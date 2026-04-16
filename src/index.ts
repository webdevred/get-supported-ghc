import {
  promisify
} from "util";
import {
  exec
} from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import * as githubCore from "@actions/core";

const execAsync = promisify(exec);

interface BaseBound {
  inclusive: boolean;
  version: string;
}

interface BaseBounds {
  lower: BaseBound | null;
  upper: BaseBound;
}

interface PackageYaml {
  dependencies ? : Array < string | {
    name: string;
    version: string;
  } > ;
  "tested-with" ? : string | string[];
}

interface GhcEntry {
  version: string;
  base: string;
}

async function runCommand(cmd: string): Promise < string > {
  const {
    stdout
  } = await execAsync(cmd);
  return stdout.trim();
}

async function getGhcupList(): Promise < string > {
  const cacheFile = process.env.RUNNER_TEMP ?
    path.join(process.env.RUNNER_TEMP, "get-supported-ghc-ghcup-list.txt") : null;

  if (cacheFile) {
    try {
      const cached = fs.readFileSync(cacheFile, "utf-8");
      githubCore.info("Using cached ghcup list output");
      return cached;
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }

  const output = await runCommand("ghcup list -t ghc -r");

  if (cacheFile) {
    fs.writeFileSync(cacheFile, output);
  }

  return output;
}

function parseBound(constraint: string, regex: RegExp, inclusiveOp: string): BaseBound | null {
  const match = constraint.match(regex);
  if (!match) return null;
  return {
    inclusive: match[1] === inclusiveOp,
    version: match[2]
  };
}

function getUpperBound(constraint: string): BaseBound | null {
  return parseBound(constraint, /(<=|<)\s*((\d+)(\.(\d+))?(\.(\d+))?(\.(\d+))?)/, "<=");
}

function getLowerBound(constraint: string): BaseBound | null {
  return parseBound(constraint, /(>=|>)\s*((\d+)(\.(\d+))?(\.(\d+))?(\.(\d+))?)/, ">=");
}

function normalizeVersion(version: string): number[] {
  return version.split(".").map(Number);
}

function compareVersions(a: string, b: string): number {
  const pa = normalizeVersion(a);
  const pb = normalizeVersion(b);
  const len = Math.max(pa.length, pb.length);

  for (let i = 0; i < len; i++) {
    const ai = pa[i] ?? 0;
    const bi = pb[i] ?? 0;
    if (ai > bi) return 1;
    if (ai < bi) return -1;
  }
  return 0;
}

function satisfiesBound(baseVersion: string, bound: BaseBound, direction: 1 | -1): boolean {
  const cmp = compareVersions(baseVersion, bound.version);
  return cmp === direction || (cmp === 0 && bound.inclusive);
}

function satisfiesUpperBound(baseVersion: string, bound: BaseBound): boolean {
  return satisfiesBound(baseVersion, bound, -1);
}

function satisfiesLowerBound(baseVersion: string, bound: BaseBound): boolean {
  return satisfiesBound(baseVersion, bound, 1);
}

function ghcMajorVersion(version: string): number {
  return Number(version.split(".")[0]);
}

function boundOp(bound: BaseBound, type: "<" | ">"): string {
  return bound.inclusive ? `${type}=` : type;
}

interface ParsedPackageYaml {
  bounds: BaseBounds;
  minTestedGhc: string | null;
}

function parsePackageYaml(packageYamlPath: string): ParsedPackageYaml {
  const fileContent = fs.readFileSync(packageYamlPath, "utf-8");
  const parsed = yaml.load(fileContent) as PackageYaml;

  const deps = parsed.dependencies;
  if (!deps || !Array.isArray(deps)) {
    throw new Error("dependencies not found or invalid in package.yaml");
  }

  const baseDep = deps.find((dep) => {
    if (typeof dep === "string") return dep === "base" || dep.startsWith("base ");
    if (typeof dep === "object" && dep.name) return dep.name === "base";
    return false;
  });

  if (!baseDep) throw new Error("No base dependency found in package.yaml");

  const constraint = typeof baseDep === "string" ? baseDep : baseDep.version;
  const upper = getUpperBound(constraint);
  if (!upper) throw new Error("No upper bound for base found in package.yaml");

  const bounds: BaseBounds = {
    lower: getLowerBound(constraint),
    upper
  };

  const testedWithRaw = parsed["tested-with"];
  const testedWith = Array.isArray(testedWithRaw) ? testedWithRaw.join(", ") : testedWithRaw;
  let minTestedGhc: string | null = null;
  if (testedWith) {
    const versions = [...testedWith.matchAll(/GHC\s*==\s*([\d.]+)/g)]
      .map((m) => m[1]);
    if (versions.length > 0) {
      versions.sort(compareVersions);
      minTestedGhc = versions[0];
    }
  }

  return {
    bounds,
    minTestedGhc
  };
}

async function main(): Promise < void > {
  try {
    const packageYamlPath =
      githubCore.getInput("package-yaml-path") || path.join(process.cwd(), "package.yaml");
    const lowerBoundInput = githubCore.getInput("validate-lower-bound");
    const checkLowerBound = lowerBoundInput === "true" || lowerBoundInput === "warn";
    const warnLowerBound = lowerBoundInput === "warn";

    const {
      bounds: {
        lower: baseLowerBound,
        upper: baseUpperBound
      },
      minTestedGhc
    } =
    parsePackageYaml(packageYamlPath);

    const ghcupListStr = await getGhcupList();
    const lines = ghcupListStr.split("\n").filter(Boolean);

    const ghcupList: GhcEntry[] = lines.flatMap((line) => {
      const match = line.match(/^ghc\s([^\s]+)\s.*?base-([0-9.]+)/);
      if (!match) return [];
      return [{
        version: match[1],
        base: match[2]
      }];
    });

    if (ghcupList.length === 0) {
      throw new Error(
        `Failed to parse GHC versions from ghcup output. Expected lines matching "ghc X.Y.Z ... base-A.B.C", got:\n${ghcupListStr.slice(0, 500)}`
      );
    }

    if (checkLowerBound && baseLowerBound && minTestedGhc) {
      const minTestedMajor = ghcMajorVersion(minTestedGhc);
      const breakingVersions = ghcupList.filter((entry) =>
        satisfiesLowerBound(entry.base, baseLowerBound) &&
        compareVersions(entry.version, minTestedGhc) < 0 &&
        ghcMajorVersion(entry.version) < minTestedMajor
      );
      if (breakingVersions.length > 0) {
        let oldest = breakingVersions[0].version;
        let newest = breakingVersions[0].version;
        for (const {
            version
          }
          of breakingVersions) {
          if (compareVersions(version, oldest) < 0) oldest = version;
          if (compareVersions(version, newest) > 0) newest = version;
        }
        const message = `base lower bound covers GHC ${oldest}..${newest} which have breaking changes relative to minimum tested version ${minTestedGhc}`;
        if (warnLowerBound) {
          githubCore.warning(message);
        } else {
          throw new Error(message);
        }
      }
    }

    const validVersions = ghcupList.filter((ghcEntry) =>
      satisfiesUpperBound(ghcEntry.base, baseUpperBound)
    );

    if (validVersions.length === 0) {
      throw new Error(
        `No GHC version found with base ${boundOp(baseUpperBound, "<")} ${baseUpperBound.version}`
      );
    }

    validVersions.sort((a, b) => compareVersions(b.version, a.version));

    const ghcVersionsJson = JSON.stringify(validVersions.map((e) => e.version));
    githubCore.setOutput("ghc-versions", ghcVersionsJson);

    const latestGhc = validVersions[0].version;

    githubCore.info(
      `Latest GHC under base ${boundOp(baseUpperBound, "<")} ${baseUpperBound.version}: ${latestGhc}`
    );

    githubCore.setOutput("max-ghc-version", latestGhc);
    githubCore.setOutput("ghc-version", latestGhc);

    if (baseLowerBound) {
      const lowerCandidates = ghcupList.filter((entry) =>
        satisfiesLowerBound(entry.base, baseLowerBound)
      );
      if (lowerCandidates.length > 0) {
        lowerCandidates.sort((a, b) => compareVersions(a.version, b.version));
        const minGhc = lowerCandidates[0].version;
        githubCore.info(
          `Oldest GHC under base ${boundOp(baseLowerBound, ">")} ${baseLowerBound.version}: ${minGhc}`
        );
        githubCore.setOutput("min-ghc-version", minGhc);
      }
    }
  } catch (err: unknown) {
    githubCore.setFailed(err instanceof Error ? err.message : String(err));
  }
}

main();

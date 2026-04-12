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
  "tested-with" ? : string;
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

function getUpperBound(constraint: string): BaseBound | null {
  const match = constraint.match(/(<=|<)\s*((\d+)(\.(\d+))?(\.(\d+))?)/);
  if (!match) return null;
  return {
    inclusive: match[1] === "<=",
    version: match[2]
  };
}

function getLowerBound(constraint: string): BaseBound | null {
  const match = constraint.match(/(>=|>)\s*((\d+)(\.(\d+))?(\.(\d+))?)/);
  if (!match) return null;
  return {
    inclusive: match[1] === ">=",
    version: match[2]
  };
}

function normalizeVersion(version: string, segments = 3): number[] {
  const parts = version.split(".").map(Number);
  while (parts.length < segments) parts.push(0);
  return parts.slice(0, segments);
}

function compareVersions(a: string, b: string): number {
  const pa = normalizeVersion(a);
  const pb = normalizeVersion(b);

  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

function satisfiesUpperBound(baseVersion: string, bound: BaseBound): boolean {
  const cmp = compareVersions(baseVersion, bound.version);
  return cmp < 0 || (cmp === 0 && bound.inclusive);
}

function satisfiesLowerBound(baseVersion: string, bound: BaseBound): boolean {
  const cmp = compareVersions(baseVersion, bound.version);
  return cmp > 0 || (cmp === 0 && bound.inclusive);
}

function ghcMajorVersion(version: string): number {
  return Number(version.split(".")[0]);
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

  const testedWith = parsed["tested-with"];
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
    const validateLowerBound = githubCore.getInput("validate-lower-bound") === "true";

    const {
      bounds: {
        lower: baseLowerBound,
        upper: baseUpperBound
      },
      minTestedGhc
    } =
    parsePackageYaml(packageYamlPath);

    const ghcupListStr = await runCommand("ghcup list -t ghc -r");
    const lines = ghcupListStr.split("\n").filter(Boolean);

    const ghcupList: GhcEntry[] = lines
      .map((line) => {
        const match = line.match(/^ghc\s([^\s]+)\s.*?base-([0-9.]+)/);
        if (!match) return null;
        return {
          version: match[1],
          base: match[2]
        };
      })
      .filter((x): x is GhcEntry => x !== null);

    if (ghcupList.length === 0) throw new Error("Failed to get GHC versions from GHCup");

    if (validateLowerBound && baseLowerBound && minTestedGhc) {
      const minTestedMajor = ghcMajorVersion(minTestedGhc);
      const breakingVersions = ghcupList.filter((entry) =>
        satisfiesLowerBound(entry.base, baseLowerBound) &&
        compareVersions(entry.version, minTestedGhc) < 0 &&
        ghcMajorVersion(entry.version) < minTestedMajor
      );
      if (breakingVersions.length > 0) {
        const oldest = breakingVersions[breakingVersions.length - 1].version;
        const newest = breakingVersions[0].version;
        throw new Error(
          `base lower bound covers GHC ${oldest}..${newest} which have breaking changes relative to minimum tested version ${minTestedGhc}`
        );
      }
    }

    const validVersions = ghcupList.filter((ghcEntry) =>
      satisfiesUpperBound(ghcEntry.base, baseUpperBound)
    );

    if (validVersions.length === 0) {
      throw new Error(
        `No GHC version found with base <${baseUpperBound.inclusive ? "=" : ""} ${baseUpperBound.version}`
      );
    }

    validVersions.sort((a, b) => compareVersions(b.version, a.version));

    const latestGhc = validVersions[0].version;

    githubCore.info(
      `Latest GHC under base <${baseUpperBound.inclusive ? "=" : ""} ${baseUpperBound.version}: ${latestGhc}`
    );

    githubCore.setOutput("ghc-version", latestGhc);
  } catch (err: unknown) {
    githubCore.setFailed(err instanceof Error ? err.message : String(err));
  }
}

main();

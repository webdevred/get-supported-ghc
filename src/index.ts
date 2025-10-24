import { exec } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import * as githubCore from "@actions/core";

interface BaseUpperBound {
  inclusive: boolean;
  version: string;
}

interface PackageYaml {
  dependencies?: Array<string | { name: string; version: string }>;
}

interface GhcEntry {
  version: string;
  base: string;
}

function runCommand(cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(cmd, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout.trim());
    });
  });
}

function getBaseUpperBound(baseBound: string): BaseUpperBound | null {
  const baseBoundMatch = baseBound.match(/(<=|<)\s*((\d+)(\.(\d+))?(\.(\d+))?)/);
  if (!baseBoundMatch) return null;

  const operator = baseBoundMatch[1];
  const version = baseBoundMatch[2];
  const inclusive = operator === "<=";

  return { inclusive, version };
}

function normalizeVersion(version: string, segments = 3): string {
  const parts = version.split(".").map(Number);
  while (parts.length < segments) parts.push(0);
  return parts.slice(0, segments).join(".");
}

function compareVersions(a: string, b: string): number {
  const pa = normalizeVersion(a).split(".").map(Number);
  const pb = normalizeVersion(b).split(".").map(Number);

  for (let i = 0; i < pa.length; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

function versionLess(baseVersion: string, bound: BaseUpperBound): boolean {
  const cmp = compareVersions(baseVersion, bound.version);
  return cmp < 0 || (cmp === 0 && bound.inclusive);
}

function parseBaseUpperBound(packageYamlPath: string): BaseUpperBound {
  const fileContent = fs.readFileSync(packageYamlPath, "utf-8");
  const parsed = yaml.load(fileContent) as PackageYaml;

  const deps = parsed.dependencies;
  if (!deps || !Array.isArray(deps)) {
    throw new Error("dependencies not found or invalid in package.yaml");
  }

  const baseDep = deps.find((dep) => {
    if (typeof dep === "string") return dep.startsWith("base");
    if (typeof dep === "object" && dep.name) return dep.name === "base";
    return false;
  });

  if (!baseDep) throw new Error("No base dependency found in package.yaml");

  const versionConstraint =
    typeof baseDep === "string"
      ? getBaseUpperBound(baseDep)
      : getBaseUpperBound(baseDep.version);

  if (!versionConstraint) throw new Error("No upper bound for base found in package.yaml");

  return versionConstraint;
}

async function main(): Promise<void> {
  try {
    const packageYamlPath =
      githubCore.getInput("package-yaml-path") || path.join(process.cwd(), "package.yaml");

    const baseUpperBound = parseBaseUpperBound(packageYamlPath);

    const ghcupListStr = await runCommand("ghcup list -t ghc -r");
    const lines = ghcupListStr.split("\n").filter(Boolean);

    const ghcupList: GhcEntry[] = lines
      .map((line) => {
        const match = line.match(/^ghc\s([^\s]+)\s.*?base-([0-9.]+)/);
        if (!match) return null;
        return { version: match[1], base: match[2] };
      })
      .filter((x): x is GhcEntry => x !== null);

    if (ghcupList.length === 0) throw new Error("Failed to get GHC versions from GHCup");

    const validVersions = ghcupList.filter((ghcEntry) =>
      versionLess(ghcEntry.base, baseUpperBound)
    );

    if (validVersions.length === 0) {
      throw new Error(
        `No GHC version found with base <${baseUpperBound.inclusive ? "=" : ""} ${baseUpperBound.version}`
      );
    }

    validVersions.sort((a, b) => compareVersions(b.version, a.version));

    const latestGhc = validVersions[0].version;

    githubCore.info(
      `Latest GHC under base < ${baseUpperBound.version}: ${latestGhc}`
    );

    githubCore.setOutput("ghc-version", latestGhc);
  } catch (err: any) {
    githubCore.setFailed(err.message);
  }
}

main();

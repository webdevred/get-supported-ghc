const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const githubCore = require("@actions/core");

async function runCommand(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve(stdout.trim());
    });
  });
}

function getBaseUpperBound(baseBound) {
  const baseBoundMatch = baseBound.match(/(<=|<)\s*((\d+)(\.(\d+))?(\.(\d+))?)/);
  if (!baseBoundMatch) return null;

  const operator = baseBoundMatch[1];
  const version = baseBoundMatch[2];
  const inclusive = operator === "<=";

  return { inclusive, version };
}

function normalizeVersion(version, segments = 3) {
  const parts = version.split('.').map(Number);
  while (parts.length < segments) parts.push(0);
  return parts.slice(0, segments).join('.');
}

function compareVersions(a, b) {
  const pa = normalizeVersion(a).split('.').map(Number);
  const pb = normalizeVersion(b).split('.').map(Number);
  const len = Math.max(pa.length, pb.length);

  for (let i = 0; i < len; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

function versionLess(baseVersion, bound) {
  const cmp = compareVersions(baseVersion, bound.version);
  return cmp < 0 || (cmp === 0 && bound.inclusive);
}

function parseBaseUpperBound(packageYamlPath) {
  const fileContent = fs.readFileSync(packageYamlPath, "utf-8");
  const parsed = yaml.load(fileContent);

  const deps = parsed.dependencies;
  if (!deps || !Array.isArray(deps)) {
    throw new Error("dependencies not found or invalid in package.yaml");
  }

  const baseDep = deps.find(dep => dep.startsWith("base"));
  if (!baseDep) {
    throw new Error("No base dependency found in package.yaml");
  }

  const versionConstraint = getBaseUpperBound(baseDep);
  if (!versionConstraint) {
    throw new Error("No upper bound for base found in package.yaml");
  }

  return versionConstraint;
}

async function main() {
  try {
    const packageYamlPath = githubCore.getInput("package-yaml-path") || path.join(process.cwd(), "package.yaml");
    const baseUpperBound = parseBaseUpperBound(packageYamlPath);

    const ghcupListStr = await runCommand("ghcup list -t ghc -r");
    const lines = ghcupListStr.split("\n").filter(Boolean);

    const ghcupList = lines.map(line => {
      const match = line.match(/^ghc\s([^\s]+)\s.*?base-([0-9.]+)/);
      if (!match) return null;
      return { version: match[1], base: match[2] };
    }).filter(Boolean);

    if (ghcupList.length > 0) {
      console.log(`Found ${ghcupList.length} GHC versions`);
    } else {
      throw new Error('Failed to get GHC versions from GHCup');
    }

    const validVersions = ghcupList.filter(ghcEntry => {
      return versionLess(ghcEntry.base, baseUpperBound);
    });

    if (validVersions.length === 0) {
      throw new Error(`No GHC version found with base <${baseUpperBound.inclusive ? "=" : ""} ${baseUpperBound.version}`);
    }

    validVersions.sort((a, b) => {
      const aVer = a.version.split('.').map(Number);
      const bVer = b.version.split('.').map(Number);
      for (let i = 0; i < Math.max(aVer.length, bVer.length); i++) {
        const n1 = aVer[i] || 0;
        const n2 = bVer[i] || 0;
        if (n1 > n2) return -1;
        if (n1 < n2) return 1;
      }
      return 0;
    });

    const latestGhc = validVersions[0].version;

    console.log(`Latest GHC under base < ${baseUpperBound.version}: ${latestGhc}`);

    const outputPath = process.env.GITHUB_OUTPUT;
    fs.appendFileSync(outputPath, `ghc-version=${latestGhc}\n`);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

main();

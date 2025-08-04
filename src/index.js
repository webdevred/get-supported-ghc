const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

async function runCommand(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve(stdout.trim());
    });
  });
}

function getBaseUpperBound(packageYamlPath) {
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

  const versionConstraint = baseDep.match(/<\s*([\d.]+)/);
  if (!versionConstraint) {
    throw new Error("No upper bound for base found in package.yaml");
  }

  return versionConstraint[1];
}

function versionLess(v1, v2) {
  const a = v1.split('.').map(Number);
  const b = v2.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const n1 = a[i] || 0;
    const n2 = b[i] || 0;
    if (n1 < n2) return true;
    if (n1 > n2) return false;
  }
  return false;
}

async function main() {
  try {
    const files = fs.readdirSync(process.cwd());

    const baseUpperBound = getBaseUpperBound(path.join(process.cwd(), "package.yaml"));

    const ghcupListStr = await runCommand("ghcup list -t ghc -r");
    const lines = ghcupListStr.split("\n").filter(Boolean);

      const ghcupList = lines.map(line => {
          const match = line.match(/^ghc\s([^\s]+)\s.*?base-([0-9.]+)/);
          if (!match) return null;
          return { version: match[1], base: match[2] };
      }).filter(Boolean);

    const validVersions = ghcupList.filter(ghcEntry => {
      return versionLess(ghcEntry.base, baseUpperBound);
    });

    if (validVersions.length === 0) {
      throw new Error(`No GHC version found with base < ${baseUpperBound}`);
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

    console.log(`Latest GHC under base < ${baseUpperBound}: ${latestGhc}`);
    const outputPath = process.env.GITHUB_OUTPUT;
    fs.appendFileSync(outputPath, `ghc-version=${latestGhc}\n`);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

main();

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function parseGitHubOutput(content) {
  const outputs = {};
  const lines = content.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const heredocMatch = lines[i].match(/^([^<]+)<<(.+)$/);
    if (heredocMatch) {
      const [, key, delimiter] = heredocMatch;
      const valueLines = [];
      i++;
      while (i < lines.length && lines[i].trimEnd() !== delimiter) {
        valueLines.push(lines[i].trimEnd());
        i++;
      }
      outputs[key] = valueLines.join("\n");
    }
    i++;
  }
  return outputs;
}

function runAction(yamlPath, validateLowerBound = false) {
  const dir = mkdtempSync(join(tmpdir(), "gsg-test-"));
  const outputFile = join(dir, "output");
  writeFileSync(outputFile, "");

  const result = spawnSync("node", ["dist/index.js"], {
    env: {
      ...process.env,
      "INPUT_PACKAGE-YAML-PATH": yamlPath,
      "INPUT_VALIDATE-LOWER-BOUND": String(validateLowerBound),
      GITHUB_OUTPUT: outputFile,
    },
    encoding: "utf-8",
  });

  const outputs = parseGitHubOutput(readFileSync(outputFile, "utf-8"));

  rmSync(dir, { recursive: true });

  if (result.status !== 0) {
    throw new Error(`Action failed:\n${result.stdout}${result.stderr}`);
  }

  return outputs;
}

test("inclusive upper bound", () => {
  const out = runAction("examples/package-equal-or-less-than.yaml");
  assert.equal(out["max-ghc-version"], "9.0.1");
  assert.equal(out["ghc-version"], out["max-ghc-version"]);
  assert.ok(out["min-ghc-version"]);
});

test("exclusive upper bound", () => {
  const out = runAction("examples/package-less-than.yaml");
  assert.equal(out["max-ghc-version"], "8.10.7");
});

test("validate-lower-bound", () => {
  const out = runAction("examples/package-validate-lower-bound.yaml", true);
  assert.ok(out["max-ghc-version"]);
  assert.equal(out["min-ghc-version"], "9.0.1");
});

test("no upper bound uses latest ghc", () => {
  const out = runAction("examples/package-no-upper-bound.yaml");
  assert.ok(out["max-ghc-version"]);
});

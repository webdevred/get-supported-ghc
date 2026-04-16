# CLAUDE.md

## Build & Test

```bash
npm clean-install
npm run build      # Bundles src/index.ts → dist/index.js via esbuild
npm run format     # Format with js-beautify — enforced in CI, run before committing
```

Use `npm clean-install` by default — it respects the lock file. `npm install` is acceptable when intentionally updating dependencies. Never use `npm ci` — the name is unclear and `clean-install` is the explicit equivalent.

## Review Philosophy

Be **harsh but rational**. If something is wrong, unclear, or fragile — say so directly. Every criticism must come with a concrete reason. "This is bad style" is not enough. "This regex silently fails on four-segment version strings like `9.10.1.1`" is.

Do not change things just because a different approach exists or it doesn't match a preferred style. Only suggest a change if it fixes a real bug, removes genuine ambiguity, or makes the code meaningfully easier to follow.

## Scope of Suggestions

Suggestions are welcome across all layers:

- **`src/index.ts`** — logic bugs, fragile parsing, poor error messages, type safety gaps
- **`action.yml`** — missing or misleading input/output descriptions, wrong defaults
- **`.github/workflows/`** — review **all** workflow files, not just the most relevant one. Unnecessary steps, missing failure handling, security issues, and flaky test assertions are all fair targets

## Testing

No unit test framework, and none should be added. All tests are integration tests that run the action end-to-end using fixture files in `examples/`. To cover new behaviour, add a fixture under `examples/` and a corresponding step in `test.yaml`, following the existing pattern.

## Ideas Worth Considering

- **Support `.cabal` or `cabal.project` files** — low priority, most cabal users likely use get-tested instead

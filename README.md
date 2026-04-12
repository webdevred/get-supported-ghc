# Get Supported GHC Version

[![Test Get Supported GHC Version Action](https://github.com/webdevred/get-supported-ghc/actions/workflows/test.yaml/badge.svg)](https://github.com/webdevred/get-supported-ghc/actions/workflows/test.yaml)

<!--toc:start-->
- [Get Supported GHC Version](#get-supported-ghc-version)
  - [Inputs](#inputs)
  - [Outputs](#outputs)
  - [Example Usage](#example-usage)
<!--toc:end-->

This GitHub Action automatically detects the latest GHC (Glasgow Haskell Compiler) version compatible with your Haskell project's `base` dependency constraint in `package.yaml`.

Useful for CI/CD workflows where you want to install a GHC version that satisfies your project's dependency bounds.

## Inputs

| Input                  | Description                                                                                                                                 | Default        | Required |
|------------------------|---------------------------------------------------------------------------------------------------------------------------------------------|----------------|----------|
| `package-yaml-path`    | Path to your `package.yaml` file relative to the repo root                                                                                  | `package.yaml` | No       |
| `validate-lower-bound` | Fail if the base lower bound covers GHC major versions with breaking changes below the minimum version in `tested-with` in your package.yaml | `false`        | No       |

## Outputs

| Output            | Description                                                 |
|-------------------|-------------------------------------------------------------|
| `max-ghc-version` | The latest compatible GHC version to install                |
| `min-ghc-version` | The oldest GHC version whose base satisfies the lower bound |
| `ghc-version`     | Deprecated - use `max-ghc-version` instead                  |

## Example Usage

```yaml
name: CI

on: [push, pull_request]

jobs:
  setup:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v4
      - name: Get supported GHC versions
        id: get-ghc
        uses: webdevred/get-supported-ghc@v0.0.1
        with:
          package-yaml-path: examples/package.yaml
          validate-lower-bound: true
      - name: Set up GHC and Cabal
        uses: haskell-actions/setup@v2.8.0
        with:
          ghc-version: "${{ steps.get-ghc.outputs.max-ghc-version }}"
```

For `validate-lower-bound` to work, add a `tested-with` field to your `package.yaml`:

```yaml
tested-with: GHC == 9.6.4, GHC == 9.8.2, GHC == 9.10.1
dependencies:
  - base >= 4.18 && < 4.22
```

If the `base` lower bound covers GHC major versions below your tested minimum (e.g. lower bound allows GHC 8.x but you only test with GHC 9.x), the action fails with a descriptive error.

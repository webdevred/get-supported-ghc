# Get Supported GHC Version

[![Test Get Supported GHC Version Action](https://github.com/webdevred/get-supported-ghc/actions/workflows/test.yaml/badge.svg)](https://github.com/webdevred/get-supported-ghc/actions/workflows/test.yaml)
[![Check for outdated dependencies](https://github.com/webdevred/get-supported-ghc/actions/workflows/updated-deps.yaml/badge.svg?event=schedule)](https://github.com/webdevred/get-supported-ghc/actions/workflows/updated-deps.yaml)

<!--toc:start-->
- [Get Supported GHC Version](#get-supported-ghc-version)
  - [Inputs](#inputs)
  - [Outputs](#outputs)
  - [Example Usage](#example-usage)
<!--toc:end-->

This GitHub Action automatically detects the latest GHC (Glasgow Haskell Compiler) version compatible with your Haskell project's `base` dependency constraint in `package.yaml`.

Useful for CI/CD workflows where you want to install a GHC version that satisfies your project's dependency bounds.

## Inputs

| Input               | Description                                                | Default        | Required |
|---------------------|------------------------------------------------------------|----------------|----------|
| `package-yaml-path` | Path to your `package.yaml` file relative to the repo root | `package.yaml` | No       |

## Outputs

| Output        | Description                                  |
|---------------|----------------------------------------------|
| `ghc-version` | The latest compatible GHC version to install |

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
      - name: Get latest supported GHC version
        id: get-ghc
        uses: webdevred/get-supported-ghc@v0.0.1
        with:
          package-yaml-path: examples/package.yaml
      - name: Set up GHC latest and Cabal
        id: setup-ghc
        uses: haskell-actions/setup@v2.8.0
        with:
          ghc-version: "${{ steps.get-ghc.outputs.ghc-version }}"
```

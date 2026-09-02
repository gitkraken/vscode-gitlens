'use strict';

// tsx (loaded via `--require tsx` or `--import tsx`) picks its decorator-transform settings by
// walking up tsconfig.json files from `process.cwd()`, not from each source file's own directory.
// That never finds e.g. `packages/git/tsconfig.json` for `@gitlens/git`'s decorated classes (its
// `@memoize()`-decorated methods) when a *different* package's tests import them across a package
// boundary -- which every `@gitlens/*` package now does routinely, since Part A of the source-package
// migration made every one of them resolve to source rather than a pre-compiled `dist/`. Undetected,
// tsx falls back to esbuild's Stage 3 decorator transform, which invokes a legacy
// `(target, key, descriptor)`-style decorator with only two arguments and crashes at runtime.
//
// Forcing tsx onto the repo's self-contained base config -- which every workspace package's
// decorator-relevant settings (`experimentalDecorators`, `target`, `useDefineForClassFields`)
// ultimately inherit from -- sidesteps the per-file, per-cwd lookup entirely. `require()` this file
// ahead of `tsx` itself (`--require ./scripts/tsxTsconfig.cjs --require tsx`, or as the first
// `--import`) so the env var is set before tsx's loader installs.
process.env.TSX_TSCONFIG_PATH ??= require('node:path').join(__dirname, '..', 'tsconfig.base.json');

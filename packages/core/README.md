# @gitkraken/core-gitlens

Shared Git, AI, and GitHub primitives from [GitLens](https://github.com/gitkraken/vscode-gitlens), bundled for consumption by internal GitKraken products.

This package flattens five internal workspace packages into a single tarball:

| Subpath             | Source package        | License        |
| ------------------- | --------------------- | -------------- |
| `utils/*`           | `@gitlens/utils`      | See `LICENSE`  |
| `git/*`             | `@gitlens/git`        | See `LICENSE`  |
| `git-cli/*`         | `@gitlens/git-cli`    | See `LICENSE`  |
| `plus/ai/*`         | `@gitlens/ai`         | `LICENSE.plus` |
| `plus/git-github/*` | `@gitlens/git-github` | `LICENSE.plus` |

## Usage

```ts
import { Logger } from '@gitkraken/core-gitlens/utils/logger.js';
import { GitService } from '@gitkraken/core-gitlens/git/service.js';
import { Repository } from '@gitkraken/core-gitlens/git/models/repository.js';
import { CliGitProvider } from '@gitkraken/core-gitlens/git-cli/cliGitProvider.js';

// Plus subpaths (proprietary)
import { GitHubProvider } from '@gitkraken/core-gitlens/plus/git-github/providers/githubProvider.js';
import { AiService } from '@gitkraken/core-gitlens/plus/ai/service.js';
```

All exports are fully typed and source-mapped back to the original TypeScript sources shipped in `src/`.

### Node vs browser

`utils/` uses internal `#env/*` imports that resolve differently based on the target:

- Node: `dist/utils/env/node/*.js`
- Browser / webworker bundlers (webpack, Vite, esbuild, Rspack): `dist/utils/env/browser/*.js`

No consumer configuration required — the runtime / bundler picks the right variant automatically via the package's `"imports"` field.

### Tree-shaking

The package is marked `"sideEffects": false` and uses per-file subpath exports. If you only import from `git/*` or `utils/*`, the `plus/*` code (including octokit dependencies) will never be loaded by Node nor included in a webpack/Rollup/esbuild bundle.

## Licensing

- `LICENSE` — governs `utils/`, `git/`, and `git-cli/`.
- `LICENSE.plus` — governs everything under `plus/` (currently `plus/ai/` and `plus/git-github/`). Proprietary; not for redistribution.

## Versioning

Independent from the [GitLens VS Code extension](https://github.com/gitkraken/vscode-gitlens). Breaking changes may happen on any minor bump while the package is `0.x`.

## Source

Built from the `packages/` workspace of [vscode-gitlens](https://github.com/gitkraken/vscode-gitlens). See `packages/core/scripts/bundle.mjs` in that repo for the flattening logic.

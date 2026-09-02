# @gitkraken/core-gitlens

Shared Git, AI, and GitHub primitives from [GitLens](https://github.com/gitkraken/vscode-gitlens), bundled for consumption by internal GitKraken products.

This package flattens eight internal workspace packages into a single tarball:

| Subpath               | Source package          | License        |
| --------------------- | ----------------------- | -------------- |
| `utils/*`             | `@gitlens/utils`        | See `LICENSE`  |
| `ipc/*`               | `@gitlens/ipc`          | See `LICENSE`  |
| `git/*`               | `@gitlens/git`          | See `LICENSE`  |
| `git-cli/*`           | `@gitlens/git-cli`      | See `LICENSE`  |
| `plus/ai/*`           | `@gitlens/ai`           | `LICENSE.plus` |
| `plus/git-github/*`   | `@gitlens/git-github`   | `LICENSE.plus` |
| `plus/agents/*`       | `@gitlens/agents`       | `LICENSE.plus` |
| `plus/integrations/*` | `@gitlens/integrations` | `LICENSE.plus` |

## Usage

```ts
import { Logger } from '@gitkraken/core-gitlens/utils/logger.js';
import { GitService } from '@gitkraken/core-gitlens/git/service.js';
import { Repository } from '@gitkraken/core-gitlens/git/models/repository.js';
import { CliGitProvider } from '@gitkraken/core-gitlens/git-cli/cliGitProvider.js';

// Plus subpaths (proprietary)
import type { GitHubGitProviderInternal } from '@gitkraken/core-gitlens/plus/git-github/providers/githubProvider.js';
import { OpenAIProvider } from '@gitkraken/core-gitlens/plus/ai/providers/openaiProvider.js';
```

All exports are fully typed and source-mapped, with the original TypeScript sources embedded in the maps.

### Provider integrations

Reading provider data (pull requests, issues, orgs, projects, repos, repository identity) goes through the
provider-neutral facade at `plus/integrations/index.js`. It has its own guide — runtime wiring, the paging and
warning contracts, the filter capability table, and a per-provider capability matrix:
[`docs/integrations.md`](./docs/integrations.md).

### Node vs browser

`utils/` uses internal `#env/*` imports that resolve differently based on the target:

- Node: `dist/utils/env/node/*.js`
- Browser / webworker bundlers (webpack, Vite, esbuild, Rspack): `dist/utils/env/browser/*.js`

No consumer configuration required — the runtime / bundler picks the right variant automatically via the package's `"imports"` field.

### Tree-shaking

The package is marked `"sideEffects": false` and uses per-file subpath exports. If you only import from `git/*` or `utils/*`, the `plus/*` code (including octokit dependencies) will never be loaded by Node nor included in a webpack/Rollup/esbuild bundle.

## Licensing

- `LICENSE` — governs `utils/`, `git/`, and `git-cli/`.
- `LICENSE.plus` — governs everything under `plus/` (currently `plus/ai/`, `plus/git-github/`, `plus/agents/`, and `plus/integrations/`). Proprietary; not for redistribution.

## Versioning

Independent from the [GitLens VS Code extension](https://github.com/gitkraken/vscode-gitlens). Breaking changes may happen on any minor bump while the package is `0.x`.

## Source

Built from the `packages/` workspace of [vscode-gitlens](https://github.com/gitkraken/vscode-gitlens), by `pnpm --filter @gitkraken/core-gitlens run build` in two steps:

1. **`tsdown.config.ts`** compiles the eight packages' TypeScript sources straight into `dist/`, one emitted module per source module, each rooted at the subpath in the table above. It reads their `src/` directly — the packages' own manifests resolve to source, so nothing here waits on their `dist/` — and cross-package imports come out as relative paths, with `#env/*` staying external for the `"imports"` field to resolve.
2. **`scripts/bundle.mjs`** assembles everything around that: it copies the LICENSEs and generates the manifest's `exports`, `imports`, and `dependencies` from the eight sub-packages' own manifests.

Neither the subpath layout nor the generated manifest is hand-written, so adding or removing a bundled package is a one-line change to `scripts/packages.mjs`, which both steps read.

The declaration files are emitted by the TypeScript compiler against `tsconfig.core-dts.json` at the repo root. That config sits at the root rather than beside this package because the emitter uses its directory as the compiler's `rootDir`, which has to contain every bundled source.

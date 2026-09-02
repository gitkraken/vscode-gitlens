# `@gitkraken/commit-graph`

High-performance, rendering-agnostic commit-graph engine and view model. It owns lane allocation, edge routing,
incremental reconcile/splice/delta classification, projections, geometry, theming, and accessibility helpers. It
does not depend on Lit, GitLens, VS Code, RPC, or another runtime package.

The package produces ESM, declarations, and source maps under `dist/`, exposes explicit subpaths, and is verified
as a packed external dependency. GitLens resolves workspace imports directly to `src/` so stale local `dist`
output can never enter its webview bundle.

## Public modules

The package has no barrel. Its `exports` map exposes these module groups:

| Module                                                                | Role                                                         |
| --------------------------------------------------------------------- | ------------------------------------------------------------ |
| `engine/types.js`                                                     | Canonical rows, commits, processed rows, edges, and segments |
| `engine/layout.js`                                                    | Lane allocation, pinned-branch stacking, and paging resume   |
| `engine/edges.js`                                                     | Edge state machine and memoization hash                      |
| `engine/process.js`                                                   | Low-level layout and edge pipeline                           |
| `engine/session.js`                                                   | Stateful delta, resume, and reconcile owner                  |
| `engine/reconcile.js`                                                 | Suffix identity reconciliation                               |
| `engine/delta.js`                                                     | Initial, append, payload, and replacement classification     |
| `engine/navigation.js`                                                | Keyboard navigation targets over laid-out rows               |
| `engine/adornments.js`                                                | Framework-neutral row-adornment provider contract            |
| `wip/identity.js`, `wip/nearest.js`                                   | Stable WIP-row creation/parsing, and nearest-WIP lookup      |
| `projection.js`, `lanes/collapse.js`, `scope.js`                      | Incremental row projections                                  |
| `zones.js`, `geometry.js`, `lanes/window.js`, `paging.js`, `stats.js` | Renderer-neutral view math                                   |
| `time.js`, `lanes/colors.js`, `a11y.js`, `theme.css`                  | Formatting, palette, labels, and generic design tokens       |

```ts
import { CommitGraphEngineSession } from '@gitkraken/commit-graph/engine/session.js';
import type { GraphCommit } from '@gitkraken/commit-graph/engine/types.js';
import { createWipRowId, isWipRowId } from '@gitkraken/commit-graph/wip/identity.js';
import '@gitkraken/commit-graph/theme.css';
```

## Runtime contract

Layout and projection are DOM-free. `engine/adornments.js` uses the standard `EventTarget` and `CustomEvent`
globals for targeted invalidation, so that module requires a browser or Node.js 19 and newer. The GitLens
workspace requires Node.js 24 and therefore satisfies this contract.

## Build, tests, and package verification

```bash
pnpm --filter @gitkraken/commit-graph run build
pnpm --filter @gitkraken/commit-graph run test
pnpm --filter @gitkraken/commit-graph run verify:package
```

The package verifier installs the produced tarball into a temporary consumer, type-checks it, bundles it for a
browser, executes the engine contract in Node.js, and resolves the exported theme. Deterministic benchmarks cover
200, 2,000, 10,000, and 100,000-row lane-heavy updates.

## License

Proprietary; see `LICENSE.plus`.

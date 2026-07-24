# @gitkraken/commit-graph

A pure-TypeScript, dependency-free commit-graph **engine**: lane allocation, edge routing,
and incremental reconcile/splice/delta classification, plus view geometry, theming, and a11y
helpers. No UI framework, no DOM rendering — the consumer owns rendering entirely.

Vendored into GitLens for the experimental Lit-based graph renderer
(`src/webviews/apps/plus/graph/graph-wrapper/`).

## Status

Private, vendored, not published (`"private": true` in package.json).

## API surface

One line per public module (see the `exports` map in `package.json`):

| Module                 | Role                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------ |
| `engine/types.js`      | Core data shapes: `GraphRow`, `ProcessedGraphRow`, `GraphCommit`, edges, segments    |
| `engine/layout.js`     | Lane (column) allocation, including pinned-branch stacking and paging resume         |
| `engine/edges.js`      | Edge state machine (starting/passThrough/ending) + memoization hash                  |
| `engine/process.js`    | Convenience pipeline wiring layout + edges over a list of commits                    |
| `engine/reconcile.js`  | Suffix identity reconciliation — restores row object identity across a prefix change |
| `engine/delta.js`      | Classifies a rows update as `initial` / `append` / `payload` / `replace`             |
| `engine/adornments.js` | Framework-agnostic adornment provider contract (refs, badges, stack chips, …)        |
| `view.js`              | Zone/column layout solver, geometry constants, date formatting, style enums          |
| `colors.js`            | OKLCH lane palette + `setLanePalette()` to swap in a host theme's colors             |
| `a11y.js`              | `buildAriaLabel()` — composes a commit row's `aria-label`                            |
| `theme.css`            | Generic design tokens (`--brand`, `--background`, …) — no host-specific variables    |

## Consumption model

Source-only exports: every subpath maps straight to its `.ts` file (both `types` and
`default` conditions), so consumers must bundle TypeScript themselves — there's no build
step or `dist/` in this package. GitLens's webpack build resolves it with no extra config.

```ts
import { processCommits } from '@gitkraken/commit-graph/engine/process.js';
import type { GraphCommit } from '@gitkraken/commit-graph/engine/types.js';
import { buildAriaLabel } from '@gitkraken/commit-graph/a11y.js';
import '@gitkraken/commit-graph/theme.css';
```

## Testing

```bash
pnpm --filter @gitkraken/commit-graph test
```

Runs the mocha + tsx suites under `src/**/__tests__/` — the engine suites plus the
package-local view tests (`solveZoneLayout`). The remaining view coverage (lane clamping)
lives in the GitLens consumer tree (see below); the a11y helpers have no dedicated tests
and are exercised only through the consumer's rendering.

## Moving this package to its own repo

Remaining steps before this can be extracted and published on its own:

- Pin the `catalog:` devDependencies to concrete versions.
- Add a build/bundle step producing `dist/` + `.d.ts` output (mirror `packages/core`'s
  `scripts/bundle.mjs` pattern) — the source-only exports work for an in-monorepo consumer
  but not an external one.
- Recreate the lint overrides that currently live in the root `.oxlintrc.json` for
  `packages/plus/commit-graph/src/**/*`.
- Relocate the remaining view/a11y tests that currently live under
  `src/webviews/apps/plus/graph/graph-wrapper/__tests__/` in the GitLens consumer tree.

## License

Proprietary. It lives under a directory named `plus`, so it is covered by `LICENSE.plus` (see the repo root `LICENSE`).

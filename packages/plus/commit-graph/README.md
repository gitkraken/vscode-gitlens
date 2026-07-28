# @gitkraken/commit-graph

A pure-TypeScript, dependency-free commit-graph **engine**: lane allocation, edge routing,
and incremental reconcile/splice/delta classification, plus view geometry, theming, and a11y
helpers. No UI framework, no DOM rendering — the consumer owns rendering entirely.

Vendored into GitLens as its Lit-based Commit Graph renderer
(`src/webviews/apps/plus/graph/graph-wrapper/`).

## Status

Private, vendored, not published (`"private": true` in package.json).

## API surface

One line per public module (see the `exports` map in `package.json`):

| Module                 | Role                                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| `engine/types.js`      | Core data shapes: `GraphRow`, `ProcessedGraphRow`, `GraphCommit`, edges, segments        |
| `engine/layout.js`     | Lane (column) allocation, including pinned-branch stacking and paging resume             |
| `engine/edges.js`      | Edge state machine (starting/passThrough/ending) + memoization hash                      |
| `engine/process.js`    | Low-level pipeline wiring layout + edges over canonical graph rows                       |
| `engine/session.js`    | Stateful delta/resume/reconcile owner for a consumer's graph dataset                     |
| `engine/reconcile.js`  | Suffix identity reconciliation — restores row object identity across a prefix change     |
| `engine/delta.js`      | Classifies a rows update as `initial` / `append` / `payload` / `replace`                 |
| `engine/navigation.js` | Keyboard navigation targets over the laid-out rows                                       |
| `engine/adornments.js` | Framework-agnostic adornment provider contract (refs, badges, stack chips, …)            |
| `projection.js`        | Stateful fold/scope intent and incremental projection of engine rows                     |
| `laneCollapse.js`      | Lane-segment folding: default set, segment maps, row filter + incremental append/splice  |
| `scope.js`             | Focal-branch scope anchors, in-scope first-parent chain, and the re-root fold projection |
| `nearestWip.js`        | Picks which working-changes row a commit click jumps to (lane-first, ancestry fallback)  |
| `view.js`              | Zone/column layout solver, geometry constants, date formatting, style enums              |
| `laneClamp.js`         | Translated-surface gutter geometry, lane build window, grouped width/cap math            |
| `paging.js`            | Row-prefetch distance for the paging trigger                                             |
| `stats.js`             | Changes-column diffstat math (mode/width stages, churn scaling)                          |
| `colors.js`            | OKLCH lane palette + `setLanePalette()` to swap in a host theme's colors                 |
| `a11y.js`              | `buildAriaLabel()` — composes a commit row's `aria-label`                                |
| `theme.css`            | Generic design tokens (`--brand`, `--background`, …) — no host-specific variables        |

## Consumption model

Source-only exports: every subpath maps straight to its `.ts` file (both `types` and
`default` conditions), so consumers must bundle TypeScript themselves — there's no build
step or `dist/` in this package. GitLens's webpack build resolves it with no extra config.

```ts
import { CommitGraphEngineSession } from '@gitkraken/commit-graph/engine/session.js';
import type { GraphCommit } from '@gitkraken/commit-graph/engine/types.js';
import { buildAriaLabel } from '@gitkraken/commit-graph/a11y.js';
import '@gitkraken/commit-graph/theme.css';
```

## Testing

```bash
pnpm --filter @gitkraken/commit-graph test
```

Runs the mocha + tsx suites under `src/**/__tests__/` — the engine suites plus the
package-local module tests (`solveZoneLayout`, lane clamping, lane collapse, scope,
nearestWip, paging, stats, colors, a11y). The remaining untested helpers are
exercised only through the consumer's rendering.

## Moving this package to its own repo

Remaining steps before this can be extracted and published on its own:

- Pin the `catalog:` devDependencies to concrete versions.
- Add a build/bundle step producing `dist/` + `.d.ts` output (mirror `packages/core`'s
  `scripts/bundle.mjs` pattern) — the source-only exports work for an in-monorepo consumer
  but not an external one.
- Recreate the lint overrides that currently live in the root `.oxlintrc.json` for
  `packages/plus/commit-graph/src/**/*` — including the import ban that keeps this package
  free of `@gitlens/*`, which is what makes the host-agnostic boundary enforceable rather
  than merely intended.

The tests still under `src/webviews/apps/plus/graph/graph-wrapper/__tests__/` are genuinely
consumer-owned (the `GitGraphRow` adapter, gutter caching/raster, fixed layout, scroll
markers) and stay behind.

## License

Proprietary. It lives under a directory named `plus`, so it is covered by `LICENSE.plus` (see the repo root `LICENSE`).

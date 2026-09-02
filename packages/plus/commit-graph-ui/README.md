# `@gitkraken/commit-graph-ui`

Host-neutral Lit renderer and static composition API for the GitKraken commit graph. The package owns the
virtualized graph surface, row/gutter rendering, renderer contracts, and optional row features. It does not own a
product shell, transport, persistence, licensing, telemetry, details panel, sidebar, minimap, or search service.

GitLens resolves this package to `src/` and includes it in the existing webview bundle. External consumers use the
built package and must bundle its ESM into their browser asset; it is not an external runtime script.

## Installation

Install `@gitkraken/commit-graph-ui` and its `lit` peer dependency; nothing else is required. The `@gitlens/*`
packages it draws on internally are compiled into this package's own `dist/` at build time, not published, so they
are never installed separately.

## Public surface

The published `exports` map is narrow and is a one-way door — everything else under `dist/` is an internal
implementation detail that can change shape without notice:

- JS: `graph.js`, `register.js`, `profile.js`, `contracts/*.js`, `extensions/*.js`, `package.json`.
- CSS: `graph.css`, `themes/vscode.css`, `extensions/scrollMarkers.css`, `extensions/stickyTimeline.css`.

GitLens's own webview code is the one exception: it resolves this package straight to `src/` and is allowed to
import additional internal subpaths, gated by lint through the package's `workspaceExports` field rather than
`exports`.

## Minimal profile

Importing contracts or the surface does not register custom elements. Registration is explicit and idempotent.

```ts
import type { CommitGraphSourceRow } from '@gitkraken/commit-graph-ui/contracts/rows.js';
import { registerCommitGraphElements } from '@gitkraken/commit-graph-ui/register.js';
import { minimalCommitGraphProfile } from '@gitkraken/commit-graph-ui/profile.js';
import type { GlCommitGraph } from '@gitkraken/commit-graph-ui/graph.js';
import '@gitkraken/commit-graph-ui/graph.css';

registerCommitGraphElements();

const rows: CommitGraphSourceRow[] = [];
const graph = document.createElement('gl-commit-graph') as GlCommitGraph;
graph.profile = minimalCommitGraphProfile;
graph.rows = rows;
document.body.append(graph);
```

The minimal profile includes no ref, WIP-stat, lane-collapse, sticky-timeline, or scroll-marker implementation.
Those modules are absent from a tree-shaken browser bundle, which the packed-consumer verifier checks from esbuild
metafiles.

## Selecting extensions

A profile is a frozen object literal built once before mount, typed `CommitGraphProfile`. Each slot is a direct,
named import — there is no registry, builder, feature discovery, service container, or feature-map lookup on row
and scroll paths. Assign a slot to opt in; leave it out to opt out, which lets bundlers drop the unused extension
module entirely.

```ts
import { laneCollapseExtension } from '@gitkraken/commit-graph-ui/extensions/laneCollapse.js';
import { refsExtension } from '@gitkraken/commit-graph-ui/extensions/refs.js';
import { scrollMarkersExtension } from '@gitkraken/commit-graph-ui/extensions/scrollMarkers.js';
import { stickyTimelineExtension } from '@gitkraken/commit-graph-ui/extensions/stickyTimeline.js';
import { wipStatsExtension } from '@gitkraken/commit-graph-ui/extensions/wipStats.js';
import { defaultCommitGraphRowAdapter } from '@gitkraken/commit-graph-ui/contracts/rows.js';
import type { CommitGraphProfile } from '@gitkraken/commit-graph-ui/profile.js';
import '@gitkraken/commit-graph-ui/extensions/scrollMarkers.css';
import '@gitkraken/commit-graph-ui/extensions/stickyTimeline.css';

const profile: CommitGraphProfile = Object.freeze({
	rowAdapter: defaultCommitGraphRowAdapter,
	refs: refsExtension,
	wipStats: wipStatsExtension,
	laneCollapse: laneCollapseExtension,
	stickyTimeline: stickyTimelineExtension,
	scrollMarkers: scrollMarkersExtension,
});
```

A product that needs custom row contexts or ref-finder UI supplies the narrow callbacks in `CommitGraphProfile`
directly. Product rows are adapted only when the engine reconciles changed input, never once per DOM render. The
type system already makes each slot duplicate-free, and the surface renders no ref finder without a `refs` slot.
Rows, refs, and controls that carry `context`/`contextData` get a `data-vscode-context` attribute — VS Code's
native context-menu protocol — and a host that supplies no context data emits no attribute at all.

## Supplying data

The package does not add a data transport. A product feeds canonical rows and stable SHA-keyed sidecars into the
surface from its existing state flow. Refs, WIP stats, and lane collapse use the engine's synchronous
`RowAdornmentProvider` contract. Sticky timeline and scroll markers receive one-time-bound `StickyTimelineHost`
and `ScrollMarkersHost` views respectively; these expose already-available rows, maps, geometry, and host actions
without promises or new subscriptions on the render and scroll paths.

A working-changes row's action strip is entirely product-supplied: the host ships one `GraphRowAction` list per
row through `rowActionsByRowSha` (`action`, `icon`, `label`, `persistent`, optional class and status content) and
the renderer draws them in order, routing clicks by the descriptor's `action`. Hosts build these once per
WIP-state change, never per render. The renderer has no knowledge of compose/review/resolve workflows, GitLens
agent-session categories, or issue-tracker rosters.

## Requirements

The published stylesheets size everything in `rem`, but the engine's row geometry is fixed in pixels (24px rows,
a 24px header). Both only agree if the document root is 10px, not the browser default of 16px:

```css
html {
	font-size: 62.5%;
}
```

GitLens and the other GitKraken webviews already set this. A host that skips it gets a browser default 16px root,
where the header and controls overflow the fixed 24px rows.

## Styling and fonts

`graph.css` contains the base renderer rules, the engine defaults, and host-neutral fallback tokens. External
profiles selecting sticky timeline or scroll markers must also import the matching extension stylesheet; profiles
that omit an extension carry neither its controller/rendering module nor its styles. Consumers can override the
documented `--gl-graph-*` properties on `gl-commit-graph`. VS Code hosts can additionally import
`@gitkraken/commit-graph-ui/themes/vscode.css`; other hosts never load or need to emulate VS Code variables.

The renderer's `code-icon` elements expect `codicon` and `glicons` font faces to be supplied by the product shell.
They are deliberately not embedded in this package because the host owns asset URLs and CSP policy.

## Performance contract

- Prepare a profile once and keep it stable for the mounted surface.
- Feed rows over the product's existing transport; the package introduces no RPC layer.
- Row adapters run only during engine reconciliation.
- Opted-out hot features create no controllers, adornment providers, or per-visible-row provider calls.
- Non-dynamic adornments retain per-SHA result caching; dynamic adornments intentionally bypass it.
- Engine CPU/allocation (`benchmark:graph:engine:compare`) and bundle-byte budgets
  (`benchmark:graph:bundle:check`) gate boundary changes. The browser frame/heap summary
  (`benchmark:graph:browser`) is a tracked, comparison-ready CI artifact — its five-run open-to-visible
  measurement is too noisy for a defensible automated gate, so compare candidate and baseline runs from
  the same controlled runner by hand (see `docs/testing.md`).

## Build and verification

```bash
pnpm --filter @gitkraken/commit-graph-ui run build
pnpm --filter @gitkraken/commit-graph-ui run test
pnpm --filter @gitkraken/commit-graph-ui run verify:package
```

`build` runs tsdown, which resolves `@gitlens/utils` and `@gitlens/components` to their sources and emits one file
per module this package actually reaches into `dist/utils/` and `dist/components/` — whole-package copies are never
made, and neither package's `dist/` is an input, so nothing has to be compiled first. The browser half of utils'
`#env/*` shim is picked at bundle time, which is why the published manifest carries no `imports` map.

The verifier packs this package and the engine, runs `publint` and `attw` over the tarballs, type-checks a consumer
against them, builds minimal and full browser profiles, checks the packaged stylesheet, and asserts that opted-out
extension implementation modules are absent from the minimal metafile.

## License

Proprietary; see `LICENSE.plus`.

# `@gitkraken/commit-graph-ui`

Host-neutral Lit renderer and static composition API for the GitKraken commit graph. The package owns the
virtualized graph surface, row/gutter rendering, renderer contracts, and optional row features. It does not own a
product shell, transport, persistence, licensing, telemetry, details panel, sidebar, minimap, or search service.

GitLens resolves this package to `src/` and includes it in the existing webview bundle. External consumers use the
built package and must bundle its ESM into their browser asset; it is not an external runtime script.

## Minimal profile

Importing contracts or the surface does not register custom elements. Registration is explicit and idempotent.

```ts
import type { CommitGraphSourceRow } from '@gitkraken/commit-graph-ui/contracts/rows.js';
import { registerCommitGraphElements } from '@gitkraken/commit-graph-ui/register.js';
import { minimalCommitGraphRuntime } from '@gitkraken/commit-graph-ui/runtime.js';
import type { GlLitGraph } from '@gitkraken/commit-graph-ui/surface.js';
import '@gitkraken/commit-graph-ui/surface.css';

registerCommitGraphElements();

const rows: CommitGraphSourceRow[] = [];
const graph = document.createElement('gl-lit-graph') as GlLitGraph;
graph.runtime = minimalCommitGraphRuntime;
graph.rows = rows;
document.body.append(graph);
```

The minimal profile includes no ref, WIP-stat, lane-collapse, sticky-timeline, or scroll-marker implementation.
Those modules are absent from a tree-shaken browser bundle, which the packed-consumer verifier checks from esbuild
metafiles.

## Selecting extensions

Profiles use explicit imports and are prepared once before mount. There is no registry, feature discovery, service
container, or feature-map lookup on row and scroll paths.

```ts
import { laneCollapseExtension } from '@gitkraken/commit-graph-ui/extensions/laneCollapse.js';
import { refsExtension } from '@gitkraken/commit-graph-ui/extensions/refs.js';
import { scrollMarkersExtension } from '@gitkraken/commit-graph-ui/extensions/scrollMarkers.js';
import { stickyTimelineExtension } from '@gitkraken/commit-graph-ui/extensions/stickyTimeline.js';
import { wipStatsExtension } from '@gitkraken/commit-graph-ui/extensions/wipStats.js';
import { defineCommitGraphProfile, prepareCommitGraphRuntime } from '@gitkraken/commit-graph-ui/runtime.js';
import '@gitkraken/commit-graph-ui/extensions/scroll-markers.css';
import '@gitkraken/commit-graph-ui/extensions/sticky-timeline.css';

const runtime = prepareCommitGraphRuntime(
	defineCommitGraphProfile({
		extensions: [
			refsExtension,
			wipStatsExtension,
			laneCollapseExtension,
			stickyTimelineExtension,
			scrollMarkersExtension,
		],
	}),
);
```

A product that needs custom row contexts or ref-finder UI supplies the narrow callbacks in
`CommitGraphProfileDefinition`. Product rows are adapted only when the engine reconciles changed input, never once
per DOM render. Duplicate slots fail during profile preparation, and a ref finder cannot be configured without the
refs extension. A host with a native context-menu attribute can select its attribute name once through
`hostContextAttribute`; other hosts omit it and the renderer writes no host-specific context attribute.

## Supplying data

The package does not add a data transport. A product feeds canonical rows and stable SHA-keyed sidecars into the
surface from its existing state flow. Refs, WIP stats, and lane collapse use the engine's synchronous
`RowAdornmentProvider` contract. Sticky timeline and scroll markers receive one-time-bound `StickyTimelineHost`
and `ScrollMarkersHost` views respectively; these expose already-available rows, maps, geometry, and host actions
without promises or new subscriptions on the render and scroll paths.

Product-specific working-row activity is adapted to `GraphRowActivity` (`action`, `icon`, `label`, optional class
and status content). The renderer has no knowledge of GitLens agent-session categories or issue-tracker rosters.

## Styling and fonts

`surface.css` contains the base renderer rules, the engine defaults, and host-neutral fallback tokens. External
profiles selecting sticky timeline or scroll markers must also import the matching extension stylesheet; profiles
that omit an extension carry neither its controller/rendering module nor its styles. Consumers can override the
documented `--gl-graph-*` properties on `gl-lit-graph`. VS Code hosts can additionally import
`@gitkraken/commit-graph-ui/themes/vscode.css`; other hosts never load or need to emulate VS Code variables.

The renderer's `code-icon` elements expect `codicon` and `glicons` font faces to be supplied by the product shell.
They are deliberately not embedded in this package because the host owns asset URLs and CSP policy.

## Performance contract

- Prepare a runtime once and keep it stable for the mounted surface.
- Feed rows over the product's existing transport; the package introduces no RPC layer.
- Row adapters run only during engine reconciliation.
- Opted-out hot features create no controllers, adornment providers, or per-visible-row provider calls.
- Non-dynamic adornments retain per-SHA result caching; dynamic adornments intentionally bypass it.
- Engine CPU/allocation, browser frame/heap, and bundle-metafile gates must pass for boundary changes.

## Build and verification

```bash
pnpm --filter @gitkraken/commit-graph-ui run build
pnpm --filter @gitkraken/commit-graph-ui run test
pnpm --filter @gitkraken/commit-graph-ui run verify:package
```

The verifier packs this package and its three workspace dependencies, type-checks a consumer against the tarballs,
builds minimal and full browser profiles, checks the packaged stylesheet, and asserts that opted-out extension
implementation modules are absent from the minimal metafile.

## License

Proprietary; see `LICENSE.plus`.

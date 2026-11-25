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

- JS: `graph.js`, `register.js`, `overviewBar.js`, `debug.js`, `profile.js`, `localization.js`,
  `contracts/*.js`, `extensions/*.js`, `package.json`.
- CSS: `graph.css`, `themes/vscode.css`, `extensions/scrollMarkers.css`, `extensions/stickyTimeline.css`.
- Data: `l10n/messages.json`, the message catalog (see "Localization").

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
native context-menu protocol — and a host that supplies no context data emits no attribute at all. The element's
`vscode` property carries the same kind of payload for the graph's own controls (`columnsContext` for the column
header, `settingsContext` for the header settings button, `scrollMarkersContext` for the scroll-marker rail), and
an event detail that echoes one back names it `vscodeContext` (`vscodeSelectionContexts` for a copied selection).
Only a VS Code webview host sets or reads any of these.

## Supplying data

The package does not add a data transport. A product feeds canonical rows and stable SHA-keyed sidecars into the
surface from its existing state flow. Refs, WIP stats, and lane collapse use the engine's synchronous
`RowAdornmentProvider` contract. Sticky timeline and scroll markers receive one-time-bound `StickyTimelineHost`
and `ScrollMarkersHost` views respectively; these expose already-available rows, maps, geometry, and host actions
without promises or new subscriptions on the render and scroll paths.

A working-changes row's action strip is entirely product-supplied: the host ships one `GraphRowAction` list per
row through `rowActionsByRowSha` (`action`, `icon`, `label`, `persistent`, optional class and status content) and
the renderer draws them in order, routing clicks by the descriptor's `action`. Hosts build these once per
WIP-state change, never per render. The renderer has no knowledge of compose/review/resolve workflows or issue-tracker rosters. Agent sessions are
the one exception in the overview bar, which knows four states (`idle`, `working`, `needs-input`, `ended`) and
how to draw each; a host maps its own session states onto them, and `renderAgentStatus` replaces the drawing. Each working-changes row names its branch and worktree from
`wipRowInfoByRowSha`, one `WipRowInfo` (`contracts/rows.js`) per row, and shows its state from `wipStateById`,
one `GraphWipState` (`contracts/state.js`) per row. `hasDirtyCounts(workDirStats)` (`contracts/state.js`) is the
graph's own test of whether counts leave anything to commit, for a host that derives `hasChanges` (or an overview
bar pill's `hasWorkingChanges`) from them.

Ref metadata (upstream ahead/behind, pull requests, issues) is asked for lazily: the element dispatches
`gl-graph-missingrefsmetadata` with the ids and types it lacks for the refs on rows in view, asking for each pair
once, so a ref is asked for when it first scrolls into view. Answer with `addRefsMetadata(answered)`, which merges
per ref id and keeps earlier answers (`null` for an id = asked, and there's none) and redraws only the rows those
refs are on, then `settleMissingRefsMetadata(requested, answered)` so anything left unanswered is asked again with
backoff. Assigning `refsMetadata` replaces the whole map, and `null` turns the feature off. To refresh answers, assign a map without them and increment `refsMetadataResetToken`, and the element asks again for whatever the new map lacks (an empty map needs no increment). `config.refsMetadataRange` widens what is asked for. `'rendered'` (the default) asks only for refs on rows in
view. `'loaded'` also asks for the `pullRequest` type for every loaded row's refs, once per ref, so a marker drawn
for every row (a minimap, say) has them; it costs one host lookup per loaded ref, where the default costs one per ref
scrolled into view. The element uses `'loaded'` by itself while its own `pullRequests` scroll marker is enabled
(`config.scrollMarkerTypes` with the `scrollMarkers` extension in the profile).

The other rows' built-in buttons (stash apply/drop, undo commit, open changes, push to commit) route through
`gl-graph-rowaction`; jump to working changes goes out as `gl-graph-jumptonearestwip` instead (see "Events"). A host
that can't serve all of them lists the ones it can in the element's `supportedRowActions` property
(`GraphBuiltInRowAction[]`); the rest aren't drawn, and an empty list draws none. Leaving it unset draws every one,
as GitLens does. Leaving out `jump-to-working-changes` also leaves the `w` and Shift+W keys to the browser.
Undo Commit is drawn on a row whose `CommitGraphView.undo` the profile's `rowAdapter` sets (the default adapter
never does). `pickRowUndoTarget(heads, hasChildren)` (`contracts/rows.js`) picks the head GitLens offers it for: none
when the commit has children, else the current HEAD, else the one worktree whose HEAD is that commit (several make
it ambiguous, so none); its `worktreeHead.worktree.path` is the `worktreePath` the `undo-commit` action reports.

`includeOnlyRefs` narrows the graph to the history of the refs it lists, keyed by ref id. An empty map, like leaving
it unset, narrows nothing; to narrow to no refs at all, pass a map holding the key `includeNoRefsKey`
(`contracts/state.js`), whose value is ignored. `excludeRefs` hides refs by id, and an entry with `type: 'remote'`,
`name: '*'` and an `owner` hides that whole remote except the ref ids in its `except`.
`getExcludedRemotes(excludeRefs)` (`contracts/state.js`) reads those wildcard entries the way the graph does, for a
host that lists refs (a ref finder, say) and must hide the same ones.

A commit row shows its message's summary and then its body. `config.showCommitMessageBody: false` shows the
summary alone. It changes only what's drawn: the row's accessible name, which reads the summary, stays the same.

`config.wipRowTitle` sets what a working-changes row shows as its title. `'label'` (the default) shows "Working
Changes", or "WIP" when narrow, followed by the worktree's branch pill. `'branch'` shows the worktree's identity as
the title instead: the branch name, or for a detached worktree its folder and short tip sha. It also removes the
row's own branch pill, and with it the pill's jump buttons for HEAD, upstream and merge target. A long title is cut
with an ellipsis and its full text is the tooltip. It changes only what's drawn: the row's accessible name stays the
same. A row with no identity keeps the label.

### Styling rows

The rows are light DOM, so a host can style them from its own CSS. Only these hooks are stable; every other class
name and attribute on a row is internal and may change.

- `.gl-graph__row.is-workdir` marks the working-changes row.
- `.gl-graph__row.is-selected` marks a selected row.
- `data-wip-state` is only ever on a working-changes row. It is `clean` when there is nothing to commit (the state
  that draws the stats pill's check) and `dirty` otherwise; a paused operation or conflicts count as `dirty`. It is
  absent until the row's state is known: its counts (`workDirStats` in `wipStateById`, read through the profile's
  `wipStats` extension) or a paused operation or conflicts. A style keyed on either value therefore never shows on
  an unmeasured row. The package draws nothing from it.
- `--gl-graph-persistent-action-width`, set on `gl-commit-graph`, is the room a row's last visible column leaves at
  its end for each button its action strip shows at rest (an unpulled commit, an unpushed one when the host serves
  push-to-commit, or a working-changes action marked `persistent`), plus a fixed `0.8rem`. Set it when the default,
  `2rem`, doesn't fit a host's button sizing.

### Host row adornments

Product-owned row content (badges, chips, warnings) goes in the profile's `rowAdornments` slot: a list of the
engine's `RowAdornmentProvider<TemplateResult>`, built once with the profile. Each provider's `zone` places its
content (`message`, the default, inline before the commit message; or `ref`, after the row's ref pills), its
`describeForA11y` fragment joins the row's accessible label, and dispatching a `RowAdornmentInvalidateEvent` on
its `invalidate` target redraws the rows it names (all rows when it names none). Content resolves only for rows
that render and is cached per sha until invalidated.

An interactive element in that content carries `data-row-control` and is a `<button>`, or has `tabindex="-1"` and
a `role`, with its own accessible name; it must not sit inside an `aria-hidden` subtree. It then behaves like the
graph's own row controls: Tab from a focused row reaches it (after the ref pills, before the action strip),
arrows move between it and its neighbours, Enter or Space activates it, and Escape returns to the row. Clicking
or double-clicking it doesn't select or open its row, so its own click handler needs no `stopPropagation`. A
`data-tooltip` on it, or on any element in the content, shows the graph's tooltip on hover and, for a
`data-row-control`, on keyboard focus.

## Events

The surface reports user intent and data requests as `CustomEvent`s dispatched on the `gl-commit-graph`
element. Every name is `gl-graph-` followed by one run-together lowercase word, like the DOM's own (`dblclick`,
`contextmenu`). Every event bubbles and is composed, so a host can listen on any ancestor; a listener on the element itself
stays scoped to that graph even with several on a page. An event without a detail carries `null`.

`CommitGraphEventMap` (`contracts/events.js`) maps each name to its `CustomEvent` type. `graph.js`'s types add it to
the global `GlobalEventHandlersEventMap`, so once a host imports from `graph.js`, `addEventListener` on any
element types `event.detail`:

```ts
import type { GraphChangeSelectionDetail } from '@gitkraken/commit-graph-ui/contracts/events.js';
import type { GlCommitGraph } from '@gitkraken/commit-graph-ui/graph.js';

declare const graph: GlCommitGraph;
declare function select(detail: GraphChangeSelectionDetail): void;
graph.addEventListener('gl-graph-changeselection', e => select(e.detail));
```

The detail types live in `contracts/events.js`, except `GraphContextMenuDetail`, `GraphCopyRequestDetail` and
`GraphHeaderMenuDetail` (`contracts/contributions.js`) and `GraphMissingRefsMetadata` (`contracts/state.js`).
Four events are cancelable; the table says what cancelling one stops the surface from doing.

| Event                              | Fires when                                                                                                                                                                                                                                                                                                                                                                    | Detail                               | Cancelling it                                                                                                                                                                                                                                                                                                    |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gl-graph-avatarloaderror`         | Avatar images failed to load, batched over ~150ms.                                                                                                                                                                                                                                                                                                                            | `GraphAvatarLoadErrorDetail`         | Not cancelable                                                                                                                                                                                                                                                                                                   |
| `gl-graph-changecolumnmode`        | A mode is picked in the Changes column's mode menu. The surface shows it at once; the host persists it.                                                                                                                                                                                                                                                                       | `GraphChangeColumnModeDetail`        | Not cancelable                                                                                                                                                                                                                                                                                                   |
| `gl-graph-changeselection`         | The selection changes from a click, keyboard navigation, or Escape (`sha: null`).                                                                                                                                                                                                                                                                                             | `GraphChangeSelectionDetail`         | Not cancelable                                                                                                                                                                                                                                                                                                   |
| `gl-graph-changevisibledays`       | The date span of the rows in view changes.                                                                                                                                                                                                                                                                                                                                    | `GraphVisibleDaysDetail`             | Not cancelable                                                                                                                                                                                                                                                                                                   |
| `gl-graph-contextmenu`             | A row or ref pill is right-clicked. For a pill, `ref` carries its `GraphContextMenuRef` (`refPillKey` from `extensions/refs.js` builds the same `key` from a host's ref).                                                                                                                                                                                                     | `GraphContextMenuDetail`             | Suppresses the native context menu, so the host opens its own at `clientX`/`clientY`.                                                                                                                                                                                                                            |
| `gl-graph-copyrequest`             | Ctrl/Cmd+C on a row with no text selected, with the focused sha and, for a multi-selection, every selected sha in display order.                                                                                                                                                                                                                                              | `GraphCopyRequestDetail`             | The surface doesn't announce the copy, so the host writes the clipboard and gives its own feedback. Left alone, the surface announces it only for rows that carry `contextData` and otherwise leaves the key to the browser.                                                                                     |
| `gl-graph-edgesearch`              | A fork-point or ref-row search (Alt+Up/Down, `[`/`]`) pages past the loaded rows: `started`, then one of `found`, `exhausted` or `cancelled`.                                                                                                                                                                                                                                 | `GraphEdgeSearchDetail`              | Not cancelable                                                                                                                                                                                                                                                                                                   |
| `gl-graph-enablechangescolumn`     | The dormant Changes column's opt-in is clicked.                                                                                                                                                                                                                                                                                                                               | None                                 | Not cancelable                                                                                                                                                                                                                                                                                                   |
| `gl-graph-filtercolumn`            | A column header's filter button is activated.                                                                                                                                                                                                                                                                                                                                 | `GraphFilterColumnDetail`            | Not cancelable                                                                                                                                                                                                                                                                                                   |
| `gl-graph-headermenu`              | The header settings button is activated, with its viewport rect as `anchor`, or the header is right-clicked, with `anchor` a zero-size rect at the pointer.                                                                                                                                                                                                                   | `GraphHeaderMenuDetail`              | Stops the `contextmenu` that follows, which opens VS Code's menu from `vscode.settingsContext` or `vscode.columnsContext` (GitLens) and nothing in a browser. A host that sets `headerMenu` cancels it and opens its menu at `anchor`.                                                                           |
| `gl-graph-jumptocommit`            | A ref pill, scroll marker, ref finder or keyboard jump asks to land a row.                                                                                                                                                                                                                                                                                                    | `GraphJumpToCommitDetail`            | The surface doesn't land the row itself, so a host that owns loading and navigation claims it. Unclaimed, the surface selects the row, scrolls it into view, flashes it and focuses it when `focus` is set. A row that isn't loaded yet lands when it arrives, unless a click or keyboard selection comes first. |
| `gl-graph-jumptonearestwip`        | The jump-to-working-changes row button, or the `w` (`target: 'primary'`, the host's own working tree) and Shift+W (`target: 'nearest'`, the working tree on `fromSha`'s lane) keys. Only the host knows which working-changes row answers, so the surface never lands it itself. A host that doesn't handle it leaves `jump-to-working-changes` out of `supportedRowActions`. | `GraphJumpToNearestWipDetail`        | Not cancelable                                                                                                                                                                                                                                                                                                   |
| `gl-graph-lanetoggle`              | A lane segment collapses or expands.                                                                                                                                                                                                                                                                                                                                          | `GraphLaneToggleDetail`              | Not cancelable                                                                                                                                                                                                                                                                                                   |
| `gl-graph-lanetoggleall`           | Every lane collapses or expands at once.                                                                                                                                                                                                                                                                                                                                      | `GraphLaneToggleAllDetail`           | Not cancelable                                                                                                                                                                                                                                                                                                   |
| `gl-graph-missingavatars`          | Rows in view show emails that `avatars` has no image for.                                                                                                                                                                                                                                                                                                                     | `GraphMissingAvatarsDetail`          | Not cancelable                                                                                                                                                                                                                                                                                                   |
| `gl-graph-missingrefsmetadata`     | Refs in view lack metadata of an enabled type (see "Supplying data").                                                                                                                                                                                                                                                                                                         | `GraphMissingRefsMetadata`           | Not cancelable                                                                                                                                                                                                                                                                                                   |
| `gl-graph-morerows`                | The surface wants the next page: scrolling near the end, a navigation past the loaded rows, or the results bar. Only an explicit ask carries a detail. After a page appends rows the graph asks again while still near the end, so a host that refuses an ask during a blocking load must replay it if that load ends without appending.                                      | `GraphMoreRowsDetail` or `null`      | Not cancelable                                                                                                                                                                                                                                                                                                   |
| `gl-graph-mouseleave`              | The pointer leaves the graph's viewport.                                                                                                                                                                                                                                                                                                                                      | None                                 | Not cancelable                                                                                                                                                                                                                                                                                                   |
| `gl-graph-openbranch`              | A ref-pill click pins or unpins its ref (`open` says which), or a click elsewhere drops the pin (`{ open: false }`).                                                                                                                                                                                                                                                          | `GraphOpenBranchDetail`              | Not cancelable                                                                                                                                                                                                                                                                                                   |
| `gl-graph-refdoubleclick`          | A ref pill is double-clicked, or one of its PR/issue chips is clicked once (`metadata` names the chip).                                                                                                                                                                                                                                                                       | `GraphRefDoubleClickDetail`          | Not cancelable                                                                                                                                                                                                                                                                                                   |
| `gl-graph-retryload`               | The retry button on the load-error state is clicked.                                                                                                                                                                                                                                                                                                                          | None                                 | Not cancelable                                                                                                                                                                                                                                                                                                   |
| `gl-graph-rowaction`               | One of the built-in row buttons is clicked (see "Supplying data").                                                                                                                                                                                                                                                                                                            | `GraphRowActionDetail`               | Not cancelable                                                                                                                                                                                                                                                                                                   |
| `gl-graph-rowdoubleclick`          | A row is double-clicked, or opened with Enter.                                                                                                                                                                                                                                                                                                                                | `GraphRowDoubleClickDetail`          | Not cancelable                                                                                                                                                                                                                                                                                                   |
| `gl-graph-rowhover`                | The pointer settles on a row's content cells (250ms).                                                                                                                                                                                                                                                                                                                         | `GraphRowHoverDetail`                | Not cancelable                                                                                                                                                                                                                                                                                                   |
| `gl-graph-rowhoverstart`           | The pointer enters a new row, or moves into a row's content cells.                                                                                                                                                                                                                                                                                                            | None                                 | Not cancelable                                                                                                                                                                                                                                                                                                   |
| `gl-graph-rowhovertrack`           | The pointer enters a row or moves between its zones, without delay.                                                                                                                                                                                                                                                                                                           | `GraphRowHoverTrackDetail`           | Not cancelable                                                                                                                                                                                                                                                                                                   |
| `gl-graph-rowpeek`                 | `i` (or Mod+I) toggles the hover card on the focused row, navigation moves an open card, or it closes. The host writes `open` back during dispatch.                                                                                                                                                                                                                           | `GraphRowPeekRequest`                | Not cancelable                                                                                                                                                                                                                                                                                                   |
| `gl-graph-rowunhover`              | The pointer leaves the hovered row.                                                                                                                                                                                                                                                                                                                                           | `GraphRowUnhoverDetail`              | Not cancelable                                                                                                                                                                                                                                                                                                   |
| `gl-graph-scopeanchorsunreachable` | The loaded rows don't reach some of the scope's anchors. `pickScopePageTarget(detail.shas, loadedShas, ineligible, mergeBaseSha)` (`contracts/events.js`) picks the sha to page toward, or `undefined` to stop.                                                                                                                                                               | `GraphScopeAnchorsUnreachableDetail` | Not cancelable                                                                                                                                                                                                                                                                                                   |
| `gl-graph-unpinref`                | The pinned ref's unpin control is clicked.                                                                                                                                                                                                                                                                                                                                    | None                                 | Not cancelable                                                                                                                                                                                                                                                                                                   |
| `gl-graph-visiblewipshaschanged`   | The working-changes rows in view change.                                                                                                                                                                                                                                                                                                                                      | `GraphWipShasDetail`                 | Not cancelable                                                                                                                                                                                                                                                                                                   |
| `gl-graph-wipshasmissingstats`     | Working-changes rows in view have no stats.                                                                                                                                                                                                                                                                                                                                   | `GraphWipShasDetail`                 | Not cancelable                                                                                                                                                                                                                                                                                                   |
| `gl-graph-wiprowopen`              | A host-supplied working-changes row button is clicked; `target` is its `GraphRowAction`'s `action`.                                                                                                                                                                                                                                                                           | `GraphWipRowOpenDetail`              | Not cancelable                                                                                                                                                                                                                                                                                                   |

A right-clicked ref pill stays expanded while its menu is open. A host that cancels `gl-graph-contextmenu` and draws
its own menu calls `graph.endContextMenu()` when that menu closes (Escape, an outside click or a choice) to collapse
the pill; it does nothing when no pill is pinned.

`applyGraphSelectionChange(selectedRows, detail)` (`contracts/state.js`) returns the `selectedRows` a
`gl-graph-changeselection` detail leads to, the way GitLens builds it, for a host that keeps the selection itself.

`graph.scrollToSha(sha, options)` scrolls a row into view, waiting for it if it isn't loaded yet. Its
`GraphRevealOptions` (`contracts/state.js`) take a `mode` (`'if-changed'` skips the row revealed last), `flash`, and
`select` and `focus`, which make the row the only selection and move keyboard focus to it when it lands, opening a
collapsed lane that hides it. A click, a keyboard selection or `graph.cancelPendingReveal()` drops a reveal still
waiting, along with its selection and focus.

`graph.getScrollState()` returns the row at the top of the view and how far into it the view is scrolled, without
reading layout, so a host can call it while unmounting. `graph.restoreScrollState(state)` puts that row back at the
same offset once rows and a size are in, or uses the saved `scrollTop` when the row isn't there. A reveal waiting at
that point wins, and the restore is dropped rather than applied later.

## Header

The header's settings button appears when the host supplies a VS Code `vscode.settingsContext` (GitLens) or sets
`headerMenu: { label?, open? }`. `label` names the button, for both its accessible name and its tooltip, so it can
say what the host's menu does; `open` reports whether that menu is open (`aria-expanded`), and the button always
declares a menu popup. Set `headerMenu` to `{}` for the button with its default name; leave it unset for none. The group/ungroup toggles for the graph and Branches / Tags columns can be turned off with
`config.placementControls: false` for a host that places columns itself.

A right-click in the header raises the same `gl-graph-headermenu`, with `anchor` a zero-size rect at the pointer.
Cancel it to open the host's own menu there. Left alone, the native `contextmenu` goes ahead.

The header's rendered height is published on the element as `--gl-graph-header-height` (25px at a 10px rem: 24px
plus its 1px bottom border), and the column resize lines and the scroll-marker rail hang from it.

## Overview bar

`gl-graph-overview-bar` is an optional strip of worktree pills that a host places above the graph, as a sibling of
`gl-commit-graph`. It has its own explicit, idempotent registration; `registerCommitGraphElements` doesn't register
it, so a host that doesn't show one doesn't bundle it.

```ts
import type { GlGraphOverviewBar } from '@gitkraken/commit-graph-ui/overviewBar.js';
import { registerOverviewBarElement } from '@gitkraken/commit-graph-ui/overviewBar.js';

registerOverviewBarElement();
const bar = document.createElement('gl-graph-overview-bar') as GlGraphOverviewBar;
bar.items = [{ id: 'main', branchName: 'main', repoPath: '/repo', isPrimary: true, tipSha: tipSha }];
```

- `items` (`OverviewBarItem[]`), one pill each, in order. `id` and `branchName` are required; `repoPath` is optional and only passed back in event details.
  `label` is optional text shown on the pill in place of `branchName`, for a host that shortens long names. The pill's
  accessible name and every event still carry `branchName`. When `label` differs from `branchName` and the host sets no
  `renderHover`, hovering or focusing the pill shows the full `branchName` as a tooltip. With a `renderHover`, the host's
  hover is the only popup.
  `hasWorkingChanges` shows a dot and `hasUnpushed` an arrow. `agent` (`idle`, `working`, `needs-input` or `ended`)
  shows a robot coloured by state, with `agentCount` beside it when it's more than one. Screen readers hear these
  states in words, as the pill's description. `branchId` turns on double-click focus.
  `statsLoaded` says the host already holds the working-changes breakdown. `vscodeContext` is a VS Code
  `data-vscode-context` value for the pill's native right-click menu. `isPrimary` styles the pill as the worktree
  the graph shows.
- Leg data draws the jump legs on any pill that supplies it, so supply it only for the pills that should have legs:
  `tipSha` for HEAD, `upstreamSha`/`upstreamName`/`upstreamIcon` (a `code-icon` name, `cloud` by default) for the
  upstream, and `target: { sha, name }` for the merge target. `branchName`, `upstreamName` and `tipSha` mean the same on a
  working-changes row (`WipRowInfo`); the shared `WorktreeRefs` type holds them. A leg with a sha is a jump button. A leg with only a
  name is a static indicator, so leave `upstreamName` unset for an upstream that no longer exists.
- `selectedId` outlines the selected pill and puts the tab stop on it, unless focus is in the bar, where the tab
  stop stays on the last focused pill. Selection belongs to the host: clicking a pill only fires
  `gl-graph-overviewselect`, and the outline moves when the host passes the new `selectedId` back.
- `statsOnHover` (default `true`): when `false`, hovering a pill never asks for its stats.
- `renderHover(item, open)` returns a pill's rich hover (`OverviewBarHoverContent`: a Lit template, a `Node`, a
  string, `nothing` or `undefined`). It's called only for pills whose hover has opened at least once, with `open`
  true while it shows. Unset, pills have no hover and hovering never asks for stats. Keep the function reference
  stable (in React, wrap it in `useCallback`): a new function re-renders every pill. The content renders inside the
  bar's shadow root, where page CSS doesn't reach, so use a shadow-DOM component or a `Node` that carries its own
  styles.
- `renderAgentStatus(item)` draws a pill's agent indicator in place of the robot and its count, for a host whose
  agent states have their own look. It's called only for items with an `agent`, returns the same content types as
  `renderHover`, and has the same stable-reference and shadow-root rules. Its content is hidden from screen
  readers, which hear the pill's description instead.
- The `start` slot sits before the scrolling strip, for host content such as an onboarding coach mark.
  `pillsElement` is the strip itself, for geometry and anchoring overlays only: its contents belong to the bar and
  may change.

Every event is named like the graph's (`gl-graph-` and one lowercase word, see "Events"), bubbles, crosses shadow
boundaries, and has a named detail type exported from `overviewBar.js`.
`OverviewBarEventMap` maps each event name to its `CustomEvent`, and augments `GlobalEventHandlersEventMap` so
`addEventListener` is typed. One event is cancelable.

| Event                          | Fires when                                                                                                                                                                                                                          | Detail                         | Cancelling it                                                                                              |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `gl-graph-overviewcontextmenu` | A pill is right-clicked. Left alone, the pill's `vscodeContext` opens VS Code's native menu.                                                                                                                                        | `OverviewBarContextMenuDetail` | Suppresses the native menu and the `vscodeContext` copy, so the host opens its own at `clientX`/`clientY`. |
| `gl-graph-overviewfocus`       | A pill with a `branchId` is double-clicked. Two `gl-graph-overviewselect` events fire first, so a host that gives the two gestures different effects holds the select briefly and drops it when the focus arrives.                  | `OverviewBarFocusDetail`       | Not cancelable                                                                                             |
| `gl-graph-overviewjump`        | A jump leg is activated. The detail has the same shape as `gl-graph-jumptocommit`, with `focus` and `flash` both `true`. The bar does nothing more with it, so the host handles it to land the row. It doesn't change `selectedId`. | `OverviewBarJumpDetail`        | Not cancelable                                                                                             |
| `gl-graph-overviewselect`      | A pill is clicked, or activated from the keyboard. The bar doesn't change `selectedId` itself.                                                                                                                                      | `OverviewBarSelectDetail`      | Not cancelable                                                                                             |
| `gl-graph-overviewstatsneeded` | A pill with working changes and no `statsLoaded` is hovered or focused, `statsOnHover` is on, and `renderHover` is set. It fires before the hover opens, so the breakdown can be ready when it shows.                               | `OverviewBarStatsNeededDetail` | Not cancelable                                                                                             |

The strip is a toolbar with one tab stop. Left/Right and Home/End move between pills, and Enter or Space selects.
The menu key or Shift+F10 opens the pill's context menu (`gl-graph-overviewcontextmenu`).
Tab from a pill enters its jump legs, where Left/Right and Home/End move between them. Shift+Tab or Escape returns
to the pill. A vertical wheel pans the strip sideways.

The bar reads these properties:

- Font: `--gl-graph-overview-bar-font-family`, falling back to `--gl-graph-font-family`.
- Surface: `--gl-graph-overview-bar-background` and `--gl-graph-overview-bar-border`, falling back to
  `--gl-graph-background` and `--gl-graph-border`.
- Pills: `--gl-graph-foreground` and `--gl-graph-focus` (which also colours the keyboard focus ring).
- Indicators: `--gl-graph-overview-bar-wip` for the working-changes dot (falling back to
  `--color-graph-scroll-marker-wip`), `--gl-tracking-ahead` for the unpushed arrow, and `--gl-agent-idle-color`,
  `--gl-agent-working-color`, `--gl-agent-waiting-color` and `--gl-agent-ended-color` for the robot.
- Legs: `--gl-row-marker-head`, `--gl-row-marker-upstream` and `--gl-row-marker-target`.
- Layout: `--gl-space-4`, `--gl-space-6`, `--gl-space-8`, `--gl-radius-xs`, `--gl-radius-sm` and `--gl-border-width`.
- Sizing: `--gl-graph-rem` (see "Sizing").

`graph.css` declares defaults on the element for all but the `--gl-graph-overview-bar-*` ones and `--gl-graph-rem`,
which are unset and fall back as listed. The foreground, focus, background and border defaults are the same
light/dark pairs the graph uses and follow `color-scheme` (see "Colours"). The indicator and leg colours are single
values tuned for dark themes, so a host with a light theme overrides those. As with `gl-commit-graph`, set them on
`gl-graph-overview-bar` itself: values set on the graph don't reach its sibling. `themes/vscode.css` maps the bar's
font (to VS Code's UI font rather than the editor font the graph uses), foreground, focus, border and
working-changes dot for VS Code hosts. It leaves the background to the host, since VS Code's depends on where the
view is docked: set `--gl-graph-overview-bar-background` to it.

## Keyboard

The graph's row keys (arrows, `j`/`k`, Page Up/Down, Home/End, Ctrl/Cmd+arrows, `[`/`]`, `h`/`u`/`t`/`w`,
Enter/Space, Escape, Tab into a row's controls, `i` peek, Ctrl/Cmd+C) work with no setup. A host normally sets nothing:
the element carries its own key handling, attached while it is connected, and answers only keydowns from inside
itself, Escape included. Several graphs on one page each handle their own keys and don't drive each other.
Graph-wide shortcuts (search, the ref finder's `/`, the shortcut sheet) belong to the host and aren't part of that
default.

Escape on the rows clears the selection. With nothing selected it does nothing and is left alone, so it reaches the
host's own Escape handling (a dialog, a page-level close). While the private default is in use, Escape also cancels a
column drag and closes the Changes column's mode menu when keyboard focus is outside the graph; a listener for that
exists only while one of them is open.

A host that already has a page-wide key dispatcher can pass it through the element's `keymap` property, so the graph's
keys and its transient surfaces share one document listener and one Escape order with the rest of the host. Any object
satisfying `GraphKeymap` works, and one object can serve every graph on the page:

```ts
import type { GraphKeymap } from '@gitkraken/commit-graph-ui/contracts/keyboard.js';

declare const pageKeymap: GraphKeymap; // your dispatcher, adapted to this shape
graph.keymap = pageKeymap;
```

`GraphKeymap` has one method, `attach(root)`, which the graph calls with itself when it connects and when `keymap`
changes. It returns a `GraphKeymapRegistrar` that belongs to that graph alone: scope names registered on it never
replace another graph's, and its bindings resolve only against its own scopes. The registrar has four methods.
`registerScope(id, { selector }, guards)` declares where one of the graph's scopes (`rows`, `rowControl`, `pillMenu`)
is live: when the selector matches an element on the keydown's composed path and every guard passes.
`registerBindings(descriptors)` registers the graph's key bindings under those scopes. `pushOverlay(entry)` puts an
open surface (the ref finder, the Changes column's mode menu, a column drag) on the Escape stack, which the host
consults ahead of any binding. Each returns something with `dispose()`. `dispose()` on the registrar removes everything
registered through it; the graph calls it when it disconnects or the `keymap` changes, and on the next registrar it
pushes an overlay again for every surface still open. The graph also disposes its bindings and registers them again
when the localizer changes (see "Localization"), so their sheet labels follow the new language. Setting `keymap` after
the first update moves the graph onto it and drops the private default.

Rebinding individual keys is not supported yet: the bindings are fixed, and a host can't change or disable one.

## Localization

Every message the graph shows goes through one lookup, which by default is `@vscode/l10n`'s `t` (GitLens configures
that with its own bundle). Any other host installs a translator once, before or after mounting:

```ts
import { setGraphLocalizer } from '@gitkraken/commit-graph-ui/localization.js';

setGraphLocalizer(message => translations[message.key] ?? message.message, {
	locale: 'fr',
});
```

- The localizer receives one `GraphMessage` per message key: the English `message`, the translator `comment` when
  there is one, and the bundle `key` (`message`, or `message/comment`). It returns the translated template with its
  placeholders (`{0}`, `{name}`) intact. The graph asks once per key until the localizer changes and substitutes
  each call's arguments itself, so `args` is always empty. The answer for a key is kept, so a host whose catalog
  arrives later calls `setGraphLocalizer` again once it has. `formatGraphMessage` substitutes arguments the way
  `@vscode/l10n` does, for a host that formats graph messages itself.
- Plural messages arrive as ICU templates (`{0, plural, one{…} other{…}}`) with empty `args`. Return the
  translated template, blocks intact; the graph picks the branch with the locale's plural rules.
- `locale` sets the language for dates (relative and absolute), numbers, plural rules and the lists the
  working-changes summary joins with `Intl.ListFormat`. Unset, dates and numbers follow the browser, and plurals
  and lists the document's `lang`.
- `setGraphLocalizer(undefined)` restores the defaults. Every graph and overview bar on the page redraws with the change, so a host
  calls nothing else after switching.
- `@gitkraken/commit-graph/l10n.js` is the engine's internal message shim: its `setMessageLocalizer` swaps the
  translator alone, leaving plurals, dates and lists in the old locale. Hosts use `setGraphLocalizer`.
- `l10n/messages.json` lists every message the packages can show, keyed and shaped like an `@vscode/l10n` bundle
  (`key: message` or `key: { message, comment }`). A host's tests can check its translations cover every key.

## Sizing

GitLens authors these styles at `1rem = 10px`, while the engine's row geometry is fixed in pixels (24px rows, a
24px header). The published stylesheets and the bundled Lit component styles therefore measure every `rem` length
against `--gl-graph-rem` instead of the document root: `1.2rem` ships as `calc(1.2*var(--gl-graph-rem,10px))`. The
graph renders identically at any root font size, and setting the property never changes the host page's own rem.

A host whose root is not 10px but which wants the graph's text to follow the user's text-size setting maps the
property to its own rem, for example on a 16px root:

```css
gl-commit-graph,
gl-graph-overview-bar {
	--gl-graph-rem: 0.625rem;
}
```

The overview bar is the graph's sibling, so it needs the property set on itself too.

Row heights stay fixed in pixels, so scaling text much past 10px crowds it within its rows.

## Styling and fonts

`graph.css` contains the base renderer rules and the default token values. Those defaults are declared on
`gl-commit-graph`, never on `:root`. Because a value declared on the element outranks one it inherits, set any token
on `gl-commit-graph` itself (or a more specific selector for it), not on an ancestor. External profiles selecting
sticky timeline or scroll markers must also import the matching extension stylesheet; profiles that omit an extension
carry neither its controller/rendering module nor its styles. VS Code hosts can additionally import
`@gitkraken/commit-graph-ui/themes/vscode.css`; other hosts never load or need to emulate VS Code variables.

### Colours

Every colour input is a full CSS colour on a `--gl-graph-*` property. Any colour syntax works, and alpha is welcome:
the graph derives its tints and hover/selection washes from these with `color-mix()`, so nothing has to be passed
as channel numbers. A simple host sets only the base tokens; every other colour token derives from them:

| Token                            | Role                                                                                    |
| -------------------------------- | --------------------------------------------------------------------------------------- |
| `--gl-graph-foreground`          | Text and icons                                                                          |
| `--gl-graph-background`          | The graph surface, and the carve that separates nodes from lanes                        |
| `--gl-graph-muted-foreground`    | Secondary text: author, date, SHA, header labels                                        |
| `--gl-graph-border`              | Dividers and chip borders                                                               |
| `--gl-graph-elevated-background` | Popovers, menus, and code spans                                                         |
| `--gl-graph-focus`               | Focus outlines                                                                          |
| `--gl-graph-accent`              | Selection tint, the HEAD chip, links, and other accents; defaults to `--gl-graph-focus` |

```css
gl-commit-graph {
	color-scheme: dark;
	--gl-graph-foreground: #e6e6e6;
	--gl-graph-background: #18181b;
	--gl-graph-muted-foreground: rgb(230 230 230 / 65%);
	--gl-graph-accent: oklch(0.65 0.15 250);
}
```

The defaults of the base tokens are light/dark pairs chosen by the element's `color-scheme`, which it inherits from
the host, so a host on a dark theme sets `color-scheme: dark` on the page or an ancestor (or on `gl-commit-graph`).
With no `color-scheme` set the graph uses the light values. The package never sets `color-scheme` itself. Set any
other documented `--gl-graph-*` token to override a derived value.

Text drawn in a lane's colour (a ref pill's name, a row marker's label) is capped in lightness so a light lane stays
readable on a light background. Set `--gl-graph-on-background-max-lightness` to the highest OKLab lightness that text
may have; GitLens uses `0.47` on light themes and `0.43` on high contrast light. Unset, it is `1`, which leaves the
text at the lane's own colour, so a host with a light theme should set it.

Lane colours aren't tokens: the graph derives each lane's tints and on-lane text colour in script, and the engine
holds one palette for the whole page. Set it with `setGraphLanePalette(colors)` from `localization.js`, one colour per
lane in order (repeating past the last). Each entry is any CSS colour (`#336699`, `rgb(51 102 153)`, `rebeccapurple`,
`oklch(...)`), resolved once to opaque sRGB; its alpha is dropped. If any entry isn't a colour, the call changes
nothing and logs a console warning. `undefined` or an empty list restores the built-in palette. Every graph on the
page redraws with the change, like `setGraphLocalizer`.

```ts
import { setGraphLanePalette } from '@gitkraken/commit-graph-ui/localization.js';

setGraphLanePalette(['#336699', 'rgb(204 102 0)', 'seagreen']);
```

The renderer's `code-icon` elements expect `codicon` and `glicons` font faces to be supplied by the product shell.
They are deliberately not embedded in this package because the host owns asset URLs and CSP policy.

## Host obligations

The graph decides what to recompute by comparing each property with its previous value by identity (`===`), so
what a host keeps referentially stable between its own renders is what keeps the graph fast. Any changed property
redraws the rows in view; the table says what else it costs.

| A new value for                                                                                                                | Costs                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `profile`                                                                                                                      | Disposes and rebuilds every extension controller and adornment provider and drops every cached row adornment. Build it once, before mount, and never replace it.                           |
| `rows`, `scope`, `excludeRefs`, `excludeTypes`, `includeOnlyRefs`, `downstreams`, `pinnedRef`, `hasRemotes`, `config.idLength` | Re-runs the engine over the rows: layout, edges, lanes and the scroll markers. A new `rows` array whose rows only changed payload (same commits and parents) skips the lane re-derivation. |
| `wipStateById`, `currentUpstream`, `rowMarkerMergeTarget`, `currentBranch`                                                     | Drops every cached row adornment, so each visible row re-resolves its pills and host content. `wipStateById` also rebuilds the WIP stats.                                                  |
| `refsMetadata`                                                                                                                 | Re-resolves only the rows whose refs' entries changed, compared entry by entry. To or from `null`, drops every cached row adornment and recomputes the scroll markers.                     |
| `searchResults`, `selectedRows`, `columns`, `config`                                                                           | Rebuilds that input's own derived state (matched set, selection set, columns, date formatters). Fields of `config` are compared one by one where they drive anything heavier.              |
| `avatars`, `rowsStats`, `rowActionsByRowSha`, `supportedRowActions`, `wipRowInfoByRowSha`, `keymap`, the callbacks             | Only the redraw (and, for `keymap`, moving its bindings; for `wipRowInfoByRowSha`, the scroll markers).                                                                                    |

So a host passes the same object or array again when nothing in it changed, and builds a new one only when it did.
Copying a store into fresh objects on every host render (`rows={[...rows]}`, `excludeRefs={{ ...filters }}`)
re-runs the engine each time. `vscode` and `headerMenu` are the exception: they are compared field by field, so an
inline object literal is fine. Mutating an array or object in place is never seen.

Host content in `rowAdornments` (and in `rowActionsByRowSha` statuses) is drawn on rows that slide under a resting
pointer while the list scrolls. The graph turns transitions off on its own row parts while scrolling, so they don't
flash as rows pass the cursor; host content gets the same treatment by putting `data-gl-graph-no-scroll-transition`
on each element that declares a `transition`. It applies to that element only, not its descendants or shadow
content, so mark every element that transitions.

The profile's hooks run on the row paths, so they must be cheap and synchronous, with no layout reads. A
`rowAdornments` provider's `provideRowAdornment` runs for every visible row on every redraw, scrolling included;
its `resolveAdornment` and `describeForA11y` run as a row comes into view and are then cached per sha until
invalidated, except for an adornment marked `dynamic`, which resolves on every redraw. `rowAdapter` runs inside
each engine run, and `resolveWipRowContext` on each keyboard-invoked row command. A host that needs anything slow
computes it ahead and has the hook look it up.

The graph dims the selection while the window is unfocused. It follows the page's `focus` and `blur` events unless
the host sets `windowFocused`, whose `true` or `false` then wins. A host whose window focus differs from the
page's, such as a webview in an iframe, sets it.

## Performance contract

- Feed rows over the product's existing transport; the package introduces no RPC layer.
- Row adapters run only during engine reconciliation.
- Opted-out hot features create no controllers, adornment providers, or per-visible-row provider calls.
- Non-dynamic adornments retain per-SHA result caching; dynamic adornments intentionally bypass it.
- Engine CPU/allocation (`benchmark:graph:engine:compare`) and bundle-byte budgets
  (`benchmark:graph:bundle:check`) gate boundary changes. The browser frame/heap summary
  (`benchmark:graph:browser`) is a tracked, comparison-ready CI artifact — its five-run open-to-visible
  measurement is too noisy for a defensible automated gate, so compare candidate and baseline runs from
  the same controlled runner by hand (see `docs/testing.md`).

`debug.js` exposes `getGraphDebugDiagnostics()` and `createGraphDebugSnapshot()`. The graph records into it only
in a build whose bundler defines a global `DEBUG` as `true` (it checks `typeof DEBUG !== 'undefined' && DEBUG`),
and then publishes `window.__gitkrakenCommitGraphDebug` with `records()`, `snapshot()` and `clear()`.

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

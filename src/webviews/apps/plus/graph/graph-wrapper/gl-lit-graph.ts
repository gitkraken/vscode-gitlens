import type { RowAdornment, RowAdornmentProvider } from '@gitkraken/commit-graph/engine/adornments.js';
import { AdornmentRegistry, RowAdornmentInvalidateEvent } from '@gitkraken/commit-graph/engine/adornments.js';
import { classifyRowsDelta } from '@gitkraken/commit-graph/engine/delta.js';
import { collectReachable, identifyFirstParentChain } from '@gitkraken/commit-graph/engine/layout.js';
import type { GraphProcessResume } from '@gitkraken/commit-graph/engine/process.js';
import { processCommitsAndSegments } from '@gitkraken/commit-graph/engine/process.js';
import type { ReconciledSuffix } from '@gitkraken/commit-graph/engine/reconcile.js';
import type { LaneSegment, ProcessedGraphRow, Sha } from '@gitkraken/commit-graph/engine/types.js';
import type { LaneSweep, LaneWindow } from '@gitkraken/commit-graph/laneClamp.js';
import { computeLaneWindow, laneWindowCovers, resolveGroupedLaneCap } from '@gitkraken/commit-graph/laneClamp.js';
import { computePrefetchDistance } from '@gitkraken/commit-graph/paging.js';
import type {
	GraphPlacement,
	GraphStyle,
	RefsPlacement,
	ResolvedGraphStyle,
	ZoneId,
	ZoneSpec,
} from '@gitkraken/commit-graph/view.js';
import {
	defaultZones,
	dragResizeZone,
	gutterPadding,
	listAutoBelow,
	mapVisibleIndex,
	mergeZones,
	reorderZones,
	rowHeightList,
	rowHeightTable,
	shortDateWidth,
	solveZoneLayout,
	xForColumn,
} from '@gitkraken/commit-graph/view.js';
import type { PropertyValues, TemplateResult } from 'lit';
import { html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { Ref } from 'lit/directives/ref.js';
import { createRef, ref } from 'lit/directives/ref.js';
import '@lit-labs/virtualizer';
import { repeat } from 'lit/directives/repeat.js';
import type { GitGraphRow } from '@gitlens/git/models/graph.js';
import { formatDate as formatGitLensDate, fromNow as gitlensFromNow } from '@gitlens/utils/date.js';
import { debounce } from '@gitlens/utils/debounce.js';
import { pluralize } from '@gitlens/utils/string.js';
import type {
	DidSearchParams,
	GraphAvatars,
	GraphColumnConfig,
	GraphColumnsConfig,
	GraphColumnsSettings,
	GraphComponentConfig,
	GraphDownstreams,
	GraphExcludeRefs,
	GraphExcludeTypes,
	GraphIncludeOnlyRefs,
	GraphMissingRefsMetadata,
	GraphPinnedRef,
	GraphRefMetadataItem,
	GraphRefMetadataType,
	GraphRefsMetadata,
	GraphRowStats,
	GraphScope,
	GraphScrollMarkerTypes,
	GraphSearchMode,
	GraphSelectedRows,
	GraphWipMetadataBySha,
	GraphWorkingTreeStats,
} from '../../../../plus/graph/protocol.js';
import { isSecondaryWipSha } from '../../../../plus/graph/protocol.js';
import { cspStyleMap } from '../../../shared/components/csp-style-map.directive.js';
import type { GlPopover } from '../../../shared/components/overlays/popover.js';
import type { RunningOperationBucket } from '../components/detailsState.js';
import type { WipRowAgentStatus } from '../components/wipRowAgentStatus.js';
import { createLaneCollapseAdornmentProvider } from './adornments/laneCollapseAdornmentProvider.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/overlays/popover.js';
import type { LaneCollapseChipContext } from './adornments/laneCollapseAdornmentProvider.js';
import type { ParsedRef } from './adornments/refAdornmentProvider.js';
import { createRefAdornmentProvider, refPillKey } from './adornments/refAdornmentProvider.js';
import { createWipStatsAdornmentProvider } from './adornments/wipStatsAdornmentProvider.js';
import type { WipStats } from './adornments/wipStatsAdornmentProvider.js';
import type { GraphCommitView } from './graph-commit.js';
import { columnsToZones, pickGhostRef, toGraphCommit, zonesToColumnsConfig } from './graph-commit.js';
import type { FixedSizeLayoutSpecifier } from './graph-fixed-layout.js';
import { fixedSizeVertical } from './graph-fixed-layout.js';
import { GutterCache, gutterEpochSignature } from './graph-gutter-cache.js';
import { laneSpacing, nodeRadiusFor, renderGutterSvg, renderWavyFilterDefs } from './graph-gutter.js';
import {
	appendDroppedRows,
	applyDroppedRows,
	branchHintFor,
	compactColumns,
	composeEffectiveCollapsed,
	computeDefaultCollapsedSet,
	computeDroppedShas,
	computeSegmentMaps,
	computeTrunkSegmentTip,
	spliceDroppedRows,
} from './graph-lane-collapse.js';
import type { RowRenderContext } from './graph-row.js';
import { renderRow } from './graph-row.js';
import { computeInScopeShas, computeScopeAnchors, computeScopeProjection } from './graph-scope.js';
import type { ScopeAnchors, ScopeProjection } from './graph-scope.js';
import type { RowMarkers, ScrollMarker } from './graph-scroll-markers.js';
import { buildSelectionScrollMarkers, computeScrollMarkers, groupScrollMarkersByRow } from './graph-scroll-markers.js';

type LitVirtualizer = HTMLElement & {
	items: readonly unknown[];
	scrollToIndex: (index: number, position?: 'start' | 'center' | 'end' | 'nearest') => void;
	// From LitElement (ReactiveElement): lets callers await the child virtualizer's own commit.
	isUpdatePending: boolean;
	updateComplete: Promise<boolean>;
};

// Expanded-density column header height in px (matches `.gl-graph__header` height: 2.4rem @ 1rem=10px).
const headerHeightPx = 24;
// How close (px) the cursor must be to a scroll-marker row for it to highlight/tooltip — a "magnet"
// so dense, merged markers are each reachable by sweeping, without false hits over empty rail.
const scrollMarkerMagnetPx = 8;
// Vertical gap (px) left between adjacent rows' block ticks so they don't squish/merge.
const scrollMarkerGapPx = 1;
// Max block-tick height (px) — in a small graph the per-row rail span approaches the full row height,
// and row-sized bricks read as UI chrome instead of position ticks.
const scrollMarkerMaxBlockPx = 12;
// Pointer travel (px) past which a rail press becomes a drag-scrub (vs. a click-to-jump on release).
const scrollMarkerDragThresholdPx = 3;
// Width (px) of the dedicated lane-fold strip prepended to the lanes when folding is enabled — wide
// enough for the chevron toggle, narrow enough to not crowd the lanes.
const foldLaneWidthPx = 14;
// Right gutter (px) reserved for the header's absolutely-positioned settings gear, so the columns
// stop short of it instead of the gear pushing the flex fill (which broke header↔body alignment).
const headerSettingsGutterPx = 24;
// Minimum width (px) of the graph column's horizontal scrollbar thumb, so it stays grabbable even when
// the lane content vastly overflows a narrow viewport.
const graphHScrollMinThumbPx = 24;
// Fallbacks for the GROUPED inline lane cap when the `gitlens.graph.lanes.grouped.*` settings are absent:
// at least `min` lanes always show (when the graph has that many); the cap grows dynamically up to `max`%
// of the row width, so wider views show more lanes before collapsing the rest to the edge.
const defaultGroupedMinLanes = 10;
const defaultGroupedMaxPercent = 40;
// Codicon shown in a column header in place of the text label when the column is too narrow to fit it
// (legacy behavior — see `headerLabelFits`). The graph column uses 'graph-line' (handled inline).
const zoneHeaderIcons: Record<ZoneId, string> = {
	ref: 'git-branch',
	message: 'comment',
	author: 'account',
	datetime: 'calendar',
	sha: 'git-commit',
};
// Whether an uppercased header label fits the given label-area width (px): ≈7px/char + the resize
// handle + padding. Below this the header swaps the text for its icon.
function headerLabelFits(label: string, areaPx: number): boolean {
	return areaPx >= label.length * 7 + 28;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

// WIP (workdir) rows carry a today-ish synthetic date, not a real commit date — reading one straight
// off a visible-range edge would skew the reported day-range (minimap). Walks from `from` toward
// `boundInclusive` for the nearest non-workdir row's date; if every row in between is workdir too,
// there's nothing to normalize against, so it falls back to the edge row's own date (prior behavior).
function nearestNonWorkdirDate(
	rows: readonly ProcessedGraphRow[],
	from: number,
	boundInclusive: number,
): number | undefined {
	const step = boundInclusive >= from ? 1 : -1;
	for (let idx = from; step > 0 ? idx <= boundInclusive : idx >= boundInclusive; idx += step) {
		const row = rows[idx];
		if (row != null && row.kind !== 'workdir') return row.date;
	}
	return rows[from]?.date;
}

/** Per-row adornment content fanned out by zone, plus the joined a11y label fragment. */
type ResolvedAdornments = { fold: TemplateResult[]; ref: TemplateResult[]; message: TemplateResult[]; label: string };

/** A ref pill/popover-row resolved from a click/dblclick event path (see `resolveRef`). */
type ResolvedRefTarget = {
	name: string;
	key: string;
	kind: string;
	remote: string | null;
	context?: string;
	current: boolean;
};

/**
 * Snapshot of the render-derived state the per-row `renderItem` needs. Populated once per
 * `render()` and read (never re-derived) inside the hot per-row loop, so `renderItem` can be a
 * stable function reference — that keeps `<lit-virtualizer>`'s `renderItem` `@property` unchanged
 * across focus/selection/scroll-state renders, skipping its async layout-config update chain.
 */
interface RenderCtx {
	total: number;
	rowHeight: number;
	gutterWidth: number;
	columnWidth: number;
	zones: readonly ZoneSpec[];
	style: ResolvedGraphStyle;
	graphPlacement: GraphPlacement;
	/** Visible-column slot the graph occupies (column mode) — interleaved among the zone cells. */
	graphColumnPos: number;
	/** Width (px) of the dedicated lane-fold strip prepended to the lanes; 0 when folding disabled. */
	foldLaneWidth: number;
	/** Displayed width (px) of the graph column (fold strip + gutter viewport). When < gutterWidth +
	 *  foldLaneWidth, the gutter clips + scrolls horizontally (column placement only). */
	graphColumnWidth: number;
	/** Cap width (fold strip excluded) for GROUPED placement — the epoch-wide fit ceilinged to the inline-
	 *  lane setting. Each row hugs its own footprint up to this; only a row past it clips here. */
	inlineGutterWidth: number;
	/** Grouped with a revealed (non-zero) lane offset: rows hug their VISIBLE extent at that offset, all
	 *  windowed in ONE shifted lane range (see RowRenderContext.groupedShifted). */
	groupedShifted: boolean;
	/** The revealed lane offset (px) backing `groupedShifted` — 0 when unshifted. */
	laneOffset: number;
	/** Narrowest graph column: render a single dot rail (no lane spread / connectors). */
	singleColumn: boolean;
	/** Lane build window (deep scrolled graphs) — rows bake it into their gutter metrics/cache keys so
	 *  edge art wholly outside it is skipped. Undefined = build every lane (small/medium graphs). */
	laneWindow?: LaneWindow;
	refsPlacement: RefsPlacement;
	refsHostId?: string;
	nodeMode: 'compact' | 'avatar';
	nodeAvatars: boolean;
	selected: ReadonlySet<string>;
	focusedSha: string | undefined;
	anchorShas?: ReadonlySet<string>;
	focalTipShas?: ReadonlySet<string>;
	forkPointShas?: ReadonlySet<string>;
	mergeTargetShas?: ReadonlySet<string>;
	inScopeShas?: ReadonlySet<string>;
	/** Shas matched by the active search (undefined = no active search). Drives row highlight + the
	 *  dimming of non-matches. Empty set = active search with 0 results (dims every row). */
	searchMatchedShas?: ReadonlySet<string>;
	/** Active search mode — matches are highlighted only in `normal` (legacy parity). */
	searchMode?: GraphSearchMode;
	/** First-parent chain of the hovered ref (highlightRowsOnRefHover) → `.is-inRefChain` rows. */
	inRefChainShas?: ReadonlySet<string>;
	/** `gitlens.graph.dimMergeCommits` — when true, merge rows render dimmed. */
	dimMergeCommits?: boolean;
	/** `showGhostRefsOnRowHover` — a faint ref pill (the row's lane-tip branch/tag) on hover/selection
	 *  for rows with no ref adornment. */
	showGhostRefs: boolean;
	/** Resolves an author email to its avatar URL — undefined when none is known OR the URL previously
	 *  failed to load (see `failedAvatarUrls`), so the row/gutter's existing "no avatarUrl" branch
	 *  renders initials without its own failed-check. */
	getAvatarUrl: (email: string) => string | undefined;
	/** Pull-through adornment resolution for a rendering row (cached per sha; O(visible) per frame). */
	getAdornments: (row: ProcessedGraphRow) => ResolvedAdornments | null;
	/** Resolves a row's commit payload (rows are topology-only; commits align by processed index). */
	getCommit: (sha: string) => GraphCommitView | undefined;
	/** Reports a failed avatar image/node load (email + attempted url); a single bound reference shared
	 *  by every row (not a per-row closure) — see `onAvatarImgError`. */
	onAvatarError: (event: Event) => void;
	formatDate?: (date: number) => string;
	segmentByCommit: ReadonlyMap<string, string>;
	/** Trunk segment's tip sha (deliberately excluded from `segmentByCommit` — lane-fold/split-pill
	 *  jump must never treat trunk as collapsible) — ghost-resolution-only fallback for trunk rows. */
	trunkTipSha?: string;
	/** Tip shas currently collapsed (drives `aria-expanded` on collapsible treeitems). */
	collapsedTips: ReadonlySet<string>;
	/** sha → clean/dirty for workdir rows; absent key = no glyph (stats not yet loaded). */
	wipStateBySha: ReadonlyMap<string, 'clean' | 'dirty'>;
	/** sha → running compose/review operation + agent status for the workdir rows' action buttons. */
	runningOperationByRowSha?: ReadonlyMap<string, RunningOperationBucket>;
	agentStatusByRowSha?: ReadonlyMap<string, WipRowAgentStatus>;
	/** Primary WIP row's conflict state — drives the Resolve action for the `work-dir-changes` row. */
	workingTreeStats?: GraphWorkingTreeStats;
	/** Secondary (per-worktree) WIP rows' metadata, keyed by their synthetic sha — same source for
	 *  their conflict state. */
	wipMetadataBySha?: GraphWipMetadataBySha;
}

/**
 * Pure-Lit commit graph host — the React-free replacement for `<gl-lit-graph>`. Owns the
 * `<lit-virtualizer>` row list, the engine pipeline (GitGraphRow → GraphCommitView →
 * `processCommitsAndSegments`), container-focus keyboard nav, and the delegated interaction
 * model. Emits the same `gl-graph-*` events `<gl-graph-wrapper>` already consumes so it is a
 * drop-in for the React path.
 *
 * Light DOM (`createRenderRoot` returns `this`) — matches `<gl-lit-graph>` so VS Code's
 * native `data-vscode-context` menu resolution works and global `graph.scss` styles apply.
 *
 * Wired: refs + WIP-stat + lane-collapse adornments, minimap day-range, WIP-stat loading +
 * avatar backfill, scope anchors / in-scope dimming / synthetic edges, lane-collapse
 * row-hiding (displayRows), column header. Stack chips remain a follow-up (need stack detection).
 */
@customElement('gl-lit-graph')
export class GlLitGraph extends LitElement {
	protected override createRenderRoot(): HTMLElement | DocumentFragment {
		return this;
	}

	@property({ type: Array }) rows?: GitGraphRow[];
	@property({ type: Object }) avatars?: GraphAvatars;
	@property({ type: Object }) rowsStats?: Record<string, GraphRowStats>;
	@property({ type: Object }) selectedRows?: GraphSelectedRows;
	// Lazily-fetched upstream/PR/issue metadata (keyed by ref id). The split ref pill reads ahead/behind
	// from `refsMetadata[id].upstream`; missing entries are requested via `gl-graph-missingrefsmetadata`.
	@property({ type: Object }) refsMetadata?: GraphRefsMetadata | null;
	// Monotonic token bumped by the host on an authoritative refsMetadata REPLACE (integration flip / toggle).
	// An integration-flip STRIP preserves a non-empty upstream map, so the empty-map reset heuristic below
	// can't catch it — a token change re-arms the per-id request dedup so the dropped types re-request.
	@property({ type: Number }) refsMetadataResetToken = 0;
	// Which metadata types the host resolves (graph.showUpstreamStatus / pullRequests.enabled /
	// issues.enabled). Drives requestMissingRefsMetadata — a type absent here is never requested even
	// when other types are.
	@property({ type: Array }) enabledRefMetadataTypes?: readonly GraphRefMetadataType[];
	@property({ type: Object }) searchResults?: DidSearchParams['results'];
	// True while a search is in flight: the host clears `searchResults` to undefined before results
	// arrive, so this keeps lanes treated as "search active" across that gap (see searchActive below).
	@property({ type: Boolean }) searching = false;
	// 'normal' = highlight matches + dim non-matches; 'filter' = show only matches. Drives row
	// highlight/dim (normal) and the displayRows filter (filter). Matches the legacy graph's behavior.
	@property({ type: String }) searchMode?: GraphSearchMode;
	@property({ type: Object }) config?: GraphComponentConfig;
	@property({ type: Object }) columns?: GraphColumnsSettings;
	// Selected repo path — needed to reconstruct lean commit rows' right-click context (the host now
	// ships only `contexts.flags`, not a serialized `contexts.row`); see toGraphCommit.
	@property({ type: String }) repoPath?: string;
	@property({ type: Object }) scope?: GraphScope;
	@property({ type: Object }) wipMetadataBySha?: GraphWipMetadataBySha;
	@property({ type: Object }) workingTreeStats?: GraphWorkingTreeStats;
	// Per-row WIP state for the row-action buttons: running compose/review operations (status icons)
	// and attached AI-agent status (the agent indicator). Drive the buttons' live updates.
	@property({ attribute: false }) runningOperationByRowSha?: ReadonlyMap<string, RunningOperationBucket>;
	@property({ attribute: false }) agentStatusByRowSha?: ReadonlyMap<string, WipRowAgentStatus>;
	@property({ type: Boolean }) loading?: boolean;
	// VS Code host-window focus state — undefined/true = focused. Dims the selection accent to the
	// inactive tone (see `gl-graph--window-unfocused` in graph.scss) when the window loses focus,
	// matching VS Code's own list/tree views.
	@property({ type: Boolean }) windowFocused?: boolean;
	// Host-serialized `data-vscode-context` JSON strings (the single source of truth, matching the
	// host's exact token format). `columnsContext` (gitlens:graph:columns) drives the column-header
	// right-click menu; `settingsContext` (gitlens:graph:settings) drives the header gear's menu
	// (columns + scroll-marker toggles). Both update via DidChangeColumns / DidChangeScrollMarkers.
	@property({ type: String }) columnsContext?: string;
	@property({ type: String }) settingsContext?: string;
	// Ref-visibility filters (Hide branch / Hide Remotes·Tags·Stashes). Applied client-side, matching
	// the legacy engine: hidden heads/remotes/tags drop from the ref pills + scroll-rail markers (the
	// current HEAD is always kept), and `excludeTypes.stashes` drops stash rows from the engine input.
	// The host re-pushes these via DidChangeRefsVisibility WITHOUT re-querying rows, so the filtering is
	// the webview's responsibility.
	@property({ type: Object }) excludeRefs?: GraphExcludeRefs;
	@property({ type: Object }) excludeTypes?: GraphExcludeTypes;
	// Per-upstream-name → tracking local branch names (packages/git-cli's `downstreamMap`, keyed
	// `${remoteOwner}/${branchName}`). Lets a tracked remote survive the "Hide Remote Branches" toggle
	// (isRefHidden) and drives the `upstream` scroll-rail marker — see graph-commit.ts's isTrackedUpstream.
	@property({ type: Object }) downstreams?: GraphDownstreams;
	// Branches-visibility narrowing (Current/Smart/Favorited). When set, only commits reachable from an
	// included ref tip stay visible; empty/undefined means "all branches". Applied client-side (the host
	// ships the full `--all` row set and re-pushes this without re-querying), so it's the webview's job.
	@property({ type: Object }) includeOnlyRefs?: GraphIncludeOnlyRefs;
	// Branch pinned to the leftmost lane(s) (gitlens.graph.pinBranchToEdge). Resolved to a sha and fed
	// to the engine as `pinnedShas`; a floating "Jump to Pinned Branch" pill scrolls to it when off-screen.
	@property({ type: Object }) pinnedRef?: GraphPinnedRef;

	@state() private containerWidth = 0;
	@state() private focusIndex = 0;
	// Fixed end of a keyboard range selection (Shift+Arrow). Reset to the moving row on any plain
	// (non-shift) navigation so the next Shift+Arrow extends from where the user last landed.
	private _selectionAnchorIndex?: number;
	// Column-header drag-reorder state. The drag SIMULATES the drop (columns re-render in the tentative
	// order), so the only reactive bit is `dragColId` — the id of the column being dragged — which marks
	// its cell as the lifted one. The rest of the drag (base snapshot, target, rAF) lives in `columnDrag`.
	@state() private dragColId: string | null = null;
	// Where the lane art renders. Session-scoped for now (not yet persisted across reloads).
	@state() private graphPlacement: GraphPlacement = 'column';
	// The graph's ANCHOR position: an insert-index into the FULL ordered zone list (`this.zones`,
	// including hidden / inline-refs zones), NOT the visible list. The VISIBLE slot is DERIVED from this
	// each render (`graphVisibleIndex`) by counting how many visible zones precede the anchor — so
	// hiding/inlining/reordering a column to the graph's left shifts its visible slot automatically and
	// can never desync. drag/Arrow-key reorder map the visible target back to an anchor. Session-scoped.
	@state() private graphColumnPos = 0;
	// Derived once per render in `updateRenderState`: the graph's VISIBLE-slot index (anchor projected
	// through the current visible zones). Read by the header; passed to rows as `ctx.graphColumnPos`.
	private graphVisibleSlot = 0;
	// Where refs (branches/tags/remotes) render: 'grouped' = pills at the head of their host column —
	// the zone adjacent to Refs at group-time (`refsHostZoneId`), falling back to Message — anchored BY
	// ID via `refsHostIdFor` so the group travels with it through reorders (default); 'column' = a
	// dedicated Refs column (expanded density only, where columns exist). Session-scoped, matching
	// `graphPlacement`.
	@state() private refsPlacement: RefsPlacement = 'grouped';
	// Adjacent zone id captured at group-time by `toggleRefsPlacement` (undefined = use the Message
	// fallback). Session-scoped like `refsPlacement` — not persisted.
	@state() private refsHostZoneId: string | undefined;
	// Lane folding (collapse/expand of mergeable lane segments). On → a dedicated fold strip on the
	// left edge of the lanes shows expand/collapse chevrons on collapsible segment-tip rows. Off → no
	// fold strip, no chevrons, and all lanes stay expanded (default-collapse + manual folds ignored).
	// Backed by `gitlens.graph.lanes.folding.enabled` (via the reactive `config` property).
	private get foldingEnabled(): boolean {
		return this.config?.lanesFoldingEnabled ?? true;
	}
	// Which lanes start folded, once folding is on — `gitlens.graph.lanes.folding.default`.
	private get foldingDefault(): 'none' | 'all' | 'auto' {
		return this.config?.lanesFoldingDefault ?? 'none';
	}
	// First-parent ancestry chain of the currently PINNED (clicked) ref pill → those rows get
	// `.is-inRefChain` (others dim). Driven by a pill CLICK now (not hover), so it persists across
	// hover-out + scroll; cleared when the pill is clicked again (unpinned).
	@state() private refHoverChainShas?: ReadonlySet<string>;
	// Name of the click-pinned ref pill: keeps it expanded (the `.is-pinned` class, reconciled after
	// each render) and drives the dim chain above + the click toggle. Undefined = nothing pinned.
	@state() private _pinnedRefKey?: string;
	// Direction to the current HEAD commit when it's scrolled OFF-screen (drives the floating
	// "Scroll to HEAD" pill; the arrow points toward HEAD). Undefined = HEAD is visible → no pill.
	// Only flips when HEAD crosses the visible edge (set from onRangeChanged), so it's not per-frame.
	@state() private headPillDirection?: 'up' | 'down';
	// Direction to the pinned branch's row when it's scrolled OFF-screen (drives the floating "Jump to
	// Pinned Branch" pill; the arrow points toward it). Undefined = no pinned ref, or it's in view.
	@state() private pinnedPillDirection?: 'up' | 'down';
	// User-set displayed width (px) of the graph column viewport, via the resize handle. Undefined =
	// fit the lanes. Narrower than the lane content → the gutter scrolls horizontally (graphScrollX)
	// instead of the lanes re-spacing. Session-scoped, matching `graphPlacement`.
	@state() private graphViewportWidth?: number;
	// Horizontal scroll offset (px) of the gutter content within the viewport. NOT a reactive prop:
	// h-scroll is one CSS-var write (`--graph-gutter-scroll`) — the compositor slides the translated
	// surfaces and the CSS pin repositions the dots, with no Lit render.
	private graphScrollX = 0;
	// GROUPED placement's lane offset (px, lane-grid aligned) — SELECTION-driven, never scroll-driven:
	// `revealFocusedLane` shifts it the minimum amount that brings the focused row's lane inside the
	// capped viewport, and every clipped row shares it (one window — the rows move together). It feeds
	// `graphScrollX` at render time (see updateRenderState); wheel/scrollbar/keys never touch it.
	private groupedLaneOffset = 0;
	// Focused sha the reveal last armed for (sha-keyed — see willUpdate; index restorations don't count).
	private lastRevealedFocusSha: string | undefined;
	// The lane build window the last committed render baked into the gutter SVGs (undefined = unwindowed).
	// The clamp pass MUST replay this (never a fresh compute) so its geometry ops align index-for-index
	// with the DOM the build emitted; `applyGraphScroll` diffs a fresh compute against it to detect the
	// (rare) bucket crossing that requires a re-render.
	private renderedLaneWindow: LaneWindow | undefined;

	private virtualizerRef: Ref<LitVirtualizer> = createRef();
	// The `role=tree`, tabindex=0 viewport — the keyboard-nav focus target. Held so the host can route
	// programmatic `focus()` (graph open / sidebar select) here; the element itself (light DOM) isn't focusable.
	private viewportRef: Ref<HTMLElement> = createRef();
	private resizeObserver?: ResizeObserver;
	// Stable `keyFunction` + `layout` so the virtualizer never re-runs its (async) layout-config
	// chain on incidental updates. `renderItem` is deliberately RE-created each render (see
	// render()) so the virtualizer re-renders visible rows when per-row state (selection, focus,
	// placement, node style, dimming, adornments) changes without `items` changing. The per-row
	// body reads the willUpdate-cached `_renderCtx` snapshot so no derivation happens in the loop.
	//
	// `rowKey` = the row's sha: ordinary scroll reuses every still-visible row's DOM untouched (only rows
	// entering the window do work); disjoint jumps (scrollbar teleports) rebuild the rendered rows, kept cheap
	// by the rasterized pass-through lanes. A slot-keyed recycling variant made teleports cheaper but re-wrote
	// every visible row's bindings on EVERY scroll tick — far worse for the common gesture.
	private readonly rowKey = (row: ProcessedGraphRow): string => row.sha;
	// Fixed-size vertical layout: rows are uniform height per density, so `idx * rowHeight` positions
	// them exactly (no `flow()` measurement, no sub-pixel drift). `itemSize` is kept in sync with the
	// density's row height in `updateRenderState` (a guarded no-op unless it actually changes). Stable
	// object identity so the virtualizer's layout stays the same instance across incidental renders.
	private readonly fixedRowLayout: FixedSizeLayoutSpecifier = fixedSizeVertical(rowHeightTable);
	private _renderCtx!: RenderCtx;
	private _activeRowId?: string;

	private renderRowItem(row: ProcessedGraphRow, index: number): TemplateResult {
		const c = this._renderCtx;
		// Rows are topology-only — resolve the aligned commit payload. A miss can't happen for rows the
		// pipeline produced; guard with an empty spacer so a bug degrades to a blank row, not a crash.
		const commit = c.getCommit(row.sha);
		if (commit == null) {
			return html`<div class="gl-graph__row" style=${cspStyleMap({ height: `${c.rowHeight}px` })}></div>`;
		}

		// Teleport-class scrolling (see `skeletonScroll`): render the STRUCTURAL row — same zones, same
		// (cache-shared) gutter, message/author/date text — skipping only the expensive extras (adornments,
		// pills, avatars, actions, aria/context payloads). Cheap enough to rebuild the whole range every
		// drag frame, and the settle swap just fills the extras in — the lanes never repaint. The workdir
		// row and the active row stay full (anchor + focus/selection continuity).
		const skeleton = this.skeletonScroll && row.kind !== 'workdir' && row.sha !== this._activeRowId;

		const adornments = skeleton ? undefined : c.getAdornments(row);
		const isAnchor = c.anchorShas?.has(row.sha) === true;
		const isFocalAnchor = c.focalTipShas?.has(row.sha) === true;
		const isForkAnchor = c.forkPointShas?.has(row.sha) === true;
		const isTargetAnchor = c.mergeTargetShas?.has(row.sha) === true;
		// Primary look priority: focal → TARGET → fork. Target beats fork so that when a branch is
		// purely ahead of its target (the common case: merge-base === target tip, same commit), the row
		// reads as the merge target — not the fork point. `anchorAlsoFork` then marks it as the base too.
		const anchorKind: RowRenderContext['anchorKind'] = !isAnchor
			? undefined
			: isFocalAnchor
				? 'focal'
				: isTargetAnchor
					? 'target'
					: isForkAnchor
						? 'fork'
						: undefined;
		// The merge-target row is ALSO the fork point (base) — show a combined marker + tooltip.
		const anchorAlsoFork = anchorKind === 'target' && isForkAnchor;
		// This row's lane-segment tip (undefined for the trunk lane / rows outside any segment) — reused
		// below for BOTH the fold-chevron hit-target (`laneTipSha`) and the ghost-ref resolution so the
		// map lookup only happens once.
		const laneTipSha = c.segmentByCommit.get(row.sha);
		// Ghost-ref pill source: the lane tip's PRIMARY visible ref (never this row's own sha) — only
		// resolved for rows that could actually show a ghost (config on, not workdir/stash) so ref-ful
		// rows and WIP/stash rows never pay for the lookup. Two map lookups (segmentByCommit + getCommit)
		// + a small scan over the tip's refs — cheap enough per ref-less row with no caching.
		// `segmentByCommit` excludes the trunk segment (laneTipSha stays undefined there — lane-fold/
		// split-pill jump must not treat trunk as collapsible), so fall back to the trunk tip for ghost
		// resolution ONLY — a ref-less trunk row still ghosts the nearest descendant tip's branch,
		// matching the legacy engine. `laneTipSha` itself (the fold hit-target) is untouched.
		const ghostTipSha = laneTipSha ?? c.trunkTipSha;
		const ghostRefSource =
			!skeleton && c.showGhostRefs && ghostTipSha != null && row.kind !== 'workdir' && row.kind !== 'stash'
				? pickGhostRef(
						c.getCommit(ghostTipSha)?.commitRefs,
						this.excludeTypes,
						this.excludeRefs,
						this.downstreams,
					)
				: undefined;
		const ghostRef: RowRenderContext['ghostRef'] =
			ghostRefSource != null ? { name: ghostRefSource.name, kind: ghostRefSource.kind } : undefined;
		return renderRow(row, {
			commit: commit,
			index: index,
			total: c.total,
			skeleton: skeleton || undefined,
			rowHeight: c.rowHeight,
			gutterWidth: c.gutterWidth,
			columnWidth: c.columnWidth,
			zones: c.zones,
			style: c.style,
			graphPlacement: c.graphPlacement,
			graphColumnPos: c.graphColumnPos,
			refsPlacement: c.refsPlacement,
			refsHostId: c.refsHostId,
			gutterCache: this.gutterCache,
			nodeMode: c.nodeMode,
			avatars: c.nodeAvatars,
			isSelected: c.selected.has(row.sha),
			isFocused: row.sha === c.focusedSha,
			isAnchor: isAnchor,
			anchorKind: anchorKind,
			anchorAlsoFork: anchorAlsoFork,
			isDimmed:
				(c.inScopeShas != null && !c.inScopeShas.has(row.sha)) ||
				(c.dimMergeCommits === true && row.kind === 'merge') ||
				// Active search dims every non-match (and every row when there are 0 matches).
				(c.searchMatchedShas != null && !c.searchMatchedShas.has(row.sha)) ||
				// Ref-hover: dim rows outside the hovered ref's first-parent chain so the chain pops.
				(c.inRefChainShas != null && !c.inRefChainShas.has(row.sha)),
			// Highlight matched rows — only in `normal` mode (filter mode would hide non-matches, so the
			// remaining rows are all matches and highlighting them would be redundant; matches the legacy).
			isSearchMatch: c.searchMatchedShas?.has(row.sha) === true && c.searchMode !== 'filter',
			isInRefChain: c.inRefChainShas?.has(row.sha) === true,
			avatarUrl: c.getAvatarUrl(commit.authorEmail),
			onAvatarError: c.onAvatarError,
			formatDate: c.formatDate,
			foldContent: adornments?.fold,
			foldLaneWidth: c.foldLaneWidth,
			graphColumnWidth: c.graphColumnWidth,
			inlineGutterWidth: c.inlineGutterWidth,
			groupedShifted: c.groupedShifted,
			laneOffset: c.laneOffset,
			singleColumn: c.singleColumn,
			laneWindow: c.laneWindow,
			refsContent: adornments?.ref,
			showGhostRefs: c.showGhostRefs,
			messageAdornments: adornments?.message,
			adornmentLabel: adornments?.label,
			laneTipSha: laneTipSha,
			laneCollapsed: c.collapsedTips.has(row.sha),
			ghostRef: ghostRef,
			wipState: c.wipStateBySha.get(row.sha),
			wipOperation: row.kind === 'workdir' ? c.runningOperationByRowSha?.get(row.sha) : undefined,
			wipAgent: row.kind === 'workdir' ? c.agentStatusByRowSha?.get(row.sha) : undefined,
			// Inline Resolve is gated to the PRIMARY WIP row (legacy parity) — secondary worktrees
			// surface conflicts via the details-header chip instead.
			hasConflicts:
				row.kind === 'workdir' && !isSecondaryWipSha(row.sha) ? c.workingTreeStats?.hasConflicts : undefined,
			isUnpushed: commit.isUnpublished,
			undoTarget: commit.undo,
			avatarVscodeContext: commit.avatarVscodeContext,
		});
	}

	// Derived, recomputed in willUpdate when their inputs change (replaces React useMemo).
	// `processedRows` is the FULL engine output (kept for trunk/chain/scope walks); `displayRows`
	// is what the virtualizer renders (processedRows minus rows hidden by collapsed lanes).
	// Engine rows are TOPOLOGY-ONLY; `commits` is the aligned payload plane (commits[i] belongs to
	// processedRows[i]) — payload lookups go by index (`processedIndexBySha`) so a payload-only
	// change can swap `commits` without touching the rows or anything derived from their identity.
	private processedRows: readonly ProcessedGraphRow[] = [];
	private displayRows: readonly ProcessedGraphRow[] = [];
	private commits: readonly GraphCommitView[] = [];
	private segments: readonly LaneSegment[] = [];
	// Incremental-append state for `recomputeRows`. When a rows change is a pure APPEND of older commits
	// onto the same prefix (no scope, no pin, unchanged idLength), the engine resumes from `_engineResume`
	// and only the new tail is mapped + processed (O(page) instead of O(total)). `_priorEngineSourceRows`
	// is the last engine input (post-filter) used to classify the change; `commits` doubles as its
	// mapping, reused for the prefix. Any mismatch falls back to a full recompute.
	private _engineResume?: GraphProcessResume;
	private _priorEngineSourceRows?: readonly GitGraphRow[];
	private _priorEngineIdLength?: number;
	// Parked-lane floor of the last full engine run — columns ≥ this are excluded from the next
	// run's sticky preferences so the lane space can't ratchet upward (see recomputeRows).
	private _priorPreferredFloor = 0;
	// True when the LAST recomputeRows took the payload-only path (engine + topology derivations
	// skipped). willUpdate reads it (same synchronous update) to route a payload change to the light
	// displayRows refresh (ref indexes + upstream requests) instead of the full lane re-derivation.
	private lastRowsDeltaPayloadOnly = false;
	// True when the LAST recomputeRows took the engine append path — willUpdate reads it to keep the
	// frozen default-collapse set (no auto-folding of segments completed by paging; see
	// recomputeLaneDerivations) and recomputeDisplayRows uses it to try the incremental drop pass.
	private lastRowsDeltaAppendOnly = false;
	// After a PREFIX change ('replace' — fetch/new commits), the aligned spans of trailing rows the
	// engine run reconciled back to prior object identity (byte-identical output, so the swap is
	// exact). The collapse filter uses it to splice the reused run instead of re-filtering the graph,
	// and willUpdate keeps the frozen default-collapse set when a replace reconciled (a background
	// update must not restructure the view under the user).
	private lastRowsDeltaReconciled?: ReconciledSuffix;
	// sha → reserved column for additional parents that paged off the window (never appear as a row).
	// Re-threaded into the collapse/scope edge re-pass so a merge's dangling stub survives folding.
	private unloadedColumns: ReadonlyMap<Sha, number> = new Map();
	private zones: readonly ZoneSpec[] = defaultZones;
	private maxColumn = 0;
	// sha → index into `displayRows` (the rendered list — drives click/keyboard/range math).
	private indexBySha = new Map<string, number>();
	private lastRowsRef?: GitGraphRow[];
	private lastIdLength = 7;
	private lastColumnsRef?: GraphColumnsSettings;
	// Cached collapse/scope derivation (the pre-filter row set produced by computeDisplayRows /
	// compactColumns). Rebuilt only when its inputs change — so an incremental filter search, which
	// re-runs recomputeDisplayRows on every results update without touching these inputs, reuses it
	// instead of rebuilding the full set over all rows each time.
	private cachedCollapsedRows?: readonly ProcessedGraphRow[];
	private lastCollapsedRowsRef?: readonly ProcessedGraphRow[];
	private lastCollapsedSegmentsRef?: ReadonlyMap<Sha, LaneSegment>;
	private lastCollapsedJunctionsRef?: ReadonlySet<Sha>;
	private lastCollapsedScopeRef?: ScopeProjection;

	// Cached split-pill ref indexes (refRowIndex/localByUpstreamId/processedIndexBySha). They depend
	// ONLY on processedRows, so rebuild only when it changes — a filter-search or lane toggle re-runs
	// recomputeDisplayRows without touching processedRows and reuses these instead of re-walking all rows.
	private cachedRefRowIndex?: Map<string, { sha: string; index: number }>;
	private cachedLocalByUpstreamId?: Map<string, { sha: string; index: number; id?: string; name?: string }>;
	private cachedProcessedIndexBySha?: Map<string, number>;
	private lastRefIndexRowsRef?: readonly ProcessedGraphRow[];
	private lastRefIndexCommitsRef?: readonly GraphCommitView[];
	// sha→HOST row map over `this.rows` (raw GitGraphRow[], carries heads/remotes — `processedRows`
	// doesn't), cached on its identity. Feeds `branchHintFor` so resolving a collapsed-lane tip's
	// branch hint is an O(1) lookup instead of an O(rows) `.find()` per tip.
	private cachedRowByShaRef?: GitGraphRow[];
	private cachedRowBySha?: ReadonlyMap<Sha, GitGraphRow>;
	// The displayRows array the display index (indexBySha/maxColumn/focus) was last built from —
	// an identity match skips that rebuild (payload-only refreshes keep the rendered list stable).
	private lastIndexedDisplayRowsRef?: readonly ProcessedGraphRow[];
	// The drop-set + engine unloaded-columns behind `cachedCollapsedRows` — the incremental collapse
	// append diffs against these to prove the already-rendered region can't have changed.
	private lastDroppedShas?: ReadonlySet<Sha>;
	private lastDisplayUnloadedColumns?: ReadonlyMap<Sha, number>;

	// Cached selection set (rebuilt only when `selectedRows` changes — not allocated per render).
	private selectedShas: ReadonlySet<string> = new Set();
	private lastSelectedRowsRef?: GraphSelectedRows;
	// Date formatters honoring the user's dateStyle/dateFormat config (rebuilt on config change).
	// `formatDateShortFn` is the ultra-compact variant used when the date column is too narrow.
	private formatDateFn?: (date: number) => string;
	private formatDateShortFn?: (date: number) => string;
	private lastConfigRef?: GraphComponentConfig;
	// Scroll-rail markers (recomputed only when rows/selection/search/marker-types change). The flat
	// list is grouped by row for rendering: one full-width interactive band per row carrying all its
	// markers (so hover/click hits the whole row + one tooltip lists every marker, in lane order).
	private scrollMarkers: readonly ScrollMarker[] = [];
	private scrollMarkerRows: readonly RowMarkers[] = [];
	// Non-selection markers (the full-row-scan output), cached so a selection-only change merges
	// selection markers on top instead of rescanning the rendered rows.
	private baseScrollMarkers: readonly ScrollMarker[] = [];
	private lastSearchResultsRef?: DidSearchParams['results'];
	private lastSearchModeRef?: GraphSearchMode;
	private lastScrollMarkerTypesRef?: GraphScrollMarkerTypes[];
	// Cached set of search-matched shas (undefined = no active search). Rebuilt only when
	// `searchResults` changes (see willUpdate) — read by dim/highlight + the filter-mode row filter.
	private _searchMatchedShas?: ReadonlySet<string>;

	// Scope (recomputed when rows/scope change). `syntheticChildren` feeds recomputeRows so the
	// engine emits wavy synthetic edges; `inScopeShas` drives per-row dimming.
	private scopeAnchors: ScopeAnchors = {};
	private inScopeShas?: ReadonlySet<string>;
	private lastScopeRef?: GraphScope;
	private lastEmittedUnreachableKey = '';

	// Ref-visibility filter tracking. `lastExcludeRefsRef`/`lastExcludeTypesRef` drive the adornment +
	// scroll-marker re-filter (identity compare — the host ships a fresh object per change). The stash
	// flag is tracked separately because hiding stashes drops rows from the ENGINE input (a recomputeRows
	// re-run).
	private lastExcludeRefsRef?: GraphExcludeRefs;
	private lastExcludeTypesRef?: GraphExcludeTypes;
	private lastExcludeStashes = false;
	// `showRemoteNamesOnRefs` field-level tracking (NOT whole-`config`-identity — a fresh config object
	// arrives on many unrelated pushes and would nuke the adornment cache constantly). A flip re-resolves
	// adornments so cached ref-pill labels pick up the new bare/qualified name.
	private lastShowRemoteNamesRef = false;
	// Row-filter tracking for branches-visibility / hidden-ref filtering — separate refs from the
	// marker trackers above so a filter change re-runs recomputeRows (it now drops commit ROWS, not
	// just ref labels: hidden heads/remotes/tags and Current/Smart/Favorited narrow the reachable set).
	private lastIncludeOnlyRefsRef?: GraphIncludeOnlyRefs;
	private lastExcludeRefsForRows?: GraphExcludeRefs;
	private lastExcludeTypesForRows?: GraphExcludeTypes;
	// Pinned branch tracking + its resolved sha (the leftmost-lane pin + the jump-pill target). A change
	// re-runs recomputeRows so the engine re-pins via `pinnedShas`.
	private lastPinnedRef?: GraphPinnedRef;
	private pinnedSha?: string;

	// Lane-collapse session state (mirrors React's two manual sets; default-mode set is derived).
	// Manual toggles re-derive synchronously in toggleLane, so willUpdate only handles the
	// rows/config/search-driven recompute.
	private manuallyCollapsed: ReadonlySet<Sha> = new Set();
	private manuallyExpanded: ReadonlySet<Sha> = new Set();
	private lastFoldingDefault?: 'none' | 'all' | 'auto';
	// Tracks the prior `foldingEnabled` so willUpdate can detect toggles (a config-derived getter can't
	// go through `changed.has`). Init matches the getter's fallback so the first pass sees no change.
	private lastFoldingEnabled = true;

	// Rows-only derivations (recomputed by recomputeRows, not on search/config/toggle).
	private headSha?: string;
	private trunkSegmentTip?: Sha;
	// The frozen default-collapse set (see recomputeLaneDerivations): re-derived only when its real
	// inputs change, carried verbatim across paging appends and manual fold toggles.
	private lastDefaultCollapsedSet: ReadonlySet<Sha> = new Set();
	private effectiveCollapsed: ReadonlySet<Sha> = new Set();
	private segmentsByTipSha: ReadonlyMap<Sha, LaneSegment> = new Map();
	private collapsedByTipSha: ReadonlyMap<Sha, LaneSegment> = new Map();
	private visibleJunctions: ReadonlySet<Sha> = new Set();
	private hiddenCountByTipSha: ReadonlyMap<Sha, number> = new Map();
	// Set while scoped to a branch: the focal-spine projection (drives displayRows + suppresses the
	// in-scope dimming, since the scoped view only renders in-scope rows). Undefined when not scoped.
	private scopeProjection?: ScopeProjection;
	// commit-sha → segment-tip-sha (non-trunk) for the gutter node's lane-collapse hit-target.
	// Mutable so an append can index only the segments that actually changed (see recomputeRows).
	private segmentByCommit = new Map<Sha, Sha>();
	// tipSha → the exact segment object last folded into `segmentByCommit`. Finalized segments keep
	// their identity across engine appends, so a reference match means "already indexed — skip".
	private readonly lastIndexedSegmentByTip = new Map<Sha, LaneSegment>();
	// Commits that WIP/workdir rows sit on (first-parent anchors). Kept visible on collapse so
	// folding a lane never hides — nor re-anchors a WIP row away from — the commit it's based on.
	private wipAnchorShas: ReadonlySet<Sha> = new Set();
	// Workdir-row shas (drives the wipSegmentTips derivation; patched on append).
	private workdirShas: ReadonlySet<Sha> = new Set();
	// Segment tips that are WIP/workdir rows — excluded from `auto` default-collapse so working changes
	// stay expanded.
	private wipSegmentTips: ReadonlySet<Sha> = new Set();
	// workdir sha → clean/dirty (built in rebuildWipStatsProvider; drives the WIP node glyph).
	private wipStateBySha: ReadonlyMap<Sha, 'clean' | 'dirty'> = new Map();
	private laneCollapseProvider?: RowAdornmentProvider<TemplateResult, LaneCollapseChipContext>;

	// Adornments (refs + WIP). Lane-collapse + stack providers are deferred to the Phase 5
	// controller (they need displayRows row-hiding / stack detection that don't exist yet).
	private adornmentRegistry = new AdornmentRegistry<TemplateResult>();
	// Split-pill support: refId → its row (for jump targets), and remote refId → the local head tracking
	// it (so a remote pill can link/jump back to its local). Built over the FULL processed rows (not just
	// displayRows) so a counterpart hidden inside a collapsed lane is still resolvable; `index` is the
	// PROCESSED-rows position (drives the jump's up/down arrow). Rebuilt per recompute.
	private refRowIndex = new Map<string, { sha: string; index: number }>();
	private localByUpstreamId = new Map<string, { sha: string; index: number; id?: string; name?: string }>();
	// sha → processed-rows position; used for the split-pill jump direction (the counterpart may be
	// collapsed, so it isn't always in the displayRows-based `indexBySha`).
	private processedIndexBySha = new Map<string, number>();
	// Payload lookup for topology-only rows: sha → the aligned commit (commits[i] ↔ processedRows[i]).
	// A stable arrow (reads live fields) so provider hooks and the render ctx never go stale.
	private readonly getCommitBySha = (sha: string): GraphCommitView | undefined => {
		const i = this.processedIndexBySha.get(sha);
		return i != null ? this.commits[i] : undefined;
	};
	// `trunkSegmentTip` can BE the synthetic WIP row (it heads the trunk segment when working
	// changes sit on HEAD) — that row's `commitRefs` is always `[]`, so ghost-resolution must hop
	// to its first parent (the real HEAD commit, which carries the branch ref) instead.
	private trunkGhostTipSha(): Sha | undefined {
		const tip = this.trunkSegmentTip;
		if (tip == null) return undefined;

		const commit = this.getCommitBySha(tip);
		return commit?.kind === 'workdir' ? commit.parents[0] : tip;
	}
	// URLs that failed to load at least once this session — never @state (flipping it must not itself
	// schedule a render; `reportAvatarLoadError` calls `requestUpdate()` explicitly). Keyed by URL, not
	// email: a proxied re-serve (see `flushAvatarLoadErrors`) arrives as a NEW url for the same email, so
	// a stale entry here simply stops matching anything — no explicit reconcile/clear is needed.
	private readonly failedAvatarUrls = new Set<string>();
	// Emails already dispatched in a `gl-graph-missingavatars` request this rows-session — a PERSISTENT dedup so
	// scrolling back over the same authors never re-requests their avatars (the visible-range scan filters these
	// out BEFORE dispatching). Reset only on a rows-identity swap (new repo/reload) + disconnect. Distinct from
	// `failedAvatarUrls` (broken-URL fallback), which this leaves untouched.
	private readonly requestedAvatars = new Set<string>();
	private pendingAvatarErrors: Record<string, string> = {};
	private avatarErrorFlushTimer: ReturnType<typeof setTimeout> | undefined;
	// Resolves an author email to its avatar URL, treating a previously-failed URL as absent so the
	// row/gutter's existing "no avatarUrl" branch renders initials — no separate failed-check needed at
	// the render sites. A stable arrow (threaded onto `RenderCtx.getAvatarUrl`, called per row).
	private readonly resolveAvatarUrl = (email: string): string | undefined => {
		const url = this.avatars?.[email];
		return url != null && url.length > 0 && !this.failedAvatarUrls.has(url) ? url : undefined;
	};
	// Delegated (shared, not a per-row closure) `@error` handler for every row's avatar `<img>` / gutter
	// identity-node `<image>` — reads the failed element's email/url straight off the DOM via
	// `data-avatar-email` + `src`/`href` (native `error` events don't bubble, but a per-element listener
	// bound to this single stable reference costs nothing extra vs. the click/contextmenu delegation
	// used elsewhere in this file).
	private readonly onAvatarImgError = (event: Event): void => {
		const target = event.target as Element;
		const email = target.getAttribute('data-avatar-email');
		const url = target.getAttribute('src') ?? target.getAttribute('href');
		if (email == null || email.length === 0 || url == null || url.length === 0) return;

		this.reportAvatarLoadError(email, url);
	};
	// Records a broken avatar URL (row/gutter fall back to initials on the next render) and batches
	// (email → url) pairs for ~150ms before asking the host to re-serve them through its avatar proxy —
	// mirrors the legacy `<gl-graph>` React adapter's `avatarErrorBatch`.
	private readonly reportAvatarLoadError = (email: string, url: string): void => {
		if (this.failedAvatarUrls.has(url)) return;

		this.failedAvatarUrls.add(url);
		this.requestUpdate();
		this.pendingAvatarErrors[email] = url;
		this.avatarErrorFlushTimer ??= setTimeout(this.flushAvatarLoadErrors, 150);
	};
	private readonly flushAvatarLoadErrors = (): void => {
		this.avatarErrorFlushTimer = undefined;
		const pending = this.pendingAvatarErrors;
		if (Object.keys(pending).length === 0) return;

		this.pendingAvatarErrors = {};
		this.dispatchEvent(new CustomEvent('gl-graph-avatarloaderror', { detail: { avatars: pending } }));
	};
	// Metadata requested so far, per ref id → the set of types already asked for (or already resolved),
	// so the lazy fetch fires once per (id, type) — turning on a new type later (e.g. Pull Requests)
	// still fires a request for refs already settled on other types.
	private requestedMetadata = new Map<string, Set<GraphRefMetadataType>>();
	private lastRefsMetadataRef?: GraphRefsMetadata | null;
	private lastRefsMetadataResetToken = 0;
	private lastDownstreamsRef?: GraphDownstreams;
	// Pinned-aware: the click-pinned ref is promoted to the inline pill (see createRefAdornmentProvider).
	// Split-pill hooks read live state (metadata/row positions), so they're getters, never cached.
	private refsProvider = createRefAdornmentProvider(
		() => this._pinnedRefKey,
		{
			getUpstream: ref => this.getUpstreamStats(ref),
			resolveJump: (ref, fromSha) => this.resolveRefJump(ref, fromSha),
			onJumpToRef: sha => this.jumpToRefRow(sha),
			getPullRequests: ref =>
				ref.id != null ? (this.refsMetadata?.[ref.id]?.pullRequest ?? undefined) : undefined,
			getIssues: ref => (ref.id != null ? (this.refsMetadata?.[ref.id]?.issue ?? undefined) : undefined),
			getUpstreamMetadataId: ref => this.getUpstreamMetadataId(ref),
			getShowRemoteNames: () => this.config?.showRemoteNamesOnRefs === true,
		},
		() => ({ excludeTypes: this.excludeTypes, excludeRefs: this.excludeRefs, downstreams: this.downstreams }),
		this.getCommitBySha,
	);
	private wipStatsProvider?: RowAdornmentProvider<TemplateResult, WipStats>;
	private providerDisposers: (() => void)[] = [];
	private invalidateUnsubs: (() => void)[] = [];
	// sha → resolved adornments (null = row has none) for rows that have RENDERED since the last
	// invalidation. Bounded by the visible window over time; cleared O(1) on any input change.
	private readonly adornmentCache = new Map<string, ResolvedAdornments | null>();
	// Per-instance memo over the per-row gutter SVG (edges + node). `updateRenderState` sets its epoch
	// once per render (from the render-global metrics/style/palette/clamp); `renderRow` keys into it per
	// row so unchanged gutters reuse their template across re-render ticks (vertical scroll, selection,
	// payload swaps). `gutterPaletteEpoch` folds palette swaps into that epoch — lane colors are baked
	// into the SVG, so the same signal that repaints ref pills (`onLanePaletteChanged`) must drop this.
	private readonly gutterCache = new GutterCache(renderGutterSvg);
	private gutterPaletteEpoch = 0;
	private providersRegistered = false;
	private lastWipStatsRef?: GraphWorkingTreeStats;
	private lastWipMetaRef?: GraphWipMetadataBySha;

	// Visible-range bookkeeping (drives minimap day-range + WIP-stat loading + avatar backfill). The scan is
	// debounced trailing (mirrors the React adapter's 350ms `wipShasSettleDelayMs`) so rapid arrow/scroll past
	// WIP rows doesn't fire IPC per frame; the dedup keys skip no-op dispatches.
	private static readonly wipSettleDelayMs = 350;
	private readonly scanVisibleRangeDebounced = debounce(
		(first: number, last: number): void => this.scanVisibleRange(first, last),
		GlLitGraph.wipSettleDelayMs,
	);
	private lastVisibleDaysKey = '';
	private lastWipVisibleKey = '';
	private lastWipMissingKey = '';
	private lastScrollbarWidth = -1;
	// Cached scroller clientHeight (the viewport height). Only changes on resize, so it's read in the
	// ResizeObserver + firstUpdated rather than per scroll frame (reading clientHeight forces layout).
	private scrollerClientHeight = 0;
	// Teardown for an in-flight column-resize drag (window listeners + RAF live outside the
	// element, so they must be cleaned up explicitly if the element disconnects mid-drag).
	private resizeDragCleanup?: () => void;
	// Double-press detection on the resize handles: pointer capture + preventDefault suppress the native
	// `dblclick`, so we time consecutive presses on the same boundary ourselves (see `onResizeStart`).
	private lastResizeDownAt = 0;
	private lastResizeDownIdx = -1;
	// True while a column/graph resize drag is active — suppresses row hovers, tooltips, and clicks so
	// the graph doesn't flicker tooltips or select rows as the pointer sweeps over it mid-drag.
	private draggingColumn = false;
	// Active column-resize preview: the solved visible zones (preserve-based, from `dragResizeZone`) and
	// the id whose preferred width persists on release. While set, `updateRenderState` renders these
	// instead of re-solving from the persisted preferred widths.
	private dragSolvedZones?: readonly ZoneSpec[];
	private dragSavedIds?: readonly ZoneId[];

	override connectedCallback(): void {
		super.connectedCallback?.();
		// Start each (re-)connect with a clean scroll-shadow state — the scroller resets to top.
		this.wasScrolled = false;
		this.resizeObserver = new ResizeObserver(entries => {
			const width = entries[0]?.contentRect.width ?? 0;
			if (width !== this.containerWidth) {
				this.containerWidth = width;
				// Abort any in-flight reveal slide: a resize re-solves the grouped cap/widths, and the
				// armed width transition would ease those (then snap mid-flight on disarm) instead of
				// tracking the resize 1:1. (A PENDING debounced reveal stays armed — it re-evaluates
				// against the resized cap when it fires, which is exactly right.)
				this.cancelLaneReveal();
			}
			// The scrollbar gutter can change with the container size.
			this.measureScrollbarWidth();
			// Cache the scroller viewport height — it only changes on resize, so per-frame readers (the
			// minimap day-range) use the cache instead of forcing layout with a live clientHeight read.
			this.scrollerClientHeight = this.virtualizerRef.value?.clientHeight ?? 0;
			// A resize can shift the chrome above the row list onto/off a fractional boundary.
			this.snapVirtualizerToPixelGrid();
		});
		this.resizeObserver.observe(this);
		// On RECONNECT the virtualizer DOM already exists but firstUpdated won't fire again, so
		// re-attach the (passive) scroll listener here. First connect is handled by firstUpdated.
		if (this.hasUpdated) {
			this.attachScrollListener();
		}
		window.addEventListener('gl-graph-lane-palette-changed', this.onLanePaletteChanged);
	}

	override disconnectedCallback(): void {
		window.removeEventListener('gl-graph-lane-palette-changed', this.onLanePaletteChanged);
		// Release the gutter-template cache so a detached instance holds no `TemplateResult`s.
		this.gutterCache.clear();
		// Drop the persistent requested-avatars dedup so a reconnect re-scans from scratch.
		this.requestedAvatars.clear();
		this.resizeObserver?.disconnect();
		this.resizeObserver = undefined;
		this.virtualizerRef.value?.removeEventListener('scroll', this.onScroll);
		this.clearScrolling.cancel();
		this.scanVisibleRangeDebounced.cancel();
		if (this.avatarErrorFlushTimer != null) {
			clearTimeout(this.avatarErrorFlushTimer);
			this.avatarErrorFlushTimer = undefined;
		}
		this.emitMoreRows.cancel();
		this.announceLoadingMore.cancel();
		this.resizeDragCleanup?.();
		this.resizeDragCleanup = undefined;
		// Tear down any in-flight column-reorder drag (window listeners, rAF, pointer capture, cursor) so
		// it can't leak onto a detached instance.
		if (this.columnDrag != null) {
			this.endColumnDrag();
		}
		this.unpinRefPill();
		// Tear down the click-pin dismiss listener (a `document` capture listener) so it can't leak onto a
		// detached instance. Do this directly rather than via `clearPinnedRef()`, which would also queue a
		// double-rAF reconcile against the disconnected element.
		if (this.pinnedRefDismiss != null) {
			document.removeEventListener('pointerdown', this.pinnedRefDismiss, true);
			this.pinnedRefDismiss = undefined;
		}
		this._pinnedRefKey = undefined;
		if (this.tooltipShowTimer != null) {
			clearTimeout(this.tooltipShowTimer);
			this.tooltipShowTimer = undefined;
		}
		if (this.tooltipHideTimer != null) {
			clearTimeout(this.tooltipHideTimer);
			this.tooltipHideTimer = undefined;
		}
		this.emitRowHover.cancel();
		// Cancel any scheduled rAFs so their callbacks can't run against the detached instance.
		if (this.reconcilePinnedRefPillRaf != null) {
			cancelAnimationFrame(this.reconcilePinnedRefPillRaf);
			this.reconcilePinnedRefPillRaf = null;
		}
		if (this.columnFlipRaf != null) {
			cancelAnimationFrame(this.columnFlipRaf);
			this.columnFlipRaf = null;
		}
		for (const dispose of this.providerDisposers) {
			dispose();
		}
		this.providerDisposers = [];
		for (const unsub of this.invalidateUnsubs) {
			unsub();
		}
		this.invalidateUnsubs = [];
		super.disconnectedCallback?.();
	}

	override willUpdate(changed: PropertyValues<this>): void {
		const idLength = this.config?.idLength ?? 7;

		// Hiding stashes drops stash rows from the ENGINE input, and pinning a branch changes the column
		// layout — both re-run recomputeRows, so fold them into the row-set change signal.
		const excludeStashes = this.excludeTypes?.stashes === true;
		const excludeStashesChanged = excludeStashes !== this.lastExcludeStashes;
		const pinnedChanged = this.pinnedRef !== this.lastPinnedRef;
		// Branches-visibility / hidden-ref filtering now drops commit ROWS from the engine input, so a
		// change to any of these re-runs recomputeRows (identity compare — the host ships fresh objects).
		const refVisibilityChanged =
			this.includeOnlyRefs !== this.lastIncludeOnlyRefsRef ||
			this.excludeRefs !== this.lastExcludeRefsForRows ||
			this.excludeTypes !== this.lastExcludeTypesForRows;
		const rowsChanged =
			changed.has('rows') ||
			this.rows !== this.lastRowsRef ||
			idLength !== this.lastIdLength ||
			excludeStashesChanged ||
			pinnedChanged ||
			refVisibilityChanged;
		const scopeChanged = changed.has('scope') || this.scope !== this.lastScopeRef;

		// A scope change invalidates manual fold state: those tip-shas key the PRIOR scope's segments /
		// projection, so carrying them over leaks stale expand/collapse into the new scope (and the
		// projection path silently honors a stale `manuallyExpanded` tip that collides in the new scope).
		// Reset to the new scope's defaults.
		if (scopeChanged) {
			if (this.manuallyExpanded.size > 0) {
				this.manuallyExpanded = new Set();
			}
			if (this.manuallyCollapsed.size > 0) {
				this.manuallyCollapsed = new Set();
			}
			// The click-pinned ref focus keys a ref in the PRIOR scope's rows; carrying it over dims the
			// new view against a stale chain and leaks the `document` pointerdown dismiss listener. Clear
			// it directly (the @state writes re-render; the lane re-derivation below rebuilds the ref
			// adornments with the cleared pin) and dismiss any pinned ref popover.
			if (this._pinnedRefKey != null || this.pinnedRefDismiss != null) {
				this._pinnedRefKey = undefined;
				this.refHoverChainShas = undefined;
				if (this.pinnedRefDismiss != null) {
					document.removeEventListener('pointerdown', this.pinnedRefDismiss, true);
					this.pinnedRefDismiss = undefined;
				}
				this.unpinRefPill();
			}
		}

		// Scope anchors depend on BOTH rows + scope (anchor reachability is row-membership — an
		// unreachable anchor becomes reachable once more rows page in), and MUST run before
		// recomputeRows since `syntheticChildren` feeds processCommitsAndSegments.
		if (rowsChanged || scopeChanged) {
			this.lastScopeRef = this.scope;
			this.recomputeScope();
		}

		// recomputeRows must also re-run on a scope-only change: `syntheticChildren` (just
		// refreshed by recomputeScope) feeds processCommitsAndSegments, so the wavy synthetic
		// edges + trunk/segment maps would otherwise stay stale until the next rows prop.
		if (rowsChanged || scopeChanged) {
			// New rows prop (repo swap / full reload) → drop the persistent requested-avatars dedup so this data
			// set can re-request any avatars the host never fulfilled. `failedAvatarUrls` is left untouched.
			if (this.rows !== this.lastRowsRef) {
				this.requestedAvatars.clear();
			}
			this.lastRowsRef = this.rows;
			this.lastIdLength = idLength;
			this.lastExcludeStashes = excludeStashes;
			this.lastPinnedRef = this.pinnedRef;
			this.lastIncludeOnlyRefsRef = this.includeOnlyRefs;
			this.lastExcludeRefsForRows = this.excludeRefs;
			this.lastExcludeTypesForRows = this.excludeTypes;
			this.recomputeRows(idLength);
		}

		if (changed.has('columns') || this.columns !== this.lastColumnsRef) {
			this.lastColumnsRef = this.columns;
			this.zones = mergeZones(defaultZones, columnsToZones(this.columns));
			// The host's column menu hides/shows the graph + Branches/Tags columns via a boolean `isHidden`;
			// column↔grouped is persisted separately as `grouped` (see `currentGraphColumnConfig`/
			// `buildColumnsConfig`). `isHidden` always wins. This bridge is idempotent — a local toggle
			// persists, and the host echoes back exactly what was sent, so re-applying is a no-op; it never
			// races an in-flight drag (see the width/order comment below).
			if (this.columns?.graph?.isHidden === true) {
				this.graphPlacement = 'hidden';
			} else {
				this.graphPlacement = this.columns?.graph?.grouped === true ? 'grouped' : 'column';
			}
			if (this.columns?.ref?.isHidden === true) {
				this.refsPlacement = 'hidden';
			} else if (this.columns?.ref?.grouped === false) {
				this.refsPlacement = 'column';
				this.refsHostZoneId = undefined;
			} else {
				// `grouped === undefined` is the default (grouped); a string is the captured host zone id
				// (undefined here falls back to the Message column via `refsHostIdFor`).
				this.refsPlacement = 'grouped';
				this.refsHostZoneId =
					typeof this.columns?.ref?.grouped === 'string' ? this.columns.ref.grouped : undefined;
			}
			// Persisted graph-column width/order (see `currentGraphColumnConfig`/`buildColumnsConfig` for
			// the write side). `columns.graph` is always populated once any columns push arrives — the
			// host backfills defaults in `getColumnSettings` — so this seeds the session state on first
			// load AND reconciles after our own writes round-trip. That round-trip is idempotent (the host
			// echoes back exactly what we sent), so it can't fight an in-progress local drag: a resize/
			// reorder drag never touches `this.columns` until it commits (see `onGraphResizeStart`,
			// `flushColumnDrag`), by which point the echo already matches.
			const graphColumnCfg = this.columns?.graph;
			if (graphColumnCfg != null) {
				if (graphColumnCfg.width > 0) {
					this.graphViewportWidth = graphColumnCfg.width;
				}
				if (typeof graphColumnCfg.order === 'number') {
					this.graphColumnPos = Math.max(0, Math.min(this.zones.length, graphColumnCfg.order));
				}
			}
		}

		const selectionChanged = changed.has('selectedRows') || this.selectedRows !== this.lastSelectedRowsRef;
		if (selectionChanged) {
			this.lastSelectedRowsRef = this.selectedRows;
			this.selectedShas = new Set(this.selectedRows != null ? Object.keys(this.selectedRows) : []);
		}

		if (changed.has('config') || this.config !== this.lastConfigRef) {
			this.lastConfigRef = this.config;
			this.formatDateFn = this.buildFormatDate(false);
			this.formatDateShortFn = this.buildFormatDate(true);
		}

		// Upstream metadata (ahead/behind) arrives lazily after a `gl-graph-missingrefsmetadata` request;
		// when it lands, re-resolve adornments so the split ref pills fill in their tracking stats.
		const refsMetadataChanged = this.refsMetadata !== this.lastRefsMetadataRef;
		if (refsMetadataChanged) {
			this.lastRefsMetadataRef = this.refsMetadata;
		}
		// An AUTHORITATIVE host reset invalidates the per-id request dedup. Two shapes reach us: a null/empty
		// map (repo switch, feature toggle — the store was wiped) OR a bumped reset token accompanying a
		// non-empty upstream-preserving STRIP (integration flip drops only PR/issue). Both clear the dedup so
		// previously-seen refs aren't blocked forever, then re-request now — a metadata-only reset doesn't move
		// rows/scope, so recomputeDisplayRows' request pass wouldn't otherwise run. The `type in entry` guard in
		// requestMissingRefsMetadata keeps a preserved `upstream` from re-requesting, so only dropped types refetch.
		const refsMetadataResetTokenChanged = this.refsMetadataResetToken !== this.lastRefsMetadataResetToken;
		this.lastRefsMetadataResetToken = this.refsMetadataResetToken;
		if (
			refsMetadataResetTokenChanged ||
			(refsMetadataChanged && (this.refsMetadata == null || Object.keys(this.refsMetadata).length === 0))
		) {
			this.requestedMetadata.clear();
			this.requestMissingRefsMetadata();
		}

		// Ref-visibility filters changed (identity compare — host ships a fresh object per change). The
		// head/remote/tag/by-id filtering is LABEL-ONLY, so it just re-resolves adornments + scroll
		// markers (the ref provider + computeScrollMarkers read the live exclude state). The stashes flag
		// is handled via rowsChanged above (it drops rows from the engine input).
		const excludeChanged =
			this.excludeRefs !== this.lastExcludeRefsRef || this.excludeTypes !== this.lastExcludeTypesRef;
		if (excludeChanged) {
			this.lastExcludeRefsRef = this.excludeRefs;
			this.lastExcludeTypesRef = this.excludeTypes;
		}

		// A downstreams change (tracked-upstream membership) affects both the Hide-Remote-Branches
		// exception (isRefHidden) and the `upstream` scroll marker, so it invalidates the same way an
		// exclude-filter change does.
		const downstreamsChanged = this.downstreams !== this.lastDownstreamsRef;
		this.lastDownstreamsRef = this.downstreams;

		// `showRemoteNamesOnRefs` field-level compare (see `lastShowRemoteNamesRef`) — a flip re-resolves
		// cached ref-pill labels without keying off whole-config identity.
		const showRemoteNames = this.config?.showRemoteNamesOnRefs === true;
		const showRemoteNamesChanged = showRemoteNames !== this.lastShowRemoteNamesRef;
		this.lastShowRemoteNamesRef = showRemoteNames;

		// Cache the search-matched sha set BEFORE lane derivations — the filter-mode displayRows filter
		// (applySearchFilter, reached via recomputeLaneDerivations) reads it. Rebuild ONLY when the
		// results object changes; a large search matches many shas, so recomputing the Set on every
		// update (selection, hover, …) while a search is active would be wasteful.
		const searchResultsChanged = this.searchResults !== this.lastSearchResultsRef;
		if (searchResultsChanged) {
			const sr = this.searchResults;
			this._searchMatchedShas = sr != null && 'count' in sr ? new Set(Object.keys(sr.ids ?? {})) : undefined;
		}

		// Lane derivations depend on processedRows/segments, the default-mode config, whether a search
		// is active (an active search suppresses default lane-collapse so matches inside auto-collapsed
		// lanes stay visible — see computeDefaultCollapsedSet), and the manual override sets.
		const configCollapseChanged = this.foldingDefault !== this.lastFoldingDefault;
		// Toggling folding flips effectiveCollapsed (off → empty) and the provider set, so it re-derives
		// lanes + rebuilds providers + adornments through the same paths a collapse-config change does.
		// Tracked via a last-value ref (a config-derived getter isn't a `keyof this` for `changed.has`).
		const foldingChanged = this.foldingEnabled !== this.lastFoldingEnabled;
		this.lastFoldingEnabled = this.foldingEnabled;
		// scopeChanged rebuilds processedRows/segments above, so lane derivations + displayRows
		// (and downstream providers/adornments) must re-derive from them too.
		// `searching` flips the searchActive guard that suppresses default lane-collapse (so in-lane
		// matches stay visible while results stream in), so a toggle must re-derive lanes.
		// A payload-only rows change (engine skipped — same topology) leaves every lane input
		// untouched, so it takes the light path below: just the displayRows refresh, which rebuilds
		// the payload-derived ref indexes + re-requests upstream metadata for new refs.
		const rowsPayloadOnly = rowsChanged && this.lastRowsDeltaPayloadOnly;
		const laneInputsChanged =
			(rowsChanged && !rowsPayloadOnly) ||
			scopeChanged ||
			configCollapseChanged ||
			searchResultsChanged ||
			foldingChanged ||
			changed.has('searching');
		if (laneInputsChanged) {
			this.lastFoldingDefault = this.foldingDefault;
			// Refresh the DEFAULT-collapse set only when its real inputs change. A paging append keeps
			// the frozen set: auto-folding a segment the moment its fork pages in would yank rows the
			// user is scrolling through out from under them, and a stable set is what lets the display
			// rows patch incrementally instead of re-filtering the whole graph. A RECONCILED replace
			// (fetch/new commits landing on the same graph) keeps it for the same reason — a background
			// update must not restructure the view; only genuine resets (repo swap, filter/scope/search
			// changes, fold toggles) re-derive.
			const rowsIncremental =
				rowsChanged && (this.lastRowsDeltaAppendOnly || this.lastRowsDeltaReconciled != null);
			this.recomputeLaneDerivations(
				(rowsChanged && !rowsIncremental) ||
					scopeChanged ||
					configCollapseChanged ||
					searchResultsChanged ||
					foldingChanged ||
					changed.has('searching'),
			);
		} else if (rowsPayloadOnly) {
			this.recomputeDisplayRows();
		}

		const wipChanged =
			this.workingTreeStats !== this.lastWipStatsRef || this.wipMetadataBySha !== this.lastWipMetaRef;
		if (wipChanged) {
			this.lastWipStatsRef = this.workingTreeStats;
			this.lastWipMetaRef = this.wipMetadataBySha;
			this.rebuildWipStatsProvider();
		}

		// Lane provider must rebuild when its segment maps / collapsed state change.
		const providersChanged = !this.providersRegistered || wipChanged || laneInputsChanged;
		if (providersChanged) {
			this.rebuildProviders();
		}

		// Evict cached adornments when any of their inputs changed — an O(1) clear; the visible rows
		// re-resolve as they render. Selection/avatar pushes don't affect adornment content, so they
		// skip even that. (Pin changes evict directly in togglePinnedRef/clearPinnedRef so the ref
		// provider can promote the pinned ref to the inline pill — `_pinnedRefKey` is a private
		// @state, not a `changed.has` key.)
		if (
			rowsChanged ||
			laneInputsChanged ||
			providersChanged ||
			refsMetadataChanged ||
			excludeChanged ||
			downstreamsChanged ||
			showRemoteNamesChanged
		) {
			this.invalidateAdornments();
		}

		// Scroll-rail markers: recompute only when their inputs change (rendered rows, selection,
		// search hits, or the enabled marker types) — NOT on every update, so the per-frame render
		// path stays untouched. The marker set is bounded by ref'd/matched rows, so this is cheap.
		const searchModeChanged = this.searchMode !== this.lastSearchModeRef;
		this.lastSearchModeRef = this.searchMode;
		// Filter mode re-filters displayRows when the matched set or mode changes. Lane derivation only
		// depends on query/rows/scope, so it won't have re-run for a results-arrived/mode-toggle update —
		// recompute here. MUST precede the marker recompute (markers map the RENDERED rows).
		if (!laneInputsChanged && (searchResultsChanged || searchModeChanged)) {
			this.recomputeDisplayRows();
		}

		const markerTypes = this.config?.scrollMarkerTypes;
		const markerTypesChanged = markerTypes !== this.lastScrollMarkerTypesRef;
		const baseMarkerInputsChanged =
			rowsChanged ||
			laneInputsChanged ||
			searchResultsChanged ||
			searchModeChanged ||
			markerTypesChanged ||
			excludeChanged ||
			refsMetadataChanged ||
			downstreamsChanged;
		if (baseMarkerInputsChanged || selectionChanged) {
			this.lastSearchResultsRef = this.searchResults;
			this.lastScrollMarkerTypesRef = markerTypes;
			// Selection alone patches on top of the cached base markers — no row rescan.
			this.recomputeScrollMarkers(!baseMarkerInputsChanged);
		}

		// Selection-driven lane window (grouped only): when navigation focuses a row whose OWN lane sits
		// outside the capped viewport, shift the shared offset the minimum lane-aligned amount that brings
		// it inside — BEFORE updateRenderState clamps `graphScrollX`/computes the window, so this render
		// already builds at the revealed offset.
		{
			// Key the reveal on the focused SHA, not the index: displayRows swaps (paging, folding, host
			// pushes) re-clamp/restore focusIndex without the USER navigating — an index-keyed trigger
			// would re-reveal and yank a manually h-scrolled view back to the focused lane.
			const focusedSha = this.displayRows[this.focusIndex]?.sha;
			if (focusedSha !== this.lastRevealedFocusSha) {
				this.lastRevealedFocusSha = focusedSha;
				// Debounced (trailing): key-repeat navigation moves focus freely with NO reveal work per
				// press — the window slides once, animated, when navigation pauses.
				this.revealFocusedLaneSoon();
			}
		}

		// Snapshot all render-derived state once per update (NOT in render() — lit forbids `this`
		// assignment there, and this caches the ≤6-element zones filter + the per-row RenderCtx the
		// stable `renderItem` reads). willUpdate→render is synchronous, so the snapshot is fresh.
		this.updateRenderState();
	}

	// Visible content zones: refs only shows as a column when `refsPlacement === 'column'` (else it's
	// inline at the head of the first content column). Columns are NOT hidden by container width — they
	// squeeze (solveZoneLayout shrinks the fill zone, then drains the rest to their floors), and below
	// listAutoBelow the whole graph switches to the stacked compact layout. Shared by
	// `updateRenderState` (the solve input) and `graphColumnWidth` (its zone-min budget).
	private getVisibleZones(): ZoneSpec[] {
		return this.zones.filter(z => {
			if (z.id === 'ref') return this.refsPlacement === 'column';
			return !z.hidden;
		});
	}

	// Host zone that grouped (inline) refs render on — BY ID (`refsHostZoneId`, the zone adjacent to Refs
	// captured when it was last grouped), so the [refs + host] group travels together through reorders
	// instead of jumping to whatever zone lands leftmost (the bug where dragging a column to the front
	// "stole" the refs). Falls back to the Message column, then the first visible zone, if that captured
	// neighbor is no longer visible. Undefined when refs are a column (no group). Mirrors how the graph
	// anchors to its inline host.
	private refsHostIdFor(visibleZones: readonly ZoneSpec[]): string | undefined {
		if (this.refsPlacement !== 'grouped') return undefined;
		if (this.refsHostZoneId != null && visibleZones.some(z => z.id === this.refsHostZoneId)) {
			return this.refsHostZoneId;
		}
		return visibleZones.some(z => z.id === 'message') ? 'message' : visibleZones[0]?.id;
	}

	// The zone that would capture Refs if grouped now (right neighbor, since pills render at the head of
	// the host cell so they stay visually in place; left neighbor if Refs is last). Shared by
	// `toggleRefsPlacement` (sets `refsHostZoneId` from it) and the placement-control label (names it) so
	// the two can never disagree.
	private refsGroupTargetId(visibleZones: readonly ZoneSpec[]): string | undefined {
		const refIdx = visibleZones.findIndex(z => z.id === 'ref');
		return refIdx < 0 ? undefined : (visibleZones[refIdx + 1] ?? visibleZones[refIdx - 1])?.id;
	}

	// True when the Refs column sits immediately right of the Graph column in the full zone order — here
	// "group refs" instead merges the GRAPH into the Refs zone (see `toggleRefsPlacement`), not the
	// `refsGroupTargetId` neighbor (which only walks real content zones and can't see the graph). Shared
	// by `toggleRefsPlacement` (drives the merge) and the placement-control label (keeps it honest) so the
	// two can never disagree.
	private refsGroupMergesGraph(): boolean {
		const refsFullIdx = this.zones.findIndex(z => z.id === 'ref');
		return this.graphPlacement === 'column' && refsFullIdx >= 0 && this.graphColumnPos === refsFullIdx + 1;
	}

	// Zone id → header display name (Title Case), the same text the header cell renders as its label.
	private zoneDisplayName(id: string): string {
		if (id === 'graph') return 'Graph';
		return this.zones.find(z => z.id === id)?.label ?? id;
	}

	// Host zone the GRAPH groups into (by id) — the zone its lanes render in (its visible-slot neighbor).
	// Used to ride the graph's group toggle on that cell instead of stranding it on the first column.
	// Undefined when the graph is a column or hidden (no grouped host).
	private graphHostIdFor(visibleZones: readonly ZoneSpec[]): string | undefined {
		if (this.graphPlacement !== 'grouped') return undefined;
		return visibleZones[Math.min(this.graphVisibleSlot, Math.max(0, visibleZones.length - 1))]?.id;
	}

	// Project the graph's anchor (an insert-index into the FULL ordered `this.zones`) onto the VISIBLE
	// list: the visible slot = how many visible zones precede the anchor. This is the desync fix — a
	// hidden/inlined/reordered zone to the graph's left drops out of `visibleZones`, so the count (and
	// thus the slot) adjusts automatically; the anchor itself never moves.
	private graphVisibleIndex(visibleZones: readonly ZoneSpec[]): number {
		const visibleIds = new Set(visibleZones.map(z => z.id));
		let slot = 0;
		for (let i = 0; i < this.graphColumnPos && i < this.zones.length; i++) {
			if (visibleIds.has(this.zones[i].id)) {
				slot++;
			}
		}
		return slot;
	}

	// Inverse of `graphVisibleIndex`: the anchor (full-`this.zones` insert-index) that yields a given
	// visible slot — used by drag/keyboard reorder to store the moved graph as an anchor. Anchors AFTER
	// the `slot`-th visible zone (so it survives later hide/inline of zones to its left).
	private graphAnchorForVisibleSlot(visibleZones: readonly ZoneSpec[], slot: number): number {
		return this.graphAnchorForVisibleSlotIn(this.zones, visibleZones, slot);
	}

	// As above, but against an explicit FULL zone order — so the live drag simulation can derive the
	// anchor for a tentative `zones` array before it's assigned to `this.zones`.
	private graphAnchorForVisibleSlotIn(
		zones: readonly ZoneSpec[],
		visibleZones: readonly ZoneSpec[],
		slot: number,
	): number {
		if (slot <= 0) return 0;

		const visibleIds = new Set(visibleZones.map(z => z.id));
		let seen = 0;
		for (let i = 0; i < zones.length; i++) {
			if (!visibleIds.has(zones[i].id)) continue;
			if (++seen === slot) return i + 1;
		}
		return zones.length;
	}

	// Build the cached render snapshot (filtered zones, node style, the per-row RenderCtx, the
	// active-descendant id). Runs at the end of willUpdate on every update.
	private updateRenderState(): void {
		const rows = this.displayRows;
		const avatarsSetting = this.config?.avatars ?? true;
		const nodeStyle = this.effectiveNodeStyle;
		const zones = this.getVisibleZones();
		const focusedSha = rows[this.focusIndex]?.sha;
		this._activeRowId = focusedSha != null ? `graph-row-${focusedSha}` : undefined;
		// Use the ultra-compact date form when the date column is narrow enough that the verbose
		// "N days ago" would clip (fixed-width date zone only; the flexible zone never shrinks here).
		// Compact density always uses it: line 2's date sticks (short) while the author truncates.
		const style = this.effectiveStyle;
		// Keep the fixed-size virtualizer layout's row height in sync with the density (guarded no-op
		// unless it changed; a real change reflows the layout to the new idx*rowHeight positions).
		this.fixedRowLayout.itemSize = this.rowHeight;
		// Zero-scroll column solve (expanded only — compact rows don't render zone columns): the
		// visible content zones get exact `currentWidth`s that sum to the available width. Mid-drag we
		// render the preserve-based preview instead. `width` is overwritten with the solved px so all
		// downstream render/geometry reads the rendered width (persistence still uses `this.zones`).
		const visibleZones: readonly ZoneSpec[] =
			this.dragSolvedZones != null
				? this.dragSolvedZones.map(z => ({ ...z, width: z.currentWidth ?? z.width }))
				: style === 'table' && this.containerWidth > 0
					? solveZoneLayout(zones, this.zoneTargetWidth).map(z => ({
							...z,
							width: z.currentWidth ?? z.width,
						}))
					: zones;
		const dateZone = visibleZones.find(z => z.id === 'datetime');
		const useShortDate =
			style === 'list' || (dateZone != null && !dateZone.flex && dateZone.width <= shortDateWidth);
		// Smart-scroll clamp: per-column screen x + connector opacity. Clamp the scroll offset first so
		// the map matches the scrollbar thumb. Computed over the (few) columns, recomputed each update —
		// including on scroll, which now re-renders (the virtualizer already does this for vertical scroll).
		// Only column placement h-scrolls from USER input; grouped's offset is SELECTION-driven
		// (`groupedLaneOffset` — see revealFocusedLane) and hidden pins to 0. Either way a stale
		// column-mode value can never slide the rasters out from under their pinned dots — this is the
		// structural invariant the clamp/window/scroll-var paths rely on.
		// A placement change from ANY path (host-driven column hide/restore, the refs merge special case —
		// not just togglePlacement) invalidates an in-flight reveal: its sweep/transition were recorded
		// under the other placement's geometry. Detected here so every path is covered by construction.
		if (this.graphPlacement !== this.lastRevealPlacement) {
			this.lastRevealPlacement = this.graphPlacement;
			this.cancelLaneReveal();
		}
		// Grouped clamps to the lane-ALIGNED max (see revealFocusedLane): re-clamping to the raw pixel max
		// (e.g. after a resize shrank it) would shift the lane grid to a sub-column position and leak
		// hidden-lane slivers at the left edge of narrow rows.
		this.graphScrollX =
			this.graphPlacement === 'column'
				? Math.max(0, Math.min(this.graphScrollX, this.maxGraphScrollX))
				: this.graphPlacement === 'grouped'
					? Math.max(
							0,
							Math.min(
								this.groupedLaneOffset,
								Math.floor(this.maxGraphScrollX / this.columnWidth) * this.columnWidth,
							),
						)
					: 0;
		// Lane build window for THIS render — rows bake it into their gutter SVGs (via the cache key) and
		// the clamp pass replays the same window, so build ↔ pass stay index-aligned.
		const laneWindow = this.laneWindow();
		this.renderedLaneWindow = laneWindow;
		const nodeMode: 'compact' | 'avatar' = nodeStyle === 'dots' ? 'compact' : 'avatar';
		const nodeAvatars = nodeStyle === 'avatars' ? true : nodeStyle === 'letters' ? false : avatarsSetting;
		// Open the gutter memo's render epoch: any render-global change (metrics, density, node style,
		// palette) drops the cache; an unchanged signature (vertical scroll, selection, payload swaps, AND
		// h-scroll — the gutter is now built clamp-independent, the clamp applied imperatively per frame) is
		// a no-op so rows reuse their gutter templates.
		this.gutterCache.beginEpoch(
			gutterEpochSignature({
				rowHeight: this.rowHeight,
				columnWidth: this.columnWidth,
				// Column builds the gutter at the resizable cell's viewport width, so its cache must react to a
				// graphColumnWidth change. Grouped/hidden build per-row at each row's OWN footprint (keyed in the
				// row key), NEVER at graphColumnWidth — and grouped's is `fit` (foldLane + gutterWidth), which
				// GROWS every page as maxColumn climbs. Keying it there dropped the WHOLE gutter cache on every
				// paging tick → a mass windowed-raster rebuild mid-scroll (the scroll blank-out). Pass 0 off-column
				// so the grouped cache survives paging (rows keep their templates; only the appended tail builds).
				graphColumnWidth: this.graphPlacement === 'column' ? this.graphColumnWidth : 0,
				foldLaneWidth: this.foldLaneWidth,
				singleColumn: this.singleColumn,
				placement: this.graphPlacement,
				nodeMode: nodeMode,
				nodeAvatars: nodeAvatars,
				paletteEpoch: this.gutterPaletteEpoch,
			}),
		);
		// Project the graph's anchor onto the current visible zones ONCE — rows + the header + the
		// hscrollbar all read this single derived slot (no per-row recompute, no desync).
		const graphVisSlot = this.graphVisibleIndex(visibleZones);
		this.graphVisibleSlot = graphVisSlot;
		this._renderCtx = {
			total: rows.length,
			rowHeight: this.rowHeight,
			gutterWidth: this.gutterWidth,
			columnWidth: this.columnWidth,
			zones: visibleZones,
			style: style,
			graphPlacement: this.graphPlacement,
			graphColumnPos: graphVisSlot,
			foldLaneWidth: this.foldLaneWidth,
			graphColumnWidth: this.graphColumnWidth,
			inlineGutterWidth: this.inlineGutterWidth,
			groupedShifted: this.graphPlacement === 'grouped' && this.graphScrollX > 0,
			laneOffset: this.graphScrollX,
			singleColumn: this.singleColumn,
			laneWindow: laneWindow,
			refsPlacement: this.refsPlacement,
			refsHostId: this.refsHostIdFor(zones),
			nodeMode: nodeMode,
			nodeAvatars: nodeAvatars,
			selected: this.selectedShas,
			focusedSha: focusedSha,
			anchorShas: this.scopeAnchors.anchorShas,
			focalTipShas: this.scopeAnchors.focalTipShas,
			forkPointShas: this.scopeAnchors.forkPointShas,
			mergeTargetShas: this.scopeAnchors.mergeTargetShas,
			// When the scope projection is active the view already contains only in-scope rows, so the
			// dim-in-place treatment is redundant — suppress it (the fold stubs would otherwise dim).
			inScopeShas: this.scopeProjection != null ? undefined : this.inScopeShas,
			searchMatchedShas: this._searchMatchedShas,
			searchMode: this.searchMode,
			inRefChainShas: this.refHoverChainShas,
			dimMergeCommits: this.config?.dimMergeCommits,
			showGhostRefs: this.config?.showGhostRefsOnRowHover === true,
			getAvatarUrl: this.resolveAvatarUrl,
			getAdornments: this.resolveRowAdornments,
			getCommit: this.getCommitBySha,
			onAvatarError: this.onAvatarImgError,
			formatDate: useShortDate ? this.formatDateShortFn : this.formatDateFn,
			segmentByCommit: this.segmentByCommit,
			trunkTipSha: this.trunkGhostTipSha(),
			collapsedTips: this.effectiveCollapsed,
			wipStateBySha: this.wipStateBySha,
			runningOperationByRowSha: this.runningOperationByRowSha,
			agentStatusByRowSha: this.agentStatusByRowSha,
			workingTreeStats: this.workingTreeStats,
			wipMetadataBySha: this.wipMetadataBySha,
		};
		// Horizontal-scrollbar geometry (CSSOM, so the thumb tracks scroll without extra reflow). Left
		// edge = the fixed zones before the lanes + the fold strip (matches graph-row's `graphLeadOffset`
		// so the bar lines up with the gutter viewport); width = the viewport; thumb = proportional with
		// a floor; thumb offset maps [0, max] onto the leftover track.
		// Column placement splices the graph at `graphVisSlot` (0..length) so the lead sums every preceding
		// zone; inline shares the host zone (clamped to the last zone). Clamping the column case dropped the
		// last column's width when the graph was the LAST column (band/scrollbar anchored one column short).
		const leadCount =
			this.graphPlacement === 'column'
				? Math.min(graphVisSlot, visibleZones.length)
				: Math.min(graphVisSlot, Math.max(0, visibleZones.length - 1));
		let leadOffset = 0;
		for (let i = 0; i < leadCount; i++) {
			leadOffset += visibleZones[i].width;
		}
		const viewport = Math.max(0, this.graphColumnWidth - this.foldLaneWidth);
		const content = this.gutterWidth;
		const thumb = content > 0 ? Math.max(graphHScrollMinThumbPx, (viewport * viewport) / content) : viewport;
		const travel = Math.max(0, viewport - thumb);
		const max = this.maxGraphScrollX;
		this.style.setProperty('--graph-col-left', `${leadOffset + this.foldLaneWidth}px`);
		this.style.setProperty('--graph-col-vw', `${viewport}px`);
		this.style.setProperty('--graph-hscroll-thumb', `${thumb}px`);
		this.style.setProperty('--graph-hscroll-left', `${max > 0 ? (this.graphScrollX / max) * travel : 0}px`);
		// Pass-through raster layer's h-scroll translate + edge-fade mask gates — set on the render path too so
		// freshly rendered / recycled rows position + fade their raster before the first clamp overlay pass paints.
		this.updateGutterScrollVars();
		// Right gutter the header reserves for the absolutely-positioned settings gear (matches the
		// zone-solve target so header columns end exactly where the row columns do).
		this.style.setProperty('--gl-graph-end-gutter', `${this.endGutterPx}px`);
		// Full GRAPH height (header + scroller) so the column resize-line dividers, anchored at the header
		// cells' top (the graph's top), span all the way to the bottom edge (VS Code sash look) instead of
		// stopping a header's-height short. `scrollerClientHeight` excludes the header, so add it back.
		// Use the ResizeObserver-maintained cache — reading the live `clientHeight` here would force a
		// synchronous layout on every render (`updateRenderState` runs each willUpdate); it only changes
		// on resize, which the observer already tracks.
		this.style.setProperty('--gl-graph-viewport-height', `${this.scrollerClientHeight + headerHeightPx}px`);
		// The CSS pin's two bounds, one owner each for every row's `--gutter-node-x`:
		// LEFT pins to the FIRST-LANE position (where a lane-0 dot sits at rest) — pinned dots then land
		// exactly ON the lane grid, so the at-offset lane river threads through the pinned-dot column the
		// same way a rest-state river threads through its own dots (an off-grid pin reads as a stray line
		// beside the dots). RIGHT trails by just the node clearance (radius + a hair).
		this.style.setProperty('--gutter-pin-x', `${xForColumn(0, this.columnWidth)}px`);
		this.style.setProperty('--gutter-inset', `${nodeRadiusFor(this.nodeSizingMode) + 2}px`);
	}

	// Lane BUILD window for the current scroll offset — active exactly when the clamp is (column-overflow
	// or grouped-capped, not the single-column rail); undefined otherwise so small/medium graphs (and fit/
	// hidden placements) build every lane, byte-identical to unwindowed. Depends only on scrollX + widths
	// (never vertical scroll), so scrolling down can never trigger gutter rebuilds.
	private laneWindow(): LaneWindow | undefined {
		// Same activation as the clamp table (`laneClampTable`): column-overflow OR grouped-capped; absent for
		// fit / hidden / single-column (maxGraphScrollX 0) so those build every lane, byte-identical to unwindowed.
		if (this.maxGraphScrollX <= 0) return undefined;

		return computeLaneWindow({
			maxColumn: this.maxColumn,
			columnWidth: this.columnWidth,
			viewport: this.graphLaneViewport,
			scrollX: this.graphScrollX,
			// Grouped's offset only moves via discrete selection reveals — exact window, fade-only margin.
			pinned: this.graphPlacement === 'grouped',
			sweep: this.laneRevealSweep,
		});
	}

	// Scope anchors + in-scope chain. Runs before recomputeRows (syntheticChildren is an input
	// to the engine) and emits the unreachable-anchors paging signal.
	private recomputeScope(): void {
		const anchors = computeScopeAnchors(this.rows, this.scope);
		this.scopeAnchors = anchors;
		this.inScopeShas = computeInScopeShas(this.rows, this.scope, anchors.focalTipShas, anchors.mergeTargetShas);
		this.emitUnreachableAnchors(anchors.unreachableAnchors);
	}

	// Resolve the pinned branch (gitlens.graph.pinBranchToEdge) to a loaded sha: the host-provided
	// `pinnedRef.sha` when present, else the row carrying the pinned ref's id (head or remote). Undefined
	// when nothing is pinned or the pinned ref isn't in the loaded rows.
	private resolvePinnedSha(rows: readonly GitGraphRow[]): string | undefined {
		const pin = this.pinnedRef;
		if (pin == null) return undefined;
		if (pin.sha != null && pin.sha.length > 0) return pin.sha;
		if (pin.id == null) return undefined;

		for (const r of rows) {
			if (r.heads?.some(h => h.id === pin.id) || r.remotes?.some(rm => rm.id === pin.id)) return r.sha;
		}
		return undefined;
	}

	// Client-side branches-visibility + hidden-ref row filter. A commit/merge row survives iff it is
	// reachable (full parent DAG) from at least one VISIBLE ref tip; synthetic rows (WIP / stash / rebase
	// warning) are always kept and follow their own visibility rules. Returns `rows` unchanged when
	// nothing narrows the ref set (the 'all' default) so the common case stays zero-cost.
	private filterRowsByRefVisibility(rows: readonly GitGraphRow[]): readonly GitGraphRow[] {
		const includeOnly = this.includeOnlyRefs;
		const excludeRefs = this.excludeRefs;
		const includeActive = includeOnly != null && Object.keys(includeOnly).length > 0;
		const excludeActive = excludeRefs != null && Object.keys(excludeRefs).length > 0;
		const hideHeads = this.excludeTypes?.heads === true;
		const hideRemotes = this.excludeTypes?.remotes === true;
		const hideTags = this.excludeTypes?.tags === true;
		// Nothing narrows the ref set → every commit stays visible (the 'all' default). Fast path.
		if (!includeActive && !excludeActive && !hideHeads && !hideRemotes && !hideTags) return rows;

		const refVisible = (id: string | undefined, hiddenType: boolean): boolean => {
			if (hiddenType) return false;
			if (excludeActive && id != null && excludeRefs[id] != null) return false;
			// Include-only modes require the ref to be listed; otherwise any non-excluded ref counts.
			return includeActive ? id != null && includeOnly[id] != null : true;
		};

		const visibleTips: Sha[] = [];
		for (const row of rows) {
			if (row.type !== 'commit-node' && row.type !== 'merge-node') continue;

			let visible = false;
			if (row.heads != null) {
				for (const h of row.heads) {
					// The current HEAD is never hidden — it anchors "where you are" regardless of the mode.
					if (h.isCurrentHead || refVisible(h.id, hideHeads)) {
						visible = true;
						break;
					}
				}
			}
			if (!visible && row.remotes != null) {
				for (const r of row.remotes) {
					if (refVisible(r.id, hideRemotes)) {
						visible = true;
						break;
					}
				}
			}
			if (!visible && row.tags != null) {
				for (const t of row.tags) {
					if (refVisible(t.id, hideTags)) {
						visible = true;
						break;
					}
				}
			}
			if (visible) {
				visibleTips.push(row.sha);
			}
		}

		const reachable = collectReachable(rows, visibleTips);
		return rows.filter(r => (r.type === 'commit-node' || r.type === 'merge-node' ? reachable.has(r.sha) : true));
	}

	private recomputeRows(idLength: number): void {
		const rows = this.rows;
		if (rows == null || rows.length === 0) {
			this._engineResume = undefined;
			this._priorEngineSourceRows = undefined;
			this.commits = [];
			this.processedRows = [];
			this.segments = [];
			this.unloadedColumns = new Map();
			this.headSha = undefined;
			this.trunkSegmentTip = undefined;
			this.segmentByCommit = new Map();
			this.lastIndexedSegmentByTip.clear();
			this.wipAnchorShas = new Set();
			this.workdirShas = new Set();
			this.wipSegmentTips = new Set();
			this.pinnedSha = undefined;
			return;
		}

		// `excludeTypes.stashes` hides stash ROWS (not just a label) — drop them from the engine input so
		// the layout + edges thread without them (no dangling lanes), matching the legacy engine.
		const stashFiltered = this.excludeTypes?.stashes === true ? rows.filter(r => r.type !== 'stash-node') : rows;
		// Branches-visibility (Current/Smart/Favorited) + hidden-ref filtering: drop commit rows not
		// reachable from any visible ref tip so hidden branches' commits AND lanes disappear, not just
		// their pills. Threads through the engine over the reduced set (no orphaned lane reservations).
		const sourceRows = this.filterRowsByRefVisibility(stashFiltered);
		const synthetic = this.scopeAnchors.syntheticChildren;
		// Pin the branch (gitlens.graph.pinBranchToEdge) to the leftmost lane(s) via the engine's
		// `pinnedShas`. Resolved here so the jump-pill target + the layout share one source.
		const pinnedSha = this.resolvePinnedSha(sourceRows);
		this.pinnedSha = pinnedSha;

		// Classify the change against the prior ENGINE INPUT (post-filter source rows). The compared
		// fields (sha/parents/type/date) are exactly what feeds the layout, so `append`/`payload` can't
		// false-positive into a stale graph. Append resumes the engine snapshot and processes ONLY the
		// new tail — O(page) instead of O(total). Scope (synthetic edges) and pin runs can't seed a
		// later plain resume, so those always take the full path (`_engineResume` is only kept for
		// plain runs, which also blocks resuming FROM a scoped/pinned run).
		const resumable = synthetic == null && pinnedSha == null && idLength === this._priorEngineIdLength;
		const prior = this._priorEngineSourceRows;
		const priorCommits = this.commits;
		const delta = classifyRowsDelta(prior, sourceRows);
		this.lastRowsDeltaPayloadOnly = false;
		this.lastRowsDeltaAppendOnly = false;
		this.lastRowsDeltaReconciled = undefined;

		// Payload-only change (same topology, fresh objects — a ref moved, WIP metadata refreshed):
		// the engine output is provably unchanged, so skip it and swap ONLY the payload plane. The two
		// payload-DERIVED topology anchors — headSha (the HEAD flag rides on refs) and the trunk it
		// selects — are recomputed first; if the trunk moved (clean-tree checkout), the segment maps'
		// trunk exclusion changes, so fall through to the full path instead.
		if (resumable && this._engineResume != null && delta.kind === 'payload') {
			const headSha = rows.find(r => r.heads?.some(h => h.isCurrentHead))?.sha;
			if (computeTrunkSegmentTip(this.segments, this.processedRows, headSha) === this.trunkSegmentTip) {
				this.headSha = headSha;
				this.commits = sourceRows.map(r => toGraphCommit(r, idLength, this.repoPath));
				this._priorEngineSourceRows = sourceRows;
				this.lastRowsDeltaPayloadOnly = true;
				return;
			}
		}

		const isAppend =
			resumable &&
			this._engineResume != null &&
			prior != null &&
			priorCommits.length === prior.length &&
			delta.kind === 'append';

		let processed: readonly ProcessedGraphRow[];
		let segments: readonly LaneSegment[];
		let unloadedColumns: ReadonlyMap<Sha, number>;
		let commits: readonly GraphCommitView[];
		if (isAppend) {
			const newCommits = sourceRows.slice(prior.length).map(r => toGraphCommit(r, idLength, this.repoPath));
			commits = [...priorCommits, ...newCommits];
			const result = processCommitsAndSegments(commits, { resume: this._engineResume });
			processed = result.rows;
			segments = result.segments;
			unloadedColumns = result.unloadedColumns;
			this._engineResume = result.resume;
		} else {
			commits = sourceRows.map(r => toGraphCommit(r, idLength, this.repoPath));
			// Sticky columns: seed the layout with the prior run's lane assignments so the unchanged
			// region reproduces its layout across a top insertion — free-column allocation is order-
			// sensitive, so without the hints a fetch/new commit reshuffles lane colors AND defeats
			// the suffix reconciliation below.
			let preferredColumns: Map<Sha, number> | undefined;
			if (delta.kind === 'replace' && this.processedRows.length > 0) {
				// PARKED lanes (column ≥ the prior run's floor) are excluded: feeding them back as
				// preferences ratchets the lane space upward on every update. They re-park
				// deterministically instead (same conflicts, same claim order).
				const parkedFloor = this._priorPreferredFloor;
				preferredColumns = new Map();
				for (const r of this.processedRows) {
					if (parkedFloor > 0 && r.column >= parkedFloor) continue;

					preferredColumns.set(r.sha, r.column);
				}
				// Below-window parents keep their reserved lanes too — their dangling stubs thread
				// through every row beneath their merge, so a shifted reservation column would break
				// the suffix convergence just as a shifted row column would.
				for (const [sha, column] of this.unloadedColumns) {
					if (parkedFloor > 0 && column >= parkedFloor) continue;

					preferredColumns.set(sha, column);
				}
			}
			// Prefix change (fetch/new commits/rebase): hand the prior rows to the engine so its edge
			// pass — the expensive half — stops at carry convergence and splices the prior row objects
			// (edges included) back in by IDENTITY. Byte-identical to a full run by construction; the
			// spans drive the collapse filter's splice and keep the frozen fold set in place. The prior
			// processed index anchors the alignment across cut/grown bottoms (fixed-count reloads).
			const result = processCommitsAndSegments(commits, {
				syntheticChildren: synthetic ?? undefined,
				pinnedShas: pinnedSha != null ? [pinnedSha] : undefined,
				preferredColumns: preferredColumns,
				reconcile:
					delta.kind === 'replace' && this.processedRows.length > 0
						? {
								priorRows: this.processedRows,
								priorIndexOfSha: sha => this.cachedProcessedIndexBySha?.get(sha),
							}
						: undefined,
			});
			processed = result.rows;
			segments = result.segments;
			unloadedColumns = result.unloadedColumns;
			// Only keep a resume for a plain (unscoped, unpinned) run — a scoped/pinned run's edge carry-over
			// carries synthetic/pinned state that can't seed a later plain append.
			this._engineResume = resumable ? result.resume : undefined;
			this.lastRowsDeltaReconciled = result.reconciled;
			this._priorPreferredFloor = result.preferredColumnFloor;
		}
		this._priorEngineSourceRows = sourceRows;
		this._priorEngineIdLength = idLength;
		this.commits = commits;
		this.lastRowsDeltaAppendOnly = isAppend;

		this.processedRows = processed;
		this.segments = segments;
		this.unloadedColumns = unloadedColumns;
		// Rows-only derivations — HEAD sha (isCurrentHead row), the trunk segment, the WIP anchor
		// sets, and the commit→tip map for the gutter hit-target. On a pure APPEND these all patch
		// from the prior values by scanning only the appended tail: the prefix can't change, the
		// filter never drops the current HEAD, and segments only extend downward — so HEAD/trunk are
		// either already known or sit in the tail, and only changed segments need re-indexing.
		const firstNew = isAppend ? prior.length : 0;
		const priorTrunk = this.trunkSegmentTip;
		if (!isAppend) {
			this.headSha = rows.find(r => r.heads?.some(h => h.isCurrentHead))?.sha;
			this.trunkSegmentTip = computeTrunkSegmentTip(segments, processed, this.headSha);
		} else if (this.headSha == null) {
			for (let i = firstNew; i < sourceRows.length; i++) {
				if (sourceRows[i].heads?.some(h => h.isCurrentHead)) {
					this.headSha = sourceRows[i].sha;
					break;
				}
			}
			this.trunkSegmentTip = computeTrunkSegmentTip(segments, processed, this.headSha);
		}
		const wipAnchorShas = isAppend ? new Set(this.wipAnchorShas) : new Set<Sha>();
		const workdirShas = isAppend ? new Set(this.workdirShas) : new Set<Sha>();
		for (let i = firstNew; i < processed.length; i++) {
			const r = processed[i];
			if (r.kind !== 'workdir') continue;

			workdirShas.add(r.sha);
			if (r.parents.length > 0) {
				wipAnchorShas.add(r.parents[0]);
			}
		}
		// Segment tips that are WIP/workdir rows — excluded from `auto` default-collapse so working
		// changes stay expanded (auto folds completed branches, not active WIP lanes). The trunk's
		// entries are excluded from `segmentByCommit`; if the trunk tip MOVED (only possible when HEAD
		// was discovered in the appended tail), the exclusions shift, so rebuild the index from scratch.
		const wipSegmentTips = isAppend ? new Set(this.wipSegmentTips) : new Set<Sha>();
		if (!isAppend || this.trunkSegmentTip !== priorTrunk) {
			this.lastIndexedSegmentByTip.clear();
			this.segmentByCommit = new Map();
		}
		for (const segment of segments) {
			if (workdirShas.has(segment.tipSha)) {
				wipSegmentTips.add(segment.tipSha);
			}

			// Reference match = this exact segment is already indexed (finalized segments keep their
			// identity across appends); only new / re-finalized (extended open) segments re-index.
			if (this.lastIndexedSegmentByTip.get(segment.tipSha) === segment) continue;

			this.lastIndexedSegmentByTip.set(segment.tipSha, segment);
			if (segment.tipSha === this.trunkSegmentTip) continue;

			for (const sha of segment.commitShas) {
				this.segmentByCommit.set(sha, segment.tipSha);
			}
		}
		this.wipAnchorShas = wipAnchorShas;
		this.workdirShas = workdirShas;
		this.wipSegmentTips = wipSegmentTips;
		// `indexBySha`/`maxColumn` are derived off `displayRows` in recomputeDisplayRows so they
		// track what's actually rendered.
	}

	// Search/config/collapse-dependent lane derivations (default-mode + manual → effectiveCollapsed,
	// segment maps), then the rendered displayRows. Rows-only inputs (headSha/trunkSegmentTip) are
	// cached by recomputeRows. Mirrors the React adapter's chain of useMemos.
	// `refreshDefaultCollapse` re-derives the default-collapse set; when false (paging appends,
	// manual fold toggles) the frozen set carries over so scrolling never auto-folds rows away.
	private recomputeLaneDerivations(refreshDefaultCollapse = false): void {
		const segments = this.segments;

		// Scope re-root: when scoped to a branch (with a fork point), project the graph down to that
		// branch's spine — the merge-target + older-history fold into expandable stubs, every other lane
		// drops. The fold maps mirror the lane-collapse maps so the same chevron adornment + toggleLane
		// path drive expand/collapse. `foldingEnabled` gates it just like ordinary folds.
		const projection = this.foldingEnabled
			? computeScopeProjection(this.processedRows, this.scope, this.scopeAnchors, this.manuallyExpanded)
			: undefined;
		this.scopeProjection = projection;
		if (projection != null) {
			this.segmentsByTipSha = projection.foldSegments;
			this.collapsedByTipSha = projection.collapsedByTipSha;
			this.hiddenCountByTipSha = projection.hiddenCountByTipSha;
			this.effectiveCollapsed = new Set(projection.collapsedByTipSha.keys());
			this.visibleJunctions = new Set();
			this.recomputeDisplayRows();
			return;
		}

		const defaultCollapsedSet = refreshDefaultCollapse
			? computeDefaultCollapsedSet({
					lanesFoldingDefault: this.foldingDefault,
					segments: segments,
					searchActive: this.searching || this._searchMatchedShas != null,
					trunkSegmentTip: this.trunkSegmentTip,
					wipTipShas: this.wipSegmentTips,
				})
			: this.lastDefaultCollapsedSet;
		this.lastDefaultCollapsedSet = defaultCollapsedSet;
		// Folding off → nothing collapses (default-collapse + manual folds are both ignored), so every
		// lane stays expanded and no chevrons/fold strip render.
		this.effectiveCollapsed = this.foldingEnabled
			? composeEffectiveCollapsed(defaultCollapsedSet, this.manuallyExpanded, this.manuallyCollapsed)
			: new Set<Sha>();

		const maps = computeSegmentMaps({
			segments: segments,
			wipAnchorShas: this.wipAnchorShas,
			trunkSegmentTip: this.trunkSegmentTip,
			effectiveCollapsed: this.effectiveCollapsed,
		});
		this.segmentsByTipSha = maps.segmentsByTipSha;
		this.collapsedByTipSha = maps.collapsedByTipSha;
		this.visibleJunctions = maps.visibleJunctions;
		this.hiddenCountByTipSha = maps.hiddenCountByTipSha;

		this.recomputeDisplayRows();
	}

	// Recompute the scroll-rail markers from the rendered rows + search/selection state. The base
	// (ref/stash/WIP/search) markers need a full pass over the rendered rows, so they're cached and
	// rebuilt only when their inputs change; a selection-only change patches on top via the display
	// index — O(selection) — so click/keyboard selection never rescans the graph.
	private recomputeScrollMarkers(selectionOnly = false): void {
		const types = this.config?.scrollMarkerTypes;
		if (types == null || types.length === 0 || this.displayRows.length === 0) {
			this.baseScrollMarkers = [];
			this.scrollMarkers = [];
			this.scrollMarkerRows = [];
			return;
		}

		const enabled = new Set(types);
		if (!selectionOnly) {
			// In filter mode every rendered row is already a match, so the search-highlight marker would
			// paint a band on the entire rail (and re-render that full-rail DOM on every paging update while
			// scrolling). Suppress it — mirrors the dim/highlight suppression in renderRowItem. Reuse the
			// matched-sha set willUpdate already built (avoids a duplicate Set alloc) in normal mode.
			const searchShas = this.searchMode === 'filter' ? undefined : this._searchMatchedShas;

			this.baseScrollMarkers = computeScrollMarkers({
				rows: this.displayRows,
				getCommit: this.getCommitBySha,
				enabled: enabled,
				searchShas: searchShas,
				excludeTypes: this.excludeTypes,
				excludeRefs: this.excludeRefs,
				downstreams: this.downstreams,
				refsMetadata: this.refsMetadata,
			});
		}

		const selection = buildSelectionScrollMarkers(this.selectedShas, this.indexBySha, enabled);
		this.scrollMarkers = selection.length > 0 ? [...this.baseScrollMarkers, ...selection] : this.baseScrollMarkers;
		this.scrollMarkerRows = groupScrollMarkersByRow(this.scrollMarkers);
	}

	// displayRows = processedRows minus rows hidden by collapsed lanes (junction-preserving,
	// edges recomputed). indexBySha/maxColumn track this rendered list.
	private recomputeDisplayRows(): void {
		// Remember which commit is focused so keyboard focus follows the same commit across a
		// collapse/expand instead of silently landing on a different row at the old index.
		const prevFocusedSha = this.displayRows[this.focusIndex]?.sha;

		// Scoped: drop everything off the focal spine (the projection's dropped set), then compact the
		// now-sparse lanes so the focal branch isn't stranded in a high column with an empty gutter.
		// Otherwise the ordinary lane-collapse path derives the dropped set from the collapsed segments.
		// This derivation depends only on the rows + collapse/scope inputs (NOT the search filter), so it's
		// memoized: a filter-search results update re-runs this method but leaves these inputs untouched.
		let collapsed = this.cachedCollapsedRows;
		if (
			collapsed == null ||
			this.processedRows !== this.lastCollapsedRowsRef ||
			this.collapsedByTipSha !== this.lastCollapsedSegmentsRef ||
			this.visibleJunctions !== this.lastCollapsedJunctionsRef ||
			this.scopeProjection !== this.lastCollapsedScopeRef
		) {
			collapsed = this.recomputeCollapsedRows();
			this.cachedCollapsedRows = collapsed;
			this.lastCollapsedRowsRef = this.processedRows;
			this.lastCollapsedSegmentsRef = this.collapsedByTipSha;
			this.lastCollapsedJunctionsRef = this.visibleJunctions;
			this.lastCollapsedScopeRef = this.scopeProjection;
		}
		this.displayRows = this.applySearchFilter(collapsed);

		// The display index re-derives proportionally to the change: unchanged rendered list (cache
		// hit + no-op filter — e.g. a payload-only refresh) → skip; identity-prefix append (paging
		// with no collapse churn — row objects are reused, so endpoint identity proves the prefix) →
		// patch only the appended range; anything else → rebuild.
		const lastIndexed = this.lastIndexedDisplayRowsRef;
		const displayRowsUnchanged = this.displayRows === lastIndexed;
		const displayRowsAppended =
			!displayRowsUnchanged &&
			lastIndexed != null &&
			lastIndexed.length > 0 &&
			this.displayRows.length > lastIndexed.length &&
			this.displayRows[0] === lastIndexed[0] &&
			this.displayRows[lastIndexed.length - 1] === lastIndexed.at(-1);
		let maxColumn = this.maxColumn;
		let indexBySha = this.indexBySha;
		if (displayRowsAppended) {
			for (let i = lastIndexed.length; i < this.displayRows.length; i++) {
				const r = this.displayRows[i];
				indexBySha.set(r.sha, i);
				const m = Math.max(r.column, r.edgeColumnMax);
				if (m > maxColumn) {
					maxColumn = m;
				}
			}
			this.lastIndexedDisplayRowsRef = this.displayRows;

			// Pipelined prefetch: a page just applied (identity-prefix append). If the last rendered range is
			// STILL within the prefetch distance of the new end, immediately request the next page instead of
			// waiting for another scroll event — so sustained scrolling keeps exactly one page in flight. The
			// wrapper's `graphState.loading` guard drops this if a request is already active or paging stopped
			// (filter-mode result set fully loaded / `hasMore` false). Suppressed under a scope projection,
			// matching the scroll trigger.
			if (
				this.scopeProjection == null &&
				this.pendingRangeLast >= this.displayRows.length - this.prefetchDistanceRows()
			) {
				this.dispatchMoreRows();
			}
		} else if (!displayRowsUnchanged) {
			maxColumn = 0;
			indexBySha = new Map<string, number>();
			for (let i = 0; i < this.displayRows.length; i++) {
				const r = this.displayRows[i];
				indexBySha.set(r.sha, i);
				const m = Math.max(r.column, r.edgeColumnMax);
				if (m > maxColumn) {
					maxColumn = m;
				}
			}
			this.lastIndexedDisplayRowsRef = this.displayRows;
		}

		// Split-pill counterpart indexes — built over the FULL processed rows (NOT just displayRows) so a
		// counterpart hidden inside a collapsed lane is still found: ahead/behind (a remote reads its
		// tracking local's id) and the jump target both resolve regardless of visibility, and the jump
		// expands the lane on demand (see jumpToRefRow). `index` is the processed-rows position (stable;
		// drives the up/down arrow). Visibility/scroll still use the displayRows-based `indexBySha`.
		// Keyed on BOTH planes: rows identity (topology) AND commits identity (payload) — the ref
		// indexes are payload-derived, so a payload-only swap (same rows, new commits) must rebuild.
		// An identity-prefix append (paging — BOTH planes reuse their prefix elements, so endpoint
		// identity proves the prefix) patches only the appended range into the same maps (consumers
		// hold live references).
		const priorIndexedRows = this.lastRefIndexRowsRef;
		const priorIndexedCommits = this.lastRefIndexCommitsRef;
		const cachedRef = this.cachedRefRowIndex;
		const cachedLocal = this.cachedLocalByUpstreamId;
		const cachedProcessedIdx = this.cachedProcessedIndexBySha;
		let refRowIndex: Map<string, { sha: string; index: number }>;
		let localByUpstreamId: Map<string, { sha: string; index: number; id?: string; name?: string }>;
		let processedIndexBySha: Map<string, number>;
		if (
			cachedRef != null &&
			cachedLocal != null &&
			cachedProcessedIdx != null &&
			this.processedRows === priorIndexedRows &&
			this.commits === priorIndexedCommits
		) {
			refRowIndex = cachedRef;
			localByUpstreamId = cachedLocal;
			processedIndexBySha = cachedProcessedIdx;
		} else if (
			cachedRef != null &&
			cachedLocal != null &&
			cachedProcessedIdx != null &&
			priorIndexedRows != null &&
			priorIndexedCommits != null &&
			priorIndexedRows.length > 0 &&
			this.processedRows.length > priorIndexedRows.length &&
			this.processedRows[0] === priorIndexedRows[0] &&
			this.processedRows[priorIndexedRows.length - 1] === priorIndexedRows.at(-1) &&
			this.commits.length === this.processedRows.length &&
			this.commits[0] === priorIndexedCommits[0] &&
			this.commits[priorIndexedCommits.length - 1] === priorIndexedCommits.at(-1)
		) {
			refRowIndex = cachedRef;
			localByUpstreamId = cachedLocal;
			processedIndexBySha = cachedProcessedIdx;
			for (let i = priorIndexedRows.length; i < this.processedRows.length; i++) {
				this.indexRowRefs(i, refRowIndex, localByUpstreamId, processedIndexBySha);
			}
			this.lastRefIndexRowsRef = this.processedRows;
			this.lastRefIndexCommitsRef = this.commits;
		} else {
			refRowIndex = new Map<string, { sha: string; index: number }>();
			localByUpstreamId = new Map<string, { sha: string; index: number; id?: string; name?: string }>();
			processedIndexBySha = new Map<string, number>();
			for (let i = 0; i < this.processedRows.length; i++) {
				this.indexRowRefs(i, refRowIndex, localByUpstreamId, processedIndexBySha);
			}
			this.cachedRefRowIndex = refRowIndex;
			this.cachedLocalByUpstreamId = localByUpstreamId;
			this.cachedProcessedIndexBySha = processedIndexBySha;
			this.lastRefIndexRowsRef = this.processedRows;
			this.lastRefIndexCommitsRef = this.commits;
		}
		this.maxColumn = maxColumn;
		this.refRowIndex = refRowIndex;
		this.localByUpstreamId = localByUpstreamId;
		this.processedIndexBySha = processedIndexBySha;

		// Restore focus to the same commit if still visible; otherwise clamp into range. (An unchanged
		// or purely-appended rendered list can't move the focused row, so those paths leave focus put.)
		if (!displayRowsUnchanged && !displayRowsAppended && prevFocusedSha != null) {
			const restored = indexBySha.get(prevFocusedSha);
			this.focusIndex = restored ?? Math.max(0, Math.min(this.focusIndex, this.displayRows.length - 1));
		}
		this.indexBySha = indexBySha;
		this.requestMissingRefsMetadata();
	}

	// The collapse-filtered row list (pre-search-filter). Scoped views and drop-set changes in the
	// already-rendered region re-filter from scratch; a pure paging append reuses the prior survivors
	// BY IDENTITY and drop/remap/edge-processes only the appended tail (the dominant page-in cost at
	// scale — cloning every survivor + re-running the edge machine over the whole graph).
	private recomputeCollapsedRows(): readonly ProcessedGraphRow[] {
		if (this.scopeProjection != null) {
			this.lastDroppedShas = undefined;
			this.lastDisplayUnloadedColumns = undefined;
			return compactColumns(
				applyDroppedRows(this.processedRows, this.scopeProjection.dropped, this.unloadedColumns),
			);
		}
		if (this.collapsedByTipSha.size === 0) {
			this.lastDroppedShas = undefined;
			this.lastDisplayUnloadedColumns = undefined;
			return this.processedRows;
		}

		const dropped = computeDroppedShas(this.collapsedByTipSha, this.visibleJunctions);
		const result =
			this.tryAppendCollapsedRows(dropped) ??
			this.tryPrefixSpliceCollapsedRows(dropped) ??
			(dropped.size === 0
				? this.processedRows
				: applyDroppedRows(this.processedRows, dropped, this.unloadedColumns));
		this.lastDroppedShas = dropped;
		this.lastDisplayUnloadedColumns = this.unloadedColumns;
		return result;
	}

	// The incremental path for a PREFIX change (fetch/new commits): the engine reconciled the
	// byte-identical trailing rows back to prior identity (lastRowsDeltaReusedSuffix), so the prior
	// filter output's suffix survivors are reusable — re-filter only the reprocessed head region.
	// Undefined → the caller runs the full filter. Guards mirror tryAppendCollapsedRows.
	private tryPrefixSpliceCollapsedRows(dropped: ReadonlySet<Sha>): readonly ProcessedGraphRow[] | undefined {
		const reconciled = this.lastRowsDeltaReconciled;
		if (reconciled == null) return undefined;
		if (this.lastCollapsedScopeRef != null) return undefined;

		const priorCollapsed = this.cachedCollapsedRows;
		const priorRows = this.lastCollapsedRowsRef;
		const priorDropped = this.lastDroppedShas;
		const priorIdx = this.cachedProcessedIndexBySha;
		if (priorCollapsed == null || priorRows == null || priorDropped == null || priorIdx == null) return undefined;

		const rows = this.processedRows;
		const { reused, priorStart, nextStart } = reconciled;
		const priorSuffixEnd = priorStart + reused;

		// The definitive alignment proof: the reconciliation swapped PRIOR objects into the new
		// array, so the reused boundary must be the SAME object in both. Anything else (stale spans,
		// filter over different rows) fails here.
		if (rows[nextStart] == null || rows[nextStart] !== priorRows[priorStart]) return undefined;

		// Same collapsed tips (a changed fold set invalidates prior survivors wholesale).
		const priorTips = this.lastCollapsedSegmentsRef;
		if (priorTips == null || priorTips.size !== this.collapsedByTipSha.size) return undefined;

		for (const tip of this.collapsedByTipSha.keys()) {
			if (!priorTips.has(tip)) return undefined;
		}

		// The drop-set delta must lie OUTSIDE the reused run — a drop change inside it would
		// invalidate the reused survivors (membership or parent remaps). Cut rows (below the reused
		// run — the host's fixed-count reload trimmed them) don't matter: they're gone entirely.
		const inReusedRun = (sha: Sha): boolean => {
			const i = priorIdx.get(sha);
			return i != null && i >= priorStart && i < priorSuffixEnd;
		};
		for (const sha of dropped) {
			if (!priorDropped.has(sha) && inReusedRun(sha)) return undefined;
		}
		for (const sha of priorDropped) {
			if (!dropped.has(sha) && inReusedRun(sha)) return undefined;
		}

		// A prior below-window parent that became dropped would remap reused survivors' parents.
		const priorUnloaded = this.lastDisplayUnloadedColumns;
		if (priorUnloaded != null) {
			for (const sha of priorUnloaded.keys()) {
				if (dropped.has(sha)) return undefined;
			}
		}

		// Head/tail-region sha lookups for the remap walk; reused-run lookups ride the prior index
		// map through the alignment shift.
		const nextSuffixEnd = nextStart + reused;
		const newRegionIdx = new Map<Sha, number>();
		for (let i = 0; i < nextStart; i++) {
			newRegionIdx.set(rows[i].sha, i);
		}
		for (let i = nextSuffixEnd; i < rows.length; i++) {
			newRegionIdx.set(rows[i].sha, i);
		}
		const shift = nextStart - priorStart;
		return spliceDroppedRows({
			priorDisplayRows: priorCollapsed,
			processedRows: rows,
			suffixStartIndex: nextStart,
			suffixEndIndex: nextSuffixEnd,
			priorIndexBySha: sha => priorIdx.get(sha),
			priorSuffixStart: priorStart,
			priorSuffixEnd: priorSuffixEnd,
			dropped: dropped,
			rowBySha: sha => {
				const ni = newRegionIdx.get(sha);
				if (ni != null) return rows[ni];

				const pi = priorIdx.get(sha);
				// Only the reused range of the prior map is positionally valid in the NEW array.
				return pi != null && pi >= priorStart && pi < priorSuffixEnd ? rows[pi + shift] : undefined;
			},
			unloadedColumns: this.unloadedColumns,
		});
	}

	// The incremental path for recomputeCollapsedRows: valid only for a pure engine append whose
	// drop-set delta is confined to the appended region (see appendDroppedRows' contract). Undefined →
	// the caller runs the full filter.
	private tryAppendCollapsedRows(dropped: ReadonlySet<Sha>): readonly ProcessedGraphRow[] | undefined {
		if (!this.lastRowsDeltaAppendOnly) return undefined;
		if (this.lastCollapsedScopeRef != null) return undefined;

		const priorCollapsed = this.cachedCollapsedRows;
		const priorRows = this.lastCollapsedRowsRef;
		const priorDropped = this.lastDroppedShas;
		const priorIdx = this.cachedProcessedIndexBySha;
		if (priorCollapsed == null || priorRows == null || priorDropped == null || priorIdx == null) return undefined;

		// `processedRows` must be an identity-prefix extension of the rows the prior filter ran over.
		const firstNew = priorRows.length;
		if (firstNew === 0 || this.processedRows.length <= firstNew) return undefined;
		if (this.processedRows[0] !== priorRows[0] || this.processedRows[firstNew - 1] !== priorRows.at(-1)) {
			return undefined;
		}

		// Same collapsed tips (the frozen default set keeps this stable across appends; manual
		// toggles re-derive through the full path).
		const priorTips = this.lastCollapsedSegmentsRef;
		if (priorTips == null || priorTips.size !== this.collapsedByTipSha.size) return undefined;

		for (const tip of this.collapsedByTipSha.keys()) {
			if (!priorTips.has(tip)) return undefined;
		}

		// The drop-set delta must lie entirely in the appended region — a drop change in the already-
		// rendered region (junction appeared/vanished) invalidates prior survivors. The prior run's
		// processed index still maps the prefix (identity-shared rows), so membership below the
		// boundary is O(1) per sha.
		const inPriorRegion = (sha: Sha): boolean => {
			const i = priorIdx.get(sha);
			return i != null && i < firstNew;
		};
		for (const sha of dropped) {
			if (!priorDropped.has(sha) && inPriorRegion(sha)) return undefined;
		}
		for (const sha of priorDropped) {
			if (!dropped.has(sha) && inPriorRegion(sha)) return undefined;
		}

		// A prior row's below-window parent that paged in AND got dropped would remap that PRIOR
		// row's parents — prior unloaded reservations are exactly that parent set.
		const priorUnloaded = this.lastDisplayUnloadedColumns;
		if (priorUnloaded != null) {
			for (const sha of priorUnloaded.keys()) {
				if (dropped.has(sha)) return undefined;
			}
		}

		const rows = this.processedRows;
		const appendedIdx = new Map<Sha, number>();
		for (let i = firstNew; i < rows.length; i++) {
			appendedIdx.set(rows[i].sha, i);
		}
		return appendDroppedRows({
			priorDisplayRows: priorCollapsed,
			processedRows: rows,
			firstNewIndex: firstNew,
			dropped: dropped,
			rowBySha: sha => {
				const i = priorIdx.get(sha) ?? appendedIdx.get(sha);
				return i != null ? rows[i] : undefined;
			},
			unloadedColumns: this.unloadedColumns,
		});
	}

	// Fold row `i`'s payload refs into the split-pill indexes (shared by the full rebuild and the
	// append patch; rows/commits align by index).
	private indexRowRefs(
		i: number,
		refRowIndex: Map<string, { sha: string; index: number }>,
		localByUpstreamId: Map<string, { sha: string; index: number; id?: string; name?: string }>,
		processedIndexBySha: Map<string, number>,
	): void {
		const r = this.processedRows[i];
		processedIndexBySha.set(r.sha, i);
		const commitRefs = this.commits[i]?.commitRefs;
		if (commitRefs == null) return;

		for (const ref of commitRefs) {
			if (ref.id != null) {
				refRowIndex.set(ref.id, { sha: r.sha, index: i });
			}
			if (ref.kind === 'head' && ref.upstreamId != null) {
				// Two locals can track the same remote; prefer the CURRENT branch, else keep the first
				// seen (deterministic) so a remote pill resolves to a stable, meaningful local — not
				// whichever row happened to be processed last.
				if (ref.current === true || !localByUpstreamId.has(ref.upstreamId)) {
					localByUpstreamId.set(ref.upstreamId, { sha: r.sha, index: i, id: ref.id, name: ref.name });
				}
			}
		}
	}

	// The id the LOCAL head's upstream metadata is keyed on: a head's own id, or — for a remote — its
	// tracking local's id (the host never keys ahead/behind on a remote's own id).
	private getUpstreamMetadataId(ref: ParsedRef): string | undefined {
		if (ref.kind === 'head') return ref.id;
		if (ref.kind === 'remote' && ref.id != null) return this.localByUpstreamId.get(ref.id)?.id;
		return undefined;
	}

	// Ahead/behind for a tracked ref (undefined until the lazy upstream metadata loads). The host keys
	// the ahead/behind on the LOCAL head's id, so a remote pill resolves to its tracking local's metadata
	// and reads it from the remote's perspective (ahead/behind swapped).
	private getUpstreamStats(ref: ParsedRef): { ahead: number; behind: number } | undefined {
		const id = this.getUpstreamMetadataId(ref);
		const u = id != null ? this.refsMetadata?.[id]?.upstream : undefined;
		if (u == null) return undefined;

		return ref.kind === 'remote'
			? { ahead: u.behind ?? 0, behind: u.ahead ?? 0 }
			: { ahead: u.ahead ?? 0, behind: u.behind ?? 0 };
	}

	// Resolve a tracked ref's linked row to jump to: a head → its upstream remote's row; a remote → the
	// local that tracks it. Returns the target sha, the vertical direction relative to `fromSha`'s row,
	// and the target's display name (for the tooltip). Undefined when the counterpart is on the same row
	// (in sync) or isn't in the loaded rows.
	private resolveRefJump(
		ref: ParsedRef,
		fromSha: Sha,
	): { sha: Sha; direction: 'up' | 'down'; name?: string } | undefined {
		const fromIndex = this.processedIndexBySha.get(fromSha);
		if (fromIndex == null) return undefined;

		const target =
			ref.kind === 'head' && ref.upstreamId != null
				? this.refRowIndex.get(ref.upstreamId)
				: ref.kind === 'remote' && ref.id != null
					? this.localByUpstreamId.get(ref.id)
					: undefined;
		if (target == null || target.sha === fromSha) return undefined;

		// Reachable = visible now, OR hidden inside a lane we can expand on jump (see jumpToRefRow). A row
		// hidden by a SEARCH FILTER (not part of a lane segment) can't be revealed, so offer no jump there.
		if (!this.indexBySha.has(target.sha) && !this.segmentByCommit.has(target.sha)) return undefined;

		// Target's display name: a head jumps to its upstream remote (the upstream's name); a remote jumps
		// to the local tracking it (that local's name, carried on the reverse-map entry).
		const name = ref.kind === 'head' ? ref.upstreamName : this.localByUpstreamId.get(ref.id ?? '')?.name;
		return { sha: target.sha, direction: target.index < fromIndex ? 'up' : 'down', name: name };
	}

	// Jump button: scroll the linked row into view AND select it (opens its details).
	private jumpToRefRow(sha: Sha): void {
		// If the target is hidden inside a collapsed lane, expand that lane first so it can be revealed —
		// scrollToSha keeps the reveal PENDING and retries once the expanded row renders.
		if (!this.indexBySha.has(sha)) {
			const tip = this.segmentByCommit.get(sha);
			if (tip != null && this.effectiveCollapsed.has(tip)) {
				this.toggleLane(tip);
			}
		}
		this.scrollToSha(sha, 'center');
		this.dispatchEvent(new CustomEvent('gl-graph-changeselection', { detail: { sha: sha, mode: 'replace' } }));
	}

	// Lazily request ref metadata (ahead/behind, PRs, issues) for the tracked refs in view that don't
	// have it yet — once per (id, type) pair (no request storm; see requestedMetadata). Bounded by
	// branch count (refs are sparse across rows).
	private requestMissingRefsMetadata(): void {
		// The host drops every request while the whole feature is off (no upstream-status/hosting/issue
		// integration) — matching that here skips the round trip instead of dispatching a no-op event.
		if (this.refsMetadata === null) return;

		const wantedTypes = this.enabledRefMetadataTypes;
		if (wantedTypes == null || wantedTypes.length === 0) return;

		let missing: GraphMissingRefsMetadata | undefined;
		const want = (id: string | undefined, type: GraphRefMetadataType): void => {
			if (id == null) return;

			const entry = this.refsMetadata?.[id];
			if (entry != null && type in entry) return;

			let requested = this.requestedMetadata.get(id);
			if (requested?.has(type)) return;

			if (requested == null) {
				requested = new Set();
				this.requestedMetadata.set(id, requested);
			}
			requested.add(type);

			missing ??= {};
			(missing[id] ??= []).push(type);
		};
		for (const r of this.displayRows) {
			const commitRefs = this.getCommitBySha(r.sha)?.commitRefs;
			if (commitRefs == null) continue;

			for (const ref of commitRefs) {
				if (ref.kind === 'tag') continue;

				for (const type of wantedTypes) {
					if (type !== 'upstream') {
						// PR/issue enrichment is keyed on the ref's OWN id — the host resolves it for a remote
						// branch too (nulling whatever doesn't apply), so both head and remote ids are asked.
						want(ref.id, type);
						continue;
					}

					// Ahead/behind is keyed on the LOCAL head's id (getUpstreamStats reads a remote pill's
					// stats via its tracking local), so request only via that id — never the remote's own.
					if (ref.kind === 'head' && ref.upstreamId != null) {
						want(ref.id, 'upstream');
					} else if (ref.kind === 'remote' && ref.id != null) {
						// A visible remote pill shows ahead/behind from its tracking local's metadata — request
						// that local's id even when the local row itself is hidden inside a collapsed lane.
						want(this.localByUpstreamId.get(ref.id)?.id, 'upstream');
					}
				}
			}
		}
		if (missing != null) {
			this.dispatchEvent(new CustomEvent('gl-graph-missingrefsmetadata', { detail: missing }));
		}
	}

	// Filter mode (`searchMode === 'filter'`): keep ONLY the rows matched by the active search, rendered
	// as a flat single-column list of nodes. Lane topology isn't preserved (filter mode is a "show me
	// the hits" view, not a structural one) — so each match is flattened to column 0 with no edges,
	// avoiding the dangling lane stubs that keeping the original lane positions would leave behind.
	// Normal mode returns the rows untouched (it dims non-matches in place). No active search → untouched.
	private applySearchFilter(rows: readonly ProcessedGraphRow[]): readonly ProcessedGraphRow[] {
		if (this.searchMode !== 'filter') return rows;

		const matched = this._searchMatchedShas;
		if (matched == null) return rows;

		return rows.filter(r => matched.has(r.sha)).map(r => ({ ...r, column: 0, edges: {}, edgeColumnMax: 0 }));
	}

	// Dedupe by content so the paging signal doesn't refire every render; resets when the set
	// empties so a future unreachable set fires once more.
	private emitUnreachableAnchors(unreachable: ReadonlySet<string> | undefined): void {
		const key = unreachable != null ? [...unreachable].sort().join(',') : '';
		if (key === this.lastEmittedUnreachableKey) return;

		this.lastEmittedUnreachableKey = key;
		if (unreachable == null || unreachable.size === 0) return;

		this.dispatchEvent(new CustomEvent('gl-graph-scopeanchorsunreachable', { detail: unreachable }));
	}

	// Toggle a lane segment's collapsed state (3-set transition, mirrors React `toggleCollapse`).
	// Reads `this.effectiveCollapsed` for the current state, so it must re-derive SYNCHRONOUSLY
	// (not via the async willUpdate) — otherwise a second toggle before the next update cycle
	// would read stale `effectiveCollapsed` and repeat the same transition instead of reversing.
	private toggleLane(tipSha: string): void {
		const isCurrentlyCollapsed = this.effectiveCollapsed.has(tipSha);
		if (isCurrentlyCollapsed) {
			const expanded = new Set(this.manuallyExpanded);
			expanded.add(tipSha);
			this.manuallyExpanded = expanded;
			if (this.manuallyCollapsed.has(tipSha)) {
				const collapsed = new Set(this.manuallyCollapsed);
				collapsed.delete(tipSha);
				this.manuallyCollapsed = collapsed;
			}
		} else {
			const collapsed = new Set(this.manuallyCollapsed);
			collapsed.add(tipSha);
			this.manuallyCollapsed = collapsed;
			if (this.manuallyExpanded.has(tipSha)) {
				const expanded = new Set(this.manuallyExpanded);
				expanded.delete(tipSha);
				this.manuallyExpanded = expanded;
			}
		}

		// Anchor the viewport across the displayRows swap so a collapse/expand doesn't shift the content the
		// user is looking at — and doesn't strand it under a fixed scrollTop when the fixed-size layout
		// shrinks the spacer (the native-clamp variant). Captured against the CURRENT rows BEFORE the
		// re-derivation; resolved against the NEW rows just after. Applied in updated(); an armed reveal wins
		// (scrollToSha clears the anchor), so this never fights a jump-to-row.
		const scrollAnchor = this.captureLaneScrollAnchor();

		// Re-derive in the same order willUpdate would, so effectiveCollapsed is fresh for the
		// next toggle and the chevron/displayRows reflect the change on the next render.
		this.recomputeLaneDerivations();
		this.rebuildProviders();
		this.invalidateAdornments();
		if (scrollAnchor != null) {
			this._pendingScrollAnchorTop = this.resolveLaneScrollAnchorTop(scrollAnchor);
		}
		this.requestUpdate();
		this.dispatchEvent(new CustomEvent('gl-graph-lanetoggle', { detail: { tipSha: tipSha } }));

		// Announce the change for screen readers (the row count change is otherwise silent).
		if (isCurrentlyCollapsed) {
			this.announce('Lane expanded.');
		} else {
			const hidden = this.hiddenCountByTipSha.get(tipSha) ?? 0;
			this.announce(`Lane collapsed. ${hidden} ${hidden === 1 ? 'commit' : 'commits'} hidden.`);
		}
	}

	// Restore target (scrollTop px) captured across a lane collapse/expand, applied in updated(); see
	// captureLaneScrollAnchor / resolveLaneScrollAnchorTop / applyPendingScrollAnchor.
	private _pendingScrollAnchorTop?: number;

	// Snapshot the row pinned at the viewport's top edge BEFORE a lane collapse/expand swaps displayRows:
	// the topmost row intersecting `scrollTop` plus the pixels the viewport has scrolled INTO it. Returns
	// the OLD row list by reference (still valid after the swap reassigns `this.displayRows`) so the resolve
	// pass can walk upward for a surviving anchor if the pinned row was folded away.
	private captureLaneScrollAnchor():
		| { rows: readonly ProcessedGraphRow[]; index: number; offset: number }
		| undefined {
		const scroller = this.virtualizerRef.value;
		if (scroller == null) return undefined;

		const rows = this.displayRows;
		if (rows.length === 0) return undefined;

		const scrollTop = scroller.scrollTop;
		const index = Math.max(0, Math.min(rows.length - 1, Math.floor(scrollTop / this.rowHeight)));
		return { rows: rows, index: index, offset: scrollTop - index * this.rowHeight };
	}

	// After the swap: put the anchored row back at the same on-screen position (exact — fixed-size layout).
	// If it was folded away, pin the nearest surviving row ABOVE it to the viewport top instead.
	private resolveLaneScrollAnchorTop(anchor: {
		rows: readonly ProcessedGraphRow[];
		index: number;
		offset: number;
	}): number | undefined {
		const anchorSha = anchor.rows[anchor.index]?.sha;
		let newIndex = anchorSha != null ? this.indexBySha.get(anchorSha) : undefined;
		let offset = anchor.offset;
		if (newIndex == null) {
			for (let i = anchor.index - 1; i >= 0; i--) {
				const survivor = this.indexBySha.get(anchor.rows[i].sha);
				if (survivor != null) {
					newIndex = survivor;
					offset = 0;
					break;
				}
			}
		}
		if (newIndex == null) return undefined;
		return Math.max(0, newIndex * this.rowHeight + offset);
	}

	// Re-assert the captured scroll position after a lane collapse/expand re-renders. Runs in updated(),
	// which fires BEFORE the child virtualizer resizes its spacer: for a COLLAPSE the list shrinks, so the
	// (smaller) target lands within the still-larger spacer and holds flush against the swap with no paint in
	// between (all microtasks) — no flicker. A near-bottom collapse may then be re-clamped by the browser as
	// the spacer shrinks (unavoidable — too few rows below to hold the position); that is the best-preserved
	// result. Expanding a lane ABOVE the viewport (rare — keyboard-only, its chevron is off-screen) can be
	// clamped short here since the spacer hasn't grown yet; the common expand-in-view case anchors exactly.
	private applyPendingScrollAnchor(): void {
		const target = this._pendingScrollAnchorTop;
		if (target == null) return;

		this._pendingScrollAnchorTop = undefined;

		// A deliberate reveal wins (scrollToSha also clears this) — don't fight a jump-to-row.
		if (this._pendingRevealSha != null) return;

		const scroller = this.virtualizerRef.value;
		if (scroller == null) return;

		if (scroller.scrollTop !== target) {
			scroller.scrollTop = target;
		}
	}

	// Visually-hidden polite live region for screen-reader announcements (lane collapse, paging).
	// Written via the cached element ref (CSSOM textContent — no host re-render).
	private liveRef = createRef<HTMLElement>();
	private announce(message: string): void {
		const el = this.liveRef.value;
		if (el != null) {
			el.textContent = message;
		}
	}

	// Shared delegated tooltip: ONE <gl-popover trigger="manual"> retargeted per hover instead of a
	// tooltip per cell — rows carry a plain `data-tooltip` string and the host anchors + shows the
	// single popover. Keeps the rich GitLens tooltip styling without adding a tooltip to every row.
	private tooltipPopoverRef = createRef<GlPopover>();
	@state() private tooltipAnchor?: HTMLElement;
	// Open state is DECOUPLED from the anchor: on hide we flip `tooltipOpen` to false but KEEP the anchor
	// until the close settles. Nulling the anchor while still open made the popover reposition to the
	// webview's top-left corner (no reference) as it animated out — especially the jump tooltip, whose
	// anchor (the expand overlay's copy) loses its layout box the instant the pill un-hovers.
	@state() private tooltipOpen = false;
	@state() private tooltipText = '';
	@state() private tooltipIcon = '';
	// Ordered icon+label list for multi-marker tooltips (a scroll-rail row band). Mutually exclusive
	// with the scalar text/icon path: whichever a show* call sets, it clears the other.
	@state() private tooltipEntries: readonly { icon: string; label: string }[] = [];
	// Rich tooltip body (a template) — for tooltips that need an INLINE icon mid-text (e.g. the split
	// pill's "Jump to ☁ origin/main"), which the scalar leading-icon path can't express. Mutually
	// exclusive with the text/icon and entries paths.
	@state() private tooltipContent?: TemplateResult;
	@state() private tooltipPlacement: 'top' | 'left' = 'top';
	// Index of the scroll-marker row nearest the cursor (drives `.is-hovered` → primary expand).
	@state() private hoveredMarkerIndex?: number;
	private tooltipShowTimer?: ReturnType<typeof setTimeout>;
	private tooltipHideTimer?: ReturnType<typeof setTimeout>;

	// Full-row rich hover: the host detects row entry via delegated pointer events and emits
	// decoupled `gl-graph-rowhover*` events; the wrapper translates them into the existing GraphHover
	// pipeline (GetRowHoverRequest → markdown card). Debounced to match the legacy 250ms open delay.
	private hoveredRowSha?: string;
	private readonly emitRowHover = debounce(
		(detail: { sha: string; clientX: number; currentTarget: HTMLElement }): void => {
			this.dispatchEvent(new CustomEvent('gl-graph-rowhover', { detail: detail }));
		},
		250,
	);

	private readonly onPointerOverTooltip = (event: PointerEvent): void => {
		// No hovers/tooltips while a column resize is in progress — the pointer sweeps over the graph
		// as the user drags the header handle, and flickering tooltips/row cards would be distracting.
		if (this.draggingColumn) return;

		const target = this.closestTooltipTarget(event.target);
		// Row entry → rich hover (only when NOT over a small affordance with its own tooltip, and
		// not over a ref pill, which has its own popover). Keeps tooltip + rich hover exclusive.
		if (target == null) {
			this.handleRowHover(event);
			this.scheduleHideTooltip();
			return;
		}

		// Over a tooltip affordance: cancel any pending/active row hover so the two never co-show.
		this.cancelRowHover();

		if (target === this.tooltipAnchor) {
			// Re-entering the same anchor (still open, or just-closed within the keep window): cancel the
			// pending hide/clear and re-open in place — content is still set, so no re-fetch/flash.
			if (this.tooltipHideTimer != null) {
				clearTimeout(this.tooltipHideTimer);
				this.tooltipHideTimer = undefined;
			}
			this.tooltipOpen = true;

			return;
		}

		// Scroll-rail row band: show ONE tooltip listing all of the row's markers, in lane order.
		const rowAttr = target.dataset.tooltipRow;
		if (rowAttr != null) {
			const row = this.scrollMarkerRows.find(r => r.index === Number(rowAttr));
			const entries =
				row?.entries.filter(e => e.label.length > 0).map(e => ({ icon: e.icon, label: e.label })) ?? [];
			if (entries.length === 0) {
				this.scheduleHideTooltip();
				return;
			}

			this.showTooltipList(target, entries, 'left', 60);
			return;
		}

		const text = target.dataset.tooltip ?? '';
		if (text.length === 0) {
			this.scheduleHideTooltip();
			return;
		}

		// Targets can opt into a side placement (e.g. the right-edge scroll markers anchor to the
		// LEFT), a leading icon (codicon name), and a faster reveal — those show near-instantly;
		// row-cell tooltips keep the longer dwell so they don't flash while scanning.
		const placement = target.dataset.tooltipPlacement === 'left' ? 'left' : 'top';
		const delay = placement === 'left' ? 60 : 280;
		const icon = target.dataset.tooltipIcon ?? '';
		// `data-tooltip-action` opts into an INLINE icon: "<action> <icon> <text>" (the glyph stands in
		// for a word — e.g. the split pill's cloud=Upstream / vm=Local). The accessible name stays in
		// the element's aria-label, which spells the word out for screen readers.
		const action = target.dataset.tooltipAction;
		if (action != null && action.length > 0 && icon.length > 0) {
			this.showTooltipContent(
				target,
				html`${action}
					<code-icon class="gl-graph__tooltip-icon" icon=${icon}></code-icon>
					${text}`,
				placement,
				delay,
			);
			return;
		}

		this.showTooltip(target, text, icon, placement, delay);
	};

	private readonly onPointerOutTooltip = (event: PointerEvent): void => {
		// Only react when the pointer actually leaves the current anchor (not when moving to a child).
		const related = event.relatedTarget;
		if (this.tooltipAnchor != null && related instanceof Node && this.tooltipAnchor.contains(related)) {
			return;
		}

		this.scheduleHideTooltip();

		// Leaving the viewport entirely → end the row hover. (The ref focus chain is click-pinned now,
		// so it deliberately persists across hover-out.)
		if (!(related instanceof Node) || !this.contains(related)) {
			this.endRowHover(related ?? null);
		}
	};

	// While a ref is pinned, a pointerdown anywhere that ISN'T a ref pill unfocuses it (click-outside
	// dismiss). Capture-phase + only active while pinned. The pill's own click is allowed through (it
	// toggles/switches via togglePinnedRef).
	private pinnedRefDismiss?: (e: PointerEvent) => void;

	// Click a ref pill → toggle "focus" on that ref: pin it expanded (`_pinnedRefKey` → `.is-pinned`)
	// + highlight its first-parent ancestry chain (`.is-inRefChain`; other rows dim). Returns the new
	// pinned state so the caller drives the branch sheet (open when pinned, close when unpinned).
	private togglePinnedRef(key: string, sha: string | null | undefined): boolean {
		if (this._pinnedRefKey === key) {
			this.clearPinnedRef();
			return false;
		}

		this._pinnedRefKey = key;
		// Highlight BOTH the pinned ref's first-parent chain AND its tracked counterpart's (a local head
		// ↔ its upstream remote, a remote ↔ the local tracking it) when the counterpart is in view, so the
		// ahead/behind divergence reads as one picture. Falls back to just the pinned ref's chain.
		this.refHoverChainShas =
			sha != null ? identifyFirstParentChain(this.processedRows, this.pinnedChainShas(key, sha)) : undefined;
		if (this.pinnedRefDismiss == null) {
			this.pinnedRefDismiss = (e: PointerEvent): void => {
				const t = e.target;
				// Don't dismiss when the press is on a ref pill OR an overflow-popover ref row (both carry
				// `data-ref-name` and toggle/switch the pin) or inside the branch sheet (its action buttons /
				// chrome) — only a press truly outside all of them untoggles.
				if (t instanceof Element && t.closest('[data-ref-name], gl-detail-sheet') != null) return;

				this.clearPinnedRef();
				// Close the branch sheet too, so the focus state stays in sync.
				this.dispatchEvent(
					new CustomEvent('gl-graph-open-branch', { detail: { open: false }, bubbles: true, composed: true }),
				);
			};
			document.addEventListener('pointerdown', this.pinnedRefDismiss, true);
		}
		// Re-render the ref pills so the newly-pinned ref is promoted to the inline pill (the ref
		// provider reads `_pinnedRefKey`); the cached adornments don't track pin state on their own.
		this.invalidateAdornments();
		// The promoted pill is a NEW element the virtualizer renders after this update — reconcile once it
		// exists so `.is-pinned` lands on it (else a secondary→primary promotion loses its highlight).
		this.scheduleReconcilePinnedRefPill();
		return true;
	}

	// Clear the click-pinned ref focus (expand + dim) and detach the dismiss listener.
	private clearPinnedRef(): void {
		this._pinnedRefKey = undefined;
		this.refHoverChainShas = undefined;
		if (this.pinnedRefDismiss != null) {
			document.removeEventListener('pointerdown', this.pinnedRefDismiss, true);
			this.pinnedRefDismiss = undefined;
		}
		// Revert the promoted inline pill back to the priority primary.
		this.invalidateAdornments();
		// Reconcile after the rows settle so `.is-pinned` is stripped from the reverted pill (same
		// virtualizer-timing reason as in `togglePinnedRef`).
		this.scheduleReconcilePinnedRefPill();
	}

	// Public entry point for the details panel: clears the click-pinned ref focus when the branch
	// sheet closes via a sheet-native path (Esc / X / scrim / Focus action) that doesn't itself touch
	// the pin. No-op when nothing is pinned — also reached by graph-initiated closes (click-outside
	// dismiss, same-pill toggle-off) round-tripping back through the panel, which must stay side-
	// effect-free here to avoid a dispatch loop.
	clearRefFocus(): void {
		if (this._pinnedRefKey == null) return;

		this.clearPinnedRef();
	}

	// The first-parent chain seeds for a pinned ref: the ref's own sha plus — for a tracked ref whose
	// counterpart is in view — the counterpart's sha (head ↔ upstream remote, remote ↔ tracking local),
	// so highlighting shows both sides of the divergence. Just `[sha]` when there's no in-view counterpart.
	private pinnedChainShas(key: string, sha: string): string[] {
		const ref = this.getCommitBySha(sha)?.commitRefs.find(
			r => refPillKey({ kind: r.kind, name: r.name, remote: r.owner }) === key,
		);
		const counterpart =
			ref?.kind === 'head' && ref.upstreamId != null
				? this.refRowIndex.get(ref.upstreamId)?.sha
				: ref?.kind === 'remote' && ref.id != null
					? this.localByUpstreamId.get(ref.id)?.sha
					: undefined;
		return counterpart != null && counterpart !== sha ? [sha, counterpart] : [sha];
	}

	// Reconcile the click-pinned expand class after each render. The pill element is recreated on
	// re-render (scroll/selection), so the imperative `.is-pinned` class can't live only on the DOM —
	// re-apply it to the pinned pill (by its UNIQUE `data-ref-key`) and strip it from any stale pill.
	// Keyed by `data-ref-key`, NOT `data-ref-name`: a local branch and the remote it tracks share a
	// name, so name-matching tagged the wrong pill (the split pill wouldn't stay expanded on click).
	private reconcilePinnedRefPill(): void {
		const key = this._pinnedRefKey;
		for (const el of this.querySelectorAll('.gl-graph__ref-pill.is-pinned')) {
			if (!(el instanceof HTMLElement) || el.dataset.refKey !== key) {
				el.classList.remove('is-pinned');
			}
		}
		if (key == null) return;

		const pinned = this.querySelector(`.gl-graph__ref-pill[data-ref-key="${CSS.escape(key)}"]`);
		pinned?.classList.add('is-pinned');
	}

	// After a pin toggle the affected row is re-rendered by the virtualizer a frame or two AFTER our
	// `updated()` reconcile runs — so when a secondary ref is promoted to the inline pill, that brand-new
	// pill doesn't exist yet when `updated()` reconciles, and `.is-pinned` never lands (the highlight is
	// lost on mouseleave). Reconcile again once the rows have settled.
	private reconcilePinnedRefPillRaf: number | null = null;
	private scheduleReconcilePinnedRefPill(): void {
		if (this.reconcilePinnedRefPillRaf != null) {
			cancelAnimationFrame(this.reconcilePinnedRefPillRaf);
		}
		this.reconcilePinnedRefPillRaf = requestAnimationFrame(() => {
			this.reconcilePinnedRefPillRaf = requestAnimationFrame(() => {
				this.reconcilePinnedRefPillRaf = null;
				this.reconcilePinnedRefPill();
			});
		});
	}

	// Emit the rich-hover lifecycle for the row under the pointer. Refs are excluded (they own the
	// ref popover); the standalone graph column is excluded (it's decorative). Mirrors the legacy
	// gl-graph: an immediate start/track pair (cancels unhover timers + tracks the minimap) then a
	// debounced hover that actually requests + shows the card.
	private handleRowHover(event: PointerEvent): void {
		const node = event.target;
		if (node instanceof Element && node.closest('[data-ref-name], .gl-graph__zone--graph') != null) {
			this.cancelRowHover();
			return;
		}

		const rowEl = node instanceof Element ? node.closest<HTMLElement>('.gl-graph__row') : null;
		const sha = rowEl?.dataset.sha;
		if (rowEl == null || sha == null) {
			this.cancelRowHover();
			return;
		}

		if (sha === this.hoveredRowSha) return;

		// Moving directly between rows (or onto an affordance and back): end the previous row's
		// hover first so its card can't linger. `rowhoverstart` below cancels the resulting unhover
		// timer in GraphHover, so the transition stays flicker-free.
		if (this.hoveredRowSha != null) {
			this.endRowHover(null);
		}

		this.hoveredRowSha = sha;
		this.dispatchEvent(new CustomEvent('gl-graph-rowhoverstart'));
		this.dispatchEvent(new CustomEvent('gl-graph-rowhovertrack', { detail: { sha: sha } }));
		this.emitRowHover({ sha: sha, clientX: event.clientX, currentTarget: rowEl });
	}

	// End any active row hover (also used when the pointer moves onto a tooltip affordance or the
	// decorative graph column, so the rich card hides instead of co-showing with the tooltip).
	private cancelRowHover(): void {
		this.endRowHover(null);
	}

	private endRowHover(relatedTarget: EventTarget | null): void {
		this.emitRowHover.cancel();
		const sha = this.hoveredRowSha;
		if (sha == null) return;

		this.hoveredRowSha = undefined;
		this.dispatchEvent(
			new CustomEvent('gl-graph-rowunhover', { detail: { sha: sha, relatedTarget: relatedTarget } }),
		);
	}

	private closestTooltipTarget(node: EventTarget | null): HTMLElement | undefined {
		if (!(node instanceof Element)) return undefined;

		// Match scalar tooltips (`data-tooltip`) AND multi-marker rail bands (`data-tooltip-row`) — the
		// band has no `data-tooltip` string, so without this it would resolve to null and the rail
		// hover would spuriously fire the row-hover card instead of the marker tooltip.
		const el = node.closest<HTMLElement>('[data-tooltip], [data-tooltip-row]');
		return el ?? undefined;
	}

	// Scalar tooltip (one icon + one text string) — used by row cells, lane-fold chips, WIP stats.
	private showTooltip(
		anchor: HTMLElement,
		text: string,
		icon: string,
		placement: 'top' | 'left',
		delay: number,
	): void {
		this.scheduleTooltip(anchor, placement, delay, () => {
			this.tooltipIcon = icon;
			this.tooltipText = text;
			this.tooltipEntries = [];
			this.tooltipContent = undefined;
		});
	}

	// Rich tooltip (a template with an inline icon). Mutually exclusive with the scalar/list paths.
	private showTooltipContent(
		anchor: HTMLElement,
		content: TemplateResult,
		placement: 'top' | 'left',
		delay: number,
	): void {
		this.scheduleTooltip(anchor, placement, delay, () => {
			this.tooltipIcon = '';
			this.tooltipText = '';
			this.tooltipEntries = [];
			this.tooltipContent = content;
		});
	}

	// List tooltip (an ordered icon+label list) — used by the scroll-rail row band to show every
	// marker on the row at once. Mutually exclusive with the scalar path (clears text/icon).
	private showTooltipList(
		anchor: HTMLElement,
		entries: readonly { icon: string; label: string }[],
		placement: 'top' | 'left',
		delay: number,
	): void {
		this.scheduleTooltip(anchor, placement, delay, () => {
			this.tooltipText = '';
			this.tooltipIcon = '';
			this.tooltipEntries = entries;
			this.tooltipContent = undefined;
		});
	}

	private scheduleTooltip(anchor: HTMLElement, placement: 'top' | 'left', delay: number, apply: () => void): void {
		if (this.tooltipHideTimer != null) {
			clearTimeout(this.tooltipHideTimer);
			this.tooltipHideTimer = undefined;
		}

		// Re-anchoring an open popover doesn't always reposition cleanly, so close-then-open on a
		// short delay — also debounces rapid passes over many cells so we don't flash per row.
		const open = (): void => {
			this.tooltipShowTimer = undefined;
			this.tooltipPlacement = placement;
			this.tooltipAnchor = anchor;
			this.tooltipOpen = true;
			apply();
		};
		// Close the current popover (keep its anchor for a clean in-place close) before reopening.
		this.tooltipOpen = false;

		if (this.tooltipShowTimer != null) {
			clearTimeout(this.tooltipShowTimer);
		}

		this.tooltipShowTimer = setTimeout(open, delay);
	}

	private scheduleHideTooltip(): void {
		if (this.tooltipShowTimer != null) {
			clearTimeout(this.tooltipShowTimer);
			this.tooltipShowTimer = undefined;
		}
		if (!this.tooltipOpen || this.tooltipHideTimer != null) return;

		// Close IMMEDIATELY (so the popover stops tracking and animates out from its current spot — not from
		// the corner once its anchor's box vanishes), but keep the anchor + content briefly so re-entering
		// the same element reopens cleanly.
		this.tooltipOpen = false;
		this.tooltipHideTimer = setTimeout(() => {
			this.tooltipHideTimer = undefined;
			this.tooltipAnchor = undefined;
			this.tooltipText = '';
			this.tooltipEntries = [];
			this.tooltipContent = undefined;
		}, 120);
	}

	private rebuildWipStatsProvider(): void {
		const out = new Map<Sha, WipStats>();
		const wts = this.workingTreeStats;
		if (wts != null) {
			out.set('work-dir-changes', {
				added: wts.added,
				modified: wts.modified,
				deleted: wts.deleted,
				renamed: wts.renamed,
			});
		}
		if (this.wipMetadataBySha != null) {
			for (const [sha, meta] of Object.entries(this.wipMetadataBySha)) {
				const s = meta?.workDirStats;
				if (s == null) continue;

				out.set(sha, {
					added: s.added,
					modified: s.modified,
					deleted: s.deleted,
					renamed: s.renamed,
					stale: meta.workDirStatsStale === true,
				});
			}
		}
		this.wipStatsProvider = createWipStatsAdornmentProvider({ statsBySha: out });

		// Derive a per-sha clean/dirty signal from the SAME stats (so primary + each secondary worktree
		// WIP row get an independent glyph). Only shas with a stats entry are added — an absent key means
		// "not loaded yet", so the node draws NO glyph (never a misleading clean check).
		const wipState = new Map<Sha, 'clean' | 'dirty'>();
		for (const [sha, s] of out) {
			const total = (s.added ?? 0) + (s.modified ?? 0) + (s.deleted ?? 0) + (s.renamed ?? 0);
			wipState.set(sha, total > 0 ? 'dirty' : 'clean');
		}
		this.wipStateBySha = wipState;
	}

	// sha→HOST row map over `this.rows`, rebuilt only when its identity changes (see `cachedRowByShaRef`).
	private getRowByShaMap(): ReadonlyMap<Sha, GitGraphRow> | undefined {
		const rows = this.rows;
		if (rows == null) return undefined;

		if (this.cachedRowByShaRef === rows) return this.cachedRowBySha;

		const map = new Map(rows.map(r => [r.sha, r]));
		this.cachedRowByShaRef = rows;
		this.cachedRowBySha = map;
		return map;
	}

	// Re-register the active providers (refs is stable; WIP rebuilds when its data changes)
	// and (re)subscribe to provider invalidation. Does not recompute — callers do that.
	private rebuildProviders(): void {
		for (const dispose of this.providerDisposers) {
			dispose();
		}
		this.providerDisposers = [];
		for (const unsub of this.invalidateUnsubs) {
			unsub();
		}
		this.invalidateUnsubs = [];

		// Rebuilt each pass: the lane provider closes over the live segment maps + collapsed set,
		// which change on rows/config/toggle. The fold chevrons write the dedicated 'fold' zone (left
		// of the lanes); refs + workdir WIP stats both write 'ref' (refs first, then WIP stats since
		// WIP rows carry no refs). The lane provider is omitted entirely when folding is disabled.
		const providers: RowAdornmentProvider<TemplateResult>[] = [];
		if (this.foldingEnabled) {
			// Built once per pass (not per tip) — `branchHintFor` needs O(1) sha lookups since it's
			// called once per collapsed-lane tip.
			const rowBySha = this.getRowByShaMap();
			this.laneCollapseProvider = createLaneCollapseAdornmentProvider({
				segmentsByTipSha: this.segmentsByTipSha,
				collapsedTips: this.effectiveCollapsed,
				hiddenCountByTipSha: this.hiddenCountByTipSha,
				branchHint: (tipSha: Sha) => branchHintFor(rowBySha, tipSha),
			});
			providers.push(this.laneCollapseProvider);
		} else {
			this.laneCollapseProvider = undefined;
		}

		providers.push(this.refsProvider);
		if (this.wipStatsProvider != null) {
			providers.push(this.wipStatsProvider);
		}

		for (const provider of providers) {
			this.providerDisposers.push(this.adornmentRegistry.register(provider));
			const target = provider.invalidate;
			if (target == null) continue;

			const handler = (e: Event): void => {
				// Honor the event's granularity: `content` with shas evicts only those rows; anything
				// else (or no shas) evicts the whole cache — still O(1) + O(visible) to repopulate.
				const detail = (e as RowAdornmentInvalidateEvent).detail;
				this.invalidateAdornments(detail?.shas);
				this.requestUpdate();
			};
			target.addEventListener(RowAdornmentInvalidateEvent.type, handler);
			this.invalidateUnsubs.push(() => target.removeEventListener(RowAdornmentInvalidateEvent.type, handler));
		}
		this.providersRegistered = true;
	}

	// Pull-through adornment resolution: adornments resolve ONLY for rows that actually render (the
	// virtualizer's visible window), cached per sha. Any input change clears the cache — O(1) — and
	// the next frame repopulates just the visible rows. This replaces the eager per-change batch,
	// which iterated every rendered row × provider and was the last O(N) cost on rows / WIP /
	// refs-metadata updates. Stable arrow so the render ctx never goes stale.
	private readonly resolveRowAdornments = (row: ProcessedGraphRow): ResolvedAdornments | null => {
		// `provideRowAdornment` is documented cheap (O(1) provider-held lookups, no scans), so it's
		// safe to call for every provider on every render — that's what lets us check `dynamic`
		// BEFORE trusting a cache hit. A row that just became dynamic (e.g. a WIP row newly carrying
		// stats) must never be served the stale non-dynamic entry a prior render cached for it.
		const contributions: { provider: RowAdornmentProvider<TemplateResult>; adornment: RowAdornment }[] = [];
		let dynamic = false;
		for (const provider of this.adornmentRegistry.list()) {
			const adornment = provider.provideRowAdornment(row);
			if (adornment == null) continue;

			contributions.push({ provider: provider, adornment: adornment });
			if (adornment.dynamic === true) {
				dynamic = true;
			}
		}

		if (!dynamic) {
			const cached = this.adornmentCache.get(row.sha);
			if (cached !== undefined) return cached;
		}

		let resolved: ResolvedAdornments | null = null;
		for (const { provider, adornment } of contributions) {
			const content = provider.resolveAdornment(row, adornment.context);
			// Async per-row content is out of scope (no current provider returns a promise).
			const syncContent = content instanceof Promise ? null : content;
			const fragment = provider.describeForA11y?.(row, adornment.context);
			if (syncContent == null && !fragment) continue;

			resolved ??= { fold: [], ref: [], message: [], label: '' };
			if (syncContent != null) {
				resolved[provider.zone ?? 'message'].push(syncContent);
			}
			if (fragment) {
				resolved.label = resolved.label ? `${resolved.label}; ${fragment}` : fragment;
			}
		}
		// A dynamic adornment resolves fresh on every call — never cached, so it can't go stale.
		if (!dynamic) {
			this.adornmentCache.set(row.sha, resolved);
		}
		return resolved;
	};

	// Theme change swapped the engine's active lane palette (graph-theme-bridge.ts) — cached ref pills
	// bake in the OLD lane color, and the gutter/`--row-lane-color` are produced at render time, so a
	// full repaint is needed. Theme changes are rare; no need to fold this into the per-update trigger
	// matrix above, a dedicated listener is simplest.
	private readonly onLanePaletteChanged = (): void => {
		this.invalidateAdornments();
		// Cached gutter SVGs bake the OLD lane hex — bump the epoch so the next render drops + rebuilds them.
		this.gutterPaletteEpoch++;
		this.requestUpdate();
	};

	// Evict cached adornments — targeted when the caller knows the affected shas (granular provider
	// invalidates), wholesale otherwise. Deliberately does NOT requestUpdate: willUpdate callers are
	// already mid-update; event handlers request their own.
	private invalidateAdornments(shas?: Iterable<string>): void {
		if (shas != null) {
			for (const sha of shas) {
				this.adornmentCache.delete(sha);
			}
		} else {
			this.adornmentCache.clear();
		}
	}

	private get effectiveStyle(): ResolvedGraphStyle {
		// The `gitlens.graph.style` setting wins when it forces a mode; `auto` (the default) switches to
		// the stacked 2-line layout only when the panel is too narrow for the columns.
		const style = this.config?.style ?? 'auto';
		if (style !== 'auto') return style;
		return this.containerWidth > 0 && this.containerWidth < listAutoBelow ? 'list' : 'table';
	}

	private get rowHeight(): number {
		return this.effectiveStyle === 'list' ? rowHeightList : rowHeightTable;
	}

	// Rows per PageUp/PageDown jump — one viewport's worth, less a row of overlap for context.
	private pageStep(): number {
		const viewportHeight = this.virtualizerRef.value?.clientHeight ?? 0;
		const rows = Math.floor(viewportHeight / this.rowHeight) - 1;
		return Math.max(1, rows);
	}

	// The lane spacing, COUPLED to the node size: clamped to the current mode's bounds so the
	// node radius (derived from this in graph-gutter) stays in [5,9] for dots / [8,11] for avatars,
	// with a 1px gap floor and a "2 nodes + 1px" spread ceiling. A user drag fixes it; otherwise the
	// auto-fit is clamped into the same range.
	private get nodeSizingMode(): 'compact' | 'avatar' {
		return this.effectiveNodeStyle === 'dots' ? 'compact' : 'avatar';
	}
	// Lane-spacing density, driven by the `gitlens.graph.lanes.density` setting (via the `config`
	// prop): 'compact' packs lanes as close as possible; 'expanded' leaves a clear gap so two
	// dots on the same row don't touch. Fixed spacing per mode (not a freeform drag). A config
	// change flows through willUpdate → updateRenderState, which re-reads columnWidth below.
	private get laneDensity(): 'expanded' | 'compact' {
		return this.config?.lanesDensity ?? 'expanded';
	}
	// Fixed lane spacing per density mode (compact = lanes nearly touch; expanded = a clear gap so
	// two dots on a row don't touch) + node mode. The graph no longer respaces on resize — the density
	// toggle picks the spacing; node size is fixed (see graph-gutter `laneSpacing` / `nodeRadiusFor`).
	private get columnWidth(): number {
		return laneSpacing(this.laneDensity, this.nodeSizingMode);
	}

	private get gutterWidth(): number {
		return gutterPadding * 2 + (this.maxColumn + 1) * this.columnWidth;
	}

	// Right gutter reserved on BOTH the header (padding) and the rows (the columns stop short of it),
	// so the settings gear has a home and the body never grows into it. Max of the scrollbar width and
	// the gear's footprint (gear only present when there's a settings menu).
	private get endGutterPx(): number {
		const scrollbar = Math.max(0, this.lastScrollbarWidth);
		// Reserve room for the header actions so columns stop short of them: the graph-style toggle (always
		// present) + the settings gear (only when there's a settings menu).
		const actions = headerSettingsGutterPx + (this.settingsContext != null ? headerSettingsGutterPx : 0);
		return Math.max(scrollbar, actions);
	}

	// Available width the content zones zero-scroll-fill (Σ currentWidth = this): the container minus the
	// right gutter (scrollbar / settings gear) and — in `column` placement — the separate graph column
	// (which keeps its own width + lane-scroll). In inline/hidden placement the graph isn't a separate
	// cell, so it's just the container minus the gutter.
	private get zoneTargetWidth(): number {
		const graphCol = this.graphPlacement === 'column' ? this.graphColumnWidth : 0;
		return Math.max(0, this.containerWidth - this.endGutterPx - graphCol);
	}

	// Width of the dedicated lane-fold strip prepended to the lanes. Non-zero only when folding is on
	// and the lanes render (column or inline placement) — `hidden` has no lanes to fold.
	private get foldLaneWidth(): number {
		return this.foldingEnabled && this.graphPlacement !== 'hidden' ? foldLaneWidthPx : 0;
	}

	// Displayed width of the graph column (the fold strip + the gutter VIEWPORT). The lanes keep their
	// fixed spacing (gutterWidth); when this viewport is narrower than the lane content, the gutter
	// clips + scrolls horizontally (graphScrollX) rather than the lanes re-spacing. Defaults to fit
	// (foldLane + full lane content); the resize handle shrinks it down to a single lane — the last
	// stretch (< 2 lanes) becomes the single-column dot rail (see `singleColumn`).
	private get graphColumnWidth(): number {
		const fit = this.foldLaneWidth + this.gutterWidth;
		// Dot-rail floor: 1.5 paddings (between the old 2-padding, too roomy, and 1-padding, dot kissing
		// the edge) so the single dot keeps a small but clear gap to the column's right edge line.
		const min = this.foldLaneWidth + gutterPadding * 1.5 + this.columnWidth;
		const floor = Math.min(min, fit);
		const want = Math.min(fit, Math.max(floor, this.graphViewportWidth ?? fit));
		if (this.graphPlacement !== 'column') return want;

		// Zero-scroll: yield to the content zones' minimums so the columns always fit without a horizontal
		// scrollbar. Capping the column below `fit` is exactly the established "lanes scroll on overflow"
		// behavior — the gutter clips + scrolls (graphScrollX) instead of the zones overflowing the row.
		let zoneMinSum = 0;
		for (const z of this.getVisibleZones()) {
			zoneMinSum += z.minWidth;
		}
		const capForZones = this.containerWidth - this.endGutterPx - zoneMinSum;
		return Math.max(floor, Math.min(want, capForZones));
	}

	// Selection-driven lane reveal: when navigation focuses a row whose OWN lane falls outside the lane
	// viewport, shift the offset the MINIMUM lane-aligned amount that brings it just inside the near edge
	// (plus the fade inset, so the dot lands fully visible — not pinned). GROUPED shifts the shared
	// `groupedLaneOffset` (its only mover — scroll input never reaches it); COLUMN shifts the same
	// `graphScrollX` the user h-scrolls, like a scroll-into-view for lanes. Lane-grid snapping keeps
	// offsets on a small set of values, so gutter builds/rasters cache across reveals. Stability rules:
	// never moves on scroll, and a focused lane already in view is a no-op — arrowing through nearby rows
	// doesn't wander the view. Trailing-debounced off focus changes (see willUpdate), so key-repeat
	// navigation costs nothing per press; the render this requests rebuilds at the revealed offset while
	// the armed `.is-lane-revealing` transition glides everything (surface, pinned dots, band origins)
	// there together — every clipped row shares the offset, so the lanes move as one.
	private readonly revealFocusedLaneSoon = debounce((): void => this.revealFocusedLane(), 200);
	private revealFocusedLane(): void {
		const placement = this.graphPlacement;
		if (placement === 'hidden' || this.singleColumn || this.maxGraphScrollX <= 0) return;

		const row = this.displayRows[this.focusIndex];
		if (row == null) return;

		const viewport = this.graphLaneViewport;
		const colW = this.columnWidth;
		if (viewport <= colW) return;

		const current = placement === 'grouped' ? this.groupedLaneOffset : this.graphScrollX;
		// The pin bounds (see `--gutter-pin-x`/`--gutter-inset`): left pins at the first-lane position,
		// right trails by the node clearance.
		const pinX = xForColumn(0, colW);
		const inset = nodeRadiusFor(this.nodeSizingMode) + 2;
		const x = xForColumn(row.column, colW);
		// Visible span for a dot at the current offset — a HALF-COLUMN tighter than the pin bounds, so the
		// reveal fires just before the dot pins (not after it sticks to the edge).
		const lo = current + pinX + colW / 2;
		const hi = current + viewport - inset - colW / 2;
		if (x >= lo && x <= hi) return;

		// Shift just past the near edge, snapped OUTWARD to the lane grid so the target lane stays inside.
		// GROUPED clamps to the lane-ALIGNED max, not the raw one: `maxGraphScrollX` (content − viewport)
		// is an arbitrary pixel count, and pinning there shifts the whole lane grid to a sub-column
		// position — a hidden lane then lands at screen x ≈ 0-few px, painting a stray vertical sliver at
		// the far left of every narrow (unfadeable) row. Column's offset is continuous anyway (h-scroll).
		const raw = x < lo ? x - pinX - colW / 2 : x - viewport + inset + colW / 2;
		const snapped = x < lo ? Math.floor(raw / colW) * colW : Math.ceil(raw / colW) * colW;
		const max = placement === 'grouped' ? Math.floor(this.maxGraphScrollX / colW) * colW : this.maxGraphScrollX;
		const next = Math.max(0, Math.min(max, snapped));
		if (next === current) return;

		if (placement === 'grouped') {
			this.groupedLaneOffset = next;
		} else {
			// updateRenderState clamps it, recomputes the window, and re-syncs the h-scrollbar thumb on
			// the render requested below.
			this.graphScrollX = next;
		}
		// The slide's sweep RANGE: everywhere the compositor translate can visually pass through. A reveal
		// RETARGETING a live slide unions with the prior sweep — the retargeted transition glides from
		// wherever the surface currently is, which can be ANYWHERE inside the old range (including outside
		// [current, next] when retargeting into the middle of it), so the whole union must stay built.
		const prior = this.laneRevealSweep;
		const sweepLo = Math.min(next, current, prior?.lo ?? current);
		const sweepHi = Math.max(next, current, prior?.hi ?? current);
		// Long-distance reveals SNAP instead of gliding: a multi-viewport slide in 180ms reads as a blur,
		// and its sweep window would make every row build lane art across the whole span — the one
		// reveal-time cost that scales with DISTANCE instead of the viewport. Checked on the UNION so
		// chained sub-timer reveals can't ratchet the span past the cap one step at a time.
		if (sweepHi - sweepLo > viewport * 3) {
			this.cancelLaneReveal();
			this.requestUpdate();
			return;
		}

		this.laneRevealSweep = { lo: sweepLo, hi: sweepHi };
		// Arm the slide BEFORE the render writes the new offset var: the surface translate, the pinned
		// node, and the band origin all consume `--graph-gutter-scroll`, so one transition class makes
		// everything glide together; a reveal landing mid-slide retargets smoothly (CSS semantics).
		this.virtualizerRef.value?.classList.add('is-lane-revealing');
		clearTimeout(this.laneRevealTimer);
		// 200ms ≈ the 180ms transition + a settle frame: clearing promptly keeps a FINISHED slide from
		// donating its origin to the next reveal's union (the ratchet) while still covering retargets that
		// land genuinely mid-flight.
		this.laneRevealTimer = setTimeout(() => {
			this.virtualizerRef.value?.classList.remove('is-lane-revealing');
			// Drop the sweep once the slide lands so it can't pin FUTURE windows wide (grouped never
			// h-scrolls, so nothing else would ever clear it there — a deep reveal would otherwise defeat
			// the pinned fade-only margin for every later row build). No render here: the next natural
			// render narrows lazily, and the gutter cache's coverage matching keeps the wide builds valid.
			this.laneRevealSweep = undefined;
		}, 200);
		this.requestUpdate();
	}

	private laneRevealTimer: ReturnType<typeof setTimeout> | undefined;
	// The offset range the in-flight reveal slide can sweep through (see computeLaneWindow's `sweep`).
	private laneRevealSweep: LaneSweep | undefined;
	// Placement the last render committed — the placement-change reveal cancel in updateRenderState.
	private lastRevealPlacement: GraphPlacement | undefined;

	// Abort an in-flight reveal slide: disarm the transition class + slide-end timer and drop the sweep
	// range. Every path that takes over the offset (manual h-scroll, placement change, resize) routes here
	// so the slide can't ease or widen anything it no longer owns.
	private cancelLaneReveal(): void {
		clearTimeout(this.laneRevealTimer);
		this.virtualizerRef.value?.classList.remove('is-lane-revealing');
		this.laneRevealSweep = undefined;
	}

	// Max inline lanes before the GROUPED gutter caps to a uniform width (extra lanes collapse to the
	// edge via the static smart-scroll clamp): at least `lanes.grouped.min`, growing up to
	// `lanes.grouped.max`% of the row width (see resolveGroupedLaneCap).
	private get inlineLaneCap(): number {
		return resolveGroupedLaneCap(
			this.containerWidth,
			this.columnWidth,
			this.config?.lanesGroupedMin ?? defaultGroupedMinLanes,
			this.config?.lanesGroupedMax ?? defaultGroupedMaxPercent,
		);
	}

	// Cap width (fold strip excluded) for GROUPED placement: the epoch-wide fit (every loaded lane, via
	// gutterWidth) ceilinged to `inlineLaneCap` lanes. Rows hug their OWN footprint up to this; only a row
	// past it clips here (built windowed + clamped), so a deep row can't shove the message arbitrarily right.
	// Also the viewport the single clamp table + build window use — every clipped row clips at this one width.
	private get inlineGutterWidth(): number {
		return Math.min(this.gutterWidth, gutterPadding * 2 + this.inlineLaneCap * this.columnWidth);
	}

	// True when the grouped gutter is capped below the full fit → the smart-scroll clamp visuals apply
	// STATICALLY at scroll offset 0 (dots past the cap pin/dim at the right edge, connectors compress +
	// fade, pass-through rasters dissolve). `singleColumn` is column-only, so grouped never trips it.
	private get inlineGutterCapped(): boolean {
		return this.graphPlacement === 'grouped' && this.inlineGutterWidth < this.gutterWidth;
	}

	// Visible lane-area width (fold strip excluded) for the active placement: the resizable column's lane
	// area in column placement, the uniform capped width in grouped, 0 when hidden (no lanes). The single
	// owner both the clamp table + build window read, so column + grouped share one viewport definition.
	private get graphLaneViewport(): number {
		if (this.graphPlacement === 'column') return Math.max(0, this.graphColumnWidth - this.foldLaneWidth);
		if (this.graphPlacement === 'grouped') return this.inlineGutterWidth;
		return 0;
	}

	// Narrowest graph column: collapse to a single dot rail (no connectors) only once the viewport is
	// down near the floor (≈ one lane). Above that the smart-scroll clamp keeps showing lanes (dots
	// stuck at the edges), so dragging narrow scrolls/clamps rather than snapping to the rail well
	// before the real minimum. gutterWidth is independent of this, so no getter cycle.
	private get singleColumn(): boolean {
		return (
			this.graphPlacement === 'column' &&
			this.graphColumnWidth - this.foldLaneWidth < gutterPadding * 2 + this.columnWidth
		);
	}

	// Max horizontal scroll offset of the gutter content within the viewport (0 when it all fits). The
	// fold strip is fixed, so only the gutter (gutterWidth) scrolls inside its viewport. Single-column
	// (dot-rail) mode + hidden placement show no lanes to scroll, so they pin to 0. Positive in column
	// placement when the lanes overflow the resizable viewport, AND in grouped placement when the uniform
	// gutter is capped — the shared value that arms the smart-scroll clamp for BOTH (grouped's offset only
	// moves via discrete selection reveals — `revealFocusedLane`; the h-scroll inputs never reach it).
	private get maxGraphScrollX(): number {
		if (this.singleColumn) return 0;

		const viewport = this.graphLaneViewport;
		if (viewport <= 0) return 0;

		return Math.max(0, this.gutterWidth - viewport);
	}

	// Apply a new horizontal scroll offset: clamp it, sync the offset var + scrollbar thumb (the
	// compositor slides the translated surfaces — no per-frame JS beyond the var write), and re-render
	// only when the offset left the built window's bucket. During a scrollbar THUMB drag the bucket
	// re-render is DEFERRED to the drag's end — the margins guarantee correct content for a full bucket
	// step, and mid-drag rebuilds were the measured hitch source.
	private applyGraphScroll(): void {
		// Manual h-scroll input (wheel/scrollbar/keys — every caller of this method) expresses an offset
		// intent: a pending focus-reveal firing afterwards would yank the view back to the focused lane,
		// and a still-armed reveal transition would ease the drag instead of tracking it 1:1.
		this.revealFocusedLaneSoon.cancel();
		this.cancelLaneReveal();
		this.graphScrollX = Math.max(0, Math.min(this.graphScrollX, this.maxGraphScrollX));
		this.updateHScrollPosition();
		// COVERAGE gate, not equality: a wider built window (e.g. the reveal's sweep span) already contains
		// everything a narrower fresh window would build — rebuilding to "shrink" it mid-gesture is the
		// measured hitch class this method exists to avoid. Only escaping the built window rebuilds.
		if (!laneWindowCovers(this.renderedLaneWindow, this.laneWindow())) {
			if (this.hScrollDragActive) {
				this.pendingWindowRender = true;
			} else {
				this.requestUpdate();
			}
		}
	}

	// True while the h-scrollbar thumb is being dragged (pointer captured) — window bucket re-renders are
	// held (`pendingWindowRender`) and flushed on release.
	private hScrollDragActive = false;
	private pendingWindowRender = false;

	// Drive the pass-through raster layer's h-scroll translate + edge-fade mask gates (one owner, called from
	// both the render path and the imperative h-scroll pass). `--graph-gutter-scroll` slides every row's raster
	// `<image>` together on h-scroll — one var write, no per-row work, no re-decode (see `.gl-graph__gutter-raster`
	// in graph.scss). `--gutter-fade-left-on`/`--gutter-fade-right-on` (0/1) gate the raster-layer edge mask so
	// mid-image lanes DISSOLVE toward the visible edges instead of hard-clipping — but NOT at an edge where
	// nothing is hidden (scrollX 0 → no left fade; scrollX max → no right fade). Active for column placement
	// (h-scrolls) AND grouped-capped (selection-driven offset — either edge can dissolve); fit/hidden gate
	// everything off so a stale offset can't slide/fade the rasters when the gutter isn't overflowing.
	private updateGutterScrollVars(): void {
		// Scrollable = the gutter overflows its viewport: column placement (h-scrolls) OR grouped-capped
		// (the raster overflows the uniform cap → the hidden edges must fade). Grouped's `scroll` is the
		// selection-driven lane offset: at 0 only the right edge dissolves; once a reveal shifts it, the
		// right-edge dissolve gate lights up. Fit / hidden gate everything off (nothing hidden either way).
		const scrollable = this.graphPlacement === 'column' || this.inlineGutterCapped;
		const scroll = scrollable ? this.graphScrollX : 0;
		const max = scrollable ? this.maxGraphScrollX : 0;
		this.style.setProperty('--graph-gutter-scroll', `${scroll}px`);
		const fadeLeft = scroll > 0;
		const fadeRight = max > 0 && scroll < max;
		this.style.setProperty('--gutter-fade-left-on', fadeLeft ? '1' : '0');
		this.style.setProperty('--gutter-fade-right-on', fadeRight ? '1' : '0');
		// A mask with fully-opaque stops is STILL a mask to the compositor — every raster layer would pay an
		// isolated offscreen group even with both fades off. Only class the virtualizer as fading when a fade
		// is genuinely active; unfaded states drop mask-image entirely so rasters composite flat.
		this.virtualizerRef.value?.classList.toggle('is-gutter-fading', fadeLeft || fadeRight);
	}

	// Sync the horizontal-scrollbar thumb offset (CSS var) + its `aria-valuenow` to the current scroll,
	// without a render — the h-scroll path skips Lit but the scrollbar must still track the position.
	private updateHScrollPosition(): void {
		const max = this.maxGraphScrollX;
		const { travel } = this.graphHScrollTravel();
		this.style.setProperty('--graph-hscroll-left', `${max > 0 ? (this.graphScrollX / max) * travel : 0}px`);
		this.updateGutterScrollVars();
		this.querySelector('.gl-graph__hscroll')?.setAttribute(
			'aria-valuenow',
			`${Math.round(Math.max(0, Math.min(this.graphScrollX, max)))}`,
		);
	}

	// Date formatter honoring `gitlens.graph.dateStyle` / `gitlens.defaultDateFormat`, falling
	// back to relative time (mirrors the React adapter). Rebuilt only when config changes. When
	// `short` is set and the effective style is relative, returns the ultra-compact form ("2d");
	// absolute styles can't meaningfully shrink a custom format, so they ignore `short`.
	private buildFormatDate(short: boolean): (date: number) => string {
		const style = this.config?.dateStyle;
		const fmt = typeof this.config?.dateFormat === 'string' ? this.config.dateFormat : undefined;
		const isRelative = style === 'relative' || (style == null && fmt == null);
		if (isRelative) {
			// Both forms come from GitLens' `fromNow` (the `short` flag picks "2d" vs "2 days ago") so the
			// narrow and wide date columns share one threshold set and can't disagree on resize.
			return short
				? (date: number): string => gitlensFromNow(new Date(date), true)
				: (date: number): string => gitlensFromNow(new Date(date));
		}
		return (date: number): string => formatGitLensDate(new Date(date), fmt ?? 'short');
	}

	// Loading / empty overlay shown over the (empty) lane area. State discrimination is deliberate to
	// avoid the sticky "No commits" cold-load trap: while `loading` OR before the host's first row push
	// (`rows === undefined`) we show a spinner, NEVER "No commits". "No commits" appears only when the
	// host has authoritatively shipped an empty array; a non-empty `rows` that filters/searches down to
	// nothing reads as "No matching commits".
	private renderStatusOverlay(): unknown {
		if (this.displayRows.length > 0) return nothing;

		if (this.loading || this.rows == null) {
			return html`<div class="gl-graph__status" role="status">
				<code-icon icon="loading" modifier="spin"></code-icon><span>Loading commits…</span>
			</div>`;
		}

		const message = this.rows.length === 0 ? 'No commits' : 'No matching commits';
		return html`<div class="gl-graph__status" role="status"><span>${message}</span></div>`;
	}

	// Filter-search results footer (mirrors the legacy graph's `renderFooter`, filter mode only — the
	// normal/highlight mode's "Load more commits…" affordance isn't ported here). A sibling BELOW the
	// viewport div (not inside the virtualizer's scroll content), so it never affects row virtualization.
	private renderSearchFooter(): TemplateResult | typeof nothing {
		if (this.searchMode !== 'filter') return nothing;

		const sr = this.searchResults;
		if (sr == null || !('count' in sr)) return nothing;

		// "No results" reads even while a background page load is in flight (matches the legacy footer) —
		// every other state needs the load settled first so the counts it reports are stable.
		if (sr.count === 0) {
			return html`<div class="gl-graph__search-footer">
				<span class="gl-graph__search-footer-message">No results found</span>
			</div>`;
		}
		if (this.loading) return nothing;

		const allLoaded = !sr.hasMore && sr.commitsLoaded.count === sr.count;
		if (allLoaded) {
			return html`<div class="gl-graph__search-footer">
				<span class="gl-graph__search-footer-message">Showing all ${pluralize('result', sr.count)}</span>
			</div>`;
		}

		return html`<div class="gl-graph__search-footer">
			<span class="gl-graph__search-footer-message"
				>Showing ${pluralize('result', sr.commitsLoaded.count)} of
				${pluralize('result', sr.count)}${sr.hasMore ? '+' : ''}</span
			><button type="button" class="gl-graph__search-footer-link" @click=${this.onLoadMoreResultsClick}>
				Load More Results…
			</button>
		</div>`;
	}

	private onLoadMoreResultsClick = (): void => {
		this.emitMoreRows();
	};

	override render(): TemplateResult {
		// All render-derived state is computed once in willUpdate (updateRenderState) and cached in
		// `_renderCtx` — render() only reads it + emits the template (no per-render derivation).
		const c = this._renderCtx;
		// A FRESH renderItem closure each render so the virtualizer re-renders visible rows when
		// per-row state changed without `items` changing (selection/focus/placement/node-style/
		// dimming/adornments). Cheap: one closure alloc; the body reads the cached _renderCtx + the
		// C-group-lean renderRow. Keeping it stable would freeze those updates on screen.
		const renderItem = (row: ProcessedGraphRow, index: number): TemplateResult => this.renderRowItem(row, index);
		// Header is always present: the full column header in expanded density; a reduced compact header
		// (graph controls + a single details cell + the settings gear) in compact, where the stacked rows
		// have no per-zone columns. In `column` placement the header reserves the graph column so it aligns.
		const header =
			c.style === 'table'
				? this.renderHeader(c.zones, c.graphPlacement === 'column' ? c.gutterWidth : 0)
				: this.renderListHeader();

		return html`
			${renderWavyFilterDefs()}
			<div
				${ref(this.viewportRef)}
				class="gl-graph__viewport scrollable${this.windowFocused === false
					? ' gl-graph--window-unfocused'
					: ''}"
				role="tree"
				aria-label="Commit graph"
				aria-multiselectable="true"
				aria-activedescendant=${this._activeRowId ?? nothing}
				tabindex="0"
				@keydown=${this.onKeydown}
				@focusin=${this.onFocusIn}
				@click=${this.onClick}
				@dblclick=${this.onDblClick}
				@contextmenu=${this.onContextMenu}
				@pointerover=${this.onPointerOverTooltip}
				@pointerout=${this.onPointerOutTooltip}
			>
				${header}
				<lit-virtualizer
					${ref(this.virtualizerRef)}
					id="gl-graph-lanes"
					class="gl-graph__virtualizer scrollable"
					scroller
					.items=${this.displayRows}
					.keyFunction=${this.rowKey}
					.layout=${this.fixedRowLayout}
					.renderItem=${renderItem}
					@rangeChanged=${this.onRangeChanged}
					@wheel=${
						// PASSIVE (see graphWheelListener) so vertical wheel scrolling never blocks on the main
						// thread. Only column placement pans the lanes with the wheel, so only attach it there
						// (and only when the lanes actually overflow).
						this.graphPlacement === 'column' && this.maxGraphScrollX > 0 ? this.graphWheelListener : nothing
					}
				></lit-virtualizer>
				${this.renderStatusOverlay()}${this.renderScrollMarkers()}${this.renderPinnedPill()}${this.renderHeadPill()}${this.renderHScrollbar()}
			</div>
			${this.renderSearchFooter()}
			<span
				${ref(this.liveRef)}
				class="gl-graph__sr-live"
				role="status"
				aria-live="polite"
				aria-atomic="true"
			></span>
			<gl-popover
				${ref(this.tooltipPopoverRef)}
				class="gl-graph__tooltip${this.tooltipEntries.length > 0 ? ' is-list' : ''}"
				trigger="manual"
				placement=${this.tooltipPlacement}
				?arrow=${this.tooltipEntries.length === 0}
				.distance=${this.tooltipEntries.length > 0 ? 4 : 6}
				.anchor=${this.tooltipAnchor}
				.open=${this.tooltipOpen}
			>
				<span slot="anchor"></span>
				<span
					slot="content"
					class="gl-graph__tooltip-content${this.tooltipEntries.length > 0 ? ' is-list' : ''}"
					>${this.tooltipContent ??
					(this.tooltipEntries.length > 0
						? this.tooltipEntries.map(
								e =>
									html`<span class="gl-graph__tooltip-row"
										>${e.icon.length > 0
											? html`<code-icon
													class="gl-graph__tooltip-icon"
													icon=${e.icon}
												></code-icon>`
											: nothing}<span>${e.label}</span></span
									>`,
							)
						: html`${this.tooltipIcon.length > 0
								? html`<code-icon class="gl-graph__tooltip-icon" icon=${this.tooltipIcon}></code-icon>`
								: nothing}${this.tooltipText}`)}</span
				>
			</gl-popover>
		`;
	}

	// Floating "Scroll to HEAD" pill (bottom-right) shown only when the current HEAD commit is off
	// screen — the arrow points toward it; clicking jumps to (centers) HEAD. Mirrors the legacy graph.
	private renderHeadPill(): TemplateResult | typeof nothing {
		const dir = this.headPillDirection;
		if (dir == null) return nothing;

		return html`<button
			class="gl-graph__head-pill"
			type="button"
			data-tooltip="Scroll to HEAD"
			aria-label="Scroll to HEAD"
			@click=${this.onHeadPillClick}
		>
			<code-icon icon=${dir === 'up' ? 'arrow-up' : 'arrow-down'}></code-icon>HEAD
		</button>`;
	}

	// Floating "Jump to Pinned Branch" pill — shown only when a branch is pinned (gitlens.graph.
	// pinBranchToEdge) AND its row is scrolled off-screen; the arrow points toward it, clicking
	// centers + selects it. Mirrors the HEAD pill (the new-engine equivalent of the legacy header
	// "Jump to Pinned Branch" zone action).
	private renderPinnedPill(): TemplateResult | typeof nothing {
		const dir = this.pinnedPillDirection;
		if (dir == null || this.pinnedSha == null) return nothing;

		const name = this.pinnedRef?.name;
		return html`<button
			class="gl-graph__head-pill gl-graph__pinned-pill"
			type="button"
			data-tooltip="Jump to Pinned Branch"
			aria-label="Jump to Pinned Branch"
			@click=${this.onPinnedPillClick}
		>
			<code-icon icon=${dir === 'up' ? 'arrow-up' : 'arrow-down'}></code-icon
			><code-icon icon="pinned"></code-icon>${name ?? 'Pinned'}
		</button>`;
	}

	// Scroll-rail markers: a thin overlay pinned to the right edge of the viewport (over the scrollbar
	// track). One full-width interactive BAND per row (placed by fraction-down-the-list, `top: N%`)
	// carries that row's lane-colored ticks as non-interactive children — so hover/click anywhere on
	// the row's y-band highlights all its markers (in lane order) + shows one tooltip listing them all,
	// and a click jumps to the row. Lets the user spot branches/tags/matches without scrolling.
	private renderScrollMarkers(): TemplateResult | typeof nothing {
		const rows = this.scrollMarkerRows;
		if (rows.length === 0) return nothing;

		// The header (now present in both densities) sits above the scroller, so offset the rail down by
		// the header height to keep tick fractions aligned with the rows below it.
		const railTop = '2.4rem';

		// Per-row pixel span on the rail (`rowPx`): the rail spans the viewport height (less the
		// header), and `topPct = index/total` maps the FULL list into it — so each row gets
		// railHeightPx / totalRowCount px. Drives each box's clamped height (matching the reference).
		const viewportPx = this.virtualizerRef.value?.clientHeight ?? 0;
		const railPx = Math.max(0, viewportPx - headerHeightPx);
		const total = this._renderCtx?.total ?? rows.length;
		const rowPx = total > 0 ? railPx / total : 0;
		// When the list DOESN'T fill the viewport (e.g. a scoped re-root with only a handful of rows),
		// `index/total` would spread the markers across the whole rail while the rows themselves cluster
		// at the top — markers end up far below their rows. In that case position each marker at its REAL
		// pixel row (rowHeight px apart); once the list overflows (rowHeight ≥ rowPx) this collapses back
		// to the index/total mapping, so scrollable graphs are unchanged.
		const rowHeight = this._renderCtx?.rowHeight ?? 0;
		const markerRowPx = rowHeight > 0 ? Math.min(rowHeight, rowPx) : rowPx;

		return html`<div
			class="gl-graph__scroll-markers"
			style=${cspStyleMap({ top: railTop })}
			@pointerdown=${this.onScrollMarkerPointerDown}
			@pointerup=${this.onScrollMarkerPointerUp}
			@pointercancel=${this.onScrollMarkerPointerCancel}
			@pointermove=${this.onScrollMarkerPointerMove}
			@pointerleave=${this.onScrollMarkerPointerLeave}
			@pointerover=${this.stopPointerOver}
		>
			${repeat(
				rows,
				// Key by the COMMIT (sha at this display index), not the index itself — across a
				// collapse/expand/filter the same index maps to a different commit, so an index key would
				// recycle a band's DOM between unrelated commits.
				row => this.displayRows[row.index]?.sha ?? row.index,
				row => {
					return html`<div
						class="gl-graph__scroll-marker-band${row.index === this.hoveredMarkerIndex
							? ' is-hovered'
							: ''}"
						data-marker-index=${row.index}
						aria-hidden="true"
						style=${cspStyleMap({ top: `${row.index * markerRowPx}px` })}
					>
						${row.entries.map((e, idx) => {
							// Block ticks fill their lane(s); fullLine/thinLine span the whole rail width as a
							// thin rule. Heights track `rowPx` (clamped), matching the reference per-shape math.
							// Block ticks are sized to rowPx MINUS a 1px gap, so adjacent rows' ticks don't
							// squish/merge (down to a 2px floor — past that the rail is too dense to gap).
							const isLine = e.shape === 'fullLine' || e.shape === 'thinLine';
							const heightPx =
								e.shape === 'fullLine'
									? clamp(0.5 * rowPx, 2, 4)
									: e.shape === 'thinLine'
										? clamp(0.25 * rowPx, 1, 2)
										: clamp(rowPx - scrollMarkerGapPx, 2, scrollMarkerMaxBlockPx);
							// Entries are priority-sorted (primary = idx 0). z-index by priority so the primary
							// draws on top where lanes overlap; on hover the primary expands to the full rail.
							return html`<span
								class="gl-graph__scroll-marker-box${idx === 0 ? ' is-primary' : ''}"
								style=${cspStyleMap({
									'--marker-left': isLine ? '0' : `${e.leftPct}%`,
									'--marker-width': isLine ? '100%' : `${e.widthPct}%`,
									'--marker-height': `${heightPx}px`,
									backgroundColor: e.color,
									zIndex: String(e.priority),
								})}
							></span>`;
						})}
					</div>`;
				},
			)}
		</div>`;
	}

	// Resolve the scroll-marker row NEAREST the cursor's y (the rail's markers merge visually when
	// dense, so per-row hit bands would overlap and be unreachable — match against the row fractions
	// instead). Returns the row only when the cursor is within a small "magnet" of it.
	private nearestScrollMarker(container: HTMLElement, clientY: number): RowMarkers | undefined {
		const rect = container.getBoundingClientRect();
		if (rect.height <= 0) return undefined;

		// Match renderScrollMarkers' positioning (real pixel row when the list doesn't fill the rail,
		// else the index/total mapping) so click-magnet hit-testing lines up with where bands actually are.
		const total = this._renderCtx?.total ?? this.scrollMarkerRows.length;
		const rowPx = total > 0 ? rect.height / total : 0;
		const rowHeight = this._renderCtx?.rowHeight ?? 0;
		const markerRowPx = rowHeight > 0 ? Math.min(rowHeight, rowPx) : rowPx;
		const clickPx = clientY - rect.top;
		let nearest: RowMarkers | undefined;
		let bestPx = Infinity;
		for (const row of this.scrollMarkerRows) {
			const px = Math.abs(row.index * markerRowPx - clickPx);
			if (px < bestPx) {
				bestPx = px;
				nearest = row;
			}
		}
		return nearest != null && bestPx <= scrollMarkerMagnetPx ? nearest : undefined;
	}

	// Active rail drag-scrub (the rail overlays the native scrollbar, so we drive scrollTop ourselves).
	// `moved` flips once travel passes the threshold — until then a release is still a click-to-jump.
	private scrollMarkerDrag?: { startY: number; startScrollTop: number; moved: boolean; pointerId: number };

	// Press on the rail → begin a potential drag-scrub. We don't scroll yet (a release without travel
	// stays a click-to-jump); pointer capture keeps the moves coming even if the cursor leaves the rail.
	private readonly onScrollMarkerPointerDown = (event: PointerEvent): void => {
		if (this.draggingColumn || event.button !== 0) return;

		const scroller = this.virtualizerRef.value;
		if (scroller == null) return;

		this.scrollMarkerDrag = {
			startY: event.clientY,
			startScrollTop: scroller.scrollTop,
			moved: false,
			pointerId: event.pointerId,
		};
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		// Prevent text selection / focus shift while dragging; the jump is handled on pointerup.
		event.preventDefault();
	};

	// End a drag-scrub. A release with NO travel is a click → jump to the nearest marker; a release
	// after travel just ends the scrub (the content already followed the cursor).
	private readonly onScrollMarkerPointerUp = (event: PointerEvent): void => {
		const drag = this.scrollMarkerDrag;
		if (drag == null) return;

		const container = event.currentTarget as HTMLElement;
		if (container.hasPointerCapture(drag.pointerId)) {
			container.releasePointerCapture(drag.pointerId);
		}
		this.scrollMarkerDrag = undefined;
		if (!drag.moved) {
			this.jumpToScrollMarker(container, event.clientY);
		}
	};

	private readonly onScrollMarkerPointerCancel = (event: PointerEvent): void => {
		const drag = this.scrollMarkerDrag;
		if (drag == null) return;

		const container = event.currentTarget as HTMLElement;
		if (container.hasPointerCapture(drag.pointerId)) {
			container.releasePointerCapture(drag.pointerId);
		}
		this.scrollMarkerDrag = undefined;
	};

	// Pointer over the rail → highlight + tooltip the nearest marker (re-shows only when it changes, so
	// sweeping doesn't re-anchor the popover every frame). While a drag is active, scrub instead.
	private readonly onScrollMarkerPointerMove = (event: PointerEvent): void => {
		if (this.draggingColumn) return;

		const container = event.currentTarget as HTMLElement;

		// Drag-scrub: dragging the full rail height scrolls the full content (matching a native thumb
		// drag's range); relative to the press point, so there's no grab-snap. The native thumb tracks
		// scrollTop, so it visually follows the drag.
		const drag = this.scrollMarkerDrag;
		if (drag != null) {
			if (!drag.moved && Math.abs(event.clientY - drag.startY) > scrollMarkerDragThresholdPx) {
				drag.moved = true;
			}
			if (drag.moved) {
				if (this.hoveredMarkerIndex != null) {
					this.hoveredMarkerIndex = undefined;
				}
				this.scheduleHideTooltip();

				const scroller = this.virtualizerRef.value;
				if (scroller == null) return;

				const rect = container.getBoundingClientRect();
				const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
				const deltaFrac = rect.height > 0 ? (event.clientY - drag.startY) / rect.height : 0;
				scroller.scrollTop = Math.max(0, Math.min(maxScroll, drag.startScrollTop + deltaFrac * maxScroll));
			}
			return;
		}

		const nearest = this.nearestScrollMarker(container, event.clientY);
		if (nearest == null) {
			if (this.hoveredMarkerIndex != null) {
				this.hoveredMarkerIndex = undefined;
			}
			this.scheduleHideTooltip();
			return;
		}

		if (nearest.index === this.hoveredMarkerIndex) return;

		this.hoveredMarkerIndex = nearest.index;
		const band = container.querySelector<HTMLElement>(`[data-marker-index="${nearest.index}"]`);
		const entries = nearest.entries.filter(e => e.label.length > 0).map(e => ({ icon: e.icon, label: e.label }));
		if (band != null && entries.length > 0) {
			this.showTooltipList(band, entries, 'left', 60);
		} else {
			this.scheduleHideTooltip();
		}
	};

	private readonly onScrollMarkerPointerLeave = (): void => {
		if (this.hoveredMarkerIndex != null) {
			this.hoveredMarkerIndex = undefined;
		}
		this.scheduleHideTooltip();
	};

	// Swallow the rail's `pointerover` so the row-hover/tooltip delegate (a bubbling pointerover
	// handler) doesn't fire for it — the rail drives its own tooltip via pointermove above.
	private readonly stopPointerOver = (event: Event): void => {
		event.stopPropagation();
	};

	// Click the rail → center a row in the viewport: the NEAREST marker if the click is near one,
	// otherwise the row at the clicked position (the rail doubles as a click-to-jump navigator). Rows
	// are fixed-height, so the target scrollTop is a direct index × rowHeight (no measurement needed).
	// Driven from pointerup (not @click) so it coexists with the drag-scrub (only fires when no drag).
	private jumpToScrollMarker(container: HTMLElement, clientY: number): void {
		const scroller = this.virtualizerRef.value;
		if (scroller == null) return;

		const nearest = this.nearestScrollMarker(container, clientY);
		let index: number;
		if (nearest != null) {
			index = nearest.index;
		} else {
			const rect = container.getBoundingClientRect();
			const total = this._renderCtx?.total ?? this.scrollMarkerRows.length;
			if (rect.height <= 0 || total <= 0) return;

			index = Math.round(((clientY - rect.top) / rect.height) * total);
		}

		scroller.scrollTop = Math.max(0, index * this.rowHeight - scroller.clientHeight / 2);
	}

	// ─── Interaction (delegated; rows carry no per-row listeners) ──────────────

	private resolveSha(event: Event): string | undefined {
		for (const el of event.composedPath()) {
			if (!(el instanceof HTMLElement)) continue;

			const sha = el.dataset.sha;
			if (sha != null) return sha;
		}
		return undefined;
	}

	// Resolve a ref pill from the event path (the chips carry data-ref-name/kind/remote). Used
	// by dblclick + contextmenu so a ref interaction wins over the enclosing row.
	private resolveRef(event: Event): ResolvedRefTarget | undefined {
		for (const el of event.composedPath()) {
			if (!(el instanceof HTMLElement)) continue;

			const name = el.dataset.refName;
			if (name != null) {
				const kind = el.dataset.refKind ?? '';
				const remote = el.dataset.refRemote ?? null;
				// Prefer the rendered unique key; fall back to composing it (via the shared refPillKey, so
				// the format can't drift) — a local branch and the remote it tracks share `name`, so the
				// kind/owner-qualified key is what keeps them from colliding for pinning.
				const key = el.dataset.refKey ?? refPillKey({ kind: kind, name: name, remote: remote });
				// `context` is the host-serialized `data-vscode-context` for this SAME element (the pill
				// root, a popover row, or a PR/issue chip anchor all carry both together) — the host's
				// double-click handler gates on `ref.context` even for a metadata (PR/issue/upstream) click.
				return {
					name: name,
					key: key,
					kind: kind,
					remote: remote,
					context: el.dataset.vscodeContext,
					current: el.dataset.refIsHead === 'true',
				};
			}
		}
		return undefined;
	}

	// Resolve a PR/issue chip or upstream segment double-click into its full metadata object (walking
	// the SAME composedPath as resolveRef, but for the nearer `data-ref-metadata-type` surface). Returns
	// undefined when the click didn't land on a metadata surface, or its data isn't loaded/resolved yet
	// (falls through to a plain ref double-click in that case).
	private resolveRefMetadata(event: Event): GraphRefMetadataItem | undefined {
		for (const el of event.composedPath()) {
			if (!(el instanceof HTMLElement)) continue;

			const type = el.dataset.refMetadataType;
			if (type !== 'upstream' && type !== 'pullRequest' && type !== 'issue') continue;

			const id = el.dataset.refId;
			if (id == null) return undefined;

			const entry = this.refsMetadata?.[id];
			if (type === 'upstream') {
				return entry?.upstream != null ? { refId: id, type: 'upstream', data: entry.upstream } : undefined;
			}
			if (type === 'pullRequest') {
				const pr = entry?.pullRequest?.[0];
				return pr != null ? { refId: id, type: 'pullRequest', data: pr } : undefined;
			}

			const issue = entry?.issue?.[0];
			return issue != null ? { refId: id, type: 'issue', data: issue } : undefined;
		}
		return undefined;
	}

	private rowTypeForSha(sha: string): GitGraphRow['type'] {
		return this.getCommitBySha(sha)?.type ?? 'commit-node';
	}

	private onClick = (event: MouseEvent): void => {
		// Ignore clicks that land while a column resize drag is active (defensive — the drag's
		// pointerup is captured on window, but guard so a stray click can't select/toggle mid-resize).
		if (this.draggingColumn) return;

		// Any deliberate click in the graph cancels a reveal still queued from an earlier jump/ensure that
		// never resolved (target filtered out, lane never expanded, row never paged in). flushPendingReveal()
		// retries on EVERY render, so an orphaned reveal would otherwise fire on THIS click's render and
		// scroll the view away instead of just selecting what was clicked — the intermittent "jumps instead
		// of selects". The jump button stops propagation, so its own freshly-queued reveal never reaches here.
		this._pendingRevealSha = undefined;

		// Row-action buttons (Open Changes / stash Apply-Drop / WIP Compose-Review-Stash) resolve
		// BEFORE selection so a button click doesn't also select the row. They carry data-row-action
		// (→ host RowActionCommand) or data-wip-open (→ the compose/review/agents workflow); the
		// wrapper routes both. Alt on open-changes switches to the working-tree variant.
		for (const el of event.composedPath()) {
			if (!(el instanceof Element)) continue;

			const rowAction = el.getAttribute('data-row-action');
			if (rowAction != null) {
				const sha = this.resolveSha(event);
				if (sha != null) {
					const action =
						rowAction === 'open-changes' && event.altKey ? 'open-changes-with-working' : rowAction;
					// Undo Commit carries the owning worktree's path (when a non-active worktree owns the
					// tip) so the host undoes the right working copy; absent → host targets the primary repo.
					const worktreePath = el.getAttribute('data-worktree-path') ?? undefined;
					this.dispatchEvent(
						new CustomEvent('gl-graph-rowaction', {
							detail: {
								action: action,
								sha: sha,
								type: this.rowTypeForSha(sha),
								worktreePath: worktreePath,
							},
						}),
					);
				}
				event.stopPropagation();
				return;
			}

			const wipOpen = el.getAttribute('data-wip-open');
			if (wipOpen != null) {
				const sha = this.resolveSha(event);
				if (sha != null) {
					this.dispatchEvent(
						new CustomEvent('gl-graph-wiprowopen', { detail: { target: wipOpen, sha: sha } }),
					);
				}
				event.stopPropagation();
				return;
			}
		}

		// Lane-collapse toggle takes precedence over selection: the gutter node hit-target
		// (`.lane-hit-target` / `data-lane-tip`) and the adornment fold chevron/chip
		// (`data-lane-toggle-tip`) both route to the same toggle.
		for (const el of event.composedPath()) {
			if (!(el instanceof Element)) continue;

			if (el.classList.contains('lane-hit-target')) {
				const tip = el.getAttribute('data-lane-tip');
				if (tip != null) {
					this.toggleLane(tip);
					// Fall through (break, no return) to the row-selection dispatch below — mirroring the
					// ref-pill branch: a gutter-NODE click toggles the lane AND selects its (surviving) tip
					// row so the details panel opens, matching a plain row-background click.
					break;
				}
			}

			// The fold-strip chevron is a pure fold control (like an IDE gutter chevron): toggle only, no
			// selection — so it stays a return.
			const toggleTip = el.getAttribute('data-lane-toggle-tip');
			if (toggleTip != null) {
				this.toggleLane(toggleTip);
				return;
			}
		}

		// A click on a branch/tag ref pill toggles "focus" on that ref — pin it expanded + dim the rows
		// outside its first-parent chain (the dim is click-driven now, not hover) — AND opens/toggles
		// the branch sheet in the details panel. It then FALLS THROUGH (no early return) to the selection
		// dispatch below so the pill's row is ALSO selected via the same path a row-background click uses.
		// Hover still expands.
		const refPill = this.resolveRef(event);
		if (refPill != null && (refPill.kind === 'head' || refPill.kind === 'tag' || refPill.kind === 'remote')) {
			const pillSha = this.resolveSha(event);
			const pinned = this.togglePinnedRef(refPill.key, pillSha);
			// The pill's own `data-vscode-context` is the refGROUP context ("Hide All") when this ref is
			// grouped with its remote(s), which the sheet's kebab + action links can't use. Prefer the
			// ref's INDIVIDUAL context from the row model, falling back to the pill context.
			const refContext =
				(pillSha != null
					? this.getCommitBySha(pillSha)?.commitRefs.find(
							r => r.kind === refPill.kind && r.name === refPill.name,
						)?.refContext
					: undefined) ?? refPill.context;
			this.dispatchEvent(
				new CustomEvent('gl-graph-open-branch', {
					detail: {
						name: refPill.name,
						refType: refPill.kind,
						remote: refPill.remote,
						sha: pillSha,
						// Serialized `data-vscode-context` for this ref — powers the sheet's kebab menu
						// (row-menu parity) and its remote/tag action links.
						context: refContext,
						open: pinned,
					},
					bubbles: true,
					composed: true,
				}),
			);
			// stopPropagation keeps the raw click from bubbling past the graph (defensive; it does NOT
			// affect the CustomEvents above nor the selection dispatch below, which are separate events).
			event.stopPropagation();
		}

		const sha = this.resolveSha(event);
		if (sha == null) return;

		const idx = this.indexBySha.get(sha);
		// Honor `gitlens.graph.multiselect: false` — when multi-select is disabled, ctrl/shift/meta
		// clicks collapse to a plain single-row replace instead of range/toggle.
		const multiEnabled = this.config?.multiSelectionMode !== false;
		const mode: 'replace' | 'toggle' | 'range' = !multiEnabled
			? 'replace'
			: event.shiftKey
				? 'range'
				: event.ctrlKey || event.metaKey
					? 'toggle'
					: 'replace';

		// Range (shift+click): emit the visible-row span from the selection anchor (the
		// previously-focused row) through the clicked row. The wrapper consumes this directly,
		// or recomputes a first-parent chain when `multiSelectionMode: 'topological'`. The
		// anchor (focusIndex) stays put on range so successive shift+clicks extend from it;
		// replace/toggle move the anchor to the clicked row.
		let rangeShas: string[] | undefined;
		if (mode === 'range' && idx != null) {
			const lo = Math.min(this.focusIndex, idx);
			const hi = Math.max(this.focusIndex, idx);
			rangeShas = this.displayRows.slice(lo, hi + 1).map(r => r.sha);
		} else if (idx != null) {
			this.focusIndex = idx;
			// A click is a discrete action — reveal its lane NOW; the reveal debounce exists for
			// key-repeat navigation (see revealFocusedLaneSoon). willUpdate's tracker re-arm is a no-op
			// (the lane is in view by then).
			this.revealFocusedLaneSoon.cancel();
			this.revealFocusedLane();
		}

		this.dispatchEvent(
			new CustomEvent('gl-graph-changeselection', { detail: { sha: sha, mode: mode, rangeShas: rangeShas } }),
		);
	};

	private onDblClick = (event: MouseEvent): void => {
		// A ref-pill double-click is a ref interaction (e.g. checkout), not a row open — resolve
		// it first and route to the ref event, matching the React shell's delegated handler. A
		// PR/issue chip or the upstream segment ALSO resolves a ref (they nest inside the pill/row
		// that carries `data-ref-name`), plus — when the click landed on one of those metadata
		// surfaces — the full metadata object, so the host can route pull/push/open-PR/open-issue.
		const ref = this.resolveRef(event);
		if (ref != null) {
			event.stopPropagation();
			const metadata = this.resolveRefMetadata(event);
			this.dispatchEvent(new CustomEvent('gl-graph-refdoubleclick', { detail: { ...ref, metadata: metadata } }));
			return;
		}

		const sha = this.resolveSha(event);
		if (sha == null) return;

		this.dispatchEvent(
			new CustomEvent('gl-graph-rowdoubleclick', { detail: { sha: sha, type: this.rowTypeForSha(sha) } }),
		);
	};

	// Right-click → emit the GitLens context-menu event so the app can sync hover/selection
	// state. VS Code's native menu still opens on its own via the data-vscode-context attributes
	// on rows + pills, so we deliberately don't preventDefault.
	private onContextMenu = (event: MouseEvent): void => {
		const sha = this.resolveSha(event);
		if (sha == null) return;

		// Right-clicking a ref pill opens the native menu, which steals :hover (collapsing the name
		// overlay) and may close the popover. Pin the pill open for the menu's lifetime.
		const pill = this.resolveRefPill(event);
		const zone: 'ref' | 'row' = pill != null ? 'ref' : 'row';
		if (pill != null) {
			this.pinRefPill(pill);
		}
		this.dispatchEvent(
			new CustomEvent('gl-graph-contextmenu', {
				detail: { sha: sha, type: this.rowTypeForSha(sha), zone: zone },
			}),
		);
	};

	// The .gl-graph__ref-pill element under the event (light-DOM walk, parallels resolveRef).
	private resolveRefPill(event: Event): HTMLElement | undefined {
		for (const el of event.composedPath()) {
			if (el instanceof HTMLElement && el.classList.contains('gl-graph__ref-pill')) return el;
		}
		return undefined;
	}

	// Keep a right-clicked ref pill "open" while the native context menu is up: pin the name overlay
	// (CSS class mirroring :hover) and force any wrapping multi-ref popover open. Unpinned on the next
	// interaction after the menu closes (webview-focus return, or the next primary pointerdown).
	private pinnedRefPill?: HTMLElement;
	private pinnedRefPopover?: GlPopover;
	private pinRefPill(pill: HTMLElement): void {
		this.unpinRefPill(); // never pin two at once / leak across rows
		this.pinnedRefPill = pill;
		pill.classList.add('is-context-pinned');

		const popover = pill.closest<GlPopover>('gl-popover.gl-graph__ref-popover') ?? undefined;
		if (popover != null) {
			this.pinnedRefPopover = popover;
			popover.open = true;
		}

		window.addEventListener('webview-focus', this.unpinRefPillBound, { once: true });
		document.addEventListener('pointerdown', this.unpinRefPillOnPointerDown, true);
	}
	private unpinRefPillBound = (): void => this.unpinRefPill();
	private unpinRefPillOnPointerDown = (e: PointerEvent): void => {
		// Ignore the menu-triggering right-click; unpin on the first primary press afterwards.
		if (e.button === 0) {
			this.unpinRefPill();
		}
	};
	private unpinRefPill(): void {
		this.pinnedRefPill?.classList.remove('is-context-pinned');
		this.pinnedRefPill = undefined;
		if (this.pinnedRefPopover != null) {
			void this.pinnedRefPopover.hide();
			this.pinnedRefPopover = undefined;
		}
		window.removeEventListener('webview-focus', this.unpinRefPillBound);
		document.removeEventListener('pointerdown', this.unpinRefPillOnPointerDown, true);
	}

	// Index of the next/prev row carrying a ref (head/remote/tag) from `from`; undefined if none that way.
	private findRefRowIndex(from: number, dir: 1 | -1): number | undefined {
		const rows = this.displayRows;
		for (let i = from + dir; i >= 0 && i < rows.length; i += dir) {
			const refs = this.getCommitBySha(rows[i].sha)?.commitRefs;
			if (refs != null && refs.length > 0) return i;
		}
		return undefined;
	}

	// First-parent lineage step: dir=1 (down/older) → the row's first parent; dir=-1 (up/newer) → the
	// nearest row above whose first parent is this row. Undefined when the lineage leaves the loaded set.
	private findTopologicalRowIndex(from: number, dir: 1 | -1): number | undefined {
		const rows = this.displayRows;
		const cur = rows[from];
		if (cur == null) return undefined;

		if (dir === 1) {
			const parentSha = cur.parents?.[0];
			return parentSha != null ? this.indexBySha.get(parentSha) : undefined;
		}

		for (let i = from - 1; i >= 0; i--) {
			if (rows[i].parents?.[0] === cur.sha) return i;
		}
		return undefined;
	}

	// Next/prev branching point (a merge commit — two or more parents) from `from`.
	private findBranchingPointIndex(from: number, dir: 1 | -1): number | undefined {
		const rows = this.displayRows;
		for (let i = from + dir; i >= 0 && i < rows.length; i += dir) {
			if ((rows[i].parents?.length ?? 0) > 1) return i;
		}
		return undefined;
	}

	private onKeydown = (event: KeyboardEvent): void => {
		// Only handle keys that originate from the tree container itself (the activedescendant focus
		// host). Interactive descendants — row-action buttons, column-header labels/resize handles — are
		// focusable and bubble their keydown here; handling them would preventDefault their native
		// activation (Enter/Space → click) or fire a row action against the wrong target. Let them run.
		if (event.target !== event.currentTarget) return;

		const last = this.displayRows.length - 1;
		if (last < 0) return;

		let next: number;
		switch (event.key) {
			case 'ArrowDown': {
				// Alt = next branching point; Ctrl/Cmd = follow first-parent lineage; plain = next row.
				const t = event.altKey
					? this.findBranchingPointIndex(this.focusIndex, 1)
					: event.ctrlKey || event.metaKey
						? this.findTopologicalRowIndex(this.focusIndex, 1)
						: Math.min(last, this.focusIndex + 1);
				if (t == null) {
					event.preventDefault();
					return;
				}

				next = t;
				break;
			}
			case 'ArrowUp': {
				const t = event.altKey
					? this.findBranchingPointIndex(this.focusIndex, -1)
					: event.ctrlKey || event.metaKey
						? this.findTopologicalRowIndex(this.focusIndex, -1)
						: Math.max(0, this.focusIndex - 1);
				if (t == null) {
					event.preventDefault();
					return;
				}

				next = t;
				break;
			}
			case 'PageDown': {
				// Alt = jump to the next ref row; plain = move a page.
				const t = event.altKey
					? this.findRefRowIndex(this.focusIndex, 1)
					: Math.min(last, this.focusIndex + this.pageStep());
				if (t == null) {
					event.preventDefault();
					return;
				}

				next = t;
				break;
			}
			case 'PageUp': {
				const t = event.altKey
					? this.findRefRowIndex(this.focusIndex, -1)
					: Math.max(0, this.focusIndex - this.pageStep());
				if (t == null) {
					event.preventDefault();
					return;
				}

				next = t;
				break;
			}
			case 'Home':
				next = 0;
				break;
			case 'End':
				next = last;
				break;
			case 'Enter':
			case ' ': {
				const sha = this.displayRows[this.focusIndex]?.sha;
				if (sha != null) {
					// Keyboard selection moves the selected commit to a different row, leaving the focus-pin's
					// ref chain orphaned (rows dimmed against a stale chain). Clear it — this path never
					// coincides with pill-pinning (that goes through togglePinnedRef on a pointer click).
					if (this._pinnedRefKey != null) {
						this.clearPinnedRef();
					}
					// Optimistically reflect selection so the screen reader announces aria-selected
					// immediately, before the host round-trips the new selectedRows back.
					this.selectedShas = new Set([sha]);
					this._selectionAnchorIndex = this.focusIndex;
					this.requestUpdate();
					this.dispatchEvent(
						new CustomEvent('gl-graph-changeselection', { detail: { sha: sha, mode: 'replace' } }),
					);
					// Enter also OPENS the commit (keyboard equivalent of double-click); Space just selects
					// and keeps focus in the graph for continued arrow browsing.
					if (event.key === 'Enter') {
						this.dispatchEvent(
							new CustomEvent('gl-graph-rowdoubleclick', {
								detail: { sha: sha, type: this.rowTypeForSha(sha) },
							}),
						);
					}
				}
				event.preventDefault();
				return;
			}
			case 'h':
			case 'H': {
				// Jump selection to HEAD (the current branch tip) — a frequent re-orientation move.
				const headSha = this.headSha;
				const idx = headSha != null ? this.indexBySha.get(headSha) : undefined;
				if (headSha != null && idx != null) {
					if (this._pinnedRefKey != null) {
						this.clearPinnedRef();
					}
					this.focusIndex = idx;
					this._selectionAnchorIndex = idx;
					this.selectedShas = new Set([headSha]);
					this.requestUpdate();
					this.dispatchEvent(
						new CustomEvent('gl-graph-changeselection', { detail: { sha: headSha, mode: 'replace' } }),
					);
					this.virtualizerRef.value?.scrollToIndex(idx, 'nearest');
				}
				event.preventDefault();
				return;
			}
			case 'Escape':
				// During an in-flight column drag, Escape aborts the drag (handled at the window level) —
				// don't also clear the row selection as a side effect.
				if (this.columnDrag != null) return;

				// Clear selection (wrapper accepts sha: null). Optimistically clear locally too so
				// the screen reader hears the deselection immediately + aria-selected drops now.
				if (this.selectedShas.size > 0) {
					this.selectedShas = new Set();
					this.requestUpdate();
				}
				this.dispatchEvent(
					new CustomEvent('gl-graph-changeselection', { detail: { sha: null, mode: 'replace' } }),
				);
				event.preventDefault();
				return;
			case 'ArrowLeft':
			case 'ArrowRight': {
				// Collapse/expand the lane segment when focused on its tip (WAI-ARIA tree pattern) —
				// the only keyboard path to the lane chevrons (which are managed-focus, tabindex=-1).
				const sha = this.displayRows[this.focusIndex]?.sha;
				if (this.foldingEnabled && sha != null && this.segmentsByTipSha.has(sha)) {
					const collapsed = this.effectiveCollapsed.has(sha);
					if ((event.key === 'ArrowLeft' && !collapsed) || (event.key === 'ArrowRight' && collapsed)) {
						this.toggleLane(sha);
						event.preventDefault();
					}
				}
				return;
			}
			default:
				return;
		}

		event.preventDefault();
		const targetSha = this.displayRows[next]?.sha;
		if (targetSha == null) return;

		const multiEnabled = this.config?.multiSelectionMode !== false;
		if (event.shiftKey && multiEnabled) {
			// Shift+Arrow extends a range selection from the fixed anchor to the new row; the details panel
			// follows the moving end. The anchor stays put across successive Shift+Arrows.
			const anchor = this._selectionAnchorIndex ?? this.focusIndex;
			this._selectionAnchorIndex = anchor;
			this.focusIndex = next;
			const lo = Math.min(anchor, next);
			const hi = Math.max(anchor, next);
			const rangeShas = this.displayRows.slice(lo, hi + 1).map(r => r.sha);
			this.selectedShas = new Set(rangeShas);
			this.requestUpdate();
			this.dispatchEvent(
				new CustomEvent('gl-graph-changeselection', {
					detail: { sha: targetSha, mode: 'range', rangeShas: rangeShas },
				}),
			);
		} else {
			// Plain navigation moves selection with focus so the details panel + minimap follow arrow
			// browsing. Skip the re-dispatch when nothing changes (already the sole selection at this row).
			const alreadySelected =
				this.focusIndex === next && this.selectedShas.size === 1 && this.selectedShas.has(targetSha);
			this.focusIndex = next;
			this._selectionAnchorIndex = next;
			if (!alreadySelected) {
				if (this._pinnedRefKey != null) {
					this.clearPinnedRef();
				}
				this.selectedShas = new Set([targetSha]);
				this.requestUpdate();
				this.dispatchEvent(
					new CustomEvent('gl-graph-changeselection', { detail: { sha: targetSha, mode: 'replace' } }),
				);
			}
		}
		this.virtualizerRef.value?.scrollToIndex(next, 'nearest');
	};

	// On Tab-in, align the active descendant with the current selection so the screen reader
	// announces the selected row rather than a stale focus index. Fires once per focus gesture.
	/** Route programmatic focus to the keyboard-nav viewport. The host calls this on graph open /
	 *  sidebar select; the host element itself isn't focusable (light DOM), so focus the tree viewport.
	 *  Default `focusVisible: false`: every entry here is host-driven (visibility auto-focus, sidebar /
	 *  overview select), NOT the user keyboard-focusing the graph — genuine Tab-in reaches the tabindex=0
	 *  viewport through the browser without routing here. Suppressing focus-visible keeps the container
	 *  focus ring off on first render; it still appears on real keyboard use, since Chromium re-evaluates
	 *  :focus-visible on subsequent keydown even without a re-focus. Callers may pass an explicit override. */
	override focus(options?: FocusOptions): void {
		this.viewportRef.value?.focus({ focusVisible: false, ...options });
	}

	private onFocusIn = (event: FocusEvent): void => {
		if (this.selectedShas.size === 0) return;

		const firstSelected = this.selectedShas.values().next().value;
		const idx = firstSelected != null ? this.indexBySha.get(firstSelected) : undefined;
		if (idx == null) return;

		if (idx !== this.focusIndex) {
			this.focusIndex = idx;
		}

		// Only REVEAL (scroll) on a GENUINE keyboard-driven focus entry. `:focus-visible` is Chromium's
		// input-modality signal — set for keyboard focus (incl. programmatic focus that inherits a keyboard
		// modality), unset for pointer clicks and pointer-modality programmatic focus. It's what a pointer
		// flag / relatedTarget couldn't detect across the iframe boundary: VS Code's webview focus-restore
		// (view-tab click, panel return, the visibility-change auto-focus) re-enters via a `.focus()` whose
		// modality is the frame's LAST input — a mouse user (relatedTarget null, no in-frame pointerdown
		// seen) has pointer modality → no jump; a keyboard user keeps the WCAG focus-visible reveal. A
		// pure-keyboard selection is already on-screen (arrow nav scrolls with it), so this only fires for a
		// keyboard user returning to a wheel-scrolled-away selection.
		//   • focus arriving FROM an element already inside the graph → an internal transfer (no reveal).
		// A skipped reveal self-heals: the next arrow-key press moves the selection, which scrolls it into view.
		// The focusIndex realignment above stays unconditional so aria-activedescendant tracks the selection
		// on every focus gesture (screen-reader announce), however focus arrived.
		if (this.viewportRef.value?.matches(':focus-visible') !== true) return;

		const related = event.relatedTarget;
		if (related instanceof Node && this.contains(related)) return;

		// Ensure the active-descendant row is actually rendered (virtualized in) so the
		// `aria-activedescendant` id resolves to a real element. Only scroll when the row is OFF-screen —
		// an already-visible row (the common arrow-key/Tab-in case) needn't enter the virtualizer's
		// scroll-scheduling path (`scrollToIndex` is a no-op for visible rows, but skipping the call
		// avoids the work entirely). Same visibility math as flushPendingReveal/updateHeadPillDirection.
		const scroller = this.virtualizerRef.value;
		if (scroller == null) return;

		const top = idx * this.rowHeight;
		const viewTop = scroller.scrollTop;
		if (top >= viewTop && top + this.rowHeight <= viewTop + this.scrollerClientHeight) return;

		scroller.scrollToIndex(idx, 'nearest');
	};

	// Dispatch a "load the next page" request. The wrapper's `graphState.loading` guard (webview) and the
	// host's `_pendingRowsQuery` dedup collapse repeated calls to a single in-flight request, so firing
	// this per scroll frame or per applied page can't storm the host — at most one page loads at a time.
	private dispatchMoreRows(): void {
		this.dispatchEvent(new CustomEvent('gl-graph-morerows'));
		this.announceLoadingMore();
	}

	// Scroll-driven prefetch trigger. Fires immediately on entering the prefetch zone (leading edge) and,
	// so a trailing-only debounce can't be starved by continuous scroll events, re-checks at least every
	// `maxWait` while the user keeps scrolling within it. Steady-state pipelining is driven by the
	// per-applied-page continuation in `recomputeDisplayRows`; this (re)starts the pipeline from scroll.
	private emitMoreRows = debounce((): void => this.dispatchMoreRows(), 250, { edges: 'both', maxWait: 250 });

	// A11y: announce "loading" at most once per burst (leading edge) so continuous prefetch doesn't spam
	// the screen reader with a running commentary.
	private announceLoadingMore = debounce((): void => this.announce('Loading more commits…'), 250, {
		edges: 'leading',
	});

	private onRangeChanged = (event: Event): void => {
		// RangeChangedEvent exposes first/last as direct properties (not under `detail`).
		// Indices are into the rendered list (displayRows).
		const { first, last } = event as Event & { first: number; last: number };
		const rows = this.displayRows;
		if (rows.length === 0) return;

		// Streaming: prefetch the next page BEFORE the loaded end scrolls into view, so it's already in
		// flight when the user arrives (rather than hitting a loading wall). The trigger distance grows
		// with the viewport and the current scroll velocity — see `computePrefetchDistance`. Suppressed
		// while a scope re-root projection is active — its (short) view ends in the collapsed older-history
		// fold, so auto-paging would pull the WHOLE repo in to grow a fold the user hasn't even expanded.
		// The fold is the explicit "there's more" affordance instead. (When scoped but the projection is
		// inactive — e.g. the merge-base isn't loaded yet — paging still runs so it can be found.)
		if (this.scopeProjection == null && last >= rows.length - this.prefetchDistanceRows()) {
			this.emitMoreRows();
		}

		// Track the rendered range (feeds the prefetch trigger + visible-range scans). Incoming rows carry
		// final geometry from their build — the compositor translate + CSS pin position them, so there is
		// nothing to re-apply here.
		this.pendingRangeFirst = first;
		this.pendingRangeLast = last;

		// Recycled rows lose the imperative click-pinned expand class — re-apply it for the new range.
		if (this._pinnedRefKey != null) {
			this.reconcilePinnedRefPill();
		}

		// HEAD pill: show a "Scroll to HEAD" affordance when the current HEAD commit is off-screen.
		this.updateHeadPillDirection();
		// Pinned-branch pill: same, for the pinned branch's row.
		this.updatePinnedPillDirection();

		// Minimap day-range — fire synchronously (cheap) so the minimap tracks scroll. Use the ACTUAL
		// visible range (scrollTop/clientHeight), NOT the virtualizer's `first`/`last` which include the
		// off-screen buffer rows — otherwise the reported day span is wider than what the user sees. Parse
		// the top/bottom rows' dates (already epoch ms — no Date alloc or parse per scroll frame).
		const scroller = this.virtualizerRef.value;
		const rh = this.rowHeight;
		const firstVisible = scroller != null && rh > 0 ? Math.max(0, Math.floor(scroller.scrollTop / rh)) : first;
		const lastVisible =
			scroller != null && rh > 0
				? Math.min(rows.length - 1, Math.ceil((scroller.scrollTop + this.scrollerClientHeight) / rh) - 1)
				: last;
		const lo = Math.max(0, firstVisible);
		const hi = Math.min(rows.length - 1, lastVisible);
		const topMs = nearestNonWorkdirDate(rows, lo, hi) ?? NaN;
		const bottomMs = nearestNonWorkdirDate(rows, hi, lo) ?? NaN;
		if (!Number.isNaN(topMs) && !Number.isNaN(bottomMs)) {
			const days = { top: Math.max(topMs, bottomMs), bottom: Math.min(topMs, bottomMs) };
			const key = `${days.top}|${days.bottom}`;
			if (key !== this.lastVisibleDaysKey) {
				this.lastVisibleDaysKey = key;
				this.dispatchEvent(new CustomEvent('gl-graph-changevisibledays', { detail: days }));
			}
		}

		// Defer the WIP scan + missing-avatar collection behind the trailing debounce so continuous arrow/scroll
		// navigation doesn't fire (potentially expensive) IPC every frame. (`pendingRange*` were set above, before
		// the synchronous clamp, so its range-change skip check sees this range; the scan reads the debounce args.)
		this.scanVisibleRangeDebounced(first, last);
	};

	private pendingRangeFirst = 0;
	private pendingRangeLast = 0;

	private scanVisibleRange(first: number, last: number): void {
		const rows = this.displayRows;
		if (rows.length === 0) return;

		const meta = this.wipMetadataBySha;
		const knownAvatars = this.avatars;
		const lo = Math.max(0, first);
		const hi = Math.min(rows.length - 1, last);
		const visibleWip: Record<string, true> = {};
		const missingStats: Record<string, true> = {};
		const missingAvatars: Record<string, string> = {};
		for (let i = lo; i <= hi; i++) {
			const commit = this.getCommitBySha(rows[i].sha);
			if (commit == null) continue;

			if (rows[i].kind === 'workdir' && isSecondaryWipSha(rows[i].sha)) {
				visibleWip[rows[i].sha] = true;
				const m = meta?.[rows[i].sha];
				if (m != null && (m.workDirStats == null || m.workDirStatsStale === true)) {
					missingStats[rows[i].sha] = true;
				}
			}
			// Author email collection — skip empty (WIP rows have none), already-resolved, and already-requested
			// emails (the persistent `requestedAvatars` dedup so scrolling back never re-asks).
			const email = commit.authorEmail;
			if (
				email &&
				knownAvatars?.[email] == null &&
				!this.requestedAvatars.has(email) &&
				!(email in missingAvatars)
			) {
				missingAvatars[email] = '';
			}
		}

		const wipKey = Object.keys(visibleWip).sort().join(',');
		if (wipKey !== this.lastWipVisibleKey) {
			this.lastWipVisibleKey = wipKey;
			this.dispatchEvent(new CustomEvent('gl-graph-visiblewipshaschanged', { detail: visibleWip }));
		}

		// Always update the dedup key (even when empty) so a sha that becomes stale again later
		// re-fires: otherwise the key stays pinned to the last non-empty set and the guard
		// permanently suppresses a recurring missing-stats request.
		const missKey = Object.keys(missingStats).sort().join(',');
		if (missKey !== this.lastWipMissingKey) {
			this.lastWipMissingKey = missKey;
			if (missKey !== '') {
				this.dispatchEvent(new CustomEvent('gl-graph-wipshasmissingstats', { detail: missingStats }));
			}
		}

		// `missingAvatars` already excludes every previously-requested email (the `requestedAvatars` filter
		// above), so a non-empty set is BY CONSTRUCTION all-new — dispatch it and mark those emails requested.
		// No range-scoped dedup key: it can't span ranges and would wrongly suppress a legitimate re-request
		// after `requestedAvatars` is cleared (rows swap / reconnect) on an identical visible range.
		const missingAvatarEmails = Object.keys(missingAvatars);
		if (missingAvatarEmails.length !== 0) {
			for (const email of missingAvatarEmails) {
				this.requestedAvatars.add(email);
			}
			this.dispatchEvent(new CustomEvent('gl-graph-missingavatars', { detail: missingAvatars }));
		}
	}

	override firstUpdated(): void {
		this.measureScrollbarWidth();
		// Prime the cached viewport height before the first scroll (the ResizeObserver refreshes it on resize).
		this.scrollerClientHeight = this.virtualizerRef.value?.clientHeight ?? 0;
		this.attachScrollListener();
		this.snapVirtualizerToPixelGrid();
	}

	// The chrome above the row list (toolbar + search + column header) can sum to a FRACTIONAL height, so
	// the virtualizer inherits a sub-pixel Y offset and every row — hence all graph text — renders off the
	// device-pixel grid and softens. Snap the virtualizer back onto whole pixels with a tiny compensating
	// transform (recomputed on resize). Visual only: the scroller still owns scrollTop, so scrolling and
	// the virtualizer's own measurements are unaffected.
	private virtualizerSnapOffset = 0;
	private snapVirtualizerToPixelGrid(): void {
		const el = this.virtualizerRef.value;
		if (el == null) return;

		// `top` already includes our prior compensation; back it out to read the raw layout offset.
		const layoutTop = el.getBoundingClientRect().top - this.virtualizerSnapOffset;
		const offset = Math.round(layoutTop) - layoutTop;
		if (Math.abs(offset - this.virtualizerSnapOffset) < 0.01) return;

		this.virtualizerSnapOffset = offset;
		el.style.transform = offset !== 0 ? `translateY(${offset.toFixed(3)}px)` : '';
	}

	protected override updated(changed: PropertyValues): void {
		super.updated(changed);
		// Re-apply the click-pinned ref-pill expand class to the live DOM after each render.
		this.reconcilePinnedRefPill();
		// Re-assert the scroll position captured across a lane collapse/expand so the swap doesn't shift the
		// viewport (runs before flushPendingReveal — a reveal, if armed, wins and clears this anchor).
		this.applyPendingScrollAnchor();
		// A reveal requested before its row was loaded (host EnsureRow round-trip) fires here once the
		// row lands in displayRows.
		this.flushPendingReveal();
		// Keep the virtualizer pixel-snapped after every render too — the ResizeObserver only fires on OUR
		// size change, so chrome above the row list (toolbar/search/header) shifting onto a fractional
		// boundary without resizing us would otherwise leave the snap stale → every row (and its text)
		// renders off the device-pixel grid and softens. Cheap: a no-op early-returns when already snapped.
		this.snapVirtualizerToPixelGrid();
	}

	/** True when `sha` is currently rendered (present in `displayRows`); false when it's loaded but
	 *  hidden by a collapsed lane, an active search filter, or the scope projection. The wrapper's
	 *  getCommits/selectCommits read this to report the displayed-vs-hidden state search-nav needs. */
	isRowDisplayed(sha: string): boolean {
		return this.indexBySha.has(sha);
	}

	// Cached sha→column map for `getColumnsBySha`, keyed on `processedRows`' array identity so a
	// caller re-querying between full re-derivations (e.g. repeated jump-to-WIP clicks) doesn't pay
	// an O(rows) rebuild each time.
	private _columnsByShaCache?: { rows: readonly ProcessedGraphRow[]; columns: Record<string, number> };

	/** Sha → lane (column) index for every processed row — the new engine's equivalent of the legacy
	 *  GK component's `onColumnsCalculated` map. The wrapper's jump-to-nearest-WIP reads this (via
	 *  `querySelector('gl-lit-graph')`) instead of its own `_columnsBySha`, which only the legacy
	 *  engine populates. */
	getColumnsBySha(): Record<string, number> | undefined {
		if (this.processedRows.length === 0) return undefined;

		const cached = this._columnsByShaCache;
		if (cached?.rows === this.processedRows) return cached.columns;

		const columns: Record<string, number> = {};
		for (const row of this.processedRows) {
			columns[row.sha] = row.column;
		}
		this._columnsByShaCache = { rows: this.processedRows, columns: columns };
		return columns;
	}

	// ─── Controllable scroll-into-view ──────────────────────────────────────────────────────────
	// Reveal is OPT-IN: callers invoke scrollToSha explicitly (search-result nav, sidebar select,
	// ensureAndSelectCommit) — generic selection changes (a click, details-panel sync) never auto-
	// scroll. A reveal for a not-yet-loaded row is held and flushed when the row arrives.
	private _pendingRevealSha?: string;
	private _pendingRevealPosition: 'center' | 'nearest' = 'center';

	/** Scroll the row for `sha` into view (centered by default) — but only when it's currently
	 *  off-screen, so revealing an already-visible row (e.g. a search hit on screen) doesn't jump.
	 *  If the row isn't loaded yet, the reveal is deferred until it appears. */
	scrollToSha(sha: string, position: 'center' | 'nearest' = 'center'): void {
		// A deliberate reveal takes precedence over a pending lane-collapse scroll anchor.
		this._pendingScrollAnchorTop = undefined;
		this._pendingRevealSha = sha;
		this._pendingRevealPosition = position;
		this.flushPendingReveal();
	}

	private flushPendingReveal(): void {
		const sha = this._pendingRevealSha;
		if (sha == null) return;

		const scroller = this.virtualizerRef.value;
		if (scroller == null) return;

		const idx = this.indexBySha.get(sha);
		if (idx == null) return; // not loaded/visible yet — keep pending; updated() retries on next render

		this._pendingRevealSha = undefined;

		// Already fully on-screen → leave the scroll position put (revealing shouldn't recenter a
		// row the user can already see).
		const top = idx * this.rowHeight;
		const viewTop = scroller.scrollTop;
		if (top >= viewTop && top + this.rowHeight <= viewTop + scroller.clientHeight) return;

		scroller.scrollToIndex(idx, this._pendingRevealPosition);
	}

	// Attach the scroll handler PASSIVELY (so it never blocks the compositor on a scroll frame —
	// a template `@scroll` binding is non-passive). Called from firstUpdated AND connectedCallback
	// (reconnect), so remove first to avoid a duplicate. Also primes the header shadow if the
	// scroller is already scrolled (e.g. restored scroll position on reconnect/reload).
	private attachScrollListener(): void {
		const scroller = this.virtualizerRef.value;
		if (scroller == null) return;

		scroller.removeEventListener('scroll', this.onScroll);
		scroller.addEventListener('scroll', this.onScroll, { passive: true });
		if (scroller.scrollTop > 4) {
			this.wasScrolled = true;
			this.querySelector('.gl-graph__header')?.classList.add('is-scrolled');
		}
	}

	/** Imperatively scroll the row list by `deltaY` px (used by the minimap wheel passthrough). */
	scrollByDelta(deltaY: number): void {
		const scroller = this.virtualizerRef.value;
		if (scroller != null) {
			scroller.scrollTop += deltaY;
		}
	}

	// Expose the scroller's actual scrollbar width so the column header can reserve a matching
	// right gutter and stay aligned with the rows (which lose that width to the scrollbar).
	// Auto-adapts to classic (≈14px) vs overlay (0px) scrollbars. Measured only on resize +
	// first render (the only times it can change for an always-overflowing list) rather than
	// every reactive update — reading offsetWidth/clientWidth forces a synchronous layout.
	// Set via CSSOM (CSP-safe) so it doesn't trigger a re-render.
	private measureScrollbarWidth(): void {
		const scroller = this.virtualizerRef.value;
		if (scroller == null) return;

		const scrollbarWidth = scroller.offsetWidth - scroller.clientWidth;
		if (scrollbarWidth === this.lastScrollbarWidth) return;

		this.lastScrollbarWidth = scrollbarWidth;
		this.style.setProperty('--gl-graph-scrollbar-width', `${scrollbarWidth}px`);
	}

	// Toggle the header's scrolled-shadow via CSSOM only when crossing the threshold — NOT a
	// reactive @state, so a scroll never triggers a host re-render / virtualizer update cycle.
	private wasScrolled = false;
	// Idle threshold (ms): a scroll gap longer than this is a fresh start (the prior fling has ended). One
	// source for both the velocity tracker (re-zeros the estimate) and the prefetch reader (gates a lingering
	// velocity to 0) — see `isScrollIdle`.
	private static readonly scrollIdleMs = 300;
	// True while scrolling is teleport-class: consecutive jumps of a viewport or more (scrollbar drags,
	// scrollbar track page-jumps) leave NO overlap between the old and new rendered ranges, so with sha row
	// keys EVERY rendered row is torn down + rebuilt each tick — 100+ heavy templates per frame saturates
	// the main thread and nothing paints until the drag ends (the view "stays blank"). While set,
	// `renderRowItem` emits skeleton rows (lane dot + subject, ~a dozen nodes) that build near-free so the
	// view keeps painting under the drag; the settle below swaps the landed range back to full rows.
	private skeletonScroll = false;
	private _lastTeleportTime = 0;
	private readonly settleSkeletonScroll = debounce((): void => {
		if (!this.skeletonScroll) return;

		this.skeletonScroll = false;
		// A fresh render recreates `renderItem`, which makes the child virtualizer re-render every rendered
		// row — one full-cost frame, exactly once, on landing.
		this.requestUpdate();
	}, 150);
	// Scroll-velocity estimate (rows/second), fed by `onScroll` and read by the prefetch trigger. A single
	// exponentially-smoothed sample — enough to distinguish a slow drag from a fast fling without a ring
	// buffer. Two-part idle handling keeps a finished fling from lingering: a gap past `scrollIdleMs` is a fresh
	// start (the NEXT sample re-zeros the estimate here), and while scrolling is fully stopped (no next sample)
	// the reader `prefetchDistanceRows` idle-gates it to 0.
	private _scrollVelocityRows = 0;
	private _lastScrollTop = 0;
	private _lastScrollTime = 0;
	// True when scrolling has gone idle: no sample yet, or the last sample is older than `scrollIdleMs`. `now`
	// is threaded from `trackScrollVelocity` so it shares that call's single timestamp.
	private isScrollIdle(now: number = performance.now()): boolean {
		return this._lastScrollTime === 0 || now - this._lastScrollTime > GlLitGraph.scrollIdleMs;
	}
	private onScroll = (event: Event): void => {
		// HEAD pill tracks the live scroll position (cheap: a Map lookup + compare; sets state only on
		// an edge-cross). Runs every scroll, BEFORE the is-scrolled threshold early-return below.
		this.updateHeadPillDirection();
		this.updatePinnedPillDirection();

		// Velocity feeds the prefetch distance — track it every scroll (before the threshold early-return,
		// which returns during sustained scroll once past 4px).
		const scrollTop = (event.target as HTMLElement).scrollTop;
		// Teleport-class jump: well past one viewport since the LAST sample (read before trackScrollVelocity
		// advances it) means the new rendered range shares nothing with the old. Engage skeleton rows only on
		// the SECOND consecutive teleport — a lone jump (scrollbar track click, reveal/scrollToIndex) renders
		// its landing full-cost as before, while a sustained scrollbar drag goes cheap from its second tick.
		// The 1.5× / raised floor keeps FAST WHEEL SPINS (which can exceed a viewport per frame) rendering
		// full rows — only genuine scrollbar-drag deltas qualify; full rows keep up fine below that.
		const viewportH = Math.max(this.scrollerClientHeight * 1.5, 900);
		if (Math.abs(scrollTop - this._lastScrollTop) >= viewportH) {
			const now = performance.now();
			if (now - this._lastTeleportTime < GlLitGraph.scrollIdleMs) {
				this.skeletonScroll = true;
			}
			this._lastTeleportTime = now;
		}
		if (this.skeletonScroll) {
			this.settleSkeletonScroll();
		}
		this.trackScrollVelocity(scrollTop);

		// Rows passing under a stationary cursor flip hover-driven state while scrolling — suppress row
		// transitions so those don't fire as spurious fades trailing the scroll; a short settle re-enables
		// them so genuine interaction still animates. The burst start also tears down any open hover card.
		this.markScrolling();

		const scrolled = scrollTop > 4;
		if (scrolled === this.wasScrolled) return;

		this.wasScrolled = scrolled;
		this.querySelector('.gl-graph__header')?.classList.toggle('is-scrolled', scrolled);
	};

	// Toggles `is-scrolling` on the virtualizer for the duration of an active scroll (idempotent add per event;
	// a trailing debounce removes it once scrolling settles). See onScroll for why.
	private readonly clearScrolling = debounce((): void => {
		this.virtualizerRef.value?.classList.remove('is-scrolling');
	}, 120);
	private markScrolling(): void {
		const el = this.virtualizerRef.value;
		if (el == null) return;

		// Burst start (nothing pending yet): dismiss any hover card already armed or open (endRowHover also
		// cancels the emitRowHover debounce). Rows stay hit-testable while scrolling — a NEW mid-scroll card is
		// prevented instead because each row passing under the stationary cursor re-arms the 250ms emitRowHover
		// debounce, which outlasts the 120ms scroll-settle, so it never fires until scrolling stops. The
		// burst-start only tears down what was armed/open BEFORE the scroll began.
		if (!this.clearScrolling.pending()) {
			this.endRowHover(null);
			this.scheduleHideTooltip();
		}

		el.classList.add('is-scrolling');
		this.clearScrolling();
	}

	// Update the smoothed rows/second velocity from a new scroll sample. Uses `performance.now()` deltas so
	// it tracks real speed regardless of frame rate; an idle gap (see `isScrollIdle`) is treated as a fresh
	// start (the prior fling has ended) so a stale high velocity isn't carried into a slow resume.
	private trackScrollVelocity(scrollTop: number): void {
		const now = performance.now();
		const dt = now - this._lastScrollTime;
		if (this.isScrollIdle(now)) {
			// First sample of a (re)started scroll — no reliable velocity yet.
			this._scrollVelocityRows = 0;
		} else if (dt === 0) {
			// Two samples in the same millisecond — leave the anchor alone so this movement folds into the
			// next sample's dt instead of being dropped (advancing lastScrollTop with dt=0 loses it).
			return;
		} else {
			const rh = this.rowHeight;
			const rowsMoved = rh > 0 ? Math.abs(scrollTop - this._lastScrollTop) / rh : 0;
			const instantaneous = (rowsMoved / dt) * 1000; // rows per second
			// Exponential moving average — favor the recent sample but damp per-frame jitter.
			this._scrollVelocityRows = this._scrollVelocityRows * 0.4 + instantaneous * 0.6;
		}
		this._lastScrollTop = scrollTop;
		this._lastScrollTime = now;
	}

	// Rows-ahead threshold at which to start paging in the next page (velocity + viewport aware).
	private prefetchDistanceRows(): number {
		// Idle gate (shares `isScrollIdle` with the velocity tracker): when scrolling has fully stopped there's
		// no next sample to decay the estimate, so a finished fling's velocity would linger and over-prefetch.
		// Treat it as stationary past the idle threshold; computePrefetchDistance stays pure.
		const velocity = this.isScrollIdle() ? 0 : this._scrollVelocityRows;
		return computePrefetchDistance(this.scrollerClientHeight, this.rowHeight, velocity);
	}

	// Resolve whether the current HEAD commit is above/below the actual VIEWPORT (or visible → no pill).
	// Uses scrollTop/clientHeight (not the virtualizer's rendered range, which includes off-screen
	// buffer rows). Only writes the @state on a CHANGE so a scroll that doesn't cross HEAD never re-renders.
	private updateHeadPillDirection(): void {
		const scroller = this.virtualizerRef.value;
		const headSha = this.headSha;
		let dir: 'up' | 'down' | undefined;
		if (scroller != null && headSha != null) {
			const idx = this.indexBySha.get(headSha);
			if (idx != null) {
				const top = idx * this.rowHeight;
				const viewTop = scroller.scrollTop;
				const viewBottom = viewTop + scroller.clientHeight;
				if (top + this.rowHeight <= viewTop) {
					dir = 'up';
				} else if (top >= viewBottom) {
					dir = 'down';
				}
			}
		}
		if (dir !== this.headPillDirection) {
			this.headPillDirection = dir;
		}
	}

	// Same off-screen math as updateHeadPillDirection, for the pinned branch's row. Only writes the
	// @state on a change so a scroll that doesn't cross the pinned row never re-renders.
	private updatePinnedPillDirection(): void {
		const scroller = this.virtualizerRef.value;
		const pinnedSha = this.pinnedSha;
		let dir: 'up' | 'down' | undefined;
		if (scroller != null && pinnedSha != null) {
			const idx = this.indexBySha.get(pinnedSha);
			if (idx != null) {
				const top = idx * this.rowHeight;
				const viewTop = scroller.scrollTop;
				const viewBottom = viewTop + scroller.clientHeight;
				if (top + this.rowHeight <= viewTop) {
					dir = 'up';
				} else if (top >= viewBottom) {
					dir = 'down';
				}
			}
		}
		if (dir !== this.pinnedPillDirection) {
			this.pinnedPillDirection = dir;
		}
	}

	private onHeadPillClick = (): void => {
		const scroller = this.virtualizerRef.value;
		const headSha = this.headSha;
		if (scroller == null || headSha == null) return;

		const idx = this.indexBySha.get(headSha);
		if (idx == null) return;

		// Jump to (center) HEAD AND select it — same selection path a row click uses, so the details
		// panel opens on HEAD too. Move the focus anchor with it (matches replace-click behavior).
		scroller.scrollTop = Math.max(0, idx * this.rowHeight - scroller.clientHeight / 2);
		this.focusIndex = idx;
		this.dispatchEvent(new CustomEvent('gl-graph-changeselection', { detail: { sha: headSha, mode: 'replace' } }));
	};

	private onPinnedPillClick = (): void => {
		const scroller = this.virtualizerRef.value;
		const pinnedSha = this.pinnedSha;
		if (scroller == null || pinnedSha == null) return;

		const idx = this.indexBySha.get(pinnedSha);
		if (idx == null) return;

		// Jump to (center) the pinned branch AND select it (same path as the HEAD pill).
		scroller.scrollTop = Math.max(0, idx * this.rowHeight - scroller.clientHeight / 2);
		this.focusIndex = idx;
		this.dispatchEvent(
			new CustomEvent('gl-graph-changeselection', { detail: { sha: pinnedSha, mode: 'replace' } }),
		);
	};

	// ─── Column header (labels + drag-resize + drag-reorder), ported from React ZoneHeader ──

	private renderHeader(visibleZones: readonly ZoneSpec[], gutterWidth: number): TemplateResult {
		// `is-scrolled` is owned solely by the CSSOM toggle in onScroll/attachScrollListener — a
		// template binding here would re-assert/wipe it on every reactive render (dual authority).
		// Grouped refs' host zone (by id) so the refs control rides the same cell as the refs pills below.
		const refsHostId = this.refsHostIdFor(visibleZones);
		// Likewise the GRAPH's grouped host zone, so its group toggle rides the cell where the lanes render
		// (by id) instead of being stranded on the first column when the graph groups into a later one.
		const graphHostId = this.graphHostIdFor(visibleZones);
		// The group/inline toggle combines a column into the one on its RIGHT, so it's meaningless on the
		// last column (nothing to group with) — hidden there for both the graph and the refs column.
		const graphIsLastColumn = gutterWidth > 0 && this.graphVisibleSlot === visibleZones.length;
		return html`<div class="gl-graph__header" role="group" aria-label="Graph columns">
			${gutterWidth > 0 && this.graphVisibleSlot === 0
				? this.renderGraphHeaderCell(gutterWidth, graphIsLastColumn)
				: nothing}
			${visibleZones.map((zone, i) => {
				const isLast = i === visibleZones.length - 1;
				// Same zero-scroll rule as the body cells (zoneStyle): fill may shrink but not grow, others
				// rigid at the solved width — so the header columns line up exactly with the rows below.
				const w = `${zone.width}px`;
				const style = zone.flex
					? { flex: `0 1 ${w}`, minWidth: `${zone.minWidth}px` }
					: { flex: `0 0 ${w}`, width: w, minWidth: `${zone.minWidth}px` };
				// Reserve room for any controls in this cell, then swap the text label for its icon when
				// the remaining width can't fit it (legacy narrow-column behavior). The flex zone never
				// narrows (it grows), so it always keeps its text.
				// The graph's group toggle rides its grouped HOST zone (by id, where the lanes render) so it
				// isn't stranded on the first column; when the graph is hidden (no host) it sits at the front.
				const graphControlHere =
					gutterWidth === 0 && (this.graphPlacement === 'grouped' ? zone.id === graphHostId : i === 0);
				const hasRefsControl = (zone.id === 'ref' && this.refsPlacement === 'column') || zone.id === refsHostId;
				// The graph control is labeled ("Graph") on its host cell, so it's wider than the bare refs toggle.
				const controlsPx = (graphControlHere ? 64 : 0) + (hasRefsControl ? 22 : 0);
				const labelAsIcon = !zone.flex && !headerLabelFits(zone.label, zone.width - controlsPx);
				return html`<div
						class="gl-graph__header-cell${this.dragColId === zone.id ? ' is-dragging' : ''}"
						data-col-id=${zone.id}
						data-vscode-context=${this.columnsContext ?? nothing}
						style=${cspStyleMap(style)}
						@pointerdown=${(e: PointerEvent) => this.onColumnPointerDown(e, zone.id)}
					>
						${graphControlHere ? this.renderPlacementControl(true) : nothing}
						${zone.id === refsHostId ? this.renderRefsPlacementControl(false, visibleZones) : nothing}
						<span
							class="gl-graph__header-label"
							role="button"
							tabindex="0"
							aria-label=${`${zone.label} column. Use Arrow Left/Right to reorder, or drag.`}
							data-tooltip=${`Drag or press Arrow keys to reorder ${zone.label.toLowerCase()} column`}
							@keydown=${(e: KeyboardEvent) => this.onLabelKeydown(e, visibleZones, i)}
							>${labelAsIcon
								? html`<code-icon
										class="gl-graph__header-label-icon"
										icon=${zoneHeaderIcons[zone.id]}
									></code-icon>`
								: zone.label}</span
						>
						${zone.id === 'ref' && this.refsPlacement === 'column' && !(isLast && !graphIsLastColumn)
							? this.renderRefsPlacementControl(true, visibleZones)
							: nothing}
						${isLast
							? nothing
							: html`<div
									class="gl-graph__resize-handle"
									role="separator"
									aria-orientation="vertical"
									tabindex="0"
									aria-label=${`Resize ${zone.label} column`}
									aria-valuenow=${zone.width}
									aria-valuemin=${zone.minWidth}
									aria-valuemax="800"
									data-tooltip=${`Drag to resize, or double-click to fit the ${(visibleZones[i + 1]?.label ?? 'next').toLowerCase()} column to its contents`}
									@pointerdown=${(e: PointerEvent) => this.onResizeStart(e, visibleZones, i)}
									@keydown=${(e: KeyboardEvent) => this.onResizeKeydown(e, visibleZones, i)}
								>
									<span class="gl-graph__resize-line"></span>
								</div>`}
					</div>
					${gutterWidth > 0 && this.graphVisibleSlot === i + 1
						? this.renderGraphHeaderCell(gutterWidth, graphIsLastColumn)
						: nothing}`;
			})}
			${this.renderStyleToggle()}${this.renderSettingsControl()}
		</div>`;
	}

	// Compact-density header. The stacked 2-line rows have no per-zone columns, so instead of the full
	// column header we render a reduced bar: the Graph column cell (its placement/node/density controls +
	// resize handle, width `graphColumnWidth`) when the graph is its own column — aligned with the row's
	// leading graph cell — then a single flex-fill "details" cell spanning the stacked content, then the
	// settings gear. When the graph is grouped or hidden there's no separate leading cell, so it collapses
	// to just the details cell (which hosts the graph group/restore control) + the gear.
	private renderListHeader(): TemplateResult {
		const graphIsColumn = this.graphPlacement === 'column';
		return html`<div class="gl-graph__header gl-graph__header--list" role="group" aria-label="Graph columns">
			${graphIsColumn ? this.renderGraphHeaderCell(this.gutterWidth, false) : nothing}
			<div
				class="gl-graph__header-cell gl-graph__header-cell--details"
				data-vscode-context=${this.columnsContext ?? nothing}
			>
				${graphIsColumn ? nothing : this.renderPlacementControl(true)}
			</div>
			${this.renderStyleToggle()}${this.renderSettingsControl()}
		</div>`;
	}

	// The graph-column header cell (placement/node/density controls + a draggable "Graph" label + the
	// resize handle). Rendered at `graphColumnPos` among the zone headers (movable column); the label's
	// dragstart/Arrow keys reorder it. The resize handle sets the column's displayed width — narrowing
	// it past the lane content scrolls the gutter (fixed spacing), it does NOT re-space the lanes.
	private renderGraphHeaderCell(gutterWidth: number, isLast: boolean): TemplateResult {
		const foldLaneWidth = this.foldLaneWidth;
		const totalWidth = this.graphColumnWidth;
		// Swap the "Graph" text for the graph icon once the cell can't fit it (placement control + label
		// + handle) — same narrow-column behavior as the zone headers.
		const labelAsIcon = !headerLabelFits('Graph', totalWidth - 22);
		return html`<div
			class="gl-graph__header-cell gl-graph__header-cell--graph${this.dragColId === 'graph'
				? ' is-dragging'
				: ''}"
			data-vscode-context=${this.columnsContext ?? nothing}
			style=${cspStyleMap({ width: `${totalWidth}px`, minWidth: `${totalWidth}px` })}
			@pointerdown=${(e: PointerEvent) => this.onColumnPointerDown(e, 'graph')}
		>
			<span
				class="gl-graph__header-label"
				role="button"
				tabindex="0"
				aria-label="Graph column. Use Arrow Left/Right to reorder, or drag."
				data-tooltip="Drag or press Arrow keys to reorder the graph column"
				@keydown=${this.onGraphLabelKeydown}
				>${labelAsIcon
					? html`<code-icon class="gl-graph__header-label-icon" icon="graph-line"></code-icon>`
					: 'Graph'}</span
			>${isLast ? nothing : this.renderPlacementControl()}
			<div
				class="gl-graph__resize-handle"
				role="separator"
				aria-orientation="vertical"
				tabindex="0"
				aria-label="Resize graph column"
				aria-valuenow=${Math.round(totalWidth)}
				aria-valuemin=${Math.round(foldLaneWidth + gutterPadding * 1.5 + this.columnWidth)}
				aria-valuemax=${Math.round(foldLaneWidth + gutterWidth)}
				data-tooltip="Drag or press Arrow keys to resize the graph column (scrolls when narrower than the lanes)"
				@pointerdown=${this.onGraphResizeStart}
				@keydown=${this.onGraphResizeKeydown}
			>
				<span class="gl-graph__resize-line"></span>
			</div>
		</div>`;
	}

	// Group/ungroup pushbutton for the graph's placement: click toggles Column ↔ Grouped. Hiding/showing
	// the graph is via the column right-click menu (which sets `graphPlacement: 'hidden'`), not this
	// button. Lives in the Graph header cell (column mode) or the grouped host's header cell. `labeled`
	// appends a "Graph" text label — used when the graph has no cell of its own (grouped into another
	// column, or hidden), so the header still names the affordance the way the standalone column does.
	private renderPlacementControl(labeled = false): TemplateResult {
		const hidden = this.graphPlacement === 'hidden';
		const grouped = this.graphPlacement === 'grouped';
		// Group/detach affordance: standalone column = outline `map` (group with the next column);
		// grouped = filled `map-filled` (separate back out). Icons are provisional (easy to swap).
		const icon = grouped ? 'map-filled' : 'map';
		const title = hidden
			? 'Graph: hidden — click to show as its own column'
			: grouped
				? 'Graph: grouped with the next column — click to show as its own column'
				: 'Graph: shown as its own column — click to group it with the next column';
		return html`<button
			class="gl-graph__placement-toggle${labeled ? ' gl-graph__placement-toggle--labeled' : ''}"
			type="button"
			aria-pressed=${grouped ? 'true' : 'false'}
			aria-label=${title}
			data-tooltip=${title}
			draggable="false"
			@pointerdown=${(e: Event) => e.stopPropagation()}
			@click=${this.togglePlacement}
		>
			<code-icon icon=${icon}></code-icon>${labeled
				? html`<span class="gl-graph__placement-toggle-label">Graph</span>`
				: nothing}
		</button>`;
	}

	// Click: flip Column ↔ Grouped (from hidden, restore to column).
	private togglePlacement = (): void => {
		this.graphPlacement = this.graphPlacement === 'column' ? 'grouped' : 'column';
		// Reset the offsets on a placement flip: a carried-over value would leave `--graph-gutter-scroll`
		// sliding the rasters out from under their dots in the new placement. Re-run the scroll path so the
		// var + any dependent clamp state re-settle against the new placement.
		this.graphScrollX = 0;
		this.groupedLaneOffset = 0;
		this.applyGraphScroll();
		// The focused row's lane may sit outside the NEW placement's viewport — re-reveal it there
		// (debounced; a no-op when it's already in view).
		this.revealFocusedLaneSoon();
		this.persistColumnsConfig();
	};

	// Resolve the render style from the graph column `mode` + the `gitlens.graph.avatars` setting. The
	// graph column's right-click "Compact" toggle sets `mode: 'compact'` (→ dots); any other value,
	// including the default `undefined` (NOT compact), shows avatars — real avatars when avatars are
	// enabled, else letters (initials). Mirrors the legacy GraphContainer's compact-vs-avatar behavior.
	private get effectiveNodeStyle(): 'dots' | 'avatars' | 'letters' {
		if (this.columns?.graph?.mode === 'compact') return 'dots';

		return (this.config?.avatars ?? true) ? 'avatars' : 'letters';
	}

	// Group/detach toggle for the Refs column. When refs is a column it lives at the RIGHT edge of the
	// Refs header (`atEnd` → outline `map` → group with Message), mirroring the graph column's toggle;
	// when grouped it migrates to the LEFT of the Message host header (filled `map-filled` → separate
	// back out). Rendered from the zone-header loop. Expanded density only (the header).
	private renderRefsPlacementControl(atEnd: boolean, visibleZones: readonly ZoneSpec[]): TemplateResult {
		const isColumn = this.refsPlacement === 'column';
		const icon = isColumn ? 'map' : 'map-filled';
		// SPECIAL CASE (see `refsGroupMergesGraph`): here the click merges the Graph into Refs, not the
		// `refsGroupTargetId` neighbor — the label must say so, or it lies about what the click will do.
		const mergesGraph = isColumn && this.refsGroupMergesGraph();
		// Name the actual target (capture-time neighbor when offering to group, current host when offering
		// to ungroup) — since HEAD grouping can land Refs on any adjacent column, not always Message.
		const targetId =
			isColumn && !mergesGraph ? this.refsGroupTargetId(visibleZones) : this.refsHostIdFor(visibleZones);
		const targetName = targetId != null ? this.zoneDisplayName(targetId) : 'the next column';
		const title = mergesGraph
			? 'Branches / Tags: shown as their own column — click to group the Graph into it'
			: isColumn
				? `Branches / Tags: shown as their own column — click to group them with the ${targetName} column`
				: `Branches / Tags: grouped with ${targetName} — click to show them as their own column`;
		return html`<button
			class=${atEnd ? 'gl-graph__placement-toggle gl-graph__placement-toggle--end' : 'gl-graph__placement-toggle'}
			type="button"
			aria-pressed=${isColumn ? 'false' : 'true'}
			aria-label=${title}
			data-tooltip=${title}
			draggable="false"
			@pointerdown=${(e: Event) => e.stopPropagation()}
			@click=${this.toggleRefsPlacement}
		>
			<code-icon icon=${icon}></code-icon>
		</button>`;
	}

	private toggleRefsPlacement = (): void => {
		if (this.refsPlacement === 'grouped') {
			// Restore the Refs column. No graphColumnPos adjustment: the refs zone re-enters the visible
			// list and the graph's derived slot shifts right on its own (anchor is unchanged).
			this.refsPlacement = 'column';
			this.refsHostZoneId = undefined;
			this.persistColumnsConfig();
			return;
		}

		// SPECIAL CASE — the Refs column sits IMMEDIATELY LEFT of the graph in the canonical (full-zone)
		// order. "Group refs" here means "merge that adjacent refs+graph pair", which is the SAME operation
		// as grouping the graph in [Graph][Refs]. So group the GRAPH into the Refs zone (Refs STAYS a
		// column — the flexible zone hosts lanes + pills), producing the identical end state. The anchor
		// moves onto the refs zone so the lanes group there.
		if (this.refsGroupMergesGraph()) {
			const refsFullIdx = this.zones.findIndex(z => z.id === 'ref');
			this.graphPlacement = 'grouped';
			this.graphColumnPos = refsFullIdx;
			// Unlike the ordinary group/ungroup paths above/below (session-only placement, anchor
			// unchanged), this special case moves the persisted anchor itself — persist it now so an
			// unrelated columns push (e.g. another column's visibility toggled from the host) can't echo
			// back the stale pre-toggle order and snap the anchor back.
			this.persistColumnsConfig();
			return;
		}

		// Ordinary group-refs: capture the zone adjacent to Refs BEFORE it drops out of the visible list —
		// mirrors the graph's positional anchor.
		this.refsHostZoneId = this.refsGroupTargetId(this.getVisibleZones());
		// The graph's derived slot shifts left automatically (the anchor doesn't move). No manual adjustment.
		this.refsPlacement = 'grouped';
		this.persistColumnsConfig();
	};

	// 3-way graph-style toggle beside the settings gear: shows the current `gitlens.graph.style` mode's
	// icon and cycles auto → table → list on click. Persists via a bubbling event the app forwards to the
	// host (`UpdateGraphConfigurationCommand`); the setting then flows back through config → `effectiveStyle`.
	private renderStyleToggle(): TemplateResult {
		const style = this.config?.style ?? 'auto';
		const icon = style === 'table' ? 'table' : style === 'list' ? 'list-flat' : 'gl-list-auto';
		const label = style === 'table' ? 'Table' : style === 'list' ? 'List' : 'Auto';
		const next = style === 'auto' ? 'table' : style === 'table' ? 'list' : 'auto';
		return html`<button
			class="gl-graph__placement-toggle gl-graph__header-style${this.settingsContext != null
				? ' gl-graph__header-style--with-gear'
				: ''}"
			type="button"
			aria-label=${`Graph style: ${label}. Click to cycle Auto, Table, List.`}
			data-tooltip=${`Graph style: ${label} — click to change`}
			draggable="false"
			@pointerdown=${(e: Event) => e.stopPropagation()}
			@click=${() => this.onStyleToggle(next)}
		>
			<code-icon icon=${icon}></code-icon>
		</button>`;
	}

	private onStyleToggle(next: GraphStyle): void {
		this.dispatchEvent(
			new CustomEvent('gl-graph-style-change', { detail: { style: next }, bubbles: true, composed: true }),
		);
	}

	// Settings gear: opens VS Code's native graph menu (column show/hide + the Scroll Markers submenu)
	// on click. `settingsContext` is the host-built `gitlens:graph:settings` data-vscode-context; a
	// left-click dispatches a synthetic `contextmenu` at the button so the native menu opens there
	// (same pattern as gl-details-commit-panel.onMoreActionsClick).
	private renderSettingsControl(): TemplateResult | typeof nothing {
		if (this.settingsContext == null) return nothing;

		return html`<button
			class="gl-graph__placement-toggle gl-graph__header-settings"
			type="button"
			aria-label="Graph and scroll-marker settings. Click to open the menu."
			data-tooltip="Settings — columns and scroll markers"
			draggable="false"
			data-vscode-context=${this.settingsContext}
			@pointerdown=${(e: Event) => e.stopPropagation()}
			@click=${this.openSettingsMenu}
		>
			<code-icon icon="settings-gear"></code-icon>
		</button>`;
	}

	private openSettingsMenu = (event: MouseEvent): void => {
		event.preventDefault();
		event.stopPropagation();
		const target = event.currentTarget;
		if (!(target instanceof HTMLElement)) return;

		const rect = target.getBoundingClientRect();
		target.dispatchEvent(
			new MouseEvent('contextmenu', {
				bubbles: true,
				composed: true,
				cancelable: true,
				clientX: rect.left,
				clientY: rect.bottom,
				button: 2,
			}),
		);
	};

	// Read-modify-write the persisted 'graph' column entry: the host replaces a column's config
	// wholesale on write (see graphWebview.ts's `updateColumns`/`updateRecordValue`), so preserve
	// `isHidden`/`mode` — owned independently by the host's column-visibility/compact-mode commands —
	// by spreading the last-echoed config before overwriting `width`/`order`.
	private currentGraphColumnConfig(): GraphColumnConfig {
		const persisted = this.columns?.graph;
		const config: GraphColumnConfig = {
			...persisted,
			width: this.graphViewportWidth ?? persisted?.width ?? this.graphColumnWidth,
			order: this.graphColumnPos,
		};
		// Omit `grouped` while hidden so the `...persisted` spread above preserves the last-echoed
		// value — only an active (non-hidden) placement overwrites it.
		if (this.graphPlacement !== 'hidden') {
			config.grouped = this.graphPlacement === 'grouped' || undefined;
		}
		return config;
	}

	// `zonesToColumnsConfig` only covers the file zones (ref/message/author/datetime/sha) — the graph
	// lane column isn't one of them (see `columnsToZones`), so its persisted width/order is stitched in
	// here for every write site.
	private buildColumnsConfig(): GraphColumnsConfig {
		const config = zonesToColumnsConfig(this.zones);
		config.graph = this.currentGraphColumnConfig();
		// Stitch in the ref column's grouped placement (host zone id) — hidden carries the last-echoed
		// value forward so un-hiding restores it instead of resetting to the default.
		config.ref.grouped =
			this.refsPlacement === 'hidden'
				? this.columns?.ref?.grouped
				: this.refsPlacement === 'grouped'
					? this.refsHostIdFor(this.getVisibleZones())
					: false;
		return config;
	}

	private persistColumnsConfig(): void {
		this.dispatchEvent(
			new CustomEvent('gl-graph-changecolumns', { detail: { settings: this.buildColumnsConfig() } }),
		);
	}

	private applyZones(next: readonly ZoneSpec[]): void {
		this.zones = next;
		this.requestUpdate();
		this.persistColumnsConfig();
	}

	private onResizeStart(event: PointerEvent, visibleZones: readonly ZoneSpec[], visibleIdx: number): void {
		// Double-click = fit-to-content. The capture + preventDefault below suppress the native `dblclick`,
		// so detect a rapid second press on the SAME boundary here and autosize instead of starting a drag.
		const now = Date.now();
		if (this.lastResizeDownIdx === visibleIdx && now - this.lastResizeDownAt < 300) {
			this.lastResizeDownAt = 0;
			this.lastResizeDownIdx = -1;
			event.preventDefault();
			event.stopPropagation();
			this.onResizeAutosize(visibleZones, visibleIdx);
			return;
		}

		this.lastResizeDownAt = now;
		this.lastResizeDownIdx = visibleIdx;

		event.preventDefault();
		event.stopPropagation();
		// Cascade drag: against the SOLVED widths captured at drag start (`visibleZones`, which carry the
		// rendered `currentWidth`) plus the CUMULATIVE pointer delta from `startX` (per-frame deltas fed
		// into a fixed snapshot oscillated → jitter). Each frame, `dragResizeZone` resizes the boundary's
		// column and cascades the inverse through the columns on the side it moves toward; the preview
		// renders via `dragSolvedZones`. Pointer capture keeps the move/up events coming even when the
		// cursor leaves the webview mid-drag (without it the drag got stuck — no pointerup arrived).
		const handle = event.currentTarget as HTMLElement;
		const pointerId = event.pointerId;
		// Capture is best-effort: it can throw for a non-active pointer; the drag still works via the
		// window listeners (only the leaves-the-webview case relies on capture).
		try {
			handle.setPointerCapture(pointerId);
		} catch {
			// no active pointer to capture — proceed without it
		}
		const startX = event.clientX;
		let totalDx = 0;
		let rafId: number | null = null;
		const flush = (): void => {
			rafId = null;
			const result = dragResizeZone(visibleZones, visibleIdx, totalDx);
			if (result == null) return;

			this.dragSolvedZones = result.zones;
			this.dragSavedIds = result.savedIds;
			this.requestUpdate();
		};
		const onMove = (e: PointerEvent): void => {
			totalDx = e.clientX - startX;
			rafId ??= requestAnimationFrame(flush);
		};
		// Forward-declared so `cleanup` can reference it; assigned below (avoids use-before-define).
		let onUp: () => void;
		const cleanup = (): void => {
			if (rafId != null) {
				cancelAnimationFrame(rafId);
				rafId = null;
			}
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			window.removeEventListener('pointercancel', onUp);
			if (handle.hasPointerCapture(pointerId)) {
				handle.releasePointerCapture(pointerId);
			}
			document.body.style.cursor = '';
			this.draggingColumn = false;
			this.dragSolvedZones = undefined;
			this.dragSavedIds = undefined;
			this.resizeDragCleanup = undefined;
		};
		onUp = (): void => {
			flush();
			// Commit: persist the cascaded columns' new widths as their preferred. Clear the preview so
			// updateRenderState re-solves from the persisted preferred widths.
			const solved = this.dragSolvedZones;
			const ids = this.dragSavedIds;
			if (solved != null && ids != null) {
				const widthById = new Map(ids.map(id => [id, solved.find(z => z.id === id)?.currentWidth]));
				this.zones = this.zones.map(z => {
					const w = widthById.get(z.id);
					return w != null ? { ...z, width: w, currentWidth: undefined } : z;
				});
			}
			cleanup();
			this.persistColumnsConfig();
		};
		this.resizeDragCleanup = cleanup;
		document.body.style.cursor = 'col-resize';
		// Suppress + dismiss any row hover/tooltip for the duration of the drag.
		this.draggingColumn = true;
		this.scheduleHideTooltip();
		this.cancelRowHover();
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
		window.addEventListener('pointercancel', onUp);
	}

	// Double-click a column boundary to fit a column to its widest loaded content. The handle sits at the
	// RIGHT edge of zone `visibleIdx` — i.e. the START of the NEXT column — so we fit that next column (the
	// one the splitter precedes), matching the "splitter before the column" model. Handles only render on
	// non-last zones, so `visibleIdx + 1` is always in range. The flex fill zone has no fixed width to fit.
	private onResizeAutosize(visibleZones: readonly ZoneSpec[], visibleIdx: number): void {
		const zone = visibleZones[visibleIdx + 1];
		if (zone == null) return;
		if (zone.flex) return;

		const cells = this.querySelectorAll<HTMLElement>(`.gl-graph__zone--${zone.id}`);
		if (cells.length === 0) return;

		// The cell never overflows — its content span truncates INSIDE it — so `cell.scrollWidth` is just the
		// current width. Measure the natural width of the cell's content children instead: each is a default
		// flex child (grow: 0), so its `scrollWidth` is the un-truncated content width. Sum them (a cell can
		// hold a leading gutter/refs + the content) and add the cell's horizontal padding (read once).
		const cs = getComputedStyle(cells[0]);
		const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
		let content = 0;
		for (const cell of cells) {
			let inner = 0;
			for (const child of [...cell.children]) {
				inner += (child as HTMLElement).scrollWidth;
			}
			content = Math.max(content, inner);
		}
		if (content <= 0) return;

		// Round up + a hair so the fitted text isn't immediately re-truncated by sub-pixel rounding.
		const width = Math.max(zone.minWidth, Math.min(zone.maxWidth ?? Infinity, Math.ceil(content + pad) + 1));
		if (width === zone.width) return;

		this.zones = this.zones.map(z => (z.id === zone.id ? { ...z, width: width, currentWidth: undefined } : z));
		this.persistColumnsConfig();
		this.requestUpdate();
	}

	// Drag the graph-column resize handle to set its displayed width (`graphViewportWidth`). Lanes keep
	// fixed spacing; once the column is narrower than the lane content the gutter scrolls (the drag
	// re-clamps the scroll offset). rAF-coalesced cumulative-delta, like `onResizeStart`.
	private onGraphResizeStart = (event: PointerEvent): void => {
		event.preventDefault();
		event.stopPropagation();
		// Pointer capture keeps the move/up events coming even when the cursor leaves the webview mid-drag.
		const handle = event.currentTarget as HTMLElement;
		const pointerId = event.pointerId;
		try {
			handle.setPointerCapture(pointerId);
		} catch {
			// no active pointer to capture — proceed without it
		}
		const startX = event.clientX;
		const startWidth = this.graphColumnWidth;
		let totalDx = 0;
		let rafId: number | null = null;
		const flush = (): void => {
			rafId = null;
			this.graphViewportWidth = startWidth + totalDx;
			this.applyGraphScroll();
			this.requestUpdate();
		};
		const onMove = (e: PointerEvent): void => {
			totalDx = e.clientX - startX;
			rafId ??= requestAnimationFrame(flush);
		};
		// Forward-declared so `cleanup` can reference it; assigned below (avoids use-before-define).
		let onUp: () => void;
		const cleanup = (): void => {
			if (rafId != null) {
				cancelAnimationFrame(rafId);
				rafId = null;
			}
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			window.removeEventListener('pointercancel', onUp);
			if (handle.hasPointerCapture(pointerId)) {
				handle.releasePointerCapture(pointerId);
			}
			document.body.style.cursor = '';
			this.draggingColumn = false;
			this.resizeDragCleanup = undefined;
		};
		onUp = (): void => {
			flush();
			cleanup();
			this.persistColumnsConfig();
		};
		this.resizeDragCleanup = cleanup;
		document.body.style.cursor = 'col-resize';
		this.draggingColumn = true;
		this.scheduleHideTooltip();
		this.cancelRowHover();
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
		window.addEventListener('pointercancel', onUp);
	};

	// Keyboard resize: Arrow Left/Right shrink/grow the viewport width (Shift = coarse). Persisted
	// immediately (no drag state), matching `onResizeKeydown`'s keyboard resize for the other columns.
	private onGraphResizeKeydown = (event: KeyboardEvent): void => {
		const dir = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
		if (dir === 0) return;

		event.preventDefault();
		const step = (event.shiftKey ? 16 : 4) * dir;
		this.graphViewportWidth = this.graphColumnWidth + step;
		this.applyGraphScroll();
		this.persistColumnsConfig();
	};

	// Horizontal wheel / Shift+wheel over the graph pans the gutter when it overflows the viewport.
	private onGraphWheel = (event: WheelEvent): void => {
		if (this.graphPlacement !== 'column' || this.maxGraphScrollX <= 0) return;

		// Only translate the wheel into lane scrolling when the pointer is actually over the graph column —
		// otherwise a horizontal/Shift-wheel over the message/author/date columns would slide the lanes
		// unexpectedly.
		const target = event.target;
		if (!(target instanceof Element) || target.closest('.gl-graph__zone--graph') == null) return;

		const dx = event.deltaX !== 0 ? event.deltaX : event.shiftKey ? event.deltaY : 0;
		if (dx === 0) return;

		const next = Math.max(0, Math.min(this.maxGraphScrollX, this.graphScrollX + dx));
		if (next === this.graphScrollX) return;

		// No preventDefault (the listener is PASSIVE — see graphWheelListener): the row scroller has no
		// native horizontal overflow, so a horizontal/Shift-wheel has no default scroll to suppress anyway.
		this.graphScrollX = next;
		this.applyGraphScroll();
	};

	// PASSIVE wheel listener wrapper: a non-passive wheel listener anywhere on the scroller's event path
	// forces the compositor to consult the main thread before EVERY wheel scroll tick — visible stutter on
	// fast wheel flings whenever a frame runs long. Passive keeps vertical wheel scrolling fully threaded
	// while the handler pans the lanes on horizontal/Shift-wheel. Declared AFTER onGraphWheel (class-field
	// initialization order). Stable identity so re-renders don't re-add the listener.
	private readonly graphWheelListener = { handleEvent: this.onGraphWheel, passive: true };

	// Horizontal scrollbar for the graph column: a bottom overlay spanning the lane viewport, shown when
	// the lanes overflow it (column placement only). Track left/width + thumb size/offset are inherited
	// CSS vars (recomputed each render). H-scroll no longer renders, so the thumb offset (`--graph-hscroll-
	// left`) + `aria-valuenow` are re-synced imperatively by `updateHScrollPosition` inside the overlay pass.
	private renderHScrollbar(): TemplateResult | typeof nothing {
		if (this.graphPlacement !== 'column' || this.maxGraphScrollX <= 0) return nothing;

		const max = Math.round(this.maxGraphScrollX);
		const now = Math.round(Math.max(0, Math.min(this.graphScrollX, this.maxGraphScrollX)));
		return html`<div
			class="gl-graph__hscroll"
			role="scrollbar"
			aria-orientation="horizontal"
			aria-label="Scroll the graph lanes horizontally"
			aria-controls="gl-graph-lanes"
			aria-valuemin="0"
			aria-valuemax=${max}
			aria-valuenow=${now}
			tabindex="0"
			@pointerdown=${this.onHScrollTrackDown}
			@click=${(e: Event) => e.stopPropagation()}
			@keydown=${this.onHScrollKeydown}
		>
			<div class="gl-graph__hscroll-thumb" @pointerdown=${this.onHScrollStart}></div>
		</div>`;
	}

	// Maps the thumb's px-extent so a drag of `dx` track-px scrolls `dx * max / travel` content-px (the
	// thumb tracks the cursor 1:1). Recomputed at grab time from the current viewport/content metrics.
	private graphHScrollTravel(): { travel: number; max: number } {
		const max = this.maxGraphScrollX;
		const viewport = Math.max(0, this.graphColumnWidth - this.foldLaneWidth);
		const content = this.gutterWidth;
		const thumb = content > 0 ? Math.max(graphHScrollMinThumbPx, (viewport * viewport) / content) : viewport;
		return { travel: Math.max(1, viewport - thumb), max: max };
	}

	// Drag the scrollbar thumb. rAF-coalesced cumulative-delta (same shape as onGraphResizeStart).
	private onHScrollStart = (event: PointerEvent): void => {
		event.preventDefault();
		event.stopPropagation();
		// Capture the pointer on the thumb (like the other drag handles) so pointerup/cancel still fire —
		// and the drag still ends — when the pointer leaves the webview iframe; otherwise the thumb sticks.
		const thumb = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
		thumb?.setPointerCapture(event.pointerId);
		// Window bucket re-renders are DEFERRED while the thumb drag is live (see applyGraphScroll) —
		// released in cleanup, flushing any held rebuild.
		this.hScrollDragActive = true;
		const startX = event.clientX;
		const startScroll = this.graphScrollX;
		const { travel, max } = this.graphHScrollTravel();
		let rafId: number | null = null;
		let totalDx = 0;
		const flush = (): void => {
			rafId = null;
			const next = Math.max(0, Math.min(max, startScroll + (totalDx / travel) * max));
			if (next === this.graphScrollX) return;

			this.graphScrollX = next;
			this.applyGraphScroll();
		};
		const onMove = (e: PointerEvent): void => {
			totalDx = e.clientX - startX;
			rafId ??= requestAnimationFrame(flush);
		};
		// Forward-declared so `cleanup` can reference it; assigned below (avoids use-before-define).
		let onUp: () => void;
		const cleanup = (): void => {
			if (thumb?.hasPointerCapture(event.pointerId)) {
				thumb.releasePointerCapture(event.pointerId);
			}
			if (rafId != null) {
				cancelAnimationFrame(rafId);
				rafId = null;
			}
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			window.removeEventListener('pointercancel', onUp);
			document.body.style.cursor = '';
			this.resizeDragCleanup = undefined;
			this.hScrollDragActive = false;
			if (this.pendingWindowRender) {
				this.pendingWindowRender = false;
				this.requestUpdate();
			}
		};
		onUp = (): void => {
			flush();
			cleanup();
		};
		// Register so `disconnectedCallback` can tear down a thumb-drag interrupted by a disconnect
		// (mirrors onResizeStart/onGraphResizeStart) — otherwise the window listeners leak onto a
		// detached instance and keep firing applyGraphScroll on it.
		this.resizeDragCleanup = cleanup;
		document.body.style.cursor = 'grabbing';
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
		window.addEventListener('pointercancel', onUp);
	};

	// Click the track (not the thumb — it stops propagation): page the lanes one viewport toward the click.
	private onHScrollTrackDown = (event: PointerEvent): void => {
		const track = event.currentTarget;
		if (!(track instanceof HTMLElement)) return;

		const rect = track.getBoundingClientRect();
		const { travel, max } = this.graphHScrollTravel();
		const thumbLeft = max > 0 ? (this.graphScrollX / max) * travel : 0;
		const viewport = Math.max(0, this.graphColumnWidth - this.foldLaneWidth);
		const dir = event.clientX - rect.left < thumbLeft ? -1 : 1;
		const next = Math.max(0, Math.min(max, this.graphScrollX + dir * viewport * 0.9));
		if (next === this.graphScrollX) return;

		this.graphScrollX = next;
		this.applyGraphScroll();
	};

	// Keyboard: Arrow Left/Right scroll by a lane (Shift = three lanes).
	private onHScrollKeydown = (event: KeyboardEvent): void => {
		const dir = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
		if (dir === 0) return;

		event.preventDefault();
		event.stopPropagation();
		const step = this.columnWidth * (event.shiftKey ? 3 : 1) * dir;
		const next = Math.max(0, Math.min(this.maxGraphScrollX, this.graphScrollX + step));
		if (next === this.graphScrollX) return;

		this.graphScrollX = next;
		this.applyGraphScroll();
	};

	// ─── Column reorder via POINTER events + live drop SIMULATION ───
	// HTML5 drag-and-drop proved unreliable here (its native drag image lingered for seconds in this
	// Electron/WSL compositor, and `drop` intermittently never fired). Pointer events are the robust
	// pattern the resize handle + VS Code's sash use: `pointerup` always fires, no native drag image.
	// Rather than a floating chip + indicator line (which overlapped the columns), the drag SIMULATES the
	// drop — the columns re-render in the tentative order as you drag (recomputed from a frozen base
	// snapshot each frame, so it never oscillates), committed on pointerup and discarded on Escape/cancel.
	private columnDrag: {
		pointerId: number;
		colId: string;
		startX: number;
		startY: number;
		header: HTMLElement;
		captureEl: HTMLElement;
		started: boolean;
		target: number;
		pendingX: number;
		rafId: number | null;
		// Snapshot taken when the drag begins (threshold crossed). The tentative order is always recomputed
		// FROM this base, and the pointer is hit-tested against these frozen column edges — so the columns
		// shifting underneath never feeds back into the targeting. Restored verbatim on cancel.
		base: {
			zones: readonly ZoneSpec[];
			graphColumnPos: number;
			visible: readonly ZoneSpec[];
			visibleSlot: number;
			headerLeft: number;
			slotRights: number[];
			from: number;
		} | null;
	} | null = null;

	// Whole-cell drag handle: a primary press anywhere on a column header cell arms a reorder (the resize
	// handle + the controls stopPropagation on pointerdown, so they're excluded). The drag begins only once
	// the pointer crosses a small threshold. Mirrors `onResizeStart`: preventDefault (else the browser's
	// default pointercancels the drag) + capture the pointer up front (so move/up arrive off the cell, and
	// focus stays keyboard-only — a click no longer focuses the label → no focus ring on click).
	private onColumnPointerDown(event: PointerEvent, colId: string): void {
		// Primary button only, and never start a second drag over an in-flight one (a second touch/stylus
		// would orphan the first pointer's capture + rAF).
		if (event.button !== 0 || this.columnDrag != null) return;

		const cell = event.currentTarget as HTMLElement;
		const header = cell.closest<HTMLElement>('.gl-graph__header');
		if (header == null) return;

		event.preventDefault();
		try {
			cell.setPointerCapture(event.pointerId);
		} catch {
			// no active pointer to capture — the window listeners still drive the drag
		}

		this.columnDrag = {
			pointerId: event.pointerId,
			colId: colId,
			startX: event.clientX,
			startY: event.clientY,
			header: header,
			captureEl: cell,
			started: false,
			target: -1,
			pendingX: event.clientX,
			rafId: null,
			base: null,
		};
		window.addEventListener('pointermove', this.onColumnPointerMove);
		window.addEventListener('pointerup', this.onColumnPointerUp);
		window.addEventListener('pointercancel', this.onColumnPointerCancel);
		window.addEventListener('keydown', this.onColumnDragKeydown);
	}

	private onColumnPointerMove = (event: PointerEvent): void => {
		const drag = this.columnDrag;
		if (event.pointerId !== drag?.pointerId) return;

		if (!drag.started) {
			if (Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY) < 4) return;

			// Threshold crossed → the reorder drag begins; snapshot the base layout to simulate against.
			drag.started = true;
			this.dragColId = drag.colId;
			this.draggingColumn = true;
			this.scheduleHideTooltip();
			this.cancelRowHover();
			document.body.style.cursor = 'grabbing';
			this.captureColumnDragBase();
		}

		// Coalesce to one re-simulation per frame (each re-renders the graph; mirror the resize drag).
		drag.pendingX = event.clientX;
		drag.rafId ??= requestAnimationFrame(this.flushColumnDrag);
	};

	// Snapshot the layout the moment the drag begins: the FULL + VISIBLE zone order, the graph's slot, and
	// each column's right edge (header coords). The simulation recomputes from this and hit-tests against
	// these frozen edges, so the live re-render never disturbs the targeting.
	private captureColumnDragBase(): void {
		const drag = this.columnDrag;
		if (drag == null) return;

		const headerRect = drag.header.getBoundingClientRect();
		const cells = [...drag.header.querySelectorAll<HTMLElement>(':scope > .gl-graph__header-cell')];
		const visible = this.getVisibleZones();
		const cols: string[] = visible.map(z => z.id);
		if (this.graphPlacement === 'column') {
			cols.splice(this.graphVisibleSlot, 0, 'graph');
		}
		drag.base = {
			zones: this.zones,
			graphColumnPos: this.graphColumnPos,
			visible: visible,
			visibleSlot: this.graphVisibleSlot,
			headerLeft: headerRect.left,
			slotRights: cells.map(c => c.getBoundingClientRect().right - headerRect.left),
			from: cols.indexOf(drag.colId),
		};
		drag.target = drag.base.from;
	}

	// rAF flush: find the column the pointer is over (frozen base edges), derive the directional target
	// slot, and — if it changed — re-render the graph in that tentative order (no persist).
	// Hit-test a client X against the FROZEN base column edges → the drop target slot. Directional:
	// hovering a column to the dragged column's right lands AFTER it; to the left lands BEFORE it.
	private columnDropTargetFor(
		base: { headerLeft: number; slotRights: number[]; from: number },
		clientX: number,
	): number {
		const x = clientX - base.headerLeft;
		let hoverIdx = base.slotRights.length - 1;
		for (let i = 0; i < base.slotRights.length; i++) {
			if (x < base.slotRights[i]) {
				hoverIdx = i;
				break;
			}
		}
		return hoverIdx > base.from ? hoverIdx + 1 : hoverIdx;
	}

	private flushColumnDrag = (): void => {
		const drag = this.columnDrag;
		if (drag == null) return;

		drag.rafId = null;
		const base = drag.base;
		if (base == null) return;

		const target = this.columnDropTargetFor(base, drag.pendingX);
		if (target === drag.target) return;

		drag.target = target;
		const result = this.computeColumnReorder(base, drag.colId, target);
		if (result == null) return;

		// FLIP slide: snapshot the current column positions, apply the reorder, then (after the SYNCHRONOUS
		// re-render, before paint) invert + play so every moved column header + body cell slides to its new
		// slot instead of jumping. Clearing first resets any in-flight slide so we measure the true layout.
		this.clearColumnFlipTransforms();
		const before = this.captureColumnCellLefts();
		this.zones = result.zones;
		this.graphColumnPos = result.graphColumnPos;
		this.requestUpdate();
		void this.updateComplete.then(() => this.flipColumns(before));
	};

	// ─── Column-move FLIP slide ───
	private columnFlipCells: HTMLElement[] = [];
	// Handle for the FLIP "play" rAF, so a re-entrant reorder or a disconnect can cancel it before it
	// writes transition styles to (possibly detached) cells.
	private columnFlipRaf: number | null = null;

	// All column cells across the header + visible body rows — the set the FLIP animates.
	private columnCellElements(): HTMLElement[] {
		return [
			...this.querySelectorAll<HTMLElement>('.gl-graph__header-cell'),
			...this.querySelectorAll<HTMLElement>('.gl-graph__row[data-sha] [class*="gl-graph__zone--"]'),
		];
	}

	// Stable identity for matching a cell across the reorder re-render: header cells by `data-col-id`
	// (graph cell by its modifier class); body cells by `row-sha:zone-id`.
	private columnCellKey(el: HTMLElement): string | undefined {
		if (el.classList.contains('gl-graph__header-cell')) {
			if (el.classList.contains('gl-graph__header-cell--graph')) return 'h:graph';
			return el.dataset.colId != null ? `h:${el.dataset.colId}` : undefined;
		}

		const cls = [...el.classList].find(x => x.startsWith('gl-graph__zone--'));
		if (cls == null) return undefined;

		const sha = el.closest<HTMLElement>('.gl-graph__row[data-sha]')?.dataset.sha;
		return sha != null ? `b:${sha}:${cls.slice('gl-graph__zone--'.length)}` : undefined;
	}

	private captureColumnCellLefts(): Map<string, number> {
		const lefts = new Map<string, number>();
		for (const el of this.columnCellElements()) {
			const key = this.columnCellKey(el);
			if (key != null) {
				lefts.set(key, el.getBoundingClientRect().left);
			}
		}
		return lefts;
	}

	// Reset any mid-flight slide transforms so the next capture reads the true (untransformed) layout.
	private clearColumnFlipTransforms(): void {
		if (this.columnFlipRaf != null) {
			cancelAnimationFrame(this.columnFlipRaf);
			this.columnFlipRaf = null;
		}
		for (const el of this.columnFlipCells) {
			el.style.transition = '';
			el.style.transform = '';
		}
		this.columnFlipCells = [];
	}

	// FLIP "invert + play": for each cell that moved, jump it back to its old x (no transition), then on
	// the next frame clear the transform with a transition so it slides to the new slot.
	private flipColumns(before: Map<string, number>): void {
		const moved: { el: HTMLElement; dx: number }[] = [];
		for (const el of this.columnCellElements()) {
			const key = this.columnCellKey(el);
			if (key == null) continue;

			const old = before.get(key);
			if (old == null) continue;

			const dx = old - el.getBoundingClientRect().left;
			if (Math.abs(dx) >= 0.5) {
				moved.push({ el: el, dx: dx });
			}
		}
		if (moved.length === 0) return;

		for (const { el, dx } of moved) {
			el.style.transition = 'none';
			el.style.transform = `translateX(${dx}px)`;
		}
		this.columnFlipCells = moved.map(m => m.el);
		// Cancel any still-pending flip rAF from a rapid re-entrant reorder so its handle can't leak.
		if (this.columnFlipRaf != null) {
			cancelAnimationFrame(this.columnFlipRaf);
		}
		this.columnFlipRaf = requestAnimationFrame(() => {
			this.columnFlipRaf = null;
			for (const { el } of moved) {
				el.style.transition = 'transform 160ms ease';
				el.style.transform = '';
			}
		});
	}

	// Pure: given the base snapshot, the dragged column, and a target gap, produce the reordered FULL zone
	// list + the graph's anchor — splitting the unified visible order back into a zone reorder + graph slot.
	// Same mapping as the committed reorder, but computed from an explicit base so it can run live.
	private computeColumnReorder(
		base: {
			zones: readonly ZoneSpec[];
			graphColumnPos: number;
			visible: readonly ZoneSpec[];
			visibleSlot: number;
		},
		colId: string,
		gap: number,
	): { zones: readonly ZoneSpec[]; graphColumnPos: number } | null {
		const graphIsColumn = this.graphPlacement === 'column';
		const cols: string[] = base.visible.map(z => z.id);
		if (graphIsColumn) {
			cols.splice(base.visibleSlot, 0, 'graph');
		}

		const from = cols.indexOf(colId);
		if (from < 0) return null;

		const target = gap > from ? gap - 1 : gap;
		if (target === from) return { zones: base.zones, graphColumnPos: base.graphColumnPos };

		cols.splice(from, 1);
		cols.splice(target, 0, colId);

		// An inlined graph follows its HOST zone so the pair moves as a group; a column graph moves alone.
		const hostId =
			!graphIsColumn && this.graphPlacement === 'grouped'
				? base.visible[Math.min(base.visibleSlot, Math.max(0, base.visible.length - 1))]?.id
				: undefined;

		let zones = base.zones;
		if (colId !== 'graph') {
			// Move the dragged zone in the FULL list via the shared visible→canonical mapping, so it lands
			// at its new visible slot WITHOUT jumping ahead of canonically-leading hidden zones (e.g. grouped
			// refs at index 0) — the same `reorderZones(mapVisibleIndex(...))` path the keyboard/old reorder
			// uses. The drop lands just before the zone that follows it in the new visible order (or the end).
			const newZoneIds = cols.filter(c => c !== 'graph');
			const newIdx = newZoneIds.indexOf(colId);
			const fromVis = base.visible.findIndex(z => z.id === colId);
			if (fromVis < 0) return null;

			const successorId = newZoneIds[newIdx + 1];
			const toVis = successorId != null ? base.visible.findIndex(z => z.id === successorId) : base.visible.length;
			zones = reorderZones(
				base.zones,
				mapVisibleIndex(base.zones, base.visible, fromVis),
				mapVisibleIndex(base.zones, base.visible, toVis),
			);
		}

		// Reordering never changes WHICH zones are visible — only their order; recompute the visible order.
		const visibleIds = new Set(base.visible.map(z => z.id));
		const updatedVisible = zones.filter(z => visibleIds.has(z.id));
		const graphSlot =
			hostId != null
				? Math.max(
						0,
						updatedVisible.findIndex(z => z.id === hostId),
					)
				: graphIsColumn
					? cols.indexOf('graph')
					: Math.min(base.visibleSlot, updatedVisible.length);
		return { zones: zones, graphColumnPos: this.graphAnchorForVisibleSlotIn(zones, updatedVisible, graphSlot) };
	}

	// Commit the simulated order on release: recompute the final tentative from the base and persist it.
	private onColumnPointerUp = (event: PointerEvent): void => {
		const drag = this.columnDrag;
		if (event.pointerId !== drag?.pointerId) return;

		const base = drag.base;
		const colId = drag.colId;
		const started = drag.started;
		// Recompute the drop slot from the RELEASE position (the last rAF may not have flushed, so
		// `drag.target` can be a frame stale) using the pointerup's own clientX — where the user let go.
		const target = base != null ? this.columnDropTargetFor(base, event.clientX) : drag.target;
		this.endColumnDrag();
		if (!started || base == null) return;

		const result = this.computeColumnReorder(base, colId, target);
		// No NET change → restore base so a mid-drag tentative render can't stick. Must compare the graph
		// slot too: a graph-column drag never rebuilds `zones` (same ref), so comparing `zones` alone would
		// wrongly revert every graph move.
		if (result == null || (result.zones === base.zones && result.graphColumnPos === base.graphColumnPos)) {
			this.zones = base.zones;
			this.graphColumnPos = base.graphColumnPos;
			this.requestUpdate();
			return;
		}

		this.graphColumnPos = result.graphColumnPos;
		this.applyZones(result.zones);
	};

	private onColumnPointerCancel = (event: PointerEvent): void => {
		if (event.pointerId !== this.columnDrag?.pointerId) return;

		this.cancelColumnDrag();
	};

	// Escape discards the in-flight simulation (restores the base order). Stop propagation so it doesn't
	// also reach the viewport's keydown handler and clear the row selection as a side effect.
	private onColumnDragKeydown = (event: KeyboardEvent): void => {
		if (event.key !== 'Escape' || this.columnDrag == null) return;

		event.preventDefault();
		event.stopPropagation();
		this.cancelColumnDrag();
	};

	private cancelColumnDrag(): void {
		const base = this.columnDrag?.base ?? null;
		this.endColumnDrag();
		if (base != null) {
			this.zones = base.zones;
			this.graphColumnPos = base.graphColumnPos;
			this.requestUpdate();
		}
	}

	private endColumnDrag(): void {
		const drag = this.columnDrag;
		this.columnDrag = null;
		if (drag != null) {
			if (drag.rafId != null) {
				cancelAnimationFrame(drag.rafId);
			}
			if (drag.captureEl.hasPointerCapture(drag.pointerId)) {
				drag.captureEl.releasePointerCapture(drag.pointerId);
			}
		}
		window.removeEventListener('pointermove', this.onColumnPointerMove);
		window.removeEventListener('pointerup', this.onColumnPointerUp);
		window.removeEventListener('pointercancel', this.onColumnPointerCancel);
		window.removeEventListener('keydown', this.onColumnDragKeydown);
		document.body.style.cursor = '';
		this.draggingColumn = false;
		this.dragColId = null;
		// Drop any in-flight slide transforms so the committed/cancelled order isn't left visually offset.
		this.clearColumnFlipTransforms();
	}

	// Keyboard reorder for the graph column (Arrow Left/Right): shift its slot among the columns,
	// clamped to [0, visibleZoneCount]. Mirrors the zone label's Arrow-key reorder.
	private onGraphLabelKeydown = (event: KeyboardEvent): void => {
		const dir = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
		if (dir === 0) return;

		event.preventDefault();
		// Move one VISIBLE slot, then store it back as an anchor (so it survives later hide/inline).
		const visible = this._renderCtx?.zones ?? this.getVisibleZones();
		const newSlot = Math.max(0, Math.min(visible.length, this.graphVisibleSlot + dir));
		this.graphColumnPos = this.graphAnchorForVisibleSlot(visible, newSlot);
		this.persistColumnsConfig();
		void this.refocusColumnLabel('graph');
	};

	// Header labels aren't rendered via a keyed `repeat`, so a reorder can leave DOM focus bound to the
	// old SLOT (now a different column) instead of following the column that moved — a second Arrow-key
	// press then moves the WRONG column. Re-query the moved column's label once Lit re-renders and
	// refocus it. Keyboard-reorder only; pointer-drag reorders never call this (no focus to preserve).
	private async refocusColumnLabel(colId: string): Promise<void> {
		await this.updateComplete;
		const selector =
			colId === 'graph'
				? '.gl-graph__header-cell--graph .gl-graph__header-label'
				: `.gl-graph__header-cell[data-col-id="${CSS.escape(colId)}"] .gl-graph__header-label`;
		this.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true });
	}

	// Keyboard resize for the role=separator handle (Arrow Left/Right; Shift = coarse step).
	// Same visible-list resize + merge-back as the pointer drag, persisted immediately.
	private onResizeKeydown(event: KeyboardEvent, visibleZones: readonly ZoneSpec[], visibleIdx: number): void {
		const dir = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
		if (dir === 0) return;

		event.preventDefault();
		const step = (event.shiftKey ? 40 : 8) * dir;
		// Same boundary trade as the pointer drag, applied once and persisted immediately: trade width
		// between this column and its right neighbor, persisting both columns' new preferred widths.
		const result = dragResizeZone(visibleZones, visibleIdx, step);
		if (result == null) return;

		const widthById = new Map(result.savedIds.map(id => [id, result.zones.find(z => z.id === id)?.currentWidth]));
		this.applyZones(
			this.zones.map(z => {
				const w = widthById.get(z.id);
				return w != null ? { ...z, width: w, currentWidth: undefined } : z;
			}),
		);
	}

	// Keyboard reorder for the column label (Arrow Left/Right). Uses the same gap-index +
	// reorderZones path as the drag-drop handler. Gap convention: move-right lands past the right
	// neighbor (gap i+2), move-left lands before the left neighbor (gap i-1).
	private onLabelKeydown(event: KeyboardEvent, visibleZones: readonly ZoneSpec[], visibleIdx: number): void {
		let toVisible: number;
		if (event.key === 'ArrowRight') {
			if (visibleIdx >= visibleZones.length - 1) return;

			toVisible = visibleIdx + 2;
		} else if (event.key === 'ArrowLeft') {
			if (visibleIdx <= 0) return;

			toVisible = visibleIdx - 1;
		} else {
			return;
		}

		event.preventDefault();
		const zoneId = visibleZones[visibleIdx].id;
		const fromFull = mapVisibleIndex(this.zones, visibleZones, visibleIdx);
		const toFull = mapVisibleIndex(this.zones, visibleZones, toVisible);
		this.applyZones(reorderZones(this.zones, fromFull, toFull));
		void this.refocusColumnLabel(zoneId);
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-lit-graph': GlLitGraph;
	}

	interface GlobalEventHandlersEventMap {
		'gl-graph-lanetoggle': CustomEvent<{ tipSha: string }>;
	}
}

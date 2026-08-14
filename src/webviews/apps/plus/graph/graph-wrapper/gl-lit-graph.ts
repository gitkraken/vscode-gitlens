import { colorForColumn } from '@gitkraken/commit-graph/colors.js';
import type { RowAdornment, RowAdornmentProvider } from '@gitkraken/commit-graph/engine/adornments.js';
import { AdornmentRegistry, RowAdornmentInvalidateEvent } from '@gitkraken/commit-graph/engine/adornments.js';
import { collectReachable } from '@gitkraken/commit-graph/engine/layout.js';
import {
	buildChildrenBySha,
	collectForkLanes,
	collectLaneChain,
	findBranchingPointSha,
} from '@gitkraken/commit-graph/engine/navigation.js';
import type { CommitGraphSessionTransition } from '@gitkraken/commit-graph/engine/session.js';
import { CommitGraphEngineSession } from '@gitkraken/commit-graph/engine/session.js';
import type { LaneSegment, ProcessedGraphRow, Sha } from '@gitkraken/commit-graph/engine/types.js';
import type { LaneSweep, LaneWindow } from '@gitkraken/commit-graph/laneClamp.js';
import { computeLaneWindow, laneWindowCovers, resolveGroupedLaneCap } from '@gitkraken/commit-graph/laneClamp.js';
import { computePrefetchDistance } from '@gitkraken/commit-graph/paging.js';
import type { CommitGraphProjectionState } from '@gitkraken/commit-graph/projection.js';
import { CommitGraphProjectionSession } from '@gitkraken/commit-graph/projection.js';
import type { ScopeAnchors, ScopeHeadsPredicate, ScopeProjection } from '@gitkraken/commit-graph/scope.js';
import { computeInScopeShas, computeScopeAnchors } from '@gitkraken/commit-graph/scope.js';
import type { ChangesColumnMode } from '@gitkraken/commit-graph/stats.js';
import {
	changesFitWidth,
	changesModeOrDefault,
	changesStageCompact,
	changesStageForWidth,
} from '@gitkraken/commit-graph/stats.js';
import type {
	GraphPlacement,
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
import { html, LitElement, nothing, render } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { Ref } from 'lit/directives/ref.js';
import { createRef, ref } from 'lit/directives/ref.js';
import '@lit-labs/virtualizer';
import { repeat } from 'lit/directives/repeat.js';
import type { GitGraphRow } from '@gitlens/git/models/graph.js';
import {
	formatDate as formatGitLensDate,
	fromNowUnit,
	fromNowUnitKey,
	fromNow as gitlensFromNow,
	unitDivisorMs,
	unitThresholdMs,
} from '@gitlens/utils/date.js';
import { debounce } from '@gitlens/utils/debounce.js';
import type { Disposable } from '@gitlens/utils/disposable.js';
import type { KeyBindingDescriptor } from '@gitlens/utils/keys/keybinding.js';
import { pluralize } from '@gitlens/utils/string.js';
import type {
	DidSearchParams,
	GraphAvatars,
	GraphColumnConfig,
	GraphColumnName,
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
	GraphRevealMode,
	GraphRowStats,
	GraphScope,
	GraphScrollMarkerTypes,
	GraphSearchMode,
	GraphSelectedRows,
	GraphWipStateById,
} from '../../../../plus/graph/protocol.js';
import { createWipRowId, getWipRowWorktreePath, isWipRowId } from '../../../../plus/graph/protocol.js';
import { cspStyleMap } from '../../../shared/components/csp-style-map.directive.js';
import type { GlPopover } from '../../../shared/components/overlays/popover.js';
import { ModifierKeysController } from '../../../shared/controllers/modifier-keys.js';
import { RovingTabindexController } from '../../../shared/controllers/roving-tabindex.js';
import { dispatchContextMenuAt } from '../../../shared/dom.js';
import type { KeymapDispatcher } from '../../../shared/keymap/keymapDispatcher.js';
import type { RunningOperationBucket } from '../components/detailsState.js';
import type { GlGraphRefFind } from '../components/gl-graph-ref-find.js';
import type { WipRowAgentStatus } from '../components/wipRowAgentStatus.js';
import { createGraphDebugSnapshot, getGraphDebugDiagnostics } from '../graphDebugDiagnostics.js';
import { getExcludedRemotes } from '../hiddenRefs.utils.js';
import type { GraphKeymapScope } from '../keymap/graphKeymap.js';
import type { ChainLaneRun } from '../utils/chainLane.utils.js';
import { computeChainLaneRuns } from '../utils/chainLane.utils.js';
import { laneSeedKey, pickLaneSeed } from '../utils/laneSeed.utils.js';
import { refContextPinKey, refPillKey } from '../utils/refKey.utils.js';
import { serializeWipContext } from '../utils/rowContext.utils.js';
import type { RowMarkerTips } from '../utils/rowMarker.utils.js';
import { isPrimaryWipRow } from '../utils/rowMarker.utils.js';
import { hasDirtyCounts } from '../utils/wip.utils.js';
import { branchHintFor, createLaneCollapseAdornmentProvider } from './adornments/laneCollapseAdornmentProvider.js';
import '../components/gl-graph-ref-find.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/overlays/popover.js';
import '../../../shared/components/overlays/tooltip.js';
import type { LaneCollapseChipContext } from './adornments/laneCollapseAdornmentProvider.js';
import type { ParsedRef, RefPillHooks } from './adornments/refAdornmentProvider.js';
import {
	createRefAdornmentProvider,
	renderIssueTooltipCard,
	renderPullRequestTooltipCard,
	renderRefPill,
	resolveAutoRefPillCap,
	toParsedRefs,
} from './adornments/refAdornmentProvider.js';
import { createWipStatsAdornmentProvider } from './adornments/wipStatsAdornmentProvider.js';
import type { WipStats } from './adornments/wipStatsAdornmentProvider.js';
import type { GraphCommitRef, GraphCommitView, RowRefOrder } from './graph-commit.js';
import { columnsToZones, isRefHidden, pickGhostRef, toGraphCommit, zonesToColumnsConfig } from './graph-commit.js';
import type { FixedSizeLayoutSpecifier } from './graph-fixed-layout.js';
import { fixedSizeVertical } from './graph-fixed-layout.js';
import { GutterCache, gutterEpochSignature } from './graph-gutter-cache.js';
import type { WipNodeState } from './graph-gutter.js';
import { laneSpacing, nodeRadiusFor, renderGutterSvg, renderWavyFilterDefs } from './graph-gutter.js';
import { RowUnitsIndex } from './graph-row-units.js';
import type { RowRenderContext } from './graph-row.js';
import { hasPersistentRowActions, renderChangesCellContent, renderRow } from './graph-row.js';
import type { RowMarkers, ScrollMarker } from './graph-scroll-markers.js';
import {
	buildMergeTargetScrollMarkers,
	buildPinnedScrollMarkers,
	buildSelectionScrollMarkers,
	computeScrollMarkers,
	groupScrollMarkersByRow,
} from './graph-scroll-markers.js';

type LitVirtualizer = HTMLElement & {
	items: readonly unknown[];
	scrollToIndex: (index: number, position?: 'start' | 'center' | 'end' | 'nearest') => void;
	// From LitElement (ReactiveElement): lets callers await the child virtualizer's own commit.
	isUpdatePending: boolean;
	updateComplete: Promise<boolean>;
	// Resolves after the virtualizer has SIZED ITS SPACER and applied its own scroll correction — strictly
	// later than `updateComplete`, which only covers its Lit render. A scroll write that has to survive
	// newly-grown content has to wait for this one (see revealIndexAt).
	layoutComplete?: Promise<void>;
};

// Expanded-density column header height in px (matches `.gl-graph__header` height: 2.4rem @ 1rem=10px).
const headerHeightPx = 24;
// Where a jump parks its target, as a fraction of the viewport (0 = top edge, 0.5 = centered). A third
// leaves the bulk of the viewport BELOW the row, which is the direction history reads in — you jump to a
// tip, a PR head or WIP to walk back from it. Clamping covers the top of the graph for free: WIP and recent
// tips land at `scrollTop = 0` with no special case.
const landingRevealRatio = 1 / 3;
// How far down the viewport a row may sit and still be left alone. Past this line it has less than a third
// of a screen of history under it, which is the thing you came to read, so it gets scrolled up to
// `landingRevealRatio`.
//
// Deliberately NOT equal to the landing: the gap between the two is a deadband. Were they the same, a row
// parked exactly on the line would re-scroll on the next jump, and stepping through search hits would drag
// the viewport a row at a time. With the gap, a landing buys roughly a third of a screen of slack — hits
// walk down a STATIONARY page and the view snaps once, at the end. (vim's `scrolljump` exists for exactly
// this reason.)
const revealComfortRatio = 2 / 3;
// Motion for a reveal that moves, lifted wholesale from VS Code's `SmoothScrollingOperation` so a graph
// jump reads like every other animated scroll in the window: 125ms (`SMOOTH_SCROLLING_TIME`,
// editor/common/viewLayout/viewLayout.ts) on an ease-out cubic.
// Scaled by how far the slide actually travels, between these bounds. A fixed duration is right for an
// editor, where scrolls span a narrow range; here the same animation covers anything from a few rows to a
// couple of screens, and one number can't be both snappy for the former and legible for the latter. VS
// Code's 125ms sits between them.
const smoothRevealMinDurationMs = 90;
const smoothRevealMaxDurationMs = 180;
// How long a bare Ctrl or Alt hold must be sustained before the lane dim engages. Longer than a
// chord-disambiguation window needs to be on its own: both modifiers front everyday gestures — Ctrl+click
// multi-select aiming, Ctrl+C, Ctrl+F, Alt+click alt-action aiming — and at 200ms those routinely outlived
// the delay and flashed the dim; 500ms reads as "deliberately holding", not "slow chord".
const holdEngageDelayMs = 500;
// How long a peeked card's re-anchor keeps retrying for the landing row's element before giving up —
// generous because a jump (End/Home) can page rows in from git before the landing row exists at all.
const peekReanchorDeadlineMs = 1000;
// The furthest a reveal animates, in viewports — and for a longer jump, how far out it cuts to before
// running that same animation in. One number, so every animated arrival is the same gesture regardless of
// how far the jump was.
//
// It is also the honest ceiling on animating a virtualized list: the rows swept past have to be rendered as
// they're crossed, and beyond a couple of viewports at this duration that outruns the virtualizer and shows
// as blanks streaming by.
const smoothRevealMaxSpan = 2.5;

/** VS Code's easing for the same operation: fast off the mark, settling into the destination. */
function easeOutCubic(t: number): number {
	return 1 - (1 - t) ** 3;
}

/** Read live rather than cached — the OS setting can change while the webview is open, and a reveal that
 *  animates after the user asked for less motion is exactly the case this guards. */
function prefersReducedMotion(): boolean {
	return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}
// Dead center. Only the scroll-marker rail wants it (see `jumpToScrollMarker`).
const centerRevealRatio = 0.5;
// How close (px) the cursor must be to a scroll-marker row for it to highlight/tooltip — a "magnet"
// so dense, merged markers are each reachable by sweeping, without false hits over empty rail.
const scrollMarkerMagnetPx = 8;
// Vertical gap (px) left between adjacent rows' block ticks so they don't squish/merge.
const scrollMarkerGapPx = 1;
/** The scroll rail's row scale — see `scrollMarkerScale`. */
type ScrollMarkerScale = {
	/** Per-row pixel pitch on the rail. */
	markerRowPx: number;
	/** The UNDERFILLED branch: bands sit at real pixel rows rather than the index/total spread. */
	realRowPositions: boolean;
};
// Max block-tick height (px) — in a small graph the per-row rail span approaches the full row height,
// and row-sized bricks read as UI chrome instead of position ticks. Kept near the line shapes' caps
// (fullLine 4, thinLine 2) so the three shapes read as one scaled family, not chrome vs hairlines.
const scrollMarkerMaxBlockPx = 6;
// Pointer travel (px) past which a rail press becomes a drag-scrub (vs. a click-to-jump on release).
const scrollMarkerDragThresholdPx = 3;
// Width (px) of the dedicated lane-fold strip prepended to the lanes when folding is enabled — wide
// enough for the chevron toggle, narrow enough to not crowd the lanes.
const foldLaneWidthPx = 14;
// Minimum width (px) of the graph column's horizontal scrollbar thumb, so it stays grabbable even when
// the lane content vastly overflows a narrow viewport.
const graphHScrollMinThumbPx = 24;
// Fallbacks for the GROUPED inline lane cap when the `gitlens.graph.lanes.grouped.*` settings are absent:
// at least `min` lanes always show (when the graph has that many); the cap grows dynamically up to `max`%
// of the row width, so wider views show more lanes before collapsing the rest to the edge.
const defaultGroupedMinLanes = 10;
const defaultGroupedMaxPercent = 40;
// Codicon shown in a column header in place of the text label when the column is too narrow to fit it
// (legacy behavior — see `headerLabelFits`). The graph column uses 'gl-graph' (handled inline).
const zoneHeaderIcons: Record<ZoneId, string> = {
	ref: 'git-branch',
	message: 'comment',
	author: 'account',
	datetime: 'calendar',
	changes: 'request-changes',
	sha: 'git-commit',
};
// Whether an uppercased header label fits the given label-area width (px): ≈7px/char + the resize
// handle + padding. Below this the header swaps the text for its icon.
function headerLabelFits(label: string, areaPx: number): boolean {
	return areaPx >= label.length * 7 + 28;
}
// Footprint (px) of the pinned settings gear over the trailing header cell's tail (button + edge
// inset); the trailing HEADER cell renders narrower by this so its label/icon never sit under it.
const headerActionPx = 24;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** Injected into `computeScopeAnchors` so the engine can resolve the focal branch's tip without
 *  knowing about GitLens ref metadata — the scope math only asks "does this row carry that head?".
 *
 *  One predicate per NAMESPACE rather than one that tries locals then remotes, because
 *  `computeScopeAnchors` takes the FIRST matching row in load order: a local branch literally named
 *  `origin/x` is legal and distinct, and a per-row "locals first" test would still let the remote's newer
 *  row win the race before the local's row is ever reached. The scope's own ref id says which namespace it
 *  meant, so resolve in that one alone. */
const rowHasLocalHead: ScopeHeadsPredicate<GitGraphRow> = (row, branchName) =>
	row.heads?.some(h => h.name === branchName) === true;

/** Remote heads are stored SPLIT (`owner` + a bare `name`) by both providers, while a scope names them
 *  qualified (`origin/x`), so they have to be recomposed to compare — without this a remote-branch scope
 *  resolves no focal tip at all, which leaves it with neither a re-root nor a dim. */
const rowHasRemoteHead: ScopeHeadsPredicate<GitGraphRow> = (row, branchName) =>
	row.remotes?.some(r => `${r.owner}/${r.name}` === branchName) === true;

/** Ref-pill segments that own a tooltip of their own, in the order `expandedTwinIfCovered` tests them. */
const pillTooltipSegmentClasses = [
	'gl-graph__ref-pill-upstream',
	'gl-graph__ref-pill-pr',
	'gl-graph__ref-pill-issue',
] as const;

// Lazily-created offscreen canvas 2D context reused for text measurement (`measureText`) — never
// attached to the DOM. Used to size the date column to its NORMAL (non-compact) format on autosize.
let textMeasureCanvas: HTMLCanvasElement | undefined;
function getTextMeasureContext(): CanvasRenderingContext2D | null {
	textMeasureCanvas ??= document.createElement('canvas');
	return textMeasureCanvas.getContext('2d');
}

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

// Sticky-timeline bucket for the row scrolled to the top of the viewport (see `updateStickyTimelineBucket`).
// Groups mirror the Date column's OWN `fromNow` relative-time families exactly (same unit/threshold
// table, via `fromNowUnit`) — NOT calendar-midnight day buckets — so the pill never disagrees with what
// a row's own date cell reads. `key` is dynamic (e.g. `week:3`) since the edge-gate just compares keys.
type StickyTimelineGroup = {
	key: string;
	label: string;
	/** Elapsed-ms window [lo, hi) this group covers, magnitude (days/weeks/… ago). `hi` undefined = an
	 *  open-ended (year) group — formatted as "before <lo's date>" instead of a range. */
	lo: number;
	hi?: number;
};

// Classifies `dateMs` relative to `nowMs` into a sticky-timeline group — pure arithmetic over
// `fromNowUnit`'s own threshold table (no Date allocation when both args are numbers, as they always
// are here), so this is safe to call per row. today/yesterday/"this week" collapse the column's
// second/minute/hour/day-2-6 families the same way a Date cell's OWN relative text would read them.
// Windows are clamped to the ADJACENT unit's real threshold (not just `n+1` steps of the same divisor)
// so [lo,hi) exactly tiles what `fromNowUnit` actually produces — e.g. week:4's naive hi (35d) would
// overshoot into where classification has already flipped to 'month' (~30.42d); year:1's naive lo (365d)
// would undershoot into where it's still 'month' (year requires ~729d elapsed before it triggers at all).
function stickyTimelineGroupFor(dateMs: number, nowMs: number): StickyTimelineGroup {
	const day = unitDivisorMs('day');
	// Future dates (clock skew, an intentionally future-dated commit) — no sensible "in N days" bucket;
	// read as "now" like a Date cell showing a sub-day relative time would.
	if (dateMs > nowMs) return { key: 'today', label: 'Today', lo: 0, hi: day };

	const result = fromNowUnit(dateMs, nowMs);
	if (result == null) return { key: 'today', label: 'Today', lo: 0, hi: day };

	const { unit, value } = result;
	const n = Math.abs(value);
	switch (unit) {
		case 'second':
		case 'minute':
		case 'hour':
			return { key: 'today', label: 'Today', lo: 0, hi: day };
		case 'day':
			if (n <= 1) return { key: 'yesterday', label: 'Yesterday', lo: day, hi: 2 * day };
			return { key: 'week', label: 'This week', lo: 2 * day, hi: unitDivisorMs('week') };
		case 'week': {
			const week = unitDivisorMs('week');
			const monthThreshold = unitThresholdMs('month');
			if (n <= 1) {
				return { key: 'week:1', label: 'Last week', lo: week, hi: Math.min(2 * week, monthThreshold) };
			}
			return {
				key: `week:${n}`,
				label: `${n} weeks ago`,
				lo: n * week,
				hi: Math.min((n + 1) * week, monthThreshold),
			};
		}
		case 'month': {
			const month = unitDivisorMs('month');
			const yearThreshold = unitThresholdMs('year');
			if (n <= 1) {
				return { key: 'month:1', label: 'Last month', lo: month, hi: Math.min(2 * month, yearThreshold) };
			}
			return {
				key: `month:${n}`,
				label: `${n} months ago`,
				lo: n * month,
				hi: Math.min((n + 1) * month, yearThreshold),
			};
		}
		default: {
			// 'year' — the only other unit fromNowUnit's table can return. year:1's true reachable window
			// starts at the YEAR THRESHOLD (~729d), not `1 * yearDivisor` (365d) — everything from 365d up
			// to the threshold is still classified 'month'; year:2+ aren't affected (n*year already clears
			// the threshold). `hi` deliberately stays undefined — stickyTimelineSpanFor reads that as
			// "open-ended" and formats "before <date>" instead of a bounded range (a year group's window
			// still gets a real reclassification bound, just computed separately — see
			// updateStickyTimelineBucket, which can't reuse group.hi here without losing that formatting).
			const lo = n <= 1 ? unitThresholdMs('year') : n * unitDivisorMs('year');
			return { key: `year:${n}`, label: `${n} years ago`, lo: lo };
		}
	}
}

// Allocation-free sibling of `stickyTimelineGroupFor` — same classification (including the future-date
// guard) but returns a plain number instead of building the group object (label/lo/hi), for the PER-ROW
// hairline comparison (renderRowItem calls this twice per row; must stay zero-allocation). Every group
// `stickyTimelineGroupFor` distinguishes maps to a distinct number here too — bases are spaced 100,000
// apart so `n` can grow arbitrarily large within a family without colliding with the next one.
function stickyTimelineGroupKeyFor(dateMs: number, nowMs: number): number {
	if (dateMs > nowMs) return 0; // future → 'today', same as stickyTimelineGroupFor.

	const raw = fromNowUnitKey(dateMs, nowMs);
	if (raw == null) return 0;

	// fromNowUnitKey's ordinal order: 0=year, 1=month, 2=week, 3=day, 4=hour, 5=minute, 6=second.
	const ordinal = Math.trunc(raw / 100_000);
	const n = Math.abs(raw - ordinal * 100_000);
	switch (ordinal) {
		case 4: // hour
		case 5: // minute
		case 6: // second
			return 0; // 'today'
		case 3: // day
			return n <= 1 ? 1 /* yesterday */ : 2; /* this week */
		case 2: // week
			return n <= 1 ? 100_000 /* last week */ : 100_000 + n;
		case 1: // month
			return n <= 1 ? 200_000 /* last month */ : 200_000 + n;
		default: // 0 = year
			return 300_000 + n;
	}
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

/** Which surface of a hovered row the pointer is over (see `handleRowHover`). 'content' = the
 *  message/author/date/sha cells (schedules the rich commit card); 'graph' = the lanes/commit-dot
 *  column (tracks only — no card today, but the seam for a future lane/branch hover card). Threaded
 *  into the emitted `gl-graph-rowhover*` events' detail so the wrapper can forward it accurately. */
type RowHoverZone = 'content' | 'graph';

/**
 * Render-ready geometry for one chain-lane run (see `buildChainLaneBox`) — the pixel counterpart of a
 * `ChainLaneRun`, consumed by `syncChainLaneOverlay`.
 *
 * `top`/`height` are the CLIP CONTAINER's box (content px) — it always starts where the rule does and
 * spans down through the rule and, when present, the elbow. `ruleHeight` is the rule's OWN height within
 * that container (the rule always starts at the container's top, i.e. relative top 0, so no separate
 * offset is needed for it).
 */
type ChainLaneBox = {
	top: number;
	height: number;
	ruleHeight: number;
	x: number;
	color: string;
	/** The reach into the run's fork point — present only for a `'fork'`-kind `ChainLaneExtension`; a
	 *  `'clamp'` just makes the rule taller (`ruleHeight`/`height` above), with no elbow to draw. */
	elbow?: {
		height: number;
		/** Absolute content-space px (NOT relative to the chain x) — see the CSS comment on
		 *  `.gl-graph__chain-lane-elbow` for how these land the border precisely. */
		left: number;
		width: number;
		/** Which side of the chain column the fork sits on — selects the `is-elbow-left`/`-right` CSS
		 *  variant (which edge carries the vertical border + corner). */
		direction: 'left' | 'right';
	};
};

/** A keyboard peek request emitted as `gl-graph-rowpeek` — open/close the rich hover card on the FOCUSED
 *  row, or move an open one onto it. `open` is an out parameter: the wrapper (and the app behind it)
 *  answer synchronously, which is the graph's only view of whether the card is up. */
export type GraphRowPeekRequest =
	| { action: 'toggle' | 'reanchor'; sha: string; anchor: HTMLElement; open: boolean }
	| { action: 'close' };

/** Why a loaded row isn't rendered — see {@link GlLitGraph.getRowHiddenReason}. */
export type GraphRowHiddenReason =
	| 'collapsed'
	| 'excluded-ref'
	| 'excluded-type'
	| 'visibility'
	| 'scope'
	| 'search-filter'
	| 'unknown';

/** The ref narrowing a row-visibility pass runs under. An absent member means that class isn't narrowing. */
type RefVisibilityFilter = {
	includeOnly?: GraphIncludeOnlyRefs;
	excludeRefs?: GraphExcludeRefs;
	hideHeads: boolean;
	hideRemotes: boolean;
	hideTags: boolean;
};

/** Classes of narrowing to resolve as if unset — how `getRowHiddenReason` asks which one dropped a row. */
type RefVisibilityWaivers = { excludeRefs?: boolean; excludeTypes?: boolean; includeOnly?: boolean };

/** Every ref tip visible — the baseline the narrowed passes are measured against. */
const allRefsVisible: RefVisibilityFilter = { hideHeads: false, hideRemotes: false, hideTags: false };

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
	/** Shared ref to the host's per-sha diffstat map for the Changes column (absent key = still pending). */
	rowsStats?: Readonly<Record<string, GraphRowStats>>;
	style: ResolvedGraphStyle;
	graphPlacement: GraphPlacement;
	/** Visible-column slot the graph occupies (column mode) — interleaved among the zone cells. */
	graphColumnPos: number;
	/** Host zone id the grouped lanes render in (see `graphHostIdFor`); undefined = anchor-slot fallback. */
	graphHostId: string | undefined;
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
	/** Quantized-row unit span at `index` — 1 for an ordinary row; > 1 spans that many base `rowHeight`s
	 *  (the refs-own-line consumer's promoted rows). Reduces to a constant 1 under the uniform row-units
	 *  index (setting off, or no consumer active), which is what keeps every 1-unit row's markup unaffected. */
	unitsOf: (index: number) => number;
	/** 0-based unit within `unitsOf(index)` the row's commit data (dot, sha/author/date, message) sits on.
	 *  0 for a 1-unit row. */
	dataUnitOf: (index: number) => number;
	nodeMode: 'compact' | 'avatar';
	nodeAvatars: boolean;
	selected: ReadonlySet<string>;
	/** Row a jump just landed on, while its announcing flash plays (see `_landingFlashSha`). */
	landingFlashSha?: string;
	focusedSha: string | undefined;
	anchorShas?: ReadonlySet<string>;
	focalTipShas?: ReadonlySet<string>;
	forkPointShas?: ReadonlySet<string>;
	mergeTargetShas?: ReadonlySet<string>;
	inScopeShas?: ReadonlySet<string>;
	/** Shas matched by the active search (undefined = no active search). Drives row highlight + the
	 *  dimming of non-matches. Empty set = active search with 0 results (dims every row). */
	searchMatchedShas?: ReadonlySet<string>;
	/** Active search mode — matches are highlighted only in `normal`. */
	searchMode?: GraphSearchMode;
	/** Lane chain of the focused ref/row → `.is-inRefChain` rows (others dim). Bounded at the merge base. */
	inRefChainShas?: ReadonlySet<string>;
	/** The active chain is the transient Ctrl-hold peek (lighter dim) rather than the click-pin (full dim). */
	chainTransient?: boolean;
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
	/** sha → owning pinned head sha, for pinned-lane ghost-ref resolution (pinned lanes never form a
	 *  `segmentByCommit` entry). */
	pinnedTipByCommit: ReadonlyMap<string, string>;
	/** Shas that are members of the current trunk segment — scopes the `trunkTipSha` ghost fallback to
	 *  rows actually on that lane. */
	trunkCommitShas: ReadonlySet<string>;
	/** Segment tips that are worktree WIP rows — ghost resolution hops these to their first parent
	 *  (the branch tip that actually carries the ref; a WIP row's `commitRefs` is always empty). */
	wipSegmentTips: ReadonlySet<string>;
	/** Tip shas currently collapsed (drives `aria-expanded` on collapsible treeitems). */
	collapsedTips: ReadonlySet<string>;
	/** sha → clean/dirty for workdir rows; absent key = no glyph (stats not yet loaded). */
	wipStateBySha: ReadonlyMap<string, WipNodeState>;
	/** sha → running compose/review operation + agent status for the workdir rows' action buttons. */
	runningOperationByRowSha?: ReadonlyMap<string, RunningOperationBucket>;
	agentStatusByRowSha?: ReadonlyMap<string, WipRowAgentStatus>;
	/** Per-worktree hot WIP state (stats + conflicts + paused op), keyed by WIP row id. Covers every
	 *  worktree, the graph's own included. */
	wipStateById?: GraphWipStateById;
	/** The graph's own worktree's WIP row id, when that row renders — the inline Resolve action is
	 *  gated to it; peers surface conflicts via the details-header chip instead. */
	primaryWipRowId?: string;
	/** The current worktree's row-marker tips (HEAD / upstream / merge-target shas + target name) — the
	 *  SAME object on every row; drives the left-edge rail on the (≤3) rows those tips land on. */
	rowMarkerTips?: RowMarkerTips;
	/** Prebuilt row-marker ref pill for the primary WIP row (built once per render from the HEAD row's
	 *  refs), threaded to the row so it never re-derives it. Undefined when the pill shouldn't show. */
	wipRowMarkerPill?: TemplateResult;
}

// Changes-column mode picker: the four visualizations as an ordered glyph strip. Labels drive the
// delegated tooltip + the accessible name; order matches the native menu.
const changesModeOptions: readonly { mode: ChangesColumnMode; label: string }[] = [
	{ mode: 'numbers', label: 'Numbers' },
	{ mode: 'squares', label: 'Squares' },
	{ mode: 'bar', label: 'Bar' },
	{ mode: 'bipolar', label: 'Bipolar' },
];

// Static glyph templates for the mode picker — tiny iconographic shapes at glyph scale (fixed, no
// data). Allocated once at module load and reused every render. Plain spans only (no custom elements);
// all sizing/colors live in graph.scss. NO minus-notch at this scale (illegible — deliberate).
const changesModeGlyphs: Record<ChangesColumnMode, TemplateResult> = {
	numbers: html`<span class="gl-graph__changes-mode-glyph-numbers"
		><span class="gl-graph__changes-mode-glyph-added">+N</span
		><span class="gl-graph__changes-mode-glyph-deleted">−N</span></span
	>`,
	squares: html`<span class="gl-graph__changes-mode-glyph-squares"
		>${(['added', 'added', 'added', 'added', 'deleted'] as const).map(
			fill =>
				html`<span
					class="gl-graph__changes-mode-glyph-square gl-graph__changes-mode-glyph-square--${fill}"
				></span>`,
		)}</span
	>`,
	bar: html`<span class="gl-graph__changes-mode-glyph-track"
		><span class="gl-graph__changes-mode-glyph-bar-added"></span
		><span class="gl-graph__changes-mode-glyph-bar-deleted"></span
	></span>`,
	bipolar: html`<span class="gl-graph__changes-mode-glyph-track"
		><span class="gl-graph__changes-mode-glyph-bipolar-axis"></span
		><span class="gl-graph__changes-mode-glyph-bipolar-deleted"></span
		><span class="gl-graph__changes-mode-glyph-bipolar-added"></span
	></span>`,
};

// The managed-focus controls inside a row. Sub-chips (upstream-jump / PR / issue) match THEMSELVES, not
// the pill containing them, so each is its own stop.
const rowControlSelector = '.gl-graph__row-action, [data-ref-metadata-type], .gl-graph__ref-pill';

/**
 * The commit graph renderer. Owns the `<lit-virtualizer>` row list, the engine pipeline
 * (GitGraphRow → GraphCommitView → package-owned `CommitGraphEngineSession`), container-focus keyboard
 * nav, and the delegated interaction model. Emits the `gl-graph-*` events `<gl-graph-wrapper>` consumes.
 *
 * Light DOM (`createRenderRoot` returns `this`) so VS Code's native `data-vscode-context` menu
 * resolution works and global `graph.scss` styles apply.
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
	// True while the host is still computing per-row diffstats (rowsStats) — drives the Changes header's
	// loading spinner. The wrapper only passes this (and rowsStats) while the Changes column is visible,
	// so a hidden column never spins nor re-renders on stats deltas.
	@property({ type: Boolean }) rowsStatsLoading = false;
	// False = the Changes column is dormant (stats consent not yet given): it renders an opt-in overlay
	// over its rows area instead of stats. The host pushes this from `graph.changesColumn.enabled`.
	@property({ type: Boolean }) changesColumnEnabled = true;
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
	// highlight/dim (normal) and the displayRows filter (filter).
	@property({ type: String }) searchMode?: GraphSearchMode;
	@property({ type: Object }) config?: GraphComponentConfig;
	@property({ type: Object }) columns?: GraphColumnsSettings;
	// Host's ack of our latest columns write (see persistColumnsConfig / shouldApplyIncomingColumns).
	@property({ type: Number }) columnsRevision = 0;
	// Selected repo path — needed to reconstruct lean commit rows' right-click context (the host now
	// ships only `contexts.flags`, not a serialized `contexts.row`); see toGraphCommit.
	@property({ type: String }) repoPath?: string;
	@property({ type: Object }) scope?: GraphScope;
	@property({ type: Object }) wipStateById?: GraphWipStateById;
	/** The graph's own worktree's WIP row id, when it renders — see {@link RowRenderContext.primaryWipRowId}. */
	@property({ type: String }) primaryWipRowId?: string;
	// The current branch's merge-target tip + name, pulled client-side via the scope-anchor pipeline. HEAD
	// and the upstream tip are derived locally (from `this.headSha` and `refRowIndex`); this is the only leg
	// the client can't compute itself. Drives the merge-target role on the rail + the ref pill's target
	// segment. Absent until the pull lands / when there's no real target (default branch, detached).
	@property({ attribute: false }) rowMarkerMergeTarget?: { sha: string; name?: string };
	// Per-row WIP state for the row-action buttons: running compose/review operations (status icons)
	// and attached AI-agent status (the agent indicator). Drive the buttons' live updates.
	@property({ attribute: false }) runningOperationByRowSha?: ReadonlyMap<string, RunningOperationBucket>;
	@property({ attribute: false }) agentStatusByRowSha?: ReadonlyMap<string, WipRowAgentStatus>;
	@property({ type: Boolean }) loading?: boolean;
	// Whether the host has more rows to page in. The element can't infer it, and without it every paging
	// trigger keeps firing dead events at the end of history — including the screen-reader "loading more"
	// announcement, which `dispatchMoreRows` makes before the wrapper's guards can reject the ask.
	@property({ type: Boolean }) hasMore?: boolean;
	// VS Code host-window focus state — undefined/true = focused. Dims the selection accent to the
	// inactive tone (see `gl-graph--window-unfocused` in graph.scss) when the window loses focus,
	// matching VS Code's own list/tree views.
	@property({ type: Boolean }) windowFocused?: boolean;
	// Host-serialized `data-vscode-context` JSON strings (the single source of truth, matching the
	// host's exact token format). `columnsContext` (gitlens:graph:columns) drives the column-header
	// right-click menu; `settingsContext` (gitlens:graph:settings) drives the header gear's menu
	// (columns + scroll-marker toggles); `scrollMarkersContext` (gitlens:graph:scrollMarkers) drives the
	// marker rail's own right-click menu — the same toggles, flattened, without the column items. All
	// update via DidChangeColumns / DidChangeScrollMarkers.
	@property({ type: String }) columnsContext?: string;
	@property({ type: String }) settingsContext?: string;
	@property({ type: String }) scrollMarkersContext?: string;
	// Ref-visibility filters (Hide branch / Hide Remotes·Tags·Stashes). Applied client-side: hidden
	// heads/remotes/tags drop from the ref pills + scroll-rail markers (the current HEAD is always
	// kept), and `excludeTypes.stashes` drops stash rows from the engine input.
	// The host re-pushes these via DidChangeRefsVisibility WITHOUT re-querying rows, so the filtering is
	// the webview's responsibility.
	@property({ type: Object }) excludeRefs?: GraphExcludeRefs;
	@property({ type: Object }) excludeTypes?: GraphExcludeTypes;
	// Per-upstream-name → tracking local branch names (packages/git-cli's `downstreamMap`, keyed
	// `${remoteOwner}/${branchName}`). Lets a tracked remote survive the "Hide Remote Branches" toggle
	// (isRefHidden). It no longer feeds the `upstream` scroll-rail marker — that follows HEAD's own upstream
	// (`ref.current`), not every remote some local branch happens to track.
	@property({ type: Object }) downstreams?: GraphDownstreams;
	// Branches-visibility narrowing (Current/Smart/Favorited). When set, only commits reachable from an
	// included ref tip stay visible; empty/undefined means "all branches". Applied client-side (the host
	// ships the full `--all` row set and re-pushes this without re-querying), so it's the webview's job.
	@property({ type: Object }) includeOnlyRefs?: GraphIncludeOnlyRefs;
	// Branch pinned to the leftmost lane(s) (gitlens.graph.pinBranchToEdge). Resolved to a sha and fed
	// to the engine as `pinnedShas`; a floating "Jump to Pinned Branch" pill scrolls to it when off-screen.
	@property({ type: Object }) pinnedRef?: GraphPinnedRef;
	// Full `owner/name` of the CURRENT branch's upstream (`branchState.upstream`). Ranks that remote's
	// pill right after the pins on every row — including the rows HEAD's own pill isn't on, which is all
	// of them once HEAD is ahead of or behind it. See `RowRefOrder`.
	@property({ type: String }) currentUpstream?: string;
	// The CURRENT branch payload (`graphState.branch`) — the host-side authority on HEAD's identity.
	// Fallback source for the row-marker tips + the WIP row's proxy pill when HEAD's row isn't in the
	// loaded page (the engine's `headSha` comes from per-row `isCurrentHead` decoration, so it can't
	// resolve there). A jump off the fallback pages the row in via the wrapper's load/select/reveal.
	@property({ attribute: false }) currentBranch?: {
		name: string;
		sha?: string;
		detached?: boolean;
		upstream?: { name: string; missing: boolean };
	};
	// Columns whose header filter is currently active (derived host-side from the search query's
	// operators — see graph-header's `updateActiveFilterColumns`). A filterable column's header filter
	// button is persistently shown + accent-toned when its id is in this set, and its 22px footprint
	// joins that cell's label-fit math (see `renderHeader`). Hover/focus reveal is CSS-only and never
	// touches this or the zone-width solver.
	@property({ attribute: false }) activeFilterColumns?: ReadonlySet<GraphColumnName>;
	// The webview's key dispatcher (owned by `gl-graph-app`, forwarded through the wrapper). Set after
	// construction, so the `rows` scope + bindings register on the first update that sees it — see
	// `registerKeymap`.
	@property({ attribute: false }) keymap?: KeymapDispatcher<GraphKeymapScope>;

	@state() private containerWidth = 0;
	@state() private focusIndex = 0;
	// Fixed end of a range selection (Shift+Arrow / Shift+Click). Reset to the landing row on any plain
	// (non-shift) navigation so the next Shift+Arrow extends from where the user last landed.
	// Held as a SHA, not an index: display rows are re-projected under the user (fold-all, scope change,
	// paging), and a raw index would silently name a different commit afterwards.
	private _selectionAnchorSha?: string;
	// Column-header drag-reorder state. The drag SIMULATES the drop (columns re-render in the tentative
	// order), so the only reactive bit is `dragColId` — the id of the column being dragged — which marks
	// its cell as the lifted one. The rest of the drag (base snapshot, target, rAF) lives in `columnDrag`.
	@state() private dragColId: string | null = null;
	// Where the lane art renders. Grouped by default (mirrors refs) — the lanes fold into the anchor-slot
	// host zone. Persisted via the columns config (`graph.grouped`; `isHidden` from the host's column menu
	// always wins).
	@state() private graphPlacement: GraphPlacement = 'grouped';
	// The graph's ANCHOR position: an insert-index into the FULL ordered zone list (`this.zones`,
	// including hidden / inline-refs zones), NOT the visible list. The VISIBLE slot is DERIVED from this
	// each render (`graphVisibleIndex`) by counting how many visible zones precede the anchor — so
	// hiding/inlining/reordering a column to the graph's left shifts its visible slot automatically and
	// can never desync. drag/Arrow-key reorder map the visible target back to an anchor. Persisted via
	// the columns config (`graph.order`).
	@state() private graphColumnPos = 0;
	// Derived once per render in `updateRenderState`: the graph's VISIBLE-slot index (anchor projected
	// through the current visible zones). Read by the header; passed to rows as `ctx.graphColumnPos`.
	private graphVisibleSlot = 0;
	// Where refs (branches/tags/remotes) render: 'grouped' = pills at the head of their host column —
	// the zone adjacent to Refs at group-time (`refsHostZoneId`), falling back to Message — anchored BY
	// ID via `refsHostIdFor` so the group travels with it through reorders (default); 'column' = a
	// dedicated Refs column (expanded density only, where columns exist). Persisted via the columns
	// config (`ref.grouped`), matching `graphPlacement`.
	@state() private refsPlacement: RefsPlacement = 'grouped';
	// Ref find widget visibility (the header's search button and `/`). Not persisted — a find is a
	// momentary navigation, not a view mode.
	@state() private refFindOpen = false;
	// Which trigger opened the finder, for telemetry — tells us whether the header button is earning
	// its width or whether `/` is carrying the feature.
	private _refFindOpenedBy: 'shortcut' | 'button' = 'button';
	// Element that held focus when `/` opened the finder, so dismissing it hands the keyboard back
	// instead of relocating it to the rows — `/` fires from anywhere in the webview, so "wherever you
	// were" is often not the graph. Cleared once a commit lands (see `onRefFindJump`), because from then
	// on the landed ROW is where you want to be.
	private _refFindReturnFocus?: HTMLElement;
	// Pill key of the ref the find widget last landed on — that pill wears the selected/hover fill so
	// it's identifiable among the others on its row. Read live by the ref-pill hooks.
	private _refFindHitKey?: string;
	// Sha of the row whose landing flash is playing, or undefined for none. Keyed on the SHA rather than as a
	// viewport-level flag over `.is-selected`: the class outlives the write that armed it by 700ms, and a
	// selection moving inside that window would hand the wash to a row that never earned it (a click right
	// after a jump). The row renderer reads this, so virtualizer recycling can't carry it either.
	@state() private _landingFlashSha?: string;
	private _landingFlashTimer?: ReturnType<typeof setTimeout>;
	// Sha of a find target the host is still paging in, with the row index it was last revealed at.
	private _refFindLoadingSha?: string;
	private _refFindLoadingRevealedIndex?: number;
	// Adjacent zone id captured at group-time by `toggleRefsPlacement` (undefined = use the Message
	// fallback). Persisted via the columns config round-trip (`ref.grouped`'s string value; see
	// `buildColumnsConfig`).
	@state() private refsHostZoneId: string | undefined;
	// Host zone the GRAPH groups into, captured at group-time — mirrors `refsHostZoneId` BY ID so the
	// [graph + host] pair travels together through reorders. Persisted via the columns config
	// (`graph.grouped`'s string value; see `currentGraphColumnConfig`). Undefined = fall back to the
	// anchor slot (`graphHostIdFor`) — also covers legacy persisted `grouped: true`.
	@state() private graphHostZoneId: string | undefined;
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
	// Name of the click-pinned ref pill: keeps it expanded (the `.is-pinned` class, read live off this
	// field via `refPillHooks.getPinnedRefKey` — see `renderRefPill`) and drives the dim chain above +
	// the click toggle. Undefined = nothing pinned. Same treatment for `_contextPinnedRefKey` below
	// (the `.is-context-pinned` class, forced open while a native context menu sits over the pill —
	// see `pinRefPill`/`unpinRefPill`). Both ride the adornment cache, NOT a DOM reconcile pass, so
	// every writer of either field must also call `invalidateAdornments()` or the pill won't restyle —
	// there is no sweep left to paper over a missed eviction.
	@state() private _pinnedRefKey?: string;
	// Sha the pinned ref resolved to — kept so the lane chain can be re-walked when more rows page in
	// (a precise lane boundary means the branch's older commits would otherwise arrive dimmed).
	private _pinnedRefSha?: string;
	// `refContextPinKey` of the ref pill pinned open by a native context menu, read live via
	// `refPillHooks.getContextPinnedRefKey` — see `renderRefPill`. Jump-sha-qualified, NOT a bare
	// `refPillKey`: the WIP row's proxy pill mirrors the HEAD row's refs under the same pill key.
	// Undefined = nothing context-pinned.
	@state() private _contextPinnedRefKey?: string;
	// The ref pill (if any) currently under the pointer — `{ key, sha }` matches what `togglePinnedRef`
	// needs (`resolveRef` + `resolveSha` on the same event). Tracked regardless of the modifier so a
	// press right after entering the pill activates immediately, with no re-hover required.
	private hoveredPillRef?: { key: string; sha: string };
	// Shared modifier-key tracker — the single source of Ctrl/Alt truth. Unlike a bare window keydown/keyup
	// pair (which only fires when the webview iframe has keyboard focus), it also reads `ctrlKey`/`altKey`
	// off pointer events, so a hold is observed even when the graph isn't focused, and a menu-bar-steal
	// that swallows the keyup still self-corrects on the next pointer move. `willUpdate` reconciles the
	// transient chain against its state (see the reconcile there).
	private readonly _modifiers = new ModifierKeysController(this);
	// Transient Ctrl/Alt-hold chain (`activateModifierChain`/`deactivateModifierChain`): while Ctrl or Alt
	// is held, dims rows outside the focused/selected row's lane chain — the same derivation as the
	// click-pin, but momentary and layered ON TOP of it (see the `inRefChainShas` assignment in
	// `updateRenderState`, which prefers this over `refHoverChainShas` while set).
	@state() private modifierChainShas?: ReadonlySet<string>;
	// Seed key `activateModifierChain` last computed the chain from (`row:<sha>`) — landing on the SAME
	// seed while the modifier stays held (or a fresh reconcile lands on it) is a no-op instead of
	// re-walking `collectLaneChain` over the lane again.
	private lastModifierChainSeed?: string;
	// Direction to the current HEAD commit when it's scrolled OFF-screen (drives the floating
	// "Jump to HEAD" pill; the arrow points toward HEAD). Undefined = HEAD is visible → no pill.
	// Only flips when HEAD crosses the visible edge (set from onRangeChanged), so it's not per-frame.
	@state() private headPillDirection?: 'up' | 'down';
	// Direction to the pinned branch's row when it's scrolled OFF-screen (drives the floating "Jump to
	// Pinned Branch" pill; the arrow points toward it). Undefined = no pinned ref, or it's in view.
	@state() private pinnedPillDirection?: 'up' | 'down';
	// Sticky-timeline group for the row scrolled to the top (drives the seam pill) — updated from
	// onScroll/onRangeChanged (same spot as the pill directions above), written ONLY on a group-key
	// change so a scroll that stays within one group never re-renders. Undefined = not yet computed /
	// feature off. `key` is dynamic (e.g. `week:3`) — see `StickyTimelineGroup`. One @state object (not
	// three separate fields) since they're always read/written together.
	@state() private stickyTimeline?: { key: string; label: string; span: string };
	// The last classified group's elapsed WINDOW [lo, hi) (hi = +Infinity for year groups — see
	// updateStickyTimelineBucket) — lets a call land back in the SAME window short-circuit before even
	// building a new StickyTimelineGroup (skips the fromNowUnit walk entirely). Invalidated whenever
	// `nowMs` is refreshed (the window is elapsed-relative, so it can go stale as real time passes).
	private stickyTimelineWindow?: { key: string; lo: number; hi: number };
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

	// The chain-lane highlight overlay: one bright rule per contiguous same-column run of the active ref
	// chain (`modifierChainShas` while Ctrl is held, else `refHoverChainShas`), painted OUTSIDE every row
	// so `.is-dimmed`'s opacity can never dim it — see `syncChainLaneOverlay`. The runs are memoized on
	// the identity of the active chain set + `displayRows` (same "for" pattern as `_scopeIdentityFor`
	// above); the render-ready boxes are rebuilt every `updateRenderState` pass because they also bake in
	// `rowHeight`/`columnWidth`, which can change without either identity changing.
	private _chainLaneChainFor?: ReadonlySet<string>;
	private _chainLaneRowsFor?: readonly ProcessedGraphRow[];
	private _chainLaneRuns?: readonly ChainLaneRun[];
	private _chainLaneOverlay?: readonly ChainLaneBox[];
	// The DOM elements `syncChainLaneOverlay` currently owns (mirrors `_chainLaneOverlay` 1:1) + the key
	// (`JSON.stringify` of the boxes, `undefined` = none) it last synced the DOM to — lets a no-op pass
	// (idle renders, the overwhelming majority) skip touching the DOM entirely.
	private _chainLaneOverlayEls: HTMLDivElement[] = [];
	private _chainLaneOverlayKey: string | undefined;

	private virtualizerRef: Ref<LitVirtualizer> = createRef();
	// Cached once true: whether the chain-lane overlay is safe to mount into the `<lit-virtualizer>`'s
	// light DOM. It MUST carry `virtualizer-sizer` — Virtualizer 2.1.1's `_children` getter treats every
	// child WITHOUT that attribute as a rendered item (node_modules/@lit-labs/virtualizer/Virtualizer.js:
	// 443-453, SIZER_ATTRIBUTE :23) and `_positionChildren` indexes into that list by `index - this._first`
	// (:516-523), so one un-excluded extra child shifts every row's position by one. `_getSizer()`
	// (:220-245) lazily ADOPTS the first `[virtualizer-sizer]` child it finds in document order the first
	// time it's called and overwrites its inline styles — if our overlay mounted before the virtualizer's
	// own sizer exists, ours could be adopted instead. `disconnected()` never clears `_sizer` (:190-204),
	// so this can only race on first layout, never on reconnect. The overlay is mounted IMPERATIVELY (see
	// `syncChainLaneOverlay`), not as a declared template child: a declared `<lit-virtualizer>` child was
	// tried first and verified LIVE to corrupt the virtualizer — its render part interleaves with the
	// directive's own light-DOM part, and the child expression's flip from `nothing` to content cleared
	// that part's committed rows (and the real sizer) along with it. Checked once per empty→non-empty
	// transition via `querySelector`, not every pass.
	private _chainOverlayMountSafe = false;
	// The outer viewport — a plain layout/delegation container (header + rows tree + overlays). Not the
	// focus/tree host: `role=tree`/`tabindex`/keyboard nav live on the inner `.gl-graph__tree` (treeRef)
	// so the header, a preceding sibling, tabs FIRST. Kept for click/pointer delegation + overlay geometry.
	private viewportRef: Ref<HTMLElement> = createRef();
	// The `role=tree`, tabindex=0 rows host — the keyboard-nav focus target, wrapping ONLY the rows
	// (`<lit-virtualizer>`). Held so the host can route programmatic `focus()` (graph open / sidebar
	// select) here; the element itself (light DOM) isn't otherwise focusable.
	private treeRef: Ref<HTMLElement> = createRef();
	// The ref find widget, held so opening it can hand over focus (it owns the input).
	private refFindRef: Ref<GlGraphRefFind> = createRef();
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
	//
	// Takes `undefined`: the virtualizer swaps `items` synchronously but re-measures its visible RANGE
	// asynchronously, so an update that shrinks the row set sharply (a scope re-root collapsing thousands of
	// rows onto a branch's spine, a filtering search) leaves a stale range whose tail indexes past the new
	// array. `virtualize.js` pushes those holes into `repeat()` verbatim, which hands them to the key fn AND
	// the item renderer, so both have to survive one frame until the measured range catches up. The key must
	// still be unique per hole — a shared constant would collide and make `repeat` reuse one row's DOM for all
	// of them. `vacant:` can't collide with a sha or a `wip::` row id.
	private readonly rowKey = (row: ProcessedGraphRow | undefined, index: number): string =>
		row?.sha ?? `vacant:${index}`;
	// Fixed-size vertical layout: rows are a uniform height per density (bar the sparse quantized rows the
	// `units` index tracks), so arithmetic positions them exactly — no `flow()` measurement, no sub-pixel
	// drift. `itemSize` and `units` are kept in sync in `updateRenderState` (both guarded no-ops unless they
	// actually change). Stable object identity so the virtualizer's layout stays the same instance across
	// incidental renders.
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
		// Compare against `focusedSha`, NOT `_activeRowId` — the latter is the `graph-row-<sha>` ELEMENT id
		// (aria-activedescendant), so a raw sha never equals it and the active-row exemption above never fired.
		const skeleton = this.skeletonScroll && row.kind !== 'workdir' && row.sha !== c.focusedSha;

		const adornments = skeleton ? undefined : c.getAdornments(row);
		const isAnchor = c.anchorShas?.has(row.sha) === true;
		const isFocalAnchor = c.focalTipShas?.has(row.sha) === true;
		const isForkAnchor = c.forkPointShas?.has(row.sha) === true;
		const isTargetAnchor = c.mergeTargetShas?.has(row.sha) === true;
		// Styling only — the row's dominant anchor, for `is-anchor--${kind}`. Target beats fork so that a
		// branch purely ahead of its target (the common case: merge-base === target tip, same commit) reads
		// as the merge target. The markers don't come through here; they read all three booleans.
		const anchorKind: RowRenderContext['anchorKind'] = !isAnchor
			? undefined
			: isFocalAnchor
				? 'focal'
				: isTargetAnchor
					? 'target'
					: isForkAnchor
						? 'fork'
						: undefined;
		// A focused lane chain (Ctrl-hold or click-pin) takes over the dim: while it's active, dim tracks
		// chain membership ALONE — an in-chain merge no longer dims itself away, and search/scope dims
		// yield to it (search matches keep their own `is-highlighted` tint). The transient peek dims
		// out-of-chain rows more softly than the pinned focus.
		const chainActive = c.inRefChainShas != null;
		const outOfChain = chainActive && c.inRefChainShas?.has(row.sha) !== true;
		// This row's lane-segment tip (undefined for the trunk lane / rows outside any segment) — reused
		// below for BOTH the fold-chevron hit-target (`laneTipSha`) and the ghost-ref resolution so the
		// map lookup only happens once.
		const laneTipSha = c.segmentByCommit.get(row.sha);
		// Ghost-ref pill source: the lane tip's PRIMARY visible ref (never this row's own sha) — the whole
		// chain below is gated on rows that could actually show a ghost (config on, not workdir/stash) so
		// everyone else pays nothing beyond the `laneTipSha` read above (which the fold hit-target needs
		// regardless). `laneTipSha` resolves first. A row on a pinned chain (`pinBranchToEdge`) never forms
		// a lane segment, so it resolves to its own pinned branch's head instead. The trunk fallback
		// applies only to rows that are actual members of the trunk segment (`trunkCommitShas`) — a row
		// that belongs to no lane at all (e.g. an unfinalized single-commit side lane) shows no ghost
		// rather than borrowing the trunk's.
		let ghostRefSource: ReturnType<typeof pickGhostRef>;
		if (!skeleton && c.showGhostRefs && row.kind !== 'workdir' && row.kind !== 'stash') {
			let ghostTipSha =
				laneTipSha ??
				c.pinnedTipByCommit.get(row.sha) ??
				(c.trunkCommitShas.has(row.sha) ? c.trunkTipSha : undefined);
			// A worktree's WIP row heads its branch's lane segment whenever that worktree has working
			// changes — and a WIP row's `commitRefs` is always empty, so the whole lane would resolve no
			// ghost. Hop to the WIP row's first parent (the branch tip, which carries the ref) — the same
			// hop `trunkGhostTipSha` does for the trunk's own WIP tip.
			if (ghostTipSha != null && c.wipSegmentTips.has(ghostTipSha)) {
				ghostTipSha = c.getCommit(ghostTipSha)?.parents[0];
			}

			ghostRefSource =
				ghostTipSha != null
					? pickGhostRef(
							c.getCommit(ghostTipSha)?.commitRefs,
							this.excludeTypes,
							this.excludeRefs,
							this.downstreams,
							this._refOrder,
						)
					: undefined;
		}
		const ghostRef: RowRenderContext['ghostRef'] =
			ghostRefSource != null ? { name: ghostRefSource.name, kind: ghostRefSource.kind } : undefined;
		// Sticky-timeline hairline: a 1px separator overlay where this row's group differs from the row
		// ABOVE it in display order (never row 0 — no "previous" to differ from). Gated on its OWN setting
		// (`gitlens.graph.timelineSeparators`), independent of the pill's `stickyTimeline` — this is the
		// FIRST condition in the `&&` chain, so it's a real short-circuit: disabled means zero
		// `stickyTimelineGroupKeyFor` calls, not just a discarded result. Compares raw row dates (NOT
		// workdir-anchor-normalized like the pill's topmost-row read) — a WIP row's own "now" stamp
		// legitimately reading as a different (newer) group than its anchor below it is the correct
		// visual: it says "this is uncommitted, everything below is history". `stickyTimelineGroupKeyFor`
		// (the allocation-free sibling of `stickyTimelineGroupFor` — no object/label/lo/hi built) is pure
		// arithmetic off the per-render-cached `nowMs`; the full group is built ONLY in
		// `updateStickyTimelineBucket`, which runs far less often than once-per-visible-row-per-render.
		const prevRowDate = index > 0 ? this.displayRows[index - 1]?.date : undefined;
		const isBucketBoundary =
			this.config?.timelineSeparators !== false &&
			row.date != null &&
			prevRowDate != null &&
			stickyTimelineGroupKeyFor(row.date, this.nowMs) !== stickyTimelineGroupKeyFor(prevRowDate, this.nowMs);
		return renderRow(row, {
			commit: commit,
			repoPath: this.repoPath,
			index: index,
			isBucketBoundary: isBucketBoundary,
			total: c.total,
			skeleton: skeleton || undefined,
			rowHeight: c.rowHeight,
			units: c.unitsOf(index),
			dataUnit: c.dataUnitOf(index),
			gutterWidth: c.gutterWidth,
			columnWidth: c.columnWidth,
			zones: c.zones,
			rowsStats: c.rowsStats,
			style: c.style,
			graphPlacement: c.graphPlacement,
			graphColumnPos: c.graphColumnPos,
			graphHostId: c.graphHostId,
			refsPlacement: c.refsPlacement,
			refsHostId: c.refsHostId,
			gutterCache: this.gutterCache,
			nodeMode: c.nodeMode,
			avatars: c.nodeAvatars,
			isSelected: c.selected.has(row.sha),
			isLandingFlash: c.landingFlashSha != null && row.sha === c.landingFlashSha,
			isFocused: row.sha === c.focusedSha,
			isAnchor: isAnchor,
			anchorKind: anchorKind,
			isFocalAnchor: isFocalAnchor,
			isForkAnchor: isForkAnchor,
			isTargetAnchor: isTargetAnchor,
			// A focused lane chain owns the dim while active (chain membership alone); otherwise the
			// scope / merge / search reasons apply. See `chainActive`/`outOfChain` above.
			isDimmed: chainActive
				? outOfChain
				: (c.inScopeShas != null && !c.inScopeShas.has(row.sha)) ||
					(c.dimMergeCommits === true && row.kind === 'merge') ||
					// Active search dims every non-match (and every row when there are 0 matches).
					(c.searchMatchedShas != null && !c.searchMatchedShas.has(row.sha)),
			// Transient (Ctrl-hold) out-of-chain rows dim softer than the pinned focus — a peek, not a mode.
			isDimmedSoft: outOfChain && c.chainTransient === true,
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
			// Inline Resolve is gated to the graph's OWN worktree's WIP row — peer
			// worktrees surface conflicts via the details-header chip instead.
			hasConflicts:
				row.kind === 'workdir' && row.sha === c.primaryWipRowId
					? c.wipStateById?.[row.sha]?.hasConflicts
					: undefined,
			isUnpushed: commit.isUnpublished,
			isUnpulled: commit.isUnpulled,
			undoTarget: commit.undo,
			// Gates the inverse Jump to Working Changes action by the SAME decision as the WIP row's proxy
			// pill (pill built ⇒ the primary WIP row exists, non-adjacent): only the graph's own HEAD row
			// offers it — a peer worktree's WIP row interleaves directly above its tip, so the jump there
			// would move one row.
			hasJumpableWipRow: c.wipRowMarkerPill != null && row.sha === c.rowMarkerTips?.headSha,
			avatarVscodeContext: commit.avatarVscodeContext,
			// The SAME tips object for every row (a reference, no per-row derivation): each row resolves its
			// own HEAD/upstream/target role by sha — 3 compares for the rows that play none. The prebuilt WIP
			// pill (built once per render) rides along and is placed only on the primary WIP row.
			rowMarkerTips: c.rowMarkerTips,
			wipRowMarkerPill: c.wipRowMarkerPill,
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
	// The package-owned engine lifecycle. It retains the aligned payload/topology planes and all
	// incremental resume/stability/reconciliation state; the Lit element consumes its current state.
	private readonly engineSession = new CommitGraphEngineSession<GitGraphRow, GraphCommitView>();
	private readonly projectionSession = new CommitGraphProjectionSession();
	private engineTransition: CommitGraphSessionTransition = { kind: 'reset', source: 'empty' };
	/** Memo for the serialized scope identity, keyed on the scope object it was derived from. */
	private _scopeIdentityFor?: GraphScope;
	private _scopeIdentity?: string;
	// True when the LAST recomputeRows took the payload-only path (engine + topology derivations
	// skipped). willUpdate reads it (same synchronous update) to route a payload change to the light
	// displayRows refresh (ref indexes + upstream requests) instead of the full lane re-derivation.
	private lastRowsDeltaPayloadOnly = false;
	// sha → reserved column for additional parents that paged off the window (never appear as a row).
	// Re-threaded into the collapse/scope edge re-pass so a merge's dangling stub survives folding.
	private unloadedColumns: ReadonlyMap<Sha, number> = new Map();
	private zones: readonly ZoneSpec[] = defaultZones;
	private maxColumn = 0;
	// sha → index into `displayRows` (the rendered list — drives click/keyboard/range math).
	private indexBySha: ReadonlyMap<string, number> = new Map();
	// Quantized row heights: the sparse index of rows that span more than one base row height, rebuilt
	// alongside `indexBySha` in `recomputeDisplayRows`. Stays the `uniform` singleton until a consumer
	// asks for tall rows (see `rowUnitsActive`), so every pixel helper below takes its uniform fast path.
	private _rowUnits: RowUnitsIndex = RowUnitsIndex.uniform;
	private lastRowsRef?: GitGraphRow[];
	private lastIdLength = 7;
	private lastColumnsRef?: GraphColumnsSettings;
	// Monotonic counter stamped on every local columns write (rides UpdateColumnsCommand; the host acks
	// it back as `columnsRevision` on every push). See `shouldApplyIncomingColumns`.
	private columnsWriteRevision = 0;
	// Cached split-pill ref indexes (refRowIndex/localByUpstreamId/processedIndexBySha). They depend
	// ONLY on processedRows, so rebuild only when it changes — a filter-search or lane toggle re-runs
	// recomputeDisplayRows without touching processedRows and reuses these instead of re-walking all rows.
	private cachedRefRowIndex?: Map<string, { sha: string; index: number }>;
	private cachedLocalByUpstreamId?: Map<string, { sha: string; index: number; id?: string; name?: string }>;
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
	// Cached selection set (rebuilt only when `selectedRows` changes — not allocated per render).
	private selectedShas: ReadonlySet<string> = new Set();
	private lastSelectedRowsRef?: GraphSelectedRows;
	// Date formatters honoring the user's dateStyle/dateFormat config (rebuilt on config change).
	// `formatDateShortFn` is the ultra-compact variant used when the date column is too narrow.
	private formatDateFn?: (date: number) => string;
	private formatDateShortFn?: (date: number) => string;
	private lastConfigRef?: GraphComponentConfig;
	// Keeps relative dates ("5m ago") fresh on an otherwise-idle graph. Only runs while the effective
	// date style is relative (see `isRelativeDateStyle`); started/stopped alongside `formatDateFn` in
	// willUpdate, and always torn down in disconnectedCallback.
	private relativeTimeTimer?: ReturnType<typeof setInterval>;
	// Scroll-rail markers (recomputed only when rows/selection/search/marker-types change). The flat
	// list is grouped by row for rendering: one full-width interactive band per row carrying all its
	// markers (so hover/click hits the whole row + one tooltip lists every marker, in lane order).
	private scrollMarkers: readonly ScrollMarker[] = [];
	private scrollMarkerRows: readonly RowMarkers[] = [];
	// Row-scanned markers, cached so a selection/merge-target change merges its markers on top instead of
	// rescanning the rendered rows.
	private baseScrollMarkers: readonly ScrollMarker[] = [];
	private lastSearchResultsRef?: DidSearchParams['results'];
	private lastSearchModeRef?: GraphSearchMode;
	private lastSearchActive = false;
	private lastScrollMarkerTypesRef?: GraphScrollMarkerTypes[];
	// Identity of the scope's merge-target anchors at the last marker recompute — the deferred row marker
	// pull is caught by `changed.has('rowMarkerMergeTarget')`, but the scope's set has no such signal.
	private lastMergeTargetShasRef?: ReadonlySet<string>;
	// Cached set of search-matched shas (undefined = no active search). Rebuilt only when
	// `searchResults` changes (see willUpdate) — read by dim/highlight + the filter-mode row filter.
	private _searchMatchedShas?: ReadonlySet<string>;
	/** True while the display rows are the search FILTER's projection — the same condition that feeds
	 *  `filterShas` to the projection. Those rows are flattened (`column: 0`) and keep their ORIGINAL
	 *  parent links, most of which no longer name a displayed row, so lane and lineage walks can't run. */
	private get searchFiltering(): boolean {
		return this.searchMode === 'filter' && this._searchMatchedShas != null;
	}

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
	// `effectiveMaxInlineRefs` (the RESOLVED cap, not the raw config value — `'auto'` mode's cap moves
	// with the available width, not with the config) field-level tracking (same reasoning as
	// `lastShowRemoteNamesRef`) — a cap change re-resolves adornments so cached ref-pill overflow (+N
	// counter) picks up the new limit. Also the value the `getMaxInlineRefs` hook serves to per-row
	// adornment resolution, so a row never re-solves the zone layout itself.
	private lastMaxInlineRefsRef = 1;
	// `rowUnitsActive` field-level tracking (same reasoning as `lastMaxInlineRefsRef`) — none of its three
	// inputs (the setting, style, refs placement) are covered by `rowsChanged`/`scopeChanged`/etc., so a
	// flip needs its own trigger to re-run recomputeDisplayRows (which rebuildRowUnits is paired to, see
	// its own comment). Read fresh every willUpdate — `rowUnitsActive` is a cheap getter.
	private lastRowUnitsActive = false;
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

	private lastFoldingDefault?: 'none' | 'all' | 'auto';
	// Tracks the prior `foldingEnabled` so willUpdate can detect toggles (a config-derived getter can't
	// go through `changed.has`). Init matches the getter's fallback so the first pass sees no change.
	private lastFoldingEnabled = true;

	// Rows-only derivations (recomputed by recomputeRows, not on search/config/toggle).
	private headSha?: string;
	private trunkSegmentTip?: Sha;
	private effectiveCollapsed: ReadonlySet<Sha> = new Set();
	private segmentsByTipSha: ReadonlyMap<Sha, LaneSegment> = new Map();
	private hiddenCountByTipSha: ReadonlyMap<Sha, number> = new Map();
	// Set while scoped to a branch: the focal-spine projection (drives displayRows + suppresses the
	// in-scope dimming, since the scoped view only renders in-scope rows). Undefined when not scoped.
	private scopeProjection?: ScopeProjection;
	// commit-sha → segment-tip-sha (non-trunk) for the gutter node's lane-collapse hit-target.
	private segmentByCommit: ReadonlyMap<Sha, Sha> = new Map();
	// sha → owning pinned head sha, for pinned-lane ghost-ref resolution.
	private pinnedTipByCommit: ReadonlyMap<Sha, Sha> = new Map();
	// Shas that are members of the current trunk segment, for scoping the trunk ghost-ref fallback.
	private trunkCommitShas: ReadonlySet<Sha> = new Set();
	// Commits that WIP/workdir rows sit on (first-parent anchors). Kept visible on collapse so
	// folding a lane never hides — nor re-anchors a WIP row away from — the commit it's based on.
	private wipAnchorShas: ReadonlySet<Sha> = new Set();
	// Workdir-row shas (drives the wipSegmentTips derivation; patched on append).
	private workdirShas: ReadonlySet<Sha> = new Set();
	// Segment tips that are WIP/workdir rows — excluded from `auto` default-collapse so working changes
	// stay expanded.
	private wipSegmentTips: ReadonlySet<Sha> = new Set();
	// workdir sha → clean/dirty (built in rebuildWipStatsProvider; drives the WIP node glyph).
	private wipStateBySha: ReadonlyMap<Sha, WipNodeState> = new Map();
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
	private processedIndexBySha: ReadonlyMap<string, number> = new Map();
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
	// (email → url) pairs for ~150ms before asking the host to re-serve them through its avatar proxy,
	// so a screenful of broken avatars costs one round trip instead of one per row.
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
	// Split-pill hooks read live state (metadata/row positions/row-marker tips), so they're getters, never
	// cached. Held as a field so the WIP-row pill (`buildWipRowMarkerPill`) reuses the exact same hooks.
	private readonly refPillHooks: RefPillHooks = {
		getUpstream: ref => this.getUpstreamStats(ref),
		resolveJump: (ref, fromSha) => this.resolveRefJump(ref, fromSha),
		onJumpToRef: sha => this.jumpToRefRow(sha),
		getPullRequests: ref => (ref.id != null ? (this.refsMetadata?.[ref.id]?.pullRequest ?? undefined) : undefined),
		getIssues: ref => (ref.id != null ? (this.refsMetadata?.[ref.id]?.issue ?? undefined) : undefined),
		getUpstreamMetadataId: ref => this.getUpstreamMetadataId(ref),
		getShowRemoteNames: () => this.config?.showRemoteNamesOnRefs === true,
		// Returns caps `updateRenderState` already resolved this pass, not live getters — re-running
		// `effectiveMaxInlineRefs` per row would re-solve the zone layout on every adornment-cache miss
		// (see `lastMaxInlineRefsRef`). Own-line promoted rows branch to their own cap instead:
		// `effectiveOwnLineRefCap` is pure math over the width `updateRenderState` cached, so it's safe
		// per row. Every other row (including a ref-bearing workdir/stash row, which never promotes)
		// keeps the plain resolved setting.
		getMaxInlineRefs: row =>
			this.rowUnitsActive && this.rowPromotesToOwnLine(row)
				? this.effectiveOwnLineRefCap
				: this.lastMaxInlineRefsRef,
		getRowMarkerTips: () => this._rowMarkerTips,
		getFindHitRefKey: () => this._refFindHitKey,
		getPinnedRefKey: () => this._pinnedRefKey,
		getContextPinnedRefKey: () => this._contextPinnedRefKey,
		getPinnedRefId: () => this.pinnedRef?.id,
		onUnpinRef: () => this.dispatchEvent(new CustomEvent('gl-graph-unpinref')),
	};
	private refsProvider = createRefAdornmentProvider(
		() => this._refOrder,
		this.refPillHooks,
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
	private lastWipStateRef?: GraphWipStateById;
	/** `repoPath` at the last WIP-stats rebuild — the graph's own WIP row is keyed by it. */
	private lastWipRepoPath?: string;

	// Visible-range bookkeeping (drives minimap day-range + WIP-stat loading + avatar backfill). The scan is
	// debounced trailing so rapid arrow/scroll past WIP rows doesn't fire IPC per frame; the dedup keys skip
	// no-op dispatches.
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
	// Cached "now" (ms), refreshed once per render (updateRenderState) AND on the 60s relative-time tick
	// (see onRelativeTimeTick) — lets `stickyTimelineGroupFor`'s elapsed math (via `fromNowUnit`) stay
	// allocation-free per row/scroll event while still tracking real time closely enough that a bucket
	// crossing (e.g. a 6-day-old top row rolling into "Last week") shows up on an otherwise-idle graph.
	private nowMs = Date.now();
	private stickyTimelineRef: Ref<HTMLElement> = createRef();
	// Toggles the sticky-timeline pill's expanded state for the ~900ms after the last scroll (idempotent
	// add per scroll; a trailing debounce removes it once scrolling settles) — CSSOM only, so a scroll
	// burst never re-renders. Mirrors `clearScrolling`'s idle-clear idiom.
	private readonly clearStickyTimelineScrollActive = debounce((): void => {
		this.stickyTimelineRef.value?.classList.remove('is-scroll-active');
	}, 900);
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
		this.registerKeymap();

		if (DEBUG) {
			getGraphDebugDiagnostics().connect(this, () =>
				createGraphDebugSnapshot({
					repoPath: this.repoPath,
					sourceRows: this.rows?.length ?? 0,
					transition: this.engineTransition,
					rows: this.processedRows,
					segments: this.segments,
					displayRows: this.displayRows,
					collapsed: this.effectiveCollapsed,
					maxColumn: this.maxColumn,
					scoped: this.scopeProjection != null,
					selected: this.selectedShas,
					focusSha: this.displayRows[this.focusIndex]?.sha,
					viewport: {
						topSha: this._viewportTopSha,
						topIndex: this._viewportTopIndex,
						scrollTop: this._viewportScrollTop,
					},
				}),
			);
		}
		// Start each (re-)connect with a clean scroll-shadow state — the scroller resets to top.
		this.wasScrolled = false;
		this.resizeObserver = new ResizeObserver(entries => {
			// Both this element AND the virtualizer are observed (see `observeVirtualizerResize`), so pick our
			// OWN entry for the container width rather than trusting entry order — a virtualizer-only resize
			// would otherwise report the scroller's width as the container's.
			const self = entries.find(e => e.target === this);
			const width = self?.contentRect.width ?? this.containerWidth;
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
			const scrollerHeight = this.virtualizerRef.value?.clientHeight ?? 0;
			if (scrollerHeight !== this.scrollerClientHeight) {
				this.scrollerClientHeight = scrollerHeight;
				// Not a reactive property, and a HEIGHT-only resize changes no other one — so nothing would
				// re-render. The scroll markers care: their positions are inline styles committed at render
				// time from this value, while hit-testing reads it live, so the drawn scale would stay on the
				// old height while the hit-test moved to the new one and hovering would pick a neighbour.
				this.requestUpdate();
				// The waypoints care too, and only these two call sites plus `onScroll` recompute them: whether
				// HEAD / the pinned row is off-screen is a function of the viewport HEIGHT, so growing or
				// shrinking the panel changes the answer with no scroll and no range change. Without this a
				// resize leaves the capsule showing a stale answer — or missing entirely — until the next
				// scroll (observed: maximizing then restoring the panel dropped it).
				this.updateHeadPillDirection();
				this.updatePinnedPillDirection();
			}
			// A resize can shift the chrome above the row list onto/off a fractional boundary — but only a
			// resize can, so re-measure only when the scroller's box actually moved. Deliveries far outnumber
			// actual size changes (paging and scrollbar churn each fire one), and the snap's
			// `getBoundingClientRect` is not free on every one. Compare the FRACTIONAL `contentRect`, not the
			// integer `clientHeight` above: a sub-pixel chrome shift is exactly what the snap corrects, and
			// rounding hides it.
			const scrollerEntry = entries.find(e => e.target === this.virtualizerRef.value);
			if (scrollerEntry != null) {
				const { width: w, height: h } = scrollerEntry.contentRect;
				if (w !== this.lastSnapWidth || h !== this.lastSnapHeight) {
					this.lastSnapWidth = w;
					this.lastSnapHeight = h;
					this.snapVirtualizerToPixelGrid();
				}
			} else if (self != null) {
				// Our own resize with no scroller entry in this delivery — the scroller's offset can still have
				// moved, so snap and let the scroller's own entry re-confirm on the next delivery.
				this.snapVirtualizerToPixelGrid();
			}
		});
		this.resizeObserver.observe(this);
		this.observeVirtualizerResize();
		// On RECONNECT the virtualizer DOM already exists but firstUpdated won't fire again, so
		// re-attach the (passive) scroll listener here. First connect is handled by firstUpdated.
		if (this.hasUpdated) {
			this.attachScrollListener();
		}
		window.addEventListener('gl-graph-lane-palette-changed', this.onLanePaletteChanged);
		this.startRelativeTimeTimer();
		document.addEventListener('visibilitychange', this.onVisibilityChangeForRelativeTime);
	}

	override disconnectedCallback(): void {
		if (DEBUG) {
			getGraphDebugDiagnostics().disconnect(this);
		}
		this.unregisterKeymap();
		window.removeEventListener('gl-graph-lane-palette-changed', this.onLanePaletteChanged);
		document.removeEventListener('visibilitychange', this.onVisibilityChangeForRelativeTime);
		this.stopRelativeTimeTimer();
		// Release the gutter-template cache so a detached instance holds no `TemplateResult`s.
		this.gutterCache.clear();
		// Drop the persistent requested-avatars dedup so a reconnect re-scans from scratch.
		this.requestedAvatars.clear();
		if (this._peekReanchorFrame != null) {
			cancelAnimationFrame(this._peekReanchorFrame);
			this._peekReanchorFrame = undefined;
		}
		this._peekOpen = false;
		this.resizeObserver?.disconnect();
		this.resizeObserver = undefined;
		this.virtualizerRef.value?.removeEventListener('scroll', this.onScroll);
		this.clearScrolling.cancel();
		this.clearStickyTimelineScrollActive.cancel();
		this.stickyTimeline = undefined;
		this.stickyTimelineWindow = undefined;
		this.scanVisibleRangeDebounced.cancel();
		if (this.avatarErrorFlushTimer != null) {
			clearTimeout(this.avatarErrorFlushTimer);
			this.avatarErrorFlushTimer = undefined;
		}
		this.emitMoreRows.cancel();
		this.announceLoadingMore.cancel();
		this.cancelPendingPillActivation();
		// A reveal animation holds a rAF that would otherwise keep writing `scrollTop` on a detached scroller.
		this.cancelRevealAnimation();
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
		this._pinnedRefSha = undefined;
		this.hoveredPillRef = undefined;
		this.modifierChainShas = undefined;
		// The overlay's DOM goes away with the (detached) virtualizer — drop our references and the
		// mount-safety latch so a reconnect re-checks the new virtualizer's sizer and remounts cleanly
		// instead of trusting stale state from the old one.
		this._chainLaneOverlayEls = [];
		this._chainLaneOverlayKey = undefined;
		this._chainOverlayMountSafe = false;
		if (this.tooltipShowTimer != null) {
			clearTimeout(this.tooltipShowTimer);
			this.tooltipShowTimer = undefined;
		}
		if (this.tooltipHideTimer != null) {
			clearTimeout(this.tooltipHideTimer);
			this.tooltipHideTimer = undefined;
		}
		this.cancelPendingHoldEngage();
		this.emitRowHover.cancel();
		// Cancel any scheduled rAFs so their callbacks can't run against the detached instance.
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
		// Drop the mode-picker's document/window dismiss listeners if it's still open on detach.
		this.closeChangesModeMenu();
		super.disconnectedCallback?.();
	}

	override willUpdate(changed: PropertyValues<this>): void {
		// `keymap` arrives as a property, so it's unset on the first connect — register on the first
		// update that carries it.
		this.registerKeymap();

		if (DEBUG) {
			getGraphDebugDiagnostics().beginUpdate(this.rows, changed.has('rows'), {
				changed: Array.from(changed.keys(), String),
				repoPath: this.repoPath,
				sourceRows: this.rows?.length ?? 0,
			});
		}
		const idLength = this.config?.idLength ?? 7;

		// A new upstream reorders pills the cached adornments already resolved, so it invalidates them. The
		// pins invalidate themselves — `togglePinnedRef`/`clearPinnedRef` for the click pin, `recomputeRows`
		// below for the edge pin.
		if (changed.has('currentUpstream')) {
			this.invalidateAdornments();
		}

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
		// projection path could otherwise honor a stale tip that collides in the new scope). The package
		// projection session resets those overrides from the viewKey passed during recompute.
		if (scopeChanged) {
			// The click-pinned ref focus keys a ref in the PRIOR scope's rows; carrying it over dims the
			// new view against a stale chain and leaks the `document` pointerdown dismiss listener. Clear
			// it directly (the @state writes re-render; the lane re-derivation below rebuilds the ref
			// adornments with the cleared pin) and dismiss any pinned ref popover.
			let clearedRefState = false;
			if (this._pinnedRefKey != null || this.pinnedRefDismiss != null) {
				this._pinnedRefKey = undefined;
				this._pinnedRefSha = undefined;
				this.refHoverChainShas = undefined;
				if (this.pinnedRefDismiss != null) {
					document.removeEventListener('pointerdown', this.pinnedRefDismiss, true);
					this.pinnedRefDismiss = undefined;
				}
				this.unpinRefPill();
				clearedRefState = true;
			}
			// The find widget's last hit keys a ref in the PRIOR scope's rows too — left open across a
			// scope switch, a ref sharing that key in the NEW view would silently inherit the find-hit
			// emphasis despite never having been searched for. A page-in still chasing the old scope's
			// walk is equally stale, so the loading watch goes with it.
			if (this._refFindHitKey != null || this._refFindLoadingSha != null) {
				this._refFindHitKey = undefined;
				this._refFindLoadingSha = undefined;
				this._refFindLoadingRevealedIndex = undefined;
				clearedRefState = true;
			}
			// Both fields above ride the adornment cache now (`.is-pinned` / `--find-hit` render off them,
			// there's no DOM reconcile pass to paper over a miss) — evict so the clear actually restyles.
			// No separate `requestUpdate()`: this runs inside `willUpdate`, already mid-cycle.
			if (clearedRefState) {
				this.invalidateAdornments();
			}
		}

		// Refresh the ref-ordering inputs AFTER the scope-change block above may have cleared the click pin
		// — that write lands inside this same update cycle, so reading it earlier would order this render's
		// pills against a pin belonging to the prior scope. Nothing before this point reads the projection.
		this.updateRefOrder();

		// Scope anchors depend on BOTH rows + scope (anchor reachability is row-membership — an
		// unreachable anchor becomes reachable once more rows page in), and MUST run before
		// recomputeRows since `syntheticChildren` feeds the package engine session.
		if (rowsChanged || scopeChanged) {
			this.lastScopeRef = this.scope;
			this.recomputeScope();
		}

		// recomputeRows must also re-run on a scope-only change: `syntheticChildren` (just
		// refreshed by recomputeScope) feeds the engine session, so the wavy synthetic
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

			// The context-menu pin lasts exactly as long as the menu that raised it. A rows refresh means
			// the interaction it belonged to is over, and its other dismiss paths (focus return, the next
			// primary press) may never fire if the menu action navigated away — so clear here too rather
			// than leave a pill expanded and its popover forced open. Unlike the click pin below, it makes
			// no attempt to survive a refresh.
			this.unpinRefPill();

			// A rows refresh can also drop the click-pinned ref's row entirely, or filter the ref itself
			// out (branch deleted / hidden). The lane-chain re-walk above tolerates that gracefully, but
			// the branch sheet would stay open on a ref that no longer exists and the click-outside
			// dismiss listener would stay attached — clear through `clearPinnedRef()` so both tear down,
			// same as the dismiss handler does.
			if (this._pinnedRefKey != null) {
				const stillPresent =
					this._pinnedRefSha != null &&
					this.getCommitBySha(this._pinnedRefSha)?.commitRefs.some(r => refPillKey(r) === this._pinnedRefKey);
				if (!stillPresent) {
					this.clearPinnedRef();
					this.dispatchEvent(
						new CustomEvent('gl-graph-open-branch', {
							detail: { open: false },
							bubbles: true,
							composed: true,
						}),
					);
				}
			}
		}

		if ((changed.has('columns') || this.columns !== this.lastColumnsRef) && this.shouldApplyIncomingColumns()) {
			this.lastColumnsRef = this.columns;
			this.zones = mergeZones(defaultZones, columnsToZones(this.columns));
			// The rebuilt zones re-bind the header cells the open picker anchored to — close it so its
			// dismiss / focus-return can't target a now-wrong column. No focus return (the anchor moves).
			if (this.changesModeAnchor != null) {
				this.closeChangesModeMenu('none');
			}
			// The host's column menu hides/shows the graph + Branches/Tags columns via a boolean `isHidden`;
			// column↔grouped is persisted separately as `grouped` (see `currentGraphColumnConfig`/
			// `buildColumnsConfig`). `isHidden` always wins. This bridge is idempotent — a local toggle
			// persists, and the host echoes back exactly what was sent, so re-applying is a no-op; it never
			// races an in-flight drag (see the width/order comment below).
			if (this.columns?.graph?.isHidden === true) {
				this.graphPlacement = 'hidden';
			} else if (this.columns?.graph?.grouped === false) {
				this.graphPlacement = 'column';
				this.graphHostZoneId = undefined;
			} else {
				// `grouped === undefined` is the default (grouped, mirroring refs); a string is the captured
				// host zone id (undefined here falls back to the anchor-slot zone via `graphHostIdFor`). Legacy
				// persisted `true` (no host) also lands here.
				this.graphPlacement = 'grouped';
				this.graphHostZoneId =
					typeof this.columns?.graph?.grouped === 'string' ? this.columns.graph.grouped : undefined;
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

		// Reconcile the transient Ctrl/Alt-hold chain against the shared modifier tracker. The tracker
		// `requestUpdate`s us on every Ctrl/Alt transition (including ones carried by a pointer event while
		// the graph is unfocused, or a menu-bar-steal that swallowed the keyup), so this engages on
		// press and reverts on release without a mouse move. `activateModifierChain` dedups against
		// `lastModifierChainSeed`, so this per-update pass is a no-op once settled — but it is ALSO the ONLY
		// retarget path: `focusIndex` is `@state`, so navigating/selecting a different commit schedules an
		// update and the new focused row becomes the seed here. The pointer never retargets it.
		this.reconcileModifierChain();

		const selectionChanged = changed.has('selectedRows') || this.selectedRows !== this.lastSelectedRowsRef;
		if (selectionChanged) {
			this.lastSelectedRowsRef = this.selectedRows;
			this.selectedShas = new Set(this.selectedRows != null ? Object.keys(this.selectedRows) : []);
		}

		if (changed.has('config') || this.config !== this.lastConfigRef) {
			this.lastConfigRef = this.config;
			this.formatDateFn = this.buildFormatDate(false);
			this.formatDateShortFn = this.buildFormatDate(true);
			if (this.needsRelativeTimeTimer()) {
				this.startRelativeTimeTimer();
			} else {
				this.stopRelativeTimeTimer();
			}
			// `stickyTimeline` propagates live: OFF hides immediately; ON (first load or re-enabled)
			// computes right away from the current scroll position instead of waiting for the next scroll.
			if (this.config?.stickyTimeline === false) {
				if (this.stickyTimeline != null) {
					this.stickyTimeline = undefined;
					this.stickyTimelineWindow = undefined;
				}
			} else if (this.stickyTimeline == null) {
				this.recomputeStickyTimelineBucket();
			}
		}

		// The host's `changesColumnEnabled` push is authoritative — clear the optimistic opt-in latch when it
		// lands (enabled = the overlay is gone anyway; still-disabled = the write was declined, re-show it).
		if (changed.has('changesColumnEnabled')) {
			this._changesEnableRequested = false;
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

		// `effectiveMaxInlineRefs` field-level compare (see `lastMaxInlineRefsRef`) — compares the RESOLVED
		// cap, not the raw config value, so a width-driven change in `'auto'` mode re-resolves cached
		// ref-pill overflow exactly when the resolved cap moves, without keying off whole-config identity.
		const maxInlineRefs = this.effectiveMaxInlineRefs;
		const maxInlineRefsChanged = maxInlineRefs !== this.lastMaxInlineRefsRef;
		this.lastMaxInlineRefsRef = maxInlineRefs;

		// Cache the search-matched sha set BEFORE lane derivations — the filter-mode displayRows filter
		// (applySearchFilter, reached via recomputeLaneDerivations) reads it. Rebuild ONLY when the
		// results object changes; a large search matches many shas, so recomputing the Set on every
		// update (selection, hover, …) while a search is active would be wasteful.
		const searchResultsChanged = this.searchResults !== this.lastSearchResultsRef;
		if (searchResultsChanged) {
			const sr = this.searchResults;
			this._searchMatchedShas = sr != null && 'count' in sr ? new Set(Object.keys(sr.ids ?? {})) : undefined;
		}
		const searchActive = this.searching || this._searchMatchedShas != null;
		const searchActiveChanged = searchActive !== this.lastSearchActive;
		this.lastSearchActive = searchActive;

		// Lane derivations depend on processedRows/segments, the default-mode config, whether a search
		// is active (an active search suppresses default lane-collapse so matches inside auto-collapsed
		// lanes stay visible), and the package-owned manual collapse intent.
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
		// Read hoisted (the `lastSearchModeRef` latch stays below) so the payload-only fast path can skip a
		// recompute that `recomputeSearchProjection` is about to do anyway.
		const searchModeChanged = this.searchMode !== this.lastSearchModeRef;
		const laneInputsChanged =
			(rowsChanged && !rowsPayloadOnly) ||
			scopeChanged ||
			configCollapseChanged ||
			foldingChanged ||
			searchActiveChanged;
		// Read once, reused below AND after the chain (to latch `lastRowUnitsActive`) — a cheap getter, but
		// no reason to re-derive `effectiveStyle`/`refsPlacement` twice in the same update.
		const rowUnitsActive = this.rowUnitsActive;
		// Set by the row-units branch below — the one path that can re-derive promotions (and so move unit
		// positions above the viewport) with the row SET completely unchanged. The viewport-anchor correction
		// further down needs that as a second trigger; `rowsChanged` alone would miss it.
		let rowUnitsMayHaveShifted = false;
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
				rowsChanged &&
				(this.engineTransition.kind === 'append' ||
					(this.engineTransition.kind === 'replace' && this.engineTransition.reconciled != null));
			this.recomputeLaneDerivations(
				(rowsChanged && !rowsIncremental) ||
					scopeChanged ||
					configCollapseChanged ||
					foldingChanged ||
					searchActiveChanged,
			);
		} else if (rowsPayloadOnly && !searchResultsChanged && !searchModeChanged) {
			this.recomputeDisplayRows();
		} else if (
			// `rowUnitsActive`'s three gates (the setting, `effectiveStyle`, `refsPlacement`) can each flip
			// WITHOUT a rows/scope/search change — none of the triggers above cover them — and, once active,
			// a ref-visibility filter change (excludeChanged/downstreamsChanged) can move which rows actually
			// promote without changing the row SET at all. Either funnels through the SAME recomputeDisplayRows
			// call the other branches above use (never a standalone rebuildRowUnits — see its pairing comment),
			// so it can only ever run once per update.
			rowUnitsActive !== this.lastRowUnitsActive ||
			(rowUnitsActive && (excludeChanged || downstreamsChanged))
		) {
			// A flip changes every promoted row's pill cap AND layout, but isn't in the adornment-eviction
			// gate below — evict here so cached pills re-resolve under the new mode. (The filter cases need
			// no eviction here: excludeChanged/downstreamsChanged are already in that gate.)
			if (rowUnitsActive !== this.lastRowUnitsActive) {
				this.invalidateAdornments();
			}

			rowUnitsMayHaveShifted = true;
			this.recomputeDisplayRows();
		}
		this.lastRowUnitsActive = rowUnitsActive;

		// Rows inserted ABOVE the viewport shift every row down WITHOUT changing `scrollTop`, so the commit the
		// user was reading silently slides out of the top slot and a newer one takes its place (measured: one
		// commit arriving moves the content exactly one row while the scrollbar never budges). Correct by the
		// UNIT-POSITION delta of the row we were parked on — still a count (of base row heights), not a
		// measurement, so this costs no layout, and it also catches a tall row appearing above the viewport,
		// which shifts pixels without changing any index. Paging and payload pushes resolve to a delta of 0 and
		// are left completely alone; an earlier attempt at this that MEASURED on every push thrashed layout and
		// starved paging.
		// TWO triggers, not one: rows arriving/leaving (the index delta), and a promotion re-derivation with
		// an unchanged row set (`rowUnitsMayHaveShifted` — toggling the setting, or a ref-visibility filter
		// change while it's on). The second moves NO index at all; only the unit-position disjunct below
		// catches it, and without it a promoted row appearing above the viewport slides the whole list.
		if (
			(rowsChanged || rowUnitsMayHaveShifted) &&
			this.wasScrolled &&
			this._viewportTopSha != null &&
			this.rowHeight > 0
		) {
			const nowAt = this.indexBySha.get(this._viewportTopSha);
			if (nowAt != null) {
				// `_rowUnits` is already the post-rebuild index: the lane/display recomputation above ran
				// `recomputeDisplayRows`, which rebuilds it in lockstep with `indexBySha`.
				const nowAtUnitPos = this._rowUnits.unitPosOf(nowAt);
				// Undefined before the first scroll tracked a row — fall back to the plain index delta.
				const wasAtUnitPos = this._viewportTopUnitPos;
				if (nowAt !== this._viewportTopIndex || (wasAtUnitPos != null && nowAtUnitPos !== wasAtUnitPos)) {
					this._pendingViewportTop = Math.max(
						0,
						this._viewportScrollTop +
							(nowAtUnitPos - (wasAtUnitPos ?? this._viewportTopIndex)) * this.rowHeight,
					);
					// The new position is committed only when the correction is actually APPLIED (a reveal can
					// preempt it). Advancing it here would strand `_viewportTopIndex` ahead of the unmoved
					// `_viewportScrollTop`, so the next update's delta would silently omit this shift.
					this._pendingViewportTopIndex = nowAt;
					this._pendingViewportTopUnitPos = nowAtUnitPos;
				}
			}
		}

		// The pinned ref's lane chain (and a held-Ctrl/Alt transient chain) was walked against the rows loaded
		// at the time — now bounded precisely at the merge base, so a branch's older commits that page in
		// later would otherwise arrive dimmed (outside the frozen set). Re-walk against the fresh rows. A
		// scope change already cleared the pin above, so this only fires for genuine paging/reconcile.
		if (rowsChanged && !rowsPayloadOnly) {
			if (this._pinnedRefKey != null && this._pinnedRefSha != null) {
				this.refHoverChainShas = this.laneChainFor(
					this.pinnedChainShas(this._pinnedRefKey, this._pinnedRefSha),
					'down',
				);
			}
			if (this.modifierChainShas != null) {
				// Force a re-walk (the seed dedup would otherwise keep the stale, shorter chain).
				this.lastModifierChainSeed = undefined;
				this.activateModifierChain();
			}
		}

		const wipChanged = this.wipStateById !== this.lastWipStateRef || this.repoPath !== this.lastWipRepoPath;
		if (wipChanged) {
			this.lastWipStateRef = this.wipStateById;
			this.lastWipRepoPath = this.repoPath;
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
		// The merge-target pull lands async (after the initial paint), and it drives the HEAD pill's role +
		// target segment — so evict cached adornments when it moves so the HEAD pill re-resolves with it.
		// (HEAD + upstream tips derive from rows/refRowIndex/refsMetadata, already covered above — except
		// the `currentBranch` fallback the tips use when HEAD isn't loaded, so it evicts too.)
		const rowMarkerChanged = changed.has('rowMarkerMergeTarget') || changed.has('currentBranch');
		// The HEAD waypoint can now resolve from the branch payload alone (unloaded HEAD), so a payload
		// arriving between range changes must recompute it — the range/scroll call sites won't fire.
		if (changed.has('currentBranch')) {
			this.updateHeadPillDirection();
		}
		if (
			rowsChanged ||
			laneInputsChanged ||
			providersChanged ||
			refsMetadataChanged ||
			excludeChanged ||
			downstreamsChanged ||
			showRemoteNamesChanged ||
			maxInlineRefsChanged ||
			rowMarkerChanged
		) {
			this.invalidateAdornments();
		}

		// Scroll-rail markers: recompute only when their inputs change (rendered rows, selection,
		// search hits, or the enabled marker types) — NOT on every update, so the per-frame render
		// path stays untouched. The marker set is bounded by ref'd/matched rows, so this is cheap.
		this.lastSearchModeRef = this.searchMode;
		// Search mode changes the projection's final visibility. Results changes already re-derived
		// structurally only when active/inactive changed; otherwise the filter-only path preserves
		// fold/scope rows and render identities. This must precede markers, which map rendered rows.
		if (!laneInputsChanged && (searchResultsChanged || searchModeChanged)) {
			this.recomputeSearchProjection();
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
		// The merge target lands AFTER the first paint (the scope-anchor pull) and moves again on a ref
		// invalidation — so it triggers the O(1) patch, never the row rescan. `scopeAnchors` is rewritten by
		// the lane derivation above, so its identity is a valid change signal by here.
		const mergeTargetShas = this.scopeAnchors.mergeTargetShas;
		const mergeTargetChanged = rowMarkerChanged || mergeTargetShas !== this.lastMergeTargetShasRef;
		if (baseMarkerInputsChanged || selectionChanged || mergeTargetChanged) {
			this.lastSearchResultsRef = this.searchResults;
			this.lastScrollMarkerTypesRef = markerTypes;
			this.lastMergeTargetShasRef = mergeTargetShas;
			// Selection/merge-target alone patch on top of the cached base markers — no row rescan.
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

		// Selection/focus/rows/config changes all reach here (an @state write or an explicit
		// requestUpdate() is how every one of those paths is already expressed) — one unconditional,
		// O(1) check covers them all instead of threading a call into every individual mutation site
		// (selection round-trip in this method above, ~8 onKeydown branches, onClick, jump-to-HEAD/
		// -pinned, Tab-in focus...). Hover is the one input that does NOT flow through here (see
		// handleRowHover/endRowHover) since hover never triggers a Lit render at all.
		this.updateStickyTimelineYield();
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

	// True when the Refs column sits immediately LEFT of the Graph column in the full zone order — here
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

	// Host zone the GRAPH groups into — BY ID (`graphHostZoneId`, captured at group-time), so the
	// [graph + host] pair travels together through reorders instead of jumping to whatever zone lands at
	// the anchor slot. Falls back to the anchor-slot derivation when unset — covers legacy persisted
	// `grouped: true` (no id) and a hidden/inlined captured host. Undefined when the graph is a column or
	// hidden (no grouped host). Mirrors `refsHostIdFor`.
	private graphHostIdFor(visibleZones: readonly ZoneSpec[]): string | undefined {
		if (this.graphPlacement !== 'grouped') return undefined;
		if (this.graphHostZoneId != null && visibleZones.some(z => z.id === this.graphHostZoneId)) {
			return this.graphHostZoneId;
		}
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
		// Refreshed once per render (not per row) — see `nowMs`'s own doc comment.
		this.nowMs = Date.now();
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
		// Same guarded-no-op contract: the layout compares by instance identity, so re-applying the same
		// index every render costs nothing.
		this.fixedRowLayout.units = this._rowUnits;
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
		// Resolved once here — rows + the hscrollbar lead below both read this single value (no per-row
		// recompute, no desync).
		const graphHostId = this.graphHostIdFor(visibleZones);
		// RowMarker tips (HEAD / upstream / merge-target shas + target name) — computed ONCE per render
		// and cached on the instance so the ref-pill role hook reads it without recomputing per pill.
		const tips = this.computeRowMarkerTips();
		this._rowMarkerTips = tips;
		// Resolved once here too — `_renderCtx.refsHostId` below reads the SAME value, and
		// `effectiveOwnLineRefCap` needs that zone's SOLVED width (own-line pills own their whole line, so
		// they cap against ITS width, not the inline case's share-of-row heuristic). Falls back to
		// 'message' — `refsHostIdFor`'s own fallback when no zone is visible under the current id — so a
		// mid-drag/zero-width render doesn't cap against a zone that resolved to none. If even THAT misses
		// (a stale mid-drag zone snapshot), keep the previous render's width rather than collapsing to 0,
		// which would floor the cap at one pill for a frame and re-resolve every promoted row's cached pills
		// for nothing; the next settled render self-corrects.
		const refsHostId = this.refsHostIdFor(zones);
		this._ownLineRefCapWidth =
			visibleZones.find(z => z.id === (refsHostId ?? 'message'))?.width ?? this._ownLineRefCapWidth;
		// Same resolved-cap eviction contract as `maxInlineRefsChanged` in willUpdate, but it must live HERE:
		// the own-line cap derives from the zone width SOLVED just above, which lands after that gate has
		// already run — tracking it up there would compare against the previous render's width and leave
		// promoted rows' cached pill counts stale at rest after a resize settles. Safe here: this method runs
		// inside willUpdate (see its call site), and `invalidateAdornments` only evicts — it never schedules
		// another update.
		const ownLineRefCap = this.effectiveOwnLineRefCap;
		if (this.rowUnitsActive && ownLineRefCap !== this._lastOwnLineRefCapRef) {
			this.invalidateAdornments();
		}

		this._lastOwnLineRefCapRef = ownLineRefCap;
		this._renderCtx = {
			total: rows.length,
			rowHeight: this.rowHeight,
			gutterWidth: this.gutterWidth,
			columnWidth: this.columnWidth,
			zones: visibleZones,
			rowsStats: this.rowsStats,
			style: style,
			graphPlacement: this.graphPlacement,
			graphColumnPos: graphVisSlot,
			graphHostId: graphHostId,
			foldLaneWidth: this.foldLaneWidth,
			graphColumnWidth: this.graphColumnWidth,
			inlineGutterWidth: this.inlineGutterWidth,
			groupedShifted: this.graphPlacement === 'grouped' && this.graphScrollX > 0,
			laneOffset: this.graphScrollX,
			singleColumn: this.singleColumn,
			laneWindow: laneWindow,
			refsPlacement: this.refsPlacement,
			refsHostId: refsHostId,
			unitsOf: index => this._rowUnits.unitsOf(index),
			// This consumer's only promoted rows (units > 1) sit their commit data on unit 1 (the bottom of
			// the 2-unit span) — see `computeRowUnits`. A future multi-unit consumer with its own placement
			// would need its own dataUnit derivation; this one is fixed by construction.
			dataUnitOf: index => (this._rowUnits.unitsOf(index) > 1 ? 1 : 0),
			nodeMode: nodeMode,
			nodeAvatars: nodeAvatars,
			selected: this.selectedShas,
			landingFlashSha: this._landingFlashSha,
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
			// The transient Ctrl-hold chain overrides the click-pin while held; falls back to the pin.
			inRefChainShas: this.modifierChainShas ?? this.refHoverChainShas,
			// Transient (Ctrl-hold) gets a lighter dim than the pinned focus — a peek, not a mode.
			chainTransient: this.modifierChainShas != null,
			dimMergeCommits: this.config?.dimMergeCommits,
			showGhostRefs: this.config?.showGhostRefsOnRowHover === true,
			getAvatarUrl: this.resolveAvatarUrl,
			getAdornments: this.resolveRowAdornments,
			getCommit: this.getCommitBySha,
			onAvatarError: this.onAvatarImgError,
			formatDate: useShortDate ? this.formatDateShortFn : this.formatDateFn,
			segmentByCommit: this.segmentByCommit,
			trunkTipSha: this.trunkGhostTipSha(),
			pinnedTipByCommit: this.pinnedTipByCommit,
			trunkCommitShas: this.trunkCommitShas,
			wipSegmentTips: this.wipSegmentTips,
			collapsedTips: this.effectiveCollapsed,
			wipStateBySha: this.wipStateBySha,
			runningOperationByRowSha: this.runningOperationByRowSha,
			agentStatusByRowSha: this.agentStatusByRowSha,
			wipStateById: this.wipStateById,
			primaryWipRowId: this.primaryWipRowId,
			rowMarkerTips: tips,
			wipRowMarkerPill: this.buildWipRowMarkerPill(tips),
		};
		// Horizontal-scrollbar geometry (CSSOM, so the thumb tracks scroll without extra reflow). Left
		// edge = the fixed zones before the lanes + the fold strip (matches graph-row's `graphLeadOffset`
		// so the bar lines up with the gutter viewport); width = the viewport; thumb = proportional with
		// a floor; thumb offset maps [0, max] onto the leftover track.
		// Column placement splices the graph at `graphVisSlot` (0..length) so the lead sums every preceding
		// zone; inline shares the resolved HOST zone (by id — falls back to the anchor-slot clamp when the
		// host isn't in `visibleZones`). Clamping the column case dropped the last column's width when the
		// graph was the LAST column (band/scrollbar anchored one column short). List mode renders the lanes
		// leftmost, so the lead is 0.
		const graphHostVisIdx = visibleZones.findIndex(z => z.id === graphHostId);
		const leadCount =
			this.effectiveStyle === 'list'
				? 0
				: this.graphPlacement === 'column'
					? Math.min(graphVisSlot, visibleZones.length)
					: graphHostVisIdx >= 0
						? graphHostVisIdx
						: Math.min(graphVisSlot, Math.max(0, visibleZones.length - 1));
		let leadOffset = 0;
		for (let i = 0; i < leadCount; i++) {
			leadOffset += visibleZones[i].width;
		}
		// The active placement's REAL lane-area width — the resizable column's lane area, grouped's uniform
		// cap, 0 when hidden (no lanes; `graphColumnWidth` still resolves to a phantom "what it would be if
		// shown" size there). `--graph-col-vw` (below) feeds the timeline-separator gradient (graph.scss),
		// so grouped must report the inline cap, not the phantom column width; the scrollbar self-gates on
		// `graphPlacement === 'column'`, where the two agree.
		const viewport = this.graphLaneViewport;
		const content = this.gutterWidth;
		const thumb = content > 0 ? Math.max(graphHScrollMinThumbPx, (viewport * viewport) / content) : viewport;
		const travel = Math.max(0, viewport - thumb);
		const max = this.maxGraphScrollX;
		this.style.setProperty('--graph-col-left', `${leadOffset + this.foldLaneWidth}px`);
		this.style.setProperty('--graph-col-vw', `${viewport}px`);
		// Chain-lane highlight overlay: one bright rule per contiguous same-column run of the active ref
		// chain (the Ctrl-hold transient wins over the click-pin — same precedence as `inRefChainShas`
		// above), painted OUTSIDE every row so `.is-dimmed`'s opacity can never dim it (see
		// `syncChainLaneOverlay`, called from `updated()`). No overlay when nothing's chained, the graph
		// column is hidden (no lanes to draw on), or the lanes are collapsed onto a single column (a
		// run-spanning rule would then cross OTHER commits' dots sharing that x). The RUNS are memoized on
		// the chain-set + displayRows identity (`_chainLane*For`, same pattern as `_scopeIdentityFor`) —
		// the O(chain) walk reruns only when a chain is set/cleared or displayRows swaps (paging, lane
		// collapse/expand, filter). The render-ready BOXES are rebuilt every pass (≤2 runs, trivial): they
		// bake in `rowHeight` (zoom/DPR) and `columnWidth` (density), which can change without either memo
		// identity changing — and the gate below must not poison the memo, or leaving single-column mode
		// with the same chain would never restore the overlay.
		const activeChain = this.modifierChainShas ?? this.refHoverChainShas;
		if (activeChain == null || this.graphPlacement === 'hidden' || this.singleColumn) {
			this._chainLaneOverlay = undefined;
		} else {
			if (this._chainLaneChainFor !== activeChain || this._chainLaneRowsFor !== rows) {
				this._chainLaneChainFor = activeChain;
				this._chainLaneRowsFor = rows;
				this._chainLaneRuns = computeChainLaneRuns(activeChain, this.indexBySha, rows);
			}

			this._chainLaneOverlay = this._chainLaneRuns?.map(run => this.buildChainLaneBox(run));
		}
		this.style.setProperty('--graph-hscroll-thumb', `${thumb}px`);
		this.style.setProperty('--graph-hscroll-left', `${max > 0 ? (this.graphScrollX / max) * travel : 0}px`);
		// Pass-through raster layer's h-scroll translate + edge-fade mask gates — set on the render path too so
		// freshly rendered / recycled rows position + fade their raster before the first clamp overlay pass paints.
		this.updateGutterScrollVars();
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
		this.style.setProperty('--gutter-inset', `${nodeRadiusFor(this.nodeSizingMode, this.rowHeight) + 2}px`);
	}

	// Converts one `ChainLaneRun` (display-row indices + an optional fork `extension`) into the
	// render-ready pixel geometry `syncChainLaneOverlay` mounts. Kept OUT of `updateRenderState` (a thin
	// per-run map) so the elbow's border-centering math has room to be commented properly.
	private buildChainLaneBox(run: ChainLaneRun): ChainLaneBox {
		const rowHeight = this.rowHeight;
		const top = (run.startIndex + 0.5) * rowHeight; // the tip dot's center
		const x = xForColumn(run.column, this.columnWidth);
		const color = colorForColumn(run.column);
		// Default: the rule ends at the last chained row's dot center (matches the pre-extension geometry).
		let ruleHeight = (run.endIndex - run.startIndex) * rowHeight;

		if (run.extension?.kind === 'clamp') {
			// No elbow — the engine's own art doesn't lead anywhere further, so neither does the rule. Just
			// a taller vertical stub, reaching the TOP of the row where continuity broke.
			ruleHeight = run.extension.clampIndex * rowHeight - top;
		}

		if (run.extension?.kind !== 'fork') {
			return { top: top, height: ruleHeight, ruleHeight: ruleHeight, x: x, color: color };
		}

		const { forkIndex, forkColumn } = run.extension;
		const forkX = xForColumn(forkColumn, this.columnWidth);
		const direction: 'left' | 'right' = forkX < x ? 'left' : 'right';
		// Keep the horizontal segment off the fork row's own (possibly dimmed) dot — the same clearance
		// the live gutter pin uses for `--gutter-inset` above.
		const inset = nodeRadiusFor(this.nodeSizingMode, rowHeight) + 2;
		// `border-box` sizing: a border paints INWARD from its box's outer edge by its own width, so its
		// visual centerline sits half a width in from that edge (0.2rem / 2 = 0.1rem = 1px at 1rem=10px —
		// the SAME half-width the rule's translate subtracts to center itself on `x`). Whichever edge
		// carries the CHAIN-side vertical border is offset by that 1px so its centerline lands exactly on
		// `x`; the FORK-side edge is inset off the fork's dot instead, not centered on anything.
		const halfBorderPx = 1;
		const left = direction === 'left' ? forkX + inset : x - halfBorderPx;
		const right = direction === 'left' ? x + halfBorderPx : forkX - inset;
		const elbowHeight = (forkIndex - run.endIndex) * rowHeight; // ends at the fork row's dot center

		return {
			top: top,
			// The container spans the rule AND the elbow beneath it — `syncChainLaneOverlay` clips both to
			// this one box.
			height: ruleHeight + elbowHeight,
			ruleHeight: ruleHeight,
			x: x,
			color: color,
			elbow: {
				height: elbowHeight,
				left: left,
				width: Math.max(0, right - left),
				direction: direction,
			},
		};
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
		// `|remotes/` inverts `getBranchId`, which builds `${repoPath}|remotes/${name}` for a remote branch.
		const focalHasHead = this.scope?.branchRef.includes('|remotes/') === true ? rowHasRemoteHead : rowHasLocalHead;

		// The scope names its additional branches by ref id, but the scope math resolves by NAME, so invert
		// `getBranchId` here. Each ref carries its own namespace and a stack can mix them (a layer with no
		// local branch falls back to its remote), so the namespace is tracked per name and the predicate
		// dispatches on it — resolving in one namespace only, for the same reason the focal predicate does.
		const remoteNames = new Set<string>();
		const localNames = new Set<string>();
		const additionalBranchNames: string[] = [];
		for (const ref of this.scope?.additionalBranchRefs ?? []) {
			const remoteAt = ref.indexOf('|remotes/');
			const name = remoteAt >= 0 ? ref.slice(remoteAt + '|remotes/'.length) : undefined;
			if (name != null) {
				remoteNames.add(name);
				additionalBranchNames.push(name);
				continue;
			}

			const localAt = ref.indexOf('|heads/');
			if (localAt >= 0) {
				const localName = ref.slice(localAt + '|heads/'.length);
				localNames.add(localName);
				additionalBranchNames.push(localName);
			}
		}

		// Both namespaces are tracked, not just the remote one: the focal predicate is the fallback, so a
		// LOCAL additional branch under a remote focal branch (a stack whose base layer has no local branch)
		// would otherwise be looked up as `${owner}/${name}` and never resolve — dropping that layer's
		// commits from the scope with no error anywhere.
		const hasHead: ScopeHeadsPredicate<GitGraphRow> = (row, branchName) =>
			remoteNames.has(branchName)
				? rowHasRemoteHead(row, branchName)
				: localNames.has(branchName)
					? rowHasLocalHead(row, branchName)
					: focalHasHead(row, branchName);

		const anchors = computeScopeAnchors(
			this.rows,
			this.scope != null && additionalBranchNames.length
				? { ...this.scope, additionalBranchNames: additionalBranchNames }
				: this.scope,
			hasHead,
		);
		this.scopeAnchors = anchors;
		this.inScopeShas = computeInScopeShas(
			this.rows,
			this.scope,
			anchors.focalTipShas,
			anchors.mergeTargetShas,
			anchors.forkPointShas,
			anchors.additionalTipShas,
		);
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
		const filter = this.resolveRefVisibility();
		if (filter == null) return rows;

		const reachable = collectReachable(rows, this.collectVisibleRefTips(rows, filter));
		return rows.filter(r => (r.kind === 'commit' || r.kind === 'merge' ? reachable.has(r.sha) : true));
	}

	/**
	 * The ref narrowing the row filter runs under, or `undefined` when nothing narrows the ref set (the
	 * 'all' default — every commit stays visible, so the filter is a no-op). Fast path for the common case.
	 *
	 * Focusing a branch is explicit intent and outranks the implicit `branchesVisibility` include
	 * set — the same rule the WIP rows follow (`filterSecondariesForScopeAndVisibility`,
	 * `shouldShowPrimaryWipRow`). Without it the scope chip reads "Showing X Only" while the mode
	 * quietly filters X's own commits out from under it, leaving the projection unable to resolve
	 * its focal tip: focused in name, unfocused on screen.
	 *
	 * Only the mode-derived include set is waived. `excludeRefs` and the type toggles are explicit
	 * per-ref/per-type hiding, so they keep applying — same line `filterSecondariesForScope` draws.
	 * Nothing here mutates the mode, so unfocusing simply resumes filtering against it.
	 *
	 * `waivers` resolves one class of narrowing as if unset — only {@link getRowHiddenReason} passes them.
	 */
	private resolveRefVisibility(waivers?: RefVisibilityWaivers): RefVisibilityFilter | undefined {
		const includeOnly = waivers?.includeOnly === true || this.scope != null ? undefined : this.includeOnlyRefs;
		const excludeRefs = waivers?.excludeRefs === true ? undefined : this.excludeRefs;
		const waiveTypes = waivers?.excludeTypes === true;
		const filter: RefVisibilityFilter = {
			// Empty maps are normalized away so every consumer can read presence as "narrowing".
			includeOnly: includeOnly != null && Object.keys(includeOnly).length > 0 ? includeOnly : undefined,
			excludeRefs: excludeRefs != null && Object.keys(excludeRefs).length > 0 ? excludeRefs : undefined,
			hideHeads: !waiveTypes && this.excludeTypes?.heads === true,
			hideRemotes: !waiveTypes && this.excludeTypes?.remotes === true,
			hideTags: !waiveTypes && this.excludeTypes?.tags === true,
		};
		if (
			filter.includeOnly == null &&
			filter.excludeRefs == null &&
			!filter.hideHeads &&
			!filter.hideRemotes &&
			!filter.hideTags
		) {
			return undefined;
		}

		return filter;
	}

	/** Shas of the rows carrying a ref tip `filter` leaves visible — the seeds of the row filter's
	 *  reachability walk. */
	private collectVisibleRefTips(rows: readonly GitGraphRow[], filter: RefVisibilityFilter): Sha[] {
		const { includeOnly, excludeRefs, hideHeads, hideRemotes, hideTags } = filter;
		const excludedRemotes = getExcludedRemotes(excludeRefs);

		const refVisible = (id: string | undefined, hiddenType: boolean): boolean => {
			if (hiddenType) return false;
			if (excludeRefs != null && id != null && excludeRefs[id] != null) return false;
			// Include-only modes require the ref to be listed; otherwise any non-excluded ref counts.
			return includeOnly != null ? id != null && includeOnly[id] != null : true;
		};

		const visibleTips: Sha[] = [];
		for (const row of rows) {
			if (row.kind !== 'commit' && row.kind !== 'merge') continue;

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
					const excludedRemote = excludedRemotes?.get(r.owner);
					if (excludedRemote != null && (r.id == null || !excludedRemote.exceptIds.has(r.id))) continue;

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

		return visibleTips;
	}

	private recomputeRows(idLength: number): void {
		const rows = this.rows ?? [];
		// A DIRECT repo swap lands here with rows already present, so the empty-rows reset below never runs
		// and the previous repo's tracked viewport row would survive into the new graph — where an
		// overlapping sha (a shared commit, a fork, the same repo opened twice) resolves and re-parks the
		// viewport at the old repo's position. Drop the tracking on identity change.
		if (this.repoPath !== this._lastScrollRepoPath) {
			this._lastScrollRepoPath = this.repoPath;
			this.cancelPendingReveal();
			this._pendingViewportTop = undefined;
			this._pendingViewportTopIndex = undefined;
			this._pendingViewportTopUnitPos = undefined;
			this._viewportTopSha = undefined;
			this._viewportTopIndex = 0;
			this._viewportTopUnitPos = undefined;
			this._viewportScrollTop = 0;
			// Same overlapping-sha hazard, one field over: a sha revealed in the PREVIOUS repo would make an
			// `'if-changed'` reveal for the same sha here read as "already handled" and silently decline,
			// leaving the newly selected row wherever it happened to fall. Not folded into
			// `cancelPendingReveal` — cancelling a queued reveal (a click does it) must NOT forget what was
			// last revealed, or every cancel would re-enable a passive re-push we mean to suppress.
			this._lastRevealedSha = undefined;
		}

		if (rows.length === 0) {
			this._pendingViewportTop = undefined;
			this._pendingViewportTopIndex = undefined;
			this._pendingViewportTopUnitPos = undefined;
			this._viewportTopSha = undefined;
			this._viewportTopIndex = 0;
			this._viewportTopUnitPos = undefined;
			this._viewportScrollTop = 0;
		}

		// `excludeTypes.stashes` hides stash ROWS (not just a label) — drop them from the engine input so
		// the layout + edges thread without them (no dangling lanes).
		const stashFiltered = this.excludeTypes?.stashes === true ? rows.filter(r => r.kind !== 'stash') : rows;
		// Branches-visibility (Current/Smart/Favorited) + hidden-ref filtering: drop commit rows not
		// reachable from any visible ref tip so hidden branches' commits AND lanes disappear, not just
		// their pills. Threads through the engine over the reduced set (no orphaned lane reservations).
		const sourceRows = this.filterRowsByRefVisibility(stashFiltered);

		// Which refs the user scoped to — `branchRef`/`additionalBranchRefs` are their choice, while
		// `focalBranchTipSha`/`mergeTargetTipSha`/`mergeBase` are resolved values that advance with the repo.
		// Keying on the choice is what separates "the user switched view" (refresh) from "the anchors
		// re-resolved" (stay stable).
		// Serialized structurally: ref names may contain commas (and most other punctuation), so a joined
		// string is not injective — two different ref sets could collide and silently suppress the refresh.
		// The additional refs are set-like, so canonicalize their order; reordering them isn't a scope change.
		// Memoized on the scope OBJECT: it holds a stable reference across the far more frequent rows-only
		// updates, so the sort + stringify would otherwise run on every host push for an unchanged scope.
		if (this._scopeIdentityFor !== this.scope) {
			this._scopeIdentityFor = this.scope;
			this._scopeIdentity =
				this.scope != null
					? JSON.stringify([this.scope.branchRef, (this.scope.additionalBranchRefs ?? []).toSorted()])
					: undefined;
		}

		// Pin the branch (gitlens.graph.pinBranchToEdge) to the leftmost lane(s) via the engine's
		// `pinnedShas`. Resolved here so the jump-pill target + the layout share one source.
		const pinnedSha = this.resolvePinnedSha(sourceRows);
		this.pinnedSha = pinnedSha;

		const engineStartedAt = DEBUG ? performance.now() : 0;
		const state = this.engineSession.update({
			identity: this.repoPath,
			sourceRows: sourceRows,
			toCommit: row => toGraphCommit(row, idLength, this.repoPath, this.pinnedRef?.id),
			headSha: rows.find(row => row.heads?.some(head => head.isCurrentHead))?.sha,
			pinnedShas: pinnedSha != null ? [pinnedSha] : undefined,
			syntheticChildren: this.scopeAnchors.syntheticChildren,
			viewKey: this._scopeIdentity,
		});
		if (DEBUG) {
			getGraphDebugDiagnostics().measureStage('engine', engineStartedAt, {
				transition: state.transition.kind,
				sourceRows: sourceRows.length,
				processedRows: state.rows.length,
				reconciled:
					state.transition.kind === 'replace' ? (state.transition.reconciled?.reused ?? 0) : undefined,
			});
		}
		this.engineTransition = state.transition;
		this.lastRowsDeltaPayloadOnly = state.transition.kind === 'payload';
		if (DEBUG && state.transition.kind !== 'append') {
			getGraphDebugDiagnostics().cancelPage();
		}

		this.commits = state.commits;
		this.processedRows = state.rows;
		this.segments = state.segments;
		this.unloadedColumns = state.unloadedColumns;
		this.processedIndexBySha = state.indexBySha;
		this.headSha = state.headSha;
		this.trunkSegmentTip = state.trunkSegmentTip;
		this.segmentByCommit = state.segmentByCommit;
		this.pinnedTipByCommit = state.pinnedTipByCommit;
		this.trunkCommitShas = state.trunkCommitShas;
		this.wipAnchorShas = state.wipAnchorShas;
		this.workdirShas = state.workdirShas;
		this.wipSegmentTips = state.wipSegmentTips;
		// `indexBySha`/`maxColumn` are derived off `displayRows` in recomputeDisplayRows so they
		// track what's actually rendered.
	}

	// Update the package-owned collapse/scope/search projection, then apply the UI-owned focus restoration,
	// ref indexes, and paging trigger. `refreshDefaultCollapse` deliberately re-derives the frozen default
	// fold set; paging and manual toggles preserve it so scrolling never auto-folds rows away.
	private recomputeLaneDerivations(refreshDefaultCollapse = false): void {
		const prevFocusedSha = this.displayRows[this.focusIndex]?.sha;
		const projectionStartedAt = DEBUG ? performance.now() : 0;
		const state = this.projectionSession.update(
			{
				identity: this.repoPath,
				viewKey: this._scopeIdentity,
				rows: this.processedRows,
				segments: this.segments,
				unloadedColumns: this.unloadedColumns,
				indexBySha: this.processedIndexBySha,
				transition: this.engineTransition,
				trunkSegmentTip: this.trunkSegmentTip,
				wipAnchorShas: this.wipAnchorShas,
				wipSegmentTips: this.wipSegmentTips,
				foldingEnabled: this.foldingEnabled,
				foldingDefault: this.foldingDefault,
				searchActive: this.searching || this._searchMatchedShas != null,
				filterShas: this.searchMode === 'filter' ? this._searchMatchedShas : undefined,
				scope: this.scope,
				scopeAnchors: this.scopeAnchors,
			},
			{ refreshDefaultCollapse: refreshDefaultCollapse },
		);
		if (DEBUG) {
			getGraphDebugDiagnostics().measureStage('projection', projectionStartedAt, {
				processedRows: this.processedRows.length,
				displayRows: state.rows.length,
				collapsed: state.effectiveCollapsed.size,
				scope: state.scopeProjection != null,
				scopeDropped: state.scopeProjection?.dropped.size ?? 0,
				searchMode: this.searchMode,
				transition: this.engineTransition.kind,
			});
		}
		this.applyProjectionState(state);
		this.recomputeDisplayRows(prevFocusedSha);
	}

	private applyProjectionState(state: CommitGraphProjectionState): void {
		this.displayRows = state.rows;
		this.indexBySha = state.indexBySha;
		this.maxColumn = state.maxColumn;
		this.scopeProjection = state.scopeProjection;
		this.segmentsByTipSha = state.segmentsByTipSha;
		this.hiddenCountByTipSha = state.hiddenCountByTipSha;
		this.effectiveCollapsed = state.effectiveCollapsed;
	}

	private recomputeSearchProjection(): void {
		const prevFocusedSha = this.displayRows[this.focusIndex]?.sha;
		const projectionStartedAt = DEBUG ? performance.now() : 0;
		const state = this.projectionSession.updateFilter(
			this.searchMode === 'filter' ? this._searchMatchedShas : undefined,
		);
		if (DEBUG) {
			getGraphDebugDiagnostics().measureStage('projection-filter', projectionStartedAt, {
				processedRows: this.processedRows.length,
				displayRows: state.rows.length,
				searchMode: this.searchMode,
			});
		}
		this.applyProjectionState(state);
		this.recomputeDisplayRows(prevFocusedSha);
	}

	// Recompute the scroll-rail markers from the rendered rows + search/selection/merge-target state. The
	// base (ref/stash/WIP/search) markers need a full pass over the rendered rows, so they're cached and
	// rebuilt only when their inputs change; a selection or merge-target change patches on top via the
	// display index — O(selection) / O(targets) — so neither a click nor the deferred merge-target resolve
	// ever rescans the graph.
	private recomputeScrollMarkers(patchOnly = false): void {
		const types = this.config?.scrollMarkerTypes;
		if (types == null || types.length === 0 || this.displayRows.length === 0) {
			this.baseScrollMarkers = [];
			this.scrollMarkers = [];
			this.scrollMarkerRows = [];
			return;
		}

		const enabled = new Set(types);
		if (!patchOnly) {
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
				repoPath: this.repoPath,
			});
		}

		const selection = buildSelectionScrollMarkers(this.selectedShas, this.indexBySha, enabled);
		const mergeTarget = buildMergeTargetScrollMarkers(
			this.mergeTargetShas(),
			this.indexBySha,
			enabled,
			this.rowMarkerMergeTarget?.name,
		);
		// `pinnedSha` is the resolved sha `recomputeRows` already computed for the lane pin + jump waypoint,
		// so the rail, the pinned lane and the waypoint can never disagree about which row the pin is on.
		const pinned = buildPinnedScrollMarkers(this.pinnedSha, this.indexBySha, enabled, this.pinnedRef?.name);
		this.scrollMarkers =
			selection.length > 0 || mergeTarget.length > 0 || pinned.length > 0
				? [...this.baseScrollMarkers, ...selection, ...mergeTarget, ...pinned]
				: this.baseScrollMarkers;
		this.scrollMarkerRows = groupScrollMarkersByRow(this.scrollMarkers);
	}

	// Apply UI state derived from the package-owned rendered-row snapshot. The package owns final
	// row visibility, display indexing, and graph width; focus, paging, and payload indexes stay here.
	private recomputeDisplayRows(prevFocusedSha = this.displayRows[this.focusIndex]?.sha): void {
		// Remember which commit is focused so keyboard focus follows the same commit across a
		// collapse/expand instead of silently landing on a different row at the old index.
		// The snapshot identity also tells the UI whether paging appended rows or replaced the view.
		const lastIndexed = this.lastIndexedDisplayRowsRef;
		const displayRowsUnchanged = this.displayRows === lastIndexed;
		const displayRowsAppended =
			!displayRowsUnchanged &&
			lastIndexed != null &&
			lastIndexed.length > 0 &&
			this.displayRows.length > lastIndexed.length &&
			this.displayRows[0] === lastIndexed[0] &&
			this.displayRows[lastIndexed.length - 1] === lastIndexed.at(-1);
		if (displayRowsAppended) {
			this.lastIndexedDisplayRowsRef = this.displayRows;

			// Pipelined prefetch: a page just applied (identity-prefix append). If the last rendered range is
			// STILL within the prefetch distance of the new end, immediately request the next page instead of
			// waiting for another scroll event — so sustained scrolling keeps exactly one page in flight. The
			// wrapper defers this if a request is already active, and drops it once paging stops (filter-mode
			// result set fully loaded / `hasMore` false). Undebounced: it's already rate-limited by the round
			// trip, and riding `emitMoreRows` would stall it behind a pending keyboard/scroll ask.
			if (this.needsMoreRows(this.pendingRangeLast)) {
				this.dispatchMoreRows();
			}
		} else if (!displayRowsUnchanged) {
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
		let refRowIndex: Map<string, { sha: string; index: number }>;
		let localByUpstreamId: Map<string, { sha: string; index: number; id?: string; name?: string }>;
		if (
			cachedRef != null &&
			cachedLocal != null &&
			this.processedRows === priorIndexedRows &&
			this.commits === priorIndexedCommits
		) {
			refRowIndex = cachedRef;
			localByUpstreamId = cachedLocal;
		} else if (
			cachedRef != null &&
			cachedLocal != null &&
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
			for (let i = priorIndexedRows.length; i < this.processedRows.length; i++) {
				this.indexRowRefs(i, refRowIndex, localByUpstreamId);
			}
			this.lastRefIndexRowsRef = this.processedRows;
			this.lastRefIndexCommitsRef = this.commits;
		} else {
			refRowIndex = new Map<string, { sha: string; index: number }>();
			localByUpstreamId = new Map<string, { sha: string; index: number; id?: string; name?: string }>();
			for (let i = 0; i < this.processedRows.length; i++) {
				this.indexRowRefs(i, refRowIndex, localByUpstreamId);
			}
			this.cachedRefRowIndex = refRowIndex;
			this.cachedLocalByUpstreamId = localByUpstreamId;
			this.lastRefIndexRowsRef = this.processedRows;
			this.lastRefIndexCommitsRef = this.commits;
		}
		this.refRowIndex = refRowIndex;
		this.localByUpstreamId = localByUpstreamId;

		// Restore focus to the same commit if still visible; otherwise clamp into range. (An unchanged
		// or purely-appended rendered list can't move the focused row, so those paths leave focus put.)
		if (!displayRowsUnchanged && !displayRowsAppended && prevFocusedSha != null) {
			const restored = this.indexBySha.get(prevFocusedSha);
			this.focusIndex = restored ?? Math.max(0, Math.min(this.focusIndex, this.displayRows.length - 1));
		}
		this.requestMissingRefsMetadata();
		// Paired with the `indexBySha`/focus rebuild above — the two must never split, or the viewport
		// anchor's unit deltas would be measured against a stale row set.
		this.rebuildRowUnits();
	}

	// `gitlens.graph.refs.layout` (`'stacked'`): rows with real ref decorations grow a second unit (pills on top, commit
	// data on the bottom) — but only where that's meaningful. Table style only: list style already stacks
	// 2 lines of its own (see renderListBody) with pills sharing line 2, and has no zone columns to split a
	// pill line out of. `refsPlacement === 'grouped'` only: `'column'` already gives refs their own cell
	// (nothing to promote — the pills aren't sharing a line with anything), and `'hidden'` renders no pills
	// at all. Both `effectiveStyle` and `refsPlacement` are cheap getters/fields, safe to re-read every
	// willUpdate (see the `lastRowUnitsActive` trigger below, which re-derives displayRows when this flips).
	private get rowUnitsActive(): boolean {
		return (
			this.config?.refsLayout === 'stacked' && this.effectiveStyle === 'table' && this.refsPlacement === 'grouped'
		);
	}

	// Whether row `row` promotes to 2 units under the own-line consumer: it carries at least one REAL,
	// currently-VISIBLE ref decoration (a head/remote/tag surviving the active hide filters — the same
	// `isRefHidden` check `createRefAdornmentProvider` filters through, so a row that would render zero
	// pills never reserves a blank pill line) — never a ghost/hover pill, which only ever renders in the
	// dedicated Refs column and carries no promotion weight here. Workdir/stash rows are excluded outright:
	// neither has a meaningful "this row's own branch" pill in the sense this setting promotes (a WIP row's
	// branch pill is the separate row-marker proxy, not this adornment). Shared by `computeRowUnits` (the
	// rebuild) and the `getMaxInlineRefs` hook (the own-line cap only applies to rows that actually promote)
	// so the two decisions can never drift apart.
	private rowPromotesToOwnLine(row: ProcessedGraphRow): boolean {
		if (row.kind === 'workdir' || row.kind === 'stash') return false;

		const refs = this.getCommitBySha(row.sha)?.commitRefs;
		if (refs == null || refs.length === 0) return false;

		return refs.some(r => !isRefHidden(r, this.excludeTypes, this.excludeRefs, this.downstreams));
	}

	// The unit-height of the row at `index` — an integer >= 1, where 1 is an ordinary `rowHeight` row.
	private computeRowUnits(index: number): number {
		const row = this.displayRows[index];
		if (row == null) return 1;

		return this.rowPromotesToOwnLine(row) ? 2 : 1;
	}

	// Rebuild the tall-row index over the current `displayRows`.
	// TODO: a paging append re-scans every row. `recomputeDisplayRows` already computes a robust identity-
	// verified `displayRowsAppended` signal (same prefix, same endpoints) that `RowUnitsIndex.extend` could
	// consume to re-derive just the appended tail — but that signal alone doesn't prove the UNTOUCHED
	// prefix's promotions are still current: a ref-visibility filter change (excludeTypes/excludeRefs/
	// downstreams) can land in the very same recomputeDisplayRows call (this method has no visibility into
	// what triggered its caller) and move a prefix row's promotion without touching `displayRows` identity
	// at all. Wiring that through safely needs the trigger context threaded in, not just this method — left
	// as a full rescan (cheap relative to everything else recomputeDisplayRows already does) until a
	// consumer needs the win.
	private rebuildRowUnits(): void {
		if (!this.rowUnitsActive) {
			this._rowUnits = RowUnitsIndex.uniform;
			return;
		}

		// Keep the CURRENT instance when the rebuild produced the same tall rows: the layout's `units` setter
		// guards on instance identity, so handing it a fresh-but-equal index would reflow the whole
		// virtualizer on every payload-only recompute (which never moves a promotion). The uniform case
		// short-circuits on its own — `build` returns the shared singleton.
		const next = RowUnitsIndex.build(this.displayRows.length, i => this.computeRowUnits(i));
		if (!next.equalsIndex(this._rowUnits)) {
			this._rowUnits = next;
		}
	}

	// Fold row `i`'s payload refs into the split-pill indexes (shared by the full rebuild and the
	// append patch; rows/commits align by index).
	private indexRowRefs(
		i: number,
		refRowIndex: Map<string, { sha: string; index: number }>,
		localByUpstreamId: Map<string, { sha: string; index: number; id?: string; name?: string }>,
	): void {
		const r = this.processedRows[i];
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
	//
	// `focus: false` keeps the keyboard where it is — the ref find widget steps through matches while the
	// user is still typing, so taking the tree's focus mid-jump would strand them. Everything else jumps
	// with focus, which is the default.
	//
	// Both callers land and both flash — a ref's tip is exactly the "jump here, then read back through
	// history" case the landing ratio is shaped for, and the flash is left to the reveal so it fires when the
	// row arrives rather than when the click did (which for an unpaged target are far apart).
	/** Expands the collapsed lane hiding `sha`, if that's what is hiding it — so a reveal armed for the
	 *  row can land once the expanded row renders. Returns whether a lane was expanded. */
	expandLaneFor(sha: Sha): boolean {
		if (this.indexBySha.has(sha)) return false;

		const tip = this.segmentByCommit.get(sha);
		if (tip == null || !this.effectiveCollapsed.has(tip)) return false;

		this.toggleLane(tip);
		return true;
	}

	private jumpToRefRow(sha: Sha, options?: { focus?: boolean; flash?: boolean }): void {
		const focus = options?.focus ?? true;
		// If the target is hidden inside a collapsed lane, expand that lane first so it can be revealed —
		// scrollToSha keeps the reveal PENDING and retries once the expanded row renders.
		this.expandLaneFor(sha);
		// Route loaded, collapsed, and unloaded targets through one wrapper-owned operation. It owns the
		// load/select/reveal lifecycle and preserves the newest user intent while any row is materializing.
		// Focus the tree first to drop the pill/sub-chip that triggered the jump (collapsing its fill and
		// closing any grouped popover), preserving the existing handoff for every target state. The explicit
		// focus policy moves the keyboard/ARIA anchor to the target after selection renders.
		if (focus) {
			this.treeRef.value?.focus();
		}
		document.dispatchEvent(
			new CustomEvent('gl-jump-to-commit', {
				detail: { sha: sha, focus: focus, flash: options?.flash ?? true },
			}),
		);
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

	// Dedupe by content so the paging signal doesn't refire every render; resets when the set
	// empties so a future unreachable set fires once more.
	//
	// The loaded row COUNT is part of the key: reachability is row membership, so rows arriving without
	// landing the anchor is a new fact, not a re-render, and the consumer's retry (which releases a parked
	// page request once rows grow — see `onScopeAnchorsUnreachable`) is reachable only if we re-emit for
	// it. Bounded on the consumer side by an attempt cap, not here.
	private emitUnreachableAnchors(unreachable: ReadonlySet<string> | undefined): void {
		const key = unreachable != null ? `${this.rows?.length ?? 0}:${[...unreachable].sort().join(',')}` : '';
		if (key === this.lastEmittedUnreachableKey) return;

		this.lastEmittedUnreachableKey = key;
		if (unreachable == null || unreachable.size === 0) return;

		this.dispatchEvent(new CustomEvent('gl-graph-scopeanchorsunreachable', { detail: unreachable }));
	}

	// Toggle a lane segment synchronously so a second input in the same Lit update cycle observes
	// the new state. The projection session owns the collapse intent and derived row projection.
	private toggleLane(tipSha: string): void {
		// Anchor the viewport across the displayRows swap so a collapse/expand doesn't shift the content the
		// user is looking at — and doesn't strand it under a fixed scrollTop when the fixed-size layout
		// shrinks the spacer (the native-clamp variant). Captured against the CURRENT rows BEFORE the
		// re-derivation; resolved against the NEW rows just after. Applied in updated(); an armed reveal wins
		// (scrollToSha clears the anchor), so this never fights a jump-to-row.
		const scrollAnchor = this.captureLaneScrollAnchor();
		const prevFocusedSha = this.displayRows[this.focusIndex]?.sha;

		const toggle = this.projectionSession.toggle(tipSha);
		if (toggle == null) return;

		this.applyProjectionState(toggle.state);
		this.recomputeDisplayRows(prevFocusedSha);
		this.rebuildProviders();
		this.invalidateAdornments();
		if (scrollAnchor != null) {
			this._pendingScrollAnchorTop = this.resolveLaneScrollAnchorTop(scrollAnchor);
		}
		this.requestUpdate();
		this.dispatchEvent(new CustomEvent('gl-graph-lanetoggle', { detail: { tipSha: tipSha } }));

		// Announce the change for screen readers (the row count change is otherwise silent).
		if (toggle.wasCollapsed) {
			this.announce('Lane expanded.');
		} else {
			const hidden = this.hiddenCountByTipSha.get(tipSha) ?? 0;
			this.announce(`Lane collapsed. ${hidden} ${hidden === 1 ? 'commit' : 'commits'} hidden.`);
		}
	}

	// Restore target (scrollTop px) captured across a row-set change — a lane collapse/expand, or a
	// rows/scope update — applied in updated(); see captureLaneScrollAnchor / resolveLaneScrollAnchorTop /
	// applyPendingScrollAnchor.
	private _pendingScrollAnchorTop?: number;

	// Snapshot the row pinned at the viewport's top edge BEFORE anything swaps displayRows (a lane
	// collapse/expand, or a rows/scope update that inserts, drops or reorders rows):
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
		const index = this.rowIndexAt(scrollTop);
		return { rows: rows, index: index, offset: scrollTop - this.rowTop(index) };
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
		return Math.max(0, this.rowTop(newIndex) + offset);
	}

	// Re-assert the captured scroll position after a lane collapse/expand re-renders. Runs in updated(),
	// which fires BEFORE the child virtualizer resizes its spacer: for a COLLAPSE the list shrinks, so the
	// (smaller) target lands within the still-larger spacer and holds flush against the swap with no paint in
	// between (all microtasks) — no flicker. A near-bottom collapse may then be re-clamped by the browser as
	// the spacer shrinks (unavoidable — too few rows below to hold the position); that is the best-preserved
	// result. Expanding a lane ABOVE the viewport (rare — keyboard-only, its chevron is off-screen) can be
	// clamped short here since the spacer hasn't grown yet; the common expand-in-view case anchors exactly.
	// A GROWING list (rows paged/fetched in above the viewport) needs the retry below whenever the new target
	// lands past the pre-growth maximum — i.e. when the viewport sat close enough to the bottom of the loaded
	// rows for the inserted ones to push it there. With more headroom than that, the first write just lands.
	private applyPendingScrollAnchor(): void {
		const target = this._pendingScrollAnchorTop;
		if (target == null) return;

		this._pendingScrollAnchorTop = undefined;
		// Every application supersedes any retry still in flight — including one that lands CLEANLY, which
		// schedules no retry of its own. Bumping only when a retry is scheduled would leave the older
		// generation current, so that older retry would still pass its guard and drag the viewport back.
		const generation = ++this._scrollAnchorGeneration;

		// A deliberate reveal wins (scrollToSha also clears this) — don't fight a jump-to-row.
		if (this._pendingRevealSha != null) return;

		const scroller = this.virtualizerRef.value;
		if (scroller == null) return;

		if (scroller.scrollTop !== target) {
			scroller.scrollTop = target;
		}
		// Mirror the write into the tracked position rather than waiting for the scroller's own scroll event
		// (which doesn't fire until the next rendering opportunity) — until it lands, `revealIndexNearest`
		// would judge visibility from the pre-anchor offset and a rows update would measure its insert-above
		// correction from it.
		const landed = scroller.scrollTop;
		this.trackViewportTop(landed);

		// Rows arriving ABOVE the viewport push the target PAST the current scroll maximum, and the child
		// virtualizer has not grown its spacer yet at this point — the write clamps short and the viewport
		// jumps anyway, which is the whole thing this exists to prevent. Re-assert once the child commits.
		// One retry only, and it re-checks the reveal guard because a jump-to-row can be armed in between.
		if (landed !== target) {
			void scroller.updateComplete.then(() => {
				if (this._scrollAnchorGeneration !== generation || this._pendingRevealSha != null) return;

				const el = this.virtualizerRef.value;
				if (el != null && el.scrollTop !== target) {
					el.scrollTop = target;
					this.trackViewportTop(el.scrollTop);
				}
			});
		}
	}

	/** Bumped by every anchor application AND by every deliberate reveal write, so a pending anchor retry can
	 *  tell the position it captured has been superseded — by a newer anchor or by the user jumping somewhere.
	 *  Reveals keep their own counter ({@link _revealGeneration}) for their own retry: an anchor must yield to
	 *  a reveal, but not the reverse, so the two are deliberately not shared. */
	private _scrollAnchorGeneration = 0;
	/** The display row sitting at the viewport top, the index it sat at, and the scroll position it was seen
	 *  at — all tracked from scroll EVENTS, whose `scrollTop` is free (reading it off the element would force
	 *  layout). This is what lets a rows update correct for insertions above the viewport by ARITHMETIC
	 *  instead of measurement. */
	private _viewportTopSha?: string;
	private _viewportTopIndex = 0;
	/** The unit position `_viewportTopIndex` sat at when it was written. INVARIANT: every write of
	 *  `_viewportTopIndex` writes this in the same statement group, valued `_rowUnits.unitPosOf(index)` as of
	 *  that write — the insert-above correction takes its delta in UNITS, so a stale pairing would offset the
	 *  viewport by whatever tall rows lie between the two positions. */
	private _viewportTopUnitPos?: number;
	private _viewportScrollTop = 0;
	/** Scroll position to restore after rows were inserted above the viewport, and the index the tracked
	 *  row moved to — both applied together in updated(), so a preempted correction commits neither. */
	private _pendingViewportTop?: number;
	private _pendingViewportTopIndex?: number;
	private _pendingViewportTopUnitPos?: number;

	/** The repo the pending scroll state belongs to — a swap reuses this element, so it must invalidate. */
	private _lastScrollRepoPath?: string;

	// Visually-hidden polite live region for screen-reader announcements (lane collapse, paging).
	// Written via the cached element ref (CSSOM textContent — no host re-render).
	// Public so the wrapper can report the outcome of the operations it owns (the nearest-WIP jump) —
	// this element owns the graph's only live region.
	private liveRef = createRef<HTMLElement>();
	announce(message: string): void {
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
	// Zone of the CURRENT `hoveredRowSha` hover (always set together with it) — see `RowHoverZone`.
	private hoveredRowZone?: RowHoverZone;
	// The row the pointer is physically over — its content OR its right-edge action buttons/affordances,
	// which carry their own `data-tooltip` and so route through the affordance branch of
	// `onPointerOverTooltip` that cancels the rich-hover card (clearing `hoveredRowSha`). Tracked
	// separately so the sticky-timeline pill's yield (`updateStickyTimelineYield`) survives that cancel:
	// the pill rides exactly over the topmost row's action strip and must stay hidden while the pointer
	// is on those buttons instead of flickering back on top of them.
	private pointerRowSha?: string;
	private readonly emitRowHover = debounce(
		(detail: { sha: string; clientX: number; currentTarget: HTMLElement; zone: RowHoverZone }): void => {
			this.dispatchEvent(new CustomEvent('gl-graph-rowhover', { detail: detail }));
		},
		250,
	);

	// ————— Keyboard peek —————
	// `i` (or `mod+I`) shows the same rich card the pointer hover opens, anchored on the FOCUSED row's
	// element — the card is owned by `graph-app`, so every request goes out as `gl-graph-rowpeek` and comes
	// back through the event's `open` out parameter.
	// While it's up: keyboard navigation re-anchors it (below), Esc closes it via the overlay stack the card
	// pushes itself onto, and a genuine pointer hover takes it over (`GlGraphHover.onRowHovered`).
	private _peekOpen = false;
	private _peekReanchorFrame: number | undefined;

	/** Opens the peek card on the focused row, or closes an open one. `false` (no focused row / no rendered
	 *  row element) falls the key through to the next candidate. */
	private togglePeek(): boolean {
		const sha = this.displayRows[this.focusIndex]?.sha;
		const anchor = this.activeRowElement();
		if (sha == null || anchor == null) return false;

		this._peekOpen = this.requestPeek({ action: 'toggle', sha: sha, anchor: anchor, open: false });
		this.announce(this._peekOpen ? 'Commit info shown.' : 'Commit info hidden.');
		return true;
	}

	private requestPeek(request: GraphRowPeekRequest): boolean {
		this.dispatchEvent(new CustomEvent('gl-graph-rowpeek', { detail: request }));
		return request.action === 'close' ? false : request.open;
	}

	private closePeek(): void {
		if (!this._peekOpen) return;

		this._peekOpen = false;
		this.requestPeek({ action: 'close' });
		this.announce('Commit info hidden.');
	}

	/** The card closed by a path this element can't see (Esc pops the hover's overlay-stack entry directly)
	 *  — sync the peek flag now instead of waiting for the next re-anchor to self-heal, and make the close
	 *  audible like every other close path. */
	onPeekClosedExternally(): void {
		if (!this._peekOpen) return;

		this._peekOpen = false;
		this.announce('Commit info hidden.');
	}

	/** Follows the row cursor while peeked. Deferred a frame so the move's scroll + virtualizer render have
	 *  landed and so a held arrow key coalesces into one re-anchor per frame. The retry runs against a time
	 *  DEADLINE, not a frame count: an End/Home jump can trigger edge-paging, and the landing row only
	 *  renders after the rows request returns — hundreds of ms, not frames. A row that still hasn't arrived
	 *  at the deadline (scrolled out under the wheel, rows replaced) closes the card rather than stranding
	 *  it on a recycled element. */
	private schedulePeekReanchor(deadline?: number): void {
		if (this._peekReanchorFrame != null) return;

		const limit = deadline ?? performance.now() + peekReanchorDeadlineMs;
		this._peekReanchorFrame = requestAnimationFrame(() => {
			this._peekReanchorFrame = undefined;
			if (!this._peekOpen) return;

			const sha = this.displayRows[this.focusIndex]?.sha;
			const anchor = this.activeRowElement();
			if (sha == null || anchor == null) {
				if (performance.now() < limit) {
					this.schedulePeekReanchor(limit);
				} else {
					this.closePeek();
				}
				return;
			}

			this._peekOpen = this.requestPeek({ action: 'reanchor', sha: sha, anchor: anchor, open: false });
		});
	}

	/** Focus leaving the graph closes the peek — it belongs to the row cursor, and nothing outside the
	 *  viewport can drive it. A null `relatedTarget` (the whole window losing focus) closes too. */
	private readonly onFocusOut = (event: FocusEvent): void => {
		if (!this._peekOpen) return;

		const next = event.relatedTarget;
		if (next instanceof Node && this.viewportRef.value?.contains(next)) return;

		this.closePeek();
	};

	private readonly onPointerOverTooltip = (event: PointerEvent): void => {
		// No hovers/tooltips while a column resize is in progress — the pointer sweeps over the graph
		// as the user drags the header handle, and flickering tooltips/row cards would be distracting.
		if (this.draggingColumn) return;

		// Track the row physically under the pointer for the sticky-timeline pill's yield BEFORE the
		// affordance branch below can cancel the rich-hover card: a row's action buttons carry their own
		// `data-tooltip`, so hovering them clears `hoveredRowSha` — this survives that so the pill stays
		// hidden over the buttons it rides. Resolves off any row (incl. the transparent, yielded pill's
		// pass-through) and to `undefined` when the pointer lands on the non-yielded pill itself.
		const pointerRowSha =
			event.target instanceof Element
				? event.target.closest<HTMLElement>('.gl-graph__row')?.dataset.sha
				: undefined;

		if (pointerRowSha !== this.pointerRowSha) {
			this.pointerRowSha = pointerRowSha;
			this.updateStickyTimelineYield();
		}

		// Track which pill (if any) is under the pointer on EVERY move — feeds `togglePinnedRef` (a press
		// right after entering the pill needs no re-hover) and the pill's own hover popover. Fires for
		// every element in the viewport (not just pills) — resolving to `undefined` off a pill is what
		// detects "left it" without a separate pointerout branch. Gated behind a cheap native `closest()`
		// first: `resolvePillHover` walks `event.composedPath()` TWICE (resolveRef + resolveSha each do
		// their own walk/allocation) — most pointer moves in the graph aren't anywhere near a pill, so this
		// short-circuits the common case for free.
		const overPill = event.target instanceof Element && event.target.closest('[data-ref-name]') != null;
		const pill = overPill ? this.resolvePillHover(event) : undefined;
		if (pill != null) {
			if (
				this.hoveredPillRef == null ||
				this.hoveredPillRef.key !== pill.key ||
				this.hoveredPillRef.sha !== pill.sha
			) {
				this.hoveredPillRef = pill;
			}
		} else if (this.hoveredPillRef != null) {
			this.hoveredPillRef = undefined;
		}

		// The row-marker band (the rail plus its widened hit zone) hover-expands on its own and must NOT open
		// the row's rich hover card — but it DOES carry its own tooltip (the roles spelled out + the merge
		// target's name, which the expanded pill has no room for). Route it through the normal row hover
		// rather than cancelling: the band resolves to the `graph` zone (see the zone map below), which tracks
		// the row — keeping the minimap following it exactly as the lanes and avatar do — while never
		// scheduling the card, so the tooltip and the card still can't co-show. Then show the rail's tooltip;
		// the hit zone carries no `data-tooltip`, so there it resolves to nothing and hides. The CSS `:hover`
		// expand is independent of all this (driven by the pointer being over it, not this handler).
		if (
			event.target instanceof Element &&
			event.target.closest('.gl-graph__row-marker-rail, .gl-graph__row-marker-hit') != null
		) {
			this.handleRowHover(event);
			const railTarget = this.closestTooltipTarget(event.target);
			if (railTarget != null) {
				this.showTooltipForTarget(railTarget);
			} else {
				this.scheduleHideTooltip();
			}
			return;
		}

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
		this.showTooltipForTarget(target);
	};

	// Resolve + show the delegated tooltip for a `data-tooltip`/`data-tooltip-row` element. Shared by the
	// pointer (`onPointerOverTooltip`) and keyboard (`showTooltipForFocus`) paths.
	private showTooltipForTarget(target: HTMLElement): void {
		if (target === this.tooltipAnchor) {
			// Re-entering the same anchor (still open, or just-closed within the keep window): cancel the
			// pending hide/clear and re-open in place — content is still set, so no re-fetch/flash. Also
			// dedupes a coincident hover+focus on one element (the host anchors one tooltip at a time).
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

		// PR/issue chips: the card is rendered from the ref's live metadata rather than duplicated into the
		// DOM per chip, so it resolves here instead of coming in as a `data-tooltip` string.
		//
		// Matched on the two metadata types that HAVE a card — `data-ref-metadata-type` is older than this
		// path and also marks the upstream and merge-target segments (for double-click routing), which carry
		// ordinary `data-tooltip` strings. Claiming every element with the attribute swallowed their
		// tooltips. A chip whose metadata has since been invalidated falls through too, and the generic
		// path below hides it.
		const metadataType = target.dataset.refMetadataType;
		if (metadataType === 'pullRequest' || metadataType === 'issue') {
			const content = this.resolveRefMetadataTooltip(metadataType, target.dataset.refId);
			if (content != null) {
				this.showTooltipContent(target, content, 'top', 280);
				return;
			}
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
	}

	// Keyboard focus → same delegated tooltip resolver. Cheap + delegated (rides the viewport `focusin`).
	private showTooltipForFocus(event: FocusEvent): void {
		if (this.draggingColumn) return;

		const target = this.closestTooltipTarget(event.target);
		if (target == null) return;
		// The mode-picker strip labels itself (aria + is-current highlight) — a tooltip popping over the
		// just-opened menu from its own programmatic focus is noise, not help.
		if (target.closest('.gl-graph__changes-mode-strip') != null) return;

		// A focused pill sub-chip is hidden behind the expand overlay; anchor to its visible twin instead.
		this.showTooltipForTarget(this.expandedTwinIfCovered(target));
	}

	/** When `target` is a pill sub-chip covered by the (shown) expand overlay, return its visible twin inside
	 *  `.gl-graph__ref-pill-expand` so a keyboard tooltip anchors to what's on screen, not the covered copy. */
	private expandedTwinIfCovered(target: HTMLElement): HTMLElement {
		const pill = target.closest<HTMLElement>('.gl-graph__ref-pill');
		if (pill == null || target.closest('.gl-graph__ref-pill-expand') != null) return target;

		const expand = pill.querySelector<HTMLElement>('.gl-graph__ref-pill-expand');
		if (expand == null || getComputedStyle(expand).display === 'none') return target;

		// The pill's tooltip-bearing segments: the upstream half (jump / status, a `data-tooltip` string) and
		// the PR / issue chips (a card resolved from `refsMetadata`). Each has a twin inside -expand.
		const segment = pillTooltipSegmentClasses.find(c => target.classList.contains(c));
		const twin = segment != null ? expand.querySelector<HTMLElement>(`.${segment}`) : null;

		return twin ?? target;
	}

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
			// `onPointerOverTooltip` clears `hoveredPillRef`/`pointerRowSha` itself on every move that
			// resolves off a pill/row — but a move that leaves the viewport entirely fires no further
			// pointerover, so that path never runs. Clear them BEFORE ending the row hover so its lane-seed
			// reconcile can't re-seed off pointer state the pointer no longer has. (Clearing `pointerRowSha`
			// also releases the sticky-timeline pill's yield row.)
			this.hoveredPillRef = undefined;
			if (this.pointerRowSha != null) {
				this.pointerRowSha = undefined;
				this.updateStickyTimelineYield();
			}
			this.endRowHover(related ?? null);
			// With the pointer outside the viewport the modifier tracker sees no further pointer events, so a
			// Ctrl/Alt release only reaches us as a keyup — which needs keyboard focus. Without it, drop the
			// dim rather than strand it on the focused-row/HEAD seed with no way to observe the release.
			if (this.treeRef.value?.contains(document.activeElement) === true) {
				this.reconcileModifierChain();
			} else {
				this.deactivateModifierChain();
			}
		}
	};

	// `pointerleave` (unlike `pointerout`) only fires once the pointer has left the element AND all its
	// descendants — exactly the "gone" signal the minimap's day-highlight needs (the wrapper re-dispatches
	// this as `gl-graph-mouse-leave` for graph-app's `minimapEl.unselect`).
	private readonly onPointerLeave = (): void => {
		this.dispatchEvent(new CustomEvent('gl-graph-mouseleave'));
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
		this._pinnedRefSha = sha ?? undefined;
		// Highlight BOTH the pinned ref's lane AND its tracked counterpart's (a local head ↔ its upstream
		// remote, a remote ↔ the local tracking it) when the counterpart is in view, so the ahead/behind
		// divergence reads as one picture. Falls back to just the pinned ref's lane. Down-only: a ref is
		// its lane tip, and the walk stops at the merge base so the highlight stays on the branch.
		this.refHoverChainShas = sha != null ? this.laneChainFor(this.pinnedChainShas(key, sha), 'down') : undefined;
		if (this.pinnedRefDismiss == null) {
			this.pinnedRefDismiss = (e: PointerEvent): void => {
				const t = e.target;
				// A divider press lives in gl-split-panel's shadow DOM and retargets to the host (slotted
				// content retargets to itself), so a split-panel target means a splitter drag — not a dismissal.
				if (t instanceof Element && t.localName === 'gl-split-panel') return;

				// Don't dismiss when the press is on a ref pill OR an overflow-popover ref row (both carry
				// `data-ref-name` and toggle/switch the pin) or inside the branch sheet (its action buttons /
				// chrome) — only a press truly outside all of them untoggles. `closest()` first: it resolves
				// the light-DOM cases (pills, popover rows) without allocating the composed path. It CANNOT
				// see a sheet inside a component's shadow root (`e.target` retargets to the host), so a miss
				// falls through to a composed-path scan before dismissing.
				if (t instanceof Element && t.closest('[data-ref-name], gl-detail-sheet') != null) return;

				if (
					e
						.composedPath()
						.some(
							el =>
								el instanceof Element &&
								(el.localName === 'gl-detail-sheet' || el.matches('[data-ref-name]')),
						)
				) {
					return;
				}

				this.clearPinnedRef();
				// Close the branch sheet too, so the focus state stays in sync.
				this.dispatchEvent(
					new CustomEvent('gl-graph-open-branch', { detail: { open: false }, bubbles: true, composed: true }),
				);
			};
			document.addEventListener('pointerdown', this.pinnedRefDismiss, true);
		}
		// Re-render the ref pills so the newly-pinned ref is promoted to the inline pill AND takes
		// `.is-pinned` (both read `_pinnedRefKey` live — see `renderRefPill`); the cached adornments
		// don't track pin state on their own.
		this.invalidateAdornments();
		return true;
	}

	// Clear the click-pinned ref focus (expand + dim) and detach the dismiss listener.
	private clearPinnedRef(): void {
		this._pinnedRefKey = undefined;
		this._pinnedRefSha = undefined;
		this.refHoverChainShas = undefined;
		if (this.pinnedRefDismiss != null) {
			document.removeEventListener('pointerdown', this.pinnedRefDismiss, true);
			this.pinnedRefDismiss = undefined;
		}
		// Revert the promoted inline pill back to the priority primary and drop its `.is-pinned` class.
		this.invalidateAdornments();
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
		const ref = this.getCommitBySha(sha)?.commitRefs.find(r => refPillKey(r) === key);
		const counterpart =
			ref?.kind === 'head' && ref.upstreamId != null
				? this.refRowIndex.get(ref.upstreamId)?.sha
				: ref?.kind === 'remote' && ref.id != null
					? this.localByUpstreamId.get(ref.id)?.sha
					: undefined;
		return counterpart != null && counterpart !== sha ? [sha, counterpart] : [sha];
	}

	// Ctrl-hold transient chain (same first-parent derivation `togglePinnedRef` uses for the click
	// pin), layered on top of it via the `inRefChainShas` fallback in `updateRenderState`. Unlike the
	// pin, this never touches `_pinnedRefKey`/adornments — the ref pills themselves don't change, only
	// the per-row dim/chain flags read fresh off `modifierChainShas` each render, so there's no adornment
	// cache to evict here (contrast `togglePinnedRef`/`clearPinnedRef`, which evict to promote/demote the
	// inline pill).
	//
	// `pickLaneSeed` chooses the seed: the focused row, falling back to HEAD when nothing is focused. The
	// pointer plays no part — hovering never seeds or retargets this chain, so the highlight stays put
	// while scrolling or mousing around. The `willUpdate` reconcile (on `focusIndex` changing) is the only
	// retarget path; navigating or selecting a different commit is what moves it. The seed always walks
	// BOTH ways to cover the whole lane ("the branch this commit is on"), stopping at the fork/merge
	// boundary (see `collectLaneChain`), so highlighting a branch never bleeds into the trunk below its
	// merge base.
	private activateModifierChain(): void {
		const target = pickLaneSeed({
			focusedSha: this.displayRows[this.focusIndex]?.sha,
			headSha: this.headSha,
		});
		if (target == null) {
			this.deactivateModifierChain();
			return;
		}

		const seed = laneSeedKey(target);
		if (seed === this.lastModifierChainSeed && this.modifierChainShas != null) return;

		this.lastModifierChainSeed = seed;
		this.modifierChainShas = this.laneChainFor([target.sha], 'both');
	}

	// Bring the transient chain in line with the shared modifier tracker — the single source of Ctrl/Alt
	// truth. Shared by the `willUpdate` reconcile and the pointer-leave paths, which now HAND OFF to the
	// next-best seed (focused row, then HEAD) instead of clearing: leaving a row doesn't mean you stopped
	// holding the modifier.
	private reconcileModifierChain(): void {
		// Both released ends the suppression, whatever else the chord did.
		if (!this._modifiers.ctrlKey && !this._modifiers.altKey) {
			this._suppressModifierChain = false;
			this.cancelPendingHoldEngage();
		}

		if (!this.canEngageModifierChain()) {
			this.cancelPendingHoldEngage();
			if (this.modifierChainShas != null) {
				this.deactivateModifierChain();
			}

			return;
		}

		// Already engaged — retarget immediately, no delay (pointer arrival / keyboard focus change).
		if (this.modifierChainShas != null) {
			this.activateModifierChain();
			return;
		}

		// Fresh engage — delay so a chording Ctrl/Alt+letter/digit shortcut never flashes the dim.
		if (this._pendingHoldEngageTimer != null) return;

		this._pendingHoldEngageTimer = setTimeout(() => {
			this._pendingHoldEngageTimer = undefined;
			if (!this.canEngageModifierChain()) return;

			this.activateModifierChain();
		}, holdEngageDelayMs);
	}

	// Gate on window focus: an Alt-Tab away fires no keyup/visibilitychange, so the tracker can still
	// read `ctrlKey`/`altKey` true while unfocused — without this the dim would stick. (The same `blur`
	// signal drives `gl-graph--window-unfocused` in render().)
	//
	// BARE Ctrl or Alt (or both together): each names no action of its own, so holding either — or both —
	// engages the dim. Shift/Meta chords DO name their own actions, so either one vetoes: dimming the graph
	// under them reads as a mode the chord didn't enter. Ctrl+Arrow / Alt+Arrow keep the highlight — they
	// walk lanes/fork points, so showing the lane is the point.
	private canEngageModifierChain(): boolean {
		const bareCtrlOrAlt =
			(this._modifiers.ctrlKey || this._modifiers.altKey) &&
			!this._modifiers.shiftKey &&
			!this._modifiers.metaKey;

		return bareCtrlOrAlt && !this._suppressModifierChain && this.windowFocused !== false && this.hasLaneSeedInput();
	}

	private cancelPendingHoldEngage(): void {
		if (this._pendingHoldEngageTimer == null) return;

		clearTimeout(this._pendingHoldEngageTimer);
		this._pendingHoldEngageTimer = undefined;
	}

	// Set by `suppressModifierChainUntilRelease` for Ctrl/Alt chords that resolve OUTSIDE the graph (the
	// app's Ctrl/Alt-carrying non-lane shortcuts — search focus, peek, copy, the shortcut sheet, the chrome
	// toggles), whose press would otherwise dim the graph on the way.
	private _suppressModifierChain = false;

	// Pending fresh-engage timer from `reconcileModifierChain` — the modifier-hold delay in flight.
	private _pendingHoldEngageTimer: ReturnType<typeof setTimeout> | undefined;

	/** Hold off the Ctrl/Alt-hold lane dim until both are released — for a Ctrl or Alt chord whose action
	 *  isn't a lane move. Called by the host before it consumes the chord. */
	public suppressModifierChainUntilRelease(): void {
		this._suppressModifierChain = true;
		this.cancelPendingHoldEngage();
		if (this.modifierChainShas != null) {
			this.deactivateModifierChain();
		}
	}

	/** Whether keyboard focus is inside the rows tree for the Ctrl/Alt-hold chain to seed from.
	 *  `windowFocused` alone is too coarse: it stays true with focus in an editor or another view, so
	 *  holding the modifier there dimmed a graph nobody was working in. `pickLaneSeed`'s HEAD fallback then
	 *  applies only once focus is actually inside the tree. */
	private hasLaneSeedInput(): boolean {
		return this.treeRef.value?.contains(document.activeElement) === true;
	}

	// Lane-bounded first-parent chain for the given seed tips, layered into `inRefChainShas`. Reuses the
	// same cached `childrenBySha` the branching-point nav builds. Returns `undefined` (not an empty set)
	// when no seed is in the current rows — an empty-but-non-null chain would read as "active" and dim
	// the WHOLE graph with nothing highlighted (e.g. a paging re-walk whose pinned seed no longer exists).
	private laneChainFor(seeds: readonly string[], direction: 'down' | 'both'): ReadonlySet<string> | undefined {
		const children = this.ensureChildrenBySha();
		const chain = collectLaneChain(this.processedRows, this.processedIndexBySha, children, seeds, direction);
		// A `'down'` walk (a ref pin) stops AT the ref tip, so it misses the working-changes (WIP) row —
		// a synthetic `workdir` row sitting one row ABOVE the current branch's tip on the same lane. Pull
		// it in so pinning the current branch lights its WIP row too, matching the `'both'` row-hover walk
		// (which reaches it as a same-column first-parent child). Only the current branch carries a WIP
		// row, so this is a no-op for any other pinned ref.
		if (direction === 'down') {
			for (const seed of seeds) {
				if (!chain.has(seed)) continue;

				const seedCol = this.processedRowFor(seed)?.column;
				for (const kid of children.get(seed) ?? []) {
					if (!this.workdirShas.has(kid)) continue;

					const kidRow = this.processedRowFor(kid);
					if (kidRow?.parents[0] === seed && kidRow.column === seedCol) {
						chain.add(kid);
					}
				}
			}
		}
		return chain.size > 0 ? chain : undefined;
	}

	private processedRowFor(sha: string): ProcessedGraphRow | undefined {
		const i = this.processedIndexBySha.get(sha);
		return i != null ? this.processedRows[i] : undefined;
	}

	private deactivateModifierChain(): void {
		this.modifierChainShas = undefined;
		this.lastModifierChainSeed = undefined;
	}

	// Emit the rich-hover lifecycle for the row under the pointer. Ref pills are fully excluded (they
	// own their own popover). The lanes/commit-dot column now PARTICIPATES (start/track fire → the
	// minimap follows it) but the ONE decision point below (zone → treatment) only schedules the
	// debounced card for 'content' — sliding onto content from the SAME row upgrades to the full
	// hover; sliding back onto the lanes hides any open/pending card without dropping row-hover/
	// minimap tracking. Also (re)targets the Ctrl-hold lane-chain dim (`activateModifierChain`)
	// when a NEW row is entered while Ctrl is already held.
	private handleRowHover(event: PointerEvent): void {
		const node = event.target;
		if (node instanceof Element && node.closest('[data-ref-name]') != null) {
			this.cancelRowHover();
			return;
		}

		const rowEl = node instanceof Element ? node.closest<HTMLElement>('.gl-graph__row') : null;
		const sha = rowEl?.dataset.sha;
		if (rowEl == null || sha == null) {
			this.cancelRowHover();
			return;
		}

		// The `graph` zone (no card, tracks only) is the standalone graph column's cell OR — when the graph is
		// grouped into a content column — the inline lane strip/fold gutter folded into that host cell. Both
		// inline surfaces are `pointer-events: auto`, so the pointer lands on them (their lane-art SVGs are
		// `pointer-events: none`); matching them keeps grouped-lane hover behaving like the column placement.
		// The row-marker rail and its hit zone count too: they're direct children of the ROW (so the hit zone
		// can span the fold strip), which would otherwise land them in `content` and pop the card across the
		// whole band. They sit over the lanes and read as part of them, so they track exactly like the lanes.
		// The dedicated Refs column (`--ref`) counts too, but only there: it only renders standalone when
		// refs are their own column — grouped/inline refs live in the message cell and keep the hovercard.
		const zone: RowHoverZone =
			node instanceof Element &&
			node.closest(
				'.gl-graph__zone--graph, .gl-graph__zone--ref, .gl-graph__gutter-viewport--inline, .gl-graph__fold-lane, .gl-graph__row-marker-rail, .gl-graph__row-marker-hit',
			) != null
				? 'graph'
				: 'content';

		if (sha === this.hoveredRowSha) {
			// Same row — only a zone CHANGE reacts; staying within a zone is a no-op. No
			// `gl-graph-rowhovertrack` here (unlike the new-row path below): the row (and hence its
			// minimap date) hasn't changed, only the zone within it, so the wrapper's minimap-select
			// would just repeat the same date — a genuine no-op dispatch.
			if (zone === this.hoveredRowZone) return;

			this.hoveredRowZone = zone;
			if (zone === 'content') {
				// graph → content: upgrade to the full hover.
				this.startRowHover(sha, zone, event, rowEl, false);
			} else {
				// content → graph: cancel any pending card request and hide an already-open one, but
				// keep the row tracked — `gl-graph-rowunhover` hides the card without touching the
				// minimap's selected day (see handleGraphRowUnhover/GraphHover.onRowUnhovered).
				this.emitRowHover.cancel();
				this.dispatchEvent(
					new CustomEvent('gl-graph-rowunhover', { detail: { sha: sha, zone: zone, relatedTarget: null } }),
				);
			}
			return;
		}

		// Moving directly between rows (or onto an affordance and back): end the previous row's
		// hover first so its card can't linger. `rowhoverstart` (inside startRowHover below) cancels
		// the resulting unhover timer in GraphHover, so the transition stays flicker-free.
		if (this.hoveredRowSha != null) {
			this.endRowHover(null);
		}

		this.hoveredRowSha = sha;
		this.hoveredRowZone = zone;
		// The sticky-timeline pill's yield tracks `pointerRowSha` (updated in `onPointerOverTooltip`, which
		// reached here), not `hoveredRowSha` — so no CSSOM poke is needed on this card-only transition.
		this.dispatchEvent(new CustomEvent('gl-graph-rowhovertrack', { detail: { sha: sha, zone: zone } }));
		this.startRowHover(sha, zone, event, rowEl, true);
	}

	// `rowhoverstart` + emitRowHover's payload are dispatched together at both hover-start sites — a
	// NEW row entered, or an already-hovered row's zone upgrading from graph → content — factored out so
	// the two can't drift on the payload shape. `isNewRow` covers the new-row case, where `rowhoverstart`
	// must fire even when landing directly in the 'graph' zone (so GraphHover's unhover timer still
	// resets and the minimap still tracks); the same-row upgrade caller only reaches this when
	// zone==='content', where `rowhoverstart` fires unconditionally either way.
	private startRowHover(
		sha: string,
		zone: RowHoverZone,
		event: PointerEvent,
		rowEl: HTMLElement,
		isNewRow: boolean,
	): void {
		if (isNewRow || zone === 'content') {
			this.dispatchEvent(new CustomEvent('gl-graph-rowhoverstart'));
		}
		if (zone === 'content') {
			this.emitRowHover({ sha: sha, clientX: event.clientX, currentTarget: rowEl, zone: zone });
		}
	}

	// End any active row hover (also used when the pointer moves onto a tooltip affordance or a ref
	// pill, which own their own tooltip/popover) — fully drops tracking, unlike the same-row zone
	// transition above, which keeps `hoveredRowSha` alive.
	private cancelRowHover(): void {
		this.endRowHover(null);
	}

	private endRowHover(relatedTarget: EventTarget | null): void {
		this.emitRowHover.cancel();
		const sha = this.hoveredRowSha;
		if (sha == null) return;

		const zone = this.hoveredRowZone;
		this.hoveredRowSha = undefined;
		this.hoveredRowZone = undefined;
		this.dispatchEvent(
			new CustomEvent('gl-graph-rowunhover', { detail: { sha: sha, zone: zone, relatedTarget: relatedTarget } }),
		);
	}

	/** The hover card for a PR/issue chip, resolved from the same `refsMetadata` the chip was rendered from.
	 *  Undefined when the metadata has since been invalidated — the chip outlives a refresh by a frame. */
	private resolveRefMetadataTooltip(type: string, refId: string | undefined): TemplateResult | undefined {
		if (refId == null) return undefined;

		const metadata = this.refsMetadata?.[refId];
		if (metadata == null) return undefined;

		if (type === 'pullRequest') {
			const pr = metadata.pullRequest?.[0];
			return pr != null ? renderPullRequestTooltipCard(pr) : undefined;
		}
		if (type === 'issue') {
			const issue = metadata.issue?.[0];
			return issue != null ? renderIssueTooltipCard(issue) : undefined;
		}
		return undefined;
	}

	private closestTooltipTarget(node: EventTarget | null): HTMLElement | undefined {
		if (!(node instanceof Element)) return undefined;

		// Match scalar tooltips (`data-tooltip`) AND multi-marker rail bands (`data-tooltip-row`) — the
		// band has no `data-tooltip` string, so without this it would resolve to null and the rail
		// hover would spuriously fire the row-hover card instead of the marker tooltip.
		// `data-ref-metadata-type` joins them: the PR/issue chips carry no tooltip STRING — their card is
		// built from the ref's metadata at hover time — so without this they'd resolve to null and the row
		// hover card would fire over the chip instead.
		const el = node.closest<HTMLElement>('[data-tooltip], [data-tooltip-row], [data-ref-metadata-type]');
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
		// One pass over the uniform hot plane — the graph's own worktree is an ordinary entry now, so
		// there's no separate primary source to fold in first.
		const out = new Map<Sha, WipStats>();
		if (this.wipStateById != null) {
			for (const [sha, state] of Object.entries(this.wipStateById)) {
				const s = state?.workDirStats;
				if (s == null) continue;

				out.set(sha, {
					added: s.added,
					modified: s.modified,
					deleted: s.deleted,
					renamed: s.renamed,
					stale: state.workDirStatsStale === true,
				});
			}
		}
		this.wipStatsProvider = createWipStatsAdornmentProvider({ statsBySha: out });

		// Derive a per-sha clean/dirty signal from the SAME stats (so primary + each secondary worktree
		// WIP row get an independent glyph). Only shas with a stats entry are added — an absent key means
		// "not loaded yet", so the node draws NO glyph (never a misleading clean check). Stale counts draw
		// a dimmed dirty dot, matching how the stats pill renders them: unverified, but not nothing.
		const wipState = new Map<Sha, WipNodeState>();
		for (const [sha, s] of out) {
			wipState.set(sha, hasDirtyCounts(s) ? (s.stale ? 'dirty-stale' : 'dirty') : 'clean');
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
		// Snap the pitch to whole DEVICE pixels: at a fractional zoom/DPR a CSS-integer pitch lands row
		// boundaries on half device pixels, so each row's lane raster resamples at alternating phase — a
		// 1-device-px seam in the lane line at every other boundary. No DPR-change listener needed: a
		// zoom change reflows the webview, the scroller ResizeObserver fires, and the next render re-reads
		// this getter.
		const h = this.effectiveStyle === 'list' ? rowHeightList : rowHeightTable;
		const dpr = window.devicePixelRatio || 1;
		return Math.round(h * dpr) / dpr;
	}

	// Row geometry in pixels, quantized-row aware. A row spans `unitsOf` base heights and starts at its
	// running unit position — under a uniform index these reduce exactly to `index * rowHeight` and
	// `rowHeight`, which is what keeps every migrated call site behavior-identical.
	private rowTop(index: number): number {
		return this._rowUnits.unitPosOf(index) * this.rowHeight;
	}

	private rowHeightOf(index: number): number {
		return this._rowUnits.unitsOf(index) * this.rowHeight;
	}

	// Topmost-row index for a scrollTop — "which row is pinned at the viewport's top edge" — clamped into
	// [0, rowCount - 1]. Shared by every reader that needs it (lane anchor capture, the sticky-timeline
	// bucket/yield checks, onRangeChanged's minimap day-range) so the clamp can't drift between them.
	private rowIndexAt(scrollTop: number): number {
		const rowHeight = this.rowHeight;
		const count = this.displayRows.length;
		if (rowHeight <= 0 || count === 0) return 0;

		return this._rowUnits.rowIndexAtUnit(Math.floor(scrollTop / rowHeight), count);
	}

	// A page's worth of HOPS — one viewport's worth of base rows, less a row of overlap for context. Only the
	// topological Shift-extend wants this: it walks the lineage chain, where "a page" can only mean a count of
	// hops (the chain's rows are scattered, so their pixel span is unrelated to the viewport). Plain paging
	// goes through `pageIndexFrom` instead, which is unit-aware. Reads the LIVE height on purpose:
	// `scrollerClientHeight` only refreshes from a ResizeObserver on the host, so chrome that resizes the
	// scroller without resizing us (the filter-mode search footer) leaves it stale, and a page jump has to land
	// exactly. Once per PageUp/PageDown is nowhere near the arrow-key hot path.
	private pageStep(): number {
		const viewportHeight = this.virtualizerRef.value?.clientHeight ?? 0;
		const rows = Math.floor(viewportHeight / this.rowHeight) - 1;
		return Math.max(1, rows);
	}

	// The row a PageUp/PageDown from `index` lands on, clamped into range. Steps a page in UNIT space and maps
	// back to a row, so promoted rows between here and there consume their real pixel span: counting them as
	// one row each (what an index delta does) overshot by a full row height per promoted row, silently skipping
	// content. Under a uniform index this is arithmetically identical to the old index delta — `unitPosOf` is
	// the identity there. Same live-height rationale as `pageStep` above.
	private pageIndexFrom(index: number, direction: 1 | -1): number {
		const count = this.displayRows.length;
		const viewportHeight = this.virtualizerRef.value?.clientHeight ?? 0;
		const rowHeight = this.rowHeight;
		// Unmeasured viewport (or an unset row height) — step a single row rather than divide by zero.
		if (viewportHeight <= 0 || rowHeight <= 0) return Math.max(0, Math.min(count - 1, index + direction));

		const units = Math.max(1, Math.floor(viewportHeight / rowHeight) - 1);
		return this._rowUnits.rowIndexAtUnit(this._rowUnits.unitPosOf(index) + direction * units, count);
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
		return this.config?.lanesDensity ?? 'compact';
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

	// The row columns stop only for the vertical scrollbar. Header actions reserve space INSIDE the
	// trailing header cell, so their footprint never creates an empty body gutter.
	private get scrollbarGutterPx(): number {
		return Math.max(0, this.lastScrollbarWidth);
	}

	// Width the pinned settings gear occupies over the trailing header cell's tail (0 when there's no
	// settings menu). The trailing HEADER cell renders narrower by this much so its label/icon never sit
	// under the gear — header-only; body columns keep their full width to the scrollbar.
	private get headerActionsPx(): number {
		return this.settingsContext != null ? headerActionPx : 0;
	}

	// Available width the content zones zero-scroll-fill (Σ currentWidth = this): the container minus the
	// scrollbar gutter and — in `column` placement — the separate graph column
	// (which keeps its own width + lane-scroll). In inline/hidden placement the graph isn't a separate
	// cell, so it's just the container minus the gutter.
	private get zoneTargetWidth(): number {
		const graphCol = this.graphPlacement === 'column' ? this.graphColumnWidth : 0;
		return Math.max(0, this.containerWidth - this.scrollbarGutterPx - graphCol);
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
		const capForZones = this.containerWidth - this.scrollbarGutterPx - zoneMinSum;
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
		const inset = nodeRadiusFor(this.nodeSizingMode, this.rowHeight) + 2;
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

	// Resolves `gitlens.graph.refs.maxInline`'s cap: a configured number passes through (floored at 1);
	// `'auto'` derives it from the width refs actually have to work with, uniformly for every row (see
	// `resolveAutoRefPillCap` — no per-row measurement). The available width depends on WHERE refs render:
	// the list style's stacked line 2 (table-style zone columns don't render there at all, so it wins
	// regardless of `refsPlacement` — see `renderListBody`), a dedicated Refs column (own zone width), or
	// grouped inline (a share of the list style's content width — kept in step with the `.gl-graph__refs`
	// SCSS cap of `min(40%, calc(100% - 9rem))`, see graph.scss).
	private get effectiveMaxInlineRefs(): number {
		// The declared type is `number | 'auto'`, but the setting's schema admits ANY string — so the
		// runtime value can be an arbitrary string and must be coerced, not trusted.
		const raw: number | string = this.config?.maxInlineRefs ?? 1;
		if (raw !== 'auto') {
			// Coerce and clamp to the setting's [1, 10] range, falling back to 1 (never NaN: it would zero
			// out every pill and defeat the change tracking).
			const n = Math.floor(Number(raw));
			return Number.isFinite(n) ? Math.min(10, Math.max(1, n)) : 1;
		}

		// Not yet measured: the first render's containerWidth is 0 until the ResizeObserver reports.
		if (this.containerWidth === 0) return 1;

		const contentWidth = Math.max(0, this.containerWidth - this.scrollbarGutterPx - this.inlineGutterWidth);

		if (this.effectiveStyle === 'list') {
			return resolveAutoRefPillCap(contentWidth);
		}

		if (this.refsPlacement === 'column') {
			const configuredWidth = this.zones.find(z => z.id === 'ref')?.width ?? 180;
			const liveWidth = solveZoneLayout(this.getVisibleZones(), this.zoneTargetWidth).find(
				z => z.id === 'ref',
			)?.currentWidth;
			return resolveAutoRefPillCap(liveWidth ?? configuredWidth);
		}

		return resolveAutoRefPillCap(contentWidth * 0.4);
	}

	// Resolves `gitlens.graph.refs.maxStacked`'s cap for a PROMOTED row's own pill line (row-units 'refs on
	// their own line' — `rowPromotesToOwnLine`): a configured number passes through as a FIXED cap (clamped
	// to [1, 10], same bounds as the setting's schema); `'auto'` derives it from the refs-host zone's SOLVED
	// width via `resolveAutoRefPillCap` — the pills own their whole line up there, so an 'auto' cap sizes
	// against that width regardless of `gitlens.graph.refs.maxInline` (that setting is for the
	// inline-sharing-the-message case; there's no message text to protect a share of here).
	// `_ownLineRefCapWidth` is resolved once per render in `updateRenderState`, not re-solved per pill.
	private get effectiveOwnLineRefCap(): number {
		// Same coercion discipline as `effectiveMaxInlineRefs`: the declared type is `number | 'auto'`,
		// but the setting's schema admits ANY string, so the runtime value must be coerced, not trusted
		// (NaN would zero out every pill and defeat the change tracking).
		const raw: number | string = this.config?.maxStackedRefs ?? 'auto';
		if (raw !== 'auto') {
			const n = Math.floor(Number(raw));
			return Number.isFinite(n) ? Math.min(10, Math.max(1, n)) : 1;
		}

		return resolveAutoRefPillCap(this._ownLineRefCapWidth);
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
	// back to relative time. Rebuilt only when config changes. When
	// `short` is set and the effective style is relative, returns the ultra-compact form ("2d");
	// absolute styles can't meaningfully shrink a custom format, so they ignore `short`.
	private buildFormatDate(short: boolean): (date: number) => string {
		if (this.isRelativeDateStyle()) {
			// Both forms come from GitLens' `fromNow` (the `short` flag picks "2d" vs "2 days ago") so the
			// narrow and wide date columns share one threshold set and can't disagree on resize.
			return short
				? (date: number): string => gitlensFromNow(new Date(date), true)
				: (date: number): string => gitlensFromNow(new Date(date));
		}

		const fmt = typeof this.config?.dateFormat === 'string' ? this.config.dateFormat : undefined;
		return (date: number): string => formatGitLensDate(new Date(date), fmt ?? 'short');
	}

	// Same effective-style check `buildFormatDate` uses — factored out so the relative-time refresh
	// timer (willUpdate) can gate on it without duplicating the two-line derivation.
	private isRelativeDateStyle(): boolean {
		const style = this.config?.dateStyle;
		const fmt = typeof this.config?.dateFormat === 'string' ? this.config.dateFormat : undefined;
		return style === 'relative' || (style == null && fmt == null);
	}

	// Whether the 60s refresh timer needs to run at all: either the Date column's own cells are
	// relative-styled text that goes stale, or the sticky-timeline pill's grouping is elapsed-based (see
	// stickyTimelineGroupFor) and can drift even when every row's date column reads an absolute format.
	// One shared timer covers both consumers instead of running two.
	private needsRelativeTimeTimer(): boolean {
		return this.isRelativeDateStyle() || this.config?.stickyTimeline !== false;
	}

	// Starts (or leaves running) the relative-time refresh timer — only while something actually needs
	// it (see `needsRelativeTimeTimer`); a no-op otherwise/when already running. `requestUpdate()` alone
	// is enough to refresh the visible rows' dates: `formatDateFn` isn't identity-gated in the willUpdate
	// trigger matrix, so no engine/adornment/marker recompute runs, just a re-render of what's on screen.
	private startRelativeTimeTimer(): void {
		if (this.relativeTimeTimer != null || !this.needsRelativeTimeTimer()) return;

		this.relativeTimeTimer = setInterval(this.onRelativeTimeTick, 60_000);
	}

	private stopRelativeTimeTimer(): void {
		if (this.relativeTimeTimer == null) return;

		clearInterval(this.relativeTimeTimer);
		this.relativeTimeTimer = undefined;
	}

	private readonly onRelativeTimeTick = (): void => {
		// A hidden retained webview must not churn while backgrounded.
		if (document.visibilityState === 'hidden') return;

		// Only the Date column's cells need a re-render (relative text going stale); the sticky-timeline
		// pill's own DOM is driven by its own @state write below, not this requestUpdate.
		if (this.isRelativeDateStyle()) {
			this.requestUpdate();
		}
		// Sticky-timeline groups are purely elapsed-based (see stickyTimelineGroupFor) — an otherwise-idle
		// graph's group can drift as real time passes (e.g. a 6-day-old top row rolling into "Last week"),
		// so recompute it on every tick regardless of dateStyle. Refresh `nowMs` first so the recompute
		// doesn't read a stale cached value. Still edge-gated inside `updateStickyTimelineBucket`/its
		// window cache, so this is a no-op unless a boundary was actually crossed.
		this.nowMs = Date.now();
		this.recomputeStickyTimelineBucket();
	};

	// Becoming visible again while the timer is active refreshes immediately instead of waiting up to
	// 60s for the next tick — same split as onRelativeTimeTick (dates re-render only if relative-styled,
	// sticky-timeline recomputes regardless).
	private readonly onVisibilityChangeForRelativeTime = (): void => {
		if (document.visibilityState !== 'visible' || this.relativeTimeTimer == null) return;

		if (this.isRelativeDateStyle()) {
			this.requestUpdate();
		}
		this.nowMs = Date.now();
		this.recomputeStickyTimelineBucket();
	};

	// The chain-lane highlight overlay is mounted IMPERATIVELY (not as a declared `<lit-virtualizer>`
	// template child) — verified live: a declared child interleaves with the virtualize directive's OWN
	// light-DOM render part, and the child expression's re-render from `nothing` to content cleared that
	// part's committed nodes too, wiping every row (and the virtualizer's real sizer) the moment the chain
	// activated. Imperative DOM ownership (same strategy the virtualizer uses for its own sizer, see
	// `_chainOverlayMountSafe` below) never touches Lit's parts, so it can't collide with them.
	// Called from `updated()` every pass; short-circuits on an unchanged `_chainLaneOverlay` (via
	// `_chainLaneOverlayKey`), so idle renders (the overwhelming majority — no active chain) do nothing.
	private syncChainLaneOverlay(): void {
		const boxes = this._chainLaneOverlay ?? [];
		const key = boxes.length === 0 ? undefined : JSON.stringify(boxes);
		if (key === this._chainLaneOverlayKey) return;

		for (const el of this._chainLaneOverlayEls) {
			el.remove();
		}
		this._chainLaneOverlayEls = [];

		if (key == null) {
			this._chainLaneOverlayKey = key;
			return;
		}

		const v = this.virtualizerRef.value;
		// No virtualizer yet — leave the key UNSET so the next `updated()` pass retries from scratch
		// instead of silently giving up on this box set.
		if (v == null) return;

		if (!this._chainOverlayMountSafe) {
			// The virtualizer hasn't adopted its own sizer yet (first layout pass) — mounting now risks OUR
			// `[virtualizer-sizer]` element being adopted instead (`_getSizer()`, Virtualizer.js:220-245,
			// lazily adopts the FIRST such child in document order). `:not(.gl-graph__chain-lane)` excludes
			// our own elements from a PRIOR successful mount so a later re-check can't be fooled by them.
			// Leave the key unset here too — this pass didn't mount anything, so it must retry.
			if (v.querySelector(':scope > [virtualizer-sizer]:not(.gl-graph__chain-lane)') == null) {
				void v.layoutComplete?.then(() => this.requestUpdate());
				return;
			}

			this._chainOverlayMountSafe = true;
		}

		for (const box of boxes) {
			const el = document.createElement('div');
			el.className = 'gl-graph__chain-lane';
			el.setAttribute('virtualizer-sizer', '');
			el.setAttribute('aria-hidden', 'true');
			el.style.top = `${box.top}px`;
			el.style.height = `${box.height}px`;
			// `--chain-lane-color` inherits down to the rule AND the elbow below — set once here, not per
			// child.
			el.style.setProperty('--chain-lane-x', `${box.x}px`);
			el.style.setProperty('--chain-lane-color', box.color);

			const rule = document.createElement('div');
			rule.className = 'gl-graph__chain-lane-rule';
			rule.style.height = `${box.ruleHeight}px`;
			el.append(rule);

			if (box.elbow != null) {
				const elbow = document.createElement('div');
				elbow.className = `gl-graph__chain-lane-elbow ${box.elbow.direction === 'left' ? 'is-elbow-left' : 'is-elbow-right'}`;
				// The elbow starts where the rule ends.
				elbow.style.top = `${box.ruleHeight}px`;
				elbow.style.height = `${box.elbow.height}px`;
				elbow.style.left = `${box.elbow.left}px`;
				elbow.style.width = `${box.elbow.width}px`;
				el.append(elbow);
			}

			// FIRST child, not appended — DOM order is paint order among these z-index:auto positioned
			// siblings, and the rule/elbow must paint UNDER the rows (see the class comment in graph.scss).
			v.insertBefore(el, v.firstChild);
			this._chainLaneOverlayEls.push(el);
		}

		this._chainLaneOverlayKey = key;
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

	// One-time opt-in overlay for the dormant Changes column — covers ONLY its rows area (top offset =
	// header height, see graph.scss) so the header stays interactive (mode picker, hide, resize). Absolutely
	// positioned to the column's solved rect, mirroring renderHeader's zone + gutter layout so it aligns with
	// the rows below. Suppressed the moment consent is requested (optimistic) or granted by the host.
	private renderChangesOptInOverlay(): unknown {
		if (this.changesColumnEnabled !== false || this._changesEnableRequested) return nothing;

		// Defer while the status overlay owns the empty viewport ("Loading commits…" / "No commits") —
		// the opt-in shouldn't compete with it, and there's no column of rows to overlay yet anyway.
		if (this.displayRows.length === 0) return nothing;

		const c = this._renderCtx;
		if (c.style !== 'table') return nothing;

		const zone = c.zones.find(z => z.id === 'changes');
		if (zone == null) return nothing;

		const narrow = zone.width < 150;
		// The overlay degrades with width like the column's cells do (changesStageForWidth), but on its OWN
		// threshold: the "Show" text button is ~57px, so it can't fit until well past the cells' 44px icon
		// stage — below `changesStageCompact` it renders as a bare glyph and the tooltip carries all the copy.
		const collapsed = zone.width < changesStageCompact;
		// `gl-tooltip` is `display: contents`, so its slotted buttons stay flex items of the overlay stack.
		// wa-popup anchors to the FIRST slotted element (the Show button), while the button's `::before`
		// expands its hit area to the whole overlay surface (see graph.scss) — hover/click anywhere on the
		// dormant column triggers the button + its tooltip, but the tooltip stays pinned above the button.
		return html`<div
			${ref(this.changesOptInRef)}
			class="gl-graph__changes-optin${narrow ? ' gl-graph__changes-optin--narrow' : ''}${
				collapsed ? ' gl-graph__changes-optin--collapsed' : ''
			}"
			style=${cspStyleMap({ width: `${zone.width}px`, visibility: 'hidden' })}
			@click=${this.onChangesOptInClick}
		>
			<gl-tooltip placement="top" show-delay="280">
				<button
					type="button"
					class="gl-graph__changes-optin-button${collapsed ? ' gl-graph__changes-optin-button--icon' : ''}"
					aria-label="Show Changes Column"
				>
					${collapsed ? html`<code-icon icon="eye"></code-icon>` : 'Show'}
				</button>
				<button
					type="button"
					class="gl-graph__changes-optin-hide"
					aria-label="Hide Column"
					@click=${this.onChangesOptInHideClick}
				>
					Hide
				</button>
				<span slot="content" class="gl-graph__changes-optin-tooltip"
					><span class="gl-graph__changes-optin-tooltip-title">Show Changes Column</span
					><span
						>Computes diff stats for loaded commits in the background — can be intensive in very large
						repos.</span
					><span class="gl-graph__changes-optin-tooltip-sub">Enable once for all repos.</span></span
				>
			</gl-tooltip>
			${
				narrow
					? nothing
					: html`<span class="gl-graph__changes-optin-help"
								>Computes diff stats for loaded commits in the background — can be intensive in very
								large repos.</span
							>
							<span class="gl-graph__changes-optin-sub">Enable once for all repos.</span>`
			}
		</div>`;
	}

	private onChangesOptInClick = (): void => {
		this._changesEnableRequested = true;
		this.requestUpdate();
		this.dispatchEvent(new CustomEvent('gl-graph-enable-changes-column', { bubbles: true, composed: true }));
	};

	private onChangesOptInHideClick = (e: MouseEvent): void => {
		e.stopPropagation();
		this.applyZones(this.zones.map(z => (z.id === 'changes' ? { ...z, hidden: true } : z)));
	};

	// Filter-search results footer — filter mode only, since normal/highlight mode leaves every row in
	// place and has nothing to report. A sibling BELOW the viewport div (not inside the virtualizer's
	// scroll content), so it never affects row virtualization.
	private renderSearchFooter(): TemplateResult | typeof nothing {
		if (this.searchMode !== 'filter') return nothing;

		const sr = this.searchResults;
		if (sr == null || !('count' in sr)) return nothing;

		// "No results" reads even while a background page load is in flight — every other state needs the
		// load settled first so the counts it reports are stable.
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
		//
		// That blunt guarantee is also the dominant per-keypress cost during arrow navigation on a
		// lane-heavy history: a new identity re-runs `renderItem` for EVERY row in the rendered range, and
		// a keypress changes the appearance of two of them. Making it stable is a real option, but it is
		// not a one-line change — everything below has to land with it, or the failure is a silently
		// frozen row rather than a slow one:
		//  • `renderRowItem` must become a `this`-free function of `(row, index, ctx)`. It reads a dozen
		//    host fields directly today (`skeletonScroll`, `excludeTypes`/`excludeRefs`/`downstreams`/
		//    `_refOrder`, `displayRows`, `nowMs`, `repoPath`, …), so no context-based staleness check can
		//    be exhaustive while those live reads exist.
		//  • The "did anything but selection change" test must compare the WHOLE context (excluding only
		//    `selected`/`focusedSha`) rather than an enumerated field list — an include-list fails unsafe
		//    (freeze), a whole-object compare fails safe (redundant re-render). That requires memoizing
		//    `zones`, `laneWindow`, `rowMarkerTips` and `wipRowMarkerPill` at their source: each allocates
		//    fresh every update, and `laneWindow` does so exactly when lanes overflow — so without the
		//    memos the check always trips on precisely the repos this is meant to help.
		//  • State that mutates behind a stable reference is invisible to any such compare and needs an
		//    explicit bump: `settleSkeletonScroll` (its `requestUpdate` relies on this closure being
		//    recreated — see its comment), `invalidateAdornments`, the in-place `failedAvatarUrls` add,
		//    the payload-only `commits` swap, the palette epoch, and the relative-date minute tick.
		//  • Selection/focus would move to an imperative reconcile — they reach the row as two class
		//    tokens plus `aria-selected`/`data-focused` and nothing else, and hover already works this way
		//    (it triggers no render at all). The template must KEEP stamping them from the context so a
		//    later re-render self-heals.
		// Note the scroll path is unaffected either way: the virtualize directive re-runs `renderItem` over
		// the whole range on every `rangeChanged`, independent of this identity.
		//
		// `undefined` row = a hole from the virtualizer's not-yet-remeasured range (see `rowKey`) — spacer it,
		// matching the missing-commit degradation in `renderRowItem`.
		const renderItem = (row: ProcessedGraphRow | undefined, index: number): TemplateResult =>
			row != null
				? this.renderRowItem(row, index)
				: html`<div class="gl-graph__row" style=${cspStyleMap({ height: `${c.rowHeight}px` })}></div>`;
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
				class="gl-graph__viewport scrollable${
					this.windowFocused === false ? ' gl-graph--window-unfocused' : ''
				}"
				@keydown=${this.handleViewportKeydown}
				@focusin=${this.onFocusIn}
				@focusout=${this.onFocusOut}
				@click=${this.onClick}
				@dblclick=${this.onDblClick}
				@contextmenu=${this.onContextMenu}
				@pointerover=${this.onPointerOverTooltip}
				@pointerout=${this.onPointerOutTooltip}
				@pointerleave=${this.onPointerLeave}
			>
				${header}
				<div
					${ref(this.treeRef)}
					class="gl-graph__tree"
					role="tree"
					aria-label="Commit graph"
					aria-multiselectable="true"
					aria-activedescendant=${this._activeRowId ?? nothing}
					tabindex="0"
					@keydown=${this.onKeydown}
				>
					<lit-virtualizer
						${ref(this.virtualizerRef)}
						id="gl-graph-lanes"
						class="gl-graph__virtualizer scrollable"
						scroller
						tabindex=${
							// Opt the scroller OUT of Chromium's keyboard-focusable-scroll-containers: since every
							// row control is tabindex=-1, the scroller has no focusable descendant, so Chromium
							// would otherwise auto-add it to the tab order — a spurious "graph body" stop where
							// Up/Down natively scroll (not navigate) and a default UA outline shows. The tree
							// wrapper (tabindex=0) is the real keyboard host; keyboard scrolling rides row nav.
							'-1'
						}
						.items=${this.displayRows}
						.keyFunction=${this.rowKey}
						.layout=${this.fixedRowLayout}
						.renderItem=${renderItem}
						@rangeChanged=${this.onRangeChanged}
						@wheel=${
							// PASSIVE (see graphWheelListener) so vertical wheel scrolling never blocks on the main
							// thread. Only column placement pans the lanes with the wheel, so only attach it there
							// (and only when the lanes actually overflow).
							this.graphPlacement === 'column' && this.maxGraphScrollX > 0
								? this.graphWheelListener
								: nothing
						}
					></lit-virtualizer>
				</div>
				${this.renderStatusOverlay()}${this.renderChangesOptInOverlay()}${this.renderScrollMarkers()}${this.renderWaypoints()}${this.renderStickyTimeline()}${this.renderHScrollbar()}${this.renderChangesModePopover()}${this.renderRefFind()}
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
					>${
						this.tooltipContent ??
						(this.tooltipEntries.length > 0
							? this.tooltipEntries.map(
									e =>
										html`<span class="gl-graph__tooltip-row"
											>${
												e.icon.length > 0
													? html`<code-icon
															class="gl-graph__tooltip-icon"
															icon=${e.icon}
														></code-icon>`
													: nothing
											}<span>${e.label}</span></span
										>`,
								)
							: html`${
									this.tooltipIcon.length > 0
										? html`<code-icon
												class="gl-graph__tooltip-icon"
												icon=${this.tooltipIcon}
											></code-icon>`
										: nothing
								}${this.tooltipText}`)
					}</span
				>
			</gl-popover>
		`;
	}

	/**
	 * Off-screen waypoints, bottom-right: one shared capsule holding a segment per target whose row is
	 * loaded but scrolled out of view.
	 *
	 * ⚠ HEAD is rendered LAST and is the anchor. The capsule is right-aligned, so HEAD's on-screen
	 * position is fixed by construction — no arithmetic, and adding a waypoint can never displace it.
	 * New segments insert to its LEFT, ordered by permanence (HEAD is always meaningful; the user's pin
	 * is a choice; anything transient goes further left).
	 *
	 * ONE presentation at every count: the capsule looks the same holding one segment or three, so a pin
	 * appearing doesn't restyle the affordance the user was already looking at.
	 */
	private renderWaypoints(): TemplateResult | typeof nothing {
		const pinned = this.renderPinnedPill();
		const head = this.renderHeadPill();
		if (pinned === nothing && head === nothing) return nothing;

		return html`<div class="gl-graph__waypoints" role="group" aria-label="Off-screen branches">
			${pinned}${head}
		</div>`;
	}

	// "Jump to HEAD" waypoint — shown only when the current HEAD commit is off screen; the arrow points
	// toward it, clicking centers + selects it. Always the capsule's trailing (anchor) segment.
	// Wording is "Jump", not "Scroll": it's the codebase's term for this action everywhere else (including
	// the WIP pill's own `Jump to HEAD (<name>)`), and it selects the row rather than merely scrolling to it.
	private renderHeadPill(): TemplateResult | typeof nothing {
		const dir = this.headPillDirection;
		if (dir == null) return nothing;

		// When the pin lands on this row the two waypoints name ONE destination, so the pinned segment
		// collapses into this one (see `pinnedIsHead`) and the pin rides along as a glyph. It keeps HEAD's
		// tint — a second accent inside one segment would re-draw the split the collapse just removed.
		const pinnedHere = this.pinnedIsHead;
		const pinnedName = pinnedHere ? this.pinnedRef?.name : undefined;
		const tooltip = !pinnedHere
			? 'Jump to HEAD'
			: pinnedName != null
				? `Jump to HEAD (Pinned Branch ${pinnedName})`
				: 'Jump to HEAD (Pinned Branch)';
		const label = !pinnedHere
			? 'Jump to HEAD'
			: pinnedName != null
				? `Jump to HEAD, pinned branch ${pinnedName}`
				: 'Jump to HEAD, pinned branch';

		return html`<button
			class="gl-graph__waypoint gl-graph__waypoint--head"
			type="button"
			data-tooltip=${tooltip}
			aria-label=${label}
			@click=${this.onHeadPillClick}
		>
			<code-icon icon=${dir === 'up' ? 'arrow-up' : 'arrow-down'}></code-icon
			>${pinnedHere ? html`<code-icon icon="gl-pinned-filled"></code-icon>` : nothing}HEAD
		</button>`;
	}

	/** The pinned branch's row IS the HEAD row, so both waypoints would scroll to and select the same row.
	 *  Gated on `headPillDirection` so the pinned waypoint is only dropped when HEAD's actually renders. */
	private get pinnedIsHead(): boolean {
		return this.pinnedSha != null && this.pinnedSha === this.headSha && this.headPillDirection != null;
	}

	/**
	 * "Jump to Pinned Branch" waypoint — shown only when a branch is pinned (gitlens.graph.pinBranchToEdge)
	 * AND its row is scrolled off-screen; the arrow points toward it, clicking centers + selects it.
	 *
	 * Reads `Pinned` at rest and widens in place to the branch NAME on hover/focus. Bounded at rest for
	 * two reasons: the capsule's left edge would otherwise jitter as the pin changes (defeating the point
	 * of anchoring HEAD), and a name truncated from the left is useless here — GitLens's own branch
	 * convention front-loads `feature/`, `bug/`, `debt/`, so the first characters are the least
	 * distinguishing part. The name stays one hover away, and `aria-label` carries it unconditionally so
	 * screen readers never need the hover.
	 */
	private renderPinnedPill(): TemplateResult | typeof nothing {
		const dir = this.pinnedPillDirection;
		// Collapsed into the HEAD segment when both point at the same row — drop THIS one, never HEAD's:
		// HEAD is the capsule's anchor, and its trailing position is what keeps it arithmetic-free.
		if (dir == null || this.pinnedSha == null || this.pinnedIsHead) return nothing;

		const name = this.pinnedRef?.name;
		return html`<button
			class="gl-graph__waypoint gl-graph__waypoint--pinned gl-graph__pinned-pill"
			type="button"
			data-tooltip=${name != null ? `Jump to Pinned Branch (${name})` : 'Jump to Pinned Branch'}
			aria-label=${name != null ? `Jump to pinned branch ${name}` : 'Jump to Pinned Branch'}
			@click=${this.onPinnedPillClick}
		>
			<code-icon icon=${dir === 'up' ? 'arrow-up' : 'arrow-down'}></code-icon
			><code-icon icon="gl-pinned-filled"></code-icon>
			<span class="gl-graph__pinned-pill-swap"
				><span class="gl-graph__pinned-pill-rest">Pinned</span
				><span class="gl-graph__pinned-pill-name">${name ?? 'Pinned'}</span></span
			>
		</button>`;
	}

	// Sticky-timeline pill: rides the header/first-row seam, showing which relative-time group (Today /
	// Yesterday / This week / Last week / N weeks ago / …) — mirroring the Date column's OWN `fromNow`
	// families — the topmost visible row falls in (see `updateStickyTimelineBucket`). AT REST it's just
	// the label; scrolling or hovering widens the SAME pill in place (native `:hover` + the JS-toggled
	// `is-scroll-active` class in `onScroll` — CSS alone drives the reveal, see graph.scss). Not a
	// button — purely informational, so no click handler/tabstop.
	private renderStickyTimeline(): TemplateResult | typeof nothing {
		if (this.config?.stickyTimeline === false || this.stickyTimeline == null) return nothing;

		return html`<div ${ref(this.stickyTimelineRef)} class="gl-graph__sticky-timeline" aria-hidden="true">
			<code-icon class="gl-graph__sticky-timeline-icon" icon="calendar"></code-icon>
			<span class="gl-graph__sticky-timeline-label">${this.stickyTimeline.label}</span>
			<span class="gl-graph__sticky-timeline-span">${this.stickyTimeline.span}</span>
		</div>`;
	}

	// The rail's row scale, from its per-row fraction `rowPx`. Drawing (`renderScrollMarkers`) and
	// hit-testing (`nearestScrollMarker`) BOTH derive from here, and both then place bands through
	// `scrollMarkerBandTop` — deriving positions from two independent copies of this math is exactly what
	// let the drawn and hit-tested bands drift apart once already.
	// When the list DOESN'T fill the viewport (e.g. a scoped re-root with only a handful of rows),
	// `index/total` would spread the markers across the whole rail while the rows themselves cluster at the
	// top — markers end up far below their rows. `realRowPositions` switches to REAL pixel rows there; once
	// the list overflows (rowHeight >= rowPx) it collapses back to the index/total mapping, so scrollable
	// graphs are unchanged.
	private scrollMarkerScale(rowPx: number): ScrollMarkerScale {
		const rowHeight = this._renderCtx?.rowHeight ?? 0;
		return {
			markerRowPx: rowHeight > 0 ? Math.min(rowHeight, rowPx) : rowPx,
			realRowPositions: rowHeight > 0 && rowHeight < rowPx,
		};
	}

	// Top (px) of row `index`'s band on the rail. The index/total mapping is pure INDEX space and
	// deliberately ignores row units; only the real-pixel-row branch has to respect them, and there a
	// promoted row's band belongs on its DATA unit — the line the commit itself renders on — not the pill
	// line above it (mirrors `dataUnitOf` in the render context, which is where that rule is defined).
	private scrollMarkerBandTop(index: number, scale: ScrollMarkerScale): number {
		if (!scale.realRowPositions) return index * scale.markerRowPx;

		const dataUnit = this._rowUnits.unitsOf(index) > 1 ? 1 : 0;
		return (this._rowUnits.unitPosOf(index) + dataUnit) * scale.markerRowPx;
	}

	// Scroll-rail markers: a thin overlay pinned to the right edge of the viewport (over the scrollbar
	// track). One full-width interactive BAND per row (placed by fraction-down-the-list, `top: N%`)
	// carries that row's lane-colored ticks as non-interactive children — so hover/click anywhere on
	// the row's y-band highlights all its markers (in lane order) + shows one tooltip listing them all,
	// and a click jumps to the row. Lets the user spot branches/tags/matches without scrolling.
	private renderScrollMarkers(): TemplateResult | typeof nothing {
		// Gate on the marker types being ENABLED, not on there being markers to draw: the rail is also the
		// right-click target for its own toggle menu, so it has to exist while the graph has no refs to mark
		// (or the user has turned every additional type off) — otherwise re-enabling a type from the rail is
		// unreachable exactly when you'd want it. With the master toggle off there's no rail (and no menu) at
		// all; the settings page owns that switch. Mirrors `recomputeScrollMarkers`' own guard.
		if (!this.config?.scrollMarkerTypes?.length) return nothing;

		const rows = this.scrollMarkerRows;

		// The header (now present in both densities) sits above the scroller, so offset the rail down by
		// the header height to keep tick fractions aligned with the rows below it.
		const railTop = '2.4rem';

		// Per-row pixel span on the rail (`rowPx`): the rail spans the viewport height (less the
		// header), and `topPct = index/total` maps the FULL list into it — so each row gets
		// railHeightPx / totalRowCount px. Drives each box's clamped height.
		// Cached height, NOT a live `clientHeight` — this runs inside render(), and a live read there forces
		// a synchronous layout on every update (same reason the viewport-height var and the minimap day-range
		// use the cache). Fall back to a live read only while the cache is unprimed, so a first paint that
		// already has rows still lays the rail out correctly; `firstUpdated` primes it right after.
		const viewportPx = this.scrollerClientHeight || (this.virtualizerRef.value?.clientHeight ?? 0);
		// The rail is `top: 2.4rem; bottom: 0` inside the viewport, so its box already IS the scroller's
		// height — the header offset is spent by `top`. `scrollerClientHeight` excludes the header too, so
		// subtracting it again drew the whole rail one header short: every marker crept upward in proportion
		// to its index, reaching a full ~24px at the bottom. `nearestScrollMarker` measures the rail's REAL
		// height, so past the 8px magnet the lower rail hovered a different marker or none at all.
		const railPx = viewportPx;
		const total = this._renderCtx?.total ?? rows.length;
		const rowPx = total > 0 ? railPx / total : 0;
		const scale = this.scrollMarkerScale(rowPx);

		return html`<div
			class="gl-graph__scroll-markers"
			style=${cspStyleMap({ top: railTop })}
			data-vscode-context=${this.scrollMarkersContext ?? nothing}
			@pointerdown=${this.onScrollMarkerPointerDown}
			@pointerup=${this.onScrollMarkerPointerUp}
			@pointercancel=${this.onScrollMarkerPointerCancel}
			@pointermove=${this.onScrollMarkerPointerMove}
			@pointerleave=${this.onScrollMarkerPointerLeave}
			@pointerover=${this.stopPointerOver}
			@contextmenu=${this.onScrollMarkerContextMenu}
			@click=${(e: Event) => e.stopPropagation()}
		>
			${repeat(
				rows,
				// Key by the COMMIT (sha at this display index), not the index itself — across a
				// collapse/expand/filter the same index maps to a different commit, so an index key would
				// recycle a band's DOM between unrelated commits.
				row => this.displayRows[row.index]?.sha ?? row.index,
				row => {
					return html`<div
						class="gl-graph__scroll-marker-band${
							row.index === this.hoveredMarkerIndex ? ' is-hovered' : ''
						}"
						data-marker-index=${row.index}
						aria-hidden="true"
						style=${cspStyleMap({
							top: `${this.scrollMarkerBandTop(row.index, scale)}px`,
						})}
					>
						${row.entries.map((e, idx) => {
							// Block ticks fill their lane(s); fullLine/thinLine span the whole rail width as a
							// thin rule. Heights track `rowPx`, clamped per shape.
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

		const total = this._renderCtx?.total ?? this.scrollMarkerRows.length;
		// Scale off the SAME value `renderScrollMarkers` draws with, not this rect's height. They agree today,
		// but deriving the scale from two independent sources is exactly what let the drawn and hit-tested
		// positions drift apart. `rect` is still needed for `top` (client → rail-relative), which no cached
		// value can supply. Falls back to the measured height while the cache is unprimed. Everything past
		// `rowPx` — the scale and each band's top — goes through the same two helpers the draw uses.
		const rowPx = total > 0 ? (this.scrollerClientHeight || rect.height) / total : 0;
		const scale = this.scrollMarkerScale(rowPx);
		const clickPx = clientY - rect.top;
		let nearest: RowMarkers | undefined;
		let bestPx = Infinity;
		for (const row of this.scrollMarkerRows) {
			const px = Math.abs(this.scrollMarkerBandTop(row.index, scale) - clickPx);
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
		// The rail overlays the rows and claims the pointer, but the row hovercard doesn't dismiss itself for
		// that — so it stayed open behind the marker's own tooltip, showing one row while the rail described a
		// different one. End the row hover for any movement on the rail; `endRowHover` no-ops when none is
		// active, so this costs nothing on the common path.
		this.endRowHover(container);

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

	// Right-click on the rail opens VS Code's native menu from `data-vscode-context` — deliberately NOT
	// preventDefault'd. Only drop the marker tooltip, which would otherwise float over the open menu (the
	// rail never gets a pointerleave while the menu has the pointer).
	private readonly onScrollMarkerContextMenu = (): void => {
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

	// Click the rail → jump to a row: the NEAREST marker if the click is near one, otherwise the row at the
	// clicked position (the rail doubles as a click-to-jump navigator).
	// Driven from pointerup (not @click) so it coexists with the drag-scrub (only fires when no drag) — and
	// the rail STOPS the click that follows, because `onClick` cancels any reveal in flight and would
	// otherwise kill the scroll this very press just started. Same contract the ref-find widget follows.
	private jumpToScrollMarker(container: HTMLElement, clientY: number): void {
		const scroller = this.virtualizerRef.value;
		if (scroller == null) return;

		const nearest = this.nearestScrollMarker(container, clientY);
		// An EMPTY-rail click is a POSITION, not a row: it scrubs like a scrollbar and selects nothing —
		// opening the details panel on whichever commit happens to sit under that pixel would be choosing
		// for the reader. With no row identity there is nothing to hand the shared jump, so this one stays
		// on the positioning primitive, centered: the clicked Y already says where in the viewport the row
		// belongs, and an offset landing would read as having missed the click.
		if (nearest == null) {
			const rect = container.getBoundingClientRect();
			const total = this._renderCtx?.total ?? this.scrollMarkerRows.length;
			if (rect.height <= 0 || total <= 0) return;

			const index = Math.round(((clientY - rect.top) / rect.height) * total);
			this.revealIndexAt(index, centerRevealRatio, true);
			return;
		}

		// Clicking a MARKER is clicking a named row — HEAD, the upstream, the merge target, the pinned ref,
		// the selection — so it takes the same wrapper-owned jump (load → select → reveal) the waypoints and
		// every ref pill take. Revealing here and dispatching the selection separately left `_pendingRevealSha`
		// unset, and the anchor correctors then re-parked the viewport off the target mid-flight (the failure
		// `onHeadPillClick` documents). Landing at the shared ratio instead of dead center is the deliberate
		// cost of that: one rule, in one place, for where a jump parks.
		const sha = this.displayRows[nearest.index]?.sha;
		if (sha == null) return;

		this.jumpToRefRow(sha, { focus: true, flash: true });
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
				const key = el.dataset.refKey ?? refPillKey({ kind: kind, name: name, owner: remote });
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

	// Resolve the `{ key, sha }` pair `togglePinnedRef`/`activateModifierChain` need from a pointer
	// event's path — same two lookups the pill click handler makes (resolveRef for the pill, resolveSha
	// for its row), just packaged for the hover path.
	private resolvePillHover(event: Event): { key: string; sha: string } | undefined {
		const ref = this.resolveRef(event);
		if (ref == null) return undefined;

		const sha = this.resolveSha(event);
		return sha != null ? { key: ref.key, sha: sha } : undefined;
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

	private rowKindForSha(sha: string): GitGraphRow['kind'] {
		return this.getCommitBySha(sha)?.kind ?? 'commit';
	}

	/** The serialized `webviewItem` context for a row, as the right-click menu would see it — what a
	 *  keyboard-invoked row command has to carry, since there's no `data-vscode-context` DOM walk to do it.
	 *  WIP rows aren't in the payload plane at all (they're synthetic), so they're built here from the
	 *  worktree path their id encodes; commit rows reuse the view row's own lazily-resolved context. */
	private rowContextFor(sha: string | undefined): string | undefined {
		if (sha == null) return undefined;

		const worktreePath = getWipRowWorktreePath(sha);
		if (worktreePath != null) {
			return serializeWipContext(
				worktreePath,
				sha !== this.primaryWipRowId,
				this.wipStateById?.[sha]?.hasConflicts ?? false,
			);
		}

		return this.getCommitBySha(sha)?.contextData;
	}

	// A ref-pill click's pin + branch-sheet open is deferred so a checkout double-click doesn't flash them
	// (the first of a double-click's two clicks would otherwise pin/open and the second toggle it back off).
	private _pendingPillActivation?: ReturnType<typeof setTimeout>;

	// Pin the ref + open its branch sheet (the body that used to run inline in `onClick`). `pillSha` is
	// captured at click time because the deferral timer runs without the event.
	private activatePill(refPill: ResolvedRefTarget, pillSha: string | undefined): void {
		const pinned = this.togglePinnedRef(refPill.key, pillSha);
		// The pill's own `data-vscode-context` carries the refGROUP keys (the "Hide" action) merged in when this ref
		// is grouped with its remote(s), which the sheet's kebab + action links can't use. Prefer the ref's
		// INDIVIDUAL context from the row model, falling back to the pill context.
		const refContext =
			(pillSha != null
				? this.getCommitBySha(pillSha)?.commitRefs.find(r => r.kind === refPill.kind && r.name === refPill.name)
						?.refContext
				: undefined) ?? refPill.context;
		this.dispatchEvent(
			new CustomEvent('gl-graph-open-branch', {
				detail: {
					name: refPill.name,
					refType: refPill.kind,
					remote: refPill.remote,
					sha: pillSha,
					// Serialized `data-vscode-context` for this ref — powers the sheet's kebab menu (row-menu
					// parity) and its remote/tag action links.
					context: refContext,
					open: pinned,
				},
				bubbles: true,
				composed: true,
			}),
		);
	}

	// Cancel a landing flash still waiting on its removal timer.
	private clearLandingFlashTimer(): void {
		if (this._landingFlashTimer == null) return;

		clearTimeout(this._landingFlashTimer);
		this._landingFlashTimer = undefined;
	}

	private cancelPendingPillActivation(): void {
		if (this._pendingPillActivation == null) return;

		clearTimeout(this._pendingPillActivation);
		this._pendingPillActivation = undefined;
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
		// Through `cancelPendingReveal` so the reveal GENERATION bumps too: a bare assignment leaves an
		// in-flight post-layout re-assert (revealIndexAt) believing it still owns the viewport, and it would
		// land after this click and scroll away from what was just selected.
		this.cancelPendingReveal();

		// A new click supersedes any ref-pill activation still pending from a prior click — whether the pointer
		// moved to another row (don't let a stale sheet pop open) or this is the second click of a double-click
		// (the pill branch below re-schedules only on a first click; `onDblClick` handles the checkout).
		this.cancelPendingPillActivation();

		// Row-action buttons (Open Changes / stash Apply-Drop / WIP Compose-Review) resolve
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
								type: this.rowKindForSha(sha),
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

			// The WIP row-marker pill carries the HEAD tip sha directly (`jumpSha`) — a client-side
			// scroll+select via the same `gl-jump-to-commit` path the WIP details header uses
			// (graph-wrapper's onJumpToCommit → navigateToCommit); NOT a host round-trip like
			// data-row-action.
			//
			// Says nothing about distance, because it can't: the pill (and hence this attribute) exists
			// only when HEAD is NOT the next row. The reveal rule sorts it out — a tip already sitting in
			// view stays put, one crammed at the bottom or off-screen gets landed. Flashes either way: when
			// nothing scrolls, the wash is the ONLY thing that pulls the eye to the row that just took the
			// selection.
			const jumpSha = el.getAttribute('data-jump-sha');
			if (jumpSha != null) {
				document.dispatchEvent(new CustomEvent('gl-jump-to-commit', { detail: { sha: jumpSha, flash: true } }));
				event.stopPropagation();
				return;
			}

			// The inverse: a worktree branch-tip row's "Jump to Working Changes" button jumps to the WIP
			// row sitting on this commit. Pass the row's own sha as `fromSha`; graph-wrapper's
			// onJumpToNearestWip resolves it (exact-anchor match) to that worktree's WIP row — the same
			// client-side path the commit details panel's chip uses. Distance is likewise unknowable here: the
			// resolved WIP can be a peer worktree's, matched by lane or ancestry, and arbitrarily far away.
			if (el.getAttribute('data-jump-nearest-wip') != null) {
				const sha = this.resolveSha(event);
				if (sha != null) {
					document.dispatchEvent(
						new CustomEvent('gl-jump-to-nearest-wip', {
							detail: { fromSha: sha, flash: true },
						}),
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
				// Shift means "all" on the chevron exactly as it does on Shift+Left/Right: the clicked lane's
				// CURRENT state picks the direction, so the click always moves every lane the way this one was
				// about to go rather than flipping each independently.
				if (event.shiftKey) {
					this.setAllLanesCollapsed(!this.effectiveCollapsed.has(toggleTip));
				} else {
					this.toggleLane(toggleTip);
				}
				return;
			}
		}

		// A PR/issue chip opens its PR/issue on a SINGLE click (its own action) — resolve the metadata surface
		// first and route it to the host's open (the same detail the dblclick path builds), then stop before
		// the ref-pill branch handling below. (A double-click on the chip is inert — see `onDblClick`.)
		const clickedMetadata = this.resolveRefMetadata(event);
		if (clickedMetadata != null && (clickedMetadata.type === 'pullRequest' || clickedMetadata.type === 'issue')) {
			const metaRef = this.resolveRef(event);
			if (metaRef != null) {
				this.dispatchEvent(
					new CustomEvent('gl-graph-refdoubleclick', { detail: { ...metaRef, metadata: clickedMetadata } }),
				);
				event.stopPropagation();
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
			if (event.detail === 0) {
				// Keyboard activation (synthesized `control.click()` carries `detail` 0) — no double-click to
				// guard against, so pin + open immediately.
				this.activatePill(refPill, pillSha);
			} else if (event.detail === 1) {
				// First click of a potential double-click — DEFER the pin + sheet open so a checkout
				// double-click can cancel it (the top-of-onClick cancel above / `onDblClick`) before it
				// flashes. Row selection still happens instantly via the fall-through below.
				this._pendingPillActivation = setTimeout(() => {
					this._pendingPillActivation = undefined;
					this.activatePill(refPill, pillSha);
				}, 250);
			}
			// detail >= 2 (the second click of a double-click): the top-of-onClick cancel already killed the
			// pending timer; do nothing here and let `onDblClick` route the checkout.

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

		// Range (shift+click): emit the visible-row span from the selection anchor through the clicked
		// row. The wrapper consumes this directly, or recomputes a first-parent chain when
		// `multiSelectionMode: 'topological'`. Same anchor the keyboard Shift+Arrow ranges use — the
		// anchor stays put so successive shift+clicks extend from it while focus follows the moving end;
		// replace/toggle move the anchor to the clicked row.
		let rangeShas: string[] | undefined;
		if (mode === 'range' && idx != null) {
			const anchor = this.selectionAnchorIndex;
			const lo = Math.min(anchor, idx);
			const hi = Math.max(anchor, idx);
			rangeShas = this.displayRows.slice(lo, hi + 1).map(r => r.sha);
			this.focusIndex = idx;
		} else if (idx != null) {
			this.focusIndex = idx;
			// Keyboard Shift+Arrow ranges extend from the anchor, not `focusIndex` — re-pin it too, or a
			// click followed by Shift+Down ranges from wherever the keyboard last anchored.
			this._selectionAnchorSha = sha;
			// A click is a discrete action — reveal its lane NOW; the reveal debounce exists for
			// key-repeat navigation (see revealFocusedLaneSoon). willUpdate's tracker re-arm is a no-op
			// (the lane is in view by then).
			this.revealFocusedLaneSoon.cancel();
			this.revealFocusedLane();
		}

		this.dispatchEvent(
			new CustomEvent('gl-graph-changeselection', { detail: { sha: sha, mode: mode, rangeShas: rangeShas } }),
		);

		// A row-BODY click (not a control) leaves focus on the virtualizer scroll container — it's the nearest
		// click-focusable ancestor, since the row controls are tabindex=-1 (and the virtualizer itself is
		// tabindex=-1 to stay out of the tab order). That makes Up/Down scroll natively and Tab skip past the
		// row controls to the trailing overlays. Redirect to the tree (the keyboard-nav host) so arrow nav +
		// the Tab-dive work. A click that landed on a control (pill / action) keeps that control's focus.
		if (document.activeElement === this.virtualizerRef.value) {
			this.treeRef.value?.focus({ focusVisible: false });
			// Focusing the tree runs onFocusIn's realign (focusIndex ← first SELECTED row), but this click's
			// new selection hasn't round-tripped from the host yet, so re-pin to the just-clicked row.
			if (idx != null) {
				this.focusIndex = idx;
			}
		}
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
			// A pill double-click is a ref action (checkout), not a "focus" select. Cancel this gesture's
			// still-pending deferred activation (a fast double-click — the second click's `onClick` usually
			// beat us to it), and drop any ref that IS pinned + close its sheet — whether pinned by an earlier
			// click or by this gesture's own timer having already fired (a slower double-click). Idempotent
			// when nothing is pinned, and it deliberately leaves the details panel's visibility untouched.
			if (ref.kind === 'head' || ref.kind === 'tag' || ref.kind === 'remote') {
				this.cancelPendingPillActivation();
				if (this._pinnedRefKey != null) {
					this.clearPinnedRef();
					this.dispatchEvent(
						new CustomEvent('gl-graph-open-branch', {
							detail: { open: false },
							bubbles: true,
							composed: true,
						}),
					);
				}
			}
			const metadata = this.resolveRefMetadata(event);
			// PR/issue chips open on a SINGLE click (see `onClick`); don't also fire the open on double-click. A
			// plain ref double-click (metadata == null) still routes here — the checkout / pull-push path.
			if (metadata?.type !== 'pullRequest' && metadata?.type !== 'issue') {
				this.dispatchEvent(
					new CustomEvent('gl-graph-refdoubleclick', { detail: { ...ref, metadata: metadata } }),
				);
			}
			return;
		}

		const sha = this.resolveSha(event);
		if (sha == null) return;

		this.dispatchEvent(
			new CustomEvent('gl-graph-rowdoubleclick', { detail: { sha: sha, type: this.rowKindForSha(sha) } }),
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
				detail: { sha: sha, type: this.rowKindForSha(sha), zone: zone },
			}),
		);
	};

	// The .gl-graph__ref-pill element under the event (light-DOM walk, parallels resolveRef). Ghost
	// pills don't count: they're hoverable (name expand) but not a real ref surface — no `data-ref-key`
	// to context-pin, and no pill-level `data-vscode-context`, so the native menu shows the ROW menu and
	// the zone must say so.
	private resolveRefPill(event: Event): HTMLElement | undefined {
		for (const el of event.composedPath()) {
			if (el instanceof HTMLElement && el.classList.contains('gl-graph__ref-pill')) {
				return el.classList.contains('gl-graph__ref-pill--ghost') ? undefined : el;
			}
		}
		return undefined;
	}

	// Keep a right-clicked ref pill "open" while the native context menu is up: force-expand it
	// (`_contextPinnedRefKey` → `.is-context-pinned`, read live — see `renderRefPill`) and force any
	// wrapping multi-ref popover open. Unpinned on the next interaction after the menu closes
	// (webview-focus return, or the next primary pointerdown).
	private pinnedRefPopover?: GlPopover;
	private pinRefPill(pill: HTMLElement): void {
		this.unpinRefPill(); // never pin two at once / leak across rows
		// Qualified by the pill's jump sha: the WIP row's proxy pill carries the SAME `data-ref-key` as the
		// real pill on the HEAD row, so the bare key would expand the wrong one (see `refContextPinKey`).
		this._contextPinnedRefKey = refContextPinKey(pill.dataset.refKey, pill.dataset.jumpSha);
		this.invalidateAdornments();

		// Resolved from the live pill under the cursor, not re-derived from the key later — this handler
		// only ever fires with the wrapping popover (if any) still attached, so there's nothing to gain
		// from a deferred lookup.
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
		if (this._contextPinnedRefKey != null) {
			this._contextPinnedRefKey = undefined;
			this.invalidateAdornments();
		}
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
	// row above whose first parent is this row (from a WIP row: its anchor's), preferring the one on this
	// row's own lane. Undefined when the lineage leaves the loaded set.
	private findTopologicalRowIndex(from: number, dir: 1 | -1): number | undefined {
		const rows = this.displayRows;
		const cur = rows[from];
		if (cur == null) return undefined;

		if (dir === 1) {
			// `parents[0]` on a DISPLAY row is the projection's remapped first VISIBLE ancestor, not the
			// commit's own first parent — a fold whose dropped parent can't be resolved omits it, so at a
			// window edge this can step onto the second merge leg.
			const parentSha = cur.parents?.[0];
			return parentSha != null ? this.indexBySha.get(parentSha) : undefined;
		}

		// A WIP row's sha is synthetic — no row parents it, so walking up from one would dead-end. It's a
		// stop on its anchor's lineage, not a terminus: resume the anchor's walk from just above the WIP
		// row, which lands on the anchor's real child (or the next worktree's WIP row anchored there).
		const childOfSha = cur.kind === 'workdir' ? cur.parents?.[0] : cur.sha;
		if (childOfSha == null) return undefined;

		// The lane is the ANCHOR's column, not the starting row's: a peer WIP row claims a lane of its own
		// whenever its anchor's column is already reserved, so its own column names the wrong lane.
		const anchorIndex = this.indexBySha.get(childOfSha);
		const laneColumn = (anchorIndex != null ? rows[anchorIndex]?.column : undefined) ?? cur.column;

		// Every commit that forked here also lists it as its first parent, so multiple rows above can match.
		// Take the nearest on-lane one — the layout gave the anchor the column its in-lane child reserved,
		// so column equality identifies that child — and keep the nearest off-lane match as the fallback.
		let offLane: number | undefined;
		for (let i = from - 1; i >= 0; i--) {
			const row = rows[i];
			if (row.parents?.[0] !== childOfSha) continue;

			// A WIP row anchored here is on-lane whatever column it landed on — it's a stop on this
			// lineage, not a fork off it. Only while nothing nearer matched, though: a PEER's row is
			// interleaved directly above its anchor, but the graph's own is pinned at row 0 however far
			// its anchor sits down the list, and that one must not outrank a real child in between.
			if (row.column === laneColumn || (row.kind === 'workdir' && offLane == null)) return i;

			offLane ??= i;
		}

		// Nothing continues this lane: it's a tip, so step onto the nearest branch that forked from it
		// rather than dead-ending (the engine's lane walks fall back the same way).
		return offLane;
	}

	// Lazy reverse-topology map for branching-point nav + lane-chain highlight; rebuilt only when
	// processedRows changes.
	private childrenBySha: ReadonlyMap<string, readonly string[]> | undefined;
	private childrenByShaRows: readonly ProcessedGraphRow[] | undefined;

	private ensureChildrenBySha(): ReadonlyMap<string, readonly string[]> {
		if (this.childrenBySha == null || this.childrenByShaRows !== this.processedRows) {
			this.childrenBySha = buildChildrenBySha(this.processedRows);
			this.childrenByShaRows = this.processedRows;
		}
		return this.childrenBySha;
	}

	// Next/prev branching point: walks the row's lane lineage (same-column hops) to the nearest fork
	// point — a commit with a child on another lane (old-engine parity). Walks the FULL topology
	// (processedRows) so hops through a collapsed lane still land, then maps the target back to a
	// display row — its own row, or the collapsed lane's chip row when it's folded away.
	private findBranchingPointIndex(from: number, dir: 1 | -1): number | undefined {
		let walkFrom = this.displayRows[from]?.sha;
		if (walkFrom == null) return undefined;

		const children = this.ensureChildrenBySha();
		// A folded target maps to its segment's CHIP row, which always sits ABOVE it — so downward that
		// mapping can land at or before `from` and the key would either walk backwards or stick forever.
		// Resume the walk from the folded target itself (the engine only tests its stop condition on newly
		// reached commits, so restarting there is the same walk continued) until something actually moves in
		// `dir`. Bounded by the processed-row count: every pass consumes at least one commit.
		for (let guard = this.processedRows.length; guard > 0; guard--) {
			const sha = findBranchingPointSha(this.processedRows, this.processedIndexBySha, children, walkFrom, dir);
			if (sha == null) return undefined;

			const idx = this.indexBySha.get(sha) ?? this.mapFoldedRowIndex(sha);
			if (idx != null && (idx - from) * dir > 0) return idx;

			walkFrom = sha;
		}

		return undefined;
	}

	/** Display index for a row hidden inside a collapsed lane — its segment's chip (tip) row. */
	private mapFoldedRowIndex(sha: string): number | undefined {
		const tip = this.segmentByCommit.get(sha);
		return tip != null ? this.indexBySha.get(tip) : undefined;
	}

	// ————— Managed row-control focus (roving toolbar groups per active row) —————
	// The tree is an aria-activedescendant single tab stop; a row's interactive controls are NOT in the tab
	// order (tabindex=-1) and are reached only by "diving" from the tree. They form TWO separate roving
	// groups in visual order — REFS (ref pills, left) then ACTIONS (row-action buttons, right):
	//   Tab from the tree → the first group's first control; Tab → the next group; Tab past the last leaves
	//   the graph. Arrow Left/Right + Home/End rove within a group. Enter/Space activate (pills via a
	//   synthesized click; action <button>s natively). Esc / Shift+Tab retreat. These are the `rowControl`
	//   scope's bindings; every other row key falls through to `rows` (see `rowControlKeyBindings`).
	// A grouped (multi-ref) pill also acts as a menu button: Enter fires its primary ref, while Arrow
	// Up/Down move an `aria-activedescendant` cursor over the open popover's ref rows and Enter on a
	// cursored row activates THAT ref — focus stays on the pill (the popover content is hoisted out of the
	// tree, so we never move real focus into it).

	/** The rendered DOM element for the active (focusIndex) row, or null when it's virtualized out. */
	private activeRowElement(): HTMLElement | null {
		const sha = this.displayRows[this.focusIndex]?.sha;
		if (sha == null) return null;

		return this.querySelector<HTMLElement>(`#${CSS.escape(`graph-row-${sha}`)}`);
	}

	/** A row's visible, interactive controls for a group, in visual (left→right = DOM) order. Refs = each
	 *  pill PLUS its inline sub-chips (upstream-jump / PR / issue, which all carry `data-ref-metadata-type`),
	 *  so Left/Right roves the whole refs row: pill → jump → PR → issue → next pill. Actions = the row-action
	 *  buttons. Excluded: controls hidden at rest (display:none / visibility:hidden); those in an aria-hidden
	 *  subtree (the hover-expand overlay's duplicate chips, ghost anchor pills); and a grouped pill's open
	 *  popover CONTENT rows (`.gl-graph__ref-popover-list`) — those are the Up/Down menu, not Left/Right
	 *  stops — while keeping the anchor pill + its inline sub-chips. */
	private rowGroupControls(rowEl: Element, group: 'refs' | 'actions'): HTMLElement[] {
		const selector = group === 'refs' ? '.gl-graph__ref-pill, [data-ref-metadata-type]' : '.gl-graph__row-action';
		return [...rowEl.querySelectorAll<HTMLElement>(selector)].filter(
			el =>
				// Focusable only: `[data-ref-metadata-type]` also matches the NON-jump upstream status span
				// (no tabindex), which would wedge the rove — `.focus()` no-ops on it, so Left/Right can't
				// step past it to the PR/issue chips that follow.
				el.matches('button, [tabindex]') &&
				el.offsetParent != null &&
				getComputedStyle(el).visibility !== 'hidden' &&
				el.closest('[aria-hidden="true"]') == null &&
				el.closest('.gl-graph__ref-popover-list') == null,
		);
	}

	/** The displayRows index of the row containing a managed control, or undefined. */
	private rowIndexOf(control: HTMLElement): number | undefined {
		const sha = control.closest<HTMLElement>('.gl-graph__row')?.dataset.sha;
		return sha != null ? this.indexBySha.get(sha) : undefined;
	}

	/** Which group a focused control belongs to, or null. Actions first (a pill never nests an action). */
	private controlGroup(control: HTMLElement): 'refs' | 'actions' | null {
		if (control.closest('.gl-graph__row-action') != null) return 'actions';
		if (control.closest('.gl-graph__ref-pill') != null) return 'refs';

		return null;
	}

	/** Move focus into the active row's FIRST non-empty group (refs, else actions). Returns false when the
	 *  active row isn't rendered or has no controls (caller lets Tab fall through / leave the graph). */
	private enterActiveRowGroup(): boolean {
		const rowEl = this.activeRowElement();
		if (rowEl == null) return false;

		for (const group of ['refs', 'actions'] as const) {
			const controls = this.rowGroupControls(rowEl, group);
			if (controls.length > 0) {
				controls[0].focus({ preventScroll: true });
				return true;
			}
		}

		return false;
	}

	/** Rove focus within a control's own group. `where`: +1 / -1 step, or 'first' / 'last'. */
	private roveRowControls(current: HTMLElement, where: number | 'first' | 'last'): void {
		const rowEl = current.closest('.gl-graph__row');
		const group = this.controlGroup(current);
		if (rowEl == null || group == null) return;

		const controls = this.rowGroupControls(rowEl, group);
		const i = controls.indexOf(current);
		if (i < 0) return;

		const n = controls.length;
		const nextIdx = where === 'first' ? 0 : where === 'last' ? n - 1 : Math.max(0, Math.min(n - 1, i + where));
		controls[nextIdx]?.focus({ preventScroll: true });
	}

	/** Move to the adjacent group's edge control (`dir` +1 forward / -1 back). Returns true if it moved;
	 *  false lets Tab/Shift+Tab fall through (forward past the last group leaves the graph, back before the
	 *  first retreats to the tree — both are the browser default since controls are tabindex=-1). */
	private moveToAdjacentGroup(current: HTMLElement, dir: 1 | -1): boolean {
		const rowEl = current.closest('.gl-graph__row');
		const group = this.controlGroup(current);
		if (rowEl == null || group == null) return false;

		const order = ['refs', 'actions'] as const;
		for (let gi = order.indexOf(group) + dir; gi >= 0 && gi < order.length; gi += dir) {
			const controls = this.rowGroupControls(rowEl, order[gi]);
			if (controls.length > 0) {
				(dir === 1 ? controls[0] : controls.at(-1))?.focus({ preventScroll: true });
				return true;
			}
		}

		return false;
	}

	/** The innermost managed row control in a keydown's composed path (sub-chips resolve to THEMSELVES, not
	 *  the pill containing them, so each is its own rove stop), or null. The `rowControl` scope's element. */
	private rowControlFor(event: KeyboardEvent): HTMLElement | null {
		return (
			event
				.composedPath()
				.find((el): el is HTMLElement => el instanceof HTMLElement && el.matches(rowControlSelector)) ?? null
		);
	}

	/** The ref pill in a keydown's composed path — the `pillMenu` scope's element, reached from the pill
	 *  itself or from one of its inline sub-chips. */
	private pillFor(event: KeyboardEvent): HTMLElement | null {
		return (
			event
				.composedPath()
				.find((el): el is HTMLElement => el instanceof HTMLElement && el.matches('.gl-graph__ref-pill')) ?? null
		);
	}

	/** Rove within the focused control's group. Clears a grouped pill's lingering menu cursor first —
	 *  roving away otherwise leaves a stale `.is-active` row + dangling `aria-activedescendant`. */
	private roveFromControl(event: KeyboardEvent, where: number | 'first' | 'last'): boolean {
		const control = this.rowControlFor(event);
		if (control == null) return false;

		this.clearPillCursorFor(control);
		this.roveRowControls(control, where);
		return true;
	}

	/** Clear the menu cursor when `control` is a ref pill; a no-op for sub-chips and action buttons. */
	private clearPillCursorFor(control: HTMLElement): void {
		if (control.classList.contains('gl-graph__ref-pill')) {
			this.clearGroupedPillCursor(control);
		}
	}

	// ——— Grouped (multi-ref) pill menu: an aria-activedescendant cursor over the open popover's rows ———

	/** The `.gl-graph__ref-popover-row` menu items for a grouped pill (light-DOM children of its
	 *  `gl-popover`, present regardless of hoist / open state), or [] for a plain single pill. */
	private groupedPillRows(pill: HTMLElement): HTMLElement[] {
		const popover = pill.closest('.gl-graph__ref-popover');
		if (popover == null) return [];

		return [...popover.querySelectorAll<HTMLElement>('.gl-graph__ref-popover-row')];
	}

	/** The cursored (`is-active`) popover row of the pill in the event's path, with that pill and its rows.
	 *  Null when there's no pill or it has no menu (a plain single pill) — every `pillMenu` binding declines
	 *  then, leaving the key to `rowControl`. */
	private groupedPillCursor(event: KeyboardEvent): {
		pill: HTMLElement;
		rows: HTMLElement[];
		activeRow: HTMLElement | undefined;
	} | null {
		const pill = this.pillFor(event);
		if (pill == null) return null;

		const rows = this.groupedPillRows(pill);
		if (rows.length === 0) return null;

		return { pill: pill, rows: rows, activeRow: rows.find(r => r.classList.contains('is-active')) };
	}

	/** Up/Down move the ROW cursor. From an inline sub-chip this ENTERS the parent pill's menu: focus goes
	 *  back to the pill (the menu anchor) so the cursor tracks the focused element and Enter can activate it.
	 *  Up from the first row (or with no cursor) clears back to the pill itself. */
	private moveGroupedPillCursor(event: KeyboardEvent, dir: 1 | -1): boolean {
		const cursor = this.groupedPillCursor(event);
		if (cursor == null) return false;

		const { pill, rows, activeRow } = cursor;
		if (this.rowControlFor(event) !== pill) {
			pill.focus();
		}

		const idx = activeRow != null ? rows.indexOf(activeRow) : -1;
		this.setGroupedPillCursor(pill, rows, dir === 1 ? Math.min(rows.length - 1, idx + 1) : idx <= 0 ? -1 : idx - 1);
		return true;
	}

	/** With a row cursored, Left/Right rove ITS items (the ref, then its jump action), clamped at the ends so
	 *  the cursor never leaves the row — exiting to an adjacent pill is Up-past-top / Escape. No cursor yet →
	 *  decline, so `rowControl` roves between pills instead. */
	private roveGroupedPillRowItems(event: KeyboardEvent, dir: 1 | -1): boolean {
		const cursor = this.groupedPillCursor(event);
		if (cursor?.activeRow == null) return false;

		const { pill, rows, activeRow } = cursor;
		const items = this.groupedRowItems(activeRow);
		const curIdx = Math.max(
			0,
			items.findIndex(el => el.classList.contains('is-cursor')),
		);
		const nextIdx = curIdx + dir;
		if (nextIdx >= 0 && nextIdx < items.length) {
			this.setRowItemCursor(pill, rows, activeRow, nextIdx);
		}

		return true;
	}

	/** Activate the cursored item — the row = its ref, a sub-action = its jump. No cursor → decline, so the
	 *  pill's own primary fires (`rowControl`'s synthesized click). */
	private activateGroupedPillCursor(event: KeyboardEvent): boolean {
		const cursor = this.groupedPillCursor(event);
		if (cursor?.activeRow == null) return false;

		const items = this.groupedRowItems(cursor.activeRow);
		(items.find(el => el.classList.contains('is-cursor')) ?? cursor.activeRow).click();
		this.clearGroupedPillCursor(cursor.pill);
		return true;
	}

	/** First Escape (cursor set) clears it; a second (no cursor) declines, falling through to `rowControl`'s
	 *  retreat to the tree. */
	private clearGroupedPillCursorFor(event: KeyboardEvent): boolean {
		const cursor = this.groupedPillCursor(event);
		if (cursor?.activeRow == null) return false;

		this.clearGroupedPillCursor(cursor.pill);
		return true;
	}

	/** Items rovable within a cursored popover row, in visual order: the row itself (its primary ref) then its
	 *  interactive sub-actions (the upstream-jump button). Left/Right step through these. */
	private groupedRowItems(row: HTMLElement): HTMLElement[] {
		return [row, ...row.querySelectorAll<HTMLElement>('.gl-graph__ref-pill-upstream--jump')];
	}

	/** Row-level cursor (Up/Down): select `rows[rowIdx]` with the cursor on its FIRST item (the primary ref);
	 *  `rowIdx < 0` clears back to the anchor pill. */
	private setGroupedPillCursor(pill: HTMLElement, rows: HTMLElement[], rowIdx: number): void {
		if (rowIdx < 0) {
			this.clearGroupedPillCursor(pill);
			return;
		}

		this.setRowItemCursor(pill, rows, rows[rowIdx], 0);
	}

	/** Point the cursor at `groupedRowItems(row)[itemIdx]`: the row FILLS (`is-active`) for its whole cursored
	 *  lifetime; the focus RECT (`is-cursor`) + `aria-activedescendant` ride the specific item (row primary at
	 *  0, else a sub-action). DOM focus stays on the pill — this menu is an aria-activedescendant surface. */
	private setRowItemCursor(pill: HTMLElement, rows: HTMLElement[], row: HTMLElement, itemIdx: number): void {
		const items = this.groupedRowItems(row);
		const item = items[Math.max(0, Math.min(items.length - 1, itemIdx))];

		for (const r of rows) {
			r.classList.toggle('is-active', r === row);
		}
		const popover = pill.closest<GlPopover>('gl-popover.gl-graph__ref-popover');
		if (popover != null) {
			// The popover may be closed here — Escape's document-level hide, a popup blur, or the focus
			// trigger's show-delay still pending — so force it open (as pinRefPill does): a cursor on a
			// hidden menu reads as dead arrow keys and points aria-activedescendant at invisible content.
			popover.open = true;
			for (const el of popover.querySelectorAll('.is-cursor')) {
				el.classList.remove('is-cursor');
			}
		}
		item.classList.add('is-cursor');
		pill.setAttribute('aria-activedescendant', item.id);

		// Keyboard tooltip parity: the aria-activedescendant cursor fires no focusin (DOM focus stays on the
		// pill), so surface the cursored item's delegated tooltip (e.g. the jump's "Jump to …") explicitly.
		this.showTooltipForTarget(item);

		// Manual scrollTop, NOT `scrollIntoView`: the latter walks EVERY scroll ancestor and would nudge the
		// graph viewport / outer panels (the nested-scroll-webview pitfall). Scroll only the popover list.
		const list = row.closest<HTMLElement>('.gl-graph__ref-popover-list');
		if (list == null) return;

		const listRect = list.getBoundingClientRect();
		const rowRect = row.getBoundingClientRect();
		if (rowRect.top < listRect.top) {
			list.scrollTop -= listRect.top - rowRect.top;
		} else if (rowRect.bottom > listRect.bottom) {
			list.scrollTop += rowRect.bottom - listRect.bottom;
		}
	}

	private clearGroupedPillCursor(pill: HTMLElement): void {
		const popover = pill.closest('.gl-graph__ref-popover');
		if (popover != null) {
			for (const el of popover.querySelectorAll('.is-active, .is-cursor')) {
				el.classList.remove('is-active', 'is-cursor');
			}
		}

		pill.removeAttribute('aria-activedescendant');
		this.scheduleHideTooltip();
	}

	/** The managed row control (pill / action button) that currently holds focus, or null. Tracked by
	 *  ELEMENT (not a boolean) so the recycle corral can tell a "row unmounted → focus fell to <body>" drop
	 *  (the element is gone from the DOM) apart from focus the user moved elsewhere (element still present). */
	private _managedFocusEl: HTMLElement | null = null;

	/** Rows are keyed by sha and unmount when scrolled beyond the virtualizer overhang, with no built-in
	 *  focus restore. If a managed control had focus and its row just recycled out (its element left the DOM
	 *  and focus dropped to <body>), pull focus back to the tree so keyboard nav isn't stranded outside the
	 *  graph. Called from `onRangeChanged`. A control still in the DOM means the user moved focus off it
	 *  deliberately (a dead-zone click, another webview) — leave it, don't yank focus back. */
	private recaptureFocusIfStranded(): void {
		const el = this._managedFocusEl;
		if (el == null) return;

		// Focus moved somewhere valid (still on the control, or on to another element) — not a strand.
		if (document.activeElement !== document.body) return;

		// Deliberate blur leaves the control in the DOM; only a recycle removes it. Recapture just the latter.
		if (this.contains(el)) return;

		this._managedFocusEl = null;
		this.treeRef.value?.focus();
	}

	/** Focusable overlay elements rendered AFTER the tree inside the viewport (changes opt-in Show/Hide,
	 *  the HEAD / pinned "scroll to" pills, the horizontal scrollbar), in DOM order. Forward Tab off the
	 *  last row control lands on the first of these; this list lets Shift+Tab from it come back. */
	private trailingFocusables(): HTMLElement[] {
		const viewport = this.viewportRef.value;
		const tree = this.treeRef.value;
		if (viewport == null || tree == null) return [];

		return [...viewport.querySelectorAll<HTMLElement>('button:not([tabindex="-1"]), [tabindex="0"]')].filter(
			el =>
				!tree.contains(el) &&
				(tree.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 &&
				el.offsetParent != null,
		);
	}

	/** The active row's LAST managed control (last group's last control — actions if present, else refs). */
	private activeRowLastControl(): HTMLElement | null {
		const rowEl = this.activeRowElement();
		if (rowEl == null) return null;

		for (const group of ['actions', 'refs'] as const) {
			const controls = this.rowGroupControls(rowEl, group);
			if (controls.length > 0) return controls.at(-1) ?? null;
		}

		return null;
	}

	// ——— `pillMenu` / `rowControl` / `rows` scopes: the graph's bindings on the webview's key dispatcher ———

	private _keymapScopes: Disposable[] = [];
	private _keymapBindings: Disposable | undefined;

	/** Register the graph's scopes + bindings. Idempotent, and a no-op until `keymap` arrives (it's a
	 *  property, so it's unset on the first connect — see `willUpdate`). The scopes are selector-based, so
	 *  they resolve against whatever is rendered at dispatch time and need no render to have happened. The
	 *  `rows` guard mirrors the empty-graph bail the local handler used to do before any row key. */
	private registerKeymap(): void {
		const keymap = this.keymap;
		if (keymap == null || this._keymapScopes.length > 0) return;

		// `pillMenu` MUST be registered BEFORE `rowControl`: both selectors match the SAME
		// `.gl-graph__ref-pill` element of the composed path, and the dispatcher walks the registered scopes
		// in registration order per path element — so registration order alone decides which of the two lands
		// innermost in the chain, and the pill's menu keys have to win over roving.
		this._keymapScopes.push(
			keymap.registerScope('pillMenu', { selector: '.gl-graph__ref-pill' }),
			keymap.registerScope('rowControl', { selector: rowControlSelector }),
			keymap.registerScope('rows', { selector: '.gl-graph__tree' }, [() => this.displayRows.length > 0]),
		);
		this._keymapBindings = keymap.registerBindings([
			...this.pillMenuKeyBindings(),
			...this.rowControlKeyBindings(),
			...this.rowKeyBindings(),
		]);
		// A reconnect with the finder still open has to re-take its overlay slot — `unregisterKeymap`
		// dropped it. The other overlay surfaces (mode menu, column drag) are torn down on disconnect.
		if (this.refFindOpen) {
			this.pushRefFindOverlay();
		}
	}

	private unregisterKeymap(): void {
		this._keymapBindings?.dispose();
		this._keymapBindings = undefined;
		for (const scope of this._keymapScopes) {
			scope.dispose();
		}

		this._keymapScopes = [];
		// Leave no entry behind on the app's stack — it outlives us, and a stale entry would eat an Esc.
		this._refFindOverlay?.dispose();
		this._refFindOverlay = undefined;
	}

	/** True when the event originated on the tree container itself rather than on a control inside a row.
	 *  Guards the keys a focused row control owns (Enter/Space/Esc/Home/End/`←`/`→`): the `rowControl` scope
	 *  claims most of them, and the one it deliberately leaves to the browser — a native `<button>`'s
	 *  Enter/Space click — must not be swallowed out from under it here. */
	private isTreeTarget(event: KeyboardEvent): boolean {
		return event.composedPath()[0] === this.treeRef.value;
	}

	/** Wrap a run body so it first re-pins the row cursor onto a focused row control's row. The rows scope
	 *  is document-level, so its keys fire while a pill/action holds focus; focusing the tree runs
	 *  onFocusIn's realign (focusIndex ← first SELECTED row), which diverges from the control's row after a
	 *  Shift+Arrow range — re-pin after. */
	private repinned(run: (event: KeyboardEvent) => boolean): (event: KeyboardEvent) => boolean {
		return event => {
			const control = this.rowControlFor(event);
			if (control != null) {
				const rowIndex = this.rowIndexOf(control);
				this.treeRef.value?.focus();
				if (rowIndex != null) {
					this.focusIndex = rowIndex;
				}
			}

			return run(event);
		};
	}

	/** Select the focused row; `open` also opens it (Enter = the keyboard double-click, Space just selects
	 *  and keeps focus in the graph for continued arrow browsing). */
	private selectFocusedRow(open: boolean): boolean {
		const sha = this.displayRows[this.focusIndex]?.sha;
		if (sha != null) {
			// Keyboard selection moves the selected commit to a different row, leaving the focus-pin's ref
			// chain orphaned (rows dimmed against a stale chain). Clear it — this path never coincides with
			// pill-pinning (that goes through togglePinnedRef on a pointer click).
			if (this._pinnedRefKey != null) {
				this.clearPinnedRef();
			}
			// Optimistically reflect selection so the screen reader announces aria-selected immediately,
			// before the host round-trips the new selectedRows back.
			this.selectedShas = new Set([sha]);
			this._selectionAnchorSha = sha;
			this.requestUpdate();
			this.dispatchEvent(new CustomEvent('gl-graph-changeselection', { detail: { sha: sha, mode: 'replace' } }));
			if (open) {
				this.dispatchEvent(
					new CustomEvent('gl-graph-rowdoubleclick', {
						detail: { sha: sha, type: this.rowKindForSha(sha) },
					}),
				);
			}
		}

		return true;
	}

	/** Clear the row selection (the wrapper accepts `sha: null`). No column-drag guard: a drag pushes itself
	 *  onto the Esc overlay stack, which resolves ahead of every focus-scope binding — so this never runs. */
	private clearRowSelection(): boolean {
		// Optimistically clear locally too so the screen reader hears the deselection immediately +
		// aria-selected drops now.
		if (this.selectedShas.size > 0) {
			this.selectedShas = new Set();
			this.requestUpdate();
		}
		this.dispatchEvent(new CustomEvent('gl-graph-changeselection', { detail: { sha: null, mode: 'replace' } }));
		return true;
	}

	/** Copy the focused row. A live text selection keeps the native copy — the user selected that text to
	 *  copy it, and no row shortcut is worth silently replacing the clipboard. `graph-app` owns the actual
	 *  command dispatch; this only names the row. */
	private copyFocusedRow(): boolean {
		if (window.getSelection()?.isCollapsed === false) return false;

		const context = this.rowContextFor(this.displayRows[this.focusIndex]?.sha);
		if (context == null) return false;

		let selectionContexts: string[] | undefined;
		if (this.selectedShas.size > 1) {
			const contexts: string[] = [];
			for (const row of this.displayRows) {
				if (!this.selectedShas.has(row.sha)) continue;

				const rowContext = this.rowContextFor(row.sha);
				if (rowContext == null) continue;

				contexts.push(rowContext);
			}
			selectionContexts = contexts;
		}

		this.dispatchEvent(
			new CustomEvent('gl-graph-copy-request', {
				detail: {
					context: context,
					selectionContexts:
						selectionContexts != null && selectionContexts.length > 1 ? selectionContexts : undefined,
				},
				bubbles: true,
				composed: true,
			}),
		);

		if (selectionContexts != null && selectionContexts.length > 1) {
			this.announce(`Copied ${pluralize('commit', selectionContexts.length)}.`);
		} else {
			this.announce('Copied.');
		}
		return true;
	}

	/** The `pillMenu` scope's bindings — a grouped (multi-ref) pill's popover cursor, claimed for the pill's
	 *  WHOLE area (the pill itself AND its inline sub-chips). Every run declines for a plain single pill (no
	 *  menu rows) or, for the cursor-relative keys, with no cursor live — falling through to `rowControl`
	 *  and then `rows`. All sheet-hidden: the sheet documents this menu in prose, not per key. */
	private pillMenuKeyBindings(): KeyBindingDescriptor<GraphKeymapScope, KeyboardEvent>[] {
		return [
			{
				keys: ['ArrowDown'],
				scope: 'pillMenu',
				sheet: 'hidden',
				run: e => this.moveGroupedPillCursor(e, 1),
			},
			{
				keys: ['ArrowUp'],
				scope: 'pillMenu',
				sheet: 'hidden',
				run: e => this.moveGroupedPillCursor(e, -1),
			},
			{
				keys: ['ArrowRight'],
				scope: 'pillMenu',
				sheet: 'hidden',
				run: e => this.roveGroupedPillRowItems(e, 1),
			},
			{
				keys: ['ArrowLeft'],
				scope: 'pillMenu',
				sheet: 'hidden',
				run: e => this.roveGroupedPillRowItems(e, -1),
			},
			{
				keys: ['Enter', ' '],
				scope: 'pillMenu',
				sheet: 'hidden',
				run: e => this.activateGroupedPillCursor(e),
			},
			{
				keys: ['Escape'],
				scope: 'pillMenu',
				sheet: 'hidden',
				run: e => this.clearGroupedPillCursorFor(e),
			},
		];
	}

	/** The `rowControl` scope's bindings — the roving-toolbar keys a focused row control owns (see the
	 *  managed-focus note above `activeRowElement`). Everything else a row key binds falls through to `rows`,
	 *  whose runs re-pin the cursor onto this control's row (`repinned`). All sheet-hidden: the sheet
	 *  documents diving into a row's controls in prose. */
	private rowControlKeyBindings(): KeyBindingDescriptor<GraphKeymapScope, KeyboardEvent>[] {
		return [
			{
				keys: ['ArrowRight'],
				scope: 'rowControl',
				sheet: 'hidden',
				run: e => this.roveFromControl(e, 1),
			},
			{
				keys: ['ArrowLeft'],
				scope: 'rowControl',
				sheet: 'hidden',
				run: e => this.roveFromControl(e, -1),
			},
			{
				keys: ['Home'],
				scope: 'rowControl',
				sheet: 'hidden',
				run: e => this.roveFromControl(e, 'first'),
			},
			{
				keys: ['End'],
				scope: 'rowControl',
				sheet: 'hidden',
				run: e => this.roveFromControl(e, 'last'),
			},
			// Cross groups: refs → actions (Tab), actions → refs (Shift+Tab). No adjacent group FORWARD
			// declines, so the browser default leaves the graph (controls are tabindex=-1 → the trailing
			// overlays). No adjacent group BACKWARD retreats to the tree EXPLICITLY, because the browser's
			// Shift+Tab from a tabindex=-1 control can rove backward through its -1 siblings instead of
			// stepping out.
			{
				keys: ['Tab'],
				scope: 'rowControl',
				sheet: 'hidden',
				run: e => {
					const control = this.rowControlFor(e);
					if (control == null) return false;

					this.clearPillCursorFor(control);
					return this.moveToAdjacentGroup(control, 1);
				},
			},
			{
				keys: ['shift+Tab'],
				scope: 'rowControl',
				sheet: 'hidden',
				run: e => {
					const control = this.rowControlFor(e);
					if (control == null) return false;

					this.clearPillCursorFor(control);
					if (!this.moveToAdjacentGroup(control, -1)) {
						this.treeRef.value?.focus();
					}

					return true;
				},
			},
			// Non-button ref controls (pills + PR/issue chip anchors are <span role=button>) synthesize the
			// single click the delegation routes: a pill → togglePinnedRef + gl-graph-open-branch + select; a
			// PR/issue chip → its own open (see `onClick`). Native <button>s (row actions, the upstream-jump
			// chip whose Enter IS its jump) fire their own click on Enter/Space — decline so the browser does
			// it (the `rows` Enter/Space bindings are `isTreeTarget`-guarded, so they decline here too).
			{
				keys: ['Enter', ' '],
				scope: 'rowControl',
				sheet: 'hidden',
				run: e => {
					const control = this.rowControlFor(e);
					if (control == null || control.tagName === 'BUTTON' || this.controlGroup(control) !== 'refs') {
						return false;
					}

					this.clearPillCursorFor(control);
					control.click();
					return true;
				},
			},
			// Explicit "back out" to the tree (the nav host); Shift+Tab out of the first group does the same.
			// A grouped pill's live menu cursor eats the first Escape (`pillMenu`), so this is the second.
			{
				keys: ['Escape'],
				scope: 'rowControl',
				sheet: 'hidden',
				run: e => {
					const control = this.rowControlFor(e);
					if (control == null) return false;

					this.clearPillCursorFor(control);
					this.treeRef.value?.focus();
					return true;
				},
			},
		];
	}

	/** The `rows` scope's bindings. A `run` returning false leaves the key alone (falls through to an outer
	 *  scope, then the browser); the dispatcher prevents + stops the event on true. Prev/next pairs put the
	 *  shortcut-sheet row on the first of the pair and hide its twin, so the sheet reads one row per move. */
	private rowKeyBindings(): KeyBindingDescriptor<GraphKeymapScope, KeyboardEvent>[] {
		return [
			// Shift extends the range from the anchor on every row move (see `applyRowNavigation`), so each
			// move declares its Shift chord alongside the plain one.
			{
				keys: ['ArrowUp', 'shift+ArrowUp'],
				scope: 'rows',
				sheet: {
					group: 'navigation',
					label: 'Previous / next commit',
					order: 1,
					// A spaced `text:` divider, not a tight `sep:` — the slash here separates the arrows from
					// their vim aliases, rather than the two halves of one chord.
					keysOverride: ['ArrowUp', 'ArrowDown', 'text: / ', 'k', 'j'],
				},
				run: this.repinned(e => this.stepRow(e, -1)),
			},
			{
				keys: ['ArrowDown', 'shift+ArrowDown'],
				scope: 'rows',
				sheet: 'hidden',
				run: this.repinned(e => this.stepRow(e, 1)),
			},
			// Vim-style aliases. A single-character token matches the shifted form too, and Shift+k produces
			// `K` — so range extension stays on the arrows rather than getting a half-working second binding.
			{
				keys: ['k'],
				scope: 'rows',
				sheet: 'hidden',
				run: this.repinned(e => this.stepRow(e, -1)),
			},
			{
				keys: ['j'],
				scope: 'rows',
				sheet: 'hidden',
				run: this.repinned(e => this.stepRow(e, 1)),
			},
			{
				keys: ['ArrowLeft'],
				scope: 'rows',
				when: [e => this.isTreeTarget(e)],
				sheet: {
					group: 'folding',
					label: 'Fold / unfold the lane',
					order: 1,
					keysOverride: ['ArrowLeft', 'ArrowRight'],
				},
				run: () => this.foldFocusedLane(-1),
			},
			{
				keys: ['ArrowRight'],
				scope: 'rows',
				when: [e => this.isTreeTarget(e)],
				sheet: 'hidden',
				run: () => this.foldFocusedLane(1),
			},
			{
				keys: ['PageUp', 'shift+PageUp'],
				scope: 'rows',
				sheet: {
					group: 'navigation',
					label: 'Page up / down',
					order: 2,
					keysOverride: ['PageUp', 'PageDown'],
				},
				run: this.repinned(e => this.stepPage(e, -1)),
			},
			{
				keys: ['PageDown', 'shift+PageDown'],
				scope: 'rows',
				sheet: 'hidden',
				run: this.repinned(e => this.stepPage(e, 1)),
			},
			// Home/End belong to a focused row control (first / last control in its group), so they only
			// reach the rows from the tree itself.
			{
				keys: ['Home', 'shift+Home'],
				scope: 'rows',
				when: [e => this.isTreeTarget(e)],
				sheet: {
					group: 'navigation',
					label: 'First / last commit',
					order: 3,
					keysOverride: ['Home', 'End'],
				},
				run: e => this.stepEnd(e, -1),
			},
			{
				keys: ['End', 'shift+End'],
				scope: 'rows',
				when: [e => this.isTreeTarget(e)],
				sheet: 'hidden',
				run: e => this.stepEnd(e, 1),
			},
			// Ctrl AND Meta both walk the lineage on every platform (as they always have here), so declare
			// both rather than collapsing to `mod`.
			{
				keys: ['ctrl+ArrowUp', 'ctrl+shift+ArrowUp', 'meta+ArrowUp', 'meta+shift+ArrowUp'],
				scope: 'rows',
				sheet: {
					group: 'navigation',
					label: 'Follow the branch',
					order: 4,
					keysOverride: ['mod+ArrowUp', 'sep:/', 'ArrowDown'],
				},
				run: this.repinned(e => this.stepLineage(e, -1)),
			},
			{
				keys: ['ctrl+ArrowDown', 'ctrl+shift+ArrowDown', 'meta+ArrowDown', 'meta+shift+ArrowDown'],
				scope: 'rows',
				sheet: 'hidden',
				run: this.repinned(e => this.stepLineage(e, 1)),
			},
			// The alt-variant of stepping: the same axis as the plain arrows, jumping to where the lineage
			// BRANCHES instead of one row. Bare Alt is the documented chord — Ctrl+Alt+arrows is legacy
			// GNOME workspace switching (grabbed at the OS before the webview ever sees it), so it can't
			// be canonical; it rides along as an undocumented alias since it reads as "the alt of lineage"
			// and is unbound in VS Code on every platform.
			{
				keys: [
					'alt+ArrowUp',
					'alt+shift+ArrowUp',
					'ctrl+alt+ArrowUp',
					'ctrl+alt+shift+ArrowUp',
					'meta+alt+ArrowUp',
					'meta+alt+shift+ArrowUp',
				],
				scope: 'rows',
				sheet: {
					group: 'navigation',
					label: 'Previous / next fork',
					order: 6,
					keysOverride: ['alt+ArrowUp', 'sep:/', 'ArrowDown'],
				},
				run: this.repinned(e => this.stepForkPoint(e, -1)),
			},
			{
				keys: [
					'alt+ArrowDown',
					'alt+shift+ArrowDown',
					'ctrl+alt+ArrowDown',
					'ctrl+alt+shift+ArrowDown',
					'meta+alt+ArrowDown',
					'meta+alt+shift+ArrowDown',
				],
				scope: 'rows',
				sheet: 'hidden',
				run: this.repinned(e => this.stepForkPoint(e, 1)),
			},
			// Unlike the bare (fold) and Ctrl/Cmd (reserved) horizontal chords, the Alt and Shift ones are NOT
			// tree-only: a focused row control leaves them to the rows, since `rowControl` binds bare `←`/`→`
			// alone. `repinned` moves focus back to the tree on the control's row first.
			// Ctrl (Cmd on mac, dual-accepted like the lineage arrows — macOS grabs ctrl+arrows for Mission
			// Control before the webview ever sees them): Ctrl means "structural navigation" on both axes,
			// lineage vertically and the fork's lanes horizontally. Alt stays the alt-action layer.
			{
				keys: ['ctrl+ArrowLeft', 'meta+ArrowLeft'],
				scope: 'rows',
				sheet: {
					group: 'navigation',
					label: 'Switch branch at a fork',
					order: 5,
					keysOverride: ['mod+ArrowLeft', 'sep:/', 'ArrowRight'],
				},
				run: this.repinned(e => this.navigateForkLane(e, -1)),
			},
			{
				keys: ['ctrl+ArrowRight', 'meta+ArrowRight'],
				scope: 'rows',
				sheet: 'hidden',
				run: this.repinned(e => this.navigateForkLane(e, 1)),
			},
			{
				keys: ['shift+ArrowLeft'],
				scope: 'rows',
				sheet: {
					group: 'folding',
					label: 'Fold / unfold every lane',
					order: 2,
					keysOverride: ['shift+ArrowLeft', 'sep:/', 'ArrowRight'],
					subline: ['text:also ', 'raw:Shift', 'text:+click a fold chevron'],
				},
				run: this.repinned(() => {
					this.setAllLanesCollapsed(true);
					return true;
				}),
			},
			{
				keys: ['shift+ArrowRight'],
				scope: 'rows',
				sheet: 'hidden',
				run: this.repinned(() => {
					this.setAllLanesCollapsed(false);
					return true;
				}),
			},
			// Single-letter jumps target the primary/canonical row (same `_rowMarkerTips` source the
			// overview rail's jump legs use, so the two can never disagree); Shift variants scan loaded
			// rows outward from focus for the nearest occurrence instead.
			{
				keys: ['h'],
				scope: 'rows',
				sheet: { group: 'goto', label: 'HEAD', order: 2 },
				run: this.repinned(() => {
					if (!this.jumpToRow(this._rowMarkerTips?.headSha)) {
						this.announce('No HEAD commit resolved.');
					}

					return true;
				}),
			},
			{
				keys: ['H'],
				scope: 'rows',
				sheet: { group: 'goto', label: 'Nearest worktree branch', order: 5, keysOverride: ['shift+KeyH'] },
				run: this.repinned(() => {
					if (!this.jumpToRow(this.nearestCheckedOutHeadSha())) {
						this.announce('No checked-out worktree branch found.');
					}

					return true;
				}),
			},
			{
				keys: ['u'],
				scope: 'rows',
				sheet: { group: 'goto', label: 'Upstream', order: 3 },
				run: this.repinned(() => {
					if (!this.jumpToRow(this._rowMarkerTips?.upstreamSha)) {
						this.announce('No upstream for this branch.');
					}

					return true;
				}),
			},
			{
				keys: ['t'],
				scope: 'rows',
				sheet: { group: 'goto', label: 'Merge target', order: 4 },
				run: this.repinned(() => {
					// The merge target resolves asynchronously (scope-anchor pull), so a silent no-op here
					// would read as broken while it's still in flight — say why instead.
					if (!this.jumpToRow(this._rowMarkerTips?.targetSha)) {
						this.announce('No merge target resolved.');
					}

					return true;
				}),
			},
			{
				keys: ['w'],
				scope: 'rows',
				sheet: { group: 'goto', label: 'Your working changes', order: 1 },
				run: this.repinned(() => {
					// Resolved by the host handler (graph-wrapper's onJumpToNearestWip): `target: 'primary'`
					// routes straight to this graph's own WIP row, deferring the navigation when it isn't
					// loaded yet. No focused row (empty graph) means no jump to make — release the key, the
					// same as every other row navigation with nothing to move within.
					const fromSha = this.displayRows[this.focusIndex]?.sha;
					if (fromSha == null) return false;

					document.dispatchEvent(
						new CustomEvent('gl-jump-to-nearest-wip', {
							detail: { fromSha: fromSha, focus: true, flash: true, target: 'primary' },
						}),
					);
					return true;
				}),
			},
			{
				keys: ['W'],
				scope: 'rows',
				sheet: {
					group: 'goto',
					label: 'Working changes on this lane',
					order: 6,
					keysOverride: ['shift+KeyW'],
				},
				run: this.repinned(() => {
					const fromSha = this.displayRows[this.focusIndex]?.sha;
					if (fromSha == null) return false;

					document.dispatchEvent(
						new CustomEvent('gl-jump-to-nearest-wip', {
							detail: { fromSha: fromSha, focus: true, flash: true, target: 'nearest' },
						}),
					);
					return true;
				}),
			},
			// Bracket keys walk ref rows (head/remote/tag) — the ref-to-ref move PageUp/Down used to carry
			// under Alt.
			{
				keys: ['['],
				scope: 'rows',
				sheet: { group: 'goto', label: 'Previous / next branch or tag', order: 7, keysOverride: ['[', ']'] },
				run: this.repinned(e => this.stepRefRow(e, -1)),
			},
			{
				keys: [']'],
				scope: 'rows',
				sheet: 'hidden',
				run: this.repinned(e => this.stepRefRow(e, 1)),
			},
			{
				keys: ['Escape'],
				scope: 'rows',
				when: [e => this.isTreeTarget(e)],
				sheet: 'hidden',
				run: () => this.clearRowSelection(),
			},
			{
				keys: ['Enter'],
				scope: 'rows',
				when: [e => this.isTreeTarget(e)],
				sheet: { group: 'selection', label: 'Open details', order: 3 },
				run: () => this.selectFocusedRow(true),
			},
			{
				keys: [' '],
				scope: 'rows',
				when: [e => this.isTreeTarget(e)],
				sheet: { group: 'selection', label: 'Select only', order: 2 },
				run: () => this.selectFocusedRow(false),
			},
			// `mod+KeyI` rides along for the VS Code hover reflex (Cmd/Ctrl+I) — the code token keeps it
			// layout-independent, and the plain `i` stays the primary.
			{
				keys: ['i', 'mod+KeyI'],
				scope: 'rows',
				sheet: {
					group: 'selection',
					label: 'Peek commit info',
					order: 4,
					keysOverride: ['i', 'text: / ', 'mod+KeyI'],
					subline: ['Escape', 'text: closes'],
				},
				run: this.repinned(() => {
					this.suppressModifierChainUntilRelease();
					return this.togglePeek();
				}),
			},
			// Ctrl+Shift+C produces the key `C`, which the `c` token never matches — so the shifted form
			// stays with whatever else binds it, exactly as before.
			{
				keys: ['ctrl+c', 'meta+c'],
				scope: 'rows',
				sheet: {
					group: 'selection',
					label: 'Copy SHA / worktree path',
					order: 5,
					keysOverride: ['mod+KeyC'],
				},
				run: this.repinned(() => {
					this.suppressModifierChainUntilRelease();
					return this.copyFocusedRow();
				}),
			},
			// Reserved: Alt+←/→ deliberately do nothing here (Alt is the alt-action layer, not a nav
			// modifier), but unconsumed they'd reach VS Code's editor-history navigation — a surprising
			// teleport out of the graph — so swallow them. (Alt+↑/↓ are bound above as fork-point aliases.)
			{
				keys: ['alt+ArrowLeft', 'alt+ArrowRight'],
				scope: 'rows',
				when: [e => this.isTreeTarget(e)],
				sheet: 'hidden',
				run: () => true,
			},
		];
	}

	private handleViewportKeydown = (event: KeyboardEvent): void => {
		// Re-entry: Shift+Tab from ANY trailing overlay (the HEAD-jump / pinned pills, the changes-opt-in
		// Show/Hide buttons, the hscrollbar) returns straight to the active row's last managed control, rather
		// than stepping back through the other overlays to the tree. Row controls are `tabindex=-1`, so the
		// browser would otherwise skip them and strand focus on the tree — making the row groups one-way
		// (forward Tab reaches the overlays; Shift+Tab couldn't come back). Bubbled keydowns from the tree /
		// header / row-controls fall out here (they're never in `trailing`).
		if (event.key !== 'Tab' || !event.shiftKey || !(event.target instanceof HTMLElement)) return;

		if (!this.trailingFocusables().includes(event.target)) return;

		const last = this.activeRowLastControl();
		if (last == null) return;

		event.preventDefault();
		last.focus({ preventScroll: true });
	};

	private onKeydown = (event: KeyboardEvent): void => {
		// Only the tree container's own keys: a keydown bubbled from a focused row control is the
		// `rowControl` scope's Tab (cross groups, or leave the graph), never a dive. (The column header is a
		// preceding SIBLING of the tree, so its keys never bubble here — it has its own headerRoving toolbar.)
		if (event.target !== event.currentTarget) return;

		// Tab dives into the active row's controls (a single roving tab stop); Shift+Tab falls through so
		// focus retreats to the header (the preceding tab stops). If the active row has no controls, let
		// Tab fall through too (it leaves the graph).
		//
		// Every other row key — movement, folding, jumps, copy, Enter/Space/Escape — is registered on the
		// webview's dispatcher under the `rows` / `rowControl` / `pillMenu` scopes (see `registerKeymap`),
		// NOT bound here. This branch could be a rows binding too (run-returns-false would hand Tab back to
		// the browser); it stays local only because it gains nothing from the move and the target guard
		// above is clearer here.
		if (event.key === 'Tab' && !event.shiftKey && this.enterActiveRowGroup()) {
			event.preventDefault();
		}
	};

	/** Move focus + selection to `sha`'s row, as a single-row replace. Reaches every state the pointer's
	 *  ref-pill jump reaches: displayed, folded inside a collapsed lane, or not yet paged in. Returns false
	 *  only for an unset sha — i.e. a marker that never resolved, which is what the callers announce. */
	private jumpToRow(sha: string | undefined): boolean {
		if (sha == null) return false;

		let idx = this.indexBySha.get(sha);
		if (idx == null) {
			// Folded away inside a collapsed lane: expand it (recomputeDisplayRows runs synchronously, so
			// the row is indexed straight after) and land locally.
			const tip = this.segmentByCommit.get(sha);
			if (tip != null && this.effectiveCollapsed.has(tip)) {
				this.toggleLane(tip);
				idx = this.indexBySha.get(sha);
			}
		}

		if (idx == null) {
			// Not in the display set at all — hand it to the wrapper's load/select/reveal operation, which
			// holds the intent while the row pages in. Same route (and same detail shape) the ref pills take.
			this.jumpToRefRow(sha, { focus: true, flash: true });
			return true;
		}

		// Standing on the target already: moving nothing must not drop the user's pinned ref or re-dispatch
		// a selection that's already current (same guard plain arrow navigation applies).
		const alreadySelected = this.focusIndex === idx && this.selectedShas.size === 1 && this.selectedShas.has(sha);
		this.focusIndex = idx;
		this._selectionAnchorSha = sha;
		if (!alreadySelected) {
			// The jump moves the selected commit off the pinned pill's row, leaving its ref chain orphaned.
			if (this._pinnedRefKey != null) {
				this.clearPinnedRef();
			}
			this.selectedShas = new Set([sha]);
			this.requestUpdate();
			this.dispatchEvent(new CustomEvent('gl-graph-changeselection', { detail: { sha: sha, mode: 'replace' } }));
		}
		this.revealIndexNearest(idx);
		// A jump can land near the loaded tail just as a step can, and the reveal alone never asks for rows.
		this.requestMoreRowsForNavigation(idx);
		return true;
	}

	/** Nearest row (by index distance from `focusIndex`, ties toward the earlier direction scanned)
	 *  whose HEAD is checked out in some worktree — scans `displayRows` via the raw-row-by-sha map
	 *  (ref metadata lives on `GitGraphRow`, not the engine's `ProcessedGraphRow`), no host round-trip. */
	private nearestCheckedOutHeadSha(): string | undefined {
		const rows = this.displayRows;
		const rowBySha = this.getRowByShaMap();
		if (rowBySha == null) return undefined;

		const focus = this.focusIndex;
		const isCheckedOut = (index: number): boolean =>
			rowBySha.get(rows[index].sha)?.heads?.some(h => h.worktree != null) === true;

		for (let distance = 0; distance < rows.length; distance++) {
			const forward = focus + distance;
			if (forward < rows.length && isCheckedOut(forward)) {
				return rows[forward].sha;
			}

			if (distance === 0) continue;

			const backward = focus - distance;
			if (backward >= 0 && isCheckedOut(backward)) {
				return rows[backward].sha;
			}
		}

		return undefined;
	}

	// The fork the lateral lane walk is anchored at, plus its lanes as `collectForkLanes` returned them.
	// Kept so a SECOND Ctrl/Cmd+Arrow steps on from the lane it just landed on rather than re-deriving from
	// a row that is no longer a fork. Cleared by any other navigation (see `applyRowNavigation`).
	private _forkNavOrigin?: { sha: string; lanes: readonly { column: number; sha: string }[] };

	/** Step one lane sideways at a fork point: Ctrl/Cmd+Right toward higher columns, Ctrl/Cmd+Left lower.
	 *  Clamps at both ends — there's no visual cue for a wrap, so wrapping would just look like a jump.
	 *  Returns false (leaving the key untouched) when the focused row isn't a fork at all. */
	private navigateForkLane(event: KeyboardEvent, dir: 1 | -1): boolean {
		const focusedSha = this.displayRows[this.focusIndex]?.sha;
		if (focusedSha == null) return false;

		// Reuse the anchored fork while focus is still on one of its lanes; otherwise this row is the fork.
		let origin = this._forkNavOrigin;
		let lanes: readonly { sha: string; index: number }[] =
			origin != null ? this.resolveForkLaneRows(origin.lanes) : [];
		if (lanes.every(l => l.index !== this.focusIndex)) {
			const forkLanes = collectForkLanes(
				this.processedRows,
				this.processedIndexBySha,
				this.ensureChildrenBySha(),
				focusedSha,
			);
			if (forkLanes.length < 2) return false;

			origin = { sha: focusedSha, lanes: forkLanes };
			lanes = this.resolveForkLaneRows(forkLanes);
		}

		// Check the RESOLVED lanes, not what the walk collected: resolution drops lanes with nothing to land
		// on (unloaded, or folded inside a nested collapse), and one landable lane is no fork to walk.
		if (lanes.length < 2) return false;

		const cursor = lanes.findIndex(l => l.index === this.focusIndex);
		const target = cursor !== -1 ? lanes[cursor + dir] : undefined;
		if (target == null) {
			event.preventDefault();
			// Only a genuine clamp gets an announcement — `cursor === -1` means focus isn't on any of the
			// resolved lanes, so there's no end to be at.
			if (cursor !== -1) {
				this.announce(dir === 1 ? 'Last lane at fork point.' : 'First lane at fork point.');
			}

			return true;
		}

		const moved = this.applyRowNavigation(event, target.index);
		// After `applyRowNavigation`, which clears the anchor on every move — including this one.
		this._forkNavOrigin = origin;
		this.announce(`Lane ${cursor + dir + 1} of ${lanes.length} at fork point.`);
		return moved;
	}

	/** Map fork lanes onto the rows actually rendered, preserving `collectForkLanes`' ascending-column
	 *  order and dropping lanes with nothing to land on. A lane hidden inside a collapsed segment resolves
	 *  to that segment's chip row instead (same fallback `findBranchingPointIndex` applies). */
	private resolveForkLaneRows(lanes: readonly { sha: string }[]): readonly { sha: string; index: number }[] {
		const rows: { sha: string; index: number }[] = [];
		for (const lane of lanes) {
			const index = this.indexBySha.get(lane.sha) ?? this.mapFoldedRowIndex(lane.sha);
			if (index == null) continue;

			rows.push({ sha: lane.sha, index: index });
		}
		return rows;
	}

	/** Fold or unfold every collapsible lane in one step (Shift+Left / Shift+Right). Deliberately not
	 *  `toggleLane` in a loop: one projection pass, one event, one announcement — N of each would spam the
	 *  live region and make the host re-derive per lane. */
	private setAllLanesCollapsed(collapsed: boolean): void {
		if (!this.foldingEnabled) return;

		const scrollAnchor = this.captureLaneScrollAnchor();
		const prevFocusedSha = this.displayRows[this.focusIndex]?.sha;

		const toggle = this.projectionSession.setAllCollapsed(collapsed);
		if (toggle == null) return;

		this.applyProjectionState(toggle.state);
		this.recomputeDisplayRows(prevFocusedSha);
		this.rebuildProviders();
		this.invalidateAdornments();
		if (scrollAnchor != null) {
			this._pendingScrollAnchorTop = this.resolveLaneScrollAnchorTop(scrollAnchor);
		}
		this.requestUpdate();
		this.dispatchEvent(new CustomEvent('gl-graph-lanetoggleall', { detail: { collapsed: collapsed } }));

		this.announce(
			collapsed
				? `All lanes collapsed. ${pluralize('lane', this.segmentsByTipSha.size)} folded.`
				: 'All lanes expanded.',
		);
	}

	/** Step one row (`↑`/`↓`, and their `k`/`j` aliases). Extending a TOPOLOGICAL selection steps the
	 *  moving end along the first-parent chain instead of the display order — otherwise one step onto an
	 *  interleaved off-chain row hands `walkTopologicalRange` two unrelated endpoints and the selection
	 *  collapses to just those two rows. Matches "select next in branch" elsewhere (GitKraken Desktop). */
	private stepRow(event: KeyboardEvent, dir: 1 | -1): boolean {
		const last = this.displayRows.length - 1;
		if (last < 0) return false;

		const next = this.topologicalExtend(event)
			? this.stepChain(this.focusIndex, dir, 1)
			: dir === 1
				? Math.min(last, this.focusIndex + 1)
				: Math.max(0, this.focusIndex - 1);
		if (next == null) {
			return this.navigationDeadEnd(
				event,
				dir,
				last,
				dir === 1 ? 'No older commit in this lineage.' : 'No newer commit in this lineage.',
			);
		}

		return this.applyRowNavigation(event, next);
	}

	/** Whether a Shift-extend should follow the first-parent chain rather than display order. */
	private topologicalExtend(event: KeyboardEvent): boolean {
		return event.shiftKey && this.config?.multiSelectionMode === 'topological';
	}

	/** Walk up to `steps` first-parent lineage hops from `from` (see `findTopologicalRowIndex`), stopping
	 *  at the loaded chain's edge. Returns the last reachable index, or undefined when even one hop fails. */
	private stepChain(from: number, dir: 1 | -1, steps: number): number | undefined {
		let index: number | undefined;
		let cursor = from;
		for (let i = 0; i < steps; i++) {
			const next = this.findTopologicalRowIndex(cursor, dir);
			if (next == null) break;

			index = next;
			cursor = next;
		}
		return index;
	}

	/** Step along the first-parent lineage (Ctrl/Cmd+`↑`/`↓`). */
	private stepLineage(event: KeyboardEvent, dir: 1 | -1): boolean {
		const last = this.displayRows.length - 1;
		// A filtered row set has no lineage to walk (see `searchFiltering`) — release the key rather than
		// consume it on a walk that can only dead-end.
		if (last < 0 || this.searchFiltering) return false;

		const next = this.findTopologicalRowIndex(this.focusIndex, dir);
		if (next == null) {
			return this.navigationDeadEnd(
				event,
				dir,
				last,
				dir === 1 ? 'No older commit in this lineage.' : 'No newer commit in this lineage.',
			);
		}

		return this.applyRowNavigation(event, next);
	}

	/** Step to the previous / next branching point (Alt+`↑`/`↓`). */
	private stepForkPoint(event: KeyboardEvent, dir: 1 | -1): boolean {
		const last = this.displayRows.length - 1;
		// Branching points are a lane concept, and a filtered row set has no lanes (see `searchFiltering`).
		if (last < 0 || this.searchFiltering) return false;

		const next = this.findBranchingPointIndex(this.focusIndex, dir);
		if (next == null) {
			return this.navigationDeadEnd(event, dir, last, dir === 1 ? 'No further fork.' : 'No previous fork.');
		}

		return this.applyRowNavigation(event, next);
	}

	/** Step to the previous / next ref row — head/remote/tag (`[`/`]`). */
	private stepRefRow(event: KeyboardEvent, dir: 1 | -1): boolean {
		const last = this.displayRows.length - 1;
		if (last < 0) return false;

		const next = this.findRefRowIndex(this.focusIndex, dir);
		if (next == null) {
			return this.navigationDeadEnd(event, dir, last, dir === 1 ? 'No further ref.' : 'No previous ref.');
		}

		return this.applyRowNavigation(event, next);
	}

	/** Step a page (`PgUp`/`PgDn`). A topological Shift-extend pages ALONG THE CHAIN (a page's worth of
	 *  lineage hops) for the same reason `stepRow` does. */
	private stepPage(event: KeyboardEvent, dir: 1 | -1): boolean {
		const last = this.displayRows.length - 1;
		if (last < 0) return false;

		const next = this.topologicalExtend(event)
			? this.stepChain(this.focusIndex, dir, this.pageStep())
			: this.pageIndexFrom(this.focusIndex, dir);
		if (next == null) {
			return this.navigationDeadEnd(
				event,
				dir,
				last,
				dir === 1 ? 'No older commit in this lineage.' : 'No newer commit in this lineage.',
			);
		}

		return this.applyRowNavigation(event, next);
	}

	/** Jump to the first / last loaded row (`Home`/`End`). A topological Shift-extend walks the chain to
	 *  its loaded edge instead. */
	private stepEnd(event: KeyboardEvent, dir: 1 | -1): boolean {
		const last = this.displayRows.length - 1;
		if (last < 0) return false;

		const next = this.topologicalExtend(event)
			? this.stepChain(this.focusIndex, dir, this.displayRows.length)
			: dir === 1
				? last
				: 0;
		if (next == null) {
			return this.navigationDeadEnd(
				event,
				dir,
				last,
				dir === 1 ? 'No older commit in this lineage.' : 'No newer commit in this lineage.',
			);
		}

		return this.applyRowNavigation(event, next);
	}

	/** No further target WITHIN the loaded rows: downward is the same dead end End is stuck at, so ask for
	 *  the next page rather than silently doing nothing. The key stays consumed either way, and the live
	 *  region says WHICH of the two happened — a silent consumed keypress reads as a wedged key. */
	private navigationDeadEnd(event: KeyboardEvent, dir: 1 | -1, last: number, miss: string): boolean {
		// Redundant with the dispatcher's prevent-on-consume, but keeps the key inert on its own.
		event.preventDefault();
		// Not while filtered: the displayed rows are the search's match set, so a page of new commits adds
		// nothing to walk — the ask would just repeat on every press.
		if (dir === 1 && !this.searchFiltering && this.needsMoreRows(last)) {
			this.requestMoreRowsForNavigation(last);
			this.announce('Loading more commits…');
		} else {
			this.announce(miss);
		}

		return true;
	}

	/** Fold or unfold the focused row's lane segment (`←`/`→`) — the only keyboard path to the lane
	 *  chevrons (which are managed-focus, tabindex=-1). Returns false when the focused row isn't a segment
	 *  tip or the direction is a no-op, leaving the key untouched (WAI-ARIA tree pattern). */
	private foldFocusedLane(dir: 1 | -1): boolean {
		const sha = this.displayRows[this.focusIndex]?.sha;
		if (!this.foldingEnabled || sha == null || !this.segmentsByTipSha.has(sha)) return false;

		const collapsed = this.effectiveCollapsed.has(sha);
		if ((dir === -1 && !collapsed) || (dir === 1 && collapsed)) {
			this.toggleLane(sha);
			return true;
		}

		return false;
	}

	/** The range-selection anchor as a display index. Falls back to the focused row whenever the anchored
	 *  commit isn't displayed — never anchored, or folded/filtered/scoped away since. */
	private get selectionAnchorIndex(): number {
		const index = this._selectionAnchorSha != null ? this.indexBySha.get(this._selectionAnchorSha) : undefined;
		return index ?? this.focusIndex;
	}

	/** Commit a row move to `next`: focus + selection (Shift extends the range from the anchor), reveal, and
	 *  the paging ask. Returns true — the key is consumed either way, even when the target row is gone. */
	private applyRowNavigation(event: KeyboardEvent, next: number): boolean {
		// Any ordinary move leaves the fork the lateral lane walk was anchored at, so the next
		// Ctrl/Cmd+Arrow re-derives its lanes from wherever focus landed.
		this._forkNavOrigin = undefined;

		event.preventDefault();
		const targetSha = this.displayRows[next]?.sha;
		if (targetSha == null) return true;

		const multiEnabled = this.config?.multiSelectionMode !== false;
		if (event.shiftKey && multiEnabled) {
			// Shift+Arrow extends a range selection from the fixed anchor to the new row; the details panel
			// follows the moving end. The anchor stays put across successive Shift+Arrows.
			const anchor = this.selectionAnchorIndex;
			this._selectionAnchorSha = this.displayRows[anchor]?.sha;
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
			this._selectionAnchorSha = targetSha;
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
		this.revealIndexNearest(next);
		this.requestMoreRowsForNavigation(next);
		return true;
	}

	// Row nav has to ask for rows ITSELF — paging is otherwise only ever triggered by a range change, and End
	// (plus a clamped PageDown) lands on the last LOADED row. Parked there the reveal is a no-op (the row is
	// already visible), so no scroll, no range change, and no ask: the page never arrives until the user
	// scrolls up and back down. Shares `emitMoreRows` with the scroll trigger so a reveal that DOES scroll
	// collapses into one ask, and so a held key can't outpace the debounce.
	private requestMoreRowsForNavigation(index: number): void {
		if (this.needsMoreRows(index)) {
			this.emitMoreRows();
		}
	}

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
		this.treeRef.value?.focus({ focusVisible: false, ...options });
	}

	/** Move keyboard and `aria-activedescendant` focus to a rendered row after programmatic navigation. */
	focusRow(sha: string): boolean {
		const index = this.indexBySha.get(sha);
		if (index == null) return false;

		// Focus first: onFocusIn deliberately realigns to the current selection. The navigation
		// selection is applied in the same task, but the event can still observe the prior row.
		this.treeRef.value?.focus({ focusVisible: false });
		this.focusIndex = index;
		this._selectionAnchorSha = sha;
		return true;
	}

	private onFocusIn = (event: FocusEvent): void => {
		// Keyboard parity for the pointer tooltip path — a focused `data-tooltip` element (incl. the mode
		// picker's glyph buttons) shows the same delegated tooltip. Runs for focus ANYWHERE in the
		// viewport (header controls, row controls) — this handler is bound on the outer viewport.
		this.showTooltipForFocus(event);

		// Track WHICH managed row control (pill / action button) holds focus, so the recycle corral
		// (recaptureFocusIfStranded) can tell a row-unmount focus drop apart from a deliberate move.
		this._managedFocusEl =
			event.target instanceof HTMLElement && this.controlGroup(event.target) != null ? event.target : null;

		// The active-descendant realign below is only for focus landing on the tree container itself
		// (Tab-in / programmatic focus). Focus on the header, or on a row's managed controls, must not
		// re-derive the row focus index.
		if (event.target !== this.treeRef.value) return;

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
		if (this.treeRef.value?.matches(':focus-visible') !== true) return;

		const related = event.relatedTarget;
		if (related instanceof Node && this.contains(related)) return;

		// Ensure the active-descendant row is actually rendered (virtualized in) so the
		// `aria-activedescendant` id resolves to a real element. `revealIndexNearest` only scrolls when
		// the row is off (or, with padding, too near) screen — an already-comfortably-visible row (the
		// common arrow-key/Tab-in case) needn't enter the virtualizer's scroll-scheduling path.
		this.revealIndexNearest(idx);
	};

	// True once `lastIndex` sits within the prefetch distance of the loaded end, i.e. the next page should be
	// in flight. Reads only tracked/cached geometry, so it's safe from a keydown handler or an update.
	// Public because the wrapper re-validates a deferred ask against it: only this element knows the scope
	// projection and the live row window, so re-asking beats mirroring either into a key over there.
	//
	// The default takes the FURTHER of the rendered range and the focused row (see `furthestKnownRowIndex`),
	// because those diverge in exactly the case this has to get right: End moves focus to the last loaded row,
	// but the virtualizer's range lands asynchronously and prefetch keeps growing the row set out from under
	// it, so the range can trail the end by more than the prefetch distance while the user sits ON the end.
	// Reading the range alone there answers "no rows needed" and silently drops the deferred ask End awaits.
	needsMoreRows(lastIndex: number = this.furthestKnownRowIndex()): boolean {
		if (this.hasMore === false) return false;

		const rows = this.displayRows;
		// Past the end means the caller's index predates a row-set swap (repo change, scope, filter) — that's a
		// stale range, not a reason to page.
		if (rows.length === 0 || lastIndex >= rows.length) return false;

		// A scope re-root ends its view in a collapsed fold, so the last row is that fold's STUB, not the edge
		// of the loaded window — paging there would pull the whole repo in to grow a fold the user hasn't
		// opened, and the chevron is the affordance instead. Keyed on the last row rather than on "a
		// projection is active": once the bottom fold is expanded its last row is a real commit at a real data
		// boundary, and paging has to resume or the fold can never reach past the loaded window.
		if (this.scopeProjection?.collapsedByTipSha.has(rows.at(-1)!.sha)) return false;

		return lastIndex >= rows.length - this.prefetchDistanceRows();
	}

	// How far into the loaded rows the user has actually reached: the rendered range's end or the keyboard
	// cursor, whichever is further. Each is discarded INDEPENDENTLY when it points past the end — they go
	// stale on different schedules (a row-set shrink leaves `pendingRangeLast` behind until the virtualizer
	// re-measures, while `focusIndex` is re-pinned on the next keypress), so taking the max first would let
	// one stale value veto the other's perfectly valid answer. Both stale ⇒ -1 ⇒ nothing needed.
	private furthestKnownRowIndex(): number {
		const max = this.displayRows.length - 1;
		return Math.max(
			this.pendingRangeLast <= max ? this.pendingRangeLast : -1,
			this.focusIndex <= max ? this.focusIndex : -1,
		);
	}

	// Dispatch a "load the next page" request. The wrapper's `graphState.loading` guard (webview) and the
	// host's `_pendingRowsQuery` dedup collapse repeated calls to a single in-flight request, so firing
	// this per scroll frame or per applied page can't storm the host — at most one page loads at a time.
	private dispatchMoreRows(): void {
		// The diagnostic mark is taken by the WRAPPER once its acceptance guards pass — asking is not the
		// same as paging, and marking here would attribute a rejected ask's start time to the next page
		// that actually loads. The rendered count rides along because only this element knows it; gating
		// it on DEBUG here leaves nothing behind in a production build, where an accessor would survive.
		if (DEBUG) {
			this.dispatchEvent(
				new CustomEvent('gl-graph-morerows', { detail: { displayRows: this.displayRows.length } }),
			);
		} else {
			// Written as two complete constructions rather than a conditional argument so the production
			// build keeps the bare one-argument call instead of an `undefined` second argument.
			this.dispatchEvent(new CustomEvent('gl-graph-morerows'));
		}
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

		if (DEBUG) {
			getGraphDebugDiagnostics().markVirtualized({
				first: first,
				last: last,
				displayRows: rows.length,
			});
		}

		// A managed-focus row may have just recycled out of the window — pull focus back to the tree before
		// it strands on <body>.
		this.recaptureFocusIfStranded();

		// Streaming: prefetch the next page BEFORE the loaded end scrolls into view, so it's already in
		// flight when the user arrives (rather than hitting a loading wall). The trigger distance grows
		// with the viewport and the current scroll velocity — see `computePrefetchDistance`. (When scoped
		// but the projection is inactive — e.g. the merge-base isn't loaded yet — paging still runs so it
		// can be found.)
		if (this.needsMoreRows(last)) {
			this.emitMoreRows();
		}

		// Track the rendered range (feeds the prefetch trigger + visible-range scans). Incoming rows carry
		// final geometry from their build — the compositor translate + CSS pin position them, so there is
		// nothing to re-apply here.
		this.pendingRangeFirst = first;
		this.pendingRangeLast = last;

		// HEAD pill: show a "Jump to HEAD" affordance when the current HEAD commit is off-screen.
		this.updateHeadPillDirection();
		// Pinned-branch pill: same, for the pinned branch's row.
		this.updatePinnedPillDirection();

		// Minimap day-range — fire synchronously (cheap) so the minimap tracks scroll. Use the ACTUAL
		// visible range (scrollTop/clientHeight), NOT the virtualizer's `first`/`last` which include the
		// off-screen buffer rows — otherwise the reported day span is wider than what the user sees. Parse
		// the top/bottom rows' dates (already epoch ms — no Date alloc or parse per scroll frame).
		const scroller = this.virtualizerRef.value;
		const rh = this.rowHeight;
		const firstVisible = scroller != null && rh > 0 ? this.rowIndexAt(scroller.scrollTop) : first;
		// The bottom edge maps through the same index, but from a CEIL'd unit (the last unit the viewport
		// touches) rather than a floor'd one, so a row straddling the edge still counts as visible.
		const lastVisible =
			scroller != null && rh > 0
				? this._rowUnits.rowIndexAtUnit(
						Math.ceil((scroller.scrollTop + this.scrollerClientHeight) / rh) - 1,
						rows.length,
					)
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

		// Sticky-timeline bucket — same topmost-row date (already workdir-normalized above), O(1) bucket
		// classify, @state write only on a bucket-key change (see updateStickyTimelineBucket).
		if (!Number.isNaN(topMs)) {
			this.updateStickyTimelineBucket(topMs);
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

		const wipState = this.wipStateById;
		const knownAvatars = this.avatars;
		const primaryWipRowId = this.repoPath != null ? createWipRowId(this.repoPath) : undefined;
		const lo = Math.max(0, first);
		const hi = Math.min(rows.length - 1, last);
		const visibleWip: Record<string, true> = {};
		const missingStats: Record<string, true> = {};
		const missingAvatars: Record<string, string> = {};
		for (let i = lo; i <= hi; i++) {
			const commit = this.getCommitBySha(rows[i].sha);
			if (commit == null) continue;

			// Peer worktrees only — the graph's own WIP row is already watched by the host's primary
			// working-tree channel, which pushes its status group unasked.
			if (rows[i].kind === 'workdir' && isWipRowId(rows[i].sha) && rows[i].sha !== primaryWipRowId) {
				visibleWip[rows[i].sha] = true;
				const state = wipState?.[rows[i].sha];
				if (state != null && (state.workDirStats == null || state.workDirStatsStale === true)) {
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
		// The scroller exists only now, so this is where it joins the ResizeObserver.
		this.observeVirtualizerResize();
		this.snapVirtualizerToPixelGrid();
	}

	/** Observe the scroller as well as the host. Chrome above the row list (toolbar / search / column
	 *  header) can change height without resizing the graph itself — the flex row list absorbs it — so
	 *  observing only the host misses exactly the case the pixel snap and the `scrollerClientHeight` cache
	 *  exist to track. The scroller is created by the first render, so this is called from `firstUpdated`
	 *  and again on reconnect; `observe` on an already-observed target is a no-op. */
	private observeVirtualizerResize(): void {
		const scroller = this.virtualizerRef.value;
		if (scroller == null) return;

		this.resizeObserver?.observe(scroller);
	}

	// The chrome above the row list (toolbar + search + column header) can sum to a FRACTIONAL height, so
	// the virtualizer inherits a sub-pixel Y offset and every row — hence all graph text — renders off the
	// device-pixel grid and softens. Snap the virtualizer back onto whole pixels with a tiny compensating
	// transform (recomputed on resize). Visual only: the scroller still owns scrollTop, so scrolling and
	// the virtualizer's own measurements are unaffected.
	// Scroller box the snap was last computed for, so repeat observer deliveries at an unchanged size skip
	// the measuring read (see the ResizeObserver callback).
	private lastSnapWidth = -1;
	private lastSnapHeight = -1;
	private virtualizerSnapOffset = 0;
	private snapVirtualizerToPixelGrid(): void {
		const el = this.virtualizerRef.value;
		if (el == null) return;

		// `top` already includes our prior compensation; back it out to read the raw layout offset.
		// Snap to the DEVICE grid, not CSS integers — at a fractional DPR a CSS-integer top still lands
		// on a half device pixel (the row pitch is device-snapped in `rowHeight`, so one snapped origin
		// keeps every boundary on the grid — quantized rows are integer multiples of that pitch, so they
		// stay on it too).
		const dpr = window.devicePixelRatio || 1;
		const layoutTop = el.getBoundingClientRect().top - this.virtualizerSnapOffset;
		const offset = Math.round(layoutTop * dpr) / dpr - layoutTop;
		if (Math.abs(offset - this.virtualizerSnapOffset) < 0.01) return;

		this.virtualizerSnapOffset = offset;
		el.style.transform = offset !== 0 ? `translateY(${offset.toFixed(3)}px)` : '';
	}

	// Column layout the Changes opt-in overlay was last positioned against — see `syncChangesOptIn`.
	private lastOptInLayoutKey?: string;

	/** Position the dormant Changes opt-in overlay over its RENDERED header cell. Solved-zone arithmetic
	 *  can't see layout-owning concerns (grouped refs/graph slot, crumbs), and drift paints the overlay over
	 *  the wrong column (live-caught +126px with grouped refs), so this measures. Hidden until positioned so
	 *  it never flashes unaligned.
	 *
	 *  `offsetLeft` forces a synchronous layout, so it is gated on the solved column layout actually having
	 *  moved rather than run per update — `updated()` fires several times per keypress during arrow
	 *  navigation and none of those touch the header. The visibility check is the second half of the gate — a
	 *  re-created overlay comes back with the template's `visibility: hidden` and a fresh `cspStyleMap`
	 *  (which otherwise skips writes for unchanged values, so it never clobbers the `left` we set here),
	 *  and without that check an unchanged layout key would leave the new element permanently hidden. */
	private syncChangesOptIn(): void {
		const optin = this.changesOptInRef.value;
		if (optin == null) {
			this.lastOptInLayoutKey = undefined;
			return;
		}

		const c = this._renderCtx;
		const key = `${this.containerWidth}|${this.graphPlacement}|${c.gutterWidth}|${c.zones
			.map(z => `${z.id}:${z.width}`)
			.join(',')}`;
		if (key === this.lastOptInLayoutKey && optin.style.visibility === 'visible') return;

		const cell = this.querySelector<HTMLElement>('.gl-graph__header-cell[data-col-id="changes"]');
		if (cell == null) return;

		this.lastOptInLayoutKey = key;
		optin.style.left = `${cell.offsetLeft}px`;
		optin.style.visibility = 'visible';
	}

	protected override updated(changed: PropertyValues): void {
		super.updated(changed);
		// Re-assert the scroll position captured across a row-set change — a lane collapse/expand, or rows
		// arriving/reordering (fetch, commit, scope switch, rebase) — so the swap doesn't shift the viewport
		// (runs before flushPendingReveal — a reveal, if armed, wins and clears this anchor).
		this.applyPendingScrollAnchor();
		// Same idea for rows arriving above the viewport, but computed by row count rather than measured.
		this.applyPendingViewportTop();
		// A reveal requested before its row was loaded (host row-load round-trip) fires here once the
		// row lands in displayRows.
		this.flushPendingReveal();
		// ...and re-arms it while a find's page-in is still settling: later batches move the row's index, and
		// the flush above has already consumed itself against an earlier one.
		this.retryRefFindReveal();
		// Imperative DOM sync for the chain-lane overlay — the virtualizer element exists by now (unlike in
		// `render()`), and every path that can change `_chainLaneOverlay` (updateRenderState, called from
		// willUpdate) funnels through an update, so this catches all of them. Short-circuits internally on
		// an unchanged box set.
		this.syncChainLaneOverlay();
		// Re-position the dormant Changes opt-in overlay — self-gated on the column layout having moved, so
		// it measures on a header change rather than on every update. The virtualizer's pixel snap is the
		// other geometry reader; it rides the ResizeObserver, whose callbacks land after layout. Keep both
		// off this method: anything measuring here forces a synchronous layout on every update.
		this.syncChangesOptIn();
		// An open keyboard peek follows the row cursor (self-gated on being open — nothing to do otherwise).
		if (this._peekOpen && changed.has('focusIndex')) {
			this.schedulePeekReanchor();
		}
		if (DEBUG) {
			getGraphDebugDiagnostics().endUpdate({
				repoPath: this.repoPath,
				sourceRows: this.rows?.length ?? 0,
				processedRows: this.processedRows.length,
				displayRows: this.displayRows.length,
				transition: changed.has('rows') ? this.engineTransition.kind : undefined,
			});
		}
		// The header roving toolbar's tabindex sweep now runs via `headerRoving` (RovingTabindexController's
		// hostUpdated), so nothing to do here.
	}

	// ————— Header roving toolbar —————
	// The header (`role="toolbar"`) is ONE tab stop: exactly one control holds `tabindex="0"` (rest -1),
	// plain Arrow Left/Right roves between controls (Home/End = ends), and each control's OWN Shift+Arrow
	// does its action (labels reorder, resize handles resize); Enter/Space activate natively. Roving is the
	// shared `RovingTabindexController` (as in the sidebar/overview): each control carries a stable
	// `data-roving-key`, so the tab stop survives the header's frequent re-renders AND column reorders; the
	// controller ignores modified arrows, so Shift+Arrow still reaches the controls' reorder/resize handlers.
	private readonly headerRoving = new RovingTabindexController(this, {
		getItems: () => this.getHeaderRovingItems(),
		orientation: 'horizontal',
	});

	// Cache for `getHeaderRovingItems`, keyed on the candidate set itself (elements + their keys) rather
	// than on the header's inputs — the DOM is the thing the answer is derived from, so it can't drift the
	// way an enumerated input list would.
	private _headerRovingCache?: {
		candidates: readonly HTMLElement[];
		keys: readonly string[];
		items: { key: string; element: HTMLElement }[];
	};

	/** The header's roving controls (column labels, resize handles, filter/placement/settings buttons) in
	 *  visual (DOM) order; visible only. Keyed by the stable `data-roving-key` each render site sets. */
	private getHeaderRovingItems(): { key: string; element: HTMLElement }[] {
		const header = this.querySelector('.gl-graph__header');
		if (header == null) return [];

		// `querySelectorAll` and `dataset` are tree/attribute reads — free. The visibility filter below is
		// NOT: `offsetParent` forces a synchronous layout, and the controller calls this from `hostUpdated`
		// after EVERY host update, i.e. with `render()`'s mutations still pending. Row-level updates
		// (selection, focus, scroll) never touch the header, so that flush buys nothing on the path that
		// runs it most.
		//
		// Reuse the previous answer while the candidate set is identical. Every one of these controls is
		// conditionally RENDERED (none is hidden in place by CSS), so an unchanged element list with
		// unchanged keys means an unchanged visible list. Both halves are load-bearing: comparing elements
		// alone misses a reused node whose `data-roving-key` was rebound (a column's zone id changing),
		// and comparing keys alone misses a node swap.
		const candidates = header.querySelectorAll<HTMLElement>('[data-roving-key]');
		const cached = this._headerRovingCache;
		if (cached != null && cached.candidates.length === candidates.length) {
			let same = true;
			for (let i = 0; i < candidates.length; i++) {
				const el = candidates[i];
				if (cached.candidates[i] !== el || cached.keys[i] !== el.dataset.rovingKey) {
					same = false;
					break;
				}
			}
			if (same) return cached.items;
		}

		const elements = [...candidates];
		const items = elements
			.filter(el => el.offsetParent != null && getComputedStyle(el).visibility !== 'hidden')
			.map(el => ({ key: el.dataset.rovingKey!, element: el }));
		// Only cache when EVERY candidate is visible. A control that was in the DOM but not laid out when
		// this ran — the whole graph subtree `[hidden]` for timeline/kanban mode nulls every `offsetParent`,
		// and a control can be mid-transition — would otherwise be cached as absent and stay absent, since
		// the DOM it is keyed on never changes. That is a tab stop silently missing until something unrelated
		// re-composes the header. Recomputing instead costs a layout read on updates where the header is
		// genuinely partly hidden, which is the failure worth having: slow, not broken.
		if (items.length !== elements.length) {
			this._headerRovingCache = undefined;
			return items;
		}

		this._headerRovingCache = {
			candidates: elements,
			keys: elements.map(el => el.dataset.rovingKey!),
			items: items,
		};
		return items;
	}

	/** True when `sha` is currently rendered (present in `displayRows`); false when it's loaded but
	 *  hidden by a collapsed lane, an active search filter, or the scope projection. The wrapper's
	 *  getCommits/selectCommits read this to report the displayed-vs-hidden state search-nav needs. */
	isRowDisplayed(sha: string): boolean {
		return this.indexBySha.has(sha);
	}

	/**
	 * Why a loaded row isn't rendered — what a failed jump reports instead of going quiet. `undefined`
	 * when the row IS rendered, or when the host never loaded it (nothing here can speak to that).
	 *
	 * Only a failed jump asks, so the reachability re-walks below never run on a render.
	 */
	getRowHiddenReason(sha: string): GraphRowHiddenReason | undefined {
		if (this.isRowDisplayed(sha)) return undefined;

		const row = this.getRowByShaMap()?.get(sha);
		if (row == null) return undefined;

		if (this.scopeProjection?.dropped.has(sha) === true) return 'scope';
		if (this.searchFiltering && this._searchMatchedShas?.has(sha) !== true) return 'search-filter';
		if (row.kind === 'stash' && this.excludeTypes?.stashes === true) return 'excluded-type';
		// The ref-visibility filter runs ahead of the engine, so a row that survived into the processed
		// index was hidden further downstream — a collapsed lane, which jump callers expand instead
		// (`expandLaneFor`) rather than report.
		if (this.processedIndexBySha.has(sha)) {
			const tip = this.segmentByCommit.get(sha);
			return tip != null && this.effectiveCollapsed.has(tip) ? 'collapsed' : 'unknown';
		}

		// Re-run the filter's reachability with one more class of refs re-included each time, and name the
		// first class that brings the row back. Unreachable even from every tip means it hangs off nothing
		// the loaded rows can see.
		if (this.isReachableUnderRefVisibility(sha, 'exclude-refs', this.resolveRefVisibility({ excludeRefs: true }))) {
			return 'excluded-ref';
		}
		if (
			this.isReachableUnderRefVisibility(
				sha,
				'exclude-types',
				this.resolveRefVisibility({ excludeRefs: true, excludeTypes: true }),
			)
		) {
			return 'excluded-type';
		}
		if (this.isReachableUnderRefVisibility(sha, 'all-refs', allRefsVisible)) return 'visibility';

		return 'unknown';
	}

	// Reachability probes for `getRowHiddenReason`, keyed by which narrowing was waived. Dropped whole
	// whenever any input the row filter reads changes — the host ships a fresh object per change, so
	// identity is the invalidation signal (same compare `lastExcludeRefsForRows` & co. use).
	private _refVisibilityProbes?: {
		rows: GitGraphRow[] | undefined;
		includeOnlyRefs: GraphIncludeOnlyRefs | undefined;
		excludeRefs: GraphExcludeRefs | undefined;
		excludeTypes: GraphExcludeTypes | undefined;
		scoped: boolean;
		reachable: Map<string, ReadonlySet<Sha>>;
	};

	private isReachableUnderRefVisibility(sha: string, key: string, filter: RefVisibilityFilter | undefined): boolean {
		// Nothing narrows once this class is waived ⇒ the filter is a no-op ⇒ every loaded row survives it.
		if (filter == null) return true;

		const cached = this._refVisibilityProbes;
		let probes: Map<string, ReadonlySet<Sha>>;
		if (
			cached != null &&
			cached.rows === this.rows &&
			cached.includeOnlyRefs === this.includeOnlyRefs &&
			cached.excludeRefs === this.excludeRefs &&
			cached.excludeTypes === this.excludeTypes &&
			cached.scoped === (this.scope != null)
		) {
			probes = cached.reachable;
		} else {
			probes = new Map<string, ReadonlySet<Sha>>();
			this._refVisibilityProbes = {
				rows: this.rows,
				includeOnlyRefs: this.includeOnlyRefs,
				excludeRefs: this.excludeRefs,
				excludeTypes: this.excludeTypes,
				scoped: this.scope != null,
				reachable: probes,
			};
		}

		let reachable = probes.get(key);
		if (reachable == null) {
			const rows = this.rows ?? [];
			reachable = collectReachable(rows, this.collectVisibleRefTips(rows, filter));
			probes.set(key, reachable);
		}
		return reachable.has(sha);
	}

	// Cached sha→column map for `getColumnsBySha`, keyed on `processedRows`' array identity so a
	// caller re-querying between full re-derivations (e.g. repeated jump-to-WIP clicks) doesn't pay
	// an O(rows) rebuild each time.
	private _columnsByShaCache?: { rows: readonly ProcessedGraphRow[]; columns: Record<string, number> };

	/** Sha → lane (column) index for every processed row. Exposed because the lane a row occupies is a
	 *  layout output only this element knows; the wrapper's jump-to-nearest-WIP reads it (via
	 *  `querySelector('gl-lit-graph')`) to pick the WIP sharing the clicked commit's visual lane. */
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
	// navigateToCommit) — generic selection changes (a click, details-panel sync) never auto-
	// scroll. A reveal for a not-yet-loaded row is held and flushed when the row arrives.
	private _pendingRevealSha?: string;
	private _pendingRevealMode: GraphRevealMode = 'always';
	private _pendingRevealFlash = false;
	/** Row to flash once the reveal has actually come to rest — see {@link settleReveal}. */
	private _flashOnRevealSettled?: string;
	/** Target of the last reveal this element evaluated — the `'if-changed'` gate compares against it. Set
	 *  whether or not that reveal ended up scrolling, since "we already dealt with this row" is the question
	 *  it answers, not "we moved for this row". */
	private _lastRevealedSha?: string;

	/** The reveal whose multi-stage motion may still be in progress, keyed to the generation it was
	 *  issued under — the long-jump path has windows (awaiting `layoutComplete` between the approach
	 *  write and the final slide) where neither `_pendingRevealSha` nor an animation frame exists, so
	 *  no single piece of live state can answer "is a reveal still working toward this row". Any
	 *  newer reveal or cancel bumps `_revealGeneration`, which invalidates this record implicitly. */
	private _revealInFlight?: { sha: string; generation: number };

	/** Sha of a reveal still queued OR still travelling (animation, or a long-jump settle window). A
	 *  same-target follow-up navigation (a selection-sync trailing the host reveal it mirrors) must
	 *  not cancel a reveal it could never re-issue — its `'if-changed'` repeat no-ops against
	 *  `_lastRevealedSha`, which banks at evaluation, so the cancel would strand the viewport
	 *  mid-travel (deterministically at the approach point, for a long jump). */
	get activeRevealSha(): string | undefined {
		if (this._pendingRevealSha != null) return this._pendingRevealSha;

		const inflight = this._revealInFlight;
		return inflight != null && inflight.generation === this._revealGeneration ? inflight.sha : undefined;
	}

	/**
	 * Scroll the row for `sha` into view, deferring until the row appears if it isn't loaded yet.
	 *
	 * WHERE it lands isn't a caller's choice — {@link flushPendingReveal} owns that. `mode` says only when
	 * the rule may run: `'always'` for anything a person did, `'if-changed'` for pushes nobody asked for.
	 *
	 * `flash` is deliberately a separate axis — announcing a landing and deciding whether to move for it are
	 * different questions, and with this rule "didn't move" is the common answer.
	 */
	scrollToSha(sha: string, options?: { mode?: GraphRevealMode; flash?: boolean }): void {
		// A deliberate reveal takes precedence over a pending lane-collapse scroll anchor — and over any
		// anchor RETRY already in flight, which would otherwise land after the reveal (its `_pendingRevealSha`
		// guard reads false once the reveal has flushed) and undo it.
		this._pendingScrollAnchorTop = undefined;
		this._scrollAnchorGeneration++;
		this._pendingRevealSha = sha;
		this._pendingRevealMode = options?.mode ?? 'always';
		this._pendingRevealFlash = options?.flash === true;
		this.flushPendingReveal();
	}

	/** Cancel a queued reveal and any post-layout retry. User selection and repository changes win. */
	cancelPendingReveal(): void {
		this._pendingRevealSha = undefined;
		this._pendingRevealFlash = false;
		// Nothing is going to land, so nothing should announce a landing — and leaving this set would hand a
		// stale sha to whichever reveal settles next.
		this._flashOnRevealSettled = undefined;
		this._revealGeneration++;
		// A reveal still mid-flight is the same stale intent as one still queued — the generation bump above
		// stops the loop, this releases the frame it was holding.
		this.cancelRevealAnimation();
	}

	/**
	 * Cancel a queued/travelling reveal, but only if it is still working toward `sha`.
	 *
	 * A reveal armed for a row that can never render (hidden by a filter, dropped by the scope) otherwise
	 * retries on every render forever; the wrapper drops it here once the user has been told the jump
	 * failed. Keyed so dismissing THAT failure can't cancel a reveal some newer navigation armed.
	 */
	cancelPendingRevealFor(sha: string): void {
		if (this.activeRevealSha !== sha) return;

		this.cancelPendingReveal();
	}

	/**
	 * Whether the row at `idx` is already somewhere worth leaving it — visible, AND with at least
	 * `1 - revealComfortRatio` of a viewport of history beneath it. When this holds a reveal does nothing at
	 * all, which is the point: the cheapest scroll is the one that doesn't happen.
	 *
	 * BOTH halves are load-bearing. "Enough room below" alone is vacuously true for a row scrolled off above
	 * the viewport — the whole viewport is below it — so a target that had been left behind upward would
	 * never be revealed. The visibility half is what excludes it.
	 *
	 * Reads the same TRACKED scroll position and cached geometry `revealIndexNearest` does, so it forces no
	 * layout and cannot disagree with the decision that follows it.
	 */
	private isIndexComfortablyPlaced(idx: number): boolean {
		const viewportHeight = this.scrollerClientHeight;
		// Defensive only — `flushPendingReveal` refuses to decide anything without geometry, so this can't be
		// reached from there. With no viewport nothing can be comfortably placed in it.
		if (viewportHeight <= 0) return false;

		const rowHeight = this.rowHeightOf(idx);
		const rowTop = this.rowTop(idx);
		const scrollTop = this._viewportScrollTop;
		// Top edge at or below the fold, bottom edge inside the comfort line.
		return rowTop >= scrollTop && rowTop + rowHeight <= scrollTop + viewportHeight * revealComfortRatio;
	}

	// `scrollToIndex(idx, 'nearest')` replacement that also honors `gitlens.graph.scrollRowPadding` — rows of
	// margin kept from the viewport edge. KEYBOARD NAVIGATION ONLY now (arrow/page stepping and the focus-in
	// ensure-visible); jumps go through the reveal rule instead, which decides by trailing context rather
	// than by bare visibility. All size math comes from cached geometry (`scrollerClientHeight`/`rowHeight`)
	// and the tracked scroll offset — no layout-forcing reads at all. Padding is clamped to leave at least
	// one row of slack either side; a clamp-to-zero (tiny viewport, or the setting itself is 0 — the
	// default) leaves `padPx` at 0, where the arithmetic below reduces exactly to plain minimal scrolling.
	private revealIndexNearest(idx: number): void {
		const scroller = this.virtualizerRef.value;
		if (scroller == null) return;

		const rowHeight = this.rowHeight;
		const viewportHeight = this.scrollerClientHeight;
		const visibleRows = rowHeight > 0 ? viewportHeight / rowHeight : 0;
		const padding = Math.max(0, Math.min(this.config?.scrollRowPadding ?? 0, Math.floor(visibleRows / 2) - 1));
		const rowTop = this.rowTop(idx);
		const rowBottom = rowTop + this.rowHeightOf(idx);
		// TRACKED position, not a live `scroller.scrollTop`. This runs from the keydown handler with the
		// update's mutations still pending, so a live read forces a synchronous layout — the dominant cost
		// of this method during rapid navigation, paid whether the scroller ends up moving or not. The same
		// read is nearly free once the DOM has settled, which is why it never showed up as a forced-layout
		// hotspot at rest. `onScroll` mirrors every scroll into `_viewportScrollTop` ahead of its own
		// early-return, and each write below re-syncs it, so the tracked value is exact here.
		const scrollTop = this._viewportScrollTop;
		// Rows are a uniform `rowHeight`, so the destination is exact arithmetic and a direct `scrollTop`
		// write lands it. Deliberately NOT the virtualizer's `scrollToIndex`, which resolves through a
		// native `scrollIntoView` on the row element — a forced layout plus a walk of every scroll
		// ancestor, on a path keyboard navigation hits once per press at the viewport edge — and which
		// settles asynchronously and can land short (the same flakiness `centerRowAt` documents avoiding).
		//
		// Generation is bumped per WRITE, not on entry: both branches can decline to scroll (the row is
		// already inside the padding), and cancelling a pending anchor retry when we never moved would
		// strand the viewport where the row-set change left it.
		// Base units on purpose: the setting counts ordinary rows of margin, not the target row's own span.
		const padPx = padding * rowHeight;
		if (rowTop < scrollTop + padPx) {
			this._scrollAnchorGeneration++;
			const target = Math.max(0, rowTop - padPx);
			scroller.scrollTop = target;
			this.trackViewportTop(target);
		} else if (rowBottom > scrollTop + viewportHeight - padPx) {
			this._scrollAnchorGeneration++;
			const target = Math.max(0, rowBottom - viewportHeight + padPx);
			scroller.scrollTop = target;
			this.trackViewportTop(target);
		}
	}

	private flushPendingReveal(): void {
		const sha = this._pendingRevealSha;
		if (sha == null) return;

		const scroller = this.virtualizerRef.value;
		if (scroller == null) return;

		const idx = this.indexBySha.get(sha);
		if (idx == null) return; // not loaded/visible yet — keep pending; updated() retries on next render

		// Same keep-it-pending contract for missing GEOMETRY. `scrollerClientHeight` starts at 0 and is only
		// filled in by the ResizeObserver, so a navigation that arrives on the first render — a deep link or
		// "Show in Commit Graph" that opens the graph, where the rows can already be in hand — would other-
		// wise choose its reveal mode against a zero-height viewport AND be consumed doing it, losing the
		// positioning request for good. Bail BEFORE the clear below so `updated()` re-flushes once there's a
		// viewport to reveal into.
		if (this.scrollerClientHeight <= 0) return;

		// A push nobody asked for only acts when it names a DIFFERENT row than the last one revealed. Geometry
		// alone can't carry this: a reader who scrolls away from the selected row and then gets that same
		// selection re-pushed — a state sync, or the pending-notification replay that fires when the webview
		// becomes visible again — would be dragged back to a row they had deliberately left. Comparing
		// identity instead makes the repeat a no-op no matter where they've scrolled to.
		if (this._pendingRevealMode === 'if-changed' && sha === this._lastRevealedSha) {
			this._pendingRevealSha = undefined;
			this._pendingRevealFlash = false;
			return;
		}

		// Supersede any in-flight anchor retry before dropping the guard it checks, or it could fire after
		// this reveal has scrolled and put the viewport back where the anchor wanted it.
		this._scrollAnchorGeneration++;
		this._pendingRevealSha = undefined;
		this._lastRevealedSha = sha;
		const flash = this._pendingRevealFlash;
		this._pendingRevealFlash = false;

		// THE rule, and the only place it lives: a row with enough history already under it is left exactly
		// where it is; everything else — off screen, or crammed into the bottom third — is scrolled to the
		// landing. No caller gets a say, because no caller can know where its target currently sits.
		if (this.isIndexComfortablyPlaced(idx)) {
			// Nothing to move, so nothing to wait for. Still deferred a tick: this method also runs from
			// `updated()`, and arming drops the flash class synchronously to restart the animation, which is a
			// reactive write mid-update that Lit flags in dev.
			if (flash) {
				void this.updateComplete.then(() => this.armLandingFlash(sha));
			}
			return;
		}

		// Handed to the reveal rather than fired here, so the wash marks the ARRIVAL: the viewport may now
		// take a couple of hundred milliseconds to get there, and a flash that starts on departure smears
		// across the travel instead of saying "you landed HERE".
		this._flashOnRevealSettled = flash ? sha : undefined;
		this.revealIndexAt(idx, landingRevealRatio, true);
		// AFTER the call: `revealIndexAt` stamps the generation this reveal runs under.
		this._revealInFlight = { sha: sha, generation: this._revealGeneration };
	}

	private _revealGeneration = 0;

	/**
	 * Park the row at `idx` at `ratio` down the viewport — the single source of the positioning math, shared
	 * by every "jump to a row" affordance (reveal, scroll-marker rail, HEAD pill, pinned pill) so they can't
	 * drift apart. `ratio` is 0 for the top edge, 0.5 for centered, 1 for the bottom.
	 *
	 * The offset is `top - (clientHeight - rowHeight) * ratio`, which is VS Code's own `list.reveal`
	 * `relativeTop` formula. Note the `- rowHeight`: `top - clientHeight * ratio` would position the row's
	 * TOP EDGE at the ratio and therefore sit a fraction of a row high, and at 0.5 it centers the edge rather
	 * than the row. Clamping to 0 means an index inside the first `ratio` of the viewport lands at the top.
	 *
	 * Writes `scrollTop` directly rather than calling the virtualizer's `scrollToIndex(idx, 'center')`, which
	 * defers until it has measured the target and can settle short — or not at all — for an index far outside
	 * the rendered range (the "jump sometimes doesn't land" flakiness). Rows are a fixed `rowHeight` here, so
	 * the offset is exact arithmetic; `revealIndexNearest` already does its own scrollTop math the same way.
	 */
	private revealIndexAt(idx: number, ratio: number, animate = false): void {
		const scroller = this.virtualizerRef.value;
		if (scroller == null) return;

		// ROUNDED, and that matters: `landed === target` below treats any inequality as "the write didn't
		// take" and schedules a re-assert. A whole-pixel target round-trips through `scrollTop` exactly, so
		// the comparison answers the question it means to ask. A fractional one does not — Chrome stores
		// scroll offsets in 1/64px LayoutUnits, and a third of a viewport is not representable there, so the
		// readback would differ by a rounding crumb on most viewport heights and every landing would take the
		// retry path. (A ratio of 0.5 hid this: `.5` is exact in both float64 and 1/64ths.)
		const target = Math.round(
			Math.max(0, this.rowTop(idx) - Math.max(0, (scroller.clientHeight - this.rowHeightOf(idx)) * ratio)),
		);
		// Stamped BEFORE the write, so every reveal — including one that lands cleanly and schedules no retry
		// of its own — supersedes a retry still in flight. Stamping only on the clamped path below would leave
		// the earlier generation current, and that earlier retry would then re-assert its stale target over
		// this reveal.
		const generation = ++this._revealGeneration;
		this._scrollAnchorGeneration++;
		// Any animation still running belongs to a superseded reveal.
		this.cancelRevealAnimation();

		const from = scroller.scrollTop;
		const viewportHeight = this.scrollerClientHeight;
		if (!animate || from === target || viewportHeight <= 0 || prefersReducedMotion()) {
			scroller.scrollTop = target;
			this.settleReveal(scroller, target, generation);
			return;
		}

		// Every animated reveal ends with the SAME motion: at most `smoothRevealMaxSpan` viewports of
		// ease-out. A jump already within that range simply runs it. A longer one cuts to exactly that
		// distance out — in the direction of travel — and then runs the identical animation, so the arrival
		// is indistinguishable from a short jump's rather than being its own smaller gesture. (Earlier
		// attempts gave long jumps a *different*, shorter tail — 0.75 of a viewport, then 3 rows — and both
		// read as "jump, then slide" precisely because the tail didn't match the vocabulary.)
		const distance = Math.abs(target - from);
		const maxSpan = smoothRevealMaxSpan * viewportHeight;
		if (distance <= maxSpan) {
			this.runRevealAnimation(scroller, from, target, generation);
			return;
		}

		const approach = Math.round(from < target ? target - maxSpan : target + maxSpan);
		this._scrollAnchorGeneration++;
		scroller.scrollTop = approach;
		const landed = scroller.scrollTop;
		this.trackViewportTop(landed);

		// Let the virtualizer render where we've landed before moving again — starting the slide against an
		// unrendered range is what streamed blank rows past the first time.
		const settled = scroller.layoutComplete ?? scroller.updateComplete;
		void settled.then(() => {
			if (this._revealGeneration !== generation) return;

			const el = this.virtualizerRef.value;
			if (el == null) return;
			// Anything that moved the viewport across the settle owns it now.
			if (this._viewportScrollTop !== landed) return;

			this.runRevealAnimation(el, el.scrollTop, target, generation);
		});
	}

	/**
	 * The landing check, shared by the instant write and the tail of an animation: mirror where we actually
	 * ended up, and re-assert once if the browser refused the write.
	 *
	 * `landed` is read back rather than assumed. Mirroring it into the tracked position matters immediately:
	 * the scroller's own scroll event wouldn't do it until the next rendering opportunity, and until then
	 * `revealIndexNearest` would judge visibility from the PRE-jump offset, and a rows update landing in that
	 * window would compute its insert-above correction from it and re-park the viewport where we moved it from.
	 */
	private settleReveal(scroller: LitVirtualizer, target: number, generation: number): void {
		const landed = scroller.scrollTop;
		this.trackViewportTop(landed);

		// The motion has stopped, so this is the arrival — announce it. A reveal that gets superseded or
		// interrupted never reaches here and never flashes, which is right: nothing landed.
		const flashSha = this._flashOnRevealSettled;
		if (flashSha != null) {
			this._flashOnRevealSettled = undefined;
			void this.updateComplete.then(() => this.armLandingFlash(flashSha));
		}

		if (landed === target) return;

		// The write didn't take: a row that just paged in (displayRows GREW this same update — e.g.
		// jumpToRefRow's row-load round-trip) can sit past the child virtualizer's PRE-growth spacer height,
		// because updated() fires before that child resizes its spacer (the same race
		// `applyPendingScrollAnchor` guards against). The browser then clamps us short — reproducing the very
		// "settle short" flakiness this replaces. Re-assert once the child's own update lands.
		//
		// The generation stamped above is what a retry checks: `_pendingRevealSha` alone can't detect
		// supersession, because it is CLEARED before the write — a second reveal armed AND flushed before this
		// promise settles would leave it undefined again, and re-asserting the older target then would drag the
		// viewport backward, which is the jump this exists to prevent.
		//
		// `updateComplete` is NOT far enough: it covers the virtualizer's Lit render, but the spacer growth
		// AND the virtualizer's own post-layout scroll correction land after it — so a re-assert keyed on it
		// clamps short a second time and is then re-anchored back to where the viewport started. That is the
		// whole failure for a row paged in by a host walk: the write "succeeds", then gets corrected away, and
		// the reveal has already been consumed so nothing tries again. `layoutComplete` is the settle point.
		const settled = scroller.layoutComplete ?? scroller.updateComplete;
		void settled.then(() => {
			if (this._revealGeneration !== generation || this._pendingRevealSha != null) return;

			const el = this.virtualizerRef.value;
			if (el == null || el.scrollTop === target) return;

			// A scroll that moved since our write is the user's, not the layout's — theirs wins.
			if (this._viewportScrollTop !== landed) return;

			// End-of-content clamping is not a failed write: the browser won't scroll past the last screenful,
			// so a row in the final viewport necessarily lands lower than `ratio` asked for, and re-writing
			// achieves nothing. Checked HERE rather than by clamping `target` up front, because before this
			// point the spacer can still be PRE-growth for a row that just paged in — clamping to that stale
			// height would make the bad write look successful and cancel the very retry this exists to be.
			// Matters more at a third than at a half: the shallower offset puts more rows in that final band.
			if (el.scrollTop >= el.scrollHeight - el.clientHeight) return;

			// Same reason the initial write bumps it: this is a deliberate reveal, and a lane-collapse anchor
			// retry armed in between must not land after it and undo it.
			this._scrollAnchorGeneration++;
			el.scrollTop = target;
			this.trackViewportTop(el.scrollTop);
		});
	}

	private _revealAnimationFrame?: number;
	/** The last offset the animation wrote, AS READ BACK. Every frame compares the live `scrollTop` against
	 *  it: if they differ, something other than us moved the viewport — the user, or a layout correction —
	 *  and it owns the scroll from that point. Storing the read-back (not the value we asked for) keeps the
	 *  comparison honest when the browser clamps us at either end of the list. */
	private _revealAnimationWrite?: number;

	private cancelRevealAnimation(): void {
		if (this._revealAnimationFrame == null) return;

		cancelAnimationFrame(this._revealAnimationFrame);
		this._revealAnimationFrame = undefined;
		this._revealAnimationWrite = undefined;
	}

	/**
	 * Ease `from` → `to`, yielding to anyone else who moves the scroller.
	 *
	 * Ends by handing off to {@link settleReveal}, so the clamp-detection and re-assert are identical to the
	 * instant path; they simply run once the motion has stopped rather than against a scroll still in flight.
	 */
	private runRevealAnimation(scroller: LitVirtualizer, from: number, to: number, generation: number): void {
		const viewportHeight = this.scrollerClientHeight;
		const reach =
			viewportHeight > 0 ? Math.min(1, Math.abs(to - from) / (smoothRevealMaxSpan * viewportHeight)) : 1;
		const duration = smoothRevealMinDurationMs + (smoothRevealMaxDurationMs - smoothRevealMinDurationMs) * reach;
		const started = performance.now();
		const step = (now: number): void => {
			// A newer reveal (or a cancel) owns the viewport now.
			if (this._revealGeneration !== generation) {
				this.cancelRevealAnimation();
				return;
			}
			// Someone else moved the scroller mid-flight — theirs wins, same rule the re-assert follows.
			if (this._revealAnimationWrite != null && scroller.scrollTop !== this._revealAnimationWrite) {
				this.cancelRevealAnimation();
				return;
			}

			const t = Math.min(1, (now - started) / duration);
			// Bumped per frame, not once: an anchor retry armed part-way through must not land inside the
			// animation and drag the viewport back to where the row-set change wanted it.
			this._scrollAnchorGeneration++;
			scroller.scrollTop = Math.round(from + (to - from) * easeOutCubic(t));
			this._revealAnimationWrite = scroller.scrollTop;
			this.trackViewportTop(this._revealAnimationWrite);

			if (t >= 1) {
				this._revealAnimationFrame = undefined;
				this._revealAnimationWrite = undefined;
				this.settleReveal(scroller, to, generation);
				return;
			}

			this._revealAnimationFrame = requestAnimationFrame(step);
		};
		this._revealAnimationFrame = requestAnimationFrame(step);
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
		// Prime the tracked position from the live one. `connectedCallback` clears `wasScrolled` on every
		// (re-)connect because the scroller resets to top, but the tracked scroll position kept its
		// pre-disconnect value — harmless while `revealIndexNearest` read the DOM, a real bug now that it
		// trusts the tracked value, since the first reveal after a reconnect would judge visibility against
		// a stale offset. This read is free: it's the same one the `wasScrolled` check below already does.
		const scrollTop = scroller.scrollTop;
		this.trackViewportTop(scrollTop);
		if (scrollTop > 4) {
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
	// Set via CSSOM (CSP-safe), then re-render once because the measured width is also an input
	// to the zero-scroll column solve.
	private measureScrollbarWidth(): void {
		const scroller = this.virtualizerRef.value;
		if (scroller == null) return;

		const scrollbarWidth = scroller.offsetWidth - scroller.clientWidth;
		if (scrollbarWidth === this.lastScrollbarWidth) return;

		this.lastScrollbarWidth = scrollbarWidth;
		this.style.setProperty('--gl-graph-scrollbar-width', `${scrollbarWidth}px`);
		this.requestUpdate();
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
		// A peeked card is anchored to a real row ELEMENT, and scrolling the row cursor out of view
		// virtualizes that element away — leaving the card stranded on a detached (soon recycled) node.
		// Only a wheel/drag scroll gets here with the cursor unmoved; keyboard moves re-anchor instead.
		if (this._peekOpen && this.activeRowElement() == null) {
			this.schedulePeekReanchor();
		}

		// HEAD pill tracks the live scroll position (cheap: a Map lookup + compare; sets state only on
		// an edge-cross). Runs every scroll, BEFORE the is-scrolled threshold early-return below.
		this.updateHeadPillDirection();
		this.updatePinnedPillDirection();

		// Velocity feeds the prefetch distance — track it every scroll (before the threshold early-return,
		// which returns during sustained scroll once past 4px).
		const scrollTop = (event.target as HTMLElement).scrollTop;
		// Teleport-class jump: well past one viewport since the LAST sample (read before trackScrollVelocity
		// advances it) means the new rendered range shares nothing with the old. Engage skeleton rows only on
		// the SECOND consecutive teleport — a lone jump (scrollbar track click, a reveal) renders
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
		this.trackViewportTop(scrollTop);

		// Rows passing under a stationary cursor flip hover-driven state while scrolling — suppress row
		// transitions so those don't fire as spurious fades trailing the scroll; a short settle re-enables
		// them so genuine interaction still animates. The burst start also tears down any open hover card.
		this.markScrolling();

		if (this.config?.stickyTimeline !== false) {
			// CSSOM-only expand-while-scrolling — classList + a debounced idle-clear, no @state, so a
			// scroll burst never triggers a render on its own.
			this.stickyTimelineRef.value?.classList.add('is-scroll-active');
			this.clearStickyTimelineScrollActive();
			// Bucket must ALSO be re-derived here, not just from onRangeChanged: the virtualizer's
			// materialized range (and its rangeChanged event) stops advancing once the render buffer
			// already covers the destination, so an incremental scroll within an already-buffered range
			// would otherwise leave the bucket frozen. O(1) index math + one array access — no DOM read
			// beyond the `scrollTop` this handler already has; the @state write inside stays edge-gated
			// (bucket-key changes only), so this doesn't turn scrolling into a render-per-frame path.
			this.updateStickyTimelineBucketFromScrollTop(scrollTop);
			// The topmost row (same index) can change independently of the bucket (an adjacent row within
			// the same bucket) — re-check the yield every scroll too, reusing the same `scrollTop`.
			this.updateStickyTimelineYield(scrollTop);
		}

		const scrolled = scrollTop > 4;
		if (scrolled === this.wasScrolled) return;

		this.wasScrolled = scrolled;
		this.querySelector('.gl-graph__header')?.classList.toggle('is-scrolled', scrolled);
	};

	// Remember which display row the viewport is parked on, from a scroll event's own `scrollTop`. Cheap:
	// one divide, a binary search over the (usually empty) tall-row index, and an array read — no DOM reads.
	// The base pitch is uniform, which is what keeps the mapping exact arithmetic.
	private trackViewportTop(scrollTop: number): void {
		this._viewportScrollTop = scrollTop;

		const rowHeight = this.rowHeight;
		if (rowHeight <= 0) return;

		const rows = this.displayRows;
		const index = this.rowIndexAt(scrollTop);
		this._viewportTopIndex = index;
		this._viewportTopUnitPos = this._rowUnits.unitPosOf(index);
		this._viewportTopSha = rows[index]?.sha;
	}

	// Re-park the viewport after rows were inserted above it. A pure write — the target was computed from a
	// unit-position delta and the scroll position tracked off scroll events, so nothing here measures the DOM.
	// A deliberate reveal still wins; it owns the viewport until it has flushed.
	private applyPendingViewportTop(): void {
		const target = this._pendingViewportTop;
		if (target == null) return;

		const index = this._pendingViewportTopIndex;
		const unitPos = this._pendingViewportTopUnitPos;
		this._pendingViewportTop = undefined;
		this._pendingViewportTopIndex = undefined;
		this._pendingViewportTopUnitPos = undefined;
		// Supersede any retry still in flight, including one scheduled by a cleanly-landing application —
		// same reasoning as `applyPendingScrollAnchor`, whose generation this deliberately shares so a reveal
		// or an anchor correction and this one can't fight each other across frames.
		const generation = ++this._scrollAnchorGeneration;
		// Bailing leaves `_viewportTopIndex` where it was, so the shift this correction skipped is still
		// carried in the NEXT update's delta (or superseded outright once the reveal scrolls and re-tracks).
		if (this._pendingRevealSha != null) return;

		const scroller = this.virtualizerRef.value;
		if (scroller == null) return;

		scroller.scrollTop = target;
		if (index != null) {
			this._viewportTopIndex = index;
			this._viewportTopUnitPos = unitPos;
		}
		// Only mirror what the scroller ACTUALLY took. Rows arriving above a viewport near the old scroll
		// maximum push the target past it before the child virtualizer has grown its spacer, so the write
		// clamps short — recording the unreachable target would leave every later delta measured from a
		// position the viewport never occupied.
		this._viewportScrollTop = scroller.scrollTop;

		// Clamped short → re-assert once the child commits its new size, exactly like the anchor path. One
		// retry, re-checking the reveal guard because a jump-to-row can be armed in between.
		if (scroller.scrollTop !== target) {
			void scroller.updateComplete.then(() => {
				if (this._scrollAnchorGeneration !== generation || this._pendingRevealSha != null) return;

				const el = this.virtualizerRef.value;
				if (el != null && el.scrollTop !== target) {
					el.scrollTop = target;
					this._viewportScrollTop = el.scrollTop;
				}
			});
		}
	}

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
			// Base-unit heuristic: velocity feeds prefetch distance, where erring early is the safe direction.
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
		// Base-unit heuristic, same as the velocity it consumes — tall rows only make it prefetch earlier.
		return computePrefetchDistance(this.scrollerClientHeight, this.rowHeight, velocity);
	}

	// Resolve whether the current HEAD commit is above/below the actual VIEWPORT (or visible → no pill).
	// Uses scrollTop/clientHeight (not the virtualizer's rendered range, which includes off-screen
	// buffer rows). Only writes the @state on a CHANGE so a scroll that doesn't cross HEAD never re-renders.
	private updateHeadPillDirection(): void {
		const scroller = this.virtualizerRef.value;
		const headSha = this.effectiveHeadSha;
		let dir: 'up' | 'down' | undefined;
		if (scroller != null && headSha != null) {
			const idx = this.indexBySha.get(headSha);
			if (idx != null) {
				const top = this.rowTop(idx);
				const bottom = top + this.rowHeightOf(idx);
				const viewTop = scroller.scrollTop;
				const viewBottom = viewTop + scroller.clientHeight;
				if (bottom <= viewTop) {
					dir = 'up';
				} else if (top >= viewBottom) {
					dir = 'down';
				}
			} else if (this.headSha == null) {
				// HEAD's row isn't loaded at all (the fallback sha) — it's beyond the window's tail in the
				// date-ordered walk, so point down; the click pages it in. A DECORATED head that's merely
				// missing from the display set (ref-visibility filter) keeps the pill hidden as before.
				dir = 'down';
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
				const top = this.rowTop(idx);
				const bottom = top + this.rowHeightOf(idx);
				const viewTop = scroller.scrollTop;
				const viewBottom = viewTop + scroller.clientHeight;
				if (bottom <= viewTop) {
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

	// The HEAD row's own head ref — several local branches can share the HEAD commit, so prefer the
	// checked-out one, else the first. Its `upstreamId` locates the upstream tip row (below). Undefined
	// until the HEAD row has landed.
	private rowMarkerHeadRef(): GraphCommitRef | undefined {
		const headSha = this.headSha;
		if (headSha == null) return undefined;

		const refs = this.getCommitBySha(headSha)?.commitRefs;
		if (refs == null) return undefined;

		let head: GraphCommitRef | undefined;
		for (const ref of refs) {
			if (ref.kind !== 'head') continue;
			if (ref.current === true) return ref;

			head ??= ref;
		}
		return head;
	}

	// The merge-target tips the scroll rail marks: the current branch's resolved target (the deferred
	// row-marker pull) UNIONED with the active scope's anchors — the same two sources the row's row-marker rail
	// folds onto its single `target` flag, so the two rails can never disagree. Undefined when neither
	// exists (the common case), and the sets are 1-2 entries, so the union costs nothing worth caching.
	private mergeTargetShas(): ReadonlySet<string> | undefined {
		const sha = this.rowMarkerMergeTarget?.sha;
		const scoped = this.scopeAnchors.mergeTargetShas;
		if (sha == null) return scoped;
		if (scoped == null || scoped.size === 0) return new Set([sha]);
		if (scoped.has(sha)) return scoped;

		return new Set([...scoped, sha]);
	}

	// The ref-ordering inputs that aren't ref data, shared by the ref pills and the lane-tip ghost ref.
	// Written in `willUpdate` via `updateRefOrder`.
	private _refOrder?: RowRefOrder;

	// Rebuild the ref-ordering inputs (both pins + the current branch's upstream + the ref-find hit) ONLY
	// when one of them actually moves — the object's IDENTITY is what `createRefAdornmentProvider` keys
	// its projection cache on, so a fresh object per update would defeat it. Stays undefined while none is
	// set (nothing pinned, no upstream, no find hit), which lets `sortRowRefs` skip the pin checks outright.
	private updateRefOrder(): void {
		const pinnedRefKey = this._pinnedRefKey;
		const pinnedRefId = this.pinnedRef?.id;
		const currentUpstreamName = this.currentUpstream;
		const findHitRefKey = this._refFindHitKey;

		const order = this._refOrder;
		if (
			order?.pinnedRefKey === pinnedRefKey &&
			order?.pinnedRefId === pinnedRefId &&
			order?.currentUpstreamName === currentUpstreamName &&
			order?.findHitRefKey === findHitRefKey
		) {
			return;
		}

		this._refOrder =
			pinnedRefKey == null && pinnedRefId == null && currentUpstreamName == null && findHitRefKey == null
				? undefined
				: {
						pinnedRefKey: pinnedRefKey,
						pinnedRefId: pinnedRefId,
						currentUpstreamName: currentUpstreamName,
						findHitRefKey: findHitRefKey,
					};
	}

	// Per-render cache of the current worktree's row-marker tips (HEAD / upstream / merge-target shas +
	// target name). Written once in `updateRenderState`; read by the ref-pill role hook per pill so it
	// never recomputes.
	private _rowMarkerTips?: RowMarkerTips;

	// Per-render cache of the own-line refs host zone's SOLVED width (see `effectiveOwnLineRefCap`).
	// Written once in `updateRenderState`; read by the `getMaxInlineRefs` hook per promoted row's pill
	// resolution so it never re-solves the zone layout.
	private _ownLineRefCapWidth = 0;
	// Last RESOLVED own-line cap — the eviction tracker paired with the width write above (see the
	// comment there for why it can't ride `maxInlineRefsChanged`'s willUpdate gate).
	private _lastOwnLineRefCapRef = 1;

	// HEAD's sha for the jump/waypoint affordances: the engine's decoration-derived `headSha`, else the
	// branch payload's tip when HEAD's row hasn't paged in (decoration is per-row, so it can't resolve
	// there). Jumps off the fallback page the row in. Detached HEAD opts out: no branch to stand for.
	private get effectiveHeadSha(): string | undefined {
		return this.headSha ?? (this.currentBranch?.detached !== true ? this.currentBranch?.sha : undefined);
	}

	// Build the row-marker tips from the client's own scalars: HEAD from `this.headSha`, the upstream tip
	// from the HEAD ref's `upstreamId` via `refRowIndex` (the same walk `H`-jump uses), and the merge-target
	// from the scope-anchor pull (`rowMarkerMergeTarget`). Returns undefined when the row plays none of
	// them (nothing to mark).
	//
	// The engine's `headSha` is per-row `isCurrentHead` decoration, so it goes undefined whenever HEAD's
	// row hasn't paged in — the branch payload fills that hole with the host's authoritative tip sha, so
	// HEAD-keyed jumps (the `h` key, the WIP proxy pill) still resolve; `jumpToRow`/`navigateToCommit`
	// page an unloaded target in. Detached HEAD opts out: no branch identity to stand for.
	private computeRowMarkerTips(): RowMarkerTips | undefined {
		const headSha = this.effectiveHeadSha;
		const target = this.rowMarkerMergeTarget;

		let upstreamSha: string | undefined;
		if (headSha != null) {
			const upstreamId = this.rowMarkerHeadRef()?.upstreamId;
			upstreamSha = upstreamId != null ? this.refRowIndex.get(upstreamId)?.sha : undefined;
		}

		if (headSha == null && upstreamSha == null && target?.sha == null) return undefined;

		return { headSha: headSha, upstreamSha: upstreamSha, targetSha: target?.sha, targetName: target?.name };
	}

	// Whether the primary WIP row's row-marker pill should render, and the data it needs (HEAD refs + lane
	// color). Rendered only when HEAD has been pushed DOWN the list: suppressed when the HEAD commit row
	// sits directly below the WIP row (adjacent — HEAD is already right there). Structural (row-index)
	// checks only — no viewport math. Shared by the pill build and the sticky-timeline yield check so both
	// read the same decision.
	//
	// An UNLOADED HEAD (tips carrying the branch payload's fallback sha) still gets the pill — by
	// definition not adjacent, and the jump is exactly how the user pulls HEAD into the loaded set. Its
	// refs are synthesized from the branch payload (the real ref decoration lives on the unloaded row),
	// and its lane comes from the engine's reservation for the WIP row's unloaded parent, matching the
	// dangling stub the row draws.
	private wipRowMarkerPillTarget(
		tips: RowMarkerTips | undefined,
	): { headRefs: readonly GraphCommitRef[]; column: number } | undefined {
		const headSha = tips?.headSha;
		if (headSha == null) return undefined;

		if (this.repoPath == null) return undefined;

		const wipIdx = this.processedIndexBySha.get(createWipRowId(this.repoPath));
		if (wipIdx == null) return undefined;

		const headIdx = this.processedIndexBySha.get(headSha);
		if (headIdx === wipIdx + 1) return undefined;

		if (headIdx != null) {
			const headRefs = this.getCommitBySha(headSha)?.commitRefs;
			if (headRefs == null || headRefs.length === 0) return undefined;

			return { headRefs: headRefs, column: this.processedRows[headIdx]?.column ?? 0 };
		}

		const branch = this.currentBranch;
		if (branch == null || branch.detached === true || branch.sha !== headSha) return undefined;

		const syntheticRef: GraphCommitRef = {
			kind: 'head',
			name: branch.name,
			current: true,
			upstreamName: branch.upstream?.missing !== true ? branch.upstream?.name : undefined,
		};
		return { headRefs: [syntheticRef], column: this.unloadedColumns.get(headSha) ?? 0 };
	}

	// The primary WIP row's row-marker pill: the CURRENT branch's ref pill (sourced from the HEAD row's
	// refs), role-forced to HEAD (so it carries the green emphasis + the merge-target segment) and reused
	// verbatim from `renderRefPill` — one pill language everywhere. `muted` softens the inversion so it
	// reads as secondary to the real HEAD-row pill; `jumpSha` makes a click JUMP to the HEAD tip (scroll +
	// select) without pinning — the WIP row is far from HEAD, so the pill is a navigation aid. `iconsOnly`
	// keeps it icon-only with no hover-expand — the name lives in the tooltip only.
	private buildWipRowMarkerPill(tips: RowMarkerTips | undefined): TemplateResult | undefined {
		const target = this.wipRowMarkerPillTarget(tips);
		if (target == null) return undefined;

		// ONLY the checked-out branch's ref — not every ref on the HEAD commit. Two reasons: this pill stands
		// for "the branch your working changes sit on", so a co-located tag or second branch isn't what it
		// means; and a multi-ref pill renders a `<gl-popover>` whose content is a SIBLING of the pill (not a
		// descendant), so `data-jump-sha` isn't in a popover click's `composedPath` — such a click would fall
		// through to the pin path and open a branch sheet keyed to the WIP row's synthetic sha, breaking this
		// pill's jump-only contract. One ref ⇒ bare pill, no popover, no such path.
		const currentHead = target.headRefs.find(r => r.kind === 'head' && r.current === true);
		const parsed = toParsedRefs(currentHead != null ? [currentHead] : target.headRefs, this._refOrder);
		// The upstream segment NAMES the remote here rather than counting the divergence (see
		// `RefPillRowMarker.upstream`). The name rides on the head ref itself, so the segment never waits on
		// paging; the remote ref — the only source of the provider glyph — is looked up when its row is loaded.
		const primary = parsed[0];
		const upstreamSha = primary.upstreamId != null ? this.refRowIndex.get(primary.upstreamId)?.sha : undefined;
		const upstreamRef =
			upstreamSha != null
				? this.getCommitBySha(upstreamSha)?.commitRefs.find(r => r.id === primary.upstreamId)
				: undefined;

		return renderRefPill(
			parsed,
			colorForColumn(target.column),
			// `wipRowMarkerPillTarget` returned a target, so `repoPath` is set.
			createWipRowId(this.repoPath!),
			this.refPillHooks,
			{
				role: 'head',
				expandAnchor: 'right',
				muted: true,
				suppressPinControl: true,
				iconsOnly: true,
				jumpSha: tips?.headSha,
				upstream:
					primary.upstreamName != null
						? {
								name: primary.upstreamName,
								hostingServiceType: upstreamRef?.hostingServiceType,
								jumpSha: upstreamSha,
							}
						: undefined,
			},
		);
	}

	// `gitlens.graph.stickyTimeline` OFF → clear (hides the pill/hairlines). Otherwise reclassifies
	// `topMs` (the topmost visible row's workdir-normalized date) and writes @state ONLY when the
	// group's KEY actually changes — mirrors `updateHeadPillDirection`'s edge-crossing gate. The window
	// cache (`stickyTimelineWindow`) short-circuits BEFORE that: while `topMs` (any row's date) stays
	// within the last classified group's elapsed bounds, there's nothing to reclassify — pure numeric
	// check, no `stickyTimelineGroupFor`/`fromNowUnit` call (and hence no allocation) at all.
	private updateStickyTimelineBucket(topMs: number): void {
		if (this.config?.stickyTimeline === false) {
			if (this.stickyTimeline != null) {
				this.stickyTimeline = undefined;
				this.stickyTimelineWindow = undefined;
			}
			return;
		}

		const win = this.stickyTimelineWindow;
		const elapsed = this.nowMs - topMs;
		if (win != null && elapsed >= win.lo && elapsed < win.hi) return;

		const group = stickyTimelineGroupFor(topMs, this.nowMs);
		// A year group's `hi` is deliberately undefined on the GROUP (stickyTimelineSpanFor reads that as
		// "open-ended" for the "before <date>" display) — but the WINDOW still needs a real reclassification
		// bound, or it'd cache as valid forever and never notice elapsed crossing into year:(n+1). Derive it
		// the same way fromNowUnit would classify the NEXT year boundary: elapsed is >=0 here (a year group
		// only classifies past dates — the future-date guard in stickyTimelineGroupFor redirects anything
		// newer to 'today' first), so this can't disagree with what re-running fromNowUnit would say.
		const year = unitDivisorMs('year');
		const hi = group.hi ?? (Math.trunc(elapsed / year) + 1) * year;
		this.stickyTimelineWindow = { key: group.key, lo: group.lo, hi: hi };
		if (group.key === this.stickyTimeline?.key) return;

		this.stickyTimeline = { key: group.key, label: group.label, span: this.stickyTimelineSpanFor(group) };
	}

	// Derives the topmost-row index (via the shared `rowIndexAt`, the same helper onRangeChanged's minimap-day
	// read uses), then updates the bucket through the shared, edge-gated
	// `updateStickyTimelineBucket`. Shared by `onScroll` (the scroll hot
	// path — `updateHeadPillDirection`-style: cheap index math + one array access, no DOM read beyond
	// the `scrollTop` the caller already has) and `recomputeStickyTimelineBucket` (a live `scrollTop`
	// read, fine there — not the hot path).
	private updateStickyTimelineBucketFromScrollTop(scrollTop: number): void {
		const rows = this.displayRows;
		const rh = this.rowHeight;
		if (rows.length === 0 || rh <= 0) return;

		const idx = this.rowIndexAt(scrollTop);
		const row = rows[idx];
		// A workdir (WIP) row's OWN date is a synthetic stamp — resolve through its EXACT anchor
		// (parents[0], mirroring the wrapper's dateForMinimapRow) when it's loaded; the positional
		// nearestNonWorkdirDate walk is only a fallback for the rare case the anchor hasn't paged in yet.
		const anchorSha = row?.kind === 'workdir' ? row.parents[0] : undefined;
		const anchorIdx = anchorSha != null ? this.indexBySha.get(anchorSha) : undefined;
		const anchorDate = anchorIdx != null ? rows[anchorIdx]?.date : undefined;
		const dateMs = anchorDate ?? nearestNonWorkdirDate(rows, idx, rows.length - 1) ?? NaN;
		if (!Number.isNaN(dateMs)) {
			this.updateStickyTimelineBucket(dateMs);
		}
	}

	// Re-derives the bucket from the CURRENT scroll position outside a range-change/scroll event — used
	// when `stickyTimeline` flips on live (see willUpdate) so the pill appears immediately instead of
	// waiting for the next scroll. A live scrollTop read is fine here (a deliberate, infrequent
	// config-driven call, not the scroll hot path) — same allowance already used by the reveal helpers.
	private recomputeStickyTimelineBucket(): void {
		const scroller = this.virtualizerRef.value;
		if (scroller == null) return;

		this.updateStickyTimelineBucketFromScrollTop(scroller.scrollTop);
	}

	// Yields the pill to the row it's covering: fades it out AND makes it pointer-transparent (CSS
	// `.is-yielding`, wins over the expand states — see graph.scss) whenever the TOPMOST visible row —
	// the same index the bucket uses — needs its own top-right corner: it's selected, keyboard-focused,
	// hovered, or renders PERSISTENT action buttons (the WIP-row case — at scroll-top the pill stays
	// hidden entirely; it reappears once scrolling puts a normal, non-persistent-actions row on top).
	// Hover reads `pointerRowSha` (NOT `hoveredRowSha`, which the rich-hover card clears when the pointer
	// moves onto a row's `data-tooltip` action buttons — the pill rides right over those, so it must keep
	// yielding while they're hovered). Both are plain fields (hover never triggers a Lit render), which is
	// exactly why this is CSSOM — an @state-driven equivalent would re-render rows on every hover in/out.
	// No flicker loop: once yielded via hover, the pointer sits over the (now pointer-transparent) pill's
	// old spot, which hits the row/buttons underneath — the row stays hovered, so it stays yielded until
	// the pointer actually leaves the row. O(1): index math + a few Set/Map lookups + one classList.toggle;
	// `scrollTop` defaults to the last scroll position `onScroll` recorded (`_lastScrollTop`) — a plain
	// field read, no DOM access — for the rare caller outside the scroll hot path; `onScroll` itself
	// passes the value it already has.
	private updateStickyTimelineYield(scrollTop: number = this._lastScrollTop): void {
		const el = this.stickyTimelineRef.value;
		if (el == null) return;

		const rows = this.displayRows;
		const rh = this.rowHeight;
		if (rows.length === 0 || rh <= 0) {
			el.classList.remove('is-yielding');
			return;
		}

		const idx = this.rowIndexAt(scrollTop);
		const row = rows[idx];
		const yielding =
			row != null &&
			(this.selectedShas.has(row.sha) ||
				idx === this.focusIndex ||
				row.sha === this.pointerRowSha ||
				this.topRowHasPersistentActions(row));
		el.classList.toggle('is-yielding', yielding);
	}

	// The same `--has-persistent` decision `renderRowActions` makes (see `hasPersistentRowActions`),
	// re-derived for an arbitrary row OUTSIDE the render loop — a WIP row's agent/operation status and a
	// commit row's unpushed/unpulled state live in plain fields/the payload plane, not just the per-render
	// RenderCtx.
	private topRowHasPersistentActions(row: ProcessedGraphRow): boolean {
		const wipAgent = row.kind === 'workdir' ? this.agentStatusByRowSha?.get(row.sha) : undefined;
		const wipOperation = row.kind === 'workdir' ? this.runningOperationByRowSha?.get(row.sha) : undefined;
		// One payload lookup for both tracking flags — this runs on the SCROLL path.
		const commit = row.kind === 'workdir' ? undefined : this.getCommitBySha(row.sha);
		// The primary WIP row's row-marker pill keeps the strip live at rest, and it rides exactly where the
		// sticky-timeline pill sits — so the timeline must yield to it like any other persistent member. Same
		// "will the pill render" decision the render loop makes (`wipRowMarkerPillTarget`).
		// Reuses the per-render tips cache (this runs on the SCROLL path — recomputing would allocate and
		// re-walk `refRowIndex` every frame the WIP row is topmost).
		const hasRowMarkerDecorator =
			isPrimaryWipRow(row.kind, row.sha, this.repoPath) &&
			this.wipRowMarkerPillTarget(this._rowMarkerTips) != null;
		return hasPersistentRowActions(
			row.kind,
			wipAgent,
			wipOperation,
			commit?.isUnpublished,
			commit?.isUnpulled,
			hasRowMarkerDecorator,
		);
	}

	// Exact date span for a group's elapsed window [lo, hi) — short month + day, en dash between; the
	// second date drops its month when it's the same as the first's (a same-month range like
	// "Jul 13 – 19" reads more naturally than repeating "Jul"). `hi` undefined (year groups) → a single
	// "before <date>" (no upper bound to show). `hi` exclusive → +1 day so the boundary date itself
	// isn't double-counted; a exactly-1-day-wide window (today/yesterday) collapses to a single date.
	private stickyTimelineSpanFor(group: StickyTimelineGroup): string {
		if (group.hi == null) {
			return `before ${formatGitLensDate(this.nowMs - group.lo, 'MMM D')}`;
		}

		const endMs = this.nowMs - group.lo;
		const startMs = this.nowMs - group.hi + unitDivisorMs('day');
		if (startMs >= endMs) return formatGitLensDate(endMs, 'MMM D');

		return this.formatDaySpan(startMs, endMs);
	}

	private formatDaySpan(fromMs: number, toMs: number): string {
		const from = new Date(fromMs);
		const to = new Date(toMs);
		const sameMonth = from.getFullYear() === to.getFullYear() && from.getMonth() === to.getMonth();
		return `${formatGitLensDate(from, 'MMM D')} – ${formatGitLensDate(to, sameMonth ? 'D' : 'MMM D')}`;
	}

	private onHeadPillClick = (e: MouseEvent): void => {
		// Jump-button convention (see `onClick`): stop the bubble so the delegated click handler's
		// `cancelPendingReveal` can't tear down the reveal this very click queues/starts.
		e.stopPropagation();
		const headSha = this.effectiveHeadSha;
		if (headSha == null) return;

		// Routed through the wrapper-owned jump (load → select → reveal) rather than driving `revealIndexAt`
		// from here, and that is load-bearing rather than tidiness: ARMING the reveal is what sets
		// `_pendingRevealSha`, the one flag `applyPendingScrollAnchor` / `applyPendingViewportTop` check
		// before re-parking the viewport — and both run from `updated()` ahead of the flush. Scrolling
		// directly left that guard unset, so the update driven by this jump's own selection captured an
		// anchor and dragged the view straight back off HEAD. Bumping `_scrollAnchorGeneration` (which
		// `revealIndexAt` does) can't cover it: that supersedes retries already in flight, not an anchor
		// captured after the reveal starts. Folding the loaded and not-yet-paged-in cases into one call is
		// the secondary win — the unloaded branch already took exactly this path.
		this.jumpToRefRow(headSha, { focus: true, flash: true });
	};

	private onPinnedPillClick = (e: MouseEvent): void => {
		// Same jump-button convention as `onHeadPillClick` — the bubble would cancel the reveal mid-flight.
		e.stopPropagation();
		const pinnedSha = this.pinnedSha;
		if (pinnedSha == null) return;

		// Same wrapper-owned jump as the HEAD waypoint, for the same reason (see there). It also gains that
		// waypoint's paging behavior: a pinned row that isn't loaded now pages in instead of no-op'ing.
		this.jumpToRefRow(pinnedSha, { focus: true, flash: true });
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
		return html`<div
			class="gl-graph__header"
			role="toolbar"
			aria-label="Graph columns"
			@keydown=${this.headerRoving.onKeydown}
			@focusin=${this.headerRoving.onFocusin}
		>
			${
				gutterWidth > 0 && this.graphVisibleSlot === 0
					? this.renderGraphHeaderCell(gutterWidth, graphIsLastColumn)
					: nothing
			}
			${visibleZones.map((zone, i) => {
				const isLast = i === visibleZones.length - 1;
				// The trailing HEADER cell yields its tail to the pinned gear — header-only: the BODY column
				// keeps its full solved width to the scrollbar (no dead body gutter), and no divider marks the
				// last cell's right edge, so the header being narrower there is invisible.
				const isTrailingCell = isLast && !graphIsLastColumn;
				const headerW = isTrailingCell ? Math.max(0, zone.width - this.headerActionsPx) : zone.width;
				// Same zero-scroll rule as the body cells (zoneStyle): fill may shrink but not grow, others
				// rigid at the solved width — so the header columns line up exactly with the rows below.
				const w = `${headerW}px`;
				const minW = isTrailingCell ? '0px' : `${zone.minWidth}px`;
				const style = zone.flex
					? { flex: `0 1 ${w}`, minWidth: minW }
					: { flex: `0 0 ${w}`, width: w, minWidth: minW };
				// Reserve room for any controls in this cell, then swap the text label for its icon when
				// the remaining width can't fit it (legacy narrow-column behavior). The flex zone never
				// narrows (it grows), so it always keeps its text.
				// The graph's group toggle rides its grouped HOST zone (by id, where the lanes render) so it
				// isn't stranded on the first column; when the graph is hidden (no host) it sits at the front.
				const graphControlHere =
					gutterWidth === 0 && (this.graphPlacement === 'grouped' ? zone.id === graphHostId : i === 0);
				const hasRefsControl = (zone.id === 'ref' && this.refsPlacement === 'column') || zone.id === refsHostId;
				// This column offers a header filter (host `isFilterable`), and whether that filter is currently
				// active (its search operator is in the query — see `activeFilterColumns`). Active persistently
				// shows the button and reserves its unit in the fit math below; hover/focus reveal is CSS-only
				// and never reaches this math.
				const filterable = this.columns?.[zone.id]?.isFilterable === true;
				const filterActive = filterable && (this.activeFilterColumns?.has(zone.id) ?? false);
				const refsMember = zone.id === refsHostId;
				// The refs crumb carries the refs FILTER button too — grouped refs have no ref header cell,
				// so the crumb is that filter's only home (routes to pickRefs like the column's own button).
				const refsCrumbZone = refsMember ? this.zones.find(z => z.id === 'ref') : undefined;
				const refsCrumbFilterable = refsCrumbZone != null && this.columns?.ref?.isFilterable === true;
				const refsCrumbFilterActive = refsCrumbFilterable && (this.activeFilterColumns?.has('ref') ?? false);
				// Grouped only — when the graph is HIDDEN the same control renders here as a bare restore
				// toggle, and a crumb would falsely read as "grouped into this column".
				const graphCrumb = graphControlHere && this.graphPlacement === 'grouped';
				// Crumbs are fixed-size chips: full = column icon + map toggle in ONE button + chevron
				// (~55px); collapsed = the bare map chip (~22px), no identity icon, no chevron. Both crumbs
				// collapse together when the fulls (plus filters + the host label's reserve) can't fit —
				// deterministic math, so the cell content can never spill into the neighboring header.
				const crumbCount = (graphCrumb ? 1 : 0) + (refsMember ? 1 : 0);
				const filtersPx = (filterActive ? 22 : 0) + (refsCrumbFilterActive ? 22 : 0);
				const hostLabelReservePx = Math.min(zone.label.length * 7, 70) + 16;
				// The find button rides wherever the refs controls do, and is ALWAYS visible (unlike the
				// hover-revealed filter), so unlike that button it has to be reserved here — including
				// before the crumb stage is decided, or full crumbs would claim width it needs.
				const refFindReservePx = hasRefsControl ? 22 : 0;
				const crumbsCollapsed =
					crumbCount > 0 && headerW - filtersPx - refFindReservePx - hostLabelReservePx < crumbCount * 55;
				const crumbsPx = crumbCount * (crumbsCollapsed ? 22 : 55);
				// At icon stage the Changes header drops its text label and shows the compact mode-picker button
				// instead (the full-size column icon + a clippable chevron) — see the render branch below.
				const changesIconStage = zone.id === 'changes' && changesStageForWidth(zone.width) === 'icon';
				// Fixed reserve per control (22 each): a hidden-graph restore toggle, the ungrouped ref
				// column's right-edge toggle, ACTIVE filter buttons — plus the crumbs at their stage size.
				// Changes' mode chevron renders inside the label (19px ≈ 1.2rem icon + 0.3rem gap + slack,
				// graph.scss) — reserve its label-adjacent width so the text never crowds it out. At icon stage
				// the label is gone (just the compact picker button), so that reserve would over-count.
				const baseControlsPx =
					(graphControlHere && !graphCrumb ? 22 : 0) +
					(hasRefsControl && !refsMember ? 22 : 0) +
					(zone.id === 'changes' && !changesIconStage ? 19 : 0) +
					filtersPx +
					crumbsPx;
				// Find button floor: it only earns its fixed unit while the cell can still afford an
				// identity glyph beside it (22 + 22). Below that it drops out rather than crowding the
				// column down to bare chrome — `/` is still the way in, so nothing becomes unreachable.
				const refFindHere = hasRefsControl && headerW - baseControlsPx >= 44;
				const controlsPx = baseControlsPx + (refFindHere ? 22 : 0);
				const labelAsIcon = !zone.flex && !headerLabelFits(zone.label, headerW - controlsPx);
				// Floor degradation: an active filter on an ultra-narrow icon-only column can't fit both the
				// filter button and the column icon — render ONLY the filter button (never a clipped half icon).
				const filterOnly = filterActive && labelAsIcon && headerW - controlsPx < 46;
				// While the host resolves diffstats, a Changes header collapsed to its glyph spins THAT glyph
				// instead of the pinned inline-end spinner: at these widths the pinned one can't clear the
				// leading content, so it was suppressed outright (see renderChangesLoading). Filter-only is
				// excluded — it has no identity glyph, only the filter button and the picker chevron.
				const changesGlyphLoading =
					zone.id === 'changes' &&
					this.rowsStatsLoading &&
					(changesIconStage || (labelAsIcon && !filterOnly));
				// Double-click fits the column the splitter precedes (the NEXT zone) — except when that's the
				// elastic fill (no fixed width), where it fits THIS zone instead (see onResizeAutosize). Name
				// the real target so the tooltip doesn't lie.
				const fitTargetLabel = (visibleZones[i + 1]?.flex ? zone.label : visibleZones[i + 1]?.label) ?? 'next';
				// Dormant tint on the Changes header while its stats are opt-in (consent not yet requested/given).
				const changesDormant =
					zone.id === 'changes' && this.changesColumnEnabled === false && !this._changesEnableRequested;
				return html`<div
						class="gl-graph__header-cell${this.dragColId === zone.id ? ' is-dragging' : ''}${
							changesDormant ? ' gl-graph__header-cell--changes-dormant' : ''
						}"
						data-col-id=${zone.id}
						data-vscode-context=${this.columnsContext ?? nothing}
						style=${cspStyleMap(style)}
						@pointerdown=${(e: PointerEvent) => this.onColumnPointerDown(e, zone.id)}
					>
						<span class="gl-graph__header-cell-content">
							${
								graphControlHere
									? html`<span class="gl-graph__group-member">
											${this.renderPlacementControl(
												false,
												graphCrumb && !crumbsCollapsed ? 'gl-graph' : undefined,
											)}
											${
												graphCrumb && !crumbsCollapsed
													? html`<code-icon
															class="gl-graph__group-member-chevron"
															icon="chevron-right"
														></code-icon>`
													: nothing
											}
										</span>`
									: nothing
							}
							${
								refsMember
									? html`<span class="gl-graph__group-member">
											${
												refsCrumbFilterable
													? this.renderFilterButton(
															refsCrumbZone,
															refsCrumbFilterActive,
															false,
															true,
														)
													: nothing
											}
											${this.renderRefsPlacementControl(
												false,
												visibleZones,
												crumbsCollapsed ? undefined : zoneHeaderIcons.ref,
											)}
											${refFindHere ? this.renderRefFindButton() : nothing}
											${
												crumbsCollapsed
													? nothing
													: html`<code-icon
															class="gl-graph__group-member-chevron"
															icon="chevron-right"
														></code-icon>`
											}
										</span>`
									: nothing
							}
							${
								changesIconStage
									? html`${
											filterable ? this.renderFilterButton(zone, filterActive, false) : nothing
										}${this.renderChangesModePickerButton(
											visibleZones,
											i,
											zoneHeaderIcons.changes,
											true,
											changesGlyphLoading,
										)}`
									: filterOnly
										? html`${this.renderFilterButton(zone, true, true)}${
												zone.id === 'changes'
													? this.renderChangesModePickerButton(visibleZones, i)
													: nothing
											}`
										: html`${filterable ? this.renderFilterButton(zone, filterActive, false) : nothing}
												<span
													class="gl-graph__header-label${
														zone.id === 'changes' ? ' gl-graph__header-label--changes' : ''
													}"
													role="button"
													tabindex="0"
													aria-haspopup=${zone.id === 'changes' ? 'menu' : nothing}
													aria-expanded=${
														zone.id === 'changes'
															? this.changesModeAnchor != null
																? 'true'
																: 'false'
															: nothing
													}
													aria-label=${
														zone.id === 'changes'
															? 'Changes column. Press Enter to change the visualization; Shift+Arrow Left/Right to reorder, or drag.'
															: `${zone.label} column. Shift+Arrow Left/Right to reorder, or drag.`
													}
													data-tooltip=${
														zone.id === 'changes'
															? 'Change Visualization — or drag / Shift+Arrow to reorder'
															: `Drag or press Shift+Arrow to reorder ${zone.label.toLowerCase()} column`
													}
													data-roving-key="label:${zone.id}"
													@keydown=${(e: KeyboardEvent) =>
														this.onLabelKeydown(e, visibleZones, i)}
													>${
														labelAsIcon
															? html`<code-icon
																	class="gl-graph__header-label-icon"
																	icon=${
																		changesGlyphLoading
																			? 'loading'
																			: zoneHeaderIcons[zone.id]
																	}
																	modifier=${changesGlyphLoading ? 'spin' : ''}
																></code-icon>`
															: zone.id === 'changes'
																? html`<span class="gl-graph__header-label-text"
																		>${zone.label}</span
																	>`
																: zone.label
													}${
														zone.id === 'changes'
															? html`<code-icon
																	class="gl-graph__changes-mode-chevron"
																	icon="chevron-down"
																	aria-hidden="true"
																></code-icon>`
															: nothing
													}</span
												>`
							}
							${
								zone.id === 'ref' && this.refsPlacement === 'column' && refFindHere
									? this.renderRefFindButton()
									: nothing
							}
							${
								zone.id === 'ref' && this.refsPlacement === 'column' && !(isLast && !graphIsLastColumn)
									? this.renderRefsPlacementControl(true, visibleZones)
									: nothing
							}
						</span>
						${
							zone.id === 'changes'
								? this.renderChangesLoading(headerW, filterOnly, changesGlyphLoading)
								: nothing
						}
						${
							isLast
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
										data-tooltip=${`Drag or Shift+Arrow to resize, or double-click to fit the ${fitTargetLabel.toLowerCase()} column to its contents`}
										@pointerdown=${(e: PointerEvent) => this.onResizeStart(e, visibleZones, i)}
										data-roving-key="resize:${zone.id}"
										@keydown=${(e: KeyboardEvent) => this.onResizeKeydown(e, visibleZones, i)}
									>
										<span class="gl-graph__resize-line"></span>
									</div>`
						}
					</div>
					${
						gutterWidth > 0 && this.graphVisibleSlot === i + 1
							? this.renderGraphHeaderCell(gutterWidth, graphIsLastColumn)
							: nothing
					}`;
			})}
			${this.renderSettingsControl()}
		</div>`;
	}

	// Header filter button, rendered at a filterable column cell's inline-start (after any placement
	// controls, before the label). Idle it's collapsed to zero width + transparent (reserves no label
	// space); the cell's `:hover`/`:focus-within` reveals it (CSS only). `active` shows it persistently in
	// the accent tone with the filled icon. `floor` is the degraded ultra-narrow case where it stands in
	// for the column icon entirely, so its tooltip names the filtered column. It's a DRAG-THROUGH control
	// (no pointerdown stopPropagation): the press bubbles to the cell so a drag reorders the column (vital
	// on narrow cells where the icon fills the grab area) — a CLEAN mouse click instead dispatches the
	// filter, resolved in `onColumnPointerUp` via `data-filter-zone`. No `@click` (like the Changes label):
	// under the cell's pointer capture a mouse click is ambiguous, so keyboard is handled via `@keydown`.
	private renderFilterButton(zone: ZoneSpec, active: boolean, floor: boolean, member = false): TemplateResult {
		// Same action-first language as the placement toggles (Group/Ungroup X with/from Y).
		const tooltip = active ? `Edit ${zone.label} Filter` : `Filter by ${zone.label}`;
		const ariaLabel = tooltip;
		return html`<button
			class="gl-graph__filter-toggle${active ? ' is-active' : ''}${
				floor ? ' gl-graph__filter-toggle--floor' : ''
			}${member ? ' gl-graph__filter-toggle--member' : ''}"
			type="button"
			aria-pressed=${active ? 'true' : 'false'}
			aria-label=${ariaLabel}
			data-tooltip=${tooltip}
			data-filter-zone=${zone.id}
			data-roving-key="filter:${zone.id}"
			draggable="false"
			@keydown=${(e: KeyboardEvent) => this.onFilterButtonKeydown(e, zone.id)}
		>
			<code-icon icon=${active ? 'filter-filled' : 'filter'}></code-icon>
		</button>`;
	}

	// Bubbles+composed so it reaches the `@gl-graph-filter-column` listener on `<gl-graph-wrapper>`
	// (graph-app binds it there); both this element and the wrapper are light DOM, so no re-dispatch.
	// Shared by the filter button's keyboard path and the pointerup clean-click path (`onColumnPointerUp`).
	private dispatchFilterColumn(zoneId: ZoneId): void {
		this.dispatchEvent(
			new CustomEvent('gl-graph-filter-column', { detail: { zone: zoneId }, bubbles: true, composed: true }),
		);
	}

	// Keyboard activation for the drag-through filter button (Enter/Space). The mouse path has no `@click`
	// (a click under the cell's pointer capture is ambiguous) — it's dispatched from `onColumnPointerUp`.
	private onFilterButtonKeydown(event: KeyboardEvent, zoneId: ZoneId): void {
		if (event.key !== 'Enter' && event.key !== ' ') return;

		event.preventDefault();
		event.stopPropagation();
		this.dispatchFilterColumn(zoneId);
	}

	// Ref find — opens the type-ahead that jumps to a branch or tag by name. Rides wherever the refs
	// controls live: the Refs column's right edge when refs are their own column, and the refs crumb
	// (after the identity/group button, before the chevron) when they're grouped, which is the default
	// and where most users will meet it.
	//
	// ALWAYS VISIBLE, unlike the hover-revealed filter button — so it feeds the header's width math
	// (`refFindHere`) and drops out on ultra-narrow columns instead of clipping.
	//
	// Uses the placement/settings contract (`stopPropagation` on pointerdown + a plain `@click`) rather
	// than the filter button's drag-through one: it sits beside the placement toggle and has to click
	// the same way its neighbor does. The trade-off is that a press here can't start a column reorder.
	private renderRefFindButton(): TemplateResult {
		const title = 'Find a Branch, Tag, or Worktree...';
		return html`<button
			class="gl-graph__ref-find-toggle${this.refFindOpen ? ' is-active' : ''}"
			type="button"
			aria-pressed=${this.refFindOpen ? 'true' : 'false'}
			aria-label=${title}
			data-tooltip=${title}
			data-roving-key="find:ref"
			draggable="false"
			@pointerdown=${(e: Event) => e.stopPropagation()}
			@click=${this.toggleRefFind}
		>
			<code-icon icon="search"></code-icon>
		</button>`;
	}

	private toggleRefFind = (): void => {
		this._refFindOpenedBy = 'button';
		// The button path returns focus to the rows, so drop any target a prior `/` session left behind.
		this._refFindReturnFocus = undefined;
		this.setRefFindOpen(!this.refFindOpen);
	};

	/**
	 * Opens the ref finder for the app-level `/` shortcut (`gl-graph-app` owns the key so it fires from
	 * anywhere in the webview; this is the only entry point that isn't the header button).
	 *
	 * `returnFocus` is the element the keystroke came from — where the keyboard goes back to on dismissal.
	 *
	 * Already open re-claims the input rather than no-opping (`setRefFindOpen` early-returns on an
	 * unchanged value), so `/` always means "put me in the finder" even when focus has wandered off it.
	 */
	openRefFind(returnFocus?: HTMLElement): void {
		this._refFindOpenedBy = 'shortcut';
		this._refFindReturnFocus = returnFocus;
		if (this.refFindOpen) {
			this.refFindRef.value?.focus();
			return;
		}

		this.setRefFindOpen(true);
	}

	/**
	 * The find widget, rendered at VIEWPORT level (a sibling of the header, pinned to its top-right)
	 * rather than in the header cell — `.gl-graph__header-cell-content` is `overflow: hidden`, and a
	 * fixed spot keeps the widget still whether the trigger sits in the Refs column or on the crumb.
	 *
	 * Kept in the tree while closed so a preserved query survives a reopen; `[open]` drives visibility.
	 *
	 * Clicks are STOPPED here. The widget is chrome that happens to live inside the viewport, so its
	 * clicks are not graph clicks — and `onClick` clears `_pendingRevealSha` on any click that reaches
	 * it. Without this, clicking Load queues a reveal for the not-yet-loaded row and then the very same
	 * click cancels it, so the row pages in and gets selected but never scrolls into view. Same contract
	 * the ref pills' jump button already follows (see `onClick`).
	 */
	private renderRefFind(): TemplateResult {
		return html`<gl-graph-ref-find
			${ref(this.refFindRef)}
			?open=${this.refFindOpen}
			.openedBy=${this._refFindOpenedBy}
			.getRowIndex=${this.refFindRowIndex}
			.rowsLoaded=${this.processedIndexBySha.size}
			@click=${(e: Event) => e.stopPropagation()}
			@gl-graph-ref-find-jump=${this.onRefFindJump}
			@gl-graph-ref-find-close=${this.onRefFindClose}
		></gl-graph-ref-find>`;
	}

	/**
	 * Resolves a ref's tip sha to its position in the PROCESSED rows — which includes rows folded
	 * inside collapsed lanes, so a ref hidden in a fold still counts as loaded and jumps (the jump
	 * expands the lane). `undefined` means genuinely not paged in, which gates the Load affordance.
	 */
	private refFindRowIndex = (sha: string): number | undefined => {
		return this.processedIndexBySha.get(sha);
	};

	private onRefFindJump = (e: CustomEvent<{ sha: string; focus: boolean; refKey?: string }>): void => {
		const sha = e.detail.sha;
		this.markRefFindHit(e.detail.refKey);
		// `focus` marks a COMMIT (Enter) rather than one of the per-keystroke preview jumps — the keyboard
		// is moving to the landed row, so the finder must not hand it back to wherever `/` was pressed.
		if (e.detail.focus) {
			this._refFindReturnFocus = undefined;
		}
		// A target that isn't paged in yet needs watching: `jumpToRefRow` starts the host walk, but the
		// reveal it queues resolves an index the rest of the walk then moves (see `retryRefFindReveal`).
		this._refFindLoadingSha = this.processedIndexBySha.has(sha) ? undefined : sha;
		this._refFindLoadingRevealedIndex = undefined;
		// The REVEAL owns the flash, not this handler: a find target may need a host walk to page in, and
		// arming here would start the 700ms timer against a row that doesn't exist yet — losing the flash
		// entirely on any walk slower than that, and (before the flash was keyed by sha) washing whichever
		// row happened to be selected instead. `flushPendingReveal` arms it when the row actually lands, and
		// `retryRefFindReveal`'s per-batch re-arms carry no flash, so a multi-batch page-in can't strobe.
		this.jumpToRefRow(sha, { focus: e.detail.focus, flash: true });
	};

	/**
	 * Re-arms the reveal for a find target while its page-in settles.
	 *
	 * A host walk can land in several batches, and the row's index moves between them. The reveal
	 * resolves an index the first time it can and then CONSUMES itself, so it lands on an early one and
	 * stops. Re-arming on every index CHANGE lets the last batch win.
	 *
	 * Reveal only, deliberately: the selection is the select intent's concern (`GraphSelectIntent`) and
	 * that part works — the intent holds the ask until the row is renderable and lands it exactly once.
	 *
	 * This lives HERE rather than in the find widget because it runs from `updated()` right after the
	 * index is rebuilt; the widget sees the index through a property, and Lit updates children before
	 * parents, so its view can lag a render.
	 *
	 * Self-limiting: an index that hasn't moved re-arms nothing, so unrelated paging costs a lookup.
	 */
	private retryRefFindReveal(): void {
		const sha = this._refFindLoadingSha;
		if (sha == null) return;

		const index = this.processedIndexBySha.get(sha);
		if (index == null || index === this._refFindLoadingRevealedIndex) return;

		this._refFindLoadingRevealedIndex = index;
		// Reveal only — NOT a re-navigation. `navigateToCommit` coalesces a same-sha re-entry while its first
		// ask is still open and returns having done nothing, so re-navigating here is silently swallowed AND
		// burns this retry's one chance (the index stamp above). Selection is the select intent's job and it
		// does land; only the scroll needs re-arming as later batches move the row.
		//
		// No flash: this is the SAME landing still settling, and re-arming per batch would strobe. Each re-arm
		// re-tests the rule, so once a batch leaves the row comfortably placed the rest cost nothing.
		this.scrollToSha(sha);
	}

	/** Ends the reveal watch for `sha` — the wrapper calls this when the row load it started settles, in
	 *  any way: landed, superseded, timed out. Without it a target that never materializes stays watched
	 *  for the finder's whole session, and unrelated paging that later brings the row in yanks the
	 *  viewport to it. Ignores a sha that isn't the one being watched, so a stale settle can't disarm a
	 *  newer jump. */
	endRefFindLoad(sha: string): void {
		if (this._refFindLoadingSha !== sha) return;

		this._refFindLoadingSha = undefined;
		this._refFindLoadingRevealedIndex = undefined;
	}

	/** Marks the landed ref so its pill takes the selected/hover fill. The row's announcing flash is the
	 *  reveal's job (see `onRefFindJump`) — it, not this, knows when the row arrived. */
	private markRefFindHit(refKey: string | undefined): void {
		this._refFindHitKey = refKey;
		this.invalidateAdornments();
		// `_refFindHitKey` is a plain field, not `@state()` — nothing else here guarantees a render, so this
		// event handler has to request its own (see `invalidateAdornments`'s comment).
		this.requestUpdate();
	}

	/**
	 * Plays the landing flash over `sha`'s row once — a brief wash announcing "you arrived here".
	 *
	 * Kept independent of WHERE a reveal lands (and of whether one happened at all): a caller that wants to
	 * announce without scrolling, or to land without announcing, sets one without touching the other.
	 *
	 * Deliberately re-armable on the same row: landing again on a row you already visited should still
	 * announce itself, so the class is dropped and re-added rather than left on. The `updateComplete` hop is
	 * what makes the drop take effect — re-adding it within the same render is a no-op the animation ignores.
	 */
	private armLandingFlash(sha: string): void {
		this.clearLandingFlashTimer();
		this._landingFlashSha = undefined;
		void this.updateComplete.then(() => {
			this._landingFlashSha = sha;
			this._landingFlashTimer = setTimeout(() => {
				this._landingFlashSha = undefined;
				this._landingFlashTimer = undefined;
			}, 700);
		});
	}

	private onRefFindClose = (): void => {
		this.setRefFindOpen(false);
	};

	/** Live overlay-stack registration for the find widget — non-null exactly while it's open. */
	private _refFindOverlay: Disposable | undefined;

	/** Esc is the overlay stack's, not the widget's: focus never leaves its input, so a local handler would
	 *  beat any surface opened on top of it. Pushed at open time so the stack's LIFO order is the order the
	 *  surfaces actually opened in. */
	private pushRefFindOverlay(): void {
		this._refFindOverlay ??= this.keymap?.pushOverlay({
			id: 'graph-ref-find',
			onClose: () => {
				if (!this.refFindOpen) return false;

				this.setRefFindOpen(false);
				return true;
			},
		});
	}

	/** Opens/closes the find widget. Closing returns focus to the graph so the keyboard isn't stranded. */
	private setRefFindOpen(open: boolean): void {
		if (this.refFindOpen === open) return;

		this.refFindOpen = open;
		if (open) {
			this.pushRefFindOverlay();
		} else {
			this._refFindOverlay?.dispose();
			this._refFindOverlay = undefined;
			// The emphasis belongs to an open find, not to the selection it left behind, and a walk
			// still landing must not scroll a closed finder's target into view.
			this._refFindHitKey = undefined;
			this._refFindLoadingSha = undefined;
			this._refFindLoadingRevealedIndex = undefined;
			this.invalidateAdornments();
		}
		// Opening hands focus to the input — the widget does that itself, once its own render has made the
		// input focusable. Closing brings the keyboard back so it isn't stranded on a hidden element:
		// to wherever `/` was pressed when the finder is being dismissed without landing, otherwise the rows.
		if (!open) {
			const returnTo = this._refFindReturnFocus;
			this._refFindReturnFocus = undefined;
			if (returnTo?.isConnected) {
				returnTo.focus();
				// An `inert` or hidden ancestor swallows `focus()` silently and drops focus to the body —
				// only the rows fallback below can un-strand the keyboard from there.
				if (document.activeElement !== document.body) return;
			}

			this.treeRef.value?.focus();
		}
	}

	// Compact-density header. The stacked 2-line rows have no per-zone columns, so instead of the full
	// column header we render a reduced bar: the Graph column cell (its placement/node/density controls +
	// resize handle, width `graphColumnWidth`) when the graph is its own column — aligned with the row's
	// leading graph cell — then a single flex-fill "details" cell spanning the stacked content, then the
	// settings gear. When the graph is grouped or hidden there's no separate leading cell, so it collapses
	// to just the details cell (which hosts the graph group/restore control) + the gear.
	private renderListHeader(): TemplateResult {
		const graphIsColumn = this.graphPlacement === 'column';
		return html`<div
			class="gl-graph__header gl-graph__header--list"
			role="toolbar"
			aria-label="Graph columns"
			@keydown=${this.headerRoving.onKeydown}
			@focusin=${this.headerRoving.onFocusin}
		>
			${graphIsColumn ? this.renderGraphHeaderCell(this.gutterWidth, false) : nothing}
			<div
				class="gl-graph__header-cell gl-graph__header-cell--details"
				data-vscode-context=${this.columnsContext ?? nothing}
			>
				${graphIsColumn ? nothing : this.renderPlacementControl(true)}
			</div>
			${this.renderSettingsControl()}
		</div>`;
	}

	// The graph-column header cell (placement/node/density controls + a draggable "Graph" label + the
	// resize handle). Rendered at `graphColumnPos` among the zone headers (movable column); the label's
	// dragstart/Arrow keys reorder it. The resize handle sets the column's displayed width — narrowing
	// it past the lane content scrolls the gutter (fixed spacing), it does NOT re-space the lanes.
	private renderGraphHeaderCell(gutterWidth: number, isLast: boolean): TemplateResult {
		const foldLaneWidth = this.foldLaneWidth;
		const totalWidth = this.graphColumnWidth;
		// As the trailing cell, yield the tail to the pinned gear (header-only — the body gutter keeps
		// `totalWidth`; no divider marks the last cell's right edge, so the difference is invisible).
		const cellWidth = isLast ? Math.max(0, totalWidth - this.headerActionsPx) : totalWidth;
		// Swap the "Graph" text for the graph icon once the cell can't fit it (placement control + label
		// + handle) — same narrow-column behavior as the zone headers.
		const labelAsIcon = !headerLabelFits('Graph', cellWidth - 22);
		return html`<div
			class="gl-graph__header-cell gl-graph__header-cell--graph${
				this.dragColId === 'graph' ? ' is-dragging' : ''
			}"
			data-vscode-context=${this.columnsContext ?? nothing}
			style=${cspStyleMap({ width: `${cellWidth}px`, minWidth: `${cellWidth}px` })}
			@pointerdown=${(e: PointerEvent) => this.onColumnPointerDown(e, 'graph')}
		>
			<span
				class="gl-graph__header-label"
				role="button"
				tabindex="0"
				aria-label="Graph column. Shift+Arrow Left/Right to reorder, or drag."
				data-tooltip="Drag or press Shift+Arrow to reorder the graph column"
				data-roving-key="label:graph"
				@keydown=${this.onGraphLabelKeydown}
				>${
					labelAsIcon
						? html`<code-icon class="gl-graph__header-label-icon" icon="gl-graph"></code-icon>`
						: 'Graph'
				}</span
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
				data-tooltip="Drag or press Shift+Arrow to resize the graph column (scrolls when narrower than the lanes)"
				@pointerdown=${this.onGraphResizeStart}
				data-roving-key="resize:graph"
				@keydown=${this.onGraphResizeKeydown}
			>
				<span class="gl-graph__resize-line"></span>
			</div>
		</div>`;
	}

	// Group/ungroup pushbutton for the graph's placement: click toggles Column ↔ Grouped. Hiding/showing
	// the graph is via the column right-click menu (which sets `graphPlacement: 'hidden'`), not this
	// button. Lives in the Graph header cell (column mode) or the grouped host's header cell. `labeled`
	// appends a "Graph" text label — used only by the list header, whose single details cell has no other
	// label to name the affordance. The table header keeps it bare: its host cell already shows that
	// column's own label, and a second "GRAPH" beside it reads as two columns rather than one control.
	// `identityIcon` renders the column's icon inside the button (the crumb-chip form: the WHOLE crumb is
	// the ungroup control — one hit target, the tooltip covers it all — instead of a dead identity glyph
	// beside a tiny button).
	private renderPlacementControl(labeled = false, identityIcon?: string): TemplateResult {
		const hidden = this.graphPlacement === 'hidden';
		const grouped = this.graphPlacement === 'grouped';
		// Group/detach affordance: standalone column = outline `map` (group with the target column);
		// grouped = filled `map-filled` (separate back out). Icons are provisional (easy to swap).
		const icon = grouped ? 'map-filled' : 'map';
		// Name the actual target — the current host when offering to ungroup, the would-be host (same
		// slot `togglePlacement` captures on group) when offering to group — so the label can never lie.
		const visibleZones = this._renderCtx?.zones ?? this.getVisibleZones();
		const targetId = grouped
			? this.graphHostIdFor(visibleZones)
			: visibleZones[Math.min(this.graphVisibleSlot, Math.max(0, visibleZones.length - 1))]?.id;
		const targetName = targetId != null ? this.zoneDisplayName(targetId) : 'the next column';
		const title = hidden
			? 'Show Graph Column'
			: grouped
				? `Ungroup Graph from ${targetName}`
				: `Group Graph with ${targetName}`;
		return html`<button
			class="gl-graph__placement-toggle${labeled ? ' gl-graph__placement-toggle--labeled' : ''}${
				identityIcon ? ' gl-graph__placement-toggle--crumb' : ''
			}"
			type="button"
			aria-pressed=${grouped ? 'true' : 'false'}
			aria-label=${title}
			data-tooltip=${title}
			draggable="false"
			@pointerdown=${(e: Event) => e.stopPropagation()}
			data-roving-key="placement:graph"
			@click=${this.togglePlacement}
		>
			${identityIcon ? html`<code-icon icon=${identityIcon}></code-icon>` : nothing}${
				labeled ? html`<span class="gl-graph__placement-toggle-label">Graph</span>` : nothing
			}<code-icon icon=${icon}></code-icon>
		</button>`;
	}

	// Click: flip Column ↔ Grouped (from hidden, restore to column).
	private togglePlacement = (): void => {
		if (this.graphPlacement === 'column') {
			// column → grouped: capture the host BY ID — the zone at the graph's current visible slot (its
			// right neighbor once the graph cell folds away) — so the [graph + host] pair travels together
			// through later reorders instead of re-deriving positionally each time.
			const visible = this.getVisibleZones();
			this.graphHostZoneId = visible[Math.min(this.graphVisibleSlot, Math.max(0, visible.length - 1))]?.id;
			this.graphPlacement = 'grouped';
		} else if (this.graphPlacement === 'grouped') {
			// grouped → column: re-derive the anchor from the host's CURRENT position — BEFORE clearing the
			// sticky id, while `graphHostIdFor` can still resolve it — so the graph column reappears
			// immediately LEFT of the host (which may have moved while grouped). Leave the anchor unchanged
			// if the host is no longer visible.
			const visible = this.getVisibleZones();
			const hostId = this.graphHostIdFor(visible);
			const hostIdx = hostId != null ? visible.findIndex(z => z.id === hostId) : -1;
			if (hostIdx >= 0) {
				this.graphColumnPos = this.graphAnchorForVisibleSlot(visible, hostIdx);
			}
			this.graphPlacement = 'column';
			this.graphHostZoneId = undefined;
		} else {
			// hidden → column.
			this.graphPlacement = 'column';
			this.graphHostZoneId = undefined;
		}
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
	// enabled, else letters (initials).
	private get effectiveNodeStyle(): 'dots' | 'avatars' | 'letters' {
		if (this.columns?.graph?.mode === 'compact') return 'dots';

		return (this.config?.avatars ?? true) ? 'avatars' : 'letters';
	}

	// Group/detach toggle for the Refs column. When refs is a column it lives at the RIGHT edge of the
	// Refs header (`atEnd` → outline `map` → group with Message), mirroring the graph column's toggle;
	// when grouped it migrates to the LEFT of the Message host header (filled `map-filled` → separate
	// back out). Rendered from the zone-header loop. Expanded density only (the header).
	// `identityIcon` = the crumb-chip form (column icon inside the button) — see renderPlacementControl.
	private renderRefsPlacementControl(
		atEnd: boolean,
		visibleZones: readonly ZoneSpec[],
		identityIcon?: string,
	): TemplateResult {
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
			? 'Group Graph with Branches / Tags'
			: isColumn
				? `Group Branches / Tags with ${targetName}`
				: `Ungroup Branches / Tags from ${targetName}`;
		return html`<button
			class="gl-graph__placement-toggle${atEnd ? ' gl-graph__placement-toggle--end' : ''}${
				identityIcon ? ' gl-graph__placement-toggle--crumb' : ''
			}"
			type="button"
			aria-pressed=${isColumn ? 'false' : 'true'}
			aria-label=${title}
			data-tooltip=${title}
			draggable="false"
			@pointerdown=${(e: Event) => e.stopPropagation()}
			data-roving-key="placement:refs"
			@click=${this.toggleRefsPlacement}
		>
			${identityIcon ? html`<code-icon icon=${identityIcon}></code-icon> ` : nothing}<code-icon
				icon=${icon}
			></code-icon>
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
		// moves onto the refs zone so the lanes group there; the sticky host id is set to `'ref'` directly
		// (no visible-slot lookup needed — this IS the merge).
		if (this.refsGroupMergesGraph()) {
			const refsFullIdx = this.zones.findIndex(z => z.id === 'ref');
			this.graphPlacement = 'grouped';
			this.graphHostZoneId = 'ref';
			this.graphColumnPos = refsFullIdx;
			// Unlike ordinary GROUPING (which captures the host id and leaves the anchor alone), this
			// special case moves the persisted anchor itself — persist it now so an unrelated columns
			// push (e.g. another column's visibility toggled from the host) can't echo back the stale
			// pre-toggle order and snap the anchor back.
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

	// Settings gear: opens VS Code's native graph menu (column show/hide + the Scroll Markers submenu)
	// on click. `settingsContext` is the host-built `gitlens:graph:settings` data-vscode-context; a
	// left-click dispatches a synthetic `contextmenu` at the button (see `openHeaderContextMenu`) so the
	// native menu opens there (same pattern as gl-details-commit-panel.onMoreActionsClick).
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
			data-roving-key="settings"
			@click=${this.openHeaderContextMenu}
		>
			<code-icon icon="settings-gear"></code-icon>
		</button>`;
	}

	// Collision floor: below this header width the inline-end spinner would overlap the leading content, so
	// it's suppressed (filter button ~18 + compact chevron ~19 + spinner ~13 + insets). Only filter-only
	// needs it — text mode always has room, and the icon-collapsed states spin their own glyph instead.
	private static readonly changesSpinnerFilterOnlyFloor = 60;

	// Loading spinner while the host resolves diffstats. Absolutely pinned to the column's inline-end
	// (graph.scss), pointer-transparent + `aria-hidden`. Skipped when the header's collapsed glyph already
	// carries the spin, and suppressed in filter-only below the width where it would overlap.
	private renderChangesLoading(
		headerW: number,
		filterOnly: boolean,
		glyphLoading: boolean,
	): TemplateResult | typeof nothing {
		if (!this.rowsStatsLoading || glyphLoading) return nothing;
		if (filterOnly && headerW < GlLitGraph.changesSpinnerFilterOnlyFloor) return nothing;

		return html`<code-icon
			class="gl-graph__changes-header-spinner"
			icon="loading"
			modifier="spin"
			aria-hidden="true"
		></code-icon>`;
	}

	// At these widths this button REPLACES the column's label, so it carries the label's roving key
	// (`label:changes`) rather than one of its own: it is the column's keyboard control here, and keying it
	// the same way both puts it where the header rove order expects the column and keeps the tab stop
	// pinned across a width change that swaps label and button. `refocusColumnLabel` and the cell's
	// focus ring resolve it for the same reason.
	// Compact picker entry, shown when the Changes column is too narrow for the full label — at icon stage
	// (the body cell is a single glyph; `primaryIcon` = the column's own full-size `request-changes` icon,
	// with `withChevron` appending the picker chevron) or the older filter-only floor (a lone `chevron-down`
	// beside the filter button). Behaves like the label control: it does NOT stop the pointerdown, so a press
	// arms the column reorder (drag) and a clean click opens the picker via `onColumnPointerUp` (no `@click`
	// — a click under the cell's pointer capture is ambiguous); keyboard reuses `onLabelKeydown` for
	// Enter/Space-to-open and Shift+Arrow-to-reorder. The `--labeled` variant pins the icon and lets the
	// chevron clip on the right, so the identity icon never shrinks or yields (see graph.scss). `loading`
	// spins the primary icon in place of the identity glyph — the button stays clickable (the picker is
	// still valid) and the aria/tooltip copy is unchanged.
	private renderChangesModePickerButton(
		visibleZones: readonly ZoneSpec[],
		i: number,
		primaryIcon: string = 'chevron-down',
		withChevron = false,
		loading = false,
	): TemplateResult {
		return html`<button
			class="gl-graph__changes-mode-picker-button${
				withChevron ? ' gl-graph__changes-mode-picker-button--labeled' : ''
			}"
			type="button"
			aria-haspopup="menu"
			aria-expanded=${this.changesModeAnchor != null ? 'true' : 'false'}
			aria-label="Change Changes column visualization"
			data-tooltip="Change Visualization"
			draggable="false"
			data-roving-key="label:changes"
			@keydown=${(e: KeyboardEvent) => this.onLabelKeydown(e, visibleZones, i)}
		>
			<code-icon
				class="gl-graph__changes-mode-picker-icon"
				icon=${loading ? 'loading' : primaryIcon}
				modifier=${loading ? 'spin' : ''}
			></code-icon>
			${
				withChevron
					? html`<code-icon
							class="gl-graph__changes-mode-picker-chevron"
							icon="chevron-down"
							aria-hidden="true"
						></code-icon>`
					: nothing
			}
		</button>`;
	}

	private get currentChangesMode(): ChangesColumnMode {
		return changesModeOrDefault(this.getVisibleZones().find(z => z.id === 'changes')?.mode);
	}

	// Mode-picker popover — a horizontal `menu` of `menuitemradio` glyph buttons hosted by `gl-popover`
	// (`trigger="manual"`): gl-popover owns the surface, Floating-UI flip/shift positioning, native top-layer
	// stacking, and the Escape/CloseWatcher + focus-out dismiss. We drive open/close programmatically from the
	// pointerup drag-latch decision (its click trigger can't be gated on the latch) and anchor it to the
	// combined Changes label control (or the compact chevron button in filter-only). Rendered inside the
	// viewport so the delegated tooltip/`focusin` listeners cover the glyphs' `data-tooltip`. `null` anchor =
	// closed (drives `open` + the label's aria-expanded); the current mode is highlighted + focused on open.
	private changesModeMenuRef = createRef<HTMLElement>();
	@state() private changesModeAnchor?: HTMLElement;
	private changesModeFocusIndex = 0;
	/** Live overlay-stack registration for the mode menu — non-null exactly while it's open. */
	private _changesModeOverlay: Disposable | undefined;

	// Optimistic latch: the opt-in overlay's click flips this so the dormant overlay + header tint clear
	// instantly, before the host's `changesColumnEnabled` push lands. Reset in willUpdate on that push
	// (the host is authoritative), so a failed/declined write re-shows the overlay.
	@state() private _changesEnableRequested = false;
	private changesOptInRef: Ref<HTMLElement> = createRef();

	private renderChangesModePopover(): TemplateResult {
		const current = this.currentChangesMode;
		return html`<gl-popover
			class="gl-graph__changes-mode-popover"
			appearance="menu"
			trigger="manual"
			placement="bottom-end"
			?arrow=${false}
			.distance=${4}
			.anchor=${this.changesModeAnchor}
			.open=${this.changesModeAnchor != null}
			@gl-popover-after-show=${this.onChangesModePopoverShow}
			@gl-popover-hide=${this.onChangesModePopoverHide}
		>
			<span slot="anchor"></span>
			<div
				${ref(this.changesModeMenuRef)}
				slot="content"
				class="gl-graph__changes-mode-strip"
				role="menu"
				aria-orientation="horizontal"
				aria-label="Changes column visualization"
				@keydown=${this.onChangesModeMenuKeydown}
			>
				${changesModeOptions.map((opt, i) => {
					const isCurrent = opt.mode === current;
					return html`<button
						class="gl-graph__changes-mode-glyph${isCurrent ? ' is-current' : ''}"
						type="button"
						role="menuitemradio"
						aria-checked=${isCurrent ? 'true' : 'false'}
						aria-label=${opt.label}
						data-tooltip=${opt.label}
						tabindex=${i === this.changesModeFocusIndex ? '0' : '-1'}
						@click=${() => this.pickChangesMode(opt.mode)}
					>
						${changesModeGlyphs[opt.mode]}
					</button>`;
				})}
			</div>
		</gl-popover>`;
	}

	private toggleChangesModeMenu(anchor: HTMLElement): void {
		if (this.changesModeAnchor != null) {
			this.closeChangesModeMenu('none');
		} else {
			this.openChangesModeMenu(anchor);
		}
	}

	private openChangesModeMenu(anchor: HTMLElement): void {
		this.changesModeFocusIndex = Math.max(
			0,
			changesModeOptions.findIndex(o => o.mode === this.currentChangesMode),
		);
		this.changesModeAnchor = anchor;
		// Manual-trigger gl-popover installs its own Escape/CloseWatcher + focus-out dismiss, but not an
		// outside-pointer dismiss — add one that EXCEPTS the anchor so a click on the label toggles (never
		// reopens). Capture phase so it settles before the label's own pointerup toggle.
		document.addEventListener('pointerdown', this.onChangesModeDocumentPointerDown, true);
		// Esc goes through the overlay stack so this menu ranks above the focus chain and below anything
		// opened over it. Pushed at open time to keep the stack in open order.
		this._changesModeOverlay = this.keymap?.pushOverlay({
			id: 'graph-changes-mode-menu',
			onClose: () => {
				if (this.changesModeAnchor == null) return false;

				this.closeChangesModeMenu('always');
				return true;
			},
		});
	}

	// Focus on close: 'always' = keyboard/pick paths (ARIA menu pattern — focus returns to the trigger
	// unconditionally); 'ifLost' = self-dismiss sync (only recover a focus that fell to <body> — never
	// steal from a deliberate focus move); 'none' = drag/zones-rebuild/detach (the anchor is moving).
	private closeChangesModeMenu(restore: 'none' | 'ifLost' | 'always' = 'none'): void {
		const anchor = this.changesModeAnchor;
		if (anchor == null) return;

		this.changesModeAnchor = undefined;
		this.detachChangesModeMenu();
		if (restore !== 'none') {
			this.restoreLabelFocus(anchor, restore === 'always');
		}
	}

	private detachChangesModeMenu(): void {
		document.removeEventListener('pointerdown', this.onChangesModeDocumentPointerDown, true);
		this._changesModeOverlay?.dispose();
		this._changesModeOverlay = undefined;
	}

	// Return focus to the label only if the close dropped it to <body> — i.e. the focused glyph was hidden
	// and nothing else claimed focus (Escape / a click on non-focusable chrome). Leaves focus wherever a Tab
	// or a focusable-target click sent it, so we never steal it.
	private restoreLabelFocus(anchor: HTMLElement, always: boolean): void {
		// Same async-hide race as the open-focus: gl-popover's teardown can park focus elsewhere a frame
		// AFTER updateComplete — retry once per frame (bounded) so the restore actually lands.
		const tryRestore = (attempts: number): void => {
			const active = document.activeElement;
			if (always || active == null || active === document.body) {
				anchor.focus();
				if (document.activeElement === anchor) return;
			} else {
				return;
			}

			if (attempts > 0) {
				requestAnimationFrame(() => tryRestore(attempts - 1));
			}
		};
		void this.updateComplete.then(() => tryRestore(5));
	}

	// Move DOM focus to the roving-tabindex button (the current mode on open, the arrowed-to one after).
	private focusChangesModeButton(): void {
		this.changesModeMenuRef.value?.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
	}

	private readonly onChangesModePopoverShow = (): void => {
		// wa-popup commits the native `showPopover()` on its own (async) update — a single-frame focus
		// attempt can land while the popover is still unfocusable and silently no-op (live-verified).
		// Bounded per-frame retry until focus actually sticks.
		const tryFocus = (attempts: number): void => {
			const btn = this.changesModeMenuRef.value?.querySelector<HTMLElement>('[tabindex="0"]');
			if (btn != null) {
				btn.focus();
				if (document.activeElement === btn) return;
			}

			if (attempts > 0) {
				requestAnimationFrame(() => tryFocus(attempts - 1));
			}
		};
		requestAnimationFrame(() => tryFocus(5));
	};

	// Sync our state when gl-popover self-dismisses (Escape via CloseWatcher, focus-out, webview blur). A
	// programmatic close nulls the anchor first, so this early-returns for it. gl-popover emits `hide` BEFORE
	// it hides the body, so an Escape-dismissed glyph is still the active element for the focus recovery.
	private readonly onChangesModePopoverHide = (): void => {
		const anchor = this.changesModeAnchor;
		if (anchor == null) return;

		this.changesModeAnchor = undefined;
		this.detachChangesModeMenu();
		this.restoreLabelFocus(anchor, false);
	};

	// Outside-pointer light dismiss (manual gl-popover doesn't install one). Excepts the anchor + popover
	// content; capture phase so it settles before the label's own pointerup toggle.
	private readonly onChangesModeDocumentPointerDown = (event: PointerEvent): void => {
		const target = event.target;
		if (!(target instanceof Node)) return;
		if (this.changesModeMenuRef.value?.contains(target) || this.changesModeAnchor?.contains(target)) {
			return;
		}

		this.closeChangesModeMenu('ifLost');
	};

	private readonly onChangesModeMenuKeydown = (event: KeyboardEvent): void => {
		const count = changesModeOptions.length;
		let next = this.changesModeFocusIndex;
		switch (event.key) {
			case 'ArrowRight':
				next = (this.changesModeFocusIndex + 1) % count;
				break;
			case 'ArrowLeft':
				next = (this.changesModeFocusIndex - 1 + count) % count;
				break;
			case 'Home':
				next = 0;
				break;
			case 'End':
				next = count - 1;
				break;
			// No Enter/Space case: the focused native <button> fires its own @click (→ pickChangesMode).
			// No Escape case either — the open menu sits on the keymap's overlay stack, which closes the
			// topmost surface only, so a card opened over the menu isn't skipped.
			case 'Tab':
				event.preventDefault();
				this.closeChangesModeMenu('always');
				return;
			default:
				return;
		}
		event.preventDefault();
		if (next !== this.changesModeFocusIndex) {
			this.changesModeFocusIndex = next;
			this.requestUpdate();
			void this.updateComplete.then(() => this.focusChangesModeButton());
		}
	};

	// Host-authoritative write: `updateColumns` ignores webview-echoed `mode`, so route the pick through a
	// dedicated command (gl-lit-graph → graph-app → UpdateColumnModeCommand → host `setColumnMode`).
	private pickChangesMode(mode: ChangesColumnMode): void {
		this.closeChangesModeMenu('always');
		// Optimistic: reflect the pick on the changes zone now so the column re-renders instantly. No persist
		// / no write-revision bump — a pure local render; the IPC below drives the real, host-authoritative
		// write, whose columns echo re-confirms. A dropped push is harmless (local state already matches).
		this.zones = this.zones.map(z => (z.id === 'changes' ? { ...z, mode: mode } : z));
		this.requestUpdate();
		this.dispatchEvent(
			new CustomEvent('gl-graph-change-column-mode', {
				detail: { name: 'changes', mode: mode },
				bubbles: true,
				composed: true,
			}),
		);
	}

	// Settings-gear menu opener (sole consumer): dispatches a synthetic `contextmenu` at the gear so VS
	// Code's native menu opens there, resolving the gear's `settingsContext` `data-vscode-context`. (The
	// Changes column's display mode is picked via the glyph popover, not a native menu item.)
	private openHeaderContextMenu = (event: MouseEvent): void => {
		event.preventDefault();
		event.stopPropagation();
		const target = event.currentTarget;
		if (!(target instanceof HTMLElement)) return;

		dispatchContextMenuAt(target);
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
		// value — only an active (non-hidden) placement overwrites it. Grouped persists the RESOLVED host id
		// (mirrors `ref.grouped` via `refsHostIdFor`, see `buildColumnsConfig`); `?? true` covers an
		// unresolvable host (e.g. a not-currently-visible zone) so grouped placement itself still persists.
		// Column persists an explicit `false` (not `undefined`) — grouped is now the default, so an
		// un-group must be recorded distinctly or it would spring back to grouped on reload.
		if (this.graphPlacement !== 'hidden') {
			config.grouped =
				this.graphPlacement === 'grouped' ? (this.graphHostIdFor(this.getVisibleZones()) ?? true) : false;
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
		// Stamp the write with the next revision; the host acks it on every subsequent columns push so
		// `shouldApplyIncomingColumns` can order pushes against our writes deterministically.
		this.dispatchEvent(
			new CustomEvent('gl-graph-changecolumns', {
				detail: { settings: this.buildColumnsConfig(), revision: ++this.columnsWriteRevision },
			}),
		);
	}

	// True when an incoming `columns` push reflects ALL our local writes (the host processes commands
	// serially and acks the latest write revision on every push). A push whose ack trails our counter was
	// generated BEFORE an in-flight write — applying it would revert the just-made placement/width change
	// ("grouping resets or jumps right after load") — so it's dropped; our own echo (ack == counter)
	// arrives next and re-syncs. Host-initiated changes (cog menu, resets) carry the current ack, so with
	// no write in flight they always apply.
	private shouldApplyIncomingColumns(): boolean {
		return this.columnsRevision >= this.columnsWriteRevision;
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
		if (this.lastResizeDownIdx === visibleIdx && now - this.lastResizeDownAt < 500) {
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
			// Cancel any still-pending rAF (harmless no-op when running AS that rAF): `onUp` calls flush
			// directly, and just nulling the id would orphan the scheduled frame — it would then re-set the
			// preview AFTER cleanup cleared it, freezing rendering on the stale snapshot until the next drag.
			if (rafId != null) {
				cancelAnimationFrame(rafId);
				rafId = null;
			}
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
			// Commit the FULL drag result (see zonesWithSolvedWidths — zero-sum, so the re-solve
			// reproduces the drag-end state instead of jumping). Only when a drag actually moved a
			// boundary (`savedIds` non-empty) — a zero-distance press (e.g. the first click of a
			// double-click, which autosizes on the second press) must NOT persist, or its stale pre-fit
			// echo races the autosize's fitted echo and the width visibly bounces pre-fit → fitted.
			const solved = this.dragSolvedZones;
			const ids = this.dragSavedIds;
			const changed = solved != null && ids != null && ids.length > 0;
			if (changed) {
				this.zones = this.zonesWithSolvedWidths(solved);
			}
			cleanup();
			if (changed) {
				this.persistColumnsConfig();
			}
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

	// Double-click a column boundary to fit a column to its widest rendered content. The handle sits at the
	// RIGHT edge of zone `visibleIdx` — i.e. the START of the NEXT column — so we normally fit that next
	// column (the one the splitter precedes), matching the "splitter before the column" model. Handles only
	// render on non-last zones, so `visibleIdx + 1` is always in range. When the next column is the elastic
	// fill (no fixed width to fit) we fall back to fitting the LEFT column instead of no-opping.
	private onResizeAutosize(visibleZones: readonly ZoneSpec[], visibleIdx: number): void {
		const right = visibleZones[visibleIdx + 1];
		const zone = right != null && !right.flex ? right : visibleZones[visibleIdx];
		if (zone == null) return;
		// Only one fill zone exists, so the left can't also be flex today — but guard anyway.
		if (zone.flex) return;

		// Only content-bearing cells count — workdir rows leave author/date/sha cells empty and pill-less
		// rows leave ref cells empty; measuring those would fit the column to its bare padding. With none
		// at all there is nothing to fit, so bail (a no-op, matching the pre-measurement behavior).
		const cells = [...this.querySelectorAll<HTMLElement>(`.gl-graph__zone--${zone.id}`)].filter(
			cell => cell.childElementCount > 0,
		);
		if (cells.length === 0) return;

		// Three columns render WIDTH-DEPENDENT content, so measuring them as-rendered fits the column to
		// whatever degraded form it currently shows — the fit can then never lift it back into a richer
		// form, and (worse) the shrunken result is persisted as the column's preferred. Each one measures
		// its CANONICAL (widest) content instead; every other column measures the DOM directly. All three
		// fall back to the DOM path when their inputs aren't resolvable.
		//  • datetime — shows the "2d" stub at ≤ shortDateWidth; measure the NORMAL date string.
		//  • author   — drops the name for an avatar at min width; measure with the name restored.
		//  • changes  — degrades through full → compact → mini → icon; measure the `full` stage.
		let content: number;
		switch (zone.id) {
			case 'datetime':
				content = this.measureDatetimeContent(cells) ?? this.measureDomContent(cells);
				break;
			case 'author':
				content = this.measureAuthorContent(cells) ?? this.measureDomContent(cells);
				break;
			case 'changes':
				content = this.measureChangesContent(cells) ?? this.measureDomContent(cells);
				break;
			default:
				content = this.measureDomContent(cells);
				break;
		}
		if (content <= 0) return;

		// Round up + a hair so the fitted content isn't immediately re-truncated by sub-pixel rounding.
		const width = Math.max(zone.minWidth, Math.min(zone.maxWidth ?? Infinity, Math.ceil(content) + 1));
		// No-op only when BOTH the canonical preferred (`this.zones`) and the solved/rendered width already
		// match the fit. Preferred alone isn't enough: a previously-persisted fit can equal the new fit
		// while a deficit renders the column crushed below it — the commit below must still run to lift it.
		const preferredWidth = this.zones.find(z => z.id === zone.id)?.width;
		if (width === preferredWidth && width === zone.width) return;

		// The fit becomes the zone's new PREFERRED width, so a fit measured off width-dependent content is
		// permanent — it survives the resize that caused the degradation. Any future cell whose content
		// varies with its column's width needs a canonical measurement in the switch above, not a DOM fit.
		//
		// Commit like a drag does — zero-sum against the CURRENT solved snapshot: the fitted zone takes its
		// fit width, every other fixed zone freezes at its solved width, and the elastic fill's committed
		// width hands over the growth delta. Without that last part, a deficit layout re-seeds the fill at
		// its full preferred on the next solve and the positional deficit pass (rightmost-first, fill
		// unprivileged) crushes the fitted column straight back to its floor — the fit visibly no-ops.
		// In slack, solved == preferred for fixed zones, so only the fill's (elastic, re-absorbing) width
		// moves; a shrink-fit (excess <= 0) frees width that flows back to the fill as slack on its own.
		const solvedById = new Map(visibleZones.map(z => [z.id, z.width]));
		const fillId = visibleZones.find(z => z.flex)?.id;
		const excess = width - (solvedById.get(zone.id) ?? width);
		this.zones = this.zones.map(z => {
			if (z.id === zone.id) return { ...z, width: width, currentWidth: undefined };

			if (z.id === fillId) {
				if (excess <= 0) return z;

				const solved = solvedById.get(z.id) ?? z.width;
				return { ...z, width: Math.max(z.minWidth, solved - excess), currentWidth: undefined };
			}

			const solved = solvedById.get(z.id);
			return solved != null && solved !== z.width ? { ...z, width: solved, currentWidth: undefined } : z;
		});
		this.persistColumnsConfig();
		this.requestUpdate();
	}

	// Fit-to-content width (px, incl. cell padding + internal gaps) across a set of rendered zone cells:
	// `cell.scrollWidth` can't be used — content either truncates INSIDE the cell (text spans) or
	// flex-shrinks to fit (ref pills), so neither overflows and both report the current width, not the
	// natural one. Instead transiently size each cell to its content (`max-content`) and read its
	// border-box `offsetWidth`. `flex-basis` overrides `width`, so both must be overridden. Synchronous
	// write→read→restore (batched to avoid layout thrash) within one task, so the transient state never paints.
	private measureDomContent(cells: readonly HTMLElement[]): number {
		const saved = cells.map(cell => cell.style.cssText);
		for (const cell of cells) {
			cell.style.flex = '0 0 auto';
			cell.style.width = 'max-content';
			// Drop the zone's min-width floor too — it would inflate the measurement; the caller re-applies it.
			cell.style.minWidth = '0';
		}
		let content = 0;
		for (const cell of cells) {
			content = Math.max(content, cell.offsetWidth);
		}
		cells.forEach((cell, i) => (cell.style.cssText = saved[i]));
		return content;
	}

	// Date-column fit target: the width of the NORMAL (non-compact) date string, not the "2d" stub the
	// column shows while narrow. Measures `formatDateFn(date)` for each rendered row via a canvas 2D
	// context using the rendered `.gl-graph__date` span's font, adds the cell's horizontal padding, and
	// returns the widest. Returns undefined (→ DOM fallback) when the formatter, a measuring context, or
	// any resolvable date is missing.
	private measureDatetimeContent(cells: readonly HTMLElement[]): number | undefined {
		const format = this.formatDateFn;
		if (format == null) return undefined;

		const ctx = getTextMeasureContext();
		if (ctx == null) return undefined;

		// sha → date over the rendered rows, so each measured cell maps to its commit's real date.
		const dateBySha = new Map<string, number>();
		for (const row of this.displayRows) {
			if (row.date != null) {
				dateBySha.set(row.sha, row.date);
			}
		}

		// Font + horizontal padding sampled from a rendered date span / its cell (all rows share these).
		const sampleSpan = cells[0].querySelector<HTMLElement>('.gl-graph__date');
		const font = getComputedStyle(sampleSpan ?? cells[0]).font;
		if (font) {
			ctx.font = font;
		}
		const cellStyle = getComputedStyle(cells[0]);
		const padding = parseFloat(cellStyle.paddingLeft) + parseFloat(cellStyle.paddingRight);

		let maxText = 0;
		let matched = 0;
		for (const cell of cells) {
			const rowId = cell.closest('[id^="graph-row-"]')?.id;
			const sha = rowId?.slice('graph-row-'.length);
			const date = sha != null ? dateBySha.get(sha) : undefined;
			if (date == null) continue;

			matched++;
			maxText = Math.max(maxText, ctx.measureText(format(date)).width);
		}
		if (matched === 0) return undefined;

		return maxText + (Number.isFinite(padding) ? padding : 0);
	}

	// Author-column fit target: the avatar + NAME, even while the column is collapsed to the bare avatar
	// (`renderAuthor` drops the name at min width). The rendered cells then hold nothing to fit, so the plain
	// DOM measurement returns ~the avatar's width — which crushes the column to its floor AND persists that
	// as its preferred, so a later widening never restores it. Transiently append each row's real author name
	// so the measurement inherits the live font, the avatar's adjacent-sibling gap and the cell padding, then
	// delegate to `measureDomContent`. Returns undefined (→ plain DOM path) when the names are already
	// rendered or no cell resolves to a commit.
	private measureAuthorContent(cells: readonly HTMLElement[]): number | undefined {
		// Not collapsed — the cells already carry their names, so the plain DOM measurement is the right one.
		if (cells.some(cell => cell.querySelector('.gl-graph__author') != null)) return undefined;

		// The collapsed cell FORCES the avatar on even in avatar node-mode, where the EXPANDED cell renders
		// none (see `renderAvatar`) — so there it must be excluded from the fit, along with the 0.8rem
		// adjacent-sibling gap it would otherwise still contribute (`display: none` leaves the sibling
		// relationship, and with it the margin, intact).
		const keepAvatar = this.nodeSizingMode === 'compact';
		const probes: HTMLElement[] = [];
		const avatars: HTMLElement[] = [];
		for (const cell of cells) {
			const rowId = cell.closest('[id^="graph-row-"]')?.id;
			const sha = rowId?.slice('graph-row-'.length);
			const author = sha != null ? this.getCommitBySha(sha)?.author : undefined;
			if (!author) continue;

			const probe = document.createElement('span');
			probe.className = 'gl-graph__author';
			probe.textContent = author;
			if (!keepAvatar) {
				probe.style.marginLeft = '0';
				for (const avatar of cell.querySelectorAll<HTMLElement>('.gl-graph__avatar')) {
					avatar.style.display = 'none';
					avatars.push(avatar);
				}
			}
			cell.append(probe);
			probes.push(probe);
		}
		if (probes.length === 0) return undefined;

		const content = this.measureDomContent(cells);
		for (const probe of probes) {
			probe.remove();
		}
		for (const avatar of avatars) {
			avatar.style.display = '';
		}
		return content;
	}

	// Changes-column fit target: the `full` stage rendered with a DESIGN-SIZE track. The rendered cells can't
	// supply this — the cell degrades full → compact → mini → icon as the column narrows, and in bar/bipolar
	// the track is a contentless flex filler that always contributes its CSS `min-width` floor, so a plain DOM
	// fit shrinks the column a stage every time and can never grow it (at the default 36px it can't move at
	// all). Take the larger of `changesFitWidth` (the canonical full-stage width — the bound that matters for
	// bar/bipolar) and a probe render of the full stage's REAL content (which `numbers` with 5-digit counts
	// genuinely exceeds). The probe is one out-of-flow cell appended to the host: all Changes styling is
	// scoped under the `gl-lit-graph` selector rather than the row, so it inherits the real font/padding/gaps.
	// Returns undefined (→ DOM fallback) when no stats have arrived yet.
	private measureChangesContent(cells: readonly HTMLElement[]): number | undefined {
		const rowsStats = this.rowsStats;
		if (rowsStats == null) return undefined;

		const mode = this.currentChangesMode;
		const probe = document.createElement('div');
		probe.className = 'gl-graph__zone gl-graph__zone--changes';
		// Out of flow + unpainted so the transient renders can't reflow or flash the rows around it.
		probe.style.position = 'absolute';
		probe.style.visibility = 'hidden';
		probe.style.pointerEvents = 'none';
		probe.style.width = 'max-content';
		probe.style.minWidth = '0';
		this.append(probe);

		// Only the RENDERED rows' stats — same bound as every other fit measurement (and `rowsStats` can
		// cover far more rows than are on screen).
		let content = 0;
		try {
			for (const cell of cells) {
				const rowId = cell.closest('[id^="graph-row-"]')?.id;
				const sha = rowId?.slice('graph-row-'.length);
				const stats = sha != null ? rowsStats[sha] : undefined;
				if (stats == null) continue;

				render(renderChangesCellContent(mode, 'full', stats), probe);
				content = Math.max(content, probe.offsetWidth);
			}
		} finally {
			probe.remove();
		}
		return Math.max(changesFitWidth, content);
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
		// Resize is Shift+Arrow so plain Arrow roves the header toolbar (headerRoving).
		if (dir === 0 || !event.shiftKey) return;

		event.preventDefault();
		const step = 4 * dir;
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
		// The Changes label control this press landed on (else null). A CLEAN click (pointerup with
		// `started` still false — the same threshold gate the reorder uses) on it toggles the mode picker;
		// any press that crosses the drag threshold reorders and never opens it. See `onColumnPointerUp`.
		changesPickerAnchor: HTMLElement | null;
		// The filterable zone whose filter button this press landed on (else null) — carried by the
		// button's `data-filter-zone` (a grouped-refs crumb button filters `ref` from another column's
		// cell, so it can't be inferred from `colId`). A clean click dispatches it; a drag reorders instead.
		filterZone: ZoneId | null;
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

	/** Live overlay-stack registration for an armed/in-flight column drag — Esc aborts it. */
	private _columnDragOverlay: Disposable | undefined;

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

		// Record whether the press landed on the Changes picker control so a clean click (no drag) can open
		// the picker at pointerup — the label (text/icon + chevron) at most widths, or the compact
		// mode-picker button at icon stage. Either way the press also arms the reorder like the rest of the
		// cell; empty cell space arms reorder but doesn't open the picker.
		const changesPickerAnchor =
			colId === 'changes' && event.target instanceof Element
				? event.target.closest<HTMLElement>(
						'.gl-graph__header-label--changes, .gl-graph__changes-mode-picker-button',
					)
				: null;
		// A press on a filter button arms the reorder like anywhere else on the cell; a clean click
		// dispatches that button's zone at pointerup (the button has no `@click` — keyboard uses `@keydown`).
		const filterZone =
			event.target instanceof Element
				? ((event.target.closest<HTMLElement>('.gl-graph__filter-toggle')?.dataset.filterZone as
						| ZoneId
						| undefined) ?? null)
				: null;

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
			changesPickerAnchor: changesPickerAnchor,
			filterZone: filterZone,
			base: null,
		};
		window.addEventListener('pointermove', this.onColumnPointerMove);
		window.addEventListener('pointerup', this.onColumnPointerUp);
		window.addEventListener('pointercancel', this.onColumnPointerCancel);
		// Esc aborts the drag through the overlay stack, which outranks every focus-scope binding — so the
		// rows' Escape (clear selection) can't also fire, and no guard is needed there for it.
		this._columnDragOverlay = this.keymap?.pushOverlay({
			id: 'graph-column-drag',
			onClose: () => {
				if (this.columnDrag == null) return false;

				this.cancelColumnDrag();
				return true;
			},
		});
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
			// A reorder beats the open picker (the anchored label is about to move) — close it, no focus return.
			this.closeChangesModeMenu('none');
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

		// Grouped's anchor never moves during a content reorder anymore — the lanes render at the STICKY
		// host id (`graphHostIdFor`), not a re-derived slot, so no host-follow compensation is needed here.
		if (this.graphPlacement === 'grouped') {
			return { zones: zones, graphColumnPos: base.graphColumnPos };
		}

		// Reordering never changes WHICH zones are visible — only their order; recompute the visible order.
		const visibleIds = new Set(base.visible.map(z => z.id));
		const updatedVisible = zones.filter(z => visibleIds.has(z.id));
		const graphSlot = graphIsColumn ? cols.indexOf('graph') : Math.min(base.visibleSlot, updatedVisible.length);
		return { zones: zones, graphColumnPos: this.graphAnchorForVisibleSlotIn(zones, updatedVisible, graphSlot) };
	}

	// Commit the simulated order on release: recompute the final tentative from the base and persist it.
	private onColumnPointerUp = (event: PointerEvent): void => {
		const drag = this.columnDrag;
		if (event.pointerId !== drag?.pointerId) return;

		const base = drag.base;
		const colId = drag.colId;
		const started = drag.started;
		const changesPickerAnchor = drag.changesPickerAnchor;
		const filterZone = drag.filterZone;
		// Recompute the drop slot from the RELEASE position (the last rAF may not have flushed, so
		// `drag.target` can be a frame stale) using the pointerup's own clientX — where the user let go.
		const target = base != null ? this.columnDropTargetFor(base, event.clientX) : drag.target;
		this.endColumnDrag();
		if (!started || base == null) {
			// A clean click (never crossed the drag threshold) toggles the Changes picker or dispatches a column
			// filter; a started drag latches `base != null` and falls through here, so it can't. For
			// the mouse path this pointerup is the sole trigger — neither control has an `@click` (keyboard
			// activation goes through the label's / filter button's `@keydown`).
			if (!started) {
				if (changesPickerAnchor != null) {
					this.toggleChangesModeMenu(changesPickerAnchor);
				} else if (filterZone != null) {
					this.dispatchFilterColumn(filterZone);
				}
			}
			return;
		}

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
		this._columnDragOverlay?.dispose();
		this._columnDragOverlay = undefined;
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
		// Reorder is Shift+Arrow so plain Arrow roves the header toolbar (headerRoving).
		if (dir === 0 || !event.shiftKey) return;

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
		// A narrow Changes column renders the compact mode-picker button INSTEAD of a label, so match either
		// — without this the reorder lands and then drops focus, which reads as Shift+Arrow not working at
		// all (the next press has nothing focused to reach the handler).
		const cell =
			colId === 'graph'
				? '.gl-graph__header-cell--graph'
				: `.gl-graph__header-cell[data-col-id="${CSS.escape(colId)}"]`;
		const control = this.querySelector<HTMLElement>(
			`${cell} .gl-graph__header-label, ${cell} .gl-graph__changes-mode-picker-button`,
		);
		control?.focus({ preventScroll: true });
	}

	// Keyboard resize for the role=separator handle (Arrow Left/Right; Shift = coarse step).
	// Same visible-list resize + merge-back as the pointer drag, persisted immediately.
	private onResizeKeydown(event: KeyboardEvent, visibleZones: readonly ZoneSpec[], visibleIdx: number): void {
		const dir = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
		// Resize is Shift+Arrow so plain Arrow roves the header toolbar (headerRoving).
		if (dir === 0 || !event.shiftKey) return;

		event.preventDefault();
		const step = 8 * dir;
		// Same boundary trade as the pointer drag, applied once and persisted immediately. Commits the
		// FULL result set (zero-sum — see zonesWithSolvedWidths); a floored no-op press commits nothing.
		const result = dragResizeZone(visibleZones, visibleIdx, step);
		if (result == null || result.savedIds.length === 0) return;

		this.applyZones(this.zonesWithSolvedWidths(result.zones));
	}

	// Zero-sum resize commit: persist EVERY visible zone at its drag/keyboard-result width — not just the
	// cascade's touched ids. In a deficit layout an untouched zone's larger preferred would re-inflate on
	// the next solve and crush the just-resized columns back to their floors (the release-time "jump").
	// The result set already sums exactly to the target, so committing it verbatim makes the re-solve
	// reproduce it deterministically. Hidden/inlined zones aren't in the set and keep their preferreds.
	private zonesWithSolvedWidths(solved: readonly ZoneSpec[]): ZoneSpec[] {
		const widthById = new Map(solved.map(z => [z.id, z.currentWidth ?? z.width]));
		return this.zones.map(z => {
			const w = widthById.get(z.id);
			return w != null ? { ...z, width: w, currentWidth: undefined } : z;
		});
	}

	// Keyboard reorder for the column label (Arrow Left/Right). Uses the same gap-index +
	// reorderZones path as the drag-drop handler. Gap convention: move-right lands past the right
	// neighbor (gap i+2), move-left lands before the left neighbor (gap i-1).
	private onLabelKeydown(event: KeyboardEvent, visibleZones: readonly ZoneSpec[], visibleIdx: number): void {
		// The Changes label doubles as the mode-picker control: Enter/Space toggle the picker (Space must
		// preventDefault or the viewport scrolls). Arrow keys still reorder (below), so this is additive.
		if (
			(event.key === 'Enter' || event.key === ' ') &&
			visibleZones[visibleIdx].id === 'changes' &&
			event.currentTarget instanceof HTMLElement
		) {
			event.preventDefault();
			this.toggleChangesModeMenu(event.currentTarget);
			return;
		}

		// Reorder is Shift+Arrow so plain Arrow roves the header toolbar (headerRoving).
		if (!event.shiftKey) return;

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
		'gl-graph-changecolumns': CustomEvent<{ settings: GraphColumnsConfig; revision?: number }>;
		'gl-graph-copy-request': CustomEvent<{ context: string; selectionContexts?: string[] }>;
		'gl-graph-lanetoggle': CustomEvent<{ tipSha: string }>;
		'gl-graph-lanetoggleall': CustomEvent<{ collapsed: boolean }>;
		'gl-graph-mouseleave': CustomEvent<void>;
	}
}

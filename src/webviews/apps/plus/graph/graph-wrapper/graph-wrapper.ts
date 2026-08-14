/*global document window*/
import type { WipCandidate } from '@gitkraken/commit-graph/nearestWip.js';
import { findNearestWipByAncestry, findWipInColumn } from '@gitkraken/commit-graph/nearestWip.js';
import type { ColumnMode } from '@gitkraken/commit-graph/view.js';
import { SignalWatcher } from '@lit-labs/signals';
import { consume } from '@lit/context';
import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { GitGraphRow, GitGraphRowKind } from '@gitlens/git/models/graph.js';
import { uncommitted } from '@gitlens/git/models/revision.js';
import type { GitCommitReachability } from '@gitlens/git/providers/commits.js';
import { areEqual as areArraysEqual } from '@gitlens/utils/array.js';
import { areEqual } from '@gitlens/utils/object.js';
import type { GraphBranchesVisibility } from '../../../../../config.js';
import type { CommitDetails } from '../../../../commitDetails/protocol.js';
import type {
	DidLoadRowParams,
	GraphAvatars,
	GraphColumnName,
	GraphMissingRefsMetadata,
	GraphRef,
	GraphRefMetadataItem,
	GraphRevealMode,
	GraphScope,
	GraphSelectedRows,
	GraphSelection,
	GraphWipRowsById,
	GraphWipStateById,
	GraphZoneType,
	ProxyAvatarsParams,
	ReadonlyGraphRow,
	RowAction,
	SelectCommitsOptions,
} from '../../../../plus/graph/protocol.js';
import {
	CancelLoadRowCommand,
	createWipRowId,
	DoubleClickedCommand,
	GetMissingAvatarsCommand,
	GetMissingRefsMetadataCommand,
	GetMoreRowsCommand,
	getWipRowWorktreePath,
	GetWipStatsRequest,
	isWipRowId,
	LoadRowRequest,
	ProxyAvatarsCommand,
	RowActionCommand,
	SyncWipWatchesCommand,
	UpdateColumnsCommand,
	UpdatePinnedRefCommand,
	UpdateSelectionCommand,
} from '../../../../plus/graph/protocol.js';
import { indexAgentSessionsByRepoAndWorktree, matchAgentSessionsForWorktree } from '../../../shared/agentUtils.js';
import type { CustomEventType } from '../../../shared/components/element.js';
import { ipcContext } from '../../../shared/contexts/ipc.js';
import type { TelemetryContext } from '../../../shared/contexts/telemetry.js';
import { telemetryContext } from '../../../shared/contexts/telemetry.js';
import type { KeymapDispatcher } from '../../../shared/keymap/keymapDispatcher.js';
import type { AnchorKey } from '../components/anchorKey.js';
import type { RunningOperationBucket } from '../components/detailsState.js';
import type { WipRowAgentStatus } from '../components/wipRowAgentStatus.js';
import { pickWipRowAgentStatus } from '../components/wipRowAgentStatus.js';
import { graphStateContext } from '../context.js';
import type { GraphCrossPaneState } from '../graphCrossPaneState.js';
import { graphCrossPaneContext } from '../graphCrossPaneState.js';
import { getGraphDebugDiagnostics } from '../graphDebugDiagnostics.js';
import type { GraphKeymapScope } from '../keymap/graphKeymap.js';
import { isGraphSearchResultsError } from '../stateProvider.js';
import { getOverviewBranchSelectionSha } from '../utils/branchSelection.utils.js';
import { GraphHostSelectionRequest } from '../utils/hostSelectionRequest.js';
import { getSelectedRepoPath } from '../utils/repository.utils.js';
import {
	computeSelectionContexts,
	needsDynamicRowContext,
	serializeRowCommitContext,
	serializeSelectionContext,
	serializeWipContext,
} from '../utils/rowContext.utils.js';
import { pickScopePageTarget } from '../utils/scopePaging.utils.js';
import { GraphSelectIntent } from '../utils/selectIntent.js';
import {
	filterSecondariesForScopeAndVisibility,
	hasDirtyCounts,
	isScopeFocalHead,
	shouldShowPrimaryWipRow,
} from '../utils/wip.utils.js';
import type { GraphRowHiddenReason, GraphRowPeekRequest } from './gl-lit-graph.js';
import './gl-lit-graph.js';

/**
 * Where a navigation came from, for diagnostics ONLY — never consult it to decide reveal behavior.
 *
 * A source names the code path that dispatched, not what the user was trying to see, and several cover
 * dispatchers with opposite intent: `jump` covers both ref-find stepping and the Pull popover's
 * jump-to-incoming; `wip` and `wip-jump` differ in how they RESOLVE a target, not in how deliberate they
 * are. Reveal behavior is stated explicitly per call site via {@link GraphNavigationOptions.reveal}.
 */
export type GraphNavigationSource =
	| 'details'
	| 'history'
	| 'host'
	| 'jump'
	| 'overview'
	| 'search'
	| 'selection-sync'
	| 'sidebar'
	| 'visibility'
	| 'wip'
	| 'wip-jump';

export type GraphNavigationOptions = {
	/** Diagnostic origin for this navigation. Never drives behavior — see {@link GraphNavigationSource}. */
	source?: GraphNavigationSource;
	/**
	 * Display name for the target, when the caller jumped via a named ref rather than a bare sha.
	 * Carried through to `gl-graph-navigation-loading`/`gl-graph-navigation-failed` so feedback UI can
	 * show a human-readable label instead of a sha. Never drives navigation behavior.
	 */
	ref?: string;
	/** Cancel this navigation when its caller no longer owns the user intent. */
	signal?: AbortSignal;
	/** Move the graph's keyboard/ARIA focus anchor to the selected row after it renders. */
	focus?: boolean;
	/**
	 * When the reveal may act. Defaults to `'always'`, which is safe as a default BECAUSE the rule it runs is
	 * conservative: a row already sitting comfortably in view is left alone, so "always" means "always
	 * evaluate", not "always scroll". Only pushes nobody asked for need `'if-changed'`.
	 *
	 * Note there is no way to ask for a particular POSITION. Callers know why they are navigating; only the
	 * graph knows where the row currently sits, and that is what decides whether and how far to move.
	 */
	reveal?: GraphRevealMode;
	/**
	 * Play the landing flash once the row is revealed. Orthogonal to {@link reveal}, and NOT conditioned on
	 * the viewport having moved: the flash draws the eye to the row, which a navigation that lands on an
	 * already-visible row needs MORE than one that scrolls, not less — nothing else marks that it happened.
	 *
	 * The line it tracks is whether the USER asked for this navigation. Set it for anything a person
	 * clicked; leave it off for selection syncs and re-anchors, where an ambient flash is noise (the same
	 * reason `9eb626264` deleted the row-marker rail's selection flash).
	 */
	flash?: boolean;
	/**
	 * Whether a client-only WIP row that is not currently renderable should remain pending until the
	 * decoration layer synthesizes it. Search disables this so a WIP excluded by the active view is
	 * skipped instead of blocking result navigation indefinitely.
	 */
	deferSynthetic?: boolean;
	/**
	 * Report a failed navigation instead of absorbing it: a loaded-but-hidden row settles as
	 * `'not-found'` carrying its {@link GraphRowHiddenReason}, and every reportable failure also fires
	 * `gl-graph-navigation-failed`. Defaults to `true`.
	 *
	 * Callers that already read the result and answer for themselves (search stepping, the WIP jump) turn
	 * it off so they keep their own handling rather than getting a second, generic one.
	 */
	feedback?: boolean;
};

/** Why a navigation never landed. Only ever set on a `'not-found'` result — a `'cancelled'` one means a
 *  newer intent took over, which is nobody's failure and stays silent. */
export type GraphNavigationFailureReason =
	| { kind: 'hidden'; hidden: GraphRowHiddenReason }
	| { kind: 'not-found' }
	| { kind: 'first-parent' }
	| { kind: 'invalid-ref' }
	| { kind: 'timeout' }
	| { kind: 'error'; message?: string };

export type GraphNavigationResult =
	| { status: 'selected'; row: ReadonlyGraphRow }
	| { status: 'not-found'; reason?: GraphNavigationFailureReason }
	| { status: 'cancelled' };

/** A navigation's resolved reveal intent, carried on the pending record so a coalesced repeat ask can be
 *  merged into it rather than discarded (see {@link GlGraphWrapper.navigateToCommit}). */
type GraphRevealIntent = { mode: GraphRevealMode; flash: boolean };

type PendingGraphNavigation = {
	abortCleanup?: () => void;
	/** Set when this navigation issued a host `LoadRowRequest` — the host walk it started is UNCAPPED,
	 *  so settling without a hit has to withdraw it (see {@link settlePendingNavigation}). */
	hostLoadSha?: string;
	debugMark?: string;
	deferSynthetic: boolean;
	/** Whether a failure here is reportable — see {@link GraphNavigationOptions.feedback}. */
	feedback: boolean;
	focus: boolean;
	generation: number;
	repositoryId?: string;
	repoPath?: string;
	reveal: GraphRevealIntent;
	signal?: AbortSignal;
	sha: string;
	/** Carried only to stamp the failure/loading events — never consulted for behavior. */
	source?: GraphNavigationSource;
	/** Carried only to stamp the failure/loading events — never consulted for behavior. */
	ref?: string;
	timeout?: ReturnType<typeof setTimeout>;
	promise: Promise<GraphNavigationResult>;
	resolve: (result: GraphNavigationResult) => void;
};

type DecoratedRowsIndex = {
	rows: GitGraphRow[];
	rowBySha: ReadonlyMap<string, GitGraphRow>;
	indexBySha: ReadonlyMap<string, number>;
};

const navigationTimeoutMs = 30_000;

/** How many targeted pages a single unreachable scope anchor gets before it's treated as
 *  unreachable-in-practice — see {@link GlGraphWrapper._unreachableAnchorRequests}. */
const maxUnreachableAnchorPageAttempts = 3;

/** Consecutive empty stats responses a WIP row re-asks about before it stops on its own. Small: the
 *  causes are transient (a cancelled batch, a busy index) or permanent (feature off, unreadable
 *  worktree), and a permanently-empty row that keeps asking is just a timer that never pays off. */
const wipStatsMaxRetries = 2;
const wipStatsRetryDelayMs = 2000;

/** How the host explained a {@link LoadRowRequest} that came back without a row — an unloadable ref, a
 *  commit only reachable off the first-parent walk, or a plain miss. */
function toNavigationFailureReason(result: DidLoadRowParams | undefined): GraphNavigationFailureReason {
	if (result?.error != null) return { kind: 'error', message: result.error };

	switch (result?.reason) {
		case 'firstParent':
			return { kind: 'first-parent' };
		case 'invalidRef':
			return { kind: 'invalid-ref' };
		default:
			return { kind: 'not-found' };
	}
}

/**
 * Walk first-parent ancestry through a row array to produce the inclusive range from
 * `fromSha` to `toSha`. Direction-agnostic — figures out which sha is the ancestor and
 * walks the other way. Returns an empty array when neither sha can be reached from the
 * other via first-parent within the loaded rows.
 *
 * This is what `gitlens.graph.multiselect: 'topological'` means: the resulting selection
 * is the first-parent chain segment between the two anchors, not the visible-row slice.
 */
function walkTopologicalRange(
	rows: readonly GitGraphRow[],
	indexBySha: ReadonlyMap<string, number>,
	fromSha: string,
	toSha: string,
): string[] {
	const fromIdx = indexBySha.get(fromSha);
	const toIdx = indexBySha.get(toSha);
	if (fromIdx == null || toIdx == null) return [];

	// Newer-to-older walk by index — the rows array is already in topo/date-descending
	// order, so the ancestor of two shas has the larger index.
	const startSha = fromIdx < toIdx ? fromSha : toSha;
	const endSha = fromIdx < toIdx ? toSha : fromSha;

	const out: string[] = [];
	let cursor: string | undefined = startSha;
	const seen = new Set<string>();
	while (cursor != null && !seen.has(cursor)) {
		seen.add(cursor);
		out.push(cursor);
		if (cursor === endSha) return out;

		const idx = indexBySha.get(cursor);
		if (idx == null) break;

		cursor = rows[idx].parents[0];
	}
	// `endSha` wasn't an ancestor of `startSha` along the first-parent chain — fall back to
	// just the two endpoints so the user still gets a 2-row selection rather than nothing.
	return [startSha, endSha];
}

/**
 * Resolves a multi-selection's shas to their rows in display order, plus whether their indexes in
 * that order form an unbroken run. A sha that isn't present in `decoratedRows` (e.g. paged/filtered
 * out) is dropped from `rows` and forces `contiguous` false — a conservative default matching "we
 * can't prove it's contiguous". Computed at right-click time; the selection is small.
 */
function resolveSelectedRowsForContextMenu(
	decoratedRows: readonly GitGraphRow[],
	indexBySha: ReadonlyMap<string, number>,
	selectedShas: readonly string[],
): { rows: GitGraphRow[]; contiguous: boolean } {
	const rows: GitGraphRow[] = [];
	const indexes: number[] = [];
	for (const sha of selectedShas) {
		const index = indexBySha.get(sha);
		if (index == null) continue;

		rows.push(decoratedRows[index]);
		indexes.push(index);
	}

	let contiguous = indexes.length === selectedShas.length;
	if (contiguous) {
		indexes.sort((a, b) => a - b);
		for (let i = 1; i < indexes.length; i++) {
			if (indexes[i] !== indexes[i - 1] + 1) {
				contiguous = false;
				break;
			}
		}
	}
	return { rows: rows, contiguous: contiguous };
}

// Builds the display message for a WIP row. The label (worktree name) is appended in parens for
// secondary WIP rows; the primary row passes `undefined` and gets the bare base string.
function wipRowMessage(label: string | undefined): string {
	return label != null ? `Working Changes (${label})` : 'Working Changes';
}

// Builds a "lite" CommitDetails from a graph row so the details panel can paint the commit
// shell synchronously on selection — no IPC roundtrip required for the metadata bar/header.
// `files`/`stats` stay undefined and get filled in by the subsequent full fetch.
// committer is duplicated from author (graph row only carries one identity); the full fetch
// reconciles it. avatar is resolved synchronously from the host-supplied email→URL map so the
// embedded gl-commit-author doesn't flash its `person` fallback icon between selections; if the
// email isn't yet in the map, the full fetch will supply the URL.
function buildCommitLite(
	row: {
		sha: string;
		parents: string[];
		author: string;
		email: string;
		date: number;
		message: string;
		stashNumber?: string;
	},
	repoPath: string,
	avatars: GraphAvatars | undefined,
): CommitDetails {
	const date = new Date(row.date);
	const avatar = row.email ? avatars?.[row.email] : undefined;
	return {
		sha: row.sha,
		shortSha: row.sha.slice(0, 7),
		message: row.message,
		author: { name: row.author, email: row.email, date: date, avatar: avatar },
		committer: { name: row.author, email: row.email, date: date, avatar: avatar },
		parents: row.parents,
		// Carries the stash hint the details panel's `currentRef` reads to route file actions as stash
		// operations. Without it a selected stash resolves as an ordinary commit, which finds nothing and
		// leaves the action doing nothing at all — silently.
		stashNumber: row.stashNumber,
		repoPath: repoPath,
	};
}

declare global {
	// interface HTMLElementTagNameMap {
	// 	'gl-graph-wrapper': GlGraphWrapper;
	// }

	interface GlobalEventHandlersEventMap {
		// passing up event map
		'gl-graph-change-selection': CustomEvent<{
			selection: GraphSelection[];
			reachability?: GitCommitReachability;
			/** Per-sha commit shell (no files/stats) for synchronous first paint of the details panel. */
			commits?: Record<string, CommitDetails>;
			/** `true` = direct user intent on the graph (row click / keyboard select), as opposed to a
			 *  programmatic re-drive through {@link GlGraphWrapper.selectCommits}. */
			userIntent?: boolean;
		}>;
		'gl-graph-change-column-mode': CustomEvent<{ name: GraphColumnName; mode: ColumnMode | undefined }>;
		'gl-graph-change-visible-days': CustomEvent<{ top: number; bottom: number }>;
		'gl-graph-enable-changes-column': CustomEvent<void>;
		'gl-graph-filter-column': CustomEvent<{ zone: GraphZoneType }>;
		'gl-graph-mouse-leave': CustomEvent<void>;
		/** A jump that settled without landing on its row, and whose caller didn't opt out of feedback
		 *  (see {@link GraphNavigationOptions.feedback}). Never fires for a superseded navigation. */
		'gl-graph-navigation-failed': CustomEvent<{
			sha: string;
			source?: GraphNavigationSource;
			ref?: string;
			reason?: GraphNavigationFailureReason;
		}>;
		/** A navigation started a host row load for `sha` — fired once, when the walk begins. Consumers
		 *  can drive an interim "looking for…" affordance while `graphState.ensureLoading` is true; the
		 *  navigation settling with a hit fires no event of its own, so absence of a later
		 *  `gl-graph-navigation-failed` for the same sha (plus `ensureLoading` going back false) is what
		 *  says it landed. `feedback: false` mirrors the navigation's opt-out — the load still holds
		 *  `ensureLoading`, so consumers must clear any affordance keyed to an earlier load. */
		'gl-graph-navigation-loading': CustomEvent<{ sha: string; ref?: string; feedback: boolean }>;
		'gl-graph-row-context-menu': CustomEvent<{ graphZoneType: GraphZoneType; graphRow: GitGraphRow }>;
		'gl-graph-row-double-click': CustomEvent<{ graphRow: GitGraphRow; preserveFocus?: boolean }>;
		'gl-graph-row-hover': CustomEvent<{
			graphZoneType: GraphZoneType;
			graphRow: GitGraphRow;
			clientX: number;
			currentTarget: HTMLElement;
		}>;
		'gl-graph-row-unhover': CustomEvent<{
			graphZoneType: GraphZoneType;
			graphRow: GitGraphRow;
			relatedTarget: EventTarget | null;
		}>;
		/** Keyboard peek of the focused row's hover card (see `GlLitGraph.togglePeek`). `open` is an OUT
		 *  parameter the app writes back synchronously — the graph has no other view of the card's state. */
		'gl-graph-row-peek': CustomEvent<
			| { action: 'toggle' | 'reanchor'; graphRow: GitGraphRow; anchor: HTMLElement; open: boolean }
			| { action: 'close' }
		>;
		/** Re-dispatched upward (see `startRowHover`) so the app can arm its hover affordances. */
		rowhoverstart: CustomEvent<void>;
		/** Re-dispatched upward (see `onGraphRowHoverTrack`) to drive minimap row tracking. */
		rowhovertrack: CustomEvent<{
			graphZoneType: GraphZoneType;
			graphRow: GitGraphRow;
			/** Minimap-day override for synthetic WIP rows, whose own `date` tracks HEAD rather than history. */
			minimapDate?: number;
		}>;
	}
}

@customElement('gl-graph-wrapper')
export class GlGraphWrapper extends SignalWatcher(LitElement) {
	// use Light DOM
	protected override createRenderRoot(): HTMLElement | DocumentFragment {
		return this;
	}

	@consume({ context: graphStateContext, subscribe: true })
	private readonly graphState!: typeof graphStateContext.__context__;

	@consume({ context: graphCrossPaneContext })
	private readonly _crossPaneState!: GraphCrossPaneState;

	@consume({ context: ipcContext })
	private readonly _ipc!: typeof ipcContext.__context__;

	@consume({ context: telemetryContext as any })
	private readonly _telemetry!: TelemetryContext;

	scrollGraphBy(deltaY: number): void {
		// <gl-lit-graph>'s virtualizer (not the role="tree" container) owns the scroll, so go through
		// its imperative scroll method.
		this.querySelector('gl-lit-graph')?.scrollByDelta(deltaY);
	}

	/** Clears the graph's click-pinned ref focus, if any — called when the details panel's branch
	 *  sheet closes via any path so the pin never outlives the sheet. */
	clearRefFocus(): void {
		this.querySelector('gl-lit-graph')?.clearRefFocus();
	}

	/** Opens the graph's ref finder for graph-app's document-level `/` shortcut. `returnFocus` is the
	 *  element the keystroke came from, which the finder hands the keyboard back to on dismissal. */
	openRefFind(returnFocus?: HTMLElement): void {
		this.querySelector('gl-lit-graph')?.openRefFind(returnFocus);
	}

	/** Holds off the graph's Ctrl/Alt-hold lane dim until both are released — for graph-app's Ctrl- or
	 *  Alt-carrying non-lane shortcuts (search focus, the shortcut sheet, the chrome toggles), whose press
	 *  would otherwise dim the graph on the way to the action. */
	suppressModifierChainUntilRelease(): void {
		this.querySelector('gl-lit-graph')?.suppressModifierChainUntilRelease();
	}

	/** The GRAPH-ROW sha(s) of graph-app's inspection anchor (the single source of truth for what the
	 *  details panel shows). The wrapper DERIVES the row highlight from this each render
	 *  (`anchorShas ∩ renderableRows`), so the highlight is never stored/stale — it goes empty
	 *  when the anchor row isn't renderable (scope/visibility filter-out), and the details persist. */
	@property({ attribute: false })
	anchorShas?: readonly string[];

	/** The webview's key dispatcher, forwarded to `<gl-lit-graph>` so it can register the `rows` scope
	 *  and its bindings. Owned by `gl-graph-app`. */
	@property({ attribute: false })
	keymap?: KeymapDispatcher<GraphKeymapScope>;

	/** The current branch's merge-target tip + name (pulled client-side via the scope-anchor pipeline) —
	 *  forwarded straight through to `<gl-lit-graph>`, the one row-marker leg the client can't derive
	 *  locally. HEAD + the upstream tip are computed in gl-lit-graph. */
	@property({ attribute: false })
	rowMarkerMergeTarget?: { sha: string; name?: string };

	// Derived-highlight bookkeeping (see `getSelectedRowsProp`):
	// - `_hostSelectionRequest`: host-initiated selections (cold-start, search, deep-link, undo) arrive as a
	//   `graphState.selectedRows` whose CONTENT differs from the last one processed; the request is surfaced
	//   to the graph until the echo adopts it into the anchor, and expires if that never happens.
	// - `_derivedHighlightCache`: identity-cache so an unrelated re-render returns the SAME highlight object
	//   (the `selectedRows` prop diffs by identity, so a fresh object would churn the row grid). It
	//   misses on a new `decoratedRows` — i.e. on every rows push, when the grid is busiest — and is skipped
	//   outright while a request is pending, which is what `_lastSelectedRowsProp` backstops.
	// - `_lastSelectedRowsProp`: the object last RETURNED by `getSelectedRowsProp`, kept so a content-equal
	//   re-projection is handed back with its identity intact.
	private readonly _hostSelectionRequest = new GraphHostSelectionRequest(navigationTimeoutMs);
	private _lastSelectedRowsProp?: GraphSelectedRows;
	private _derivedHighlightCache?: {
		anchorShas: readonly string[] | undefined;
		decoratedRows: GitGraphRow[] | undefined;
		primaryWipRowId: string | undefined;
		result: GraphSelectedRows | undefined;
	};
	// sha→HOST row index (see `getSourceRowByShaMap`), cached on `graphState.rows` so it's built once per
	// page, not rebuilt over all rows on every selection/context-menu (the dominant per-call cost).
	private _sourceRowByShaCache?: { rows: GitGraphRow[]; map: ReadonlyMap<string, GitGraphRow> };
	// SHA indexes over the decorated set (including synthetic WIP rows), cached on the exact rows identity.
	// Selection, navigation, topological ranges, and context menus share this one O(rows) build.
	private _decoratedRowsIndexCache?: DecoratedRowsIndex;

	// Tracks the last observed `branchesVisibility` + repo so a genuine in-repo TOGGLE into `'current'`
	// (not the initial paint, not a repo switch) can refocus a hidden anchor.
	private _wasBranchesVisibility?: GraphBranchesVisibility;
	private _wasVisibilityRepository?: string;

	override connectedCallback(): void {
		super.connectedCallback?.();

		document.addEventListener('gl-jump-to-nearest-wip', this.onJumpToNearestWip as EventListener);
		document.addEventListener('gl-jump-to-commit', this.onJumpToCommit as EventListener);

		// A remount cancelled the retry timer but the shas it owed are still pending, and nothing else will
		// ask for them: the child graph keeps its `lastWipMissingKey` across the detach, so an identical
		// visible range after reconnect dedups the scan away. Re-arm so they drain instead of stranding.
		this.armWipStatsRetry();
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback?.();

		document.removeEventListener('gl-jump-to-nearest-wip', this.onJumpToNearestWip as EventListener);
		document.removeEventListener('gl-jump-to-commit', this.onJumpToCommit as EventListener);
		this.cancelPendingSelection();
		// Nothing will replay it, and a remount starts from whatever the host then pushes.
		this._deferredMoreRows = undefined;
		if (this._clearRowContextTimer != null) {
			clearTimeout(this._clearRowContextTimer);
			this._clearRowContextTimer = undefined;
		}
		if (this._wipStatsRetryTimer != null) {
			clearTimeout(this._wipStatsRetryTimer);
			this._wipStatsRetryTimer = undefined;
		}
		// The pending set and miss counts deliberately SURVIVE — `connectedCallback` re-arms the timer, so a
		// remount resumes the retry instead of dropping rows nothing else would ever ask about again.
	}

	// Reveal intent rides on the EVENT, not on the source: `gl-jump-to-commit` is dispatched by affordances
	// as different as a ref pill, a WIP row's neighbor button and the Pull popover, and only the dispatcher
	// knows whether its target is one row away or across the history.
	private onJumpToCommit = (
		e: CustomEvent<{ sha: string; focus?: boolean; reveal?: GraphRevealMode; flash?: boolean }>,
	) => {
		void this.navigateToCommit(e.detail.sha, {
			source: 'jump',
			focus: e.detail.focus,
			reveal: e.detail.reveal,
			flash: e.detail.flash,
		});
	};

	private onJumpToNearestWip = (
		e: CustomEvent<{
			fromSha: string;
			focus?: boolean;
			reveal?: GraphRevealMode;
			flash?: boolean;
			target?: 'primary' | 'nearest';
		}>,
	) => {
		// `target: 'primary'` (this graph's own row) skips the column/ancestry search entirely.
		if (e.detail.target === 'primary') {
			void this.navigateToWipRow(uncommitted, e.detail);

			return;
		}

		const rows = this.graphState.rows;
		// PEER rows only — the graph's own is passed separately below as the flagged `primaryWip`
		// candidate (keyed by `uncommitted`, which is what `navigateToCommit` resolves back to its row).
		// Filtered exactly as the decoration filters them, so the search can't target a peer whose row
		// isn't rendered (scope / branch visibility) — that jump would silently wait out its deferral.
		const peerWipRows = filterSecondariesForScopeAndVisibility(
			this.getPeerWipRows(),
			this.graphState.scope,
			this.graphState.branchesVisibility,
			this.graphState.includeOnlyRefs,
		);
		const primaryAnchor = this.graphState.branch?.sha;
		// The engine-side search is host-agnostic — it takes the primary WIP as a flagged candidate
		// rather than knowing GitLens' `uncommitted` sentinel. The flag is what wins its tie-breaks.
		const primaryWip: WipCandidate | undefined =
			primaryAnchor != null ? { sha: uncommitted, anchor: primaryAnchor, primary: true } : undefined;

		// Pull the lane map straight from gl-lit-graph (it derives its own columns from `processedRows`).
		// Undefined before it mounts, which keeps the BFS-ancestry fallback below as the safety net.
		const columnsBySha = this.querySelector('gl-lit-graph')?.getColumnsBySha();

		// Starting ON a WIP row (Shift+W from working changes): its sha is synthetic, so it's in neither
		// `rows` nor the column map and every strategy below would miss it. Search from its anchor commit
		// instead — the real row it sits on top of.
		const fromRow = this.getDecoratedRowByShaMap()?.get(e.detail.fromSha);
		const fromSha = (fromRow?.kind === 'workdir' ? fromRow.parents[0] : undefined) ?? e.detail.fromSha;

		// Primary strategy: pick the WIP in the same column as the clicked commit (the
		// "visual lane" the user sees). Exact-anchor match (clicked commit IS a branch tip
		// with a WIP) overrides — jumps directly to that branch's WIP regardless of column.
		let target = findWipInColumn(fromSha, rows, primaryWip, peerWipRows, columnsBySha);

		// Defensive fallback when column data for the clicked commit is unavailable — either
		// the cold-start window before the graph has laid out and exposed any columns, OR the brief partial-load
		// gap after scope change / paging where the clicked row is in `rows` but not yet in
		// the column map. Without this, clicks during the gap blindly snap to primary.
		// Once the column for the clicked commit lands, the column rule dominates.
		if (target == null && columnsBySha?.[fromSha] == null) {
			const wips: WipCandidate[] = [];
			if (primaryWip != null) {
				wips.push(primaryWip);
			}
			if (peerWipRows != null) {
				for (const [sha, row] of Object.entries(peerWipRows)) {
					if (row.parentSha != null) {
						wips.push({ sha: sha, anchor: row.parentSha });
					}
				}
			}
			target = findNearestWipByAncestry(fromSha, wips, rows);
		}

		// Last-resort: no in-column WIP and no ancestry match → jump to the primary (uncommitted).
		void this.navigateToWipRow(target ?? uncommitted, e.detail);
	};

	/** Run a nearest-WIP jump and report a miss to the graph's live region — the WIP row can be absent
	 *  (detached HEAD, a scope that excludes it) and a silent no-op there reads as a broken key. */
	private async navigateToWipRow(
		sha: string,
		options: { focus?: boolean; reveal?: GraphRevealMode; flash?: boolean },
	): Promise<void> {
		const result = await this.navigateToCommit(sha, {
			source: 'wip-jump',
			focus: options.focus,
			reveal: options.reveal,
			flash: options.flash,
			// This jump reads its own result and answers below; generic feedback on top would double it.
			feedback: false,
		});
		if (result.status === 'not-found') {
			this.querySelector('gl-lit-graph')?.announce('No working changes row to jump to.');
		}
	}

	// Cache keyed by (rows, wipRowsById, primaryRepoPath, scope, branchesVisibility,
	// includeOnlyRefs, branch.id + detached) — any reference change invalidates. Only the TOPOLOGY
	// plane is in the key: WIP row placement reads anchors/labels/branchRefs, never the hot state, so a
	// working-tree tick that only moves counts leaves this memo (and the whole decorated-rows identity
	// it gates) intact. `primaryRepoPath` is in the key because the synthesized primary WIP row's id is
	// derived from it. Scope must be
	// in the key because `filterSecondariesForScopeAndVisibility` reads `scope.branchRef`/`upstreamRef`/
	// `additionalBranchRefs` AND switches off the visibility filter entirely when scope is active,
	// AND `shouldShowPrimaryWipRow` reads `scope.branchRef` to enforce the "primary WIP belongs
	// only to the focal branch when focal === current" convention; `branchesVisibility` +
	// `includeOnlyRefs` + `currentBranchId`/`currentBranchDetached` must also be in the key because the
	// WIP-visibility helpers read them (`detached` feeds the detached-HEAD check; the branch's `name` is
	// never read) when the scope picker is in a non-`all` mode (current/smart/favorited/agents) AND when
	// no scope is active.
	private _decoratedRowsCache?: {
		rows: GitGraphRow[] | undefined;
		wipRowsById: GraphWipRowsById | undefined;
		primaryRepoPath: string | undefined;
		scope: GraphScope | undefined;
		branchesVisibility: typeof graphStateContext.__context__.branchesVisibility;
		includeOnlyRefs: typeof graphStateContext.__context__.includeOnlyRefs;
		// Keyed on the branch's id + detached rather than the `branch` object: the host re-creates that
		// object on every full-state push, so caching on its identity would defeat the memo entirely.
		currentBranchId: string | undefined;
		currentBranchDetached: boolean | undefined;
		result: { rows: GitGraphRow[] | undefined; showPrimary: boolean; primaryWipRowId: string | undefined };
	};

	// Stable `date` stamps for the synthesized WIP rows, keyed by row sha. `date` is an ENGINE input
	// (topology): re-stamping `Date.now()` on every interleave made every host push look like a
	// topology change to the engine's rows-delta classifier, defeating its append/payload fast
	// paths. Keep the stamp from when the WIP row first appeared at its current anchor; re-stamp only
	// when the anchor moves (checkout/commit — a real topology change anyway).
	private readonly _wipRowDates = new Map<string, { parentSha: string | undefined; date: number }>();
	private stableWipRowDate(sha: string, parentSha: string | undefined): number {
		const entry = this._wipRowDates.get(sha);
		if (entry != null && entry.parentSha === parentSha) return entry.date;

		const date = Date.now();
		this._wipRowDates.set(sha, { parentSha: parentSha, date: date });
		return date;
	}

	/** Builds one synthetic `workdir` row. Shared by the graph's own worktree and every peer — the two
	 *  differ only in where the row lands and whether it carries a worktree-name suffix. */
	private buildWipRow(sha: string, parentSha: string | undefined, label: string | undefined): GitGraphRow {
		return {
			sha: sha,
			parents: parentSha ? [parentSha] : [],
			author: '',
			email: '',
			date: this.stableWipRowDate(sha, parentSha),
			message: wipRowMessage(label),
			kind: 'workdir',
			heads: [],
			remotes: [],
			tags: [],
			// `contexts.row` is built on demand at right-click (see `buildRowContextMenuContext`).
		};
	}

	/** The graph's own worktree's WIP row id, or `undefined` before the repo path resolves. */
	private get primaryWipRowId(): string | undefined {
		const repoPath = this.getRepoPath();
		return repoPath != null ? createWipRowId(repoPath) : undefined;
	}

	/** `wipRowsById` minus the graph's own worktree — see {@link partitionOutPrimaryWipRow}. Memoized on
	 *  the map identity so the peer-only consumers (nearest-WIP jump, decorated rows) share one slice. */
	private _peerWipRowsCache?: {
		wipRowsById: GraphWipRowsById | undefined;
		primaryWipRowId: string | undefined;
		peers: GraphWipRowsById | undefined;
	};
	private getPeerWipRows(): GraphWipRowsById | undefined {
		const wipRowsById = this.graphState.wipRowsById;
		const primaryWipRowId = this.primaryWipRowId;

		const cached = this._peerWipRowsCache;
		if (cached != null && cached.wipRowsById === wipRowsById && cached.primaryWipRowId === primaryWipRowId) {
			return cached.peers;
		}

		const peers = partitionOutPrimaryWipRow(wipRowsById, primaryWipRowId);
		this._peerWipRowsCache = {
			wipRowsById: wipRowsById,
			primaryWipRowId: primaryWipRowId,
			peers: peers,
		};
		return peers;
	}

	// Injects a synthetic WIP row for the graph's own worktree at [0] and one per peer worktree
	// immediately above the commit it's anchored at, so the graph renders one row per worktree. Every
	// one of them is identified by `createWipRowId(<its worktree path>)`.
	private getDecoratedRows(): {
		rows: GitGraphRow[] | undefined;
		showPrimary: boolean;
		primaryWipRowId: string | undefined;
	} {
		const { graphState } = this;
		const rows = graphState.rows;
		const wipRowsById = graphState.wipRowsById;
		const scope = graphState.scope;
		const branchesVisibility = graphState.branchesVisibility;
		const includeOnlyRefs = graphState.includeOnlyRefs;
		const currentBranch = graphState.branch;
		const currentBranchId = currentBranch?.id;
		const currentBranchDetached = currentBranch?.detached;

		const primaryRepoPath = this.getRepoPath();

		const cached = this._decoratedRowsCache;
		if (
			cached != null &&
			cached.rows === rows &&
			cached.wipRowsById === wipRowsById &&
			cached.primaryRepoPath === primaryRepoPath &&
			cached.scope === scope &&
			cached.branchesVisibility === branchesVisibility &&
			cached.includeOnlyRefs === includeOnlyRefs &&
			cached.currentBranchId === currentBranchId &&
			cached.currentBranchDetached === currentBranchDetached
		) {
			// Return the cached `result` identity-stable — downstream caches (present-sha set,
			// row-by-sha map, gl-lit-graph's own dirty-check) all key on its `rows` reference,
			// so a hit here also short-circuits their rebuilds, not just the interleave work.
			if (DEBUG) {
				getGraphDebugDiagnostics().transferRowsApplied(rows, cached.result.rows);
			}
			return cached.result;
		}

		// Only consulted when the branch payload is missing — a known branch answers authoritatively.
		const scopeFocalIsHead = currentBranch == null ? isScopeFocalHead(rows, scope) : undefined;
		// The row's id IS its worktree path, so an unresolved repo path means there's no row to
		// synthesize yet — the next render (once `repositories`/`selectedRepository` land) shows it.
		const primaryWipRowId = primaryRepoPath != null ? createWipRowId(primaryRepoPath) : undefined;
		// One uniform plane, two PLACEMENT rules — the only place the primary still forks. Every worktree's
		// row is built the same way from the same record; the graph's own is pinned at [0] and anchored via
		// the rows' HEAD decoration (so it survives a scope re-root, and shows even when HEAD isn't in the
		// loaded page), while peers are interleaved above their own `parentSha` and dropped when it isn't
		// anchorable. Their VISIBILITY rules differ for the same reason: the primary belongs to HEAD, peers
		// to their branch. Partitioning on the row id also guarantees the two can't emit the same sha twice.
		const peerWipRows = partitionOutPrimaryWipRow(wipRowsById, primaryWipRowId);
		const showPrimary =
			primaryWipRowId != null &&
			shouldShowPrimaryWipRow(branchesVisibility, includeOnlyRefs, currentBranch, scope, scopeFocalIsHead);

		const filteredPeers = filterSecondariesForScopeAndVisibility(
			peerWipRows,
			scope,
			branchesVisibility,
			includeOnlyRefs,
		);

		// The engine never auto-injects a primary WIP row, so whenever one should show we must
		// synthesize it here — not only when peers force the interleave path.
		const hasSecondaryWips = filteredPeers != null && Object.keys(filteredPeers).length > 0;
		let resultRows: GitGraphRow[] | undefined;
		if (rows != null && (hasSecondaryWips || showPrimary)) {
			// Anchor the primary on the SAME row the scope re-root projection roots its spine at — that
			// walk resolves the focal tip by branch NAME (`computeScopeAnchors`) while this one uses the
			// `isCurrentHead` flag, and `computeScopeProjection` drops any workdir row whose parent isn't
			// on the resulting spine. With a KNOWN branch, the scope gate in `shouldShowPrimaryWipRow`
			// guarantees focal === current, so both resolve the same row — preferring the name match makes
			// that agreement structural instead of coincidental. With an UNKNOWN branch the gate was
			// skipped, so nothing established focal === current — require the branch here too, falling
			// back to `isCurrentHead`: that anchors at true HEAD (still the focal tip when the scope IS
			// the current branch) and lets the projection drop the row when the scope isn't.
			//
			// The unscoped fallbacks: when HEAD's row isn't in the loaded page (`isCurrentHead` is per-row
			// decoration, so it can't resolve), the host's WIP topology record carries the worktree's real
			// HEAD sha — anchoring there gives the engine an unloaded parent it handles honestly (reserved
			// lane + dangling stub that connects when HEAD pages in), instead of adopting `rows[0]`'s chain.
			// The positional `rows[0]` guess survives only for the cold window before that record arrives.
			// Under a scope neither is used: guessing a lane there is exactly how the row lands somewhere it
			// doesn't belong — a parentless row the projection drops is the honest outcome instead.
			const headRefSha =
				(showPrimary && scope?.branchName != null && currentBranch != null
					? rows.find(r => r.heads?.some(h => h.name === scope.branchName))?.sha
					: undefined) ??
				rows.find(r => r.heads?.some(h => h.isCurrentHead))?.sha ??
				(scope == null
					? ((primaryWipRowId != null ? wipRowsById?.[primaryWipRowId]?.parentSha : undefined) ??
						rows[0]?.sha)
					: undefined);

			// The primary row's ID is its worktree's WIP row id — the SAME scheme every other worktree's
			// WIP row uses (`createWipRowId`). Its `type` stays `'workdir'` (the row type). No label
			// suffix: the graph's own worktree is the implicit subject, so naming it would be noise.
			const primary: GitGraphRow | undefined =
				showPrimary && primaryWipRowId != null
					? this.buildWipRow(primaryWipRowId, headRefSha, undefined)
					: undefined;

			// Single-worktree case (no peers to place): the result is just the primary ahead of the host
			// rows, so skip the index map and the interleave walk below — both are O(loaded) per cache miss.
			if (!hasSecondaryWips) {
				resultRows = primary != null ? [primary, ...rows] : rows.slice();
			} else {
				// Group peer WIP rows by the index of their parent commit in `rows`, so each
				// worktree's WIP row renders directly above the commit it's anchored at. Worktrees whose
				// HEAD isn't in the loaded/visible rows (hidden branch, beyond paging limit) are dropped —
				// a floating WIP row with no anchor in the graph is more confusing than missing one.
				const rowIndexBySha = new Map<string, number>();
				for (let i = 0; i < rows.length; i++) {
					rowIndexBySha.set(rows[i].sha, i);
				}

				const secondariesByParentIdx = new Map<number, GitGraphRow[]>();
				for (const [sha, wipRow] of Object.entries(filteredPeers ?? {})) {
					const idx = wipRow.parentSha != null ? rowIndexBySha.get(wipRow.parentSha) : undefined;
					if (idx == null) continue;

					const row = this.buildWipRow(sha, wipRow.parentSha, wipRow.label);
					const existing = secondariesByParentIdx.get(idx);
					if (existing != null) {
						existing.push(row);
					} else {
						secondariesByParentIdx.set(idx, [row]);
					}
				}

				const interleaved: GitGraphRow[] = primary != null ? [primary] : [];
				for (let i = 0; i < rows.length; i++) {
					const atThisIdx = secondariesByParentIdx.get(i);
					if (atThisIdx != null) {
						interleaved.push(...atThisIdx);
					}
					interleaved.push(rows[i]);
				}

				resultRows = interleaved;
			}
		} else {
			// Nothing to synthesize — pass the host rows through (fresh array so the decorated
			// generation's identity stays distinct from `graphState.rows`).
			resultRows = rows?.slice();
		}

		// Cache the `result` for re-use on subsequent renders with identical inputs. The engine
		// never mutates the rows it receives, so the cached array is handed to it directly.
		const result = { rows: resultRows, showPrimary: showPrimary, primaryWipRowId: primaryWipRowId };
		if (DEBUG) {
			// Host rows are decorated into a new identity before the engine sees them. Carry the
			// rows-plane timestamp across that boundary so the render metric follows the actual array.
			getGraphDebugDiagnostics().transferRowsApplied(rows, resultRows);
		}
		this._decoratedRowsCache = {
			rows: rows,
			wipRowsById: wipRowsById,
			primaryRepoPath: primaryRepoPath,
			scope: scope,
			branchesVisibility: branchesVisibility,
			includeOnlyRefs: includeOnlyRefs,
			currentBranchId: currentBranchId,
			currentBranchDetached: currentBranchDetached,
			result: result,
		};
		return result;
	}

	// Memoization for `getRunningOperationByRowSha`: every wrapper render would otherwise build a
	// fresh Map (new identity), which cascades into Lit @property updates → invalidate-event-driven
	// adornment re-resolve. Cached on the only input that drives the translation (the registry signal's
	// value identity — a WIP anchor's row id derives from its OWN repoPath, so the graph's selected repo
	// doesn't enter into it) so unrelated wrapper re-renders return the same Map instance and stop the
	// churn at the prop boundary.
	private _runningOperationByRowShaCache?: {
		registry: ReadonlyMap<AnchorKey, RunningOperationBucket>;
		byRowSha: ReadonlyMap<string, RunningOperationBucket> | undefined;
	};

	/** Translates the canonical anchor-keyed `runningOperations` registry from the cross-pane
	 *  context into a row-sha-keyed bucket map the row renderer can look up directly. WIP anchors
	 *  only — commit/multi-commit anchors don't decorate graph rows. Memoized on the registry
	 *  identity; see {@link _runningOperationByRowShaCache}. */
	private getRunningOperationByRowSha(): ReadonlyMap<string, RunningOperationBucket> | undefined {
		const runningOperations = this._crossPaneState?.runningOperations.get();
		if (runningOperations == null) return undefined;

		const cached = this._runningOperationByRowShaCache;
		if (cached?.registry === runningOperations) return cached.byRowSha;

		let byRowSha: ReadonlyMap<string, RunningOperationBucket> | undefined;
		if (runningOperations.size === 0) {
			byRowSha = undefined;
		} else {
			const next = new Map<string, RunningOperationBucket>();
			for (const bucket of runningOperations.values()) {
				// Any kind in the bucket has the same anchor (the bucket is per-anchor), so
				// derive repoPath from whichever is set.
				const anchor = (bucket.review ?? bucket.compose ?? bucket.resolve)?.anchor;
				if (anchor?.kind !== 'wip') continue;

				next.set(createWipRowId(anchor.repoPath), bucket);
			}
			byRowSha = next;
		}
		this._runningOperationByRowShaCache = { registry: runningOperations, byRowSha: byRowSha };
		return byRowSha;
	}

	// The selected repo's path only changes on repo switch, but `render()` reads it every render
	// (selection/hover/paging/theme). Cache it on the `(repositories, selectedRepository)` identity so
	// the `repos.find` scan doesn't re-run on unrelated re-renders.
	private _repoPathCache?: {
		repositories: typeof graphStateContext.__context__.repositories;
		selectedRepository: typeof graphStateContext.__context__.selectedRepository;
		path: string | undefined;
	};
	private getRepoPath(): string | undefined {
		const { repositories, selectedRepository } = this.graphState;
		const cached = this._repoPathCache;
		if (
			cached != null &&
			cached.repositories === repositories &&
			cached.selectedRepository === selectedRepository
		) {
			return cached.path;
		}

		const path = getSelectedRepoPath(this.graphState);
		this._repoPathCache = { repositories: repositories, selectedRepository: selectedRepository, path: path };
		return path;
	}

	// Memoization for `getAgentStatusByRowSha`: agent state and WIP metadata both update
	// independently of other render triggers (selection, hover, theme), so caching on the three
	// inputs that actually drive the row→agent mapping keeps the prop identity stable and stops
	// the invalidate-event churn at the prop boundary.
	private _agentStatusByRowShaCache?: {
		agentSessions: typeof graphStateContext.__context__.agentSessions | undefined;
		wipRowsById: GraphWipRowsById | undefined;
		primaryRepoPath: string | undefined;
		byRowSha: ReadonlyMap<string, WipRowAgentStatus> | undefined;
	};

	/** Maps each WIP row's sha → the worst-priority agent status running in that worktree. Every row is
	 *  matched against its own `wipRowsById[sha].repoPath`, keyed against the graph's repo family
	 *  (`primaryRepoPath`). Returns `undefined` when no WIP row has a surfacing agent so the row
	 *  renderer can skip the indicator path entirely. */
	private getAgentStatusByRowSha(): ReadonlyMap<string, WipRowAgentStatus> | undefined {
		const agentSessions = this.graphState.agentSessions;
		const wipRowsById = this.graphState.wipRowsById;

		const primaryRepoPath = this.getRepoPath();

		const cached = this._agentStatusByRowShaCache;
		if (
			cached?.agentSessions === agentSessions &&
			cached.wipRowsById === wipRowsById &&
			cached.primaryRepoPath === primaryRepoPath
		) {
			return cached.byRowSha;
		}

		let byRowSha: ReadonlyMap<string, WipRowAgentStatus> | undefined;
		const index = indexAgentSessionsByRepoAndWorktree(agentSessions);
		if (index == null || index.size === 0) {
			byRowSha = undefined;
		} else {
			const next = new Map<string, WipRowAgentStatus>();

			// One pass over every WIP row — the graph's own worktree included, since it's an ordinary
			// entry now. The sha encodes the worktree path; `row.repoPath` is the same value but read
			// directly to avoid parsing. Falls back to synthesizing the graph's own row when the worktree
			// enumeration hasn't landed (or couldn't run), so its indicator never waits on that.
			if (primaryRepoPath != null) {
				const worktreePaths = new Map<string, string>();
				const primaryWipRowId = createWipRowId(primaryRepoPath);
				worktreePaths.set(primaryWipRowId, primaryRepoPath);
				for (const [sha, row] of Object.entries(wipRowsById ?? {})) {
					if (row?.repoPath == null) continue;

					worktreePaths.set(sha, row.repoPath);
				}

				for (const [sha, worktreePath] of worktreePaths) {
					const matches = matchAgentSessionsForWorktree(index, {
						repoPath: primaryRepoPath,
						worktreePath: worktreePath,
					});
					const status = pickWipRowAgentStatus(matches);
					if (status != null) {
						next.set(sha, status);
					}
				}
			}

			byRowSha = next.size > 0 ? next : undefined;
		}

		this._agentStatusByRowShaCache = {
			agentSessions: agentSessions,
			wipRowsById: wipRowsById,
			primaryRepoPath: primaryRepoPath,
			byRowSha: byRowSha,
		};
		return byRowSha;
	}

	/** Identity guard over {@link computeSelectedRowsProp}: hand back the SAME object whenever the newly
	 *  computed projection has equal CONTENT, so the prop's identity survives (a) a rows push, which
	 *  invalidates `_derivedHighlightCache` through `decoratedRows` even though the selection never moved,
	 *  and (b) a pending host request, which bypasses that cache on EVERY render. Consumers diff this prop
	 *  by identity: `<gl-lit-graph>` reads a re-ship as a change of selection, rebuilding its `selectedShas`
	 *  set and re-rendering on every graph update. Cheap: `areEqual`'s `a === b` fast path covers the steady
	 *  state, and the records hold 0-1 keys. */
	private getSelectedRowsProp(
		decoratedRows: GitGraphRow[] | undefined,
		primaryWipRowId: string | undefined,
	): GraphSelectedRows | undefined {
		const next = this.computeSelectedRowsProp(decoratedRows, primaryWipRowId);
		const prev = this._lastSelectedRowsProp;
		if (next !== prev && areEqual(next, prev)) return prev;

		this._lastSelectedRowsProp = next;
		return next;
	}

	/**
	 * The `selectedRows` prop handed to the graph. Projects the inspection anchor into a row highlight,
	 * so a selection the host pushed (or an anchor whose row isn't loaded yet) still reads as selected.
	 * The derived highlight is `anchorShas ∩ renderableRows`, so it goes empty when the anchor row is
	 * filtered out (graph shows nothing, details persist). A host request (cold-start, search, deep-link)
	 * is surfaced until the echo adopts it as the anchor, after which `derived` matches and takes over.
	 */
	private computeSelectedRowsProp(
		decoratedRows: GitGraphRow[] | undefined,
		primaryWipRowId: string | undefined,
	): GraphSelectedRows | undefined {
		this._hostSelectionRequest.sync(this.graphState.selectedRows);

		const anchorShas = this.anchorShas;
		const pending = this._hostSelectionRequest.pending;

		// Fast path / identity cache: in the steady state (no pending request) return the SAME highlight
		// object when the inputs are unchanged, so unrelated re-renders (hover/scroll/theme) don't churn
		// the prop. Skips the O(rows) `present` Set build entirely when nothing is highlighted.
		// Compare `anchorShas` by CONTENT, not reference: graph-app's `activeAnchorShas` getter returns a
		// freshly-allocated array each parent render, so a reference check would miss the cache every time.
		const cache = this._derivedHighlightCache;
		if (
			pending == null &&
			cache != null &&
			cache.decoratedRows === decoratedRows &&
			cache.primaryWipRowId === primaryWipRowId &&
			areArraysEqual(cache.anchorShas, anchorShas)
		) {
			return cache.result;
		}

		// Reuse the shared decorated-row SHA index rather than building a selection-only Set. The primary
		// WIP row is still projected separately because callers pass its id only when it should render.
		const present = this.getDecoratedRowsIndex(decoratedRows)?.rowBySha;

		const derived = projectShasToSelectedRows(anchorShas, present, primaryWipRowId);
		this._derivedHighlightCache = {
			anchorShas: anchorShas,
			decoratedRows: decoratedRows,
			primaryWipRowId: primaryWipRowId,
			result: derived,
		};

		if (pending == null) return derived;
		// The anchor adopted the request — drop it; the derived highlight takes over.
		if (this._hostSelectionRequest.adopt(derived)) return derived;

		// Surface the request only while its row is renderable; otherwise keep the anchor's highlight (the
		// host's ensure/paging path loads it, then `derived` resolves on a later frame).
		const surfaced = projectShasToSelectedRows(Object.keys(pending), present, primaryWipRowId);
		if (surfaced == null) {
			// Only an unsurfaced request ages: the bound exists for a row that never becomes renderable, and
			// a bootstrap selection is never adopted into the anchor, so an absolute age would erase it.
			this._hostSelectionRequest.expireIfWaiting();
			return derived;
		}

		this._hostSelectionRequest.touch();
		return surfaced;
	}

	override render() {
		const { graphState } = this;
		const { rows: decoratedRows, showPrimary, primaryWipRowId } = this.getDecoratedRows();

		// Gate the Changes-column stats props on the column being visible AND its stats consent enabled:
		// a hidden OR dormant (opt-in pending) column must get zero stats-driven re-renders (the host
		// ships rowsStats/rowsStatsLoading regardless). The engine's own zones may briefly lag this host
		// `isHidden` during an in-flight local columns write; it self-heals on that write's echo, so any
		// transient stats prop is harmless.
		const changesColumnVisible = graphState.columns?.changes?.isHidden !== true;
		const changesColumnActive = changesColumnVisible && (graphState.config?.changesColumnEnabled ?? true);
		return html`<gl-lit-graph
			.rows=${decoratedRows}
			.avatars=${graphState.avatars}
			.changesColumnEnabled=${graphState.config?.changesColumnEnabled ?? true}
			.rowsStats=${changesColumnActive ? graphState.rowsStats : undefined}
			?rowsStatsLoading=${changesColumnActive && (graphState.rowsStatsLoading ?? false)}
			.selectedRows=${this.getSelectedRowsProp(decoratedRows, showPrimary ? primaryWipRowId : undefined)}
			.refsMetadata=${graphState.refsMetadata}
			.refsMetadataResetToken=${graphState.refsMetadataResetToken}
			.enabledRefMetadataTypes=${graphState.config?.enabledRefMetadataTypes}
			.searchResults=${graphState.searchResults}
			.searching=${graphState.searching}
			.searchMode=${graphState.searchMode}
			.config=${graphState.config}
			.downstreams=${graphState.downstreams}
			.columns=${graphState.columns}
			.columnsRevision=${graphState.columnsRevision ?? 0}
			.activeFilterColumns=${graphState.activeFilterColumns}
			.repoPath=${this.getRepoPath()}
			.columnsContext=${graphState.context?.header}
			.settingsContext=${graphState.context?.settings}
			.scrollMarkersContext=${graphState.context?.scrollMarkers}
			.excludeRefs=${graphState.excludeRefs}
			.excludeTypes=${graphState.excludeTypes}
			.includeOnlyRefs=${graphState.includeOnlyRefs}
			.pinnedRef=${graphState.pinnedRef}
			.currentUpstream=${graphState.branchState?.upstream}
			.currentBranch=${graphState.branch}
			.scope=${graphState.scope}
			.wipStateById=${graphState.wipStateById}
			.rowMarkerMergeTarget=${this.rowMarkerMergeTarget}
			.keymap=${this.keymap}
			.primaryWipRowId=${showPrimary ? primaryWipRowId : undefined}
			.runningOperationByRowSha=${this.getRunningOperationByRowSha()}
			.agentStatusByRowSha=${this.getAgentStatusByRowSha()}
			?loading=${graphState.loading || graphState.ensureLoading || graphState.scopeLoading}
			.hasMore=${(graphState.paging?.hasMore ?? true) && !this.filterResultsExhausted}
			?windowFocused=${graphState.windowFocused}
			@gl-graph-changeselection=${this.onGraphSelectionChanged}
			@gl-graph-rowdoubleclick=${this.onGraphRowDoubleClick}
			@gl-graph-refdoubleclick=${this.onGraphRefDoubleClick}
			@gl-graph-contextmenu=${this.onGraphContextMenu}
			@gl-graph-morerows=${this.onGraphMoreRows}
			@gl-graph-changevisibledays=${this.onGraphVisibleDaysChanged}
			@gl-graph-visiblewipshaschanged=${this.onVisibleWipShasChanged}
			@gl-graph-wipshasmissingstats=${this.onWipShasMissingStats}
			@gl-graph-missingavatars=${this.onGraphMissingAvatars}
			@gl-graph-avatarloaderror=${this.onGraphAvatarLoadError}
			@gl-graph-missingrefsmetadata=${this.onGraphMissingRefsMetadata}
			@gl-graph-scopeanchorsunreachable=${this.onScopeAnchorsUnreachable}
			@gl-graph-changecolumns=${this.onColumnsChanged}
			@gl-graph-rowhoverstart=${this.onGraphRowHoverStart}
			@gl-graph-rowhovertrack=${this.onGraphRowHoverTrack}
			@gl-graph-rowhover=${this.onGraphRowHover}
			@gl-graph-rowpeek=${this.onGraphRowPeek}
			@gl-graph-rowunhover=${this.onGraphRowUnhover}
			@gl-graph-rowaction=${this.onGraphRowAction}
			@gl-graph-unpinref=${this.onGraphUnpinRef}
			@gl-graph-wiprowopen=${this.onGraphWipRowOpen}
			@gl-graph-mouseleave=${this.onMouseLeave}
		></gl-lit-graph>`;
	}

	override updated(changedProperties: Map<PropertyKey, unknown>): void {
		super.updated(changedProperties);
		// Selecting a peer WIP row has to add its watcher even when the viewport didn't move (and clear it
		// again when the selection leaves); the visible-set event alone only fires on scroll.
		const selectedPeerWip = this.selectedPeerWipSha;
		if (selectedPeerWip !== this._lastSelectedPeerWipSha) {
			this._lastSelectedPeerWipSha = selectedPeerWip;
			this.syncWipWatches();
		}
		this.flushPendingSelect();
		this.refocusOnEnteringCurrentVisibility();
		// LAST, after everything here that can start a row load: `refocusOnEnteringCurrentVisibility` may
		// navigate to an unloaded row, and the host cancels a pending rows query whose id differs — so the
		// replay has to see that navigation in `rowLoadInFlight` and re-park rather than race it. Deferring
		// is free; a cancelled walk is not.
		this.replayDeferredUnreachableAnchors();
		// AFTER the anchor replay so a targeted anchor walk wins the gate: it's starvation-prone (attempt
		// budget, parked on a no-progress response), while a generic row page re-parks for free.
		this.replayDeferredMoreRows();
	}

	/** When the user switches to `branchesVisibility: 'current'`, a SECONDARY-worktree WIP anchor is
	 *  always hidden (it lives on another branch), so refocus the inspection anchor onto the current
	 *  branch's WIP-or-tip. (Scope-to-branch already always-jumps; this is the lighter visibility-toggle
	 *  case, which only jumps when the anchor is hidden.) Primary-WIP / commit anchors that survive
	 *  `'current'` stay; an off-branch commit anchor falls to the empty-highlight safety net. */
	private refocusOnEnteringCurrentVisibility(): void {
		const visibility = this.graphState.branchesVisibility;
		const repository = this.graphState.selectedRepository;
		const prevVisibility = this._wasBranchesVisibility;
		const prevRepository = this._wasVisibilityRepository;
		this._wasBranchesVisibility = visibility;
		this._wasVisibilityRepository = repository;

		// Only act on a genuine in-repo TOGGLE into 'current'. Skip the initial paint (no prior value)
		// and a repo switch — both can carry a stale cross-repo anchor while the new repo's persisted
		// 'current' arrives, which would auto-select against the wrong anchor on first paint.
		if (prevVisibility == null || repository !== prevRepository) return;
		if (visibility !== 'current' || prevVisibility === 'current') return;

		// Only a PEER worktree's WIP anchor is unconditionally hidden by `'current'`; the graph's own
		// WIP row survives it.
		const anchorShas = this.anchorShas;
		if (anchorShas?.length !== 1) return;

		const anchorWorktreePath = getWipRowWorktreePath(anchorShas[0]);
		if (anchorWorktreePath == null || anchorWorktreePath === this.getRepoPath()) return;

		const target = this.getCurrentBranchSelectionSha();
		if (target == null || anchorShas.includes(target)) return;

		void this.navigateToCommit(target, { source: 'visibility', reveal: 'if-changed' });
	}

	/** The current branch's graph-row sha to select (its WIP if it renders under the active filters,
	 *  else its tip), via the shared overview-selection cascade. */
	private getCurrentBranchSelectionSha(): string | undefined {
		const branch = this.graphState.branch;
		if (branch == null) return undefined;

		return getOverviewBranchSelectionSha(
			{ id: branch.id ?? '', repoPath: branch.repoPath, opened: true, reference: { sha: branch.sha } },
			{
				wipRowsById: this.graphState.wipRowsById,
				primaryWipRowId: this.primaryWipRowId,
				rows: this.graphState.rows,
				branchesVisibility: this.graphState.branchesVisibility,
				includeOnlyRefs: this.graphState.includeOnlyRefs,
				scope: this.graphState.scope,
				currentBranch: branch,
			},
		);
	}

	override focus(): void {
		// Query the `<gl-lit-graph>` element (light DOM) and focus its keyboard-nav viewport directly.
		this.querySelector<HTMLElement>('gl-lit-graph')?.focus();
	}

	getCommits(shas: string[]): ReadonlyGraphRow[] {
		const rowBySha = this.getDecoratedRowByShaMap();
		if (rowBySha == null) return [];

		// A returned row is loaded; report `hidden` from the graph's displayed set so the consumer can
		// tell loaded-&-visible (fast select) from loaded-but-hidden — a collapsed lane, an active search
		// filter, or a scope drop (→ the "result hidden" warning). When the element isn't mounted, assume
		// visible (the row is loaded — never report `undefined`, which the consumer reads as "not loaded").
		const result: ReadonlyGraphRow[] = [];
		const seen = new Set<string>();
		for (const sha of shas) {
			if (seen.has(sha)) continue;

			seen.add(sha);
			const row = rowBySha.get(sha);
			if (row != null) {
				result.push(this.withVisibility(row));
			}
		}
		return result;
	}

	/** Resolve once this wrapper AND the underlying `<gl-lit-graph>` have flushed any pending render, so a
	 *  caller that then reads post-render state (row visibility via getCommits/selectCommits →
	 *  isRowDisplayed) sees the up-to-date displayRows after newly-paged rows land. */
	async ensureRendered(): Promise<void> {
		await this.updateComplete;
		await this.querySelector('gl-lit-graph')?.updateComplete;
	}

	selectCommits(shas: string[], options?: SelectCommitsOptions): ReadonlyGraphRow[] {
		// A direct selection is newer user/app intent than any queued targeted navigation. Without this,
		// details/minimap selections can be overwritten when an older LoadRowRequest finally renders.
		this.cancelPendingSelection();
		const rows = this.selectCommitsCore(shas);
		// `ensureVisible` is opt-in: scroll the (first) selected row into view ONLY when the caller asks
		// (search-result nav, etc.) — a plain selection never auto-scrolls.
		if (options?.ensureVisible && shas.length > 0) {
			this.querySelector('gl-lit-graph')?.scrollToSha(shas[0], {
				mode: options.reveal ?? 'always',
				flash: options.flash === true,
			});
		}
		return rows;
	}

	/**
	 * Select rows in the commit-graph engine: pushing a new `graphState.selectedRows` map is enough
	 * to highlight the row and move the focus index. We also fire the standard
	 * `gl-graph-change-selection` host event + IPC update so the details panel, minimap, and
	 * host-side selection cache stay consistent — same as if the user had clicked the row themselves.
	 */
	private selectCommitsCore(
		shas: string[],
		rowBySha: ReadonlyMap<string, GitGraphRow> | undefined = this.getDecoratedRowByShaMap(),
	): ReadonlyGraphRow[] {
		if (rowBySha == null) return [];

		const matched: GitGraphRow[] = [];
		const seen = new Set<string>();
		for (const sha of shas) {
			if (seen.has(sha)) continue;

			seen.add(sha);
			const row = rowBySha.get(sha);
			if (row != null) {
				matched.push(row);
			}
		}
		if (matched.length === 0) return [];

		const next: GraphSelectedRows = {};
		for (const row of matched) {
			next[row.sha] = true;
		}
		this.graphState.selectedRows = next;

		// Surface the same selection event a real click would. This is what wires the
		// minimap-day-selected → details-panel and selection-state-cache flows.
		const wipRowsById = this.graphState.wipRowsById;
		const focusedRow = matched[0];
		const sha = focusedRow.sha;
		const selection: GraphSelection[] = [
			{
				id: sha,
				type: focusedRow.kind,
				active: true,
				hidden: false,
				// The row id IS the worktree path for a WIP row; `wipRowsById` is the un-normalized form.
				repoPath: getWipRowWorktreePath(sha) ?? wipRowsById?.[sha]?.repoPath,
			},
		];

		this.graphState.activeRow = `${focusedRow.sha}|${focusedRow.date}`;
		this.graphState.activeDay = this.dateForMinimapRow(focusedRow);

		let commits: Record<string, CommitDetails> | undefined;
		if (focusedRow.kind !== 'workdir') {
			const fallbackRepoPath = getSelectedRepoPath(this.graphState);
			if (fallbackRepoPath != null) {
				commits = { [focusedRow.sha]: buildCommitLite(focusedRow, fallbackRepoPath, this.graphState.avatars) };
			}
		}

		// Decode the focused row's reachability from the graph's shared table — via the HOST row (the
		// synthetic WIP shas `getDecoratedRows` injects aren't in `graphState.rows`, so this naturally
		// stays undefined for them).
		const sourceFocusedRow = this.getSourceRowByShaMap()?.get(focusedRow.sha);
		const reachability =
			sourceFocusedRow != null ? this.graphState.getRowReachability(sourceFocusedRow) : undefined;

		this.dispatchEvent(
			new CustomEvent('gl-graph-change-selection', {
				detail: { selection: selection, reachability: reachability, commits: commits },
			}),
		);

		this._lastSentSelectionKey = selection.map(s => `${s.id}|${s.active ? 1 : 0}|${s.hidden ? 1 : 0}`).join(',');
		this._ipc.sendCommand(UpdateSelectionCommand, { selection: selection });

		// Matched rows are loaded; report `hidden` from the displayed set (see getCommits) so the search-nav
		// "result hidden" warning fires for a loaded-but-not-displayed match.
		return matched.map(row => this.withVisibility(row));
	}

	private withVisibility(row: GitGraphRow): ReadonlyGraphRow {
		const lit = this.querySelector('gl-lit-graph');
		return { ...row, hidden: lit != null ? !lit.isRowDisplayed(row.sha) : false };
	}

	/**
	 * A navigation whose row wasn't renderable yet.
	 *
	 * `scrollToSha` already defers the REVEAL until a row appears, but selection had no equivalent, so a
	 * row that materializes late — a WIP row the next `getDecoratedRows` synthesizes, or a commit the host
	 * pages in — got scrolled to without ever being selected. Callers that set the details anchor first
	 * masked it; the scope, overview and jump paths don't all do that.
	 *
	 * Held as an INTENT, not a retry loop: the newest one wins, and any
	 * user-originated selection cancels it outright — a queued jump must never overwrite a click the user
	 * made while waiting for it.
	 */
	private readonly _selectIntent = new GraphSelectIntent(navigationTimeoutMs);
	private _selectIntentRepositoryId?: string;
	private _selectIntentRepoPath?: string;
	private _endEnsureLoading?: () => void;
	private _pendingNavigation?: PendingGraphNavigation;

	private cancelPendingSelection(): void {
		this._selectIntent.cancel();
		this._selectIntentRepositoryId = undefined;
		this._selectIntentRepoPath = undefined;
		this.settlePendingNavigation({ status: 'cancelled' });
		this.querySelector('gl-lit-graph')?.cancelPendingReveal();
	}

	private settlePendingNavigation(result: GraphNavigationResult): void {
		const pending = this._pendingNavigation;
		if (pending == null) return;

		this._pendingNavigation = undefined;
		// A superseded/aborted/timed-out navigation leaves the host walking the whole repository for a row
		// nobody awaits — withdraw it. Harmless if the host already finished: it only cancels a query still
		// matching this id.
		if (pending.hostLoadSha != null && result.status !== 'selected') {
			this._ipc.sendCommand(CancelLoadRowCommand, { id: pending.hostLoadSha });
		}
		// A row that can't be found won't become renderable on its own, so drop a host highlight request
		// naming it. Keyed to this sha, and never on 'cancelled' — there a newer owner has taken over and
		// may have armed its own request.
		if (result.status === 'not-found') {
			this._hostSelectionRequest.rejectFor(pending.sha);
		}
		// The ref-find reveal watch is scoped to THIS load; EVERY exit ends it, `selected` included.
		// Measured: left armed, the watch re-reveals on any later index change — forcing a stale stamp on a
		// landed target snapped the viewport from 243856 to 22870, its row's exact offset. New commits
		// arriving above it do the same, which is the fetch-jumps-the-graph report this began with. The
		// targeted walk is finished by `selected` (it pages until the sha is in, and the host load is
		// cancelled on every other status), so nothing legitimate is left to re-arm for.
		this.querySelector('gl-lit-graph')?.endRefFindLoad(pending.sha);
		if (pending.timeout != null) {
			clearTimeout(pending.timeout);
		}
		pending.abortCleanup?.();
		this._endEnsureLoading?.();
		this._endEnsureLoading = undefined;
		if (DEBUG) {
			if (pending.debugMark != null) {
				getGraphDebugDiagnostics().endNavigation(pending.debugMark, {
					status: result.status,
					sha: pending.sha,
					hidden: result.status === 'selected' ? result.row.hidden === true : undefined,
					reason: result.status === 'not-found' ? result.reason?.kind : undefined,
				});
			}
		}
		pending.resolve(result);
		// The one choke point every failure passes through (hidden row, host miss, timeout, abort-free
		// error), so the announcement is armed once no matter which path got here. `cancelled` is silent:
		// a newer intent took over, and nothing failed.
		if (result.status === 'not-found' && pending.feedback) {
			this.dispatchEvent(
				new CustomEvent('gl-graph-navigation-failed', {
					detail: { sha: pending.sha, source: pending.source, ref: pending.ref, reason: result.reason },
				}),
			);
		}
		// `_pendingNavigation` is half of `rowLoadInFlight` but a plain field, so clearing it schedules no
		// render — and a navigation that resolves before the delayed `ensureLoading` affordance ever engages
		// writes no signal either. Replay here or a page parked behind this load waits for an unrelated render.
		this.replayDeferredMoreRows();
	}

	private createPendingNavigation(
		init: Omit<
			PendingGraphNavigation,
			'abortCleanup' | 'hostLoadSha' | 'promise' | 'repoPath' | 'repositoryId' | 'resolve' | 'timeout'
		>,
	): Promise<GraphNavigationResult> {
		let resolve!: (result: GraphNavigationResult) => void;
		const promise = new Promise<GraphNavigationResult>(r => (resolve = r));
		const pending: PendingGraphNavigation = {
			...init,
			repositoryId: this._selectIntentRepositoryId,
			repoPath: this._selectIntentRepoPath,
			promise: promise,
			resolve: resolve,
		};
		const generation = init.generation;
		pending.timeout = setTimeout(
			() => this.rejectPendingNavigation(generation, { kind: 'timeout' }),
			navigationTimeoutMs,
		);
		const signal = init.signal;
		if (signal != null) {
			const onAbort = (): void => this.cancelPendingNavigation(generation);
			signal.addEventListener('abort', onAbort, { once: true });
			pending.abortCleanup = () => signal.removeEventListener('abort', onAbort);
		}
		this._pendingNavigation = pending;
		return promise;
	}

	private cancelPendingNavigation(generation: number): void {
		if (!this._selectIntent.reject(generation)) return;

		this._selectIntentRepositoryId = undefined;
		this._selectIntentRepoPath = undefined;
		this.querySelector('gl-lit-graph')?.cancelPendingReveal();
		if (this._pendingNavigation?.generation === generation) {
			this.settlePendingNavigation({ status: 'cancelled' });
		}
	}

	private rejectPendingNavigation(generation: number, reason?: GraphNavigationFailureReason): void {
		if (!this._selectIntent.reject(generation)) return;

		this._selectIntentRepositoryId = undefined;
		this._selectIntentRepoPath = undefined;
		this.querySelector('gl-lit-graph')?.cancelPendingReveal();
		if (this._pendingNavigation?.generation === generation) {
			this.settlePendingNavigation({ status: 'not-found', reason: reason });
		}
	}

	/** Applies a deferred selection once its row is renderable. Called from `updated()`, so it retries on
	 *  exactly the renders that could have made the row appear. */
	private flushPendingSelect(): void {
		const pending = this._pendingNavigation;
		if (this._selectIntent.pending == null || pending == null) return;
		if (
			this._selectIntentRepositoryId !== this.graphState.selectedRepository ||
			this._selectIntentRepoPath !== this.getRepoPath()
		) {
			this.cancelPendingSelection();
			return;
		}

		const rowBySha = this.getDecoratedRowByShaMap();
		const sha = this._selectIntent.take(s => rowBySha?.has(s) === true);
		if (sha == null) return;

		const row = rowBySha?.get(sha);
		if (row == null) return;

		this.selectCommitsCore([sha], rowBySha);
		void this.completePendingNavigation(pending, row);
	}

	private async completePendingNavigation(pending: PendingGraphNavigation, row: GitGraphRow): Promise<void> {
		await this.ensureRendered();
		if (
			this._pendingNavigation !== pending ||
			pending.repositoryId !== this.graphState.selectedRepository ||
			pending.repoPath !== this.getRepoPath()
		) {
			return;
		}

		if (pending.focus) {
			this.querySelector('gl-lit-graph')?.focusRow(pending.sha);
		}
		this._selectIntentRepositoryId = undefined;
		this._selectIntentRepoPath = undefined;
		this.settleNavigationOnRow(row, pending.feedback);
	}

	/**
	 * Settle a navigation that reached its row.
	 *
	 * A row can be loaded and still not on screen — hidden by a ref filter, dropped by the scope, folded
	 * into a collapsed lane — and the reveal armed for it then never fires, which is what made a jump look
	 * like it did nothing at all. That settles as a REPORTED failure carrying why.
	 *
	 * Selection still moved either way: the details panel should follow a target the user asked for even
	 * when the graph can't show it. The reveal also stays ARMED, so unhiding the row still lands it —
	 * {@link cancelNavigationFeedback} is what disarms it, once the failure has been acknowledged.
	 */
	private settleNavigationOnRow(row: GitGraphRow, feedback: boolean): void {
		const selected = this.withVisibility(row);
		if (selected.hidden === true && feedback) {
			const lit = this.querySelector('gl-lit-graph');
			const hidden = lit?.getRowHiddenReason(row.sha);
			// A collapsed lane isn't a failure — expand it (same as a pill jump would have up front) and
			// let the armed reveal land once the expanded row renders.
			if (hidden === 'collapsed' && lit?.expandLaneFor(row.sha) === true) {
				this.settlePendingNavigation({ status: 'selected', row: selected });
				return;
			}

			this.settlePendingNavigation({
				status: 'not-found',
				reason: { kind: 'hidden', hidden: hidden ?? 'unknown' },
			});
			return;
		}

		this.settlePendingNavigation({ status: 'selected', row: selected });
	}

	/** Drop the reveal still armed for a reported failure's row, once that report has been dismissed.
	 *  Keyed to the sha so it can't cancel a reveal a newer navigation armed in the meantime. */
	cancelNavigationFeedback(sha: string): void {
		this.querySelector('gl-lit-graph')?.cancelPendingRevealFor(sha);
	}

	/** Cancel the pending navigation targeting `sha`, exactly as a superseding {@link navigateToCommit}
	 *  call would (a silent `'cancelled'` settlement that withdraws any still-travelling host walk).
	 *  No-op when the pending navigation targets a different sha or none is pending — a caller (e.g. the
	 *  jump-feedback toast's Cancel action) can't accidentally cancel a newer, unrelated navigation. */
	cancelNavigation(sha: string): void {
		if (this._pendingNavigation?.sha !== sha) return;

		this._selectIntent.cancel();
		this._selectIntentRepositoryId = undefined;
		this._selectIntentRepoPath = undefined;
		this.settlePendingNavigation({ status: 'cancelled' });
		this.querySelector('gl-lit-graph')?.cancelPendingReveal();
	}

	/**
	 * Load, select, and reveal a row as one latest-wins operation.
	 *
	 * The host only makes rows available. This wrapper owns selection and reveal, and resolves only
	 * after the selected row's rendered visibility is current. A newer navigation or direct selection
	 * resolves an older pending operation as cancelled, so async callers cannot overwrite newer intent.
	 */
	async navigateToCommit(sha: string, options?: GraphNavigationOptions): Promise<GraphNavigationResult> {
		if (options?.signal?.aborted === true) return { status: 'cancelled' };

		const litGraph = this.querySelector('gl-lit-graph');
		const { rows: decorated, showPrimary, primaryWipRowId } = this.getDecoratedRows();

		// Callers referring to "the WIP" by git revision (sidebar panel, overview cards) hand us
		// `uncommitted`, which is NOT a row id — map it to the graph's own worktree's WIP row here, the
		// one boundary where the revision becomes a row id. Without this it would miss both the
		// fast-path lookup and the host-side row-load fallback (which can't load a synthetic id either).
		if (sha === uncommitted) {
			// No resolved repo path means no row id to map onto — and `getDecoratedRows` gates the primary
			// WIP row's synthesis on the same value, so there is nothing to select in that window either.
			// Returning is the honest answer; the next render (once `repositories`/`selectedRepository`
			// land) synthesizes the row and a repeat call resolves. Deliberate: the previous behavior
			// normalized to a path-free constant and fired a host round-trip that could never resolve it.
			//
			// `showPrimary` is the same gate the decoration renders on: with it false (detached HEAD, a
			// scope that excludes the current branch) the row is never synthesized, so deferring to it
			// would just wait out the timeout in silence.
			if (primaryWipRowId == null || !showPrimary) {
				return { status: 'not-found' };
			}

			sha = primaryWipRowId;
		}

		const repoPath = this.getRepoPath();
		const repositoryId = this.graphState.selectedRepository;
		const deferSynthetic = options?.deferSynthetic !== false;
		const feedback = options?.feedback !== false;
		const focus = options?.focus === true;
		const ref = options?.ref;
		const signal = options?.signal;
		// Resolved once and shared by all three reveal sites below (loaded, deferred synthetic WIP, and
		// host-loaded), so a row that has to be paged in lands the same way one already in hand does.
		const reveal: GraphRevealIntent = {
			mode: options?.reveal ?? 'always',
			flash: options?.flash === true,
		};
		const pending = this._pendingNavigation;
		if (
			pending?.sha === sha &&
			pending.repositoryId === repositoryId &&
			pending.repoPath === repoPath &&
			pending.deferSynthetic === deferSynthetic &&
			pending.signal === signal
		) {
			pending.focus ||= focus;
			// Same upgrade-don't-discard rule `focus` follows: a repeat ask for the row already in flight can
			// carry STRONGER intent than the one queued — an ambient selection-sync paging a row in, then the
			// user clicking that same sha — and coalescing must not swallow it. MERGED, not replaced, and each
			// axis independently, so neither can be downgraded: a later `'if-changed'` can't demote a pending
			// `'always'`, and a flash-only upgrade still re-arms.
			const merged: GraphRevealIntent = {
				mode: pending.reveal.mode === 'always' || reveal.mode === 'always' ? 'always' : 'if-changed',
				flash: pending.reveal.flash || reveal.flash,
			};
			if (merged.mode !== pending.reveal.mode || merged.flash !== pending.reveal.flash) {
				pending.reveal = merged;
				litGraph?.scrollToSha(sha, merged);
			}
			return pending.promise;
		}

		// Newest ask wins: supersede any different intent still waiting for its row. SAME-target reveals
		// survive: a selection-sync navigation trails the host reveal it mirrors by a render cycle, and
		// cancelling that reveal's still-travelling animation would strand the viewport mid-scroll — the
		// trailing `'if-changed'` repeat can never re-issue it (`_lastRevealedSha` banks at evaluation).
		this.settlePendingNavigation({ status: 'cancelled' });
		if (litGraph?.activeRevealSha !== sha) {
			litGraph?.cancelPendingReveal();
		}
		const generation = this._selectIntent.begin();
		this._selectIntentRepositoryId = repositoryId;
		this._selectIntentRepoPath = repoPath;
		const rowBySha = this.getDecoratedRowByShaMap(decorated);
		const row = rowBySha?.get(sha);
		let debugMark: string | undefined;
		if (DEBUG) {
			debugMark = getGraphDebugDiagnostics().beginNavigation({
				source: options?.source ?? 'unknown',
				sha: sha,
				repositoryId: repositoryId,
				repoPath: repoPath,
				loaded: row != null,
			});
		}
		const navigation = this.createPendingNavigation({
			debugMark: debugMark,
			deferSynthetic: deferSynthetic,
			feedback: feedback,
			focus: focus,
			generation: generation,
			ref: ref,
			reveal: reveal,
			sha: sha,
			signal: signal,
			source: options?.source,
		});

		if (row != null) {
			this.selectCommitsCore([sha], rowBySha);
			// Navigation implies reveal.
			litGraph?.scrollToSha(sha, reveal);
			await this.ensureRendered();
			if (
				!this._selectIntent.isCurrent(generation) ||
				this._selectIntentRepositoryId !== this.graphState.selectedRepository ||
				this._selectIntentRepoPath !== this.getRepoPath()
			) {
				if (this._pendingNavigation?.generation === generation) {
					this.cancelPendingSelection();
				}
				return navigation;
			}

			if (focus) {
				litGraph?.focusRow(sha);
			}
			this._selectIntentRepositoryId = undefined;
			this._selectIntentRepoPath = undefined;
			this.settleNavigationOnRow(row, feedback);
			return navigation;
		}

		// Synthetic WIP rows are client-side only — the host has no graph row for them, and asking it to
		// load one costs an unbounded walk for an id that can never resolve. The next `getDecoratedRows`
		// synthesis surfaces the row instead, so hold the selection for it.
		if (isWipRowId(sha)) {
			if (!deferSynthetic) {
				this.rejectPendingNavigation(generation);
				return navigation;
			}

			this._selectIntent.defer(sha, generation);
			litGraph?.scrollToSha(sha, reveal);

			// A peer worktree's WIP row is only synthesized once its ANCHOR commit is loaded — the
			// interleave drops it otherwise — so deferring alone would wait for a row that can never
			// appear, and time out. Page the anchor in: it is a real commit, so that walk is bounded.
			const anchorSha = this.graphState.wipRowsById?.[sha]?.parentSha;
			if (anchorSha != null && rowBySha?.get(anchorSha) == null) {
				this._endEnsureLoading = this.graphState.beginEnsureLoading();
				if (this._pendingNavigation?.generation === generation) {
					this._pendingNavigation.hostLoadSha = anchorSha;
				}
				this.dispatchEvent(
					new CustomEvent('gl-graph-navigation-loading', {
						detail: { sha: sha, ref: ref, feedback: feedback },
					}),
				);
				void this._ipc
					.sendRequest(LoadRowRequest, { id: anchorSha })
					.then(result => {
						// The anchor never arrives ⇒ the WIP row cannot be synthesized; fail now rather
						// than let the deferred intent sit until it times out.
						if (result?.id !== anchorSha) {
							this.rejectPendingNavigation(generation, toNavigationFailureReason(result));
						}
					})
					.catch((ex: unknown) => {
						this.rejectPendingNavigation(generation, {
							kind: 'error',
							message: ex instanceof Error ? ex.message : undefined,
						});
					});
			}
			return navigation;
		}

		this._endEnsureLoading = this.graphState.beginEnsureLoading();
		if (this._pendingNavigation?.generation === generation) {
			this._pendingNavigation.hostLoadSha = sha;
		}
		this.dispatchEvent(
			new CustomEvent('gl-graph-navigation-loading', { detail: { sha: sha, ref: ref, feedback: feedback } }),
		);
		void this._ipc
			.sendRequest(LoadRowRequest, { id: sha })
			.then(result => {
				if (result?.id !== sha) {
					this.rejectPendingNavigation(generation, toNavigationFailureReason(result));
				}
			})
			.catch((ex: unknown) => {
				this.rejectPendingNavigation(generation, {
					kind: 'error',
					message: ex instanceof Error ? ex.message : undefined,
				});
			});
		// Selection is client-owned: hold the latest intent until the rows push makes it renderable.
		this._selectIntent.defer(sha, generation);
		// Row isn't loaded yet — queue the reveal so it fires once the host's rows land.
		litGraph?.scrollToSha(sha, reveal);
		return navigation;
	}
	private onColumnsChanged(event: CustomEventType<'gl-graph-changecolumns'>) {
		this._ipc.sendCommand(UpdateColumnsCommand, {
			config: event.detail.settings,
			revision: event.detail.revision,
		});
	}

	private onMouseLeave() {
		this.dispatchEvent(new CustomEvent('gl-graph-mouse-leave'));
	}

	// Row-action button → host command (the graph emits a flat {action, sha, type, worktreePath?}
	// detail from its click delegation).
	private onGraphRowAction({
		detail: { action, sha, type, worktreePath },
	}: CustomEvent<{ action: RowAction; sha: string; type: GitGraphRowKind; worktreePath?: string }>) {
		const rowRef = { id: sha, type: type };
		// Narrow per-action so the discriminated `RowActionParams` only carries the fields its case
		// allows — keeps stash/open-changes payloads from accidentally inheriting worktreePath.
		const params =
			action === 'undo-commit'
				? { action: action, row: rowRef, worktreePath: worktreePath }
				: { action: action, row: rowRef };
		this._ipc.sendCommand(RowActionCommand, params);
	}

	/** Ref pill's pin zone → clear the edge pin. Goes through `UpdatePinnedRefCommand` (the host's own
	 *  pinned-ref channel) rather than executing `gitlens.graph.unpinBranchFromEdge`: the command takes no
	 *  meaningful payload beyond the session it runs in, and the sidebar's generic action channel re-stamps
	 *  telemetry origin as `sidebar-inline`, which would misattribute a graph-body click. */
	private onGraphUnpinRef() {
		this._ipc.sendCommand(UpdatePinnedRefCommand, { ref: null });
	}

	// New-engine WIP row-open button (resolve/compose/review/agents) → look the full row up by sha and
	// re-dispatch the webview-internal event graph-app already handles (select + open details).
	private onGraphWipRowOpen({
		detail: { target, sha },
	}: CustomEvent<{ target: 'compose' | 'review' | 'resolve' | 'agents'; sha: string }>) {
		// WIP rows (one `wip::<worktreePath>` per worktree) are synthesized in `getDecoratedRows()` and
		// never exist in `graphState.rows`, so look the row up there — otherwise the lookup misses and
		// the compose/review/agents open is silently dropped.
		const row = this.getDecoratedRowByShaMap()?.get(sha);
		if (row == null) return;

		this.dispatchEvent(
			new CustomEvent('gl-graph-wip-row-open', {
				detail: { target: target, row: row },
				bubbles: true,
				composed: true,
			}),
		);
	}

	/** Builds the serialized `data-vscode-context` for a right-clicked row on demand, or `undefined`
	 *  when the row carries its own host-built context (stash) or none is needed. */
	private buildRowContextMenuContext(graphRow: GitGraphRow): string | undefined {
		const repoPath = this.getRepoPath();
		if (repoPath == null) return undefined;

		// Working-changes (WIP) rows: the `gitlens:wip` context is static (worktree path + the synthetic
		// `uncommitted` ref), so build it for any WIP row we render rather than depending on host-shipped
		// stats. The conflict bit comes from that row's own hot-plane entry — one lookup for every
		// worktree now, the graph's own included.
		if (graphRow.kind === ('workdir' satisfies GitGraphRowKind)) {
			const worktreePath = getWipRowWorktreePath(graphRow.sha);
			const hasConflicts = this.graphState.wipStateById?.[graphRow.sha]?.hasConflicts ?? false;
			if (worktreePath != null && worktreePath !== repoPath) {
				const row = this.graphState.wipRowsById?.[graphRow.sha];
				return row?.repoPath != null ? serializeWipContext(row.repoPath, true, hasConflicts) : undefined;
			}
			return serializeWipContext(repoPath, false, hasConflicts);
		}

		// Lean commit rows: build the commit context from `contexts.flags` + row fields. Stash rows
		// (and any row already carrying a host-built `contexts.row`) opt out here and keep it. The
		// avatar zone's contributor context is stamped declaratively per row (see graph-commit.ts).
		if (!needsDynamicRowContext(graphRow)) return undefined;

		return serializeRowCommitContext(graphRow, repoPath);
	}

	private _clearRowContextTimer: ReturnType<typeof setTimeout> | undefined;

	/** Writes a wrapper-level `data-vscode-context` synchronously (VS Code reads it synchronously on
	 *  contextmenu) and clears it shortly after; mirrors the 100ms cleanup in `ContextMenuProxyController`
	 *  / the tree-view so the attribute can't leak across menus. */
	private writeVscodeContext(context: string | undefined): void {
		if (context == null) return;

		this.dataset.vscodeContext = context;
		if (this._clearRowContextTimer != null) {
			clearTimeout(this._clearRowContextTimer);
		}
		this._clearRowContextTimer = setTimeout(() => {
			delete this.dataset.vscodeContext;
			this._clearRowContextTimer = undefined;
		}, 100);
	}

	private _lastSelectionKey: string | undefined;

	// Bridges the graph's decoupled `gl-graph-rowhover*` events into the hover pipeline (rowhoverstart/track
	// + gl-graph-row-hover/unhover → GraphHover/GetRowHover). The graph excludes refs from the row hover,
	// so the zone is always a non-`ref` value.
	// The last row we resolved for a hover, kept so an unhover can still emit a `graphRow` even if
	// the rows array churned (scope change / paging) between hover-start and hover-end — otherwise
	// the consumer never gets the unhover and the rich card stays stuck open.
	private _lastHoverRow: GitGraphRow | undefined;

	private rowBySha(sha: string): GitGraphRow | undefined {
		return this.getDecoratedRowByShaMap()?.get(sha);
	}

	/** sha→HOST row map (`graphState.rows` — never the synthetic WIP rows `getDecoratedRows` injects),
	 *  cached on `graphState.rows` identity. Used to recover GitLens-only row fields (reachability,
	 *  `isCurrentUser`, etc.) that the GK-processed row doesn't preserve; a synthetic WIP sha naturally
	 *  misses (it's absent from `graphState.rows`), which callers rely on to skip WIP rows. */
	private getSourceRowByShaMap(): ReadonlyMap<string, GitGraphRow> | undefined {
		const rows = this.graphState.rows;
		if (rows == null) return undefined;

		if (this._sourceRowByShaCache?.rows === rows) return this._sourceRowByShaCache.map;

		const map = new Map(rows.map(r => [r.sha, r]));
		this._sourceRowByShaCache = { rows: rows, map: map };
		return map;
	}

	/** A synthetic WIP row's `date` is a stable-but-arbitrary stamp (`stableWipRowDate`), not the day
	 *  it's anchored at — feeding it straight to the minimap always tracks "today" instead of the WIP's
	 *  anchor commit. Resolve to the anchor's (`parents[0]`, always a loaded HOST row when the WIP row
	 *  exists) date instead; real rows pass through unchanged. */
	private dateForMinimapRow(row: {
		readonly sha: string;
		readonly kind: string;
		readonly parents: readonly string[];
		readonly date: number;
	}): number {
		// Only PEER WIP rows follow their anchor. Every WIP row shares the workdir kind and a `now`-based
		// `date` stamp, but they sit in different places: the graph's own worktree belongs at the start of
		// the timeline (so its own stamp IS its position — same as how `type:wip` search dates it), while a
		// peer is drawn against its worktree HEAD and should track that commit's date. Keying on the kind
		// alone dragged the primary back to HEAD's day.
		if (row.kind !== 'workdir' || row.sha === this.primaryWipRowId) return row.date;

		const anchorSha = row.parents[0];
		const anchorRow = anchorSha != null ? this.getSourceRowByShaMap()?.get(anchorSha) : undefined;
		// Worktree HEADs are routinely outside the loaded window, so fall back to the row record's
		// `parentDate` — the same value `type:wip` search dates these rows by — rather than the row's own
		// `now` stamp, which would drag every unloaded worktree onto today.
		return anchorRow?.date ?? this.graphState.wipRowsById?.[row.sha]?.parentDate ?? row.date;
	}

	/** sha→DECORATED row map (includes synthetic primary + per-worktree WIP rows `getDecoratedRows`
	 *  injects), cached on the decorated `rows` identity. Range/toggle selection resolves many shas per
	 *  event — a Map lookup keeps that O(selection), not O(selection × rows). */
	private getDecoratedRowByShaMap(
		rows: GitGraphRow[] | undefined = this.getDecoratedRows().rows,
	): ReadonlyMap<string, GitGraphRow> | undefined {
		return this.getDecoratedRowsIndex(rows)?.rowBySha;
	}

	private getDecoratedRowsIndex(
		rows: GitGraphRow[] | undefined = this.getDecoratedRows().rows,
	): DecoratedRowsIndex | undefined {
		if (rows == null) return undefined;

		if (this._decoratedRowsIndexCache?.rows === rows) return this._decoratedRowsIndexCache;

		const rowBySha = new Map<string, GitGraphRow>();
		const indexBySha = new Map<string, number>();
		for (let i = 0; i < rows.length; i++) {
			const row = rows[i];
			rowBySha.set(row.sha, row);
			indexBySha.set(row.sha, i);
		}
		const index = { rows: rows, rowBySha: rowBySha, indexBySha: indexBySha };
		this._decoratedRowsIndexCache = index;
		return index;
	}

	private resolveHoverRow(sha: string): GitGraphRow | undefined {
		const row = this.rowBySha(sha);
		if (row != null) {
			this._lastHoverRow = row;
			return row;
		}

		return this._lastHoverRow?.sha === sha ? this._lastHoverRow : undefined;
	}

	private onGraphRowHoverStart() {
		this.dispatchEvent(new CustomEvent('rowhoverstart', { bubbles: true, composed: true }));
	}

	/** Maps gl-lit-graph's own decoupled `'content' | 'graph'` hover-zone vocabulary onto the shared
	 *  `GraphZoneType` graph-app's handlers understand — 'graph' is the seam a future lane/branch hover
	 *  card would branch on in `handleGraphRowHoverTrack`; everything else collapses to 'message' (only
	 *  the `=== 'ref'` check differentiates today, and the Lit engine never reports 'ref' — pills are
	 *  excluded from row-hover entirely). */
	private hoverZoneType(zone: 'content' | 'graph'): GraphZoneType {
		return zone === 'graph' ? 'graph' : 'message';
	}

	private onGraphRowHoverTrack({ detail }: CustomEvent<{ sha: string; zone: 'content' | 'graph' }>) {
		const graphRow = this.resolveHoverRow(detail.sha);
		if (graphRow == null) return;

		this.dispatchEvent(
			new CustomEvent('rowhovertrack', {
				detail: {
					graphZoneType: this.hoverZoneType(detail.zone),
					graphRow: graphRow,
					minimapDate: this.dateForMinimapRow(graphRow),
				},
				bubbles: true,
				composed: true,
			}),
		);
	}

	private onGraphRowHover({
		detail,
	}: CustomEvent<{ sha: string; clientX: number; currentTarget: HTMLElement; zone: 'content' | 'graph' }>) {
		const graphRow = this.resolveHoverRow(detail.sha);
		if (graphRow == null) return;

		this.dispatchEvent(
			new CustomEvent('gl-graph-row-hover', {
				detail: {
					graphZoneType: this.hoverZoneType(detail.zone),
					graphRow: graphRow,
					clientX: detail.clientX,
					currentTarget: detail.currentTarget,
				},
			}),
		);
	}

	/** Relays an externally-driven peek close (Esc popping the hover's overlay entry) down to the graph. */
	notifyPeekClosed(): void {
		this.querySelector('gl-lit-graph')?.onPeekClosedExternally();
	}

	/** Resolves the graph's peek request onto a row and relays the app's answer back through the incoming
	 *  event's detail — both dispatches are synchronous, so the graph reads `open` right after its own. */
	private onGraphRowPeek({ detail }: CustomEvent<GraphRowPeekRequest>) {
		if (detail.action === 'close') {
			this.dispatchEvent(new CustomEvent('gl-graph-row-peek', { detail: { action: 'close' } }));
			return;
		}

		const graphRow = this.resolveHoverRow(detail.sha);
		if (graphRow == null) return;

		const relayed = { action: detail.action, graphRow: graphRow, anchor: detail.anchor, open: false };
		this.dispatchEvent(new CustomEvent('gl-graph-row-peek', { detail: relayed }));
		detail.open = relayed.open;
	}

	private onGraphRowUnhover({
		detail,
	}: CustomEvent<{ sha: string; zone?: 'content' | 'graph'; relatedTarget: EventTarget | null }>) {
		const graphRow = this.resolveHoverRow(detail.sha);
		if (graphRow == null) return;

		this.dispatchEvent(
			new CustomEvent('gl-graph-row-unhover', {
				detail: {
					graphZoneType: this.hoverZoneType(detail.zone ?? 'content'),
					graphRow: graphRow,
					relatedTarget: detail.relatedTarget,
				},
			}),
		);
		this._lastHoverRow = undefined;
	}

	private _lastSentSelectionKey: string | undefined;

	/**
	 * SHAs we've already issued `GetMoreRowsCommand({ id: sha })` for via the unreachable-anchor
	 * path, mapped to the loaded row count at the time the request was sent plus how many targeted
	 * walks that SHA has cost. If a targeted walk returns without surfacing the SHA, we park it here
	 * so the next `scopeanchorsunreachable` event doesn't re-fire the same request immediately.
	 * Entries are released three ways:
	 * (a) scope reference changes (user re-scopes, or refs-moved invalidation produces a new
	 *     scope object), which clears the entire map;
	 * (b) the host response delivered new rows, growing `rows.length` past the snapshot — the
	 *     provider's cursor advanced past where the previous walk's `limit * 10` cap aborted,
	 *     so a retry continues the walk from the new cursor rather than re-running the same
	 *     range. Entries whose request didn't grow rows stay parked: retrying would hit the
	 *     same cap at the same cursor with no progress.
	 * (c) never, once `maxUnreachableAnchorPageAttempts` walks have gone by without landing the
	 *     SHA. Growing rows alone is not proof of progress TOWARD the anchor: a stale anchor the
	 *     invalidation missed will never arrive, and the GitHub provider's `more()` ignores the
	 *     target id entirely, so on the web path every "targeted" page is a blind page. Without
	 *     the cap those cases page until history ends.
	 */
	private _unreachableAnchorRequests = new Map<string, { rowCount: number; attempts: number }>();
	/** Anchors whose page was held back because a row load was already in flight — replayed from `updated()`
	 *  once it finishes. See {@link processUnreachableAnchors} for why dropping them isn't an option. Stamped
	 *  with {@link scopeAnchorKey} so a replay can't page for a view the user has already left. */
	private _deferredUnreachableAnchors?: { anchors: ReadonlySet<string>; key: string | undefined };
	private _unreachableAnchorScope: typeof graphStateContext.__context__.scope = undefined;
	/** A row page held back because a load was already in flight — replayed from `updated()` once it clears.
	 *  Stamped with the repository it was asked for: a swap REPLACES the row set, and the graph clamps a
	 *  now-out-of-range focus onto the new rows (often onto their last row), so the replay's own
	 *  `needsMoreRows` re-validation would see a perfectly in-range index and page the WRONG repository.
	 *  `displayRows` rides along only so a replayed ask keeps the count it was asked at for DEBUG. */
	private _deferredMoreRows?: { displayRows: number; repoPath: string | undefined };

	// `<gl-lit-graph>` emits a small, renderer-shaped set of events; the handlers below translate them
	// into the IPC commands and app-wide events the rest of the app (details panel, selection sync,
	// paging) consumes, so nothing downstream has to know how the graph is drawn.

	private onGraphSelectionChanged(
		event: CustomEvent<{
			sha: string | null;
			mode?: 'replace' | 'toggle' | 'range';
			rangeShas?: readonly string[];
		}>,
	) {
		const { sha, mode, rangeShas: graphRangeShas } = event.detail;
		const wipRowsById = this.graphState.wipRowsById;

		// This event is user intent (a click / keyboard select). It outranks any queued jump still waiting
		// for its row — landing that later would silently move the user off what they just picked.
		this.cancelPendingSelection();

		// If the user has `gitlens.graph.multiselect: 'topological'`, replace commit-graph's
		// visible-row range with the first-parent chain from the previously-focused row
		// down through the clicked row — the user's mental model of "select all
		// commits between A and B" follows commit ancestry, not visible position.
		const { rows: decoratedRowsForSelection } = this.getDecoratedRows();
		const decoratedRowsIndex = this.getDecoratedRowsIndex(decoratedRowsForSelection);
		let rangeShas = graphRangeShas;
		if (mode === 'range' && this.graphState.config?.multiSelectionMode === 'topological' && sha != null) {
			// The anchor must come from the event's own range, not `activeRow` — `activeRow` tracks the
			// moving end of the selection (the row just pressed/clicked), not its fixed anchor. Deriving
			// `prior` from it made successive shift+arrow presses slide a 2-row window instead of
			// accumulating a range. `graphRangeShas` carries both ends; the anchor is whichever end isn't
			// `sha`.
			let prior: string | undefined;
			if (graphRangeShas != null && graphRangeShas.length > 0) {
				const lastRangeSha = graphRangeShas.at(-1);
				prior = sha === lastRangeSha ? graphRangeShas[0] : lastRangeSha;
			} else {
				prior = this.graphState.activeRow?.split('|')[0];
			}

			if (decoratedRowsIndex != null && prior != null && prior !== sha) {
				rangeShas = walkTopologicalRange(decoratedRowsIndex.rows, decoratedRowsIndex.indexBySha, prior, sha);
			}
		}

		// Look up rows in the DECORATED set (which includes synthetic primary + per-worktree
		// secondary WIP rows) — `graphState.rows` doesn't carry those, so a secondary-WIP
		// click would otherwise miss. Map lookup (not `.find()`) keeps range/toggle selection
		// O(selection), not O(selection × rows) — a shift-click range can span many shas.
		const decoratedRowBySha = decoratedRowsIndex?.rowBySha;
		const focusedRow = sha != null ? decoratedRowBySha?.get(sha) : undefined;

		// Build the full GraphSelection[] so the details panel + host see the same shape regardless of mode:
		//   - `replace` (no mod) → just the focused sha
		//   - `toggle` (cmd/ctrl+click) → existing selection ⊕ this sha
		//   - `range`  (shift+click)   → the graph's visible-row range, already swapped above for the
		//                                 first-parent chain when `multiselect: 'topological'`
		// For toggle, build off the *previously stored* selection in graphState.
		let selection: GraphSelection[];
		if (sha != null && focusedRow != null) {
			const focusedSel: GraphSelection = {
				id: sha,
				type: focusedRow.kind,
				active: true,
				hidden: false,
				// The row id IS the worktree path for a WIP row; `wipRowsById` is the un-normalized form.
				repoPath: getWipRowWorktreePath(sha) ?? wipRowsById?.[sha]?.repoPath,
			};

			if (mode === 'range' && rangeShas != null && rangeShas.length > 0) {
				selection = rangeShas.flatMap<GraphSelection>(rs => {
					const r = decoratedRowBySha?.get(rs);
					if (r == null) return [];
					return [
						{
							id: rs,
							type: r.kind,
							active: rs === sha,
							hidden: false,
							repoPath: getWipRowWorktreePath(rs) ?? wipRowsById?.[rs]?.repoPath,
						},
					];
				});
				if (selection.length === 0) {
					selection = [focusedSel];
				}
			} else if (mode === 'toggle') {
				const prior = this.graphState.selectedRows ?? {};
				const next: GraphSelection[] = [];
				for (const otherSha of Object.keys(prior)) {
					if (otherSha === sha) continue;

					const r = decoratedRowBySha?.get(otherSha);
					if (r == null) continue;

					next.push({
						id: otherSha,
						type: r.kind,
						active: false,
						hidden: false,
						repoPath: getWipRowWorktreePath(otherSha) ?? wipRowsById?.[otherSha]?.repoPath,
					});
				}
				// Only add the clicked sha when it wasn't already in the selection (toggle off).
				if (prior[sha] !== true) {
					next.push(focusedSel);
				}
				selection = next.length > 0 ? next : [focusedSel];
			} else {
				selection = [focusedSel];
			}
		} else {
			selection = [];
		}

		// Keep `graphState.selectedRows` in sync so commit-graph's `selectedHashes` derivation
		// reflects the same set we just sent to the host.
		const nextSelectedRows: GraphSelectedRows = {};
		for (const s of selection) {
			nextSelectedRows[s.id] = true;
		}
		this.graphState.selectedRows = nextSelectedRows;

		this.graphState.activeRow = focusedRow != null ? `${focusedRow.sha}|${focusedRow.date}` : undefined;
		this.graphState.activeDay = focusedRow != null ? this.dateForMinimapRow(focusedRow) : undefined;

		// Build commit-lite shells for every commit in the selection so the details panel
		// paints synchronously without an IPC round-trip. WIP rows are skipped — they have
		// no commit shell; the details panel branches on `type === 'workdir'`.
		const sourceRowBySha = this.getSourceRowByShaMap();
		let commits: Record<string, CommitDetails> | undefined;
		if (sourceRowBySha != null && selection.length > 0) {
			const fallbackRepoPath = getSelectedRepoPath(this.graphState);
			if (fallbackRepoPath != null) {
				for (const sel of selection) {
					if (sel.type === 'workdir') continue;

					const sourceRow = sourceRowBySha.get(sel.id);
					if (sourceRow == null) continue;

					commits ??= {};
					commits[sel.id] = buildCommitLite(
						sourceRow,
						sel.repoPath ?? fallbackRepoPath,
						this.graphState.avatars,
					);
				}
			}
		}

		// Decode the focused row's reachability from the graph's shared table — via the HOST row (the
		// synthetic WIP shas `getDecoratedRows` injects aren't in `graphState.rows`, so this naturally
		// stays undefined for them).
		const sourceFocusedRow = focusedRow != null ? this.getSourceRowByShaMap()?.get(focusedRow.sha) : undefined;
		const reachability =
			sourceFocusedRow != null ? this.graphState.getRowReachability(sourceFocusedRow) : undefined;

		this.dispatchEvent(
			new CustomEvent('gl-graph-change-selection', {
				detail: { selection: selection, reachability: reachability, commits: commits, userIntent: true },
			}),
		);

		const selectionKey = selection.map(s => `${s.id}|${s.active ? 1 : 0}|${s.hidden ? 1 : 0}`).join(',');
		if (selectionKey === this._lastSentSelectionKey) return;

		this._lastSentSelectionKey = selectionKey;

		this._ipc.sendCommand(UpdateSelectionCommand, { selection: selection });
	}

	private onGraphRowDoubleClick(event: CustomEvent<{ sha: string; type: GitGraphRow['kind'] }>) {
		const { sha, type } = event.detail;
		// Resolve against the decorated rows (Seam B) so synthetic WIP shas — injected in
		// `getDecoratedRows` and absent from `graphState.rows` — still resolve to a row.
		const row = this.rowBySha(sha);
		if (row != null) {
			this.dispatchEvent(
				new CustomEvent('gl-graph-row-double-click', {
					detail: { graphRow: row, preserveFocus: false },
				}),
			);
		}
		this._ipc.sendCommand(DoubleClickedCommand, {
			type: 'row',
			row: { id: sha, type: type },
			preserveFocus: false,
		});
	}

	private onGraphMoreRows(e: CustomEvent<{ displayRows: number } | null>) {
		this.requestMoreRows(e.detail?.displayRows ?? 0);
	}

	/** Ask the host for the next row page. A request blocked by an in-flight load is PARKED, never dropped —
	 *  same principle as {@link processUnreachableAnchors}. Paging is edge-triggered off a scroll range change
	 *  or row nav, and a user parked at the loaded end can produce NEITHER (End is a no-op there, since the
	 *  reveal declines to scroll a row that's already visible), so a dropped ask is a page that never arrives
	 *  until they scroll up and back down. `graphState.loading` is also a shared affordance flag the timeline
	 *  sets for its own pages; that over-broad gate is tolerable precisely because a blocked ask costs a
	 *  replay, not a lost page. */
	/** Filter mode with the whole result set already loaded — row paging has nothing left to surface, so don't
	 *  keep walking history trying to "fill" the viewport with non-matches. Folded into the graph's `hasMore`
	 *  so the element stops emitting asks (and announcing "loading more") for pages this would reject. */
	private get filterResultsExhausted(): boolean {
		const searchResults = this.graphState.searchResults;
		return (
			this.graphState.searchMode === 'filter' &&
			searchResults != null &&
			!isGraphSearchResultsError(searchResults) &&
			!searchResults.hasMore &&
			searchResults.commitsLoaded.count === searchResults.count
		);
	}

	private requestMoreRows(displayRows: number): void {
		if (!this.graphState.paging?.hasMore) {
			this._deferredMoreRows = undefined;
			return;
		}

		if (this.filterResultsExhausted) {
			this._deferredMoreRows = undefined;
			return;
		}

		// Blocked — park it rather than drop it (see above). At most ONE parked ask, cleared on acceptance, so
		// a deferral costs exactly one replay and can never loop. Gated on `rowLoadInFlight`, not `loading`
		// alone: the host only dedups an untargeted page against a pending TARGETED walk while the search
		// object is identical too (`pendingSearch === search`), so a search change in between turns this ask
		// into a supersede that cancels a `navigateToCommit` walk. Over-broad is free here — a blocked ask
		// costs a replay, not a lost page.
		if (this.rowLoadInFlight) {
			this._deferredMoreRows = { displayRows: displayRows, repoPath: this.getRepoPath() };
			return;
		}

		this._deferredMoreRows = undefined;

		// Marked HERE, after every acceptance guard — a request rejected above never starts a page, and
		// leaving its mark standing would inflate the next successful page's measured duration.
		if (DEBUG) {
			getGraphDebugDiagnostics().markPageRequested({
				repoPath: this.getRepoPath(),
				sourceRows: this.graphState.rows?.length ?? 0,
				displayRows: displayRows,
			});
		}
		this.graphState.loading = true;
		this._ipc.sendCommand(GetMoreRowsCommand, { id: undefined });
	}

	/** Re-run a page request deferred while a row load held the gate. Cheap enough for `updated()`: ONE plain
	 *  field read when nothing is parked, and that early return is load-bearing, not just tidy — see
	 *  {@link replayDeferredUnreachableAnchors} for why (`SignalWatcher` tracks every `graphState` read here).
	 *
	 *  Re-validated against the graph's LIVE predicate rather than stamped with a key like the anchor
	 *  deferral: a repo switch, a scope, or a filter all REPLACE the row set, and any of them makes a parked
	 *  ask meaningless — `needsMoreRows` already rejects every one of those (scope projection, stale range
	 *  index), so asking it again is both cheaper and harder to get wrong than mirroring that state here. */
	private replayDeferredMoreRows(): void {
		const deferred = this._deferredMoreRows;
		if (deferred == null) return;

		// The repository moved on — the rows this was asked against are gone. Identity has to be checked HERE
		// rather than left to `needsMoreRows`: a swap clamps the stale focus into the new row set, so the
		// index the predicate sees is in range and indistinguishable from a real one.
		if (deferred.repoPath !== this.getRepoPath()) {
			this._deferredMoreRows = undefined;
			return;
		}

		const graph = this.querySelector('gl-lit-graph');
		if (graph == null) {
			this._deferredMoreRows = undefined;
			return;
		}

		// Re-validate only AFTER the graph has applied this update. Lit schedules a child's update as its own
		// microtask, so at our `updated()` the element still holds the PRE-page row window — asking it now
		// would measure the ask against the very rows the response just delivered, answer "still needed" no
		// matter how far the new rows moved the end, and page again unprompted.
		void graph.updateComplete.then(() => {
			const pending = this._deferredMoreRows;
			// Re-check identity as well as existence: the await is where a repo swap most easily lands.
			if (pending == null || pending.repoPath !== this.getRepoPath()) {
				this._deferredMoreRows = undefined;
				return;
			}

			if (!graph.needsMoreRows()) {
				this._deferredMoreRows = undefined;
				return;
			}

			this.requestMoreRows(pending.displayRows);
		});
	}

	private onGraphContextMenu(event: CustomEvent<{ sha: string; type: GitGraphRow['kind']; zone: 'ref' | 'row' }>) {
		const { sha, zone } = event.detail;
		// Resolve against the decorated rows (Seam B) so a right-click on a synthetic WIP row
		// (absent from `graphState.rows`) still finds its row and emits the context event.
		const row = this.rowBySha(sha);
		if (row == null) return;

		// Ref zones keep their host-serialized branch/tag/remote contexts (rendered per ref pill) —
		// don't pollute them with row/selection/WIP keys. Every other row's own commit context is
		// already stamped declaratively (graph-row.ts `data-vscode-context`), so only WIP rows (which
		// carry no row-level context at all) and multi-selected commit rows (selection keys are
		// ADDITIVE — VS Code merges them with the nearer row-level `webviewItem`) need a wrapper-level
		// write here.
		if (zone !== 'ref') {
			this.injectGraphContextMenuContext(row);
		}

		// `gl-graph-row-context-menu` consumers (hover dismissal, selection sync) key off the coarse
		// `GraphZoneType`: `'ref'` for chips, `'graph'` for everything in the row body.
		const graphZoneType: GraphZoneType = zone === 'ref' ? 'ref' : 'graph';
		this.dispatchEvent(
			new CustomEvent('gl-graph-row-context-menu', {
				detail: { graphZoneType: graphZoneType, graphRow: row },
			}),
		);
	}

	private injectGraphContextMenuContext(row: GitGraphRow): void {
		// WIP rows carry NO row-level context at all (graph-commit.ts never builds one for them), so
		// the wrapper-level write is authoritative — build the `gitlens:wip…` context unconditionally.
		if (row.kind === ('workdir' satisfies GitGraphRowKind)) {
			this.writeVscodeContext(this.buildRowContextMenuContext(row));
			return;
		}

		// A plain (non-multi-selected) commit row's own `data-vscode-context` already serves its menu —
		// nothing to add at the wrapper level (avoid double work).
		const selectedRows = this.graphState.selectedRows;
		if (selectedRows?.[row.sha] !== true) return;

		const selectedShas = Object.keys(selectedRows);
		if (selectedShas.length <= 1) return;

		const repoPath = this.getRepoPath();
		const { rows: decoratedRows } = this.getDecoratedRows();
		const decoratedRowsIndex = this.getDecoratedRowsIndex(decoratedRows);
		if (repoPath == null || decoratedRowsIndex == null) return;

		const { rows: selectedSourceRows, contiguous } = resolveSelectedRowsForContextMenu(
			decoratedRowsIndex.rows,
			decoratedRowsIndex.indexBySha,
			selectedShas,
		);
		const contexts = computeSelectionContexts(selectedSourceRows, repoPath, contiguous);
		const context = contexts?.get(row.kind);
		if (context == null) return;

		this.writeVscodeContext(serializeSelectionContext(context));
	}

	private onGraphMissingAvatars(event: CustomEvent<Record<string, string>>) {
		// Host resolves the URLs and pushes them back through the `avatars` prop.
		this._ipc.sendCommand(GetMissingAvatarsCommand, { emails: event.detail });
	}

	private onGraphAvatarLoadError(event: CustomEvent<ProxyAvatarsParams>) {
		// Host re-serves the broken remote avatar URLs through its proxy.
		this._ipc.sendCommand(ProxyAvatarsCommand, event.detail);
	}

	private onGraphMissingRefsMetadata(event: CustomEvent<GraphMissingRefsMetadata>) {
		// The graph requests upstream (ahead/behind) metadata for tracked refs lazily; host resolves
		// it and pushes it back through the `refsMetadata` prop.
		this._ipc.sendCommand(GetMissingRefsMetadataCommand, { metadata: event.detail });
	}

	private onGraphVisibleDaysChanged(event: CustomEvent<{ top: number; bottom: number }>) {
		// Re-emit under the app-wide name: the minimap and graph-app listen for
		// `gl-graph-change-visible-days`, not for the graph element's own event.
		this.dispatchEvent(new CustomEvent('gl-graph-change-visible-days', { detail: event.detail }));
	}

	private onGraphRefDoubleClick(
		event: CustomEvent<{
			name: string;
			kind: string;
			remote: string | null;
			context?: string;
			current: boolean;
			metadata?: GraphRefMetadataItem;
		}>,
	) {
		const { name, kind, remote, context, current, metadata } = event.detail;

		// `gl-graph-refdoubleclick` is a misnomer — it fires on a single click. A PR chip click opens the
		// in-webview sheet directly rather than round-tripping to the host to open the browser.
		if (metadata?.type === 'pullRequest') {
			this.dispatchEvent(
				new CustomEvent('gl-graph-show-pr-sheet', {
					detail: { number: String(metadata.data.id), url: metadata.data.url },
					bubbles: true,
					composed: true,
				}),
			);

			return;
		}

		// The host expects a GraphRef shape with a refType. Map commit-graph's parsed ref kind to it.
		// `head` = local branch, `tag` = annotated/lightweight tag, `remote` = remote branch.
		const refType = kind === 'tag' ? 'tag' : kind === 'remote' ? 'remote' : 'head';
		const ref = {
			refType: refType as GraphRef['refType'],
			name: name,
			context: context,
			...(refType === 'head' ? { isCurrentHead: current } : {}),
			...(remote != null ? { owner: remote } : {}),
		} satisfies Partial<GraphRef> as GraphRef;
		this._ipc.sendCommand(DoubleClickedCommand, { type: 'ref', ref: ref, metadata: metadata });
	}

	private onScopeAnchorsUnreachable(event: CustomEvent<Set<string>>) {
		this.processUnreachableAnchors(event.detail);
	}

	/** Row loads THIS component started: a page it asked for (`graphState.loading`, which the rows push
	 *  clears) or a targeted row load from `navigateToCommit`. Issuing an anchor page alongside either is
	 *  unsafe — the host supersedes a pending rows query whose id differs, cancelling one of the two walks.
	 *
	 *  The targeted load has to be checked separately because it drives `ensureLoading`, NOT
	 *  `graphState.loading`; conversely `graphState.loading` is a shared affordance flag the timeline also
	 *  sets for its own pages. That imprecision is tolerable ONLY because a blocked signal is deferred
	 *  rather than dropped — an over-broad gate costs a replay, not a lost page. */
	private get rowLoadInFlight(): boolean {
		return this.graphState.loading || this._pendingNavigation?.hostLoadSha != null;
	}

	/** Identity of the scope AS THE ANCHOR MATH SEES IT: the focal branch plus the two anchor SHAs
	 *  `computeScopeAnchors` derives reachability from. Deliberately NOT the scope object's reference —
	 *  `applyScopeAnchorPatch` mints a new object when only `focalBranchTipSha` advances (an ordinary commit
	 *  does that), which leaves the anchors, the unreachable set, and therefore the emitter's dedupe key all
	 *  identical. Keying on the reference there would discard parked work that nothing will re-emit. */
	private scopeAnchorKey(scope: typeof graphStateContext.__context__.scope): string | undefined {
		if (scope == null) return undefined;

		return `${scope.branchRef}|${scope.mergeBase?.sha ?? ''}|${scope.mergeTargetTipSha ?? ''}`;
	}

	/** Re-run an anchor page that was deferred while a row load held the gate. Cheap enough for `updated()`:
	 *  ONE plain-field read when nothing is parked, and that early return is load-bearing, not just tidy.
	 *  `SignalWatcher` runs the whole update — `updated()` included — inside a `Signal.Computed`, so every
	 *  `graphState` read here joins the element's tracked dependencies; returning first keeps the idle path
	 *  from subscribing to anything. Setting `loading` from in here can't re-trigger this element: a computed
	 *  stays dirty for the duration of its own recomputation, and notification skips already-dirty consumers. */
	private replayDeferredUnreachableAnchors(): void {
		const deferred = this._deferredUnreachableAnchors;
		if (deferred == null) return;

		// The anchors themselves moved on (re-scope, or a rebase that relocated the merge base) — these
		// describe a boundary that no longer applies, and the live scope emits its own against current rows.
		if (deferred.key !== this.scopeAnchorKey(this.graphState.scope)) {
			this._deferredUnreachableAnchors = undefined;
			return;
		}

		if (this.rowLoadInFlight || !this.graphState.paging?.hasMore) return;

		this.processUnreachableAnchors(deferred.anchors);
	}

	private processUnreachableAnchors(anchors: ReadonlySet<string> | undefined) {
		// The component flagged that one or more scope anchors can't reach a visible ancestor
		// within the loaded graph rows (merge base not yet fetched). Ask the host for more rows
		// so the synthetic edges can resolve.
		if (anchors == null || anchors.size === 0) {
			this._deferredUnreachableAnchors = undefined;
			return;
		}

		// Blocked for now — PARK it, never drop it. The component re-emits only when the loaded row count
		// changes, and the case that most needs a retry is the one where no rows arrive at all, so a dropped
		// signal is an anchor that never gets paged: focus re-roots against its open terminus and then sits
		// there, never reaching its merge base, until the user unscopes and re-scopes. `updated()` replays.
		if (this.rowLoadInFlight || !this.graphState.paging?.hasMore) {
			this._deferredUnreachableAnchors = { anchors: anchors, key: this.scopeAnchorKey(this.graphState.scope) };
			return;
		}

		this._deferredUnreachableAnchors = undefined;

		// Drop prior dedupe state when the live scope reference changes — the stateProvider
		// assigns a new scope object on every transition (re-scope, post-invalidation re-resolve),
		// so reference inequality cleanly catches both.
		const scope = this.graphState.scope;
		if (scope !== this._unreachableAnchorScope) {
			this._unreachableAnchorRequests.clear();
			this._unreachableAnchorScope = scope;
		}

		// Forward a page-target SHA to the host so the provider's page-until-found path (graph.ts
		// `getCommitsForGraphCore` stop logic) loads enough rows in one round trip — typically the
		// `scope.mergeBase.sha` when the library flagged loaded branch tips as "unreachable"
		// because their parent chain can't reach a visible ancestor. Without that targeted page,
		// `isBounded` stays false and the library's scroll/fill-viewport paths leak generic pages.
		const rows = this.graphState.rows;
		if (rows?.length) {
			// Reachability IS row membership, so the component re-emits on every row-count change for as long
			// as anything stays unreachable. Once every candidate has spent its attempt budget we will never
			// request again, so bail before the O(rows) `loaded` scan rather than rebuilding it per page.
			// `pickScopePageTarget` can also fall back to the scope's merge base, so it counts as a candidate.
			const exhausted = (sha: string): boolean =>
				(this._unreachableAnchorRequests.get(sha)?.attempts ?? 0) >= maxUnreachableAnchorPageAttempts;
			const fallback = scope?.mergeBase?.sha;
			if ([...anchors].every(exhausted) && (fallback == null || exhausted(fallback))) return;

			const loaded = new Set(rows.map(r => r.sha));
			const rowCount = rows.length;

			// Which prior requests are still parked (ineligible to retry): those whose response delivered
			// no new rows — the provider's cursor didn't advance, so retrying re-runs the same range — and
			// those that have spent their whole attempt budget. Entries are kept, not deleted, so the
			// attempt count survives a release.
			const parked = new Set<string>();
			for (const [sha, request] of this._unreachableAnchorRequests) {
				if (rowCount <= request.rowCount || request.attempts >= maxUnreachableAnchorPageAttempts) {
					parked.add(sha);
				}
			}

			const target = pickScopePageTarget(anchors, loaded, parked, scope?.mergeBase?.sha);
			if (target == null) return;

			this._unreachableAnchorRequests.set(target, {
				rowCount: rowCount,
				attempts: (this._unreachableAnchorRequests.get(target)?.attempts ?? 0) + 1,
			});
			this.graphState.loading = true;
			this._ipc.sendCommand(GetMoreRowsCommand, { id: target });
			return;
		}

		this.graphState.loading = true;
		this._ipc.sendCommand(GetMoreRowsCommand, { id: undefined });
	}

	private _lastSyncedWipShas: Set<string> | undefined;

	private _lastVisibleWipShas: readonly string[] = [];
	private _lastSelectedPeerWipSha: string | undefined;

	/** The selected row's sha when it's a PEER WIP row — the worktree the details panel is showing, which
	 *  has to stay watched even after its row scrolls out. Undefined for commit rows and our own WIP row
	 *  (whose worktree rides the primary working-tree channel and is always watched). */
	private get selectedPeerWipSha(): string | undefined {
		const selected = this.graphState.selectedRows;
		if (selected == null) return undefined;

		const primaryWipRowId = this.primaryWipRowId;
		for (const sha of Object.keys(selected)) {
			if (isWipRowId(sha) && sha !== primaryWipRowId) return sha;
		}
		return undefined;
	}

	private onVisibleWipShasChanged(event: CustomEvent<Record<string, true>>) {
		this._lastVisibleWipShas = Object.keys(event.detail);
		this.syncWipWatches();
	}

	/**
	 * Sends the host the set of secondary WIP rows to keep watchers on: the ones in the viewport, PLUS the
	 * one the details panel is showing. A selected row keeps its panel open after scrolling away, and that
	 * worktree is the one under the most attention — dropping its watcher because its row left the viewport
	 * is how the panel ends up rendering a working tree that has since moved on. Costs one watcher.
	 */
	private syncWipWatches() {
		// The graph reports the full current set of secondary WIP rows in the viewport.
		// The host diffs against its own subscription map and opens/closes FS watchers as needed.
		const shas = [...this._lastVisibleWipShas];
		const selected = this.selectedPeerWipSha;
		if (selected != null && !shas.includes(selected)) {
			shas.push(selected);
		}

		// Defensive dedup against repeat-identical sets (the library's settle-delay collapses most dupes,
		// but a round-trip through viewport edges can still emit the same set back to back).
		if (this._lastSyncedWipShas?.size === shas.length && shas.every(s => this._lastSyncedWipShas!.has(s))) {
			return;
		}

		this._lastSyncedWipShas = new Set(shas);
		this._ipc.sendCommand(SyncWipWatchesCommand, { shas: shas });

		// Mirror the host's watcher set into graphState so `getWipState().isLive` reflects which
		// repos are currently being watched. The state provider unions in the primary repo path
		// implicitly — we only pass the secondary set here.
		const watchedRepoPaths: string[] = [];
		const wipRowsById = this.graphState.wipRowsById;
		if (wipRowsById != null) {
			for (const sha of shas) {
				const repoPath = wipRowsById[sha]?.repoPath;
				if (repoPath != null) {
					watchedRepoPaths.push(repoPath);
				}
			}
		}
		this.graphState.updateActiveWipWatchers(watchedRepoPaths);
	}

	/** Per-sha count of consecutive stats requests that came back with no entry. Cleared the moment one
	 *  lands, so it measures the CURRENT failure run rather than a session total. */
	private readonly _wipStatsMisses = new Map<string, number>();
	/** Shas awaiting the armed retry. A SET, not the failing batch's array: overlapping fetches fail
	 *  independently, and a later failure landing while the timer is armed has to join the pending retry
	 *  rather than be dropped on the floor — nothing else would ever ask about it again. */
	private readonly _wipStatsPendingRetry = new Set<string>();
	private _wipStatsRetryTimer: ReturnType<typeof setTimeout> | undefined;

	private onWipShasMissingStats(event: CustomEvent<Record<string, true>>) {
		void this.fetchWipStats(Object.keys(event.detail));
	}

	/**
	 * Fetches stats for `shas` and merges them into the hot plane.
	 *
	 * A sha that comes back empty stays stale (see below), and the graph's visible-scan only re-dispatches
	 * when the missing SET changes — so on a viewport that never moves, one transient failure would strand
	 * the row. Hence the bounded self-retry: re-ask for just the shas that failed, a couple of times, then
	 * stop. Leaving it to the scan alone would either strand the row or require re-asking on every scan.
	 */
	private async fetchWipStats(shas: string[]): Promise<void> {
		if (shas.length === 0) return;
		// The host refuses every unforced batch while `graph.showWorktreeWipStats` is off, so asking is pure
		// round-trip cost — and the empty answer would still CLAIM these rows, superseding (and dropping) the
		// selection-driven `force: true` fetch that is the only thing allowed to answer for them in that mode.
		if (this.graphState.config?.showWorktreeWipStats === false) return;

		const ticket = this.graphState.claimWipStatsRequest(shas);
		// A null response is the host answering nothing at all — same standing as a response missing every
		// sha, so it must go through the miss/retry bookkeeping below rather than returning early. It's the
		// failure most likely during startup/reconnect, and the visible-scan dedup never re-asks on its own.
		const response = (await this._ipc.sendRequest(GetWipStatsRequest, { shas: shas })) ?? {};

		// Merge fetched stats into the hot plane. Skipping no-op entries preserves the prior reference so
		// downstream reactive consumers don't churn.
		const existing = this.graphState.wipStateById;
		if (existing == null) return;

		let next: GraphWipStateById | undefined;
		let retry = false;
		for (const sha of shas) {
			const prev = existing[sha];
			if (prev == null) continue;

			// A newer request for this row has already been issued — its answer supersedes ours, whichever
			// order they land in. Skipping both branches keeps us from rolling the row back to an older read
			// and from counting a miss the newer request may not share.
			if (!this.graphState.isCurrentWipStatsRequest(sha, ticket)) continue;

			const incoming = response[sha];
			if (incoming === undefined) {
				// Host couldn't (or wouldn't) provide stats — feature disabled with force=false, the
				// underlying `git status` errored, or the batch was cancelled by a later one. Keep the
				// prior `workDirStats` rather than clobbering it with `undefined`, but LEAVE IT STALE:
				// clearing the flag here promotes an unverified value to authoritative and silences every
				// stale-gated re-ask at once.
				const misses = (this._wipStatsMisses.get(sha) ?? 0) + 1;
				this._wipStatsMisses.set(sha, misses);
				if (misses <= wipStatsMaxRetries) {
					this._wipStatsPendingRetry.add(sha);
					retry = true;
				}
				continue;
			}

			this._wipStatsMisses.delete(sha);
			this._wipStatsPendingRetry.delete(sha);
			if (
				!prev.workDirStatsStale &&
				areEqual(prev.workDirStats, incoming.workDirStats) &&
				prev.pausedOpStatus === incoming.pausedOpStatus &&
				prev.hasConflicts === incoming.hasConflicts
			) {
				continue;
			}

			next ??= { ...existing };
			next[sha] = {
				...prev,
				workDirStats: incoming.workDirStats,
				workDirStatsStale: false,
				// Retire the probe's cheap bit against the authoritative counts — see the matching note in
				// `mergeWipState`; these two merges have to agree or the WIP bar and the row disagree.
				hasChanges: hasDirtyCounts(incoming.workDirStats),
				pausedOpStatus: incoming.pausedOpStatus,
				hasConflicts: incoming.hasConflicts,
			};
		}
		if (next != null) {
			this.graphState.wipStateById = next;
		}

		if (retry) {
			this.armWipStatsRetry();
		}
	}

	/** Arms the single retry timer if anything is pending and one isn't already running — a failing batch of
	 *  N rows must not become N timers, and a failure arriving while it's armed joins the set instead. */
	private armWipStatsRetry(): void {
		if (this._wipStatsPendingRetry.size === 0 || this._wipStatsRetryTimer != null) return;

		this._wipStatsRetryTimer = setTimeout(() => {
			this._wipStatsRetryTimer = undefined;
			const pending = [...this._wipStatsPendingRetry];
			this._wipStatsPendingRetry.clear();
			void this.fetchWipStats(pending);
		}, wipStatsRetryDelayMs);
	}
}

/** The PEER (non-primary) slice of the uniform WIP row plane. The graph's own worktree is an ordinary
 *  entry there now, but it keeps its own placement, visibility, and selection rules — so the handful of
 *  peer-only consumers slice it out here rather than each re-deriving the distinction. Returns the same
 *  reference when there's nothing to drop, so identity-keyed caches downstream still hit. */
function partitionOutPrimaryWipRow(
	wipRowsById: GraphWipRowsById | undefined,
	primaryWipRowId: string | undefined,
): GraphWipRowsById | undefined {
	if (wipRowsById == null || primaryWipRowId == null || wipRowsById[primaryWipRowId] == null) return wipRowsById;

	const { [primaryWipRowId]: _primary, ...peers } = wipRowsById;
	return peers;
}

/** Builds a `{ sha: true }` highlight record from `shas`, keeping only those that render: a sha present
 *  in the decorated rows (`present`), or the primary WIP row (`primaryWipRowId`, passed only when it
 *  shows — it isn't necessarily in `present`). Returns `undefined` when nothing survives — the
 *  empty-highlight case. */
function projectShasToSelectedRows(
	shas: readonly string[] | undefined,
	present: ReadonlyMap<string, GitGraphRow> | undefined,
	primaryWipRowId: string | undefined,
): GraphSelectedRows | undefined {
	if (shas == null || shas.length === 0) return undefined;

	let result: Record<string, true> | undefined;
	for (const sha of shas) {
		const renders = (present?.has(sha) ?? false) || sha === primaryWipRowId;
		if (!renders) continue;

		(result ??= {})[sha] = true;
	}
	return result;
}

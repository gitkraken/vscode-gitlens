/*global document window*/
import type GraphContainer from '@gitkraken/gitkraken-components';
import { SignalWatcher } from '@lit-labs/signals';
import { consume } from '@lit/context';
import { html, LitElement } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import type { GitGraphRow, GitGraphRowType } from '@gitlens/git/models/graph.js';
import { uncommitted } from '@gitlens/git/models/revision.js';
import type { GitCommitReachability } from '@gitlens/git/providers/commits.js';
import { areEqual as areArraysEqual, filterMap } from '@gitlens/utils/array.js';
import { getCssMixedColorValue, getCssOpacityColorValue, getCssVariable } from '@gitlens/utils/color.js';
import { debounce } from '@gitlens/utils/debounce.js';
import { areEqual, hasKeys } from '@gitlens/utils/object.js';
import type { GraphBranchesVisibility } from '../../../../../config.js';
import type { CommitDetails } from '../../../../commitDetails/protocol.js';
import type {
	ColumnNumberBySha,
	CssVariables,
	GraphAvatars,
	GraphMissingRefsMetadata,
	GraphRef,
	GraphRefMetadataItem,
	GraphScope,
	GraphSelectedRows,
	GraphSelection,
	GraphWipMetadataBySha,
	GraphZoneType,
	ProxyAvatarsParams,
	ReadonlyGraphRow,
	RowAction,
	SelectCommitsOptions,
} from '../../../../plus/graph/protocol.js';
import {
	createSecondaryWipSha,
	DoubleClickedCommand,
	EnsureRowRequest,
	GetMissingAvatarsCommand,
	GetMissingRefsMetadataCommand,
	GetMoreRowsCommand,
	GetWipStatsRequest,
	isSecondaryWipSha,
	ProxyAvatarsCommand,
	RowActionCommand,
	SyncWipWatchesCommand,
	UpdateColumnsCommand,
	UpdateRefsVisibilityCommand,
	UpdateSelectionCommand,
} from '../../../../plus/graph/protocol.js';
import { indexAgentSessionsByRepoAndWorktree, matchAgentSessionsForWorktree } from '../../../shared/agentUtils.js';
import type { CustomEventType } from '../../../shared/components/element.js';
import { ipcContext } from '../../../shared/contexts/ipc.js';
import type { TelemetryContext } from '../../../shared/contexts/telemetry.js';
import { telemetryContext } from '../../../shared/contexts/telemetry.js';
import type { Disposable } from '../../../shared/events.js';
import type { ThemeChangeEvent } from '../../../shared/theme.js';
import { onDidChangeTheme } from '../../../shared/theme.js';
import type { AnchorKey } from '../components/anchorKey.js';
import type { RunningOperationBucket } from '../components/detailsState.js';
import type { WipRowAgentStatus } from '../components/wipRowAgentStatus.js';
import { pickWipRowAgentStatus } from '../components/wipRowAgentStatus.js';
import { graphStateContext } from '../context.js';
import type { GraphCrossPaneState } from '../graphCrossPaneState.js';
import { graphCrossPaneContext } from '../graphCrossPaneState.js';
import { isGraphSearchResultsError } from '../stateProvider.js';
import { getOverviewBranchSelectionSha } from '../utils/branchSelection.utils.js';
import { getSelectedRepoPath } from '../utils/repository.utils.js';
import {
	computeSelectionContexts,
	isUnpublishedRow,
	needsDynamicRowContext,
	serializeRowAvatarContext,
	serializeRowCommitContext,
	serializeSelectionContext,
	serializeWipContext,
} from '../utils/rowContext.utils.js';
import { pickScopePageTarget } from '../utils/scopePaging.utils.js';
import { filterSecondariesForScopeAndVisibility, shouldShowPrimaryWipRow } from '../utils/wip.utils.js';
import type { GlGraph } from './gl-graph.js';
import type { GraphWrapperTheming } from './gl-graph.react.jsx';
import type { WipCandidate } from './nearestWip.js';
import { findNearestWipByAncestry, findWipInColumn } from './nearestWip.js';
import './gl-lit-graph.js';

// The legacy GK renderer drags in a huge dependency subtree (react, react-dom,
// @gitkraken/gitkraken-components) — defer its module EXECUTION until the legacy engine actually
// renders, so new-engine sessions never pay its init cost at boot. `webpackMode: 'eager'` keeps
// the code in this same bundle file (no extra chunk — the web build requires a single file) while
// still deferring evaluation to the first call. Lit's ReactiveElement upgrades the late-defined
// `<gl-graph>` element safely (instance properties are re-applied on upgrade).
let legacyGraphRequested = false;
function ensureLegacyGraphDefined(): void {
	if (legacyGraphRequested) return;

	legacyGraphRequested = true;
	void import(/* webpackMode: 'eager' */ './gl-graph.js');
}

/**
 * Walk first-parent ancestry through a row array to produce the inclusive range from
 * `fromSha` to `toSha`. Direction-agnostic — figures out which sha is the ancestor and
 * walks the other way. Returns an empty array when neither sha can be reached from the
 * other via first-parent within the loaded rows.
 *
 * Mirrors the legacy `shiftSelectMode='topological'` semantics: the resulting selection
 * is the first-parent chain segment between the two anchors, not the visible-row slice.
 */
function walkTopologicalRange(rows: readonly GitGraphRow[], fromSha: string, toSha: string): string[] {
	const indexBySha = new Map<string, number>();
	for (let i = 0; i < rows.length; i++) {
		indexBySha.set(rows[i].sha, i);
	}
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
	selectedShas: readonly string[],
): { rows: GitGraphRow[]; contiguous: boolean } {
	const indexBySha = new Map<string, number>();
	for (let i = 0; i < decoratedRows.length; i++) {
		indexBySha.set(decoratedRows[i].sha, i);
	}

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
	row: { sha: string; parents: string[]; author: string; email: string; date: number; message: string },
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
		repoPath: repoPath,
	};
}

// These properties in the DOM are auto-generated by VS Code from our `contributes.colors` in package.json
const graphLaneThemeColors = new Map([
	['--vscode-gitlens-graphLane1Color', '#18D1D1'],
	['--vscode-gitlens-graphLane2Color', '#45C6FE'],
	['--vscode-gitlens-graphLane3Color', '#98B5FE'],
	['--vscode-gitlens-graphLane4Color', '#C9A1FE'],
	['--vscode-gitlens-graphLane5Color', '#F58FD7'],
	['--vscode-gitlens-graphLane6Color', '#FE949D'],
	['--vscode-gitlens-graphLane7Color', '#FE9B5E'],
	['--vscode-gitlens-graphLane8Color', '#E0B027'],
	['--vscode-gitlens-graphLane9Color', '#A6C750'],
	['--vscode-gitlens-graphLane10Color', '#4DD494'],
]);

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
		}>;
		'gl-graph-change-visible-days': CustomEvent<{ top: number; bottom: number }>;
		'gl-graph-filter-column': CustomEvent<{ zone: GraphZoneType }>;
		'gl-graph-mouse-leave': CustomEvent<void>;
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
	}
}

@customElement('gl-graph-wrapper')
export class GlGraphWrapper extends SignalWatcher(LitElement) {
	// use Light DOM
	protected override createRenderRoot(): HTMLElement | DocumentFragment {
		return this;
	}

	private disposables: Disposable[] = [];

	@consume({ context: graphStateContext, subscribe: true })
	private readonly graphState!: typeof graphStateContext.__context__;

	@consume({ context: graphCrossPaneContext })
	private readonly _crossPaneState!: GraphCrossPaneState;

	@consume({ context: ipcContext })
	private readonly _ipc!: typeof ipcContext.__context__;

	@consume({ context: telemetryContext as any })
	private readonly _telemetry!: TelemetryContext;

	@query('gl-graph')
	graph!: typeof GlGraph;

	private ref?: GraphContainer;
	private onSetRef = (ref: GraphContainer) => {
		this.ref = ref;
	};

	scrollGraphBy(deltaY: number): void {
		if (this.graphState.config?.useNewEngine) {
			// The pure-Lit engine renders <gl-lit-graph>, whose virtualizer (not the role="tree"
			// container) owns the scroll. Use its imperative scroll method.
			this.querySelector('gl-lit-graph')?.scrollByDelta(deltaY);
			return;
		}
		if (this.ref == null) return;

		this.ref.setScrollTop((this.ref.scrollTop ?? 0) + deltaY);
	}

	/** Clears the graph's click-pinned ref focus, if any — called when the details panel's branch
	 *  sheet closes via any path so the pin never outlives the sheet. No-op under the legacy engine
	 *  (which has no pin/focus concept). */
	clearRefFocus(): void {
		if (!this.graphState.config?.useNewEngine) return;

		this.querySelector('gl-lit-graph')?.clearRefFocus();
	}

	@state()
	private theming?: GraphWrapperTheming;

	/** The GRAPH-ROW sha(s) of graph-app's inspection anchor (the single source of truth for what the
	 *  details panel shows). The wrapper DERIVES the GK `isSelectedBySha` highlight from this each
	 *  render (`anchorShas ∩ renderableRows`), so the highlight is never stored/stale — it goes empty
	 *  when the anchor row isn't renderable (scope/visibility filter-out), and the details persist. */
	@property({ attribute: false })
	anchorShas?: readonly string[];

	// Derived-highlight bookkeeping (see `getSelectedRowsProp`):
	// - `_lastDerivedHighlight`: the anchor's projected highlight from the last render — the basis the
	//   `onSelectionChanged` discriminator uses to tell an ECHO of our own prop from genuine user INTENT.
	// - `_lastSeenHostSelection`/`_pendingHostSelectedRows`: host-initiated selections (cold-start, search,
	//   deep-link, undo) arrive as a `graphState.selectedRows` whose CONTENT differs from the last one we
	//   processed; we surface that request to the GK until the echo adopts it into the anchor. Compared by
	//   CONTENT (not reference) because the host re-ships an identical `selectedRows` (new object) on every
	//   full-state push — a re-ship must not re-arm the request. A user click never changes the host value.
	// - `_derivedHighlightCache`: identity-cache so an unrelated re-render returns the SAME highlight object
	//   (the GK `isSelectedBySha` prop diffs by identity, so a fresh object would churn the row grid).
	private _lastDerivedHighlight?: GraphSelectedRows;
	private _lastSeenHostSelection?: GraphSelectedRows;
	private _pendingHostSelectedRows?: GraphSelectedRows;
	private _derivedHighlightCache?: {
		anchorShas: readonly string[] | undefined;
		decoratedRows: GitGraphRow[] | undefined;
		showPrimary: boolean;
		result: GraphSelectedRows | undefined;
	};
	// The set of rendered row shas, cached on the (identity-stable) `decoratedRows` reference so it's
	// rebuilt only when the rows change (paging/filter) — NOT on every selection. Selecting a row must
	// stay O(anchorShas), never O(rows), or it janks badly with lots of commits loaded.
	private _presentShaCache?: { decoratedRows: GitGraphRow[] | undefined; set: ReadonlySet<string> };
	// sha→HOST row index (see `getSourceRowByShaMap`), cached on `graphState.rows` so it's built once per
	// page, not rebuilt over all rows on every selection/context-menu (the dominant per-call cost).
	private _sourceRowByShaCache?: { rows: GitGraphRow[]; map: ReadonlyMap<string, GitGraphRow> };
	// sha→DECORATED row index (see `getDecoratedRowByShaMap`), cached on the decorated `rows` reference —
	// same rationale as `_sourceRowByShaCache`, but over the decorated set (incl. synthetic WIP rows) that
	// range/toggle selection resolves against.
	private _decoratedRowByShaCache?: { rows: GitGraphRow[]; map: ReadonlyMap<string, GitGraphRow> };
	// The defensive copy of the rows passed to <gl-graph>, cached on the (identity-stable) `decoratedRows`
	// reference. Without this, render() re-`.slice()`s on EVERY render (incl. selection-only ones), handing
	// the GK GraphContainer a fresh array each time → it re-indexes all rows. Re-slicing only when
	// `decoratedRows` changes keeps the prop identity stable across selection renders (GK skips the re-index).
	private _rowsForGraphCache?: { source: GitGraphRow[] | undefined; sliced: GitGraphRow[] | undefined };

	// Tracks the last observed `branchesVisibility` + repo so a genuine in-repo TOGGLE into `'current'`
	// (not the initial paint, not a repo switch) can refocus a hidden anchor.
	private _wasBranchesVisibility?: GraphBranchesVisibility;
	private _wasVisibilityRepository?: string;

	override connectedCallback(): void {
		super.connectedCallback?.();

		this.theming = this.getGraphTheming();
		this.disposables.push(
			onDidChangeTheme(
				debounce((e: ThemeChangeEvent) => {
					this.theming = this.getGraphTheming(e);
				}, 100),
			),
		);

		document.addEventListener('gl-jump-to-pinned-branch', this.onJumpToPinnedBranch as EventListener);
		document.addEventListener('gl-jump-to-nearest-wip', this.onJumpToNearestWip as EventListener);
		document.addEventListener('gl-jump-to-commit', this.onJumpToCommit as EventListener);
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback?.();

		document.removeEventListener('gl-jump-to-pinned-branch', this.onJumpToPinnedBranch as EventListener);
		document.removeEventListener('gl-jump-to-nearest-wip', this.onJumpToNearestWip as EventListener);
		document.removeEventListener('gl-jump-to-commit', this.onJumpToCommit as EventListener);
		if (this._clearRowContextTimer != null) {
			clearTimeout(this._clearRowContextTimer);
			this._clearRowContextTimer = undefined;
		}
		this.disposables.forEach(d => d.dispose());
		this.disposables = [];
	}

	private onJumpToPinnedBranch = (e: CustomEvent<{ sha: string }>) => {
		this.ensureAndSelectCommit(e.detail.sha);
	};

	private onJumpToCommit = (e: CustomEvent<{ sha: string }>) => {
		this.ensureAndSelectCommit(e.detail.sha);
	};

	// Per-SHA column assignments from the GK component (`onColumnsCalculated`). Held on the
	// instance and consulted on-demand by `onJumpToNearestWip` so the jump never crosses lanes
	// to a different worktree's WIP. Stays undefined until the first layout pass; individual
	// shas may also be missing during the partial-load window after a scope change or paging.
	// Both gaps are handled — see `findWipInColumn`'s early-return on missing data and the
	// defensive BFS fallback in `onJumpToNearestWip` below.
	private _columnsBySha: ColumnNumberBySha | undefined;

	private onColumnsCalculated = (event: CustomEvent<ColumnNumberBySha>): void => {
		this._columnsBySha = event.detail;
	};

	private onJumpToNearestWip = (e: CustomEvent<{ fromSha: string }>) => {
		const rows = this.graphState.rows;
		const wipMetadataBySha = this.graphState.wipMetadataBySha;
		const primaryAnchor = this.graphState.branch?.sha;

		// `_columnsBySha` is only fed by the legacy engine's `onColumnsCalculated` — the new engine
		// never emits it, so pull the lane map straight from gl-lit-graph instead (it derives its own
		// columns from `processedRows`). Falls through to `_columnsBySha` (undefined) otherwise, which
		// keeps the BFS-ancestry fallback below as the safety net.
		const columnsBySha = this.graphState.config?.useNewEngine
			? (this.querySelector('gl-lit-graph')?.getColumnsBySha() ?? this._columnsBySha)
			: this._columnsBySha;

		// Primary strategy: pick the WIP in the same column as the clicked commit (the
		// "visual lane" the user sees). Exact-anchor match (clicked commit IS a branch tip
		// with a WIP) overrides — jumps directly to that branch's WIP regardless of column.
		let target = findWipInColumn(e.detail.fromSha, rows, primaryAnchor, wipMetadataBySha, columnsBySha);

		// Defensive fallback when column data for the clicked commit is unavailable — either
		// the cold-start window before any `onColumnsCalculated`, OR the brief partial-load
		// gap after scope change / paging where the clicked row is in `rows` but not yet in
		// the column map. Without this, clicks during the gap blindly snap to primary.
		// Once the column for the clicked commit lands, the column rule dominates.
		if (target == null && columnsBySha?.[e.detail.fromSha] == null) {
			const wips: WipCandidate[] = [];
			if (primaryAnchor != null) {
				wips.push({ sha: uncommitted, anchor: primaryAnchor });
			}
			if (wipMetadataBySha != null) {
				for (const [sha, meta] of Object.entries(wipMetadataBySha)) {
					if (meta.parentSha != null) {
						wips.push({ sha: sha, anchor: meta.parentSha });
					}
				}
			}
			target = findNearestWipByAncestry(e.detail.fromSha, wips, rows);
		}

		// Last-resort: no in-column WIP and no ancestry match → jump to the primary (uncommitted).
		this.ensureAndSelectCommit(target ?? uncommitted);
	};

	// Cache keyed by (rows, wipMetadataBySha, scope, branchesVisibility,
	// includeOnlyRefs, branch.id, useNewEngine) — any reference change invalidates. Scope must be in the key
	// because `filterSecondariesForScopeAndVisibility` reads `scope.branchRef`/`upstreamRef`/
	// `additionalBranchRefs` AND switches off the visibility filter entirely when scope is active,
	// AND `shouldShowPrimaryWipRow` reads `scope.branchRef` to enforce the "primary WIP belongs
	// only to the focal branch when focal === current" convention; `branchesVisibility` +
	// `includeOnlyRefs` + `currentBranchId` must also be in the key because the WIP-visibility
	// helpers read them when the scope picker is in a non-`all` mode (current/smart/favorited/agents)
	// AND when no scope is active. `useNewEngine` must also be in the key because it gates whether
	// the primary WIP row is synthesized here at all (see `getDecoratedRows` below).
	private _decoratedRowsCache?: {
		rows: GitGraphRow[] | undefined;
		wipMetadataBySha: GraphWipMetadataBySha | undefined;
		scope: GraphScope | undefined;
		branchesVisibility: typeof graphStateContext.__context__.branchesVisibility;
		includeOnlyRefs: typeof graphStateContext.__context__.includeOnlyRefs;
		currentBranchId: string | undefined;
		useNewEngine: boolean;
		result: { rows: GitGraphRow[] | undefined; showPrimary: boolean };
	};

	// Stable `date` stamps for the synthesized WIP rows, keyed by row sha. `date` is an ENGINE input
	// (topology): re-stamping `Date.now()` on every interleave made every host push look like a
	// topology change to the new engine's rows-delta classifier, defeating its append/payload fast
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

	// Injects a synthetic primary WIP row at [0] and per-worktree secondary WIP rows
	// immediately after, so the GK component renders one row per worktree. The component's
	// own auto-inject is skipped because rows[0] already has type `work-dir-changes`.
	private getDecoratedRows(): { rows: GitGraphRow[] | undefined; showPrimary: boolean } {
		const { graphState } = this;
		const rows = graphState.rows;
		const wipMetadataBySha = graphState.wipMetadataBySha;
		const scope = graphState.scope;
		const branchesVisibility = graphState.branchesVisibility;
		const includeOnlyRefs = graphState.includeOnlyRefs;
		const currentBranchId = graphState.branch?.id;
		const useNewEngine = graphState.config?.useNewEngine === true;

		const cached = this._decoratedRowsCache;
		if (
			cached != null &&
			cached.rows === rows &&
			cached.wipMetadataBySha === wipMetadataBySha &&
			cached.scope === scope &&
			cached.branchesVisibility === branchesVisibility &&
			cached.includeOnlyRefs === includeOnlyRefs &&
			cached.currentBranchId === currentBranchId &&
			cached.useNewEngine === useNewEngine
		) {
			// Return the cached `result` object identity-stable. The render boundary still
			// slices `.rows` defensively (the GK component mutates the array it receives), so
			// gl-graph sees a fresh array reference per render and runs its own dirty-check —
			// the cache's benefit here is avoiding the O(n*m) interleave work, NOT skipping
			// gl-graph re-renders. The shared `result.rows` reference inside the cache is
			// pristine because the slice-at-boundary keeps GK's mutations confined to the
			// downstream copy.
			return cached.result;
		}

		const showPrimary = shouldShowPrimaryWipRow(branchesVisibility, includeOnlyRefs, currentBranchId, scope);

		const filteredMetadata = filterSecondariesForScopeAndVisibility(
			wipMetadataBySha,
			scope,
			branchesVisibility,
			includeOnlyRefs,
		);

		// The new (Lit) engine never auto-injects a primary WIP row, so whenever one should show we must
		// synthesize it here — not only when secondaries force the interleave path. The GK engine still
		// auto-injects its own primary, so for it we take this path only when there are secondary
		// (worktree) WIP rows to interleave; the single-worktree primary stays GK's job there.
		const hasSecondaryWips = filteredMetadata != null && Object.keys(filteredMetadata).length > 0;
		let resultRows: GitGraphRow[] | undefined;
		if (rows != null && (hasSecondaryWips || (useNewEngine && showPrimary))) {
			// The GK component mutates the passed array via unshift on each render, so rows[0] may
			// already be a primary work-dir row from a previous pass. Strip it to avoid duplicates —
			// we inject our own primary below with the same role.
			const realRows = rows[0]?.type === 'work-dir-changes' ? rows.slice(1) : rows;
			const headRefSha = realRows.find(r => r.heads?.some(h => h.isCurrentHead))?.sha ?? realRows[0]?.sha;

			const primary: GitGraphRow = {
				sha: 'work-dir-changes',
				parents: headRefSha ? [headRefSha] : [],
				author: '',
				email: '',
				date: this.stableWipRowDate('work-dir-changes', headRefSha),
				message: wipRowMessage(undefined),
				type: 'work-dir-changes',
				heads: [],
				remotes: [],
				tags: [],
				// `contexts.row` is built on demand at right-click (see `buildRowContextMenuContext`).
				// `workingTreeStats.context` is still produced host-side for GK's own auto-injected primary.
			};

			// Group secondary WIP rows by the index of their parent commit in `realRows`, so each
			// worktree's WIP row renders directly above the commit it's anchored at. Worktrees whose
			// HEAD isn't in the loaded/visible rows (hidden branch, beyond paging limit) are dropped —
			// a floating WIP row with no anchor in the graph is more confusing than missing one.
			const realRowIndexBySha = new Map<string, number>();
			for (let i = 0; i < realRows.length; i++) {
				realRowIndexBySha.set(realRows[i].sha, i);
			}

			const secondariesByParentIdx = new Map<number, GitGraphRow[]>();
			for (const [sha, meta] of Object.entries(filteredMetadata ?? {})) {
				const idx = realRowIndexBySha.get(meta.parentSha);
				if (idx == null) continue;

				const row: GitGraphRow = {
					sha: sha,
					parents: [meta.parentSha],
					author: '',
					email: '',
					date: this.stableWipRowDate(sha, meta.parentSha),
					message: wipRowMessage(meta.label),
					type: 'work-dir-changes',
					heads: [],
					remotes: [],
					tags: [],
					// `contexts.row` is built on demand at right-click (see `buildRowContextMenuContext`).
				};
				const existing = secondariesByParentIdx.get(idx);
				if (existing != null) {
					existing.push(row);
				} else {
					secondariesByParentIdx.set(idx, [row]);
				}
			}

			const interleaved: GitGraphRow[] = showPrimary ? [primary] : [];
			for (let i = 0; i < realRows.length; i++) {
				const atThisIdx = secondariesByParentIdx.get(i);
				if (atThisIdx != null) {
					interleaved.push(...atThisIdx);
				}
				interleaved.push(realRows[i]);
			}

			resultRows = interleaved;
		} else if (!showPrimary && rows?.[0]?.type === 'work-dir-changes') {
			// Strip a stale GK-injected primary from a prior render; we render no primary in
			// this branch by also passing `wipVisibility='auto'` + `workingTreeStats=undefined`
			// down to the GK component so it doesn't re-inject.
			resultRows = rows.slice(1);
		} else {
			// Let the GK component handle the primary WIP auto-inject from workingTreeStats.
			resultRows = rows?.slice();
		}

		// Cache the pristine `result` for re-use on subsequent renders with identical inputs.
		// The defensive slice happens at the `gl-graph` prop boundary in `render()` so the
		// cache and consumer never share an array reference (the GK component mutates the
		// passed array; see the `render()` `.rows=` binding comment).
		const result = { rows: resultRows, showPrimary: showPrimary };
		this._decoratedRowsCache = {
			rows: rows,
			wipMetadataBySha: wipMetadataBySha,
			scope: scope,
			branchesVisibility: branchesVisibility,
			includeOnlyRefs: includeOnlyRefs,
			currentBranchId: currentBranchId,
			useNewEngine: useNewEngine,
			result: result,
		};
		return result;
	}

	// Memoization for `getRunningOperationByRowSha`: every wrapper render would otherwise build a
	// fresh Map (new identity), which cascades into Lit @property updates → React subscriber
	// push → invalidate-event-driven adornment re-resolve. Cached on the inputs that actually
	// drive the translation (registry signal value identity + primary repo path) so unrelated
	// wrapper re-renders return the same Map instance and stop the churn at the prop boundary.
	private _runningOperationByRowShaCache?: {
		registry: ReadonlyMap<AnchorKey, RunningOperationBucket>;
		primaryRepoPath: string | undefined;
		byRowSha: ReadonlyMap<string, RunningOperationBucket> | undefined;
	};

	/** Translates the canonical anchor-keyed `runningOperations` registry from the cross-pane
	 *  context into a row-sha-keyed bucket map the React row renderer can look up directly. WIP
	 *  anchors only — commit/multi-commit anchors don't decorate graph rows. Memoized on
	 *  (registry, primaryRepoPath); see {@link _runningOperationByRowShaCache}. */
	private getRunningOperationByRowSha(): ReadonlyMap<string, RunningOperationBucket> | undefined {
		const runningOperations = this._crossPaneState?.runningOperations.get();
		if (runningOperations == null) return undefined;

		const primaryRepoPath = this.getRepoPath();

		const cached = this._runningOperationByRowShaCache;
		if (cached?.registry === runningOperations && cached.primaryRepoPath === primaryRepoPath) {
			return cached.byRowSha;
		}

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

				const rowSha =
					anchor.repoPath === primaryRepoPath ? 'work-dir-changes' : createSecondaryWipSha(anchor.repoPath);
				next.set(rowSha, bucket);
			}
			byRowSha = next;
		}
		this._runningOperationByRowShaCache = {
			registry: runningOperations,
			primaryRepoPath: primaryRepoPath,
			byRowSha: byRowSha,
		};
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
	// inputs that actually drive the row→agent mapping keeps the prop identity stable for the
	// React layer and stops the invalidate-event churn at the prop boundary.
	private _agentStatusByRowShaCache?: {
		agentSessions: typeof graphStateContext.__context__.agentSessions | undefined;
		wipMetadataBySha: GraphWipMetadataBySha | undefined;
		primaryRepoPath: string | undefined;
		byRowSha: ReadonlyMap<string, WipRowAgentStatus> | undefined;
	};

	/** Maps each WIP row's sha → the worst-priority agent status running in that worktree.
	 *  Primary WIP (sha `'work-dir-changes'`) is matched against `primaryRepoPath`; secondaries
	 *  are matched against their `wipMetadataBySha[sha].repoPath`. Returns `undefined` when no
	 *  WIP row has a surfacing agent so the React layer can skip the indicator path entirely. */
	private getAgentStatusByRowSha(): ReadonlyMap<string, WipRowAgentStatus> | undefined {
		const agentSessions = this.graphState.agentSessions;
		const wipMetadataBySha = this.graphState.wipMetadataBySha;

		const primaryRepoPath = this.getRepoPath();

		const cached = this._agentStatusByRowShaCache;
		if (
			cached?.agentSessions === agentSessions &&
			cached.wipMetadataBySha === wipMetadataBySha &&
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

			// Primary WIP row — always sha `'work-dir-changes'`, anchored at the primary repo path.
			if (primaryRepoPath != null) {
				const primaryMatches = matchAgentSessionsForWorktree(index, {
					repoPath: primaryRepoPath,
					worktreePath: primaryRepoPath,
				});
				const status = pickWipRowAgentStatus(primaryMatches);
				if (status != null) {
					next.set('work-dir-changes', status);
				}
			}

			// Secondary WIP rows — one per worktree in `wipMetadataBySha`. The sha encodes the
			// worktree path; `meta.repoPath` is the same value but read directly to avoid parsing.
			if (wipMetadataBySha != null && primaryRepoPath != null) {
				for (const [sha, meta] of Object.entries(wipMetadataBySha)) {
					if (meta?.repoPath == null) continue;

					const matches = matchAgentSessionsForWorktree(index, {
						repoPath: primaryRepoPath,
						worktreePath: meta.repoPath,
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
			wipMetadataBySha: wipMetadataBySha,
			primaryRepoPath: primaryRepoPath,
			byRowSha: byRowSha,
		};
		return byRowSha;
	}

	// The gitkraken-components library doesn't preserve our row-context additions on the row objects
	// it hands to `provideAdornments`, so we project the unpushed SHAs out at the wrapper boundary
	// and pass them as a sidecar — same pattern as `runningOperationByRowSha` / `agentStatusByRowSha`.
	// Reads the `Unpublished` flag bit (single source of truth with the right-click context builder,
	// via `isUnpublishedRow`). Memoized on rows identity to keep React prop identity stable.
	//
	// Cache safety: `state.rows` is only ever replaced wholesale by the StateProvider — pagination
	// allocates a `new Array(...)` of merged rows ([stateProvider.ts](../../../plus/graph/stateProvider.ts)
	// `DidChangeRowsNotification` handler), and full updates assign the IPC payload directly. No
	// callsite mutates a row's flags in place, so identity equality on `rows` is a sufficient cache
	// key. If that invariant ever changes, switch to a content fingerprint.
	private _unpublishedShasCache?: {
		rows: readonly GitGraphRow[] | undefined;
		shas: ReadonlySet<string> | undefined;
	};

	private getUnpublishedShas(): ReadonlySet<string> | undefined {
		const rows = this.graphState.rows;
		const cached = this._unpublishedShasCache;
		if (cached != null && cached.rows === rows) return cached.shas;

		let shas: ReadonlySet<string> | undefined;
		if (rows != null && rows.length > 0) {
			const next = new Set<string>();
			for (const r of rows) {
				if (isUnpublishedRow(r)) {
					next.add(r.sha);
				}
			}
			shas = next.size > 0 ? next : undefined;
		}
		this._unpublishedShasCache = { rows: rows, shas: shas };
		return shas;
	}

	/** Derives the GK `isSelectedBySha` prop from the inspection anchor each render (the single source
	 *  of truth), with a transient pass-through for a fresh host-initiated select-request. The derived
	 *  highlight is `anchorShas ∩ renderableRows`, so it goes empty when the anchor row is filtered out
	 *  (graph shows nothing, details persist). A host request (cold-start, search, deep-link) is surfaced
	 *  until the GK echo adopts it as the anchor, after which `derived` matches and takes over. */
	/** Defensive copy of the rows handed to <gl-graph> (the GK mutates `rows[0]` — its auto-primary WIP
	 *  unshift/shift), re-sliced ONLY when `decoratedRows` actually changes. Selection-only renders reuse
	 *  the same array reference so the GraphContainer doesn't re-index all rows. A WIP-injection toggle
	 *  changes `decoratedRows`' reference (a different getDecoratedRows cache result), which forces a
	 *  re-slice — so the index-0 mutation concern stays covered while the GK's no-op stays idempotent. */
	private getRowsForGraph(decoratedRows: GitGraphRow[] | undefined): GitGraphRow[] | undefined {
		const cache = this._rowsForGraphCache;
		if (cache != null && cache.source === decoratedRows) return cache.sliced;

		const sliced = decoratedRows?.slice();
		this._rowsForGraphCache = { source: decoratedRows, sliced: sliced };
		return sliced;
	}

	private getSelectedRowsProp(
		decoratedRows: GitGraphRow[] | undefined,
		showPrimary: boolean,
	): GraphSelectedRows | undefined {
		// A host-initiated select-request arrives as a `graphState.selectedRows` whose CONTENT differs
		// from the last one we processed — re-arm pending on that (NOT on reference: the host re-ships an
		// identical value with a new object on every full-state push, which must not re-arm).
		const hostRows = this.graphState.selectedRows;
		if (!areEqual(hostRows, this._lastSeenHostSelection)) {
			this._lastSeenHostSelection = hostRows;
			this._pendingHostSelectedRows = hostRows != null && hasKeys(hostRows) ? hostRows : undefined;
		}

		const anchorShas = this.anchorShas;
		const pending = this._pendingHostSelectedRows;

		// Fast path / identity cache: in the steady state (no pending request) return the SAME highlight
		// object when the inputs are unchanged, so unrelated re-renders (hover/scroll/theme) don't churn
		// the GK prop. Skips the O(rows) `present` Set build entirely when nothing is highlighted.
		// Compare `anchorShas` by CONTENT, not reference: graph-app's `activeAnchorShas` getter returns a
		// freshly-allocated array each parent render, so a reference check would miss the cache every time.
		const cache = this._derivedHighlightCache;
		if (
			pending == null &&
			cache != null &&
			cache.decoratedRows === decoratedRows &&
			cache.showPrimary === showPrimary &&
			areArraysEqual(cache.anchorShas, anchorShas)
		) {
			this._lastDerivedHighlight = cache.result;
			return cache.result;
		}

		// Build the present-sha set ONCE per `decoratedRows` generation (cached), not per selection. The
		// primary WIP row ('work-dir-changes') renders even when it's NOT in `decoratedRows` (the GK
		// auto-injects it in the single-worktree case) — handled via `showPrimary` in the projection so
		// the cached set stays a pure mirror of the rows.
		const presentCache = this._presentShaCache;
		let present: ReadonlySet<string>;
		if (presentCache != null && presentCache.decoratedRows === decoratedRows) {
			present = presentCache.set;
		} else {
			present = new Set(decoratedRows?.map(r => r.sha));
			this._presentShaCache = { decoratedRows: decoratedRows, set: present };
		}

		const derived = projectShasToSelectedRows(anchorShas, present, showPrimary);
		this._lastDerivedHighlight = derived;
		this._derivedHighlightCache = {
			anchorShas: anchorShas,
			decoratedRows: decoratedRows,
			showPrimary: showPrimary,
			result: derived,
		};

		if (pending == null) return derived;
		if (areEqual(pending, derived)) {
			// The anchor adopted the request — drop it; the derived highlight takes over.
			this._pendingHostSelectedRows = undefined;
			return derived;
		}
		// Surface the request only while its row is renderable; otherwise keep the anchor's highlight (the
		// host's ensure/paging path loads it, then `derived` resolves on a later frame).
		return projectShasToSelectedRows(Object.keys(pending), present, showPrimary) ?? derived;
	}

	override render() {
		const { graphState } = this;
		const { rows: decoratedRows, showPrimary } = this.getDecoratedRows();

		if (graphState.config?.useNewEngine) {
			// Pure-Lit renderer (React-free). Emits the same `gl-graph-*` events + takes the same
			// props as the React `<gl-lit-graph>`, so it's a drop-in within this branch.
			return html`<gl-lit-graph
				.rows=${decoratedRows}
				.avatars=${graphState.avatars}
				.rowsStats=${graphState.rowsStats}
				.selectedRows=${this.getSelectedRowsProp(decoratedRows, showPrimary)}
				.refsMetadata=${graphState.refsMetadata}
				.refsMetadataResetToken=${graphState.refsMetadataResetToken}
				.enabledRefMetadataTypes=${graphState.config?.enabledRefMetadataTypes}
				.searchResults=${graphState.searchResults}
				.searching=${graphState.searching}
				.searchMode=${graphState.searchMode}
				.config=${graphState.config}
				.downstreams=${graphState.downstreams}
				.columns=${graphState.columns}
				.activeFilterColumns=${graphState.activeFilterColumns}
				.repoPath=${this.getRepoPath()}
				.columnsContext=${graphState.context?.header}
				.settingsContext=${graphState.context?.settings}
				.excludeRefs=${graphState.excludeRefs}
				.excludeTypes=${graphState.excludeTypes}
				.includeOnlyRefs=${graphState.includeOnlyRefs}
				.pinnedRef=${graphState.pinnedRef}
				.scope=${graphState.scope}
				.wipMetadataBySha=${graphState.wipMetadataBySha}
				.workingTreeStats=${showPrimary ? graphState.workingTreeStats : undefined}
				.runningOperationByRowSha=${this.getRunningOperationByRowSha()}
				.agentStatusByRowSha=${this.getAgentStatusByRowSha()}
				?loading=${graphState.loading || graphState.scopeLoading}
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
				@gl-graph-rowunhover=${this.onGraphRowUnhover}
				@gl-graph-rowaction=${this.onGraphRowAction}
				@gl-graph-wiprowopen=${this.onGraphWipRowOpen}
			></gl-lit-graph>`;
		}

		ensureLegacyGraphDefined();

		// The GK component runs this on every render against `rows[0]`:
		//   if (shouldShowWip(stats, wipVisibility) && rows.length && !isWipType(rows[0].type)) rows.unshift(autoPrimary)
		//   else if (!shouldShowWip(...) && rows.length && isWipType(rows[0].type))            rows.shift()  // ← removes our injected secondary
		// When we inject a secondary WIP that lands at `rows[0]` (scope to a worktree whose tip
		// is the first loaded commit, e.g. `feature/agents-collapse-modes` at the top of the
		// rows), the `else if` would shift it out under our default `auto`/`undefined` props.
		// Force `'always'` + a stats sentinel when our WIP is at index 0 so GK no-ops on it.
		// We don't always pass `'always'` because when there's no WIP at index 0 and we do, GK
		// unshifts its own primary WIP at index 0 — that produces a duplicate.
		const wipAtTop = decoratedRows?.[0]?.type === 'work-dir-changes';
		const wipVisibility = showPrimary || wipAtTop ? 'always' : 'auto';
		// Sentinel zero-stats keeps the no-op branch live without colliding with our row (GK
		// only reads `workingTreeStats` to build its own auto-primary, which it skips when
		// `rows[0]` is already a WIP). When we show our primary, pass the real stats so the
		// primary row can display them.
		const workingTreeStats = showPrimary
			? graphState.workingTreeStats
			: wipAtTop
				? GlGraphWrapper.sentinelWorkingTreeStats
				: undefined;

		return html`<gl-graph
			.setRef=${this.onSetRef}
			.activeFilterColumns=${graphState.activeFilterColumns}
			.activeRow=${graphState.activeRow}
			.avatars=${graphState.avatars}
			.columns=${graphState.columns}
			.config=${graphState.config}
			.context=${graphState.context}
			.downstreams=${graphState.downstreams}
			.excludeRefs=${graphState.excludeRefs}
			.excludeTypes=${graphState.excludeTypes}
			.includeOnlyRefs=${graphState.includeOnlyRefs}
			.pinnedRef=${graphState.pinnedRef}
			?loading=${graphState.loading || graphState.scopeLoading}
			nonce=${ifDefined(graphState.nonce)}
			.paging=${graphState.paging}
			.refsMetadata=${graphState.refsMetadata}
			.rows=${this.getRowsForGraph(decoratedRows)}
			.rowsStats=${graphState.rowsStats}
			?rowsStatsLoading=${graphState.rowsStatsLoading}
			.searchMode=${graphState.searchMode}
			.searchResults=${graphState.searchResults}
			.selectedRows=${this.getSelectedRowsProp(decoratedRows, showPrimary)}
			.theming=${this.theming}
			?windowFocused=${graphState.windowFocused}
			.workingTreeStats=${workingTreeStats}
			.wipMetadataBySha=${graphState.wipMetadataBySha}
			.wipShasSettleDelayMs=${GlGraphWrapper.wipShasSettleDelayMs}
			.wipVisibility=${wipVisibility}
			.scope=${graphState.scope}
			.repoPath=${this.getRepoPath()}
			.runningOperationByRowSha=${this.getRunningOperationByRowSha()}
			.agentStatusByRowSha=${this.getAgentStatusByRowSha()}
			.unpublishedShas=${this.getUnpublishedShas()}
			@changecolumns=${this.onColumnsChanged}
			@changerefsvisibility=${this.onRefsVisibilityChanged}
			@changeselection=${this.onSelectionChanged}
			@changevisibledays=${this.onVisibleDaysChanged}
			@filtercolumn=${this.onFilterColumn}
			@avatarloaderror=${this.onAvatarLoadError}
			@missingavatars=${this.onMissingAvatars}
			@missingrefsmetadata=${this.onMissingRefsMetadata}
			@morerows=${this.onGetMoreRows}
			@graphmouseleave=${this.onMouseLeave}
			@refdoubleclick=${this.onRefDoubleClick}
			@rowaction=${this.onRowAction}
			@wiprowopen=${this.onWipRowOpen}
			@rowcontextmenu=${this.onRowContextMenu}
			@rowdoubleclick=${this.onRowDoubleClick}
			@rowhover=${this.onRowHover}
			@rowunhover=${this.onRowUnhover}
			@scopeanchorsunreachable=${this.onScopeAnchorsUnreachable}
			@wipshasmissingstats=${this.onWipShasMissingStats}
			@visiblewipshaschanged=${this.onVisibleWipShasChanged}
			@columnscalculated=${this.onColumnsCalculated}
		></gl-graph>`;
	}

	override updated(changedProperties: Map<PropertyKey, unknown>): void {
		super.updated(changedProperties);
		this.refocusOnEnteringCurrentVisibility();
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

		const anchorShas = this.anchorShas;
		if (anchorShas?.length !== 1 || !isSecondaryWipSha(anchorShas[0])) return;

		const target = this.getCurrentBranchSelectionSha();
		if (target == null || anchorShas.includes(target)) return;

		this.ensureAndSelectCommit(target);
	}

	/** The current branch's graph-row sha to select (its WIP if it renders under the active filters,
	 *  else its tip), via the shared overview-selection cascade. */
	private getCurrentBranchSelectionSha(): string | undefined {
		const branch = this.graphState.branch;
		if (branch == null) return undefined;

		return getOverviewBranchSelectionSha(
			{ id: branch.id ?? '', repoPath: branch.repoPath, opened: true, reference: { sha: branch.sha } },
			{
				wipMetadataBySha: this.graphState.wipMetadataBySha,
				rows: this.graphState.rows,
				branchesVisibility: this.graphState.branchesVisibility,
				includeOnlyRefs: this.graphState.includeOnlyRefs,
			},
		);
	}

	override focus(): void {
		// The old path exposes an imperative ref via `.setRef`; the new engine has none, so query the
		// `<gl-lit-graph>` element (light DOM) and focus its keyboard-nav viewport directly. Without this
		// every graph-app `focus()` no-ops under the new engine and arrows/Enter do nothing until a click.
		if (this.graphState.config?.useNewEngine) {
			this.querySelector<HTMLElement>('gl-lit-graph')?.focus();
			return;
		}

		this.ref?.focus();
	}

	getCommits(shas: string[]): ReadonlyGraphRow[] {
		if (this.graphState.config?.useNewEngine) {
			const { rows } = this.getDecoratedRows();
			if (rows == null) return [];

			const set = new Set(shas);
			// A returned row is loaded; report `hidden` from the graph's displayed set so the consumer can
			// tell loaded-&-visible (fast select) from loaded-but-hidden — a collapsed lane, an active search
			// filter, or a scope drop (→ the "result hidden" warning). When the element isn't mounted, assume
			// visible (the row is loaded — never report `undefined`, which the consumer reads as "not loaded").
			const lit = this.querySelector('gl-lit-graph');
			return rows
				.filter(r => set.has(r.sha))
				.map(r => ({ ...r, hidden: lit != null ? !lit.isRowDisplayed(r.sha) : false }));
		}
		// Old engine: GraphContainer returns its own (GKC) row shape; the runtime objects are the same
		// host-built rows, so re-type them to the native shape the API surface now exposes.
		return (this.ref?.getCommits(shas) ?? []) as unknown as ReadonlyGraphRow[];
	}

	/** Resolve once this wrapper AND the underlying `<gl-lit-graph>` have flushed any pending render, so a
	 *  caller that then reads post-render state (row visibility via getCommits/selectCommits →
	 *  isRowDisplayed) sees the up-to-date displayRows after newly-paged rows land. */
	async ensureRendered(): Promise<void> {
		await this.updateComplete;
		await this.querySelector('gl-lit-graph')?.updateComplete;
	}

	selectCommits(shas: string[], options?: SelectCommitsOptions): ReadonlyGraphRow[] {
		if (this.graphState.config?.useNewEngine) {
			const rows = this.selectCommitsLit(shas);
			// Honor the same `ensureVisible` opt-in the legacy engine did: scroll the (first) selected
			// row into view ONLY when the caller asks (search-result nav, etc.) — a plain selection
			// never auto-scrolls. The reveal is no-op if the row is already on screen.
			if (options?.ensureVisible && shas.length > 0) {
				this.querySelector('gl-lit-graph')?.scrollToSha(shas[0]);
			}
			return rows;
		}
		return (this.ref?.selectCommits(shas, options) ?? []) as unknown as ReadonlyGraphRow[];
	}

	/** Monotonic counter bumped on every `ensureAndSelectCommit` entry. The synthetic-WIP retry
	 *  loop captures the value at scheduling time and bails when it advances — without this, a
	 *  retry from an earlier scope/selection can race the next ~166 ms of frames and clobber a
	 *  newer selection (e.g. user scopes to a WIP branch then immediately scopes elsewhere; the
	 *  older `work-dir-changes` retry would overwrite the newer focal-tip selection). Mirrors
	 *  the `_anchorGenerations` pattern in `stateProvider`. */
	private _selectGeneration = 0;

	/**
	 * Select rows in the commit-graph engine. The commit-graph React component derives `focusedSha`
	 * from `selectedHashes`, which itself comes from `graphState.selectedRows` — so
	 * pushing a new selectedRows map is enough to (a) highlight the row, (b) move the
	 * focus index, and (c) trigger the internal scroll-to-focus effect. We also fire the
	 * standard `gl-graph-change-selection` host event + IPC update so the details panel,
	 * minimap, and host-side selection cache stay consistent — same as if the user had
	 * clicked the row themselves.
	 */
	private selectCommitsLit(shas: string[]): ReadonlyGraphRow[] {
		const { rows: decorated } = this.getDecoratedRows();
		if (decorated == null) return [];

		const shaSet = new Set(shas);
		const matched = decorated.filter(r => shaSet.has(r.sha));
		if (matched.length === 0) return [];

		const next: GraphSelectedRows = {};
		for (const sha of shas) {
			next[sha] = true;
		}
		this.graphState.selectedRows = next;

		// Surface the same selection event a real click would. This is what wires the
		// minimap-day-selected → details-panel and selection-state-cache flows.
		const wipMetadataBySha = this.graphState.wipMetadataBySha;
		const sha = shas[0];
		const focusedRow = matched[0];
		const selection: GraphSelection[] = [
			{
				id: sha,
				type: focusedRow.type,
				active: true,
				hidden: false,
				repoPath: wipMetadataBySha?.[sha]?.repoPath,
			},
		];

		this.graphState.activeRow = `${focusedRow.sha}|${focusedRow.date}`;
		this.graphState.activeDay = focusedRow.date;

		let commits: Record<string, CommitDetails> | undefined;
		if (focusedRow.type !== 'work-dir-changes') {
			const repositories = this.graphState.repositories;
			const selectedRepoId = this.graphState.selectedRepository;
			const fallbackRepoPath =
				(selectedRepoId != null ? repositories?.find(r => r.id === selectedRepoId)?.path : undefined) ??
				repositories?.[0]?.path;
			if (fallbackRepoPath != null) {
				commits = { [focusedRow.sha]: buildCommitLite(focusedRow, fallbackRepoPath, this.graphState.avatars) };
			}
		}

		// Decode the focused row's reachability from the graph's shared table — via the HOST row (the
		// synthetic WIP shas `getDecoratedRows` injects aren't in `graphState.rows`, so this naturally
		// stays undefined for them, matching the legacy path's WIP handling).
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
		const lit = this.querySelector('gl-lit-graph');
		return matched.map(r => ({
			...r,
			hidden: lit != null ? !lit.isRowDisplayed(r.sha) : false,
		}));
	}

	/**
	 * Select a row by SHA, loading it into the graph first if necessary.
	 * The host handles both loading and selecting — the rows notification
	 * carries the updated selection so the graph renders it automatically.
	 */
	ensureAndSelectCommit(sha: string): void {
		// The primary WIP row is synthesized client-side (see `decoratedRows` above) with the
		// literal sha `'work-dir-changes'`, NOT the `uncommitted` revision constant. Callers that
		// hand us `uncommitted` (sidebar panel, overview cards, anywhere referring to "the WIP")
		// would otherwise miss the row in both the fast-path lookup and the host-side EnsureRow
		// fallback (which can't load a synthetic id either) — normalize once here so every caller
		// can use either form.
		if (sha === uncommitted) {
			sha = 'work-dir-changes';
		}

		// commit-graph engine has its own selection path — check it first, before the gitkraken-
		// components fast path below.
		if (this.graphState.config?.useNewEngine) {
			const litGraph = this.querySelector('gl-lit-graph');
			const { rows: decorated } = this.getDecoratedRows();
			if (decorated?.some(r => r.sha === sha)) {
				this.selectCommitsLit([sha]);
				// ensureAndSelect implies "reveal" (parity with the legacy `ensureVisible` fast path).
				litGraph?.scrollToSha(sha);
				return;
			}

			this.graphState.loading = true;
			// Clear the spinner off the request's own settlement — the host answers via a
			// selection-only notification, so nothing else clears `loading` (mirrors graph-header).
			void this._ipc.sendRequest(EnsureRowRequest, { id: sha, select: true }).finally(() => {
				this.graphState.loading = false;
			});
			// Row isn't loaded yet — queue the reveal so it fires once the host's rows land.
			litGraph?.scrollToSha(sha);
			return;
		}

		const generation = ++this._selectGeneration;

		// Fast path — row already loaded
		if (this.ref?.getCommits([sha])?.length) {
			this.ref.selectCommits([sha], { ensureVisible: true });
			return;
		}

		// Synthetic WIP rows (`work-dir-changes` and `worktree-wip::<path>`) can't be loaded
		// via the host EnsureRow fallback — the host has no real graph row for them, and the
		// fallback's `updateGraphWithMoreRows` won't materialize one. They appear after the next
		// render when `getDecoratedRows` synthesizes them, which only happens after Lit + React
		// catch up to a scope change. Retry with a short backoff so callers that scope and select
		// in the same tick (e.g. `handleScopeToBranchFromHeader`) don't drop the selection.
		// We need to wait through: signal flush → Lit update → wrapper's render-batching RAF →
		// React setState batch → React render → GK component indexing. A few retries cover that
		// reliably without blocking on a fixed long timeout.
		if (sha === 'work-dir-changes' || isSecondaryWipSha(sha)) {
			const tryAgain = (attempt: number): void => {
				if (this._selectGeneration !== generation) return;
				if (this.ref?.getCommits([sha])?.length) {
					this.ref.selectCommits([sha], { ensureVisible: true });
					return;
				}
				if (attempt >= 10) return;

				requestAnimationFrame(() => tryAgain(attempt + 1));
			};
			requestAnimationFrame(() => tryAgain(0));
			return;
		}

		// Ask the host to load and select the row; the rows notification
		// will carry the selection so the graph picks it up on render.
		this.graphState.loading = true;
		// Clear the spinner off the request's own settlement — the host answers via a
		// selection-only notification, so nothing else clears `loading` (mirrors graph-header).
		void this._ipc.sendRequest(EnsureRowRequest, { id: sha, select: true }).finally(() => {
			this.graphState.loading = false;
		});
	}

	private onColumnsChanged(event: CustomEventType<'graph-changecolumns'>) {
		this._ipc.sendCommand(UpdateColumnsCommand, { config: event.detail.settings });
	}

	private onGetMoreRows({ detail: sha }: CustomEventType<'graph-morerows'>) {
		this.graphState.loading = true;
		this._ipc.sendCommand(GetMoreRowsCommand, { id: sha });
	}

	private onMouseLeave() {
		this.dispatchEvent(new CustomEvent('gl-graph-mouse-leave'));
	}

	private onAvatarLoadError({ detail: emails }: CustomEventType<'graph-avatarloaderror'>) {
		this._ipc.sendCommand(ProxyAvatarsCommand, { avatars: emails });
	}

	private onMissingAvatars({ detail: emails }: CustomEventType<'graph-missingavatars'>) {
		this._ipc.sendCommand(GetMissingAvatarsCommand, { emails: emails });
	}

	private onMissingRefsMetadata({ detail: metadata }: CustomEventType<'graph-missingrefsmetadata'>) {
		this._ipc.sendCommand(GetMissingRefsMetadataCommand, { metadata: metadata });
	}

	private onRefDoubleClick({ detail: { ref, metadata } }: CustomEventType<'graph-doubleclickref'>) {
		this._ipc.sendCommand(DoubleClickedCommand, { type: 'ref', ref: ref, metadata: metadata });
	}

	private onFilterColumn({ detail }: CustomEventType<'graph-filtercolumn'>) {
		this.dispatchEvent(new CustomEvent('gl-graph-filter-column', { detail: detail }));
	}

	private onRefsVisibilityChanged({ detail }: CustomEventType<'graph-changerefsvisibility'>) {
		this._ipc.sendCommand(UpdateRefsVisibilityCommand, detail);
	}

	private onRowAction({
		detail: { action, row, worktreePath },
	}: CustomEvent<{ action: RowAction; row: GitGraphRow; worktreePath?: string }>) {
		const rowRef = { id: row.sha, type: row.type };
		// Narrow per-action so the discriminated `RowActionParams` only carries the fields its
		// case allows — keeps stash/open-changes payloads from accidentally inheriting worktreePath.
		const params =
			action === 'undo-commit'
				? { action: action, row: rowRef, worktreePath: worktreePath }
				: { action: action, row: rowRef };
		this._ipc.sendCommand(RowActionCommand, params);
	}

	// New-engine row-action button → same host command as the React graph's onRowAction (the new
	// graph emits a flat {action, sha, type, worktreePath?} detail from its click delegation).
	private onGraphRowAction({
		detail: { action, sha, type, worktreePath },
	}: CustomEvent<{ action: RowAction; sha: string; type: GitGraphRowType; worktreePath?: string }>) {
		const rowRef = { id: sha, type: type };
		// Narrow per-action so the discriminated `RowActionParams` only carries the fields its case
		// allows — keeps stash/open-changes payloads from accidentally inheriting worktreePath (mirrors
		// the React graph's onRowAction).
		const params =
			action === 'undo-commit'
				? { action: action, row: rowRef, worktreePath: worktreePath }
				: { action: action, row: rowRef };
		this._ipc.sendCommand(RowActionCommand, params);
	}

	// New-engine WIP row-open button (resolve/compose/review/agents) → look the full row up by sha and
	// re-dispatch the webview-internal event graph-app already handles (select + open details).
	private onGraphWipRowOpen({
		detail: { target, sha },
	}: CustomEvent<{ target: 'compose' | 'review' | 'resolve' | 'agents'; sha: string }>) {
		// WIP rows (primary `work-dir-changes` + per-worktree `worktree-wip::<path>`) are synthesized
		// in `getDecoratedRows()` and never exist in `graphState.rows`, so look the row up there —
		// otherwise the lookup misses and the compose/review/agents open is silently dropped.
		const row = this.getDecoratedRows().rows?.find(r => r.sha === sha);
		if (row == null) return;

		this.dispatchEvent(
			new CustomEvent('gl-graph-wip-row-open', {
				detail: { target: target, row: row },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private onWipRowOpen({
		detail: { target, row },
	}: CustomEvent<{ target: 'compose' | 'review' | 'resolve' | 'agents'; row: GitGraphRow }>) {
		// Webview-internal event — bubbles up to graph-app which selects the row, opens the
		// details panel, and routes to the requested target (compose/review/resolve enter the matching
		// workflow mode; `agents` expands the agents section). No IPC round-trip needed.
		this.dispatchEvent(
			new CustomEvent('gl-graph-wip-row-open', {
				detail: { target: target, row: row },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private onRowContextMenu({
		detail: { graphRow, graphZoneType, isAvatar },
	}: CustomEventType<'graph-rowcontextmenu'>) {
		// On-demand context injection: lean commit rows ship only `contexts.flags`, not the serialized
		// `contexts.row`/`contexts.avatar` blobs. Build the one webview-item context for the right-clicked
		// row + region here and write it onto this host element's `data-vscode-context`. VS Code's webview
		// integration walks UP the (light) DOM at contextmenu time, so a single ancestor write is what it
		// reads — no per-row attributes needed. Cleared shortly after, like `ContextMenuProxyController`.
		// Old-engine event detail is typed with the GKC row shape; the runtime object is the native row.
		this.injectRowContextMenuContext(graphRow as unknown as GitGraphRow, graphZoneType, isAvatar);

		this.dispatchEvent(
			new CustomEvent('gl-graph-row-context-menu', {
				detail: { graphZoneType: graphZoneType, graphRow: graphRow },
			}),
		);
	}

	/** Builds the serialized `data-vscode-context` for a right-clicked row on demand, or `undefined`
	 *  when the row carries its own host-built context (stash) or none is needed. */
	private buildRowContextMenuContext(graphRow: GitGraphRow, isAvatar: boolean): string | undefined {
		const repoPath = this.getRepoPath();
		if (repoPath == null) return undefined;

		// Working-changes (WIP) rows: the `gitlens:wip` context is static (worktree path + the synthetic
		// `uncommitted` ref), so build it for any WIP row we render rather than depending on host-shipped
		// stats. Primary WIP uses the selected repo path; a secondary worktree's path comes from its
		// `wipMetadataBySha` entry (keyed by the same secondary sha).
		if (graphRow.type === ('work-dir-changes' satisfies GitGraphRowType)) {
			if (isSecondaryWipSha(graphRow.sha)) {
				const meta = this.graphState.wipMetadataBySha?.[graphRow.sha];
				return meta?.repoPath != null
					? serializeWipContext(meta.repoPath, true, meta.hasConflicts ?? false)
					: undefined;
			}
			return serializeWipContext(repoPath, false, this.graphState.workingTreeStats?.hasConflicts ?? false);
		}

		// Lean commit rows: build the commit (or avatar/contributor) context from `contexts.flags` + row
		// fields. Stash rows (and any row already carrying a host-built `contexts.row`) opt out here and
		// keep the context GK renders for them.
		if (!needsDynamicRowContext(graphRow)) return undefined;

		// `graphRow` is GK's PROCESSED row, which drops GitLens-only fields like `isCurrentUser` (the
		// `+current` contributor flag that prevents offering to co-author yourself). Resolve the source
		// row by sha to recover them — same workaround the reachability/selection paths use.
		const sourceRow = this.graphState.rows?.find(r => r.sha === graphRow.sha) ?? graphRow;

		// The avatar, the bare commit node, and the lane lines all share the `graph` zone, so the region
		// is distinguished by `isAvatar` (resolved from the event target in the React layer): the avatar
		// opens the contributor menu; the node/lanes and every other zone open the commit menu.
		return isAvatar
			? serializeRowAvatarContext(sourceRow, repoPath)
			: serializeRowCommitContext(sourceRow, repoPath);
	}

	private _clearRowContextTimer: ReturnType<typeof setTimeout> | undefined;

	/** Writes a wrapper-level `data-vscode-context` synchronously (VS Code reads it synchronously on
	 *  contextmenu) and clears it shortly after; mirrors the 100ms cleanup in `ContextMenuProxyController`
	 *  / the tree-view so the attribute can't leak across menus. Shared by both engines' injection paths. */
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

	private injectRowContextMenuContext(graphRow: GitGraphRow, graphZoneType: GraphZoneType, isAvatar: boolean): void {
		// Ref zones keep their host-serialized branch/tag/remote contexts (GK renders those per element).
		if (graphZoneType === 'ref') return;

		this.writeVscodeContext(this.buildRowContextMenuContext(graphRow, isAvatar));
	}

	private onRowDoubleClick({ detail: { row, preserveFocus } }: CustomEventType<'graph-doubleclickrow'>) {
		this.dispatchEvent(
			new CustomEvent('gl-graph-row-double-click', {
				detail: { graphRow: row, preserveFocus: preserveFocus },
			}),
		);
		this._ipc.sendCommand(DoubleClickedCommand, {
			type: 'row',
			row: { id: row.sha, type: row.type },
			preserveFocus: preserveFocus,
		});
	}

	private onRowHover({ detail }: CustomEventType<'graph-graphrowhovered'>) {
		this.dispatchEvent(new CustomEvent('gl-graph-row-hover', { detail: detail }));
	}

	private onRowUnhover({ detail }: CustomEventType<'graph-graphrowunhovered'>) {
		this.dispatchEvent(new CustomEvent('gl-graph-row-unhover', { detail: detail }));
	}

	private _lastSelectionKey: string | undefined;

	// Bridge the new Lit graph's decoupled `gl-graph-rowhover*` events into the same hover pipeline the
	// legacy graph uses (rowhoverstart/track + gl-graph-row-hover/unhover → GraphHover/GetRowHover).
	// The Lit graph excludes refs from the row hover, so the zone is always a non-`ref` value.
	// The last row we resolved for a hover, kept so an unhover can still emit a `graphRow` even if
	// the rows array churned (scope change / paging) between hover-start and hover-end — otherwise
	// the consumer never gets the unhover and the rich card stays stuck open.
	private _lastHoverRow: GitGraphRow | undefined;

	private rowBySha(sha: string): GitGraphRow | undefined {
		return this.getDecoratedRows().rows?.find(r => r.sha === sha);
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

	/** sha→DECORATED row map (includes synthetic primary + per-worktree WIP rows `getDecoratedRows`
	 *  injects), cached on the decorated `rows` identity. Range/toggle selection resolves many shas per
	 *  event — a Map lookup keeps that O(selection), not O(selection × rows). */
	private getDecoratedRowByShaMap(): ReadonlyMap<string, GitGraphRow> | undefined {
		const { rows } = this.getDecoratedRows();
		if (rows == null) return undefined;

		if (this._decoratedRowByShaCache?.rows === rows) return this._decoratedRowByShaCache.map;

		const map = new Map(rows.map(r => [r.sha, r]));
		this._decoratedRowByShaCache = { rows: rows, map: map };
		return map;
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

	private onGraphRowHoverTrack({ detail }: CustomEvent<{ sha: string }>) {
		const graphRow = this.resolveHoverRow(detail.sha);
		if (graphRow == null) return;

		const graphZoneType: GraphZoneType = 'graph';
		this.dispatchEvent(
			new CustomEvent('rowhovertrack', {
				detail: { graphZoneType: graphZoneType, graphRow: graphRow },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private onGraphRowHover({ detail }: CustomEvent<{ sha: string; clientX: number; currentTarget: HTMLElement }>) {
		const graphRow = this.resolveHoverRow(detail.sha);
		if (graphRow == null) return;

		const graphZoneType: GraphZoneType = 'graph';
		this.dispatchEvent(
			new CustomEvent('gl-graph-row-hover', {
				detail: {
					graphZoneType: graphZoneType,
					graphRow: graphRow,
					clientX: detail.clientX,
					currentTarget: detail.currentTarget,
				},
			}),
		);
	}

	private onGraphRowUnhover({ detail }: CustomEvent<{ sha: string; relatedTarget: EventTarget | null }>) {
		const graphRow = this.resolveHoverRow(detail.sha);
		if (graphRow == null) return;

		const graphZoneType: GraphZoneType = 'graph';
		this.dispatchEvent(
			new CustomEvent('gl-graph-row-unhover', {
				detail: { graphZoneType: graphZoneType, graphRow: graphRow, relatedTarget: detail.relatedTarget },
			}),
		);
		this._lastHoverRow = undefined;
	}

	private _lastSentSelectionKey: string | undefined;

	private onSelectionChanged({ detail: { rows, focusedRow } }: CustomEventType<'graph-changeselection'>) {
		const wipMetadataBySha = this.graphState.wipMetadataBySha;
		const selection: GraphSelection[] = filterMap(rows, r =>
			r != null
				? ({
						id: r.sha,
						type: r.type,
						active: r === focusedRow,
						hidden: r.hidden,
						repoPath: wipMetadataBySha?.[r.sha]?.repoPath,
					} satisfies GraphSelection)
				: undefined,
		);

		const activeKey = focusedRow != null ? `${focusedRow.sha}|${focusedRow.date}` : undefined;
		this.graphState.activeRow = activeKey;
		this.graphState.activeDay = focusedRow?.date;

		// EMPTY report → never moves the inspection anchor. The GK reports empty when the derived
		// highlight is empty (scope/visibility filtered the anchor row out) or before a synthetic WIP
		// row is injected — both must KEEP the anchor (graph shows nothing, details persist). The graph
		// has no gesture that intentionally deselects to empty; the details panel owns its own dismiss.
		if (!selection.length) return;

		// Dedup the GK's repeated fires (selection + focus-row reconciliation passes, scroll) by
		// identity. Without this every redundant fire would re-send the host IPC and (on intent)
		// rebuild commit shells + re-dispatch to the details panel. `activeRow`/`activeDay` update
		// above (before the guard) so the minimap/overview keep tracking the focused row on every event.
		const selectionKey = selection
			.map(s => `${s.id}|${s.type}|${s.repoPath ?? ''}|${s.active ? 1 : 0}|${s.hidden ? 1 : 0}`)
			.join(',');
		if (selectionKey === this._lastSelectionKey) return;

		this._lastSelectionKey = selectionKey;

		// Keep the host's command-target ref + getGraph paging hint warm on every distinct selection
		// (echo OR intent) so context-menu/keyboard fallbacks act on what's actually highlighted.
		this._ipc.sendCommand(UpdateSelectionCommand, { selection: selection });

		// ECHO vs INTENT. The GK echoes the `isSelectedBySha` prop we set (the anchor's derived
		// highlight) — that's confirmation, not user intent, so don't move the anchor. A report that
		// DIVERGES from our last derived highlight is genuine intent: a user click, OR a fresh host
		// select-request the GK just surfaced (the transient pass-through in `getSelectedRowsProp`).
		// Either way, dispatch it so graph-app adopts it as the new anchor; the next render's derived
		// highlight then matches and the echo settles to a no-op.
		if (selectionMatchesSelectedRows(selection, this._lastDerivedHighlight)) return;

		// A genuine intent moves the anchor — drop any still-armed host select-request so a stale
		// request whose row pages in later can't hijack the anchor the user has now chosen.
		this._pendingHostSelectedRows = undefined;

		// Build per-sha commit shells from the underlying row data so the details panel can
		// paint the commit metadata synchronously (no IPC roundtrip) on cold-cache selections.
		// Skip WIP / work-dir-changes rows — they don't map to a commit shell.
		const fallbackRepoPath = this.getRepoPath();
		const sourceRowBySha = this.getSourceRowByShaMap();
		let commits: Record<string, CommitDetails> | undefined;
		if (sourceRowBySha != null) {
			for (const sel of selection) {
				if (sel.type === ('work-dir-changes' satisfies GitGraphRowType)) continue;

				const sourceRow = sourceRowBySha.get(sel.id);
				if (sourceRow == null) continue;

				const repoPath = sel.repoPath ?? fallbackRepoPath;
				if (repoPath == null) continue;

				commits ??= {};
				commits[sel.id] = buildCommitLite(sourceRow, repoPath, this.graphState.avatars);
			}
		}

		// Decode the focused row's reachability on demand from the graph's shared table (rows carry
		// only a `reachabilityIndex`; the GK-processed row doesn't preserve custom GitGraphRow props).
		const focusedSourceRow = focusedRow != null ? sourceRowBySha?.get(focusedRow.sha) : undefined;
		const reachability =
			focusedSourceRow != null ? this.graphState.getRowReachability(focusedSourceRow) : undefined;

		this.dispatchEvent(
			new CustomEvent('gl-graph-change-selection', {
				detail: { selection: selection, reachability: reachability, commits: commits },
			}),
		);
	}

	private onVisibleDaysChanged({ detail }: CustomEventType<'graph-changevisibledays'>) {
		this.dispatchEvent(new CustomEvent('gl-graph-change-visible-days', { detail: detail }));
	}

	/**
	 * SHAs we've already issued `GetMoreRowsCommand({ id: sha })` for via the unreachable-anchor
	 * path, mapped to the loaded row count at the time the request was sent. If a targeted walk
	 * returns without surfacing the SHA, we park it here so the next `scopeanchorsunreachable`
	 * event doesn't re-fire the same request immediately. Entries are released two ways:
	 * (a) scope reference changes (user re-scopes, or refs-moved invalidation produces a new
	 *     scope object), which clears the entire map;
	 * (b) the host response delivered new rows, growing `rows.length` past the snapshot — the
	 *     provider's cursor advanced past where the previous walk's `limit * 10` cap aborted,
	 *     so a retry continues the walk from the new cursor rather than re-running the same
	 *     range. Entries whose request didn't grow rows stay parked: retrying would hit the
	 *     same cap at the same cursor with no progress.
	 */
	private _unreachableAnchorRequests = new Map<string, number>();
	private _unreachableAnchorScope: typeof graphStateContext.__context__.scope = undefined;

	// ─── Experimental commit-graph engine handlers ────────────────────────────────────────────
	// The commit-graph `<gl-lit-graph>` element emits a smaller set of events. We translate them
	// into the same IPC commands and host events the legacy `<gl-graph>` flow uses so the
	// rest of the app (details panel, selection sync, paging) sees no behavior change.

	private onGraphSelectionChanged(
		event: CustomEvent<{
			sha: string | null;
			mode?: 'replace' | 'toggle' | 'range';
			rangeShas?: readonly string[];
		}>,
	) {
		const { sha, mode, rangeShas: graphRangeShas } = event.detail;
		const wipMetadataBySha = this.graphState.wipMetadataBySha;

		// If the user has `gitlens.graph.multiselect: 'topological'`, replace commit-graph's
		// visible-row range with the first-parent chain from the previously-focused row
		// down through the clicked row. This matches the legacy GraphContainer's
		// `shiftSelectMode='topological'` behavior — the user's mental model of "select all
		// commits between A and B" follows commit ancestry, not visible position.
		let rangeShas = graphRangeShas;
		if (mode === 'range' && this.graphState.config?.multiSelectionMode === 'topological' && sha != null) {
			const { rows: decoratedRowsForRange } = this.getDecoratedRows();
			const prior = this.graphState.activeRow?.split('|')[0];
			if (decoratedRowsForRange != null && prior != null && prior !== sha) {
				rangeShas = walkTopologicalRange(decoratedRowsForRange, prior, sha);
			}
		}

		// Look up rows in the DECORATED set (which includes synthetic primary + per-worktree
		// secondary WIP rows) — `graphState.rows` doesn't carry those, so a secondary-WIP
		// click would otherwise miss. Map lookup (not `.find()`) keeps range/toggle selection
		// O(selection), not O(selection × rows) — a shift-click range can span many shas.
		const decoratedRowBySha = this.getDecoratedRowByShaMap();
		const focusedRow = sha != null ? decoratedRowBySha?.get(sha) : undefined;

		// Build the full GraphSelection[] for the legacy event so the details panel + host
		// see the same shape regardless of mode:
		//   - `replace` (no mod) → just the focused sha
		//   - `toggle` (cmd/ctrl+click) → existing selection ⊕ this sha
		//   - `range`  (shift+click)   → host-supplied range, with `topological` mode resolved
		//                                 in the React adapter against the visible rows
		// For toggle, build off the *previously stored* selection in graphState.
		let selection: GraphSelection[];
		if (sha != null && focusedRow != null) {
			const focusedSel: GraphSelection = {
				id: sha,
				type: focusedRow.type,
				active: true,
				hidden: false,
				repoPath: wipMetadataBySha?.[sha]?.repoPath,
			};

			if (mode === 'range' && rangeShas != null && rangeShas.length > 0) {
				selection = rangeShas.flatMap<GraphSelection>(rs => {
					const r = decoratedRowBySha?.get(rs);
					if (r == null) return [];
					return [
						{
							id: rs,
							type: r.type,
							active: rs === sha,
							hidden: false,
							repoPath: wipMetadataBySha?.[rs]?.repoPath,
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
						type: r.type,
						active: false,
						hidden: false,
						repoPath: wipMetadataBySha?.[otherSha]?.repoPath,
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
		this.graphState.activeDay = focusedRow?.date;

		// Build commit-lite shells for every commit in the selection so the details panel
		// paints synchronously without an IPC round-trip. WIP rows are skipped — they have
		// no commit shell; the details panel branches on `type === 'work-dir-changes'`.
		const sourceRowBySha = this.getSourceRowByShaMap();
		let commits: Record<string, CommitDetails> | undefined;
		if (sourceRowBySha != null && selection.length > 0) {
			const repositories = this.graphState.repositories;
			const selectedRepoId = this.graphState.selectedRepository;
			const fallbackRepoPath =
				(selectedRepoId != null ? repositories?.find(r => r.id === selectedRepoId)?.path : undefined) ??
				repositories?.[0]?.path;
			if (fallbackRepoPath != null) {
				for (const sel of selection) {
					if (sel.type === 'work-dir-changes') continue;

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
		// stays undefined for them, matching the legacy path's WIP handling).
		const sourceFocusedRow = focusedRow != null ? this.getSourceRowByShaMap()?.get(focusedRow.sha) : undefined;
		const reachability =
			sourceFocusedRow != null ? this.graphState.getRowReachability(sourceFocusedRow) : undefined;

		this.dispatchEvent(
			new CustomEvent('gl-graph-change-selection', {
				detail: { selection: selection, reachability: reachability, commits: commits },
			}),
		);

		const selectionKey = selection.map(s => `${s.id}|${s.active ? 1 : 0}|${s.hidden ? 1 : 0}`).join(',');
		if (selectionKey === this._lastSentSelectionKey) return;

		this._lastSentSelectionKey = selectionKey;

		this._ipc.sendCommand(UpdateSelectionCommand, { selection: selection });
	}

	private onGraphRowDoubleClick(event: CustomEvent<{ sha: string; type: GitGraphRow['type'] }>) {
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

	private onGraphMoreRows() {
		if (this.graphState.loading || !this.graphState.paging?.hasMore) return;

		// Filter mode: once the search result set is fully loaded there's nothing more for row paging
		// to surface — mirrors the legacy engine's `hasMoreCommits` gate (gl-graph.react.tsx) so it
		// doesn't keep paging through history trying to "fill" the viewport with non-matches.
		const searchResults = this.graphState.searchResults;
		if (
			this.graphState.searchMode === 'filter' &&
			searchResults != null &&
			!isGraphSearchResultsError(searchResults) &&
			!searchResults.hasMore &&
			searchResults.commitsLoaded.count === searchResults.count
		) {
			return;
		}

		this.graphState.loading = true;
		this._ipc.sendCommand(GetMoreRowsCommand, { id: undefined });
	}

	private onGraphContextMenu(event: CustomEvent<{ sha: string; type: GitGraphRow['type']; zone: 'ref' | 'row' }>) {
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

		// Mirror the legacy `gl-graph-row-context-menu` event shape so consumers (hover
		// dismissal, selection sync) don't need an engine-aware code path. The legacy
		// gitkraken-components zone names are `'ref'` for chips and `'graph'` for the row body.
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
		if (row.type === ('work-dir-changes' satisfies GitGraphRowType)) {
			this.writeVscodeContext(this.buildRowContextMenuContext(row, false));
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
		if (repoPath == null || decoratedRows == null) return;

		const { rows: selectedSourceRows, contiguous } = resolveSelectedRowsForContextMenu(decoratedRows, selectedShas);
		const contexts = computeSelectionContexts(selectedSourceRows, repoPath, contiguous);
		const context = contexts?.get(row.type);
		if (context == null) return;

		this.writeVscodeContext(serializeSelectionContext(context));
	}

	private onGraphMissingAvatars(event: CustomEvent<Record<string, string>>) {
		// Same IPC the legacy `<gl-graph>` `missingavatars` event triggers — host resolves
		// the URLs and pushes them back through the `avatars` prop.
		this._ipc.sendCommand(GetMissingAvatarsCommand, { emails: event.detail });
	}

	private onGraphAvatarLoadError(event: CustomEvent<ProxyAvatarsParams>) {
		// Same IPC the legacy `<gl-graph>` `avatarloaderror` event triggers (see `onAvatarLoadError`
		// above) — host re-serves the broken remote avatar URLs through its proxy.
		this._ipc.sendCommand(ProxyAvatarsCommand, event.detail);
	}

	private onGraphMissingRefsMetadata(event: CustomEvent<GraphMissingRefsMetadata>) {
		// The Lit graph requests upstream (ahead/behind) metadata for tracked refs lazily; host resolves
		// it and pushes it back through the `refsMetadata` prop (same IPC as the legacy `<gl-graph>`).
		this._ipc.sendCommand(GetMissingRefsMetadataCommand, { metadata: event.detail });
	}

	private onGraphVisibleDaysChanged(event: CustomEvent<{ top: number; bottom: number }>) {
		// Forward to the same custom event the legacy graph emits — the minimap and graph-app
		// already listen for `gl-graph-change-visible-days` and don't care which engine fired.
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
		// The component flagged that one or more scope anchors can't reach a visible ancestor
		// within the loaded graph rows (merge base not yet fetched). Ask the host for more rows
		// so the synthetic edges can resolve.
		if (this.graphState.loading || !this.graphState.paging?.hasMore) return;

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
		const anchors = event.detail;
		const rows = this.graphState.rows;
		if (anchors?.size && rows?.length) {
			const loaded = new Set(rows.map(r => r.sha));
			const rowCount = rows.length;

			// Release any prior request whose response delivered new rows — the provider's cursor
			// advanced past where the previous walk's cap aborted, so retrying continues the walk
			// from the new cursor instead of re-running the same range.
			for (const [sha, requestedAtCount] of this._unreachableAnchorRequests) {
				if (rowCount > requestedAtCount) {
					this._unreachableAnchorRequests.delete(sha);
				}
			}

			const target = pickScopePageTarget(
				anchors,
				loaded,
				new Set(this._unreachableAnchorRequests.keys()),
				scope?.mergeBase?.sha,
			);
			if (target == null) return;

			this._unreachableAnchorRequests.set(target, rowCount);
			this.graphState.loading = true;
			this._ipc.sendCommand(GetMoreRowsCommand, { id: target });
			return;
		}

		this.graphState.loading = true;
		this._ipc.sendCommand(GetMoreRowsCommand, { id: undefined });
	}

	private _lastSyncedWipShas: Set<string> | undefined;

	/**
	 * How long a secondary WIP row must settle in the viewport before the GK component fires
	 * `onWipShasMissingStats` for it. Library default is 100ms; we raise it so rows that only flash
	 * through during fast scrolls never trigger stats work. Re-entry works because the library prunes
	 * its `requestedMissingWipStats` dedup for shas that leave the viewport.
	 */
	private static readonly wipShasSettleDelayMs = 350;

	/**
	 * Zero-stats sentinel passed down to GK's `workingTreeStats` prop when our injected
	 * secondary WIP lands at `rows[0]` and we're not showing the primary WIP. GK uses
	 * `workingTreeStats` + `wipVisibility` together to decide whether to keep / shift the
	 * row at index 0. Pinning a stable identity (rather than `{}` each render) avoids
	 * triggering needless `componentDidUpdate` work in GK on every wrapper render.
	 * `Object.freeze` ensures any downstream consumer that decides to mutate the prop
	 * (defensive copy helpers, future instrumentation hooks) throws in strict mode
	 * instead of silently poisoning the singleton for every future render.
	 */
	private static readonly sentinelWorkingTreeStats = Object.freeze({ added: 0, deleted: 0, modified: 0 } as const);

	private onVisibleWipShasChanged(event: CustomEvent<Record<string, true>>) {
		// The GK component tells us the full current set of secondary WIP rows in the viewport.
		// The host diffs against its own subscription map and opens/closes FS watchers as needed.
		const shas = Object.keys(event.detail);

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
		const metadata = this.graphState.wipMetadataBySha;
		if (metadata != null) {
			for (const sha of shas) {
				const repoPath = metadata[sha]?.repoPath;
				if (repoPath != null) {
					watchedRepoPaths.push(repoPath);
				}
			}
		}
		this.graphState.updateActiveWipWatchers(watchedRepoPaths);
	}

	private async onWipShasMissingStats(event: CustomEvent<Record<string, true>>) {
		const shas = Object.keys(event.detail);
		if (shas.length === 0) return;

		const response = await this._ipc.sendRequest(GetWipStatsRequest, { shas: shas });
		if (response == null) return;

		// Merge fetched stats into `wipMetadataBySha`. Skipping no-op entries via `wipStatsEqual` preserves
		// the prior reference so downstream reactive consumers don't churn.
		const existing = this.graphState.wipMetadataBySha;
		if (existing == null) return;

		let next: GraphWipMetadataBySha | undefined;
		for (const sha of shas) {
			const prev = existing[sha];
			if (prev == null) continue;

			const incoming = response[sha];
			if (incoming === undefined) {
				// Host couldn't (or wouldn't) provide stats — feature disabled with force=false,
				// or the underlying `git status` errored. Don't clobber an existing `workDirStats`
				// value with `undefined`; just clear the stale flag so the GK component's
				// `requestedMissingWipStats` dedup doesn't loop on us.
				if (prev.workDirStatsStale) {
					next ??= { ...existing };
					next[sha] = { ...prev, workDirStatsStale: false };
				}
				continue;
			}
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
				pausedOpStatus: incoming.pausedOpStatus,
				hasConflicts: incoming.hasConflicts,
			};
		}
		if (next == null) return;

		this.graphState.wipMetadataBySha = next;
	}

	private readonly themingDefaults: { cssVariables: CssVariables; themeOpacityFactor: number } = {
		cssVariables: (() => {
			const bgColor = getCssVariableValue('--color-background');
			const mixedGraphColors: CssVariables = {};
			let i = 0;
			let color;
			for (const [colorVar, colorDefault] of graphLaneThemeColors) {
				color = getCssVariableValue(colorVar, { fallbackValue: colorDefault });
				mixedGraphColors[`--graph-color-${i}`] = color;
				for (const mixInt of [15, 25, 45, 50]) {
					mixedGraphColors[`--graph-color-${i}-bg${mixInt}`] = getCssMixedColorValue(bgColor, color, mixInt);
				}
				for (const mixInt of [10, 50]) {
					mixedGraphColors[`--graph-color-${i}-f${mixInt}`] = getCssOpacityColorValue(color, mixInt);
				}
				i++;
			}
			return {
				'--app__bg0': getCssVariableValue('--color-graph-background'),
				'--panel__bg0': getCssVariableValue('--color-graph-background1'),
				'--panel__bg1': getCssVariableValue('--color-graph-background2'),
				'--section-border': getCssVariableValue('--color-graph-background2'),
				'--selected-row': getCssVariableValue('--color-graph-selected-row'),
				'--selected-row-border': 'none',
				'--hover-row': getCssVariableValue('--color-graph-hover-row'),
				'--hover-row-border': 'none',
				'--scrollable-scrollbar-thickness': getCssVariableValue('--graph-column-scrollbar-thickness'),
				'--scroll-thumb-bg': getCssVariableValue('--vscode-scrollbarSlider-background'),
				'--scroll-marker-head-color': getCssVariableValue('--color-graph-scroll-marker-head'),
				'--scroll-marker-upstream-color': getCssVariableValue('--color-graph-scroll-marker-upstream'),
				'--scroll-marker-highlights-color': getCssVariableValue('--color-graph-scroll-marker-highlights'),
				'--scroll-marker-local-branches-color': getCssVariableValue(
					'--color-graph-scroll-marker-local-branches',
				),
				'--scroll-marker-remote-branches-color': getCssVariableValue(
					'--color-graph-scroll-marker-remote-branches',
				),
				'--scroll-marker-stashes-color': getCssVariableValue('--color-graph-scroll-marker-stashes'),
				'--scroll-marker-tags-color': getCssVariableValue('--color-graph-scroll-marker-tags'),
				'--scroll-marker-selection-color': getCssVariableValue('--color-graph-scroll-marker-selection'),
				'--scroll-marker-pull-requests-color': getCssVariableValue('--color-graph-scroll-marker-pull-requests'),
				'--scroll-marker-wip-color': getCssVariableValue('--color-graph-scroll-marker-wip'),
				'--stats-added-color': getCssVariableValue('--color-graph-stats-added'),
				'--stats-deleted-color': getCssVariableValue('--color-graph-stats-deleted'),
				'--stats-files-color': getCssVariableValue('--color-graph-stats-files'),
				'--stats-bar-border-radius': getCssVariableValue('--graph-stats-bar-border-radius'),
				'--stats-bar-height': getCssVariableValue('--graph-stats-bar-height'),
				'--text-selected': getCssVariableValue('--color-graph-text-selected'),
				'--text-selected-row': getCssVariableValue('--color-graph-text-selected-row'),
				'--text-hovered': getCssVariableValue('--color-graph-text-hovered'),
				'--text-dimmed-selected': getCssVariableValue('--color-graph-text-dimmed-selected'),
				'--text-dimmed': getCssVariableValue('--color-graph-text-dimmed'),
				'--text-normal': getCssVariableValue('--color-graph-text-normal'),
				'--text-secondary': getCssVariableValue('--color-graph-text-secondary'),
				'--text-disabled': getCssVariableValue('--color-graph-text-disabled'),
				'--text-accent': getCssVariableValue('--color-link-foreground'),
				'--text-inverse': getCssVariableValue('--vscode-input-background'),
				'--text-bright': getCssVariableValue('--vscode-input-background'),
				...mixedGraphColors,
			};
		})(),
		themeOpacityFactor: 1,
	};

	private getGraphTheming(e?: ThemeChangeEvent): GraphWrapperTheming {
		// this will be called on theme updated as well as on config updated since it is dependent on the column colors from config changes and the background color from the theme
		const computedStyle = e?.computedStyle ?? window.getComputedStyle(document.documentElement);
		const bgColor = getCssVariableValue('--color-background', { computedStyle: computedStyle });

		const mixedGraphColors: CssVariables = {};

		let i = 0;
		let color;
		for (const [colorVar, colorDefault] of graphLaneThemeColors) {
			color = getCssVariableValue(colorVar, { computedStyle: computedStyle, fallbackValue: colorDefault });

			mixedGraphColors[`--column-${i}-color`] = getCssVariable(colorVar, computedStyle) || colorDefault;

			for (const mixInt of [15, 25, 45, 50]) {
				mixedGraphColors[`--graph-color-${i}-bg${mixInt}`] = getCssMixedColorValue(bgColor, color, mixInt);
			}

			i++;
		}

		const isHighContrastTheme =
			e?.isHighContrastTheme ??
			(document.body.classList.contains('vscode-high-contrast') ||
				document.body.classList.contains('vscode-high-contrast-light'));

		return {
			cssVariables: {
				...this.themingDefaults.cssVariables,
				'--selected-row-border': isHighContrastTheme
					? `1px solid ${getCssVariableValue('--color-graph-contrast-border', { computedStyle: computedStyle })}`
					: 'none',
				'--hover-row-border': isHighContrastTheme
					? `1px dashed ${getCssVariableValue('--color-graph-contrast-border', { computedStyle: computedStyle })}`
					: 'none',
				...mixedGraphColors,
			},
			themeOpacityFactor:
				parseInt(getCssVariable('--graph-theme-opacity-factor', computedStyle)) ||
				this.themingDefaults.themeOpacityFactor,
		};
	}
}

/** Builds a `{ sha: true }` highlight record from `shas`, keeping only those that render: a sha present
 *  in the decorated rows (`present`), or the primary WIP row when `showPrimary` (the GK auto-injects it,
 *  so it's not always in `present`). Returns `undefined` when nothing survives — the empty-highlight case. */
function projectShasToSelectedRows(
	shas: readonly string[] | undefined,
	present: ReadonlySet<string> | undefined,
	showPrimary: boolean,
): GraphSelectedRows | undefined {
	if (shas == null || shas.length === 0) return undefined;

	let result: Record<string, true> | undefined;
	for (const sha of shas) {
		const renders =
			(present?.has(sha) ?? false) || (showPrimary && sha === ('work-dir-changes' satisfies GitGraphRowType));
		if (!renders) continue;

		(result ??= {})[sha] = true;
	}
	return result;
}

/** Whether the reported GK selection's id-set equals a highlight record's key-set (the echo test). */
function selectionMatchesSelectedRows(selection: GraphSelection[], record: GraphSelectedRows | undefined): boolean {
	const keys = record != null ? Object.keys(record) : [];
	if (selection.length !== keys.length) return false;

	for (const sel of selection) {
		if (record?.[sel.id] == null) return false;
	}
	return true;
}

function getCssVariableValue(
	variable: string,
	options?: { computedStyle?: CSSStyleDeclaration; fallbackValue?: string },
): string {
	const fallbackValue = options?.computedStyle
		? getCssVariable(variable, options?.computedStyle)
		: options?.fallbackValue
			? options.fallbackValue
			: undefined;

	if (fallbackValue) {
		return `var(${variable}, ${fallbackValue})`;
	}
	return `var(${variable})`;
}

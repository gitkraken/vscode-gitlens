/*global document window*/
import type { WipCandidate } from '@gitkraken/commit-graph/nearestWip.js';
import { findNearestWipByAncestry, findWipInColumn } from '@gitkraken/commit-graph/nearestWip.js';
import { SignalWatcher } from '@lit-labs/signals';
import { consume } from '@lit/context';
import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { GitGraphRow, GitGraphRowType } from '@gitlens/git/models/graph.js';
import { uncommitted } from '@gitlens/git/models/revision.js';
import type { GitCommitReachability } from '@gitlens/git/providers/commits.js';
import { areEqual as areArraysEqual } from '@gitlens/utils/array.js';
import { areEqual, hasKeys } from '@gitlens/utils/object.js';
import type { GraphBranchesVisibility } from '../../../../../config.js';
import type { CommitDetails } from '../../../../commitDetails/protocol.js';
import type {
	GraphAvatars,
	GraphColumnName,
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
	createWipRowId,
	DoubleClickedCommand,
	EnsureRowRequest,
	GetMissingAvatarsCommand,
	GetMissingRefsMetadataCommand,
	GetMoreRowsCommand,
	getWipRowWorktreePath,
	GetWipStatsRequest,
	isWipRowId,
	ProxyAvatarsCommand,
	RowActionCommand,
	SyncWipWatchesCommand,
	UpdateColumnsCommand,
	UpdateSelectionCommand,
} from '../../../../plus/graph/protocol.js';
import { indexAgentSessionsByRepoAndWorktree, matchAgentSessionsForWorktree } from '../../../shared/agentUtils.js';
import type { CustomEventType } from '../../../shared/components/element.js';
import { ipcContext } from '../../../shared/contexts/ipc.js';
import type { TelemetryContext } from '../../../shared/contexts/telemetry.js';
import { telemetryContext } from '../../../shared/contexts/telemetry.js';
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
	needsDynamicRowContext,
	serializeRowCommitContext,
	serializeSelectionContext,
	serializeWipContext,
} from '../utils/rowContext.utils.js';
import { pickScopePageTarget } from '../utils/scopePaging.utils.js';
import { GraphSelectIntent } from '../utils/selectIntent.js';
import {
	filterSecondariesForScopeAndVisibility,
	isScopeFocalHead,
	shouldShowPrimaryWipRow,
} from '../utils/wip.utils.js';
import './gl-lit-graph.js';

/**
 * Walk first-parent ancestry through a row array to produce the inclusive range from
 * `fromSha` to `toSha`. Direction-agnostic — figures out which sha is the ancestor and
 * walks the other way. Returns an empty array when neither sha can be reached from the
 * other via first-parent within the loaded rows.
 *
 * This is what `gitlens.graph.multiselect: 'topological'` means: the resulting selection
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
		'gl-graph-change-column-mode': CustomEvent<{ name: GraphColumnName; mode: string | undefined }>;
		'gl-graph-change-visible-days': CustomEvent<{ top: number; bottom: number }>;
		'gl-graph-enable-changes-column': CustomEvent<void>;
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

	/** The GRAPH-ROW sha(s) of graph-app's inspection anchor (the single source of truth for what the
	 *  details panel shows). The wrapper DERIVES the row highlight from this each render
	 *  (`anchorShas ∩ renderableRows`), so the highlight is never stored/stale — it goes empty
	 *  when the anchor row isn't renderable (scope/visibility filter-out), and the details persist. */
	@property({ attribute: false })
	anchorShas?: readonly string[];

	/** The current branch's merge-target tip + name (pulled client-side via the scope-anchor pipeline) —
	 *  forwarded straight through to `<gl-lit-graph>`, the one row-marker leg the client can't derive
	 *  locally. HEAD + the upstream tip are computed in gl-lit-graph. */
	@property({ attribute: false })
	rowMarkerMergeTarget?: { sha: string; name?: string };

	// Derived-highlight bookkeeping (see `getSelectedRowsProp`):
	// - `_lastDerivedHighlight`: the anchor's projected highlight from the last render — the basis the
	//   `onSelectionChanged` discriminator uses to tell an ECHO of our own prop from genuine user INTENT.
	// - `_lastSeenHostSelection`/`_pendingHostSelectedRows`: host-initiated selections (cold-start, search,
	//   deep-link, undo) arrive as a `graphState.selectedRows` whose CONTENT differs from the last one we
	//   processed; we surface that request to the graph until the echo adopts it into the anchor. Compared
	//   by CONTENT (not reference) because the host re-ships an identical `selectedRows` (new object) on
	//   every full-state push — a re-ship must not re-arm the request. A user click never changes the host
	//   value.
	// - `_derivedHighlightCache`: identity-cache so an unrelated re-render returns the SAME highlight object
	//   (the `selectedRows` prop diffs by identity, so a fresh object would churn the row grid). It
	//   misses on a new `decoratedRows` — i.e. on every rows push, when the grid is busiest — and is skipped
	//   outright while a request is pending, which is what `_lastSelectedRowsProp` backstops.
	// - `_lastSelectedRowsProp`: the object last RETURNED by `getSelectedRowsProp`, kept so a content-equal
	//   re-projection is handed back with its identity intact. Distinct from `_lastDerivedHighlight`, which
	//   tracks the ANCHOR's projection specifically (the pending branch legitimately returns something else).
	private _lastDerivedHighlight?: GraphSelectedRows;
	private _lastSelectedRowsProp?: GraphSelectedRows;
	private _lastSeenHostSelection?: GraphSelectedRows;
	private _pendingHostSelectedRows?: GraphSelectedRows;
	private _derivedHighlightCache?: {
		anchorShas: readonly string[] | undefined;
		decoratedRows: GitGraphRow[] | undefined;
		primaryWipRowId: string | undefined;
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

	// Tracks the last observed `branchesVisibility` + repo so a genuine in-repo TOGGLE into `'current'`
	// (not the initial paint, not a repo switch) can refocus a hidden anchor.
	private _wasBranchesVisibility?: GraphBranchesVisibility;
	private _wasVisibilityRepository?: string;

	override connectedCallback(): void {
		super.connectedCallback?.();

		document.addEventListener('gl-jump-to-nearest-wip', this.onJumpToNearestWip as EventListener);
		document.addEventListener('gl-jump-to-commit', this.onJumpToCommit as EventListener);
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback?.();

		document.removeEventListener('gl-jump-to-nearest-wip', this.onJumpToNearestWip as EventListener);
		document.removeEventListener('gl-jump-to-commit', this.onJumpToCommit as EventListener);
		if (this._clearRowContextTimer != null) {
			clearTimeout(this._clearRowContextTimer);
			this._clearRowContextTimer = undefined;
		}
	}

	private onJumpToCommit = (e: CustomEvent<{ sha: string }>) => {
		this.ensureAndSelectCommit(e.detail.sha);
	};

	private onJumpToNearestWip = (e: CustomEvent<{ fromSha: string }>) => {
		const rows = this.graphState.rows;
		const wipMetadataBySha = this.graphState.wipMetadataBySha;
		const primaryAnchor = this.graphState.branch?.sha;
		// The engine-side search is host-agnostic — it takes the primary WIP as a flagged candidate
		// rather than knowing GitLens' `uncommitted` sentinel. The flag is what wins its tie-breaks.
		const primaryWip: WipCandidate | undefined =
			primaryAnchor != null ? { sha: uncommitted, anchor: primaryAnchor, primary: true } : undefined;

		// Pull the lane map straight from gl-lit-graph (it derives its own columns from `processedRows`).
		// Undefined before it mounts, which keeps the BFS-ancestry fallback below as the safety net.
		const columnsBySha = this.querySelector('gl-lit-graph')?.getColumnsBySha();

		// Primary strategy: pick the WIP in the same column as the clicked commit (the
		// "visual lane" the user sees). Exact-anchor match (clicked commit IS a branch tip
		// with a WIP) overrides — jumps directly to that branch's WIP regardless of column.
		let target = findWipInColumn(e.detail.fromSha, rows, primaryWip, wipMetadataBySha, columnsBySha);

		// Defensive fallback when column data for the clicked commit is unavailable — either
		// the cold-start window before the graph has laid out and exposed any columns, OR the brief partial-load
		// gap after scope change / paging where the clicked row is in `rows` but not yet in
		// the column map. Without this, clicks during the gap blindly snap to primary.
		// Once the column for the clicked commit lands, the column rule dominates.
		if (target == null && columnsBySha?.[e.detail.fromSha] == null) {
			const wips: WipCandidate[] = [];
			if (primaryWip != null) {
				wips.push(primaryWip);
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

	// Cache keyed by (rows, wipMetadataBySha, primaryRepoPath, scope, branchesVisibility,
	// includeOnlyRefs, branch.id + detached) — any reference change invalidates. `primaryRepoPath` is in
	// the key because the synthesized primary WIP row's id is derived from it. Scope must be
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
		wipMetadataBySha: GraphWipMetadataBySha | undefined;
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
		const wipMetadataBySha = graphState.wipMetadataBySha;
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
			cached.wipMetadataBySha === wipMetadataBySha &&
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
			return cached.result;
		}

		// Only consulted when the branch payload is missing — a known branch answers authoritatively.
		const scopeFocalIsHead = currentBranch == null ? isScopeFocalHead(rows, scope) : undefined;
		// The row's id IS its worktree path, so an unresolved repo path means there's no row to
		// synthesize yet — the next render (once `repositories`/`selectedRepository` land) shows it.
		const primaryWipRowId = primaryRepoPath != null ? createWipRowId(primaryRepoPath) : undefined;
		// Never synthesize a primary whose id a `wipMetadataBySha` entry already owns. The host excludes
		// its OWN repo from that map, so normally they can't collide — but the two paths derive the repo
		// independently (host: `repository.path`; here: the selected entry in `state.repositories`, which
		// falls back to the first entry when the id isn't found), and a disagreement would otherwise put
		// two rows with the SAME sha into the array handed to the engine. The metadata entry wins: it
		// carries that worktree's own stats, whereas the synthesized row would paint `workingTreeStats`
		// from a different worktree onto it.
		const primaryIdOwnedByWorktree = primaryWipRowId != null && wipMetadataBySha?.[primaryWipRowId] != null;
		const showPrimary =
			primaryWipRowId != null &&
			!primaryIdOwnedByWorktree &&
			shouldShowPrimaryWipRow(branchesVisibility, includeOnlyRefs, currentBranch, scope, scopeFocalIsHead);

		const filteredMetadata = filterSecondariesForScopeAndVisibility(
			wipMetadataBySha,
			scope,
			branchesVisibility,
			includeOnlyRefs,
		);

		// The engine never auto-injects a primary WIP row, so whenever one should show we must
		// synthesize it here — not only when secondaries force the interleave path.
		const hasSecondaryWips = filteredMetadata != null && Object.keys(filteredMetadata).length > 0;
		let resultRows: GitGraphRow[] | undefined;
		if (rows != null && (hasSecondaryWips || showPrimary)) {
			// Defensive: strip a leading primary work-dir row so we can't emit a duplicate alongside
			// the one we synthesize below.
			const realRows = rows[0]?.type === 'work-dir-changes' ? rows.slice(1) : rows;
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
			// The positional fallback is unscoped-only, where it's the long-standing behavior and there's
			// no projection to mis-place the row against. Under a scope it would only be reached with the
			// branch unknown or the focal tip not yet loaded, and guessing a lane there is exactly how the
			// row lands somewhere it doesn't belong — a parentless row the projection drops is the honest
			// outcome instead.
			const headRefSha =
				(showPrimary && scope?.branchName != null && currentBranch != null
					? realRows.find(r => r.heads?.some(h => h.name === scope.branchName))?.sha
					: undefined) ??
				realRows.find(r => r.heads?.some(h => h.isCurrentHead))?.sha ??
				(scope == null ? realRows[0]?.sha : undefined);

			// The primary row's ID is its worktree's WIP row id — the SAME scheme every other worktree's
			// WIP row uses (`createWipRowId`). Its `type` stays `'work-dir-changes'` (the row type).
			const primary: GitGraphRow | undefined =
				showPrimary && primaryWipRowId != null
					? {
							sha: primaryWipRowId,
							parents: headRefSha ? [headRefSha] : [],
							author: '',
							email: '',
							date: this.stableWipRowDate(primaryWipRowId, headRefSha),
							message: wipRowMessage(undefined),
							type: 'work-dir-changes',
							heads: [],
							remotes: [],
							tags: [],
							// `contexts.row` is built on demand at right-click (see `buildRowContextMenuContext`).
						}
					: undefined;

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

			const interleaved: GitGraphRow[] = primary != null ? [primary] : [];
			for (let i = 0; i < realRows.length; i++) {
				const atThisIdx = secondariesByParentIdx.get(i);
				if (atThisIdx != null) {
					interleaved.push(...atThisIdx);
				}
				interleaved.push(realRows[i]);
			}

			resultRows = interleaved;
		} else if (!showPrimary && rows?.[0]?.type === 'work-dir-changes') {
			// Defensive: host rows shouldn't carry a work-dir row, but if one leads, strip it —
			// no primary may render when `showPrimary` is off.
			resultRows = rows.slice(1);
		} else {
			// Nothing to synthesize — pass the host rows through (fresh array so the decorated
			// generation's identity stays distinct from `graphState.rows`).
			resultRows = rows?.slice();
		}

		// Cache the `result` for re-use on subsequent renders with identical inputs. The engine
		// never mutates the rows it receives, so the cached array is handed to it directly.
		const result = { rows: resultRows, showPrimary: showPrimary, primaryWipRowId: primaryWipRowId };
		this._decoratedRowsCache = {
			rows: rows,
			wipMetadataBySha: wipMetadataBySha,
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
		wipMetadataBySha: GraphWipMetadataBySha | undefined;
		primaryRepoPath: string | undefined;
		byRowSha: ReadonlyMap<string, WipRowAgentStatus> | undefined;
	};

	/** Maps each WIP row's sha → the worst-priority agent status running in that worktree.
	 *  The graph's own worktree is matched against `primaryRepoPath`; peers are matched against their
	 *  `wipMetadataBySha[sha].repoPath`. Returns `undefined` when no WIP row has a surfacing agent so
	 *  the row renderer can skip the indicator path entirely. */
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

			// The graph's own worktree's WIP row, anchored at the primary repo path.
			if (primaryRepoPath != null) {
				const primaryMatches = matchAgentSessionsForWorktree(index, {
					repoPath: primaryRepoPath,
					worktreePath: primaryRepoPath,
				});
				const status = pickWipRowAgentStatus(primaryMatches);
				if (status != null) {
					next.set(createWipRowId(primaryRepoPath), status);
				}
			}

			// Peer WIP rows — one per worktree in `wipMetadataBySha`. The sha encodes the
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

	/** Identity guard over {@link computeSelectedRowsProp}: hand back the SAME object whenever the newly
	 *  computed projection has equal CONTENT, so the prop's identity survives (a) a rows push, which
	 *  invalidates `_derivedHighlightCache` through `decoratedRows` even though the selection never moved,
	 *  and (b) a pending host request, which bypasses that cache on EVERY render. Consumers diff this prop
	 *  by identity: `<gl-lit-graph>` read a re-ship as a change of selection — which flashed the row-marker
	 *  rail on every graph update. Cheap: `areEqual`'s `a === b` fast path covers the steady state, and the
	 *  records hold 0-1 keys. */
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
	 *
	 * The projected value is recorded in `_lastDerivedHighlight` because `onSelectionChanged` needs it to
	 * tell an ECHO of this prop from genuine user INTENT — without that basis, the graph reporting back
	 * what we just told it would look like a click.
	 */
	private computeSelectedRowsProp(
		decoratedRows: GitGraphRow[] | undefined,
		primaryWipRowId: string | undefined,
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
			this._lastDerivedHighlight = cache.result;
			return cache.result;
		}

		// Build the present-sha set ONCE per `decoratedRows` generation (cached), not per selection. The
		// primary WIP row is projected in separately (`primaryWipRowId`) so the cached set stays a pure
		// mirror of the rows.
		const presentCache = this._presentShaCache;
		let present: ReadonlySet<string>;
		if (presentCache != null && presentCache.decoratedRows === decoratedRows) {
			present = presentCache.set;
		} else {
			present = new Set(decoratedRows?.map(r => r.sha));
			this._presentShaCache = { decoratedRows: decoratedRows, set: present };
		}

		const derived = projectShasToSelectedRows(anchorShas, present, primaryWipRowId);
		this._lastDerivedHighlight = derived;
		this._derivedHighlightCache = {
			anchorShas: anchorShas,
			decoratedRows: decoratedRows,
			primaryWipRowId: primaryWipRowId,
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
		return projectShasToSelectedRows(Object.keys(pending), present, primaryWipRowId) ?? derived;
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
			.scope=${graphState.scope}
			.wipMetadataBySha=${graphState.wipMetadataBySha}
			.rowMarkerMergeTarget=${this.rowMarkerMergeTarget}
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
			@gl-graph-mouseleave=${this.onMouseLeave}
		></gl-lit-graph>`;
	}

	override updated(changedProperties: Map<PropertyKey, unknown>): void {
		super.updated(changedProperties);
		this.flushPendingSelect();
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

		// Only a PEER worktree's WIP anchor is unconditionally hidden by `'current'`; the graph's own
		// WIP row survives it.
		const anchorShas = this.anchorShas;
		if (anchorShas?.length !== 1) return;

		const anchorWorktreePath = getWipRowWorktreePath(anchorShas[0]);
		if (anchorWorktreePath == null || anchorWorktreePath === this.getRepoPath()) return;

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

	/** Resolve once this wrapper AND the underlying `<gl-lit-graph>` have flushed any pending render, so a
	 *  caller that then reads post-render state (row visibility via getCommits/selectCommits →
	 *  isRowDisplayed) sees the up-to-date displayRows after newly-paged rows land. */
	async ensureRendered(): Promise<void> {
		await this.updateComplete;
		await this.querySelector('gl-lit-graph')?.updateComplete;
	}

	selectCommits(shas: string[], options?: SelectCommitsOptions): ReadonlyGraphRow[] {
		const rows = this.selectCommitsLit(shas);
		// `ensureVisible` is opt-in: scroll the (first) selected row into view ONLY when the caller asks
		// (search-result nav, etc.) — a plain selection never auto-scrolls. No-op if already on screen.
		if (options?.ensureVisible && shas.length > 0) {
			this.querySelector('gl-lit-graph')?.scrollToSha(shas[0]);
		}
		return rows;
	}

	/**
	 * Select rows in the commit-graph engine: pushing a new `graphState.selectedRows` map is enough
	 * to highlight the row and move the focus index. We also fire the standard
	 * `gl-graph-change-selection` host event + IPC update so the details panel, minimap, and
	 * host-side selection cache stay consistent — same as if the user had clicked the row themselves.
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
				// The row id IS the worktree path for a WIP row, and it's the only source that covers the
				// PRIMARY one — the host's `wipMetadataBySha` deliberately excludes the graph's own repo.
				repoPath: getWipRowWorktreePath(sha) ?? wipMetadataBySha?.[sha]?.repoPath,
			},
		];

		this.graphState.activeRow = `${focusedRow.sha}|${focusedRow.date}`;
		this.graphState.activeDay = this.dateForMinimapRow(focusedRow);

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
		const lit = this.querySelector('gl-lit-graph');
		return matched.map(r => ({
			...r,
			hidden: lit != null ? !lit.isRowDisplayed(r.sha) : false,
		}));
	}

	/**
	 * A selection asked for by {@link ensureAndSelectCommit} whose row wasn't renderable yet.
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
	private readonly _selectIntent = new GraphSelectIntent();

	/** Applies a deferred selection once its row is renderable. Called from `updated()`, so it retries on
	 *  exactly the renders that could have made the row appear. */
	private flushPendingSelect(): void {
		if (this._selectIntent.pending == null) return;

		const { rows } = this.getDecoratedRows();
		const sha = this._selectIntent.take(s => rows?.some(r => r.sha === s) === true);
		if (sha == null) return;

		this.selectCommitsLit([sha]);
	}

	/**
	 * Select a row by SHA, loading it into the graph first if necessary.
	 * The host handles both loading and selecting — the rows notification
	 * carries the updated selection so the graph renders it automatically.
	 */
	ensureAndSelectCommit(sha: string): void {
		const litGraph = this.querySelector('gl-lit-graph');
		const { rows: decorated, primaryWipRowId } = this.getDecoratedRows();

		// Callers referring to "the WIP" by git revision (sidebar panel, overview cards) hand us
		// `uncommitted`, which is NOT a row id — map it to the graph's own worktree's WIP row here, the
		// one boundary where the revision becomes a row id. Without this it would miss both the
		// fast-path lookup and the host-side EnsureRow fallback (which can't load a synthetic id either).
		if (sha === uncommitted) {
			// No resolved repo path means no row id to map onto — and `getDecoratedRows` gates the primary
			// WIP row's synthesis on the same value, so there is nothing to select in that window either.
			// Returning is the honest answer; the next render (once `repositories`/`selectedRepository`
			// land) synthesizes the row and a repeat call resolves. Deliberate: the previous behavior
			// normalized to a path-free constant and fired a host round-trip that could never resolve it.
			if (primaryWipRowId == null) return;

			sha = primaryWipRowId;
		}

		// Newest ask wins: supersede any intent still waiting for its row. Below EVERY early return above —
		// `begin()` clears what's queued, so a call that can't possibly select anything must not run it and
		// silently cancel an unrelated ask that is still live.
		const generation = this._selectIntent.begin();

		if (decorated?.some(r => r.sha === sha)) {
			this.selectCommitsLit([sha]);
			// ensureAndSelect implies "reveal".
			litGraph?.scrollToSha(sha);
			return;
		}

		// Synthetic WIP rows are client-side only — the host has no graph row for them, and asking it to
		// EnsureRow one costs an unbounded walk for an id that can never resolve. Queue the reveal and let
		// the next `getDecoratedRows` synthesis surface the row instead.
		if (isWipRowId(sha)) {
			// The next `getDecoratedRows` synthesis is what surfaces this row, so hold the selection for it.
			this._selectIntent.defer(sha, generation);
			litGraph?.scrollToSha(sha);
			return;
		}

		this.graphState.loading = true;
		// Clear the spinner off the request's own settlement — the host answers via a
		// selection-only notification, so nothing else clears `loading` (mirrors graph-header).
		void this._ipc.sendRequest(EnsureRowRequest, { id: sha, select: true }).finally(() => {
			this.graphState.loading = false;
		});
		// The host answers with a selection-bearing rows push, but that push can lose a race with a
		// locally-synthesized row, so hold the intent here too — unless a newer ask has replaced us.
		this._selectIntent.defer(sha, generation);
		// Row isn't loaded yet — queue the reveal so it fires once the host's rows land.
		litGraph?.scrollToSha(sha);
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
	}: CustomEvent<{ action: RowAction; sha: string; type: GitGraphRowType; worktreePath?: string }>) {
		const rowRef = { id: sha, type: type };
		// Narrow per-action so the discriminated `RowActionParams` only carries the fields its case
		// allows — keeps stash/open-changes payloads from accidentally inheriting worktreePath.
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
		// WIP rows (one `wip::<worktreePath>` per worktree) are synthesized in `getDecoratedRows()` and
		// never exist in `graphState.rows`, so look the row up there — otherwise the lookup misses and
		// the compose/review/agents open is silently dropped.
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

	/** Builds the serialized `data-vscode-context` for a right-clicked row on demand, or `undefined`
	 *  when the row carries its own host-built context (stash) or none is needed. */
	private buildRowContextMenuContext(graphRow: GitGraphRow): string | undefined {
		const repoPath = this.getRepoPath();
		if (repoPath == null) return undefined;

		// Working-changes (WIP) rows: the `gitlens:wip` context is static (worktree path + the synthetic
		// `uncommitted` ref), so build it for any WIP row we render rather than depending on host-shipped
		// stats. A peer worktree's conflict bit comes from its `wipMetadataBySha` entry (keyed by the same
		// row id); the graph's own worktree reads `workingTreeStats`.
		if (graphRow.type === ('work-dir-changes' satisfies GitGraphRowType)) {
			const worktreePath = getWipRowWorktreePath(graphRow.sha);
			if (worktreePath != null && worktreePath !== repoPath) {
				const meta = this.graphState.wipMetadataBySha?.[graphRow.sha];
				return meta?.repoPath != null
					? serializeWipContext(meta.repoPath, true, meta.hasConflicts ?? false)
					: undefined;
			}
			return serializeWipContext(repoPath, false, this.graphState.workingTreeStats?.hasConflicts ?? false);
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
		readonly type: string;
		readonly parents: readonly string[];
		readonly date: number;
	}): number {
		// Only SECONDARY WIP rows follow their anchor. Both WIP kinds share the `work-dir-changes` type
		// and a `now`-based `date` stamp, but they sit in different places: the primary row belongs at
		// the start of the timeline (so its own stamp IS its position — same as how `type:wip` search
		// dates it), while a secondary row is drawn against its worktree HEAD and should track that
		// commit's date. Keying on the type alone dragged the primary back to HEAD's day.
		if (!isSecondaryWipSha(row.sha)) return row.date;

		const anchorSha = row.parents[0];
		const anchorRow = anchorSha != null ? this.getSourceRowByShaMap()?.get(anchorSha) : undefined;
		// Worktree HEADs are routinely outside the loaded window, so fall back to the metadata's
		// `parentDate` — the same value `type:wip` search dates these rows by — rather than the row's
		// own `now` stamp, which would drag every unloaded worktree onto today.
		return anchorRow?.date ?? this.graphState.wipMetadataBySha?.[row.sha]?.parentDate ?? row.date;
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
		const wipMetadataBySha = this.graphState.wipMetadataBySha;

		// This event is user intent (a click / keyboard select). It outranks any queued jump still waiting
		// for its row — landing that later would silently move the user off what they just picked.
		this._selectIntent.cancel();

		// If the user has `gitlens.graph.multiselect: 'topological'`, replace commit-graph's
		// visible-row range with the first-parent chain from the previously-focused row
		// down through the clicked row — the user's mental model of "select all
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
				type: focusedRow.type,
				active: true,
				hidden: false,
				// The row id IS the worktree path for a WIP row, and it's the only source that covers the
				// PRIMARY one — the host's `wipMetadataBySha` deliberately excludes the graph's own repo.
				repoPath: getWipRowWorktreePath(sha) ?? wipMetadataBySha?.[sha]?.repoPath,
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
							repoPath: getWipRowWorktreePath(rs) ?? wipMetadataBySha?.[rs]?.repoPath,
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
						repoPath: getWipRowWorktreePath(otherSha) ?? wipMetadataBySha?.[otherSha]?.repoPath,
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
		// stays undefined for them).
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
		// to surface, so don't keep paging through history trying to "fill" the viewport with
		// non-matches.
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
		if (row.type === ('work-dir-changes' satisfies GitGraphRowType)) {
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
		if (repoPath == null || decoratedRows == null) return;

		const { rows: selectedSourceRows, contiguous } = resolveSelectedRowsForContextMenu(decoratedRows, selectedShas);
		const contexts = computeSelectionContexts(selectedSourceRows, repoPath, contiguous);
		const context = contexts?.get(row.type);
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

	private onVisibleWipShasChanged(event: CustomEvent<Record<string, true>>) {
		// The graph reports the full current set of secondary WIP rows in the viewport.
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
				// value with `undefined`; just clear the stale flag so the graph's visible-scan
				// missing-stats dedup doesn't loop on us.
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
}

/** Builds a `{ sha: true }` highlight record from `shas`, keeping only those that render: a sha present
 *  in the decorated rows (`present`), or the primary WIP row (`primaryWipRowId`, passed only when it
 *  shows — it isn't necessarily in `present`). Returns `undefined` when nothing survives — the
 *  empty-highlight case. */
function projectShasToSelectedRows(
	shas: readonly string[] | undefined,
	present: ReadonlySet<string> | undefined,
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

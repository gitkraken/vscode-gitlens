/**
 * Stateful, rendering-agnostic projection of processed graph rows into the rows a view displays.
 *
 * Owns lane-fold intent, scope projection, default-collapse freezing, and the append/prefix-splice
 * caches that keep projection work proportional to an engine transition. It also owns final search
 * filtering and the rendered-row index/width. Focus, viewport anchoring, and paging dispatch remain
 * consumer concerns.
 */

import type { CommitGraphSessionTransition } from './engine/session.js';
import type { LaneSegment, ProcessedGraphRow, Sha } from './engine/types.js';
import {
	appendDroppedRows,
	applyDroppedRows,
	compactColumns,
	composeEffectiveCollapsed,
	computeDefaultCollapsedSet,
	computeDroppedShas,
	computeSegmentMaps,
	spliceDroppedRows,
} from './laneCollapse.js';
import type { FocalScope, ScopeAnchors, ScopeProjection } from './scope.js';
import { computeScopeProjection } from './scope.js';

export type CommitGraphProjectionInput = {
	/** Dataset identity. A change clears user fold overrides so sha collisions cannot leak across repos. */
	identity?: string;
	/** View/scope intent identity. A change clears overrides keyed to the prior projection's segment tips. */
	viewKey?: string;
	rows: readonly ProcessedGraphRow[];
	segments: readonly LaneSegment[];
	unloadedColumns: ReadonlyMap<Sha, number>;
	indexBySha: ReadonlyMap<Sha, number>;
	transition: CommitGraphSessionTransition;
	trunkSegmentTip?: Sha;
	wipAnchorShas: ReadonlySet<Sha>;
	wipSegmentTips: ReadonlySet<Sha>;
	foldingEnabled: boolean;
	foldingDefault: 'none' | 'all' | 'auto';
	searchActive: boolean;
	/** Present only for search-filter mode. An empty set intentionally projects an empty result list. */
	filterShas?: ReadonlySet<Sha>;
	scope?: FocalScope;
	scopeAnchors: ScopeAnchors;
};

/**
 * Current projection state. Collections are session-owned and exposed read-only; consumers must not
 * mutate or retain them as historical snapshots across a later `update` or `updateFilter`.
 */
export type CommitGraphProjectionState = {
	rows: readonly ProcessedGraphRow[];
	indexBySha: ReadonlyMap<Sha, number>;
	maxColumn: number;
	effectiveCollapsed: ReadonlySet<Sha>;
	segmentsByTipSha: ReadonlyMap<Sha, LaneSegment>;
	collapsedByTipSha: ReadonlyMap<Sha, LaneSegment>;
	visibleJunctions: ReadonlySet<Sha>;
	hiddenCountByTipSha: ReadonlyMap<Sha, number>;
	scopeProjection?: ScopeProjection;
};

export type CommitGraphProjectionToggle = {
	wasCollapsed: boolean;
	state: CommitGraphProjectionState;
};

export class CommitGraphProjectionSession {
	private _identity?: string;
	private _viewKey?: string;
	private _input?: CommitGraphProjectionInput;
	private _manuallyCollapsed: ReadonlySet<Sha> = new Set();
	private _manuallyExpanded: ReadonlySet<Sha> = new Set();
	private _defaultCollapsed: ReadonlySet<Sha> = new Set();
	private _state: CommitGraphProjectionState = {
		rows: [],
		indexBySha: new Map(),
		maxColumn: 0,
		effectiveCollapsed: new Set(),
		segmentsByTipSha: new Map(),
		collapsedByTipSha: new Map(),
		visibleJunctions: new Set(),
		hiddenCountByTipSha: new Map(),
	};

	private _priorRows?: readonly ProcessedGraphRow[];
	private _priorIndexBySha?: ReadonlyMap<Sha, number>;
	private _priorCollapsedRows?: readonly ProcessedGraphRow[];
	private _priorCollapsedByTipSha?: ReadonlyMap<Sha, LaneSegment>;
	private _priorScopeProjection?: ScopeProjection;
	private _priorDroppedShas?: ReadonlySet<Sha>;
	private _priorUnloadedColumns?: ReadonlyMap<Sha, number>;
	private _structuralRows: readonly ProcessedGraphRow[] = [];
	private readonly _flattenedRows = new WeakMap<ProcessedGraphRow, ProcessedGraphRow>();

	update(
		input: CommitGraphProjectionInput,
		options?: { refreshDefaultCollapse?: boolean },
	): CommitGraphProjectionState {
		if (input.identity !== this._identity || input.viewKey !== this._viewKey) {
			this._manuallyCollapsed = new Set();
			this._manuallyExpanded = new Set();
			this._defaultCollapsed = new Set();
		}

		const scopeProjection = input.foldingEnabled
			? computeScopeProjection(input.rows, input.scope, input.scopeAnchors, this._manuallyExpanded)
			: undefined;
		let effectiveCollapsed: ReadonlySet<Sha>;
		let segmentsByTipSha: ReadonlyMap<Sha, LaneSegment>;
		let collapsedByTipSha: ReadonlyMap<Sha, LaneSegment>;
		let visibleJunctions: ReadonlySet<Sha>;
		let hiddenCountByTipSha: ReadonlyMap<Sha, number>;

		if (scopeProjection != null) {
			segmentsByTipSha = scopeProjection.foldSegments;
			collapsedByTipSha = scopeProjection.collapsedByTipSha;
			hiddenCountByTipSha = scopeProjection.hiddenCountByTipSha;
			effectiveCollapsed = new Set(scopeProjection.collapsedByTipSha.keys());
			visibleJunctions = new Set();
		} else {
			if (options?.refreshDefaultCollapse === true) {
				this._defaultCollapsed = computeDefaultCollapsedSet({
					lanesFoldingDefault: input.foldingDefault,
					segments: input.segments,
					searchActive: input.searchActive,
					trunkSegmentTip: input.trunkSegmentTip,
					wipTipShas: input.wipSegmentTips,
				});
			}
			effectiveCollapsed = input.foldingEnabled
				? composeEffectiveCollapsed(this._defaultCollapsed, this._manuallyExpanded, this._manuallyCollapsed)
				: new Set<Sha>();
			const maps = computeSegmentMaps({
				segments: input.segments,
				wipAnchorShas: input.wipAnchorShas,
				trunkSegmentTip: input.trunkSegmentTip,
				effectiveCollapsed: effectiveCollapsed,
			});
			segmentsByTipSha = maps.segmentsByTipSha;
			collapsedByTipSha = maps.collapsedByTipSha;
			visibleJunctions = maps.visibleJunctions;
			hiddenCountByTipSha = maps.hiddenCountByTipSha;
		}

		const structuralRows = this.projectRows(input, scopeProjection, collapsedByTipSha, visibleJunctions);
		const rows = this.filterRows(structuralRows, input.filterShas);
		// Only an unfiltered projection can be an append — a filter re-selects arbitrary rows.
		const display = this.deriveDisplayIndex(rows, input.filterShas == null);
		this._state = {
			rows: rows,
			indexBySha: display.indexBySha,
			maxColumn: display.maxColumn,
			effectiveCollapsed: effectiveCollapsed,
			segmentsByTipSha: segmentsByTipSha,
			collapsedByTipSha: collapsedByTipSha,
			visibleJunctions: visibleJunctions,
			hiddenCountByTipSha: hiddenCountByTipSha,
			scopeProjection: scopeProjection,
		};
		this._identity = input.identity;
		this._viewKey = input.viewKey;
		this._input = input;
		this._structuralRows = structuralRows;
		this._priorRows = input.rows;
		this._priorIndexBySha = input.indexBySha;
		// Incremental lane projection composes against the structural collapse result, never the
		// optional flat search result that is derived from it.
		this._priorCollapsedRows = structuralRows;
		this._priorCollapsedByTipSha = collapsedByTipSha;
		this._priorScopeProjection = scopeProjection;
		return this._state;
	}

	/**
	 * Change only the final flat search filter, retaining structural fold/scope rows and their
	 * identities. Use when result batches stream or the user toggles normal/filter presentation
	 * without changing whether a search is active.
	 */
	updateFilter(filterShas: ReadonlySet<Sha> | undefined): CommitGraphProjectionState {
		const input = this._input;
		if (input == null || filterShas === input.filterShas) return this._state;

		const rows = this.filterRows(this._structuralRows, filterShas);
		const display = this.deriveDisplayIndex(rows, false);
		this._state = {
			...this._state,
			rows: rows,
			indexBySha: display.indexBySha,
			maxColumn: display.maxColumn,
		};
		this._input = { ...input, filterShas: filterShas };
		return this._state;
	}

	toggle(tipSha: Sha): CommitGraphProjectionToggle | undefined {
		const input = this._input;
		if (input == null) return undefined;

		const wasCollapsed = this._state.effectiveCollapsed.has(tipSha);
		if (wasCollapsed) {
			const expanded = new Set(this._manuallyExpanded);
			expanded.add(tipSha);
			this._manuallyExpanded = expanded;
			if (this._manuallyCollapsed.has(tipSha)) {
				const collapsed = new Set(this._manuallyCollapsed);
				collapsed.delete(tipSha);
				this._manuallyCollapsed = collapsed;
			}
		} else {
			const collapsed = new Set(this._manuallyCollapsed);
			collapsed.add(tipSha);
			this._manuallyCollapsed = collapsed;
			if (this._manuallyExpanded.has(tipSha)) {
				const expanded = new Set(this._manuallyExpanded);
				expanded.delete(tipSha);
				this._manuallyExpanded = expanded;
			}
		}

		return {
			wasCollapsed: wasCollapsed,
			state: this.update(input),
		};
	}

	/**
	 * Fold or unfold every collapsible segment at once. Mirrors `toggle()`'s manual-set bookkeeping but
	 * replaces both sets wholesale instead of flipping one sha, so this is O(1) update calls regardless
	 * of segment count.
	 */
	setAllCollapsed(collapsed: boolean): CommitGraphProjectionToggle | undefined {
		const input = this._input;
		if (input == null) return undefined;

		const wasCollapsed = !collapsed;
		if (collapsed) {
			this._manuallyCollapsed = new Set(this._state.segmentsByTipSha.keys());
			this._manuallyExpanded = new Set();
		} else {
			this._manuallyExpanded = new Set(this._state.segmentsByTipSha.keys());
			this._manuallyCollapsed = new Set();
		}

		return {
			wasCollapsed: wasCollapsed,
			state: this.update(input),
		};
	}

	/** Whether every collapsible segment is currently folded. False when there are none to fold. */
	get allLanesCollapsed(): boolean {
		return (
			this._state.segmentsByTipSha.size > 0 &&
			this._state.effectiveCollapsed.size === this._state.segmentsByTipSha.size
		);
	}

	private projectRows(
		input: CommitGraphProjectionInput,
		scopeProjection: ScopeProjection | undefined,
		collapsedByTipSha: ReadonlyMap<Sha, LaneSegment>,
		visibleJunctions: ReadonlySet<Sha>,
	): readonly ProcessedGraphRow[] {
		if (scopeProjection != null) {
			this._priorDroppedShas = undefined;
			this._priorUnloadedColumns = undefined;
			return compactColumns(applyDroppedRows(input.rows, scopeProjection.dropped, input.unloadedColumns));
		}
		if (collapsedByTipSha.size === 0) {
			this._priorDroppedShas = undefined;
			this._priorUnloadedColumns = undefined;
			return input.rows;
		}

		const dropped = computeDroppedShas(collapsedByTipSha, visibleJunctions);
		const rows =
			this.tryAppend(input, dropped, collapsedByTipSha) ??
			this.tryPrefixSplice(input, dropped, collapsedByTipSha) ??
			(dropped.size === 0 ? input.rows : applyDroppedRows(input.rows, dropped, input.unloadedColumns));
		this._priorDroppedShas = dropped;
		this._priorUnloadedColumns = input.unloadedColumns;
		return rows;
	}

	private filterRows(
		rows: readonly ProcessedGraphRow[],
		filterShas: ReadonlySet<Sha> | undefined,
	): readonly ProcessedGraphRow[] {
		if (filterShas == null) return rows;

		const filtered: ProcessedGraphRow[] = [];
		for (const row of rows) {
			if (!filterShas.has(row.sha)) continue;

			let flat = this._flattenedRows.get(row);
			if (flat == null) {
				flat = { ...row, column: 0, edges: {}, edgeColumnMax: 0 };
				this._flattenedRows.set(row, flat);
			}
			filtered.push(flat);
		}
		return filtered;
	}

	/**
	 * @param canAppend Whether an APPEND is structurally possible for this transition. Identity checks
	 * alone cannot establish it: `filterRows` hands back cached flattened rows, so a changed filter can
	 * produce a longer list whose first row and whose row at the prior length both match by reference
	 * while rows in between were swapped — leaving removed shas indexed, new shas missing, and a stale
	 * `maxColumn`. Filtering is already O(n), so a filter transition just rebuilds.
	 */
	private deriveDisplayIndex(
		rows: readonly ProcessedGraphRow[],
		canAppend: boolean,
	): {
		indexBySha: ReadonlyMap<Sha, number>;
		maxColumn: number;
	} {
		const priorRows = this._state.rows;
		if (rows === priorRows) {
			return { indexBySha: this._state.indexBySha, maxColumn: this._state.maxColumn };
		}

		const appended =
			canAppend &&
			priorRows.length > 0 &&
			rows.length > priorRows.length &&
			rows[0] === priorRows[0] &&
			rows[priorRows.length - 1] === priorRows.at(-1);
		if (appended) {
			const indexBySha = this._state.indexBySha as Map<Sha, number>;
			let maxColumn = this._state.maxColumn;
			for (let i = priorRows.length; i < rows.length; i++) {
				const row = rows[i];
				indexBySha.set(row.sha, i);
				maxColumn = Math.max(maxColumn, row.column, row.edgeColumnMax);
			}
			return { indexBySha: indexBySha, maxColumn: maxColumn };
		}

		const indexBySha = new Map<Sha, number>();
		let maxColumn = 0;
		for (let i = 0; i < rows.length; i++) {
			const row = rows[i];
			indexBySha.set(row.sha, i);
			maxColumn = Math.max(maxColumn, row.column, row.edgeColumnMax);
		}
		return { indexBySha: indexBySha, maxColumn: maxColumn };
	}

	private tryPrefixSplice(
		input: CommitGraphProjectionInput,
		dropped: ReadonlySet<Sha>,
		collapsedByTipSha: ReadonlyMap<Sha, LaneSegment>,
	): readonly ProcessedGraphRow[] | undefined {
		const reconciled = input.transition.kind === 'replace' ? input.transition.reconciled : undefined;
		if (reconciled == null || this._priorScopeProjection != null) return undefined;

		const priorCollapsed = this._priorCollapsedRows;
		const priorRows = this._priorRows;
		const priorDropped = this._priorDroppedShas;
		const priorIndex = this._priorIndexBySha;
		if (priorCollapsed == null || priorRows == null || priorDropped == null || priorIndex == null) {
			return undefined;
		}

		const rows = input.rows;
		const { reused, priorStart, nextStart } = reconciled;
		const priorSuffixEnd = priorStart + reused;
		if (rows[nextStart] == null || rows[nextStart] !== priorRows[priorStart]) return undefined;
		if (!this.sameCollapsedTips(collapsedByTipSha)) return undefined;

		const inReusedRun = (sha: Sha): boolean => {
			const i = priorIndex.get(sha);
			return i != null && i >= priorStart && i < priorSuffixEnd;
		};
		for (const sha of dropped) {
			if (!priorDropped.has(sha) && inReusedRun(sha)) return undefined;
		}
		for (const sha of priorDropped) {
			if (!dropped.has(sha) && inReusedRun(sha)) return undefined;
		}
		if (this.priorUnloadedParentBecameDropped(dropped)) return undefined;

		const nextSuffixEnd = nextStart + reused;
		const newRegionIndex = new Map<Sha, number>();
		for (let i = 0; i < nextStart; i++) {
			newRegionIndex.set(rows[i].sha, i);
		}
		for (let i = nextSuffixEnd; i < rows.length; i++) {
			newRegionIndex.set(rows[i].sha, i);
		}
		const shift = nextStart - priorStart;
		return spliceDroppedRows({
			priorDisplayRows: priorCollapsed,
			processedRows: rows,
			suffixStartIndex: nextStart,
			suffixEndIndex: nextSuffixEnd,
			priorIndexBySha: sha => priorIndex.get(sha),
			priorSuffixStart: priorStart,
			priorSuffixEnd: priorSuffixEnd,
			dropped: dropped,
			rowBySha: sha => {
				const nextIndex = newRegionIndex.get(sha);
				if (nextIndex != null) return rows[nextIndex];

				const priorRowIndex = priorIndex.get(sha);
				return priorRowIndex != null && priorRowIndex >= priorStart && priorRowIndex < priorSuffixEnd
					? rows[priorRowIndex + shift]
					: undefined;
			},
			unloadedColumns: input.unloadedColumns,
		});
	}

	private tryAppend(
		input: CommitGraphProjectionInput,
		dropped: ReadonlySet<Sha>,
		collapsedByTipSha: ReadonlyMap<Sha, LaneSegment>,
	): readonly ProcessedGraphRow[] | undefined {
		if (input.transition.kind !== 'append' || this._priorScopeProjection != null) return undefined;

		const priorCollapsed = this._priorCollapsedRows;
		const priorRows = this._priorRows;
		const priorDropped = this._priorDroppedShas;
		const priorIndex = this._priorIndexBySha;
		if (priorCollapsed == null || priorRows == null || priorDropped == null || priorIndex == null) {
			return undefined;
		}

		const firstNewIndex = priorRows.length;
		if (firstNewIndex === 0 || input.rows.length <= firstNewIndex) return undefined;
		if (input.rows[0] !== priorRows[0] || input.rows[firstNewIndex - 1] !== priorRows.at(-1)) {
			return undefined;
		}
		if (!this.sameCollapsedTips(collapsedByTipSha)) return undefined;

		const inPriorRegion = (sha: Sha): boolean => {
			const i = priorIndex.get(sha);
			return i != null && i < firstNewIndex;
		};
		for (const sha of dropped) {
			if (!priorDropped.has(sha) && inPriorRegion(sha)) return undefined;
		}
		for (const sha of priorDropped) {
			if (!dropped.has(sha) && inPriorRegion(sha)) return undefined;
		}
		if (this.priorUnloadedParentBecameDropped(dropped)) return undefined;

		const appendedIndex = new Map<Sha, number>();
		for (let i = firstNewIndex; i < input.rows.length; i++) {
			appendedIndex.set(input.rows[i].sha, i);
		}
		return appendDroppedRows({
			priorDisplayRows: priorCollapsed,
			processedRows: input.rows,
			firstNewIndex: firstNewIndex,
			dropped: dropped,
			rowBySha: sha => {
				const i = priorIndex.get(sha) ?? appendedIndex.get(sha);
				return i != null ? input.rows[i] : undefined;
			},
			unloadedColumns: input.unloadedColumns,
		});
	}

	private sameCollapsedTips(next: ReadonlyMap<Sha, LaneSegment>): boolean {
		const prior = this._priorCollapsedByTipSha;
		if (prior == null || prior.size !== next.size) return false;

		for (const tip of next.keys()) {
			if (!prior.has(tip)) return false;
		}
		return true;
	}

	private priorUnloadedParentBecameDropped(dropped: ReadonlySet<Sha>): boolean {
		if (this._priorUnloadedColumns == null) return false;

		for (const sha of this._priorUnloadedColumns.keys()) {
			if (dropped.has(sha)) return true;
		}
		return false;
	}
}

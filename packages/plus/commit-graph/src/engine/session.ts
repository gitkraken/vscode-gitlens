/**
 * Stateful, rendering-agnostic owner of the commit-graph engine lifecycle.
 *
 * A consumer supplies its native source rows plus a bridge to the canonical `GraphCommit`
 * shape. The session owns delta classification, payload alignment, incremental paging resume,
 * suffix reconciliation, and the topology indexes derived from the engine result. It imports no
 * host, DOM, or rendering-framework types.
 */

import { computeTrunkSegment } from '../laneCollapse.js';
import type { RowsDelta, RowTopology } from './delta.js';
import { classifyRowsDelta } from './delta.js';
import type { GraphProcessResume } from './process.js';
import { processGraphRows } from './process.js';
import type { ReconciledSuffix } from './reconcile.js';
import type { GraphCommit, LaneSegment, ProcessedGraphRow, Sha } from './types.js';

export type CommitGraphSessionTransition =
	| { kind: 'reset'; source: 'empty' | 'identity' }
	| { kind: 'initial' }
	| { kind: 'payload' }
	| { kind: 'append'; firstNewIndex: number }
	| {
			kind: 'replace';
			source: Exclude<RowsDelta['kind'], 'initial'> | 'view';
			reconciled?: ReconciledSuffix;
	  };

export type CommitGraphSessionUpdate<TSource extends RowTopology, TCommit extends GraphCommit> = {
	/**
	 * Identity of the graph dataset (normally a repository path). A change is a hard reset even when
	 * the two repositories happen to share commit shas.
	 */
	identity?: string;
	/** Rows after consumer-owned visibility filtering, in engine order (newest to oldest). */
	sourceRows: readonly TSource[];
	/** Git/provider-specific payload bridge. Called for all rows on replace/payload, and tail-only on append. */
	toCommit: (row: TSource) => TCommit;
	/** Current HEAD resolved by the consumer; no ref/provider types cross the package boundary. */
	headSha?: Sha;
	/** Ordered heads to pin to the leftmost lanes. */
	pinnedShas?: readonly Sha[];
	/** Scoped-view synthetic edge anchors. Empty is normalized to no synthetic edges. */
	syntheticChildren?: ReadonlySet<Sha>;
	/**
	 * Stable identity of the user's view intent (for example the selected scope refs). Resolved anchors
	 * may move while this stays fixed; changing it deliberately permits a cold relayout.
	 */
	viewKey?: string;
};

/**
 * Current session state. Collections are session-owned and exposed read-only; consumers must not
 * mutate or retain them as historical snapshots across a later `update`.
 */
export type CommitGraphSessionState<TCommit extends GraphCommit> = {
	revision: number;
	transition: CommitGraphSessionTransition;
	commits: readonly TCommit[];
	rows: readonly ProcessedGraphRow[];
	segments: readonly LaneSegment[];
	unloadedColumns: ReadonlyMap<Sha, number>;
	indexBySha: ReadonlyMap<Sha, number>;
	headSha?: Sha;
	trunkSegmentTip?: Sha;
	segmentByCommit: ReadonlyMap<Sha, Sha>;
	/** sha → owning pinned head sha, for pinned-lane ghost-ref resolution (pinned lanes never form a
	 *  `segmentByCommit` entry — they don't open a `SegmentBuilder`). Empty when nothing is pinned. */
	pinnedTipByCommit: ReadonlyMap<Sha, Sha>;
	/** Shas that are members of the current trunk segment — ghost-ref resolution's trunk fallback is
	 *  scoped to these rows only, so a row belonging to no segment at all borrows nothing. */
	trunkCommitShas: ReadonlySet<Sha>;
	wipAnchorShas: ReadonlySet<Sha>;
	workdirShas: ReadonlySet<Sha>;
	wipSegmentTips: ReadonlySet<Sha>;
};

function setsEqual<T>(a: ReadonlySet<T> | undefined, b: ReadonlySet<T> | undefined): boolean {
	const aSize = a?.size ?? 0;
	if (aSize !== (b?.size ?? 0)) return false;
	if (aSize === 0) return true;

	for (const value of a!) {
		if (b?.has(value) !== true) return false;
	}
	return true;
}

function arraysEqual<T>(a: readonly T[] | undefined, b: readonly T[] | undefined): boolean {
	const aLength = a?.length ?? 0;
	if (aLength !== (b?.length ?? 0)) return false;

	for (let i = 0; i < aLength; i++) {
		if (a![i] !== b![i]) return false;
	}
	return true;
}

function normalizedSet<T>(values: ReadonlySet<T> | undefined): ReadonlySet<T> | undefined {
	return values != null && values.size > 0 ? values : undefined;
}

function normalizedArray<T>(values: readonly T[] | undefined): readonly T[] | undefined {
	return values != null && values.length > 0 ? values : undefined;
}

export class CommitGraphEngineSession<TSource extends RowTopology, TCommit extends GraphCommit> {
	private _revision = 0;
	private _identity?: string;
	private _viewKey?: string;
	private _sourceRows?: readonly TSource[];
	private _commits: readonly TCommit[] = [];
	private _rows: readonly ProcessedGraphRow[] = [];
	private _segments: readonly LaneSegment[] = [];
	private _unloadedColumns: ReadonlyMap<Sha, number> = new Map();
	private _indexBySha: ReadonlyMap<Sha, number> = new Map();
	private _headSha?: Sha;
	private _trunkSegmentTip?: Sha;
	/** False while {@link _trunkSegmentTip} is only the top-row fallback — HEAD has no segment yet. */
	private _trunkFromHead = false;
	private _segmentByCommit: ReadonlyMap<Sha, Sha> = new Map();
	private _pinnedTipByCommit: ReadonlyMap<Sha, Sha> = new Map();
	private _trunkCommitShas: ReadonlySet<Sha> = new Set();
	private _wipAnchorShas: ReadonlySet<Sha> = new Set();
	private _workdirShas: ReadonlySet<Sha> = new Set();
	private _wipSegmentTips: ReadonlySet<Sha> = new Set();
	private _resume?: GraphProcessResume;
	private _syntheticChildren?: ReadonlySet<Sha>;
	private _pinnedShas?: readonly Sha[];
	private readonly _lastIndexedSegmentByTip = new Map<Sha, LaneSegment>();

	/** Force the next update through a full engine pass without changing the current dataset or view intent. */
	resetLayout(): void {
		this._sourceRows = undefined;
		this._resume = undefined;
	}

	update(input: CommitGraphSessionUpdate<TSource, TCommit>): CommitGraphSessionState<TCommit> {
		const identityChanged = input.identity !== this._identity;
		const syntheticChildren = normalizedSet(input.syntheticChildren);
		const pinnedShas = normalizedArray(input.pinnedShas);

		if (input.sourceRows.length === 0) {
			return this.reset(input, identityChanged ? 'identity' : 'empty');
		}

		const viewSwitched = identityChanged || input.viewKey !== this._viewKey;
		const sourceDelta: RowsDelta = identityChanged
			? { kind: 'initial' }
			: classifyRowsDelta(this._sourceRows, input.sourceRows);
		const priorRowCount = this._rows.length;

		// Every row is re-mapped, including an append's unchanged prefix. Reusing the prior prefix would be
		// assuming more than the classifier proves: `append` establishes that the TOPOLOGY prefix matches
		// (sha/parents/kind/date) — `payload` is the classification that means "payload may differ" — so a
		// push that both pages in rows AND changes a loaded row's refs, message or author would keep the
		// stale mapping. Reference identity is not a usable shortcut either: the client-side splice reuses
		// row OBJECTS and patches `contexts.flags`/`reachabilityIndex` into them IN PLACE, so an unchanged
		// reference does not imply unchanged content. Mapping is a per-row object build; a `payload` push
		// already re-maps everything, so this only makes paging agree with it.
		const commits: readonly TCommit[] = input.sourceRows.map(row => input.toCommit(row));

		const engineOptionsUnchanged =
			!viewSwitched &&
			arraysEqual(pinnedShas, this._pinnedShas) &&
			setsEqual(syntheticChildren, this._syntheticChildren);

		// Identical topology can retain the entire engine plane. HEAD is payload-derived, so verify
		// that moving it does not select a different trunk segment before taking the fast path.
		if (sourceDelta.kind === 'payload' && engineOptionsUnchanged && this._rows.length > 0) {
			const trunk = computeTrunkSegment(this._segments, this._rows, input.headSha);
			if (trunk.tip === this._trunkSegmentTip) {
				this._sourceRows = input.sourceRows;
				this._commits = commits;
				this._headSha = input.headSha;
				// The tip is unchanged, but its PROVENANCE can flip when HEAD moves — a HEAD that is no
				// longer loaded falls back to the topmost row, which may resolve to the same tip. Leaving
				// the old provenance would let a later append retain a fallback trunk as if HEAD had
				// selected it, so the real segment never replaces it when it materializes.
				this._trunkFromHead = trunk.fromHead;
				this.rememberInput(input, syntheticChildren, pinnedShas);
				return this.state({ kind: 'payload' });
			}
		}

		const resumable =
			!viewSwitched &&
			syntheticChildren == null &&
			pinnedShas == null &&
			this._resume != null &&
			sourceDelta.kind === 'append';

		let result: ReturnType<typeof processGraphRows>;
		let transition: CommitGraphSessionTransition;
		if (resumable) {
			result = processGraphRows(commits, { resume: this._resume });
			transition = { kind: 'append', firstNewIndex: sourceDelta.firstNewIndex };
		} else {
			result = processGraphRows(commits, {
				syntheticChildren: syntheticChildren,
				pinnedShas: pinnedShas,
				reconcile:
					sourceDelta.kind === 'replace' && this._rows.length > 0
						? {
								priorRows: this._rows,
								priorIndexOfSha: sha => this._indexBySha.get(sha),
							}
						: undefined,
			});
			transition =
				sourceDelta.kind === 'initial'
					? { kind: 'initial' }
					: {
							kind: 'replace',
							source: viewSwitched ? 'view' : sourceDelta.kind,
							reconciled: result.reconciled,
						};
		}

		this._sourceRows = input.sourceRows;
		this._commits = commits;
		this._rows = result.rows;
		this._segments = result.segments;
		this._unloadedColumns = result.unloadedColumns;
		this._pinnedTipByCommit = result.pinnedTipByCommit;
		this._resume = syntheticChildren == null && pinnedShas == null ? result.resume : undefined;
		const priorHeadSha = this._headSha;
		this._headSha = input.headSha;
		this.rebuildIndexesAndAnchors(transition.kind === 'append' ? priorRowCount : 0, priorHeadSha);
		this.rememberInput(input, syntheticChildren, pinnedShas);
		return this.state(transition);
	}

	private rebuildIndexesAndAnchors(firstNewIndex: number, priorHeadSha: Sha | undefined): void {
		const appended = firstNewIndex > 0;
		let indexBySha: Map<Sha, number>;
		if (appended) {
			indexBySha = this._indexBySha as Map<Sha, number>;
			for (let i = firstNewIndex; i < this._rows.length; i++) {
				indexBySha.set(this._rows[i].sha, i);
			}
		} else {
			indexBySha = new Map();
			for (let i = 0; i < this._rows.length; i++) {
				indexBySha.set(this._rows[i].sha, i);
			}
		}
		this._indexBySha = indexBySha;

		// On a pure APPEND the trunk patches from the prior value rather than being rediscovered: the
		// prefix can't change, the filter never drops the current HEAD, and segments only extend
		// downward — so a trunk resolved FROM HEAD stays the trunk. Rediscovering it costs a scan of
		// every loaded commit on every page. Recompute on replace/reset, when HEAD moves, when no trunk
		// is known — and while the current one is only the top-row FALLBACK: HEAD holding a single
		// placed commit has no segment yet, and the one that materializes when its parent pages in must
		// replace the fallback or an unrelated lane keeps the collapse protection HEAD should have.
		const priorTrunk = this._trunkSegmentTip;
		if (!appended || priorTrunk == null || this._headSha !== priorHeadSha || !this._trunkFromHead) {
			const trunk = computeTrunkSegment(this._segments, this._rows, this._headSha);
			this._trunkSegmentTip = trunk.tip;
			this._trunkFromHead = trunk.fromHead;
		}

		const wipAnchorShas = appended ? new Set(this._wipAnchorShas) : new Set<Sha>();
		const workdirShas = appended ? new Set(this._workdirShas) : new Set<Sha>();
		for (let i = firstNewIndex; i < this._rows.length; i++) {
			const row = this._rows[i];
			if (row.kind !== 'workdir') continue;

			workdirShas.add(row.sha);
			if (row.parents.length > 0) {
				wipAnchorShas.add(row.parents[0]);
			}
		}

		const wipSegmentTips = appended ? new Set(this._wipSegmentTips) : new Set<Sha>();
		let segmentByCommit = this._segmentByCommit as Map<Sha, Sha>;
		let trunkCommitShas = this._trunkCommitShas as Set<Sha>;
		if (!appended || this._trunkSegmentTip !== priorTrunk) {
			this._lastIndexedSegmentByTip.clear();
			segmentByCommit = new Map();
			trunkCommitShas = new Set();
		}
		for (const segment of this._segments) {
			if (workdirShas.has(segment.tipSha)) {
				wipSegmentTips.add(segment.tipSha);
			}
			if (this._lastIndexedSegmentByTip.get(segment.tipSha) === segment) continue;

			this._lastIndexedSegmentByTip.set(segment.tipSha, segment);
			if (segment.tipSha === this._trunkSegmentTip) {
				// An OPEN trunk re-finalizes into a fresh object (with its full commit list) every pass, so
				// the identity dedupe above never skips it — index only the appended tail or a long trunk
				// re-inserts its whole history on every page-in. `commitShas` only ever grows by append for
				// a live builder (any other change goes through the wholesale reset above), so the set's
				// size IS the already-indexed prefix length.
				for (let i = trunkCommitShas.size; i < segment.commitShas.length; i++) {
					trunkCommitShas.add(segment.commitShas[i]);
				}

				continue;
			}

			for (const sha of segment.commitShas) {
				segmentByCommit.set(sha, segment.tipSha);
			}
		}

		this._segmentByCommit = segmentByCommit;
		this._trunkCommitShas = trunkCommitShas;
		this._wipAnchorShas = wipAnchorShas;
		this._workdirShas = workdirShas;
		this._wipSegmentTips = wipSegmentTips;
	}

	private rememberInput(
		input: CommitGraphSessionUpdate<TSource, TCommit>,
		syntheticChildren: ReadonlySet<Sha> | undefined,
		pinnedShas: readonly Sha[] | undefined,
	): void {
		this._identity = input.identity;
		this._viewKey = input.viewKey;
		this._syntheticChildren = syntheticChildren;
		this._pinnedShas = pinnedShas;
	}

	private reset(
		input: CommitGraphSessionUpdate<TSource, TCommit>,
		source: 'empty' | 'identity',
	): CommitGraphSessionState<TCommit> {
		this._sourceRows = input.sourceRows;
		this._commits = [];
		this._rows = [];
		this._segments = [];
		this._unloadedColumns = new Map();
		this._indexBySha = new Map();
		this._headSha = undefined;
		this._trunkSegmentTip = undefined;
		this._segmentByCommit = new Map();
		this._pinnedTipByCommit = new Map();
		this._trunkCommitShas = new Set();
		this._wipAnchorShas = new Set();
		this._workdirShas = new Set();
		this._wipSegmentTips = new Set();
		this._resume = undefined;
		this._lastIndexedSegmentByTip.clear();
		this.rememberInput(input, normalizedSet(input.syntheticChildren), normalizedArray(input.pinnedShas));
		return this.state({ kind: 'reset', source: source });
	}

	private state(transition: CommitGraphSessionTransition): CommitGraphSessionState<TCommit> {
		return {
			revision: ++this._revision,
			transition: transition,
			commits: this._commits,
			rows: this._rows,
			segments: this._segments,
			unloadedColumns: this._unloadedColumns,
			indexBySha: this._indexBySha,
			headSha: this._headSha,
			trunkSegmentTip: this._trunkSegmentTip,
			segmentByCommit: this._segmentByCommit,
			pinnedTipByCommit: this._pinnedTipByCommit,
			trunkCommitShas: this._trunkCommitShas,
			wipAnchorShas: this._wipAnchorShas,
			workdirShas: this._workdirShas,
			wipSegmentTips: this._wipSegmentTips,
		};
	}
}

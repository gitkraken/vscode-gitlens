import { carriedEdgesEqual, collapsedLinkKey, computeEdges } from '@gitkraken/commit-graph/engine/edges.js';
import type { LaneSegment, ProcessedGraphRow, RowEdges, Sha } from '@gitkraken/commit-graph/engine/types.js';
import type { GitGraphRow } from '@gitlens/git/models/graph.js';

/**
 * Walk the segment list and return the tip-sha of the segment whose `commitShas` includes
 * the given sha — typically used to identify "the segment containing HEAD" so default-mode
 * collapse can skip it. Returns `undefined` when the sha doesn't belong to any segment.
 */
export function findSegmentTipContaining(segments: readonly LaneSegment[], sha: Sha): Sha | undefined {
	for (const segment of segments) {
		for (const candidate of segment.commitShas) {
			if (candidate === sha) return segment.tipSha;
		}
	}

	return undefined;
}

/**
 * The "trunk" segment is the one containing HEAD (or, when HEAD is unknown, the one
 * containing the topmost row). Excluded from interactive collapse so a stray click on
 * a trunk commit can't accidentally hide the entire mainline. Also excluded from the
 * auto/all default-mode set so a trunk lane never starts collapsed.
 */
export function computeTrunkSegmentTip(
	segments: readonly LaneSegment[],
	processedRows: readonly ProcessedGraphRow[],
	headSha: Sha | undefined,
): Sha | undefined {
	if (segments.length === 0) return undefined;

	if (headSha != null) {
		const tip = findSegmentTipContaining(segments, headSha);
		if (tip != null) return tip;
	}

	const topRow = processedRows[0];
	return topRow != null ? findSegmentTipContaining(segments, topRow.sha) : undefined;
}

/**
 * Default-mode set: which segments are collapsed before manual overrides apply.
 * Always exclude the trunk segment so the user's current location stays put. When a
 * search query is active, suppress default collapse entirely so hits inside would-be-
 * collapsed segments stay visible. Manual collapses still apply on top of this set.
 *
 * Modes:
 *   • 'none'  — collapse nothing on load (manual folding only).
 *   • 'all'   — collapse every foldable (non-trunk) lane.
 *   • 'auto'  — collapse COMPLETED side branches: non-trunk lanes that rejoin the graph (a fork
 *               point, `forkSha` set), excluding WIP/working-changes lanes. Branches still open at
 *               the bottom of the loaded window (no fork point) and the mainline stay expanded, so
 *               finished side history folds away while active work + the trunk stay in view.
 */
export function computeDefaultCollapsedSet(args: {
	lanesCollapseDefault: 'none' | 'all' | 'auto';
	segments: readonly LaneSegment[];
	/** True while a search is active — suppresses default collapse so matches inside auto-collapsed lanes stay visible. */
	searchActive: boolean;
	trunkSegmentTip: Sha | undefined;
	/** Segment tips that are WIP/working-changes rows — never auto-collapsed (kept expanded). */
	wipTipShas: ReadonlySet<Sha>;
}): ReadonlySet<Sha> {
	const { lanesCollapseDefault, segments, searchActive, trunkSegmentTip, wipTipShas } = args;

	if (lanesCollapseDefault === 'none' || segments.length === 0) return new Set();
	if (searchActive) return new Set();

	const out = new Set<Sha>();
	for (const segment of segments) {
		if (segment.tipSha === trunkSegmentTip) continue;

		// 'all' collapses every non-trunk lane; 'auto' collapses completed side branches — those that
		// rejoin the graph (forkSha set) and aren't active WIP lanes.
		const auto = segment.forkSha != null && !wipTipShas.has(segment.tipSha);
		if (lanesCollapseDefault === 'all' || auto) {
			out.add(segment.tipSha);
		}
	}

	return out;
}

/**
 * Compose the effective collapsed set: `defaultCollapsedSet ∪ manuallyCollapsed ∖ manuallyExpanded`.
 * Manual expands win over the default set; manual collapses win over everything.
 */
export function composeEffectiveCollapsed(
	defaultCollapsedSet: ReadonlySet<Sha>,
	manuallyExpanded: ReadonlySet<Sha>,
	manuallyCollapsed: ReadonlySet<Sha>,
): ReadonlySet<Sha> {
	if (defaultCollapsedSet.size === 0 && manuallyCollapsed.size === 0) return new Set();

	const out = new Set<Sha>(defaultCollapsedSet);
	for (const sha of manuallyExpanded) {
		out.delete(sha);
	}

	for (const sha of manuallyCollapsed) {
		out.add(sha);
	}

	return out;
}

/**
 * Derived segment maps used by the row filter, the fold-chevron adornment provider, and the
 * collapsed-chip rendering:
 *   • segmentsByTipSha — every collapsible (non-trunk) segment keyed by tipSha. Used by the
 *     fold-chevron adornment provider so it can render a discoverable affordance on EVERY
 *     foldable row, not just the currently-collapsed ones. Trunk segments are excluded (trunk
 *     is never foldable; folding HEAD's lane would hide the user's current location).
 *   • collapsedByTipSha — subset of `segmentsByTipSha` that are currently collapsed. Needed
 *     for the row filter (drop hidden rows) and for the chip's collapsed-state rendering.
 *   • visibleJunctions — junction commits to KEEP visible even when they fall inside a
 *     collapsed segment. A "junction" is a commit that another lane forks off from — hiding
 *     it would orphan the forking-off lane visually (its tip would float with no anchor back
 *     to where the branch originated). We only protect junctions whose forking-off lane is
 *     currently expanded; if both the parent lane AND its child lane are collapsed, the user
 *     has signaled they don't care about either, so we can safely drop the junction.
 *     ALSO protected: the anchor commit (`commitShas[1]`) of any WIP-tipped segment — the
 *     commit a working-changes row sits on. Folding a WIP lane must never hide what the WIP
 *     is based on, so the anchor stays visible (and is excluded from the hidden count).
 *   • hiddenCountByTipSha — how many commits would actually be hidden per segment after
 *     junction-preserving? Drives the chip's "+N" count so it reflects what the user really
 *     loses on collapse (not the segment's total body size).
 */
export function computeSegmentMaps(args: {
	segments: readonly LaneSegment[];
	trunkSegmentTip: Sha | undefined;
	effectiveCollapsed: ReadonlySet<Sha>;
	/** Commits that WIP/working-changes rows sit on (first-parent anchors) — kept visible on collapse
	 *  so a fold never hides, or re-anchors a WIP row away from, the commit it's based on. */
	wipAnchorShas: ReadonlySet<Sha>;
}): {
	segmentsByTipSha: ReadonlyMap<Sha, LaneSegment>;
	collapsedByTipSha: ReadonlyMap<Sha, LaneSegment>;
	visibleJunctions: ReadonlySet<Sha>;
	hiddenCountByTipSha: ReadonlyMap<Sha, number>;
} {
	const { segments, trunkSegmentTip, effectiveCollapsed, wipAnchorShas } = args;

	const segmentsByTipSha = new Map<Sha, LaneSegment>();
	if (segments.length > 0) {
		for (const segment of segments) {
			if (segment.tipSha === trunkSegmentTip) continue;

			segmentsByTipSha.set(segment.tipSha, segment);
		}
	}

	const collapsedByTipSha = new Map<Sha, LaneSegment>();
	if (effectiveCollapsed.size > 0) {
		for (const [tipSha, segment] of segmentsByTipSha) {
			if (effectiveCollapsed.has(tipSha)) {
				collapsedByTipSha.set(tipSha, segment);
			}
		}
	}

	const visibleJunctions = new Set<Sha>();
	// The commit every WIP/working-changes row sits on stays visible regardless of what folds —
	// folding away (or re-anchoring a WIP row off of) "what my WIP is based on" is never wanted.
	// Added unconditionally so the hidden count also excludes these.
	for (const sha of wipAnchorShas) {
		visibleJunctions.add(sha);
	}

	if (segments.length > 0) {
		for (const segment of segments) {
			if (segment.forkSha == null) continue;
			if (effectiveCollapsed.has(segment.tipSha)) continue;

			visibleJunctions.add(segment.forkSha);
		}
	}

	const hiddenCountByTipSha = new Map<Sha, number>();
	if (segmentsByTipSha.size > 0) {
		for (const [tipSha, segment] of segmentsByTipSha) {
			let count = 0;
			for (let i = 1; i < segment.commitShas.length; i++) {
				if (visibleJunctions.has(segment.commitShas[i])) continue;

				count++;
			}

			hiddenCountByTipSha.set(tipSha, count);
		}
	}

	return {
		segmentsByTipSha: segmentsByTipSha,
		collapsedByTipSha: collapsedByTipSha,
		visibleJunctions: visibleJunctions,
		hiddenCountByTipSha: hiddenCountByTipSha,
	};
}

/**
 * Filter + edge-recompute for the rendered row list. Two passes:
 *
 *   1) Drop commits in collapsed segments except (a) the tip — the chip's anchor row —
 *      and (b) any commit that's a visible junction for another still-expanded lane.
 *   2) For every surviving row, remap parents whose direct ancestor is now dropped to
 *      the NEAREST visible ancestor in the first-parent chain, then re-run the engine's
 *      edge state machine over the filtered list. This is what makes lane lines flow
 *      continuously through the chip row instead of breaking at each dropped commit —
 *      passThrough / ending edges land on visible rows, so the renderer paints an
 *      uninterrupted lane from the tip's circle down to its fork point.
 *
 * When nothing is collapsed (or all dropped commits happen to leave parents intact)
 * we short-circuit and return the unfiltered, untouched `processedRows`.
 */
export function computeDisplayRows<T extends ProcessedGraphRow>(
	processedRows: readonly T[],
	collapsedByTipSha: ReadonlyMap<Sha, LaneSegment>,
	visibleJunctions: ReadonlySet<Sha>,
	unloadedColumns?: ReadonlyMap<Sha, number>,
): readonly T[] {
	if (collapsedByTipSha.size === 0) return processedRows;

	const dropped = computeDroppedShas(collapsedByTipSha, visibleJunctions);
	return applyDroppedRows(processedRows, dropped, unloadedColumns);
}

/**
 * The commits hidden by the collapsed segments (each segment's body minus protected junctions).
 * Exported so the incremental append path ({@link appendDroppedRows}) can diff the drop-set between
 * runs — the exact signal for whether the previously-rendered region is still valid.
 */
export function computeDroppedShas(
	collapsedByTipSha: ReadonlyMap<Sha, LaneSegment>,
	visibleJunctions: ReadonlySet<Sha>,
): Set<Sha> {
	const dropped = new Set<Sha>();
	for (const segment of collapsedByTipSha.values()) {
		for (let i = 1; i < segment.commitShas.length; i++) {
			const sha = segment.commitShas[i];
			if (visibleJunctions.has(sha)) continue;

			dropped.add(sha);
		}
	}

	return dropped;
}

/**
 * Incremental counterpart of {@link computeDisplayRows} for a pure paging APPEND: reuses the prior
 * filter output (survivor rows, clones and all — by identity) and runs the drop/remap/edge pass over
 * ONLY the appended tail, resuming the edge state machine from the last prior survivor's edges.
 *
 * SAFE ONLY WHEN the previously-rendered region provably can't change — the CALLER must verify:
 *   • `processedRows` is an identity-prefix extension of the rows `priorDisplayRows` was built from;
 *   • the drop-set delta vs the prior run lies entirely in the appended region (an expanded/newly-
 *     collapsed lane or a junction change in the prior region invalidates prior survivors);
 *   • no prior row's below-window parent (prior `unloadedColumns` key) became dropped — that would
 *     remap a PRIOR row's parents.
 * Given those, prior survivors' rows AND edges are byte-identical to a full recompute (columns are
 * paging-stable and the edge machine is forward-only), so appending the freshly-processed tail is
 * exact — asserted by the append-equivalence unit tests.
 */
export function appendDroppedRows<T extends ProcessedGraphRow>(args: {
	priorDisplayRows: readonly T[];
	processedRows: readonly T[];
	/** Index of the first appended row in `processedRows` (= the prior engine row count). */
	firstNewIndex: number;
	dropped: ReadonlySet<Sha>;
	/** Full-set row lookup (prior + appended) for the nearest-visible-ancestor remap walk. */
	rowBySha: (sha: Sha) => T | undefined;
	unloadedColumns?: ReadonlyMap<Sha, number>;
}): readonly T[] {
	const { priorDisplayRows, processedRows, firstNewIndex, dropped, rowBySha, unloadedColumns } = args;

	// Walk a starting sha through its first-parent chain until a visible commit (or the chain ends).
	const findVisibleAncestor = (start: Sha): Sha | undefined => {
		let walked: Sha | undefined = start;
		let safety = processedRows.length;
		while (walked != null && dropped.has(walked) && safety > 0) {
			walked = rowBySha(walked)?.parents?.[0];
			safety--;
		}

		if (walked == null) return undefined;

		return dropped.has(walked) ? undefined : walked;
	};

	const collapsedLinks = new Set<string>();
	const appended: T[] = [];
	for (let i = firstNewIndex; i < processedRows.length; i++) {
		const r = processedRows[i];
		if (dropped.has(r.sha)) continue;

		let remapped = false;
		const newParents: Sha[] = [];
		for (const p of r.parents) {
			if (dropped.has(p)) {
				const visible = findVisibleAncestor(p);
				if (visible != null) {
					newParents.push(visible);
					collapsedLinks.add(collapsedLinkKey(r.sha, visible));
				}

				remapped = true;
			} else {
				newParents.push(p);
			}
		}

		appended.push({ ...r, parents: remapped ? newParents : r.parents, edges: {}, edgeColumnMax: 0 });
	}

	// Resume the edge pass from the last prior survivor — appended rows' parents only ever point
	// DOWNWARD (older), so the batch-local sha map inside computeEdges suffices, exactly like the
	// engine's own append resume.
	computeEdges(appended, {
		collapsedLinks: collapsedLinks.size > 0 ? collapsedLinks : undefined,
		unloadedColumns: unloadedColumns,
		resumePrev: priorDisplayRows.at(-1)?.edges ?? {},
	});
	return [...priorDisplayRows, ...appended];
}

/**
 * Incremental counterpart of {@link computeDisplayRows} for a PREFIX change (fetch / new commits):
 * the engine reconciled a byte-identical trailing run back to prior row identity, so the prior
 * filter output's matching survivors (clones and all) are reusable — drop/remap/edge-process only
 * the reprocessed head region, then verify the edge state flowing INTO the first reused survivor
 * matches what it was built with. A mismatch (the edge machine hadn't converged by the boundary)
 * returns undefined and the caller runs the full filter.
 *
 * The CALLER must verify (mirroring {@link appendDroppedRows}'s contract):
 *   • the collapsed tip-set is unchanged and the drop-set delta lies entirely OUTSIDE the reused
 *     suffix;
 *   • no prior below-window parent (prior `unloadedColumns` key) became dropped.
 */
export function spliceDroppedRows<T extends ProcessedGraphRow>(args: {
	/** Prior filter output; its survivors within the reused run are reused verbatim. */
	priorDisplayRows: readonly T[];
	/** The NEW processed rows, with the reused run already swapped to prior identity. */
	processedRows: readonly T[];
	/** The reused run in NEW indexes: [suffixStartIndex, suffixEndIndex). Rows past the end are NEW
	 *  rows the host loaded beyond the prior window — processed like an appended tail. */
	suffixStartIndex: number;
	suffixEndIndex: number;
	/** Returns a prior survivor's index in the PRIOR processed rows (undefined = not a prior row). */
	priorIndexBySha: (sha: Sha) => number | undefined;
	/** The reused run in PRIOR indexes: [priorSuffixStart, priorSuffixEnd). Prior rows past the end
	 *  were CUT by the host's fixed-count reload and must not leak into the reused survivors. */
	priorSuffixStart: number;
	priorSuffixEnd: number;
	dropped: ReadonlySet<Sha>;
	rowBySha: (sha: Sha) => T | undefined;
	unloadedColumns?: ReadonlyMap<Sha, number>;
}): readonly T[] | undefined {
	const {
		priorDisplayRows,
		processedRows,
		suffixStartIndex,
		suffixEndIndex,
		priorIndexBySha,
		priorSuffixStart,
		priorSuffixEnd,
		dropped,
		rowBySha,
	} = args;

	// The reusable survivor window: survivors keep row order, so the reused run's survivors form a
	// contiguous block — everything before it filtered the replaced prefix (dead), everything after
	// it filtered cut rows (also dead).
	let firstReusedSurvivor = priorDisplayRows.length;
	for (let i = 0; i < priorDisplayRows.length; i++) {
		const priorIndex = priorIndexBySha(priorDisplayRows[i].sha);
		if (priorIndex != null && priorIndex >= priorSuffixStart && priorIndex < priorSuffixEnd) {
			firstReusedSurvivor = i;
			break;
		}
	}
	let endReusedSurvivor = priorDisplayRows.length;
	for (let i = priorDisplayRows.length - 1; i >= firstReusedSurvivor; i--) {
		const priorIndex = priorIndexBySha(priorDisplayRows[i].sha);
		if (priorIndex != null && priorIndex >= priorSuffixStart && priorIndex < priorSuffixEnd) {
			endReusedSurvivor = i + 1;
			break;
		}

		endReusedSurvivor = i;
	}

	// Walk a starting sha through its first-parent chain until a visible commit (or the chain ends).
	const findVisibleAncestor = (start: Sha): Sha | undefined => {
		let walked: Sha | undefined = start;
		let safety = processedRows.length;
		while (walked != null && dropped.has(walked) && safety > 0) {
			walked = rowBySha(walked)?.parents?.[0];
			safety--;
		}

		if (walked == null) return undefined;

		return dropped.has(walked) ? undefined : walked;
	};

	// Drop/remap/clone a region's survivors (the shared filter body).
	const filterRegion = (from: number, to: number, collapsedLinks: Set<string>): T[] => {
		const out: T[] = [];
		for (let i = from; i < to; i++) {
			const r = processedRows[i];
			if (dropped.has(r.sha)) continue;

			let remapped = false;
			const newParents: Sha[] = [];
			for (const p of r.parents) {
				if (dropped.has(p)) {
					const visible = findVisibleAncestor(p);
					if (visible != null) {
						newParents.push(visible);
						collapsedLinks.add(collapsedLinkKey(r.sha, visible));
					}

					remapped = true;
				} else {
					newParents.push(p);
				}
			}

			out.push({ ...r, parents: remapped ? newParents : r.parents, edges: {}, edgeColumnMax: 0 });
		}
		return out;
	};

	// A region-only edge pass can't resolve additional-parent columns that live OUTSIDE the batch —
	// thread them via the unloaded-columns channel with the SAME column values the full pass reads
	// off the real rows, so the emitted edges are identical.
	const augmentColumns = (region: readonly T[]): ReadonlyMap<Sha, number> | undefined => {
		let columns = args.unloadedColumns;
		const regionShas = new Set<Sha>();
		for (const r of region) {
			regionShas.add(r.sha);
		}
		for (const r of region) {
			for (let i = 1; i < r.parents.length; i++) {
				const p = r.parents[i];
				if (regionShas.has(p) || args.unloadedColumns?.has(p)) continue;

				const column = rowBySha(p)?.column;
				if (column == null) continue;

				if (columns === args.unloadedColumns) {
					columns = new Map(args.unloadedColumns ?? []);
				}
				(columns as Map<Sha, number>).set(p, column);
			}
		}
		return columns;
	};

	const headLinks = new Set<string>();
	const head = filterRegion(0, suffixStartIndex, headLinks);
	computeEdges(head, {
		collapsedLinks: headLinks.size > 0 ? headLinks : undefined,
		unloadedColumns: augmentColumns(head),
	});

	// The reused survivors' edges embed the carry that flowed into them from above — reuse is exact
	// only when the NEW head region hands over the same carry the OLD prefix did. (Endings are
	// consumed at their row and never propagate, so this compares the carried projection.)
	const emptyCarry: RowEdges = {};
	const newCarry = head.at(-1)?.edges ?? emptyCarry;
	const oldCarry =
		firstReusedSurvivor > 0 ? (priorDisplayRows[firstReusedSurvivor - 1]?.edges ?? emptyCarry) : emptyCarry;
	if (!carriedEdgesEqual(newCarry, oldCarry)) return undefined;

	const reusedSurvivors = priorDisplayRows.slice(firstReusedSurvivor, endReusedSurvivor);

	// Rows the host loaded BEYOND the prior window (a rebuild can land mid-page) — an appended tail:
	// filter it and resume the edge pass from the last reused survivor, mirroring appendDroppedRows.
	let tail: T[] = [];
	if (suffixEndIndex < processedRows.length) {
		const tailLinks = new Set<string>();
		tail = filterRegion(suffixEndIndex, processedRows.length, tailLinks);
		computeEdges(tail, {
			collapsedLinks: tailLinks.size > 0 ? tailLinks : undefined,
			unloadedColumns: augmentColumns(tail),
			resumePrev: reusedSurvivors.at(-1)?.edges ?? newCarry,
		});
	}

	return [...head, ...reusedSurvivors, ...tail];
}

/**
 * Filter `dropped` commits out of the row list, remap surviving rows' parents to the nearest visible
 * first-parent ancestor (so lane lines flow continuously through the gap), flag those remapped links
 * `spansHidden` (renderer draws them dashed), and re-run the edge state machine over the result.
 *
 * Shared by {@link computeDisplayRows} (segment collapse — `dropped` derived from collapsed segments)
 * and the scope re-root projection (`dropped` = everything off the focal spine). When `dropped` is
 * empty the untouched `processedRows` are returned unchanged.
 *
 * `unloadedColumns` (from the original layout pass) is re-threaded into the edge recompute so a merge
 * whose additional parent paged off the window keeps its dangling stub — the surviving rows preserve
 * their original `column`, so the sha→column map stays valid across the re-pass.
 */
export function applyDroppedRows<T extends ProcessedGraphRow>(
	processedRows: readonly T[],
	dropped: ReadonlySet<Sha>,
	unloadedColumns?: ReadonlyMap<Sha, number>,
): readonly T[] {
	if (dropped.size === 0) return processedRows;

	// Sha → original row map, used to walk first-parent chains across dropped commits.
	const allBySha = new Map<Sha, T>();
	for (const r of processedRows) {
		allBySha.set(r.sha, r);
	}

	// Walk a starting sha through its first-parent chain until we hit one that's still
	// visible, or run out of ancestors. Returns the visible ancestor's sha (or
	// undefined when the chain bottoms out without finding one).
	const findVisibleAncestor = (start: Sha): Sha | undefined => {
		let walked: Sha | undefined = start;
		let safety = processedRows.length;
		while (walked != null && dropped.has(walked) && safety > 0) {
			walked = allBySha.get(walked)?.parents?.[0];
			safety--;
		}

		if (walked == null) return undefined;

		return dropped.has(walked) ? undefined : walked;
	};

	// Clone surviving rows into a single pre-sized array (no intermediate filtered array). Reset
	// `edges` / `edgeColumnMax` so the upcoming `computeEdges` pass writes fresh state; remap any
	// parents that now point to dropped commits so the edge state machine can correctly terminate
	// them (reusing the original `parents` reference when nothing was remapped). Every remapped link
	// (child → nearest visible ancestor) is recorded so the edge pass can flag it `spansHidden` —
	// the renderer then draws that lane dashed to signal the commits folded away along it.
	const collapsedLinks = new Set<string>();
	const cloned: T[] = new Array(processedRows.length - dropped.size);
	let w = 0;
	for (const r of processedRows) {
		if (dropped.has(r.sha)) continue;

		let remapped = false;
		const newParents: Sha[] = [];
		for (const p of r.parents) {
			if (dropped.has(p)) {
				const visible = findVisibleAncestor(p);
				if (visible != null) {
					newParents.push(visible);
					collapsedLinks.add(collapsedLinkKey(r.sha, visible));
				}

				remapped = true;
			} else {
				newParents.push(p);
			}
		}

		cloned[w++] = { ...r, parents: remapped ? newParents : r.parents, edges: {}, edgeColumnMax: 0 };
	}

	// Mutates each row's `edges` / `edgeColumnMax` in place. Thread `unloadedColumns` through so the
	// unloaded-additional-parent dangling stub survives the fold (it'd otherwise drop on every collapse).
	computeEdges(
		cloned,
		collapsedLinks.size > 0 || unloadedColumns != null
			? { collapsedLinks: collapsedLinks.size > 0 ? collapsedLinks : undefined, unloadedColumns: unloadedColumns }
			: undefined,
	);
	return cloned;
}

/**
 * Renumber sparse lane columns to a dense 0..N range, remapping each row's `column` and edge column
 * keys (content — kind/spansHidden — is preserved; only the lane index changes). Dropping lanes (e.g.
 * the scope re-root projection) leaves gaps — the focal branch can end up stranded at column 7 with an
 * empty gutter to its left; this packs the surviving lanes back together. Returns the rows untouched
 * when columns are already dense. NOT used for ordinary fold-collapse (lane colors should stay stable
 * there); reserved for the re-rooted scope view where re-coloring to the compact range is expected.
 */
export function compactColumns<T extends ProcessedGraphRow>(rows: readonly T[]): readonly T[] {
	if (rows.length === 0) return rows;

	const used = new Set<number>();
	for (const r of rows) {
		used.add(r.column);
		for (const key of Object.keys(r.edges)) {
			used.add(Number(key));
		}
	}

	const sorted = [...used].sort((a, b) => a - b);
	let dense = true;
	for (let i = 0; i < sorted.length; i++) {
		if (sorted[i] !== i) {
			dense = false;
			break;
		}
	}
	if (dense) return rows;

	const colMap = new Map<number, number>();
	for (let i = 0; i < sorted.length; i++) {
		colMap.set(sorted[i], i);
	}

	return rows.map(r => {
		const edges: RowEdges = {};
		let max = 0;
		for (const key of Object.keys(r.edges)) {
			const nc = colMap.get(Number(key)) ?? 0;
			edges[nc] = r.edges[Number(key)];
			if (nc > max) {
				max = nc;
			}
		}

		return { ...r, column: colMap.get(r.column) ?? 0, edges: edges, edgeColumnMax: max };
	});
}

/**
 * Branch-hint resolver — gives the chip a "+N in feat-foo" label when the segment's tip
 * happens to carry a head ref. Prefers a non-current head, falling back to the first head,
 * then to the first remote's `owner/name` (or bare `name`). Returns `undefined` for unreffed
 * tips, in which case the chip just shows "+N".
 *
 * Takes a pre-built sha→row map, not the raw rows array — this runs once per collapsed-lane tip
 * (potentially many per adornment-resolve pass), so the caller builds the index once per rows
 * generation instead of this doing an O(rows) `.find()` per tip.
 */
export function branchHintFor(rowBySha: ReadonlyMap<Sha, GitGraphRow> | undefined, tipSha: Sha): string | undefined {
	const row = rowBySha?.get(tipSha);
	if (row == null) return undefined;

	const head = row.heads?.find(h => !h.isCurrentHead) ?? row.heads?.[0];
	if (head != null) return head.name;

	const remote = row.remotes?.[0];
	if (remote != null) return remote.owner ? `${remote.owner}/${remote.name}` : remote.name;

	return undefined;
}

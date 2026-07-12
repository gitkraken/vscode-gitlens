import { identifyFirstParentChain } from '@gitkraken/commit-graph/engine/layout.js';
import type { LaneSegment, ProcessedGraphRow, Sha } from '@gitkraken/commit-graph/engine/types.js';
import type { GitGraphRow } from '@gitlens/git/models/graph.js';
import type { GraphScope } from '../../../../plus/graph/protocol.js';

/**
 * Scope anchor sets derived from the active {@link GraphScope}. We categorize anchors into
 * three semantic classes so the renderer can render distinct visuals per type
 * (legacy GKC parity: fork-point diamond vs merge-target ring vs focal-tip rail):
 *   • focalTip — the head commit of the focal branch
 *   • forkPoint — the merge-base where the focal branch diverged from its parent line
 *   • mergeTarget — the tip of the merge target (typically main/develop)
 * `anchorShas` is the union of all three (legacy behavior, used for paging fallback +
 * the existing accent rail). `syntheticChildren` matches the legacy model: anchor shas
 * are the source of wavy synthetic edges to unloaded ancestors.
 */
export interface ScopeAnchors {
	anchorShas?: ReadonlySet<string>;
	focalTipShas?: ReadonlySet<string>;
	forkPointShas?: ReadonlySet<string>;
	mergeTargetShas?: ReadonlySet<string>;
	syntheticChildren?: ReadonlySet<string>;
	unreachableAnchors?: ReadonlySet<string>;
}

/**
 * Compute scope anchor sets + the synthetic-children set, classifying each anchor as
 * present-in-rows vs unreachable (the latter surfaced to the host to trigger paging).
 * Returns empty anchors when scope or rows are absent.
 */
export function computeScopeAnchors(
	rows: readonly GitGraphRow[] | undefined,
	scope: GraphScope | undefined,
): ScopeAnchors {
	if (scope == null || rows == null || rows.length === 0) {
		return {
			anchorShas: undefined,
			focalTipShas: undefined,
			forkPointShas: undefined,
			mergeTargetShas: undefined,
			syntheticChildren: undefined,
			unreachableAnchors: undefined,
		};
	}

	const focalTip = new Set<string>();
	const forkPoint = new Set<string>();
	const mergeTarget = new Set<string>();
	const unreachable = new Set<string>();
	if (scope.mergeBase?.sha) {
		if (rows.some(r => r.sha === scope.mergeBase!.sha)) {
			forkPoint.add(scope.mergeBase.sha);
		} else {
			unreachable.add(scope.mergeBase.sha);
		}
	}

	if (scope.mergeTargetTipSha) {
		if (rows.some(r => r.sha === scope.mergeTargetTipSha)) {
			mergeTarget.add(scope.mergeTargetTipSha);
		} else {
			unreachable.add(scope.mergeTargetTipSha);
		}
	}

	// Resolve the focal branch's tip by name — the row carrying the matching head ref.
	if (scope.branchName) {
		let resolved = false;
		for (const r of rows) {
			if (r.heads?.some(h => h.name === scope.branchName)) {
				focalTip.add(r.sha);
				resolved = true;
				break;
			}
		}

		if (!resolved) {
			unreachable.add(`branch:${scope.branchName}`);
		}
	}

	const anchors = new Set<string>([...focalTip, ...forkPoint, ...mergeTarget]);
	return {
		anchorShas: anchors,
		focalTipShas: focalTip.size > 0 ? focalTip : undefined,
		forkPointShas: forkPoint.size > 0 ? forkPoint : undefined,
		mergeTargetShas: mergeTarget.size > 0 ? mergeTarget : undefined,
		syntheticChildren: anchors,
		unreachableAnchors: unreachable.size > 0 ? unreachable : undefined,
	};
}

/**
 * In-scope sha set: the first-parent chain walked from the focal-branch tip (legacy
 * "first-parent only" view semantics). When scope is active, rows NOT in this set are
 * dimmed so the focused branch's lineage stands out. We extend the chain through the
 * merge target's first-parent ancestors too so the user can still see the mainline
 * context the focal branch will be merged into.
 */
export function computeInScopeShas(
	rows: readonly GitGraphRow[] | undefined,
	scope: GraphScope | undefined,
	focalTipShas: ReadonlySet<string> | undefined,
	mergeTargetShas: ReadonlySet<string> | undefined,
): ReadonlySet<string> | undefined {
	if (scope == null || rows == null || rows.length === 0) return undefined;
	if (focalTipShas == null || focalTipShas.size === 0) return undefined;

	const heads: Sha[] = [...focalTipShas];
	if (mergeTargetShas != null) {
		heads.push(...mergeTargetShas);
	}

	// `GitGraphRow` already carries sha + parents at the top level and the chain walk reads only
	// those, so pass rows straight through — no projected-array allocation per scope recompute.
	return identifyFirstParentChain(rows, heads);
}

/**
 * Scope re-root projection: the result of "filter the graph down to just the focal branch".
 * The focal branch's first-parent spine (tip → merge-base) stays fully visible; the merge-target
 * lane and the shared history below the merge-base each collapse into an expandable fold (one stub
 * row each), and every other lane is dropped. The fold maps mirror the lane-collapse maps so the
 * existing fold-chevron adornment + toggle drive the expand/collapse with no extra wiring.
 */
export interface ScopeProjection {
	/** Commits to hide (everything not on the focal spine and not a visible fold body/stub). */
	dropped: ReadonlySet<Sha>;
	/** Both folds (merge-target + older-history), keyed by stub tip — for the discoverable chevron. */
	foldSegments: ReadonlyMap<Sha, LaneSegment>;
	/** Subset of `foldSegments` currently collapsed (= not in `manuallyExpanded`). */
	collapsedByTipSha: ReadonlyMap<Sha, LaneSegment>;
	/** Hidden-commit count per fold stub (drives the chevron's "+N" affordance/tooltip). */
	hiddenCountByTipSha: ReadonlyMap<Sha, number>;
}

function firstParentChainUntil(
	bySha: ReadonlyMap<Sha, ProcessedGraphRow>,
	start: Sha,
	stop: ReadonlySet<Sha>,
	limit: number,
): Sha[] {
	const chain: Sha[] = [];
	let cur: Sha | undefined = start;
	let safety = limit;
	while (cur != null && safety-- > 0) {
		if (stop.has(cur) || !bySha.has(cur)) break;

		chain.push(cur);
		cur = bySha.get(cur)?.parents?.[0];
	}

	return chain;
}

/**
 * Project the processed rows down to the scoped branch (see {@link ScopeProjection}). Returns
 * `undefined` when there's no scope or no fork point to re-root around (nothing to fold "beyond"),
 * in which case the caller falls back to ordinary lane-collapse + in-scope dimming.
 *
 * `manuallyExpanded` is the same set the lane-fold toggle maintains — a fold stub present there is
 * rendered expanded (its whole chain visible), so toggling a stub's chevron flips its state for free.
 */
export function computeScopeProjection(
	rows: readonly ProcessedGraphRow[] | undefined,
	scope: GraphScope | undefined,
	anchors: ScopeAnchors,
	manuallyExpanded: ReadonlySet<Sha>,
): ScopeProjection | undefined {
	if (scope == null || rows == null || rows.length === 0) return undefined;

	const focalTip = anchors.focalTipShas?.values().next().value;
	const mergeBase = anchors.forkPointShas?.values().next().value;
	// Re-rooting needs both a focal tip and a fork point — without the merge-base there's no
	// boundary to fold "beyond", so leave scoping as the dim-in-place fallback.
	if (focalTip == null || mergeBase == null) return undefined;

	const bySha = new Map<Sha, ProcessedGraphRow>();
	const indexBySha = new Map<Sha, number>();
	for (let i = 0; i < rows.length; i++) {
		const r = rows[i];
		bySha.set(r.sha, r);
		indexBySha.set(r.sha, i);
	}
	if (!bySha.has(focalTip) || !bySha.has(mergeBase)) return undefined;

	// Focal spine: the branch's first-parent chain from its tip down to (and including) the merge-base.
	// The merge-base may NOT lie on the first-parent chain (e.g. the branch's first-parent line re-enters
	// trunk above the computed fork point); bound the walk by the merge-base's row position (rows are
	// newest→oldest, so a higher index is older) so a chain that misses it stops instead of running past
	// and swallowing trunk history into the spine.
	const mergeBaseIndex = indexBySha.get(mergeBase) ?? rows.length;
	const focalSpine = new Set<Sha>();
	{
		let cur: Sha | undefined = focalTip;
		let safety = rows.length;
		while (cur != null && safety-- > 0) {
			if (cur === mergeBase) {
				focalSpine.add(cur);
				break;
			}
			// Past (older than) the merge-base without hitting it → the first-parent line diverged from the
			// fork point; stop so trunk history isn't dragged into the spine.
			if ((indexBySha.get(cur) ?? -1) > mergeBaseIndex) break;

			focalSpine.add(cur);
			cur = bySha.get(cur)?.parents?.[0];
		}
	}

	// The branch's working-changes row (sits on the focal tip) stays visible alongside the spine.
	const visible = new Set<Sha>(focalSpine);
	for (const r of rows) {
		if (r.kind === 'workdir' && r.parents.length > 0 && focalSpine.has(r.parents[0])) {
			visible.add(r.sha);
		}
	}

	const foldSegments = new Map<Sha, LaneSegment>();
	const collapsedByTipSha = new Map<Sha, LaneSegment>();
	const hiddenCountByTipSha = new Map<Sha, number>();
	const addFold = (chain: Sha[], forkSha: Sha | null): void => {
		if (chain.length === 0) return;

		const tip = chain[0];
		const segment: LaneSegment = {
			id: tip,
			tipSha: tip,
			forkSha: forkSha,
			mergeSha: null,
			column: bySha.get(tip)?.column ?? 0,
			commitShas: chain,
		};
		foldSegments.set(tip, segment);
		hiddenCountByTipSha.set(tip, chain.length - 1);
		if (manuallyExpanded.has(tip)) {
			for (const sha of chain) {
				visible.add(sha);
			}
		} else {
			visible.add(tip);
			collapsedByTipSha.set(tip, segment);
		}
	};

	// Merge-target fold: the target tip's divergent first-parent chain, down to (excluding) the
	// merge-base. forkSha = merge-base so the chevron/junction logic anchors it there.
	const mergeTargetTip = anchors.mergeTargetShas?.values().next().value;
	if (mergeTargetTip != null && mergeTargetTip !== mergeBase && bySha.has(mergeTargetTip)) {
		addFold(firstParentChainUntil(bySha, mergeTargetTip, focalSpine, rows.length), mergeBase);
	}

	// Older-history fold: everything on the first-parent line below the merge-base.
	const olderTip = bySha.get(mergeBase)?.parents?.[0];
	if (olderTip != null && bySha.has(olderTip)) {
		addFold(firstParentChainUntil(bySha, olderTip, focalSpine, rows.length), null);
	}

	const dropped = new Set<Sha>();
	for (const r of rows) {
		if (!visible.has(r.sha)) {
			dropped.add(r.sha);
		}
	}

	return {
		dropped: dropped,
		foldSegments: foldSegments,
		collapsedByTipSha: collapsedByTipSha,
		hiddenCountByTipSha: hiddenCountByTipSha,
	};
}

import { identifyFirstParentChain } from './engine/layout.js';
import type { LaneSegment, ProcessedGraphRow, Sha } from './engine/types.js';

/**
 * Minimum row shape the scope math reads — a sha plus its parent links. Consumers pass their own row
 * type; any superset works. Ref metadata (which branch heads a row carries) is NOT part of the shape:
 * it reaches the focal-tip resolution through the injected {@link ScopeHeadsPredicate} instead.
 */
export interface ScopeRow {
	sha: Sha;
	parents: readonly Sha[];
}

/**
 * Minimum scope shape the scope math reads — the focal branch's name plus its resolved fork point and
 * merge-target tip. Consumers pass their own scope type; any superset works.
 *
 * Distinct from the engine's `GraphScope` (a data-layer row filter) — this describes the
 * "focused on one branch" view the anchors + re-root projection are derived from.
 */
export interface FocalScope {
	/** Name of the focal branch, matched against a row's heads via {@link ScopeHeadsPredicate}. */
	branchName?: string;
	/** Merge-base where the focal branch diverged from its parent line. */
	mergeBase?: { sha: Sha };
	/** Tip of the merge target (typically main/develop). Its ancestors are NOT walked. */
	mergeTargetTipSha?: Sha;
}

/**
 * Host-injected "does this row carry the focal branch's head ref?" test — the engine has no ref model
 * of its own, so the focal tip is resolved by asking the consumer about its own row metadata.
 */
export type ScopeHeadsPredicate<T> = (row: T, branchName: string) => boolean;

/**
 * Scope anchor sets derived from the active {@link FocalScope}. We categorize anchors into
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
	anchorShas?: ReadonlySet<Sha>;
	focalTipShas?: ReadonlySet<Sha>;
	forkPointShas?: ReadonlySet<Sha>;
	mergeTargetShas?: ReadonlySet<Sha>;
	syntheticChildren?: ReadonlySet<Sha>;
	/** Anchor SHAs the scope resolved but the loaded rows don't carry. Consumers page toward these, so
	 *  membership is restricted to real, pageable SHAs — never a synthetic marker for a ref that didn't
	 *  resolve (a page request for one walks history for a SHA that can never match). */
	unreachableAnchors?: ReadonlySet<Sha>;
}

/**
 * Compute scope anchor sets + the synthetic-children set, classifying each anchor as
 * present-in-rows vs unreachable (the latter surfaced to the host to trigger paging).
 * Returns empty anchors when scope or rows are absent.
 */
export function computeScopeAnchors<T extends ScopeRow>(
	rows: readonly T[] | undefined,
	scope: FocalScope | undefined,
	hasHead: ScopeHeadsPredicate<T>,
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

	const focalTip = new Set<Sha>();
	const forkPoint = new Set<Sha>();
	const mergeTarget = new Set<Sha>();
	const unreachable = new Set<Sha>();
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

	// Resolve the focal branch's tip by name — the row carrying the matching head ref. An unresolved
	// branch is reported as an absent `focalTipShas`, NOT as an unreachable anchor: we only know the
	// branch's NAME here, and consumers page `unreachableAnchors` by SHA.
	if (scope.branchName) {
		for (const r of rows) {
			if (hasHead(r, scope.branchName)) {
				focalTip.add(r.sha);
				break;
			}
		}
	}

	const anchors = new Set<Sha>([...focalTip, ...forkPoint, ...mergeTarget]);
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
 *
 * Returns `undefined` (= dim nothing) when the scope resolved a merge base the loaded rows don't carry
 * yet AND the chain is still cut at the loaded window's edge — see the truncation gate below.
 */
export function computeInScopeShas(
	rows: readonly ScopeRow[] | undefined,
	scope: FocalScope | undefined,
	focalTipShas: ReadonlySet<Sha> | undefined,
	mergeTargetShas: ReadonlySet<Sha> | undefined,
	forkPointShas: ReadonlySet<Sha> | undefined,
): ReadonlySet<Sha> | undefined {
	if (scope == null || rows == null || rows.length === 0) return undefined;
	if (focalTipShas == null || focalTipShas.size === 0) return undefined;

	const heads: Sha[] = [...focalTipShas];
	if (mergeTargetShas != null) {
		heads.push(...mergeTargetShas);
	}

	// The rows already carry sha + parents at the top level and the chain walk reads only those, so
	// pass rows straight through — no projected-array allocation per scope recompute.
	const chain = identifyFirstParentChain(rows, heads);

	// The chain walk is bounded to LOADED rows, so a merge base that hasn't paged in yet (`forkPointShas`
	// is non-empty iff the base IS in the loaded rows) truncates it at the window's edge — for a branch
	// whose base is deep that leaves only the branch's own commits in scope and dims essentially every row
	// on screen ("focused" in name, greyed-out in practice). A knowably-truncated spine is worse than no
	// dim at all, so a cut chain suppresses the set while the base is missing.
	//
	// The truncation test is what scopes the suppression: once the loaded lines have bottomed out at root
	// commits there is no window edge left for the base to be hiding below — it isn't on these lines at
	// all (typically a SHA a history rewrite left behind) — and the chain is as complete as it will ever
	// get. That case KEEPS the dim, mirroring a scope with no resolved base; it is also the shape
	// `computeScopeProjection`'s bounded-spine bail falls back to, so suppressing it there would leave the
	// scope with no treatment at all.
	//
	// `computeScopeProjection` re-roots the truncated case itself (open terminus) and its projection
	// suppresses this set entirely, so in the default configuration this never decides anything. It
	// carries the fallback for lane folding turned OFF, where no re-root runs at all and dimming is the
	// only scope treatment.
	if (scope.mergeBase?.sha != null && !forkPointShas?.size && isChainTruncated(rows, chain)) return undefined;

	return chain;
}

/** True when some chain row's first parent didn't make it into the chain — rows load newest→oldest with
 *  parents after children, so a missing first parent means the walk was cut at the loaded window's edge
 *  rather than ending at a root. */
function isChainTruncated(rows: readonly ScopeRow[], chain: ReadonlySet<Sha>): boolean {
	for (const row of rows) {
		if (!chain.has(row.sha)) continue;

		const firstParent = row.parents[0];
		if (firstParent && !chain.has(firstParent)) return true;
	}
	return false;
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

const noStop: ReadonlySet<Sha> = new Set<Sha>();

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
 * `undefined` when there's no scope, no focal tip, or no merge base at all, in which case the caller
 * falls back to ordinary lane-collapse + in-scope dimming.
 *
 * A merge base the scope RESOLVED but the loaded rows don't carry yet re-roots with an **open
 * terminus**: the tip is the start and the boundary is merely late, so the spine runs from the tip to
 * the edge of the loaded window and the older-history fold is omitted until the base arrives. The bound
 * is sound because rows load as a date-ordered prefix and `--date-order` respects topology, so an
 * unloaded base means nothing below it on the first-parent line is loaded either — the walk terminates
 * at or above the base, never past it.
 *
 * A scope with NO resolved base is different in kind, not degree: git has already answered "there is no
 * boundary" (the focal branch is the default branch, has no merge target, or has no common ancestor with
 * one), so paging can never produce a terminus. An open-terminus spine there would grow deeper into trunk
 * with every page — re-shuffling the view on each one — so those scopes keep the dim-in-place fallback.
 *
 * `manuallyExpanded` is the same set the lane-fold toggle maintains — a fold stub present there is
 * rendered expanded (its whole chain visible), so toggling a stub's chevron flips its state for free.
 */
export function computeScopeProjection(
	rows: readonly ProcessedGraphRow[] | undefined,
	scope: FocalScope | undefined,
	anchors: ScopeAnchors,
	manuallyExpanded: ReadonlySet<Sha>,
): ScopeProjection | undefined {
	if (scope == null || rows == null || rows.length === 0) return undefined;

	const focalTip = anchors.focalTipShas?.values().next().value;
	const forkPoint = anchors.forkPointShas?.values().next().value;
	// Re-rooting needs a focal tip to start from and a boundary to work toward — a scope that resolved
	// neither has nothing to re-root around, so leave it on the dim-in-place fallback.
	if (focalTip == null || (forkPoint == null && scope.mergeBase?.sha == null)) return undefined;

	const bySha = new Map<Sha, ProcessedGraphRow>();
	const indexBySha = new Map<Sha, number>();
	for (let i = 0; i < rows.length; i++) {
		const r = rows[i];
		bySha.set(r.sha, r);
		indexBySha.set(r.sha, i);
	}
	if (!bySha.has(focalTip)) return undefined;

	// The merge base as a bound THESE rows can actually carry. The anchors are resolved against the
	// consumer's row set, which is a superset of the engine's (ref-visibility and stash filtering run in
	// between), so a base the anchors classified as loaded can still be missing here. Absent either way means
	// the same thing to everything below — bound the spine with the open-terminus stand-in rather than with
	// an index bound that resolves to `rows.length` and lets the walk swallow trunk.
	const mergeBase = forkPoint != null && bySha.has(forkPoint) ? forkPoint : undefined;

	// Focal spine: the branch's first-parent chain from its tip down to (and including) the merge-base.
	// The merge-base may NOT lie on the first-parent chain (e.g. the branch's first-parent line re-enters
	// trunk above the computed fork point); bound the walk by the merge-base's row position (rows are
	// newest→oldest, so a higher index is older) so a chain that misses it stops instead of running past
	// and swallowing trunk history into the spine.
	const mergeBaseIndex = mergeBase != null ? (indexBySha.get(mergeBase) ?? rows.length) : rows.length;
	// Open terminus only: with no loaded base to stop at, the merge target's OWN first-parent line stands in
	// for the boundary. Anything on it is an ancestor of the target, so meeting it means the walk has reached
	// shared history — which is the property that matters here, and it holds without assuming the two lines
	// have a unique common ancestor (criss-cross histories have several). It can stop EARLIER than the base
	// git picked, never later, so the error direction is a shorter spine rather than trunk in the spine.
	// Absent a stand-in (no loaded target tip) only the loaded-window edge bounds the walk, so a stale target
	// far back in history yields a longer spine — still bounded, and still the branch's own line.
	const mergeTargetTip = anchors.mergeTargetShas?.values().next().value;
	const sharedLine =
		mergeBase == null && mergeTargetTip != null && bySha.has(mergeTargetTip)
			? new Set(firstParentChainUntil(bySha, mergeTargetTip, noStop, rows.length))
			: undefined;
	const focalSpine = new Set<Sha>();
	// Did the walk actually reach a boundary? Always true once a loaded base bounds it. Under an open
	// terminus it distinguishes "ran out of LOADED rows / met the shared line" — the boundary is merely
	// late — from "ran to a root commit", which means the resolved base isn't on this line at all.
	let boundedSpine = mergeBase != null;
	{
		let cur: Sha | undefined = focalTip;
		let safety = rows.length;
		while (cur != null && safety-- > 0) {
			// Off the end of the loaded rows: more history exists below, so the boundary is down there.
			if (!bySha.has(cur)) {
				boundedSpine = true;
				break;
			}
			if (cur === mergeBase) {
				focalSpine.add(cur);
				break;
			}
			// Reached history the merge target also carries — at or below the fork point (open terminus).
			// Never on the FIRST step: when the focal tip itself sits on the target's line (two branches on
			// one commit) an empty spine would drop every row, so the tip always makes it in and the walk
			// stops one step later.
			if (sharedLine?.has(cur) && focalSpine.size > 0) {
				boundedSpine = true;
				break;
			}
			// Past (older than) the merge-base without hitting it → the first-parent line diverged from the
			// fork point; stop so trunk history isn't dragged into the spine.
			if ((indexBySha.get(cur) ?? -1) > mergeBaseIndex) break;

			focalSpine.add(cur);
			cur = bySha.get(cur)?.parents?.[0];
		}
	}
	// The line ran to a root with no boundary in sight, so the resolved base is not merely late — it isn't
	// on this line at all (typically a SHA a history rewrite left behind). Re-rooting on that would present
	// trunk as the branch's spine, so leave it on the dim-in-place fallback.
	if (!boundedSpine) return undefined;

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
	// merge-base. forkSha = merge-base so the chevron/junction logic anchors it there — `null` under an
	// open terminus, since anchoring the junction at a row that isn't loaded would draw it nowhere.
	if (mergeTargetTip != null && mergeTargetTip !== mergeBase && bySha.has(mergeTargetTip)) {
		addFold(firstParentChainUntil(bySha, mergeTargetTip, focalSpine, rows.length), mergeBase ?? null);
	}

	// Older-history fold: everything on the first-parent line below the merge-base. Skipped under an open
	// terminus — the base bounds this fold, and nothing below an unloaded base is loaded to fold.
	const olderTip = mergeBase != null ? bySha.get(mergeBase)?.parents?.[0] : undefined;
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

import type { GraphScope, GraphScopeOrigin } from '../../../../plus/graph/protocol.js';
import { sameScopeOrigin } from '../sidebar/branchActions.utils.js';

/**
 * Re-stamps a `${repoPath}|...` id (e.g. `getBranchId`'s output) from one repo path onto another.
 *
 * Used when a same-family rebind (a worktree ↔ its main repo, or two sibling worktrees) swaps which
 * binding the graph renders from: the underlying commit graph is shared, so an id naming a branch by
 * the OLD path is still the same branch under the NEW one — only the path component needs to move.
 *
 * Matches on the exact `${fromRepoPath}|` prefix (including the delimiter), so a path that merely
 * starts with `fromRepoPath` as a string (e.g. `/repo2` against `/repo`) is never mistaken for it.
 * Ids that don't carry the `fromRepoPath` prefix at all are returned unchanged.
 */
export function restampId(id: string, fromRepoPath: string, toRepoPath: string): string {
	const prefix = `${fromRepoPath}|`;
	if (!id.startsWith(prefix)) return id;

	return `${toRepoPath}${id.slice(fromRepoPath.length)}`;
}

/**
 * Re-stamps a {@link GraphScope}'s repoPath-embedded ref ids (`branchRef`, `additionalBranchRefs`,
 * `upstreamRef`) from one repo path onto another for a same-family rebind. Everything else is
 * preserved as-is:
 * - `origin` is deliberately not part of the scope's refresh identity (see its own doc comment) and
 *   isn't a repoPath-embedded id, so it carries over unchanged.
 * - `focalBranchTipSha`/`mergeTargetTipSha`/`mergeBase.sha` are commit SHAs, family-stable by
 *   construction (the family shares one commit graph) — no re-stamping needed or correct to do.
 */
export function restampScope(scope: GraphScope, fromRepoPath: string, toRepoPath: string): GraphScope {
	if (fromRepoPath === toRepoPath) return scope;

	return {
		...scope,
		branchRef: restampId(scope.branchRef, fromRepoPath, toRepoPath),
		// Conditionally spread rather than assigning `undefined` outright — an absent optional field must
		// stay absent (not become a present key holding `undefined`) so the re-stamped scope's shape
		// exactly mirrors the input's.
		...(scope.upstreamRef != null
			? { upstreamRef: restampId(scope.upstreamRef, fromRepoPath, toRepoPath) }
			: undefined),
		...(scope.additionalBranchRefs != null
			? {
					additionalBranchRefs: scope.additionalBranchRefs.map(ref =>
						restampId(ref, fromRepoPath, toRepoPath),
					),
				}
			: undefined),
	};
}

/** What a worktree gesture resolves to — see {@link resolveWorktreeGesture}. Every field is an ACTION
 *  for the calling surface to execute; the machine itself is pure. */
export interface WorktreeGestureOutcome {
	/** `'set'` re-perspectives onto {@link perspectivePath}; `'clear'` exits any live perspective;
	 *  `'none'` leaves it alone. */
	readonly perspective: 'set' | 'clear' | 'none';
	/** Target for `perspective: 'set'`. */
	readonly perspectivePath?: string;
	/** Whether to clear the live branch focus — the toggle-off half of the exit. */
	readonly clearScope: boolean;
	/** Whether the caller should still run its branch-focus pipeline. */
	readonly focus: boolean;
	/** The origin the caller must forward to that focus call — dropped for a go-home gesture, so the
	 *  focus that follows is genuinely PLAIN (no worktree icon on the chip, no worktree toggle identity). */
	readonly origin: GraphScopeOrigin | undefined;
	/** The WIP row to select and reveal once the rebind lands, set only when the gesture was performed ON
	 *  that row AND it scopes (see {@link WorktreeGestureInput.targetRowId}). */
	readonly followRowId?: string;
}

/** What the calling surface knows at gesture time — see {@link resolveWorktreeGesture}. */
export interface WorktreeGestureInput {
	/** Ref id of the branch this gesture targets (`${repoPath}|heads/{name}`), or undefined when the
	 *  surface couldn't resolve one. Each surface derives it its own way (the sidebar builds it from the
	 *  selected repo path, the WIP row and pill read it off their row) — the machine only compares it. */
	readonly branchRef: string | undefined;
	/** Provenance this gesture would stamp: a worktree origin for a Scope verb, `undefined` for a plain
	 *  Focus, or a pull-request/stack origin from a sidebar leaf. Whether a worktree gesture stamps one
	 *  at all stays the SURFACE's decision (`graph.doubleClickWorktreeAction`, the dual-verb button). */
	readonly origin: GraphScopeOrigin | undefined;
	/** The worktree this gesture's ROW is, independent of `origin` — a plain-Focus payload carries no
	 *  origin but must still be able to close a perspective an earlier Scope left on the same row. */
	readonly worktreePath: string | undefined;
	readonly scope: { readonly branchRef: string; readonly origin?: GraphScopeOrigin } | undefined;
	readonly perspectivePath: string | undefined;
	readonly homeRepositoryPath: string | undefined;
	/** `graph.scopeBehavior` resolved to a boolean by the caller. */
	readonly scopeBehaviorIncludesFocus: boolean;
	/** The graph row the gesture was performed ON, when the surface IS that row (the WIP row, the
	 *  overview pill). Declared by the surface rather than inferred: it's what separates "the user acted
	 *  on this row, follow it" from a rebind arriving while they're parked elsewhere. */
	readonly targetRowId?: string;
}

/**
 * The whole worktree-gesture rule, in one place: toggle-off detection, the go-home exit, the perspective
 * transition and whether a focus follows. Every gesture surface (the sidebar row, the graph's WIP row,
 * the overview pill) resolves through this and then just executes the outcome, so the rule can't drift
 * into three subtly different copies again — which it had.
 *
 * TOGGLE IDENTITY IS ORIGIN-AWARE (the sidebar's rule, promoted): re-invoking the same branch through the
 * SAME origin is a toggle-off, but reaching that branch through a DIFFERENT one (a stack or pull request
 * over its plain-focused base, a Scope verb over a plain Focus) changes the scope's shape and is a
 * re-focus. Only the sidebar got this right before; the WIP row and pill compared `branchRef` alone and
 * toggled off instead.
 *
 * The EXIT's scope-clear is deliberately branch-keyed and origin-BLIND, which is not the same question:
 * "did the user re-invoke the same thing?" decides whether this is an exit at all, while "is there a live
 * focus on this branch?" decides what an exit has to clean up. Keeping the second origin-blind is what
 * preserves the full-exit ruling — a Focus-verb gesture on a worktree an earlier Scope gesture both
 * scoped and focused still leaves nothing behind.
 *
 * The graph's HOME worktree is its un-scoped identity, so a gesture on it means "go home": exit any live
 * perspective wherever it points, and run a PLAIN focus (no origin, ungated by `graph.scopeBehavior`).
 * See {@link isHomeWorktree} for why that's keyed on the home BINDING rather than the repo's default
 * worktree.
 */
export function resolveWorktreeGesture(input: WorktreeGestureInput): WorktreeGestureOutcome {
	const { branchRef, origin, scope, targetRowId, worktreePath } = input;

	const isHome = isHomeWorktree(worktreePath, input.homeRepositoryPath);
	// A home gesture exits whatever perspective is live, even one pointing at a DIFFERENT worktree —
	// that's what makes "gesture on home to go home" work from anywhere.
	const homeExit = isHome && input.perspectivePath != null;
	// The live focus is on this branch — the exit's cleanup question (origin-blind, see above).
	const focusedOnBranch = branchRef != null && scope?.branchRef === branchRef;
	// The user re-invoked the same target the same way — the exit's ENTRY question (origin-aware).
	const sameTarget = focusedOnBranch && sameScopeOrigin(scope?.origin, origin);
	// This row's own worktree is the live perspective. Skipped for home, whose perspective handling is
	// the unconditional exit above rather than a same-path match (home is never itself "the perspective").
	const perspectived = !isHome && worktreePath != null && input.perspectivePath === worktreePath;

	if (sameTarget || perspectived) {
		return {
			perspective: perspectived || homeExit ? 'clear' : 'none',
			clearScope: focusedOnBranch,
			focus: false,
			origin: undefined,
			// No follow on the way OUT: the row returns to its ordinary position and the viewport's
			// parking (see `gl-lit-graph`'s rebind re-track) is the right behavior for that direction.
			followRowId: undefined,
		};
	}

	if (origin?.kind === 'worktree' && !isHome) {
		return {
			perspective: 'set',
			perspectivePath: origin.path,
			clearScope: false,
			focus: input.scopeBehaviorIncludesFocus,
			origin: origin,
			followRowId: targetRowId,
		};
	}

	return {
		perspective: homeExit ? 'clear' : 'none',
		clearScope: false,
		focus: true,
		// A go-home gesture drops the origin so the focus that follows is plain; anything else forwards
		// what it was given (a pull-request or stack origin from a sidebar leaf included).
		origin: isHome ? undefined : origin,
		followRowId: undefined,
	};
}

/**
 * Whether `worktreePath` is the worktree the graph calls HOME — i.e. a gesture on it means "exit any
 * scope", not "scope to it". The single home test behind every worktree gesture surface (the WIP row,
 * the overview pill, the sidebar row, and the host-command path via {@link resolveWorktreeGesture}), so
 * they can't disagree about the same row.
 *
 * Deliberately NOT `worktree.isDefault`: the repo's main checkout is only home when the window was
 * opened there. Open a window on a worktree and that worktree is home, while the main checkout becomes
 * an ordinary scope target — the gestures on it must produce a real scoped state, not a silent no-op.
 * An unknown home (`undefined`, before the first state lands) answers false: scoping is recoverable
 * (the host refuses and the perspective reverts), silently swallowing the gesture isn't.
 */
export function isHomeWorktree(worktreePath: string | undefined, homeRepositoryPath: string | undefined): boolean {
	return worktreePath != null && homeRepositoryPath != null && worktreePath === homeRepositoryPath;
}

import type { GraphScope, GraphScopeOrigin } from '../../../../plus/graph/protocol.js';
import type { AppState } from '../context.js';
import { sameScopeOrigin } from '../sidebar/branchActions.utils.js';

/**
 * Re-stamps a `${repoPath}|...` id (e.g. `getBranchId`'s output) from one repo path onto another for a
 * same-family rebind: the family shares one commit graph, so an id naming a branch by the OLD path names
 * the same branch under the NEW one.
 *
 * Matches the exact `${fromRepoPath}|` prefix INCLUDING the delimiter, so a path that merely starts with
 * `fromRepoPath` (e.g. `/repo2` against `/repo`) is never mistaken for it. Non-matching ids pass through.
 */
export function restampId(id: string, fromRepoPath: string, toRepoPath: string): string {
	const prefix = `${fromRepoPath}|`;
	if (!id.startsWith(prefix)) return id;

	return `${toRepoPath}${id.slice(fromRepoPath.length)}`;
}

/**
 * Re-stamps a {@link GraphScope}'s repoPath-embedded ref ids (`branchRef`, `additionalBranchRefs`,
 * `upstreamRef`) from one repo path onto another for a same-family rebind. Everything else carries over:
 * `origin` isn't a repoPath-embedded id, and the SHAs are family-stable by construction, so re-stamping
 * either would be wrong.
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
	/** The worktree this gesture's ROW is, independent of `origin` — it identifies the row (is this HOME?
	 *  is this the live perspective?) for BOTH verbs, including the plain-Focus payload that carries no
	 *  origin. It does NOT let a plain Focus close a perspective: see `perspectiveExit`. */
	readonly worktreePath: string | undefined;
	readonly scope: { readonly branchRef: string; readonly origin?: GraphScopeOrigin } | undefined;
	/**
	 * Which VERB the user invoked — the only thing that may close a perspective on this row (see
	 * `perspectiveExit`). Declared by the surface rather than inferred from `origin`, because the two
	 * genuinely differ: the overview bar omits the origin on the PRIMARY pill even under the Scope verb
	 * (that pill's worktree is already the graph's binding, so there is no rebind to ask for), and the
	 * sidebar's home row omits it too (the gesture means "go home", not "perspective to home"). Reading
	 * the verb off `origin` would strand the scoped worktree's own pill with no way to exit.
	 *
	 * Defaults to `'scope'` when omitted — surfaces with only one verb (the host commands, an ordinary
	 * branch row that has no worktree at all) keep the full-exit behavior.
	 */
	readonly verb?: 'scope' | 'focus';
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
 * transition and whether a focus follows. Every gesture surface (the sidebar row, the graph's WIP row, the
 * overview pill) resolves through this and then just executes the outcome, so the rule can't drift into
 * three subtly different copies.
 *
 * TOGGLE IDENTITY IS ORIGIN-AWARE: re-invoking the same branch through the SAME origin is a toggle-off,
 * but reaching it through a DIFFERENT one (a stack or pull request over its plain-focused base, a Scope
 * verb over a plain Focus) changes the scope's shape and is a re-focus.
 *
 * The EXIT's scope-clear is deliberately branch-keyed and origin-BLIND, a different question: "did the
 * user re-invoke the same thing?" decides whether this is an exit at all, while "is there a live focus on
 * this branch?" decides what the exit must clean up. So a SCOPE-verb exit still clears a focus a plain
 * Focus put there, and vice versa.
 *
 * WHICH VERB MAY CLOSE A PERSPECTIVE is a third question, and only the Scope verb may (see
 * `perspectiveExit`). A plain Focus is focus-only, because that is what the setting and the Alt-click
 * affordance promise; it can unfocus a branch on a scoped worktree without unscoping it.
 *
 * The graph's HOME worktree is its un-scoped identity, so a SCOPE gesture on it means "go home": exit any
 * live perspective wherever it points, and run a PLAIN focus (no origin, ungated by
 * `graph.scopeBehavior`). A FOCUS gesture on home focuses only, like anywhere else.
 */
export function resolveWorktreeGesture(input: WorktreeGestureInput): WorktreeGestureOutcome {
	const { branchRef, origin, scope, targetRowId, worktreePath } = input;

	const isHome = isHomeWorktree(worktreePath, input.homeRepositoryPath);
	// Only the SCOPE verb may move the perspective at all — see `perspectiveExit` below for the rule and
	// why it is keyed on the declared verb rather than on `origin`.
	const scopeVerb = (input.verb ?? 'scope') === 'scope';
	// A SCOPE gesture on home exits whatever perspective is live, even one pointing at a DIFFERENT
	// worktree — that's what makes "gesture on home to go home" work from anywhere. A FOCUS gesture on home
	// does not: the setting promises focus-only, and the home row is reachable while scoped elsewhere.
	const homeExit = isHome && scopeVerb && input.perspectivePath != null;
	// The live focus is on this branch — the exit's cleanup question (origin-blind, see above).
	const focusedOnBranch = branchRef != null && scope?.branchRef === branchRef;
	// The user re-invoked the same target the same way — the exit's ENTRY question (origin-aware).
	const sameTarget = focusedOnBranch && sameScopeOrigin(scope?.origin, origin);
	// This row's own worktree is the live perspective. Skipped for home, whose perspective handling is
	// the unconditional exit above rather than a same-path match (home is never itself "the perspective").
	const perspectived = !isHome && worktreePath != null && input.perspectivePath === worktreePath;
	// Only the SCOPE verb may close a perspective on this row: the Focus verb is focus-only BY CONTRACT,
	// so it toggles the branch and leaves the perspective where it was. NO Focus-verb gesture touches the
	// perspective on any row, home included (see `homeExit`). Keyed on the declared `verb`, NOT on
	// `origin?.kind` — see {@link WorktreeGestureInput.verb} for the Scope-verb payloads that carry no
	// origin, which gating on the origin would strand.
	const perspectiveExit = perspectived && scopeVerb;

	if (sameTarget || perspectiveExit) {
		return {
			perspective: perspectiveExit || homeExit ? 'clear' : 'none',
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
 * Executes the perspective + scope-clear half of a {@link resolveWorktreeGesture} outcome, shared by every
 * gesture surface so the transition can't drift between them.
 *
 * The FOCUS half (`outcome.focus`/`outcome.origin`) deliberately stays with the caller: each surface scopes
 * a different way (by name, by ref plus `additional` refs, via a dispatched event) and only some emit
 * telemetry on the transition.
 *
 * `onFollowRow` fires only when `outcome.followRowId` is set, which only happens when the gesture was
 * performed ON a graph row. A caller with no row to follow can omit it.
 *
 * The scope live BEFORE the clear is threaded through as `clearWorktreePerspective`'s
 * `restoreScopeOnRefusal`, so a host-refused exit restores the branch focus along with the perspective.
 */
export function applyWorktreeGestureOutcome(
	state: AppState,
	outcome: WorktreeGestureOutcome,
	branchName: string | undefined,
	onFollowRow?: (rowId: string, repoPath: string) => void,
): void {
	// Captured before the clear below, which is what makes it a restorable snapshot.
	const scopeOnRefusal = outcome.clearScope ? state.scope : undefined;

	if (outcome.clearScope) {
		state.clearScope();
	}

	if (outcome.perspective === 'set' && outcome.perspectivePath != null) {
		state.setWorktreePerspective(outcome.perspectivePath, { branchName: branchName });
		if (outcome.followRowId != null) {
			onFollowRow?.(outcome.followRowId, outcome.perspectivePath);
		}
	} else if (outcome.perspective === 'clear' && state.worktreePerspective != null) {
		state.clearWorktreePerspective(scopeOnRefusal != null ? { restoreScopeOnRefusal: scopeOnRefusal } : undefined);
	}
}

/**
 * Whether `worktreePath` is the worktree the graph calls HOME — i.e. a gesture on it means "exit any
 * scope", not "scope to it". The single home test behind every worktree gesture surface, so they can't
 * disagree about the same row.
 *
 * Deliberately NOT `worktree.isDefault`: the repo's main checkout is only home when the window was opened
 * there. Open a window on a worktree and the main checkout becomes an ordinary scope target. An unknown
 * home (before the first state lands) answers false — scoping is recoverable if wrong, since the host
 * refuses and the perspective reverts, while silently swallowing the gesture isn't.
 */
export function isHomeWorktree(worktreePath: string | undefined, homeRepositoryPath: string | undefined): boolean {
	return worktreePath != null && homeRepositoryPath != null && worktreePath === homeRepositoryPath;
}

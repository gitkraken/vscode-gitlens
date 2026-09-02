import * as assert from 'assert';
import type { GraphScope } from '../../../../../plus/graph/protocol.js';
import type { AppState } from '../../context.js';
import type { WorktreeGestureOutcome } from '../rebind.utils.js';
import {
	applyWorktreeGestureOutcome,
	isHomeWorktree,
	resolveWorktreeGesture,
	restampId,
	restampScope,
} from '../rebind.utils.js';

suite('restampId', () => {
	test('re-stamps an id carrying the exact fromRepoPath prefix', () => {
		assert.strictEqual(restampId('/repo|heads/main', '/repo', '/wt'), '/wt|heads/main');
	});

	test('re-stamps a remote-ref id', () => {
		assert.strictEqual(restampId('/repo|remotes/origin/main', '/repo', '/wt'), '/wt|remotes/origin/main');
	});

	test('leaves an id with an unrelated repo path unchanged', () => {
		assert.strictEqual(restampId('/other|heads/main', '/repo', '/wt'), '/other|heads/main');
	});

	// Guard against a prefix collision: `/repo2` must not be mistaken for `/repo` just because it
	// starts with the same characters — the match requires the `|` delimiter right after `fromRepoPath`.
	test('does not match a path that merely starts with fromRepoPath', () => {
		assert.strictEqual(restampId('/repo2|heads/main', '/repo', '/wt'), '/repo2|heads/main');
	});

	test('is a no-op when fromRepoPath === toRepoPath', () => {
		assert.strictEqual(restampId('/repo|heads/main', '/repo', '/repo'), '/repo|heads/main');
	});
});

suite('restampScope', () => {
	function makeScope(overrides?: Partial<GraphScope>): GraphScope {
		return {
			branchName: 'main',
			branchRef: '/repo|heads/main',
			upstreamRef: '/repo|remotes/origin/main',
			additionalBranchRefs: ['/repo|heads/feature-a', '/repo|heads/feature-b'],
			focalBranchTipSha: 'a'.repeat(40),
			mergeTargetTipSha: 'b'.repeat(40),
			mergeBase: { sha: 'c'.repeat(40), date: 1234 },
			origin: { kind: 'worktree', path: '/repo' },
			...overrides,
		};
	}

	test('re-stamps branchRef, upstreamRef, and every additionalBranchRefs entry', () => {
		const result = restampScope(makeScope(), '/repo', '/wt');

		assert.strictEqual(result.branchRef, '/wt|heads/main');
		assert.strictEqual(result.upstreamRef, '/wt|remotes/origin/main');
		assert.deepStrictEqual(result.additionalBranchRefs, ['/wt|heads/feature-a', '/wt|heads/feature-b']);
	});

	test('preserves origin, branchName, and SHA-based anchors unchanged', () => {
		const scope = makeScope();
		const result = restampScope(scope, '/repo', '/wt');

		assert.strictEqual(result.branchName, scope.branchName);
		assert.deepStrictEqual(result.origin, scope.origin);
		assert.strictEqual(result.focalBranchTipSha, scope.focalBranchTipSha);
		assert.strictEqual(result.mergeTargetTipSha, scope.mergeTargetTipSha);
		assert.deepStrictEqual(result.mergeBase, scope.mergeBase);
	});

	test('leaves undefined upstreamRef/additionalBranchRefs undefined', () => {
		const scope = makeScope({ upstreamRef: undefined, additionalBranchRefs: undefined });
		const result = restampScope(scope, '/repo', '/wt');

		assert.strictEqual(result.upstreamRef, undefined);
		assert.strictEqual(result.additionalBranchRefs, undefined);
	});

	test('returns the same scope reference when fromRepoPath === toRepoPath', () => {
		const scope = makeScope();
		assert.strictEqual(restampScope(scope, '/repo', '/repo'), scope);
	});
});

/**
 * The home test behind every worktree gesture. The regression these pin: comparing against the repo
 * FAMILY (always the main checkout) instead of the graph's HOME binding silently turned "scope to the
 * main worktree" into a no-op go-home in any window opened ON a worktree — where the main checkout is
 * an ordinary scope target and the divergence is exactly what the user is asking to see.
 */
suite('isHomeWorktree', () => {
	test('the graph’s home worktree is home', () => {
		assert.strictEqual(isHomeWorktree('/home', '/home'), true);
	});

	test('another worktree is not', () => {
		assert.strictEqual(isHomeWorktree('/wt', '/home'), false);
	});

	// Window opened ON a worktree: home is that worktree, and the repo's main checkout is a scope target
	// like any other — this is the case the family-key comparison got wrong.
	test('the repo’s MAIN checkout is not home when the window was opened on a worktree', () => {
		assert.strictEqual(isHomeWorktree('/main', '/main.worktrees/feature'), false);
	});

	test('that same window still treats its own worktree as home', () => {
		assert.strictEqual(isHomeWorktree('/main.worktrees/feature', '/main.worktrees/feature'), true);
	});

	test('an unknown home answers false — scope (recoverable) over a silently swallowed gesture', () => {
		assert.strictEqual(isHomeWorktree('/wt', undefined), false);
		assert.strictEqual(isHomeWorktree(undefined, '/home'), false);
	});
});

/**
 * The one gesture machine every surface resolves through. The matrix below is the contract: each row is
 * a state the sidebar row, the WIP row and the overview pill must now agree on, where before they had
 * three subtly different copies of it.
 */
suite('resolveWorktreeGesture', () => {
	const home = '/home';
	const wtOrigin = { kind: 'worktree', path: '/wt' } as const;

	function gesture(overrides: Partial<Parameters<typeof resolveWorktreeGesture>[0]> = {}) {
		return resolveWorktreeGesture({
			branchRef: '/wt|heads/feature',
			origin: wtOrigin,
			worktreePath: '/wt',
			scope: undefined,
			perspectivePath: undefined,
			homeRepositoryPath: home,
			scopeBehaviorIncludesFocus: true,
			...overrides,
		});
	}

	suite('scoping in', () => {
		test('a non-home worktree sets the perspective, keeps the origin, and focuses', () => {
			assert.deepStrictEqual(gesture(), {
				perspective: 'set',
				perspectivePath: '/wt',
				clearScope: false,
				focus: true,
				origin: wtOrigin,
				followRowId: undefined,
			});
		});

		test("`scopeBehavior: 'scope'` scopes without focusing", () => {
			const outcome = gesture({ scopeBehaviorIncludesFocus: false });

			assert.strictEqual(outcome.perspective, 'set');
			assert.strictEqual(outcome.focus, false);
		});

		test('a gesture ON a row carries that row as the follow target', () => {
			assert.strictEqual(gesture({ targetRowId: 'wip::/wt' }).followRowId, 'wip::/wt');
		});

		test('a surface that is not a row (the sidebar) asks for no follow', () => {
			assert.strictEqual(gesture().followRowId, undefined);
		});
	});

	suite('toggle identity — the origin-aware rule, promoted from the sidebar', () => {
		// The behavior DELTA this unification ships: the WIP row and pill compared `branchRef` alone, so
		// reaching the same branch through a different origin toggled the focus off instead of re-shaping it.
		test('same branch through the SAME origin toggles off', () => {
			const outcome = gesture({ scope: { branchRef: '/wt|heads/feature', origin: wtOrigin } });

			assert.strictEqual(outcome.clearScope, true);
			assert.strictEqual(outcome.focus, false);
			assert.strictEqual(outcome.perspective, 'none', 'nothing was perspectived to exit');
		});

		test('same branch through a DIFFERENT origin RE-focuses instead of toggling off', () => {
			const outcome = gesture({
				scope: { branchRef: '/wt|heads/feature', origin: { kind: 'pullRequest', number: '7' } },
			});

			assert.strictEqual(outcome.clearScope, false, 'not a toggle — the scope changes shape');
			assert.strictEqual(outcome.focus, true);
			assert.deepStrictEqual(outcome.origin, wtOrigin);
		});

		test('a plain focus over a plain focus on the same branch still toggles off', () => {
			const outcome = gesture({
				origin: undefined,
				scope: { branchRef: '/wt|heads/feature' },
			});

			assert.strictEqual(outcome.clearScope, true);
			assert.strictEqual(outcome.focus, false);
		});
	});

	suite('exiting', () => {
		test('re-gesturing the live perspective exits both halves', () => {
			const outcome = gesture({
				scope: { branchRef: '/wt|heads/feature', origin: wtOrigin },
				perspectivePath: '/wt',
			});

			assert.strictEqual(outcome.perspective, 'clear');
			assert.strictEqual(outcome.clearScope, true);
			assert.strictEqual(outcome.focus, false);
		});

		// The exit's scope-clear is branch-keyed and origin-BLIND on purpose — a different question from
		// the origin-aware ENTRY. Without that split, unifying on the sidebar's rule would have quietly
		// stopped this case from fully exiting (perspective cleared, focus left behind).
		test('a SCOPE-verb gesture carrying no origin still fully exits (the primary pill after a rebind)', () => {
			// The reachable shape the verb gate has to keep working: once a rebind lands, the scoped
			// worktree's own pill/row is PRIMARY, and the surfaces stamp no worktree origin on it (there's
			// no rebind left to ask for). Inferring the verb from `origin` would strand that row with no
			// way out of the perspective it is showing.
			const outcome = gesture({
				origin: undefined,
				verb: 'scope',
				scope: { branchRef: '/wt|heads/feature', origin: wtOrigin },
				perspectivePath: '/wt',
			});

			assert.strictEqual(outcome.perspective, 'clear');
			assert.strictEqual(outcome.clearScope, true, 'the exit is origin-blind about what it cleans up');
		});

		test('a FOCUS-verb gesture on the live perspective unfocuses only, leaving the perspective', () => {
			// The contract `graph.doubleClickWorktreeAction: 'focus'` and the sidebar's Alt-click both
			// promise: focus the branch, never touch the scope. Reaching the branch through a different
			// verb than the live scope's origin makes this a re-focus, not a toggle-off — so it focuses.
			const refocus = gesture({
				origin: undefined,
				verb: 'focus',
				scope: { branchRef: '/wt|heads/feature', origin: wtOrigin },
				perspectivePath: '/wt',
			});

			assert.strictEqual(refocus.perspective, 'none', 'the Focus verb must never close a perspective');
			assert.strictEqual(refocus.focus, true);

			// And re-invoking that plain focus toggles the BRANCH off, still leaving the perspective.
			const unfocus = gesture({
				origin: undefined,
				verb: 'focus',
				scope: { branchRef: '/wt|heads/feature' },
				perspectivePath: '/wt',
			});

			assert.strictEqual(unfocus.perspective, 'none');
			assert.strictEqual(unfocus.clearScope, true, 'the branch unfocuses');
			assert.strictEqual(unfocus.focus, false);
		});

		test('the FOCUS verb does NOT go home — no Focus gesture touches the perspective, on any row', () => {
			// The home row is reachable from all three double-click surfaces while the graph is scoped
			// somewhere ELSE, so exempting it would break `doubleClickWorktreeAction: 'focus'`'s promise
			// exactly where the user is least expecting it — clicking one worktree's row to focus its branch
			// and silently unscoping another. The rule is uniform: only the Scope verb moves the perspective.
			const outcome = gesture({
				origin: undefined,
				verb: 'focus',
				worktreePath: home,
				perspectivePath: '/wt',
			});

			assert.strictEqual(outcome.perspective, 'none', 'the Focus verb leaves the perspective alone');
			assert.strictEqual(outcome.focus, true, 'and still focuses the branch');
		});

		test('the SCOPE verb still goes home, from a perspective pointing anywhere', () => {
			// The other half of the same gate: the home row's own Scope payload carries no origin (it means
			// "go home", not "perspective to home"), which is exactly why the gate reads the declared verb
			// rather than the origin.
			const outcome = gesture({
				origin: undefined,
				verb: 'scope',
				worktreePath: home,
				perspectivePath: '/wt',
			});

			assert.strictEqual(outcome.perspective, 'clear');
			assert.strictEqual(outcome.focus, true);
		});

		test('exiting a perspective whose focus is on another branch leaves that focus alone', () => {
			const outcome = gesture({
				scope: { branchRef: '/wt|heads/other' },
				perspectivePath: '/wt',
			});

			assert.strictEqual(outcome.perspective, 'clear');
			assert.strictEqual(outcome.clearScope, false);
		});

		test('an exit never asks for a follow — the row goes back where it was', () => {
			const outcome = gesture({ perspectivePath: '/wt', targetRowId: 'wip::/wt' });

			assert.strictEqual(outcome.followRowId, undefined);
		});

		// The HOST-COMMAND path (`GraphApp.applyWorktreeGestureOrigin` — the focus command and
		// `showWorktreeInGraph`) used to resolve with `branchRef` and `scope` withheld, on the theory that a
		// command is a fresh ask and never a toggle. But the machine still saw `worktreePath`, so a repeat
		// took the exit branch with `focusedOnBranch` stuck false: perspective cleared, focus and chip left
		// standing. A half exit only that one surface could produce — hence the second half of this test,
		// which pins WHY every caller has to thread both inputs.
		test('the command path exits fully because it threads the same branchRef + scope every surface does', () => {
			const live = { branchRef: '/wt|heads/feature', origin: wtOrigin };

			const threaded = gesture({ scope: live, perspectivePath: '/wt' });
			assert.strictEqual(threaded.perspective, 'clear');
			assert.strictEqual(threaded.clearScope, true);

			const withheld = gesture({ branchRef: undefined, scope: undefined, perspectivePath: '/wt' });
			assert.strictEqual(withheld.perspective, 'clear');
			assert.strictEqual(
				withheld.clearScope,
				false,
				'withholding both inputs is exactly what produced the half exit',
			);
		});
	});

	suite('go home', () => {
		test('a gesture on home exits a perspective pointing ANYWHERE and focuses plainly', () => {
			const outcome = gesture({
				branchRef: '/home|heads/main',
				origin: { kind: 'worktree', path: home },
				worktreePath: home,
				perspectivePath: '/some-other-wt',
			});

			assert.deepStrictEqual(outcome, {
				perspective: 'clear',
				clearScope: false,
				focus: true,
				origin: undefined,
				followRowId: undefined,
			});
		});

		test('a gesture on home with nothing perspectived is just a plain focus', () => {
			const outcome = gesture({
				branchRef: '/home|heads/main',
				origin: { kind: 'worktree', path: home },
				worktreePath: home,
			});

			assert.strictEqual(outcome.perspective, 'none');
			assert.strictEqual(outcome.focus, true);
			assert.strictEqual(outcome.origin, undefined);
		});

		test('home is the BINDING, so the main checkout of a worktree-home window scopes normally', () => {
			const outcome = gesture({
				branchRef: '/main|heads/main',
				origin: { kind: 'worktree', path: '/main' },
				worktreePath: '/main',
				homeRepositoryPath: '/main.worktrees/feature',
			});

			assert.strictEqual(outcome.perspective, 'set');
			assert.deepStrictEqual(outcome.origin, { kind: 'worktree', path: '/main' });
		});

		test("`scopeBehavior: 'scope'` does not suppress a go-home focus — it is not scoping", () => {
			const outcome = gesture({
				branchRef: '/home|heads/main',
				origin: { kind: 'worktree', path: home },
				worktreePath: home,
				scopeBehaviorIncludesFocus: false,
			});

			assert.strictEqual(outcome.focus, true);
		});
	});

	suite('non-worktree origins (sidebar leaves)', () => {
		test('a pull-request origin passes through untouched and focuses', () => {
			const pr = { kind: 'pullRequest', number: '7' } as const;
			const outcome = gesture({ branchRef: '/home|heads/x', origin: pr, worktreePath: undefined });

			assert.deepStrictEqual(outcome, {
				perspective: 'none',
				clearScope: false,
				focus: true,
				origin: pr,
				followRowId: undefined,
			});
		});

		test('a stack over its plain-focused base re-focuses rather than toggling off', () => {
			const stack = { kind: 'stack', number: 3, size: 2 } as const;
			const outcome = gesture({
				branchRef: '/home|heads/x',
				origin: stack,
				worktreePath: undefined,
				scope: { branchRef: '/home|heads/x' },
			});

			assert.strictEqual(outcome.clearScope, false);
			assert.strictEqual(outcome.focus, true);
			assert.deepStrictEqual(outcome.origin, stack);
		});

		test('the same stack again toggles off', () => {
			const stack = { kind: 'stack', number: 3, size: 2 } as const;
			const outcome = gesture({
				branchRef: '/home|heads/x',
				origin: stack,
				worktreePath: undefined,
				scope: { branchRef: '/home|heads/x', origin: { kind: 'stack', number: 3, size: 2 } },
			});

			assert.strictEqual(outcome.clearScope, true);
			assert.strictEqual(outcome.focus, false);
		});
	});
});

/**
 * The state-mutation half every gesture surface used to hand-write itself. Focus stays with the
 * caller by design (see the function's own doc comment), so it's out of scope here.
 */
suite('applyWorktreeGestureOutcome', () => {
	type FakeState = AppState & {
		clearScopeCalls: number;
		perspectiveCalls: { path: string; branchName: string | undefined }[];
		clearPerspectiveCalls: number;
		clearPerspectiveOptions: ({ restoreScopeOnRefusal?: unknown } | undefined)[];
	};

	function fakeState(overrides?: Partial<AppState>): FakeState {
		const state = {
			clearScopeCalls: 0,
			perspectiveCalls: [] as { path: string; branchName: string | undefined }[],
			clearPerspectiveCalls: 0,
			clearPerspectiveOptions: [] as ({ restoreScopeOnRefusal?: unknown } | undefined)[],
			worktreePerspective: undefined,
			clearScope: function () {
				state.clearScopeCalls++;
			},
			setWorktreePerspective: function (path: string, options?: { branchName?: string }) {
				state.perspectiveCalls.push({ path: path, branchName: options?.branchName });
			},
			clearWorktreePerspective: function (options?: { restoreScopeOnRefusal?: unknown }) {
				state.clearPerspectiveCalls++;
				state.clearPerspectiveOptions.push(options);
			},
			...overrides,
		} as unknown as FakeState;

		return state;
	}

	function outcome(overrides?: Partial<WorktreeGestureOutcome>): WorktreeGestureOutcome {
		return {
			perspective: 'none',
			clearScope: false,
			focus: false,
			origin: undefined,
			...overrides,
		};
	}

	test('clears the scope when the outcome asks for it', () => {
		const state = fakeState();

		applyWorktreeGestureOutcome(state, outcome({ clearScope: true }), 'feature');

		assert.strictEqual(state.clearScopeCalls, 1);
	});

	test('sets the perspective and calls onFollowRow when the outcome carries a followRowId', () => {
		const state = fakeState();
		const followCalls: { rowId: string; repoPath: string }[] = [];

		applyWorktreeGestureOutcome(
			state,
			outcome({ perspective: 'set', perspectivePath: '/wt', followRowId: 'wip::/wt' }),
			'feature',
			(rowId, repoPath) => followCalls.push({ rowId: rowId, repoPath: repoPath }),
		);

		assert.deepStrictEqual(state.perspectiveCalls, [{ path: '/wt', branchName: 'feature' }]);
		assert.deepStrictEqual(followCalls, [{ rowId: 'wip::/wt', repoPath: '/wt' }]);
	});

	test('does not call onFollowRow when the outcome carries no followRowId (the sidebar surface)', () => {
		const state = fakeState();
		let followCalls = 0;

		applyWorktreeGestureOutcome(state, outcome({ perspective: 'set', perspectivePath: '/wt' }), 'feature', () => {
			followCalls++;
		});

		assert.strictEqual(followCalls, 0);
	});

	test('omitting onFollowRow entirely is safe even when there is a followRowId to follow', () => {
		const state = fakeState();

		assert.doesNotThrow(() =>
			applyWorktreeGestureOutcome(
				state,
				outcome({ perspective: 'set', perspectivePath: '/wt', followRowId: 'wip::/wt' }),
				'feature',
			),
		);
	});

	test('clears the perspective when the outcome asks to clear one that is live', () => {
		const state = fakeState({ worktreePerspective: { path: '/wt' } });

		applyWorktreeGestureOutcome(state, outcome({ perspective: 'clear' }), 'feature');

		assert.strictEqual(state.clearPerspectiveCalls, 1);
	});

	// The refusal-snapshot half every gesture surface used to hand-write only on the branch pill's ✕ —
	// see `applyWorktreeGestureOutcome`'s doc comment.
	test('a full exit passes the scope live BEFORE the clear as restoreScopeOnRefusal', () => {
		const liveScope: GraphScope = { branchName: 'main', branchRef: '/wt|heads/main' };
		const state = fakeState({ worktreePerspective: { path: '/wt' }, scope: liveScope });

		applyWorktreeGestureOutcome(state, outcome({ perspective: 'clear', clearScope: true }), 'feature');

		assert.deepStrictEqual(state.clearPerspectiveOptions, [{ restoreScopeOnRefusal: liveScope }]);
	});

	test('an exit that does not clear the scope passes no restoreScopeOnRefusal', () => {
		const otherScope: GraphScope = { branchName: 'other', branchRef: '/wt|heads/other' };
		const state = fakeState({ worktreePerspective: { path: '/wt' }, scope: otherScope });

		applyWorktreeGestureOutcome(state, outcome({ perspective: 'clear', clearScope: false }), 'feature');

		assert.deepStrictEqual(state.clearPerspectiveOptions, [undefined]);
	});

	test('does not clear the perspective when the outcome says clear but none is live', () => {
		const state = fakeState({ worktreePerspective: undefined });

		applyWorktreeGestureOutcome(state, outcome({ perspective: 'clear' }), 'feature');

		assert.strictEqual(state.clearPerspectiveCalls, 0);
	});

	test('a no-op outcome touches nothing', () => {
		const state = fakeState();

		applyWorktreeGestureOutcome(state, outcome(), 'feature');

		assert.strictEqual(state.clearScopeCalls, 0);
		assert.strictEqual(state.perspectiveCalls.length, 0);
		assert.strictEqual(state.clearPerspectiveCalls, 0);
	});
});

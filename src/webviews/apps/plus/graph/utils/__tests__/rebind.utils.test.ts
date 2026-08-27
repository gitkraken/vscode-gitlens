import * as assert from 'assert';
import type { GraphScope } from '../../../../../plus/graph/protocol.js';
import { isHomeWorktree, resolveWorktreeGesture, restampId, restampScope } from '../rebind.utils.js';

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
		test('a DIFFERENT-origin gesture on the live perspective still clears the focus on that branch', () => {
			const outcome = gesture({
				origin: undefined,
				scope: { branchRef: '/wt|heads/feature', origin: wtOrigin },
				perspectivePath: '/wt',
			});

			assert.strictEqual(outcome.perspective, 'clear');
			assert.strictEqual(outcome.clearScope, true, 'the full-exit ruling must survive the origin split');
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

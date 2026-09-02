import * as assert from 'assert';
import type { ReactiveControllerHost } from 'lit';
import type { GraphScopeOrigin } from '../../../../plus/graph/protocol.js';
import type { OverviewBarFocusDetail } from '../components/gl-graph-overview-bar.js';
import { OverviewBarController } from '../overviewBarController.js';

/**
 * `onFocus` handles a double-click on an overview-bar pill — it shares the `graph.doubleClickWorktreeAction`
 * setting with the graph canvas's WIP-row double-click (`GraphApp.toggleScopeFromWipRow`) and the
 * sidebar worktree row's double-click. In its default `'scope'` mode, a SECONDARY pill's worktree isn't
 * the graph's own, so focusing it must set the worktree PERSPECTIVE (and still stamp the origin on the
 * scope for provenance/toggle-identity) — same rule as the sidebar's "Scope to Worktree" action. Whether
 * it ALSO focuses the branch is gated by `graph.scopeBehavior`. In `'focus'` mode it's the classic
 * branch-focus toggle instead, with no perspective involved at all. A PRIMARY pill's worktree is already
 * the graph's own, so it never gets a NEW perspective either way.
 */
suite('OverviewBarController.onFocus — worktree perspective + origin stamping', () => {
	const fakeHost: ReactiveControllerHost = {
		addController: () => {},
		removeController: () => {},
		requestUpdate: () => {},
		updateComplete: Promise.resolve(true),
	};

	function createController(
		config?: {
			doubleClickWorktreeAction?: 'scope' | 'focus';
			scopeBehavior?: 'scope' | 'scopeAndFocus';
		},
		home = '/repo',
	): {
		controller: OverviewBarController;
		calls: { branchName: string; upstreamName: string | undefined; origin: GraphScopeOrigin | undefined }[];
		perspectiveCalls: { path: string; branchName: string | undefined }[];
		clearPerspectiveCalls: number[];
		graphState: {
			scope: unknown;
			worktreePerspective: { path: string; branchName?: string } | undefined;
			config: typeof config;
			homeRepositoryPath: string;
		};
	} {
		const calls: { branchName: string; upstreamName: string | undefined; origin: GraphScopeOrigin | undefined }[] =
			[];
		const perspectiveCalls: { path: string; branchName: string | undefined }[] = [];
		// A live counter array (not a snapshot number) — `.length` after the fact reflects calls made
		// during `onFocus`, since the destructured array reference is shared, not copied.
		const clearPerspectiveCalls: number[] = [];
		const graphState = {
			scope: undefined as unknown,
			worktreePerspective: undefined as { path: string; branchName?: string } | undefined,
			config: config,
			// Where the graph calls home — what `isHomeWorktree` compares each pill against. `/repo` is
			// the ordinary window-opened-at-the-main-checkout case; the worktree-home suite below overrides it.
			homeRepositoryPath: home,
			clearScope: () => {
				graphState.scope = undefined;
			},
			setWorktreePerspective: (path: string, options?: { branchName?: string }) => {
				perspectiveCalls.push({ path: path, branchName: options?.branchName });
				graphState.worktreePerspective = { path: path, branchName: options?.branchName };
			},
			clearWorktreePerspective: () => {
				clearPerspectiveCalls.push(1);
				graphState.worktreePerspective = undefined;
			},
		};
		const controller = new OverviewBarController(fakeHost, {
			graphState: () => graphState,
			graph: () => undefined,
			scopeToBranchByName: (
				branchName: string,
				upstreamName?: string,
				options?: { origin?: GraphScopeOrigin },
			) => {
				calls.push({ branchName: branchName, upstreamName: upstreamName, origin: options?.origin });
				return Promise.resolve();
			},
			fetchSelectedWorktreeWipStats: () => Promise.resolve(),
		} as unknown as never);
		return {
			controller: controller,
			calls: calls,
			perspectiveCalls: perspectiveCalls,
			clearPerspectiveCalls: clearPerspectiveCalls,
			graphState: graphState,
		};
	}

	function focusEvent(detail: OverviewBarFocusDetail): CustomEvent<OverviewBarFocusDetail> {
		return new CustomEvent<OverviewBarFocusDetail>('gl-graph-overview-bar-focus', { detail: detail });
	}

	test('a secondary pill stamps a worktree origin at its own repo path (default scope mode)', () => {
		const { controller, calls } = createController();

		controller.onFocus(
			focusEvent({
				branchId: '/wt|heads/feature',
				branch: 'feature',
				repoPath: '/wt',
				isPrimary: false,
			}),
		);

		assert.strictEqual(calls.length, 1);
		assert.deepStrictEqual(calls[0].origin, { kind: 'worktree', path: '/wt' });
	});

	test('a secondary pill sets the worktree perspective synchronously, before the focus pipeline', () => {
		const { controller, perspectiveCalls } = createController();

		controller.onFocus(
			focusEvent({
				branchId: '/wt|heads/feature',
				branch: 'feature',
				repoPath: '/wt',
				isPrimary: false,
			}),
		);

		assert.deepStrictEqual(perspectiveCalls, [{ path: '/wt', branchName: 'feature' }]);
	});

	test('the HOME pill stays a plain branch scope — no origin stamped, no perspective set', () => {
		const { controller, calls, perspectiveCalls } = createController();

		controller.onFocus(
			focusEvent({
				branchId: '/repo|heads/main',
				branch: 'main',
				repoPath: '/repo',
				isPrimary: true,
			}),
		);

		assert.strictEqual(calls.length, 1);
		assert.strictEqual(calls[0].origin, undefined);
		assert.deepStrictEqual(perspectiveCalls, []);
	});

	// The REACHABLE shape of "re-focus the already-scoped-and-perspectived worktree": once a rebind has
	// landed, `selectedRepository` IS the worktree, so its own pill reports `isPrimary: true` — a
	// worktree can never re-arrive here as a SECONDARY (`isPrimary: false`) pill while also being the
	// live perspective. It is emphatically not HOME (home is `/repo` here), which is what makes the
	// `perspectived` exit — not the home-pill clear — the path under test here. The
	// toggle-off exit therefore keys off `e.detail.repoPath` directly, never `origin` (which stays
	// `undefined` for a primary pill) — see `onFocus`'s `repoPath` comment.
	test('re-focusing the already-scoped-and-perspectived PRIMARY pill clears BOTH', () => {
		const { controller, graphState, clearPerspectiveCalls } = createController();
		graphState.scope = { branchRef: '/wt|heads/feature' };
		graphState.worktreePerspective = { path: '/wt', branchName: 'feature' };

		controller.onFocus(
			focusEvent({
				branchId: '/wt|heads/feature',
				branch: 'feature',
				repoPath: '/wt',
				isPrimary: true,
			}),
		);

		assert.strictEqual(graphState.scope, undefined, 'the focus must clear');
		assert.strictEqual(clearPerspectiveCalls.length, 1, 'the perspective must clear alongside it');
	});

	// The state the two `!` checks exist for, and the one that regressed when `isPrimary` was dropped:
	// the graph is bound to a worktree that isn't home (a rebind, or the header repo picker), so its pill
	// is primary but not home. Scoping to what the graph is already bound to would be refused by the host,
	// so both this surface and the WIP row must settle on a plain branch focus.
	test('a PRIMARY-but-not-default pill stays a plain branch focus — no origin, no perspective', () => {
		const { controller, calls, perspectiveCalls } = createController();

		controller.onFocus(
			focusEvent({
				branchId: '/wt|heads/feature',
				branch: 'feature',
				repoPath: '/wt',
				isPrimary: true,
			}),
		);

		assert.strictEqual(calls.length, 1);
		assert.strictEqual(calls[0].origin, undefined, 'no self-scope for the binding the graph already has');
		assert.deepStrictEqual(perspectiveCalls, []);
	});

	test('a PRIMARY-but-not-default pill with NO live perspective clears nothing', () => {
		// Reached via the header repo picker (a switch, not a rebind): there is no perspective to exit,
		// and inventing one here is what left the titlebar stuck yellow.
		const { controller, graphState, clearPerspectiveCalls, perspectiveCalls } = createController();

		controller.onFocus(
			focusEvent({
				branchId: '/wt|heads/feature',
				branch: 'feature',
				repoPath: '/wt',
				isPrimary: true,
			}),
		);

		assert.strictEqual(graphState.worktreePerspective, undefined);
		assert.strictEqual(clearPerspectiveCalls.length, 0);
		assert.deepStrictEqual(perspectiveCalls, []);
	});

	test('re-focusing the already-scoped PRIMARY pill with NO live perspective clears focus only', () => {
		// The home repo, never rebound — the ordinary case for every primary-pill toggle before any
		// worktree gesture has ever fired.
		const { controller, graphState, perspectiveCalls, clearPerspectiveCalls } = createController();
		graphState.scope = { branchRef: '/repo|heads/main' };

		controller.onFocus(
			focusEvent({
				branchId: '/repo|heads/main',
				branch: 'main',
				repoPath: '/repo',
				isPrimary: true,
			}),
		);

		assert.strictEqual(graphState.scope, undefined, 'the focus must clear');
		assert.strictEqual(clearPerspectiveCalls.length, 0, 'nothing was perspectived — nothing to clear');
		assert.deepStrictEqual(perspectiveCalls, []);
	});

	suite("graph.doubleClickWorktreeAction === 'focus'", () => {
		test('a secondary pill never sets a perspective and stamps no origin — the classic branch-focus toggle', () => {
			const { controller, calls, perspectiveCalls } = createController({ doubleClickWorktreeAction: 'focus' });

			controller.onFocus(
				focusEvent({
					branchId: '/wt|heads/feature',
					branch: 'feature',
					repoPath: '/wt',
					isPrimary: false,
				}),
			);

			assert.deepStrictEqual(perspectiveCalls, []);
			assert.strictEqual(calls.length, 1);
			assert.strictEqual(calls[0].origin, undefined);
		});

		test('re-focusing the same secondary pill unfocuses (no perspective to clear)', () => {
			const { controller, graphState, clearPerspectiveCalls } = createController({
				doubleClickWorktreeAction: 'focus',
			});
			graphState.scope = { branchRef: '/wt|heads/feature' };

			controller.onFocus(
				focusEvent({
					branchId: '/wt|heads/feature',
					branch: 'feature',
					repoPath: '/wt',
					isPrimary: false,
				}),
			);

			assert.strictEqual(graphState.scope, undefined);
			assert.strictEqual(clearPerspectiveCalls.length, 0);
		});

		test('a live perspective is left alone — the Focus verb never unscopes', () => {
			// The setting was 'scope' when the user perspectived this worktree, then changed to 'focus' —
			// or a DIFFERENT gesture (sidebar, host command) set it. Either way THIS click is the Focus
			// verb, whose contract is "focuses the branch only, without scoping to it", so it must not
			// close a scope the user never asked it to touch. The ways out remain: the Scope verb, the
			// branch pill's ✕, and the sidebar's Scope toggle.
			const { controller, graphState, calls, clearPerspectiveCalls } = createController({
				doubleClickWorktreeAction: 'focus',
			});
			graphState.worktreePerspective = { path: '/wt', branchName: 'feature' };

			controller.onFocus(
				focusEvent({
					branchId: '/wt|heads/feature',
					branch: 'feature',
					repoPath: '/wt',
					isPrimary: false,
				}),
			);

			assert.strictEqual(clearPerspectiveCalls.length, 0, 'the perspective must survive a Focus-verb click');
			assert.strictEqual(calls.length, 1, 'and the branch focus still runs');
		});
	});

	suite("graph.scopeBehavior === 'scope'", () => {
		test('a secondary pill sets the perspective but never runs the focus pipeline', () => {
			const { controller, calls, perspectiveCalls } = createController({ scopeBehavior: 'scope' });

			controller.onFocus(
				focusEvent({
					branchId: '/wt|heads/feature',
					branch: 'feature',
					repoPath: '/wt',
					isPrimary: false,
				}),
			);

			assert.deepStrictEqual(perspectiveCalls, [{ path: '/wt', branchName: 'feature' }]);
			assert.deepStrictEqual(calls, [], 'perspective-only — the focus pipeline must not run');
		});

		test('re-focusing the same secondary pill still fully exits via the perspective alone', () => {
			// With focus disabled, `scope` was never set by the first click — the toggle-off exit must key
			// off the live PERSPECTIVE, not `scope?.branchRef`, or the cycle would never close.
			const { controller, graphState, clearPerspectiveCalls } = createController({
				scopeBehavior: 'scope',
			});
			graphState.worktreePerspective = { path: '/wt', branchName: 'feature' };

			controller.onFocus(
				focusEvent({
					branchId: '/wt|heads/feature',
					branch: 'feature',
					repoPath: '/wt',
					isPrimary: false,
				}),
			);

			assert.strictEqual(clearPerspectiveCalls.length, 1);
		});
	});

	/**
	 * A window opened ON a worktree: home is `/main.worktrees/feature`, so the repo's MAIN checkout is an
	 * ordinary scope target and must produce a real scoped state. Under the old default-worktree test the
	 * main checkout read as home and the gesture silently no-op'd — the round-8 regression.
	 */
	suite('home is a worktree', () => {
		const home = '/main.worktrees/feature';

		test('scoping the repo’s MAIN checkout stamps an origin and sets the perspective', () => {
			const { controller, calls, perspectiveCalls } = createController(undefined, home);

			controller.onFocus(
				focusEvent({
					branchId: '/main|heads/main',
					branch: 'main',
					// The repo's own main checkout — the row that used to be exempted as "the default
					// worktree". Here it is simply not home, so it scopes like any other worktree.
					repoPath: '/main',
					isPrimary: false,
				}),
			);

			assert.deepStrictEqual(perspectiveCalls, [{ path: '/main', branchName: 'main' }]);
			assert.strictEqual(calls.length, 1);
			assert.deepStrictEqual(calls[0].origin, { kind: 'worktree', path: '/main' });
		});

		test('a gesture on the window’s OWN worktree is the go-home exit', () => {
			const { controller, calls, perspectiveCalls, clearPerspectiveCalls, graphState } = createController(
				undefined,
				home,
			);
			graphState.worktreePerspective = { path: '/other-wt', branchName: 'other' };

			controller.onFocus(
				focusEvent({
					branchId: `${home}|heads/feature`,
					branch: 'feature',
					repoPath: home,
					isPrimary: true,
				}),
			);

			assert.strictEqual(clearPerspectiveCalls.length, 1, 'the live perspective must be exited');
			assert.deepStrictEqual(perspectiveCalls, []);
			assert.strictEqual(calls[0]?.origin, undefined, 'and the focus that follows is plain');
		});
	});
});

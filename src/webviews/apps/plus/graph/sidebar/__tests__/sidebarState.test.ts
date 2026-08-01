import * as assert from 'assert';
import type { GitDiffFileStats } from '@gitlens/git/models/diff.js';
import type { GraphSidebarService } from '../../../../../plus/graph/graphService.js';
import type { DidGetSidebarDataParams, SidebarWorktreeChange } from '../../../../../plus/graph/protocol.js';
import type { SidebarActions } from '../sidebarState.js';
import { createSidebarActions } from '../sidebarState.js';

/** Lets the `.then().catch().finally()` chain in `requestWorktreeWipStats` drain before asserting. */
function flush(): Promise<void> {
	return new Promise<void>(resolve => setTimeout(resolve, 0));
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise: promise, resolve: resolve, reject: reject };
}

/** Minimal stand-in — `initialize` only subscribes and fetches counts; the tests drive the rest. */
function fakeService(getWorktreeWipStats: GraphSidebarService['getWorktreeWipStats']): GraphSidebarService {
	const shape = {
		onSidebarInvalidated: async () => () => {},
		onConfigChanged: async () => () => {},
		onWorktreeStateChanged: async () => () => {},
		getSidebarCounts: async () => undefined,
		getWorktreeWipStats: getWorktreeWipStats,
	};
	return shape as unknown as GraphSidebarService;
}

/** Seeds the worktrees panel without a service — `applyWorktreeChanges` reads the resource, not the RPC. */
function seedWorktrees(actions: SidebarActions, items: Array<{ uri: string; hasChanges?: boolean }>): void {
	actions.state.panels.worktrees.mutate({ items: items } as unknown as DidGetSidebarDataParams);
}

function worktreesOf(actions: SidebarActions): Array<{ uri: string; hasChanges?: boolean }> {
	const data = actions.state.panels.worktrees.value.get();
	return (data as unknown as { items: Array<{ uri: string; hasChanges?: boolean }> }).items;
}

suite('Sidebar State Test Suite', () => {
	suite('applyWorktreeChanges', () => {
		let actions: SidebarActions;

		setup(() => {
			actions = createSidebarActions();
		});

		teardown(() => actions.dispose());

		test('applies a clean/dirty flip and republishes the panel data', () => {
			seedWorktrees(actions, [{ uri: '/repos/wt-1', hasChanges: false }]);
			const before = actions.state.panels.worktrees.value.get();

			actions.applyWorktreeChanges({ '/repos/wt-1': { hasChanges: true } });

			assert.strictEqual(worktreesOf(actions)[0].hasChanges, true);
			assert.notStrictEqual(
				actions.state.panels.worktrees.value.get(),
				before,
				'a real change must publish a new object so watchers re-render',
			);
		});

		test('does not republish when nothing actually changed', () => {
			// The reason the breakdown compare had to go: fresh stat objects differed by reference on every
			// FS tick and flashed the panel. A boolean compare has to stay quiet on a no-op push.
			seedWorktrees(actions, [{ uri: '/repos/wt-1', hasChanges: true }]);
			const before = actions.state.panels.worktrees.value.get();

			actions.applyWorktreeChanges({ '/repos/wt-1': { hasChanges: true } });

			assert.strictEqual(actions.state.panels.worktrees.value.get(), before);
		});

		test('leaves rows the push says nothing about untouched', () => {
			seedWorktrees(actions, [
				{ uri: '/repos/wt-1', hasChanges: true },
				{ uri: '/repos/wt-2', hasChanges: false },
			]);

			// An explicit `undefined` is the host saying "no verdict for this one" — not "clean".
			const changes: Record<string, SidebarWorktreeChange | undefined> = { '/repos/wt-1': undefined };
			actions.applyWorktreeChanges(changes);

			assert.strictEqual(worktreesOf(actions)[0].hasChanges, true);
			assert.strictEqual(worktreesOf(actions)[1].hasChanges, false);
		});

		test('ignores a push that arrives before the panel has data', () => {
			assert.doesNotThrow(() => actions.applyWorktreeChanges({ '/repos/wt-1': { hasChanges: true } }));
		});
	});

	suite('requestWorktreeWipStats', () => {
		const stats: GitDiffFileStats = { added: 1, changed: 2, deleted: 3 };

		test('fetches once and records the result', async () => {
			let calls = 0;
			const actions = createSidebarActions();
			actions.initialize(
				fakeService(async () => {
					calls++;
					return stats;
				}),
			);

			actions.requestWorktreeWipStats('/repos/wt-1');
			await flush();

			assert.strictEqual(calls, 1);
			assert.deepStrictEqual(actions.worktreeWipStats.get().get('/repos/wt-1'), stats);
			actions.dispose();
		});

		test('does not re-fetch while a request is in flight', async () => {
			let calls = 0;
			const gate = deferred<GitDiffFileStats | null>();
			const actions = createSidebarActions();
			actions.initialize(
				fakeService(async () => {
					calls++;
					return gate.promise;
				}),
			);

			// Re-entering the same row while the popover is open must not stack `git status` calls.
			actions.requestWorktreeWipStats('/repos/wt-1');
			actions.requestWorktreeWipStats('/repos/wt-1');
			await flush();
			assert.strictEqual(calls, 1);

			gate.resolve(stats);
			await flush();
			assert.strictEqual(calls, 1);
			actions.dispose();
		});

		test('re-asks on a later open so the breakdown cannot go stale', async () => {
			// The client has no invalidation signal for the working tree; the host does (TTL + FS-watcher
			// eviction). So every open re-asks and the host decides whether that costs a `git status`.
			let calls = 0;
			const actions = createSidebarActions();
			actions.initialize(
				fakeService(async () => {
					calls++;
					return calls === 1 ? stats : { added: 9, changed: 9, deleted: 9 };
				}),
			);

			actions.requestWorktreeWipStats('/repos/wt-1');
			await flush();
			actions.requestWorktreeWipStats('/repos/wt-1');
			await flush();

			assert.strictEqual(calls, 2);
			assert.deepStrictEqual(actions.worktreeWipStats.get().get('/repos/wt-1'), {
				added: 9,
				changed: 9,
				deleted: 9,
			});
			actions.dispose();
		});

		test('records a null answer without treating it as an error', async () => {
			const actions = createSidebarActions();
			actions.initialize(fakeService(async () => null));

			actions.requestWorktreeWipStats('/repos/wt-1');
			await flush();

			assert.strictEqual(actions.worktreeWipStats.get().has('/repos/wt-1'), true);
			assert.strictEqual(actions.worktreeWipStats.get().get('/repos/wt-1'), null);
			actions.dispose();
		});

		test('resolves the returned promise even when the fetch fails', async () => {
			// The tooltip awaits this to end its spinner; a rejection here would leave it spinning.
			const actions = createSidebarActions();
			actions.initialize(
				fakeService(async () => {
					throw new Error('git exploded');
				}),
			);

			await actions.requestWorktreeWipStats('/repos/wt-1');

			assert.strictEqual(actions.worktreeWipStats.get().has('/repos/wt-1'), false);
			actions.dispose();
		});

		test('hands concurrent callers the same promise', async () => {
			const gate = deferred<GitDiffFileStats | null>();
			const actions = createSidebarActions();
			actions.initialize(fakeService(async () => gate.promise));

			const a = actions.requestWorktreeWipStats('/repos/wt-1');
			const b = actions.requestWorktreeWipStats('/repos/wt-1');
			assert.strictEqual(a, b, 'a joiner must be able to await the outstanding attempt, not a fresh one');

			gate.resolve(stats);
			await Promise.all([a, b]);
			actions.dispose();
		});

		test('drops cached results and in-flight state when the service is replaced', async () => {
			// RPC reconnect: an outstanding request against the old service may never settle, and its result
			// is no longer trustworthy.
			const gate = deferred<GitDiffFileStats | null>();
			const actions = createSidebarActions();
			actions.initialize(fakeService(async () => gate.promise));
			actions.requestWorktreeWipStats('/repos/wt-1');
			await flush();

			let callsAfterReconnect = 0;
			actions.initialize(
				fakeService(async () => {
					callsAfterReconnect++;
					return stats;
				}),
			);
			assert.strictEqual(actions.worktreeWipStats.get().size, 0);

			actions.requestWorktreeWipStats('/repos/wt-1');
			await flush();
			assert.strictEqual(callsAfterReconnect, 1, 'the path must not still be marked in flight');
			actions.dispose();
		});

		test('leaves a failed path absent so the next open retries', async () => {
			let calls = 0;
			const actions = createSidebarActions();
			actions.initialize(
				fakeService(async () => {
					calls++;
					if (calls === 1) throw new Error('git exploded');
					return stats;
				}),
			);

			actions.requestWorktreeWipStats('/repos/wt-1');
			await flush();
			// Absent, not null — recording a failure would make one bad read permanent for the session.
			assert.strictEqual(actions.worktreeWipStats.get().has('/repos/wt-1'), false);

			actions.requestWorktreeWipStats('/repos/wt-1');
			await flush();
			assert.strictEqual(calls, 2);
			assert.deepStrictEqual(actions.worktreeWipStats.get().get('/repos/wt-1'), stats);
			actions.dispose();
		});

		test('does nothing before a service is wired', () => {
			const actions = createSidebarActions();
			actions.requestWorktreeWipStats('/repos/wt-1');
			assert.strictEqual(actions.worktreeWipStats.get().size, 0);
			actions.dispose();
		});

		test('keys results per path', async () => {
			const actions = createSidebarActions();
			actions.initialize(fakeService(async path => (path === '/repos/wt-1' ? stats : null)));

			actions.requestWorktreeWipStats('/repos/wt-1');
			actions.requestWorktreeWipStats('/repos/wt-2');
			await flush();

			assert.deepStrictEqual(actions.worktreeWipStats.get().get('/repos/wt-1'), stats);
			assert.strictEqual(actions.worktreeWipStats.get().get('/repos/wt-2'), null);
			actions.dispose();
		});
	});
});

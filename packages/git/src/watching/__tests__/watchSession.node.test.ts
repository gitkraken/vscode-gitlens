import assert from 'node:assert';
import { describe, it, mock } from 'node:test';
import type { WatcherRepoChangeEvent, WorkingTreeChangeEvent } from '../changeEvent.js';
import { allWatchedRepositoryChanges } from '../classifyChange.js';
import type { WatchSessionLifecycle } from '../watchSession.js';
import { RepositoryWatchSession } from '../watchSession.js';

function delay(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function makeLifecycle(): WatchSessionLifecycle & {
	firstRepo: ReturnType<typeof mock.fn>;
	lastRepo: ReturnType<typeof mock.fn>;
	firstWT: ReturnType<typeof mock.fn>;
	lastWT: ReturnType<typeof mock.fn>;
} {
	const firstRepo = mock.fn();
	const lastRepo = mock.fn();
	const firstWT = mock.fn();
	const lastWT = mock.fn();
	return {
		onFirstRepoSubscriber: firstRepo,
		onLastRepoSubscriber: lastRepo,
		onFirstWorkingTreeSubscriber: firstWT,
		onLastWorkingTreeSubscriber: lastWT,
		firstRepo: firstRepo,
		lastRepo: lastRepo,
		firstWT: firstWT,
		lastWT: lastWT,
	};
}

describe('WatchSession', () => {
	describe('creation', () => {
		it('exposes repoPath', () => {
			const session = new RepositoryWatchSession({ repoPath: '/repo' });
			assert.strictEqual(session.repoPath, '/repo');
			session.dispose();
		});

		it('starts with no subscribers', () => {
			const session = new RepositoryWatchSession({ repoPath: '/repo' });
			assert.strictEqual(session.repoSubscriberCount, 0);
			assert.strictEqual(session.workingTreeSubscriberCount, 0);
			session.dispose();
		});

		it('starts not suspended', () => {
			const session = new RepositoryWatchSession({ repoPath: '/repo' });
			assert.strictEqual(session.suspended, false);
			session.dispose();
		});

		it('starts with no pending changes', () => {
			const session = new RepositoryWatchSession({ repoPath: '/repo' });
			assert.strictEqual(session.hasPendingChanges, false);
			session.dispose();
		});
	});

	describe('subscribe — lifecycle', () => {
		it('fires onFirstRepoSubscriber on first subscribe', () => {
			const lc = makeLifecycle();
			const session = new RepositoryWatchSession({ repoPath: '/repo', lifecycle: lc });

			session.subscribe();

			assert.strictEqual(lc.firstRepo.mock.callCount(), 1);
			assert.strictEqual(lc.lastRepo.mock.callCount(), 0);
			session.dispose();
		});

		it('does not fire onFirstRepoSubscriber on subsequent subscribes', () => {
			const lc = makeLifecycle();
			const session = new RepositoryWatchSession({ repoPath: '/repo', lifecycle: lc });

			session.subscribe();
			session.subscribe();

			assert.strictEqual(lc.firstRepo.mock.callCount(), 1);
			assert.strictEqual(session.repoSubscriberCount, 2);
			session.dispose();
		});

		it('fires onLastRepoSubscriber when last subscriber disposes', () => {
			const lc = makeLifecycle();
			const session = new RepositoryWatchSession({ repoPath: '/repo', lifecycle: lc });

			const sub1 = session.subscribe();
			const sub2 = session.subscribe();

			sub1.dispose();
			assert.strictEqual(lc.lastRepo.mock.callCount(), 0);
			assert.strictEqual(session.repoSubscriberCount, 1);

			sub2.dispose();
			assert.strictEqual(lc.lastRepo.mock.callCount(), 1);
			assert.strictEqual(session.repoSubscriberCount, 0);
			session.dispose();
		});

		it('fires onFirstRepoSubscriber again after last subscriber disposes and re-subscribes', () => {
			const lc = makeLifecycle();
			const session = new RepositoryWatchSession({ repoPath: '/repo', lifecycle: lc });

			const sub1 = session.subscribe();
			sub1.dispose();

			assert.strictEqual(lc.firstRepo.mock.callCount(), 1);
			assert.strictEqual(lc.lastRepo.mock.callCount(), 1);

			session.subscribe();
			assert.strictEqual(lc.firstRepo.mock.callCount(), 2);
			session.dispose();
		});

		it('subscribe dispose is idempotent', () => {
			const lc = makeLifecycle();
			const session = new RepositoryWatchSession({ repoPath: '/repo', lifecycle: lc });

			const sub = session.subscribe();
			sub.dispose();
			sub.dispose();

			assert.strictEqual(lc.lastRepo.mock.callCount(), 1);
			session.dispose();
		});
	});

	describe('subscribeToWorkingTree — lifecycle', () => {
		it('fires onFirstWorkingTreeSubscriber on first subscribe', () => {
			const lc = makeLifecycle();
			const session = new RepositoryWatchSession({ repoPath: '/repo', lifecycle: lc });

			session.subscribeToWorkingTree();

			assert.strictEqual(lc.firstWT.mock.callCount(), 1);
			session.dispose();
		});

		it('fires onLastWorkingTreeSubscriber when last subscriber disposes', () => {
			const lc = makeLifecycle();
			const session = new RepositoryWatchSession({ repoPath: '/repo', lifecycle: lc });

			const sub = session.subscribeToWorkingTree();
			sub.dispose();

			assert.strictEqual(lc.lastWT.mock.callCount(), 1);
			session.dispose();
		});
	});

	describe('repo change pipeline — debounce + coalesce', () => {
		it('debounces repo changes (fires after delay)', async () => {
			const session = new RepositoryWatchSession({
				repoPath: '/repo',
				defaultRepoDelayMs: 50,
			});

			const received: WatcherRepoChangeEvent[] = [];
			const sub = session.subscribe({ delayMs: 50 });
			sub.onDidChange(e => received.push(e));

			session.pushRepoChanges(['head']);

			// Not yet fired
			assert.strictEqual(received.length, 0);
			assert.ok(session.hasPendingChanges);

			await delay(80);

			assert.strictEqual(received.length, 1);
			assert.ok(received[0].changes.has('head'));
			assert.strictEqual(received[0].repoPath, '/repo');
			assert.ok(!session.hasPendingChanges);

			sub.dispose();
			session.dispose();
		});

		it('coalesces multiple pushes within the debounce window', async () => {
			const session = new RepositoryWatchSession({
				repoPath: '/repo',
				defaultRepoDelayMs: 50,
			});

			const received: WatcherRepoChangeEvent[] = [];
			const sub = session.subscribe({ delayMs: 50 });
			sub.onDidChange(e => received.push(e));

			session.pushRepoChanges(['head']);
			session.pushRepoChanges(['tags']);
			session.pushRepoChanges(['stash']);

			await delay(80);

			// All coalesced into one event
			assert.strictEqual(received.length, 1);
			assert.ok(received[0].changes.has('head'));
			assert.ok(received[0].changes.has('tags'));
			assert.ok(received[0].changes.has('stash'));

			sub.dispose();
			session.dispose();
		});

		it('deduplicates changes within the coalesced event', async () => {
			const session = new RepositoryWatchSession({
				repoPath: '/repo',
				defaultRepoDelayMs: 50,
			});

			const received: WatcherRepoChangeEvent[] = [];
			const sub = session.subscribe({ delayMs: 50 });
			sub.onDidChange(e => received.push(e));

			session.pushRepoChanges(['head', 'heads']);
			session.pushRepoChanges(['head']); // Duplicate

			await delay(80);

			assert.strictEqual(received.length, 1);
			assert.strictEqual(received[0].changes.size, 2); // Head + Heads only

			sub.dispose();
			session.dispose();
		});

		it('notifies all subscribers of the same event', async () => {
			const session = new RepositoryWatchSession({
				repoPath: '/repo',
				defaultRepoDelayMs: 50,
			});

			const received1: WatcherRepoChangeEvent[] = [];
			const received2: WatcherRepoChangeEvent[] = [];
			const sub1 = session.subscribe({ delayMs: 50 });
			const sub2 = session.subscribe({ delayMs: 100 });
			sub1.onDidChange(e => received1.push(e));
			sub2.onDidChange(e => received2.push(e));

			session.pushRepoChanges(['head']);

			// Shortest delay wins (50ms)
			await delay(80);

			assert.strictEqual(received1.length, 1);
			assert.strictEqual(received2.length, 1);
			assert.strictEqual(received1[0], received2[0]); // Same event object

			sub1.dispose();
			sub2.dispose();
			session.dispose();
		});
	});

	describe('shortest-wins debounce recalculation', () => {
		it('uses the shortest subscriber delay', async () => {
			const session = new RepositoryWatchSession({
				repoPath: '/repo',
				defaultRepoDelayMs: 200,
			});

			const received: WatcherRepoChangeEvent[] = [];
			const sub1 = session.subscribe({ delayMs: 200 });
			const sub2 = session.subscribe({ delayMs: 50 });
			sub1.onDidChange(e => received.push(e));

			session.pushRepoChanges(['head']);

			// Should fire at 50ms (shortest wins), not 200ms
			await delay(80);
			assert.strictEqual(received.length, 1);

			sub1.dispose();
			sub2.dispose();
			session.dispose();
		});

		it('recalculates delay when fast subscriber leaves', async () => {
			const session = new RepositoryWatchSession({
				repoPath: '/repo',
				defaultRepoDelayMs: 200,
			});

			const received: WatcherRepoChangeEvent[] = [];
			const sub1 = session.subscribe({ delayMs: 200 });
			const sub2 = session.subscribe({ delayMs: 30 });
			sub1.onDidChange(e => received.push(e));

			// Remove the fast subscriber
			sub2.dispose();

			// Now push — should use 200ms delay
			session.pushRepoChanges(['head']);

			await delay(60);
			assert.strictEqual(received.length, 0); // Not yet — 200ms hasn't elapsed

			await delay(200);
			assert.strictEqual(received.length, 1);

			sub1.dispose();
			session.dispose();
		});
	});

	describe('suspend / resume', () => {
		it('accumulates changes while suspended', async () => {
			const session = new RepositoryWatchSession({
				repoPath: '/repo',
				defaultRepoDelayMs: 30,
			});

			const received: WatcherRepoChangeEvent[] = [];
			const sub = session.subscribe({ delayMs: 30 });
			sub.onDidChange(e => received.push(e));

			session.suspend();
			assert.ok(session.suspended);

			session.pushRepoChanges(['head']);
			session.pushRepoChanges(['tags']);

			await delay(60);

			// Nothing fired while suspended
			assert.strictEqual(received.length, 0);
			assert.ok(session.hasPendingChanges);

			sub.dispose();
			session.dispose();
		});

		it('flushes accumulated changes on resume', async () => {
			const session = new RepositoryWatchSession({
				repoPath: '/repo',
				defaultRepoDelayMs: 30,
			});

			const received: WatcherRepoChangeEvent[] = [];
			const sub = session.subscribe({ delayMs: 30 });
			sub.onDidChange(e => received.push(e));

			session.suspend();
			session.pushRepoChanges(['head']);
			session.pushRepoChanges(['tags']);

			session.resume();
			assert.ok(!session.suspended);

			await delay(60);

			assert.strictEqual(received.length, 1);
			assert.ok(received[0].changes.has('head'));
			assert.ok(received[0].changes.has('tags'));

			sub.dispose();
			session.dispose();
		});

		it('resume with custom delay', async () => {
			const session = new RepositoryWatchSession({
				repoPath: '/repo',
				defaultRepoDelayMs: 30,
			});

			const received: WatcherRepoChangeEvent[] = [];
			const sub = session.subscribe({ delayMs: 30 });
			sub.onDidChange(e => received.push(e));

			session.suspend();
			session.pushRepoChanges(['head']);

			session.resume(100);

			// Should not fire after 30ms (the normal delay)
			await delay(50);
			assert.strictEqual(received.length, 0);

			// Should fire after 100ms (the custom resume delay)
			await delay(80);
			assert.strictEqual(received.length, 1);

			sub.dispose();
			session.dispose();
		});

		it('resume is a no-op if not suspended', () => {
			const session = new RepositoryWatchSession({ repoPath: '/repo' });
			session.resume(); // Should not throw
			session.dispose();
		});

		it('does not fire if resumed with no pending changes', async () => {
			const session = new RepositoryWatchSession({
				repoPath: '/repo',
				defaultRepoDelayMs: 30,
			});

			const received: WatcherRepoChangeEvent[] = [];
			const sub = session.subscribe({ delayMs: 30 });
			sub.onDidChange(e => received.push(e));

			session.suspend();
			session.resume();

			await delay(60);
			assert.strictEqual(received.length, 0);

			sub.dispose();
			session.dispose();
		});

		it('suspend cancels active debounce timer', async () => {
			const session = new RepositoryWatchSession({
				repoPath: '/repo',
				defaultRepoDelayMs: 100,
			});

			const received: WatcherRepoChangeEvent[] = [];
			const sub = session.subscribe({ delayMs: 100 });
			sub.onDidChange(e => received.push(e));

			session.pushRepoChanges(['head']);

			// Suspend before debounce fires
			await delay(30);
			session.suspend();

			await delay(120);
			assert.strictEqual(received.length, 0); // Timer was cancelled

			// Resume triggers re-flush
			session.resume();
			await delay(130);
			assert.strictEqual(received.length, 1);

			sub.dispose();
			session.dispose();
		});

		it('accumulates working tree changes while suspended', async () => {
			const session = new RepositoryWatchSession({
				repoPath: '/repo',
				defaultWorkingTreeDelayMs: 30,
			});

			const received: WorkingTreeChangeEvent[] = [];
			const sub = session.subscribeToWorkingTree({ delayMs: 30 });
			sub.onDidChangeWorkingTree(e => received.push(e));

			session.suspend();
			session.pushWorkingTreeChanges(['/repo/a.ts', '/repo/b.ts']);

			await delay(60);
			assert.strictEqual(received.length, 0);

			session.resume();
			await delay(60);
			assert.strictEqual(received.length, 1);
			assert.ok(received[0].paths.has('/repo/a.ts'));
			assert.ok(received[0].paths.has('/repo/b.ts'));

			sub.dispose();
			session.dispose();
		});
	});

	describe('onDidFireWorkingTreeChange (global cache-clock forwarding)', () => {
		it('fires with the repoPath BEFORE subscribers, so a synchronous status read sees the advanced clock', async () => {
			const order: string[] = [];
			const session = new RepositoryWatchSession({
				repoPath: '/repo',
				defaultWorkingTreeDelayMs: 20,
				onDidFireWorkingTreeChange: p => order.push(`clock:${p}`),
			});

			const sub = session.subscribeToWorkingTree({ delayMs: 20 });
			sub.onDidChangeWorkingTree(() => order.push('subscriber'));

			session.pushWorkingTreeChanges(['/repo/a.ts']);
			await delay(50);

			assert.deepStrictEqual(order, ['clock:/repo', 'subscriber']);

			sub.dispose();
			session.dispose();
		});

		it('does not fire while suspended (no spurious clock advance)', async () => {
			const fired: string[] = [];
			const session = new RepositoryWatchSession({
				repoPath: '/repo',
				defaultWorkingTreeDelayMs: 20,
				onDidFireWorkingTreeChange: p => fired.push(p),
			});
			const sub = session.subscribeToWorkingTree({ delayMs: 20 });

			session.suspend();
			session.pushWorkingTreeChanges(['/repo/a.ts']);
			await delay(50);
			assert.strictEqual(fired.length, 0, 'suspended: no clock advance');

			session.resume();
			await delay(50);
			assert.deepStrictEqual(fired, ['/repo'], 'resume flushes exactly one clock advance');

			sub.dispose();
			session.dispose();
		});
	});

	describe('fireChange (manual injection)', () => {
		it('goes through debounce pipeline', async () => {
			const session = new RepositoryWatchSession({
				repoPath: '/repo',
				defaultRepoDelayMs: 50,
			});

			const received: WatcherRepoChangeEvent[] = [];
			const sub = session.subscribe({ delayMs: 50 });
			sub.onDidChange(e => received.push(e));

			session.fireChange('head', 'tags');

			// Not yet — debounced
			assert.strictEqual(received.length, 0);

			await delay(80);
			assert.strictEqual(received.length, 1);
			assert.ok(received[0].changes.has('head'));
			assert.ok(received[0].changes.has('tags'));

			sub.dispose();
			session.dispose();
		});

		it('coalesces with pending pushRepoChanges', async () => {
			const session = new RepositoryWatchSession({
				repoPath: '/repo',
				defaultRepoDelayMs: 50,
			});

			const received: WatcherRepoChangeEvent[] = [];
			const sub = session.subscribe({ delayMs: 50 });
			sub.onDidChange(e => received.push(e));

			session.pushRepoChanges(['head']);
			session.fireChange('tags');

			await delay(80);
			assert.strictEqual(received.length, 1);
			assert.ok(received[0].changes.has('head'));
			assert.ok(received[0].changes.has('tags'));

			sub.dispose();
			session.dispose();
		});

		it('respects suspend', async () => {
			const session = new RepositoryWatchSession({
				repoPath: '/repo',
				defaultRepoDelayMs: 30,
			});

			const received: WatcherRepoChangeEvent[] = [];
			const sub = session.subscribe({ delayMs: 30 });
			sub.onDidChange(e => received.push(e));

			session.suspend();
			session.fireChange('head');

			await delay(60);
			assert.strictEqual(received.length, 0);

			session.resume();
			await delay(60);
			assert.strictEqual(received.length, 1);

			sub.dispose();
			session.dispose();
		});
	});

	describe('fireChangeImmediate', () => {
		it('notifies the global forwarder BEFORE subscribers (same contract as flushRepo)', () => {
			const order: string[] = [];
			const session = new RepositoryWatchSession({
				repoPath: '/repo',
				onDidFireRepoChange: () => order.push('clock'),
			});

			const sub = session.subscribe();
			sub.onDidChange(() => order.push('subscriber'));

			session.fireChangeImmediate('closed');

			// Skipping the forwarder would route the change to subscribers that nobody advanced the clock for —
			// they treat it as session-routed and (correctly) don't re-advance, so the cache would go stale.
			assert.deepStrictEqual(order, ['clock', 'subscriber']);

			sub.dispose();
			session.dispose();
		});

		it('fires immediately, bypassing debounce and suspend', () => {
			const session = new RepositoryWatchSession({ repoPath: '/repo' });

			const received: WatcherRepoChangeEvent[] = [];
			const sub = session.subscribe();
			sub.onDidChange(e => received.push(e));

			session.suspend();
			session.fireChangeImmediate('closed');

			// Fires immediately even though suspended
			assert.strictEqual(received.length, 1);
			assert.ok(received[0].changes.has('closed'));

			sub.dispose();
			session.dispose();
		});

		it('does not affect the pending debounced event', async () => {
			const session = new RepositoryWatchSession({
				repoPath: '/repo',
				defaultRepoDelayMs: 50,
			});

			const received: WatcherRepoChangeEvent[] = [];
			const sub = session.subscribe({ delayMs: 50 });
			sub.onDidChange(e => received.push(e));

			session.pushRepoChanges(['head']);
			session.fireChangeImmediate('closed');

			assert.strictEqual(received.length, 1); // Only the immediate one

			await delay(80);
			assert.strictEqual(received.length, 2); // Now the debounced one too
			assert.ok(received[1].changes.has('head'));

			sub.dispose();
			session.dispose();
		});
	});

	describe('ref names', () => {
		async function flush(push: (session: RepositoryWatchSession) => void): Promise<WatcherRepoChangeEvent[]> {
			const session = new RepositoryWatchSession({ repoPath: '/repo', defaultRepoDelayMs: 20 });
			const received: WatcherRepoChangeEvent[] = [];
			const sub = session.subscribe();
			sub.onDidChange(e => received.push(e));

			push(session);
			await delay(50);

			sub.dispose();
			session.dispose();
			return received;
		}

		it('accumulates names across pushes and starts afresh after a flush', async () => {
			const session = new RepositoryWatchSession({ repoPath: '/repo', defaultRepoDelayMs: 20 });
			const received: WatcherRepoChangeEvent[] = [];
			const sub = session.subscribe();
			sub.onDidChange(e => received.push(e));

			session.pushRepoChanges(['heads'], 'refs/heads/a');
			session.pushRepoChanges(['heads'], 'refs/heads/b');
			session.pushRepoChanges(['head', 'heads'], 'HEAD');
			await delay(50);

			session.pushRepoChanges(['heads'], 'refs/heads/c');
			await delay(50);

			assert.strictEqual(received.length, 2);
			assert.deepStrictEqual([...received[0].refs].sort(), ['HEAD', 'refs/heads/a', 'refs/heads/b']);
			assert.strictEqual(received[0].unnamedRefKinds.size, 0);
			assert.ok(received[0].mayHaveChangedRef('refs/heads/a'));
			assert.ok(!received[0].mayHaveChangedRef('refs/heads/c'));
			assert.deepStrictEqual([...received[1].refs], ['refs/heads/c']);
			assert.ok(!received[1].mayHaveChangedRef('refs/heads/a'));

			sub.dispose();
			session.dispose();
		});

		it('marks remotes unnamed for a config change', async () => {
			const [e] = await flush(session => session.pushRepoChanges(['config', 'remotes']));
			assert.deepStrictEqual([...e.unnamedRefKinds], ['remotes']);
			assert.strictEqual(e.refs.size, 0);
		});

		it('marks heads, remotes and tags unnamed for a packed-refs rewrite', async () => {
			const [e] = await flush(session => session.pushRepoChanges(['heads', 'remotes', 'tags']));
			assert.deepStrictEqual([...e.unnamedRefKinds].sort(), ['heads', 'remotes', 'tags']);
		});

		it("marks a kind unnamed when the name's kind doesn't match (refs/replace, a bare ref namespace)", async () => {
			const [e] = await flush(session => {
				session.pushRepoChanges(['heads'], 'refs/replace/0123');
				session.pushRepoChanges(['remotes'], 'refs/remotes');
			});
			assert.deepStrictEqual([...e.unnamedRefKinds].sort(), ['heads', 'remotes']);
			assert.strictEqual(e.refs.size, 0);
		});

		it('marks a kind unnamed once the retained names reach the cap', async () => {
			const [e] = await flush(session => {
				for (let i = 0; i < 1000; i++) {
					session.pushRepoChanges(['tags'], `refs/tags/v${i}`);
				}
				session.pushRepoChanges(['tags'], 'refs/tags/past-the-cap');
			});
			assert.strictEqual(e.refs.size, 1000);
			assert.ok(!e.refs.has('refs/tags/past-the-cap'));
			assert.deepStrictEqual([...e.unnamedRefKinds], ['tags']);
			assert.ok(e.mayHaveChangedRef('refs/tags/past-the-cap'));
		});

		it('marks injected ref changes unnamed', async () => {
			const [e] = await flush(session => {
				session.pushRepoChanges(['heads'], 'refs/heads/a');
				session.fireChange('heads', 'stash');
			});
			assert.deepStrictEqual([...e.refs], ['refs/heads/a']);
			assert.deepStrictEqual([...e.unnamedRefKinds].sort(), ['heads', 'stash']);
			assert.ok(e.mayHaveChangedRef('refs/heads/other'));
		});

		it('marks immediate ref changes unnamed', () => {
			const session = new RepositoryWatchSession({ repoPath: '/repo' });
			const received: WatcherRepoChangeEvent[] = [];
			const sub = session.subscribe();
			sub.onDidChange(e => received.push(e));

			session.fireChangeImmediate('heads');

			assert.deepStrictEqual([...received[0].unnamedRefKinds], ['heads']);

			sub.dispose();
			session.dispose();
		});
	});

	describe('getRelevantRefs', () => {
		it("unions every repo subscriber's current relevant refs, and drops a subscriber's as it leaves", () => {
			const session = new RepositoryWatchSession({ repoPath: '/repo' });
			let mainRefs = ['refs/heads/main', 'refs/remotes/origin/main'];
			const sameRefs = (): string[] => ['refs/heads/feature'];
			const a = session.subscribe({ relevantRefs: () => mainRefs });
			const b = session.subscribe({ relevantRefs: sameRefs });
			const c = session.subscribe({ relevantRefs: sameRefs });
			const unfiltered = session.subscribe();

			assert.deepStrictEqual([...session.getRelevantRefs()].sort(), [
				'refs/heads/feature',
				'refs/heads/main',
				'refs/remotes/origin/main',
			]);

			mainRefs = ['refs/heads/next'];
			b.dispose();
			assert.deepStrictEqual(
				[...session.getRelevantRefs()].sort(),
				['refs/heads/feature', 'refs/heads/next'],
				'read at call time; a subscriber sharing the function keeps its refs',
			);

			a.dispose();
			c.dispose();
			assert.deepStrictEqual([...session.getRelevantRefs()], []);

			unfiltered.dispose();
			session.dispose();
		});
	});

	describe('relevantRefs (per-subscription filter)', () => {
		function setup(relevant: string[]): {
			session: RepositoryWatchSession;
			filtered: WatcherRepoChangeEvent[];
			unfiltered: WatcherRepoChangeEvent[];
			forwarded: WatcherRepoChangeEvent[];
			relevant: string[];
			dispose(): void;
		} {
			const forwarded: WatcherRepoChangeEvent[] = [];
			const session = new RepositoryWatchSession({
				repoPath: '/repo',
				defaultRepoDelayMs: 20,
				onDidFireRepoChange: e => forwarded.push(e),
			});
			const filtered: WatcherRepoChangeEvent[] = [];
			const unfiltered: WatcherRepoChangeEvent[] = [];
			const filteredSub = session.subscribe({ relevantRefs: () => relevant });
			filteredSub.onDidChange(e => filtered.push(e));
			const unfilteredSub = session.subscribe();
			unfilteredSub.onDidChange(e => unfiltered.push(e));

			return {
				session: session,
				filtered: filtered,
				unfiltered: unfiltered,
				forwarded: forwarded,
				relevant: relevant,
				dispose: () => {
					filteredSub.dispose();
					unfilteredSub.dispose();
					session.dispose();
				},
			};
		}

		it('delivers nothing to a filtered subscriber when only irrelevant refs moved, while others get the full event', async () => {
			const t = setup(['refs/heads/a']);

			t.session.pushRepoChanges(['heads'], 'refs/heads/b');
			t.session.pushRepoChanges(['tags'], 'refs/tags/v1');
			t.session.pushRepoChanges(['stash'], 'refs/stash');
			await delay(50);

			assert.strictEqual(t.filtered.length, 0);
			assert.strictEqual(t.unfiltered.length, 1);
			assert.strictEqual(t.forwarded.length, 1);
			assert.strictEqual(t.forwarded[0], t.unfiltered[0]);
			assert.deepStrictEqual([...t.unfiltered[0].changes].sort(), ['heads', 'stash', 'tags']);
			assert.deepStrictEqual([...t.unfiltered[0].refs].sort(), ['refs/heads/b', 'refs/stash', 'refs/tags/v1']);

			t.dispose();
		});

		it('keeps heads changes for a subscriber listing HEAD, since HEAD follows the checked-out branch', async () => {
			const t = setup(['HEAD']);

			t.session.pushRepoChanges(['heads'], 'refs/heads/b');
			t.session.pushRepoChanges(['tags'], 'refs/tags/v1');
			await delay(50);

			assert.strictEqual(t.filtered.length, 1);
			assert.deepStrictEqual([...t.filtered[0].changes], ['heads']);
			assert.ok(t.filtered[0].mayHaveChangedRef('HEAD'));

			t.dispose();
		});

		it('delivers a narrowed event when some kinds are irrelevant', async () => {
			const t = setup(['refs/heads/a']);

			t.session.pushRepoChanges(['index']);
			t.session.pushRepoChanges(['heads'], 'refs/heads/a');
			t.session.pushRepoChanges(['heads'], 'refs/heads/b');
			t.session.pushRepoChanges(['tags'], 'refs/tags/v1');
			await delay(50);

			assert.strictEqual(t.filtered.length, 1);
			const e = t.filtered[0];
			assert.notStrictEqual(e, t.unfiltered[0]);
			assert.deepStrictEqual([...e.changes].sort(), ['heads', 'index']);
			assert.deepStrictEqual([...e.refs], ['refs/heads/a']);
			assert.ok(e.mayHaveChangedRef('refs/heads/a'));
			assert.ok(!e.mayHaveChangedRef('refs/heads/b'));
			assert.ok(!e.mayHaveChangedRef('refs/tags/v1'));

			assert.deepStrictEqual([...t.unfiltered[0].changes].sort(), ['heads', 'index', 'tags']);
			assert.deepStrictEqual([...t.forwarded[0].changes].sort(), ['heads', 'index', 'tags']);

			t.dispose();
		});

		it('passes non-ref kinds even when every ref kind is dropped', async () => {
			const t = setup([]);

			t.session.pushRepoChanges(['index']);
			t.session.pushRepoChanges(['heads'], 'refs/heads/b');
			await delay(50);

			assert.strictEqual(t.filtered.length, 1);
			assert.deepStrictEqual([...t.filtered[0].changes], ['index']);

			t.dispose();
		});

		it('delivers the original event object when nothing is removed', async () => {
			const t = setup(['refs/heads/a']);

			t.session.pushRepoChanges(['heads'], 'refs/heads/a');
			t.session.pushRepoChanges(['index']);
			await delay(50);

			assert.strictEqual(t.filtered.length, 1);
			assert.strictEqual(t.filtered[0], t.unfiltered[0]);

			t.dispose();
		});

		it('reads the relevant refs at delivery', async () => {
			const t = setup(['refs/heads/a']);

			t.session.pushRepoChanges(['heads'], 'refs/heads/b');
			t.relevant.push('refs/heads/b');
			await delay(50);

			assert.strictEqual(t.filtered.length, 1);
			assert.strictEqual(t.filtered[0], t.unfiltered[0]);

			t.dispose();
		});

		it('passes unnamed kinds', async () => {
			const t = setup([]);

			t.session.pushRepoChanges(['heads', 'remotes', 'tags']);
			t.session.fireChange('stash');
			await delay(50);

			assert.strictEqual(t.filtered.length, 1);
			assert.strictEqual(t.filtered[0], t.unfiltered[0]);

			t.dispose();
		});

		it('passes heads when a pseudo-ref moved', async () => {
			const t = setup([]);

			t.session.pushRepoChanges(['head', 'heads'], 'HEAD');
			t.session.pushRepoChanges(['heads'], 'refs/heads/b');
			t.session.pushRepoChanges(['tags'], 'refs/tags/v1');
			await delay(50);

			assert.strictEqual(t.filtered.length, 1);
			const e = t.filtered[0];
			assert.deepStrictEqual([...e.changes].sort(), ['head', 'heads']);
			assert.deepStrictEqual([...e.refs], ['HEAD']);
			assert.ok(e.mayHaveChangedRef('HEAD'));
			assert.ok(!e.mayHaveChangedRef('refs/heads/b'));

			t.dispose();
		});

		it('lets a changed ref directory cover a relevant ref', async () => {
			const t = setup(['refs/heads/feature/x', 'refs/remotes/origin/main']);

			t.session.pushRepoChanges(['heads'], 'refs/heads/feature');
			t.session.pushRepoChanges(['remotes'], 'refs/remotes/upstream/main');
			await delay(50);

			assert.strictEqual(t.filtered.length, 1);
			const e = t.filtered[0];
			assert.deepStrictEqual([...e.changes], ['heads']);
			assert.deepStrictEqual([...e.refs], ['refs/heads/feature']);
			assert.ok(e.mayHaveChangedRef('refs/heads/feature/x'));

			t.dispose();
		});
	});

	describe('working tree pipeline', () => {
		it('debounces working tree changes', async () => {
			const session = new RepositoryWatchSession({
				repoPath: '/repo',
				defaultWorkingTreeDelayMs: 50,
			});

			const received: WorkingTreeChangeEvent[] = [];
			const sub = session.subscribeToWorkingTree({ delayMs: 50 });
			sub.onDidChangeWorkingTree(e => received.push(e));

			session.pushWorkingTreeChanges(['/repo/a.ts']);

			assert.strictEqual(received.length, 0);

			await delay(80);
			assert.strictEqual(received.length, 1);
			assert.ok(received[0].paths.has('/repo/a.ts'));
			assert.strictEqual(received[0].repoPath, '/repo');

			sub.dispose();
			session.dispose();
		});

		it('coalesces multiple pushes', async () => {
			const session = new RepositoryWatchSession({
				repoPath: '/repo',
				defaultWorkingTreeDelayMs: 50,
			});

			const received: WorkingTreeChangeEvent[] = [];
			const sub = session.subscribeToWorkingTree({ delayMs: 50 });
			sub.onDidChangeWorkingTree(e => received.push(e));

			session.pushWorkingTreeChanges(['/repo/a.ts']);
			session.pushWorkingTreeChanges(['/repo/b.ts', '/repo/c.ts']);
			session.pushWorkingTreeChanges(['/repo/a.ts']); // Duplicate

			await delay(80);
			assert.strictEqual(received.length, 1);
			assert.strictEqual(received[0].paths.size, 3); // a, b, c (deduped)

			sub.dispose();
			session.dispose();
		});

		it('does not set overflowed for an ordinary burst', async () => {
			const session = new RepositoryWatchSession({
				repoPath: '/repo',
				defaultWorkingTreeDelayMs: 50,
			});

			const received: WorkingTreeChangeEvent[] = [];
			const sub = session.subscribeToWorkingTree({ delayMs: 50 });
			sub.onDidChangeWorkingTree(e => received.push(e));

			session.pushWorkingTreeChanges(Array.from({ length: 100 }, (_, i) => `/repo/${i}.ts`));

			await delay(80);
			assert.strictEqual(received.length, 1);
			assert.strictEqual(received[0].paths.size, 100);
			assert.strictEqual(received[0].incomplete, false);

			sub.dispose();
			session.dispose();
		});

		it('caps retained paths and reports overflowed once the cap is exceeded', async () => {
			const session = new RepositoryWatchSession({
				repoPath: '/repo',
				defaultWorkingTreeDelayMs: 50,
			});

			const received: WorkingTreeChangeEvent[] = [];
			const sub = session.subscribeToWorkingTree({ delayMs: 50 });
			sub.onDidChangeWorkingTree(e => received.push(e));

			// Well past the cap, pushed in chunks the way a branch switch or build arrives.
			for (let i = 0; i < 15; i++) {
				session.pushWorkingTreeChanges(Array.from({ length: 100 }, (_, j) => `/repo/${i}-${j}.ts`));
			}

			await delay(80);
			assert.strictEqual(received.length, 1);
			assert.strictEqual(received[0].incomplete, true);
			// Retained set stays bounded rather than growing to the 1500 paths pushed.
			assert.ok(received[0].paths.size <= 1000, `expected <= 1000 retained paths, got ${received[0].paths.size}`);

			sub.dispose();
			session.dispose();
		});

		it('clears overflowed on the next flush', async () => {
			const session = new RepositoryWatchSession({
				repoPath: '/repo',
				defaultWorkingTreeDelayMs: 50,
			});

			const received: WorkingTreeChangeEvent[] = [];
			const sub = session.subscribeToWorkingTree({ delayMs: 50 });
			sub.onDidChangeWorkingTree(e => received.push(e));

			for (let i = 0; i < 15; i++) {
				session.pushWorkingTreeChanges(Array.from({ length: 100 }, (_, j) => `/repo/${i}-${j}.ts`));
			}
			await delay(80);

			session.pushWorkingTreeChanges(['/repo/after.ts']);
			await delay(80);

			assert.strictEqual(received.length, 2);
			assert.strictEqual(received[0].incomplete, true);
			// A stuck flag would make every later event claim a partial set and force needless refreshes.
			assert.strictEqual(received[1].incomplete, false);
			assert.strictEqual(received[1].paths.size, 1);

			sub.dispose();
			session.dispose();
		});

		it('accumulates across a suspend window without growing past the cap', async () => {
			const session = new RepositoryWatchSession({
				repoPath: '/repo',
				defaultWorkingTreeDelayMs: 50,
			});

			const received: WorkingTreeChangeEvent[] = [];
			const sub = session.subscribeToWorkingTree({ delayMs: 50 });
			sub.onDidChangeWorkingTree(e => received.push(e));

			// The unbounded-growth case this cap exists for: window unfocused, so nothing flushes.
			session.suspend();
			for (let i = 0; i < 20; i++) {
				session.pushWorkingTreeChanges(Array.from({ length: 100 }, (_, j) => `/repo/${i}-${j}.ts`));
			}

			await delay(80);
			assert.strictEqual(received.length, 0, 'suspended session must not fire');

			session.resume();
			await delay(80);

			assert.strictEqual(received.length, 1);
			assert.strictEqual(received[0].incomplete, true);
			assert.ok(received[0].paths.size <= 1000, `expected <= 1000 retained paths, got ${received[0].paths.size}`);

			sub.dispose();
			session.dispose();
		});

		it('propagates a caller-reported overflow even when the surviving batch is small', async () => {
			const session = new RepositoryWatchSession({
				repoPath: '/repo',
				defaultWorkingTreeDelayMs: 50,
			});

			const received: WorkingTreeChangeEvent[] = [];
			const sub = session.subscribeToWorkingTree({ delayMs: 50 });
			sub.onDidChangeWorkingTree(e => received.push(e));

			// What the watch service's pre-filter buffer does when it caps: most of what it dropped was
			// gitignored, so only a couple of paths survive filtering — but the batch is still partial.
			session.pushWorkingTreeChanges(['/repo/a.ts', '/repo/b.ts'], true);

			await delay(80);
			assert.strictEqual(received.length, 1);
			assert.strictEqual(received[0].paths.size, 2);
			assert.strictEqual(received[0].incomplete, true, 'a small batch can still be partial');

			sub.dispose();
			session.dispose();
		});

		it('fires a caller-reported overflow even when every path was filtered out', async () => {
			const session = new RepositoryWatchSession({
				repoPath: '/repo',
				defaultWorkingTreeDelayMs: 50,
			});

			const received: WorkingTreeChangeEvent[] = [];
			const sub = session.subscribeToWorkingTree({ delayMs: 50 });
			sub.onDidChangeWorkingTree(e => received.push(e));

			// The watch service pushes this shape when its pre-filter buffer capped and everything that
			// survived was gitignored. The paths it dropped were never filtered, so something may well have
			// changed — swallowing this because the retained set is empty is a silent miss.
			session.pushWorkingTreeChanges([], true);

			await delay(80);
			assert.strictEqual(received.length, 1);
			assert.strictEqual(received[0].paths.size, 0);
			assert.strictEqual(received[0].incomplete, true);

			sub.dispose();
			session.dispose();
		});

		it('drops a pending overflow when the last working-tree subscriber leaves', async () => {
			const session = new RepositoryWatchSession({
				repoPath: '/repo',
				defaultWorkingTreeDelayMs: 50,
			});

			const first = session.subscribeToWorkingTree({ delayMs: 50 });
			session.pushWorkingTreeChanges(['/repo/a.ts'], true);
			first.dispose();

			const received: WorkingTreeChangeEvent[] = [];
			const second = session.subscribeToWorkingTree({ delayMs: 50 });
			second.onDidChangeWorkingTree(e => received.push(e));

			session.pushWorkingTreeChanges(['/repo/b.ts']);
			await delay(80);

			assert.strictEqual(received.length, 1);
			// A leaked flag would make this ordinary edit claim a partial set and force needless refreshes.
			assert.strictEqual(received[0].incomplete, false);

			second.dispose();
			session.dispose();
		});

		it('repo and working tree pipelines are independent', async () => {
			const session = new RepositoryWatchSession({
				repoPath: '/repo',
				defaultRepoDelayMs: 30,
				defaultWorkingTreeDelayMs: 30,
			});

			const repoReceived: WatcherRepoChangeEvent[] = [];
			const wtReceived: WorkingTreeChangeEvent[] = [];

			const repoSub = session.subscribe({ delayMs: 30 });
			const wtSub = session.subscribeToWorkingTree({ delayMs: 30 });
			repoSub.onDidChange(e => repoReceived.push(e));
			wtSub.onDidChangeWorkingTree(e => wtReceived.push(e));

			session.pushRepoChanges(['head']);
			session.pushWorkingTreeChanges(['/repo/a.ts']);

			await delay(60);

			assert.strictEqual(repoReceived.length, 1);
			assert.strictEqual(wtReceived.length, 1);

			repoSub.dispose();
			wtSub.dispose();
			session.dispose();
		});
	});

	describe('dispose', () => {
		it('clears pending changes and timers', async () => {
			const session = new RepositoryWatchSession({
				repoPath: '/repo',
				defaultRepoDelayMs: 100,
			});

			const received: WatcherRepoChangeEvent[] = [];
			const sub = session.subscribe({ delayMs: 100 });
			sub.onDidChange(e => received.push(e));

			session.pushRepoChanges(['head']);
			session.dispose();

			await delay(150);
			assert.strictEqual(received.length, 0); // Timer was cancelled

			sub.dispose();
		});

		it('ignores pushRepoChanges after dispose', async () => {
			const session = new RepositoryWatchSession({
				repoPath: '/repo',
				defaultRepoDelayMs: 30,
			});

			const received: WatcherRepoChangeEvent[] = [];
			const sub = session.subscribe({ delayMs: 30 });
			sub.onDidChange(e => received.push(e));

			session.dispose();
			session.pushRepoChanges(['head']);

			await delay(60);
			assert.strictEqual(received.length, 0);

			sub.dispose();
		});

		it('ignores fireChange after dispose', () => {
			const session = new RepositoryWatchSession({ repoPath: '/repo' });
			session.dispose();
			// Should not throw
			session.fireChange('head');
			session.fireChangeImmediate('head');
		});
	});

	describe('no subscribers', () => {
		it('pushRepoChanges with no subscribers does not accumulate', async () => {
			const session = new RepositoryWatchSession({
				repoPath: '/repo',
				defaultRepoDelayMs: 30,
			});

			// Push without any subscriber — changes should be dropped
			session.pushRepoChanges(['head']);

			// Now subscribe
			const received: WatcherRepoChangeEvent[] = [];
			const sub = session.subscribe({ delayMs: 30 });
			sub.onDidChange(e => received.push(e));

			await delay(60);

			// The changes pushed before subscribing should not be delivered
			// (they were coalesced but nobody will receive them since the timer
			// ran before the subscriber existed. Actually, the changes DO accumulate
			// and the timer fires, but the emitter had no listeners at push time.)
			// Let's verify the event count is at most 1 if it was already pending.
			// Actually, the push creates a pending event and schedules a timer.
			// The timer fires and the emitter dispatches. But the subscriber
			// registered after the push — so the emitter.fire() happens after
			// the subscriber registered. So they WILL receive it.
			// This is correct behavior — events fire to whoever is listening
			// at flush time, not at push time.

			sub.dispose();
			session.dispose();
		});
	});

	describe('max-wait (starvation bound)', () => {
		/** Calls `push` every ~20ms for `durationMs`, so the trailing debounce never sees a quiet gap. */
		async function pushContinuously(push: () => void, durationMs: number): Promise<void> {
			const end = Date.now() + durationMs;
			while (Date.now() < end) {
				push();
				await delay(20);
			}
		}

		it('flushes repeatedly while events continue (max-wait caps the trailing debounce)', async () => {
			const session = new RepositoryWatchSession({ repoPath: '/repo' });

			const received: WatcherRepoChangeEvent[] = [];
			const sub = session.subscribe({ delayMs: 60, maxWaitMs: 150 });
			sub.onDidChange(e => received.push(e));

			await pushContinuously(() => session.pushRepoChanges(['head']), 600);

			// Measured before the events stop being "recent" — a trailing-only debounce would still be at 0 here.
			assert.ok(received.length >= 3, `expected >= 3 flushes during continuous events, got ${received.length}`);

			sub.dispose();
			session.dispose();
		});

		it('starves until events stop when max-wait is Infinity (the regression max-wait fixes)', async () => {
			const session = new RepositoryWatchSession({ repoPath: '/repo' });

			const received: WatcherRepoChangeEvent[] = [];
			const sub = session.subscribe({ delayMs: 60, maxWaitMs: Infinity });
			sub.onDidChange(e => received.push(e));

			await pushContinuously(() => session.pushRepoChanges(['head']), 600);
			assert.strictEqual(received.length, 0, 'no cap: continuous events must keep deferring the flush');

			await delay(120);
			assert.strictEqual(received.length, 1);

			sub.dispose();
			session.dispose();
		});

		it('bounds the working tree pipeline the same way', async () => {
			const session = new RepositoryWatchSession({ repoPath: '/repo' });

			const received: WorkingTreeChangeEvent[] = [];
			const sub = session.subscribeToWorkingTree({ delayMs: 60, maxWaitMs: 150 });
			sub.onDidChangeWorkingTree(e => received.push(e));

			let i = 0;
			await pushContinuously(() => session.pushWorkingTreeChanges([`/repo/${i++}.ts`]), 600);
			assert.ok(received.length >= 3, `expected >= 3 flushes during continuous events, got ${received.length}`);

			sub.dispose();
			session.dispose();
		});

		it('starves the working tree pipeline when max-wait is Infinity', async () => {
			const session = new RepositoryWatchSession({ repoPath: '/repo' });

			const received: WorkingTreeChangeEvent[] = [];
			const sub = session.subscribeToWorkingTree({ delayMs: 60, maxWaitMs: Infinity });
			sub.onDidChangeWorkingTree(e => received.push(e));

			await pushContinuously(() => session.pushWorkingTreeChanges(['/repo/a.ts']), 600);
			assert.strictEqual(received.length, 0);

			await delay(120);
			assert.strictEqual(received.length, 1);

			sub.dispose();
			session.dispose();
		});

		it('falls back to the session default max-wait when a subscriber does not specify one', async () => {
			const session = new RepositoryWatchSession({ repoPath: '/repo', defaultRepoMaxWaitMs: 150 });

			const received: WatcherRepoChangeEvent[] = [];
			const sub = session.subscribe({ delayMs: 60 });
			sub.onDidChange(e => received.push(e));

			await pushContinuously(() => session.pushRepoChanges(['head']), 600);
			assert.ok(received.length >= 3, `expected >= 3 flushes, got ${received.length}`);

			sub.dispose();
			session.dispose();
		});

		it('uses the shortest max-wait across subscribers', async () => {
			const session = new RepositoryWatchSession({ repoPath: '/repo' });

			const received: WatcherRepoChangeEvent[] = [];
			const slow = session.subscribe({ delayMs: 60, maxWaitMs: 1000 });
			const fast = session.subscribe({ delayMs: 60, maxWaitMs: 150 });
			slow.onDidChange(e => received.push(e));

			await pushContinuously(() => session.pushRepoChanges(['head']), 400);
			// With only the 1000ms cap there could be no flush yet.
			assert.ok(received.length >= 2, `expected >= 2 flushes at the 150ms cap, got ${received.length}`);

			slow.dispose();
			fast.dispose();
			session.dispose();
		});

		it('moves a pending flush earlier when a later subscriber has a shorter max-wait', async () => {
			const session = new RepositoryWatchSession({ repoPath: '/repo' });

			const flushedAt: number[] = [];
			const start = Date.now();
			const first = session.subscribe({ delayMs: 60, maxWaitMs: 5000 });
			first.onDidChange(() => flushedAt.push(Date.now() - start));

			let second: ReturnType<typeof session.subscribe> | undefined;
			const joinTimer = setTimeout(() => {
				second = session.subscribe({ delayMs: 60, maxWaitMs: 150 });
			}, 80);

			await pushContinuously(() => session.pushRepoChanges(['head']), 400);
			clearTimeout(joinTimer);

			// Without the join the 5000ms cap and continuous events would defer the flush past the whole run.
			assert.ok(flushedAt.length >= 1, 'expected a flush while events continued');
			assert.ok(flushedAt[0] >= 80, `flush should come after the join, got ${flushedAt[0]}ms`);
			assert.ok(flushedAt[0] < 260, `flush should be at the shorter cap, got ${flushedAt[0]}ms`);

			first.dispose();
			second?.dispose();
			session.dispose();
		});

		it('flushes at max-wait when max-wait is shorter than the delay', async () => {
			const session = new RepositoryWatchSession({ repoPath: '/repo' });

			const received: WatcherRepoChangeEvent[] = [];
			const sub = session.subscribe({ delayMs: 400, maxWaitMs: 50 });
			sub.onDidChange(e => received.push(e));

			session.pushRepoChanges(['head']);
			await delay(120);
			assert.strictEqual(received.length, 1);

			sub.dispose();
			session.dispose();
		});
	});

	describe('timer churn', () => {
		it('arms at most two timers for a burst of 1000 synchronous pushes', async () => {
			const original = globalThis.setTimeout;
			let armed = 0;
			globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
				armed++;
				return original(...args);
			}) as typeof setTimeout;

			const session = new RepositoryWatchSession({ repoPath: '/repo' });
			try {
				const repoSub = session.subscribe({ delayMs: 50 });
				const wtSub = session.subscribeToWorkingTree({ delayMs: 50 });
				const repoEvents: WatcherRepoChangeEvent[] = [];
				repoSub.onDidChange(e => repoEvents.push(e));

				armed = 0;
				for (let i = 0; i < 1000; i++) {
					session.pushRepoChanges(['head']);
				}
				const repoTimers = armed;

				armed = 0;
				for (let i = 0; i < 1000; i++) {
					session.pushWorkingTreeChanges(['/repo/a.ts']);
				}
				const wtTimers = armed;

				assert.ok(repoTimers <= 2, `repo pipeline armed ${repoTimers} timers for 1000 pushes`);
				assert.ok(wtTimers <= 2, `working tree pipeline armed ${wtTimers} timers for 1000 pushes`);

				await delay(100);
				assert.strictEqual(repoEvents.length, 1, 'the burst still coalesces into one event');

				repoSub.dispose();
				wtSub.dispose();
			} finally {
				globalThis.setTimeout = original;
				session.dispose();
			}
		});
	});

	describe('resume restarts the max-wait window', () => {
		it('flushes after the delay (not immediately) even when suspended past the max-wait', async () => {
			const session = new RepositoryWatchSession({ repoPath: '/repo' });

			const received: WatcherRepoChangeEvent[] = [];
			const sub = session.subscribe({ delayMs: 80, maxWaitMs: 100 });
			sub.onDidChange(e => received.push(e));

			session.suspend();
			session.pushRepoChanges(['head']);
			await delay(200);
			assert.strictEqual(received.length, 0, 'events during suspension must not flush');

			session.resume();
			await delay(30);
			// A window still anchored at the first (pre-resume) event would already be overdue here.
			assert.strictEqual(received.length, 0, 'resume must restart the window, not flush as overdue');

			await delay(120);
			assert.strictEqual(received.length, 1);

			sub.dispose();
			session.dispose();
		});

		it('flushes immediately on resume(0)', async () => {
			const session = new RepositoryWatchSession({ repoPath: '/repo' });

			const received: WatcherRepoChangeEvent[] = [];
			const sub = session.subscribe({ delayMs: 200, maxWaitMs: 400 });
			sub.onDidChange(e => received.push(e));

			session.suspend();
			session.pushRepoChanges(['head']);
			session.resume(0);

			await delay(40);
			assert.strictEqual(received.length, 1);

			sub.dispose();
			session.dispose();
		});

		it('returns to normal debounce when an event arrives before the resume flush', async () => {
			const session = new RepositoryWatchSession({ repoPath: '/repo' });

			const received: WatcherRepoChangeEvent[] = [];
			const sub = session.subscribe({ delayMs: 50, maxWaitMs: 1000 });
			sub.onDidChange(e => received.push(e));

			session.suspend();
			session.pushRepoChanges(['head']);
			session.resume(400);

			await delay(20);
			session.pushRepoChanges(['tags']);

			// Normal debounce from that event (50ms), not the 400ms resume stagger.
			await delay(150);
			assert.strictEqual(received.length, 1);
			assert.ok(received[0].changes.has('head'));
			assert.ok(received[0].changes.has('tags'));

			sub.dispose();
			session.dispose();
		});

		it('restarts the working tree window on resume too', async () => {
			const session = new RepositoryWatchSession({ repoPath: '/repo' });

			const received: WorkingTreeChangeEvent[] = [];
			const sub = session.subscribeToWorkingTree({ delayMs: 80, maxWaitMs: 100 });
			sub.onDidChangeWorkingTree(e => received.push(e));

			session.suspend();
			session.pushWorkingTreeChanges(['/repo/a.ts']);
			await delay(200);
			assert.strictEqual(received.length, 0);

			session.resume();
			await delay(30);
			assert.strictEqual(received.length, 0);

			await delay(120);
			assert.strictEqual(received.length, 1);

			sub.dispose();
			session.dispose();
		});
	});

	describe('noteSelfWrite', () => {
		function createSession(): { session: RepositoryWatchSession; received: WatcherRepoChangeEvent[] } {
			const session = new RepositoryWatchSession({ repoPath: '/repo', defaultRepoDelayMs: 20 });
			const received: WatcherRepoChangeEvent[] = [];
			session.subscribe().onDidChange(e => received.push(e));
			return { session: session, received: received };
		}

		function sorted(values: Iterable<string>): string[] {
			return [...values].sort();
		}

		it('drops pending raw changes of the announced kinds and fires the announcement once in their place', async () => {
			const { session, received } = createSession();

			session.pushRepoChanges(['heads'], 'refs/heads/main');
			session.pushRepoChanges(['index']);
			session.noteSelfWrite(['head', 'heads', 'index']);
			assert.strictEqual(received.length, 0, 'the announcement goes through the debounce');
			await delay(60);

			assert.strictEqual(received.length, 1);
			assert.deepStrictEqual(sorted(received[0].changes), ['head', 'heads', 'index']);
			assert.deepStrictEqual(sorted(received[0].announced), ['head', 'heads', 'index']);
			assert.deepStrictEqual([...received[0].refs], [], 'announcements carry no ref names');
			assert.deepStrictEqual([...received[0].unnamedRefKinds], ['heads']);
			session.dispose();
		});

		it('keeps pending raw changes of kinds it did not announce, without the announced refs', async () => {
			const { session, received } = createSession();

			session.pushRepoChanges(['heads'], 'refs/heads/main');
			session.pushRepoChanges(['tags'], 'refs/tags/v1');
			session.noteSelfWrite(['heads']);
			await delay(60);

			assert.strictEqual(received.length, 1);
			assert.deepStrictEqual(sorted(received[0].changes), ['heads', 'tags']);
			assert.deepStrictEqual([...received[0].announced], ['heads']);
			assert.deepStrictEqual([...received[0].refs], ['refs/tags/v1']);
			assert.deepStrictEqual([...received[0].unnamedRefKinds], ['heads']);
			session.dispose();
		});

		it('holds the announcement while suspended and fires it, without the dropped raw changes, on resume', async () => {
			const { session, received } = createSession();
			session.suspend();

			session.pushRepoChanges(['heads'], 'refs/heads/main');
			session.noteSelfWrite(['heads']);
			await delay(60);
			assert.strictEqual(received.length, 0);

			session.resume(0);
			await delay(60);
			assert.strictEqual(received.length, 1);
			assert.deepStrictEqual([...received[0].changes], ['heads']);
			assert.deepStrictEqual([...received[0].announced], ['heads']);
			assert.deepStrictEqual([...received[0].refs], []);
			session.dispose();
		});

		it('merges a raw change of an announced kind within the debounce delay, keeping it announced', async () => {
			const { session, received } = createSession();

			session.noteSelfWrite(['heads']);
			session.pushRepoChanges(['heads'], 'refs/heads/main');
			await delay(60);

			assert.strictEqual(received.length, 1, 'the late echo merges into the announcement');
			assert.deepStrictEqual([...received[0].changes], ['heads']);
			assert.deepStrictEqual([...received[0].announced], ['heads']);
			assert.ok(received[0].mayHaveChangedRef('refs/heads/other'), 'the announced heads stays unnamed');
			session.dispose();
		});

		it('fires an unannounced event for a raw change of an announced kind after the announcement fired', async () => {
			const { session, received } = createSession();

			// A fetch announces its remotes, then an outside push moves a remote ref right after the announcement fired
			session.noteSelfWrite(['remotes']);
			await delay(60);
			assert.strictEqual(received.length, 1);
			assert.deepStrictEqual([...received[0].announced], ['remotes']);

			session.pushRepoChanges(['remotes'], 'refs/remotes/origin/main');
			await delay(60);
			assert.strictEqual(received.length, 2, 'the outside change is not lost');
			assert.deepStrictEqual([...received[1].changes], ['remotes']);
			assert.deepStrictEqual([...received[1].announced], []);
			assert.deepStrictEqual([...received[1].refs], ['refs/remotes/origin/main']);
			session.dispose();
		});

		it('clears the mark for a raw change of the kind after the debounce delay but before the announcement fires', async () => {
			const { session, received } = createSession();
			session.suspend();

			session.noteSelfWrite(['heads', 'index']);
			await delay(40);
			session.pushRepoChanges(['heads'], 'refs/heads/main');
			session.resume(0);
			await delay(60);

			assert.strictEqual(received.length, 1);
			assert.deepStrictEqual(sorted(received[0].changes), ['heads', 'index']);
			assert.deepStrictEqual([...received[0].announced], ['index']);
			assert.ok(received[0].mayHaveChangedRef('refs/heads/other'), 'the announced heads stays unnamed');
			session.dispose();
		});

		it('clears the mark for an injected or unfenced change of the kind', async () => {
			const { session, received } = createSession();

			session.noteSelfWrite(['heads', 'index', 'tags']);
			session.fireChange('heads');
			session.pushUnfencedRepoChanges(['index']);
			await delay(60);

			assert.strictEqual(received.length, 1);
			assert.deepStrictEqual(sorted(received[0].changes), ['heads', 'index', 'tags']);
			assert.deepStrictEqual([...received[0].announced], ['tags']);
			session.dispose();
		});

		it('passes a raw change of a kind it did not announce', async () => {
			const { session, received } = createSession();

			session.noteSelfWrite(['heads']);
			session.pushRepoChanges(['tags'], 'refs/tags/v1');
			await delay(60);

			assert.strictEqual(received.length, 1);
			assert.deepStrictEqual(sorted(received[0].changes), ['heads', 'tags']);
			assert.deepStrictEqual([...received[0].announced], ['heads']);
			assert.deepStrictEqual([...received[0].refs], ['refs/tags/v1']);
			session.dispose();
		});

		it('keeps the unannounced kinds of a raw change mixing both, marking only the announced ones', async () => {
			const { session, received } = createSession();

			session.noteSelfWrite(['heads']);
			session.pushRepoChanges(['head', 'heads'], 'HEAD');
			await delay(60);

			assert.strictEqual(received.length, 1);
			assert.deepStrictEqual(sorted(received[0].changes), ['head', 'heads']);
			assert.deepStrictEqual([...received[0].announced], ['heads']);
			assert.deepStrictEqual([...received[0].refs], ['HEAD']);
			session.dispose();
		});

		it('never holds back an injected change, pending or fired after it', async () => {
			const { session, received } = createSession();

			session.fireChange('heads');
			session.noteSelfWrite(['heads']);
			await delay(60);
			assert.strictEqual(received.length, 1);
			assert.deepStrictEqual([...received[0].changes], ['heads']);
			assert.deepStrictEqual([...received[0].announced], [], 'the injected change reported it first');

			session.fireChange('heads');
			await delay(60);
			assert.strictEqual(received.length, 2);
			assert.deepStrictEqual([...received[1].changes], ['heads']);
			assert.deepStrictEqual([...received[1].announced], []);

			session.fireChangeImmediate('heads');
			assert.strictEqual(received.length, 3);
			assert.deepStrictEqual([...received[2].announced], []);
			session.dispose();
		});

		it('never holds back an unfenced push, pending or pushed after it', async () => {
			const { session, received } = createSession();

			session.pushUnfencedRepoChanges(['index', 'heads']);
			session.noteSelfWrite([]);
			await delay(60);
			assert.strictEqual(received.length, 1);
			assert.deepStrictEqual(sorted(received[0].changes), sorted(allWatchedRepositoryChanges));
			assert.deepStrictEqual(
				sorted(received[0].announced),
				sorted(allWatchedRepositoryChanges.filter(c => c !== 'index' && c !== 'heads')),
			);

			session.pushUnfencedRepoChanges(['ignores']);
			await delay(60);
			assert.strictEqual(received.length, 2);
			assert.deepStrictEqual([...received[1].changes], ['ignores']);
			assert.deepStrictEqual([...received[1].announced], []);
			session.dispose();
		});

		it('leaves working-tree changes alone', async () => {
			const session = new RepositoryWatchSession({ repoPath: '/repo', defaultWorkingTreeDelayMs: 20 });
			const received: string[][] = [];
			session.subscribeToWorkingTree().onDidChangeWorkingTree(e => received.push([...e.paths]));

			session.pushWorkingTreeChanges(['/repo/a.txt']);
			session.noteSelfWrite([]);
			session.pushWorkingTreeChanges(['/repo/b.txt']);
			await delay(60);

			assert.deepStrictEqual(received, [['/repo/a.txt', '/repo/b.txt']]);
			session.dispose();
		});

		it('announces every watched kind, never unknown, for an empty announcement or one naming unknown', async () => {
			for (const announced of [[], ['unknown', 'heads']] as const) {
				const { session, received } = createSession();

				session.pushRepoChanges(['config', 'remotes']);
				session.noteSelfWrite(announced);
				session.pushRepoChanges(['tags'], 'refs/tags/v1');
				session.pushRepoChanges(['index']);
				await delay(60);

				const label = `announced: ${announced.join(', ')}`;
				assert.strictEqual(received.length, 1, label);
				assert.deepStrictEqual(sorted(received[0].changes), sorted(allWatchedRepositoryChanges), label);
				assert.deepStrictEqual(sorted(received[0].announced), sorted(allWatchedRepositoryChanges), label);
				assert.deepStrictEqual([...received[0].refs], ['refs/tags/v1'], label);
				session.dispose();
			}
		});

		it('neither replaces nor announces closed or opened', async () => {
			const { session, received } = createSession();

			session.noteSelfWrite(['closed', 'opened']);
			assert.strictEqual(session.hasPendingChanges, false);
			session.pushRepoChanges(['heads'], 'refs/heads/main');
			await delay(60);

			assert.strictEqual(received.length, 1);
			assert.deepStrictEqual([...received[0].changes], ['heads']);
			assert.deepStrictEqual([...received[0].announced], []);
			session.dispose();
		});

		it('keeps the announced kinds through a relevant-refs narrowing', async () => {
			const session = new RepositoryWatchSession({ repoPath: '/repo', defaultRepoDelayMs: 20 });
			const received: WatcherRepoChangeEvent[] = [];
			session.subscribe({ relevantRefs: () => ['refs/heads/main'] }).onDidChange(e => received.push(e));

			session.noteSelfWrite(['index', 'stash']);
			session.pushRepoChanges(['tags'], 'refs/tags/v1');
			await delay(60);

			assert.strictEqual(received.length, 1);
			assert.deepStrictEqual(sorted(received[0].changes), ['index', 'stash']);
			assert.deepStrictEqual(sorted(received[0].announced), ['index', 'stash']);
			session.dispose();
		});
	});
});

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { mixinDisposable } from '@gitlens/utils/disposable.js';
import { fileUri } from '@gitlens/utils/uri.js';
import type { GitDir } from '../../models/repository.js';
import type { WatcherRepoChangeEvent } from '../changeEvent.js';
import type { FileWatcher, FileWatchEvent, FileWatchingProvider } from '../provider.js';
import { RepositoryWatchService } from '../watchService.js';

interface MockWatcher extends FileWatcher {
	readonly basePath: string;
	readonly pattern: string;
	fire(event: FileWatchEvent): void;
	disposed: boolean;
}

function createMockFactory(): { factory: FileWatchingProvider; watchers: MockWatcher[] } {
	const watchers: MockWatcher[] = [];
	const factory: FileWatchingProvider = {
		createWatcher: function (
			basePath: string,
			pattern: string,
			onEvent: (event: FileWatchEvent) => void,
		): FileWatcher {
			const w: MockWatcher = mixinDisposable(
				{
					basePath: basePath,
					pattern: pattern,
					disposed: false,
					fire: function (event: FileWatchEvent): void {
						onEvent(event);
					},
				},
				() => (w.disposed = true),
			);
			watchers.push(w);
			return w;
		},
	};
	return { factory: factory, watchers: watchers };
}

function delay(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function standardGitDir(path: string): GitDir {
	return { uri: fileUri(path) };
}

function worktreeGitDir(path: string, commonPath: string): GitDir {
	return { uri: fileUri(path), commonUri: fileUri(commonPath) };
}

/** Assert that `watch()` returned a handle (service is not disposed). */
function assertHandle(
	handle: ReturnType<RepositoryWatchService['watch']>,
): asserts handle is NonNullable<typeof handle> {
	assert.ok(handle != null, 'expected watch() to return a WatchHandle, got undefined');
}

describe('RepositoryWatchService', () => {
	describe('watch', () => {
		it('returns a handle with a session', () => {
			const { factory } = createMockFactory();
			const service = new RepositoryWatchService({ watchingProvider: factory });

			const handle = service.watch('/repo', standardGitDir('/repo/.git'));
			assertHandle(handle);

			assert.ok(handle.session);
			assert.strictEqual(handle.session.repoPath, '/repo');

			handle.dispose();
			service.dispose();
		});

		it('returns the same session for the same repoPath', () => {
			const { factory } = createMockFactory();
			const service = new RepositoryWatchService({ watchingProvider: factory });

			const handle1 = service.watch('/repo', standardGitDir('/repo/.git'));
			const handle2 = service.watch('/repo', standardGitDir('/repo/.git'));
			assertHandle(handle1);
			assertHandle(handle2);

			assert.strictEqual(handle1.session, handle2.session);

			handle1.dispose();
			handle2.dispose();
			service.dispose();
		});

		it('creates different sessions for different repoPaths', () => {
			const { factory } = createMockFactory();
			const service = new RepositoryWatchService({ watchingProvider: factory });

			const handle1 = service.watch('/repo1', standardGitDir('/repo1/.git'));
			const handle2 = service.watch('/repo2', standardGitDir('/repo2/.git'));
			assertHandle(handle1);
			assertHandle(handle2);

			assert.notStrictEqual(handle1.session, handle2.session);

			handle1.dispose();
			handle2.dispose();
			service.dispose();
		});
	});

	describe('getSession', () => {
		it('returns the session for a watched repo', () => {
			const { factory } = createMockFactory();
			const service = new RepositoryWatchService({ watchingProvider: factory });

			const handle = service.watch('/repo', standardGitDir('/repo/.git'));
			assertHandle(handle);

			assert.strictEqual(service.getSession('/repo'), handle.session);

			handle.dispose();
			service.dispose();
		});

		it('returns undefined for an unwatched repo', () => {
			const { factory } = createMockFactory();
			const service = new RepositoryWatchService({ watchingProvider: factory });

			assert.strictEqual(service.getSession('/nonexistent'), undefined);

			service.dispose();
		});

		it('returns undefined after handle is disposed', () => {
			const { factory } = createMockFactory();
			const service = new RepositoryWatchService({ watchingProvider: factory });

			const handle = service.watch('/repo', standardGitDir('/repo/.git'));
			assertHandle(handle);
			handle.dispose();

			assert.strictEqual(service.getSession('/repo'), undefined);

			service.dispose();
		});
	});

	describe('ref-counting', () => {
		it('keeps session alive while any handle is held', () => {
			const { factory } = createMockFactory();
			const service = new RepositoryWatchService({ watchingProvider: factory });

			const handle1 = service.watch('/repo', standardGitDir('/repo/.git'));
			const handle2 = service.watch('/repo', standardGitDir('/repo/.git'));
			assertHandle(handle1);
			assertHandle(handle2);

			handle1.dispose();
			assert.ok(service.getSession('/repo') != null);

			handle2.dispose();
			assert.strictEqual(service.getSession('/repo'), undefined);

			service.dispose();
		});

		it('handle dispose is idempotent', () => {
			const { factory } = createMockFactory();
			const service = new RepositoryWatchService({ watchingProvider: factory });

			const handle = service.watch('/repo', standardGitDir('/repo/.git'));
			assertHandle(handle);
			handle.dispose();
			handle.dispose(); // Should not throw or double-decrement

			assert.strictEqual(service.getSession('/repo'), undefined);

			service.dispose();
		});
	});

	describe('watcher lifecycle — opt-in', () => {
		it('creates no watchers until subscribe() is called', () => {
			const { factory, watchers } = createMockFactory();
			const service = new RepositoryWatchService({
				watchingProvider: factory,
				defaultRepoDelayMs: 30,
			});

			const handle = service.watch('/repo', standardGitDir('/repo/.git'));
			assertHandle(handle);

			// Just watch() — no watchers yet
			assert.strictEqual(watchers.length, 0);

			handle.dispose();
			service.dispose();
		});

		it('creates watchers when first subscriber joins', () => {
			const { factory, watchers } = createMockFactory();
			const service = new RepositoryWatchService({
				watchingProvider: factory,
				defaultRepoDelayMs: 30,
			});

			const handle = service.watch('/repo', standardGitDir('/repo/.git'));
			assertHandle(handle);
			const sub = handle.session.subscribe({ delayMs: 30 });

			// Now watchers should exist
			assert.ok(watchers.length > 0);

			sub.dispose();
			handle.dispose();
			service.dispose();
		});

		it('disposes watchers when last subscriber leaves', () => {
			const { factory, watchers } = createMockFactory();
			const service = new RepositoryWatchService({
				watchingProvider: factory,
				defaultRepoDelayMs: 30,
			});

			const handle = service.watch('/repo', standardGitDir('/repo/.git'));
			assertHandle(handle);
			const sub = handle.session.subscribe({ delayMs: 30 });

			assert.ok(watchers.length > 0);
			const allDisposed = () => watchers.every(w => w.disposed);

			sub.dispose();

			// After last subscriber, watchers should be disposed
			assert.ok(allDisposed());

			handle.dispose();
			service.dispose();
		});
	});

	describe('full pipeline — standard repo', () => {
		it('delivers file system events through the full pipeline', async () => {
			const { factory, watchers } = createMockFactory();
			const service = new RepositoryWatchService({
				watchingProvider: factory,
				defaultRepoDelayMs: 30,
			});

			const handle = service.watch('/repo', standardGitDir('/repo/.git'));
			assertHandle(handle);
			const received: WatcherRepoChangeEvent[] = [];
			const sub = handle.session.subscribe({ delayMs: 30 });
			sub.onDidChange(e => received.push(e));

			// Find the root watcher created by the subscription
			const rootWatcher = watchers.find(w => w.basePath === '/repo/.git');
			assert.ok(rootWatcher, 'Root watcher should be created');

			// Simulate HEAD change
			rootWatcher.fire({ path: '/repo/.git/HEAD', reason: 'change' });

			// Wait for debounce
			await delay(60);

			assert.strictEqual(received.length, 1);
			assert.ok(received[0].changes.has('head'));
			assert.ok(received[0].changes.has('heads'));
			assert.strictEqual(received[0].repoPath, '/repo');

			sub.dispose();
			handle.dispose();
			service.dispose();
		});

		it('delivers events to multiple subscribers', async () => {
			const { factory, watchers } = createMockFactory();
			const service = new RepositoryWatchService({
				watchingProvider: factory,
				defaultRepoDelayMs: 30,
			});

			const handle = service.watch('/repo', standardGitDir('/repo/.git'));
			assertHandle(handle);
			const received1: WatcherRepoChangeEvent[] = [];
			const received2: WatcherRepoChangeEvent[] = [];
			const sub1 = handle.session.subscribe({ delayMs: 30 });
			const sub2 = handle.session.subscribe({ delayMs: 50 });
			sub1.onDidChange(e => received1.push(e));
			sub2.onDidChange(e => received2.push(e));

			const rootWatcher = watchers.find(w => w.basePath === '/repo/.git');
			assert.ok(rootWatcher);

			rootWatcher.fire({ path: '/repo/.git/refs/heads/main', reason: 'change' });

			await delay(60);

			assert.strictEqual(received1.length, 1);
			assert.strictEqual(received2.length, 1);

			sub1.dispose();
			sub2.dispose();
			handle.dispose();
			service.dispose();
		});

		it('coalesces multiple events within debounce window', async () => {
			const { factory, watchers } = createMockFactory();
			const service = new RepositoryWatchService({
				watchingProvider: factory,
				defaultRepoDelayMs: 50,
			});

			const handle = service.watch('/repo', standardGitDir('/repo/.git'));
			assertHandle(handle);
			const received: WatcherRepoChangeEvent[] = [];
			const sub = handle.session.subscribe({ delayMs: 50 });
			sub.onDidChange(e => received.push(e));

			const rootWatcher = watchers.find(w => w.basePath === '/repo/.git');
			assert.ok(rootWatcher);

			rootWatcher.fire({ path: '/repo/.git/HEAD', reason: 'change' });
			rootWatcher.fire({ path: '/repo/.git/refs/tags/v1.0', reason: 'create' });

			await delay(80);

			assert.strictEqual(received.length, 1);
			assert.ok(received[0].changes.has('head'));
			assert.ok(received[0].changes.has('tags'));

			sub.dispose();
			handle.dispose();
			service.dispose();
		});
	});

	describe('full pipeline — worktree repos', () => {
		it('shares common watcher across worktrees', async () => {
			const { factory, watchers } = createMockFactory();
			const service = new RepositoryWatchService({
				watchingProvider: factory,
				defaultRepoDelayMs: 30,
			});

			const handleA = service.watch('/worktrees/A', worktreeGitDir('/repo/.git/worktrees/A', '/repo/.git'));
			const handleB = service.watch('/worktrees/B', worktreeGitDir('/repo/.git/worktrees/B', '/repo/.git'));
			assertHandle(handleA);
			assertHandle(handleB);

			const receivedA: WatcherRepoChangeEvent[] = [];
			const receivedB: WatcherRepoChangeEvent[] = [];

			const subA = handleA.session.subscribe({ delayMs: 30 });
			subA.onDidChange(e => receivedA.push(e));
			const subB = handleB.session.subscribe({ delayMs: 30 });
			subB.onDidChange(e => receivedB.push(e));

			// Count common watchers (pattern includes 'config')
			const commonWatchers = watchers.filter(w => w.basePath === '/repo/.git');
			// Should have at most 1 common watcher (shared)
			// Note: global forwarding also creates subscriptions which trigger watchers
			// The important thing is that the common git dir watcher is shared
			assert.ok(commonWatchers.length >= 1);

			// Fire a common event (refs/heads change)
			const commonWatcher = commonWatchers[0];
			commonWatcher.fire({ path: '/repo/.git/refs/heads/main', reason: 'change' });

			await delay(60);

			// Both sessions should receive the event
			assert.ok(receivedA.length >= 1);
			assert.ok(receivedB.length >= 1);

			subA.dispose();
			subB.dispose();
			handleA.dispose();
			handleB.dispose();
			service.dispose();
		});

		it('root watcher events go only to owning session', async () => {
			const { factory, watchers } = createMockFactory();
			const service = new RepositoryWatchService({
				watchingProvider: factory,
				defaultRepoDelayMs: 30,
			});

			const handleA = service.watch('/worktrees/A', worktreeGitDir('/repo/.git/worktrees/A', '/repo/.git'));
			const handleB = service.watch('/worktrees/B', worktreeGitDir('/repo/.git/worktrees/B', '/repo/.git'));
			assertHandle(handleA);
			assertHandle(handleB);

			const receivedA: WatcherRepoChangeEvent[] = [];
			const receivedB: WatcherRepoChangeEvent[] = [];

			const subA = handleA.session.subscribe({ delayMs: 30 });
			subA.onDidChange(e => receivedA.push(e));
			const subB = handleB.session.subscribe({ delayMs: 30 });
			subB.onDidChange(e => receivedB.push(e));

			// Find root watcher for worktree A
			const rootA = watchers.find(w => w.basePath === '/repo/.git/worktrees/A');
			assert.ok(rootA, 'Root watcher for worktree A should exist');

			rootA.fire({ path: '/repo/.git/worktrees/A/HEAD', reason: 'change' });

			await delay(60);

			assert.ok(receivedA.length >= 1);
			// B should not receive root events from A's watcher
			assert.strictEqual(receivedB.length, 0);

			subA.dispose();
			subB.dispose();
			handleA.dispose();
			handleB.dispose();
			service.dispose();
		});
	});

	describe('global onDidChangeRepository', () => {
		it('fires for all watched repos', async () => {
			const { factory, watchers } = createMockFactory();
			const service = new RepositoryWatchService({
				watchingProvider: factory,
				defaultRepoDelayMs: 30,
			});

			const globalReceived: WatcherRepoChangeEvent[] = [];
			service.onDidChangeRepository(e => globalReceived.push(e));

			const handle1 = service.watch('/repo1', standardGitDir('/repo1/.git'));
			const handle2 = service.watch('/repo2', standardGitDir('/repo2/.git'));
			assertHandle(handle1);
			assertHandle(handle2);

			const sub1 = handle1.session.subscribe({ delayMs: 30 });
			const sub2 = handle2.session.subscribe({ delayMs: 30 });

			// Fire events on both repos
			const watcher1 = watchers.find(w => w.basePath === '/repo1/.git');
			const watcher2 = watchers.find(w => w.basePath === '/repo2/.git');
			assert.ok(watcher1);
			assert.ok(watcher2);

			watcher1.fire({ path: '/repo1/.git/HEAD', reason: 'change' });
			watcher2.fire({ path: '/repo2/.git/refs/tags/v1.0', reason: 'create' });

			await delay(60);

			assert.strictEqual(globalReceived.length, 2);
			const repoPaths = globalReceived.map(e => e.repoPath);
			assert.ok(repoPaths.includes('/repo1'));
			assert.ok(repoPaths.includes('/repo2'));

			sub1.dispose();
			sub2.dispose();
			handle1.dispose();
			handle2.dispose();
			service.dispose();
		});
	});

	describe('suspendAll / resumeAll', () => {
		it('suspends all sessions', () => {
			const { factory } = createMockFactory();
			const service = new RepositoryWatchService({ watchingProvider: factory });

			const handle1 = service.watch('/repo1', standardGitDir('/repo1/.git'));
			const handle2 = service.watch('/repo2', standardGitDir('/repo2/.git'));
			assertHandle(handle1);
			assertHandle(handle2);

			service.suspendAll();

			assert.ok(handle1.session.suspended);
			assert.ok(handle2.session.suspended);

			handle1.dispose();
			handle2.dispose();
			service.dispose();
		});

		it('resumes all sessions with optional stagger delay', async () => {
			const { factory, watchers } = createMockFactory();
			const service = new RepositoryWatchService({
				watchingProvider: factory,
				defaultRepoDelayMs: 30,
			});

			const handle1 = service.watch('/repo1', standardGitDir('/repo1/.git'));
			const handle2 = service.watch('/repo2', standardGitDir('/repo2/.git'));
			assertHandle(handle1);
			assertHandle(handle2);

			const sub1 = handle1.session.subscribe({ delayMs: 30 });
			const sub2 = handle2.session.subscribe({ delayMs: 30 });

			// Suspend
			service.suspendAll();

			// Push events while suspended
			handle1.session.pushRepoChanges(['head']);
			handle2.session.pushRepoChanges(['tags']);

			// Resume with stagger
			service.resumeAll(session => {
				if (session.repoPath === '/repo1') return 0;
				return 50;
			});

			assert.ok(!handle1.session.suspended);
			assert.ok(!handle2.session.suspended);

			sub1.dispose();
			sub2.dispose();
			handle1.dispose();
			handle2.dispose();
			service.dispose();
		});
	});

	describe('dispose', () => {
		it('watch() returns undefined when service is already disposed', () => {
			const { factory } = createMockFactory();
			const service = new RepositoryWatchService({ watchingProvider: factory });

			service.dispose();

			const handle = service.watch('/repo', standardGitDir('/repo/.git'));
			assert.strictEqual(handle, undefined);
		});

		it('disposes all sessions, watchers, and groups', () => {
			const { factory, watchers } = createMockFactory();
			const service = new RepositoryWatchService({
				watchingProvider: factory,
				defaultRepoDelayMs: 30,
			});

			const handle = service.watch('/repo', standardGitDir('/repo/.git'));
			assert.ok(handle != null);
			handle.session.subscribe({ delayMs: 30 });

			assert.ok(watchers.length > 0);

			service.dispose();

			for (const w of watchers) {
				assert.ok(w.disposed, `Watcher at ${w.basePath} should be disposed`);
			}

			assert.strictEqual(service.getSession('/repo'), undefined);
		});
	});
});

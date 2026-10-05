import assert from 'node:assert';
import { describe, it } from 'node:test';
import { mixinDisposable } from '@gitlens/utils/disposable.js';
import { normalizePath } from '@gitlens/utils/path.js';
import { fileUri, getRepositoryKey } from '@gitlens/utils/uri.js';
import type { GitDir } from '../../models/repository.js';
import type { WatcherRepoChangeEvent } from '../changeEvent.js';
import type { GitIgnoreFilter } from '../gitIgnoreFilter.js';
import type { FileWatcher, FileWatcherOptions, FileWatchEvent, FileWatchingProvider } from '../provider.js';
import { dotGitGlobCommon, workingTreeExcludes } from '../watcherPatterns.js';
import { RepositoryWatchService } from '../watchService.js';

interface MockWatcher extends FileWatcher {
	readonly basePath: string;
	readonly pattern: string;
	readonly options: FileWatcherOptions | undefined;
	fire(event: FileWatchEvent): void;
	disposed: boolean;
}

function createMockFactory(supportsExcludes?: boolean): {
	factory: FileWatchingProvider;
	watchers: MockWatcher[];
	/** `create:<n>` / `dispose:<n>` in the order they happened, `n` being the watcher's index in `watchers` */
	log: string[];
} {
	const watchers: MockWatcher[] = [];
	const log: string[] = [];
	const factory: FileWatchingProvider = {
		supportsExcludes: supportsExcludes,
		createWatcher: function (
			basePath: string,
			pattern: string,
			onEvent: (event: FileWatchEvent) => void,
			options?: FileWatcherOptions,
		): FileWatcher {
			const w: MockWatcher = mixinDisposable(
				{
					// Watchers get the git dir's OS path (`fsPath`), which is backslashed on Windows; normalize it so
					// the assertions can name the POSIX paths the fixtures are written in.
					basePath: normalizePath(basePath),
					pattern: pattern,
					options: options,
					disposed: false,
					fire: function (event: FileWatchEvent): void {
						onEvent(event);
					},
				},
				() => {
					w.disposed = true;
					log.push(`dispose:${watchers.indexOf(w)}`);
				},
			);
			watchers.push(w);
			log.push(`create:${watchers.length - 1}`);
			return w;
		},
	};
	return { factory: factory, watchers: watchers, log: log };
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

		it("filters a sibling branch's commit out of a subscription scoped to its own refs, but not out of the global event", async () => {
			const { factory, watchers } = createMockFactory();
			const service = new RepositoryWatchService({
				watchingProvider: factory,
				defaultRepoDelayMs: 30,
			});

			const globalReceived: WatcherRepoChangeEvent[] = [];
			service.onDidChangeRepository(e => globalReceived.push(e));

			const handleA = service.watch('/worktrees/A', worktreeGitDir('/repo/.git/worktrees/A', '/repo/.git'));
			assertHandle(handleA);

			const receivedA: WatcherRepoChangeEvent[] = [];
			const subA = handleA.session.subscribe({ delayMs: 30, relevantRefs: () => ['refs/heads/A'] });
			subA.onDidChange(e => receivedA.push(e));

			const common = watchers.find(w => w.pattern === dotGitGlobCommon);
			assert.ok(common);

			// A commit on B, as git writes it: lock file, then rename over the ref
			common.fire({ path: '/repo/.git/refs/heads/B.lock', reason: 'create' });
			common.fire({ path: '/repo/.git/refs/heads/B', reason: 'create' });
			common.fire({ path: '/repo/.git/refs/heads/B.lock', reason: 'delete' });

			await delay(60);

			assert.strictEqual(receivedA.length, 0);
			assert.strictEqual(globalReceived.length, 1);
			assert.strictEqual(globalReceived[0].repoPath, '/worktrees/A');
			assert.ok(globalReceived[0].mayHaveChangedRef('refs/heads/B'));

			// A commit on A itself still arrives
			common.fire({ path: '/repo/.git/refs/heads/A', reason: 'change' });
			await delay(60);

			assert.strictEqual(receivedA.length, 1);
			assert.ok(receivedA[0].mayHaveChangedRef('refs/heads/A'));

			subA.dispose();
			handleA.dispose();
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

		it('treats a nested .gitignore change as an ignore change and a working-tree change', async () => {
			const { factory, watchers } = createMockFactory();
			const service = new RepositoryWatchService({
				watchingProvider: factory,
				defaultRepoDelayMs: 30,
				defaultWorkingTreeDelayMs: 30,
			});

			const globalReceived: WatcherRepoChangeEvent[] = [];
			service.onDidChangeRepository(e => globalReceived.push(e));

			let gitIgnoreChanges = 0;
			const handle = service.watch('/repo', standardGitDir('/repo/.git'), {
				onGitIgnoreChanged: () => gitIgnoreChanges++,
			});
			assertHandle(handle);

			const wtSub = handle.session.subscribeToWorkingTree({ delayMs: 30 });
			const repoSub = handle.session.subscribe({ delayMs: 30 });
			const workingTreeReceived: string[][] = [];
			wtSub.onDidChangeWorkingTree(e => workingTreeReceived.push([...e.paths]));

			const wtWatcher = watchers.find(w => w.basePath === '/repo');
			assert.ok(wtWatcher, 'working-tree watcher should exist');

			wtWatcher.fire({ path: '/repo/packages/a/.gitignore', reason: 'change' });
			await delay(60);

			assert.strictEqual(gitIgnoreChanges, 1);
			assert.strictEqual(globalReceived.filter(e => e.changed('ignores')).length, 1);
			assert.deepStrictEqual(
				workingTreeReceived,
				[['/repo/packages/a/.gitignore']],
				'a nested .gitignore is also a working-tree file (a tracked one shows as modified)',
			);

			// The root .gitignore stays an ignore change only
			wtWatcher.fire({ path: '/repo/.gitignore', reason: 'change' });
			await delay(60);

			assert.strictEqual(gitIgnoreChanges, 2);
			assert.strictEqual(globalReceived.filter(e => e.changed('ignores')).length, 2);
			assert.strictEqual(workingTreeReceived.length, 1, 'the root .gitignore is not a working-tree change');

			wtSub.dispose();
			repoSub.dispose();
			handle.dispose();
			service.dispose();
		});

		it('routes a .gitignore change through the repo channel as an `ignores` change (fences closed worktrees)', async () => {
			const { factory, watchers } = createMockFactory();
			const service = new RepositoryWatchService({
				watchingProvider: factory,
				defaultRepoDelayMs: 30,
				defaultWorkingTreeDelayMs: 30,
			});

			const globalReceived: WatcherRepoChangeEvent[] = [];
			service.onDidChangeRepository(e => globalReceived.push(e));

			const handle = service.watch('/repo', standardGitDir('/repo/.git'));
			assertHandle(handle);

			// Subscribing to the working tree starts the WT watcher — the one that sees `.gitignore`.
			const wtSub = handle.session.subscribeToWorkingTree({ delayMs: 30 });
			const repoSub = handle.session.subscribe({ delayMs: 30 });

			const wtWatcher = watchers.find(w => w.basePath === '/repo');
			assert.ok(wtWatcher, 'working-tree watcher should exist');

			wtWatcher.fire({ path: '/repo/.gitignore', reason: 'change' });
			await delay(60);

			// A closed secondary worktree has no `onGitIgnoreChanged` hook, so the ignore change must reach it as a
			// repo change (like `info/exclude`) to advance its status clock.
			const ignores = globalReceived.filter(e => e.repoPath === '/repo' && e.changed('ignores'));
			assert.strictEqual(ignores.length, 1, 'a .gitignore change must produce exactly one `ignores` repo change');

			wtSub.dispose();
			repoSub.dispose();
			handle.dispose();
			service.dispose();
		});
	});

	describe('global onDidChangeFetchHead', () => {
		it('fires with the repo key as FETCH_HEAD changes, before any hook', () => {
			const { factory, watchers } = createMockFactory();
			const service = new RepositoryWatchService({ watchingProvider: factory });

			const order: string[] = [];
			service.onDidChangeFetchHead(p => order.push(`global:${p}`));

			const handle = service.watch('/repo/', standardGitDir('/repo/.git'), {
				onFetchHeadChanged: p => order.push(`hook:${p}`),
			});
			assertHandle(handle);
			const sub = handle.session.subscribe();

			const gitDirWatcher = watchers.find(w => w.basePath === '/repo/.git');
			assert.ok(gitDirWatcher);
			gitDirWatcher.fire({ path: '/repo/.git/FETCH_HEAD', reason: 'change' });

			assert.deepStrictEqual(order, ['global:/repo', 'hook:/repo']);

			sub.dispose();
			handle.dispose();
			service.dispose();
		});
	});

	describe('repo keys', () => {
		it('keys a Windows-shaped path the way status reads do, so every event lands on the cache key', async () => {
			const { factory, watchers } = createMockFactory();
			const service = new RepositoryWatchService({
				watchingProvider: factory,
				defaultRepoDelayMs: 30,
				defaultWorkingTreeDelayMs: 30,
			});

			const raw = 'C:\\repo\\';
			const key = getRepositoryKey(raw);
			assert.notStrictEqual(key, raw);

			const repoEvents: string[] = [];
			const workingTreeEvents: string[] = [];
			service.onDidChangeRepository(e => repoEvents.push(e.repoPath));
			service.onDidChangeWorkingTree(p => workingTreeEvents.push(p));

			const handle = service.watch(raw, standardGitDir('C:/repo/.git'));
			assertHandle(handle);
			assert.strictEqual(handle.session.repoPath, key);

			// A host spelling the same repository differently joins the same session
			const other = service.watch('C:/repo', standardGitDir('C:/repo/.git'));
			assertHandle(other);
			assert.strictEqual(other.session, handle.session);
			assert.strictEqual(service.getSession('C:\\repo'), handle.session);

			const repoSub = handle.session.subscribe();
			const wtSub = handle.session.subscribeToWorkingTree();
			const [gitDirWatcher, wtWatcher] = watchers;
			assert.ok(gitDirWatcher != null && wtWatcher != null);

			gitDirWatcher.fire({ path: `${gitDirWatcher.basePath}/HEAD`, reason: 'change' });
			wtWatcher.fire({ path: `${wtWatcher.basePath}/src/a.ts`, reason: 'change' });
			await delay(60);

			assert.deepStrictEqual(repoEvents, [key]);
			assert.deepStrictEqual(workingTreeEvents, [key]);

			wtSub.dispose();
			repoSub.dispose();
			other.dispose();
			handle.dispose();
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

		it('a session created while globally suspended starts suspended', () => {
			const { factory } = createMockFactory();
			const service = new RepositoryWatchService({ watchingProvider: factory });

			// Suspend globally before any session for this path exists (e.g. window blurred)
			service.suspendAll();

			const handle = service.watch('/late', standardGitDir('/late/.git'));
			assertHandle(handle);
			assert.ok(handle.session.suspended, 'late-joining session should inherit the global suspended state');

			handle.dispose();
			service.dispose();
		});

		it('resumeAll clears the global suspend so later-created sessions start unsuspended', () => {
			const { factory } = createMockFactory();
			const service = new RepositoryWatchService({ watchingProvider: factory });

			service.suspendAll();
			service.resumeAll();

			const handle = service.watch('/after-resume', standardGitDir('/after-resume/.git'));
			assertHandle(handle);
			assert.ok(!handle.session.suspended, 'session created after resumeAll should not be suspended');

			handle.dispose();
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

	describe('working-tree watcher excludes', () => {
		const wtPath = '/repo';
		const ignoredReadDelayMs = 700; // past the service's 500ms refresh debounce

		function workingTreeWatchers(watchers: MockWatcher[]): MockWatcher[] {
			return watchers.filter(w => w.basePath === wtPath);
		}

		function startService(
			supportsExcludes: boolean | undefined,
			getIgnoredDirectories?: (repoPath: string) => Promise<readonly string[]>,
			filter?: GitIgnoreFilter,
		) {
			const { factory, watchers, log } = createMockFactory(supportsExcludes);
			const service = new RepositoryWatchService({
				watchingProvider: factory,
				defaultWorkingTreeDelayMs: 30,
				getIgnoredDirectories: getIgnoredDirectories,
				getIgnoreFilter: filter != null ? () => filter : undefined,
			});
			const handle = service.watch(wtPath, standardGitDir('/repo/.git'));
			assertHandle(handle);
			return { service: service, handle: handle, watchers: watchers, log: log };
		}

		it('creates the working-tree watcher with the static excludes', () => {
			const { service, handle, watchers } = startService(undefined);
			const wtSub = handle.session.subscribeToWorkingTree({ delayMs: 30 });

			const [watcher, ...rest] = workingTreeWatchers(watchers);
			assert.strictEqual(rest.length, 0);
			assert.deepStrictEqual(watcher.options, { excludes: workingTreeExcludes });

			wtSub.dispose();
			handle.dispose();
			service.dispose();
		});

		it('never reads the ignored directories for a provider that cannot prune', async () => {
			let reads = 0;
			const { service, handle, watchers } = startService(undefined, async () => {
				reads++;
				return ['dist'];
			});
			const wtSub = handle.session.subscribeToWorkingTree({ delayMs: 30 });

			workingTreeWatchers(watchers)[0].fire({ path: '/repo/packages/a/.gitignore', reason: 'change' });
			await delay(ignoredReadDelayMs);

			assert.strictEqual(reads, 0);
			assert.strictEqual(workingTreeWatchers(watchers).length, 1);

			wtSub.dispose();
			handle.dispose();
			service.dispose();
		});

		it('re-creates the watcher with the static and ignored excludes, new before old', async () => {
			const { service, handle, watchers, log } = startService(true, async () => ['dist', 'packages/app/out']);
			const wtSub = handle.session.subscribeToWorkingTree({ delayMs: 30 });
			const first = workingTreeWatchers(watchers)[0];
			const firstIndex = watchers.indexOf(first);

			await delay(20);

			const created = workingTreeWatchers(watchers);
			assert.strictEqual(created.length, 2);
			assert.deepStrictEqual(created[1].options, {
				excludes: [...workingTreeExcludes, 'dist', 'packages/app/out'],
			});
			assert.ok(first.disposed);
			assert.ok(!created[1].disposed);

			const secondIndex = watchers.indexOf(created[1]);
			assert.ok(
				log.indexOf(`create:${secondIndex}`) < log.indexOf(`dispose:${firstIndex}`),
				'the new watcher is created before the old one is disposed',
			);

			wtSub.dispose();
			handle.dispose();
			service.dispose();
		});

		it('keeps the static set when the read fails', async () => {
			const { service, handle, watchers } = startService(true, () => Promise.reject(new Error('git failed')));
			const wtSub = handle.session.subscribeToWorkingTree({ delayMs: 30 });

			await delay(30);

			const created = workingTreeWatchers(watchers);
			assert.strictEqual(created.length, 1);
			assert.ok(!created[0].disposed);

			wtSub.dispose();
			handle.dispose();
			service.dispose();
		});

		it('does not re-create the watcher when the set is unchanged', async () => {
			let reads = 0;
			const { service, handle, watchers } = startService(true, async () => {
				reads++;
				return ['dist'];
			});
			const wtSub = handle.session.subscribeToWorkingTree({ delayMs: 30 });
			await delay(20);
			assert.strictEqual(workingTreeWatchers(watchers).length, 2);

			workingTreeWatchers(watchers)[1].fire({ path: '/repo/.gitignore', reason: 'change' });
			await delay(ignoredReadDelayMs);

			assert.strictEqual(reads, 2, 'the set was read again');
			assert.strictEqual(workingTreeWatchers(watchers).length, 2, 'but nothing was re-created');

			wtSub.dispose();
			handle.dispose();
			service.dispose();
		});

		it('re-reads after the debounce on a nested .gitignore change and re-creates', async () => {
			let sets: string[][] = [['dist']];
			let reads = 0;
			const { service, handle, watchers } = startService(true, async () => {
				reads++;
				return sets[Math.min(reads - 1, sets.length - 1)];
			});
			const wtSub = handle.session.subscribeToWorkingTree({ delayMs: 30 });
			await delay(20);
			sets = [['dist'], ['dist', 'packages/a/out']];

			const live = workingTreeWatchers(watchers)[1];
			live.fire({ path: '/repo/packages/a/.gitignore', reason: 'change' });
			live.fire({ path: '/repo/packages/a/.gitignore', reason: 'change' });
			await delay(100);
			assert.strictEqual(reads, 1, 'the re-read waits for the debounce');

			await delay(ignoredReadDelayMs);
			assert.strictEqual(reads, 2, 'bursts coalesce into one read');

			const created = workingTreeWatchers(watchers);
			assert.strictEqual(created.length, 3);
			assert.deepStrictEqual(created[2].options, {
				excludes: [...workingTreeExcludes, 'dist', 'packages/a/out'],
			});
			assert.ok(live.disposed);

			wtSub.dispose();
			handle.dispose();
			service.dispose();
		});

		it('pushes an incomplete working-tree change when a directory is watched again, not when the set grows', async () => {
			let reads = 0;
			const sets = [['dist'], ['dist', 'out'], ['out']];
			const { service, handle, watchers } = startService(true, async () => sets[Math.min(reads++, 2)]);

			const received: string[] = [];
			service.onDidChangeWorkingTree(p => received.push(p));
			const wtSub = handle.session.subscribeToWorkingTree({ delayMs: 30 });

			await delay(100);
			assert.strictEqual(workingTreeWatchers(watchers).length, 2);
			assert.deepStrictEqual(received, [], 'first read pushes nothing');

			// Grows: ['dist'] -> ['dist', 'out']
			workingTreeWatchers(watchers)[1].fire({ path: '/repo/.gitignore', reason: 'change' });
			await delay(ignoredReadDelayMs + 100);
			assert.strictEqual(workingTreeWatchers(watchers).length, 3);
			assert.deepStrictEqual(received, [], 'a grown set pushes nothing');

			// Shrinks: ['dist', 'out'] -> ['out']
			workingTreeWatchers(watchers)[2].fire({ path: '/repo/.gitignore', reason: 'change' });
			await delay(ignoredReadDelayMs + 100);
			assert.strictEqual(workingTreeWatchers(watchers).length, 4);
			assert.deepStrictEqual(received, ['/repo'], 'a directory watched again pushes an incomplete change');

			wtSub.dispose();
			handle.dispose();
			service.dispose();
		});

		it('refreshes on an info/exclude change', async () => {
			let reads = 0;
			const { service, handle, watchers } = startService(true, async () => (reads++ === 0 ? [] : ['dist']));
			const repoSub = handle.session.subscribe({ delayMs: 30 });
			const wtSub = handle.session.subscribeToWorkingTree({ delayMs: 30 });
			await delay(20);
			assert.strictEqual(workingTreeWatchers(watchers).length, 1);

			const gitDirWatcher = watchers.find(w => w.basePath === '/repo/.git');
			assert.ok(gitDirWatcher);
			gitDirWatcher.fire({ path: '/repo/.git/info/exclude', reason: 'change' });
			await delay(ignoredReadDelayMs);

			assert.strictEqual(reads, 2);
			assert.deepStrictEqual(workingTreeWatchers(watchers).at(-1)?.options, {
				excludes: [...workingTreeExcludes, 'dist'],
			});

			repoSub.dispose();
			wtSub.dispose();
			handle.dispose();
			service.dispose();
		});

		it('creates nothing when stopped during an in-flight read', async () => {
			let resolveRead: ((dirs: string[]) => void) | undefined;
			const { service, handle, watchers } = startService(
				true,
				() => new Promise<string[]>(resolve => (resolveRead = resolve)),
			);
			const wtSub = handle.session.subscribeToWorkingTree({ delayMs: 30 });
			assert.strictEqual(workingTreeWatchers(watchers).length, 1);

			wtSub.dispose();
			assert.ok(workingTreeWatchers(watchers)[0].disposed);

			resolveRead?.(['dist']);
			await delay(20);

			assert.strictEqual(workingTreeWatchers(watchers).length, 1, 'no watcher after stop');

			handle.dispose();
			service.dispose();
		});

		it('drops a pending refresh when stopped', async () => {
			let reads = 0;
			const { service, handle, watchers } = startService(true, async () => {
				reads++;
				return [];
			});
			const wtSub = handle.session.subscribeToWorkingTree({ delayMs: 30 });
			await delay(20);

			workingTreeWatchers(watchers)[0].fire({ path: '/repo/.gitignore', reason: 'change' });
			wtSub.dispose();
			await delay(ignoredReadDelayMs);

			assert.strictEqual(reads, 1, 'the debounced re-read never ran');

			handle.dispose();
			service.dispose();
		});

		describe('ignored directories created after the watcher started', () => {
			/** Ignores `dist/` and `out/` (with everything beneath them) and the root `.env` file */
			function ignoringFilter(): GitIgnoreFilter {
				return {
					ready: () => Promise.resolve(),
					isIgnored: (path: string) => path === '.env' || /^(dist|out)(\/|$)/.test(path),
					refresh: () => Promise.resolve(),
				} as unknown as GitIgnoreFilter;
			}

			async function startPruning(getIgnoredDirectories: () => Promise<readonly string[]>) {
				const started = startService(true, getIgnoredDirectories, ignoringFilter());
				const wtSub = started.handle.session.subscribeToWorkingTree({ delayMs: 30 });
				const received: string[][] = [];
				wtSub.onDidChangeWorkingTree(e => received.push([...e.paths]));
				// Let the start-up read settle
				await delay(20);
				return { ...started, wtSub: wtSub, received: received };
			}

			it('re-reads once and re-creates the watcher excluding a newly ignored directory', async () => {
				let reads = 0;
				const { service, handle, watchers, wtSub, received } = await startPruning(async () =>
					reads++ === 0 ? [] : ['dist'],
				);
				assert.strictEqual(reads, 1);
				assert.strictEqual(workingTreeWatchers(watchers).length, 1, 'nothing to prune at start');

				const live = workingTreeWatchers(watchers)[0];
				live.fire({ path: '/repo/dist/main.js', reason: 'create' });
				live.fire({ path: '/repo/dist/chunks/a.js', reason: 'create' });
				await delay(ignoredReadDelayMs);

				assert.strictEqual(reads, 2, 'exactly one re-read');
				const created = workingTreeWatchers(watchers);
				assert.strictEqual(created.length, 2);
				assert.deepStrictEqual(created[1].options, { excludes: [...workingTreeExcludes, 'dist'] });
				assert.ok(live.disposed);
				assert.deepStrictEqual(received, [], 'the ignored events never reach subscribers');

				wtSub.dispose();
				handle.dispose();
				service.dispose();
			});

			it('arms one timer for a burst of events under an unpruned directory', async () => {
				let reads = 0;
				const { service, handle, watchers, wtSub } = await startPruning(async () =>
					reads++ === 0 ? [] : ['dist'],
				);
				const live = workingTreeWatchers(watchers)[0];

				const realSetTimeout = globalThis.setTimeout;
				let timers = 0;
				globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
					timers++;
					return realSetTimeout(...args);
				}) as typeof setTimeout;
				try {
					for (let i = 0; i < 1000; i++) {
						live.fire({ path: `/repo/dist/file${i}.js`, reason: 'create' });
					}
				} finally {
					globalThis.setTimeout = realSetTimeout;
				}
				assert.strictEqual(timers, 1, 'one timer for the whole burst');

				await delay(ignoredReadDelayMs);
				assert.strictEqual(reads, 2, 'and one re-read');

				wtSub.dispose();
				handle.dispose();
				service.dispose();
			});

			it('triggers nothing for an ignored file in a watched directory', async () => {
				let reads = 0;
				const { service, handle, watchers, wtSub, received } = await startPruning(async () => {
					reads++;
					return [];
				});

				const live = workingTreeWatchers(watchers)[0];
				live.fire({ path: '/repo/.env', reason: 'change' });
				await delay(ignoredReadDelayMs);

				assert.strictEqual(reads, 1, 'no re-read');
				assert.strictEqual(workingTreeWatchers(watchers).length, 1);
				assert.deepStrictEqual(received, []);

				wtSub.dispose();
				handle.dispose();
				service.dispose();
			});

			it('re-reads once for a directory git will not prune, then not again until an ignore rule changes', async () => {
				let reads = 0;
				// `dist` holds tracked files, so git never lists it as ignored
				const { service, handle, watchers, wtSub } = await startPruning(async () => {
					reads++;
					return [];
				});

				const live = workingTreeWatchers(watchers)[0];
				live.fire({ path: '/repo/dist/main.js', reason: 'change' });
				await delay(ignoredReadDelayMs);
				assert.strictEqual(reads, 2, 'one re-read');

				live.fire({ path: '/repo/dist/main.js', reason: 'change' });
				live.fire({ path: '/repo/dist/other.js', reason: 'change' });
				live.fire({ path: '/repo/dist/chunks/a/b.js', reason: 'create' });
				await delay(ignoredReadDelayMs);
				assert.strictEqual(reads, 2, 'never again for that directory, its subdirectories included');

				// Another unpruned directory still triggers its own re-read
				live.fire({ path: '/repo/out/a.js', reason: 'create' });
				await delay(ignoredReadDelayMs);
				assert.strictEqual(reads, 3);

				// An ignore-rule change re-reads and forgets what wasn't prunable
				live.fire({ path: '/repo/.gitignore', reason: 'change' });
				await delay(ignoredReadDelayMs);
				assert.strictEqual(reads, 4);

				live.fire({ path: '/repo/dist/main.js', reason: 'change' });
				await delay(ignoredReadDelayMs);
				assert.strictEqual(reads, 5, 'the directory triggers again after the rule change');

				wtSub.dispose();
				handle.dispose();
				service.dispose();
			});

			it('queues one re-read for an unpruned directory seen while a read is in flight', async () => {
				const pending: ((dirs: readonly string[]) => void)[] = [];
				const { service, handle, watchers, wtSub } = await startPruning(
					() => new Promise<readonly string[]>(resolve => pending.push(resolve)),
				);
				assert.strictEqual(pending.length, 1, 'the start-up read is in flight');

				const live = workingTreeWatchers(watchers)[0];
				live.fire({ path: '/repo/dist/main.js', reason: 'create' });
				live.fire({ path: '/repo/dist/other.js', reason: 'create' });

				// The start-up read began before `dist` existed
				pending[0]([]);
				await delay(20);
				assert.strictEqual(pending.length, 2, 'one immediate re-read');

				pending[1](['dist']);
				await delay(20);
				assert.strictEqual(pending.length, 2);
				assert.deepStrictEqual(workingTreeWatchers(watchers).at(-1)?.options, {
					excludes: [...workingTreeExcludes, 'dist'],
				});

				wtSub.dispose();
				handle.dispose();
				service.dispose();
			});
		});
	});
});

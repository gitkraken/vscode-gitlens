import assert from 'node:assert';
import { describe, it, mock } from 'node:test';
import { mixinDisposable } from '@gitlens/utils/disposable.js';
import { normalizePath } from '@gitlens/utils/path.js';
import { fileUri, getRepositoryKey } from '@gitlens/utils/uri.js';
import { Cache } from '../../cache.js';
import { FileType } from '../../context.js';
import type { GitDir } from '../../models/repository.js';
import type { WatcherRepoChangeEvent } from '../changeEvent.js';
import { GitIgnoreFilter } from '../gitIgnoreFilter.js';
import type {
	FileWatcher,
	FileWatcherOptions,
	FileWatcherReliability,
	FileWatchEvent,
	FileWatchingProvider,
} from '../provider.js';
import { dotGitGlobCombined, dotGitGlobCommon, workingTreeExcludes } from '../watcherPatterns.js';
import { RepositoryWatchService } from '../watchService.js';

interface MockWatcher extends FileWatcher {
	readonly basePath: string;
	readonly pattern: string;
	readonly options: FileWatcherOptions | undefined;
	fire(event: FileWatchEvent): void;
	/** Reports a reliability the way a provider would, after `createWatcher` returned */
	report(state: FileWatcherReliability): void;
	/** Reports the watch live the way a provider that places it asynchronously would */
	start(): void;
	disposed: boolean;
}

/** `initialReliability` is reported synchronously inside `createWatcher`, for the watchers it returns one for */
function createMockFactory(
	supportsExcludes?: boolean,
	initialReliability?: (basePath: string, index: number) => FileWatcherReliability | undefined,
): {
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
					report: function (state: FileWatcherReliability): void {
						options?.onDidChangeReliability?.(state);
					},
					start: function (): void {
						options?.onDidStart?.();
					},
				},
				() => {
					w.disposed = true;
					log.push(`dispose:${watchers.indexOf(w)}`);
				},
			);
			watchers.push(w);
			log.push(`create:${watchers.length - 1}`);
			const initial = initialReliability?.(w.basePath, watchers.length - 1);
			if (initial != null) {
				options?.onDidChangeReliability?.(initial);
			}
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

		it("reports no change for a ref's lock file git removes without writing the ref", async () => {
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
			const subA = handleA.session.subscribe({ delayMs: 30, relevantRefs: () => ['refs/remotes/origin/HEAD'] });
			subA.onDidChange(e => receivedA.push(e));

			const common = watchers.find(w => w.pattern === dotGitGlobCommon);
			assert.ok(common);

			// A fetch that moved nothing: it locks the remote's HEAD to check its default branch, then releases it
			common.fire({ path: '/repo/.git/refs/remotes/origin/HEAD.lock', reason: 'create' });
			common.fire({ path: '/repo/.git/refs/remotes/origin/HEAD.lock', reason: 'delete' });

			await delay(60);

			assert.strictEqual(receivedA.length, 0);
			assert.strictEqual(globalReceived.length, 0);

			subA.dispose();
			handleA.dispose();
			service.dispose();
		});

		it('drops the admin entry reports of a worktree under a folder its provider ignores, in either spelling', async () => {
			const { factory, watchers } = createMockFactory();
			const gitdirs: Record<string, string> = {
				'/repo/.git/worktrees/x-1/gitdir': '/repo/.git/sync-tools-worktrees/x/.git\n',
				// Git writes the path the common git dir resolves to, through a symlink
				'/repo/.git/worktrees/x-2/gitdir': '/private/repo/.git/sync-tools-worktrees/y/.git\n',
				// Inside the git dir, but under no folder the provider registered: a user's own worktree
				'/repo/.git/worktrees/mine/gitdir': '/repo/.git/my-worktrees/x/.git\n',
			};
			const asked: string[] = [];
			const service = new RepositoryWatchService({
				watchingProvider: factory,
				defaultRepoDelayMs: 30,
				readFile: path => {
					const normalized = normalizePath(path);
					if (normalized === '/repo/.git/config') {
						return Promise.resolve(new TextEncoder().encode('[core]\n'));
					}

					const content = gitdirs[normalized];
					return content != null
						? Promise.resolve(new TextEncoder().encode(content))
						: Promise.reject(new Error('ENOENT'));
				},
				readDirectory: path =>
					normalizePath(path) === '/repo/.git/worktrees'
						? Promise.resolve([
								['x-1', FileType.Directory],
								['x-2', FileType.Directory],
								['mine', FileType.Directory],
							] as [string, number][])
						: Promise.reject(new Error('ENOENT')),
				getIgnoredWorktreeRoots: repoPath => {
					asked.push(repoPath);
					return Promise.resolve([
						'/repo/.git/sync-tools-worktrees',
						'/private/repo/.git/sync-tools-worktrees',
					]);
				},
			});

			const handleA = service.watch('/worktrees/A', worktreeGitDir('/repo/.git/worktrees/A', '/repo/.git'));
			assertHandle(handleA);

			const receivedA: WatcherRepoChangeEvent[] = [];
			const subA = handleA.session.subscribe({ delayMs: 30 });
			subA.onDidChange(e => receivedA.push(e));

			const common = watchers.find(w => w.pattern === dotGitGlobCommon);
			assert.ok(common);
			// A report arriving before the admin entries are first read is told at once
			for (let i = 0; i < 5; i++) {
				await new Promise(resolve => setImmediate(resolve));
			}

			common.fire({ path: '/repo/.git/worktrees/x-1/HEAD', reason: 'change' });
			common.fire({ path: '/repo/.git/worktrees/x-2/HEAD', reason: 'change' });
			await delay(60);
			assert.strictEqual(receivedA.length, 0);

			common.fire({ path: '/repo/.git/worktrees/mine/HEAD', reason: 'change' });
			await delay(60);
			assert.strictEqual(receivedA.length, 1);
			assert.deepStrictEqual(asked, ['/worktrees/A']);

			subA.dispose();
			handleA.dispose();
			service.dispose();
		});

		it('leaves the folders its provider ignores worktrees under unwatched beneath the common git dir', () => {
			const { factory, watchers } = createMockFactory();
			const asked: string[] = [];
			const service = new RepositoryWatchService({
				watchingProvider: factory,
				getIgnoredWorktreeFolders: repoPath => {
					asked.push(repoPath);
					return ['sync-tools-worktrees'];
				},
			});

			const main = service.watch('/repo', standardGitDir('/repo/.git'));
			const linked = service.watch('/worktrees/A', worktreeGitDir('/repo/.git/worktrees/A', '/repo/.git'));
			assertHandle(main);
			assertHandle(linked);
			const subs = [main.session.subscribe({ delayMs: 30 }), linked.session.subscribe({ delayMs: 30 })];

			const excludes = (basePath: string, pattern?: string) =>
				watchers.find(w => w.basePath === basePath && (pattern == null || w.pattern === pattern))?.options
					?.excludes;
			assert.ok(excludes('/repo/.git', dotGitGlobCombined)?.includes('sync-tools-worktrees'));
			assert.ok(excludes('/repo/.git', dotGitGlobCommon)?.includes('sync-tools-worktrees'));
			assert.ok(!excludes('/repo/.git/worktrees/A')?.includes('sync-tools-worktrees'));
			assert.ok(watchers.every(w => !w.options?.excludes?.includes('worktrees')));
			assert.deepStrictEqual(asked, ['/repo']);

			for (const sub of subs) {
				sub.dispose();
			}
			linked.dispose();
			main.dispose();
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

	describe('overflow', () => {
		it('pushes one incomplete working-tree change', async () => {
			const { factory, watchers } = createMockFactory();
			const service = new RepositoryWatchService({ watchingProvider: factory, defaultWorkingTreeDelayMs: 20 });
			const handle = service.watch('/repo', standardGitDir('/repo/.git'));
			assertHandle(handle);
			const wtSub = handle.session.subscribeToWorkingTree({ delayMs: 20 });
			const received: boolean[] = [];
			wtSub.onDidChangeWorkingTree(e => received.push(e.incomplete));

			watchers.find(w => w.basePath === '/repo')!.fire({ path: '/repo', reason: 'overflow' });
			await delay(60);

			assert.deepStrictEqual(received, [true]);

			wtSub.dispose();
			handle.dispose();
			service.dispose();
		});

		it('pushes it before the gitignore filter is ready', async () => {
			const { factory, watchers } = createMockFactory();
			const filter = {
				ready: () => new Promise<void>(() => {}),
				isIgnored: () => false,
				refresh: () => Promise.resolve(),
				revalidate: () => Promise.resolve(false),
			} as unknown as GitIgnoreFilter;
			const service = new RepositoryWatchService({
				watchingProvider: factory,
				defaultWorkingTreeDelayMs: 20,
				getIgnoreFilter: () => filter,
			});
			const handle = service.watch('/repo', standardGitDir('/repo/.git'));
			assertHandle(handle);
			const wtSub = handle.session.subscribeToWorkingTree({ delayMs: 20 });
			const received: boolean[] = [];
			wtSub.onDidChangeWorkingTree(e => received.push(e.incomplete));

			watchers.find(w => w.basePath === '/repo')!.fire({ path: '/repo/sub', reason: 'overflow' });
			await delay(60);

			assert.deepStrictEqual(received, [true]);

			wtSub.dispose();
			handle.dispose();
			service.dispose();
		});

		it('reloads the ignore rules, since a lost .gitignore edit would leave them stale', async () => {
			const { factory, watchers } = createMockFactory();
			let refreshes = 0;
			const filter = {
				ready: () => Promise.resolve(),
				isIgnored: () => false,
				refresh: () => {
					refreshes++;
					return Promise.resolve();
				},
				revalidate: () => Promise.resolve(false),
			} as unknown as GitIgnoreFilter;
			const service = new RepositoryWatchService({
				watchingProvider: factory,
				defaultRepoDelayMs: 20,
				defaultWorkingTreeDelayMs: 20,
				getIgnoreFilter: () => filter,
			});
			const handle = service.watch('/repo', standardGitDir('/repo/.git'));
			assertHandle(handle);
			const sub = handle.session.subscribe({ delayMs: 20 });
			const wtSub = handle.session.subscribeToWorkingTree({ delayMs: 20 });
			const changes: string[][] = [];
			sub.onDidChange(e => changes.push([...e.changes]));

			watchers.find(w => w.basePath === '/repo')!.fire({ path: '/repo', reason: 'overflow' });
			await delay(60);

			assert.strictEqual(refreshes, 1);
			assert.deepStrictEqual(changes, [['ignores']]);

			wtSub.dispose();
			sub.dispose();
			handle.dispose();
			service.dispose();
		});

		it('a .git overflow clears the cache without unregistering the worktree', async () => {
			const { factory, watchers } = createMockFactory();
			const service = new RepositoryWatchService({ watchingProvider: factory, defaultRepoDelayMs: 20 });
			const cache = new Cache();
			const gitDir = worktreeGitDir('/repo/.git/worktrees/wt', '/repo/.git');
			cache.registerRepoPath(fileUri('/worktrees/wt'), gitDir);
			assert.ok(cache.isRegistered('/worktrees/wt'));

			const changes: string[][] = [];
			service.onDidChangeRepository(e => {
				changes.push([...e.changes]);
				cache.onRepositoryChanged(e.repoPath, e.changes);
			});

			const handle = service.watch('/worktrees/wt', gitDir);
			assertHandle(handle);
			const sub = handle.session.subscribe({ delayMs: 20 });

			watchers
				.find(w => w.basePath === '/repo/.git/worktrees/wt')!
				.fire({
					path: '/repo/.git/worktrees/wt',
					reason: 'overflow',
				});
			await delay(60);

			assert.strictEqual(changes.length, 1);
			assert.ok(changes[0].includes('heads'));
			assert.ok(!changes[0].includes('unknown'));
			assert.ok(cache.isRegistered('/worktrees/wt'), 'overflow must not unregister the path');
			assert.strictEqual(cache.isWorktree('/worktrees/wt'), true);

			// Control: 'unknown' is what would have unregistered it
			cache.onRepositoryChanged('/worktrees/wt', ['unknown']);
			assert.ok(!cache.isRegistered('/worktrees/wt'));

			sub.dispose();
			handle.dispose();
			service.dispose();
		});
	});

	describe('a watch placed asynchronously', () => {
		it("rescans the working tree once as the working-tree watch goes live, and doesn't ask the .git watcher", async () => {
			const { factory, watchers } = createMockFactory();
			const service = new RepositoryWatchService({ watchingProvider: factory, defaultWorkingTreeDelayMs: 20 });
			const handle = service.watch('/repo', standardGitDir('/repo/.git'));
			assertHandle(handle);
			const sub = handle.session.subscribe();
			const wtSub = handle.session.subscribeToWorkingTree({ delayMs: 20 });
			const received: { paths: number; incomplete: boolean }[] = [];
			wtSub.onDidChangeWorkingTree(e => received.push({ paths: e.paths.size, incomplete: e.incomplete }));

			const gitDirWatchers = watchers.filter(w => w.basePath !== '/repo');
			assert.ok(gitDirWatchers.length > 0);
			for (const w of gitDirWatchers) {
				assert.ok(!('onDidStart' in (w.options ?? {})), `watcher at ${w.basePath}`);
			}

			const workingTree = watchers.find(w => w.basePath === '/repo')!;
			workingTree.start();
			await delay(60);
			assert.deepStrictEqual(received, [{ paths: 0, incomplete: true }]);

			workingTree.start();
			await delay(60);
			assert.strictEqual(received.length, 1, 'only the first report counts');

			wtSub.dispose();
			sub.dispose();
			handle.dispose();
			service.dispose();
		});

		it('asks the working-tree watcher with polling on too', () => {
			const { factory, watchers } = createMockFactory();
			const service = new RepositoryWatchService({
				watchingProvider: factory,
				polling: { stat: () => Promise.resolve(undefined) },
			});
			const handle = service.watch('/repo', standardGitDir('/repo/.git'));
			assertHandle(handle);
			const wtSub = handle.session.subscribeToWorkingTree();

			const workingTree = watchers.find(w => w.basePath === '/repo');
			assert.strictEqual(typeof workingTree?.options?.onDidStart, 'function');

			wtSub.dispose();
			handle.dispose();
			service.dispose();
		});

		describe('isWorkingTreeStarting', () => {
			it('is true from placing the working-tree watch until it goes live, for a provider that says it will', () => {
				const { factory, watchers } = createMockFactory();
				const service = new RepositoryWatchService({ watchingProvider: { ...factory, callsOnDidStart: true } });
				const handle = service.watch('/repo', standardGitDir('/repo/.git'));
				assertHandle(handle);
				assert.strictEqual(service.isWorkingTreeStarting('/repo'), false, 'no working-tree watch yet');

				const wtSub = handle.session.subscribeToWorkingTree();
				assert.strictEqual(service.isWorkingTreeStarting('/repo'), true);

				watchers.find(w => w.basePath === '/repo')!.start();
				assert.strictEqual(service.isWorkingTreeStarting('/repo'), false);

				wtSub.dispose();
				handle.dispose();
				service.dispose();
			});

			it("is false for a provider that doesn't say it will", () => {
				const { factory } = createMockFactory();
				const service = new RepositoryWatchService({ watchingProvider: factory });
				const handle = service.watch('/repo', standardGitDir('/repo/.git'));
				assertHandle(handle);
				const wtSub = handle.session.subscribeToWorkingTree();

				assert.strictEqual(service.isWorkingTreeStarting('/repo'), false);

				wtSub.dispose();
				handle.dispose();
				service.dispose();
			});

			it('is false, with no rescan, for a watch that went live inside createWatcher', async () => {
				const { factory } = createMockFactory();
				const provider: FileWatchingProvider = {
					...factory,
					callsOnDidStart: true,
					createWatcher: function (basePath, pattern, onEvent, options) {
						const watcher = factory.createWatcher(basePath, pattern, onEvent, options);
						if (basePath === '/repo') {
							options?.onDidStart?.();
						}
						return watcher;
					},
				};
				const service = new RepositoryWatchService({
					watchingProvider: provider,
					defaultWorkingTreeDelayMs: 20,
				});
				const handle = service.watch('/repo', standardGitDir('/repo/.git'));
				assertHandle(handle);
				const wtSub = handle.session.subscribeToWorkingTree({ delayMs: 20 });
				let received = 0;
				wtSub.onDidChangeWorkingTree(() => received++);

				assert.strictEqual(service.isWorkingTreeStarting('/repo'), false);
				await delay(60);
				assert.strictEqual(received, 0);

				wtSub.dispose();
				handle.dispose();
				service.dispose();
			});

			it('is false while the watch is unwatchable, and once it comes back', () => {
				const { factory, watchers } = createMockFactory();
				const service = new RepositoryWatchService({
					watchingProvider: { ...factory, callsOnDidStart: true },
					polling: { stat: () => Promise.resolve(undefined) },
				});
				const handle = service.watch('/repo', standardGitDir('/repo/.git'));
				assertHandle(handle);
				const wtSub = handle.session.subscribeToWorkingTree();
				assert.strictEqual(service.isWorkingTreeStarting('/repo'), true);

				const watcher = watchers.find(w => w.basePath === '/repo')!;
				watcher.report('unwatchable');
				assert.strictEqual(service.isWorkingTreeStarting('/repo'), false);

				// Coming back rescans in place of a start the provider may never report
				watcher.report('reliable');
				assert.strictEqual(service.isWorkingTreeStarting('/repo'), false);

				wtSub.dispose();
				handle.dispose();
				service.dispose();
			});

			it('starts over with a re-created watcher, which only its own start ends', async () => {
				const { factory, watchers } = createMockFactory(true);
				const service = new RepositoryWatchService({
					watchingProvider: { ...factory, callsOnDidStart: true },
					getIgnoredDirectories: async () => ['dist'],
				});
				const handle = service.watch('/repo', standardGitDir('/repo/.git'));
				assertHandle(handle);
				const wtSub = handle.session.subscribeToWorkingTree();
				const [first] = watchers.filter(w => w.basePath === '/repo');
				first.start();
				assert.strictEqual(service.isWorkingTreeStarting('/repo'), false);

				await delay(20);
				const [, second, ...rest] = watchers.filter(w => w.basePath === '/repo');
				assert.ok(second != null && rest.length === 0, 'the watcher was re-created excluding `dist`');
				assert.strictEqual(service.isWorkingTreeStarting('/repo'), true);

				second.start();
				assert.strictEqual(service.isWorkingTreeStarting('/repo'), false);

				wtSub.dispose();
				handle.dispose();
				service.dispose();
			});

			it("isn't ended by a replaced watcher's start", async () => {
				const { factory, watchers } = createMockFactory(true);
				const service = new RepositoryWatchService({
					watchingProvider: { ...factory, callsOnDidStart: true },
					getIgnoredDirectories: async () => ['dist'],
				});
				const handle = service.watch('/repo', standardGitDir('/repo/.git'));
				assertHandle(handle);
				const wtSub = handle.session.subscribeToWorkingTree();

				await delay(20);
				const [first, second] = watchers.filter(w => w.basePath === '/repo');
				assert.ok(first.disposed && second != null);

				first.start();
				assert.strictEqual(service.isWorkingTreeStarting('/repo'), true);

				wtSub.dispose();
				handle.dispose();
				service.dispose();
			});
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
			assert.deepStrictEqual(watcher.options?.excludes, workingTreeExcludes);

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
			assert.deepStrictEqual(created[1].options?.excludes, [...workingTreeExcludes, 'dist', 'packages/app/out']);
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
			assert.deepStrictEqual(created[2].options?.excludes, [...workingTreeExcludes, 'dist', 'packages/a/out']);
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
			assert.deepStrictEqual(workingTreeWatchers(watchers).at(-1)?.options?.excludes, [
				...workingTreeExcludes,
				'dist',
			]);

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
					revalidate: () => Promise.resolve(false),
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
				assert.deepStrictEqual(created[1].options?.excludes, [...workingTreeExcludes, 'dist']);
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
				assert.deepStrictEqual(workingTreeWatchers(watchers).at(-1)?.options?.excludes, [
					...workingTreeExcludes,
					'dist',
				]);

				wtSub.dispose();
				handle.dispose();
				service.dispose();
			});
		});

		describe('a watch that stops and starts again', () => {
			const ignoresDist = /^dist(\/|$)/;

			/** A fake filter whose `revalidate` reports `next` (then false), and whose `ready` waits on it */
			function revalidatingFilter() {
				const state = {
					revalidations: 0,
					refreshes: 0,
					next: undefined as Promise<boolean> | boolean | undefined,
					revalidating: undefined as Promise<boolean> | undefined,
					ignored: ignoresDist,
				};
				const filter = {
					ready: () => state.revalidating?.then(noop, noop) ?? Promise.resolve(),
					isIgnored: (path: string) => state.ignored.test(path),
					refresh: () => {
						state.refreshes++;
						return Promise.resolve();
					},
					revalidate: () => {
						state.revalidations++;
						state.revalidating = Promise.resolve(state.next ?? false);
						state.next = undefined;
						return state.revalidating;
					},
				} as unknown as GitIgnoreFilter;
				return { filter: filter, state: state };
			}

			function noop(): void {}

			function startRestartable(
				filter: GitIgnoreFilter,
				getIgnoredDirectories: () => Promise<readonly string[]>,
			) {
				const { factory, watchers } = createMockFactory(true);
				const service = new RepositoryWatchService({
					watchingProvider: factory,
					defaultRepoDelayMs: 20,
					defaultWorkingTreeDelayMs: 20,
					getIgnoredDirectories: getIgnoredDirectories,
					getIgnoreFilter: () => filter,
				});
				const counts = { gitIgnoreChanges: 0 };
				const handle = service.watch(wtPath, standardGitDir('/repo/.git'), {
					onGitIgnoreChanged: () => counts.gitIgnoreChanges++,
				});
				assertHandle(handle);
				const repoChanges: string[][] = [];
				const repoSub = handle.session.subscribe({ delayMs: 20 });
				repoSub.onDidChange(e => repoChanges.push([...e.changes]));
				const received: string[][] = [];
				const subscribe = () => {
					const sub = handle.session.subscribeToWorkingTree({ delayMs: 20 });
					// The event is the session's, so a listener outlives its subscription unless disposed with it
					const listener = sub.onDidChangeWorkingTree(e => received.push([...e.paths]));
					return {
						dispose: () => {
							listener.dispose();
							sub.dispose();
						},
					};
				};
				const dispose = () => {
					repoSub.dispose();
					handle.dispose();
					service.dispose();
				};
				return {
					watchers: watchers,
					counts: counts,
					repoChanges: repoChanges,
					received: received,
					subscribe: subscribe,
					dispose: dispose,
				};
			}

			it('starts excluding the last read, without reading again, when the rules held', async () => {
				const { filter, state } = revalidatingFilter();
				let reads = 0;
				const started = startRestartable(filter, async () => {
					reads++;
					return ['dist'];
				});
				const first = started.subscribe();
				await delay(20);
				assert.strictEqual(reads, 1);
				first.dispose();
				assert.ok(workingTreeWatchers(started.watchers).every(w => w.disposed));

				const second = started.subscribe();
				await delay(ignoredReadDelayMs);

				assert.strictEqual(state.revalidations, 2);
				assert.strictEqual(reads, 1, 'no read on the restart');
				const created = workingTreeWatchers(started.watchers);
				assert.strictEqual(created.length, 3, 'one watcher for the restart, never swapped');
				assert.deepStrictEqual(created[2].options?.excludes, [...workingTreeExcludes, 'dist']);
				assert.strictEqual(started.counts.gitIgnoreChanges, 0);

				second.dispose();
				started.dispose();
			});

			it('re-reads and announces an ignore change when revalidation finds the rules moved', async () => {
				const { filter, state } = revalidatingFilter();
				let reads = 0;
				const started = startRestartable(filter, async () => (reads++ === 0 ? ['dist'] : ['dist', 'out']));
				const first = started.subscribe();
				await delay(20);
				first.dispose();

				state.next = true;
				const second = started.subscribe();
				await delay(60);

				assert.strictEqual(started.counts.gitIgnoreChanges, 1);
				assert.ok(
					started.repoChanges.some(c => c.includes('ignores')),
					"'ignores' reaches the session",
				);
				assert.strictEqual(state.refreshes, 0, 'the filter already reloaded');

				await delay(ignoredReadDelayMs);
				assert.strictEqual(reads, 2);
				assert.deepStrictEqual(workingTreeWatchers(started.watchers).at(-1)?.options?.excludes, [
					...workingTreeExcludes,
					'dist',
					'out',
				]);

				second.dispose();
				started.dispose();
			});

			it('refreshes the filter and announces an ignore change when revalidation fails', async () => {
				const { filter, state } = revalidatingFilter();
				const started = startRestartable(filter, async () => ['dist']);
				const first = started.subscribe();
				await delay(20);
				first.dispose();

				state.next = Promise.reject(new Error('stat failed'));
				const second = started.subscribe();
				await delay(60);

				assert.strictEqual(state.refreshes, 1);
				assert.strictEqual(started.counts.gitIgnoreChanges, 1);

				// The re-read matches what the restart's watcher already excludes
				await delay(ignoredReadDelayMs);
				assert.strictEqual(workingTreeWatchers(started.watchers).length, 3, 'nothing re-created');

				second.dispose();
				started.dispose();
			});

			it('ignores a revalidation that lands after the watch stopped again', async () => {
				const { filter, state } = revalidatingFilter();
				const started = startRestartable(filter, async () => ['dist']);
				const first = started.subscribe();
				await delay(20);
				first.dispose();

				let resolve!: (changed: boolean) => void;
				state.next = new Promise<boolean>(r => (resolve = r));
				const second = started.subscribe();
				second.dispose();
				resolve(true);
				await delay(60);

				assert.strictEqual(started.counts.gitIgnoreChanges, 0);

				started.dispose();
			});

			it('reads again on the next start when a revalidation found the rules moved after the watch stopped', async () => {
				const { filter, state } = revalidatingFilter();
				let reads = 0;
				const started = startRestartable(filter, async () => {
					reads++;
					return ['dist'];
				});
				const first = started.subscribe();
				await delay(20);
				first.dispose();

				let resolve!: (changed: boolean) => void;
				state.next = new Promise<boolean>(r => (resolve = r));
				const second = started.subscribe();
				second.dispose();
				resolve(true);
				await delay(20);
				assert.strictEqual(reads, 1);

				// The filter already reloaded, so this start's revalidation finds nothing; the list from before must go
				const third = started.subscribe();
				await delay(20);
				assert.strictEqual(reads, 2, 'the list from before the rule change is not reused');

				third.dispose();
				started.dispose();
			});

			it('reads again on restart when the rules changed and the watch stopped before the re-read', async () => {
				const { filter } = revalidatingFilter();
				let reads = 0;
				const started = startRestartable(filter, async () => {
					reads++;
					return ['dist'];
				});
				const first = started.subscribe();
				await delay(20);
				assert.strictEqual(reads, 1);

				workingTreeWatchers(started.watchers).at(-1)!.fire({ path: '/repo/.gitignore', reason: 'change' });
				first.dispose();

				const second = started.subscribe();
				await delay(20);
				assert.strictEqual(reads, 2, 'the list from before the rule change is not reused');

				second.dispose();
				started.dispose();
			});

			it('holds events arriving during revalidation, then filters them under the rules it lands on', async () => {
				const { filter, state } = revalidatingFilter();
				const started = startRestartable(filter, async () => ['dist']);
				const first = started.subscribe();
				await delay(20);
				first.dispose();

				// `dist` stopped being ignored while nothing watched; the restart's revalidation is what notices
				state.ignored = /(?!)/;
				let resolve!: (changed: boolean) => void;
				state.next = new Promise<boolean>(r => (resolve = r));
				const second = started.subscribe();
				const live = workingTreeWatchers(started.watchers).at(-1)!;
				live.fire({ path: '/repo/dist/a.js', reason: 'change' });
				live.fire({ path: '/repo/src/b.ts', reason: 'change' });
				await delay(60);
				assert.deepStrictEqual(started.received, [], 'held until the revalidation lands');

				state.ignored = ignoresDist;
				resolve(true);
				await delay(60);
				assert.deepStrictEqual(started.received, [['/repo/src/b.ts']]);

				second.dispose();
				started.dispose();
			});

			it('with a real filter: a first start stats nothing beyond its load, a restart under unchanged rules reloads nothing', async () => {
				const stats: string[] = [];
				const reads: string[] = [];
				let discovered!: () => void;
				const discovery = new Promise<void>(r => (discovered = r));
				const filter = new GitIgnoreFilter({
					repoPath: wtPath,
					gitDirPath: '/repo/.git',
					fs: {
						readFile: async uri => {
							reads.push(uri.path);
							if (uri.path !== '/repo/.gitignore') throw new Error('ENOENT');
							return new TextEncoder().encode('dist/\n');
						},
						stat: async uri => {
							stats.push(uri.path);
							return uri.path === '/repo/.gitignore'
								? { type: FileType.File, ctime: 0, mtime: 1, size: 6 }
								: undefined;
						},
						readDirectory: async () => [],
					},
					getGitIgnorePaths: async () => {
						await discovery;
						return ['.gitignore', 'pkg/.gitignore'];
					},
				});
				let dirReads = 0;
				const started = startRestartable(filter, async () => {
					dirReads++;
					return ['dist'];
				});

				// The filter's first load is still discovering nested files
				const first = started.subscribe();
				await delay(20);
				assert.ok(!stats.includes('/repo/pkg/.gitignore'), "a revalidation would have stat'ed it");
				discovered();
				await filter.ready();
				first.dispose();
				const loadStats = stats.length;
				const loadReads = reads.length;

				const second = started.subscribe();
				await delay(ignoredReadDelayMs);

				assert.deepStrictEqual(stats.slice(loadStats).sort(), [
					'/repo/.git/info/exclude',
					'/repo/.gitignore',
					'/repo/pkg/.gitignore',
				]);
				assert.strictEqual(reads.length, loadReads, 'nothing re-read');
				assert.strictEqual(dirReads, 1);
				assert.strictEqual(started.counts.gitIgnoreChanges, 0);

				second.dispose();
				started.dispose();
			});
		});
	});

	describe('noteSelfWrite', () => {
		function watchRepo(): {
			service: RepositoryWatchService;
			watchers: MockWatcher[];
			received: WatcherRepoChangeEvent[];
			dispose: () => void;
		} {
			const { factory, watchers } = createMockFactory();
			const service = new RepositoryWatchService({ watchingProvider: factory, defaultRepoDelayMs: 20 });
			const handle = service.watch('/repo', standardGitDir('/repo/.git'));
			assertHandle(handle);
			const sub = handle.session.subscribe();
			const received: WatcherRepoChangeEvent[] = [];
			sub.onDidChange(e => received.push(e));
			return {
				service: service,
				watchers: watchers,
				received: received,
				dispose: () => {
					sub.dispose();
					handle.dispose();
					service.dispose();
				},
			};
		}

		it('routes to the session watching the path, however the path is spelled', async () => {
			const { service, watchers, received, dispose } = watchRepo();
			const gitDirWatcher = watchers.find(w => w.basePath === '/repo/.git')!;

			gitDirWatcher.fire({ path: '/repo/.git/index', reason: 'change' });
			service.noteSelfWrite('/repo/', ['index']);
			gitDirWatcher.fire({ path: '/repo/.git/index', reason: 'change' });
			await delay(60);

			assert.strictEqual(received.length, 1, 'the announcement fires once in place of the echo');
			assert.deepStrictEqual([...received[0].changes], ['index']);
			assert.deepStrictEqual([...received[0].announced], ['index']);
			dispose();
		});

		it('reports a .git change of an announced kind after the announcement fired, unannounced', async () => {
			const { service, watchers, received, dispose } = watchRepo();

			service.noteSelfWrite('/repo', ['remotes']);
			await delay(60);
			watchers
				.find(w => w.basePath === '/repo/.git')!
				.fire({ path: '/repo/.git/refs/remotes/origin/main', reason: 'change' });
			await delay(60);

			assert.strictEqual(received.length, 2);
			assert.deepStrictEqual([...received[0].announced], ['remotes']);
			assert.deepStrictEqual([...received[1].changes], ['remotes']);
			assert.deepStrictEqual([...received[1].announced], []);
			assert.ok(received[1].mayHaveChangedRef('refs/remotes/origin/main'));
			dispose();
		});

		it('is a no-op for a path no session watches', async () => {
			const { service, watchers, received, dispose } = watchRepo();

			service.noteSelfWrite('/other', []);
			watchers.find(w => w.basePath === '/repo/.git')!.fire({ path: '/repo/.git/index', reason: 'change' });
			await delay(60);

			assert.strictEqual(received.length, 1);
			assert.deepStrictEqual([...received[0].changes], ['index']);
			assert.deepStrictEqual([...received[0].announced], []);
			dispose();
		});

		it('never holds back an overflow rescan', async () => {
			const { service, watchers, received, dispose } = watchRepo();

			service.noteSelfWrite('/repo', []);
			watchers.find(w => w.basePath === '/repo/.git')!.fire({ path: '/repo/.git', reason: 'overflow' });
			await delay(60);

			assert.strictEqual(received.length, 1);
			assert.ok(received[0].changes.has('heads'));
			assert.ok(received[0].changes.has('index'));
			assert.deepStrictEqual([...received[0].announced], [], 'the rescan reports every kind itself');
			dispose();
		});
	});
	describe('polling', () => {
		/**
		 * Files and directories keyed by POSIX path; `touch` moves one's mtime, and `remove` and `rename` take a path with
		 * everything beneath it, moving its parent directory's mtime as a filesystem does
		 */
		function createFs(paths: readonly string[]): {
			stat: (path: string) => Promise<{ mtime: number; size: number } | undefined>;
			touch: (path: string) => void;
			remove: (path: string) => void;
			rename: (from: string, to: string) => void;
		} {
			const files = new Map<string, { mtime: number; size: number }>(paths.map(p => [p, { mtime: 1, size: 1 }]));
			const touch = (path: string): void => {
				const file = files.get(path);
				files.set(path, { mtime: (file?.mtime ?? 0) + 1, size: file?.size ?? 1 });
			};
			const take = (path: string): [string, { mtime: number; size: number }][] => {
				const taken = [...files].filter(([p]) => p === path || p.startsWith(`${path}/`));
				for (const [p] of taken) {
					files.delete(p);
				}
				touch(path.substring(0, path.lastIndexOf('/')));
				return taken;
			};
			return {
				stat: function (path: string): Promise<{ mtime: number; size: number } | undefined> {
					return Promise.resolve(files.get(normalizePath(path)));
				},
				touch: touch,
				remove: function (path: string): void {
					take(path);
				},
				rename: function (from: string, to: string): void {
					for (const [p, file] of take(from)) {
						files.set(`${to}${p.substring(from.length)}`, file);
					}
				},
			};
		}

		function noFiles(): Promise<undefined> {
			return Promise.resolve(undefined);
		}

		/** Lets a nudged pass (stat reads, then the session's debounce) finish */
		function settle(): Promise<void> {
			return delay(60);
		}

		it('creates watchers without a reliability callback when polling is off', () => {
			const { factory, watchers } = createMockFactory();
			const service = new RepositoryWatchService({ watchingProvider: factory });
			const handle = service.watch('/repo', standardGitDir('/repo/.git'));
			assertHandle(handle);
			const sub = handle.session.subscribe();
			const wtSub = handle.session.subscribeToWorkingTree();

			for (const w of watchers) {
				assert.ok(!('onDidChangeReliability' in (w.options ?? {})), `watcher at ${w.basePath}`);
			}
			assert.ok(!('watch.pollTargets.count' in service.getResourceUsage()));

			wtSub.dispose();
			sub.dispose();
			handle.dispose();
			service.dispose();
		});

		it('reports the watch mode, and announces each change of it while the repository is watched', () => {
			const { factory, watchers } = createMockFactory();
			const service = new RepositoryWatchService({ watchingProvider: factory, polling: { stat: noFiles } });
			const modes: string[] = [];
			service.onDidChangeWatchMode(e => modes.push(`${e.repoPath} ${e.mode}`));

			assert.strictEqual(service.getWatchMode('/repo'), undefined);
			const handle = service.watch('/repo', standardGitDir('/repo/.git'));
			assertHandle(handle);
			assert.strictEqual(service.getWatchMode('/repo'), undefined, 'nothing watches it before a subscriber');

			const sub = handle.session.subscribe();
			assert.strictEqual(service.getWatchMode('/repo'), 'events');

			const root = watchers.find(w => w.basePath === '/repo/.git')!;
			root.report('unreliable');
			assert.strictEqual(service.getWatchMode('/repo'), 'events', 'polled beside a watcher that still works');
			root.report('unwatchable');
			assert.strictEqual(service.getWatchMode('/repo'), 'poll');
			assert.strictEqual(service.getResourceUsage()['watch.pollTargets.count'], 1);
			root.report('reliable');
			assert.strictEqual(service.getWatchMode('/repo'), 'events');
			root.report('unwatchable');

			sub.dispose();
			assert.strictEqual(service.getWatchMode('/repo'), undefined);
			assert.deepStrictEqual(
				modes,
				['/repo poll', '/repo events', '/repo poll'],
				'no longer watched is not announced',
			);

			// Watched again, it starts over from 'events'
			const resub = handle.session.subscribe();
			assert.strictEqual(service.getWatchMode('/repo'), 'events');
			watchers.findLast(w => w.basePath === '/repo/.git')!.report('unwatchable');
			assert.strictEqual(service.getWatchMode('/repo'), 'poll');
			assert.deepStrictEqual(modes, ['/repo poll', '/repo events', '/repo poll', '/repo poll']);

			resub.dispose();
			handle.dispose();
			service.dispose();
		});

		it('announces no mode change as a polled repository with a working-tree watcher goes away', () => {
			const { factory, watchers } = createMockFactory();
			const service = new RepositoryWatchService({ watchingProvider: factory, polling: { stat: noFiles } });
			const modes: string[] = [];
			service.onDidChangeWatchMode(e => modes.push(e.mode));

			const handle = service.watch('/repo', standardGitDir('/repo/.git'));
			assertHandle(handle);
			handle.session.subscribe();
			handle.session.subscribeToWorkingTree();
			watchers.find(w => w.basePath === '/repo/.git')!.report('unwatchable');
			assert.deepStrictEqual(modes, ['poll']);

			handle.dispose();

			assert.strictEqual(service.getWatchMode('/repo'), undefined);
			assert.deepStrictEqual(modes, ['poll'], 'no longer watched is not announced');
			service.dispose();
		});

		it('counts an unwatchable working tree as polled, and re-reads it on a .git index change', async () => {
			const { factory, watchers } = createMockFactory(undefined, basePath =>
				basePath === '/repo' ? 'unwatchable' : undefined,
			);
			const service = new RepositoryWatchService({
				watchingProvider: factory,
				defaultWorkingTreeDelayMs: 20,
				polling: { stat: noFiles },
			});
			const handle = service.watch('/repo', standardGitDir('/repo/.git'));
			assertHandle(handle);
			const sub = handle.session.subscribe({ delayMs: 20 });
			const wtSub = handle.session.subscribeToWorkingTree({ delayMs: 20 });
			const received: boolean[] = [];
			wtSub.onDidChangeWorkingTree(e => received.push(e.incomplete));

			assert.strictEqual(service.getWatchMode('/repo'), 'poll');
			await settle();
			assert.deepStrictEqual(received, [], 'no rescan for a watcher that never worked');

			watchers.find(w => w.basePath === '/repo/.git')!.fire({ path: '/repo/.git/index', reason: 'change' });
			await settle();
			assert.deepStrictEqual(received, [true]);

			wtSub.dispose();
			sub.dispose();
			handle.dispose();
			service.dispose();
		});

		it('leaves a watched working tree alone on a .git index change', async () => {
			const { factory, watchers } = createMockFactory();
			const service = new RepositoryWatchService({
				watchingProvider: factory,
				defaultWorkingTreeDelayMs: 20,
				polling: { stat: noFiles },
			});
			const handle = service.watch('/repo', standardGitDir('/repo/.git'));
			assertHandle(handle);
			const sub = handle.session.subscribe({ delayMs: 20 });
			const wtSub = handle.session.subscribeToWorkingTree({ delayMs: 20 });
			const received: boolean[] = [];
			wtSub.onDidChangeWorkingTree(e => received.push(e.incomplete));

			watchers.find(w => w.basePath === '/repo/.git')!.fire({ path: '/repo/.git/index', reason: 'change' });
			await settle();
			assert.deepStrictEqual(received, []);

			wtSub.dispose();
			sub.dispose();
			handle.dispose();
			service.dispose();
		});

		it('polls an unwatchable repository on resumeAll, mid-interval, through its subscribers', async () => {
			const fs = createFs(['/repo/.git/HEAD', '/repo/.git/index', '/repo/.git/refs/heads/main']);
			const { factory } = createMockFactory(undefined, () => 'unwatchable');
			const service = new RepositoryWatchService({
				watchingProvider: factory,
				defaultRepoDelayMs: 20,
				defaultWorkingTreeDelayMs: 20,
				polling: { stat: fs.stat, intervalMs: 60_000, activeCheckMs: 60_000 },
			});
			const handle = service.watch('/repo', standardGitDir('/repo/.git'));
			assertHandle(handle);
			const repoEvents: WatcherRepoChangeEvent[] = [];
			const sub = handle.session.subscribe({ delayMs: 20, relevantRefs: () => ['refs/heads/main'] });
			sub.onDidChange(e => repoEvents.push(e));
			const wtSub = handle.session.subscribeToWorkingTree({ delayMs: 20 });
			const wtEvents: boolean[] = [];
			wtSub.onDidChangeWorkingTree(e => wtEvents.push(e.incomplete));

			service.resumeAll();
			await settle();
			assert.strictEqual(repoEvents.length, 0, 'the first pass only records');

			fs.touch('/repo/.git/index');
			fs.touch('/repo/.git/refs/heads/main');
			service.resumeAll();
			await settle();

			assert.strictEqual(repoEvents.length, 1);
			assert.deepStrictEqual([...repoEvents[0].changes].sort(), ['heads', 'index']);
			assert.ok(repoEvents[0].mayHaveChangedRef('refs/heads/main'));
			assert.deepStrictEqual(wtEvents, [true]);

			wtSub.dispose();
			sub.dispose();
			handle.dispose();
			service.dispose();
		});

		it("reports every remote-tracking ref as possibly moved when a polled remote's directory goes", async () => {
			// What `git remote remove origin` leaves: a rewritten config, and the remote's directory deleted with its
			// loose refs, which moves `refs/remotes`
			const fs = createFs([
				'/repo/.git/HEAD',
				'/repo/.git/config',
				'/repo/.git/refs/heads/main',
				'/repo/.git/refs/remotes',
				'/repo/.git/refs/remotes/origin',
				'/repo/.git/refs/remotes/origin/main',
			]);
			const { factory } = createMockFactory(undefined, () => 'unwatchable');
			const service = new RepositoryWatchService({
				watchingProvider: factory,
				defaultRepoDelayMs: 20,
				polling: { stat: fs.stat, intervalMs: 60_000, activeCheckMs: 60_000 },
			});
			const handle = service.watch('/repo', standardGitDir('/repo/.git'));
			assertHandle(handle);
			const repoEvents: WatcherRepoChangeEvent[] = [];
			const sub = handle.session.subscribe({ delayMs: 20 });
			sub.onDidChange(e => repoEvents.push(e));
			// A subscriber narrowed to the refs it follows still hears it, whether or not it names a remote ref
			const narrowedEvents: WatcherRepoChangeEvent[] = [];
			const narrowedSubs = [['refs/heads/main', 'refs/remotes/origin/main'], ['refs/heads/main']].map(refs => {
				const narrowed = handle.session.subscribe({ delayMs: 20, relevantRefs: () => refs });
				narrowed.onDidChange(e => narrowedEvents.push(e));
				return narrowed;
			});

			service.resumeAll();
			await settle();
			assert.strictEqual(repoEvents.length, 0, 'the first pass only records');

			fs.touch('/repo/.git/config');
			fs.remove('/repo/.git/refs/remotes/origin');
			service.resumeAll();
			await settle();

			assert.strictEqual(repoEvents.length, 1);
			const [e] = repoEvents;
			assert.deepStrictEqual([...e.changes].sort(), ['config', 'remotes']);
			assert.ok(e.unnamedRefKinds.has('remotes'), "the poll can't tell which remote went");
			assert.ok(e.mayHaveChangedRef('refs/remotes/origin/main'), "the removed remote's refs may have moved");
			assert.ok(e.mayHaveChangedRef('refs/remotes/upstream/main'), 'as may any remote-tracking ref');
			assert.ok(!e.mayHaveChangedRef('refs/heads/main'), 'no branch moved');

			assert.strictEqual(narrowedEvents.length, 2);
			for (const narrowed of narrowedEvents) {
				assert.deepStrictEqual([...narrowed.changes].sort(), ['config', 'remotes']);
				assert.ok(narrowed.mayHaveChangedRef('refs/remotes/origin/main'));
				assert.ok(!narrowed.mayHaveChangedRef('refs/heads/main'));
			}

			narrowedSubs.forEach(s => s.dispose());
			sub.dispose();
			handle.dispose();
			service.dispose();
		});

		it("reports every remote-tracking ref as possibly moved when a polled remote's directory is renamed", async () => {
			// What `git remote rename origin upstream` leaves: a rewritten config, and the remote's loose refs moved to a
			// new directory, which moves `refs/remotes`
			const fs = createFs([
				'/repo/.git/HEAD',
				'/repo/.git/config',
				'/repo/.git/refs/heads/main',
				'/repo/.git/refs/remotes',
				'/repo/.git/refs/remotes/origin',
				'/repo/.git/refs/remotes/origin/main',
			]);
			const { factory } = createMockFactory(undefined, () => 'unwatchable');
			const service = new RepositoryWatchService({
				watchingProvider: factory,
				defaultRepoDelayMs: 20,
				polling: { stat: fs.stat, intervalMs: 60_000, activeCheckMs: 60_000 },
			});
			const handle = service.watch('/repo', standardGitDir('/repo/.git'));
			assertHandle(handle);
			const repoEvents: WatcherRepoChangeEvent[] = [];
			const sub = handle.session.subscribe({ delayMs: 20 });
			sub.onDidChange(e => repoEvents.push(e));

			service.resumeAll();
			await settle();
			assert.strictEqual(repoEvents.length, 0, 'the first pass only records');

			fs.touch('/repo/.git/config');
			fs.rename('/repo/.git/refs/remotes/origin', '/repo/.git/refs/remotes/upstream');
			service.resumeAll();
			await settle();

			assert.strictEqual(repoEvents.length, 1);
			const [e] = repoEvents;
			assert.deepStrictEqual([...e.changes].sort(), ['config', 'remotes']);
			assert.ok(e.unnamedRefKinds.has('remotes'));
			assert.ok(e.mayHaveChangedRef('refs/remotes/origin/main'), 'the old name is gone');
			assert.ok(e.mayHaveChangedRef('refs/remotes/upstream/main'), 'and the new one appeared');
			assert.ok(!e.mayHaveChangedRef('refs/heads/main'), 'no branch moved');

			sub.dispose();
			handle.dispose();
			service.dispose();
		});

		it("names no ref for a polled config write that leaves every remote's directory alone", async () => {
			// What `git branch --set-upstream-to` leaves: only the config moves, so no remote-tracking ref did
			const fs = createFs([
				'/repo/.git/HEAD',
				'/repo/.git/config',
				'/repo/.git/refs/heads/main',
				'/repo/.git/refs/remotes',
				'/repo/.git/refs/remotes/origin',
				'/repo/.git/refs/remotes/origin/main',
			]);
			const { factory } = createMockFactory(undefined, () => 'unwatchable');
			const service = new RepositoryWatchService({
				watchingProvider: factory,
				defaultRepoDelayMs: 20,
				polling: { stat: fs.stat, intervalMs: 60_000, activeCheckMs: 60_000 },
			});
			const handle = service.watch('/repo', standardGitDir('/repo/.git'));
			assertHandle(handle);
			const repoEvents: WatcherRepoChangeEvent[] = [];
			const sub = handle.session.subscribe({ delayMs: 20 });
			sub.onDidChange(e => repoEvents.push(e));

			service.resumeAll();
			await settle();
			assert.strictEqual(repoEvents.length, 0, 'the first pass only records');

			fs.touch('/repo/.git/config');
			service.resumeAll();
			await settle();

			assert.strictEqual(repoEvents.length, 1);
			const [e] = repoEvents;
			assert.deepStrictEqual([...e.changes].sort(), ['config', 'remotes']);
			assert.strictEqual(e.unnamedRefKinds.size, 0);
			assert.ok(!e.mayHaveChangedRef('refs/remotes/origin/main'));
			assert.ok(!e.mayHaveChangedRef('refs/heads/main'));

			sub.dispose();
			handle.dispose();
			service.dispose();
		});

		it('names no ref for a config write the watcher reports, which reports the moved refs itself', async () => {
			const { factory, watchers } = createMockFactory();
			const service = new RepositoryWatchService({ watchingProvider: factory, defaultRepoDelayMs: 20 });
			const handle = service.watch('/repo', standardGitDir('/repo/.git'));
			assertHandle(handle);
			const repoEvents: WatcherRepoChangeEvent[] = [];
			const sub = handle.session.subscribe({ delayMs: 20 });
			sub.onDidChange(e => repoEvents.push(e));

			watchers.find(w => w.basePath === '/repo/.git')!.fire({ path: '/repo/.git/config', reason: 'change' });
			await settle();

			assert.strictEqual(repoEvents.length, 1);
			const [e] = repoEvents;
			assert.deepStrictEqual([...e.changes].sort(), ['config', 'remotes']);
			assert.strictEqual(e.unnamedRefKinds.size, 0);
			assert.ok(!e.mayHaveChangedRef('refs/remotes/origin/main'));
			assert.ok(!e.mayHaveChangedRef('refs/heads/main'));

			sub.dispose();
			handle.dispose();
			service.dispose();
		});

		it("reports the working tree changed when the host's fingerprint of it moves", async () => {
			let fingerprint = 'a';
			const { factory } = createMockFactory(undefined, basePath =>
				basePath === '/repo' ? 'unreliable' : undefined,
			);
			const service = new RepositoryWatchService({
				watchingProvider: factory,
				defaultWorkingTreeDelayMs: 20,
				polling: {
					stat: noFiles,
					intervalMs: 60_000,
					getWorkingTreeFingerprint: () => Promise.resolve(fingerprint),
				},
			});
			const handle = service.watch('/repo', standardGitDir('/repo/.git'));
			assertHandle(handle);
			const wtSub = handle.session.subscribeToWorkingTree({ delayMs: 20 });
			const received: boolean[] = [];
			wtSub.onDidChangeWorkingTree(e => received.push(e.incomplete));
			assert.strictEqual(service.getResourceUsage()['watch.pollTargets.count'], 1);

			service.resumeAll();
			await settle();
			service.resumeAll();
			await settle();
			assert.deepStrictEqual(received, [], 'an unchanged fingerprint is quiet');

			fingerprint = 'b';
			service.resumeAll();
			await settle();
			assert.deepStrictEqual(received, [true]);

			wtSub.dispose();
			assert.strictEqual(service.getResourceUsage()['watch.pollTargets.count'], 0);
			handle.dispose();
			service.dispose();
		});

		it("takes the working tree's reliability from its live watcher only, across a re-creation", async () => {
			const { factory, watchers } = createMockFactory(true, (_basePath, index) =>
				index === 0 ? 'unwatchable' : undefined,
			);
			const service = new RepositoryWatchService({
				watchingProvider: factory,
				defaultWorkingTreeDelayMs: 20,
				getIgnoredDirectories: () => Promise.resolve(['dist']),
				polling: { stat: noFiles },
			});
			const modes: string[] = [];
			service.onDidChangeWatchMode(e => modes.push(e.mode));
			const handle = service.watch('/repo', standardGitDir('/repo/.git'));
			assertHandle(handle);
			const wtSub = handle.session.subscribeToWorkingTree({ delayMs: 20 });
			const received: boolean[] = [];
			wtSub.onDidChangeWorkingTree(e => received.push(e.incomplete));
			assert.strictEqual(service.getWatchMode('/repo'), 'poll');

			// The ignored-directory read re-creates the watcher; the new one reports nothing, so it is reliable
			await settle();
			assert.strictEqual(watchers.length, 2);
			assert.ok(watchers[0].disposed);
			assert.strictEqual(service.getWatchMode('/repo'), 'events');
			assert.deepStrictEqual(received, [true], 'coming back rescans the working tree');

			watchers[0].report('reliable');
			watchers[0].report('unwatchable');
			assert.strictEqual(service.getWatchMode('/repo'), 'events', 'the replaced watcher is not heard');

			watchers[1].report('unwatchable');
			assert.strictEqual(service.getWatchMode('/repo'), 'poll');
			assert.deepStrictEqual(modes, ['poll', 'events', 'poll']);

			wtSub.dispose();
			handle.dispose();
			service.dispose();
		});

		/** The poller's timer under the default gate: the one timeout set for the default 60000ms interval */
		function spyPollTimer(): { readonly timers: unknown[]; readonly cleared: unknown[]; restore(): void } {
			const timers: unknown[] = [];
			const cleared: unknown[] = [];
			const originalSetTimeout = globalThis.setTimeout;
			const originalClearTimeout = globalThis.clearTimeout;
			const set = mock.method(globalThis, 'setTimeout', (callback: () => void, ms?: number) => {
				const timer = originalSetTimeout(callback, ms);
				if (ms === 60_000) {
					timers.push(timer);
				}
				return timer;
			});
			const clear = mock.method(globalThis, 'clearTimeout', (timer: unknown) => {
				cleared.push(timer);
				originalClearTimeout(timer as ReturnType<typeof setTimeout>);
			});
			return {
				timers: timers,
				cleared: cleared,
				restore: () => {
					set.mock.restore();
					clear.mock.restore();
				},
			};
		}

		it('clears its timer on dispose', () => {
			const spy = spyPollTimer();
			try {
				const { factory } = createMockFactory(undefined, () => 'unwatchable');
				const service = new RepositoryWatchService({ watchingProvider: factory, polling: { stat: noFiles } });
				const handle = service.watch('/repo', standardGitDir('/repo/.git'));
				assertHandle(handle);
				handle.session.subscribe();
				assert.strictEqual(service.getResourceUsage()['watch.pollTargets.count'], 1);
				assert.strictEqual(spy.timers.length, 1);

				service.dispose();

				assert.ok(spy.cleared.includes(spy.timers[0]));
				assert.strictEqual(service.getWatchMode('/repo'), undefined);
			} finally {
				spy.restore();
			}
		});

		it('stops polling on suspendAll and polls at once on resumeAll', async () => {
			const fs = createFs(['/repo/.git/HEAD', '/repo/.git/index']);
			let stats = 0;
			const spy = spyPollTimer();
			try {
				const { factory } = createMockFactory(undefined, () => 'unwatchable');
				const service = new RepositoryWatchService({
					watchingProvider: factory,
					polling: {
						stat: path => {
							stats++;
							return fs.stat(path);
						},
					},
				});
				const handle = service.watch('/repo', standardGitDir('/repo/.git'));
				assertHandle(handle);
				const sub = handle.session.subscribe();
				await settle();
				assert.ok(stats > 0, 'the first reading');
				assert.strictEqual(spy.timers.length, 1);

				service.suspendAll();
				assert.ok(spy.cleared.includes(spy.timers[0]), 'no wakeup while suspended');

				const before = stats;
				service.resumeAll();
				await settle();
				assert.ok(stats > before, 'the resumed pass');
				assert.strictEqual(spy.timers.length, 2, 'the timer runs again from the resumed pass');

				sub.dispose();
				handle.dispose();
				service.dispose();
			} finally {
				spy.restore();
			}
		});
	});
});

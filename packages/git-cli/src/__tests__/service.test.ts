import * as assert from 'assert';
import type { MergeTargetsChangeEvent } from '@gitlens/git/cache.js';
import { Cache } from '@gitlens/git/cache.js';
import type { FileSystemProvider } from '@gitlens/git/context.js';
import { FileType } from '@gitlens/git/context.js';
import type { GitService } from '@gitlens/git/service.js';
import type { WatcherRepoChangeEvent } from '@gitlens/git/watching/changeEvent.js';
import type { FileWatchEvent, FileWatchingProvider } from '@gitlens/git/watching/provider.js';
import { createDisposable } from '@gitlens/utils/disposable.js';
import { first } from '@gitlens/utils/iterable.js';
import { normalizePath } from '@gitlens/utils/path.js';
import { fileUri, toFsPath } from '@gitlens/utils/uri.js';
import { CliGitProvider } from '../cliGitProvider.js';
import { createCliGitService } from '../service.js';

suite('createCliGitService — watch bridging', () => {
	const repoPath = '/test/repo';

	let cache: Cache;
	let service: GitService;
	let watchers: { basePath: string; fire: (event: FileWatchEvent) => void }[];

	setup(() => {
		cache = new Cache();
		watchers = [];
		const watchingProvider: FileWatchingProvider = {
			createWatcher: function (basePath, _pattern, onEvent) {
				watchers.push({ basePath: basePath, fire: onEvent });
				return createDisposable(() => {});
			},
		};
		service = createCliGitService({
			context: { fs: {} as unknown as FileSystemProvider },
			locator: async () => ({ path: '/nonexistent/git-binary', version: '2.40.0' }),
			cache: cache,
			watchingProvider: watchingProvider,
		});
	});

	teardown(() => {
		service.dispose();
		cache.dispose();
	});

	test('a FETCH_HEAD change drops the cached last-fetched time', async () => {
		let reads = 0;
		const read = () => cache.getLastFetchedTimestamp(repoPath, () => ++reads);

		assert.strictEqual(await read(), 1);
		assert.strictEqual(await read(), 1, 'served from the cache until something changes');

		const handle = service.watchService!.watch(repoPath, { uri: fileUri(`${repoPath}/.git`) });
		assert.ok(handle != null);
		const sub = handle.session.subscribe();

		const gitDirWatcher = watchers.find(w => w.basePath === fileUri(`${repoPath}/.git`).fsPath);
		assert.ok(gitDirWatcher != null);
		gitDirWatcher.fire({ path: `${gitDirWatcher.basePath}/FETCH_HEAD`, reason: 'change' });

		assert.strictEqual(await read(), 2);

		sub.dispose();
		handle.dispose();
	});

	test('an announced kind is not evicted again when its event fires; a raw kind beside it is', async () => {
		const provider = first(service.getProviders());
		assert.ok(provider instanceof CliGitProvider);

		const handle = service.watchService!.watch(repoPath, { uri: fileUri(`${repoPath}/.git`) });
		assert.ok(handle != null);
		const sub = handle.session.subscribe();
		const fired = new Promise<WatcherRepoChangeEvent>(resolve => {
			const listener = service.watchService!.onDidChangeRepository(e => {
				listener.dispose();
				resolve(e);
			});
		});

		let reads = 0;
		const read = () => cache.getLastFetchedTimestamp(repoPath, () => ++reads);
		assert.strictEqual(await read(), 1);

		provider.notifyChanged(repoPath, ['lastFetched']);
		// The host's re-read after the announcement, inside the debounce window
		assert.strictEqual(await read(), 2);

		const gitDirWatcher = watchers.find(w => w.basePath === fileUri(`${repoPath}/.git`).fsPath);
		assert.ok(gitDirWatcher != null);
		gitDirWatcher.fire({ path: `${gitDirWatcher.basePath}/refs/heads/main`, reason: 'change' });
		const generation = cache.getStatusGeneration(repoPath);

		const e = await fired;
		assert.deepStrictEqual([...e.announced], ['lastFetched']);
		assert.ok(e.changed('heads'));

		assert.strictEqual(await read(), 2, 'the re-read survives the announced-only kind');
		assert.strictEqual(cache.getStatusGeneration(repoPath), generation + 1, 'the raw heads change still applies');

		sub.dispose();
		handle.dispose();
	});

	test('an announced-only event evicts nothing', async () => {
		const provider = first(service.getProviders());
		assert.ok(provider instanceof CliGitProvider);

		const handle = service.watchService!.watch(repoPath, { uri: fileUri(`${repoPath}/.git`) });
		assert.ok(handle != null);
		const sub = handle.session.subscribe();
		const fired = new Promise<WatcherRepoChangeEvent>(resolve => {
			const listener = service.watchService!.onDidChangeRepository(e => {
				listener.dispose();
				resolve(e);
			});
		});

		let reads = 0;
		const read = () => cache.getLastFetchedTimestamp(repoPath, () => ++reads);

		provider.notifyChanged(repoPath, ['heads', 'lastFetched']);
		assert.strictEqual(await read(), 1);
		const generation = cache.getStatusGeneration(repoPath);

		const e = await fired;
		assert.deepStrictEqual(new Set(e.announced), new Set(['heads', 'lastFetched']));

		assert.strictEqual(await read(), 1, 'the re-read after the announcement is kept');
		assert.strictEqual(cache.getStatusGeneration(repoPath), generation, 'the status clock does not advance again');

		sub.dispose();
		handle.dispose();
	});

	test('forwards merge-target changes once, even from two providers sharing one cache', async () => {
		const received: MergeTargetsChangeEvent[] = [];
		service.onDidChangeMergeTargets(e => received.push(e));

		const second = new CliGitProvider({
			context: { fs: {} as unknown as FileSystemProvider },
			locator: async () => ({ path: '/nonexistent/git-binary', version: '2.40.0' }),
			cache: cache,
		});
		const registration = service.register(second, () => false);

		// No baseline was ever read, so whatever the reconcile finds, any branch may have changed
		cache.onRepositoryChanged(repoPath, ['gkConfig']);
		await new Promise(resolve => setTimeout(resolve, 50));

		assert.deepStrictEqual(received, [{ repoPath: repoPath, refs: undefined }]);

		registration.dispose();
		second.dispose();
	});
});

suite('createCliGitService — worktree admin entries', () => {
	const repoPath = '/test/repo';

	test('lists only the directories in the worktrees directory as admin entries', async () => {
		const reads: string[] = [];
		const fs: FileSystemProvider = {
			readDirectory: uri =>
				Promise.resolve(
					normalizePath(toFsPath(uri)) === `${repoPath}/.git/worktrees`
						? [
								['A', FileType.Directory],
								['.DS_Store', FileType.File],
							]
						: [],
				),
			readFile: uri => {
				const path = normalizePath(toFsPath(uri));
				reads.push(path);
				return path === `${repoPath}/.git/worktrees/A/gitdir`
					? Promise.resolve(new TextEncoder().encode('/worktrees/A/.git\n'))
					: Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
			},
			stat: uri =>
				Promise.resolve(
					normalizePath(toFsPath(uri)) === `${repoPath}/.git`
						? { type: FileType.Directory, ctime: 0, mtime: 0, size: 0 }
						: undefined,
				),
		};
		const service = createCliGitService({
			context: { fs: fs },
			locator: async () => ({ path: '/nonexistent/git-binary', version: '2.40.0' }),
			watchingProvider: { createWatcher: () => createDisposable(() => {}) },
			ignoredWorktreeFolders: ['sync-tools-worktrees'],
		});
		try {
			const handle = service.watchService!.watch(repoPath, { uri: fileUri(`${repoPath}/.git`) });
			assert.ok(handle != null);
			const sub = handle.session.subscribe();

			// The entries are listed and read as the watch starts, past a real `realpath` of the common git dir
			for (let i = 0; i < 1000 && !reads.includes(`${repoPath}/.git/worktrees/A/gitdir`); i++) {
				await new Promise(resolve => setImmediate(resolve));
			}

			assert.ok(reads.includes(`${repoPath}/.git/worktrees/A/gitdir`));
			assert.ok(!reads.some(r => r.includes('.DS_Store')), `read ${reads.join(', ')}`);

			sub.dispose();
			handle.dispose();
		} finally {
			service.dispose();
		}
	});
});

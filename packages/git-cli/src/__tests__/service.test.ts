import * as assert from 'assert';
import type { MergeTargetsChangeEvent } from '@gitlens/git/cache.js';
import { Cache } from '@gitlens/git/cache.js';
import type { FileSystemProvider } from '@gitlens/git/context.js';
import type { GitService } from '@gitlens/git/service.js';
import type { FileWatchEvent, FileWatchingProvider } from '@gitlens/git/watching/provider.js';
import { createDisposable } from '@gitlens/utils/disposable.js';
import { fileUri } from '@gitlens/utils/uri.js';
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

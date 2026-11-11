import * as assert from 'assert';
import { resolve } from 'node:path';
import { env } from 'node:process';
import { Cache } from '@gitlens/git/cache.js';
import type { FileSystemProvider } from '@gitlens/git/context.js';
import { normalizePath } from '@gitlens/utils/path.js';
import { fileUri, toFsPath } from '@gitlens/utils/uri.js';
import { CliGitProvider } from '../cliGitProvider.js';
import { Git } from '../exec/git.js';

suite('CliGitProvider — ignore rules that change while nothing watches the repository', () => {
	const repoPath = normalizePath(resolve('/test/repo'));
	const locator = async () => ({ path: '/nonexistent/git-binary', version: '2.40.0' });
	const kept = fileUri(`${repoPath}/kept.txt`);
	const dropped = fileUri(`${repoPath}/dropped.txt`);

	let cache: Cache;
	let provider: CliGitProvider;
	let files: Map<string, { content: string; mtime: number }>;
	let savedXdg: string | undefined;

	/** Rewrites `.gitignore` with the same length of content, so only its modified time says it changed */
	function ignore(name: 'kept.txt' | 'dropped.txt', mtime: number): void {
		files.set(`${repoPath}/.gitignore`, { content: `${name}\n`.padEnd(13), mtime: mtime });
	}

	setup(() => {
		// No global excludes file to read from the machine running the test
		savedXdg = env.XDG_CONFIG_HOME;
		env.XDG_CONFIG_HOME = normalizePath(resolve('/test/xdg'));

		cache = new Cache();
		cache.registerRepoPath(fileUri(repoPath), { uri: fileUri(`${repoPath}/.git`) });

		files = new Map();
		const fs: FileSystemProvider = {
			readDirectory: () => Promise.resolve([]),
			readFile: uri => {
				const file = files.get(normalizePath(toFsPath(uri)));
				return file != null
					? Promise.resolve(new TextEncoder().encode(file.content))
					: Promise.reject(new Error(`ENOENT: ${toFsPath(uri)}`));
			},
			stat: uri => {
				const file = files.get(normalizePath(toFsPath(uri)));
				return Promise.resolve(
					file != null ? { type: 1, ctime: 0, mtime: file.mtime, size: file.content.length } : undefined,
				);
			},
		};
		provider = new CliGitProvider({
			cache: cache,
			// A nonexistent binary fails every run fast, leaving the root `.gitignore` as the only rules read
			git: new Git(locator),
			locator: locator,
			context: { fs: fs, hooks: {} },
		});
	});

	teardown(() => {
		provider.dispose();
		cache.dispose();
		if (savedXdg == null) {
			Reflect.deleteProperty(env, 'XDG_CONFIG_HOME');
		} else {
			env.XDG_CONFIG_HOME = savedXdg;
		}
	});

	test('excludeIgnoredUris reflects a changed .gitignore', async () => {
		ignore('dropped.txt', 1);
		assert.deepStrictEqual(await provider.excludeIgnoredUris(repoPath, [kept, dropped]), [kept]);

		ignore('kept.txt', 2);
		assert.deepStrictEqual(await provider.excludeIgnoredUris(repoPath, [kept, dropped]), [dropped]);
	});

	test('getIgnoredUrisFilter reflects a changed .gitignore', async () => {
		ignore('dropped.txt', 1);
		const before = await provider.getIgnoredUrisFilter(repoPath);
		assert.deepStrictEqual([before(kept), before(dropped)], [false, true]);

		ignore('kept.txt', 2);
		const after = await provider.getIgnoredUrisFilter(repoPath);
		assert.deepStrictEqual([after(kept), after(dropped)], [true, false]);
	});

	test('an unchanged .gitignore keeps answering the same', async () => {
		ignore('dropped.txt', 1);
		assert.deepStrictEqual(await provider.excludeIgnoredUris(repoPath, [kept, dropped]), [kept]);
		assert.deepStrictEqual(await provider.excludeIgnoredUris(repoPath, [kept, dropped]), [kept]);
	});
});

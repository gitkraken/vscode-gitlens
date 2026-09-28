import * as assert from 'assert';
import * as sinon from 'sinon';
import type { CachedGitTypes } from '@gitlens/git/cache.js';
import { Cache } from '@gitlens/git/cache.js';
import type { FileSystemProvider } from '@gitlens/git/context.js';
import type { RepositoryChange } from '@gitlens/git/models/repository.js';
import { fileUri } from '@gitlens/utils/uri.js';
import { CliGitProvider } from '../cliGitProvider.js';
import { Git } from '../exec/git.js';

type PendingCommand = { cwd: string | undefined; promise: Promise<unknown> };

suite('CliGitProvider — what an announced change resets', () => {
	const repoPath = '/test/repo';
	const worktreePath = '/test/repo-wt';
	const otherPath = '/test/other';
	const locator = async () => ({ path: '/nonexistent/git-binary', version: '2.40.0' });

	let cache: Cache;
	let git: Git;
	let provider: CliGitProvider;
	let resets: [string, CachedGitTypes[]][];
	let changed: [string, RepositoryChange[]][];

	setup(() => {
		cache = new Cache();
		cache.registerRepoPath(fileUri(repoPath), { uri: fileUri(`${repoPath}/.git`) });
		cache.registerRepoPath(fileUri(worktreePath), {
			uri: fileUri(`${repoPath}/.git/worktrees/wt`),
			commonUri: fileUri(`${repoPath}/.git`),
		});
		cache.registerRepoPath(fileUri(otherPath), { uri: fileUri(`${otherPath}/.git`) });

		// A nonexistent binary fails every run fast without spawning anything; `notify` still applies once it settles
		git = new Git(locator);
		resets = [];
		changed = [];
		provider = new CliGitProvider({
			cache: cache,
			git: git,
			locator: locator,
			context: {
				fs: {} as unknown as FileSystemProvider,
				hooks: {
					cache: { onReset: (path, ...types) => resets.push([path, types]) },
					repository: { onChanged: (path, changes) => changed.push([path, changes]) },
				},
			},
		});

		cache.blame.set(repoPath, 'file.ts', Promise.resolve(undefined));
		cache.branches.set(repoPath, Promise.resolve({ values: [] }));
		cache.tags.set(repoPath, Promise.resolve({ values: [] }));
		cache.worktrees.set(repoPath, Promise.resolve([]));
		cache.stashes.set(repoPath, 'all', Promise.resolve({ repoPath: repoPath, stashes: new Map() }));
	});

	teardown(() => {
		provider.dispose();
		cache.dispose();
	});

	/** Seeds one in-flight run per cwd, keyed the way `Git.runCore` keys them, and returns the map. */
	function seedPending(cwds: string[]): Map<string, PendingCommand> {
		const pending = (git as unknown as { pendingCommands: Map<string, PendingCommand> }).pendingCommands;
		for (const cwd of cwds) {
			pending.set(`[${cwd}] git status`, { cwd: cwd, promise: new Promise(() => {}) });
		}
		return pending;
	}

	test("notify: ['index'] resets only what the index feeds and advances the status clock", async () => {
		await git.run({ cwd: repoPath, errors: 'ignore', notify: ['index'] }, 'add', 'file.ts');

		assert.strictEqual(resets.length, 1);
		assert.strictEqual(resets[0][0], repoPath);
		assert.deepStrictEqual([...resets[0][1]].sort(), ['blame', 'diff', 'fileLog', 'tracking']);
		assert.strictEqual(cache.getStatusGeneration(repoPath), 1);
		assert.strictEqual(cache.blame.get(repoPath, 'file.ts'), undefined);
		assert.ok(cache.branches.has(repoPath), 'branches must survive an index change');
		assert.ok(cache.tags.has(repoPath), 'tags must survive an index change');
		assert.ok(cache.worktrees.has(repoPath), 'worktrees must survive an index change');
		assert.notStrictEqual(cache.stashes.get(repoPath, 'all'), undefined, 'stashes must survive an index change');
		assert.deepStrictEqual(changed, [[repoPath, ['index']]]);
	});

	test('an empty change list still resets everything', () => {
		provider.notifyChanged(repoPath, []);

		assert.deepStrictEqual(resets, [[repoPath, []]]);
		assert.strictEqual(cache.blame.get(repoPath, 'file.ts'), undefined);
		assert.ok(!cache.branches.has(repoPath));
		assert.ok(!cache.worktrees.has(repoPath));
	});

	test("'unknown' alone resets everything without closing the repository", () => {
		provider.notifyChanged(repoPath, ['unknown']);

		assert.deepStrictEqual(resets, [[repoPath, []]]);
		assert.ok(!cache.branches.has(repoPath));
		assert.ok(cache.isRegistered(repoPath), 'a raw write is not the repository closing');
	});

	test("'unknown' beside known kinds still resets everything", () => {
		provider.notifyChanged(repoPath, ['index', 'unknown']);

		assert.deepStrictEqual(resets, [[repoPath, []]]);
		assert.ok(!cache.branches.has(repoPath));
	});

	test('an explicit cache option wins over the types the changes map to', () => {
		provider.notifyChanged(repoPath, ['index'], { cache: ['tags'] });

		assert.deepStrictEqual(resets, [[repoPath, ['tags']]]);
		assert.ok(!cache.tags.has(repoPath));
		assert.notStrictEqual(cache.blame.get(repoPath, 'file.ts'), undefined);
	});

	test('a change that maps to no cache type resets nothing but is still announced', () => {
		const pending = seedPending([repoPath]);

		provider.notifyChanged(repoPath, ['starred']);

		assert.deepStrictEqual(resets, []);
		assert.ok(cache.branches.has(repoPath));
		assert.strictEqual(pending.size, 1);
		assert.deepStrictEqual(changed, [[repoPath, ['starred']]]);
	});

	test("a write drops its own repository's pending runs, a sibling worktree's included, and no one else's", () => {
		const pending = seedPending([repoPath, `${repoPath}/sub`, worktreePath, otherPath]);

		provider.notifyChanged(repoPath, ['index']);

		assert.deepStrictEqual(
			Array.from(pending.values(), p => p.cwd),
			[otherPath],
		);
	});

	test("a typed write's reset drops only its own repository's pending runs", () => {
		const pending = seedPending([repoPath, worktreePath, otherPath]);

		provider.context.hooks?.cache?.onReset?.(worktreePath, 'branches');

		assert.deepStrictEqual(
			Array.from(pending.values(), p => p.cwd),
			[otherPath],
		);
	});

	test('a -C shared-state write into a sibling worktree drops pending runs once, and resets and announces both paths', async () => {
		const clearPending = sinon.spy(git, 'clearPendingCommands');
		try {
			await git.run(
				{ cwd: repoPath, errors: 'ignore', notify: 'infer' },
				'-C',
				worktreePath,
				'branch',
				'-d',
				'x',
			);

			assert.deepStrictEqual(
				resets.map(([path]) => path),
				[worktreePath, repoPath],
				'a host may keep per-worktree state, so each path is reset',
			);
			assert.strictEqual(clearPending.callCount, 1, 'one repository, one pending clear');
			assert.deepStrictEqual(
				changed.map(([path]) => path),
				[worktreePath, repoPath],
				'hosts listen per path, so each path is still announced',
			);
		} finally {
			clearPending.restore();
		}
	});

	test("a gkConfig change drops the repository's pending runs, so its re-read never joins a pre-write one", () => {
		const pending = seedPending([repoPath, otherPath]);

		provider.notifyChanged(repoPath, ['gkConfig']);

		assert.deepStrictEqual(
			Array.from(pending.values(), p => p.cwd),
			[otherPath],
		);
	});

	test('a -C shared-state write into an unrelated repository resets both', async () => {
		await git.run({ cwd: repoPath, errors: 'ignore', notify: 'infer' }, '-C', otherPath, 'branch', '-d', 'x');

		assert.deepStrictEqual(
			resets.map(([path]) => path),
			[otherPath, repoPath],
		);
	});
});

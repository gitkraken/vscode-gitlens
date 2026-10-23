import * as assert from 'assert';
import { resolve } from 'node:path';
import * as sinon from 'sinon';
import type { CachedGitTypes } from '@gitlens/git/cache.js';
import { Cache } from '@gitlens/git/cache.js';
import type { FileSystemProvider } from '@gitlens/git/context.js';
import type { RepositoryChange } from '@gitlens/git/models/repository.js';
import { normalizePath } from '@gitlens/utils/path.js';
import { fileUri, toFsPath } from '@gitlens/utils/uri.js';
import { CliGitProvider } from '../cliGitProvider.js';
import type { CommandChanges } from '../exec/commandClassifier.js';
import { Git } from '../exec/git.js';

type PendingCommand = { cwd: string | undefined; promise: Promise<unknown> };
/** One `repository.onChanged` call: its refs and options only when given */
type Changed =
	| [string, RepositoryChange[]]
	| [string, RepositoryChange[], readonly string[]]
	| [string, RepositoryChange[], readonly string[], { readonly configConfinedToRefs?: boolean }];

suite('CliGitProvider — what an announced change resets', () => {
	// Absolute on this platform (a drive is added on Windows), as real repository paths are: a `-C` path is
	// resolved against the working directory, which would otherwise give it a drive the bare paths lack.
	const repoPath = normalizePath(resolve('/test/repo'));
	const worktreePath = normalizePath(resolve('/test/repo-wt'));
	const otherPath = normalizePath(resolve('/test/other'));
	const locator = async () => ({ path: '/nonexistent/git-binary', version: '2.40.0' });

	let cache: Cache;
	let git: Git;
	let provider: CliGitProvider;
	let resets: [string, CachedGitTypes[]][];
	let changed: Changed[];
	/** The files the provider's `fs` serves, by normalized path; a directory is `null` */
	let files: Map<string, string | null>;

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
		files = new Map();
		const fs: FileSystemProvider = {
			readDirectory: () => Promise.resolve([]),
			readFile: uri => {
				const content = files.get(normalizePath(toFsPath(uri)));
				return content != null
					? Promise.resolve(new TextEncoder().encode(content))
					: Promise.reject(new Error(`ENOENT: ${toFsPath(uri)}`));
			},
			stat: uri => {
				const path = normalizePath(toFsPath(uri));
				if (!files.has(path)) return Promise.resolve(undefined);

				return Promise.resolve({ type: files.get(path) == null ? 2 : 1, ctime: 0, mtime: 0, size: 0 });
			},
		};
		provider = new CliGitProvider({
			cache: cache,
			git: git,
			locator: locator,
			context: {
				fs: fs,
				hooks: {
					cache: { onReset: (path, ...types) => resets.push([path, types]) },
					repository: {
						onChanged: (path, changes, refs, options) => {
							if (refs == null) {
								changed.push([path, changes]);
							} else if (options == null) {
								changed.push([path, changes, refs]);
							} else {
								changed.push([path, changes, refs, options]);
							}
						},
					},
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
	suite('names a raw write announces', () => {
		const moveHead: CommandChanges = {
			changes: ['head', 'heads', 'index', 'pausedOp'],
			sharedChanges: ['heads'],
			movesHeadBranch: true,
		};

		/** Makes `notify: 'infer'` classify every argv as `classified`, whatever the classifier makes of it today */
		function classifyAs(classified: CommandChanges): void {
			(git as unknown as { _classify: () => CommandChanges })._classify = () => classified;
		}

		test('reach the path it ran in whole, and its siblings as the shared refs among them', async () => {
			classifyAs({
				changes: ['heads', 'index'],
				sharedChanges: ['heads'],
				refs: ['refs/heads/main', 'refs/tags/v1'],
			});
			const announced: { repoPath: string; refs?: readonly string[] }[] = [];
			const listener = provider.onDidAnnounceChanges(e => announced.push({ repoPath: e.repoPath, refs: e.refs }));
			try {
				await git.run({ cwd: repoPath, errors: 'ignore', notify: 'infer' }, 'commit', '-m', 'msg');
			} finally {
				listener.dispose();
			}

			assert.deepStrictEqual(changed, [
				[repoPath, ['heads', 'index'], ['refs/heads/main', 'refs/tags/v1']],
				// `tags` isn't among the changes, so its name isn't one a sibling hears
				[worktreePath, ['heads'], ['refs/heads/main']],
			]);
			assert.deepStrictEqual(announced, [
				{ repoPath: repoPath, refs: ['refs/heads/main', 'refs/tags/v1'] },
				{ repoPath: worktreePath, refs: ['refs/heads/main'] },
			]);
		});

		test('reach both paths of a -C shared-state write, with its config confinement', async () => {
			classifyAs({
				changes: ['config', 'heads'],
				pathOverride: worktreePath,
				sharedChanges: ['config', 'heads'],
				refs: ['refs/heads/x'],
				configConfinedToRefs: true,
			});

			await git.run(
				{ cwd: repoPath, errors: 'ignore', notify: 'infer' },
				'-C',
				worktreePath,
				'branch',
				'-d',
				'x',
			);

			assert.deepStrictEqual(changed, [
				[worktreePath, ['config', 'heads'], ['refs/heads/x'], { configConfinedToRefs: true }],
				[repoPath, ['config', 'heads'], ['refs/heads/x'], { configConfinedToRefs: true }],
			]);
		});

		test("reach a -C write's cwd as the shared refs, beside the shared part of its changes", async () => {
			classifyAs({
				changes: ['head', 'heads', 'index'],
				pathOverride: worktreePath,
				sharedChanges: ['heads'],
				refs: ['refs/heads/feature'],
			});

			await git.run(
				{ cwd: repoPath, errors: 'ignore', notify: 'infer' },
				'-C',
				worktreePath,
				'commit',
				'-m',
				'msg',
			);

			assert.deepStrictEqual(changed, [
				[worktreePath, ['head', 'heads', 'index'], ['refs/heads/feature']],
				[repoPath, ['heads'], ['refs/heads/feature']],
			]);
		});

		test("name the branch HEAD stayed on, read from the worktree's own HEAD file", async () => {
			classifyAs(moveHead);
			files.set(`${repoPath}/.git`, null);
			files.set(`${repoPath}/.git/HEAD`, 'ref: refs/heads/main\n');

			await git.run({ cwd: repoPath, errors: 'ignore', notify: 'infer' }, 'commit', '-m', 'msg');

			assert.deepStrictEqual(changed, [
				[repoPath, ['head', 'heads', 'index', 'pausedOp'], ['refs/heads/main']],
				[worktreePath, ['heads'], ['refs/heads/main']],
			]);
		});

		test('a linked worktree its .git file points to is read the same way', async () => {
			classifyAs({ ...moveHead, pathOverride: worktreePath });
			files.set(`${worktreePath}/.git`, `gitdir: ${repoPath}/.git/worktrees/wt\n`);
			files.set(`${repoPath}/.git/worktrees/wt/HEAD`, 'ref: refs/heads/feature\n');

			await git.run(
				{ cwd: repoPath, errors: 'ignore', notify: 'infer' },
				'-C',
				worktreePath,
				'commit',
				'-m',
				'msg',
			);

			assert.deepStrictEqual(changed, [
				[worktreePath, ['head', 'heads', 'index', 'pausedOp'], ['refs/heads/feature']],
				[repoPath, ['heads'], ['refs/heads/feature']],
			]);
		});

		test('a detached HEAD moving announces no branch move, so no sibling hears of it', async () => {
			classifyAs(moveHead);
			files.set(`${repoPath}/.git`, null);
			files.set(`${repoPath}/.git/HEAD`, `${'a'.repeat(40)}\n`);

			await git.run({ cwd: repoPath, errors: 'ignore', notify: 'infer' }, 'commit', '-m', 'msg');

			assert.deepStrictEqual(changed, [[repoPath, ['head', 'index', 'pausedOp']]]);
			assert.ok(!cache.branches.has(repoPath), "the branch list shows the detached HEAD, so it's read again");
		});

		test("a reftable repository's placeholder HEAD, or none at all, leaves the branch move unnamed", async () => {
			classifyAs(moveHead);
			files.set(`${repoPath}/.git`, null);
			files.set(`${repoPath}/.git/HEAD`, 'ref: refs/heads/.invalid\n');

			await git.run({ cwd: repoPath, errors: 'ignore', notify: 'infer' }, 'commit', '-m', 'msg');
			files.clear();
			await git.run({ cwd: repoPath, errors: 'ignore', notify: 'infer' }, 'commit', '-m', 'msg');

			assert.deepStrictEqual(changed, [
				[repoPath, ['head', 'heads', 'index', 'pausedOp']],
				[worktreePath, ['heads']],
				[repoPath, ['head', 'heads', 'index', 'pausedOp']],
				[worktreePath, ['heads']],
			]);
		});
	});
});

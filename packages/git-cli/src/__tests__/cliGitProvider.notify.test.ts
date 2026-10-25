import * as assert from 'assert';
import { promises as nodeFsPromises } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import * as sinon from 'sinon';
import type { CachedGitTypes } from '@gitlens/git/cache.js';
import { Cache } from '@gitlens/git/cache.js';
import type { FileSystemProvider } from '@gitlens/git/context.js';
import type { RepositoryChange } from '@gitlens/git/models/repository.js';
import { getIgnoredWorktreeFolderExcludes } from '@gitlens/git/watching/watcherPatterns.js';
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

	test("a lock's worktree-list-only reset and announcement keep every pending run joinable", () => {
		const pending = seedPending([repoPath, worktreePath, otherPath]);

		provider.context.hooks?.cache?.onReset?.(worktreePath, 'worktreeList');
		provider.notifyChanged(worktreePath, ['worktrees']);

		assert.deepStrictEqual(
			Array.from(pending.values(), p => p.cwd),
			[repoPath, worktreePath, otherPath],
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

	test("a worktree write's HEAD reaches each sibling announced, which evicts none of the shared caches for it", async () => {
		const applied = sinon.spy(cache, 'applyRepositoryChanges');
		const announced: [string, RepositoryChange[]][] = [];
		const listener = provider.onDidAnnounceChanges(e => announced.push([e.repoPath, [...e.changes]]));
		try {
			provider.context.hooks?.repository?.onChanged?.(repoPath, ['worktrees', 'worktreeHead']);
		} finally {
			listener.dispose();
			applied.restore();
		}

		// The sibling's watcher reports the entry's HEAD too, so it must be announced there to be taken for the echo
		assert.deepStrictEqual(announced, [
			[repoPath, ['worktrees', 'worktreeHead']],
			[worktreePath, ['worktrees', 'worktreeHead']],
		]);
		assert.deepStrictEqual(changed, announced);

		const siblingCall = applied.getCalls().find(c => c.args[0] === worktreePath);
		assert.ok(siblingCall);
		assert.deepStrictEqual(siblingCall.args.slice(1), [
			['worktrees', 'worktreeHead'],
			'evict',
			{ worktreeOnly: true },
		]);

		// What that reset evicts on its own: the shared caches it names were evicted by the writer's reset before it
		const gitResult = {
			stdout: 'x',
			stderr: undefined,
			exitCode: 0,
			completion: { status: 'exited', code: 0 },
		} as const;
		let gitResultReads = 0;
		const readGitResult = () =>
			cache.gitResults.getOrCreate(worktreePath, 'git status', () => {
				gitResultReads++;
				return Promise.resolve(gitResult);
			});
		let mergeTargetReads = 0;
		const readMergeTarget = () =>
			cache.getMergeTarget(worktreePath, 'refs/heads/feature', () => {
				mergeTargetReads++;
				return {
					result: undefined,
					selfAtTip: false,
					tips: [],
					replaced: '',
					shallow: null,
					configKey: undefined,
					stored: undefined,
					evictOnCheckout: true,
				};
			});
		cache.worktrees.set(repoPath, Promise.resolve([]));
		await readGitResult();
		await readMergeTarget();

		cache.applyRepositoryChanges(worktreePath, ['worktrees', 'worktreeHead'], 'evict', { worktreeOnly: true });

		await readGitResult();
		await readMergeTarget();
		assert.strictEqual(gitResultReads, 1, "the sibling's git results are kept");
		assert.strictEqual(mergeTargetReads, 1, 'the merge targets are kept');
		assert.ok(cache.worktrees.has(repoPath), 'the shared worktree list is kept');
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

	suite('ignored worktree folders', () => {
		const ignored = `${repoPath}/.git/sync-tools-worktrees/x`;
		// Inside the git dir, but under no folder the host registered: a user's own worktree
		const inGitDir = `${repoPath}/.git/my-worktrees/x`;

		test("a worktree under a registered folder of a linked worktree's common git dir announces nothing", async () => {
			const ownGit = new Git(locator);
			const ownChanged: [string, RepositoryChange[]][] = [];
			const registering = new CliGitProvider({
				cache: cache,
				git: ownGit,
				locator: locator,
				context: {
					fs: provider.context.fs,
					hooks: { repository: { onChanged: (path, changes) => ownChanged.push([path, changes]) } },
				},
				ignoredWorktreeFolders: ['sync-tools-worktrees'],
			});

			// The linked worktree's `.git` file leads to its admin entry, whose `commondir` leads to the shared git dir
			files.set(`${worktreePath}/.git`, `gitdir: ${repoPath}/.git/worktrees/wt\n`);
			files.set(`${repoPath}/.git/worktrees/wt/commondir`, '../..\n');

			try {
				await ownGit.run(
					{ cwd: worktreePath, errors: 'ignore', notify: 'infer' },
					'worktree',
					'remove',
					ignored,
				);
				assert.strictEqual(ownChanged.length, 0);

				await ownGit.run(
					{ cwd: worktreePath, errors: 'ignore', notify: 'infer' },
					'worktree',
					'remove',
					inGitDir,
				);
				assert.ok(ownChanged.some(([path, changes]) => path === worktreePath && changes.includes('worktrees')));
				// The common git dir doesn't exist on disk, so it has no resolved spelling
				assert.deepStrictEqual(await registering.getIgnoredWorktreeRoots(worktreePath), [
					`${repoPath}/.git/sync-tools-worktrees`,
				]);
				assert.deepStrictEqual(registering.getIgnoredWorktreeFolders(worktreePath), ['sync-tools-worktrees']);
			} finally {
				registering.dispose();
			}
		});

		test('drops a folder that is no literal path inside the common git dir, for its roots and the watcher alike', async () => {
			const registering = new CliGitProvider({
				git: new Git(locator),
				locator: locator,
				context: { fs: provider.context.fs },
				ignoredWorktreeFolders: [
					'/elsewhere',
					'../outside',
					'tools/../../outside',
					'build-*',
					'(refs|x)',
					'worktrees/x',
					'c:x',
					'sync-tools-worktrees',
					'refs/sync',
				],
			});
			files.set(`${repoPath}/.git`, null);

			try {
				const folders = registering.getIgnoredWorktreeFolders(repoPath);
				assert.deepStrictEqual(folders, ['sync-tools-worktrees', 'refs/sync']);
				assert.deepStrictEqual(await registering.getIgnoredWorktreeRoots(repoPath), [
					`${repoPath}/.git/sync-tools-worktrees`,
					`${repoPath}/.git/refs/sync`,
				]);
				// One under `refs` is still ignored, but stays watched: the `.git` watch reads every ref there
				assert.deepStrictEqual(getIgnoredWorktreeFolderExcludes(folders), ['sync-tools-worktrees']);
			} finally {
				registering.dispose();
			}
		});

		/** A provider registering sync-tools' folder, over its own cache and the suite's files, counting each fs call */
		function createCountingProvider(): { registering: CliGitProvider; ownCache: Cache; reads: string[] } {
			const reads: string[] = [];
			const fs = provider.context.fs;
			const ownCache = new Cache();
			const registering = new CliGitProvider({
				cache: ownCache,
				git: new Git(locator),
				locator: locator,
				context: {
					fs: {
						readDirectory: uri => {
							reads.push(toFsPath(uri));
							return fs.readDirectory(uri);
						},
						readFile: uri => {
							reads.push(toFsPath(uri));
							return fs.readFile(uri);
						},
						stat: uri => {
							reads.push(toFsPath(uri));
							return fs.stat(uri);
						},
					},
				},
				ignoredWorktreeFolders: ['sync-tools-worktrees'],
			});
			return { registering: registering, ownCache: ownCache, reads: reads };
		}

		test('reads the roots once per common git dir, and nothing once the git dir is cached', async () => {
			const { registering, ownCache, reads } = createCountingProvider();
			ownCache.gitDir.set(repoPath, { uri: fileUri(`${repoPath}/.git`) });
			ownCache.gitDir.set(worktreePath, {
				uri: fileUri(`${repoPath}/.git/worktrees/wt`),
				commonUri: fileUri(`${repoPath}/.git`),
			});
			// The common git dir resolves to itself, so the roots are complete and kept
			const realpath = sinon.stub(nodeFsPromises, 'realpath').callsFake(async path => String(path));

			try {
				const roots = await registering.getIgnoredWorktreeRoots(repoPath);
				assert.deepStrictEqual(roots, [`${repoPath}/.git/sync-tools-worktrees`]);
				assert.strictEqual(await registering.getIgnoredWorktreeRoots(repoPath), roots);
				// A sibling worktree shares them
				assert.strictEqual(await registering.getIgnoredWorktreeRoots(worktreePath), roots);
				assert.deepStrictEqual(reads, []);
				assert.strictEqual(realpath.callCount, 1);
			} finally {
				sinon.restore();
				registering.dispose();
				ownCache.dispose();
			}
		});

		test('reads the roots of a path registered again from its new git dir', async () => {
			const { registering, ownCache } = createCountingProvider();
			const otherCommon = normalizePath(resolve('/test/other-repo/.git'));
			ownCache.registerRepoPath(fileUri(worktreePath), {
				uri: fileUri(`${repoPath}/.git/worktrees/wt`),
				commonUri: fileUri(`${repoPath}/.git`),
			});
			ownCache.gitDir.set(worktreePath, {
				uri: fileUri(`${repoPath}/.git/worktrees/wt`),
				commonUri: fileUri(`${repoPath}/.git`),
			});

			try {
				assert.deepStrictEqual(await registering.getIgnoredWorktreeRoots(worktreePath), [
					`${repoPath}/.git/sync-tools-worktrees`,
				]);

				// The worktree was removed, and the path reused by another repository's
				ownCache.unregisterRepoPath(worktreePath);
				ownCache.gitDir.set(worktreePath, {
					uri: fileUri(`${otherCommon}/worktrees/wt`),
					commonUri: fileUri(otherCommon),
				});
				assert.deepStrictEqual(await registering.getIgnoredWorktreeRoots(worktreePath), [
					`${otherCommon}/sync-tools-worktrees`,
				]);
			} finally {
				registering.dispose();
				ownCache.dispose();
			}
		});

		test("asks git once for a bare repository's git dir, and its worktree list keeps the shared cache", async () => {
			const bare = normalizePath(resolve('/test/bare.git'));
			const { registering, ownCache } = createCountingProvider();
			ownCache.registerRepoPath(fileUri(bare), { uri: fileUri(bare) });
			// What `git rev-parse` finds for a bare repository: the repository itself is its git dir
			const getGitDir = sinon.stub(registering.config, 'getGitDir').callsFake(path => {
				const gitDir = { uri: fileUri(bare) };
				ownCache.gitDir.set(path, gitDir);
				return Promise.resolve(gitDir);
			});
			const listings: string[] = [];
			sinon.stub(registering.git, 'run').callsFake((options, ...args) => {
				if (args[0] === 'worktree') {
					listings.push(String(options.cwd));
					return Promise.resolve({
						stdout: `worktree ${bare}\nbare\n\nworktree ${bare}/sync-tools-worktrees/x\nHEAD def\ndetached\n\n`,
						stderr: undefined,
						exitCode: 0,
						completion: { status: 'exited', code: 0 },
					});
				}
				return Promise.resolve({
					stdout: '',
					stderr: undefined,
					exitCode: 0,
					completion: { status: 'exited', code: 0 },
				});
			});

			try {
				assert.deepStrictEqual(await registering.getIgnoredWorktreeRoots(bare), [
					`${bare}/sync-tools-worktrees`,
				]);
				assert.strictEqual(getGitDir.callCount, 1);

				const first = await registering.worktrees.getWorktrees(bare);
				const second = await registering.worktrees.getWorktrees(bare);
				assert.deepStrictEqual(
					first.map(w => normalizePath(w.path)),
					[bare],
				);
				assert.deepStrictEqual(
					second.map(w => normalizePath(w.path)),
					[bare],
				);
				assert.strictEqual(listings.length, 1);
			} finally {
				registering.dispose();
				ownCache.dispose();
			}
		});

		suite('when the git dir hangs', () => {
			let clock: sinon.SinonFakeTimers;

			setup(() => {
				clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
			});

			teardown(() => {
				clock.restore();
				sinon.restore();
			});

			test('gives up on the roots after a few seconds, and reads them again next time', async () => {
				const { registering, ownCache } = createCountingProvider();
				ownCache.gitDir.set(repoPath, { uri: fileUri(`${repoPath}/.git`) });
				// A stale mount: resolving the common git dir never settles
				const realpath = sinon.stub(nodeFsPromises, 'realpath').returns(new Promise<string>(() => {}));

				try {
					let failed = false;
					void registering.getIgnoredWorktreeRoots(repoPath).catch(() => {
						failed = true;
					});
					await clock.tickAsync(5000);
					assert.strictEqual(failed, true);

					realpath.resolves(normalizePath(resolve('/real/repo/.git')));
					assert.deepStrictEqual(await registering.getIgnoredWorktreeRoots(repoPath), [
						`${repoPath}/.git/sync-tools-worktrees`,
						`${normalizePath(resolve('/real/repo/.git'))}/sync-tools-worktrees`,
					]);
				} finally {
					registering.dispose();
					ownCache.dispose();
				}
			});
		});

		test('serves the roots it could read when the git dir can not be resolved, and resolves it again next time', async () => {
			const { registering, ownCache } = createCountingProvider();
			ownCache.gitDir.set(repoPath, { uri: fileUri(`${repoPath}/.git`) });
			const realpath = sinon
				.stub(nodeFsPromises, 'realpath')
				.rejects(Object.assign(new Error('EIO'), { code: 'EIO' }));

			try {
				assert.deepStrictEqual(await registering.getIgnoredWorktreeRoots(repoPath), [
					`${repoPath}/.git/sync-tools-worktrees`,
				]);

				realpath.resolves(normalizePath(resolve('/real/repo/.git')));
				assert.deepStrictEqual(await registering.getIgnoredWorktreeRoots(repoPath), [
					`${repoPath}/.git/sync-tools-worktrees`,
					`${normalizePath(resolve('/real/repo/.git'))}/sync-tools-worktrees`,
				]);
				assert.strictEqual(realpath.callCount, 2);
			} finally {
				sinon.restore();
				registering.dispose();
				ownCache.dispose();
			}
		});

		test('a provider that registers no folder announces every worktree write', async () => {
			await git.run({ cwd: worktreePath, errors: 'ignore', notify: 'infer' }, 'worktree', 'remove', ignored);

			assert.ok(changed.some(([path, changes]) => path === worktreePath && changes.includes('worktrees')));
		});

		test('a provider that registers no folder answers no roots, reading nothing', async () => {
			const reads: string[] = [];
			const plain = new CliGitProvider({
				git: new Git(locator),
				locator: locator,
				context: {
					fs: {
						readDirectory: uri => {
							reads.push(toFsPath(uri));
							return Promise.resolve([]);
						},
						readFile: uri => {
							reads.push(toFsPath(uri));
							return Promise.reject(new Error('ENOENT'));
						},
						stat: uri => {
							reads.push(toFsPath(uri));
							return Promise.resolve(undefined);
						},
					},
				},
			});
			try {
				assert.deepStrictEqual(await plain.getIgnoredWorktreeRoots(repoPath), []);
				assert.deepStrictEqual(plain.getIgnoredWorktreeFolders(repoPath), []);
				assert.deepStrictEqual(reads, []);
			} finally {
				plain.dispose();
			}
		});

		test('a provider that registers no folder, sharing the Git of one that does, announces every worktree write', async () => {
			const sharedGit = new Git(locator);
			const plainChanged: [string, RepositoryChange[]][] = [];
			const registering = new CliGitProvider({
				cache: cache,
				git: sharedGit,
				locator: locator,
				context: { fs: provider.context.fs },
				ignoredWorktreeFolders: ['sync-tools-worktrees'],
			});
			const plain = new CliGitProvider({
				cache: cache,
				git: sharedGit,
				locator: locator,
				context: {
					fs: provider.context.fs,
					hooks: { repository: { onChanged: (path, changes) => plainChanged.push([path, changes]) } },
				},
			});
			files.set(`${worktreePath}/.git`, `gitdir: ${repoPath}/.git/worktrees/wt\n`);
			files.set(`${repoPath}/.git/worktrees/wt/commondir`, '../..\n');

			try {
				// The folder-registering provider, created first, would have ignored it
				assert.deepStrictEqual(await registering.getIgnoredWorktreeRoots(worktreePath), [
					`${repoPath}/.git/sync-tools-worktrees`,
				]);
				await sharedGit.run(
					{ cwd: worktreePath, errors: 'ignore', notify: 'infer' },
					'worktree',
					'remove',
					ignored,
				);
				assert.ok(
					plainChanged.some(([path, changes]) => path === worktreePath && changes.includes('worktrees')),
				);
			} finally {
				plain.dispose();
				registering.dispose();
			}
		});

		suite('through a symlink', () => {
			let tmp: string;
			/** The repository as the host spells it: through a symlink to `realPath` */
			let linkPath: string;
			/** The repository as git spells it, every symlink resolved */
			let realPath: string;
			let ownCache: Cache;
			let ownChanged: [string, RepositoryChange[]][];

			const nodeFs: FileSystemProvider = {
				readDirectory: async uri =>
					(await readdir(toFsPath(uri), { withFileTypes: true })).map(d => [d.name, d.isDirectory() ? 2 : 1]),
				readFile: uri => readFile(toFsPath(uri)),
				stat: async uri => {
					try {
						const s = await stat(toFsPath(uri));
						return { type: s.isDirectory() ? 2 : 1, ctime: s.ctimeMs, mtime: s.mtimeMs, size: s.size };
					} catch {
						return undefined;
					}
				},
			};

			function createProvider(git: Git, localRepositories?: boolean): CliGitProvider {
				return new CliGitProvider({
					cache: ownCache,
					git: git,
					locator: locator,
					context: {
						fs: nodeFs,
						hooks: { repository: { onChanged: (path, changes) => ownChanged.push([path, changes]) } },
					},
					ignoredWorktreeFolders: ['sync-tools-worktrees'],
					localRepositories: localRepositories,
				});
			}

			setup(async function () {
				tmp = await mkdtemp(join(tmpdir(), 'gl-ignored-worktrees-'));
				const real = join(tmp, 'real');
				await mkdir(join(real, '.git'), { recursive: true });
				const link = join(tmp, 'link');
				try {
					await symlink(real, link, 'dir');
				} catch (ex) {
					// Windows creates symlinks only with Developer Mode or elevation
					if ((ex as NodeJS.ErrnoException).code === 'EPERM') {
						this.skip();
					}
					throw ex;
				}
				linkPath = normalizePath(link);
				realPath = normalizePath(await realpath(real));
				ownCache = new Cache();
				ownCache.registerRepoPath(fileUri(linkPath), { uri: fileUri(`${linkPath}/.git`) });
				ownChanged = [];
			});

			teardown(async () => {
				ownCache?.dispose();
				await rm(tmp, { recursive: true, force: true });
			});

			test('gives each folder as the host spells the common git dir and as it resolves', async () => {
				const resolving = createProvider(new Git(locator));
				const local = new CliGitProvider({
					git: new Git(locator),
					locator: locator,
					context: { fs: nodeFs },
					ignoredWorktreeFolders: ['sync-tools-worktrees'],
				});
				try {
					assert.deepStrictEqual(await resolving.getIgnoredWorktreeRoots(linkPath), [
						`${linkPath}/.git/sync-tools-worktrees`,
						`${realPath}/.git/sync-tools-worktrees`,
					]);
					// Found from the `.git` folder on disk, without a cache entry
					assert.deepStrictEqual(await local.getIgnoredWorktreeRoots(linkPath), [
						`${linkPath}/.git/sync-tools-worktrees`,
						`${realPath}/.git/sync-tools-worktrees`,
					]);
				} finally {
					local.dispose();
					resolving.dispose();
				}
			});

			test('gives only the host spelling for repositories that may not be local', async () => {
				const remote = createProvider(new Git(locator), false);
				try {
					assert.deepStrictEqual(await remote.getIgnoredWorktreeRoots(linkPath), [
						`${linkPath}/.git/sync-tools-worktrees`,
					]);
				} finally {
					remote.dispose();
				}
			});

			test('a worktree git names by its resolved path announces nothing', async () => {
				const ownGit = new Git(locator);
				const registering = createProvider(ownGit);
				try {
					await ownGit.run(
						{ cwd: linkPath, errors: 'ignore', notify: 'infer' },
						'worktree',
						'remove',
						resolve(`${realPath}/.git/sync-tools-worktrees/x`),
					);
					await ownGit.run(
						{ cwd: linkPath, errors: 'ignore', notify: 'infer' },
						'worktree',
						'remove',
						resolve(`${linkPath}/.git/sync-tools-worktrees/x`),
					);
					assert.deepStrictEqual(ownChanged, []);

					await ownGit.run(
						{ cwd: linkPath, errors: 'ignore', notify: 'infer' },
						'worktree',
						'remove',
						resolve(`${realPath}/.git/my-worktrees/x`),
					);
					assert.deepStrictEqual(ownChanged, [[linkPath, ['worktrees', 'worktreeHead']]]);
				} finally {
					registering.dispose();
				}
			});
		});
	});
});

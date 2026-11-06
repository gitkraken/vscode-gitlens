import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { GitBranch } from '@gitlens/git/models/branch.js';
import { isCancellationError } from '@gitlens/utils/cancellation.js';
import type { LogChannel } from '@gitlens/utils/logger.js';
import { defer } from '@gitlens/utils/promise.js';
import { fileUri } from '@gitlens/utils/uri.js';
import type { CliGitProvider } from '../../../cliGitProvider.js';
import type { TestRepo } from './helpers.js';
import {
	addCommit,
	checkout,
	cloneTestRepo,
	createBranch,
	createBranchAt,
	createProvider,
	createTestRepo,
	createTrackingBranch,
	createWorktree,
	fetch,
	getHeadSha,
	setBranchGkDisposition,
	setUpstream,
} from './helpers.js';

function git(cwd: string, ...args: string[]): string {
	return execFileSync('git', args, { cwd: cwd, encoding: 'utf-8', stdio: 'pipe' }).trim();
}

/** Everything a `GitBranch` answer carries, in a form `deepStrictEqual` can compare */
function fieldsOf(branch: GitBranch | undefined): Record<string, unknown> | undefined {
	if (branch == null) return undefined;

	return {
		repoPath: branch.repoPath,
		refName: branch.refName,
		id: branch.id,
		name: branch.name,
		current: branch.current,
		detached: branch.detached,
		rebasing: branch.rebasing,
		remote: branch.remote,
		sha: branch.sha,
		date: branch.date,
		upstream: branch.upstream,
		worktree: branch.worktree,
		metadata: branch.metadata,
	};
}

suite('BranchesSubProvider.getBranch without a per-worktree list (real git)', () => {
	const cleanups: (() => void)[] = [];
	const providers: CliGitProvider[] = [];

	/** The argv of each git process finished (completed or failed) since the last {@link resetSpawns} */
	const spawns: string[] = [];
	const spawnLogger: LogChannel = {
		name: 'spawn-counter',
		logLevel: 0,
		dispose: () => {},
		trace: () => {},
		debug: () => {},
		info: (msg: string) => {
			if (msg.includes('• completed')) {
				spawns.push(msg);
			}
		},
		warn: () => {},
		error: (msg: string) => {
			if (msg.includes('• FAILED')) {
				spawns.push(msg);
			}
		},
	};

	function resetSpawns(): void {
		spawns.length = 0;
	}

	function spawnCount(command: string): number {
		return spawns.filter(s => s.includes(command)).length;
	}

	/** Whether new providers list refs in reverse, the only way to get a remote-tracking entry ahead of a local one */
	let reverseRefs = false;

	/** A provider with cold caches that knows each of `paths`, so linked worktrees share their common path's list */
	async function newProvider(paths: readonly string[]): Promise<CliGitProvider> {
		const provider = createProvider({ gitOptions: { logger: spawnLogger } });
		providers.push(provider);
		if (reverseRefs) {
			const refs = provider.refs;
			const getRefs = refs.getRefs.bind(refs);
			refs.getRefs = async (...args) => (await getRefs(...args)).toReversed();
		}
		for (const path of paths) {
			provider.cache.registerRepoPath(fileUri(path), await provider.config.getGitDir(path));
		}
		return provider;
	}

	function track<T extends { cleanup: () => void }>(value: T): T {
		cleanups.unshift(() => value.cleanup());
		return value;
	}

	function worktreeOf(repo: TestRepo, branch: string): string {
		return track(createWorktree(repo.path, branch)).path;
	}

	/** A clone with `origin/main` and `origin/tracked`, plus local `feature` and `other` branches */
	function createClone(): TestRepo {
		const origin = track(createTestRepo());
		addCommit(origin.path, 'origin.txt', 'origin', 'Origin commit');
		createBranch(origin.path, 'tracked');
		const clone = track(cloneTestRepo(origin.path));
		createBranch(clone.path, 'feature');
		createBranch(clone.path, 'other');
		createTrackingBranch(clone.path, 'tracked', 'origin/tracked');
		return clone;
	}

	/** Leaves `path` stopped on a conflicting rebase of its branch onto a new branch off `main` */
	function startConflictingRebase(repoPath: string, path: string): void {
		createBranchAt(repoPath, 'onto', 'main');
		addCommit(track(createWorktree(repoPath, 'onto')).path, 'conflict.txt', 'onto', 'Commit on onto');
		addCommit(path, 'conflict.txt', 'rebased', 'Commit to rebase');
		assert.throws(() => git(path, 'rebase', 'onto'));
	}

	/**
	 * Asserts the narrow reads answer as the full list does, for read orders on cold caches: the list first, the current
	 * branch first, and the named ones first.
	 */
	async function assertParity(
		target: string,
		paths: readonly string[],
		names: readonly string[],
		check?: (current: GitBranch) => void,
	): Promise<void> {
		const listFirst = await newProvider(paths);
		const { values } = await listFirst.branches.getBranches(target);
		const expectedCurrent = values.find(b => b.current);
		assert.ok(expectedCurrent != null, 'the list should have a current branch');
		check?.(expectedCurrent);

		const allNames = [...names, expectedCurrent.name, 'missing-branch'];
		const expectedNamed = allNames.map(n => values.find(b => b.name === n));

		const assertCurrent = async (provider: CliGitProvider, order: string): Promise<void> => {
			const current = await provider.branches.getBranch(target);
			assert.deepStrictEqual(fieldsOf(current), fieldsOf(expectedCurrent), `current branch, ${order}`);
		};
		const assertNamed = async (provider: CliGitProvider, order: string): Promise<void> => {
			for (let i = 0; i < allNames.length; i++) {
				const named = await provider.branches.getBranch(target, allNames[i]);
				assert.deepStrictEqual(fieldsOf(named), fieldsOf(expectedNamed[i]), `${allNames[i]}, ${order}`);
			}
		};

		await assertCurrent(listFirst, 'list read first');
		await assertNamed(listFirst, 'list read first');

		const currentFirst = await newProvider(paths);
		await assertCurrent(currentFirst, 'current read first');
		await assertNamed(currentFirst, 'current read first');
		assert.strictEqual(currentFirst.cache.branches.has(target), false, 'narrow reads keep no list');

		const namedFirst = await newProvider(paths);
		await assertNamed(namedFirst, 'named read first');
		await assertCurrent(namedFirst, 'named read first');
		assert.strictEqual(namedFirst.cache.branches.has(target), false, 'narrow reads keep no list');

		// The list answers the same when read after the narrow reads
		const { values: after } = await namedFirst.branches.getBranches(target);
		assert.deepStrictEqual(after.map(fieldsOf), values.map(fieldsOf), 'list read after the narrow reads');
	}

	teardown(() => {
		reverseRefs = false;
		for (const provider of providers.splice(0)) {
			provider.dispose();
		}
		for (const cleanup of cleanups.splice(0)) {
			cleanup();
		}
	});

	suite('parity with the list', () => {
		test('the main checkout', async () => {
			const repo = createClone();
			const wt = worktreeOf(repo, 'feature');

			await assertParity(
				repo.path,
				[repo.path, wt],
				['main', 'feature', 'other', 'origin/main', 'origin/tracked'],
			);
		});

		test('a linked worktree on a plain branch', async () => {
			const repo = createClone();
			const wt = worktreeOf(repo, 'feature');

			await assertParity(
				wt,
				[repo.path, wt],
				['main', 'feature', 'other', 'origin/main', 'origin/tracked'],
				c => {
					assert.strictEqual(c.name, 'feature');
					assert.strictEqual(c.repoPath, wt);
				},
			);
		});

		test('a linked worktree whose repository was never registered', async () => {
			const repo = createClone();
			const wt = worktreeOf(repo, 'feature');

			await assertParity(wt, [], ['main', 'feature', 'origin/main']);
		});

		test('an upstream with ahead and behind counts', async () => {
			const repo = createClone();
			const origin = git(repo.path, 'remote', 'get-url', 'origin');
			git(origin, 'checkout', '-q', 'tracked');
			addCommit(origin, 'behind.txt', 'behind', 'Behind commit');
			git(origin, 'checkout', '-q', 'main');
			fetch(repo.path);
			const wt = worktreeOf(repo, 'tracked');
			addCommit(wt, 'ahead.txt', 'ahead', 'Ahead commit');

			const assertCounts = (c: GitBranch): void => {
				assert.strictEqual(c.upstream?.name, 'origin/tracked');
				assert.deepStrictEqual(c.upstream?.state, { ahead: 1, behind: 1 });
			};
			await assertParity(wt, [repo.path, wt], ['main', 'tracked', 'origin/tracked'], assertCounts);

			checkout(wt, 'feature');
			checkout(repo.path, 'tracked');
			await assertParity(repo.path, [repo.path, wt], ['main', 'tracked', 'origin/tracked'], assertCounts);
		});

		test('an upstream that is a local branch', async () => {
			const repo = createClone();
			setUpstream(repo.path, 'feature', 'main');
			const wt = worktreeOf(repo, 'feature');

			await assertParity(wt, [repo.path, wt], ['main', 'feature'], c => {
				assert.strictEqual(c.upstream?.name, 'main');
				assert.strictEqual(c.upstream?.remote, undefined);
			});
		});

		test('an upstream that is gone', async () => {
			const repo = createClone();
			git(repo.path, 'update-ref', '-d', 'refs/remotes/origin/tracked');
			const wt = worktreeOf(repo, 'tracked');

			await assertParity(wt, [repo.path, wt], ['main', 'tracked', 'origin/tracked'], c => {
				assert.strictEqual(c.upstream?.missing, true);
			});
		});

		test('a detached HEAD in a linked worktree', async () => {
			const repo = createClone();
			const wt = worktreeOf(repo, 'feature');
			git(wt, 'checkout', '-q', '--detach');

			await assertParity(wt, [repo.path, wt], ['main', 'feature', 'origin/main'], c => {
				assert.strictEqual(c.detached, true);
			});
		});

		test('a detached HEAD in the main checkout', async () => {
			const repo = createClone();
			const wt = worktreeOf(repo, 'feature');
			git(repo.path, 'checkout', '-q', '--detach');

			await assertParity(repo.path, [repo.path, wt], ['main', 'feature', 'origin/main'], c => {
				assert.strictEqual(c.detached, true);
			});
		});

		test('a rebase stopped on a conflict in a linked worktree', async () => {
			const repo = createClone();
			const wt = worktreeOf(repo, 'feature');
			startConflictingRebase(repo.path, wt);

			await assertParity(wt, [repo.path, wt], ['main', 'feature', 'other', 'origin/main'], c => {
				assert.strictEqual(c.rebasing, true);
				assert.strictEqual(c.name, 'feature');
			});
		});

		test('a rebase stopped on a conflict in the main checkout', async () => {
			const repo = createClone();
			const wt = worktreeOf(repo, 'other');
			checkout(repo.path, 'feature');
			startConflictingRebase(repo.path, repo.path);

			await assertParity(repo.path, [repo.path, wt], ['main', 'feature', 'other', 'origin/main'], c => {
				assert.strictEqual(c.rebasing, true);
			});
		});

		test('a rebasing branch named like a remote-tracking branch', async () => {
			const repo = createClone();
			createBranch(repo.path, 'origin/tracked');
			const wt = worktreeOf(repo, 'origin/tracked');
			startConflictingRebase(repo.path, wt);

			await assertParity(wt, [repo.path, wt], ['main', 'origin/tracked', 'tracked'], c => {
				assert.strictEqual(c.rebasing, true);
				assert.strictEqual(c.remote, false);
			});
		});

		test('a local branch named like a remote-tracking branch, not current', async () => {
			const repo = createClone();
			createBranch(repo.path, 'origin/main');
			const wt = worktreeOf(repo, 'feature');

			await assertParity(wt, [repo.path, wt], ['main', 'origin/main']);
			git(wt, 'checkout', '-q', '--detach');
			await assertParity(wt, [repo.path, wt], ['main', 'origin/main']);
		});

		test('a remote-tracking entry listed ahead of the rebasing branch of its name', async () => {
			const repo = createClone();
			createBranch(repo.path, 'origin/tracked');
			const wt = worktreeOf(repo, 'origin/tracked');
			startConflictingRebase(repo.path, wt);
			reverseRefs = true;

			await assertParity(wt, [repo.path, wt], ['main', 'origin/tracked', 'tracked'], c => {
				assert.strictEqual(c.rebasing, true);
			});

			const provider = await newProvider([repo.path, wt]);
			assert.strictEqual((await provider.branches.getBranch(wt, 'origin/tracked'))?.remote, true);
			assert.strictEqual((await provider.branches.getBranch(wt))?.remote, false);
		});

		test('a linked worktree on an unborn branch', async () => {
			const repo = createClone();
			const wt = worktreeOf(repo, 'feature');
			git(wt, 'checkout', '-q', '--orphan', 'unborn');

			await assertParity(wt, [repo.path, wt], ['main', 'feature', 'unborn', 'origin/main'], c => {
				assert.strictEqual(c.name, 'unborn');
				assert.strictEqual(c.sha, undefined);
			});
		});

		test('a repository with no commits', async () => {
			const dir = mkdtempSync(join(tmpdir(), 'gitlens-empty-'));
			cleanups.unshift(() => rmSync(dir, { recursive: true, force: true }));
			git(dir, 'init', '-q', '-b', 'main');

			await assertParity(dir, [dir], ['main'], c => {
				assert.strictEqual(c.name, 'main');
				assert.strictEqual(c.sha, undefined);
			});
		});

		test('a linked worktree of a repository with no commits', async function () {
			const dir = mkdtempSync(join(tmpdir(), 'gitlens-empty-'));
			cleanups.unshift(() => rmSync(dir, { recursive: true, force: true }));
			git(dir, 'init', '-q', '-b', 'main');
			const parent = mkdtempSync(join(tmpdir(), 'gitlens-worktree-'));
			cleanups.unshift(() => rmSync(parent, { recursive: true, force: true }));
			const wt = join(parent, 'wt');
			try {
				git(dir, 'worktree', 'add', '-q', '--orphan', '-b', 'unborn', wt);
			} catch {
				this.skip();
			}

			await assertParity(wt, [dir, wt], ['main', 'unborn'], c => {
				assert.strictEqual(c.name, 'unborn');
			});
		});
	});

	suite('retention', () => {
		test('narrow reads keep no list for the worktree, and a later list is right', async () => {
			const repo = createClone();
			const wt = worktreeOf(repo, 'feature');
			const provider = await newProvider([repo.path, wt]);

			await provider.branches.getBranch(wt);
			await provider.branches.getBranch(wt, 'main');
			await provider.branches.getBranch(wt, 'feature');
			assert.strictEqual(provider.cache.branches.has(wt), false);
			assert.strictEqual(provider.cache.branches.has(repo.path), false);

			const { values } = await provider.branches.getBranches(wt);
			assert.strictEqual(provider.cache.branches.has(wt), true, 'the list keeps its per-worktree entry');
			assert.deepStrictEqual(
				values.filter(b => b.current).map(b => b.name),
				['feature'],
			);
			assert.ok(values.every(b => b.repoPath === wt));
		});

		test('a detached worktree keeps no list either', async () => {
			const repo = createClone();
			const wt = worktreeOf(repo, 'feature');
			git(wt, 'checkout', '-q', '--detach');
			const provider = await newProvider([repo.path, wt]);

			await provider.branches.getBranch(wt);
			await provider.branches.getBranch(wt, 'main');
			assert.strictEqual(provider.cache.branches.has(wt), false);
		});
	});

	suite('launches', () => {
		function createWorktrees(repo: TestRepo, count: number): string[] {
			const paths: string[] = [];
			for (let i = 0; i < count; i++) {
				createBranch(repo.path, `task-${i}`);
				paths.push(worktreeOf(repo, `task-${i}`));
			}
			return paths;
		}

		test('a sweep of the worktrees reads the refs once and runs no rev-parse', async () => {
			const repo = track(createTestRepo());
			const worktrees = createWorktrees(repo, 5);
			const provider = await newProvider([repo.path, ...worktrees]);
			resetSpawns();

			for (let i = 0; i < worktrees.length; i++) {
				const branch = await provider.branches.getBranch(worktrees[i]);
				assert.strictEqual(branch?.name, `task-${i}`);
				assert.strictEqual(branch?.current, true);
			}

			assert.strictEqual(spawnCount('for-each-ref'), 1);
			assert.strictEqual(spawnCount('rev-parse'), 0);
		});

		test('a sweep of the worktrees runs no rev-parse when the refs listing is copied', async () => {
			const repo = track(createTestRepo());
			const worktrees = createWorktrees(repo, 5);
			reverseRefs = true;
			const provider = await newProvider([repo.path, ...worktrees]);
			resetSpawns();

			for (let i = 0; i < worktrees.length; i++) {
				const branch = await provider.branches.getBranch(worktrees[i]);
				assert.strictEqual(branch?.name, `task-${i}`);
				assert.strictEqual(branch?.current, true);
			}

			assert.strictEqual(spawnCount('rev-parse'), 0);
		});

		test('a sweep of named reads reads the refs once and runs no rev-parse', async () => {
			const repo = track(createTestRepo());
			const worktrees = createWorktrees(repo, 5);
			const provider = await newProvider([repo.path, ...worktrees]);
			resetSpawns();

			for (const worktree of worktrees) {
				assert.strictEqual((await provider.branches.getBranch(worktree, 'main'))?.repoPath, worktree);
			}

			assert.strictEqual(spawnCount('for-each-ref'), 1);
			assert.strictEqual(spawnCount('rev-parse'), 0);
		});

		test('concurrent reads share one answer', async () => {
			const repo = track(createTestRepo());
			const [worktree] = createWorktrees(repo, 1);
			const provider = await newProvider([repo.path, worktree]);
			resetSpawns();

			const branches = await Promise.all(Array.from({ length: 50 }, () => provider.branches.getBranch(worktree)));

			assert.ok(branches[0] != null);
			assert.ok(branches.every(b => b === branches[0]));
			assert.strictEqual(spawnCount('for-each-ref'), 1);
			assert.strictEqual(spawnCount('rev-parse'), 0);
		});

		test('named reads in a detached worktree run git log once', async () => {
			const repo = track(createTestRepo());
			const [worktree] = createWorktrees(repo, 1);
			git(worktree, 'checkout', '-q', '--detach');
			const provider = await newProvider([repo.path, worktree]);

			resetSpawns();
			await provider.branches.getBranch(worktree, 'main');
			assert.strictEqual(
				spawnCount(' log '),
				2,
				"the first read looks up the detached HEAD's sha, then its date",
			);

			resetSpawns();
			await provider.branches.getBranch(worktree, 'main');
			await provider.branches.getBranch(worktree, 'task-0');

			assert.strictEqual(spawnCount(' log '), 0);
		});
	});

	suite('invalidation', () => {
		test('a new branch checked out in a worktree is seen after its branch eviction', async () => {
			const repo = track(createTestRepo());
			createBranch(repo.path, 'feature');
			createBranch(repo.path, 'sibling');
			const wt = worktreeOf(repo, 'feature');
			const sibling = worktreeOf(repo, 'sibling');
			const provider = await newProvider([repo.path, wt, sibling]);
			assert.strictEqual((await provider.branches.getBranch(wt))?.name, 'feature');
			assert.strictEqual((await provider.branches.getBranch(sibling))?.name, 'sibling');

			git(wt, 'checkout', '-q', '-b', 'created');
			provider.cache.evictCaches(wt, 'branch');

			const branch = await provider.branches.getBranch(wt);
			assert.strictEqual(branch?.name, 'created');
			assert.strictEqual(branch?.current, true);
			assert.strictEqual(branch?.repoPath, wt);
			assert.strictEqual(
				(await provider.branches.getBranch(sibling))?.name,
				'sibling',
				"the sibling's own branch",
			);
		});

		test('a list read across a checkout leaves the new branch to be read', async () => {
			const repo = track(createTestRepo());
			createBranch(repo.path, 'feature');
			createBranch(repo.path, 'other');
			createBranch(repo.path, 'sibling');
			// With an upstream, rev-parse exits cleanly and so is counted
			setUpstream(repo.path, 'other', 'main');
			setUpstream(repo.path, 'sibling', 'main');
			const wt = worktreeOf(repo, 'feature');
			const sibling = worktreeOf(repo, 'sibling');
			const provider = await newProvider([repo.path, wt, sibling]);
			resetSpawns();

			// Holds the list read after `for-each-ref` has run, so the checkout lands between the read and its seeding
			const refs = provider.refs;
			const getRefs = refs.getRefs;
			const read = defer<void>();
			const released = defer<void>();
			refs.getRefs = async function (this: typeof refs, ...args) {
				const records = await getRefs.apply(this, args);
				read.fulfill();
				await released.promise;
				return records;
			};

			const during = provider.branches.getBranch(wt);
			await read.promise;
			checkout(wt, 'other');
			provider.cache.evictCaches(wt, 'branch');
			released.fulfill();
			await during;

			assert.strictEqual((await provider.branches.getBranch(wt))?.name, 'other');
			assert.strictEqual((await provider.branches.getBranch(sibling))?.name, 'sibling');
			assert.strictEqual(spawnCount('for-each-ref'), 1);
			assert.strictEqual(spawnCount('rev-parse'), 1, 'only the checkout that changed reads its HEAD');
		});

		test('refs read before a checkout leave the new branch to be read', async () => {
			const repo = track(createTestRepo());
			createBranch(repo.path, 'feature');
			createBranch(repo.path, 'other');
			const wt = worktreeOf(repo, 'feature');
			const provider = await newProvider([repo.path, wt]);
			await provider.refs.getRefs(repo.path);

			checkout(wt, 'other');
			provider.cache.evictCaches(wt, 'branch');

			assert.strictEqual((await provider.branches.getBranch(wt))?.name, 'other');
		});

		test('a commit is seen after a branches eviction', async () => {
			const repo = track(createTestRepo());
			createBranch(repo.path, 'feature');
			createBranch(repo.path, 'sibling');
			const wt = worktreeOf(repo, 'feature');
			const sibling = worktreeOf(repo, 'sibling');
			const provider = await newProvider([repo.path, wt, sibling]);
			const before = await provider.branches.getBranch(wt);
			await provider.branches.getBranch(sibling);

			addCommit(wt, 'new.txt', 'new', 'New commit');
			provider.cache.evictCaches(wt, 'branches');

			const after = await provider.branches.getBranch(wt);
			assert.notStrictEqual(after?.sha, before?.sha);
			assert.strictEqual(after?.sha, getHeadSha(wt));
			assert.strictEqual((await provider.branches.getBranch(wt, 'feature'))?.sha, getHeadSha(wt));
			assert.strictEqual((await provider.branches.getBranch(sibling, 'feature'))?.sha, getHeadSha(wt));
			assert.strictEqual((await provider.branches.getBranch(sibling))?.sha, getHeadSha(sibling));
		});

		test('force reads past what is cached', async () => {
			const repo = track(createTestRepo());
			createBranch(repo.path, 'feature');
			const wt = worktreeOf(repo, 'feature');
			const provider = await newProvider([repo.path, wt]);
			await provider.branches.getBranch(wt);
			await provider.branches.getBranch(wt, 'feature');

			addCommit(wt, 'new.txt', 'new', 'New commit');

			assert.strictEqual(
				(await provider.branches.getBranch(wt, undefined, { force: true }))?.sha,
				getHeadSha(wt),
			);

			addCommit(wt, 'newer.txt', 'newer', 'Newer commit');

			assert.strictEqual(
				(await provider.branches.getBranch(wt, 'feature', { force: true }))?.sha,
				getHeadSha(wt),
			);
		});

		test('a worktree leaving a detached HEAD answers its branch again', async () => {
			const repo = track(createTestRepo());
			createBranch(repo.path, 'feature');
			const wt = worktreeOf(repo, 'feature');
			git(wt, 'checkout', '-q', '--detach');
			const provider = await newProvider([repo.path, wt]);
			assert.strictEqual((await provider.branches.getBranch(wt))?.detached, true);

			checkout(wt, 'feature');
			provider.cache.evictCaches(wt, 'branch');

			const branch = await provider.branches.getBranch(wt);
			assert.strictEqual(branch?.name, 'feature');
			assert.strictEqual(branch?.detached, false);
			assert.deepStrictEqual(branch?.worktree, { path: wt, isDefault: false });
			const named = await provider.branches.getBranch(wt, 'feature');
			assert.strictEqual(named?.current, true);
			assert.deepStrictEqual(named?.worktree, { path: wt, isDefault: false });
		});

		test("a worktree's list agrees with its branch after its branch eviction, without reading the refs again", async () => {
			const repo = track(createTestRepo());
			createBranch(repo.path, 'feature');
			createBranch(repo.path, 'other');
			const wt = worktreeOf(repo, 'feature');
			const provider = await newProvider([repo.path, wt]);
			await provider.branches.getBranches(wt);

			checkout(wt, 'other');
			provider.cache.evictCaches(wt, 'branch');
			resetSpawns();

			assert.strictEqual((await provider.branches.getBranch(wt))?.name, 'other');
			const { values } = await provider.branches.getBranches(wt);
			assert.strictEqual(values.find(b => b.current)?.name, 'other');
			assert.strictEqual(spawnCount('for-each-ref'), 0);
		});

		test('a degraded shared list leaves no current branch cached', async () => {
			const repo = track(createTestRepo());
			createBranch(repo.path, 'feature');
			const wt = worktreeOf(repo, 'feature');
			const provider = await newProvider([repo.path, wt]);

			const refs = provider.refs;
			const getRefs = refs.getRefs;
			refs.getRefs = () => Promise.resolve([]);
			try {
				await provider.branches.getBranch(wt);
				await new Promise(r => setTimeout(r, 0));
				assert.strictEqual(provider.cache.branch.has(wt), false);
			} finally {
				refs.getRefs = getRefs;
			}

			assert.strictEqual((await provider.branches.getBranch(wt))?.name, 'feature');
		});

		test('a repository with no commits keeps its current branch', async () => {
			const dir = mkdtempSync(join(tmpdir(), 'gitlens-empty-'));
			cleanups.unshift(() => rmSync(dir, { recursive: true, force: true }));
			git(dir, 'init', '-q', '-b', 'main');
			const provider = await newProvider([dir]);

			await provider.branches.getBranch(dir);
			await new Promise(r => setTimeout(r, 0));
			assert.strictEqual(provider.cache.branch.has(dir), true);

			resetSpawns();
			assert.strictEqual((await provider.branches.getBranch(dir))?.name, 'main');
			assert.strictEqual(spawnCount(' log '), 0);
		});

		test("a linked worktree's read in a repository with no commits leaves its siblings' current branches", async function () {
			const dir = mkdtempSync(join(tmpdir(), 'gitlens-empty-'));
			cleanups.unshift(() => rmSync(dir, { recursive: true, force: true }));
			git(dir, 'init', '-q', '-b', 'main');
			const parent = mkdtempSync(join(tmpdir(), 'gitlens-worktree-'));
			cleanups.unshift(() => rmSync(parent, { recursive: true, force: true }));
			const wt = join(parent, 'wt');
			try {
				git(dir, 'worktree', 'add', '-q', '--orphan', '-b', 'unborn', wt);
			} catch {
				this.skip();
			}
			const provider = await newProvider([dir, wt]);

			await provider.branches.getBranch(dir);
			await provider.branches.getBranch(wt);
			await new Promise(r => setTimeout(r, 0));
			assert.strictEqual(provider.cache.branch.has(dir), true);
			assert.strictEqual(provider.cache.branch.has(wt), true);

			resetSpawns();
			assert.strictEqual((await provider.branches.getBranch(dir))?.name, 'main');
			assert.strictEqual((await provider.branches.getBranch(wt))?.name, 'unborn');
			assert.strictEqual(spawnCount(' log '), 0);
		});

		test('after a branch eviction the list keeps the worktree its last read gave the new current branch, and getBranch names it', async function () {
			const repo = track(createTestRepo());
			createBranch(repo.path, 'other');
			const provider = await newProvider([repo.path]);
			const before = await provider.branches.getBranches(repo.path);
			if (before.values.find(b => b.name === 'other')?.worktree !== false) {
				// git < 2.23 lists no `%(worktreepath)`
				this.skip();
			}

			checkout(repo.path, 'other');
			provider.cache.evictCaches(repo.path, 'branch');

			const current = (await provider.branches.getBranches(repo.path)).values.find(b => b.current);
			assert.strictEqual(current?.name, 'other');
			assert.strictEqual(current?.worktree, false, 'a stale list stays recognizable as one');
			const worktree = { path: repo.path, isDefault: true };
			assert.deepStrictEqual((await provider.branches.getBranch(repo.path, 'other'))?.worktree, worktree);
			assert.deepStrictEqual((await provider.branches.getBranch(repo.path))?.worktree, worktree);
		});

		test('after a branch eviction getBranch no longer names the branch a linked worktree left, while the list keeps its placement, without reading the refs again', async function () {
			const repo = track(createTestRepo());
			createBranch(repo.path, 'feature');
			createBranch(repo.path, 'other');
			const wt = worktreeOf(repo, 'feature');
			const provider = await newProvider([repo.path, wt]);
			const before = await provider.branches.getBranches(wt);
			if (before.values.find(b => b.name === 'other')?.worktree !== false) {
				// git < 2.23 lists no `%(worktreepath)`
				this.skip();
			}
			await provider.branches.getBranch(wt, 'feature');

			checkout(wt, 'other');
			provider.cache.evictCaches(wt, 'branch');
			resetSpawns();

			const left = await provider.branches.getBranch(wt, 'feature');
			assert.strictEqual(left?.worktree, false);
			const current = await provider.branches.getBranch(wt);
			assert.strictEqual(current?.name, 'other');
			assert.deepStrictEqual(current?.worktree, { path: wt, isDefault: false });
			const { values } = await provider.branches.getBranches(wt);
			assert.deepStrictEqual(
				values.find(b => b.name === 'feature')?.worktree,
				{ path: wt, isDefault: false },
				'the list keeps its placement so a stale list stays recognizable as one',
			);
			assert.strictEqual(spawnCount('for-each-ref'), 0);
		});

		test('after a branch eviction getBranch no longer names the branch the main checkout left, while the list keeps its placement, without reading the refs again', async function () {
			const repo = track(createTestRepo());
			createBranch(repo.path, 'feature');
			createBranch(repo.path, 'other');
			const wt = worktreeOf(repo, 'feature');
			const provider = await newProvider([repo.path, wt]);
			const before = await provider.branches.getBranches(repo.path);
			if (before.values.find(b => b.name === 'other')?.worktree !== false) {
				// git < 2.23 lists no `%(worktreepath)`
				this.skip();
			}
			await provider.branches.getBranch(repo.path, 'main');

			checkout(repo.path, 'other');
			provider.cache.evictCaches(repo.path, 'branch');
			resetSpawns();

			const left = await provider.branches.getBranch(repo.path, 'main');
			assert.strictEqual(left?.worktree, false);
			const current = await provider.branches.getBranch(repo.path);
			assert.strictEqual(current?.name, 'other');
			assert.deepStrictEqual(current?.worktree, { path: repo.path, isDefault: true });
			const { values } = await provider.branches.getBranches(repo.path);
			assert.deepStrictEqual(
				values.find(b => b.name === 'main')?.worktree,
				{ path: repo.path, isDefault: true },
				'the list keeps its placement so a stale list stays recognizable as one',
			);
			assert.strictEqual(spawnCount('for-each-ref'), 0);
		});

		test('after a branch eviction getBranch names the worktree for a current branch the list places in another', async function () {
			const repo = track(createTestRepo());
			createBranch(repo.path, 'feature');
			createBranch(repo.path, 'other');
			const wt = worktreeOf(repo, 'feature');
			const provider = await newProvider([repo.path, wt]);
			const before = await provider.branches.getBranches(repo.path);
			if (before.values.find(b => b.name === 'other')?.worktree !== false) {
				// git < 2.23 lists no `%(worktreepath)`
				this.skip();
			}

			checkout(wt, 'other');
			checkout(repo.path, 'feature');
			provider.cache.evictCaches(wt, 'branch');
			provider.cache.evictCaches(repo.path, 'branch');
			resetSpawns();

			const worktree = { path: repo.path, isDefault: true };
			const current = await provider.branches.getBranch(repo.path);
			assert.strictEqual(current?.name, 'feature');
			assert.deepStrictEqual(current?.worktree, worktree);
			assert.deepStrictEqual((await provider.branches.getBranch(repo.path, 'feature'))?.worktree, worktree);
			assert.strictEqual((await provider.branches.getBranch(repo.path, 'main'))?.worktree, false);
			const listed = (await provider.branches.getBranches(repo.path)).values.find(b => b.current);
			assert.strictEqual(listed?.name, 'feature');
			assert.deepStrictEqual(
				listed?.worktree,
				{ path: wt, isDefault: false },
				'a stale list stays recognizable as one',
			);
			assert.strictEqual(spawnCount('for-each-ref'), 0);
		});

		test("a branch the list places at a worktree whose current branch couldn't be read keeps that worktree", async function () {
			const repo = track(createTestRepo());
			createBranch(repo.path, 'feature');
			const wt = worktreeOf(repo, 'feature');
			const provider = await newProvider([repo.path, wt]);
			const before = await provider.branches.getBranches(repo.path);
			if (before.values.find(b => b.name === 'feature')?.worktree == null) {
				// git < 2.23 lists no `%(worktreepath)`
				this.skip();
			}

			// As a failed read of the worktree's HEAD leaves it
			provider.cache.evictCaches(wt, 'branch');
			provider.cache.currentBranchReference.set(wt, Promise.resolve(undefined));

			const worktree = { path: wt, isDefault: false };
			assert.deepStrictEqual((await provider.branches.getBranch(wt, 'feature'))?.worktree, worktree);
			const { values } = await provider.branches.getBranches(wt);
			assert.deepStrictEqual(values.find(b => b.name === 'feature')?.worktree, worktree);
		});

		for (const registered of [true, false]) {
			test(`a checkout in ${registered ? 'a registered' : 'an unregistered'} linked worktree that the main checkout reports is seen, without reading the refs again`, async () => {
				const repo = track(createTestRepo());
				createBranch(repo.path, 'feature');
				createBranch(repo.path, 'other');
				// With an upstream, rev-parse exits cleanly and so is counted
				setUpstream(repo.path, 'main', 'feature');
				setUpstream(repo.path, 'other', 'main');
				const wt = worktreeOf(repo, 'feature');
				const provider = await newProvider(registered ? [repo.path, wt] : [repo.path]);
				// The main checkout's list seeds the worktree's current branch
				await provider.branches.getBranches(repo.path);
				assert.strictEqual((await provider.branches.getBranch(wt))?.name, 'feature');
				assert.strictEqual((await provider.branches.getBranch(repo.path))?.name, 'main');

				checkout(wt, 'other');
				resetSpawns();
				// As the main checkout's watcher reports `worktrees/<id>/HEAD`
				provider.cache.onRepositoryChanged(repo.path, ['worktrees', 'worktreeHead']);

				const branch = await provider.branches.getBranch(wt);
				assert.strictEqual(branch?.name, 'other');
				assert.deepStrictEqual(branch?.worktree, { path: wt, isDefault: false });
				assert.strictEqual((await provider.branches.getBranch(repo.path))?.name, 'main');
				assert.strictEqual(spawnCount('rev-parse'), 1, 'only the linked worktree reads its HEAD');
				assert.strictEqual(spawnCount('for-each-ref'), 0);
			});

			test(`a worktree the main checkout removes leaves ${registered ? 'a registered' : 'an unregistered'} linked worktree's current branch`, async () => {
				const repo = track(createTestRepo());
				createBranch(repo.path, 'feature');
				createBranch(repo.path, 'removed');
				// With an upstream, rev-parse exits cleanly and so is counted
				setUpstream(repo.path, 'feature', 'main');
				const wt = worktreeOf(repo, 'feature');
				const removed = worktreeOf(repo, 'removed');
				const provider = await newProvider(registered ? [repo.path, wt] : [repo.path]);
				await provider.branches.getBranches(repo.path);
				assert.strictEqual((await provider.branches.getBranch(wt))?.name, 'feature');

				await provider.worktrees.deleteWorktree(repo.path, removed);
				resetSpawns();

				assert.strictEqual((await provider.branches.getBranch(wt))?.name, 'feature');
				assert.strictEqual(spawnCount('rev-parse'), 0);
				assert.strictEqual(spawnCount('for-each-ref'), 0);
			});

			test(`a raw detached checkout in the main checkout leaves ${registered ? 'a registered' : 'an unregistered'} linked worktree's current branch`, async () => {
				const repo = track(createTestRepo());
				createBranch(repo.path, 'feature');
				setUpstream(repo.path, 'feature', 'main');
				const wt = worktreeOf(repo, 'feature');
				const provider = await newProvider(registered ? [repo.path, wt] : [repo.path]);
				await provider.branches.getBranches(repo.path);
				assert.strictEqual((await provider.branches.getBranch(wt))?.name, 'feature');

				await provider.git.run({ cwd: repo.path, notify: 'infer' }, 'checkout', '-q', '--detach');
				resetSpawns();

				assert.strictEqual((await provider.branches.getBranch(wt))?.name, 'feature');
				assert.strictEqual(spawnCount('rev-parse'), 0);
				assert.strictEqual(spawnCount('for-each-ref'), 0);
				assert.strictEqual((await provider.branches.getBranch(repo.path))?.detached, true);
			});

			test(`a raw checkout the main checkout runs with -C in a folder of ${registered ? 'a registered' : 'an unregistered'} linked worktree is seen there`, async () => {
				const repo = track(createTestRepo());
				createBranch(repo.path, 'feature');
				const wt = worktreeOf(repo, 'feature');
				mkdirSync(join(wt, 'folder'));
				const provider = await newProvider(registered ? [repo.path, wt] : [repo.path]);
				await provider.branches.getBranches(repo.path);
				assert.strictEqual((await provider.branches.getBranch(wt))?.name, 'feature');

				await provider.git.run(
					{ cwd: repo.path, notify: 'infer' },
					'-C',
					join(wt, 'folder'),
					'checkout',
					'-q',
					'--detach',
				);

				const branch = await provider.branches.getBranch(wt);
				assert.strictEqual(branch?.detached, true);
				assert.strictEqual(branch?.sha, getHeadSha(wt));
			});
		}

		test('a checkout in a linked worktree the report names is seen there, and another linked worktree reads nothing', async () => {
			const repo = track(createTestRepo());
			createBranch(repo.path, 'feature');
			createBranch(repo.path, 'other');
			createBranch(repo.path, 'second');
			// With an upstream, rev-parse exits cleanly and so is counted
			setUpstream(repo.path, 'other', 'main');
			setUpstream(repo.path, 'second', 'main');
			const wt = worktreeOf(repo, 'feature');
			const wt2 = worktreeOf(repo, 'second');
			const provider = await newProvider([repo.path, wt, wt2]);
			await provider.branches.getBranches(repo.path);
			assert.strictEqual((await provider.branches.getBranch(wt))?.name, 'feature');
			assert.strictEqual((await provider.branches.getBranch(wt2))?.name, 'second');

			checkout(wt, 'other');
			resetSpawns();
			// As the main checkout's watcher reports `worktrees/<id>/HEAD`, naming the worktree by its id
			provider.cache.onRepositoryChanged(repo.path, ['worktrees', 'worktreeHead'], {
				movedWorktrees: new Set([basename(git(wt, 'rev-parse', '--absolute-git-dir'))]),
			});

			assert.strictEqual((await provider.branches.getBranch(wt))?.name, 'other');
			assert.strictEqual(spawnCount('rev-parse'), 1, 'only the worktree that moved reads its HEAD');
			assert.strictEqual((await provider.branches.getBranch(wt2))?.name, 'second');
			assert.strictEqual((await provider.branches.getBranch(repo.path))?.name, 'main');
			assert.strictEqual(spawnCount('rev-parse'), 1, 'the others read nothing');
			assert.strictEqual(spawnCount('for-each-ref'), 0);
		});

		test('a caller aborted after the list is read rejects, rather than answering with no current branch', async () => {
			const repo = track(createTestRepo());
			createBranch(repo.path, 'feature');
			const wt = worktreeOf(repo, 'feature');
			const provider = await newProvider([repo.path, wt]);
			await provider.branches.getBranch(wt, 'main');
			provider.cache.evictCaches(wt, 'branch');

			const controller = new AbortController();
			const cache = provider.cache;
			const getSharedBranches = cache.getSharedBranches;
			cache.getSharedBranches = async function (this: typeof cache, ...args) {
				const result = await getSharedBranches.apply(this, args);
				controller.abort();
				return result;
			};
			try {
				await assert.rejects(provider.branches.getBranch(wt, 'feature', undefined, controller.signal), ex =>
					isCancellationError(ex),
				);
			} finally {
				cache.getSharedBranches = getSharedBranches;
			}

			assert.strictEqual((await provider.branches.getBranch(wt, 'feature'))?.current, true);
		});

		test('a patched metadata value reaches the cached current branch', async () => {
			const repo = track(createTestRepo());
			createBranch(repo.path, 'feature');
			setBranchGkDisposition(repo.path, 'feature', 'starred');
			const wt = worktreeOf(repo, 'feature');
			const provider = await newProvider([repo.path, wt]);
			const current = await provider.branches.getBranch(wt);
			const named = await provider.branches.getBranch(wt, 'feature');
			assert.strictEqual(current?.metadata?.disposition, 'starred');

			const stamp = '2026-10-05T00:00:00.000Z';
			provider.cache.patchBranchMetadata(wt, [{ branch: 'feature', key: 'gk-last-accessed', value: stamp }]);

			assert.strictEqual(current?.metadata?.lastAccessedAt, stamp);
			assert.strictEqual(named?.metadata?.lastAccessedAt, stamp);
			assert.strictEqual(await provider.branches.getBranch(wt), current, 'still cached');
		});
	});

	test('an aborted caller rejects, and leaves the next read an answer', async () => {
		const repo = track(createTestRepo());
		createBranch(repo.path, 'feature');
		const wt = worktreeOf(repo, 'feature');
		const provider = await newProvider([repo.path, wt]);
		const controller = new AbortController();
		controller.abort();

		await assert.rejects(provider.branches.getBranch(wt, 'feature', undefined, controller.signal));
		await assert.rejects(provider.branches.getBranch(wt, undefined, undefined, controller.signal));

		assert.strictEqual((await provider.branches.getBranch(wt, 'feature'))?.current, true);
		assert.strictEqual((await provider.branches.getBranch(wt))?.name, 'feature');
	});

	test('a paged list still answers for the worktree', async () => {
		const repo = createClone();
		const wt = worktreeOf(repo, 'feature');
		const provider = await newProvider([repo.path, wt]);

		const { values } = await provider.branches.getBranches(wt, { paging: { cursor: 'next' } });

		assert.deepStrictEqual(
			values.filter(b => b.current).map(b => b.name),
			['feature'],
		);
		assert.ok(values.every(b => b.repoPath === wt));
		assert.strictEqual(provider.cache.branches.has(wt), false);
	});
});

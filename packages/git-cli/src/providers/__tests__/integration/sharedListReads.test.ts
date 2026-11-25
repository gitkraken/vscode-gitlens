import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GitBranch } from '@gitlens/git/models/branch.js';
import type { GitTag } from '@gitlens/git/models/tag.js';
import { getLocalBranchByUpstream } from '@gitlens/git/utils/branch.utils.js';
import type { LogChannel } from '@gitlens/utils/logger.js';
import { fileUri } from '@gitlens/utils/uri.js';
import type { CliGitProvider } from '../../../cliGitProvider.js';
import type { TestRepo } from './helpers.js';
import {
	addCommit,
	cloneTestRepo,
	createBranch,
	createBranchAt,
	createProvider,
	createTag,
	createTestRepo,
	createTrackingBranch,
	createWorktree,
	getHeadSha,
	revParse,
	setUpstream,
} from './helpers.js';

function git(cwd: string, ...args: string[]): string {
	return execFileSync('git', args, { cwd: cwd, encoding: 'utf-8', stdio: 'pipe' }).trim();
}

/** Everything a `GitBranch` answer carries, in a form `deepStrictEqual` can compare */
function branchFields(branch: GitBranch | undefined): Record<string, unknown> | undefined {
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

/** Everything a `GitTag` answer carries, in a form `deepStrictEqual` can compare */
function tagFields(tag: GitTag | undefined): Record<string, unknown> | undefined {
	if (tag == null) return undefined;

	return {
		repoPath: tag.repoPath,
		refName: tag.refName,
		id: tag.id,
		name: tag.name,
		sha: tag.sha,
		message: tag.message,
		date: tag.date,
		commitDate: tag.commitDate,
		annotated: tag.annotated,
	};
}

type RefFilter = { branches?: (b: GitBranch) => boolean; tags?: (t: GitTag) => boolean };

suite('Reads answered from the shared lists without a per-worktree copy (real git)', () => {
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

	/** A provider with cold caches that knows each of `paths`, so linked worktrees share their common path's lists */
	async function newProvider(paths: readonly string[]): Promise<CliGitProvider> {
		const provider = createProvider({ gitOptions: { logger: spawnLogger } });
		providers.push(provider);
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

	/** A clone with `origin/main` and `origin/tracked`, plus local `feature` and `other` branches, and tracking `tracked` */
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

	teardown(() => {
		for (const provider of providers.splice(0)) {
			provider.dispose();
		}
		for (const cleanup of cleanups.splice(0)) {
			cleanup();
		}
	});

	suite('getLocalBranchByUpstream', () => {
		/**
		 * Asserts `target` answers each of `names` as the full mapped list does (the util over `getBranches`, computed on
		 * a separate provider), keeps no list for itself, and that a list read afterwards is the same as before
		 */
		async function assertParity(
			target: string,
			paths: readonly string[],
			names: readonly string[],
			check?: (expected: Map<string, GitBranch | undefined>) => void,
		): Promise<void> {
			const reference = await newProvider(paths);
			const { values } = await reference.branches.getBranches(target);
			const expected = new Map<string, GitBranch | undefined>();
			for (const name of names) {
				expected.set(name, await getLocalBranchByUpstream(name, new Map(values.map((b, i) => [i, b]))));
			}
			check?.(expected);

			const provider = await newProvider(paths);
			resetSpawns();
			for (const name of names) {
				assert.deepStrictEqual(
					branchFields(await provider.branches.getLocalBranchByUpstream(target, name)),
					branchFields(expected.get(name)),
					name,
				);
			}
			assert.strictEqual(provider.cache.branches.has(target), false, 'no per-worktree list is kept');
			assert.ok(spawnCount('for-each-ref') <= 1, 'the refs are read at most once');

			const { values: after } = await provider.branches.getBranches(target);
			assert.deepStrictEqual(after.map(branchFields), values.map(branchFields), 'a later list is right');
		}

		const names = [
			'origin/tracked',
			'remotes/origin/tracked',
			'origin/main',
			'remotes/origin/main',
			'origin/nothing',
		];

		test('a linked worktree on a plain branch', async () => {
			const repo = createClone();
			const wt = worktreeOf(repo, 'feature');

			await assertParity(wt, [repo.path, wt], names, expected => {
				assert.strictEqual(expected.get('origin/tracked')?.name, 'tracked');
				assert.strictEqual(expected.get('origin/tracked')?.repoPath, wt);
				assert.strictEqual(expected.get('remotes/origin/tracked')?.name, 'tracked');
				assert.strictEqual(expected.get('origin/nothing'), undefined);
			});
		});

		test('the first of two local branches tracking the same upstream wins', async () => {
			const repo = createClone();
			createTrackingBranch(repo.path, 'b-second', 'origin/tracked');
			createTrackingBranch(repo.path, 'a-first', 'origin/tracked');
			const wt = worktreeOf(repo, 'feature');

			await assertParity(wt, [repo.path, wt], names, expected => {
				assert.strictEqual(expected.get('origin/tracked')?.name, 'a-first');
				assert.strictEqual(expected.get('remotes/origin/tracked')?.name, 'a-first');
			});
		});

		test('the worktree’s current branch is the match', async () => {
			const repo = createClone();
			const wt = worktreeOf(repo, 'tracked');

			await assertParity(wt, [repo.path, wt], names, expected => {
				assert.strictEqual(expected.get('origin/tracked')?.name, 'tracked');
				assert.strictEqual(expected.get('origin/tracked')?.current, true);
			});
		});

		test('the main checkout', async () => {
			const repo = createClone();
			const wt = worktreeOf(repo, 'feature');

			await assertParity(repo.path, [repo.path, wt], names, expected => {
				assert.strictEqual(expected.get('origin/main')?.name, 'main');
				assert.strictEqual(expected.get('origin/main')?.current, true);
			});
		});

		test('a detached worktree', async () => {
			const repo = createClone();
			const wt = worktreeOf(repo, 'feature');
			git(wt, 'checkout', '-q', '--detach');

			await assertParity(wt, [repo.path, wt], names, expected => {
				assert.strictEqual(expected.get('origin/tracked')?.name, 'tracked');
				assert.strictEqual(expected.get('origin/tracked')?.current, false);
			});
		});

		test('a rebasing stand-in replaces the listed branch it stands for', async () => {
			const repo = createClone();
			setUpstream(repo.path, 'feature', 'origin/tracked');
			const wt = worktreeOf(repo, 'feature');
			startConflictingRebase(repo.path, wt);

			await assertParity(wt, [repo.path, wt], names, expected => {
				// The listed `feature` tracks the name and sorts ahead of `tracked`, but the stand-in took its place
				assert.strictEqual(expected.get('origin/tracked')?.name, 'tracked');
			});
		});

		test('an unborn current branch listed ahead of the others', async () => {
			const repo = createClone();
			const wt = worktreeOf(repo, 'feature');
			git(wt, 'checkout', '-q', '--orphan', 'unborn');
			git(wt, 'config', 'branch.unborn.remote', 'origin');
			git(wt, 'config', 'branch.unborn.merge', 'refs/heads/tracked');

			await assertParity(wt, [repo.path, wt], names, expected => {
				assert.strictEqual(expected.get('origin/tracked')?.name, 'tracked');
			});
		});

		test('no listed branch tracks the name', async () => {
			const repo = createClone();
			const wt = worktreeOf(repo, 'feature');

			await assertParity(wt, [repo.path, wt], ['origin/nothing', 'remotes/origin/nothing', 'main'], expected => {
				assert.strictEqual(expected.get('origin/nothing'), undefined);
				assert.strictEqual(expected.get('main'), undefined);
			});
		});
	});

	suite('getTag', () => {
		function createTagged(): TestRepo {
			const repo = track(createTestRepo());
			createTag(repo.path, 'v1.0.0', 'First release');
			addCommit(repo.path, 'file1.txt', 'content', 'Second commit');
			createTag(repo.path, 'v1.1.0');
			createBranch(repo.path, 'feature');
			return repo;
		}

		test('answers each tag as the full mapped list does, from a linked worktree, and keeps no list', async () => {
			const repo = createTagged();
			const wt = worktreeOf(repo, 'feature');

			const reference = await newProvider([repo.path, wt]);
			const { values } = await reference.tags.getTags(wt);
			const lookups = ['v1.0.0', 'v1.1.0', 'v9.9.9'];
			const expected = lookups.map(n => values.find(t => t.name === n));
			assert.strictEqual(expected[0]?.annotated, true);
			assert.strictEqual(expected[1]?.annotated, false);
			assert.strictEqual(expected[2], undefined);

			const provider = await newProvider([repo.path, wt]);
			resetSpawns();
			for (const [i, name] of lookups.entries()) {
				const tag = await provider.tags.getTag(wt, name);
				assert.deepStrictEqual(tagFields(tag), tagFields(expected[i]), name);
				if (tag != null) {
					assert.strictEqual(tag.repoPath, wt);
				}
			}
			assert.strictEqual(provider.cache.tags.has(wt), false, 'no per-worktree list is kept');
			assert.strictEqual(spawnCount('for-each-ref'), 1, 'the refs are read once');

			const { values: after } = await provider.tags.getTags(wt);
			assert.deepStrictEqual(after.map(tagFields), values.map(tagFields), 'a later list is right');
			assert.ok(after.every(t => t.repoPath === wt));
			assert.strictEqual(provider.cache.tags.has(wt), true, 'the list keeps its per-worktree entry');
		});

		test('answers in the main checkout', async () => {
			const repo = createTagged();
			const provider = await newProvider([repo.path]);

			const tag = await provider.tags.getTag(repo.path, 'v1.0.0');
			assert.strictEqual(tag?.repoPath, repo.path);
			assert.strictEqual(tag?.sha, revParse(repo.path, 'v1.0.0^{commit}'));
		});

		test('getReference resolves a tag from a linked worktree without a list', async () => {
			const repo = createTagged();
			const wt = worktreeOf(repo, 'feature');
			const provider = await newProvider([repo.path, wt]);

			const ref = await provider.refs.getReference(wt, 'v1.1.0');
			assert.strictEqual(ref?.refType, 'tag');
			assert.strictEqual(provider.cache.tags.has(wt), false);
		});
	});

	suite('hasBranchOrTag', () => {
		function createRefs(): TestRepo {
			const repo = createClone();
			createTag(repo.path, 'v1.0.0', 'First release');
			createTag(repo.path, 'v1.1.0');
			return repo;
		}

		/** What `hasBranchOrTag` answered before: both full mapped lists, filtered */
		async function expectedFor(provider: CliGitProvider, wt: string, filter?: RefFilter): Promise<boolean> {
			const [branches, tags] = await Promise.all([
				provider.branches.getBranches(wt, { filter: filter?.branches, sort: false }),
				provider.tags.getTags(wt, { filter: filter?.tags, sort: false }),
			]);
			return branches.values.length !== 0 || tags.values.length !== 0;
		}

		function defineFilterCase(title: string, filterFor: (wt: string) => RefFilter | undefined): void {
			test(`answers as the full mapped lists do: ${title}`, async () => {
				const repo = createRefs();
				const wt = worktreeOf(repo, 'feature');
				const filter = filterFor(wt);

				const expected = await expectedFor(await newProvider([repo.path, wt]), wt, filter);

				const provider = await newProvider([repo.path, wt]);
				resetSpawns();
				assert.strictEqual(await provider.refs.hasBranchOrTag(wt, { filter: filter }), expected);
				assert.strictEqual(provider.cache.branches.has(wt), false, 'no per-worktree branch list is kept');
				assert.strictEqual(provider.cache.tags.has(wt), false, 'no per-worktree tag list is kept');
				assert.ok(spawnCount('for-each-ref') <= 1, 'the refs are read at most once');

				const { values } = await provider.branches.getBranches(wt);
				assert.ok(values.every(b => b.repoPath === wt));
			});
		}

		defineFilterCase('no filter', () => undefined);
		defineFilterCase('an empty filter', () => ({}));
		defineFilterCase('a branch filter that matches', () => ({ branches: b => b.name === 'other' }));
		defineFilterCase('a branch filter that matches nothing', () => ({ branches: b => b.name === 'nothing' }));
		defineFilterCase('a tag filter that matches', () => ({ tags: t => t.name === 'v1.0.0' }));
		defineFilterCase('a tag filter that matches nothing', () => ({ tags: t => t.name === 'nothing' }));
		defineFilterCase('both filters, the branch matching', () => ({
			branches: b => b.name === 'other',
			tags: t => t.name === 'nothing',
		}));
		defineFilterCase('both filters, the tag matching', () => ({
			branches: b => b.name === 'nothing',
			tags: t => t.name === 'v1.1.0',
		}));
		defineFilterCase('both filters, neither matching', () => ({
			branches: b => b.name === 'nothing',
			tags: t => t.name === 'nothing',
		}));
		defineFilterCase('a branch filter on the worktree’s current branch', () => ({
			branches: b => b.current && b.name === 'feature',
		}));
		defineFilterCase('a branch filter on another branch being current', () => ({
			branches: b => b.current && b.name === 'main',
		}));
		defineFilterCase('a branch filter on the worktree’s path', wt => ({ branches: b => b.repoPath === wt }));
		defineFilterCase('a branch filter on a path other than the worktree’s', wt => ({
			branches: b => b.repoPath !== wt,
		}));
		defineFilterCase('a tag filter on the worktree’s path', wt => ({ tags: t => t.repoPath === wt }));
		defineFilterCase('a tag filter on a path other than the worktree’s', wt => ({
			tags: t => t.repoPath !== wt,
		}));

		test('a predicate sees the worktree’s branches as its list holds them', async () => {
			const repo = createRefs();
			const wt = worktreeOf(repo, 'feature');
			const provider = await newProvider([repo.path, wt]);

			const seen: GitBranch[] = [];
			assert.strictEqual(
				await provider.refs.hasBranchOrTag(wt, {
					filter: {
						branches: b => {
							seen.push(b);
							return false;
						},
						tags: () => false,
					},
				}),
				false,
			);

			const reference = await newProvider([repo.path, wt]);
			const { values } = await reference.branches.getBranches(wt);
			assert.deepStrictEqual(seen.map(branchFields), values.map(branchFields));
		});

		test('a detached worktree’s stand-in is among the branches a predicate sees', async () => {
			const repo = createRefs();
			const wt = worktreeOf(repo, 'feature');
			git(wt, 'checkout', '-q', '--detach');
			const provider = await newProvider([repo.path, wt]);

			assert.strictEqual(
				await provider.refs.hasBranchOrTag(wt, { filter: { branches: b => b.detached, tags: () => false } }),
				true,
			);
			assert.strictEqual(
				await provider.refs.hasBranchOrTag(wt, {
					filter: { branches: b => b.current && !b.detached, tags: () => false },
				}),
				false,
			);
			assert.strictEqual(provider.cache.branches.has(wt), false);
		});

		test('reads no tags once a branch matched', async () => {
			const repo = createRefs();
			const wt = worktreeOf(repo, 'feature');
			const provider = await newProvider([repo.path, wt]);

			assert.strictEqual(
				await provider.refs.hasBranchOrTag(wt, {
					filter: {
						branches: b => b.name === 'other',
						tags: () => {
							throw new Error('a tag was judged');
						},
					},
				}),
				true,
			);
			assert.strictEqual(provider.cache.tags.has(repo.path), false, 'the tag list was not read');
			assert.strictEqual(provider.cache.tags.has(wt), false);
		});

		test('reads the tags when no branch matched, and keeps no copy of them', async () => {
			const repo = createRefs();
			const wt = worktreeOf(repo, 'feature');
			const provider = await newProvider([repo.path, wt]);

			assert.strictEqual(
				await provider.refs.hasBranchOrTag(wt, {
					filter: { branches: b => b.name === 'nothing', tags: t => t.name === 'v1.0.0' },
				}),
				true,
			);
			assert.strictEqual(provider.cache.tags.has(repo.path), true, 'the shared tag list was read');
			assert.strictEqual(provider.cache.tags.has(wt), false);
		});
	});

	suite('applyUnreachableCommitForPatch', () => {
		function createPatchCommit(repo: TestRepo): string {
			createBranchAt(repo.path, 'patch-source', 'main');
			const dir = mkdtempSync(join(tmpdir(), 'gitlens-patch-'));
			cleanups.unshift(() => rmSync(dir, { recursive: true, force: true }));
			const source = join(dir, 'wt');
			git(repo.path, 'worktree', 'add', '-q', source, 'patch-source');
			cleanups.unshift(() => git(repo.path, 'worktree', 'remove', '--force', source));
			addCommit(source, 'patched.txt', 'patched', 'Patch commit');
			return getHeadSha(source);
		}

		test('checks an existing branch from a linked worktree without keeping a list', async () => {
			const repo = createClone();
			const rev = createPatchCommit(repo);
			const wt = worktreeOf(repo, 'feature');
			const provider = await newProvider([repo.path, wt]);

			await provider.patch.applyUnreachableCommitForPatch(wt, rev, { branchName: 'feature' });
			assert.strictEqual(provider.cache.branches.has(wt), false);

			git(wt, 'reset', '-q', '--hard');
			git(wt, 'clean', '-fdq');
			await provider.patch.applyUnreachableCommitForPatch(wt, rev, { branchName: 'other' });
			assert.strictEqual(git(wt, 'rev-parse', '--abbrev-ref', 'HEAD'), 'other');
			assert.strictEqual(provider.cache.branches.has(wt), false);
		});

		test('creates a missing branch when asked, and fails to check one out when not', async () => {
			const repo = createClone();
			const rev = createPatchCommit(repo);
			const wt = worktreeOf(repo, 'feature');
			const provider = await newProvider([repo.path, wt]);

			await assert.rejects(provider.patch.applyUnreachableCommitForPatch(wt, rev, { branchName: 'missing' }));
			assert.strictEqual(provider.cache.branches.has(wt), false);

			await provider.patch.applyUnreachableCommitForPatch(wt, rev, {
				branchName: 'created',
				createBranchIfNeeded: true,
			});
			assert.strictEqual(git(wt, 'rev-parse', '--abbrev-ref', 'HEAD'), 'created');
			assert.strictEqual(provider.cache.branches.has(wt), false);
		});
	});
});

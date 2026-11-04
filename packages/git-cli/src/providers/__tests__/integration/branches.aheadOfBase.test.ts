import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as sinon from 'sinon';
import type { AheadOfBase } from '@gitlens/git/providers/branches.js';
import { formatDetachedHeadName } from '@gitlens/git/utils/branch.utils.js';
import { isCancellationError } from '@gitlens/utils/cancellation.js';
import { fileUri, toFsPath } from '@gitlens/utils/uri.js';
import { patchCheckClock } from '../../branches.js';
import type { TestRepo } from './helpers.js';
import {
	addCommit,
	addEmptyCommits,
	checkout,
	cloneTestRepo,
	createBranch,
	createBranchAt,
	createTestRepo,
	createTrackingBranch,
	fetch,
	getHeadSha,
	gkConfig,
	mergeBranch,
	setConfig,
	setRemoteHead,
	supportsReftable,
} from './helpers.js';

// Every fixture is built before the provider's first read of it: the provider caches merge bases, ref lookups
// and the gk config, and no watcher runs here to invalidate them.

function git(repoPath: string, ...args: string[]): void {
	execFileSync('git', args, { cwd: repoPath, stdio: 'pipe' });
}

function revParse(repoPath: string, ref: string): string {
	return execFileSync('git', ['rev-parse', ref], { cwd: repoPath, encoding: 'utf-8' }).trim();
}

function mergeBase(repoPath: string, ref: string): string {
	return execFileSync('git', ['merge-base', 'HEAD', ref], { cwd: repoPath, encoding: 'utf-8' }).trim();
}

function storeGk(repoPath: string, key: string, value: string): void {
	mkdirSync(join(repoPath, '.git', 'gk'), { recursive: true });
	git(repoPath, 'config', '--file', join(repoPath, '.git', 'gk', 'config'), key, value);
}

function storeTargets(
	repoPath: string,
	branch: string,
	targets: { user?: string; detected?: string; recorded?: string },
): void {
	if (targets.user != null) {
		storeGk(repoPath, `branch.${branch}.gk-merge-target-user`, targets.user);
	}
	if (targets.detected != null) {
		storeGk(repoPath, `branch.${branch}.gk-merge-target`, targets.detected);
	}
	if (targets.recorded != null) {
		storeGk(repoPath, `branch.${branch}.gk-merge-base`, targets.recorded);
	}
}

/**
 * Creates and checks out `name` at `startPoint` from a detached HEAD, so its reflog names no branch it was created
 * from ("Created from HEAD") and the base falls through to the default branch
 */
function createBranchFromDetachedHead(repoPath: string, name: string, startPoint: string): void {
	git(repoPath, 'checkout', '--detach', startPoint);
	git(repoPath, 'checkout', '-b', name);
}

function getAheadOfBase(
	repo: TestRepo,
	branch: string | undefined,
	options?: { skipUserTarget?: boolean; preferredTarget?: string },
	cancellation?: AbortSignal,
): Promise<AheadOfBase> {
	return repo.provider.branches.getAheadOfBase(repo.path, branch, options, cancellation);
}

function assertDependsOn(result: AheadOfBase, refs: string[]): void {
	for (const ref of refs) {
		assert.ok(
			result.dependsOn.includes(ref),
			`Expected dependsOn to include ${ref}: ${result.dependsOn.join(', ')}`,
		);
	}
}

/** A repo whose `feature` sits on a stack of three candidate bases, each one commit past the last, so the
 *  count names which candidate won. */
function createCandidateRepo(): TestRepo {
	const repo = createTestRepo();
	for (const branch of ['develop', 'release', 'staging']) {
		createBranch(repo.path, branch, { checkout: true });
		addCommit(repo.path, `${branch}-only.txt`, branch, `${branch} only`);
	}
	createBranch(repo.path, 'feature', { checkout: true });
	addCommit(repo.path, 'branch-only.txt', 'feature', 'branch only');
	return repo;
}

/** How a fixture's clone stores its refs, which decides whether its reflogs are files */
type CloneOptions = { readonly refFormat?: 'reftable' };

/** A clone of a fresh origin. `git clone` sets `refs/remotes/origin/HEAD`, so the clone's default branch
 *  resolves from the symref. */
function createClone(options?: CloneOptions): { origin: TestRepo; clone: TestRepo; cleanup: () => void } {
	const origin = createTestRepo();
	let clone: TestRepo;
	try {
		clone = cloneTestRepo(origin.path, options);
	} catch (ex) {
		origin.cleanup();
		throw ex;
	}
	return {
		origin: origin,
		clone: clone,
		cleanup: () => {
			clone.cleanup();
			origin.cleanup();
		},
	};
}

/** A fork's clone: local `main` tracks `origin/main`, and an `upstream` remote's `main` is one commit past it unless `synced` */
function createFork(options?: { synced?: boolean }): { origin: TestRepo; clone: TestRepo; cleanup: () => void } {
	const fork = createClone();
	try {
		if (!options?.synced) {
			addCommit(fork.origin.path, 'upstream-only.txt', 'upstream', 'upstream only');
		}
		// `origin/main` stays at the clone's commit
		git(fork.clone.path, 'remote', 'add', 'upstream', fork.origin.path);
		fetch(fork.clone.path, 'upstream');
	} catch (ex) {
		fork.cleanup();
		throw ex;
	}
	return fork;
}

/**
 * `feature` taken off `origin/main` with four commits of its own, then `origin/main` force-moved through `moves`, each
 * brought in by a real fetch, so its reflog holds them. A move may name one of `feature`'s commits by its index.
 */
function createForceMovedBase(
	moves: (shas: { base: string; commits: string[] }) => string[],
	options?: CloneOptions,
): {
	origin: TestRepo;
	clone: TestRepo;
	base: string;
	commits: string[];
	cleanup: () => void;
} {
	const { origin, clone, cleanup } = createClone(options);
	try {
		const base = revParse(clone.path, 'origin/main');
		createBranchFromDetachedHead(clone.path, 'feature', 'origin/main');
		const commits: string[] = [];
		for (let i = 1; i <= 4; i++) {
			addCommit(clone.path, `c${i}.txt`, `c${i}`, `c${i}`);
			commits.push(getHeadSha(clone.path));
		}

		git(origin.path, 'fetch', '-q', clone.path, 'feature');
		for (const sha of moves({ base: base, commits: commits })) {
			git(origin.path, 'reset', '-q', '--hard', sha);
			fetch(clone.path);
		}
		return { origin: origin, clone: clone, base: base, commits: commits, cleanup: cleanup };
	} catch (ex) {
		cleanup();
		throw ex;
	}
}

/**
 * `feature` taken off `origin/main` at `oldTip` with one commit of its own, then `origin/main` rewritten in one real
 * fetch: another commit put on `oldTip`'s parent, and with `rewrite` `'rebased'` `oldTip` replayed onto it (the same
 * patch, as a rebase leaves it), or with `'replaced'` not (`oldTip` dropped for good). `pad` empty commits then follow.
 */
function createRewrittenBase(
	rewrite: 'rebased' | 'replaced',
	pad = 0,
	options?: CloneOptions,
): { origin: TestRepo; clone: TestRepo; oldTip: string; cleanup: () => void } {
	const { origin, clone, cleanup } = createClone(options);
	try {
		addCommit(origin.path, 'old-tip.txt', 'old', 'old tip');
		fetch(clone.path);
		const oldTip = revParse(clone.path, 'origin/main');
		createBranchFromDetachedHead(clone.path, 'feature', 'origin/main');
		addCommit(clone.path, 'branch-only.txt', 'feature', 'branch only');

		git(origin.path, 'reset', '-q', '--hard', 'HEAD~1');
		addCommit(origin.path, 'new-tip.txt', 'new', 'rewritten tip');
		if (rewrite === 'rebased') {
			git(origin.path, 'cherry-pick', oldTip);
		}
		addEmptyCommits(origin.path, pad);
		fetch(clone.path);
		return { origin: origin, clone: clone, oldTip: oldTip, cleanup: cleanup };
	} catch (ex) {
		cleanup();
		throw ex;
	}
}

/** Fast-forwards `branch` onto `sha` and resets it back, as a merged pull request undone leaves it, then checks out `back` */
function moveOntoAndBack(repoPath: string, branch: string, sha: string, back: string): void {
	const tip = revParse(repoPath, branch);
	git(repoPath, 'checkout', '-q', branch);
	git(repoPath, 'merge', '-q', '--ff-only', sha);
	git(repoPath, 'reset', '-q', '--hard', tip);
	git(repoPath, 'checkout', '-q', back);
}

/**
 * `child` stacked on `parent`, each created from the branch below it: `parent` one commit past `main`, `child` two
 * past `parent`. `main` is then fast-forwarded onto `child`'s first commit and reset back; `child` is checked out.
 */
function createStackOverRewoundMain(repoPath: string): { base: string; parentTip: string; childCommits: string[] } {
	const base = revParse(repoPath, 'main');
	git(repoPath, 'checkout', '-q', '-b', 'parent', 'main');
	addCommit(repoPath, 'parent.txt', 'parent', 'parent');
	const parentTip = getHeadSha(repoPath);
	git(repoPath, 'checkout', '-q', '-b', 'child', 'parent');
	const childCommits: string[] = [];
	for (let i = 1; i <= 2; i++) {
		addCommit(repoPath, `child-${i}.txt`, `child ${i}`, `child ${i}`);
		childCommits.push(getHeadSha(repoPath));
	}
	moveOntoAndBack(repoPath, 'main', childCommits[0], 'child');
	return { base: base, parentTip: parentTip, childCommits: childCommits };
}

/**
 * `feat` created from `feat-a`, `feat-a` merged into `main` (one commit past where `feat-a` started) and `feat` rebased
 * onto `main`, so `main` holds `feat-a` and `feat` has one commit of its own; `feat` is checked out
 */
function createRebasedOntoMergedParent(repoPath: string): { parentTip: string; mainTip: string; own: string } {
	git(repoPath, 'checkout', '-q', '-b', 'feat-a', 'main');
	addCommit(repoPath, 'feat-a.txt', 'feat-a', 'feat-a work');
	const parentTip = getHeadSha(repoPath);
	git(repoPath, 'checkout', '-q', '-b', 'feat', 'feat-a');
	addCommit(repoPath, 'feat.txt', 'feat', 'feat work');
	checkout(repoPath, 'main');
	addCommit(repoPath, 'main-only.txt', 'main', 'main only');
	mergeBranch(repoPath, 'feat-a', 'merge feat-a');
	const mainTip = getHeadSha(repoPath);
	checkout(repoPath, 'feat');
	git(repoPath, 'rebase', '-q', 'main');
	return { parentTip: parentTip, mainTip: mainTip, own: getHeadSha(repoPath) };
}

/** Fails each of `repo`'s git runs whose string arguments `fails` picks, as a run that couldn't start does */
function failRuns(repo: TestRepo, fails: (args: string[]) => boolean): sinon.SinonStub {
	const git = repo.provider.git;
	const run = git.run.bind(git);
	return sinon
		.stub(git, 'run')
		.callsFake(((options: unknown, ...args: unknown[]) =>
			fails(args.filter((a): a is string => typeof a === 'string'))
				? Promise.reject(new Error('failed'))
				: run(options as never, ...(args as never[]))) as typeof git.run);
}

/** `git merge-base --fork-point <ref> HEAD`, git's own reading */
function gitForkPoint(repoPath: string, ref: string): string {
	return execFileSync('git', ['merge-base', '--fork-point', ref, 'HEAD'], {
		cwd: repoPath,
		encoding: 'utf-8',
	}).trim();
}

suite('BranchesSubProvider.getAheadOfBase', () => {
	suite('merge target order', () => {
		test("measures against the user's merge target over every other recorded one", async () => {
			const repo = createCandidateRepo();
			try {
				storeTargets(repo.path, 'feature', { user: 'develop', detected: 'release', recorded: 'staging' });

				const result = await getAheadOfBase(repo, 'feature');
				assert.strictEqual(result.base?.ref, 'develop');
				assert.strictEqual(result.base?.ahead, 3);
				assert.strictEqual(result.base?.sha, revParse(repo.path, 'develop'));
				assert.strictEqual(result.base?.tier, 'user');
				assert.strictEqual(result.base?.forkPoint, mergeBase(repo.path, 'develop'));
				assertDependsOn(result, ['refs/heads/feature', 'refs/heads/develop']);
				assert.ok(
					!result.dependsOn.includes('refs/heads/release'),
					'A candidate past the chosen one is not read',
				);
			} finally {
				repo.cleanup();
			}
		});

		test('reports the commit a tag resolves to when a tag and a branch share the base name', async () => {
			const repo = createCandidateRepo();
			try {
				// Git resolves the short name to the tag, so the count and the sha are the tag's, not the branch's
				git(repo.path, 'tag', '-a', 'develop', '-m', 'tag', revParse(repo.path, 'develop^'));
				storeTargets(repo.path, 'feature', { user: 'develop' });

				const result = await getAheadOfBase(repo, 'feature');
				assert.strictEqual(result.base?.ref, 'develop');
				assert.strictEqual(result.base?.sha, revParse(repo.path, 'refs/tags/develop^{commit}'));
				assert.notStrictEqual(result.base?.sha, revParse(repo.path, 'refs/heads/develop'));
				assertDependsOn(result, ['refs/tags/develop']);
				assert.strictEqual(
					result.base?.ahead,
					Number(
						execFileSync('git', ['rev-list', '--count', 'refs/tags/develop..HEAD'], {
							cwd: repo.path,
							encoding: 'utf-8',
						}).trim(),
					),
				);
			} finally {
				repo.cleanup();
			}
		});

		test('measures against the detected merge target over the recorded base', async () => {
			const repo = createCandidateRepo();
			try {
				storeTargets(repo.path, 'feature', { detected: 'release', recorded: 'staging' });

				const result = await getAheadOfBase(repo, 'feature');
				assert.strictEqual(result.base?.ref, 'release');
				assert.strictEqual(result.base?.ahead, 2);
				assert.strictEqual(result.base?.tier, 'detected');
			} finally {
				repo.cleanup();
			}
		});

		test('measures against the recorded base when no merge target is stored', async () => {
			const repo = createCandidateRepo();
			try {
				storeTargets(repo.path, 'feature', { recorded: 'staging' });

				const result = await getAheadOfBase(repo, 'feature');
				assert.strictEqual(result.base?.ref, 'staging');
				assert.strictEqual(result.base?.ahead, 1);
				assert.strictEqual(result.base?.tier, 'recorded');
			} finally {
				repo.cleanup();
			}
		});

		test('falls through a target that names no ref, and one that would parse as a flag', async () => {
			const repo = createCandidateRepo();
			try {
				storeTargets(repo.path, 'feature', {
					user: 'origin/gone',
					detected: '--output=x',
					recorded: 'staging',
				});

				const result = await getAheadOfBase(repo, 'feature');
				assert.strictEqual(result.base?.ref, 'staging');
				assert.strictEqual(result.base?.ahead, 1);
				assert.strictEqual(result.base?.tier, 'recorded');
				// The missing ref was compared, so its creation can change the answer; the flag never was
				assertDependsOn(result, ['refs/heads/origin/gone', 'refs/remotes/origin/gone', 'refs/heads/staging']);
				assert.ok(!result.dependsOn.some(ref => ref.includes('--output')));
			} finally {
				repo.cleanup();
			}
		});

		test('skips a candidate naming the branch itself', async () => {
			const repo = createCandidateRepo();
			try {
				storeTargets(repo.path, 'feature', { user: 'feature', detected: 'develop' });

				const result = await getAheadOfBase(repo, 'feature');
				assert.strictEqual(result.base?.ref, 'develop');
				assert.strictEqual(result.base?.ahead, 3);
				assert.strictEqual(result.base?.tier, 'detected');
			} finally {
				repo.cleanup();
			}
		});
	});

	suite('a base that is the branch itself', () => {
		test('answers no base when the target is its own upstream at the same commit', async () => {
			const { clone, cleanup } = createClone();
			try {
				storeTargets(clone.path, 'main', { user: 'origin/main' });

				// "Up to date with its own upstream" is no signal, not "0 ahead"
				const result = await getAheadOfBase(clone, 'main');
				assert.strictEqual(result.base, undefined);
				assert.strictEqual(result.reason, 'self');
				assertDependsOn(result, ['refs/heads/main', 'refs/remotes/origin/main']);
			} finally {
				cleanup();
			}
		});

		test('answers no base for a recorded remote copy of itself at the same commit, with no tracking set', async () => {
			const repo = createTestRepo();
			try {
				git(repo.path, 'remote', 'add', 'origin', 'https://example.test/repo.git');
				git(repo.path, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
				storeTargets(repo.path, 'main', { recorded: 'origin/main' });

				const result = await getAheadOfBase(repo, 'main');
				assert.strictEqual(result.base, undefined);
				assert.strictEqual(result.reason, 'self');
				assertDependsOn(result, ['refs/remotes/origin/main']);
			} finally {
				repo.cleanup();
			}
		});

		test('measures against its own upstream once their tips differ: the unpushed work', async () => {
			const { clone, cleanup } = createClone();
			try {
				addCommit(clone.path, 'unpushed.txt', 'unpushed', 'unpushed on main');
				storeTargets(clone.path, 'main', { user: 'origin/main' });

				const result = await getAheadOfBase(clone, 'main');
				assert.strictEqual(result.base?.ref, 'origin/main');
				assert.strictEqual(result.base?.ahead, 1);
			} finally {
				cleanup();
			}
		});

		test('measures 0 ahead of its own upstream once a fetch moves it on', async () => {
			const { origin, clone, cleanup } = createClone();
			try {
				addCommit(origin.path, 'origin-only.txt', 'origin', 'origin only');
				fetch(clone.path);
				storeTargets(clone.path, 'main', { user: 'origin/main' });

				const result = await getAheadOfBase(clone, 'main');
				assert.deepStrictEqual(result.base, {
					ref: 'origin/main',
					ahead: 0,
					sha: revParse(clone.path, 'origin/main'),
					forkPoint: mergeBase(clone.path, 'origin/main'),
					tier: 'user',
				});
			} finally {
				cleanup();
			}
		});

		test('does not take a local branch that only ends with the same name for the branch itself', async () => {
			const repo = createTestRepo();
			try {
				git(repo.path, 'branch', 'release/main');
				storeTargets(repo.path, 'main', { user: 'release/main' });

				const result = await getAheadOfBase(repo, 'main');
				assert.strictEqual(result.base?.ref, 'release/main');
				assert.strictEqual(result.base?.ahead, 0);
			} finally {
				repo.cleanup();
			}
		});

		test('measures the default branch against its own upstream: the unpushed work', async () => {
			const { clone, cleanup } = createClone();
			try {
				addCommit(clone.path, 'unpushed-1.txt', 'unpushed', 'unpushed on main');
				addCommit(clone.path, 'unpushed-2.txt', 'unpushed', 'more unpushed on main');

				const result = await getAheadOfBase(clone, 'main');
				assert.deepStrictEqual(result.base, {
					ref: 'origin/main',
					ahead: 2,
					sha: revParse(clone.path, 'origin/main'),
					forkPoint: mergeBase(clone.path, 'origin/main'),
					tier: 'upstream',
				});
				assertDependsOn(result, ['refs/heads/main', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);
			} finally {
				cleanup();
			}
		});

		test("prefers an upstream remote's copy of the default branch over its own upstream", async () => {
			const { origin, clone, cleanup } = createClone();
			try {
				addCommit(origin.path, 'origin-only.txt', 'origin', 'origin only');
				git(clone.path, 'remote', 'add', 'upstream', origin.path);
				// `origin/main` stays at the clone's commit; `upstream/main` has moved on
				fetch(clone.path, 'upstream');
				setRemoteHead(clone.path, 'upstream', 'main');
				addCommit(clone.path, 'unpushed.txt', 'unpushed', 'unpushed on main');

				const result = await getAheadOfBase(clone, 'main');
				assert.strictEqual(result.base?.ref, 'upstream/main');
				assert.strictEqual(result.base?.ahead, 1);
				assert.strictEqual(result.base?.sha, revParse(clone.path, 'upstream/main'));
				assert.notStrictEqual(result.base?.sha, revParse(clone.path, 'origin/main'));
				assert.strictEqual(result.base?.tier, 'upstream');
				assertDependsOn(result, ['refs/remotes/upstream/HEAD', 'refs/remotes/upstream/main']);
			} finally {
				cleanup();
			}
		});

		test("answers no base on the default branch at its own upstream's commit", async () => {
			const { clone, cleanup } = createClone();
			try {
				const result = await getAheadOfBase(clone, 'main');
				assert.strictEqual(result.base, undefined);
				assert.strictEqual(result.reason, 'self');
				// Either moving brings the base back
				assertDependsOn(result, ['refs/heads/main', 'refs/remotes/origin/main']);
			} finally {
				cleanup();
			}
		});

		test('measures the default branch only ahead of its upstream with the count alone, its tip the fork point', async () => {
			const { clone, cleanup } = createClone();
			try {
				addCommit(clone.path, 'unpushed-1.txt', 'unpushed', 'unpushed on main');
				await getAheadOfBase(clone, 'main');

				// A commit clears the cached results, as the heads watcher does
				addCommit(clone.path, 'unpushed-2.txt', 'unpushed', 'more unpushed on main');
				clone.provider.cache.clearCaches(clone.path, 'branch', 'branches');

				const spy = sinon.spy(clone.provider.git, 'run');
				let result: AheadOfBase;
				try {
					result = await getAheadOfBase(clone, 'main');
				} finally {
					spy.restore();
				}

				assert.deepStrictEqual(result.base, {
					ref: 'origin/main',
					ahead: 2,
					sha: revParse(clone.path, 'origin/main'),
					forkPoint: revParse(clone.path, 'origin/main'),
					tier: 'upstream',
				});

				const calls = spy.getCalls().map(c => c.args.slice(1).filter(a => typeof a === 'string'));
				assert.strictEqual(calls.filter(args => args[0] === 'merge-base').length, 0, 'spawned a merge-base');
				assert.strictEqual(calls.filter(args => args[0] === 'rev-list').length, 1, 'expected one count');
				const upstreamReads = calls.filter(
					args =>
						args[0] === 'rev-parse' &&
						args.some(a => a.startsWith('HEAD') || a.includes('@{u}') || a.includes('origin/main')),
				);
				assert.deepStrictEqual(upstreamReads, [], 'read the upstream or HEAD with rev-parse');
			} finally {
				cleanup();
			}
		});

		test('measures the default branch behind its upstream from their fork point', async () => {
			const { origin, clone, cleanup } = createClone();
			try {
				addCommit(origin.path, 'origin-only.txt', 'origin', 'origin only');
				fetch(clone.path);
				addCommit(clone.path, 'unpushed.txt', 'unpushed', 'unpushed on main');

				const result = await getAheadOfBase(clone, 'main');
				assert.deepStrictEqual(result.base, {
					ref: 'origin/main',
					ahead: 1,
					sha: revParse(clone.path, 'origin/main'),
					forkPoint: mergeBase(clone.path, 'origin/main'),
					tier: 'upstream',
				});
				assert.notStrictEqual(result.base?.forkPoint, result.base?.sha);
			} finally {
				cleanup();
			}
		});

		test('answers no base on the default branch when its upstream ref is gone', async () => {
			const { clone, cleanup } = createClone();
			try {
				addCommit(clone.path, 'unpushed.txt', 'unpushed', 'unpushed on main');
				setConfig(clone.path, 'branch.main.merge', 'refs/heads/gone');

				const result = await getAheadOfBase(clone, 'main');
				assert.strictEqual(result.base, undefined);
				assert.strictEqual(result.reason, 'self');
				// The fetch or push that recreates it brings the base back
				assertDependsOn(result, ['refs/remotes/origin/gone']);
			} finally {
				cleanup();
			}
		});

		test('reads the upstream of a default branch that is not checked out', async () => {
			const { clone, cleanup } = createClone();
			try {
				createBranch(clone.path, 'feature', { checkout: true });
				addCommit(clone.path, 'feature.txt', 'feature', 'feature work');

				const result = await getAheadOfBase(clone, 'main');
				assert.deepStrictEqual(result.base, {
					ref: 'origin/main',
					ahead: 1,
					sha: revParse(clone.path, 'origin/main'),
					forkPoint: revParse(clone.path, 'origin/main'),
					tier: 'upstream',
				});
			} finally {
				cleanup();
			}
		});
	});

	suite('base vs its tracking ref', () => {
		test('cuts at the remote fork when the local default branch is stale', async () => {
			const { origin, clone, cleanup } = createClone();
			try {
				addCommit(origin.path, 'origin-only.txt', 'origin', 'origin only');
				fetch(clone.path);
				// Taken off the fetched remote tip; local `main` stays behind at the clone's commit
				createBranchFromDetachedHead(clone.path, 'feature', 'origin/main');
				addCommit(clone.path, 'branch-only.txt', 'feature', 'branch only');

				const result = await getAheadOfBase(clone, 'feature');
				assert.strictEqual(result.base?.ref, 'origin/main');
				assert.strictEqual(result.base?.ahead, 1);
				assert.strictEqual(result.base?.sha, revParse(clone.path, 'origin/main'));
				assertDependsOn(result, [
					'refs/heads/feature',
					'refs/heads/main',
					'refs/remotes/origin/main',
					'refs/remotes/origin/HEAD',
				]);
			} finally {
				cleanup();
			}
		});

		test('defers a stale recorded base to its fresher upstream', async () => {
			const { origin, clone, cleanup } = createClone();
			try {
				addCommit(origin.path, 'origin-only.txt', 'origin', 'origin only');
				fetch(clone.path);
				createBranchAt(clone.path, 'feature', 'origin/main', { checkout: true });
				addCommit(clone.path, 'branch-only.txt', 'feature', 'branch only');
				storeTargets(clone.path, 'feature', { recorded: 'main' });

				const result = await getAheadOfBase(clone, 'feature');
				assert.strictEqual(result.base?.ref, 'origin/main');
				assert.strictEqual(result.base?.ahead, 1);
				assertDependsOn(result, ['refs/heads/main', 'refs/remotes/origin/main']);
				// The default was never consulted
				assert.ok(!result.dependsOn.includes('refs/remotes/origin/HEAD'));
			} finally {
				cleanup();
			}
		});

		test('prefers a local base carrying unpushed work over its upstream', async () => {
			const { clone, cleanup } = createClone();
			try {
				addCommit(clone.path, 'unpushed.txt', 'unpushed', 'unpushed on main');
				createBranch(clone.path, 'feature', { checkout: true });
				addCommit(clone.path, 'branch-only.txt', 'feature', 'branch only');
				storeTargets(clone.path, 'feature', { recorded: 'main' });

				const result = await getAheadOfBase(clone, 'feature');
				assert.strictEqual(result.base?.ref, 'main');
				assert.strictEqual(result.base?.ahead, 1);
			} finally {
				cleanup();
			}
		});

		test('never asks a remote-tracking target for its upstream, which it cannot have', async () => {
			const { origin, clone, cleanup } = createClone();
			try {
				addCommit(origin.path, 'origin-only.txt', 'origin', 'origin only');
				fetch(clone.path);
				createBranchAt(clone.path, 'feature', 'origin/main', { checkout: true });
				addCommit(clone.path, 'branch-only.txt', 'feature', 'branch only');
				storeTargets(clone.path, 'feature', { detected: 'origin/main' });

				const spy = sinon.spy(clone.provider.git, 'run');
				let result: AheadOfBase;
				try {
					result = await getAheadOfBase(clone, 'feature');
				} finally {
					spy.restore();
				}

				assert.strictEqual(result.base?.ref, 'origin/main');
				assert.strictEqual(result.base?.ahead, 1);
				assert.strictEqual(result.base?.sha, revParse(clone.path, 'origin/main'));
				assertDependsOn(result, ['refs/remotes/origin/main']);
				const upstreamReads = spy
					.getCalls()
					.filter(c => c.args.some(a => typeof a === 'string' && a.endsWith('@{u}')));
				assert.deepStrictEqual(
					upstreamReads.map(c => c.args.filter(a => typeof a === 'string').join(' ')),
					[],
				);
			} finally {
				cleanup();
			}
		});

		test('asks a local target for its upstream, and measures against it when it forked nearer', async () => {
			const { origin, clone, cleanup } = createClone();
			try {
				addCommit(origin.path, 'origin-only.txt', 'origin', 'origin only');
				fetch(clone.path);
				createBranchAt(clone.path, 'feature', 'origin/main', { checkout: true });
				addCommit(clone.path, 'branch-only.txt', 'feature', 'branch only');
				storeTargets(clone.path, 'feature', { detected: 'main' });

				const spy = sinon.spy(clone.provider.git, 'run');
				let result: AheadOfBase;
				try {
					result = await getAheadOfBase(clone, 'feature');
				} finally {
					spy.restore();
				}

				assert.strictEqual(result.base?.ref, 'origin/main');
				assert.strictEqual(result.base?.ahead, 1);
				assertDependsOn(result, ['refs/heads/main', 'refs/remotes/origin/main']);
				assert.ok(
					spy.getCalls().some(c => c.args.includes('main@{u}')),
					'the local target was asked for its upstream',
				);
			} finally {
				cleanup();
			}
		});

		test('keeps a merged-in default branch out of the count when local main is stale', async () => {
			const { origin, clone, cleanup } = createClone();
			try {
				addCommit(origin.path, 'origin-first.txt', 'first', 'origin first');
				fetch(clone.path);
				createBranchFromDetachedHead(clone.path, 'feature', 'origin/main');
				addCommit(clone.path, 'branch-only.txt', 'feature', 'branch only');
				addCommit(origin.path, 'origin-second.txt', 'second', 'origin second');
				fetch(clone.path);
				mergeBranch(clone.path, 'origin/main', 'merge origin/main');

				const result = await getAheadOfBase(clone, 'feature');
				assert.strictEqual(result.base?.ref, 'origin/main');
				// The branch's own commit and the merge; nothing that arrived on the default branch
				assert.strictEqual(result.base?.ahead, 2);
			} finally {
				cleanup();
			}
		});
	});

	suite('a base force-moved over the branch', () => {
		test('takes the tip of a stored target moved back off a commit of the branch', async () => {
			const { clone, base, cleanup } = createForceMovedBase(({ base, commits }) => [commits[1], base]);
			try {
				storeTargets(clone.path, 'feature', { detected: 'origin/main' });

				const result = await getAheadOfBase(clone, 'feature');
				assert.deepStrictEqual(result.base, {
					ref: 'origin/main',
					ahead: 4,
					sha: base,
					forkPoint: base,
					tier: 'detected',
				});
			} finally {
				cleanup();
			}
		});

		test('takes the tip of the default branch moved back off a commit of the branch', async () => {
			const { clone, base, cleanup } = createForceMovedBase(({ base, commits }) => [commits[1], base]);
			try {
				const result = await getAheadOfBase(clone, 'feature');
				assert.deepStrictEqual(result.base, {
					ref: 'origin/main',
					ahead: 4,
					sha: base,
					forkPoint: base,
					tier: 'default',
				});
			} finally {
				cleanup();
			}
		});

		test('takes the tip when it was moved back to another commit of the branch', async () => {
			const { clone, commits, cleanup } = createForceMovedBase(({ commits }) => [commits[2], commits[0]]);
			try {
				storeTargets(clone.path, 'feature', { detected: 'origin/main' });

				const result = await getAheadOfBase(clone, 'feature');
				assert.strictEqual(result.base?.forkPoint, commits[0]);
				assert.strictEqual(result.base?.ahead, 3);
			} finally {
				cleanup();
			}
		});

		test('keeps the fork point of a rebased base, whose tip the branch lacks, and counts past it', async () => {
			const { clone, oldTip, cleanup } = createRewrittenBase('rebased');
			try {
				storeTargets(clone.path, 'feature', { detected: 'origin/main' });

				const result = await getAheadOfBase(clone, 'feature');
				assert.notStrictEqual(
					mergeBase(clone.path, 'origin/main'),
					oldTip,
					'the merge base is before the rewrite',
				);
				assert.strictEqual(result.base?.forkPoint, oldTip);
				assert.strictEqual(result.base?.sha, revParse(clone.path, 'origin/main'));
				// Only the branch's own commit, the one `<forkPoint>..HEAD` lists, not the old tip the merge base counts too
				assert.strictEqual(result.base?.ahead, 1);
			} finally {
				cleanup();
			}
		});

		test('takes the merge base of a rewritten base that dropped the commit under the branch', async () => {
			// Moved off the commit to one that neither holds it nor is behind it, as a rebase moves it, but with no commit
			// of the same patch in its history: the commit is the branch's to show
			const { clone, oldTip, cleanup } = createRewrittenBase('replaced');
			try {
				storeTargets(clone.path, 'feature', { detected: 'origin/main' });

				const result = await getAheadOfBase(clone, 'feature');
				assert.notStrictEqual(result.base?.forkPoint, oldTip);
				assert.deepStrictEqual(result.base, {
					ref: 'origin/main',
					ahead: 2,
					sha: revParse(clone.path, 'origin/main'),
					forkPoint: mergeBase(clone.path, 'origin/main'),
					tier: 'detected',
				});
			} finally {
				cleanup();
			}
		});

		test('takes the merge base of a rebased base whose replayed commit is too far below its tip to compare', async () => {
			// The patches are compared only against the base's newest commits, so one replayed deeper reads as dropped,
			// which shows the commit rather than hides it
			const { clone, oldTip, cleanup } = createRewrittenBase('rebased', 300);
			try {
				storeTargets(clone.path, 'feature', { detected: 'origin/main' });
				const cherry = execFileSync('git', ['cherry', 'origin/main', oldTip], {
					cwd: clone.path,
					encoding: 'utf-8',
				});
				assert.strictEqual(cherry.trim(), `- ${oldTip}`, 'the base holds the same patch');

				const result = await getAheadOfBase(clone, 'feature');
				assert.strictEqual(result.base?.forkPoint, mergeBase(clone.path, 'origin/main'));
				assert.strictEqual(result.base?.ahead, 2);
			} finally {
				cleanup();
			}
		});

		test('takes the merge base of a rebased base whose patch comparison ran out of time, and does not run it again', async () => {
			const { clone, oldTip, cleanup } = createRewrittenBase('rebased');
			try {
				storeTargets(clone.path, 'feature', { detected: 'origin/main' });
				const git = clone.provider.git;
				const run = git.run.bind(git);
				let patchReads = 0;
				const stub = sinon.stub(git, 'run').callsFake(((options: unknown, ...args: unknown[]) => {
					if (!args.includes('--cherry-mark')) return run(options as never, ...(args as never[]));

					patchReads++;
					return Promise.resolve({
						stdout: '',
						completion: { status: 'cancelled', reason: 'timeout', error: new Error('timed out') },
					});
				}) as typeof git.run);
				try {
					for (let i = 0; i < 2; i++) {
						const result = await getAheadOfBase(clone, 'feature');
						assert.strictEqual(result.base?.forkPoint, mergeBase(clone.path, 'origin/main'));
						assert.strictEqual(result.base?.ahead, 2);
					}
				} finally {
					stub.restore();
				}
				assert.strictEqual(patchReads, 1);
				assert.notStrictEqual(mergeBase(clone.path, 'origin/main'), oldTip);
			} finally {
				cleanup();
			}
		});

		test('takes the merge base once the moved-back base also moves on', async () => {
			const { origin, clone, base, cleanup } = createForceMovedBase(({ base, commits }) => [commits[1], base]);
			try {
				addCommit(origin.path, 'moved-on.txt', 'moved on', 'moved on');
				fetch(clone.path);
				storeTargets(clone.path, 'feature', { detected: 'origin/main' });

				const result = await getAheadOfBase(clone, 'feature');
				assert.strictEqual(mergeBase(clone.path, 'origin/main'), base);
				assert.deepStrictEqual(result.base, {
					ref: 'origin/main',
					ahead: 4,
					sha: revParse(clone.path, 'origin/main'),
					forkPoint: base,
					tier: 'detected',
				});
			} finally {
				cleanup();
			}
		});

		test('takes the merge base once a base moved back to another commit of the branch also moves on', async () => {
			const { origin, clone, commits, cleanup } = createForceMovedBase(({ commits }) => [commits[2], commits[0]]);
			try {
				git(origin.path, 'reset', '-q', '--hard', 'HEAD~1');
				addCommit(origin.path, 'moved-on.txt', 'moved on', 'moved on');
				fetch(clone.path);
				storeTargets(clone.path, 'feature', { detected: 'origin/main' });

				const result = await getAheadOfBase(clone, 'feature');
				assert.strictEqual(result.base?.forkPoint, mergeBase(clone.path, 'origin/main'));
				assert.notStrictEqual(result.base?.forkPoint, commits[2]);
				assert.strictEqual(result.base?.ahead, 4);
			} finally {
				cleanup();
			}
		});

		test('takes the merge base when the base moved on from a commit of the branch before being moved back behind it', async () => {
			// Another commit landed on top before both were undone: the move off the branch's commit was a fast-forward,
			// and only the later move back shows the commit undone
			const { origin, clone, commits, base, cleanup } = createForceMovedBase(({ commits }) => [commits[1]]);
			try {
				addCommit(origin.path, 'landed-after.txt', 'landed after', 'landed after');
				fetch(clone.path);
				git(origin.path, 'reset', '-q', '--hard', base);
				fetch(clone.path);
				addCommit(origin.path, 'moved-on.txt', 'moved on', 'moved on');
				fetch(clone.path);
				storeTargets(clone.path, 'feature', { detected: 'origin/main' });

				const forkPoint = execFileSync('git', ['merge-base', '--fork-point', 'origin/main', 'HEAD'], {
					cwd: clone.path,
					encoding: 'utf-8',
				}).trim();
				assert.strictEqual(forkPoint, commits[1], "git's fork point is the undone commit");

				const result = await getAheadOfBase(clone, 'feature');
				assert.deepStrictEqual(result.base, {
					ref: 'origin/main',
					ahead: 4,
					sha: revParse(clone.path, 'origin/main'),
					forkPoint: base,
					tier: 'detected',
				});
			} finally {
				cleanup();
			}
		});

		test('takes the merge base when the move back and the next commit arrive in one fetch', async () => {
			// The reflog then has one entry off the dropped commits, to a commit that lacks them, which is what a rebased
			// base looks like too; the base holds no commit of the same patch as either, so they are the branch's
			const { origin, clone, commits, base, cleanup } = createForceMovedBase(({ commits }) => [commits[1]]);
			try {
				git(origin.path, 'reset', '-q', '--hard', base);
				addCommit(origin.path, 'moved-on.txt', 'moved on', 'moved on');
				fetch(clone.path);
				storeTargets(clone.path, 'feature', { detected: 'origin/main' });

				const forkPoint = execFileSync('git', ['merge-base', '--fork-point', 'origin/main', 'HEAD'], {
					cwd: clone.path,
					encoding: 'utf-8',
				}).trim();
				assert.strictEqual(forkPoint, commits[1], "git's fork point is the dropped commit");

				const result = await getAheadOfBase(clone, 'feature');
				assert.deepStrictEqual(result.base, {
					ref: 'origin/main',
					ahead: 4,
					sha: revParse(clone.path, 'origin/main'),
					forkPoint: base,
					tier: 'detected',
				});
			} finally {
				cleanup();
			}
		});

		test('takes the merge base when the base took many pushes past a commit of the branch before a reset dropped it', async () => {
			// Every push past the commit is a move whose message says nothing of its direction; however many there are,
			// the reset that dropped the commit is what decides
			const { origin, clone, cleanup } = createClone();
			try {
				const base = revParse(clone.path, 'origin/main');
				createBranchFromDetachedHead(clone.path, 'feature', 'origin/main');
				const commits: string[] = [];
				for (let i = 1; i <= 4; i++) {
					addCommit(clone.path, `c${i}.txt`, `c${i}`, `c${i}`);
					commits.push(getHeadSha(clone.path));
				}
				git(origin.path, 'config', 'receive.denyCurrentBranch', 'ignore');
				git(clone.path, 'push', '-q', 'origin', `${commits[1]}:refs/heads/main`);
				createBranchFromDetachedHead(clone.path, 'landed', commits[1]);
				for (let i = 1; i <= 9; i++) {
					addCommit(clone.path, `landed-${i}.txt`, `landed ${i}`, `landed ${i}`);
					git(clone.path, 'push', '-q', 'origin', 'landed:main');
				}
				checkout(clone.path, 'feature');
				git(origin.path, 'reset', '-q', '--hard', base);
				addCommit(origin.path, 'moved-on.txt', 'moved on', 'moved on');
				fetch(clone.path);
				storeTargets(clone.path, 'feature', { detected: 'origin/main' });
				assert.strictEqual(
					gitForkPoint(clone.path, 'origin/main'),
					commits[1],
					"git's fork point is the dropped commit",
				);

				const result = await getAheadOfBase(clone, 'feature');
				assert.deepStrictEqual(result.base, {
					ref: 'origin/main',
					ahead: 4,
					sha: revParse(clone.path, 'origin/main'),
					forkPoint: base,
					tier: 'detected',
				});
			} finally {
				cleanup();
			}
		});

		test('takes the merge base when the reflog has lost the line that moved off a commit of the branch', async () => {
			const { origin, clone, commits, base, cleanup } = createForceMovedBase(({ base, commits }) => [
				commits[1],
				base,
			]);
			try {
				addCommit(origin.path, 'moved-on.txt', 'moved on', 'moved on');
				fetch(clone.path);
				// The move back off the commit; the move on still names the commit it moved from, so the reflog has a gap
				git(clone.path, 'reflog', 'delete', 'refs/remotes/origin/main@{1}');
				storeTargets(clone.path, 'feature', { detected: 'origin/main' });
				assert.strictEqual(
					gitForkPoint(clone.path, 'origin/main'),
					commits[1],
					"git's fork point is the dropped commit",
				);

				const result = await getAheadOfBase(clone, 'feature');
				assert.strictEqual(result.base?.forkPoint, base);
				assert.strictEqual(result.base?.ahead, 4);
			} finally {
				cleanup();
			}
		});

		test("takes the merge base of a rewritten base named by its remote's HEAD, whose own reflog says nothing of the move", async () => {
			const { clone, oldTip, cleanup } = createRewrittenBase('replaced');
			try {
				storeTargets(clone.path, 'feature', { detected: 'origin/HEAD' });
				assert.strictEqual(
					gitForkPoint(clone.path, 'origin/HEAD'),
					oldTip,
					"git's fork point is the dropped commit",
				);

				const result = await getAheadOfBase(clone, 'feature');
				assert.strictEqual(result.base?.forkPoint, mergeBase(clone.path, 'origin/main'));
				assert.strictEqual(result.base?.ahead, 2);
			} finally {
				cleanup();
			}
		});

		test('trusts only the reflog messages git writes for a move forward, and checks the commits for the rest', async () => {
			const cases: { message: string; forward: boolean }[] = [
				{ message: 'fetch -q origin: fast-forward', forward: true },
				{ message: 'pull -q --rebase: Fast-forward', forward: true },
				{ message: "merge other: Merge made by the 'ort' strategy.", forward: true },
				{ message: 'commit: a subject', forward: true },
				{ message: 'commit (merge): a subject', forward: true },
				{ message: 'update by push', forward: false },
				{ message: 'fetch origin: forced-update', forward: false },
				{ message: 'rebase (finish): refs/heads/main onto 1234567', forward: false },
				{ message: 'reset: moving to HEAD~1', forward: false },
				{ message: 'commit (amend): a subject', forward: false },
				// A commit's subject is free text, so it can't vouch for the move
				{ message: 'commit (amend): chore: fast-forward', forward: false },
				{ message: "reset: moving to merge: Merge made by the 'ort' strategy.", forward: false },
			];
			for (const { message, forward } of cases) {
				const { clone, cleanup } = createClone();
				try {
					const base = revParse(clone.path, 'origin/main');
					createBranchFromDetachedHead(clone.path, 'other', 'origin/main');
					addCommit(clone.path, 'other.txt', 'other', 'other');
					const moved = getHeadSha(clone.path);
					createBranchFromDetachedHead(clone.path, 'feature', 'origin/main');
					addCommit(clone.path, 'branch-only.txt', 'feature', 'branch only');
					git(clone.path, 'update-ref', '-m', message, 'refs/remotes/origin/main', moved);
					storeTargets(clone.path, 'feature', { detected: 'origin/main' });

					const spy = sinon.spy(clone.provider.git, 'run');
					try {
						const result = await getAheadOfBase(clone, 'feature');
						assert.strictEqual(result.base?.forkPoint, base, message);
						assert.strictEqual(result.base?.ahead, 1, message);
					} finally {
						spy.restore();
					}

					const checks = spy
						.getCalls()
						.map(c => c.args.slice(1).filter(a => typeof a === 'string'))
						.filter(args => args[0] === 'merge-base' && args[1] === base);
					assert.deepStrictEqual(checks, forward ? [] : [['merge-base', base, moved]], message);
				} finally {
					cleanup();
				}
			}
		});

		test('takes the merge base when the ref list has no tip to check the fork point against', async () => {
			const { origin, clone, base, cleanup } = createForceMovedBase(({ base, commits }) => [commits[1], base]);
			try {
				addCommit(origin.path, 'moved-on.txt', 'moved on', 'moved on');
				fetch(clone.path);
				storeTargets(clone.path, 'feature', { detected: 'origin/main' });

				// `getRefs` answers a failed enumeration with an empty list
				const refs = sinon.stub(clone.provider.refs, 'getRefs').resolves([]);
				try {
					const result = await getAheadOfBase(clone, 'feature');
					assert.strictEqual(result.base?.forkPoint, base);
					assert.strictEqual(result.base?.ahead, 4);
				} finally {
					refs.restore();
				}
			} finally {
				cleanup();
			}
		});

		test('takes the merge base of a rewritten base whose reflog file cannot be read', async () => {
			const { clone, oldTip, cleanup } = createRewrittenBase('replaced');
			try {
				storeTargets(clone.path, 'feature', { detected: 'origin/main' });
				assert.strictEqual(
					gitForkPoint(clone.path, 'origin/main'),
					oldTip,
					"git's fork point is the dropped commit",
				);

				const fs = clone.provider.context.fs;
				const readFile = sinon.stub(fs, 'readFile').callsFake(async uri => {
					if (toFsPath(uri).includes(join('logs', 'refs'))) throw new Error('unreadable');
					return readFile.wrappedMethod.call(fs, uri);
				});
				try {
					const result = await getAheadOfBase(clone, 'feature');
					assert.strictEqual(result.base?.forkPoint, mergeBase(clone.path, 'origin/main'));
					assert.strictEqual(result.base?.ahead, 2);
					assert.ok(readFile.called, 'the reflog file was asked for');
				} finally {
					readFile.restore();
				}
			} finally {
				cleanup();
			}
		});

		test('keeps the fork point of a base moved back off it and forward onto it again, then on', async () => {
			const { origin, clone, commits, cleanup } = createForceMovedBase(({ base, commits }) => [
				commits[1],
				base,
				commits[1],
			]);
			try {
				addCommit(origin.path, 'moved-on.txt', 'moved on', 'moved on');
				fetch(clone.path);
				storeTargets(clone.path, 'feature', { detected: 'origin/main' });

				const spy = sinon.spy(clone.provider.git, 'run');
				let result: AheadOfBase;
				try {
					result = await getAheadOfBase(clone, 'feature');
				} finally {
					spy.restore();
				}
				assert.strictEqual(result.base?.forkPoint, commits[1]);
				assert.strictEqual(result.base?.ahead, 2);
				// The reflog shows the base moved only forward since it last left the commit
				const mergeBases = spy
					.getCalls()
					.map(c => c.args.slice(1).filter(a => typeof a === 'string'))
					.filter(args => args[0] === 'merge-base');
				assert.deepStrictEqual(mergeBases, [['merge-base', '--fork-point', 'origin/main', 'HEAD']]);
			} finally {
				cleanup();
			}
		});

		test('takes the merge base of a base moved back off its fork point and forward onto it again, then rewritten', async () => {
			const { origin, clone, commits, base, cleanup } = createForceMovedBase(({ base, commits }) => [
				commits[1],
				base,
				commits[1],
			]);
			try {
				git(origin.path, 'reset', '-q', '--hard', base);
				addCommit(origin.path, 'moved-on.txt', 'moved on', 'moved on');
				fetch(clone.path);
				storeTargets(clone.path, 'feature', { detected: 'origin/main' });
				assert.strictEqual(
					gitForkPoint(clone.path, 'origin/main'),
					commits[1],
					"git's fork point is the dropped commit",
				);

				const result = await getAheadOfBase(clone, 'feature');
				assert.strictEqual(result.base?.forkPoint, base);
				assert.strictEqual(result.base?.ahead, 4);
			} finally {
				cleanup();
			}
		});

		test('runs a patch comparison that ran out of time again once a while has passed', async () => {
			const { clone, oldTip, cleanup } = createRewrittenBase('rebased');
			try {
				storeTargets(clone.path, 'feature', { detected: 'origin/main' });
				const git = clone.provider.git;
				const run = git.run.bind(git);
				let patchReads = 0;
				let timeOut = true;
				const stub = sinon.stub(git, 'run').callsFake(((options: unknown, ...args: unknown[]) => {
					if (!args.includes('--cherry-mark')) return run(options as never, ...(args as never[]));

					patchReads++;
					if (!timeOut) return run(options as never, ...(args as never[]));
					return Promise.resolve({
						stdout: '',
						completion: {
							status: 'cancelled',
							reason: 'timeout',
							error: new Error('timed out'),
						},
					});
				}) as typeof git.run);
				let now = Date.now();
				const clock = sinon.stub(patchCheckClock, 'now').callsFake(() => now);
				try {
					assert.strictEqual(
						(await getAheadOfBase(clone, 'feature')).base?.forkPoint,
						mergeBase(clone.path, 'origin/main'),
					);
					timeOut = false;
					now += 9 * 60 * 1000;
					assert.strictEqual(
						(await getAheadOfBase(clone, 'feature')).base?.forkPoint,
						mergeBase(clone.path, 'origin/main'),
					);
					assert.strictEqual(patchReads, 1, 'not run again while it would likely run out of time again');

					now += 2 * 60 * 1000;
					const result = await getAheadOfBase(clone, 'feature');
					assert.strictEqual(patchReads, 2, 'run again');
					assert.strictEqual(result.base?.forkPoint, oldTip);
					assert.strictEqual(result.base?.ahead, 1);
				} finally {
					clock.restore();
					stub.restore();
				}
			} finally {
				cleanup();
			}
		});

		test('takes the merge base, counted from it, when the count past a rewritten fork point fails', async () => {
			const { clone, oldTip, cleanup } = createRewrittenBase('rebased');
			try {
				storeTargets(clone.path, 'feature', { detected: 'origin/main' });
				const stub = failRuns(clone, args => args.includes(`${oldTip}...HEAD`));
				try {
					const result = await getAheadOfBase(clone, 'feature');
					assert.strictEqual(result.base?.forkPoint, mergeBase(clone.path, 'origin/main'));
					assert.strictEqual(result.base?.ahead, 2);
				} finally {
					stub.restore();
				}
			} finally {
				cleanup();
			}
		});

		test('keeps the rewritten fork point, with the count from the merge base, when neither the count past it nor the merge base can be read', async () => {
			const { clone, oldTip, cleanup } = createRewrittenBase('rebased');
			try {
				storeTargets(clone.path, 'feature', { detected: 'origin/main' });
				const stub = failRuns(
					clone,
					args =>
						args.includes(`${oldTip}...HEAD`) ||
						(args[0] === 'merge-base' &&
							args.includes('HEAD') &&
							args.includes('origin/main') &&
							!args.includes('--fork-point')),
				);
				try {
					const result = await getAheadOfBase(clone, 'feature');
					assert.strictEqual(result.base?.forkPoint, oldTip);
					assert.strictEqual(result.base?.ahead, 2);
				} finally {
					stub.restore();
				}
			} finally {
				cleanup();
			}
		});

		test('takes the merge base, counted from it, when the ancestry check of a fork point the base left fails', async () => {
			const { clone, oldTip, cleanup } = createRewrittenBase('rebased');
			try {
				storeTargets(clone.path, 'feature', { detected: 'origin/main' });
				const tip = revParse(clone.path, 'origin/main');
				const stub = failRuns(
					clone,
					args => args[0] === 'merge-base' && args.includes(oldTip) && args.includes(tip),
				);
				try {
					const result = await getAheadOfBase(clone, 'feature');
					assert.strictEqual(result.base?.forkPoint, mergeBase(clone.path, 'origin/main'));
					assert.strictEqual(result.base?.ahead, 2);
				} finally {
					stub.restore();
				}
			} finally {
				cleanup();
			}
		});

		test("known limit: counts an empty commit the base dropped below the fork point as the base's while the base has an unrelated empty commit", async () => {
			// Git's patch comparison takes any two empty commits as the same patch, so the base's own empty commit stands
			// in for the dropped one, which is left out of the branch's commits
			const repo = createTestRepo();
			try {
				addCommit(repo.path, 'a.txt', 'a', 'a');
				const base = getHeadSha(repo.path);
				git(repo.path, 'commit', '-q', '--allow-empty', '-m', 'dropped empty');
				addCommit(repo.path, 'parent.txt', 'parent', 'parent');
				const parentTip = getHeadSha(repo.path);
				createBranch(repo.path, 'feature', { checkout: true });
				addCommit(repo.path, 'own.txt', 'own', 'own');
				checkout(repo.path, 'main');
				git(repo.path, 'reset', '-q', '--hard', base);
				addCommit(repo.path, 'other.txt', 'other', 'other');
				git(repo.path, 'cherry-pick', parentTip);
				git(repo.path, 'commit', '-q', '--allow-empty', '-m', 'unrelated empty');
				checkout(repo.path, 'feature');
				storeTargets(repo.path, 'feature', { detected: 'main' });
				assert.strictEqual(gitForkPoint(repo.path, 'main'), parentTip);

				const result = await getAheadOfBase(repo, 'feature');
				// Shown in full, the dropped empty commit would count too: 2 past the merge base's `a`
				assert.strictEqual(result.base?.forkPoint, parentTip);
				assert.strictEqual(result.base?.ahead, 1);
			} finally {
				repo.cleanup();
			}
		});

		test('counts the default branch past the fork point its rebased upstream keeps', async () => {
			const { origin, clone, cleanup } = createClone();
			try {
				addCommit(origin.path, 'old-tip.txt', 'old', 'old tip');
				git(clone.path, 'pull', '-q', '--ff-only');
				const oldTip = revParse(clone.path, 'origin/main');
				addCommit(clone.path, 'local.txt', 'local', 'unpushed');

				git(origin.path, 'reset', '-q', '--hard', 'HEAD~1');
				addCommit(origin.path, 'new-tip.txt', 'new', 'rewritten tip');
				git(origin.path, 'cherry-pick', oldTip);
				fetch(clone.path);

				const result = await getAheadOfBase(clone, 'main');
				assert.strictEqual(result.base?.tier, 'upstream');
				assert.strictEqual(result.base?.forkPoint, oldTip);
				assert.strictEqual(result.base?.ahead, 1);
			} finally {
				cleanup();
			}
		});

		test('still defers to the moved-back upstream from a local base holding the dropped commit', async () => {
			// The local base forks no further than git's reading of the upstream, its dropped commit, so it doesn't take
			// over as soon as its upstream moves back, though the upstream's own fork point settles below it
			const { clone, commits, base, cleanup } = createForceMovedBase(({ base, commits }) => [commits[1], base]);
			try {
				git(clone.path, 'branch', '-f', 'main', commits[1]);

				const result = await getAheadOfBase(clone, 'feature');
				assert.deepStrictEqual(result.base, {
					ref: 'origin/main',
					ahead: 4,
					sha: base,
					forkPoint: base,
					tier: 'default',
				});
			} finally {
				cleanup();
			}
		});

		test('still defers to the moved-back upstream from a local base that pulled the dropped commit', async () => {
			// The same through a pull: the local base's reflog moved forward onto the commit, with the upstream
			const { origin, clone, commits, base, cleanup } = createForceMovedBase(({ commits }) => [commits[1]]);
			try {
				git(clone.path, 'checkout', '-q', 'main');
				git(clone.path, 'pull', '-q', '--ff-only');
				git(clone.path, 'checkout', '-q', 'feature');
				git(origin.path, 'reset', '-q', '--hard', base);
				fetch(clone.path);
				assert.strictEqual(revParse(clone.path, 'main'), commits[1]);

				const result = await getAheadOfBase(clone, 'feature');
				assert.deepStrictEqual(result.base, {
					ref: 'origin/main',
					ahead: 4,
					sha: base,
					forkPoint: base,
					tier: 'default',
				});
			} finally {
				cleanup();
			}
		});

		test('prefers a local base carrying unpushed work over its upstream moved back off a commit both held', async () => {
			const { origin, clone, commits, base, cleanup } = createForceMovedBase(({ commits }) => [commits[1]]);
			try {
				git(clone.path, 'checkout', '-q', 'main');
				git(clone.path, 'pull', '-q', '--ff-only');
				git(origin.path, 'reset', '-q', '--hard', base);
				fetch(clone.path);
				addCommit(clone.path, 'unpushed.txt', 'unpushed', 'unpushed on main');
				const unpushed = getHeadSha(clone.path);
				createBranchFromDetachedHead(clone.path, 'work', 'main');
				addCommit(clone.path, 'work.txt', 'work', 'work');
				assert.strictEqual(gitForkPoint(clone.path, 'origin/main'), commits[1]);

				const result = await getAheadOfBase(clone, 'work');
				assert.deepStrictEqual(result.base, {
					ref: 'main',
					ahead: 1,
					sha: unpushed,
					forkPoint: unpushed,
					tier: 'default',
				});
			} finally {
				cleanup();
			}
		});

		test('counts the commit dropped from a parent moved back as the stacked branch its own', async () => {
			const repo = createTestRepo();
			try {
				const base = getHeadSha(repo.path);
				createBranch(repo.path, 'parent', { checkout: true });
				addCommit(repo.path, 'parent.txt', 'parent', 'parent');
				const dropped = getHeadSha(repo.path);
				git(repo.path, 'branch', 'child', 'parent');
				checkout(repo.path, 'child');
				addCommit(repo.path, 'child.txt', 'child', 'child');
				git(repo.path, 'branch', '-f', 'parent', base);

				const result = await getAheadOfBase(repo, 'child');
				assert.strictEqual(result.base?.ref, 'parent');
				assert.strictEqual(result.base?.tier, 'created');
				assert.strictEqual(result.base?.forkPoint, base);
				assert.notStrictEqual(result.base?.forkPoint, dropped);
				assert.strictEqual(result.base?.ahead, 2);
			} finally {
				repo.cleanup();
			}
		});

		test('counts a stacked branch past its fork point from a parent rebased since', async () => {
			const repo = createTestRepo();
			try {
				createBranch(repo.path, 'parent', { checkout: true });
				const parentCommits: string[] = [];
				for (let i = 1; i <= 3; i++) {
					addCommit(repo.path, `parent-${i}.txt`, `parent ${i}`, `parent ${i}`);
					parentCommits.push(getHeadSha(repo.path));
				}
				git(repo.path, 'branch', 'child', 'parent');
				checkout(repo.path, 'main');
				addCommit(repo.path, 'main.txt', 'main', 'main moved on');
				// Rebased alone, as without `rebase.updateRefs`, which would carry the child along
				git(repo.path, '-c', 'rebase.updateRefs=false', 'rebase', '-q', 'main', 'parent');
				checkout(repo.path, 'child');
				addCommit(repo.path, 'child.txt', 'child', 'child');

				const result = await getAheadOfBase(repo, 'child');
				assert.strictEqual(result.base?.ref, 'parent');
				assert.strictEqual(result.base?.forkPoint, parentCommits[2]);
				// Only the child's commit, as `<forkPoint>..HEAD` lists, not the parent's three the merge base counts too
				assert.strictEqual(result.base?.ahead, 1);
			} finally {
				repo.cleanup();
			}
		});

		test('reports a stacked branch with nothing past its fork point from a rebased parent as 0 ahead of it', async () => {
			const repo = createTestRepo();
			try {
				createBranch(repo.path, 'parent', { checkout: true });
				addCommit(repo.path, 'parent.txt', 'parent', 'parent');
				const parentTip = getHeadSha(repo.path);
				git(repo.path, 'branch', 'child', 'parent');
				checkout(repo.path, 'main');
				addCommit(repo.path, 'main.txt', 'main', 'main moved on');
				// Rebased alone, as without `rebase.updateRefs`, which would carry the child along
				git(repo.path, '-c', 'rebase.updateRefs=false', 'rebase', '-q', 'main', 'parent');
				checkout(repo.path, 'child');

				const result = await getAheadOfBase(repo, 'child');
				assert.deepStrictEqual(result.base, {
					ref: 'parent',
					ahead: 0,
					sha: revParse(repo.path, 'parent'),
					forkPoint: parentTip,
					tier: 'created',
				});
			} finally {
				repo.cleanup();
			}
		});

		test("counts a parent's commit amended in place as the stacked branch's fork point, not its own", async () => {
			const repo = createTestRepo();
			try {
				createBranch(repo.path, 'parent', { checkout: true });
				addCommit(repo.path, 'parent.txt', 'parent', 'parent');
				const amended = getHeadSha(repo.path);
				git(repo.path, 'branch', 'child', 'parent');
				git(repo.path, 'commit', '-q', '--amend', '-m', 'parent amended');
				checkout(repo.path, 'child');
				addCommit(repo.path, 'child.txt', 'child', 'child');

				const result = await getAheadOfBase(repo, 'child');
				assert.strictEqual(result.base?.ref, 'parent');
				assert.strictEqual(result.base?.forkPoint, amended);
				assert.strictEqual(result.base?.ahead, 1);
			} finally {
				repo.cleanup();
			}
		});

		test("counts a parent's commit amended with new changes as the stacked branch's own", async () => {
			// Accepted: the old commit shows in the child until it is rebased, which is visible rather than hiding work
			const repo = createTestRepo();
			try {
				const base = getHeadSha(repo.path);
				createBranch(repo.path, 'parent', { checkout: true });
				addCommit(repo.path, 'parent.txt', 'parent', 'parent');
				const amended = getHeadSha(repo.path);
				git(repo.path, 'branch', 'child', 'parent');
				writeFileSync(join(repo.path, 'parent.txt'), 'parent changed');
				git(repo.path, 'commit', '-q', '-a', '--amend', '-m', 'parent');
				checkout(repo.path, 'child');
				addCommit(repo.path, 'child.txt', 'child', 'child');

				const result = await getAheadOfBase(repo, 'child');
				assert.strictEqual(result.base?.ref, 'parent');
				assert.strictEqual(result.base?.forkPoint, base);
				assert.notStrictEqual(result.base?.forkPoint, amended);
				assert.strictEqual(result.base?.ahead, 2);
			} finally {
				repo.cleanup();
			}
		});

		test("counts a parent's commit amended while rebasing, and the ones after it, as the stacked branch's own", async () => {
			// Rebased onto a base that moved on, with its middle commit changed: the commit under it has a replayed copy and
			// stays the parent's, the changed one and the one after it, which replays it, are the child's
			const repo = createTestRepo();
			try {
				createBranch(repo.path, 'parent', { checkout: true });
				const parentCommits: string[] = [];
				for (let i = 1; i <= 3; i++) {
					addCommit(repo.path, `parent-${i}.txt`, `parent ${i}`, `parent ${i}`);
					parentCommits.push(getHeadSha(repo.path));
				}
				git(repo.path, 'branch', 'child', 'parent');
				checkout(repo.path, 'main');
				addCommit(repo.path, 'main.txt', 'main', 'main moved on');
				git(repo.path, 'checkout', '-q', '--detach', 'main');
				git(repo.path, 'cherry-pick', parentCommits[0]);
				addCommit(repo.path, 'parent-2.txt', 'parent 2 changed', 'parent 2');
				git(repo.path, 'cherry-pick', parentCommits[2]);
				// One move off the old tip, as a rebase makes
				git(repo.path, 'branch', '-f', 'parent', 'HEAD');
				checkout(repo.path, 'child');
				addCommit(repo.path, 'child.txt', 'child', 'child');

				const result = await getAheadOfBase(repo, 'child');
				assert.strictEqual(result.base?.ref, 'parent');
				assert.strictEqual(result.base?.forkPoint, parentCommits[0]);
				assert.strictEqual(result.base?.ahead, 3);
			} finally {
				repo.cleanup();
			}
		});

		test("counts a rebased parent's merge, and what it merged, as the stacked branch's own", async () => {
			// A rebase replays the merged commits in a line and drops the merge, which has no patch to compare
			const repo = createTestRepo();
			try {
				const base = getHeadSha(repo.path);
				createBranch(repo.path, 'side', { checkout: true });
				addCommit(repo.path, 'side.txt', 'side', 'side');
				checkout(repo.path, 'main');
				createBranch(repo.path, 'parent', { checkout: true });
				addCommit(repo.path, 'parent.txt', 'parent', 'parent');
				git(repo.path, 'merge', '-q', '--no-ff', '-m', 'Merge side', 'side');
				git(repo.path, 'branch', 'child', 'parent');
				checkout(repo.path, 'main');
				addCommit(repo.path, 'main.txt', 'main', 'main moved on');
				git(repo.path, '-c', 'rebase.updateRefs=false', 'rebase', '-q', 'main', 'parent');
				checkout(repo.path, 'child');
				addCommit(repo.path, 'child.txt', 'child', 'child');

				const result = await getAheadOfBase(repo, 'child');
				assert.strictEqual(result.base?.ref, 'parent');
				assert.strictEqual(result.base?.forkPoint, base);
				assert.strictEqual(result.base?.ahead, 4);
			} finally {
				repo.cleanup();
			}
		});

		test('takes the base holding the same patches again as the fork point: a pull request undone and re-landed by cherry-pick', async () => {
			const { origin, clone, commits, base, cleanup } = createForceMovedBase(({ base, commits }) => [
				commits[1],
				base,
			]);
			try {
				git(origin.path, 'cherry-pick', commits[0], commits[1]);
				fetch(clone.path);
				storeTargets(clone.path, 'feature', { detected: 'origin/main' });

				const result = await getAheadOfBase(clone, 'feature');
				assert.strictEqual(mergeBase(clone.path, 'origin/main'), base);
				assert.strictEqual(result.base?.forkPoint, commits[1]);
				assert.strictEqual(result.base?.ahead, 2);
			} finally {
				cleanup();
			}
		});

		test('counts past the part of an undone pull request the base re-landed, and no further', async () => {
			const { origin, clone, commits, cleanup } = createForceMovedBase(({ base, commits }) => [commits[1], base]);
			try {
				git(origin.path, 'cherry-pick', commits[0]);
				fetch(clone.path);
				storeTargets(clone.path, 'feature', { detected: 'origin/main' });

				const result = await getAheadOfBase(clone, 'feature');
				assert.strictEqual(result.base?.forkPoint, commits[0]);
				assert.strictEqual(result.base?.ahead, 3);
			} finally {
				cleanup();
			}
		});

		test("keeps the fork point of a parent's commit reset away and committed again with the same patch", async () => {
			const repo = createTestRepo();
			try {
				const base = getHeadSha(repo.path);
				createBranch(repo.path, 'parent', { checkout: true });
				addCommit(repo.path, 'parent.txt', 'parent', 'parent');
				const replaced = getHeadSha(repo.path);
				git(repo.path, 'branch', 'child', 'parent');
				git(repo.path, 'reset', '-q', '--soft', 'HEAD~1');
				git(repo.path, 'commit', '-q', '-m', 'parent again');
				checkout(repo.path, 'child');
				addCommit(repo.path, 'child.txt', 'child', 'child');

				const result = await getAheadOfBase(repo, 'child');
				assert.strictEqual(result.base?.ref, 'parent');
				assert.notStrictEqual(result.base?.forkPoint, base);
				assert.strictEqual(result.base?.forkPoint, replaced);
				assert.strictEqual(result.base?.ahead, 1);
			} finally {
				repo.cleanup();
			}
		});

		test('reads the base reflog from its file: a base moved only forward adds no process', async () => {
			const forkPointRead = ['merge-base', '--fork-point', 'origin/main', 'HEAD'];
			const cases: {
				name: string;
				/**
				 * The fixture, with the merge bases a read asks for, how many counts it takes and how many patch
				 * comparisons. The branch read is `feature`, with `origin/main` its detected target, unless `branch` and
				 * `detected` (`null` for none) say otherwise.
				 */
				create: () => {
					clone: TestRepo;
					cleanup: () => void;
					mergeBases: string[][];
					counts: number;
					patches?: number;
					branch?: string;
					detected?: string | null;
				};
			}[] = [
				{
					name: 'moved only forward',
					create: () => {
						const { origin, clone, cleanup } = createClone();
						try {
							createBranchFromDetachedHead(clone.path, 'feature', 'origin/main');
							addCommit(clone.path, 'branch-only.txt', 'feature', 'branch only');
							addCommit(origin.path, 'moved-on.txt', 'moved on', 'moved on');
							fetch(clone.path);
						} catch (ex) {
							cleanup();
							throw ex;
						}
						return { clone: clone, cleanup: cleanup, mergeBases: [forkPointRead], counts: 1 };
					},
				},
				{
					name: 'moved forward by a push, whose reflog message says nothing of the direction',
					create: () => {
						const { origin, clone, cleanup } = createClone();
						try {
							const base = revParse(clone.path, 'origin/main');
							createBranchFromDetachedHead(clone.path, 'other', 'origin/main');
							addCommit(clone.path, 'other.txt', 'other', 'other');
							const pushed = getHeadSha(clone.path);
							createBranchFromDetachedHead(clone.path, 'feature', 'origin/main');
							addCommit(clone.path, 'branch-only.txt', 'feature', 'branch only');
							git(origin.path, 'config', 'receive.denyCurrentBranch', 'ignore');
							git(clone.path, 'push', '-q', 'origin', 'other:main');
							// One ancestry check shows the move forward, so nothing is recounted
							return {
								clone: clone,
								cleanup: cleanup,
								mergeBases: [forkPointRead, ['merge-base', base, pushed]],
								counts: 1,
							};
						} catch (ex) {
							cleanup();
							throw ex;
						}
					},
				},
				{
					name: 'a local base and its tracking ref, moved only forward',
					create: () => {
						const { origin, clone, cleanup } = createClone();
						try {
							createBranchFromDetachedHead(clone.path, 'feature', 'origin/main');
							addCommit(clone.path, 'branch-only.txt', 'feature', 'branch only');
							addCommit(origin.path, 'moved-on.txt', 'moved on', 'moved on');
							fetch(clone.path);
						} catch (ex) {
							cleanup();
							throw ex;
						}
						// The two tie, so nothing is compared
						return {
							clone: clone,
							cleanup: cleanup,
							mergeBases: [['merge-base', '--fork-point', 'main', 'HEAD'], forkPointRead],
							counts: 1,
							detected: 'main',
						};
					},
				},
				{
					name: 'a parent it was created from, against the default and its tracking ref, all moved only forward',
					create: () => {
						const { origin, clone, cleanup } = createClone();
						let parentTip: string;
						try {
							git(clone.path, 'checkout', '-q', '-b', 'parent', 'main');
							addCommit(clone.path, 'parent.txt', 'parent', 'parent');
							parentTip = getHeadSha(clone.path);
							git(clone.path, 'checkout', '-q', '-b', 'feature', 'parent');
							addCommit(clone.path, 'branch-only.txt', 'feature', 'branch only');
							addCommit(origin.path, 'moved-on.txt', 'moved on', 'moved on');
							fetch(clone.path);
						} catch (ex) {
							cleanup();
							throw ex;
						}
						// One ancestry check between the parent and the default's pick
						return {
							clone: clone,
							cleanup: cleanup,
							mergeBases: [
								['merge-base', '--fork-point', 'parent', 'HEAD'],
								['merge-base', '--fork-point', 'main', 'HEAD'],
								forkPointRead,
								['merge-base', '--is-ancestor', parentTip, revParse(clone.path, 'main')],
							],
							counts: 1,
							detected: null,
						};
					},
				},
				{
					name: 'a parent it was created from, against a default moved back off a commit of the branch',
					create: () => {
						const { clone, cleanup } = createClone();
						let stack: ReturnType<typeof createStackOverRewoundMain>;
						try {
							stack = createStackOverRewoundMain(clone.path);
						} catch (ex) {
							cleanup();
							throw ex;
						}
						// Git's reading of the local default is past its tracking ref's, so it is settled: one ancestry check
						// finds the tip in its history, so the tip, which ties with the tracking ref
						return {
							clone: clone,
							cleanup: cleanup,
							mergeBases: [
								['merge-base', '--fork-point', 'parent', 'HEAD'],
								['merge-base', '--fork-point', 'main', 'HEAD'],
								forkPointRead,
								['merge-base', '--is-ancestor', stack.childCommits[0], stack.base],
								['merge-base', stack.childCommits[0], stack.base],
								['merge-base', '--is-ancestor', stack.parentTip, stack.base],
							],
							counts: 1,
							branch: 'child',
							detected: null,
						};
					},
				},
				{
					name: 'moved back off a commit of the branch, then on',
					create: () => {
						const { origin, clone, commits, cleanup } = createForceMovedBase(({ base, commits }) => [
							commits[1],
							base,
						]);
						try {
							addCommit(origin.path, 'moved-on.txt', 'moved on', 'moved on');
							fetch(clone.path);
						} catch (ex) {
							cleanup();
							throw ex;
						}
						// One ancestry check of the fork point against the tip, the patch comparison, then the merge base
						return {
							clone: clone,
							cleanup: cleanup,
							mergeBases: [
								forkPointRead,
								['merge-base', commits[1], revParse(clone.path, 'origin/main')],
								['merge-base', 'HEAD', 'origin/main'],
							],
							counts: 1,
							patches: 1,
						};
					},
				},
				{
					name: 'rebased',
					create: () => {
						const { clone, oldTip, cleanup } = createRewrittenBase('rebased');
						// One ancestry check of the fork point against the tip, the patch comparison, then the count past it
						return {
							clone: clone,
							cleanup: cleanup,
							mergeBases: [forkPointRead, ['merge-base', oldTip, revParse(clone.path, 'origin/main')]],
							counts: 2,
							patches: 1,
						};
					},
				},
				{
					name: 'rewritten, dropping the commit under the branch',
					create: () => {
						const { clone, oldTip, cleanup } = createRewrittenBase('replaced');
						// One ancestry check of the fork point against the tip, the patch comparison, then the merge base,
						// past which the count already read counts
						return {
							clone: clone,
							cleanup: cleanup,
							mergeBases: [
								forkPointRead,
								['merge-base', oldTip, revParse(clone.path, 'origin/main')],
								['merge-base', 'HEAD', 'origin/main'],
							],
							counts: 1,
							patches: 1,
						};
					},
				},
				{
					name: 'moved back and on in one fetch',
					create: () => {
						const { origin, clone, commits, base, cleanup } = createForceMovedBase(({ commits }) => [
							commits[1],
						]);
						try {
							git(origin.path, 'reset', '-q', '--hard', base);
							addCommit(origin.path, 'moved-on.txt', 'moved on', 'moved on');
							fetch(clone.path);
						} catch (ex) {
							cleanup();
							throw ex;
						}
						return {
							clone: clone,
							cleanup: cleanup,
							mergeBases: [
								forkPointRead,
								['merge-base', commits[1], revParse(clone.path, 'origin/main')],
								['merge-base', 'HEAD', 'origin/main'],
							],
							counts: 1,
							patches: 1,
						};
					},
				},
			];

			for (const c of cases) {
				const {
					clone,
					cleanup,
					mergeBases,
					counts,
					patches = 0,
					branch = 'feature',
					detected = 'origin/main',
				} = c.create();
				try {
					if (detected != null) {
						storeTargets(clone.path, branch, { detected: detected });
					}

					const spy = sinon.spy(clone.provider.git, 'run');
					try {
						await getAheadOfBase(clone, branch);
					} finally {
						spy.restore();
					}

					const calls = spy.getCalls().map(c => c.args.slice(1).filter(a => typeof a === 'string'));
					assert.deepStrictEqual(
						calls.filter(args => args[0] === 'merge-base'),
						mergeBases,
						c.name,
					);
					const revLists = calls.filter(args => args[0] === 'rev-list');
					const patchReads = revLists.filter(args => args.includes('--cherry-mark'));
					assert.strictEqual(revLists.length - patchReads.length, counts, c.name);
					assert.strictEqual(patchReads.length, patches, c.name);
					// Only the branch's own, for the branch it was created from, when no target is stored
					assert.deepStrictEqual(
						calls.filter(args => args[0] === 'reflog').map(args => args.at(-2)),
						detected != null ? [] : [`refs/heads/${branch}`],
						c.name,
					);
				} finally {
					cleanup();
				}
			}
		});
	});

	suite('candidates compared where the branch forked from each', () => {
		test("measures a stacked branch against its parent, not a default moved back off the branch's commit", async () => {
			const repo = createTestRepo();
			try {
				const { parentTip, childCommits } = createStackOverRewoundMain(repo.path);
				assert.strictEqual(
					gitForkPoint(repo.path, 'main'),
					childCommits[0],
					"git's fork point is the undone commit",
				);

				const result = await getAheadOfBase(repo, 'child');
				assert.deepStrictEqual(result.base, {
					ref: 'parent',
					ahead: 2,
					sha: parentTip,
					forkPoint: parentTip,
					tier: 'created',
				});
			} finally {
				repo.cleanup();
			}
		});

		test("measures against a default moved back off the branch's commit once the branch it was created from merged into it", async () => {
			const repo = createTestRepo();
			try {
				const { mainTip, own } = createRebasedOntoMergedParent(repo.path);
				moveOntoAndBack(repo.path, 'main', own, 'feat');
				assert.strictEqual(gitForkPoint(repo.path, 'main'), own, "git's fork point is the undone commit");

				const result = await getAheadOfBase(repo, 'feat');
				assert.deepStrictEqual(result.base, {
					ref: 'main',
					ahead: 1,
					sha: mainTip,
					forkPoint: mainTip,
					tier: 'default',
				});
			} finally {
				repo.cleanup();
			}
		});

		test("measures against the default once the branch it was created from merged into it and was moved back off the branch's commit", async () => {
			const repo = createTestRepo();
			try {
				const { parentTip, mainTip, own } = createRebasedOntoMergedParent(repo.path);
				moveOntoAndBack(repo.path, 'feat-a', own, 'feat');
				assert.strictEqual(gitForkPoint(repo.path, 'feat-a'), own, "git's fork point is the undone commit");
				assert.strictEqual(revParse(repo.path, 'feat-a'), parentTip);

				const result = await getAheadOfBase(repo, 'feat');
				assert.deepStrictEqual(result.base, {
					ref: 'main',
					ahead: 1,
					sha: mainTip,
					forkPoint: mainTip,
					tier: 'default',
				});
			} finally {
				repo.cleanup();
			}
		});

		test("keeps a rebased parent's fork point against a default moved back off the branch's commit", async () => {
			const repo = createTestRepo();
			try {
				const base = getHeadSha(repo.path);
				createBranch(repo.path, 'parent', { checkout: true });
				const parentCommits: string[] = [];
				for (let i = 1; i <= 3; i++) {
					addCommit(repo.path, `parent-${i}.txt`, `parent ${i}`, `parent ${i}`);
					parentCommits.push(getHeadSha(repo.path));
				}
				git(repo.path, 'branch', 'child', 'parent');
				checkout(repo.path, 'child');
				addCommit(repo.path, 'child.txt', 'child', 'child');
				moveOntoAndBack(repo.path, 'main', getHeadSha(repo.path), 'main');
				addCommit(repo.path, 'main.txt', 'main', 'main moved on');
				// Rebased alone, as without `rebase.updateRefs`, which would carry the child along
				git(repo.path, '-c', 'rebase.updateRefs=false', 'rebase', '-q', 'main', 'parent');
				checkout(repo.path, 'child');
				assert.strictEqual(mergeBase(repo.path, 'parent'), base, 'the merge base is below the rebase');

				const result = await getAheadOfBase(repo, 'child');
				assert.deepStrictEqual(result.base, {
					ref: 'parent',
					ahead: 1,
					sha: revParse(repo.path, 'parent'),
					forkPoint: parentCommits[2],
					tier: 'created',
				});
			} finally {
				repo.cleanup();
			}
		});
	});

	suite('a base in a reftable repository', () => {
		const reftable = { refFormat: 'reftable' } as const;

		suiteSetup(function () {
			if (!supportsReftable()) {
				this.skip();
			}
		});

		/** Spies on the uncached spawn path under `Git.run`, which a `run` served from a result cache never reaches */
		function spyOnSpawns(repo: TestRepo): sinon.SinonSpy {
			return sinon.spy(
				repo.provider.git as unknown as {
					runCore: (...args: unknown[]) => unknown;
				},
				'runCore',
			);
		}

		/** What `spy` (see {@link spyOnSpawns}) saw spawned, as each spawn's string arguments, global options first */
		function spawns(spy: sinon.SinonSpy): string[][] {
			return spy.getCalls().map(c => (c.args[1] as unknown[]).filter((a): a is string => typeof a === 'string'));
		}

		/** The spawns that read the base's reflog: the entries, and the value before the oldest one */
		function reflogSpawns(spy: sinon.SinonSpy): string[][] {
			return spawns(spy).filter(args => args.includes('reflog') || args.some(a => /@\{\d+\}$/.test(a)));
		}

		test('keeps its own reflog out of files, so the fixture is the repository it claims to be', () => {
			const { clone, cleanup } = createClone(reftable);
			try {
				assert.ok(existsSync(join(clone.path, '.git', 'reftable', 'tables.list')));
				assert.ok(!existsSync(join(clone.path, '.git', 'logs')));
			} finally {
				cleanup();
			}
		});

		test('takes the tip of a stored target moved back off a commit of the branch', async () => {
			const { clone, base, cleanup } = createForceMovedBase(({ base, commits }) => [commits[1], base], reftable);
			try {
				storeTargets(clone.path, 'feature', { detected: 'origin/main' });

				const result = await getAheadOfBase(clone, 'feature');
				assert.deepStrictEqual(result.base, {
					ref: 'origin/main',
					ahead: 4,
					sha: base,
					forkPoint: base,
					tier: 'detected',
				});
			} finally {
				cleanup();
			}
		});

		test('takes the tip when it was moved back to another commit of the branch', async () => {
			const { clone, commits, cleanup } = createForceMovedBase(
				({ commits }) => [commits[2], commits[0]],
				reftable,
			);
			try {
				storeTargets(clone.path, 'feature', { detected: 'origin/main' });

				const result = await getAheadOfBase(clone, 'feature');
				assert.strictEqual(result.base?.forkPoint, commits[0]);
				assert.strictEqual(result.base?.ahead, 3);
			} finally {
				cleanup();
			}
		});

		test('takes the merge base once the moved-back base also moves on', async () => {
			const { origin, clone, base, cleanup } = createForceMovedBase(
				({ base, commits }) => [commits[1], base],
				reftable,
			);
			try {
				storeTargets(clone.path, 'feature', { detected: 'origin/main' });
				addCommit(origin.path, 'moved-on.txt', 'moved on', 'moved on');
				fetch(clone.path);

				const result = await getAheadOfBase(clone, 'feature');
				assert.strictEqual(result.base?.forkPoint, base);
				assert.strictEqual(result.base?.ahead, 4);
			} finally {
				cleanup();
			}
		});

		test('keeps the fork point of a rebased base, whose tip the branch lacks, and counts past it', async () => {
			const { clone, oldTip, cleanup } = createRewrittenBase('rebased', 0, reftable);
			try {
				storeTargets(clone.path, 'feature', { detected: 'origin/main' });

				const result = await getAheadOfBase(clone, 'feature');
				assert.notStrictEqual(
					mergeBase(clone.path, 'origin/main'),
					oldTip,
					'the merge base is before the rewrite',
				);
				assert.strictEqual(result.base?.forkPoint, oldTip);
				assert.strictEqual(result.base?.sha, revParse(clone.path, 'origin/main'));
				assert.strictEqual(result.base?.ahead, 1);
			} finally {
				cleanup();
			}
		});

		test('takes the merge base of a rewritten base that dropped the commit under the branch', async () => {
			const { clone, oldTip, cleanup } = createRewrittenBase('replaced', 0, reftable);
			try {
				storeTargets(clone.path, 'feature', { detected: 'origin/main' });

				const result = await getAheadOfBase(clone, 'feature');
				assert.strictEqual(result.base?.forkPoint, mergeBase(clone.path, 'origin/main'));
				assert.notStrictEqual(result.base?.forkPoint, oldTip);
				assert.strictEqual(result.base?.ahead, 2);
			} finally {
				cleanup();
			}
		});

		test("measures a stacked branch against its parent, not a default moved back off the branch's commit", async () => {
			const { clone, cleanup } = createClone(reftable);
			try {
				const { parentTip, childCommits } = createStackOverRewoundMain(clone.path);
				assert.strictEqual(
					gitForkPoint(clone.path, 'main'),
					childCommits[0],
					"git's fork point is the undone commit",
				);

				const result = await getAheadOfBase(clone, 'child');
				assert.deepStrictEqual(result.base, {
					ref: 'parent',
					ahead: 2,
					sha: parentTip,
					forkPoint: parentTip,
					tier: 'created',
				});
			} finally {
				cleanup();
			}
		});

		test('settles a rewritten base without its reflog: one ancestry check of the fork point for each tip', async () => {
			const { origin, clone, oldTip, cleanup } = createRewrittenBase('rebased', 0, reftable);
			try {
				storeTargets(clone.path, 'feature', { detected: 'origin/main' });
				const ancestryChecks = (spy: sinon.SinonSpy, tip: string) =>
					spawns(spy).filter(
						args => args.includes('merge-base') && args.at(-2) === oldTip && args.at(-1) === tip,
					);

				const spy = spyOnSpawns(clone);
				try {
					const tip = revParse(clone.path, 'origin/main');
					const first = await getAheadOfBase(clone, 'feature');
					assert.strictEqual(first.base?.forkPoint, oldTip);
					assert.strictEqual(first.base?.ahead, 1);
					assert.deepStrictEqual(reflogSpawns(spy), [], 'the reflog is never read');
					assert.strictEqual(ancestryChecks(spy, tip).length, 1);

					spy.resetHistory();
					assert.deepStrictEqual(await getAheadOfBase(clone, 'feature'), first);
					assert.deepStrictEqual(ancestryChecks(spy, tip), [], 'the second read reuses the first');

					addCommit(origin.path, 'moved-on.txt', 'moved on', 'moved on');
					fetch(clone.path);
					// No watcher runs here to drop the cached ref list
					await clone.provider.refs.getRefs(clone.path, undefined, { force: true });
					spy.resetHistory();
					const fetched = await getAheadOfBase(clone, 'feature');
					const movedTip = revParse(clone.path, 'origin/main');
					assert.strictEqual(fetched.base?.forkPoint, oldTip);
					assert.strictEqual(fetched.base?.sha, movedTip);
					assert.strictEqual(ancestryChecks(spy, movedTip).length, 1, 'the moved tip is checked');
					assert.deepStrictEqual(reflogSpawns(spy), []);
				} finally {
					spy.restore();
				}
			} finally {
				cleanup();
			}
		});

		test('settles a base moved back off a commit of the branch again each time it moves on', async () => {
			const { origin, clone, base, cleanup } = createForceMovedBase(
				({ base, commits }) => [commits[1], base],
				reftable,
			);
			try {
				storeTargets(clone.path, 'feature', { detected: 'origin/main' });
				addCommit(origin.path, 'moved-on.txt', 'moved on', 'moved on');
				fetch(clone.path);
				await clone.provider.refs.getRefs(clone.path, undefined, {
					force: true,
				});
				assert.strictEqual((await getAheadOfBase(clone, 'feature')).base?.forkPoint, base);

				addCommit(origin.path, 'moved-on-again.txt', 'moved on again', 'moved on again');
				fetch(clone.path);
				await clone.provider.refs.getRefs(clone.path, undefined, {
					force: true,
				});
				const moved = await getAheadOfBase(clone, 'feature');
				assert.strictEqual(moved.base?.forkPoint, base);
				assert.strictEqual(moved.base?.ahead, 4);
			} finally {
				cleanup();
			}
		});

		test('shares one ancestry check of the fork point between worktrees of one repository', async () => {
			const { clone, oldTip, cleanup } = createRewrittenBase('rebased', 0, reftable);
			const worktrees = mkdtempSync(join(tmpdir(), 'gitlens-reftable-worktrees-'));
			try {
				storeTargets(clone.path, 'feature', { detected: 'origin/main' });
				storeTargets(clone.path, 'second', { detected: 'origin/main' });
				const second = join(worktrees, 'second');
				git(clone.path, 'worktree', 'add', '-q', '--no-track', '-b', 'second', second, 'feature');
				addCommit(second, 'second-only.txt', 'second', 'second only');
				clone.provider.cache.registerRepoPath(fileUri(second), await clone.provider.config.getGitDir(second));

				const spy = spyOnSpawns(clone);
				try {
					const first = await clone.provider.branches.getAheadOfBase(clone.path, 'feature');
					const other = await clone.provider.branches.getAheadOfBase(second, 'second');
					assert.strictEqual(first.base?.forkPoint, other.base?.forkPoint);
					assert.strictEqual(first.base?.ahead, 1);
					assert.strictEqual(other.base?.ahead, 2);
					assert.strictEqual(
						spawns(spy).filter(args => args.includes('merge-base') && args.at(-2) === oldTip).length,
						1,
						'one ancestry check for both',
					);
					assert.deepStrictEqual(reflogSpawns(spy), []);
				} finally {
					spy.restore();
				}
			} finally {
				rmSync(worktrees, { recursive: true, force: true });
				cleanup();
			}
		});

		test('takes the merge base of a rewritten base whose reflog git cannot read', async () => {
			const { clone, oldTip, cleanup } = createRewrittenBase('replaced', 0, reftable);
			try {
				storeTargets(clone.path, 'feature', { detected: 'origin/main' });

				const git = clone.provider.git;
				const run = git.run.bind(git);
				const stub = sinon
					.stub(git, 'run')
					.callsFake(((options: unknown, ...args: unknown[]) =>
						args[0] === 'reflog'
							? Promise.reject(new Error('boom'))
							: run(options as never, ...(args as never[]))) as never);
				try {
					const result = await getAheadOfBase(clone, 'feature');
					assert.strictEqual(result.base?.forkPoint, mergeBase(clone.path, 'origin/main'));
					assert.notStrictEqual(result.base?.forkPoint, oldTip);
					assert.strictEqual(result.base?.ahead, 2);
				} finally {
					stub.restore();
				}
			} finally {
				cleanup();
			}
		});
	});

	suite('a base ref with no reflog file', () => {
		test('spawns nothing to read a reflog it does not have', async () => {
			const { origin, clone, cleanup } = createClone();
			try {
				// `origin/main` then moves with no entry in any reflog, as after a clone, so `--fork-point` finds the merge base
				setConfig(clone.path, 'core.logAllRefUpdates', 'false');
				createBranchFromDetachedHead(clone.path, 'feature', 'origin/main');
				addCommit(clone.path, 'branch-only.txt', 'feature', 'branch only');
				addCommit(origin.path, 'moved-on.txt', 'moved on', 'moved on');
				fetch(clone.path);
				storeTargets(clone.path, 'feature', { detected: 'origin/main' });
				assert.ok(!existsSync(join(clone.path, '.git', 'logs', 'refs', 'remotes', 'origin', 'main')));

				const spy = sinon.spy(clone.provider.git, 'run');
				try {
					const result = await getAheadOfBase(clone, 'feature');
					assert.strictEqual(result.base?.ahead, 1);
				} finally {
					spy.restore();
				}

				const calls = spy.getCalls().map(c => c.args.slice(1).filter(a => typeof a === 'string'));
				assert.deepStrictEqual(
					calls.filter(args => args[0] === 'reflog' || args.some(a => /@\{\d+\}$/.test(a))),
					[],
				);
				// With no reflog, git's reading is the merge base, so no ancestry check of it is needed
				assert.deepStrictEqual(
					calls.filter(args => args[0] === 'merge-base'),
					[
						['merge-base', '--fork-point', 'origin/main', 'HEAD'],
						['merge-base', 'HEAD', 'origin/main'],
					],
				);
			} finally {
				cleanup();
			}
		});
	});

	suite('local default branch', () => {
		test('prefers the origin/HEAD symref, as its local name', async () => {
			const { origin, clone, cleanup } = createClone();
			try {
				createBranch(origin.path, 'develop');
				fetch(clone.path);
				setRemoteHead(clone.path, 'origin', 'develop');
				createTrackingBranch(clone.path, 'develop', 'origin/develop');
				createBranchFromDetachedHead(clone.path, 'feature', 'develop');
				addCommit(clone.path, 'branch-only.txt', 'feature', 'branch only');

				const result = await getAheadOfBase(clone, 'feature');
				// `develop` and its upstream fork at the same commit, so the tracking ref takes it
				assert.strictEqual(result.base?.ref, 'origin/develop');
				assert.strictEqual(result.base?.ahead, 1);
				assert.strictEqual(result.base?.tier, 'default');
				assertDependsOn(result, [
					'refs/remotes/origin/HEAD',
					'refs/heads/develop',
					'refs/remotes/origin/develop',
				]);
			} finally {
				cleanup();
			}
		});

		test("prefers the upstream remote's symref over origin's", async () => {
			const { origin, clone, cleanup } = createClone();
			try {
				createBranch(origin.path, 'develop', { checkout: true });
				addCommit(origin.path, 'develop-only.txt', 'develop', 'develop only');
				git(clone.path, 'remote', 'add', 'upstream', origin.path);
				fetch(clone.path, 'upstream');
				// `origin/HEAD` still names `main`
				setRemoteHead(clone.path, 'upstream', 'develop');
				createTrackingBranch(clone.path, 'develop', 'upstream/develop');
				createBranchFromDetachedHead(clone.path, 'feature', 'develop');
				addCommit(clone.path, 'branch-only.txt', 'feature', 'branch only');

				const result = await getAheadOfBase(clone, 'feature');
				assert.strictEqual(result.base?.ref, 'upstream/develop');
				assert.strictEqual(result.base?.ahead, 1);
				assert.strictEqual(result.base?.tier, 'default');
				assertDependsOn(result, ['refs/remotes/upstream/HEAD', 'refs/heads/develop']);
				assert.ok(!result.dependsOn.includes('refs/remotes/origin/HEAD'), 'Only the chosen remote is read');
			} finally {
				cleanup();
			}
		});

		test("falls back to origin's symref when the upstream remote has none", async () => {
			const { origin, clone, cleanup } = createClone();
			try {
				createBranch(origin.path, 'develop', { checkout: true });
				addCommit(origin.path, 'develop-only.txt', 'develop', 'develop only');
				fetch(clone.path);
				setRemoteHead(clone.path, 'origin', 'develop');
				git(clone.path, 'remote', 'add', 'upstream', origin.path);
				fetch(clone.path, 'upstream');
				// Git before 2.48 never writes a remote's `HEAD` symref on fetch, so a remote added after the clone has none
				git(clone.path, 'remote', 'set-head', 'upstream', '-d');
				createBranchFromDetachedHead(clone.path, 'feature', 'origin/develop');
				addCommit(clone.path, 'branch-only.txt', 'feature', 'branch only');

				const result = await getAheadOfBase(clone, 'feature');
				assert.strictEqual(result.base?.ref, 'origin/develop');
				assert.strictEqual(result.base?.ahead, 1);
				assert.strictEqual(result.base?.tier, 'default');
				// `upstream`'s symref appearing changes the answer
				assertDependsOn(result, ['refs/remotes/upstream/HEAD', 'refs/remotes/origin/HEAD']);
			} finally {
				cleanup();
			}
		});

		test('uses the remote ref the symref names when there is no local branch of that name', async () => {
			const { origin, clone, cleanup } = createClone();
			try {
				createBranch(origin.path, 'develop', { checkout: true });
				addCommit(origin.path, 'develop-only.txt', 'develop', 'develop only');
				fetch(clone.path);
				setRemoteHead(clone.path, 'origin', 'develop');
				createBranchFromDetachedHead(clone.path, 'feature', 'origin/develop');
				addCommit(clone.path, 'branch-only.txt', 'feature', 'branch only');

				const result = await getAheadOfBase(clone, 'feature');
				assert.strictEqual(result.base?.ref, 'origin/develop');
				assert.strictEqual(result.base?.ahead, 1);
				assert.strictEqual(result.base?.tier, 'default');
				// A local `develop` appearing changes the answer
				assertDependsOn(result, [
					'refs/remotes/origin/HEAD',
					'refs/heads/develop',
					'refs/remotes/origin/develop',
				]);
			} finally {
				cleanup();
			}
		});

		test('reads the first remote when there is neither an upstream nor an origin remote', async () => {
			const { origin, clone, cleanup } = createClone();
			try {
				createBranch(origin.path, 'develop', { checkout: true });
				addCommit(origin.path, 'develop-only.txt', 'develop', 'develop only');
				git(clone.path, 'remote', 'rename', 'origin', 'fork');
				fetch(clone.path, 'fork');
				setRemoteHead(clone.path, 'fork', 'develop');
				createBranchFromDetachedHead(clone.path, 'feature', 'fork/develop');
				addCommit(clone.path, 'branch-only.txt', 'feature', 'branch only');

				const result = await getAheadOfBase(clone, 'feature');
				assert.strictEqual(result.base?.ref, 'fork/develop');
				assert.strictEqual(result.base?.ahead, 1);
				assert.strictEqual(result.base?.tier, 'default');
				assertDependsOn(result, ['refs/remotes/fork/HEAD']);
			} finally {
				cleanup();
			}
		});

		test("guesses origin/main without a symref, a remote's usual default name", async () => {
			const { clone, cleanup } = createClone();
			try {
				git(clone.path, 'remote', 'set-head', 'origin', '-d');
				createBranchFromDetachedHead(clone.path, 'feature', 'origin/main');
				addCommit(clone.path, 'branch-only.txt', 'feature', 'branch only');
				git(clone.path, 'branch', '-D', 'main');

				const result = await getAheadOfBase(clone, 'feature');
				assert.strictEqual(result.base?.ref, 'origin/main');
				assert.strictEqual(result.base?.ahead, 1);
				assert.strictEqual(result.base?.tier, 'default');
				// The symref appearing changes the answer, as does a local `main`
				assertDependsOn(result, ['refs/remotes/origin/HEAD', 'refs/remotes/origin/main', 'refs/heads/main']);
			} finally {
				cleanup();
			}
		});

		test('guesses origin/master without a symref when origin has no main', async () => {
			const origin = createTestRepo();
			let clone: TestRepo | undefined;
			try {
				git(origin.path, 'branch', '-m', 'main', 'master');
				clone = cloneTestRepo(origin.path);
				git(clone.path, 'remote', 'set-head', 'origin', '-d');
				createBranchFromDetachedHead(clone.path, 'feature', 'origin/master');
				addCommit(clone.path, 'branch-only.txt', 'feature', 'branch only');
				git(clone.path, 'branch', '-D', 'master');

				const result = await getAheadOfBase(clone, 'feature');
				assert.strictEqual(result.base?.ref, 'origin/master');
				assert.strictEqual(result.base?.ahead, 1);
				assert.strictEqual(result.base?.tier, 'default');
				// `origin/main` was looked for first, so its creation can change the answer
				assertDependsOn(result, [
					'refs/remotes/origin/HEAD',
					'refs/remotes/origin/main',
					'refs/remotes/origin/master',
				]);
			} finally {
				clone?.cleanup();
				origin.cleanup();
			}
		});

		test('takes the guessed origin/main as its local branch when there is one', async () => {
			const { clone, cleanup } = createClone();
			try {
				git(clone.path, 'remote', 'set-head', 'origin', '-d');
				// Unpushed work on `main`, so measuring against `origin/main` instead would count it too
				addCommit(clone.path, 'main-only.txt', 'main', 'main only');
				createBranch(clone.path, 'feature', { checkout: true });
				addCommit(clone.path, 'branch-only.txt', 'feature', 'branch only');

				const result = await getAheadOfBase(clone, 'feature');
				assert.strictEqual(result.base?.ref, 'main');
				assert.strictEqual(result.base?.ahead, 1);
				assert.strictEqual(result.base?.tier, 'default');
				assertDependsOn(result, ['refs/remotes/origin/HEAD', 'refs/remotes/origin/main', 'refs/heads/main']);
			} finally {
				cleanup();
			}
		});

		test('falls back to init.defaultBranch without a symref', async () => {
			const repo = createTestRepo();
			try {
				git(repo.path, 'branch', '-m', 'main', 'trunk');
				setConfig(repo.path, 'init.defaultBranch', 'trunk');
				createBranch(repo.path, 'feature', { checkout: true });
				addCommit(repo.path, 'branch-only.txt', 'feature', 'branch only');

				const result = await getAheadOfBase(repo, 'feature');
				assert.strictEqual(result.base?.ref, 'trunk');
				assert.strictEqual(result.base?.ahead, 1);
				assert.strictEqual(result.base?.tier, 'default');
				assertDependsOn(result, ['refs/heads/trunk']);
				// With no remote there is no symref to read
				assert.ok(!result.dependsOn.some(ref => ref.startsWith('refs/remotes/') && ref.endsWith('/HEAD')));
			} finally {
				repo.cleanup();
			}
		});

		test('falls back to main, then master', async () => {
			const onMain = createTestRepo();
			const onMaster = createTestRepo();
			try {
				createBranch(onMain.path, 'feature', { checkout: true });
				addCommit(onMain.path, 'branch-only.txt', 'feature', 'branch only');

				git(onMaster.path, 'branch', '-m', 'main', 'master');
				setConfig(onMaster.path, 'init.defaultBranch', 'nope');
				createBranch(onMaster.path, 'feature', { checkout: true });
				addCommit(onMaster.path, 'branch-only.txt', 'feature', 'branch only');

				const mainResult = await getAheadOfBase(onMain, 'feature');
				assert.strictEqual(mainResult.base?.ref, 'main');
				assert.strictEqual(mainResult.base?.ahead, 1);
				assert.strictEqual(mainResult.base?.tier, 'default');

				const masterResult = await getAheadOfBase(onMaster, 'feature');
				assert.strictEqual(masterResult.base?.ref, 'master');
				assert.strictEqual(masterResult.base?.ahead, 1);
				// A default that didn't exist yet was looked for, so its creation can change the answer
				assertDependsOn(masterResult, ['refs/heads/nope', 'refs/heads/main', 'refs/heads/master']);
			} finally {
				onMaster.cleanup();
				onMain.cleanup();
			}
		});

		test('measures a stored base over the default even when the default exists', async () => {
			const repo = createTestRepo();
			try {
				createBranch(repo.path, 'develop', { checkout: true });
				addCommit(repo.path, 'develop-only.txt', 'develop', 'develop only');
				createBranch(repo.path, 'feature', { checkout: true });
				addCommit(repo.path, 'branch-only.txt', 'feature', 'branch only');
				storeTargets(repo.path, 'feature', { recorded: 'develop' });

				const result = await getAheadOfBase(repo, 'feature');
				// `develop`'s own work belongs to develop, not to the branch taken off it
				assert.strictEqual(result.base?.ref, 'develop');
				assert.strictEqual(result.base?.ahead, 1);
				assert.strictEqual(result.base?.tier, 'recorded');
			} finally {
				repo.cleanup();
			}
		});
	});

	suite('created from', () => {
		test("measures against the branch the reflog says it was created from, before the fork's default", async () => {
			const { clone, cleanup } = createFork();
			try {
				git(clone.path, 'switch', '-c', 'feat', 'upstream/main');
				addCommit(clone.path, 'feat.txt', 'feat', 'feat work');

				const result = await getAheadOfBase(clone, 'feat');
				assert.strictEqual(result.base?.ref, 'upstream/main');
				assert.strictEqual(result.base?.ahead, 1);
				assert.strictEqual(result.base?.tier, 'created');
				assert.strictEqual(result.base?.sha, revParse(clone.path, 'upstream/main'));
				// The default was consulted too: the branch becoming the default changes the answer
				assertDependsOn(result, [
					'refs/heads/feat',
					'refs/remotes/upstream/main',
					'refs/remotes/upstream/HEAD',
				]);
				// Nor is the reflog's answer written back as the recorded base
				assert.strictEqual(gkConfig(clone.path, 'branch.feat.gk-merge-base'), undefined);
			} finally {
				cleanup();
			}
		});

		test("measures a branch created from a fork's stale main against upstream's once rebased onto it", async () => {
			const { clone, cleanup } = createFork();
			try {
				git(clone.path, 'switch', '-c', 'feat', 'main');
				addCommit(clone.path, 'feat.txt', 'feat', 'feat work');
				git(clone.path, 'rebase', 'upstream/main');

				const result = await getAheadOfBase(clone, 'feat');
				// Against `main` or `origin/main`, upstream's commit would count too
				assert.strictEqual(result.base?.ref, 'upstream/main');
				assert.strictEqual(result.base?.ahead, 1);
				assert.strictEqual(result.base?.tier, 'created');
				assertDependsOn(result, ['refs/heads/main', 'refs/remotes/origin/main', 'refs/remotes/upstream/main']);
			} finally {
				cleanup();
			}
		});

		test("measures a fork's branch against upstream's default when it forked nearer than origin's", async () => {
			const { clone, cleanup } = createFork();
			try {
				createBranchFromDetachedHead(clone.path, 'feat', 'upstream/main');
				addCommit(clone.path, 'feat.txt', 'feat', 'feat work');

				const result = await getAheadOfBase(clone, 'feat');
				// Against `main` or `origin/main`, upstream's commit would count too
				assert.strictEqual(result.base?.ref, 'upstream/main');
				assert.strictEqual(result.base?.ahead, 1);
				assert.strictEqual(result.base?.tier, 'default');
				assert.strictEqual(result.base?.forkPoint, revParse(clone.path, 'upstream/main'));
				assertDependsOn(result, ['refs/heads/main', 'refs/remotes/origin/main', 'refs/remotes/upstream/main']);
			} finally {
				cleanup();
			}
		});

		test("keeps a synced fork's own default over upstream's", async () => {
			const { clone, cleanup } = createFork({ synced: true });
			try {
				createBranch(clone.path, 'feat', { checkout: true });
				addCommit(clone.path, 'feat.txt', 'feat', 'feat work');

				const result = await getAheadOfBase(clone, 'feat');
				assert.strictEqual(result.base?.ref, 'origin/main');
				assert.strictEqual(result.base?.ahead, 1);
				assert.strictEqual(result.base?.tier, 'default');
			} finally {
				cleanup();
			}
		});

		test('does not measure a branch git created from its own remote copy against that copy', async () => {
			const { origin, clone, cleanup } = createClone();
			try {
				createBranch(origin.path, 'feat', { checkout: true });
				addCommit(origin.path, 'feat-pushed.txt', 'feat', 'pushed feat work');
				fetch(clone.path);
				// Creates `feat` from `origin/feat`
				git(clone.path, 'switch', 'feat');
				addCommit(clone.path, 'feat-local.txt', 'feat', 'local feat work');

				const result = await getAheadOfBase(clone, 'feat');
				assert.strictEqual(result.base?.ref, 'origin/main');
				assert.strictEqual(result.base?.ahead, 2);
				assert.strictEqual(result.base?.tier, 'default');
			} finally {
				cleanup();
			}
		});

		test('ignores a branch created from a tag, a sha or a revision expression', async () => {
			for (const startPoint of ['v1', 'sha', 'develop~0']) {
				const repo = createTestRepo();
				try {
					createBranch(repo.path, 'develop', { checkout: true });
					addCommit(repo.path, 'develop-only.txt', 'develop', 'develop only');
					git(repo.path, 'tag', 'v1');
					git(repo.path, 'checkout', '-b', 'feat', startPoint === 'sha' ? getHeadSha(repo.path) : startPoint);
					addCommit(repo.path, 'feat.txt', 'feat', 'feat work');

					const result = await getAheadOfBase(repo, 'feat');
					assert.strictEqual(result.base?.ref, 'main', startPoint);
					assert.strictEqual(result.base?.ahead, 2, startPoint);
					assert.strictEqual(result.base?.tier, 'default', startPoint);
				} finally {
					repo.cleanup();
				}
			}
		});

		test('measures a recorded base over the branch it was created from, without reading the reflog', async () => {
			const repo = createTestRepo();
			try {
				createBranch(repo.path, 'develop', { checkout: true });
				addCommit(repo.path, 'develop-only.txt', 'develop', 'develop only');
				git(repo.path, 'checkout', '-b', 'feat', 'develop');
				addCommit(repo.path, 'feat.txt', 'feat', 'feat work');
				storeTargets(repo.path, 'feat', { recorded: 'main' });

				const spy = sinon.spy(repo.provider.refs, 'getReflogEntries');
				let result: AheadOfBase;
				try {
					result = await getAheadOfBase(repo, 'feat');
				} finally {
					spy.restore();
				}

				assert.strictEqual(result.base?.ref, 'main');
				assert.strictEqual(result.base?.ahead, 2);
				assert.strictEqual(result.base?.tier, 'recorded');
				assert.strictEqual(spy.callCount, 0, 'read the reflog');
			} finally {
				repo.cleanup();
			}
		});

		test('reads the reflog once per branch, again after the provider deletes and recreates it', async () => {
			const repo = createTestRepo();
			try {
				createBranch(repo.path, 'develop', { checkout: true });
				addCommit(repo.path, 'develop-only.txt', 'develop', 'develop only');
				git(repo.path, 'checkout', '-b', 'feat', 'develop');
				addCommit(repo.path, 'feat.txt', 'feat', 'feat work');

				const first = await getAheadOfBase(repo, 'feat');
				assert.strictEqual(first.base?.ref, 'develop');
				assert.strictEqual(first.base?.ahead, 1);
				assert.strictEqual(first.base?.tier, 'created');

				const spy = sinon.spy(repo.provider.refs, 'getReflogEntries');
				try {
					// A commit clears the cached results, as the heads watcher does
					addCommit(repo.path, 'feat-2.txt', 'feat', 'more feat work');
					repo.provider.cache.clearCaches(repo.path);

					const second = await getAheadOfBase(repo, 'feat');
					assert.strictEqual(second.base?.ref, 'develop');
					assert.strictEqual(second.base?.ahead, 2);
					assert.strictEqual(second.base?.tier, 'created');
					assert.strictEqual(spy.callCount, 0, 'read the reflog again');

					checkout(repo.path, 'main');
					await repo.provider.branches.deleteLocalBranch(repo.path, 'feat', { force: true });
					git(repo.path, 'checkout', '-b', 'feat', 'main');
					addCommit(repo.path, 'feat-3.txt', 'feat', 'new feat work');
					repo.provider.cache.clearCaches(repo.path);

					const recreated = await getAheadOfBase(repo, 'feat');
					assert.strictEqual(recreated.base?.ref, 'main');
					assert.strictEqual(recreated.base?.ahead, 1);
					assert.strictEqual(recreated.base?.tier, 'created');
					assert.strictEqual(spy.callCount, 1, 'expected one reflog read for the recreated branch');
				} finally {
					spy.restore();
				}
			} finally {
				repo.cleanup();
			}
		});

		test('measures against the default once the branch it was created from merged and it was rebased', async () => {
			const repo = createTestRepo();
			try {
				createBranch(repo.path, 'feat-a', { checkout: true });
				addCommit(repo.path, 'feat-a.txt', 'feat-a', 'feat-a work');
				git(repo.path, 'checkout', '-b', 'feat', 'feat-a');
				addCommit(repo.path, 'feat.txt', 'feat', 'feat work');
				checkout(repo.path, 'main');
				mergeBranch(repo.path, 'feat-a', 'merge feat-a');
				checkout(repo.path, 'feat');
				git(repo.path, 'rebase', 'main');

				const result = await getAheadOfBase(repo, 'feat');
				// Against the kept `feat-a`, the merge commit would count too
				assert.strictEqual(result.base?.ref, 'main');
				assert.strictEqual(result.base?.ahead, 1);
				assert.strictEqual(result.base?.tier, 'default');
				assert.strictEqual(result.base?.forkPoint, revParse(repo.path, 'main'));
			} finally {
				repo.cleanup();
			}
		});

		test("keeps a stacked branch's unmerged parent over the default", async () => {
			const repo = createTestRepo();
			try {
				createBranch(repo.path, 'feat-a', { checkout: true });
				addCommit(repo.path, 'feat-a.txt', 'feat-a', 'feat-a work');
				git(repo.path, 'checkout', '-b', 'feat', 'feat-a');
				addCommit(repo.path, 'feat.txt', 'feat', 'feat work');
				checkout(repo.path, 'main');
				addCommit(repo.path, 'main-only.txt', 'main', 'main only');
				checkout(repo.path, 'feat');

				const result = await getAheadOfBase(repo, 'feat');
				assert.strictEqual(result.base?.ref, 'feat-a');
				assert.strictEqual(result.base?.ahead, 1);
				assert.strictEqual(result.base?.tier, 'created');
				assertDependsOn(result, ['refs/heads/feat-a', 'refs/heads/main']);
			} finally {
				repo.cleanup();
			}
		});

		test('never reads the reflog for the default branch, created from another', async () => {
			const repo = createTestRepo();
			try {
				git(repo.path, 'checkout', '-b', 'develop', 'main');
				addCommit(repo.path, 'develop-only.txt', 'develop', 'develop only');
				setConfig(repo.path, 'init.defaultBranch', 'develop');

				const spy = sinon.spy(repo.provider.refs, 'getReflogEntries');
				let result: AheadOfBase;
				try {
					result = await getAheadOfBase(repo, 'develop');
				} finally {
					spy.restore();
				}

				// Measured against its own upstream, of which it has none, not against `main`
				assert.strictEqual(result.base, undefined);
				assert.strictEqual(result.reason, 'self');
				assert.strictEqual(spy.callCount, 0, 'read the reflog');
			} finally {
				repo.cleanup();
			}
		});
	});

	suite('no base', () => {
		test("never uses a base only HEAD's checkout history knows", async () => {
			const repo = createTestRepo();
			try {
				createBranch(repo.path, 'develop', { checkout: true });
				addCommit(repo.path, 'develop-only.txt', 'develop', 'develop only');
				createBranch(repo.path, 'feature', { checkout: true });
				addCommit(repo.path, 'branch-only.txt', 'feature', 'branch only');

				const result = await getAheadOfBase(repo, 'feature');
				// Measured against the default, so `develop`'s commit counts too
				assert.strictEqual(result.base?.ref, 'main');
				assert.strictEqual(result.base?.ahead, 2);
				assert.strictEqual(result.base?.tier, 'default');
				assert.ok(!result.dependsOn.includes('refs/heads/develop'));
				// Nor is the reflog's guess written back as the recorded base
				assert.strictEqual(gkConfig(repo.path, 'branch.feature.gk-merge-base'), undefined);
			} finally {
				repo.cleanup();
			}
		});

		test('answers no base on the default branch itself when it has no upstream', async () => {
			const repo = createTestRepo();
			try {
				addCommit(repo.path, 'more.txt', 'more', 'more');

				const result = await getAheadOfBase(repo, 'main');
				assert.strictEqual(result.base, undefined);
				assert.strictEqual(result.reason, 'self');
				assertDependsOn(result, ['refs/heads/main']);
			} finally {
				repo.cleanup();
			}
		});

		test('answers no base when neither a recorded base nor a default resolves', async () => {
			const repo = createTestRepo();
			try {
				git(repo.path, 'branch', '-m', 'main', 'solo');
				setConfig(repo.path, 'init.defaultBranch', 'nope');
				storeTargets(repo.path, 'solo', { user: 'gone' });

				const result = await getAheadOfBase(repo, 'solo');
				assert.strictEqual(result.base, undefined);
				assert.strictEqual(result.reason, 'none');
				assertDependsOn(result, [
					'refs/heads/solo',
					'refs/heads/gone',
					'refs/heads/nope',
					'refs/heads/main',
					'refs/heads/master',
				]);
			} finally {
				repo.cleanup();
			}
		});

		test('answers no base on a branch with no commit yet, still naming its refs', async () => {
			const repo = createTestRepo();
			try {
				git(repo.path, 'checkout', '--orphan', 'fresh');

				const result = await getAheadOfBase(repo, 'fresh');
				assert.strictEqual(result.base, undefined);
				assert.strictEqual(result.reason, 'unborn');
				assertDependsOn(result, ['refs/heads/fresh', 'refs/heads/main']);
			} finally {
				repo.cleanup();
			}
		});

		test('answers no base in a repository with no commit yet', async () => {
			const repo = createTestRepo();
			const dir = mkdtempSync(join(tmpdir(), 'gitlens-test-'));
			try {
				git(dir, 'init', '-b', 'main');

				const result = await repo.provider.branches.getAheadOfBase(dir, 'main');
				assert.strictEqual(result.base, undefined);
				assert.strictEqual(result.reason, 'unborn');
			} finally {
				rmSync(dir, { recursive: true, force: true });
				repo.cleanup();
			}
		});

		test('measures a detached head against the default branch, with no self check', async () => {
			const repo = createCandidateRepo();
			try {
				storeTargets(repo.path, 'feature', { user: 'develop', recorded: 'staging' });
				const sha = getHeadSha(repo.path);
				checkout(repo.path, sha);

				for (const branch of [undefined, formatDetachedHeadName(sha), '']) {
					const result = await getAheadOfBase(repo, branch);
					assert.strictEqual(result.base?.ref, 'main');
					assert.strictEqual(result.base?.tier, 'default');
					assert.strictEqual(result.base?.ahead, 4);
					assert.strictEqual(result.base?.sha, revParse(repo.path, 'main'));
					assert.strictEqual(result.base?.forkPoint, mergeBase(repo.path, 'main'));
					assertDependsOn(result, ['refs/heads/main']);
					assert.ok(
						!result.dependsOn.some(ref => ref.startsWith('refs/heads/') && ref !== 'refs/heads/main'),
						`Only the default branch is consulted: ${result.dependsOn.join(', ')}`,
					);
				}
			} finally {
				repo.cleanup();
			}
		});

		test('answers no base on a detached head when no default branch resolves', async () => {
			const repo = createTestRepo();
			try {
				git(repo.path, 'branch', '-m', 'main', 'solo');
				setConfig(repo.path, 'init.defaultBranch', 'nope');
				const sha = getHeadSha(repo.path);
				checkout(repo.path, sha);

				const result = await getAheadOfBase(repo, undefined);
				assert.strictEqual(result.base, undefined);
				assert.strictEqual(result.reason, 'none');
				assertDependsOn(result, ['refs/heads/nope', 'refs/heads/main', 'refs/heads/master']);
				assert.ok(!result.dependsOn.includes('refs/heads/solo'));
			} finally {
				repo.cleanup();
			}
		});
	});

	suite('options', () => {
		test('leaves the user target out and measures the detected one with skipUserTarget', async () => {
			const repo = createCandidateRepo();
			try {
				storeTargets(repo.path, 'feature', { user: 'develop', detected: 'release', recorded: 'staging' });

				const result = await getAheadOfBase(repo, 'feature', { skipUserTarget: true });
				assert.strictEqual(result.base?.ref, 'release');
				assert.strictEqual(result.base?.ahead, 2);
				assert.strictEqual(result.base?.tier, 'detected');
				assert.ok(!result.dependsOn.includes('refs/heads/develop'), 'The user target is not read');
			} finally {
				repo.cleanup();
			}
		});

		test('tries a preferred target before the user target', async () => {
			const repo = createCandidateRepo();
			try {
				storeTargets(repo.path, 'feature', { user: 'develop', detected: 'release' });

				const result = await getAheadOfBase(repo, 'feature', { preferredTarget: ' staging ' });
				assert.strictEqual(result.base?.ref, 'staging');
				assert.strictEqual(result.base?.ahead, 1);
				assert.strictEqual(result.base?.tier, 'preferred');
				assert.strictEqual(result.base?.forkPoint, mergeBase(repo.path, 'staging'));
				assertDependsOn(result, ['refs/heads/feature', 'refs/heads/staging']);
			} finally {
				repo.cleanup();
			}
		});

		test('falls back to the usual order when the preferred target names no ref', async () => {
			const repo = createCandidateRepo();
			try {
				storeTargets(repo.path, 'feature', { user: 'develop', detected: 'release' });

				const result = await getAheadOfBase(repo, 'feature', { preferredTarget: 'origin/gone' });
				assert.strictEqual(result.base?.ref, 'develop');
				assert.strictEqual(result.base?.tier, 'user');
				assertDependsOn(result, ['refs/heads/origin/gone', 'refs/remotes/origin/gone', 'refs/heads/develop']);
			} finally {
				repo.cleanup();
			}
		});

		test('falls back to the usual order when the preferred target is the branch itself', async () => {
			const repo = createCandidateRepo();
			try {
				storeTargets(repo.path, 'feature', { user: 'develop' });

				const result = await getAheadOfBase(repo, 'feature', { preferredTarget: 'feature' });
				assert.strictEqual(result.base?.ref, 'develop');
				assert.strictEqual(result.base?.tier, 'user');
			} finally {
				repo.cleanup();
			}
		});

		test('falls back to the usual order when the preferred target is the branch itself as a full ref', async () => {
			const repo = createCandidateRepo();
			try {
				storeTargets(repo.path, 'feature', { user: 'develop' });
				git(repo.path, 'remote', 'add', 'origin', 'https://example.test/repo.git');
				git(repo.path, 'update-ref', 'refs/remotes/origin/feature', 'HEAD');

				for (const preferredTarget of ['refs/heads/feature', 'refs/remotes/origin/feature']) {
					const result = await getAheadOfBase(repo, 'feature', { preferredTarget: preferredTarget });
					assert.strictEqual(result.base?.ref, 'develop', preferredTarget);
					assert.strictEqual(result.base?.tier, 'user', preferredTarget);
				}
			} finally {
				repo.cleanup();
			}
		});

		test('uses a full ref to a different branch as the preferred target', async () => {
			const repo = createCandidateRepo();
			try {
				storeTargets(repo.path, 'feature', { user: 'develop' });

				const result = await getAheadOfBase(repo, 'feature', { preferredTarget: 'refs/heads/staging' });
				assert.strictEqual(result.base?.ref, 'refs/heads/staging');
				assert.strictEqual(result.base?.tier, 'preferred');
			} finally {
				repo.cleanup();
			}
		});

		test('answers no base when the preferred target is unusable and nothing else resolves', async () => {
			const repo = createTestRepo();
			try {
				git(repo.path, 'branch', '-m', 'main', 'solo');
				setConfig(repo.path, 'init.defaultBranch', 'nope');

				const result = await getAheadOfBase(repo, 'solo', { preferredTarget: 'gone' });
				assert.strictEqual(result.base, undefined);
				assert.strictEqual(result.reason, 'none');
				assertDependsOn(result, ['refs/heads/solo', 'refs/heads/gone']);
			} finally {
				repo.cleanup();
			}
		});

		test('applies a preferred target on a detached head', async () => {
			const repo = createCandidateRepo();
			try {
				checkout(repo.path, getHeadSha(repo.path));

				const result = await getAheadOfBase(repo, undefined, { preferredTarget: 'develop' });
				assert.strictEqual(result.base?.ref, 'develop');
				assert.strictEqual(result.base?.ahead, 3);
				assert.strictEqual(result.base?.tier, 'preferred');
			} finally {
				repo.cleanup();
			}
		});

		test('treats a blank preferred target as none', async () => {
			const repo = createCandidateRepo();
			try {
				storeTargets(repo.path, 'feature', { user: 'develop' });

				assert.strictEqual((await getAheadOfBase(repo, 'feature')).base?.tier, 'user');
				assert.strictEqual(
					(await getAheadOfBase(repo, 'feature', { preferredTarget: '  ' })).base?.tier,
					'user',
				);
			} finally {
				repo.cleanup();
			}
		});
	});

	test('rejects when the count against a resolved base fails, rather than answering no base', async () => {
		const repo = createCandidateRepo();
		try {
			storeTargets(repo.path, 'feature', { recorded: 'develop' });
			// Cache the ref list naming `develop`, then delete it: the base still resolves, but the count against it fails
			await repo.provider.refs.getRefs(repo.path);
			git(repo.path, 'branch', '-D', 'develop');

			await assert.rejects(
				getAheadOfBase(repo, 'feature'),
				ex => !isCancellationError(ex) && ex instanceof Error && ex.message.includes('develop'),
			);
		} finally {
			repo.cleanup();
		}
	});

	test('does not keep a cached failed count: re-counts once the base is back', async () => {
		const repo = createCandidateRepo();
		try {
			git(repo.path, 'branch', '-m', 'develop', 'develop-hidden');
			assert.strictEqual(
				await repo.provider.commits.getLeftRightCommitCount(repo.path, 'develop...HEAD'),
				undefined,
			);

			git(repo.path, 'branch', '-m', 'develop-hidden', 'develop');
			storeTargets(repo.path, 'feature', { recorded: 'develop' });

			const result = await getAheadOfBase(repo, 'feature');
			assert.deepStrictEqual(result.base, {
				ref: 'develop',
				ahead: 3,
				sha: revParse(repo.path, 'develop'),
				forkPoint: mergeBase(repo.path, 'develop'),
				tier: 'recorded',
			});
		} finally {
			repo.cleanup();
		}
	});

	test('rejects when cancelled', async () => {
		const repo = createCandidateRepo();
		try {
			storeTargets(repo.path, 'feature', { recorded: 'develop' });
			const aborted = new AbortController();
			aborted.abort();

			await assert.rejects(getAheadOfBase(repo, 'feature', undefined, aborted.signal), ex =>
				isCancellationError(ex),
			);
		} finally {
			repo.cleanup();
		}
	});
});

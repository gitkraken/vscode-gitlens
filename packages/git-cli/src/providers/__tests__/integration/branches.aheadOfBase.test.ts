import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as sinon from 'sinon';
import type { AheadOfBase } from '@gitlens/git/providers/branches.js';
import { formatDetachedHeadName } from '@gitlens/git/utils/branch.utils.js';
import { isCancellationError } from '@gitlens/utils/cancellation.js';
import type { TestRepo } from './helpers.js';
import {
	addCommit,
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

/** A clone of a fresh origin. `git clone` sets `refs/remotes/origin/HEAD`, so the clone's default branch
 *  resolves from the symref. */
function createClone(): { origin: TestRepo; clone: TestRepo; cleanup: () => void } {
	const origin = createTestRepo();
	let clone: TestRepo;
	try {
		clone = cloneTestRepo(origin.path);
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
			// Cache `develop` as valid, then delete it: the base still resolves, but the count against it fails
			await repo.provider.refs.validateReference(repo.path, 'develop');
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

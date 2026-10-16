import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
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

function getAheadOfBase(repo: TestRepo, branch: string, cancellation?: AbortSignal): Promise<AheadOfBase> {
	return repo.provider.branches.getAheadOfBase(repo.path, branch, cancellation);
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
	});

	suite('base vs its tracking ref', () => {
		test('cuts at the remote fork when the local default branch is stale', async () => {
			const { origin, clone, cleanup } = createClone();
			try {
				addCommit(origin.path, 'origin-only.txt', 'origin', 'origin only');
				fetch(clone.path);
				// Taken off the fetched remote tip; local `main` stays behind at the clone's commit
				createBranchAt(clone.path, 'feature', 'origin/main', { checkout: true });
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
				createBranchAt(clone.path, 'feature', 'origin/main', { checkout: true });
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
				createBranchAt(clone.path, 'feature', 'develop', { checkout: true });
				addCommit(clone.path, 'branch-only.txt', 'feature', 'branch only');

				const result = await getAheadOfBase(clone, 'feature');
				// `develop` and its upstream fork at the same commit, so the tracking ref takes it
				assert.strictEqual(result.base?.ref, 'origin/develop');
				assert.strictEqual(result.base?.ahead, 1);
				assertDependsOn(result, [
					'refs/remotes/origin/HEAD',
					'refs/heads/develop',
					'refs/remotes/origin/develop',
				]);
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
				assertDependsOn(result, ['refs/remotes/origin/HEAD', 'refs/heads/trunk']);
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
			} finally {
				repo.cleanup();
			}
		});
	});

	suite('no base', () => {
		test('never uses a base only the reflog knows', async () => {
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
				assert.ok(!result.dependsOn.includes('refs/heads/develop'));
				// Nor is the reflog's guess written back as the recorded base
				assert.strictEqual(gkConfig(repo.path, 'branch.feature.gk-merge-base'), undefined);
			} finally {
				repo.cleanup();
			}
		});

		test('answers no base on the default branch itself', async () => {
			const repo = createTestRepo();
			try {
				addCommit(repo.path, 'more.txt', 'more', 'more');

				const result = await getAheadOfBase(repo, 'main');
				assert.strictEqual(result.base, undefined);
				assertDependsOn(result, ['refs/heads/main', 'refs/remotes/origin/HEAD']);
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
				assertDependsOn(result, [
					'refs/heads/solo',
					'refs/heads/gone',
					'refs/heads/nope',
					'refs/heads/main',
					'refs/heads/master',
					'refs/remotes/origin/HEAD',
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
				assertDependsOn(result, ['refs/heads/fresh', 'refs/heads/main']);
			} finally {
				repo.cleanup();
			}
		});

		test('answers no base on a detached head', async () => {
			const repo = createCandidateRepo();
			try {
				storeTargets(repo.path, 'feature', { recorded: 'develop' });
				const sha = getHeadSha(repo.path);
				checkout(repo.path, sha);

				assert.deepStrictEqual(await getAheadOfBase(repo, formatDetachedHeadName(sha)), {
					base: undefined,
					dependsOn: [],
				});
				assert.deepStrictEqual(await getAheadOfBase(repo, ''), { base: undefined, dependsOn: [] });
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
			assert.deepStrictEqual(result.base, { ref: 'develop', ahead: 3, sha: revParse(repo.path, 'develop') });
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

			await assert.rejects(getAheadOfBase(repo, 'feature', aborted.signal), ex => isCancellationError(ex));
		} finally {
			repo.cleanup();
		}
	});
});

import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import * as sinon from 'sinon';
import type { RepositoryChange } from '@gitlens/git/models/repository.js';
import type { MergeTarget, MergeTargetOptions } from '@gitlens/git/providers/branches.js';
import { formatDetachedHeadName } from '@gitlens/git/utils/branch.utils.js';
import { CancellationError, isCancellationError } from '@gitlens/utils/cancellation.js';
import { normalizePath } from '@gitlens/utils/path.js';
import type { TestRepo } from './helpers.js';
import {
	addCommit,
	checkout,
	cloneTestRepo,
	createBranch,
	createBranchAt,
	createTestRepo,
	createWorktree,
	fetch,
	gkConfig,
	setConfig,
} from './helpers.js';

// Every fixture is built before the provider's first read of it: no watcher runs here, so a change made after a read
// is only seen once the test reports it the way the watcher would (`reportChange`).

function git(repoPath: string, ...args: string[]): void {
	execFileSync('git', args, { cwd: repoPath, stdio: 'pipe' });
}

function revParse(repoPath: string, ref: string): string {
	return execFileSync('git', ['rev-parse', ref], { cwd: repoPath, encoding: 'utf-8' }).trim();
}

function mergeBase(repoPath: string, ref1: string, ref2: string): string {
	return execFileSync('git', ['merge-base', ref1, ref2], { cwd: repoPath, encoding: 'utf-8' }).trim();
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
 * from and HEAD's reflog names no branch it was checked out from
 */
function createBranchFromDetachedHead(repoPath: string, name: string, startPoint: string): void {
	git(repoPath, 'checkout', '--detach', startPoint);
	git(repoPath, 'checkout', '-b', name);
}

function getMergeTarget(
	repo: TestRepo,
	branch: string,
	options?: MergeTargetOptions,
): Promise<MergeTarget | undefined> {
	return repo.provider.branches.getMergeTarget(repo.path, branch, options);
}

/** Reports a change the way the watcher would; a gk config change is reconciled asynchronously, so that is waited out */
async function reportChange(repo: TestRepo, ...changes: RepositoryChange[]): Promise<void> {
	repo.provider.cache.onRepositoryChanged(normalizePath(repo.path), changes);
	if (changes.includes('gkConfig')) {
		await new Promise(resolve => setTimeout(resolve, 300));
	}
}

/** Waits for a fire-and-forget gk config write to land */
async function waitForGk(repoPath: string, key: string): Promise<string | undefined> {
	for (let i = 0; i < 40; i++) {
		const value = gkConfig(repoPath, key);
		if (value != null) return value;

		await new Promise(resolve => setTimeout(resolve, 50));
	}
	return undefined;
}

/** Gives a fire-and-forget write that shouldn't happen the time it would take to land */
function settle(): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, 300));
}

function pullRequest(
	base: string | undefined,
	options?: { stacked?: boolean },
): () => Promise<{ refs?: { base: { branch: string } }; stack?: unknown }> {
	return () =>
		Promise.resolve({
			refs: base != null ? { base: { branch: base } } : undefined,
			stack: options?.stacked ? { position: 2 } : undefined,
		});
}

/**
 * A host callback that closes over one caller's signal, as each caller's own callbacks do in GitLens: it rejects with a
 * cancellation once that signal fires. `asked` settles when the lookup calls it.
 */
function cancelledWith<T>(signal: AbortSignal): { callback: () => Promise<T>; asked: Promise<void> } {
	let onAsked!: () => void;
	const asked = new Promise<void>(resolve => (onAsked = resolve));
	return {
		callback: () => {
			onAsked();
			if (signal.aborted) return Promise.reject(new CancellationError());

			return new Promise<T>((_, reject) =>
				signal.addEventListener('abort', () => reject(new CancellationError()), { once: true }),
			);
		},
		asked: asked,
	};
}

/** Spies on the uncached spawn path under `Git.run`, which a `run` served from a result cache never reaches */
function spyOnSpawns(repo: TestRepo): sinon.SinonSpy {
	return sinon.spy(repo.provider.git as unknown as { runCore: (...args: unknown[]) => unknown }, 'runCore');
}

function spawnedArgs(spy: sinon.SinonSpy): string[] {
	return spy.getCalls().map(c => (c.args[1] as unknown[]).filter(a => typeof a === 'string').join(' '));
}

/** `feature` on a stack of three candidates, each one commit past the last, each created with `checkout -b` (so from
 *  `HEAD`), then `main` checked out again so nothing is measured from HEAD by accident */
function createCandidateRepo(): TestRepo {
	const repo = createTestRepo();
	for (const branch of ['develop', 'release', 'staging']) {
		createBranch(repo.path, branch, { checkout: true });
		addCommit(repo.path, `${branch}-only.txt`, branch, `${branch} only`);
	}
	createBranch(repo.path, 'feature', { checkout: true });
	addCommit(repo.path, 'branch-only.txt', 'feature', 'branch only');
	checkout(repo.path, 'main');
	return repo;
}

/**
 * A clone of a fresh origin (which also has `develop`, one commit past `main`), with `feature` created from
 * `origin/main`, pushed and tracked
 */
function createClone(): { origin: TestRepo; clone: TestRepo; cleanup: () => void } {
	const origin = createTestRepo();
	let clone: TestRepo | undefined;
	try {
		createBranch(origin.path, 'develop', { checkout: true });
		addCommit(origin.path, 'develop-only.txt', 'develop', 'develop only');
		checkout(origin.path, 'main');

		clone = cloneTestRepo(origin.path);
		createBranchAt(clone.path, 'feature', 'origin/main', { checkout: true });
		addCommit(clone.path, 'branch-only.txt', 'feature', 'branch only');
		git(clone.path, 'push', '-q', '-u', 'origin', 'feature');
		checkout(clone.path, 'main');
	} catch (ex) {
		clone?.cleanup();
		origin.cleanup();
		throw ex;
	}

	const created = clone;
	return {
		origin: origin,
		clone: created,
		cleanup: () => {
			created.cleanup();
			origin.cleanup();
		},
	};
}

/** A fork's clone: local `main` tracks `origin/main`, and an `upstream` remote's `main` is one commit past it */
function createFork(): { origin: TestRepo; clone: TestRepo; cleanup: () => void } {
	const origin = createTestRepo();
	let clone: TestRepo | undefined;
	try {
		clone = cloneTestRepo(origin.path);
		addCommit(origin.path, 'upstream-only.txt', 'upstream', 'upstream only');
		// `origin/main` stays at the clone's commit
		git(clone.path, 'remote', 'add', 'upstream', origin.path);
		fetch(clone.path, 'upstream');
	} catch (ex) {
		clone?.cleanup();
		origin.cleanup();
		throw ex;
	}

	const created = clone;
	return {
		origin: origin,
		clone: created,
		cleanup: () => {
			created.cleanup();
			origin.cleanup();
		},
	};
}

suite('BranchesSubProvider.getMergeTarget', () => {
	suite('candidate order', () => {
		test("answers the user's merge target over every other candidate", async () => {
			const repo = createCandidateRepo();
			try {
				storeTargets(repo.path, 'feature', { user: 'develop', detected: 'release', recorded: 'staging' });

				assert.deepStrictEqual(await getMergeTarget(repo, 'feature'), {
					ref: 'develop',
					forkPoint: revParse(repo.path, 'develop'),
					tier: 'user',
				});
			} finally {
				repo.cleanup();
			}
		});

		test("leaves out the user's merge target with skipUserTarget", async () => {
			const repo = createCandidateRepo();
			try {
				storeTargets(repo.path, 'feature', { user: 'develop', detected: 'release', recorded: 'staging' });

				const target = await getMergeTarget(repo, 'feature', { skipUserTarget: true });
				assert.strictEqual(target?.ref, 'release');
				assert.strictEqual(target?.tier, 'detected');
				// The user's pick is still what an unqualified read answers
				assert.strictEqual((await getMergeTarget(repo, 'feature'))?.tier, 'user');
			} finally {
				repo.cleanup();
			}
		});

		test('answers the recorded base, then the default branch, when no merge target is stored', async () => {
			const recorded = createCandidateRepo();
			const none = createCandidateRepo();
			try {
				storeTargets(recorded.path, 'feature', { recorded: 'staging' });

				assert.deepStrictEqual(await getMergeTarget(recorded, 'feature'), {
					ref: 'staging',
					forkPoint: revParse(recorded.path, 'staging'),
					tier: 'recorded',
				});
				assert.deepStrictEqual(await getMergeTarget(none, 'feature'), {
					ref: 'main',
					forkPoint: revParse(none.path, 'main'),
					tier: 'default',
				});
			} finally {
				none.cleanup();
				recorded.cleanup();
			}
		});

		test('tries a preferred target before every other source, and falls through an unusable one', async () => {
			const repo = createCandidateRepo();
			try {
				storeTargets(repo.path, 'feature', { user: 'develop' });

				assert.deepStrictEqual(await getMergeTarget(repo, 'feature', { preferredTarget: 'release' }), {
					ref: 'release',
					forkPoint: revParse(repo.path, 'release'),
					tier: 'preferred',
				});
				assert.strictEqual((await getMergeTarget(repo, 'feature', { preferredTarget: 'gone' }))?.tier, 'user');
				assert.strictEqual(
					(await getMergeTarget(repo, 'feature', { preferredTarget: 'feature' }))?.tier,
					'user',
				);
			} finally {
				repo.cleanup();
			}
		});

		test('falls through a stored target git confirms is gone, and one that would parse as a flag', async () => {
			const repo = createCandidateRepo();
			try {
				storeTargets(repo.path, 'feature', { user: 'gone', detected: '--output=x', recorded: 'staging' });

				const target = await getMergeTarget(repo, 'feature');
				assert.strictEqual(target?.ref, 'staging');
				assert.strictEqual(target?.tier, 'recorded');
			} finally {
				repo.cleanup();
			}
		});

		test("keeps a stored target whose check couldn't complete, without caching the answer", async () => {
			const repo = createCandidateRepo();
			const check = repo.provider.refs.getSymbolicReferenceNameOrMissing.bind(repo.provider.refs);
			const stub = sinon
				.stub(repo.provider.refs, 'getSymbolicReferenceNameOrMissing')
				.callsFake((path, ref, options, cancellation) =>
					ref === 'unverifiable'
						? Promise.resolve({ name: undefined, missing: false })
						: check(path, ref, options, cancellation),
				);
			try {
				storeTargets(repo.path, 'feature', { user: 'unverifiable', recorded: 'staging' });

				assert.deepStrictEqual(await getMergeTarget(repo, 'feature'), {
					ref: 'unverifiable',
					forkPoint: undefined,
					tier: 'user',
				});
				const checks = stub.getCalls().filter(c => c.args[1] === 'unverifiable').length;
				assert.ok(checks > 0);

				// Taken on no word from git, so asked again rather than served from the cache
				assert.strictEqual((await getMergeTarget(repo, 'feature'))?.ref, 'unverifiable');
				assert.ok(stub.getCalls().filter(c => c.args[1] === 'unverifiable').length > checks);
			} finally {
				stub.restore();
				repo.cleanup();
			}
		});
	});

	suite('pull request', () => {
		test('reads the pull request only when no stored merge target is usable, and ranks it over the recorded base', async () => {
			const { clone, cleanup } = createClone();
			try {
				storeTargets(clone.path, 'feature', { recorded: 'main' });
				let reads = 0;
				const read = pullRequest('develop');
				const getAssociatedPullRequest = (): ReturnType<typeof read> => {
					reads++;
					return read();
				};

				const target = await getMergeTarget(clone, 'feature', {
					getAssociatedPullRequest: getAssociatedPullRequest,
				});
				assert.strictEqual(target?.ref, 'origin/develop');
				assert.strictEqual(target?.tier, 'pr');
				assert.ok(reads > 0);
				await waitForGk(clone.path, 'branch.feature.gk-merge-target');

				const stored = createClone();
				try {
					storeTargets(stored.clone.path, 'feature', { detected: 'main' });
					reads = 0;

					const storedTarget = await getMergeTarget(stored.clone, 'feature', {
						getAssociatedPullRequest: getAssociatedPullRequest,
					});
					assert.strictEqual(storedTarget?.tier, 'detected');
					assert.strictEqual(reads, 0);
				} finally {
					stored.cleanup();
				}
			} finally {
				cleanup();
			}
		});

		test("records a pull request's base as the detected target, never as the user's", async () => {
			const { clone, cleanup } = createClone();
			try {
				const target = await getMergeTarget(clone, 'feature', {
					getAssociatedPullRequest: pullRequest('develop'),
				});
				assert.strictEqual(target?.ref, 'origin/develop');
				assert.strictEqual(target?.tier, 'pr');

				assert.strictEqual(await waitForGk(clone.path, 'branch.feature.gk-merge-target'), 'origin/develop');
				assert.strictEqual(gkConfig(clone.path, 'branch.feature.gk-merge-target-user'), undefined);
			} finally {
				cleanup();
			}
		});

		test("uses a stacked pull request's base without recording it, asking for it again on each read", async () => {
			const { clone, cleanup } = createClone();
			try {
				let reads = 0;
				const read = pullRequest('develop', { stacked: true });
				const options: MergeTargetOptions = {
					getAssociatedPullRequest: () => {
						reads++;
						return read();
					},
				};

				const target = await getMergeTarget(clone, 'feature', options);
				assert.strictEqual(target?.ref, 'origin/develop');
				assert.strictEqual(target?.tier, 'pr');

				const first = reads;
				assert.deepStrictEqual(await getMergeTarget(clone, 'feature', options), target);
				assert.ok(reads > first, 'a stacked base is never stored, so a cached answer asks again');

				await settle();
				assert.strictEqual(gkConfig(clone.path, 'branch.feature.gk-merge-target'), undefined);
				assert.strictEqual(gkConfig(clone.path, 'branch.feature.gk-merge-target-user'), undefined);
			} finally {
				cleanup();
			}
		});

		test("skips a pull request's base whose branch is gone", async () => {
			const { clone, cleanup } = createClone();
			try {
				const target = await getMergeTarget(clone, 'feature', {
					getAssociatedPullRequest: pullRequest('gone'),
				});
				// `feature` was created from `origin/main`
				assert.strictEqual(target?.ref, 'origin/main');
				assert.strictEqual(target?.tier, 'created');

				await settle();
				assert.strictEqual(gkConfig(clone.path, 'branch.feature.gk-merge-target'), undefined);
			} finally {
				cleanup();
			}
		});

		test('answers a caller still waiting when the one whose pull request read it shares gives up', async () => {
			const { clone, cleanup } = createClone();
			try {
				const first = new AbortController();
				const read = cancelledWith<{ refs?: { base: { branch: string } } }>(first.signal);

				const cancelled = clone.provider.branches.getMergeTarget(
					clone.path,
					'feature',
					{ getAssociatedPullRequest: read.callback },
					first.signal,
				);
				const waiting = getMergeTarget(clone, 'feature', { getAssociatedPullRequest: pullRequest(undefined) });
				await read.asked;
				first.abort();

				await assert.rejects(cancelled, ex => isCancellationError(ex));
				const target = await waiting;
				assert.strictEqual(target?.ref, 'origin/main');
				assert.strictEqual(target?.tier, 'created');
			} finally {
				cleanup();
			}
		});
	});

	suite('a candidate vs its tracking ref', () => {
		test('defers a stale local candidate to its fresher upstream', async () => {
			const { origin, clone, cleanup } = createClone();
			try {
				addCommit(origin.path, 'origin-only.txt', 'origin', 'origin only');
				fetch(clone.path);
				// Taken off the fetched remote tip; local `main` stays behind at the clone's commit
				createBranchAt(clone.path, 'topic', 'origin/main', { checkout: true });
				addCommit(clone.path, 'topic-only.txt', 'topic', 'topic only');
				checkout(clone.path, 'main');
				storeTargets(clone.path, 'topic', { recorded: 'main' });

				assert.deepStrictEqual(await getMergeTarget(clone, 'topic'), {
					ref: 'origin/main',
					forkPoint: revParse(clone.path, 'origin/main'),
					tier: 'recorded',
				});
			} finally {
				cleanup();
			}
		});

		test('prefers a local candidate carrying unpushed work the branch forked from', async () => {
			const { clone, cleanup } = createClone();
			try {
				addCommit(clone.path, 'unpushed.txt', 'unpushed', 'unpushed on main');
				createBranch(clone.path, 'topic', { checkout: true });
				addCommit(clone.path, 'topic-only.txt', 'topic', 'topic only');
				checkout(clone.path, 'main');
				storeTargets(clone.path, 'topic', { recorded: 'main' });

				assert.deepStrictEqual(await getMergeTarget(clone, 'topic'), {
					ref: 'main',
					forkPoint: revParse(clone.path, 'main'),
					tier: 'recorded',
				});
			} finally {
				cleanup();
			}
		});

		test('gives a tie to the tracking ref', async () => {
			const { clone, cleanup } = createClone();
			try {
				storeTargets(clone.path, 'feature', { recorded: 'main' });

				const target = await getMergeTarget(clone, 'feature');
				assert.strictEqual(target?.ref, 'origin/main');
				assert.strictEqual(target?.forkPoint, revParse(clone.path, 'main'));
			} finally {
				cleanup();
			}
		});

		test("measures against the upstream remote's copy of the default when the branch forked nearer to it", async () => {
			const { clone, cleanup } = createFork();
			try {
				createBranchFromDetachedHead(clone.path, 'feat', 'upstream/main');
				addCommit(clone.path, 'feat.txt', 'feat', 'feat work');
				checkout(clone.path, 'main');

				assert.deepStrictEqual(await getMergeTarget(clone, 'feat'), {
					ref: 'upstream/main',
					forkPoint: revParse(clone.path, 'upstream/main'),
					tier: 'default',
				});
			} finally {
				cleanup();
			}
		});
	});

	suite('a target that is the branch itself', () => {
		test('answers a local branch that only ends with the same name, at the same commit', async () => {
			const repo = createTestRepo();
			try {
				git(repo.path, 'branch', 'release/main');
				storeTargets(repo.path, 'main', { user: 'release/main' });

				assert.strictEqual((await getMergeTarget(repo, 'main'))?.ref, 'release/main');
			} finally {
				repo.cleanup();
			}
		});

		test('answers nothing for its own copy on a remote at the same commit, unless keepSelfAtTip', async () => {
			const { clone, cleanup } = createClone();
			try {
				storeTargets(clone.path, 'main', { user: 'origin/main' });

				assert.strictEqual(await getMergeTarget(clone, 'main'), undefined);
				assert.deepStrictEqual(await getMergeTarget(clone, 'main', { keepSelfAtTip: true }), {
					ref: 'origin/main',
					forkPoint: revParse(clone.path, 'main'),
					tier: 'user',
				});
			} finally {
				cleanup();
			}
		});

		test('answers its own copy on a remote at a different commit', async () => {
			const { clone, cleanup } = createClone();
			try {
				addCommit(clone.path, 'unpushed.txt', 'unpushed', 'unpushed on main');
				storeTargets(clone.path, 'main', { user: 'origin/main' });

				assert.strictEqual((await getMergeTarget(clone, 'main'))?.ref, 'origin/main');
			} finally {
				cleanup();
			}
		});
	});

	suite('the default branch', () => {
		test('measures the default branch against its own upstream', async () => {
			const { clone, cleanup } = createClone();
			try {
				addCommit(clone.path, 'unpushed.txt', 'unpushed', 'unpushed on main');

				assert.deepStrictEqual(await getMergeTarget(clone, 'main'), {
					ref: 'origin/main',
					forkPoint: revParse(clone.path, 'origin/main'),
					tier: 'upstream',
				});
			} finally {
				cleanup();
			}
		});

		test('answers nothing for the default branch at its upstream, unless keepSelfAtTip', async () => {
			const { clone, cleanup } = createClone();
			try {
				assert.strictEqual(await getMergeTarget(clone, 'main'), undefined);
				assert.deepStrictEqual(await getMergeTarget(clone, 'main', { keepSelfAtTip: true }), {
					ref: 'origin/main',
					forkPoint: revParse(clone.path, 'main'),
					tier: 'upstream',
				});
			} finally {
				cleanup();
			}
		});

		test("prefers an upstream remote's copy of the default branch over its own upstream", async () => {
			const { clone, cleanup } = createFork();
			try {
				addCommit(clone.path, 'unpushed.txt', 'unpushed', 'unpushed on main');

				assert.deepStrictEqual(await getMergeTarget(clone, 'main'), {
					ref: 'upstream/main',
					forkPoint: revParse(clone.path, 'origin/main'),
					tier: 'upstream',
				});
			} finally {
				cleanup();
			}
		});

		test("asks the remote for its default only with defaultBranch: 'remote', when local refs name none", async () => {
			const origin = createTestRepo();
			let clone: TestRepo | undefined;
			try {
				git(origin.path, 'branch', '-m', 'main', 'trunk');
				clone = cloneTestRepo(origin.path);
				git(clone.path, 'remote', 'set-head', 'origin', '-d');
				createBranchFromDetachedHead(clone.path, 'feature', 'origin/trunk');
				addCommit(clone.path, 'branch-only.txt', 'feature', 'branch only');

				assert.strictEqual(await getMergeTarget(clone, 'feature'), undefined);

				assert.deepStrictEqual(await getMergeTarget(clone, 'feature', { defaultBranch: 'remote' }), {
					ref: 'origin/trunk',
					forkPoint: revParse(clone.path, 'origin/trunk'),
					tier: 'default',
				});
			} finally {
				clone?.cleanup();
				origin.cleanup();
			}
		});

		test("takes getFallbackDefaultBranch's remote-qualified answer as its local branch", async () => {
			const origin = createTestRepo();
			let clone: TestRepo | undefined;
			try {
				git(origin.path, 'branch', '-m', 'main', 'trunk');
				clone = cloneTestRepo(origin.path);
				git(clone.path, 'remote', 'set-head', 'origin', '-d');
				addCommit(clone.path, 'unpushed.txt', 'unpushed', 'unpushed on trunk');

				// `trunk` is the default branch, so it measures against its own upstream
				assert.deepStrictEqual(
					await getMergeTarget(clone, 'trunk', {
						getFallbackDefaultBranch: () => Promise.resolve('origin/trunk'),
					}),
					{ ref: 'origin/trunk', forkPoint: revParse(clone.path, 'origin/trunk'), tier: 'upstream' },
				);
			} finally {
				clone?.cleanup();
				origin.cleanup();
			}
		});

		test('asks getFallbackDefaultBranch when git names no default', async () => {
			const repo = createTestRepo();
			try {
				git(repo.path, 'branch', '-m', 'main', 'trunk');
				setConfig(repo.path, 'init.defaultBranch', 'nope');
				createBranch(repo.path, 'feature', { checkout: true });
				addCommit(repo.path, 'branch-only.txt', 'feature', 'branch only');

				assert.strictEqual(await getMergeTarget(repo, 'feature'), undefined);

				const target = await getMergeTarget(repo, 'feature', {
					getFallbackDefaultBranch: () => Promise.resolve('trunk'),
				});
				assert.strictEqual(target?.ref, 'trunk');
				assert.strictEqual(target?.tier, 'default');
			} finally {
				repo.cleanup();
			}
		});

		test('answers a caller still waiting when the one whose getFallbackDefaultBranch it shares gives up', async () => {
			const repo = createTestRepo();
			try {
				git(repo.path, 'branch', '-m', 'main', 'trunk');
				setConfig(repo.path, 'init.defaultBranch', 'nope');
				createBranch(repo.path, 'feature', { checkout: true });
				addCommit(repo.path, 'branch-only.txt', 'feature', 'branch only');

				const first = new AbortController();
				const fallback = cancelledWith<string | undefined>(first.signal);

				const cancelled = repo.provider.branches.getMergeTarget(
					repo.path,
					'feature',
					{ getFallbackDefaultBranch: fallback.callback },
					first.signal,
				);
				const waiting = getMergeTarget(repo, 'feature', {
					getFallbackDefaultBranch: () => Promise.resolve(undefined),
				});
				await fallback.asked;
				first.abort();

				await assert.rejects(cancelled, ex => isCancellationError(ex));
				assert.strictEqual(await waiting, undefined);

				// The failed read isn't kept as the answer
				const target = await getMergeTarget(repo, 'feature', {
					getFallbackDefaultBranch: () => Promise.resolve('trunk'),
				});
				assert.strictEqual(target?.ref, 'trunk');
			} finally {
				repo.cleanup();
			}
		});
	});

	suite('created from', () => {
		test('answers the branch the reflog says it was created from', async () => {
			const repo = createCandidateRepo();
			try {
				git(repo.path, 'switch', '-c', 'topic', 'develop');
				addCommit(repo.path, 'topic-only.txt', 'topic', 'topic only');
				checkout(repo.path, 'main');

				assert.deepStrictEqual(await getMergeTarget(repo, 'topic'), {
					ref: 'develop',
					forkPoint: revParse(repo.path, 'develop'),
					tier: 'created',
				});
			} finally {
				repo.cleanup();
			}
		});

		test('answers a branch created from a full ref by its short name, weighed against its tracking ref', async () => {
			const { clone, cleanup } = createClone();
			try {
				git(clone.path, 'switch', '-c', 'local-topic', 'refs/heads/feature');
				addCommit(clone.path, 'local-topic-only.txt', 'local-topic', 'local topic only');
				git(clone.path, 'switch', '-c', 'remote-topic', 'refs/remotes/origin/develop');
				addCommit(clone.path, 'remote-topic-only.txt', 'remote-topic', 'remote topic only');
				checkout(clone.path, 'main');

				// `feature` is level with `origin/feature`, which takes the tie
				const local = await getMergeTarget(clone, 'local-topic');
				assert.strictEqual(local?.ref, 'origin/feature');
				assert.strictEqual(local?.tier, 'created');

				const remote = await getMergeTarget(clone, 'remote-topic');
				assert.strictEqual(remote?.ref, 'origin/develop');
				assert.strictEqual(remote?.tier, 'created');
			} finally {
				cleanup();
			}
		});

		test('infers the branch HEAD was on when a branch created from HEAD was checked out, only with inferBase, and never records it', async () => {
			const repo = createCandidateRepo();
			try {
				const without = await getMergeTarget(repo, 'feature');
				assert.strictEqual(without?.ref, 'main');
				assert.strictEqual(without?.tier, 'default');

				assert.deepStrictEqual(await getMergeTarget(repo, 'feature', { inferBase: true }), {
					ref: 'staging',
					forkPoint: revParse(repo.path, 'staging'),
					tier: 'inferred',
				});

				await settle();
				assert.strictEqual(gkConfig(repo.path, 'branch.feature.gk-merge-base'), undefined);
			} finally {
				repo.cleanup();
			}
		});

		test("infers whatever the user's grep.patternType", async () => {
			const repo = createCandidateRepo();
			try {
				setConfig(repo.path, 'grep.patternType', 'fixed');

				const target = await getMergeTarget(repo, 'feature', { inferBase: true });
				assert.strictEqual(target?.ref, 'staging');
				assert.strictEqual(target?.tier, 'inferred');
			} finally {
				repo.cleanup();
			}
		});

		test('infers only from checkouts of the branch itself, not of one whose name extends it', async () => {
			const repo = createTestRepo();
			try {
				createBranch(repo.path, 'develop', { checkout: true });
				addCommit(repo.path, 'develop-only.txt', 'develop', 'develop only');
				createBranch(repo.path, 'feature-x', { checkout: true });
				createBranch(repo.path, 'release', { checkout: true });
				addCommit(repo.path, 'release-only.txt', 'release', 'release only');
				createBranch(repo.path, 'feature', { checkout: true });
				addCommit(repo.path, 'branch-only.txt', 'feature', 'branch only');
				checkout(repo.path, 'main');

				const target = await getMergeTarget(repo, 'feature', { inferBase: true });
				assert.strictEqual(target?.ref, 'release');
				assert.strictEqual(target?.tier, 'inferred');
			} finally {
				repo.cleanup();
			}
		});

		test('infers from the HEAD reflog of the linked worktree the branch was created in', async () => {
			const repo = createTestRepo();
			createBranch(repo.path, 'wt-base');
			const worktree = createWorktree(repo.path, 'wt-base');
			try {
				addCommit(worktree.path, 'wt-base-only.txt', 'wt-base', 'wt-base only');
				git(worktree.path, 'checkout', '-b', 'feature');
				addCommit(worktree.path, 'branch-only.txt', 'feature', 'branch only');

				assert.deepStrictEqual(await getMergeTarget(repo, 'feature', { inferBase: true }), {
					ref: 'wt-base',
					forkPoint: revParse(repo.path, 'wt-base'),
					tier: 'inferred',
				});
			} finally {
				worktree.cleanup();
				repo.cleanup();
			}
		});

		test("takes VS Code's recorded base only with inferBase, recording it as GitLens's", async () => {
			const repo = createCandidateRepo();
			try {
				setConfig(repo.path, 'branch.feature.vscode-merge-base', 'release');

				assert.strictEqual((await getMergeTarget(repo, 'feature'))?.tier, 'default');

				const target = await getMergeTarget(repo, 'feature', { inferBase: true });
				assert.strictEqual(target?.ref, 'release');
				assert.strictEqual(target?.tier, 'recorded');
				assert.strictEqual(await waitForGk(repo.path, 'branch.feature.gk-merge-base'), 'release');
			} finally {
				repo.cleanup();
			}
		});
	});

	suite('a remote-tracking branch', () => {
		test('reads no stored targets for it, and measures it from its own tip', async () => {
			const { clone, cleanup } = createClone();
			try {
				storeTargets(clone.path, 'origin/feature', { user: 'origin/develop' });

				assert.deepStrictEqual(await getMergeTarget(clone, 'origin/feature'), {
					ref: 'origin/main',
					forkPoint: revParse(clone.path, 'origin/main'),
					tier: 'default',
				});
			} finally {
				cleanup();
			}
		});

		test("answers its pull request's base without recording it", async () => {
			const { clone, cleanup } = createClone();
			try {
				assert.deepStrictEqual(
					await getMergeTarget(clone, 'origin/feature', { getAssociatedPullRequest: pullRequest('develop') }),
					{ ref: 'origin/develop', forkPoint: revParse(clone.path, 'origin/main'), tier: 'pr' },
				);

				await settle();
				assert.strictEqual(gkConfig(clone.path, 'branch.origin/feature.gk-merge-target'), undefined);
			} finally {
				cleanup();
			}
		});

		test('takes the local branch of its name for itself', async () => {
			const { clone, cleanup } = createClone();
			try {
				assert.strictEqual(await getMergeTarget(clone, 'origin/main'), undefined);
				assert.deepStrictEqual(await getMergeTarget(clone, 'origin/main', { keepSelfAtTip: true }), {
					ref: 'origin/main',
					forkPoint: revParse(clone.path, 'origin/main'),
					tier: 'default',
				});
			} finally {
				cleanup();
			}
		});

		test('takes itself as the default branch when no local branch has its name', async () => {
			const { clone, cleanup } = createClone();
			try {
				checkout(clone.path, 'feature');
				git(clone.path, 'branch', '-D', 'main');

				assert.strictEqual(await getMergeTarget(clone, 'origin/main'), undefined);
				assert.deepStrictEqual(await getMergeTarget(clone, 'origin/main', { keepSelfAtTip: true }), {
					ref: 'origin/main',
					forkPoint: revParse(clone.path, 'origin/main'),
					tier: 'default',
				});
			} finally {
				cleanup();
			}
		});
	});

	suite('cache', () => {
		const gitLensOptions: MergeTargetOptions = {
			getAssociatedPullRequest: pullRequest(undefined),
			getFallbackDefaultBranch: () => Promise.resolve(undefined),
			inferBase: true,
			defaultBranch: 'remote',
			keepSelfAtTip: true,
		};

		test('runs no git command on a warm read', async () => {
			const { clone, cleanup } = createClone();
			try {
				createBranch(clone.path, 'topic');
				storeTargets(clone.path, 'feature', { recorded: 'main' });

				for (const options of [undefined, { skipUserTarget: true }, gitLensOptions]) {
					for (const branch of ['feature', 'topic', 'main']) {
						const first = await getMergeTarget(clone, branch, options);

						const spy = spyOnSpawns(clone);
						try {
							assert.deepStrictEqual(await getMergeTarget(clone, branch, options), first);
							assert.deepStrictEqual(spawnedArgs(spy), [], `${branch} ${JSON.stringify(options)}`);
						} finally {
							spy.restore();
						}
					}
				}
			} finally {
				cleanup();
			}
		});

		test('re-measures nothing when only an unrelated branch moved', async () => {
			const { clone, cleanup } = createClone();
			try {
				createBranch(clone.path, 'unrelated');
				createBranch(clone.path, 'topic');
				storeTargets(clone.path, 'feature', { recorded: 'main' });
				const first = await getMergeTarget(clone, 'feature');
				const firstDefault = await getMergeTarget(clone, 'topic', gitLensOptions);

				git(clone.path, 'branch', '-f', 'unrelated', 'origin/feature');
				await reportChange(clone, 'heads');

				const spy = spyOnSpawns(clone);
				try {
					assert.deepStrictEqual(await getMergeTarget(clone, 'feature'), first);
					assert.deepStrictEqual(await getMergeTarget(clone, 'topic', gitLensOptions), firstDefault);
					// Only the shared reads a ref move clears for every reader, never a merge base or a tracking-ref lookup
					const spawned = spawnedArgs(spy);
					assert.ok(spawned.length > 0, 'the ref list re-read should be seen, or the spy sees nothing');
					assert.ok(
						spawned.every(args => !args.includes('merge-base') && !args.includes('@{u}')),
						spawned.join('\n'),
					);
				} finally {
					spy.restore();
				}
			} finally {
				cleanup();
			}
		});

		test('re-resolves a stale answer once for callers that find it stale together', async () => {
			const repo = createCandidateRepo();
			try {
				storeTargets(repo.path, 'feature', { recorded: 'develop' });
				await getMergeTarget(repo, 'feature');

				git(repo.path, 'branch', '-f', 'develop', 'release');
				await reportChange(repo, 'heads');

				// Identical git commands already join in flight, so the resolutions are counted rather than the spawns
				const resolve = sinon.spy(
					repo.provider.branches as unknown as { resolveMergeTarget: (...args: unknown[]) => unknown },
					'resolveMergeTarget',
				);
				try {
					const answers = await Promise.all([1, 2, 3].map(() => getMergeTarget(repo, 'feature')));
					assert.ok(answers.every(a => a?.ref === 'develop'));
					assert.strictEqual(resolve.callCount, 1);
				} finally {
					resolve.restore();
				}
			} finally {
				repo.cleanup();
			}
		});

		test('serves the cached answer until a ref it read moves', async () => {
			const { clone, cleanup } = createClone();
			try {
				storeTargets(clone.path, 'main', { user: 'origin/main' });
				assert.strictEqual(await getMergeTarget(clone, 'main'), undefined);

				addCommit(clone.path, 'unpushed.txt', 'unpushed', 'unpushed on main');
				// Nothing reported the commit yet, so the cached ref list still has `main` where it was
				assert.strictEqual(await getMergeTarget(clone, 'main'), undefined);

				await reportChange(clone, 'heads');
				assert.strictEqual((await getMergeTarget(clone, 'main'))?.ref, 'origin/main');
			} finally {
				cleanup();
			}
		});

		test('reflects a moved candidate in the fork point', async () => {
			const repo = createCandidateRepo();
			try {
				storeTargets(repo.path, 'feature', { user: 'develop' });
				assert.strictEqual((await getMergeTarget(repo, 'feature'))?.forkPoint, revParse(repo.path, 'develop'));

				git(repo.path, 'branch', '-f', 'develop', 'release');
				await reportChange(repo, 'heads');

				assert.strictEqual((await getMergeTarget(repo, 'feature'))?.forkPoint, revParse(repo.path, 'release'));
			} finally {
				repo.cleanup();
			}
		});

		test('keeps an answer that fell through a gone target, until that target appears', async () => {
			const repo = createCandidateRepo();
			try {
				storeTargets(repo.path, 'feature', { user: 'later', detected: 'develop' });
				assert.strictEqual((await getMergeTarget(repo, 'feature'))?.ref, 'develop');

				const spy = spyOnSpawns(repo);
				try {
					assert.strictEqual((await getMergeTarget(repo, 'feature'))?.ref, 'develop');
					assert.deepStrictEqual(spawnedArgs(spy), []);
				} finally {
					spy.restore();
				}

				git(repo.path, 'branch', 'later', 'release');
				await reportChange(repo, 'heads');

				const target = await getMergeTarget(repo, 'feature');
				assert.strictEqual(target?.ref, 'later');
				assert.strictEqual(target?.tier, 'user');
			} finally {
				repo.cleanup();
			}
		});

		test('reflects a changed stored target once the gk config change is reported', async () => {
			const repo = createCandidateRepo();
			try {
				storeTargets(repo.path, 'feature', { user: 'develop' });
				assert.strictEqual((await getMergeTarget(repo, 'feature'))?.ref, 'develop');

				storeTargets(repo.path, 'feature', { user: 'release' });
				await reportChange(repo, 'gkConfig');

				assert.strictEqual((await getMergeTarget(repo, 'feature'))?.ref, 'release');
			} finally {
				repo.cleanup();
			}
		});

		test('reflects a stored target changed on disk before the reconcile that follows the watcher report runs', async () => {
			const repo = createCandidateRepo();
			try {
				checkout(repo.path, 'feature');
				storeTargets(repo.path, 'feature', { user: 'develop' });
				assert.strictEqual((await getMergeTarget(repo, 'feature'))?.ref, 'develop');
				assert.strictEqual((await repo.provider.branches.getAheadOfBase(repo.path, 'feature')).base?.ahead, 3);

				storeTargets(repo.path, 'feature', { user: 'release' });
				// Only the watcher's synchronous step: the gk config map is dropped, the reconcile hasn't cascaded
				repo.provider.cache.deleteGkConfigMap(normalizePath(repo.path));

				assert.strictEqual((await getMergeTarget(repo, 'feature'))?.ref, 'release');
				const ahead = await repo.provider.branches.getAheadOfBase(repo.path, 'feature');
				assert.strictEqual(ahead.base?.ref, 'release');
				assert.strictEqual(ahead.base?.ahead, 2);
			} finally {
				repo.cleanup();
			}
		});

		test('reflects a stored target written through the provider', async () => {
			const repo = createCandidateRepo();
			try {
				assert.strictEqual((await getMergeTarget(repo, 'feature'))?.ref, 'main');

				await repo.provider.branches.storeUserMergeTargetBranchName?.(repo.path, 'feature', 'staging');

				assert.strictEqual((await getMergeTarget(repo, 'feature'))?.ref, 'staging');
			} finally {
				repo.cleanup();
			}
		});

		test('reflects a tracking change once the config change is reported', async () => {
			const { clone, cleanup } = createClone();
			try {
				addCommit(clone.path, 'unpushed.txt', 'unpushed', 'unpushed on main');
				assert.strictEqual((await getMergeTarget(clone, 'main'))?.ref, 'origin/main');

				git(clone.path, 'branch', '--unset-upstream', 'main');
				await reportChange(clone, 'config', 'remotes');

				// The default branch with no upstream has nothing to be measured against
				assert.strictEqual(await getMergeTarget(clone, 'main'), undefined);
			} finally {
				cleanup();
			}
		});

		test("reads a candidate's tracking anew after a config-only change, which leaves the ref list as it was", async () => {
			const { origin, clone, cleanup } = createClone();
			try {
				addCommit(origin.path, 'origin-only.txt', 'origin', 'origin only');
				fetch(clone.path);
				createBranchAt(clone.path, 'topic', 'origin/main', { checkout: true });
				addCommit(clone.path, 'topic-only.txt', 'topic', 'topic only');
				checkout(clone.path, 'main');
				storeTargets(clone.path, 'topic', { recorded: 'main' });
				assert.strictEqual((await getMergeTarget(clone, 'topic'))?.ref, 'origin/main');

				git(clone.path, 'branch', '--unset-upstream', 'main');
				await reportChange(clone, 'config');

				assert.strictEqual((await getMergeTarget(clone, 'topic'))?.ref, 'main');
			} finally {
				cleanup();
			}
		});

		test('resolves again after a checkout when HEAD reflog had no answer for the inferred base', async () => {
			const repo = createTestRepo();
			try {
				createBranch(repo.path, 'develop', { checkout: true });
				addCommit(repo.path, 'develop-only.txt', 'develop', 'develop only');
				// Created from HEAD, and never checked out yet
				git(repo.path, 'branch', 'feature', 'HEAD');

				assert.strictEqual((await getMergeTarget(repo, 'feature', { inferBase: true }))?.tier, 'default');

				checkout(repo.path, 'feature');
				// A checkout moves no ref, so only the HEAD change it reports evicts the answer
				assert.strictEqual((await getMergeTarget(repo, 'feature', { inferBase: true }))?.tier, 'default');

				await reportChange(repo, 'head');
				assert.deepStrictEqual(await getMergeTarget(repo, 'feature', { inferBase: true }), {
					ref: 'develop',
					forkPoint: revParse(repo.path, 'develop'),
					tier: 'inferred',
				});
			} finally {
				repo.cleanup();
			}
		});

		test('resolves again after a checkout reported only as a worktree change', async () => {
			const repo = createTestRepo();
			try {
				createBranch(repo.path, 'develop', { checkout: true });
				addCommit(repo.path, 'develop-only.txt', 'develop', 'develop only');
				git(repo.path, 'branch', 'feature', 'HEAD');

				assert.strictEqual((await getMergeTarget(repo, 'feature', { inferBase: true }))?.tier, 'default');

				checkout(repo.path, 'feature');
				// What a window hears of a checkout in a worktree it doesn't watch
				await reportChange(repo, 'worktrees', 'worktreeHead');
				assert.strictEqual((await getMergeTarget(repo, 'feature', { inferBase: true }))?.tier, 'inferred');
			} finally {
				repo.cleanup();
			}
		});

		test('reads a fork point again after its merge-base read failed, rather than caching none', async () => {
			const repo = createCandidateRepo();
			const spawner = repo.provider.git as unknown as { runCore: (...args: unknown[]) => Promise<unknown> };
			const stub = sinon.stub(spawner, 'runCore').callsFake(function (this: unknown, ...args: unknown[]) {
				if ((args[1] as string[]).includes('merge-base')) return Promise.reject(new Error('merge-base failed'));

				return stub.wrappedMethod.apply(this, args);
			});
			try {
				storeTargets(repo.path, 'feature', { recorded: 'develop' });

				assert.deepStrictEqual(await getMergeTarget(repo, 'feature'), {
					ref: 'develop',
					forkPoint: undefined,
					tier: 'recorded',
				});

				stub.restore();
				assert.strictEqual(
					(await getMergeTarget(repo, 'feature'))?.forkPoint,
					mergeBase(repo.path, 'feature', 'develop'),
				);
			} finally {
				stub.restore();
				repo.cleanup();
			}
		});

		test('reflects a replace ref that moves the fork point while every tip stands', async () => {
			const repo = createCandidateRepo();
			try {
				// `develop` moves past where `feature` forked from it
				checkout(repo.path, 'develop');
				addCommit(repo.path, 'develop-later.txt', 'develop', 'develop later');
				checkout(repo.path, 'main');
				const forkedAt = mergeBase(repo.path, 'feature', 'develop');
				storeTargets(repo.path, 'feature', { recorded: 'develop' });

				assert.strictEqual((await getMergeTarget(repo, 'feature'))?.forkPoint, forkedAt);

				git(repo.path, 'replace', '--graft', revParse(repo.path, 'feature'), revParse(repo.path, 'develop'));
				await reportChange(repo, 'heads');

				assert.strictEqual((await getMergeTarget(repo, 'feature'))?.forkPoint, revParse(repo.path, 'develop'));
			} finally {
				repo.cleanup();
			}
		});

		test('reflects a deepened shallow clone, which moves the fork point while every tip stands', async () => {
			const origin = createTestRepo();
			let clone: TestRepo | undefined;
			try {
				addCommit(origin.path, 'c2.txt', 'c2', 'c2');
				const c2 = revParse(origin.path, 'HEAD');
				createBranch(origin.path, 'develop', { checkout: true });
				addCommit(origin.path, 'develop-only.txt', 'develop', 'develop only');
				checkout(origin.path, 'main');
				for (const name of ['c3', 'c4', 'c5']) {
					addCommit(origin.path, `${name}.txt`, name, name);
				}

				clone = cloneTestRepo(origin.path, { depth: 1 });
				// As `--no-single-branch` would have, so `origin/develop` is fetched, and deepened, too
				git(clone.path, 'config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*');
				git(clone.path, 'fetch', '-q', '--depth', '1', 'origin');
				createBranchAt(clone.path, 'topic', 'origin/main');
				storeTargets(clone.path, 'topic', { recorded: 'origin/develop' });

				// Where they forked is past the shallow boundary
				assert.deepStrictEqual(await getMergeTarget(clone, 'topic'), {
					ref: 'origin/develop',
					forkPoint: undefined,
					tier: 'recorded',
				});

				git(clone.path, 'fetch', '-q', '--unshallow', 'origin');
				await reportChange(clone, 'heads', 'remotes');

				assert.strictEqual((await getMergeTarget(clone, 'topic'))?.forkPoint, c2);
			} finally {
				clone?.cleanup();
				origin.cleanup();
			}
		});
	});

	test('answers nothing for a detached head or an empty branch name', async () => {
		const repo = createCandidateRepo();
		try {
			assert.strictEqual(await getMergeTarget(repo, ''), undefined);
			assert.strictEqual(
				await getMergeTarget(repo, formatDetachedHeadName(revParse(repo.path, 'HEAD'))),
				undefined,
			);
		} finally {
			repo.cleanup();
		}
	});

	test('answers nothing for a branch that has no ref, without reading again until it has one', async () => {
		const repo = createCandidateRepo();
		try {
			assert.strictEqual(await getMergeTarget(repo, 'later'), undefined);

			const spy = spyOnSpawns(repo);
			try {
				assert.strictEqual(await getMergeTarget(repo, 'later'), undefined);
				assert.deepStrictEqual(spawnedArgs(spy), []);
			} finally {
				spy.restore();
			}

			git(repo.path, 'branch', 'later', 'feature');
			await reportChange(repo, 'heads');

			const target = await getMergeTarget(repo, 'later');
			assert.strictEqual(target?.ref, 'feature');
			assert.strictEqual(target?.tier, 'created');
		} finally {
			repo.cleanup();
		}
	});

	test('rejects when cancelled', async () => {
		const repo = createCandidateRepo();
		try {
			const aborted = new AbortController();
			aborted.abort();

			await assert.rejects(
				repo.provider.branches.getMergeTarget(repo.path, 'feature', undefined, aborted.signal),
				ex => isCancellationError(ex),
			);
		} finally {
			repo.cleanup();
		}
	});
});

suite('BranchesSubProvider.getBaseBranchName', () => {
	function getBaseBranchName(repo: TestRepo, branch: string): Promise<string | undefined> {
		return repo.provider.branches.getBaseBranchName(repo.path, branch);
	}

	test('answers the reflog guess without recording it', async () => {
		const repo = createCandidateRepo();
		try {
			assert.strictEqual(await getBaseBranchName(repo, 'feature'), 'staging');

			await settle();
			assert.strictEqual(gkConfig(repo.path, 'branch.feature.gk-merge-base'), undefined);
		} finally {
			repo.cleanup();
		}
	});

	test("records VS Code's recorded base as GitLens's", async () => {
		const repo = createCandidateRepo();
		try {
			setConfig(repo.path, 'branch.feature.vscode-merge-base', 'release');

			assert.strictEqual(await getBaseBranchName(repo, 'feature'), 'release');
			assert.strictEqual(await waitForGk(repo.path, 'branch.feature.gk-merge-base'), 'release');
		} finally {
			repo.cleanup();
		}
	});

	test('falls through a recorded base git confirms is gone, without overwriting it', async () => {
		const repo = createCandidateRepo();
		try {
			storeTargets(repo.path, 'feature', { recorded: 'gone' });

			assert.strictEqual(await getBaseBranchName(repo, 'feature'), 'staging');

			await settle();
			assert.strictEqual(gkConfig(repo.path, 'branch.feature.gk-merge-base'), 'gone');
		} finally {
			repo.cleanup();
		}
	});

	test("keeps a recorded base whose check couldn't complete", async () => {
		const repo = createCandidateRepo();
		const check = repo.provider.refs.getSymbolicReferenceNameOrMissing.bind(repo.provider.refs);
		const stub = sinon
			.stub(repo.provider.refs, 'getSymbolicReferenceNameOrMissing')
			.callsFake((path, ref, options, cancellation) =>
				ref === 'unverifiable'
					? Promise.resolve({ name: undefined, missing: false })
					: check(path, ref, options, cancellation),
			);
		try {
			storeTargets(repo.path, 'feature', { recorded: 'unverifiable' });

			assert.strictEqual(await getBaseBranchName(repo, 'feature'), 'unverifiable');
		} finally {
			stub.restore();
			repo.cleanup();
		}
	});

	test('reads the checkout from the HEAD reflog of the linked worktree the branch is checked out in', async () => {
		const repo = createTestRepo();
		createBranch(repo.path, 'wt-base');
		const worktree = createWorktree(repo.path, 'wt-base');
		try {
			addCommit(worktree.path, 'wt-base-only.txt', 'wt-base', 'wt-base only');
			git(worktree.path, 'checkout', '-b', 'feature');
			addCommit(worktree.path, 'branch-only.txt', 'feature', 'branch only');

			assert.strictEqual(await getBaseBranchName(repo, 'feature'), 'wt-base');
		} finally {
			worktree.cleanup();
			repo.cleanup();
		}
	});
});

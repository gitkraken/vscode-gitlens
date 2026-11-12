import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LogChannel } from '@gitlens/utils/logger.js';
import type { TestRepo } from './helpers.js';
import { addCommit, cloneTestRepo, createBranch, createProvider, createTestRepo, setUpstream } from './helpers.js';

/**
 * Some reads are answered "no" by a git exit code the caller declared expected (`merge-base --fork-point` has no
 * fork point, `rev-parse … <branch>@{u}` has no upstream, both exit 1). That answer is kept like a found one, until a
 * change that can alter it is reported. Each git process that finishes logs one `… • completed` line, or a `… • FAILED` one,
 * through `gitOptions.logger`.
 */
suite('Cached git reads keep an answer given by an expected exit code', () => {
	const completed: string[] = [];
	const countingLogger: LogChannel = {
		name: 'spawn-counter',
		logLevel: 0,
		dispose: () => {},
		trace: () => {},
		debug: () => {},
		info: (msg: string) => {
			if (msg.includes('• completed')) {
				completed.push(msg);
			}
		},
		warn: () => {},
		error: (msg: string) => {
			if (msg.includes('\u2022 FAILED')) {
				completed.push(msg);
			}
		},
	};

	const cleanups: (() => void)[] = [];

	teardown(() => {
		while (cleanups.length) {
			cleanups.pop()!();
		}
	});

	async function launchesDuring(command: string, read: () => Promise<unknown>): Promise<number> {
		const mark = completed.length;
		await read();
		return completed.slice(mark).filter(line => line.includes(command)).length;
	}

	function git(repoPath: string, ...args: string[]): void {
		execFileSync('git', args, { cwd: repoPath, stdio: 'pipe' });
	}

	suite('a branch with no fork point', () => {
		type BranchesInternals = {
			readMergeBase(
				repoPath: string,
				ref1: string,
				ref2: string,
				forkPoint: boolean,
				reads: { priority: undefined; pinnable: boolean },
				cancellation: AbortSignal | undefined,
			): Promise<string | undefined>;
		};

		/** A repository whose checked-out `other` shares no history with `main`, so there is no fork point */
		function createUnrelatedRepo(): TestRepo {
			const repo = createTestRepo({ gitOptions: { logger: countingLogger } });
			cleanups.push(repo.cleanup);
			git(repo.path, 'checkout', '--orphan', 'other');
			addCommit(repo.path, 'other.txt', 'other', 'Unrelated');
			return repo;
		}

		function readForkPoint(repo: TestRepo): Promise<string | undefined> {
			return (repo.provider.branches as unknown as BranchesInternals).readMergeBase(
				repo.path,
				'main',
				'HEAD',
				true,
				{ priority: undefined, pinnable: true },
				undefined,
			);
		}

		test('is read once, then answered from the cache', async () => {
			const repo = createUnrelatedRepo();

			assert.strictEqual(
				await launchesDuring('merge-base --fork-point', async () =>
					assert.strictEqual(await readForkPoint(repo), undefined),
				),
				1,
			);
			assert.strictEqual(
				await launchesDuring('merge-base --fork-point', async () =>
					assert.strictEqual(await readForkPoint(repo), undefined),
				),
				0,
			);
		});

		test('is read again, and can answer differently, once a ref move is reported', async () => {
			const repo = createUnrelatedRepo();
			assert.strictEqual(await readForkPoint(repo), undefined);

			// `main` now points at the commit HEAD is on, so that commit is its fork point
			git(repo.path, 'branch', '-f', 'main', 'other');
			assert.strictEqual(
				await launchesDuring('merge-base --fork-point', async () =>
					assert.strictEqual(await readForkPoint(repo), undefined),
				),
				0,
				'nothing has been reported yet',
			);

			repo.provider.cache.onRepositoryChanged(repo.path, ['heads']);

			let found: string | undefined;
			assert.strictEqual(
				await launchesDuring('merge-base --fork-point', async () => {
					found = await readForkPoint(repo);
				}),
				1,
			);
			assert.strictEqual(
				found,
				execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.path, encoding: 'utf-8' }).trim(),
			);
		});

		test('is not kept when git failed rather than answered', async () => {
			const repo = createUnrelatedRepo();

			const read = () =>
				(repo.provider.branches as unknown as BranchesInternals).readMergeBase(
					repo.path,
					'no-such-ref',
					'HEAD',
					true,
					{ priority: undefined, pinnable: true },
					undefined,
				);

			assert.strictEqual(await launchesDuring('merge-base --fork-point', read), 1);
			assert.strictEqual(await launchesDuring('merge-base --fork-point', read), 1);
		});
	});

	suite('a branch with no upstream', () => {
		/** A clone whose `feature` branch has no upstream */
		function createCloneWithoutUpstream(): TestRepo {
			const origin = createTestRepo();
			cleanups.push(origin.cleanup);
			const clone = cloneTestRepo(origin.path, { gitOptions: { logger: countingLogger } });
			cleanups.push(clone.cleanup);
			createBranch(clone.path, 'feature');
			return clone;
		}

		test('is read once, then answered from the cache, and still reads as missing', async () => {
			const clone = createCloneWithoutUpstream();
			const read = () => clone.provider.refs.getSymbolicReferenceNameOrMissing(clone.path, 'feature@{u}');

			assert.strictEqual(
				await launchesDuring('--symbolic-full-name', async () =>
					assert.deepStrictEqual(await read(), { name: undefined, missing: true }),
				),
				1,
			);
			assert.strictEqual(
				await launchesDuring('--symbolic-full-name', async () =>
					assert.deepStrictEqual(await read(), { name: undefined, missing: true }),
				),
				0,
			);
			assert.strictEqual(
				await clone.provider.refs.getSymbolicReferenceName(clone.path, 'feature@{u}'),
				undefined,
			);
		});

		test('is read again, and finds the upstream, once a config change is reported', async () => {
			const clone = createCloneWithoutUpstream();
			assert.strictEqual(
				await clone.provider.refs.getSymbolicReferenceName(clone.path, 'feature@{u}'),
				undefined,
			);

			setUpstream(clone.path, 'feature', 'origin/main');
			assert.strictEqual(
				await clone.provider.refs.getSymbolicReferenceName(clone.path, 'feature@{u}'),
				undefined,
				'nothing has been reported yet',
			);

			clone.provider.cache.onRepositoryChanged(clone.path, ['config']);

			assert.strictEqual(
				await launchesDuring('--symbolic-full-name', async () =>
					assert.strictEqual(
						await clone.provider.refs.getSymbolicReferenceName(clone.path, 'feature@{u}'),
						'origin/main',
					),
				),
				1,
			);
			assert.strictEqual(
				await launchesDuring('--symbolic-full-name', async () =>
					assert.strictEqual(
						await clone.provider.refs.getSymbolicReferenceName(clone.path, 'feature@{u}'),
						'origin/main',
					),
				),
				0,
			);
		});

		test('is also kept for a ref that does not exist', async () => {
			const clone = createCloneWithoutUpstream();
			const read = () => clone.provider.refs.getSymbolicReferenceNameOrMissing(clone.path, 'no-such-branch');

			assert.strictEqual(
				await launchesDuring('--symbolic-full-name', async () =>
					assert.deepStrictEqual(await read(), { name: undefined, missing: true }),
				),
				1,
			);
			assert.strictEqual(await launchesDuring('--symbolic-full-name', read), 0);
		});

		test('is not kept for a directory that is not a repository, which is not reported missing', async () => {
			const dir = realpathSync(mkdtempSync(join(tmpdir(), 'gitlens-not-a-repo-')));
			const provider = createProvider({ gitOptions: { logger: countingLogger } });
			cleanups.push(() => {
				provider.dispose();
				rmSync(dir, { recursive: true, force: true });
			});
			const read = () => provider.refs.getSymbolicReferenceNameOrMissing(dir, 'main@{u}');

			assert.strictEqual(
				await launchesDuring('--symbolic-full-name', async () =>
					assert.deepStrictEqual(await read(), { name: undefined, missing: false }),
				),
				1,
			);
			assert.strictEqual(await launchesDuring('--symbolic-full-name', read), 1);
		});
	});
});

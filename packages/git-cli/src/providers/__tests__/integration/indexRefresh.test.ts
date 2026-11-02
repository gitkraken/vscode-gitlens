import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizePath } from '@gitlens/utils/path.js';
import type { TestRepo } from './helpers.js';
import { addCommit, cloneTestRepo, createBranch, createStash, createTestRepo, getHeadSha } from './helpers.js';

function git(cwd: string, ...args: string[]): string {
	return execFileSync('git', args, { cwd: cwd, encoding: 'utf-8', stdio: 'pipe' });
}

/** The whole second of each index entry's modified time, by path */
function entrySeconds(cwd: string): Map<string, number> {
	const seconds = new Map<string, number>();
	let path: string | undefined;
	for (const line of git(cwd, 'ls-files', '--debug').split('\n')) {
		const mtime = /^\s+mtime: (\d+):\d+/.exec(line)?.[1];
		if (mtime != null && path != null) {
			seconds.set(path, Number(mtime));
		} else if (line && !line.startsWith(' ')) {
			path = line;
		}
	}
	return seconds;
}

function indexMtimeMs(cwd: string): number {
	return statSync(join(cwd, '.git', 'index')).mtimeMs;
}

/** Git calls an entry racily clean when its second is not earlier than the index file's */
function racyEntries(cwd: string): string[] {
	const indexSecond = Math.floor(indexMtimeMs(cwd) / 1000);
	return [...entrySeconds(cwd)].filter(([, second]) => second >= indexSecond).map(([path]) => path);
}

suite('Index refresh', () => {
	suite('racily clean index', () => {
		let repo: TestRepo;

		suiteSetup(() => {
			repo = createTestRepo();
		});

		suiteTeardown(() => {
			repo.cleanup();
		});

		test('a read-only diff leaves the index as it was, and scheduleIndexRefresh makes every entry trusted', async () => {
			// Every file and the index file are stamped ten seconds back, so the refresh runs on the real clock with no wait
			const past = new Date(Date.now() - 10_000);
			const pastSecond = Math.floor(past.getTime() / 1000);
			const names = ['racy-1.txt', 'racy-2.txt', 'racy-3.txt'];
			for (const name of names) {
				writeFileSync(join(repo.path, name), `${name}\n`);
				utimesSync(join(repo.path, name), past, past);
			}
			utimesSync(join(repo.path, 'README.md'), past, past);
			git(repo.path, 'add', ...names);
			git(repo.path, 'commit', '-q', '-m', 'racy files');
			git(repo.path, 'update-index', '--refresh');
			const indexPath = join(repo.path, '.git', 'index');
			utimesSync(indexPath, past, past);
			const stamped = indexMtimeMs(repo.path);

			assert.deepStrictEqual(racyEntries(repo.path).sort(), ['README.md', ...names].sort());

			execFileSync('git', ['diff', '--quiet', 'HEAD'], {
				cwd: repo.path,
				env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
			});
			assert.strictEqual(indexMtimeMs(repo.path), stamped, 'a read-only diff must not write the index');
			assert.strictEqual(racyEntries(repo.path).length, names.length + 1);

			repo.provider.ops.scheduleIndexRefresh(repo.path);
			await repo.provider.indexRefresher.pending(repo.path);

			assert.ok(Math.floor(indexMtimeMs(repo.path) / 1000) > pastSecond, 'the index was rewritten');
			assert.deepStrictEqual(racyEntries(repo.path), []);
		});
	});

	suite('after a write', () => {
		let repo: TestRepo;
		let worktreeParent: string | undefined;
		/** The refresher's clock, fixed before anything is written so that nothing waits in real time */
		let nowMs: number;
		/** The wait the refresher asked for, the first time it asked */
		let timerRequested: Promise<number>;

		setup(() => {
			nowMs = Date.now();
			let requested: (ms: number) => void;
			timerRequested = new Promise(resolve => (requested = resolve));
			repo = createTestRepo({
				refreshIndexAfterWrites: true,
				indexRefresh: {
					now: () => nowMs,
					setTimer: (_fn, ms) => {
						requested(ms);
						return () => {};
					},
				},
			});
		});

		teardown(() => {
			repo.cleanup();
			if (worktreeParent != null) {
				rmSync(worktreeParent, { recursive: true, force: true });
				worktreeParent = undefined;
			}
		});

		/** Leaves the index older than the second the next write starts in, and every entry trusted */
		function settleIndex(): void {
			const past = new Date(Date.now() - 10_000);
			for (const name of git(repo.path, 'ls-files').split('\n').filter(Boolean)) {
				utimesSync(join(repo.path, name), past, past);
			}
			git(repo.path, 'update-index', '--refresh');
			ageIndex();
		}

		/** Leaves the index older than the second the next write starts in, which doesn't need it to be clean */
		function ageIndex(): void {
			const earlier = new Date(Date.now() - 5000);
			utimesSync(join(repo.path, '.git', 'index'), earlier, earlier);
		}

		/** Edits README.md differently on `main` and on `other`, leaving `main` checked out */
		function divergeReadme(): void {
			createBranch(repo.path, 'other');
			git(repo.path, 'checkout', '-q', 'other');
			addCommit(repo.path, 'README.md', '# Test Repository\nother edit\n', 'other edit');
			git(repo.path, 'checkout', '-q', 'main');
			addCommit(repo.path, 'README.md', '# Test Repository\nmain edit\n', 'main edit');
		}

		test('createWorktree schedules a refresh of the new worktree, waiting for the clock to pass its index', async () => {
			worktreeParent = mkdtempSync(join(tmpdir(), 'gitlens-index-refresh-'));
			const worktreePath = join(worktreeParent, 'wt');

			await repo.provider.worktrees.createWorktree(repo.path, worktreePath, { createBranch: 'feature' });

			assert.ok(repo.provider.indexRefresher.pending(worktreePath), 'the new worktree is queued');
			assert.strictEqual(repo.provider.indexRefresher.pending(repo.path), undefined);
			const waitMs = await timerRequested;
			assert.ok(waitMs > 0 && waitMs <= 1000, `waits for the next second, asked for ${waitMs}ms`);
		});

		test('a refused createWorktree leaves its path unresolved, so a later add there still schedules a refresh', async () => {
			// Inside the main checkout, where a git dir resolved for the missing worktree would be found by walking up
			const worktreePath = join(repo.path, '.worktrees', 'wt');

			// `main` is checked out in the main worktree, so git refuses to add it again
			await assert.rejects(
				repo.provider.worktrees.createWorktree(repo.path, worktreePath, { commitish: 'main' }),
			);
			assert.strictEqual(repo.provider.indexRefresher.pending(worktreePath), undefined);
			assert.strictEqual(repo.provider.cache.gitDir.get(normalizePath(worktreePath)), undefined);

			await repo.provider.worktrees.createWorktree(repo.path, worktreePath, { createBranch: 'feature' });
			assert.ok(repo.provider.indexRefresher.pending(worktreePath), 'the new worktree is queued');
		});

		test('checkout schedules a refresh when it rewrote files', async () => {
			createBranch(repo.path, 'other');
			git(repo.path, 'checkout', '-q', 'other');
			addCommit(repo.path, 'only-on-other.txt', 'other\n', 'on other');
			git(repo.path, 'checkout', '-q', 'main');
			settleIndex();

			await repo.provider.ops.checkout(repo.path, 'other');
			assert.ok(repo.provider.indexRefresher.pending(repo.path), 'a file was written');
		});

		test('clone schedules a refresh of the clone', async () => {
			worktreeParent = mkdtempSync(join(tmpdir(), 'gitlens-index-refresh-'));

			const clonePath = await repo.provider.clone(repo.path, worktreeParent, { folderName: 'cloned' });

			assert.ok(clonePath);
			assert.ok(repo.provider.indexRefresher.pending(clonePath));
			await timerRequested;
		});

		test('merge schedules a refresh when it rewrote files, and none when already up to date', async () => {
			createBranch(repo.path, 'other');
			git(repo.path, 'checkout', '-q', 'other');
			addCommit(repo.path, 'only-on-other.txt', 'other\n', 'on other');
			git(repo.path, 'checkout', '-q', 'main');
			settleIndex();

			await repo.provider.ops.merge(repo.path, 'main');
			assert.strictEqual(repo.provider.indexRefresher.pending(repo.path), undefined, 'already up to date');

			await repo.provider.ops.merge(repo.path, 'other');
			assert.ok(repo.provider.indexRefresher.pending(repo.path), 'the fast-forward wrote a file');
		});

		test('reset schedules a refresh when it rewrote files, and none when it left the index alone', async () => {
			addCommit(repo.path, 'second.txt', 'second\n', 'second');
			settleIndex();

			await repo.provider.ops.reset(repo.path, 'HEAD', { mode: 'soft' });
			assert.strictEqual(repo.provider.indexRefresher.pending(repo.path), undefined, 'a soft reset');

			await repo.provider.ops.reset(repo.path, 'HEAD~1', { mode: 'hard' });
			assert.ok(repo.provider.indexRefresher.pending(repo.path), 'a hard reset removed a file');
		});

		test('pull schedules a refresh when it fast-forwarded, and none when already up to date', async () => {
			const clone = cloneTestRepo(repo.path, {
				refreshIndexAfterWrites: true,
				indexRefresh: { now: () => nowMs, setTimer: () => () => {} },
			});
			try {
				const settle = new Date(Date.now() - 10_000);
				for (const name of git(clone.path, 'ls-files').split('\n').filter(Boolean)) {
					utimesSync(join(clone.path, name), settle, settle);
				}
				git(clone.path, 'update-index', '--refresh');
				const earlier = new Date(Date.now() - 5000);
				utimesSync(join(clone.path, '.git', 'index'), earlier, earlier);

				await clone.provider.ops.pull(clone.path);
				assert.strictEqual(clone.provider.indexRefresher.pending(clone.path), undefined, 'already up to date');

				addCommit(repo.path, 'pulled.txt', 'pulled\n', 'new upstream commit');
				await clone.provider.ops.pull(clone.path);
				assert.ok(clone.provider.indexRefresher.pending(clone.path), 'the fast-forward wrote a file');
			} finally {
				clone.cleanup();
			}
		});

		test('a failed write schedules nothing', async () => {
			settleIndex();

			await assert.rejects(repo.provider.ops.checkout(repo.path, 'no-such-branch'));
			assert.strictEqual(repo.provider.indexRefresher.pending(repo.path), undefined);
		});

		test('a merge that stops on a conflict still schedules a refresh', async () => {
			divergeReadme();
			settleIndex();

			const result = await repo.provider.ops.merge(repo.path, 'other', { fastForward: false });

			assert.strictEqual(result.conflicted, true);
			assert.ok(repo.provider.indexRefresher.pending(repo.path), 'the stopped merge rewrote the index');
		});

		test('cherryPick schedules a refresh when it rewrote files', async () => {
			createBranch(repo.path, 'other');
			git(repo.path, 'checkout', '-q', 'other');
			addCommit(repo.path, 'only-on-other.txt', 'other\n', 'on other');
			const sha = getHeadSha(repo.path);
			git(repo.path, 'checkout', '-q', 'main');
			settleIndex();

			await repo.provider.ops.cherryPick(repo.path, [sha]);

			assert.ok(repo.provider.indexRefresher.pending(repo.path), 'a file was written');
		});

		test('revert schedules a refresh when it rewrote files', async () => {
			addCommit(repo.path, 'second.txt', 'second\n', 'second');
			settleIndex();

			await repo.provider.ops.revert(repo.path, ['HEAD'], { editMessage: false });

			assert.ok(repo.provider.indexRefresher.pending(repo.path), 'the file was removed');
		});

		test('applyStash schedules a refresh', async () => {
			createStash(repo.path, 'saved');
			settleIndex();

			await repo.provider.stash.applyStash(repo.path, 'stash@{0}');

			assert.ok(repo.provider.indexRefresher.pending(repo.path), 'the apply rewrote the index');
		});

		test('rebase schedules a refresh when it rewrote files', async () => {
			createBranch(repo.path, 'feature');
			git(repo.path, 'checkout', '-q', 'feature');
			addCommit(repo.path, 'on-feature.txt', 'feature\n', 'on feature');
			git(repo.path, 'checkout', '-q', 'main');
			addCommit(repo.path, 'on-main.txt', 'main\n', 'on main');
			git(repo.path, 'checkout', '-q', 'feature');
			settleIndex();

			await repo.provider.ops.rebase(repo.path, 'main');

			assert.ok(repo.provider.indexRefresher.pending(repo.path), 'the replay wrote on-main.txt');
		});

		test('restore schedules a refresh when it put a modified file back', async () => {
			writeFileSync(join(repo.path, 'README.md'), 'modified\n');
			// `update-index --refresh` exits 1 for a modified file, so only age the index
			ageIndex();

			await repo.provider.ops.restore(repo.path, 'README.md');

			assert.ok(repo.provider.indexRefresher.pending(repo.path), 'the file was rewritten');
		});

		test('saveStash schedules a refresh when it put a modified file back', async () => {
			writeFileSync(join(repo.path, 'README.md'), 'modified\n');
			// `update-index --refresh` exits 1 for a modified file, so only age the index
			ageIndex();

			await repo.provider.stash.saveStash(repo.path, 'saved');

			assert.ok(repo.provider.indexRefresher.pending(repo.path), 'the file was reset to HEAD');
		});

		test('continuePausedOperation schedules a refresh when it finished a conflicted step', async () => {
			divergeReadme();
			git(repo.path, 'checkout', '-q', 'other');
			assert.throws(() => git(repo.path, 'rebase', 'main'));
			writeFileSync(join(repo.path, 'README.md'), '# Test Repository\nresolved\n');
			git(repo.path, 'add', 'README.md');
			ageIndex();

			await repo.provider.pausedOps.continuePausedOperation(repo.path, { messageEditor: 'true' });

			assert.ok(repo.provider.indexRefresher.pending(repo.path), 'the continued step rewrote the index');
		});

		test('abortPausedOperation schedules a refresh when it put the files back', async () => {
			divergeReadme();
			assert.throws(() => git(repo.path, 'merge', '--no-ff', 'other'));
			ageIndex();

			await repo.provider.pausedOps.abortPausedOperation(repo.path);

			assert.ok(repo.provider.indexRefresher.pending(repo.path), 'the abort reset the conflicted file');
		});
	});

	suite('by default', () => {
		test("core's own writes schedule no refresh", async () => {
			const repo = createTestRepo({ indexRefresh: { now: () => Date.now(), setTimer: () => () => {} } });
			const worktreeParent = mkdtempSync(join(tmpdir(), 'gitlens-index-refresh-'));
			try {
				const worktreePath = join(worktreeParent, 'wt');
				await repo.provider.worktrees.createWorktree(repo.path, worktreePath, { createBranch: 'feature' });
				assert.strictEqual(repo.provider.indexRefresher.pending(worktreePath), undefined);

				createBranch(repo.path, 'other');
				git(repo.path, 'checkout', '-q', 'other');
				addCommit(repo.path, 'only-on-other.txt', 'other\n', 'on other');
				git(repo.path, 'checkout', '-q', 'main');
				await repo.provider.ops.checkout(repo.path, 'other');
				assert.strictEqual(repo.provider.indexRefresher.pending(repo.path), undefined);

				createBranch(repo.path, 'picked');
				git(repo.path, 'checkout', '-q', 'picked');
				addCommit(repo.path, 'picked.txt', 'picked\n', 'to pick');
				const sha = getHeadSha(repo.path);
				git(repo.path, 'checkout', '-q', 'main');
				await repo.provider.ops.cherryPick(repo.path, [sha]);
				assert.strictEqual(repo.provider.indexRefresher.pending(repo.path), undefined);

				repo.provider.ops.scheduleIndexRefresh(repo.path);
				assert.ok(repo.provider.indexRefresher.pending(repo.path), 'a host can still ask for one');
			} finally {
				repo.provider.indexRefresher.dispose();
				repo.cleanup();
				rmSync(worktreeParent, { recursive: true, force: true });
			}
		});
	});
});

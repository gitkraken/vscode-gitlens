import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import {
	existsSync,
	promises as fs,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as sinon from 'sinon';
import type { GitResult, GitRunOptions } from '@gitlens/git/run.types.js';
import { normalizePath } from '@gitlens/utils/path.js';
import { fileUri } from '@gitlens/utils/uri.js';
import type { TestRepo } from './helpers.js';
import { createBranch, createProvider, createTestRepo, createWorktree, gkConfig } from './helpers.js';

suite('ConfigSubProvider', () => {
	let repo: TestRepo;

	suiteSetup(() => {
		repo = createTestRepo();
	});

	suiteTeardown(() => {
		repo.cleanup();
	});

	test('getConfig reads user.name', async () => {
		const value = await repo.provider.config.getConfig(repo.path, 'user.name');
		assert.strictEqual(value, 'Test User');
	});

	test('getConfig reads user.email', async () => {
		const value = await repo.provider.config.getConfig(repo.path, 'user.email');
		assert.strictEqual(value, 'test@gitlens.test');
	});

	test('getConfig returns undefined for unset keys', async () => {
		const value = await repo.provider.config.getConfig(repo.path, 'gitlens.nonexistent.key' as any);
		assert.strictEqual(value, undefined);
	});

	test('getRepositoryInfo resolves repo root + gitDir for the repo path', async () => {
		const info = await repo.provider.config.getRepositoryInfo(repo.path);
		assert.ok(info != null && !Array.isArray(info), 'should resolve to rich object shape');
		assert.strictEqual(info.repoPath, normalizePath(repo.path));
		assert.strictEqual(info.gitDir, normalizePath(join(repo.path, '.git')));
		assert.strictEqual(info.commonGitDir, undefined);
		assert.strictEqual(info.superprojectPath, undefined);
	});

	test('getRepositoryInfo returns [] for a non-git directory', async () => {
		const outside = mkdtempSync(join(tmpdir(), 'gitlens-test-nonrepo-'));
		try {
			const info = await repo.provider.config.getRepositoryInfo(outside);
			assert.deepStrictEqual(info, []);
		} finally {
			rmSync(outside, { recursive: true, force: true });
		}
	});
});

suite('ConfigSubProvider — gk branch sections', () => {
	let repo: TestRepo;

	setup(() => {
		repo = createTestRepo();
	});

	teardown(() => {
		repo.cleanup();
	});

	async function setBase(ref: string, value: string): Promise<void> {
		await repo.provider.config.setGkConfig(repo.path, `branch.${ref}.gk-merge-base`, value);
	}

	function readBase(ref: string): Promise<string | undefined> {
		return repo.provider.config.getGkConfig(repo.path, `branch.${ref}.gk-merge-base`);
	}

	test("removeGkConfigBranchSection drops that ref's gk keys and leaves siblings alone", async () => {
		await setBase('doomed', 'origin/doomed-base');
		await setBase('keeper', 'origin/keeper-base');

		await repo.provider.config.removeGkConfigBranchSection(repo.path, 'doomed');

		assert.strictEqual(await readBase('doomed'), undefined, 'the removed ref must have no stored base');
		assert.strictEqual(await readBase('keeper'), 'origin/keeper-base', 'siblings must be untouched');
	});

	test('removeGkConfigBranchSection is a no-op for a ref that has no gk keys', async () => {
		await setBase('keeper', 'origin/keeper-base');

		await repo.provider.config.removeGkConfigBranchSection(repo.path, 'never-had-metadata');

		assert.strictEqual(await readBase('keeper'), 'origin/keeper-base');
	});

	test('renameGkConfigBranchSection moves the stored base to the new name', async () => {
		await setBase('old', 'origin/from-old');

		await repo.provider.config.renameGkConfigBranchSection(repo.path, 'old', 'new');

		assert.strictEqual(await readBase('new'), 'origin/from-old');
		assert.strictEqual(await readBase('old'), undefined, 'the old name must not keep the metadata');
	});

	test('renaming onto an orphaned destination yields the source value, not the orphan', async () => {
		// An earlier branch called `new` left its base behind; `git config --rename-section` APPENDS onto an
		// existing section, and git resolves a duplicated key to its LAST value — so without clearing the
		// destination first the orphan wins.
		await setBase('old', 'origin/from-old');
		await setBase('new', 'origin/STALE-ORPHAN');

		await repo.provider.config.renameGkConfigBranchSection(repo.path, 'old', 'new');

		assert.strictEqual(await readBase('new'), 'origin/from-old');
	});

	test('renaming a source with no gk keys still clears an orphaned destination', async () => {
		await setBase('new', 'origin/STALE-ORPHAN');

		await repo.provider.config.renameGkConfigBranchSection(repo.path, 'old-without-metadata', 'new');

		assert.strictEqual(await readBase('new'), undefined, 'the orphan must not survive for the renamed branch');
	});

	test('a RESOLVED bulk-read failure still removes the section', async () => {
		// The shape the swallow test can't reach: `errors: 'ignore'` makes a failed bulk read RESOLVE an
		// empty map rather than throw. The cache refuses to store it, but this caller still holds it — and
		// reading that empty map as authoritative would skip the removal, leaving a deleted branch's
		// metadata for the next branch reusing the name.
		await setBase('doomed', 'origin/doomed-base');

		const real = repo.provider.git.run.bind(repo.provider.git);
		const stub = sinon
			.stub(repo.provider.git, 'run')
			.callsFake(async (options: GitRunOptions, ...args: readonly (string | undefined)[]) => {
				// Fail only the bulk `--get-regex` read; let the removal itself through.
				if (!args.includes('--get-regex')) return real(options, ...args);

				const failed: GitResult = {
					stdout: '',
					stderr: undefined,
					completion: { status: 'failed', reason: 'unstarted', error: new Error('read never ran') },
				};
				return failed;
			});
		try {
			await repo.provider.config.removeGkConfigBranchSection(repo.path, 'doomed');
		} finally {
			stub.restore();
		}

		assert.strictEqual(await readBase('doomed'), undefined, 'a failed pre-check must not skip the removal');
	});

	test('a failure is swallowed so it cannot fail the branch op that already succeeded', async () => {
		// A bogus path is NOT enough to prove this: every git call on that route uses `errors: 'ignore'`,
		// so nothing throws and the assertion would hold even with the try/catch deleted. Force a real
		// throw instead.
		const stub = sinon.stub(repo.provider.git, 'run').rejects(new Error('boom'));
		try {
			await assert.doesNotReject(repo.provider.config.removeGkConfigBranchSection(repo.path, 'whatever'));
		} finally {
			stub.restore();
		}
	});
});

suite('ConfigSubProvider — held config lock', () => {
	let repo: TestRepo;
	let lockPath: string;

	setup(() => {
		repo = createTestRepo();
		mkdirSync(join(repo.path, '.git', 'gk'), { recursive: true });
		lockPath = join(repo.path, '.git', 'gk', 'config.lock');
	});

	teardown(() => {
		repo.cleanup();
	});

	test('setGkConfig waits out a lock another process releases', async () => {
		writeFileSync(lockPath, '');
		const timer = setTimeout(rmSync, 150, lockPath, { force: true });

		try {
			await repo.provider.config.setGkConfig(repo.path, 'branch.main.gk-merge-base', 'origin/main');
		} finally {
			clearTimeout(timer);
		}

		assert.strictEqual(
			await repo.provider.config.getGkConfig(repo.path, 'branch.main.gk-merge-base'),
			'origin/main',
		);
	});

	test('setGkConfig rejects once the retries run out on a lock that never clears', async () => {
		writeFileSync(lockPath, '');

		await assert.rejects(repo.provider.config.setGkConfig(repo.path, 'branch.main.gk-merge-base', 'origin/main'));
		assert.ok(existsSync(lockPath), 'the foreign lock must be left alone');
	});

	test('removeGkConfigBranchSection waits out a lock another process releases', async () => {
		await repo.provider.config.setGkConfig(repo.path, 'branch.doomed.gk-merge-base', 'origin/doomed');
		writeFileSync(lockPath, '');
		const timer = setTimeout(rmSync, 150, lockPath, { force: true });

		try {
			await repo.provider.config.removeGkConfigBranchSection(repo.path, 'doomed');
		} finally {
			clearTimeout(timer);
		}

		assert.strictEqual(await repo.provider.config.getGkConfig(repo.path, 'branch.doomed.gk-merge-base'), undefined);
	});

	test('a config write outside ConfigSubProvider waits out a lock too', async () => {
		const gitLockPath = join(repo.path, '.git', 'config.lock');
		writeFileSync(gitLockPath, '');
		const timer = setTimeout(rmSync, 150, gitLockPath, { force: true });

		try {
			await repo.provider.git.run({ cwd: repo.path }, 'config', '--local', 'gitlens.test.key', 'value');
		} finally {
			clearTimeout(timer);
		}

		assert.strictEqual(await repo.provider.config.getConfig(repo.path, 'gitlens.test.key' as any), 'value');
	});

	test('removeGkConfigBranchSection reports failure without throwing when the lock never clears', async () => {
		await repo.provider.config.setGkConfig(repo.path, 'branch.doomed.gk-merge-base', 'origin/doomed');
		writeFileSync(lockPath, '');

		await repo.provider.config.removeGkConfigBranchSection(repo.path, 'doomed');
		rmSync(lockPath, { force: true });

		assert.strictEqual(
			await repo.provider.config.getGkConfig(repo.path, 'branch.doomed.gk-merge-base'),
			'origin/doomed',
		);
	});
});

suite('ConfigSubProvider — concurrent gk config writes', () => {
	const key = 'branch.main.gk-merge-target-user';
	let repo: TestRepo;

	setup(() => {
		repo = createTestRepo();
	});

	teardown(() => {
		sinon.restore();
		repo.cleanup();
	});

	function countWrites(run: sinon.SinonSpy): number {
		return run.getCalls().filter(call => call.args[1] === 'config' && call.args.includes(key)).length;
	}

	test('lands writes of one key in call order, even when a later one repeats a pending value', async () => {
		const config = repo.provider.config;
		const writes = [
			config.setGkConfig(repo.path, key, 'X'),
			config.setGkConfig(repo.path, key, 'Y'),
			config.setGkConfig(repo.path, key, 'X'),
		];

		const results = await Promise.allSettled(writes);
		assert.deepStrictEqual(
			results.map(r => r.status),
			['fulfilled', 'fulfilled', 'fulfilled'],
		);
		assert.strictEqual(gkConfig(repo.path, key), 'X');
		assert.strictEqual(await config.getGkConfig(repo.path, key), 'X');

		// An unset with no write pending
		await config.setGkConfig(repo.path, key, undefined);
		assert.strictEqual(gkConfig(repo.path, key), undefined);
	});

	test('shares one write between identical concurrent writes', async () => {
		const run = sinon.spy(repo.provider.git, 'run');
		const config = repo.provider.config;

		await Promise.all([config.setGkConfig(repo.path, key, 'X'), config.setGkConfig(repo.path, key, 'X')]);

		assert.strictEqual(countWrites(run), 1);
		assert.strictEqual(gkConfig(repo.path, key), 'X');
	});
});

suite('ConfigSubProvider strict association persistence', () => {
	let repo: TestRepo;

	setup(() => {
		repo = createTestRepo();
	});

	teardown(() => {
		sinon.restore();
		repo.cleanup();
	});

	test('strict reads reject a failed command while ordinary readers retain their contract', async () => {
		const key = 'branch.main.gk-associated-issues';
		await repo.provider.config.setGkConfig(repo.path, key, '["existing"]');
		const real = repo.provider.git.run.bind(repo.provider.git);
		sinon
			.stub(repo.provider.git, 'run')
			.callsFake(async (options: GitRunOptions, ...args: readonly (string | undefined)[]) => {
				if (!args.includes('--get-regex') && !args.includes('--list')) return real(options, ...args);

				return {
					stdout: '',
					stderr: undefined,
					completion: { status: 'failed', reason: 'unstarted', error: new Error('read failed') },
				};
			});
		assert.strictEqual(await repo.provider.config.getGkConfig(repo.path, key), undefined);
		await assert.rejects(
			repo.provider.config.getGkConfig(repo.path, key, { throwOnError: true }),
			/Unable to read/,
		);
		assert.strictEqual(gkConfig(repo.path, key), '["existing"]');
	});

	test('strict reads accept missing storage and missing keys', async () => {
		const key = 'branch.main.gk-associated-issues';
		assert.strictEqual(existsSync(join(repo.path, '.git', 'gk', 'config')), false);
		assert.strictEqual(await repo.provider.config.getGkConfig(repo.path, key, { throwOnError: true }), undefined);
		await repo.provider.config.setGkConfig(repo.path, key, '[]', { throwOnError: true });
		assert.strictEqual(gkConfig(repo.path, key), '[]');
	});

	test('strict reads see external writes despite a warm ordinary cache', async () => {
		const key = 'branch.main.gk-associated-issues';
		await repo.provider.config.setGkConfig(repo.path, key, '["old1"]');
		assert.strictEqual(await repo.provider.config.getGkConfig(repo.path, key), '["old1"]');
		execFileSync('git', ['config', '-f', join(repo.path, '.git', 'gk', 'config'), key, '["old1","old2"]']);
		assert.strictEqual(await repo.provider.config.getGkConfig(repo.path, key), '["old1"]');
		assert.strictEqual(
			await repo.provider.config.getGkConfig(repo.path, key, { throwOnError: true }),
			'["old1","old2"]',
		);
	});

	test('strict reads reject a real file parent when stat reports Windows ENOENT', async () => {
		const key = 'branch.main.gk-associated-issues';
		await repo.provider.config.setGkConfig(repo.path, key, '["old"]');
		const folder = join(repo.path, '.git', 'gk');
		const path = join(folder, 'config');
		rmSync(folder, { recursive: true });
		writeFileSync(folder, 'blocked');
		const missing = await fs.stat(path).then(
			() => assert.fail('A child beneath a file cannot be statted'),
			(ex: unknown) => {
				const error = ex as NodeJS.ErrnoException;
				assert.ok(error.code === 'ENOTDIR' || error.code === 'ENOENT');
				return Object.assign(error, { code: 'ENOENT' });
			},
		);
		sinon.stub(fs, 'stat').callThrough().withArgs(path).rejects(missing);
		sinon.stub(fs, 'lstat').callThrough().withArgs(path).rejects(missing);
		await assert.rejects(repo.provider.config.getGkConfig(repo.path, key, { throwOnError: true }));
	});

	test('strict reads accept missing config and gk directories after migration', async () => {
		const key = 'branch.main.gk-associated-issues';
		await repo.provider.config.setGkConfig(repo.path, key, '["old"]');
		await repo.provider.config.getGkConfig(repo.path, key, { throwOnError: true });
		const folder = join(repo.path, '.git', 'gk');
		rmSync(join(folder, 'config'));
		assert.strictEqual(await repo.provider.config.getGkConfig(repo.path, key, { throwOnError: true }), undefined);
		rmSync(folder, { recursive: true });
		assert.strictEqual(await repo.provider.config.getGkConfig(repo.path, key, { throwOnError: true }), undefined);
		await repo.provider.config.setGkConfig(repo.path, key, '["first"]', { throwOnError: true });
		assert.strictEqual(gkConfig(repo.path, key), '["first"]');
	});

	test('strict reads preserve directory symlinks and reject dangling directories', async () => {
		const key = 'branch.main.gk-associated-issues';
		await repo.provider.config.setGkConfig(repo.path, key, '["old"]');
		await repo.provider.config.getGkConfig(repo.path, key, { throwOnError: true });
		const folder = join(repo.path, '.git', 'gk');
		const target = join(repo.path, 'metadata');
		mkdirSync(target);
		writeFileSync(join(target, 'config'), readFileSync(join(folder, 'config')));
		rmSync(folder, { recursive: true });
		symlinkSync(target, folder, process.platform === 'win32' ? 'junction' : 'dir');
		assert.strictEqual(await repo.provider.config.getGkConfig(repo.path, key, { throwOnError: true }), '["old"]');
		rmSync(join(target, 'config'));
		assert.strictEqual(await repo.provider.config.getGkConfig(repo.path, key, { throwOnError: true }), undefined);
		rmSync(target, { recursive: true });
		await assert.rejects(repo.provider.config.getGkConfig(repo.path, key, { throwOnError: true }));
	});

	test('strict reads preserve supported file symlinks and reject dangling entries', async function () {
		const key = 'branch.main.gk-associated-issues';
		await repo.provider.config.setGkConfig(repo.path, key, '["old"]');
		await repo.provider.config.getGkConfig(repo.path, key, { throwOnError: true });
		const path = join(repo.path, '.git', 'gk', 'config');
		const target = join(repo.path, 'metadata');
		writeFileSync(target, readFileSync(path));
		rmSync(path);
		try {
			symlinkSync(target, path, 'file');
		} catch (ex) {
			if ((ex as NodeJS.ErrnoException).code !== 'EPERM') throw ex;

			this.skip();
		}
		assert.strictEqual(await repo.provider.config.getGkConfig(repo.path, key, { throwOnError: true }), '["old"]');
		rmSync(target);
		await assert.rejects(repo.provider.config.getGkConfig(repo.path, key, { throwOnError: true }));
	});

	test('strict first reads migrate legacy associations before returning', async () => {
		const key = 'branch.main.gk-associated-issues';
		execFileSync('git', ['config', '--local', key, '["legacy"]'], { cwd: repo.path });
		assert.strictEqual(
			await repo.provider.config.getGkConfig(repo.path, key, { throwOnError: true }),
			'["legacy"]',
		);
		assert.strictEqual(gkConfig(repo.path, key), '["legacy"]');
	});

	test('strict worktree reads use shared association storage', async () => {
		const key = 'branch.main.gk-associated-issues';
		await repo.provider.config.setGkConfig(repo.path, key, '["shared"]');
		createBranch(repo.path, 'strict-associations');
		const worktree = createWorktree(repo.path, 'strict-associations');
		try {
			assert.strictEqual(
				await repo.provider.config.getGkConfig(worktree.path, key, { throwOnError: true }),
				'["shared"]',
			);
		} finally {
			worktree.cleanup();
		}
	});

	(['config directory', 'parent file'] as const).forEach(fault => {
		test(`strict reads reject a ${fault} even after an ordinary read cached it as empty`, async () => {
			const key = 'branch.main.gk-associated-issues';
			await repo.provider.config.setGkConfig(repo.path, key, '["old1","old2"]');
			const folder = join(repo.path, '.git', 'gk');
			const configPath = join(folder, 'config');
			if (fault === 'config directory') {
				rmSync(configPath);
				mkdirSync(configPath);
			} else {
				rmSync(folder, { recursive: true });
				writeFileSync(folder, 'blocked');
			}

			assert.strictEqual(await repo.provider.config.getGkConfig(repo.path, key), undefined);
			await assert.rejects(repo.provider.config.getGkConfig(repo.path, key, { throwOnError: true }));
		});

		test(`strict retry after a ${fault} preserves stored associations without cache invalidation`, async () => {
			const key = 'branch.main.gk-associated-issues';
			await repo.provider.config.setGkConfig(repo.path, key, '["old1","old2"]');
			const folder = join(repo.path, '.git', 'gk');
			const configPath = join(folder, 'config');
			const before = readFileSync(configPath);
			if (fault === 'config directory') {
				rmSync(configPath);
				mkdirSync(configPath);
			} else {
				rmSync(folder, { recursive: true });
				writeFileSync(folder, 'blocked');
			}

			await repo.provider.config.getGkConfig(repo.path, key, { throwOnError: true }).catch(() => {});
			await assert.rejects(
				repo.provider.config.setGkConfig(repo.path, key, '["failed"]', { throwOnError: true }),
			);
			rmSync(folder, { recursive: true });
			mkdirSync(folder);
			writeFileSync(configPath, before);

			const encoded = await repo.provider.config.getGkConfig(repo.path, key, { throwOnError: true });
			const associated = encoded ? (JSON.parse(encoded) as string[]) : [];
			associated.push('new');
			await repo.provider.config.setGkConfig(repo.path, key, JSON.stringify(associated), { throwOnError: true });
			assert.deepStrictEqual(JSON.parse(gkConfig(repo.path, key)!), ['old1', 'old2', 'new']);
		});
	});

	test('strict writes reject a lock failure even when its path matches a Git warning', async () => {
		const root = mkdtempSync(join(tmpdir(), 'gitlens-no such path-'));
		const path = join(root, 'repo');
		const provider = createProvider();
		const key = 'branch.main.gk-associated-issues';
		try {
			execFileSync('git', ['clone', '--no-hardlinks', repo.path, path], { stdio: 'pipe' });
			await provider.config.setGkConfig(path, key, '["old"]', { throwOnError: true });
			const configPath = join(path, '.git', 'gk', 'config');
			const before = readFileSync(configPath, 'utf8');
			writeFileSync(`${configPath}.lock`, '');
			const publications = sinon.spy(provider.cache, 'recordGkConfigWrite');
			await assert.doesNotReject(provider.config.setGkConfig(path, key, '["ordinary"]'));
			const ordinaryPublications = publications.callCount;
			await assert.rejects(provider.config.setGkConfig(path, key, '["strict"]', { throwOnError: true }));
			assert.strictEqual(readFileSync(configPath, 'utf8'), before);
			assert.strictEqual(publications.callCount, ordinaryPublications);
		} finally {
			provider.dispose();
			rmSync(root, { recursive: true, force: true });
		}
	});

	test('a strict write does not join an ordinary write that silently fails to prepare storage', async () => {
		const key = 'branch.main.gk-associated-issues';
		writeFileSync(join(repo.path, '.git', 'gk'), 'blocked');
		const results = await Promise.allSettled([
			repo.provider.config.setGkConfig(repo.path, key, '[]'),
			repo.provider.config.setGkConfig(repo.path, key, '[]', { throwOnError: true }),
		]);
		assert.strictEqual(results[0].status, 'fulfilled');
		assert.strictEqual(results[1].status, 'rejected');
		assert.strictEqual(existsSync(join(repo.path, '.git', 'gk', 'config')), false);
	});
});

suite('ConfigSubProvider — config under extensions.worktreeConfig', () => {
	let repo: TestRepo;
	let worktree: { path: string; cleanup: () => void };
	let plain: { path: string; cleanup: () => void };

	function git(cwd: string, ...args: string[]): string {
		return execFileSync('git', args, { cwd: cwd, encoding: 'utf-8', stdio: 'pipe' }).trim();
	}

	setup(async () => {
		repo = createTestRepo();
		git(repo.path, 'config', 'extensions.worktreeConfig', 'true');
		createBranch(repo.path, 'with-override');
		createBranch(repo.path, 'no-override');
		worktree = createWorktree(repo.path, 'with-override');
		plain = createWorktree(repo.path, 'no-override');
		// The cache keys checkouts by normalized (forward-slash) path, which a native Windows path isn't
		repo.path = normalizePath(repo.path);
		worktree.path = normalizePath(worktree.path);
		plain.path = normalizePath(plain.path);
		git(worktree.path, 'config', '--worktree', 'user.name', 'Worktree User');
		git(worktree.path, 'config', '--worktree', 'commit.gpgsign', 'true');

		// How core learns that a linked worktree shares the main checkout's common path
		for (const path of [repo.path, worktree.path, plain.path]) {
			repo.provider.cache.registerRepoPath(fileUri(path), await repo.provider.config.getGitDir(path));
		}
		assert.notStrictEqual(repo.provider.cache.getCommonPath(worktree.path), worktree.path);
		assert.strictEqual(
			repo.provider.cache.getCommonPath(worktree.path),
			repo.provider.cache.getCommonPath(repo.path),
		);
	});

	teardown(() => {
		plain?.cleanup();
		worktree?.cleanup();
		repo?.cleanup();
	});

	test('each worktree reads its own config.worktree value, whichever read first', async () => {
		const config = repo.provider.config;
		const pattern = '^user\\.name$';

		assert.strictEqual((await config.getConfigRegex(repo.path, pattern)).get('user.name'), 'Test User');
		assert.strictEqual((await config.getConfigRegex(worktree.path, pattern)).get('user.name'), 'Worktree User');
		assert.strictEqual((await config.getConfigRegex(plain.path, pattern)).get('user.name'), 'Test User');
	});

	test('a worktree read first does not leak its config.worktree value to the others', async () => {
		const config = repo.provider.config;
		const pattern = '^user\\.name$';

		assert.strictEqual((await config.getConfigRegex(worktree.path, pattern)).get('user.name'), 'Worktree User');
		assert.strictEqual((await config.getConfigRegex(repo.path, pattern)).get('user.name'), 'Test User');
		assert.strictEqual((await config.getConfigRegex(plain.path, pattern)).get('user.name'), 'Test User');
	});

	test("getConfig reads each worktree's own config.worktree value, whichever read first", async () => {
		const config = repo.provider.config;

		assert.strictEqual(await config.getConfig(repo.path, 'user.name'), 'Test User');
		assert.strictEqual(await config.getConfig(worktree.path, 'user.name'), 'Worktree User');
		assert.strictEqual(await config.getConfig(plain.path, 'user.name'), 'Test User');
		assert.strictEqual(await config.getConfig(worktree.path, 'commit.gpgsign'), 'true');
		assert.strictEqual(await config.getConfig(repo.path, 'commit.gpgsign'), 'false');
	});

	test("getSigningConfig and getCurrentUser read the linked worktree's own values after the main checkout read first", async () => {
		const config = repo.provider.config;

		assert.strictEqual((await config.getSigningConfig(repo.path)).enabled, false);
		assert.strictEqual((await config.getCurrentUser(repo.path))?.name, 'Test User');

		assert.strictEqual((await config.getSigningConfig(worktree.path)).enabled, true);
		assert.strictEqual((await config.getCurrentUser(worktree.path))?.name, 'Worktree User');
		assert.strictEqual((await config.getSigningConfig(plain.path)).enabled, false);
		assert.strictEqual((await config.getCurrentUser(plain.path))?.name, 'Test User');
	});

	test("a shared write clears every worktree's cached read, not just the one that wrote", async () => {
		const config = repo.provider.config;
		const pattern = '^(user\\.name|branch\\.shared\\.rebase)$';

		assert.strictEqual((await config.getConfigRegex(repo.path, pattern)).get('branch.shared.rebase'), undefined);
		assert.strictEqual(
			(await config.getConfigRegex(worktree.path, pattern)).get('branch.shared.rebase'),
			undefined,
		);
		assert.strictEqual((await config.getConfigRegex(plain.path, pattern)).get('branch.shared.rebase'), undefined);

		await config.setConfig(repo.path, 'branch.shared.rebase', 'true');

		assert.strictEqual((await config.getConfigRegex(repo.path, pattern)).get('branch.shared.rebase'), 'true');
		assert.strictEqual((await config.getConfigRegex(plain.path, pattern)).get('branch.shared.rebase'), 'true');
		const fromWorktree = await config.getConfigRegex(worktree.path, pattern);
		assert.strictEqual(fromWorktree.get('branch.shared.rebase'), 'true');
		assert.strictEqual(fromWorktree.get('user.name'), 'Worktree User', 'still its own override');
	});

	test("a write from one worktree clears the others' cached read of the key it changed", async () => {
		const config = repo.provider.config;
		const pattern = '^user\\.name$';

		assert.strictEqual((await config.getConfigRegex(plain.path, pattern)).get('user.name'), 'Test User');
		assert.strictEqual(await config.getConfig(plain.path, 'user.name'), 'Test User');

		await config.setConfig(repo.path, 'user.name', 'Changed User');

		assert.strictEqual((await config.getConfigRegex(plain.path, pattern)).get('user.name'), 'Changed User');
		assert.strictEqual((await config.getConfigRegex(repo.path, pattern)).get('user.name'), 'Changed User');
		assert.strictEqual((await config.getConfigRegex(worktree.path, pattern)).get('user.name'), 'Worktree User');
		assert.strictEqual(await config.getConfig(plain.path, 'user.name'), 'Changed User');
		assert.strictEqual(await config.getConfig(worktree.path, 'user.name'), 'Worktree User');
	});

	test('getConfigRegexAll serves the shared value to every worktree, never a config.worktree value', async () => {
		const config = repo.provider.config;
		const pattern = '^user\\.name$';

		const fromWorktree = await config.getConfigRegexAll(worktree.path, pattern);
		const fromMain = await config.getConfigRegexAll(repo.path, pattern);
		const fromPlain = await config.getConfigRegexAll(plain.path, pattern);

		for (const result of [fromWorktree, fromMain, fromPlain]) {
			// Every scope's value is kept (the machine's global one too), the repository's last; none is the worktree's
			const values = result.get('user.name');
			assert.strictEqual(values?.at(-1), 'Test User');
			assert.ok(!values.includes('Worktree User'));
		}
	});
});

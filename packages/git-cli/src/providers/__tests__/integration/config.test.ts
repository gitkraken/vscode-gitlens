import * as assert from 'assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as sinon from 'sinon';
import type { GitResult, GitRunOptions } from '@gitlens/git/run.types.js';
import { normalizePath } from '@gitlens/utils/path.js';
import type { TestRepo } from './helpers.js';
import { createTestRepo } from './helpers.js';

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

	test('removeGkConfigBranchSection drops that ref’s gk keys and leaves siblings alone', async () => {
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

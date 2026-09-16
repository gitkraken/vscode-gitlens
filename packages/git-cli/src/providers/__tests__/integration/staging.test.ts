import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CachedGitTypes } from '@gitlens/git/cache.js';
import type { RepositoryChange } from '@gitlens/git/models/repository.js';
import type { TestRepo } from './helpers.js';
import { createTestRepo } from './helpers.js';

suite('StagingSubProvider', () => {
	let repo: TestRepo;
	let cacheResets: { repoPath: string; types: CachedGitTypes[] }[];
	let repoChanges: { repoPath: string; changes: RepositoryChange[] }[];

	suiteSetup(() => {
		cacheResets = [];
		repoChanges = [];
		repo = createTestRepo({
			hooks: {
				cache: { onReset: (repoPath, ...types) => cacheResets.push({ repoPath: repoPath, types: types }) },
				repository: {
					onChanged: (repoPath, changes) => repoChanges.push({ repoPath: repoPath, changes: changes }),
				},
			},
		});
	});

	suiteTeardown(() => {
		repo.cleanup();
	});

	setup(() => {
		cacheResets.length = 0;
		repoChanges.length = 0;
	});

	function writeUntracked(name: string, content = 'x'): string {
		const filePath = join(repo.path, name);
		writeFileSync(filePath, content);
		return filePath;
	}

	function stagedNames(): string {
		return execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: repo.path, encoding: 'utf8' });
	}

	test('stageFiles stages and fires the status hooks', async () => {
		writeUntracked('staged.txt');

		await repo.provider.staging.stageFiles(repo.path, ['staged.txt']);

		assert.ok(stagedNames().includes('staged.txt'), 'the file should be staged');
		assert.ok(
			cacheResets.some(r => r.types.includes('status')),
			'onReset should fire for status',
		);
		assert.ok(
			repoChanges.some(c => c.changes.includes('index')),
			'onChanged should fire for index',
		);
	});

	test('stageFiles against a temporary index does not fire hooks', async () => {
		writeUntracked('temp-index.txt');

		const index = await repo.provider.staging.createTemporaryIndex(repo.path, 'empty');
		try {
			await repo.provider.staging.stageFiles(repo.path, ['temp-index.txt'], { index: index });
		} finally {
			await index.dispose();
		}

		assert.strictEqual(cacheResets.length, 0, 'no cache reset should fire for a temporary-index stage');
		assert.strictEqual(repoChanges.length, 0, 'no repository change should fire for a temporary-index stage');

		// The real index must be untouched.
		assert.ok(!stagedNames().includes('temp-index.txt'), 'the real index should not see the temp-index stage');
	});

	test('clean removes an untracked file', async () => {
		const filePath = writeUntracked('untracked.txt');
		assert.ok(existsSync(filePath));

		await repo.provider.staging.clean(repo.path);

		assert.ok(!existsSync(filePath), 'the untracked file should be removed');
		assert.ok(
			cacheResets.some(r => r.types.includes('status')),
			'onReset should fire for status',
		);
		assert.ok(
			repoChanges.some(c => c.changes.includes('index')),
			'onChanged should fire for index',
		);
	});

	test('clean leaves ignored files unless ignored is set', async () => {
		writeFileSync(join(repo.path, '.gitignore'), 'ignored.txt\n');
		execFileSync('git', ['add', '.gitignore'], { cwd: repo.path, stdio: 'pipe' });
		execFileSync('git', ['commit', '-m', 'add gitignore'], { cwd: repo.path, stdio: 'pipe' });
		const ignoredPath = writeUntracked('ignored.txt');

		await repo.provider.staging.clean(repo.path);
		assert.ok(existsSync(ignoredPath), 'a plain clean should leave an ignored file alone');

		await repo.provider.staging.clean(repo.path, { ignored: true });
		assert.ok(!existsSync(ignoredPath), 'ignored: true should remove an ignored file too');
	});

	test('clean removes directories only with directories set', async () => {
		const dirPath = join(repo.path, 'untracked-dir');
		mkdirSync(dirPath);
		writeFileSync(join(dirPath, 'inner.txt'), 'x');

		await repo.provider.staging.clean(repo.path);
		assert.ok(existsSync(dirPath), 'a plain clean should not remove an untracked directory');

		await repo.provider.staging.clean(repo.path, { directories: true });
		assert.ok(!existsSync(dirPath), 'directories: true should remove the untracked directory');
	});

	test('clean honours paths', async () => {
		const keepPath = writeUntracked('keep.txt');
		const removePath = writeUntracked('remove.txt');

		await repo.provider.staging.clean(repo.path, { paths: ['remove.txt'] });

		assert.ok(existsSync(keepPath), 'a file outside paths should survive');
		assert.ok(!existsSync(removePath), 'a file inside paths should be removed');
	});
});

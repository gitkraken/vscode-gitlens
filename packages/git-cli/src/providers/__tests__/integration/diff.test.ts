import * as assert from 'assert';
import type { TestRepo } from './helpers.js';
import { addCommit, createTestRepo } from './helpers.js';

suite('DiffSubProvider', () => {
	let repo: TestRepo;

	suiteSetup(() => {
		repo = createTestRepo();
		addCommit(repo.path, 'diff-test.txt', 'line 1\nline 2\nline 3\n', 'Add diff-test.txt');
		addCommit(repo.path, 'diff-test.txt', 'line 1\nline 2 modified\nline 3\nline 4\n', 'Modify diff-test.txt');
	});

	suiteTeardown(() => {
		repo.cleanup();
	});

	test('getDiff returns diff between commits', async () => {
		const diff = await repo.provider.diff.getDiff?.(repo.path, 'HEAD', 'HEAD~1');
		assert.ok(diff, 'Diff should not be undefined');
		assert.ok(diff.contents.length > 0, 'Diff should have contents');
		assert.ok(diff.contents.includes('diff-test.txt'), 'Diff should mention the changed file');
	});

	test('getChangedFilesCount returns correct count', async () => {
		const stat = await repo.provider.diff.getChangedFilesCount(repo.path, 'HEAD', 'HEAD~1');
		assert.ok(stat, 'Stat should not be undefined');
		assert.strictEqual(stat.files, 1);
	});

	test('getDiffStatus returns file statuses', async () => {
		const files = await repo.provider.diff.getDiffStatus(repo.path, 'HEAD~1..HEAD');
		assert.ok(files, 'Files should not be undefined');
		assert.ok(files.length > 0, 'Should have at least one changed file');
		const diffFile = files.find(f => f.path === 'diff-test.txt');
		assert.ok(diffFile, 'Should find diff-test.txt in diff status');
	});
});

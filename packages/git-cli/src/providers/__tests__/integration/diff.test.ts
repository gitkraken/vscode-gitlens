import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
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

suite('DiffSubProvider.getParsedDiff', () => {
	test('returns files with hunks for a two-commit diff', async () => {
		const r = createTestRepo();
		try {
			addCommit(r.path, 'a.txt', 'line 1\nline 2\n', 'Add a.txt');
			addCommit(r.path, 'a.txt', 'line 1\nline 2 changed\nline 3\n', 'Edit a.txt');

			const parsed = await r.provider.diff.getParsedDiff?.(r.path, 'HEAD', 'HEAD~1');
			assert.ok(parsed, 'Expected a ParsedGitDiff');
			assert.strictEqual(parsed.files.length, 1);

			const [file] = parsed.files;
			assert.strictEqual(file.path, 'a.txt');
			assert.ok(file.hunks.length > 0, 'Expected at least one hunk');
			assert.ok(file.hunks[0].content.length > 0, 'Hunk should have raw content');
		} finally {
			r.cleanup();
		}
	});

	test('returns undefined for same-ref diff', async () => {
		const r = createTestRepo();
		try {
			const parsed = await r.provider.diff.getParsedDiff?.(r.path, 'HEAD', 'HEAD');
			assert.strictEqual(parsed, undefined);
		} finally {
			r.cleanup();
		}
	});

	test('populates originalPath and rename status', async () => {
		const r = createTestRepo();
		try {
			addCommit(r.path, 'original.txt', 'content line 1\ncontent line 2\n', 'Add original.txt');
			execFileSync('git', ['mv', 'original.txt', 'renamed.txt'], { cwd: r.path, stdio: 'pipe' });
			execFileSync('git', ['commit', '-m', 'Rename'], { cwd: r.path, stdio: 'pipe' });

			const parsed = await r.provider.diff.getParsedDiff?.(r.path, 'HEAD', 'HEAD~1');
			assert.ok(parsed, 'Expected a ParsedGitDiff');
			const renamed = parsed.files.find(f => f.path === 'renamed.txt');
			assert.ok(renamed, 'Should include the renamed file');
			assert.strictEqual(renamed.originalPath, 'original.txt');
			assert.strictEqual(renamed.status, 'R');
		} finally {
			r.cleanup();
		}
	});

	test('multi-file commit produces one entry per file', async () => {
		const r = createTestRepo();
		try {
			addCommit(r.path, 'file1.txt', 'one\n', 'first file');

			writeFileSync(join(r.path, 'file1.txt'), 'one modified\n');
			writeFileSync(join(r.path, 'file2.txt'), 'two\n');
			execFileSync('git', ['add', '.'], { cwd: r.path, stdio: 'pipe' });
			execFileSync('git', ['commit', '-m', 'two-file commit'], { cwd: r.path, stdio: 'pipe' });

			const parsed = await r.provider.diff.getParsedDiff?.(r.path, 'HEAD', 'HEAD~1');
			assert.ok(parsed, 'Expected a ParsedGitDiff');
			assert.strictEqual(parsed.files.length, 2);
			assert.ok(parsed.files.find(f => f.path === 'file1.txt'));
			assert.ok(parsed.files.find(f => f.path === 'file2.txt'));
		} finally {
			r.cleanup();
		}
	});
});

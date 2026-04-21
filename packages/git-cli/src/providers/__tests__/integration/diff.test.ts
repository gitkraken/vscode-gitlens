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

suite('DiffSubProvider.includeUntracked', () => {
	test('getDiffStatus(HEAD, includeUntracked) includes tracked + staged + untracked files', async () => {
		const r = createTestRepo();
		try {
			addCommit(r.path, 'tracked.txt', 'original\n', 'Add tracked.txt');

			// Modify the tracked file (working tree change)
			writeFileSync(join(r.path, 'tracked.txt'), 'modified\n');
			// Add a staged new file
			writeFileSync(join(r.path, 'staged.txt'), 'staged content\n');
			execFileSync('git', ['add', 'staged.txt'], { cwd: r.path, stdio: 'pipe' });
			// Add an untracked file
			writeFileSync(join(r.path, 'untracked.txt'), 'untracked content\n');

			const filesWithout = await r.provider.diff.getDiffStatus(r.path, 'HEAD');
			assert.ok(filesWithout, 'Without includeUntracked, should still return tracked + staged');
			assert.ok(filesWithout.find(f => f.path === 'tracked.txt'));
			assert.ok(filesWithout.find(f => f.path === 'staged.txt'));
			assert.strictEqual(
				filesWithout.find(f => f.path === 'untracked.txt'),
				undefined,
				'Without includeUntracked, untracked files should be absent',
			);

			const filesWith = await r.provider.diff.getDiffStatus(r.path, 'HEAD', undefined, {
				includeUntracked: true,
			});
			assert.ok(filesWith, 'Files should not be undefined');
			assert.ok(
				filesWith.find(f => f.path === 'tracked.txt'),
				'Should include modified tracked file',
			);
			assert.ok(
				filesWith.find(f => f.path === 'staged.txt'),
				'Should include staged file',
			);
			assert.ok(
				filesWith.find(f => f.path === 'untracked.txt'),
				'Should include untracked file',
			);
		} finally {
			r.cleanup();
		}
	});

	test('getDiffStatus(HEAD, includeUntracked) returns untracked only in otherwise-clean repo', async () => {
		const r = createTestRepo();
		try {
			addCommit(r.path, 'a.txt', 'a\n', 'Add a.txt');
			writeFileSync(join(r.path, 'new.txt'), 'new\n');

			const files = await r.provider.diff.getDiffStatus(r.path, 'HEAD', undefined, { includeUntracked: true });
			assert.ok(files, 'Expected at least the untracked file');
			assert.strictEqual(files.length, 1);
			assert.strictEqual(files[0].path, 'new.txt');
		} finally {
			r.cleanup();
		}
	});

	test('getDiffStatus with two refs ignores includeUntracked', async () => {
		const r = createTestRepo();
		try {
			addCommit(r.path, 'a.txt', 'a\n', 'Add a.txt');
			addCommit(r.path, 'b.txt', 'b\n', 'Add b.txt');
			writeFileSync(join(r.path, 'untracked.txt'), 'ignored\n');

			// Two-ref form (ref2 != null) is not "working tree vs ref" — untracked should be skipped
			const files = await r.provider.diff.getDiffStatus(r.path, 'HEAD', 'HEAD~1', {
				includeUntracked: true,
			});
			assert.ok(files, 'Files should not be undefined');
			assert.strictEqual(
				files.find(f => f.path === 'untracked.txt'),
				undefined,
				'Untracked files should not be merged into a two-ref diff',
			);
		} finally {
			r.cleanup();
		}
	});

	test('getChangedFilesCount(HEAD, includeUntracked) adds untracked count', async () => {
		const r = createTestRepo();
		try {
			addCommit(r.path, 'tracked.txt', 'original\n', 'Add tracked.txt');

			writeFileSync(join(r.path, 'tracked.txt'), 'modified\n');
			writeFileSync(join(r.path, 'untracked.txt'), 'new\n');

			const without = await r.provider.diff.getChangedFilesCount(r.path, 'HEAD');
			assert.ok(without, 'Without includeUntracked, should still report tracked changes');
			assert.strictEqual(without.files, 1);

			const withUntracked = await r.provider.diff.getChangedFilesCount(r.path, 'HEAD', undefined, {
				includeUntracked: true,
			});
			assert.ok(withUntracked, 'Stat should not be undefined');
			assert.strictEqual(withUntracked.files, 2, 'Expected tracked + untracked count');
		} finally {
			r.cleanup();
		}
	});

	test('getChangedFilesCount("", <non-HEAD ref>) returns working-tree vs ref, not ref^..ref', async () => {
		const r = createTestRepo();
		try {
			// main (HEAD): one commit with a.txt only.
			// feature: adds b.txt in a second commit.
			// Working tree stays on main (clean) — so b.txt does NOT exist on disk but DOES on feature.
			addCommit(r.path, 'a.txt', 'v1\n', 'Add a.txt');
			const mainRef = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: r.path }).toString().trim();
			execFileSync('git', ['checkout', '-b', 'feature'], { cwd: r.path, stdio: 'pipe' });
			addCommit(r.path, 'b.txt', 'new line\n', 'Add b.txt on feature');
			execFileSync('git', ['checkout', mainRef], { cwd: r.path, stdio: 'pipe' });

			// Working tree vs feature: b.txt exists on feature but not in working tree
			// → diff reports b.txt as deleted (1 file, 1 deletion, 0 additions).
			const workingTreeVsFeature = await r.provider.diff.getChangedFilesCount(r.path, '', 'feature');
			assert.ok(workingTreeVsFeature, 'Expected a shortstat for working tree vs feature');
			assert.strictEqual(workingTreeVsFeature.files, 1);
			assert.strictEqual(workingTreeVsFeature.additions, 0);
			assert.strictEqual(workingTreeVsFeature.deletions, 1);

			// feature^..feature: b.txt was added (1 file, 1 addition, 0 deletions) — opposite direction.
			const featureParentToFeature = await r.provider.diff.getChangedFilesCount(r.path, 'feature', undefined);
			assert.ok(featureParentToFeature);
			assert.strictEqual(featureParentToFeature.files, 1);
			assert.strictEqual(featureParentToFeature.additions, 1);
			assert.strictEqual(featureParentToFeature.deletions, 0);

			// Hard guardrail: the two shapes MUST differ.
			assert.notDeepStrictEqual(
				workingTreeVsFeature,
				featureParentToFeature,
				'working-tree-vs-ref and ref^..ref must produce different stats',
			);
		} finally {
			r.cleanup();
		}
	});

	test('getChangedFilesCount("", <non-HEAD ref>, includeUntracked) adds untracked count', async () => {
		const r = createTestRepo();
		try {
			addCommit(r.path, 'a.txt', 'v1\n', 'Add a.txt');
			const mainRef = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: r.path }).toString().trim();
			execFileSync('git', ['checkout', '-b', 'feature'], { cwd: r.path, stdio: 'pipe' });
			addCommit(r.path, 'a.txt', 'v2\n', 'Modify a.txt on feature');
			execFileSync('git', ['checkout', mainRef], { cwd: r.path, stdio: 'pipe' });

			writeFileSync(join(r.path, 'untracked.txt'), 'new\n');

			const without = await r.provider.diff.getChangedFilesCount(r.path, '', 'feature');
			assert.ok(without);
			assert.strictEqual(without.files, 1, 'Without includeUntracked, only the tracked diff file is counted');

			const withUntracked = await r.provider.diff.getChangedFilesCount(r.path, '', 'feature', {
				includeUntracked: true,
			});
			assert.ok(withUntracked);
			assert.strictEqual(
				withUntracked.files,
				2,
				'With includeUntracked on a non-HEAD working-tree comparison, untracked files must contribute to the count',
			);
		} finally {
			r.cleanup();
		}
	});

	test('getDiffStatus("", <non-HEAD ref>, includeUntracked) merges untracked', async () => {
		const r = createTestRepo();
		try {
			addCommit(r.path, 'a.txt', 'v1\n', 'Add a.txt');
			const mainRef = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: r.path }).toString().trim();
			execFileSync('git', ['checkout', '-b', 'feature'], { cwd: r.path, stdio: 'pipe' });
			addCommit(r.path, 'a.txt', 'v2\n', 'Modify a.txt on feature');
			execFileSync('git', ['checkout', mainRef], { cwd: r.path, stdio: 'pipe' });

			writeFileSync(join(r.path, 'untracked.txt'), 'new\n');

			const files = await r.provider.diff.getDiffStatus(r.path, 'feature', undefined, {
				includeUntracked: true,
			});
			assert.ok(files);
			assert.ok(
				files.find(f => f.path === 'a.txt'),
				'Should include the tracked diff file',
			);
			assert.ok(
				files.find(f => f.path === 'untracked.txt'),
				'Should include the untracked file when comparing working tree vs feature',
			);
		} finally {
			r.cleanup();
		}
	});

	test('getDiffStatus with options.path ignores non-matching untracked files', async () => {
		const r = createTestRepo();
		try {
			addCommit(r.path, 'a.txt', 'v1\n', 'Add a.txt');
			writeFileSync(join(r.path, 'a.txt'), 'v2\n');
			writeFileSync(join(r.path, 'other-untracked.txt'), 'new\n');

			const files = await r.provider.diff.getDiffStatus(r.path, 'HEAD', undefined, {
				includeUntracked: true,
				path: 'a.txt',
			});
			assert.ok(files);
			assert.strictEqual(
				files.find(f => f.path === 'other-untracked.txt'),
				undefined,
				'Untracked files outside the path filter must not be merged',
			);
		} finally {
			r.cleanup();
		}
	});

	test('getDiffStatus with filters that exclude additions omits untracked', async () => {
		const r = createTestRepo();
		try {
			addCommit(r.path, 'a.txt', 'v1\n', 'Add a.txt');
			writeFileSync(join(r.path, 'a.txt'), 'v2\n');
			writeFileSync(join(r.path, 'untracked.txt'), 'new\n');

			const files = await r.provider.diff.getDiffStatus(r.path, 'HEAD', undefined, {
				includeUntracked: true,
				filters: ['M'],
			});
			assert.ok(files);
			assert.strictEqual(
				files.find(f => f.path === 'untracked.txt'),
				undefined,
				'Untracked files are "added" — a filter restricted to M must omit them',
			);

			// But filters including 'A' should still merge untracked
			const withA = await r.provider.diff.getDiffStatus(r.path, 'HEAD', undefined, {
				includeUntracked: true,
				filters: ['M', 'A'],
			});
			assert.ok(withA);
			assert.ok(
				withA.find(f => f.path === 'untracked.txt'),
				'Filters containing A should still include untracked files',
			);
		} finally {
			r.cleanup();
		}
	});

	test('getChangedFilesCount("", <non-HEAD ref>, includeUntracked) adds untracked count', async () => {
		const r = createTestRepo();
		try {
			addCommit(r.path, 'a.txt', 'v1\n', 'Add a.txt');
			const mainRef = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: r.path }).toString().trim();
			execFileSync('git', ['checkout', '-b', 'feature'], { cwd: r.path, stdio: 'pipe' });
			addCommit(r.path, 'b.txt', 'new line\n', 'Add b.txt on feature');
			execFileSync('git', ['checkout', mainRef], { cwd: r.path, stdio: 'pipe' });

			// Working tree on main is clean; feature has b.txt. Add an untracked file on disk.
			writeFileSync(join(r.path, 'untracked.txt'), 'new\n');

			const without = await r.provider.diff.getChangedFilesCount(r.path, '', 'feature');
			assert.ok(without, 'Without includeUntracked, stats should still reflect working-tree vs feature');
			assert.strictEqual(without.files, 1, 'Expected b.txt only (tracked diff)');

			const withUntracked = await r.provider.diff.getChangedFilesCount(r.path, '', 'feature', {
				includeUntracked: true,
			});
			assert.ok(withUntracked, 'Stat should not be undefined');
			assert.strictEqual(
				withUntracked.files,
				2,
				'Expected b.txt (tracked) + untracked.txt when includeUntracked is set for non-HEAD ref',
			);
		} finally {
			r.cleanup();
		}
	});

	test('getChangedFilesCount with uris ignores includeUntracked', async () => {
		const r = createTestRepo();
		try {
			addCommit(r.path, 'a.txt', 'v1\n', 'Add a.txt');
			writeFileSync(join(r.path, 'a.txt'), 'v2\n');
			writeFileSync(join(r.path, 'untracked.txt'), 'new\n');

			const stat = await r.provider.diff.getChangedFilesCount(r.path, 'HEAD', undefined, {
				includeUntracked: true,
				uris: ['a.txt'],
			});
			assert.ok(stat);
			assert.strictEqual(
				stat.files,
				1,
				'When a pathspec filter is active, untracked files must not be merged into the count',
			);
		} finally {
			r.cleanup();
		}
	});
});

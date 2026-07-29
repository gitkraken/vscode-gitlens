import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { uncommitted, uncommittedStaged } from '@gitlens/git/models/revision.js';
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

// Guards the assumption the review fix (#5586) rests on: `git diff` (working-vs-index) never contains
// untracked content, but after `git add -N` (intent-to-add) it does — and unstaging cleanly restores the
// untracked state. `getDiff(uncommitted)` maps to that unstaged `git diff`.
suite('DiffSubProvider.getDiff — untracked via intent-to-add (#5586)', () => {
	test('unstaged diff omits untracked files until intent-to-add staging, then restores', async () => {
		const r = createTestRepo();
		try {
			addCommit(r.path, 'tracked.txt', 'v1\n', 'Add tracked.txt');
			// An unstaged change to a tracked file + a brand-new untracked file.
			writeFileSync(join(r.path, 'tracked.txt'), 'v2\n');
			writeFileSync(join(r.path, 'untracked.txt'), 'brand new\n');

			const before = await r.provider.diff.getDiff?.(r.path, uncommitted);
			assert.ok(before?.contents, 'Expected an unstaged diff for the tracked change');
			assert.ok(before.contents.includes('tracked.txt'), 'Unstaged diff should include the tracked change');
			assert.ok(
				!before.contents.includes('untracked.txt'),
				'Root cause: untracked files are absent from the unstaged diff',
			);

			// Mirror the review fix: stage untracked with intent-to-add, then re-diff.
			const untracked = (await r.provider.status?.getUntrackedFiles(r.path))?.map(f => f.path) ?? [];
			assert.deepStrictEqual(untracked, ['untracked.txt'], 'Expected exactly the untracked file');
			await r.provider.staging?.stageFiles(r.path, untracked, { intentToAdd: true });

			const after = await r.provider.diff.getDiff?.(r.path, uncommitted);
			assert.ok(after?.contents, 'Expected an unstaged diff after intent-to-add staging');
			assert.ok(
				after.contents.includes('untracked.txt'),
				'After intent-to-add, the untracked file must appear in the unstaged diff',
			);
			assert.ok(after.contents.includes('brand new'), 'Untracked file contents must be present');
			assert.ok(after.contents.includes('tracked.txt'), 'Tracked change must still be present');

			// Cleanup restores the untracked state (working tree unchanged).
			await r.provider.staging?.unstageFiles(r.path, untracked);
			const restored = (await r.provider.status?.getUntrackedFiles(r.path))?.map(f => f.path) ?? [];
			assert.deepStrictEqual(restored, ['untracked.txt'], 'Unstaging must restore the file to untracked');
		} finally {
			r.cleanup();
		}
	});

	test('untracked-only working tree: unstaged diff is empty until intent-to-add (#5586 hard failure)', async () => {
		const r = createTestRepo();
		try {
			addCommit(r.path, 'a.txt', 'a\n', 'Add a.txt');
			writeFileSync(join(r.path, 'only-untracked.txt'), 'content\n');

			// No tracked changes → the unstaged diff is empty. This is what surfaced as "No changes found".
			const before = await r.provider.diff.getDiff?.(r.path, uncommitted);
			assert.ok(!before?.contents, 'With only untracked content, the unstaged diff is empty');

			const untracked = (await r.provider.status?.getUntrackedFiles(r.path))?.map(f => f.path) ?? [];
			await r.provider.staging?.stageFiles(r.path, untracked, { intentToAdd: true });

			const after = await r.provider.diff.getDiff?.(r.path, uncommitted);
			assert.ok(after?.contents, 'After intent-to-add, the untracked-only diff is non-empty');
			assert.ok(after.contents.includes('only-untracked.txt'), 'The untracked file must be reviewable');

			await r.provider.staging?.unstageFiles(r.path, untracked);
		} finally {
			r.cleanup();
		}
	});
});

// The review used to intent-to-add into the REAL index and unstage afterwards. That cost two defects: a user
// `git add` landing inside the window was silently reverted by the cleanup (#5604), and the write itself read
// as a working-tree change, so a finished review could mark itself stale (#5605). The fix stages into a
// scratch index (`createTemporaryIndex('current')`) and diffs against that, so the real index is never
// written. These guard the git-level behavior that makes that possible.
suite('DiffSubProvider.getDiff — untracked via a scratch index (#5604, #5605)', () => {
	function porcelain(repoPath: string): string {
		return execFileSync('git', ['status', '--porcelain'], { cwd: repoPath, encoding: 'utf-8' });
	}

	test('scratch-index intent-to-add surfaces untracked content and leaves the real index untouched', async () => {
		const r = createTestRepo();
		try {
			addCommit(r.path, 'staged.txt', 's1\n', 'Add staged.txt');
			addCommit(r.path, 'tracked.txt', 'v1\n', 'Add tracked.txt');
			// A pre-staged change (what the user stands to lose), an unstaged change, and an untracked file.
			writeFileSync(join(r.path, 'staged.txt'), 's2\n');
			execFileSync('git', ['add', 'staged.txt'], { cwd: r.path, stdio: 'pipe' });
			writeFileSync(join(r.path, 'tracked.txt'), 'v2\n');
			writeFileSync(join(r.path, 'untracked.txt'), 'brand new\n');

			const statusBefore = porcelain(r.path);

			const untracked = (await r.provider.status?.getUntrackedFiles(r.path))?.map(f => f.path) ?? [];
			assert.deepStrictEqual(untracked, ['untracked.txt'], 'Expected exactly the untracked file');

			const index = await r.provider.staging.createTemporaryIndex(r.path, 'current');
			try {
				await r.provider.staging.stageFiles(r.path, untracked, { index: index, intentToAdd: true });

				const diff = await r.provider.diff.getDiff?.(r.path, uncommitted, undefined, { index: index });
				assert.ok(diff?.contents, 'Expected an unstaged diff against the scratch index');
				assert.ok(diff.contents.includes('untracked.txt'), 'Untracked file must appear in the diff');
				assert.ok(diff.contents.includes('brand new'), 'Untracked file contents must be present');
				assert.ok(diff.contents.includes('tracked.txt'), 'The unstaged tracked change must still be present');
				assert.ok(
					!diff.contents.includes('staged.txt'),
					'The scratch index inherits the staged entry, so the staged change is not also unstaged',
				);

				// The whole point of #5604: the real index never saw the intent-to-add entry.
				assert.strictEqual(porcelain(r.path), statusBefore, 'The repository index must be unchanged');
			} finally {
				await index.dispose();
			}

			assert.strictEqual(porcelain(r.path), statusBefore, 'Disposal must not touch the repository index');
		} finally {
			r.cleanup();
		}
	});

	test('a concurrent user `git add` of the same untracked path survives the review window', async () => {
		const r = createTestRepo();
		try {
			writeFileSync(join(r.path, 'untracked.txt'), 'brand new\n');

			const untracked = (await r.provider.status?.getUntrackedFiles(r.path))?.map(f => f.path) ?? [];
			const index = await r.provider.staging.createTemporaryIndex(r.path, 'current');
			try {
				await r.provider.staging.stageFiles(r.path, untracked, { index: index, intentToAdd: true });

				// The user stages the same path mid-review — from the SCM view, a terminal, or elsewhere.
				execFileSync('git', ['add', 'untracked.txt'], { cwd: r.path, stdio: 'pipe' });

				await r.provider.diff.getDiff?.(r.path, uncommitted, undefined, { index: index });
			} finally {
				await index.dispose();
			}

			assert.strictEqual(
				porcelain(r.path),
				'A  untracked.txt\n',
				'The staging the user performed must still be in place after the review window closes',
			);
		} finally {
			r.cleanup();
		}
	});

	test(`'current' treats a repo with no index file as an empty index rather than throwing`, async () => {
		const r = createTestRepo();
		try {
			// A repo that has never staged anything has no `.git/index`; `createTemporaryIndex('current')`
			// must not fail there (it would silently drop untracked files from every review).
			rmSync(join(r.path, '.git', 'index'));

			const index = await r.provider.staging.createTemporaryIndex(r.path, 'current');
			const tempDir = dirname(index.path);
			try {
				assert.ok(!existsSync(index.path), 'A missing source index yields an (absent) empty temp index');

				writeFileSync(join(r.path, 'untracked.txt'), 'brand new\n');
				await r.provider.staging.stageFiles(r.path, ['untracked.txt'], {
					index: index,
					intentToAdd: true,
				});

				const diff = await r.provider.diff.getDiff?.(r.path, uncommitted, undefined, { index: index });
				assert.ok(diff?.contents?.includes('untracked.txt'), 'The untracked file must still be reviewable');
			} finally {
				await index.dispose();
			}

			assert.ok(!existsSync(tempDir), 'Disposal must remove the scratch index directory');
			assert.ok(!existsSync(join(r.path, '.git', 'index')), 'The repository index must not be recreated');
		} finally {
			r.cleanup();
		}
	});

	// #5605: the review's staging used to write the real index, and that write registers as a working-tree
	// change — enough to mark a just-finished review stale and to let a scoped-list refetch catch an untracked
	// row mid-stage, showing it as added. Content equality is too weak to guard that: a watcher fires on the
	// write, and git rewrites the index with identical content just to refresh its stat cache. So assert the
	// file is not WRITTEN — same mtime and same bytes across the whole review sequence.
	test('the review sequence performs no write at all to the repository index', async () => {
		const r = createTestRepo();
		try {
			addCommit(r.path, 'staged.txt', 's1\n', 'Add staged.txt');
			addCommit(r.path, 'tracked.txt', 'v1\n', 'Add tracked.txt');
			writeFileSync(join(r.path, 'staged.txt'), 's2\n');
			execFileSync('git', ['add', 'staged.txt'], { cwd: r.path, stdio: 'pipe' });
			writeFileSync(join(r.path, 'tracked.txt'), 'v2\n');
			writeFileSync(join(r.path, 'untracked.txt'), 'brand new\n');

			const indexPath = join(r.path, '.git', 'index');
			const stamp = () => {
				const { mtimeMs, size } = statSync(indexPath);
				return `${createHash('sha256').update(readFileSync(indexPath)).digest('hex')} ${mtimeMs} ${size}`;
			};

			// Settle first: the `git add` above leaves the stat cache stale, and the next status refreshes it by
			// rewriting the index once (identical content, new mtime). That write converges and is not the
			// review's doing — measuring from before it would blame the review for it.
			await r.provider.status?.getStatus(r.path, { force: true });
			const before = stamp();

			// Now the review's full unstaged-scope sequence.
			const untracked = (await r.provider.status?.getUntrackedFiles(r.path))?.map(f => f.path) ?? [];
			const index = await r.provider.staging.createTemporaryIndex(r.path, 'current');
			try {
				await r.provider.staging.stageFiles(r.path, untracked, { index: index, intentToAdd: true });
				const unstaged = await r.provider.diff.getDiff?.(r.path, uncommitted, undefined, { index: index });
				assert.ok(
					unstaged?.contents?.includes('untracked.txt'),
					'Sanity: the review must still be picking up untracked content',
				);
				// The staged half of a both-scopes review reads the real index.
				await r.provider.diff.getDiff?.(r.path, uncommittedStaged);
			} finally {
				await index.dispose();
			}

			assert.strictEqual(stamp(), before, 'The review must not write the repository index at all');
		} finally {
			r.cleanup();
		}
	});
});

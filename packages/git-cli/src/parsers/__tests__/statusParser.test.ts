import * as assert from 'assert';
import { GitFileConflictStatus, GitFileIndexStatus, GitFileWorkingTreeStatus } from '@gitlens/git/models/fileStatus.js';
import { formatDetachedHeadName } from '@gitlens/git/utils/branch.utils.js';
import { fileUri } from '@gitlens/utils/uri.js';
import { parseGitStatus } from '../statusParser.js';

const repoPath = '/repo';

suite('Status Parser Test Suite', () => {
	test('returns undefined for empty data', () => {
		const result = parseGitStatus('', repoPath, 1);
		assert.strictEqual(result, undefined, 'Should return undefined for empty string');
	});

	test('returns undefined for whitespace-only data', () => {
		const result = parseGitStatus('\n\n', repoPath, 1);
		assert.strictEqual(result, undefined, 'Should return undefined when no meaningful lines');
	});

	// V1 tests

	test('V1: parses branch and upstream from header', () => {
		const data = '## main...origin/main';

		const result = parseGitStatus(data, repoPath, 1);

		assert.ok(result, 'Should return a status');
		assert.strictEqual(result.branch, 'main', 'Should parse branch name');
		assert.ok(result.upstream, 'Should have upstream info');
		assert.strictEqual(result.upstream?.name, 'origin/main', 'Should parse upstream name');
	});

	test('V1: parses ahead and behind counts', () => {
		const data = '## main...origin/main [ahead 2, behind 1]';

		const result = parseGitStatus(data, repoPath, 1);

		assert.ok(result, 'Should return a status');
		assert.strictEqual(result.upstream?.state.ahead, 2, 'Should parse ahead count');
		assert.strictEqual(result.upstream?.state.behind, 1, 'Should parse behind count');
	});

	test('V1: parses ahead only', () => {
		const data = '## main...origin/main [ahead 3]';

		const result = parseGitStatus(data, repoPath, 1);

		assert.ok(result, 'Should return a status');
		assert.strictEqual(result.upstream?.state.ahead, 3, 'Should parse ahead count');
		assert.strictEqual(result.upstream?.state.behind, 0, 'Behind should be 0');
	});

	test('V1: parses behind only', () => {
		const data = '## main...origin/main [behind 5]';

		const result = parseGitStatus(data, repoPath, 1);

		assert.ok(result, 'Should return a status');
		assert.strictEqual(result.upstream?.state.ahead, 0, 'Ahead should be 0');
		assert.strictEqual(result.upstream?.state.behind, 5, 'Should parse behind count');
	});

	test('V1: handles gone upstream', () => {
		const data = '## main...origin/main [gone]';

		const result = parseGitStatus(data, repoPath, 1);

		assert.ok(result, 'Should return a status');
		assert.strictEqual(result.upstream?.missing, true, 'Should mark upstream as missing');
		assert.strictEqual(result.upstream?.state.ahead, 0, 'Ahead should be 0 for gone upstream');
		assert.strictEqual(result.upstream?.state.behind, 0, 'Behind should be 0 for gone upstream');
	});

	test('V1: without --branch (no ## line) still parses every file', () => {
		const data = [' M src/foo.ts', '?? src/new.ts'].join('\n');

		const result = parseGitStatus(data, repoPath, 1);

		assert.ok(result, 'Should return a status');
		assert.strictEqual(result.sha, '', 'v1 never carries a sha');
		assert.strictEqual(result.upstream, undefined, 'no upstream without a ## header');
		assert.strictEqual(result.files.length, 2, 'both files should still be parsed');
		assert.strictEqual(result.files[0].path, 'src/foo.ts');
		assert.strictEqual(result.files[1].path, 'src/new.ts');
	});

	test('V1: parses modified file', () => {
		const data = ['## main', ' M src/foo.ts'].join('\n');

		const result = parseGitStatus(data, repoPath, 1);

		assert.ok(result, 'Should return a status');
		assert.strictEqual(result.files.length, 1, 'Should have 1 file');
		assert.strictEqual(result.files[0].path, 'src/foo.ts', 'Should have correct path');
		assert.strictEqual(
			result.files[0].workingTreeStatus,
			GitFileWorkingTreeStatus.Modified,
			'Should be working tree modified',
		);
	});

	test('V1: parses index-added file', () => {
		const data = ['## main', 'A  src/new.ts'].join('\n');

		const result = parseGitStatus(data, repoPath, 1);

		assert.ok(result, 'Should return a status');
		assert.strictEqual(result.files.length, 1, 'Should have 1 file');
		assert.strictEqual(result.files[0].path, 'src/new.ts', 'Should have correct path');
		assert.strictEqual(result.files[0].indexStatus, GitFileIndexStatus.Added, 'Should be index added');
	});

	test('V1: parses untracked file', () => {
		const data = ['## main', '?? untracked.ts'].join('\n');

		const result = parseGitStatus(data, repoPath, 1);

		assert.ok(result, 'Should return a status');
		assert.strictEqual(result.files.length, 1, 'Should have 1 file');
		assert.strictEqual(result.files[0].path, 'untracked.ts', 'Should have correct path');
		assert.strictEqual(
			result.files[0].workingTreeStatus,
			GitFileWorkingTreeStatus.Untracked,
			'Should be untracked',
		);
	});

	test('V1: parses renamed file', () => {
		const data = ['## main', 'R  old.ts -> new.ts'].join('\n');

		const result = parseGitStatus(data, repoPath, 1);

		assert.ok(result, 'Should return a status');
		assert.strictEqual(result.files.length, 1, 'Should have 1 file');
		assert.strictEqual(result.files[0].path, 'new.ts', 'Should have the new path');
		assert.strictEqual(result.files[0].originalPath, 'old.ts', 'Should have the original path');
		assert.strictEqual(result.files[0].indexStatus, GitFileIndexStatus.Renamed, 'Should be renamed');
	});

	test('V1: parses renamed file with quoted paths containing spaces', () => {
		// Git quotes paths with spaces: "old path.ts" -> "new path.ts"
		// The parser strips quotes via replace(quoteRegex, '') before splitting on ' -> '
		const data = ['## main', 'R  "old path.ts" -> "new path.ts"'].join('\n');

		const result = parseGitStatus(data, repoPath, 1);

		assert.ok(result, 'Should return a status');
		assert.strictEqual(result.files.length, 1, 'Should have 1 file');
		assert.strictEqual(result.files[0].path, 'new path.ts', 'Should strip quotes from new path');
		assert.strictEqual(result.files[0].originalPath, 'old path.ts', 'Should strip quotes from old path');
		assert.strictEqual(result.files[0].indexStatus, GitFileIndexStatus.Renamed, 'Should be renamed');
	});

	test('V1: parses staged content change with a working-tree type change (MT)', () => {
		const data = ['## main', 'MT typechanged.ts'].join('\n');

		const result = parseGitStatus(data, repoPath, 1);

		assert.ok(result, 'Should return a status');
		assert.strictEqual(result.files.length, 1, 'Should have 1 file');
		assert.strictEqual(result.files[0].path, 'typechanged.ts', 'Should have correct path');
		assert.strictEqual(result.files[0].indexStatus, GitFileIndexStatus.Modified, 'Should be index modified');
		assert.strictEqual(
			result.files[0].workingTreeStatus,
			GitFileWorkingTreeStatus.TypeChanged,
			'Should be working tree type changed',
		);
	});

	test('V1: parses deleted file', () => {
		const data = ['## main', ' D removed.ts'].join('\n');

		const result = parseGitStatus(data, repoPath, 1);

		assert.ok(result, 'Should return a status');
		assert.strictEqual(result.files.length, 1, 'Should have 1 file');
		assert.strictEqual(result.files[0].path, 'removed.ts', 'Should have correct path');
		assert.strictEqual(
			result.files[0].workingTreeStatus,
			GitFileWorkingTreeStatus.Deleted,
			'Should be working tree deleted',
		);
	});

	// V2 tests

	test('V2: parses branch info headers', () => {
		const data = [
			'# branch.oid abc1234def5678',
			'# branch.head main',
			'# branch.upstream origin/main',
			'# branch.ab +2 -1',
		].join('\n');

		const result = parseGitStatus(data, repoPath, 2);

		assert.ok(result, 'Should return a status');
		assert.strictEqual(result.branch, 'main', 'Should parse branch name');
		assert.strictEqual(result.sha, 'abc1234def5678', 'Should parse SHA');
		assert.ok(result.upstream, 'Should have upstream');
		assert.strictEqual(result.upstream?.name, 'origin/main', 'Should parse upstream name');
		assert.strictEqual(result.upstream?.state.ahead, 2, 'Should parse ahead count');
		assert.strictEqual(result.upstream?.state.behind, 1, 'Should parse behind count');
		assert.strictEqual(result.upstream?.missing, false, 'Should not be missing when branch.ab is present');
	});

	test('V2: detached HEAD — branch.head is the literal `(detached)` token', () => {
		// Git prints `# branch.head (detached)` for ANY non-branch HEAD (plain detached, rebase,
		// bisect). `GitStatus` must classify it as detached and swap in the synthesized `(sha…)`
		// label — regression guard for the `isDetachedHead` narrowing that dropped this token.
		const data = ['# branch.oid abc1234def5678', '# branch.head (detached)'].join('\n');

		const result = parseGitStatus(data, repoPath, 2);

		assert.ok(result, 'Should return a status');
		assert.strictEqual(result.detached, true, 'Should be detached');
		assert.strictEqual(
			result.branch,
			formatDetachedHeadName('abc1234def5678'),
			'Should synthesize the detached label from the SHA',
		);
	});

	test('V2: missing upstream when no branch.ab header', () => {
		const data = ['# branch.oid abc1234', '# branch.head main', '# branch.upstream origin/gone-branch'].join('\n');

		const result = parseGitStatus(data, repoPath, 2);

		assert.ok(result, 'Should return a status');
		assert.strictEqual(result.upstream?.missing, true, 'Should be missing when no branch.ab header');
	});

	test('V2: without --branch (no # lines) still parses every file', () => {
		const data = ['1 .M N... 100644 100644 100644 abc1234 def5678 src/foo.ts', '? src/new.ts'].join('\n');

		const result = parseGitStatus(data, repoPath, 2);

		assert.ok(result, 'Should return a status');
		assert.strictEqual(result.sha, '', 'sha is empty without header lines');
		assert.strictEqual(result.upstream, undefined, 'no upstream without header lines');
		assert.strictEqual(result.files.length, 2, 'both files should still be parsed');
		assert.strictEqual(result.files[0].path, 'src/foo.ts');
		assert.strictEqual(result.files[1].path, 'src/new.ts');
	});

	test('V2: parses normal changed file (type 1)', () => {
		const data = [
			'# branch.oid abc1234',
			'# branch.head main',
			'1 .M N... 100644 100644 100644 abc1234 def5678 src/foo.ts',
		].join('\n');

		const result = parseGitStatus(data, repoPath, 2);

		assert.ok(result, 'Should return a status');
		assert.strictEqual(result.files.length, 1, 'Should have 1 file');
		assert.strictEqual(result.files[0].path, 'src/foo.ts', 'Should have correct path');
		assert.strictEqual(
			result.files[0].workingTreeStatus,
			GitFileWorkingTreeStatus.Modified,
			'Should be working tree modified',
		);
	});

	test('V2: parses renamed file (type 2)', () => {
		const data = [
			'# branch.oid abc1234',
			'# branch.head main',
			'2 R. N... 100644 100644 100644 abc1234 def5678 R100 new.ts\told.ts',
		].join('\n');

		const result = parseGitStatus(data, repoPath, 2);

		assert.ok(result, 'Should return a status');
		assert.strictEqual(result.files.length, 1, 'Should have 1 file');
		assert.strictEqual(result.files[0].path, 'new.ts', 'Should have new path');
		assert.strictEqual(result.files[0].originalPath, 'old.ts', 'Should have original path');
		assert.strictEqual(result.files[0].indexStatus, GitFileIndexStatus.Renamed, 'Should be renamed');
	});

	test('V2: parses untracked file', () => {
		const data = ['# branch.oid abc1234', '# branch.head main', '? untracked.ts'].join('\n');

		const result = parseGitStatus(data, repoPath, 2);

		assert.ok(result, 'Should return a status');
		assert.strictEqual(result.files.length, 1, 'Should have 1 file');
		assert.strictEqual(result.files[0].path, 'untracked.ts', 'Should have correct path');
		assert.strictEqual(
			result.files[0].workingTreeStatus,
			GitFileWorkingTreeStatus.Untracked,
			'Should be untracked',
		);
	});

	test('V2: parses unmerged file (type u)', () => {
		const data = [
			'# branch.oid abc1234',
			'# branch.head main',
			'u UU N... 100644 100644 100644 100644 abc1234 def5678 ghi9012 src/conflict.ts',
		].join('\n');

		const result = parseGitStatus(data, repoPath, 2);

		assert.ok(result, 'Should return a status');
		assert.strictEqual(result.files.length, 1, 'Should have 1 file');
		assert.strictEqual(result.files[0].path, 'src/conflict.ts', 'Should have correct path');
		assert.strictEqual(
			result.files[0].conflictStatus,
			GitFileConflictStatus.ModifiedByBoth,
			'Should be modified by both (UU)',
		);
		assert.strictEqual(result.files[0].conflicted, true, 'Should be marked as conflicted');
	});

	test('V2: parses multiple files of different types', () => {
		const data = [
			'# branch.oid abc1234',
			'# branch.head feature',
			'1 M. N... 100644 100644 100644 abc1234 def5678 src/modified.ts',
			'1 A. N... 000000 100644 100644 0000000 abc1234 src/added.ts',
			'? new-file.ts',
		].join('\n');

		const result = parseGitStatus(data, repoPath, 2);

		assert.ok(result, 'Should return a status');
		assert.strictEqual(result.files.length, 3, 'Should have 3 files');
	});

	test('V2: parses submodule change', () => {
		const data = [
			'# branch.oid abc1234',
			'# branch.head main',
			'1 .M S... 160000 160000 160000 abc1234 def5678 libs/submod',
		].join('\n');

		const result = parseGitStatus(data, repoPath, 2);

		assert.ok(result, 'Should return a status');
		assert.strictEqual(result.files.length, 1, 'Should have 1 file');
		assert.strictEqual(result.files[0].path, 'libs/submod', 'Should have correct submodule path');
		assert.ok(result.files[0].submodule, 'Should have submodule info');
		assert.strictEqual(result.files[0].submodule?.oid, 'def5678', 'Should have submodule oid');
	});

	test('V2: parses a type 1 path containing spaces', () => {
		const data = '1 .M N... 100644 100644 100644 abc1234 def5678 src/my folder/a b.ts';

		const result = parseGitStatus(data, repoPath, 2);

		assert.strictEqual(result?.files.length, 1);
		assert.strictEqual(result.files[0].path, 'src/my folder/a b.ts');
	});

	test('V2: parses a type 1 entry with 64-char hashes', () => {
		const h1 = 'a'.repeat(64);
		const h2 = 'b'.repeat(64);
		const data = `1 M. N... 100644 100644 100644 ${h1} ${h2} src/a b.ts`;

		const result = parseGitStatus(data, repoPath, 2);

		assert.strictEqual(result?.files.length, 1);
		assert.strictEqual(result.files[0].path, 'src/a b.ts');
		assert.strictEqual(result.files[0].indexStatus, GitFileIndexStatus.Modified);
	});

	test('V2: parses a rename where both paths contain spaces', () => {
		const data = '2 R. N... 100644 100644 100644 abc1234 def5678 R100 new dir/new name.ts\told dir/old name.ts';

		const result = parseGitStatus(data, repoPath, 2);

		assert.strictEqual(result?.files.length, 1);
		assert.strictEqual(result.files[0].path, 'new dir/new name.ts');
		assert.strictEqual(result.files[0].originalPath, 'old dir/old name.ts');
		assert.strictEqual(result.files[0].indexStatus, GitFileIndexStatus.Renamed);
	});

	test('V2: a rename without a tab has no original path', () => {
		const data = '2 R. N... 100644 100644 100644 abc1234 def5678 R100 new name.ts';

		const result = parseGitStatus(data, repoPath, 2);

		assert.strictEqual(result?.files[0].path, 'new name.ts');
		assert.strictEqual(result.files[0].originalPath, undefined);
	});

	test('V2: parses an unmerged path containing spaces', () => {
		const data = 'u UU N... 100644 100644 100644 100644 abc1234 def5678 ghi9012 src/con flict.ts';

		const result = parseGitStatus(data, repoPath, 2);

		assert.strictEqual(result?.files.length, 1);
		assert.strictEqual(result.files[0].path, 'src/con flict.ts');
		assert.strictEqual(result.files[0].submodule, undefined);
	});

	test('V2: parses an untracked path containing spaces', () => {
		const data = '? some dir/new file.ts';

		const result = parseGitStatus(data, repoPath, 2);

		assert.strictEqual(result?.files.length, 1);
		assert.strictEqual(result.files[0].path, 'some dir/new file.ts');
		assert.strictEqual(result.files[0].workingTreeStatus, GitFileWorkingTreeStatus.Untracked);
	});

	test('V2: keeps the trailing slash on an untracked nested repository', () => {
		const data = '? nested-repo/';

		const result = parseGitStatus(data, repoPath, 2);

		assert.strictEqual(result?.files[0].path, 'nested-repo/');
	});

	test('V2: reads submodule oids from a type 1 entry', () => {
		const data = '1 .M S.M. 160000 160000 160000 prev1234 curr5678 libs/sub mod';

		const result = parseGitStatus(data, repoPath, 2);

		assert.strictEqual(result?.files[0].path, 'libs/sub mod');
		assert.strictEqual(result.files[0].submodule?.oid, 'curr5678');
		assert.strictEqual(result.files[0].submodule?.previousOid, 'prev1234');
	});

	test('V2: reads submodule oids from an unmerged entry', () => {
		const data = 'u UU S... 160000 160000 160000 160000 base1111 ours2222 theirs3333 libs/sub';

		const result = parseGitStatus(data, repoPath, 2);

		assert.strictEqual(result?.files[0].path, 'libs/sub');
		assert.strictEqual(result.files[0].submodule?.oid, 'theirs3333');
		assert.strictEqual(result.files[0].submodule?.previousOid, 'base1111');
	});

	test('V2: skips ignored entries', () => {
		const data = ['! ignored.ts', '? kept.ts'].join('\n');

		const result = parseGitStatus(data, repoPath, 2);

		assert.strictEqual(result?.files.length, 1);
		assert.strictEqual(result.files[0].path, 'kept.ts');
	});

	test('builds each file uri from the repo path and file path', () => {
		const data = ['? src/a b.ts', '? nested-repo/'].join('\n');

		const result = parseGitStatus(data, repoPath, 2);

		assert.strictEqual(result?.files[0].uri.toString(), 'file:///repo/src/a%20b.ts');
		assert.strictEqual(result.files[1].uri.toString(), 'file:///repo/nested-repo');
	});

	test('uses getUri for file uris when given', () => {
		const data = '? src/a.ts';

		const result = parseGitStatus(data, repoPath, 2, p => fileUri(`/elsewhere/${p}`));

		assert.strictEqual(result?.files[0].uri.toString(), 'file:///elsewhere/src/a.ts');
	});

	test('normalizes repoPath in result', () => {
		const data = '## main';

		const result = parseGitStatus(data, '/repo/path', 1);

		assert.ok(result, 'Should return a status');
		assert.strictEqual(result.repoPath, '/repo/path', 'Should have normalized repoPath');
	});

	test('V1: handles branch with no upstream', () => {
		const data = ['## feature-branch', 'M  src/foo.ts'].join('\n');

		const result = parseGitStatus(data, repoPath, 1);

		assert.ok(result, 'Should return a status');
		assert.strictEqual(result.branch, 'feature-branch', 'Should parse branch name');
		assert.strictEqual(result.upstream, undefined, 'Should have no upstream');
	});
});

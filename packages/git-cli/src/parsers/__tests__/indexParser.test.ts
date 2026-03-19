import * as assert from 'assert';
import { GitFileConflictStatus } from '@gitlens/git/models/fileStatus.js';
import { parseGitConflictFiles, parseGitLsFilesStaged } from '../indexParser.js';

suite('Index Parser Test Suite', () => {
	suite('parseGitLsFilesStaged', () => {
		test('returns empty array for undefined data', () => {
			const result = parseGitLsFilesStaged(undefined, false);
			assert.deepStrictEqual(result, [], 'Should return empty array for undefined');
		});

		test('returns empty array for empty string data', () => {
			const result = parseGitLsFilesStaged('', false);
			assert.deepStrictEqual(result, [], 'Should return empty array for empty string');
		});

		test('parses a single entry with stage 0 (normal)', () => {
			const data = '100644 abc1234567890 0\tpath/to/file.ts\x00';

			const result = parseGitLsFilesStaged(data, false);

			assert.strictEqual(result.length, 1, 'Should parse one entry');
			assert.strictEqual(result[0].mode, '100644', 'Should have correct mode');
			assert.strictEqual(result[0].oid, 'abc1234567890', 'Should have correct oid');
			assert.strictEqual(result[0].path, 'path/to/file.ts', 'Should have correct path');
			assert.strictEqual(result[0].version, 'normal', 'Stage 0 should map to normal version');
		});

		test('maps stage numbers to correct versions', () => {
			const data = `${[
				'100644 aaa0000 0\tfile-normal.ts',
				'100644 bbb1111 1\tfile-base.ts',
				'100644 ccc2222 2\tfile-current.ts',
				'100644 ddd3333 3\tfile-incoming.ts',
			].join('\x00')}\x00`;

			const result = parseGitLsFilesStaged(data, false);

			assert.strictEqual(result.length, 4, 'Should parse four entries');
			assert.strictEqual(result[0].version, 'normal', 'Stage 0 should map to normal');
			assert.strictEqual(result[1].version, 'base', 'Stage 1 should map to base');
			assert.strictEqual(result[2].version, 'current', 'Stage 2 should map to current');
			assert.strictEqual(result[3].version, 'incoming', 'Stage 3 should map to incoming');
		});

		test('parses multiple entries', () => {
			const data = `${[
				'100644 aaa111 0\tsrc/index.ts',
				'100755 bbb222 0\tscripts/build.sh',
				'120000 ccc333 0\tlink/target',
			].join('\x00')}\x00`;

			const result = parseGitLsFilesStaged(data, false);

			assert.strictEqual(result.length, 3, 'Should parse three entries');
			assert.strictEqual(result[0].path, 'src/index.ts');
			assert.strictEqual(result[0].mode, '100644');
			assert.strictEqual(result[1].path, 'scripts/build.sh');
			assert.strictEqual(result[1].mode, '100755');
			assert.strictEqual(result[2].path, 'link/target');
			assert.strictEqual(result[2].mode, '120000');
		});

		test('works with singleEntry=true', () => {
			const data = '100644 abc1234 0\tsingle-file.ts\x00';

			const result = parseGitLsFilesStaged(data, true);

			assert.strictEqual(result.length, 1, 'Should parse one entry with singleEntry=true');
			assert.strictEqual(result[0].path, 'single-file.ts');
			assert.strictEqual(result[0].oid, 'abc1234');
		});

		test('skips lines without tab separator', () => {
			const data = 'malformed line without tab\x00100644 abc1234 0\tvalid/file.ts\x00';

			const result = parseGitLsFilesStaged(data, false);

			assert.strictEqual(result.length, 1, 'Should skip malformed lines');
			assert.strictEqual(result[0].path, 'valid/file.ts');
		});

		test('skips lines with incomplete metadata', () => {
			// Missing second space separating oid from stage
			const data = '100644 abc1234\tincomplete/file.ts\x00100644 def5678 0\tvalid/file.ts\x00';

			const result = parseGitLsFilesStaged(data, false);

			assert.strictEqual(result.length, 1, 'Should skip lines with incomplete metadata');
			assert.strictEqual(result[0].path, 'valid/file.ts');
		});
	});

	suite('parseGitConflictFiles', () => {
		const repoPath = '/repo';

		test('returns empty array for undefined data', () => {
			const result = parseGitConflictFiles(undefined, repoPath);
			assert.deepStrictEqual(result, [], 'Should return empty array for undefined');
		});

		test('returns empty array for empty string data', () => {
			const result = parseGitConflictFiles('', repoPath);
			assert.deepStrictEqual(result, [], 'Should return empty array for empty string');
		});

		test('parses a conflict file with all 3 stages (base+current+incoming = ModifiedByBoth)', () => {
			const data = `${[
				'100644 aaa111 1\tconflict.ts',
				'100644 bbb222 2\tconflict.ts',
				'100644 ccc333 3\tconflict.ts',
			].join('\x00')}\x00`;

			const result = parseGitConflictFiles(data, repoPath);

			assert.strictEqual(result.length, 1, 'Should group into one conflict file');
			assert.strictEqual(result[0].path, 'conflict.ts');
			assert.strictEqual(result[0].repoPath, repoPath);

			assert.ok(result[0].base, 'Should have base revision');
			assert.strictEqual(result[0].base?.oid, 'aaa111');
			assert.strictEqual(result[0].base?.version, 'base');

			assert.ok(result[0].current, 'Should have current revision');
			assert.strictEqual(result[0].current?.oid, 'bbb222');
			assert.strictEqual(result[0].current?.version, 'current');

			assert.ok(result[0].incoming, 'Should have incoming revision');
			assert.strictEqual(result[0].incoming?.oid, 'ccc333');
			assert.strictEqual(result[0].incoming?.version, 'incoming');

			assert.strictEqual(
				result[0].status,
				GitFileConflictStatus.ModifiedByBoth,
				'All 3 stages should be ModifiedByBoth (UU)',
			);
		});

		test('conflict status: current+incoming only = AddedByBoth (AA)', () => {
			const data = `${['100644 bbb222 2\tfile.ts', '100644 ccc333 3\tfile.ts'].join('\x00')}\x00`;

			const result = parseGitConflictFiles(data, repoPath);

			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0].base, undefined, 'Should have no base revision');
			assert.ok(result[0].current, 'Should have current revision');
			assert.ok(result[0].incoming, 'Should have incoming revision');
			assert.strictEqual(
				result[0].status,
				GitFileConflictStatus.AddedByBoth,
				'current+incoming should be AddedByBoth (AA)',
			);
		});

		test('conflict status: current only = AddedByUs (AU)', () => {
			const data = '100644 bbb222 2\tfile.ts\x00';

			const result = parseGitConflictFiles(data, repoPath);

			assert.strictEqual(result.length, 1);
			assert.ok(result[0].current, 'Should have current revision');
			assert.strictEqual(result[0].base, undefined);
			assert.strictEqual(result[0].incoming, undefined);
			assert.strictEqual(
				result[0].status,
				GitFileConflictStatus.AddedByUs,
				'current only should be AddedByUs (AU)',
			);
		});

		test('conflict status: incoming only = AddedByThem (UA)', () => {
			const data = '100644 ccc333 3\tfile.ts\x00';

			const result = parseGitConflictFiles(data, repoPath);

			assert.strictEqual(result.length, 1);
			assert.ok(result[0].incoming, 'Should have incoming revision');
			assert.strictEqual(result[0].base, undefined);
			assert.strictEqual(result[0].current, undefined);
			assert.strictEqual(
				result[0].status,
				GitFileConflictStatus.AddedByThem,
				'incoming only should be AddedByThem (UA)',
			);
		});

		test('conflict status: base+incoming = DeletedByUs (DU)', () => {
			const data = `${['100644 aaa111 1\tfile.ts', '100644 ccc333 3\tfile.ts'].join('\x00')}\x00`;

			const result = parseGitConflictFiles(data, repoPath);

			assert.strictEqual(result.length, 1);
			assert.ok(result[0].base);
			assert.strictEqual(result[0].current, undefined);
			assert.ok(result[0].incoming);
			assert.strictEqual(
				result[0].status,
				GitFileConflictStatus.DeletedByUs,
				'base+incoming should be DeletedByUs (DU)',
			);
		});

		test('conflict status: base+current = DeletedByThem (UD)', () => {
			const data = `${['100644 aaa111 1\tfile.ts', '100644 bbb222 2\tfile.ts'].join('\x00')}\x00`;

			const result = parseGitConflictFiles(data, repoPath);

			assert.strictEqual(result.length, 1);
			assert.ok(result[0].base);
			assert.ok(result[0].current);
			assert.strictEqual(result[0].incoming, undefined);
			assert.strictEqual(
				result[0].status,
				GitFileConflictStatus.DeletedByThem,
				'base+current should be DeletedByThem (UD)',
			);
		});

		test('parses multiple conflict files grouped by path', () => {
			const data = `${[
				'100644 aaa111 1\tfileA.ts',
				'100644 bbb222 2\tfileA.ts',
				'100644 ccc333 3\tfileA.ts',
				'100644 ddd444 2\tfileB.ts',
				'100644 eee555 3\tfileB.ts',
			].join('\x00')}\x00`;

			const result = parseGitConflictFiles(data, repoPath);

			assert.strictEqual(result.length, 2, 'Should group into two conflict files');

			const fileA = result.find(f => f.path === 'fileA.ts');
			assert.ok(fileA, 'Should have fileA');
			assert.strictEqual(
				fileA.status,
				GitFileConflictStatus.ModifiedByBoth,
				'fileA with all 3 stages should be ModifiedByBoth',
			);

			const fileB = result.find(f => f.path === 'fileB.ts');
			assert.ok(fileB, 'Should have fileB');
			assert.strictEqual(
				fileB.status,
				GitFileConflictStatus.AddedByBoth,
				'fileB with current+incoming should be AddedByBoth',
			);
		});

		test('sets repoPath on all conflict files', () => {
			const data = `${[
				'100644 aaa111 2\tfile1.ts',
				'100644 bbb222 3\tfile1.ts',
				'100644 ccc333 2\tfile2.ts',
				'100644 ddd444 3\tfile2.ts',
			].join('\x00')}\x00`;

			const customRepoPath = '/custom/repo/path';
			const result = parseGitConflictFiles(data, customRepoPath);

			assert.strictEqual(result.length, 2);
			for (const file of result) {
				assert.strictEqual(file.repoPath, customRepoPath, 'Each file should have the provided repoPath');
			}
		});

		test('revision fields have correct mode and version', () => {
			const data = `${['100644 aaa111 1\tfile.ts', '100755 bbb222 2\tfile.ts', '100644 ccc333 3\tfile.ts'].join(
				'\x00',
			)}\x00`;

			const result = parseGitConflictFiles(data, repoPath);

			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0].base?.mode, '100644', 'Base should have correct mode');
			assert.strictEqual(result[0].base?.version, 'base', 'Base should have base version');
			assert.strictEqual(result[0].current?.mode, '100755', 'Current should have correct mode');
			assert.strictEqual(result[0].current?.version, 'current', 'Current should have current version');
			assert.strictEqual(result[0].incoming?.mode, '100644', 'Incoming should have correct mode');
			assert.strictEqual(result[0].incoming?.version, 'incoming', 'Incoming should have incoming version');
		});
	});
});

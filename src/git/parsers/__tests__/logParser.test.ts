import * as assert from 'assert';
import { getCommitsLogParser } from '../logParser.js';

/**
 * Tests for the log parser's file parsing logic with --raw and --numstat output.
 *
 * The parser processes two types of output lines:
 * 1. --raw format: :<old_mode> <new_mode> <old_sha> <new_sha> <status>[score]\t<path>[\t<new_path>]
 * 2. --numstat format: <additions>\t<deletions>\t<path>
 *
 * The --raw lines provide mode info (crucial for submodule detection) and accurate status,
 * while --numstat provides line counts.
 */
suite('Log Parser - File Parsing Test Suite', () => {
	// Get the parser and its separators
	function getParserWithSeparators() {
		const parser = getCommitsLogParser(true);
		return {
			parser: parser,
			recordSep: parser.separators.record,
			fieldSep: parser.separators.field,
		};
	}

	// Helper to create a mock commit record with files
	// Format from commitsMapping: sha, author, authorEmail, authorDate, committer, committerEmail, committerDate, parents, tips, message
	// The file content comes as a separate field AFTER the message field
	function createCommitRecord(
		sha: string,
		rawLines: string[],
		numstatLines: string[],
		recordSep: string,
		fieldSep: string,
	): string {
		// File content: --raw lines first, then --numstat lines, separated by newlines
		const fileContent = [...rawLines, ...numstatLines].join('\n');

		// Format: recordSep + 10 mapped fields + 1 file content field, all separated by fieldSep
		// When fieldCount === keys.length (10), the parser reads the file content field
		const fields = [
			sha, // sha (field 0)
			'Test Author', // author (field 1)
			'test@example.com', // authorEmail (field 2)
			'1234567890', // authorDate (field 3)
			'Test Committer', // committer (field 4)
			'committer@example.com', // committerEmail (field 5)
			'1234567890', // committerDate (field 6)
			'', // parents (field 7)
			'', // tips (field 8)
			'Test commit message', // message (field 9)
			fileContent, // file content (field 10, parsed when fieldCount === 10)
		];
		return recordSep + fields.join(fieldSep);
	}

	test('parses regular file modification', () => {
		const { parser, recordSep, fieldSep } = getParserWithSeparators();

		const rawLine = ':100644 100644 abc1234 def5678 M\tsrc/file.ts';
		const numstatLine = '10\t5\tsrc/file.ts';

		const data = createCommitRecord('abc123', [rawLine], [numstatLine], recordSep, fieldSep);
		const entries = [...parser.parse(data)];

		assert.strictEqual(entries.length, 1, 'Should parse one commit');
		assert.strictEqual(entries[0].files?.length, 1, 'Should have one file');

		const file = entries[0].files[0];
		assert.strictEqual(file.path, 'src/file.ts', 'Should have correct path');
		assert.strictEqual(file.status, 'M', 'Should have modified status');
		assert.strictEqual(file.additions, 10, 'Should have correct additions');
		assert.strictEqual(file.deletions, 5, 'Should have correct deletions');
		assert.strictEqual(file.mode, '100644', 'Should have regular file mode');
		assert.strictEqual(file.originalPath, undefined, 'Should have no original path');
	});

	test('parses file addition', () => {
		const { parser, recordSep, fieldSep } = getParserWithSeparators();

		const rawLine = ':000000 100644 0000000 abc1234 A\tnew-file.ts';
		const numstatLine = '50\t0\tnew-file.ts';

		const data = createCommitRecord('abc123', [rawLine], [numstatLine], recordSep, fieldSep);
		const entries = [...parser.parse(data)];

		assert.strictEqual(entries.length, 1, 'Should parse one commit');
		const file = entries[0].files![0];
		assert.strictEqual(file.path, 'new-file.ts', 'Should have correct path');
		assert.strictEqual(file.status, 'A', 'Should have added status');
		assert.strictEqual(file.additions, 50, 'Should have correct additions');
		assert.strictEqual(file.deletions, 0, 'Should have zero deletions');
		assert.strictEqual(file.mode, '100644', 'Should have regular file mode');
	});

	test('parses file deletion', () => {
		const { parser, recordSep, fieldSep } = getParserWithSeparators();

		const rawLine = ':100644 000000 abc1234 0000000 D\told-file.ts';
		const numstatLine = '0\t30\told-file.ts';

		const data = createCommitRecord('abc123', [rawLine], [numstatLine], recordSep, fieldSep);
		const entries = [...parser.parse(data)];

		assert.strictEqual(entries.length, 1, 'Should parse one commit');
		const file = entries[0].files![0];
		assert.strictEqual(file.path, 'old-file.ts', 'Should have correct path');
		assert.strictEqual(file.status, 'D', 'Should have deleted status');
		assert.strictEqual(file.additions, 0, 'Should have zero additions');
		assert.strictEqual(file.deletions, 30, 'Should have correct deletions');
	});

	test('parses file rename', () => {
		const { parser, recordSep, fieldSep } = getParserWithSeparators();

		// --raw format for rename: old_path\tnew_path
		const rawLine = ':100644 100644 abc1234 abc1234 R100\told-name.ts\tnew-name.ts';
		// --numstat format for rename: {old => new} or explicit paths
		const numstatLine = '0\t0\t{old-name.ts => new-name.ts}';

		const data = createCommitRecord('abc123', [rawLine], [numstatLine], recordSep, fieldSep);
		const entries = [...parser.parse(data)];

		assert.strictEqual(entries.length, 1, 'Should parse one commit');
		const file = entries[0].files![0];
		assert.strictEqual(file.path, 'new-name.ts', 'Should have new path');
		assert.strictEqual(file.originalPath, 'old-name.ts', 'Should have original path from --raw');
		assert.strictEqual(file.status, 'R', 'Should have rename status');
	});

	test('parses file rename with path components', () => {
		const { parser, recordSep, fieldSep } = getParserWithSeparators();

		// Rename within directory: src/old.ts -> src/new.ts
		const rawLine = ':100644 100644 abc1234 abc1234 R095\tsrc/old.ts\tsrc/new.ts';
		const numstatLine = '5\t2\tsrc/{old.ts => new.ts}';

		const data = createCommitRecord('abc123', [rawLine], [numstatLine], recordSep, fieldSep);
		const entries = [...parser.parse(data)];

		const file = entries[0].files![0];
		assert.strictEqual(file.path, 'src/new.ts', 'Should have new path');
		assert.strictEqual(file.originalPath, 'src/old.ts', 'Should have original path');
		assert.strictEqual(file.status, 'R', 'Should have rename status');
		assert.strictEqual(file.additions, 5, 'Should have correct additions');
		assert.strictEqual(file.deletions, 2, 'Should have correct deletions');
	});

	test('parses file copy', () => {
		const { parser, recordSep, fieldSep } = getParserWithSeparators();

		const rawLine = ':100644 100644 abc1234 abc1234 C100\tsource.ts\tcopy.ts';
		const numstatLine = '0\t0\t{source.ts => copy.ts}';

		const data = createCommitRecord('abc123', [rawLine], [numstatLine], recordSep, fieldSep);
		const entries = [...parser.parse(data)];

		const file = entries[0].files![0];
		assert.strictEqual(file.path, 'copy.ts', 'Should have copy path');
		assert.strictEqual(file.originalPath, 'source.ts', 'Should have source path');
		assert.strictEqual(file.status, 'C', 'Should have copy status');
	});

	test('parses binary file (dash for stats)', () => {
		const { parser, recordSep, fieldSep } = getParserWithSeparators();

		const rawLine = ':100644 100644 abc1234 def5678 M\timage.png';
		// Binary files show "-" for additions and deletions
		const numstatLine = '-\t-\timage.png';

		const data = createCommitRecord('abc123', [rawLine], [numstatLine], recordSep, fieldSep);
		const entries = [...parser.parse(data)];

		const file = entries[0].files![0];
		assert.strictEqual(file.path, 'image.png', 'Should have correct path');
		assert.strictEqual(file.status, 'M', 'Should have modified status');
		assert.strictEqual(file.additions, 0, 'Should convert dash to 0 for additions');
		assert.strictEqual(file.deletions, 0, 'Should convert dash to 0 for deletions');
	});

	test('parses submodule (mode 160000)', () => {
		const { parser, recordSep, fieldSep } = getParserWithSeparators();

		// Submodules have mode 160000 (gitlink)
		const rawLine = ':160000 160000 abc1234 def5678 M\tlibs/submodule';
		const numstatLine = '1\t1\tlibs/submodule';

		const data = createCommitRecord('abc123', [rawLine], [numstatLine], recordSep, fieldSep);
		const entries = [...parser.parse(data)];

		const file = entries[0].files![0];
		assert.strictEqual(file.path, 'libs/submodule', 'Should have correct path');
		assert.strictEqual(file.status, 'M', 'Should have modified status');
		assert.strictEqual(file.mode, '160000', 'Should have submodule mode');
	});

	test('parses new submodule addition', () => {
		const { parser, recordSep, fieldSep } = getParserWithSeparators();

		const rawLine = ':000000 160000 0000000 abc1234 A\tlibs/new-submodule';
		const numstatLine = '1\t0\tlibs/new-submodule';

		const data = createCommitRecord('abc123', [rawLine], [numstatLine], recordSep, fieldSep);
		const entries = [...parser.parse(data)];

		const file = entries[0].files![0];
		assert.strictEqual(file.path, 'libs/new-submodule', 'Should have correct path');
		assert.strictEqual(file.status, 'A', 'Should have added status');
		assert.strictEqual(file.mode, '160000', 'Should have submodule mode');
	});

	test('parses executable file (mode 100755)', () => {
		const { parser, recordSep, fieldSep } = getParserWithSeparators();

		const rawLine = ':100755 100755 abc1234 def5678 M\tscripts/build.sh';
		const numstatLine = '5\t3\tscripts/build.sh';

		const data = createCommitRecord('abc123', [rawLine], [numstatLine], recordSep, fieldSep);
		const entries = [...parser.parse(data)];

		const file = entries[0].files![0];
		assert.strictEqual(file.path, 'scripts/build.sh', 'Should have correct path');
		assert.strictEqual(file.mode, '100755', 'Should have executable mode');
	});

	test('parses symlink (mode 120000)', () => {
		const { parser, recordSep, fieldSep } = getParserWithSeparators();

		const rawLine = ':120000 120000 abc1234 def5678 M\tlink-to-file';
		const numstatLine = '1\t1\tlink-to-file';

		const data = createCommitRecord('abc123', [rawLine], [numstatLine], recordSep, fieldSep);
		const entries = [...parser.parse(data)];

		const file = entries[0].files![0];
		assert.strictEqual(file.path, 'link-to-file', 'Should have correct path');
		assert.strictEqual(file.mode, '120000', 'Should have symlink mode');
	});

	test('parses mode change (type change)', () => {
		const { parser, recordSep, fieldSep } = getParserWithSeparators();

		// File changed from regular to executable
		const rawLine = ':100644 100755 abc1234 abc1234 T\tscript.sh';
		const numstatLine = '0\t0\tscript.sh';

		const data = createCommitRecord('abc123', [rawLine], [numstatLine], recordSep, fieldSep);
		const entries = [...parser.parse(data)];

		const file = entries[0].files![0];
		assert.strictEqual(file.path, 'script.sh', 'Should have correct path');
		assert.strictEqual(file.status, 'T', 'Should have type change status');
		assert.strictEqual(file.mode, '100755', 'Should have new mode (executable)');
	});

	test('parses multiple files in one commit', () => {
		const { parser, recordSep, fieldSep } = getParserWithSeparators();

		const rawLines = [
			':100644 100644 abc1234 def5678 M\tsrc/main.ts',
			':000000 100644 0000000 abc1234 A\tsrc/new.ts',
			':100644 000000 abc1234 0000000 D\tsrc/old.ts',
			':160000 160000 sub1234 sub5678 M\tlibs/submodule',
		];
		const numstatLines = ['10\t5\tsrc/main.ts', '50\t0\tsrc/new.ts', '0\t30\tsrc/old.ts', '1\t1\tlibs/submodule'];

		const data = createCommitRecord('abc123', rawLines, numstatLines, recordSep, fieldSep);
		const entries = [...parser.parse(data)];

		assert.strictEqual(entries.length, 1, 'Should parse one commit');
		assert.strictEqual(entries[0].files?.length, 4, 'Should have four files');

		// Verify each file
		const [main, newFile, oldFile, submodule] = entries[0].files;

		assert.strictEqual(main.path, 'src/main.ts');
		assert.strictEqual(main.status, 'M');
		assert.strictEqual(main.mode, '100644');

		assert.strictEqual(newFile.path, 'src/new.ts');
		assert.strictEqual(newFile.status, 'A');

		assert.strictEqual(oldFile.path, 'src/old.ts');
		assert.strictEqual(oldFile.status, 'D');

		assert.strictEqual(submodule.path, 'libs/submodule');
		assert.strictEqual(submodule.mode, '160000');
	});

	test('handles file path with spaces', () => {
		const { parser, recordSep, fieldSep } = getParserWithSeparators();

		const rawLine = ':100644 100644 abc1234 def5678 M\tpath with spaces/file name.ts';
		const numstatLine = '5\t3\tpath with spaces/file name.ts';

		const data = createCommitRecord('abc123', [rawLine], [numstatLine], recordSep, fieldSep);
		const entries = [...parser.parse(data)];

		const file = entries[0].files![0];
		assert.strictEqual(file.path, 'path with spaces/file name.ts', 'Should preserve spaces in path');
	});

	test('handles empty file content (no files in commit)', () => {
		const { parser, recordSep, fieldSep } = getParserWithSeparators();

		// Commit with no file changes (e.g., empty commit or merge commit)
		const data = createCommitRecord('abc123', [], [], recordSep, fieldSep);
		const entries = [...parser.parse(data)];

		assert.strictEqual(entries.length, 1, 'Should parse one commit');
		assert.strictEqual(entries[0].files?.length, 0, 'Should have zero files');
	});

	test('falls back to M status when no --raw info available', () => {
		const { parser, recordSep, fieldSep } = getParserWithSeparators();

		// Only numstat line, no raw line (edge case)
		const numstatLine = '10\t5\torphan-file.ts';

		const data = createCommitRecord('abc123', [], [numstatLine], recordSep, fieldSep);
		const entries = [...parser.parse(data)];

		const file = entries[0].files![0];
		assert.strictEqual(file.path, 'orphan-file.ts', 'Should have correct path');
		assert.strictEqual(file.status, 'M', 'Should default to M status');
		assert.strictEqual(file.mode, undefined, 'Should have undefined mode');
	});

	test('handles rename detected from numstat only', () => {
		const { parser, recordSep, fieldSep } = getParserWithSeparators();

		// Only numstat rename format, no raw line
		const numstatLine = '0\t0\t{old.ts => new.ts}';

		const data = createCommitRecord('abc123', [], [numstatLine], recordSep, fieldSep);
		const entries = [...parser.parse(data)];

		const file = entries[0].files![0];
		assert.strictEqual(file.path, 'new.ts', 'Should have new path');
		assert.strictEqual(file.originalPath, 'old.ts', 'Should detect original path from numstat');
		assert.strictEqual(file.status, 'R', 'Should infer R status from rename pattern');
	});

	test('prefers --raw originalPath over numstat format', () => {
		const { parser, recordSep, fieldSep } = getParserWithSeparators();

		// Raw provides clean paths, numstat has brace format
		const rawLine = ':100644 100644 abc1234 def5678 R100\tsrc/original.ts\tsrc/renamed.ts';
		const numstatLine = '5\t2\tsrc/{original.ts => renamed.ts}';

		const data = createCommitRecord('abc123', [rawLine], [numstatLine], recordSep, fieldSep);
		const entries = [...parser.parse(data)];

		const file = entries[0].files![0];
		assert.strictEqual(file.path, 'src/renamed.ts', 'Should have clean new path');
		assert.strictEqual(file.originalPath, 'src/original.ts', 'Should use clean originalPath from --raw');
	});
});

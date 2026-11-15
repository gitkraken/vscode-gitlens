import * as assert from 'assert';
import type { CommitsWithFilesLogParser, GraphLogParser } from '../logParser.js';
import {
	getCommitsLogParser,
	getGraphParser,
	getShaAndDatesWithFilesLogParser,
	getShaAndFileRangeLogParser,
	getShaAndFilesAndStatsLogParser,
	getShaAndFileSummaryLogParser,
} from '../logParser.js';

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

suite('Log Parser - Batched Async Parsing Test Suite', () => {
	function record(fields: string[]): string {
		return `\x1E${fields.join('\x1D')}\x1D`;
	}

	async function* streamOf(chunks: string[]): AsyncGenerator<string> {
		for (const c of chunks) {
			yield c;
		}
	}

	async function collect<T>(it: AsyncGenerator<T>): Promise<T[]> {
		const out: T[] = [];
		for await (const v of it) {
			out.push(v);
		}
		return out;
	}

	function chunk(s: string, size: number): string[] {
		const out: string[] = [];
		for (let i = 0; i < s.length; i += size) {
			out.push(s.substring(i, i + size));
		}
		return out;
	}

	// The graph mapping has 8 fields: sha, author, authorEmail, authorDate, committerDate, parents, tips, message
	const recs = [
		record(['sha1', 'Alice', 'a@x.com', '100', '101', 'p1 p2', 'HEAD -> main', 'first commit\n\nbody line']),
		record(['sha2', 'Bob', 'b@x.com', '200', '201', 'p3', '', 'second: with \x00 odd bytes']),
		record(['sha3', 'Carol', 'c@x.com', '300', '301', '', 'tag: v1', 'third']),
	];
	const input = recs.join('');

	test('batched parse equals per-record parse for every chunking', async () => {
		const parser = getGraphParser() as GraphLogParser;
		const expected = await collect(parser.parseAsync(streamOf([input])));
		assert.strictEqual(expected.length, 3);

		// Chunk sizes that split mid-record, mid-field, on separators, and single-byte
		for (const size of [1, 3, 7, 16, 64, input.length]) {
			const batches = await collect(parser.parseAsyncBatched!(streamOf(chunk(input, size))));
			const flat = batches.flat();
			assert.deepStrictEqual(flat, expected, `chunk size ${size} diverged`);
		}
	});

	test('empty records are skipped and a trailing record without a final separator parses', async () => {
		const parser = getGraphParser() as GraphLogParser;
		// Double record-separator (empty record) + final record missing its trailing content boundary
		const raw = `\x1E\x1E${record(['sha9', 'Dee', 'd@x.com', '900', '901', '', '', 'tail']).slice(1)}`;
		const expected = await collect(parser.parseAsync(streamOf([raw])));
		const batches = await collect(parser.parseAsyncBatched!(streamOf(chunk(raw, 5))));
		assert.deepStrictEqual(batches.flat(), expected);
	});
});

suite('Log Parser - Truncated Record Guard', () => {
	function record(fields: string[]): string {
		return `\x1E${fields.join('\x1D')}\x1D`;
	}

	async function* streamOf(chunks: string[]): AsyncGenerator<string> {
		for (const c of chunks) {
			yield c;
		}
	}

	async function collect<T>(it: AsyncGenerator<T>): Promise<T[]> {
		const out: T[] = [];
		for await (const v of it) {
			out.push(v);
		}
		return out;
	}

	// Graph mapping has 8 fields: sha, author, authorEmail, authorDate, committerDate, parents, tips, message
	const complete1 = record(['sha1', 'Alice', 'a@x.com', '100', '101', 'p1', 'HEAD -> main', 'first commit']);
	const complete2 = record(['sha2', 'Bob', 'b@x.com', '200', '201', '', '', 'second commit']);
	// All fields terminated except the last (message), which is missing its trailing separator - simulates a
	// cancelled/early-closed stream that stopped mid-message.
	const truncatedMidMessage = '\x1Esha3\x1DCarol\x1Dc@x.com\x1D300\x1D301\x1D\x1D\x1Dthird commit partial';
	// Stream ends right after the sha field's separator - truncated well before the message.
	const truncatedEarlyField = '\x1Esha4\x1D';

	test('parseAsyncBatched drops a truncated mid-message tail, keeps preceding complete records', async () => {
		const parser = getGraphParser() as GraphLogParser;
		const batches = await collect(
			parser.parseAsyncBatched!(streamOf([complete1 + complete2 + truncatedMidMessage])),
		);
		const flat = batches.flat();
		assert.strictEqual(flat.length, 2, 'Truncated tail must be dropped');
		assert.deepStrictEqual(
			flat.map(e => e.sha),
			['sha1', 'sha2'],
		);
	});

	test('parseAsyncBatched control: a complete final record without a trailing record separator is parsed', async () => {
		const parser = getGraphParser() as GraphLogParser;
		const finalComplete = record(['sha3', 'Carol', 'c@x.com', '300', '301', '', '', 'third commit']);
		const batches = await collect(parser.parseAsyncBatched!(streamOf([complete1 + complete2 + finalComplete])));
		const flat = batches.flat();
		assert.strictEqual(flat.length, 3, 'A genuinely complete trailing record must still be parsed');
		assert.strictEqual(flat[2].message, 'third commit');
	});

	test('parseAsync drops a truncated mid-message tail, keeps preceding complete records', async () => {
		const parser = getGraphParser() as GraphLogParser;
		const entries = await collect(parser.parseAsync(streamOf([complete1 + complete2 + truncatedMidMessage])));
		assert.strictEqual(entries.length, 2, 'Truncated tail must be dropped');
		assert.deepStrictEqual(
			entries.map(e => e.sha),
			['sha1', 'sha2'],
		);
	});

	test('parseAsync control: a complete final record without a trailing record separator is parsed', async () => {
		const parser = getGraphParser() as GraphLogParser;
		const finalComplete = record(['sha3', 'Carol', 'c@x.com', '300', '301', '', '', 'third commit']);
		const entries = await collect(parser.parseAsync(streamOf([complete1 + complete2 + finalComplete])));
		assert.strictEqual(entries.length, 3);
		assert.strictEqual(entries[2].message, 'third commit');
	});

	test('parseAsync drops a record truncated right after the first field separator', async () => {
		const parser = getGraphParser() as GraphLogParser;
		const entries = await collect(parser.parseAsync(streamOf([complete1 + truncatedEarlyField])));
		assert.strictEqual(entries.length, 1, 'Early truncation must be dropped');
		assert.strictEqual(entries[0].sha, 'sha1');
	});

	test('parseAsync (commits with files/stats) drops a truncated trailing commit', async () => {
		const parser = getCommitsLogParser(true) as CommitsWithFilesLogParser;
		// commitsMapping has 10 fields: sha, author, authorEmail, authorDate, committer, committerEmail,
		// committerDate, parents, tips, message
		const completeCommit = record([
			'sha1',
			'Alice',
			'a@x.com',
			'100',
			'Alice',
			'a@x.com',
			'101',
			'',
			'',
			'first commit',
		]);
		const truncatedCommit =
			'\x1Esha2\x1DBob\x1Db@x.com\x1D200\x1DBob\x1Db@x.com\x1D201\x1D\x1D\x1Dsecond commit partial';
		const entries = await collect(parser.parseAsync(streamOf([completeCommit + truncatedCommit])));
		assert.strictEqual(entries.length, 1, 'Truncated commit must be dropped');
		assert.strictEqual(entries[0].sha, 'sha1');
	});
});

suite('Log Parser - Commit With Very Many Files Test Suite', () => {
	const fileCount = 200_000;

	async function* streamOf(chunks: string[]): AsyncGenerator<string> {
		for (const c of chunks) {
			yield c;
		}
	}

	function buildRawAndNumstat(): string {
		const raw: string[] = [];
		const numstat: string[] = [];
		for (let i = 0; i < fileCount; i++) {
			raw.push(`:000000 100644 0000000 abc1234 A\tdir/file${i}.txt`);
			numstat.push(`1\t0\tdir/file${i}.txt`);
		}
		return [...raw, ...numstat].join('\n');
	}

	function buildCommitsRecord(): string {
		const parser = getCommitsLogParser(true);
		const fields = [
			'abc123',
			'Test Author',
			'test@example.com',
			'1234567890',
			'Test Committer',
			'committer@example.com',
			'1234567890',
			'',
			'',
			'Test commit message',
			buildRawAndNumstat(),
		];
		return parser.separators.record + fields.join(parser.separators.field);
	}

	test('parse keeps every file of a commit touching 200k files', () => {
		const parser = getCommitsLogParser(true);
		const entries = [...parser.parse(buildCommitsRecord())];

		assert.strictEqual(entries.length, 1);
		assert.strictEqual(entries[0].files?.length, fileCount);
		assert.strictEqual(entries[0].files?.[fileCount - 1].path, `dir/file${fileCount - 1}.txt`);
	});

	test('parseAsync keeps every file of a commit touching 200k files', async () => {
		const parser = getCommitsLogParser(true);
		const entries = [];
		for await (const e of parser.parseAsync(streamOf([buildCommitsRecord()]))) {
			entries.push(e);
		}

		assert.strictEqual(entries.length, 1);
		assert.strictEqual(entries[0].files?.length, fileCount);
	});

	test('file-summary parse keeps every file of a commit touching 200k files', () => {
		const parser = getShaAndFileSummaryLogParser();
		const lines: string[] = [];
		for (let i = 0; i < fileCount; i++) {
			lines.push(` create mode 100644 dir/file${i}.txt`);
		}
		const data = `${parser.separators.record}abc123${parser.separators.field}\n${lines.join('\n')}`;
		const entries = [...parser.parse(data)];

		assert.strictEqual(entries.length, 1);
		assert.strictEqual(entries[0].files.length, fileCount);
	});
});

suite('Log Parser - File Range Test Suite', () => {
	function parseRange(patch: string) {
		const parser = getShaAndFileRangeLogParser();
		const data = `${parser.separators.record}abc123${parser.separators.field}\n\n${patch}`;
		const entries = [...parser.parse(data)];
		assert.strictEqual(entries.length, 1);
		return entries[0].files[0];
	}

	test('reads the path and range of an ordinary file', () => {
		const file = parseRange(
			[
				'diff --git a/src/foo.ts b/src/foo.ts',
				'--- a/src/foo.ts',
				'+++ b/src/foo.ts',
				'@@ -2,3 +4,5 @@',
				' x',
			].join('\n'),
		);

		assert.strictEqual(file.path, 'src/foo.ts');
		assert.strictEqual(file.originalPath, undefined);
		assert.strictEqual(file.status, 'M');
		assert.deepStrictEqual(file.range, { startLine: 4, endLine: 8 });
		assert.deepStrictEqual(file.originalRange, { startLine: 2, endLine: 4 });
	});

	test('reads the path of a file holding " b/"', () => {
		const file = parseRange(
			[
				'diff --git a/Plan b/notes.md b/Plan b/notes.md',
				'--- a/Plan b/notes.md\t',
				'+++ b/Plan b/notes.md\t',
				'@@ -1 +1,2 @@',
				' x',
			].join('\n'),
		);

		assert.strictEqual(file.path, 'Plan b/notes.md');
	});

	test('reads the path of a file git C-quotes', () => {
		const file = parseRange(
			[
				'diff --git "a/q\\"uote\\ttab.txt" "b/q\\"uote\\ttab.txt"',
				'--- "a/q\\"uote\\ttab.txt"',
				'+++ "b/q\\"uote\\ttab.txt"',
				'@@ -1 +1,2 @@',
				' x',
			].join('\n'),
		);

		assert.strictEqual(file.path, 'q"uote\ttab.txt');
	});
});

// Output of `git log` as git writes it with `core.quotepath=false`, which C-quotes a name holding a `"`, `\`, tab or
// newline and leaves a non-ASCII name raw
suite('Log Parser - Quoted Paths Test Suite', () => {
	suite('files and stats (--numstat --raw)', () => {
		function parseFiles(lines: string[]) {
			const parser = getShaAndFilesAndStatsLogParser();
			const data = `${parser.separators.record}abc123${parser.separators.field}\n\n${lines.join('\n')}`;
			const entries = [...parser.parse(data)];
			assert.strictEqual(entries.length, 1);
			return entries[0].files;
		}

		test('unquotes a double quote, a backslash, a tab, a newline and a space', () => {
			const files = parseFiles([
				':100644 100644 587be6b b77b4eb M\t"back\\\\slash.txt"',
				':100644 100644 587be6b b77b4eb M\t"new\\nline.txt"',
				':100644 100644 587be6b b77b4eb M\t"q\\"uote.txt"',
				':100644 100644 587be6b b77b4eb M\tsp ace.txt',
				':100644 100644 587be6b b77b4eb M\t"tab\\there.txt"',
				':100644 100644 587be6b b77b4eb M\tcafé 日本.txt',
				'1\t0\t"back\\\\slash.txt"',
				'2\t1\t"new\\nline.txt"',
				'3\t0\t"q\\"uote.txt"',
				'4\t0\tsp ace.txt',
				'5\t2\t"tab\\there.txt"',
				'6\t0\tcafé 日本.txt',
			]);

			assert.deepStrictEqual(
				files.map(f => [f.path, f.status, f.additions, f.deletions, f.mode]),
				[
					['back\\slash.txt', 'M', 1, 0, '100644'],
					['new\nline.txt', 'M', 2, 1, '100644'],
					['q"uote.txt', 'M', 3, 0, '100644'],
					['sp ace.txt', 'M', 4, 0, '100644'],
					['tab\there.txt', 'M', 5, 2, '100644'],
					['café 日本.txt', 'M', 6, 0, '100644'],
				],
			);
		});

		test('unquotes octal escapes', () => {
			const files = parseFiles([
				':000000 100644 0000000 3e75765 A\t"caf\\303\\251 ctl\\001.txt"',
				'1\t0\t"caf\\303\\251 ctl\\001.txt"',
			]);

			assert.strictEqual(files[0].path, 'café ctl\x01.txt');
			assert.strictEqual(files[0].status, 'A');
		});

		test('reads a deletion and an addition of a quoted path', () => {
			const files = parseFiles([
				':100644 000000 587be6b 0000000 D\t"move \\"me\\".txt"',
				':000000 100644 0000000 3e75765 A\t"new \\"n\\".txt"',
				'0\t1\t"move \\"me\\".txt"',
				'1\t0\t"new \\"n\\".txt"',
			]);

			assert.deepStrictEqual(
				files.map(f => [f.path, f.status, f.additions, f.deletions]),
				[
					['move "me".txt', 'D', 0, 1],
					['new "n".txt', 'A', 1, 0],
				],
			);
		});

		test('reads a rename to a quoted path, whose numstat drops the compact form', () => {
			const files = parseFiles([
				':100644 100644 587be6b 587be6b R100\tdel me.txt\t"moved \\"it\\".txt"',
				'0\t0\tdel me.txt => "moved \\"it\\".txt"',
			]);

			assert.strictEqual(files[0].path, 'moved "it".txt');
			assert.strictEqual(files[0].originalPath, 'del me.txt');
			assert.strictEqual(files[0].status, 'R');
		});

		test('reads a rename of a quoted path to a name that is not', () => {
			const files = parseFiles([
				':100644 100644 71ac1b5 71ac1b5 R100\t"dir b/q\\"uote.txt"\tdir b/plain.txt',
				'0\t0\t"dir b/q\\"uote.txt" => dir b/plain.txt',
			]);

			assert.strictEqual(files[0].path, 'dir b/plain.txt');
			assert.strictEqual(files[0].originalPath, 'dir b/q"uote.txt');
		});

		test('reads a rename between quoted paths', () => {
			const files = parseFiles([
				':100644 100644 71ac1b5 71ac1b5 R100\t"dir b/q\\"uote.txt"\t"dir b/r\\"ename.txt"',
				'0\t0\t"dir b/q\\"uote.txt" => "dir b/r\\"ename.txt"',
			]);

			assert.strictEqual(files[0].path, 'dir b/r"ename.txt');
			assert.strictEqual(files[0].originalPath, 'dir b/q"uote.txt');
			assert.strictEqual(files[0].status, 'R');
		});

		test('keeps the backslashes of a rename between quoted paths', () => {
			const files = parseFiles([
				':100644 100644 587be6b 587be6b R100\t"back\\\\slash.txt"\t"back\\\\slash2.txt"',
				'0\t0\t"back\\\\slash.txt" => "back\\\\slash2.txt"',
			]);

			assert.deepStrictEqual(
				files.map(f => [f.path, f.originalPath, f.status, f.mode]),
				[['back\\slash2.txt', 'back\\slash.txt', 'R', '100644']],
			);
		});

		test('keeps the whitespace inside a quoted name and trims an unquoted one', () => {
			// `git log --numstat --raw` of a commit adding `\tlead.txt`, `q"trail ` and `plain trail ` and renaming
			// `\tren from.txt` to `q"ren to `
			const files = parseFiles([
				':000000 100644 0000000 9115e30 A\t"\\tlead.txt"',
				':000000 100644 0000000 b9bca01 A\tplain trail ',
				':100644 100644 71ac1b5 71ac1b5 R100\t"\\tren from.txt"\t"q\\"ren to "',
				':000000 100644 0000000 0781fd5 A\t"q\\"trail "',
				'1\t0\t"\\tlead.txt"',
				'1\t0\tplain trail ',
				'0\t0\t"\\tren from.txt" => "q\\"ren to "',
				'1\t0\t"q\\"trail "',
			]);

			assert.deepStrictEqual(
				files.map(f => [f.path, f.originalPath, f.status, f.mode]),
				[
					['\tlead.txt', undefined, 'A', '100644'],
					['plain trail', undefined, 'A', '100644'],
					['q"ren to ', '\tren from.txt', 'R', '100644'],
					['q"trail ', undefined, 'A', '100644'],
				],
			);
		});

		test('reads a quoted name that holds " => "', () => {
			const files = parseFiles([
				':100644 100644 587be6b b77b4eb M\t"a => \\"b\\".txt"',
				'1\t0\t"a => \\"b\\".txt"',
			]);

			assert.strictEqual(files.length, 1);
			assert.strictEqual(files[0].path, 'a => "b".txt');
			assert.strictEqual(files[0].originalPath, undefined);
		});

		test('reads a rename that git did not quote as before', () => {
			const files = parseFiles([
				':100644 100644 71ac1b5 71ac1b5 R100\tdir b/x.txt\tdir b/y.txt',
				'0\t0\tdir b/{x.txt => y.txt}',
			]);

			assert.strictEqual(files[0].path, 'dir b/y.txt');
			assert.strictEqual(files[0].originalPath, 'dir b/x.txt');
		});
	});

	suite('file summary (--summary)', () => {
		function parseSummary(lines: string[]) {
			const parser = getShaAndFileSummaryLogParser();
			const data = `${parser.separators.record}abc123${parser.separators.field}\n\n${lines.join('\n')}`;
			const entries = [...parser.parse(data)];
			assert.strictEqual(entries.length, 1);
			return entries[0].files;
		}

		test('unquotes created and deleted paths', () => {
			const files = parseSummary([
				' create mode 100644 "new \\"n\\".txt"',
				' delete mode 100644 "move \\"me\\".txt"',
				' create mode 100644 "tab\\there\\\\x.txt"',
				' create mode 100644 "new\\nline.txt"',
				' create mode 100644 Plan b/sp ace.txt',
				' mode change 100644 => 100755 "q\\"uote.sh"',
			]);

			assert.deepStrictEqual(
				files.map(f => [f.path, f.status]),
				[
					['new "n".txt', 'A'],
					['move "me".txt', 'D'],
					['tab\there\\x.txt', 'A'],
					['new\nline.txt', 'A'],
					['Plan b/sp ace.txt', 'A'],
				],
			);
		});

		test('reads renames in which git quoted a name', () => {
			const files = parseSummary([
				' rename del me.txt => "moved \\"it\\".txt" (100%)',
				' rename "dir b/q\\"uote.txt" => "dir b/r\\"ename.txt" (88%)',
				' copy "dir b/q\\"uote.txt" => dir b/plain.txt (100%)',
				' rename dir b/{x.txt => y.txt} (100%)',
				' rename "back\\\\slash.txt" => "back\\\\slash2.txt" (100%)',
			]);

			assert.deepStrictEqual(
				files.map(f => [f.path, f.originalPath, f.status]),
				[
					['moved "it".txt', 'del me.txt', 'R'],
					['dir b/r"ename.txt', 'dir b/q"uote.txt', 'R'],
					['dir b/plain.txt', 'dir b/q"uote.txt', 'C'],
					['dir b/y.txt', 'dir b/x.txt', 'R'],
					['back\\slash2.txt', 'back\\slash.txt', 'R'],
				],
			);
		});
	});

	suite('file names (--name-only)', () => {
		test('unquotes names git quotes', () => {
			const parser = getShaAndDatesWithFilesLogParser();
			const { record, field } = parser.separators;
			const names = [
				'Plan b/notes.md',
				'"back\\\\slash.txt"',
				'"moved \\"it\\".txt"',
				'"new\\nline.txt"',
				'"tab\\there.txt"',
				'café 日本.txt',
			];
			const entries = [...parser.parse(`${record}abc123${field}1${field}2${field}\n\n${names.join('\n')}`)];

			assert.strictEqual(entries.length, 1);
			assert.deepStrictEqual(
				entries[0].files.map(f => f.path),
				[
					'Plan b/notes.md',
					'back\\slash.txt',
					'moved "it".txt',
					'new\nline.txt',
					'tab\there.txt',
					'café 日本.txt',
				],
			);
		});
	});
});

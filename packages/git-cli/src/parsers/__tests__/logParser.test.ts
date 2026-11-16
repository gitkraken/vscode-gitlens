import * as assert from 'assert';
import type {
	CommitsInFileRangeLogParser,
	CommitsLogParser,
	CommitsWithFilesLogParser,
	GraphLogParser,
} from '../logParser.js';
import {
	getCommitsLogParser,
	getContributorsLogParser,
	getGraphParser,
	getShaAndDatesWithFilesLogParser,
	getShaAndFilesAndStatsLogParser,
	getShaAndFileSummaryLogParser,
	getShaAndStatsLogParser,
	getStashFilesOnlyLogParser,
	getStashLogParser,
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
		return `\0\x1E${fields.join('\0\x1D')}\0\x1D`;
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
		const raw = `\0\x1E\0\x1E${record(['sha9', 'Dee', 'd@x.com', '900', '901', '', '', 'tail']).slice(1)}`;
		const expected = await collect(parser.parseAsync(streamOf([raw])));
		const batches = await collect(parser.parseAsyncBatched!(streamOf(chunk(raw, 5))));
		assert.deepStrictEqual(batches.flat(), expected);
	});
});

suite('Log Parser - Truncated Record Guard', () => {
	function record(fields: string[]): string {
		return `\0\x1E${fields.join('\0\x1D')}\0\x1D`;
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
	const truncatedMidMessage =
		'\0\x1Esha3\0\x1DCarol\0\x1Dc@x.com\0\x1D300\0\x1D301\0\x1D\0\x1D\0\x1Dthird commit partial';
	// Stream ends right after the sha field's separator - truncated well before the message.
	const truncatedEarlyField = '\0\x1Esha4\0\x1D';

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
			'\0\x1Esha2\0\x1DBob\0\x1Db@x.com\0\x1D200\0\x1DBob\0\x1Db@x.com\0\x1D201\0\x1D\0\x1D\0\x1Dsecond commit partial';
		const entries = await collect(parser.parseAsync(streamOf([completeCommit + truncatedCommit])));
		assert.strictEqual(entries.length, 1, 'Truncated commit must be dropped');
		assert.strictEqual(entries[0].sha, 'sha1');
	});
});

// #5659 — free text (messages, names, refs, reflog subjects) can contain bare 0x1E/0x1D. They must not
// split a record or shift its fields in any parser variant.
suite('Log Parser - Embedded Separator Characters (#5659)', () => {
	const evilMessage = 'subject \x1E with a record sep\n\nbody \x1D with a field sep \x1E\x1D\n';
	const evilAuthor = 'Ev\x1Eil \x1DName';
	const evilTips = 'HEAD -> main\x1E, tag: v\x1D1';

	async function* streamOf(chunks: string[]): AsyncGenerator<string> {
		for (const c of chunks) {
			yield c;
		}
	}

	async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
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

	function record(separators: { record: string; field: string }, fields: string[], trailing = ''): string {
		return `${separators.record}${fields.join(separators.field)}${separators.field}${trailing}`;
	}

	// commitsMapping: sha, author, authorEmail, authorDate, committer, committerEmail, committerDate, parents, tips, message
	function commitFields(sha: string): string[] {
		return [sha, evilAuthor, 'e@x.com', '100', evilAuthor, 'e@x.com', '101', 'p1', evilTips, evilMessage];
	}

	function assertCommit(entry: Record<string, unknown> | undefined, sha: string): void {
		assert.ok(entry, `Missing entry for ${sha}`);
		assert.strictEqual(entry.sha, sha);
		assert.strictEqual(entry.author, evilAuthor);
		assert.strictEqual(entry.committer, evilAuthor);
		assert.strictEqual(entry.tips, evilTips);
		assert.strictEqual(entry.message, evilMessage);
		assert.strictEqual(entry.parents, 'p1');
	}

	test('separators are multi-char sentinels, not a bare 0x1E/0x1D', () => {
		const parser = getCommitsLogParser(false);
		assert.strictEqual(parser.separators.record, '\0\x1E');
		assert.strictEqual(parser.separators.field, '\0\x1D');
		assert.ok(parser.arguments[0].startsWith('--format=%x00%x1E%H%x00%x1D'), parser.arguments[0]);
	});

	test('parse (sync, used for limit:1 lookups) keeps a commit with embedded separators intact', () => {
		const parser = getCommitsLogParser(false) as CommitsLogParser;
		const data = record(parser.separators, commitFields('sha1')) + record(parser.separators, commitFields('sha2'));
		const entries = [...parser.parse(data)];
		assert.strictEqual(entries.length, 2);
		assertCommit(entries[0], 'sha1');
		assertCommit(entries[1], 'sha2');
	});

	test('parseAsync keeps a commit with embedded separators intact across chunkings', async () => {
		const parser = getCommitsLogParser(false) as CommitsLogParser;
		const data = record(parser.separators, commitFields('sha1')) + record(parser.separators, commitFields('sha2'));
		for (const size of [1, 2, 3, 7, data.length]) {
			const entries = await collect(parser.parseAsync(streamOf(chunk(data, size))));
			assert.strictEqual(entries.length, 2, `chunk size ${size}`);
			assertCommit(entries[0], 'sha1');
			assertCommit(entries[1], 'sha2');
		}
	});

	test('parseAsyncBatched (graph) keeps a commit with embedded separators intact across chunkings', async () => {
		const parser = getGraphParser() as GraphLogParser;
		// graphMapping: sha, author, authorEmail, authorDate, committerDate, parents, tips, message
		const fields = (sha: string) => [sha, evilAuthor, 'e@x.com', '100', '101', 'p1', evilTips, evilMessage];
		const data = record(parser.separators, fields('sha1')) + record(parser.separators, fields('sha2'));
		const expected = await collect(parser.parseAsync(streamOf([data])));
		assert.strictEqual(expected.length, 2);
		assert.strictEqual(expected[0].message, evilMessage);
		assert.strictEqual(expected[1].tips, evilTips);
		// Sizes 1 and 2 split the 2-char sentinels themselves across chunks
		for (const size of [1, 2, 3, 7, data.length]) {
			const batches = await collect(parser.parseAsyncBatched!(streamOf(chunk(data, size))));
			assert.deepStrictEqual(batches.flat(), expected, `chunk size ${size} diverged`);
		}
	});

	test('files+stats variant (parse and parseAsync) keeps fields and files intact', async () => {
		const parser = getCommitsLogParser(true) as CommitsWithFilesLogParser;
		const files = '\n\n:100644 100644 abc1234 def5678 M\tsrc/file.ts\n3\t1\tsrc/file.ts\n';
		const data =
			record(parser.separators, commitFields('sha1'), files) +
			record(parser.separators, commitFields('sha2'), files);

		for (const entries of [[...parser.parse(data)], await collect(parser.parseAsync(streamOf(chunk(data, 3))))]) {
			assert.strictEqual(entries.length, 2);
			for (const [i, entry] of entries.entries()) {
				assertCommit(entry, `sha${i + 1}`);
				assert.strictEqual(entry.files.length, 1);
				assert.strictEqual(entry.files[0].path, 'src/file.ts');
				assert.strictEqual(entry.stats.additions, 3);
				assert.strictEqual(entry.stats.deletions, 1);
			}
		}
	});

	test('patch (file range) variant (parse and parseAsync) keeps fields and file intact', async () => {
		const parser = getCommitsLogParser(false, true) as CommitsInFileRangeLogParser;
		const patch =
			'\n\ndiff --git a/src/file.ts b/src/file.ts\n--- a/src/file.ts\n+++ b/src/file.ts\n@@ -1,2 +1,3 @@\n x\n+y\n';
		const data =
			record(parser.separators, commitFields('sha1'), patch) +
			record(parser.separators, commitFields('sha2'), patch);

		for (const entries of [[...parser.parse(data)], await collect(parser.parseAsync(streamOf(chunk(data, 3))))]) {
			assert.strictEqual(entries.length, 2);
			for (const [i, entry] of entries.entries()) {
				assertCommit(entry, `sha${i + 1}`);
				assert.strictEqual(entry.files?.[0]?.path, 'src/file.ts');
			}
		}
	});

	test('stats variant (parse and parseAsync) keeps fields and stats intact', async () => {
		const parser = getContributorsLogParser(true);
		// contributorsMapping: sha, author, email, date, message
		const stats = '\n\n 1 file changed, 2 insertions(+), 1 deletion(-)\n';
		const fields = (sha: string) => [sha, evilAuthor, 'e@x.com', '100', evilMessage];
		const data =
			record(parser.separators, fields('sha1'), stats) + record(parser.separators, fields('sha2'), stats);

		// `getContributorsLogParser` returns a stats/no-stats union, so name the shared entry shape
		type Entry = { sha: string; author: string; message: string; stats?: unknown };
		const entriesList: Entry[][] = [
			[...parser.parse(data)],
			await collect<Entry>(parser.parseAsync(streamOf(chunk(data, 3)))),
		];
		for (const entries of entriesList) {
			assert.strictEqual(entries.length, 2);
			for (const [i, entry] of entries.entries()) {
				assert.strictEqual(entry.sha, `sha${i + 1}`);
				assert.strictEqual(entry.author, evilAuthor);
				assert.strictEqual(entry.message, evilMessage);
				assert.deepStrictEqual(entry.stats, { files: 1, additions: 2, deletions: 1 });
			}
		}
	});

	test('name-only files variant (parse and parseAsync) keeps fields and files intact', async () => {
		const parser = getShaAndDatesWithFilesLogParser(true);
		// shaAndDateAndTipsMapping: sha, authorDate, committerDate, tips
		const files = '\n\nsrc/file.ts\n';
		const fields = (sha: string) => [sha, '100', '101', evilTips];
		const data =
			record(parser.separators, fields('sha1'), files) + record(parser.separators, fields('sha2'), files);

		for (const entries of [[...parser.parse(data)], await collect(parser.parseAsync(streamOf(chunk(data, 3))))]) {
			assert.strictEqual(entries.length, 2);
			for (const [i, entry] of entries.entries()) {
				assert.strictEqual(entry.sha, `sha${i + 1}`);
				assert.strictEqual(entry.tips, evilTips);
				assert.deepStrictEqual(entry.files, [{ path: 'src/file.ts' }]);
			}
		}
	});

	test('stash variant keeps a reflog subject and commit subject with embedded separators intact', () => {
		const parser = getStashLogParser(false);
		// stashMapping: sha, authorDate, committedDate, parents, stashName, summary, commitSubject
		const summary = 'On main: wip \x1E with \x1D seps';
		const fields = (sha: string, n: number) => [sha, '100', '101', 'p1 p2', `stash@{${n}}`, summary, summary];
		const data = record(parser.separators, fields('sha1', 0)) + record(parser.separators, fields('sha2', 1));
		const entries = [...parser.parse(data)];
		assert.strictEqual(entries.length, 2);
		assert.deepStrictEqual(
			entries.map(e => [e.sha, e.stashName, e.summary, e.commitSubject]),
			[
				['sha1', 'stash@{0}', summary, summary],
				['sha2', 'stash@{1}', summary, summary],
			],
		);
	});

	test('parse (sync) skips a malformed record instead of yielding undefined fields', () => {
		const parser = getCommitsLogParser(false) as CommitsLogParser;
		const { record: rs, field: fs } = parser.separators;
		const data = `${record(parser.separators, commitFields('sha1'))}${rs}sha2${fs}Bob${fs}truncated`;
		const entries = [...parser.parse(data)];
		assert.strictEqual(entries.length, 1, 'Malformed record must be skipped');
		assertCommit(entries[0], 'sha1');
	});
});

// A record's payload (patch, shortstat, file lists) follows its mapped fields. It can be missing (a stream that
// stopped right after the metadata), truncated (a stream that stopped mid-patch), or contain a NUL+0x1D pair (diff
// content may hold NUL), which splits it into extra segments. None of these may throw, drop the commit, leave a
// required property undefined, or let a later segment overwrite the payload already parsed.
suite('Log Parser - Missing, Truncated, and Split Payloads', () => {
	async function* streamOf(chunks: string[]): AsyncGenerator<string> {
		for (const c of chunks) {
			yield c;
		}
	}

	async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
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

	function record(separators: { record: string; field: string }, fields: string[], payload = ''): string {
		return `${separators.record}${fields.join(separators.field)}${separators.field}${payload}`;
	}

	// Chunk sizes 1 and 2 split the 2-char sentinels themselves across chunks
	const chunkSizes = [1, 2, 3, 7, Number.MAX_SAFE_INTEGER];

	// commitsMapping: sha, author, authorEmail, authorDate, committer, committerEmail, committerDate, parents, tips, message
	function commitFields(sha: string): string[] {
		return [sha, 'Alice', 'a@x.com', '100', 'Alice', 'a@x.com', '101', 'p1', '', `${sha} message`];
	}

	function assertCommit(entry: Record<string, unknown> | undefined, sha: string): void {
		assert.ok(entry, `Missing entry for ${sha}`);
		assert.strictEqual(entry.sha, sha);
		assert.strictEqual(entry.author, 'Alice');
		assert.strictEqual(entry.committerDate, '101');
		assert.strictEqual(entry.parents, 'p1');
		assert.strictEqual(entry.message, `${sha} message`);
	}

	suite('patch (file range) variant', () => {
		const header = '\n\ndiff --git a/src/file.ts b/src/file.ts';
		const fullPatch = `${header}\n--- a/src/file.ts\n+++ b/src/file.ts\n@@ -1,2 +1,3 @@\n x\n+y\n`;
		const fullFile = {
			status: 'M',
			path: 'src/file.ts',
			originalPath: undefined,
			range: { startLine: 1, endLine: 3 },
			originalRange: { startLine: 1, endLine: 2 },
		};
		// The header was parsed, so the file is kept — only its ranges are unknown
		const headerOnlyFile = { ...fullFile, range: undefined, originalRange: undefined };

		const truncations: { name: string; payload: string; files: unknown[] }[] = [
			{ name: 'right after the metadata (no payload)', payload: '', files: [] },
			{ name: 'after `diff --git`', payload: header, files: [headerOnlyFile] },
			{ name: 'after `--- a/f`', payload: `${header}\n--- a/src/file.ts`, files: [headerOnlyFile] },
			{
				name: 'before the first `@@`',
				payload: `${header}\n--- a/src/file.ts\n+++ b/src/file.ts\n`,
				files: [headerOnlyFile],
			},
		];

		for (const { name, payload, files } of truncations) {
			test(`parse keeps a commit whose record ends ${name}`, () => {
				const parser = getCommitsLogParser(false, true) as CommitsInFileRangeLogParser;
				const data =
					record(parser.separators, commitFields('sha1'), fullPatch) +
					record(parser.separators, commitFields('sha2'), payload);

				const entries = [...parser.parse(data)];
				assert.strictEqual(entries.length, 2);
				assertCommit(entries[0], 'sha1');
				assert.deepStrictEqual(entries[0].files, [fullFile]);
				assertCommit(entries[1], 'sha2');
				assert.deepStrictEqual(entries[1].files, files);
			});

			test(`parseAsync keeps a commit whose record ends ${name}`, async () => {
				const parser = getCommitsLogParser(false, true) as CommitsInFileRangeLogParser;
				const data =
					record(parser.separators, commitFields('sha1'), fullPatch) +
					record(parser.separators, commitFields('sha2'), payload);

				for (const size of chunkSizes) {
					const entries = await collect(parser.parseAsync(streamOf(chunk(data, size))));
					assert.strictEqual(entries.length, 2, `chunk size ${size}`);
					assertCommit(entries[0], 'sha1');
					assert.deepStrictEqual(entries[0].files, [fullFile], `chunk size ${size}`);
					assertCommit(entries[1], 'sha2');
					assert.deepStrictEqual(entries[1].files, files, `chunk size ${size}`);
				}
			});
		}

		test('parse and parseAsync keep the file and ranges when diff content contains NUL+0x1D', async () => {
			const parser = getCommitsLogParser(false, true) as CommitsInFileRangeLogParser;
			const patch = `${header}\n--- a/src/file.ts\n+++ b/src/file.ts\n@@ -1,2 +1,3 @@\n x\n+y\0\x1Dz\n`;
			const data =
				record(parser.separators, commitFields('sha1'), patch) +
				record(parser.separators, commitFields('sha2'), fullPatch);

			const entriesList = [[...parser.parse(data)]];
			for (const size of chunkSizes) {
				entriesList.push(await collect(parser.parseAsync(streamOf(chunk(data, size)))));
			}

			for (const entries of entriesList) {
				assert.strictEqual(entries.length, 2);
				assertCommit(entries[0], 'sha1');
				assert.deepStrictEqual(entries[0].files, [fullFile]);
				assertCommit(entries[1], 'sha2');
				assert.deepStrictEqual(entries[1].files, [fullFile]);
			}
		});
	});

	suite('stats variant', () => {
		const shortstat = '\n\n 1 file changed, 2 insertions(+), 1 deletion(-)\n';

		test('parse and parseAsync yield zeroed stats for a record that ends right after its metadata', async () => {
			const parser = getShaAndStatsLogParser();
			const data = record(parser.separators, ['sha1'], shortstat) + record(parser.separators, ['sha2']);

			const entriesList = [[...parser.parse(data)]];
			for (const size of chunkSizes) {
				entriesList.push(await collect(parser.parseAsync(streamOf(chunk(data, size)))));
			}

			for (const entries of entriesList) {
				assert.deepStrictEqual(entries, [
					{ sha: 'sha1', stats: { files: 1, additions: 2, deletions: 1 } },
					{ sha: 'sha2', stats: { files: 0, additions: 0, deletions: 0 } },
				]);
			}
		});

		// Real --shortstat output can't contain NUL; this guards the framing, not a git-produced input
		test('parse and parseAsync ignore segments split off after a valid shortstat', async () => {
			const parser = getShaAndStatsLogParser();
			const data = record(parser.separators, ['sha1'], `${shortstat}\0\x1Dtrailing`);

			const entriesList = [[...parser.parse(data)]];
			for (const size of chunkSizes) {
				entriesList.push(await collect(parser.parseAsync(streamOf(chunk(data, size)))));
			}

			for (const entries of entriesList) {
				assert.deepStrictEqual(entries, [{ sha: 'sha1', stats: { files: 1, additions: 2, deletions: 1 } }]);
			}
		});
	});

	suite('files+stats variant', () => {
		const files = '\n\n:100644 100644 abc1234 def5678 M\tsrc/file.ts\n3\t1\tsrc/file.ts\n';
		const expectedFile = {
			status: 'M',
			path: 'src/file.ts',
			originalPath: undefined,
			additions: 3,
			deletions: 1,
			mode: '100644',
			oid: undefined,
			previousOid: undefined,
		};

		test('parse and parseAsync yield empty files for a record that ends right after its metadata', async () => {
			const parser = getShaAndFilesAndStatsLogParser();
			const data = record(parser.separators, ['sha1'], files) + record(parser.separators, ['sha2']);

			const entriesList = [[...parser.parse(data)]];
			for (const size of chunkSizes) {
				entriesList.push(await collect(parser.parseAsync(streamOf(chunk(data, size)))));
			}

			for (const entries of entriesList) {
				assert.strictEqual(entries.length, 2);
				assert.deepStrictEqual(entries[0].files, [expectedFile]);
				assert.strictEqual(entries[1].sha, 'sha2');
				assert.deepStrictEqual(entries[1].files, []);
			}
		});

		test('parse and parseAsync ignore segments split off after the file list', async () => {
			const parser = getShaAndFilesAndStatsLogParser();
			const data = record(parser.separators, ['sha1'], `${files}\0\x1D7\t7\tbogus.ts\n`);

			const entriesList = [[...parser.parse(data)]];
			for (const size of chunkSizes) {
				entriesList.push(await collect(parser.parseAsync(streamOf(chunk(data, size)))));
			}

			for (const entries of entriesList) {
				assert.strictEqual(entries.length, 1);
				assert.deepStrictEqual(entries[0].files, [expectedFile]);
				assert.deepStrictEqual(entries[0].stats, {
					additions: 3,
					deletions: 1,
					files: { added: 0, deleted: 0, changed: 1 },
				});
			}
		});

		test('files-only (no mapped fields) parse ignores segments split off after the file list', () => {
			const parser = getStashFilesOnlyLogParser();
			const data = `${files.substring(2)}\0\x1D7\t7\tbogus.ts\n`;

			const entries = [...parser.parse(data)];
			assert.strictEqual(entries.length, 1);
			assert.deepStrictEqual(entries[0].files, [expectedFile]);
		});
	});

	suite('file summary variant', () => {
		const summary = '\n\n create mode 100644 src/new.ts\n';

		test('parse yields empty files for a record that ends right after its metadata', () => {
			const parser = getShaAndFileSummaryLogParser();
			const data = record(parser.separators, ['sha1'], summary) + record(parser.separators, ['sha2']);

			const entries = [...parser.parse(data)];
			assert.deepStrictEqual(entries, [
				{ sha: 'sha1', files: [{ path: 'src/new.ts', status: 'A' }] },
				{ sha: 'sha2', files: [] },
			]);
		});

		test('parse ignores segments split off after the summary', () => {
			const parser = getShaAndFileSummaryLogParser();
			const data = record(parser.separators, ['sha1'], `${summary}\0\x1D delete mode 100644 bogus.ts\n`);

			const entries = [...parser.parse(data)];
			assert.deepStrictEqual(entries, [{ sha: 'sha1', files: [{ path: 'src/new.ts', status: 'A' }] }]);
		});
	});

	suite('name-only files variant', () => {
		// shaAndDateMapping: sha, authorDate, committerDate
		const fields = (sha: string) => [sha, '100', '101'];

		test('parse and parseAsync yield empty files for a record that ends right after its metadata', async () => {
			const parser = getShaAndDatesWithFilesLogParser();
			const data =
				record(parser.separators, fields('sha1'), '\n\nsrc/file.ts\n') +
				record(parser.separators, fields('sha2'));

			const entriesList = [[...parser.parse(data)]];
			for (const size of chunkSizes) {
				entriesList.push(await collect(parser.parseAsync(streamOf(chunk(data, size)))));
			}

			for (const entries of entriesList) {
				assert.deepStrictEqual(entries, [
					{ sha: 'sha1', authorDate: '100', committerDate: '101', files: [{ path: 'src/file.ts' }] },
					{ sha: 'sha2', authorDate: '100', committerDate: '101', files: [] },
				]);
			}
		});

		test('parse and parseAsync ignore segments split off after the file list', async () => {
			const parser = getShaAndDatesWithFilesLogParser();
			const data = record(parser.separators, fields('sha1'), '\n\nsrc/file.ts\n\0\x1Dbogus.ts\n');

			const entriesList = [[...parser.parse(data)]];
			for (const size of chunkSizes) {
				entriesList.push(await collect(parser.parseAsync(streamOf(chunk(data, size)))));
			}

			for (const entries of entriesList) {
				assert.deepStrictEqual(entries, [
					{ sha: 'sha1', authorDate: '100', committerDate: '101', files: [{ path: 'src/file.ts' }] },
				]);
			}
		});
	});
});

// Truncated tails on the variants whose `parseAsync` gained the completeness guard in #5659, a record broken in the
// middle of a batched stream, and values that start with a bare (NUL-less) 0x1E/0x1D.
suite('Log Parser - Truncated Tails, Mid-Stream Drops, and Leading Bare Separators (#5659)', () => {
	async function* streamOf(chunks: string[]): AsyncGenerator<string> {
		for (const c of chunks) {
			yield c;
		}
	}

	async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
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

	function record(separators: { record: string; field: string }, fields: string[], payload = ''): string {
		return `${separators.record}${fields.join(separators.field)}${separators.field}${payload}`;
	}

	// Chunk sizes 1 and 2 split the 2-char sentinels themselves across chunks
	const chunkSizes = [1, 2, 3, 7, Number.MAX_SAFE_INTEGER];

	suite('truncated tail (record missing its last field terminator)', () => {
		test('stats variant drops it and keeps earlier records', async () => {
			const parser = getContributorsLogParser(true);
			const shortstat = '\n\n 1 file changed, 2 insertions(+), 1 deletion(-)\n';
			// contributorsMapping: sha, author, email, date, message; the tail stops before the message terminator
			const tail = '\0\x1Esha2\0\x1DBob\0\x1Db@x.com\0\x1D200\0\x1Dpartial message';
			const data = `${record(parser.separators, ['sha1', 'Alice', 'a@x.com', '100', 'first'], shortstat)}${tail}`;

			type Entry = { sha: string; stats?: unknown };
			const entriesList: Entry[][] = [[...parser.parse(data)]];
			for (const size of chunkSizes) {
				entriesList.push(await collect<Entry>(parser.parseAsync(streamOf(chunk(data, size)))));
			}

			for (const entries of entriesList) {
				assert.deepStrictEqual(
					entries.map(e => e.sha),
					['sha1'],
				);
				assert.deepStrictEqual(entries[0].stats, { files: 1, additions: 2, deletions: 1 });
			}
		});

		test('name-only files variant drops it and keeps earlier records', async () => {
			const parser = getShaAndDatesWithFilesLogParser();
			// shaAndDateMapping: sha, authorDate, committerDate; the tail stops before the last terminator
			const tail = '\0\x1Esha2\0\x1D100\0\x1D101';
			const data = `${record(parser.separators, ['sha1', '100', '101'], '\n\nsrc/file.ts\n')}${tail}`;

			const entriesList = [[...parser.parse(data)]];
			for (const size of chunkSizes) {
				entriesList.push(await collect(parser.parseAsync(streamOf(chunk(data, size)))));
			}

			for (const entries of entriesList) {
				assert.deepStrictEqual(entries, [
					{ sha: 'sha1', authorDate: '100', committerDate: '101', files: [{ path: 'src/file.ts' }] },
				]);
			}
		});

		test('files+stats variant drops it and keeps earlier records', async () => {
			const parser = getShaAndFilesAndStatsLogParser();
			const files = '\n\n:100644 100644 abc1234 def5678 M\tsrc/file.ts\n3\t1\tsrc/file.ts\n';
			// shaMapping has a single field; the tail has no terminator at all
			const data = `${record(parser.separators, ['sha1'], files)}\0\x1Esha2`;

			const entriesList = [[...parser.parse(data)]];
			for (const size of chunkSizes) {
				entriesList.push(await collect(parser.parseAsync(streamOf(chunk(data, size)))));
			}

			for (const entries of entriesList) {
				assert.deepStrictEqual(
					entries.map(e => e.sha),
					['sha1'],
				);
				assert.strictEqual(entries[0].files.length, 1);
			}
		});

		test('file summary variant (parse) drops it and keeps earlier records', () => {
			const parser = getShaAndFileSummaryLogParser();
			const data = `${record(parser.separators, ['sha1'], '\n\n create mode 100644 src/new.ts\n')}\0\x1Esha2`;

			assert.deepStrictEqual(
				Array.from(parser.parse(data), e => e.sha),
				['sha1'],
			);
		});

		test('patch (file range) variant drops it and keeps earlier records', async () => {
			const parser = getCommitsLogParser(false, true) as CommitsInFileRangeLogParser;
			const patch =
				'\n\ndiff --git a/src/file.ts b/src/file.ts\n--- a/src/file.ts\n+++ b/src/file.ts\n@@ -1,2 +1,3 @@\n x\n+y\n';
			// commitsMapping: 10 fields; the tail stops before the message terminator
			const tail =
				'\0\x1Esha2\0\x1DBob\0\x1Db@x.com\0\x1D200\0\x1DBob\0\x1Db@x.com\0\x1D201\0\x1D\0\x1D\0\x1Dpartial';
			const first = ['sha1', 'Alice', 'a@x.com', '100', 'Alice', 'a@x.com', '101', 'p1', '', 'first'];
			const data = `${record(parser.separators, first, patch)}${tail}`;

			const entriesList = [[...parser.parse(data)]];
			for (const size of chunkSizes) {
				entriesList.push(await collect(parser.parseAsync(streamOf(chunk(data, size)))));
			}

			for (const entries of entriesList) {
				assert.deepStrictEqual(
					entries.map(e => e.sha),
					['sha1'],
				);
			}
		});
	});

	suite('graph parser (parse, parseAsync, parseAsyncBatched)', () => {
		// graphMapping: sha, author, authorEmail, authorDate, committerDate, parents, tips, message
		const fields = (sha: string) => [sha, 'Alice', 'a@x.com', '100', '101', 'p1', '', `${sha} message`];

		test('parseAsyncBatched drops an incomplete record in the middle of the stream and keeps its neighbours', async () => {
			const parser = getGraphParser() as GraphLogParser;
			// Missing its message field, then immediately followed by the next record's separator
			const broken = '\0\x1Esha2\0\x1DBob\0\x1Db@x.com\0\x1D200\0\x1D201\0\x1Dp1\0\x1D\0\x1Dpartial';
			const data = record(parser.separators, fields('sha1')) + broken + record(parser.separators, fields('sha3'));

			const expected = ['sha1', 'sha3'];
			assert.deepStrictEqual(
				Array.from(parser.parse(data), e => e.sha),
				expected,
			);
			assert.deepStrictEqual(
				(await collect(parser.parseAsync(streamOf([data])))).map(e => e.sha),
				expected,
			);
			for (const size of chunkSizes) {
				const batches = await collect(parser.parseAsyncBatched!(streamOf(chunk(data, size))));
				assert.deepStrictEqual(
					batches.flat().map(e => e.sha),
					expected,
					`chunk size ${size}`,
				);
				assert.strictEqual(batches.flat()[1].message, 'sha3 message');
			}
		});

		test('a field value that starts with a bare 0x1E or 0x1D is preserved exactly', async () => {
			const parser = getGraphParser() as GraphLogParser;
			const author = '\x1EAlice';
			const message = '\x1Dstarts with a field sep\n\x1E';
			const tips = '\x1D\x1E';
			const f = (sha: string) => [sha, author, 'a@x.com', '100', '101', 'p1', tips, message];
			const data = record(parser.separators, f('sha1')) + record(parser.separators, f('sha2'));

			const check = (
				entries: { sha: string; author: string; tips: string; message: string }[],
				label: string,
			): void => {
				assert.strictEqual(entries.length, 2, label);
				for (const [i, entry] of entries.entries()) {
					assert.strictEqual(entry.sha, `sha${i + 1}`, label);
					assert.strictEqual(entry.author, author, label);
					assert.strictEqual(entry.tips, tips, label);
					assert.strictEqual(entry.message, message, label);
				}
			};

			check([...parser.parse(data)], 'parse');
			for (const size of chunkSizes) {
				check(await collect(parser.parseAsync(streamOf(chunk(data, size)))), `parseAsync ${size}`);
				check(
					(await collect(parser.parseAsyncBatched!(streamOf(chunk(data, size))))).flat(),
					`parseAsyncBatched ${size}`,
				);
			}
		});
	});
});

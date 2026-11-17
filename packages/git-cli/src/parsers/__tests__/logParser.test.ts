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
	const truncatedMidMessage =
		'\0\x1Esha3\0\x1DCarol\0\x1Dc@x.com\0\x1D300\0\x1D301\0\x1D\0\x1D\0\x1Dthird commit partial';
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
		const fields = (sha: string) => [sha, evilAuthor, 'e@x.com', '100', '101', 'p1', evilTips, evilMessage];
		const data = record(parser.separators, fields('sha1')) + record(parser.separators, fields('sha2'));
		const expected = await collect(parser.parseAsync(streamOf([data])));
		assert.strictEqual(expected.length, 2);
		assert.strictEqual(expected[0].message, evilMessage);
		assert.strictEqual(expected[1].tips, evilTips);
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
		const stats = '\n\n 1 file changed, 2 insertions(+), 1 deletion(-)\n';
		const fields = (sha: string) => [sha, evilAuthor, 'e@x.com', '100', evilMessage];
		const data =
			record(parser.separators, fields('sha1'), stats) + record(parser.separators, fields('sha2'), stats);

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

	const chunkSizes = [1, 2, 3, 7, Number.MAX_SAFE_INTEGER];

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

	const chunkSizes = [1, 2, 3, 7, Number.MAX_SAFE_INTEGER];

	suite('truncated tail (record missing its last field terminator)', () => {
		test('stats variant drops it and keeps earlier records', async () => {
			const parser = getContributorsLogParser(true);
			const shortstat = '\n\n 1 file changed, 2 insertions(+), 1 deletion(-)\n';
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
		const fields = (sha: string) => [sha, 'Alice', 'a@x.com', '100', '101', 'p1', '', `${sha} message`];

		test('parseAsyncBatched drops an incomplete record in the middle of the stream and keeps its neighbours', async () => {
			const parser = getGraphParser() as GraphLogParser;
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

suite('Log Parser - Generated Input, Malformed Input, and Streaming (#5659)', () => {
	const rs = '\0\x1E';
	const fs = '\0\x1D';

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

	function chunkRandomly(s: string, next: () => number, maxSize: number): string[] {
		const out: string[] = [];
		for (let i = 0; i < s.length;) {
			const size = 1 + Math.floor(next() * maxSize);
			out.push(s.substring(i, i + size));
			i += size;
		}
		return out;
	}

	function createRandom(seed: number): () => number {
		let a = seed >>> 0;
		return () => {
			a = (a + 0x6d2b79f5) >>> 0;
			let t = a;
			t = Math.imul(t ^ (t >>> 15), t | 1);
			t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	}

	function record(fields: string[], payload = ''): string {
		return `${rs}${fields.map(f => `${f}${fs}`).join('')}${payload}`;
	}

	// KEEP: never NUL in a piece: the framing assumes git emits none inside a field
	const textPieces = ['a', 'Z', '0', ' ', '-', ':', '\x1E', '\x1D', '\x1E\x1D', 'é', 'Ω', '日本', '😀', '𝄞'];
	// KEEP: no tab, newline, ' => ', ' b/', braces or edge whitespace in a piece: the payload formats reserve them
	const pathPieces = ['a', 'é', '日', '😀', '\x1E', '\x1D', '-', '_', ' ', '/'];

	type Generated = { data: string; expected: Record<string, unknown>[] };
	type Variant = {
		name: string;
		keys: string[];
		payload: (random: Random) => { text: string; props: Record<string, unknown> };
		parse: (data: string | Iterable<string>) => Iterable<unknown>;
		parseAsync?: (stream: AsyncGenerator<string>) => AsyncIterable<unknown>;
		parseAsyncBatched?: (stream: AsyncGenerator<string>) => AsyncIterable<unknown[]>;
	};

	class Random {
		constructor(readonly next: () => number) {}

		int(min: number, max: number): number {
			return min + Math.floor(this.next() * (max - min + 1));
		}

		pick<T>(items: readonly T[]): T {
			return items[Math.floor(this.next() * items.length)];
		}

		text(options?: { newlines?: boolean; long?: boolean }): string {
			const roll = this.next();
			let length;
			if (roll < 0.15) {
				length = 0;
			} else if (options?.long && roll > 0.9) {
				length = this.int(1000, 3000);
			} else {
				length = this.int(1, 12);
			}

			let s = '';
			for (let i = 0; i < length; i++) {
				s += options?.newlines && this.next() < 0.1 ? '\n' : this.pick(textPieces);
			}
			if (this.next() < 0.2) {
				s = this.pick(['\x1E', '\x1D']) + s;
			}
			if (this.next() < 0.2) {
				s += this.pick(['\x1E', '\x1D']);
			}
			return s;
		}

		path(index: number): string {
			let s = 'p';
			const length = this.int(0, 8);
			for (let i = 0; i < length; i++) {
				s += this.pick(pathPieces);
			}
			return `${s}${index}.ts`;
		}
	}

	function filesAndStatsPayload(random: Random): { text: string; props: Record<string, unknown> } {
		const count = random.int(0, 4);
		if (count === 0) return { text: random.pick(['', '\n']), props: { files: [] } };

		const raw: string[] = [];
		const numstat: string[] = [];
		const files: Record<string, unknown>[] = [];
		const stats = { additions: 0, deletions: 0, files: { added: 0, deleted: 0, changed: 0 } };
		for (let i = 0; i < count; i++) {
			const path = random.path(i);
			const status = random.pick(['M', 'A', 'D', 'T', 'S']);
			const binary = random.next() < 0.15;
			const additions = binary ? 0 : random.int(0, 50);
			const deletions = binary ? 0 : random.int(0, 50);

			let oldMode = status === 'A' ? '000000' : '100644';
			let newMode = status === 'D' ? '000000' : random.pick(['100644', '100755']);
			let oid: string | undefined;
			let previousOid: string | undefined;
			if (status === 'S') {
				oldMode = newMode = '160000';
				previousOid = `${i}aaaaaa`;
				oid = `${i}bbbbbb`;
			}

			const rawStatus = status === 'S' ? 'M' : status;
			raw.push(`:${oldMode} ${newMode} ${previousOid ?? 'abc1234'} ${oid ?? 'def5678'} ${rawStatus}\t${path}`);
			numstat.push(binary ? `-\t-\t${path}` : `${additions}\t${deletions}\t${path}`);
			files.push({
				status: rawStatus,
				path: path,
				originalPath: undefined,
				additions: additions,
				deletions: deletions,
				mode: newMode,
				oid: oid,
				previousOid: previousOid,
			});

			if (additions || deletions) {
				stats.additions += additions;
				stats.deletions += deletions;
				if (rawStatus === 'A') {
					stats.files.added++;
				} else if (rawStatus === 'D') {
					stats.files.deleted++;
				} else {
					stats.files.changed++;
				}
			}
		}

		return { text: `\n\n${[...raw, ...numstat].join('\n')}\n`, props: { files: files, stats: stats } };
	}

	function statsPayload(random: Random): { text: string; props: Record<string, unknown> } {
		const files = random.int(0, 3);
		const zeroed = { files: 0, additions: 0, deletions: 0 };
		if (files === 0) return { text: random.pick(['', '\n']), props: { stats: zeroed } };

		const additions = random.int(0, 3);
		const deletions = random.int(0, 3);
		let text = ` ${files} file${files === 1 ? '' : 's'} changed`;
		if (additions) {
			text += `, ${additions} insertion${additions === 1 ? '' : 's'}(+)`;
		}
		if (deletions) {
			text += `, ${deletions} deletion${deletions === 1 ? '' : 's'}(-)`;
		}
		return {
			text: `\n\n${text}\n`,
			props: { stats: { files: files, additions: additions, deletions: deletions } },
		};
	}

	function fileNamesPayload(random: Random): { text: string; props: Record<string, unknown> } {
		const paths = Array.from({ length: random.int(0, 4) }, (_, i) => random.path(i));
		if (!paths.length) return { text: random.pick(['', '\n']), props: { files: [] } };

		return { text: `\n\n${paths.join('\n')}\n`, props: { files: paths.map(p => ({ path: p })) } };
	}

	function fileSummaryPayload(random: Random): { text: string; props: Record<string, unknown> } {
		const lines: string[] = [];
		const files: Record<string, unknown>[] = [];
		const count = random.int(0, 4);
		for (let i = 0; i < count; i++) {
			const path = random.path(i);
			const kind = random.pick(['create', 'delete', 'mode']);
			if (kind === 'mode') {
				lines.push(` mode change 100644 => 100755 ${path}`);
			} else {
				lines.push(` ${kind} mode 100644 ${path}`);
				files.push({ path: path, status: kind === 'create' ? 'A' : 'D' });
			}
		}
		if (!lines.length) return { text: random.pick(['', '\n']), props: { files: [] } };

		return { text: `\n\n${lines.join('\n')}\n`, props: { files: files } };
	}

	function patchPayload(random: Random): { text: string; props: Record<string, unknown> } {
		if (random.next() < 0.2) return { text: random.pick(['', '\n']), props: { files: [] } };

		const path = random.path(0);
		const oldStart = random.int(1, 500);
		const oldCount = random.int(0, 30);
		const newStart = random.int(1, 500);
		const newCount = random.int(0, 30);
		let text = `\n\ndiff --git a/${path} b/${path}\nindex abc1234..def5678 100644\n--- a/${path}\n+++ b/${path}\n`;
		text += `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@ ${random.text()}\n`;
		const lines = random.int(0, 6);
		for (let i = 0; i < lines; i++) {
			text += `${random.pick([' ', '+', '-'])}${random.text({ long: true })}${random.next() < 0.1 ? fs : ''}\n`;
		}

		return {
			text: text,
			props: {
				files: [
					{
						status: 'M',
						path: path,
						originalPath: undefined,
						range: newCount ? { startLine: newStart, endLine: newStart + newCount - 1 } : undefined,
						originalRange: oldCount ? { startLine: oldStart, endLine: oldStart + oldCount - 1 } : undefined,
					},
				],
			},
		};
	}

	const graphKeys = ['sha', 'author', 'authorEmail', 'authorDate', 'committerDate', 'parents', 'tips', 'message'];
	const commitsKeys = [
		'sha',
		'author',
		'authorEmail',
		'authorDate',
		'committer',
		'committerEmail',
		'committerDate',
		'parents',
		'tips',
		'message',
	];

	function getVariants(): Variant[] {
		const graph = getGraphParser() as GraphLogParser;
		const commitsWithFiles = getCommitsLogParser(true) as CommitsWithFilesLogParser;
		const contributorsWithStats = getContributorsLogParser(true);
		const fileNames = getShaAndDatesWithFilesLogParser(true);
		const patch = getCommitsLogParser(false, true) as CommitsInFileRangeLogParser;
		const fileSummary = getShaAndFileSummaryLogParser();
		const stashFilesOnly = getStashFilesOnlyLogParser();

		return [
			{
				name: 'graph',
				keys: graphKeys,
				payload: random => ({ text: random.pick(['', '\n', `\n${random.text()}`]), props: {} }),
				parse: d => graph.parse(d),
				parseAsync: s => graph.parseAsync(s),
				parseAsyncBatched: s => graph.parseAsyncBatched!(s),
			},
			{
				name: 'commits with files and stats',
				keys: commitsKeys,
				payload: filesAndStatsPayload,
				parse: d => commitsWithFiles.parse(d),
				parseAsync: s => commitsWithFiles.parseAsync(s),
			},
			{
				name: 'stash files only (no mapped fields)',
				keys: [],
				payload: filesAndStatsPayload,
				parse: d => stashFilesOnly.parse(d),
				parseAsync: s => stashFilesOnly.parseAsync(s),
			},
			{
				name: 'contributors with stats',
				keys: ['sha', 'author', 'email', 'date', 'message'],
				payload: statsPayload,
				parse: d => contributorsWithStats.parse(d),
				parseAsync: s => contributorsWithStats.parseAsync(s),
			},
			{
				name: 'name-only files',
				keys: ['sha', 'authorDate', 'committerDate', 'tips'],
				payload: fileNamesPayload,
				parse: d => fileNames.parse(d),
				parseAsync: s => fileNames.parseAsync(s),
			},
			{
				name: 'patch (file range)',
				keys: commitsKeys,
				payload: patchPayload,
				parse: d => patch.parse(d),
				parseAsync: s => patch.parseAsync(s),
			},
			{
				name: 'file summary',
				keys: ['sha'],
				payload: fileSummaryPayload,
				parse: d => fileSummary.parse(d),
			},
		];
	}

	function generate(variant: Variant, random: Random, count: number): Generated {
		let data = '';
		const expected: Record<string, unknown>[] = [];
		for (let i = 0; i < count; i++) {
			const entry: Record<string, unknown> = {};
			const fields = variant.keys.map((key, k) => {
				const value =
					k === 0 ? `sha${i}${random.text()}` : random.text({ newlines: key === 'message', long: true });
				entry[key] = value;
				return value;
			});
			const { text, props } = variant.payload(random);
			const rendered = record(fields, text);
			data += rendered;

			if (rendered.length > rs.length) {
				expected.push({ ...entry, ...props });
			}
		}
		return { data: data, expected: expected };
	}

	test('every parse path matches expectations built from generated records', async () => {
		for (const variant of getVariants()) {
			for (const seed of [1, 2, 3]) {
				const random = new Random(createRandom(seed * 7919 + variant.name.length));
				const { data, expected } = generate(variant, random, 12);
				const label = (path: string) => `${variant.name}, seed ${seed}, ${path}`;

				assert.deepStrictEqual([...variant.parse(data)], expected, label('parse(string)'));
				const chunksForIterable = chunkRandomly(data, random.next, 200);
				assert.deepStrictEqual(
					[...variant.parse(chunksForIterable.values())],
					expected,
					label('parse(Iterable)'),
				);

				const chunkings: [string, string[]][] = [
					['size 1', chunk(data, 1)],
					['size 2', chunk(data, 2)],
					['size 3', chunk(data, 3)],
					['random sizes', chunkRandomly(data, random.next, 300)],
					['size 64', chunk(data, 64)],
					['one chunk', [data]],
				];
				for (const [name, chunks] of chunkings) {
					if (variant.parseAsync != null) {
						assert.deepStrictEqual(
							await collect(variant.parseAsync(streamOf(chunks))),
							expected,
							label(`parseAsync ${name}`),
						);
					}
					if (variant.parseAsyncBatched != null) {
						const batches = await collect(variant.parseAsyncBatched(streamOf(chunks)));
						assert.ok(
							batches.every(b => b.length > 0),
							label(`parseAsyncBatched ${name} yields no empty batches`),
						);
						assert.deepStrictEqual(batches.flat(), expected, label(`parseAsyncBatched ${name}`));
					}
				}
			}
		}
	});

	suite('malformed input', () => {
		async function allPaths(variant: Variant, data: string): Promise<[string, unknown[]][]> {
			const results: [string, unknown[]][] = [['parse', [...variant.parse(data)]]];
			for (const size of [1, 3, Number.MAX_SAFE_INTEGER]) {
				if (variant.parseAsync != null) {
					results.push([
						`parseAsync ${size}`,
						await collect(variant.parseAsync(streamOf(chunk(data, size)))),
					]);
				}
				if (variant.parseAsyncBatched != null) {
					const batches = await collect(variant.parseAsyncBatched(streamOf(chunk(data, size))));
					results.push([`parseAsyncBatched ${size}`, batches.flat()]);
				}
			}
			return results;
		}

		const cases: {
			variant: string;
			fields: (sha: string) => string[];
			payload: string;
			first: object;
			empty: object;
		}[] = [
			{
				variant: 'graph',
				fields: sha => [sha, 'Alice', 'a@x.com', '100', '101', 'p1', 'tag: v1', `${sha} message`],
				payload: '\n',
				first: {},
				empty: {},
			},
			{
				variant: 'commits with files and stats',
				fields: sha => [sha, 'Alice', 'a@x.com', '100', 'Bob', 'b@x.com', '101', 'p1', '', `${sha} msg`],
				payload: '\n\n:100644 100644 abc1234 def5678 M\tsrc/f.ts\n3\t1\tsrc/f.ts\n',
				first: {
					files: [
						{
							status: 'M',
							path: 'src/f.ts',
							originalPath: undefined,
							additions: 3,
							deletions: 1,
							mode: '100644',
							oid: undefined,
							previousOid: undefined,
						},
					],
					stats: { additions: 3, deletions: 1, files: { added: 0, deleted: 0, changed: 1 } },
				},
				empty: { files: [] },
			},
			{
				variant: 'contributors with stats',
				fields: sha => [sha, 'Alice', 'a@x.com', '100', `${sha} msg`],
				payload: '\n\n 1 file changed, 2 insertions(+)\n',
				first: { stats: { files: 1, additions: 2, deletions: 0 } },
				empty: { stats: { files: 0, additions: 0, deletions: 0 } },
			},
			{
				variant: 'name-only files',
				fields: sha => [sha, '100', '101', 'HEAD -> main'],
				payload: '\n\nsrc/f.ts\n',
				first: { files: [{ path: 'src/f.ts' }] },
				empty: { files: [] },
			},
			{
				variant: 'patch (file range)',
				fields: sha => [sha, 'Alice', 'a@x.com', '100', 'Bob', 'b@x.com', '101', 'p1', '', `${sha} msg`],
				payload: '\n\ndiff --git a/f.ts b/f.ts\n--- a/f.ts\n+++ b/f.ts\n@@ -1 +1,2 @@\n x\n+y\n',
				first: {
					files: [
						{
							status: 'M',
							path: 'f.ts',
							originalPath: undefined,
							range: { startLine: 1, endLine: 2 },
							originalRange: { startLine: 1, endLine: 1 },
						},
					],
				},
				empty: { files: [] },
			},
			{
				variant: 'file summary',
				fields: sha => [sha],
				payload: '\n\n create mode 100644 src/new.ts\n',
				first: { files: [{ path: 'src/new.ts', status: 'A' }] },
				empty: { files: [] },
			},
		];

		function entryOf(keys: string[], fields: string[], props: object): Record<string, unknown> {
			const entry: Record<string, unknown> = {};
			keys.forEach((key, i) => (entry[key] = fields[i]));
			return { ...entry, ...props };
		}

		test('a tail truncated at every position before its last field terminator is dropped', async () => {
			const variants = getVariants();
			for (const c of cases) {
				const variant = variants.find(v => v.name === c.variant)!;
				const first = entryOf(variant.keys, c.fields('sha1'), c.first);
				const second = record(c.fields('sha2'));

				for (let cut = 2; cut <= second.length; cut++) {
					const data = record(c.fields('sha1'), c.payload) + second.substring(0, cut);
					const expected =
						cut === second.length ? [first, entryOf(variant.keys, c.fields('sha2'), c.empty)] : [first];
					for (const [path, entries] of await allPaths(variant, data)) {
						assert.deepStrictEqual(entries, expected, `${c.variant}, cut ${cut}, ${path}`);
					}
				}
			}
		});

		test('an incomplete record in the middle of the stream is dropped and its neighbours kept', async () => {
			const variants = getVariants();
			for (const c of cases) {
				const variant = variants.find(v => v.name === c.variant)!;
				const broken = record(c.fields('sha2')).slice(0, -fs.length);
				const data =
					record(c.fields('sha1'), c.payload) + broken + record(c.fields('sha3'), c.payload) + broken;
				const expected = [
					entryOf(variant.keys, c.fields('sha1'), c.first),
					entryOf(variant.keys, c.fields('sha3'), c.first),
				];
				for (const [path, entries] of await allPaths(variant, data)) {
					assert.deepStrictEqual(entries, expected, `${c.variant}, ${path}`);
				}
			}
		});

		test('a patch truncated anywhere after its `diff --git` line keeps the file, with ranges only once the hunk header is complete', async () => {
			const variant = getVariants().find(v => v.name === 'patch (file range)')!;
			const fields = ['sha1', 'Alice', 'a@x.com', '100', 'Bob', 'b@x.com', '101', 'p1', '', 'msg'];
			const diffLine = '\n\ndiff --git a/f.ts b/f.ts';
			const hunkLine = '@@ -3,4 +5,6 @@ fn()';
			const payload = `${diffLine}\nindex abc1234..def5678 100644\n--- a/f.ts\n+++ b/f.ts\n${hunkLine}\n x\n+y\n`;
			const rangesFrom = payload.indexOf(hunkLine) + hunkLine.indexOf(' @@') + 3;

			const file = {
				status: 'M',
				path: 'f.ts',
				originalPath: undefined,
				range: undefined,
				originalRange: undefined,
			};
			for (let cut = diffLine.length; cut <= payload.length; cut++) {
				const files = [
					cut >= rangesFrom
						? { ...file, range: { startLine: 5, endLine: 10 }, originalRange: { startLine: 3, endLine: 6 } }
						: file,
				];
				const expected = [entryOf(variant.keys, fields, { files: files })];
				for (const [path, entries] of await allPaths(variant, record(fields, payload.substring(0, cut)))) {
					assert.deepStrictEqual(entries, expected, `cut ${cut}, ${path}`);
				}
			}
		});
	});

	suite('early termination', () => {
		const graphRecord = (sha: string) => record([sha, 'Alice', 'a@x.com', '100', '101', '', '', 'msg']);

		test('breaking out of parseAsync neither closes the stream nor waits on its cleanup (the caller owns it)', async () => {
			const parser = getGraphParser() as GraphLogParser;
			let releaseCleanup!: () => void;
			const cleanup = new Promise<void>(resolve => (releaseCleanup = resolve));
			let cleanedUp = false;
			async function* source(): AsyncGenerator<string> {
				try {
					for (const sha of ['sha1', 'sha2', 'sha3', 'sha4']) {
						yield graphRecord(sha);
					}
				} finally {
					await cleanup;
					cleanedUp = true;
				}
			}

			const stream = source();
			const originalReturn = stream.return.bind(stream);
			let returnCalls = 0;
			stream.return = (value: unknown) => {
				returnCalls++;
				return originalReturn(value);
			};

			const entries: string[] = [];
			for await (const entry of parser.parseAsync(stream)) {
				entries.push(entry.sha);
				break;
			}

			assert.deepStrictEqual(entries, ['sha1']);
			assert.strictEqual(returnCalls, 0, 'parseAsync must not call return() on the stream it was given');
			assert.strictEqual(cleanedUp, false);

			const closing = stream.return(undefined);
			releaseCleanup();
			await closing;
			assert.ok(cleanedUp);
		});

		test('breaking out of parseAsyncBatched closes the source stream (unchanged from before)', async () => {
			const parser = getGraphParser() as GraphLogParser;
			let closed = false;
			let pulled = 0;
			async function* source(): AsyncGenerator<string> {
				try {
					for (const sha of ['sha1', 'sha2', 'sha3']) {
						pulled++;
						yield graphRecord(sha);
					}
					yield graphRecord('sha4');
				} finally {
					closed = true;
				}
			}

			for await (const _ of parser.parseAsyncBatched!(source())) {
				break;
			}
			assert.ok(closed, 'the source generator must be closed so its finally runs');
			assert.ok(pulled < 3, 'parsing must stop pulling chunks once the consumer stops');
		});

		test('an error from the source propagates as the same object, after the records before it', async () => {
			const parser = getGraphParser() as GraphLogParser;
			const error = new Error('git failed');
			async function* source(): AsyncGenerator<string> {
				yield graphRecord('sha1') + graphRecord('sha2').substring(0, 5);
				throw error;
			}

			for (const [path, parse] of [
				['parseAsync', (s: AsyncGenerator<string>) => parser.parseAsync(s)],
				['parseAsyncBatched', (s: AsyncGenerator<string>) => parser.parseAsyncBatched!(s)],
			] as const) {
				const shas: string[] = [];
				let caught: unknown;
				try {
					for await (const value of parse(source())) {
						for (const entry of Array.isArray(value) ? value : [value]) {
							shas.push(entry.sha);
						}
					}
				} catch (ex) {
					caught = ex;
				}
				assert.deepStrictEqual(shas, ['sha1'], path);
				assert.strictEqual(caught, error, path);
			}
		});

		test('breaking out of parse over a lazy Iterable closes it', () => {
			const parser = getGraphParser() as GraphLogParser;
			let closed = false;
			let pulled = 0;
			function* source(): Generator<string> {
				try {
					for (const sha of ['sha1', 'sha2', 'sha3', 'sha4']) {
						pulled++;
						yield graphRecord(sha);
					}
				} finally {
					closed = true;
				}
			}

			for (const _ of parser.parse(source())) {
				break;
			}
			assert.ok(closed, 'the source generator must be closed so its finally runs');
			assert.ok(pulled < 4, 'parsing must stop pulling chunks once the consumer stops');
		});
	});

	suite('chunk boundaries', () => {
		const fields = (sha: string) => [sha, 'Alice', 'a@x.com', '100', '101', 'p1', '', `${sha} \x1Emessage`];
		const expected = ['sha1', 'sha2'];

		async function shasForChunks(chunks: string[]): Promise<[string, string[]][]> {
			const parser = getGraphParser() as GraphLogParser;
			return [
				['parse', Array.from(parser.parse(chunks.values()), e => e.sha)],
				['parseAsync', (await collect(parser.parseAsync(streamOf(chunks)))).map(e => e.sha)],
				[
					'parseAsyncBatched',
					(await collect(parser.parseAsyncBatched!(streamOf(chunks)))).flat().map(e => e.sha),
				],
			];
		}

		test("an empty chunk between a separator's NUL and its marker still splits the records", async () => {
			const first = record(fields('sha1'));
			const second = record(fields('sha2'));
			const chunks = [`${first}\0`, '', second.substring(1)];
			for (const [path, shas] of await shasForChunks(chunks)) {
				assert.deepStrictEqual(shas, expected, path);
			}
		});

		test('a bare 0x1E at the start of a chunk, with no NUL before it, does not split a record', async () => {
			const first = record(fields('sha1'));
			const second = record(fields('sha2'));
			const marker = first.indexOf('\x1Emessage');
			const chunks = [first.substring(0, marker), first.substring(marker) + second];
			for (const [path, shas] of await shasForChunks(chunks)) {
				assert.deepStrictEqual(shas, expected, path);
			}

			const parser = getGraphParser() as GraphLogParser;
			const entries = await collect(parser.parseAsync(streamOf(chunks)));
			assert.strictEqual(entries[0].message, 'sha1 \x1Emessage');
		});
	});

	suite('records spanning many chunks', () => {
		async function countIndexOfWork(fn: () => Promise<void>): Promise<number> {
			const original = String.prototype.indexOf;
			let examined = 0;
			// oxlint-disable-next-line no-extend-native -- counts the chars indexOf scans; restored in finally
			String.prototype.indexOf = function (this: string, search: string, position?: number): number {
				const index = original.call(this, search, position);
				const from = Math.min(Math.max(position ?? 0, 0), this.length);
				examined += (index === -1 ? this.length : index + search.length) - from;
				return index;
			};
			try {
				await fn();
			} finally {
				// oxlint-disable-next-line no-extend-native -- restores the original indexOf
				String.prototype.indexOf = original;
			}
			return examined;
		}

		test('a 2MB file list in 100-char chunks parses in linear work', async () => {
			const parser = getShaAndDatesWithFilesLogParser();
			const paths = Array.from({ length: 100_000 }, (_, i) => `src/folder/file-${i}.ts`);
			const data = record(['sha1', '100', '101'], `\n\n${paths.join('\n')}\n`) + record(['sha2', '200', '201']);
			assert.ok(data.length > 2_000_000);

			let entries: { sha: string; files: { path: string }[] }[] = [];
			const examined = await countIndexOfWork(async () => {
				entries = await collect(parser.parseAsync(streamOf(chunk(data, 100))));
			});

			assert.deepStrictEqual(
				entries.map(e => e.sha),
				['sha1', 'sha2'],
			);
			assert.deepStrictEqual(
				entries[0].files.map(f => f.path),
				paths,
			);
			assert.deepStrictEqual(entries[1].files, []);
			assert.ok(examined < data.length * 4, `examined ${examined} chars for ${data.length} of input`);
		});

		test('a 2MB graph message in 100-char chunks parses in linear work (parse, parseAsync, parseAsyncBatched)', async () => {
			const parser = getGraphParser() as GraphLogParser;
			const message = 'm\x1E\x1D😀'.repeat(400_000);
			const fields = (sha: string) => [sha, 'Alice', 'a@x.com', '100', '101', 'p1', '', message];
			const data = record(fields('sha1')) + record(fields('sha2'));
			const chunks = chunk(data, 100);

			for (const [path, run] of [
				['parse', async () => [...parser.parse(chunks.values())]],
				['parseAsync', () => collect(parser.parseAsync(streamOf(chunks)))],
				['parseAsyncBatched', async () => (await collect(parser.parseAsyncBatched!(streamOf(chunks)))).flat()],
			] as const) {
				let entries: { sha: string; message: string }[] = [];
				const examined = await countIndexOfWork(async () => {
					entries = await run();
				});

				assert.deepStrictEqual(
					entries.map(e => e.sha),
					['sha1', 'sha2'],
					path,
				);
				assert.ok(
					entries.every(e => e.message === message),
					path,
				);
				assert.ok(
					examined < data.length * 3,
					`${path}: examined ${examined} chars for ${data.length} of input`,
				);
			}
		});
	});
});

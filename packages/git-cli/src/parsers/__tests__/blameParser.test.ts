import * as assert from 'assert';
import { parseGitBlame } from '../blameParser.js';

const repoPath = '/repo';

function blameBlock(options: {
	sha: string;
	originalLine: number;
	line: number;
	lineCount: number;
	author: string;
	authorEmail: string;
	authorTime: number;
	authorTz?: string;
	committer: string;
	committerEmail: string;
	committerTime: number;
	committerTz?: string;
	summary: string;
	filename: string;
	previousSha?: string;
	previousPath?: string;
}): string {
	const lines: string[] = [];
	lines.push(`${options.sha} ${options.originalLine} ${options.line} ${options.lineCount}`);
	lines.push(`author ${options.author}`);
	lines.push(`author-mail <${options.authorEmail}>`);
	lines.push(`author-time ${options.authorTime}`);
	lines.push(`author-tz ${options.authorTz ?? '+0000'}`);
	lines.push(`committer ${options.committer}`);
	lines.push(`committer-mail <${options.committerEmail}>`);
	lines.push(`committer-time ${options.committerTime}`);
	lines.push(`committer-tz ${options.committerTz ?? '+0000'}`);
	if (options.previousSha) {
		lines.push(`previous ${options.previousSha} ${options.previousPath ?? options.filename}`);
	}
	lines.push(`summary ${options.summary}`);
	lines.push(`filename ${options.filename}`);
	return lines.join('\n');
}

suite('Blame Parser Test Suite', () => {
	test('returns undefined for empty data', () => {
		const result = parseGitBlame(repoPath, '', undefined);
		assert.strictEqual(result, undefined, 'Should return undefined for empty string');
	});

	test('returns undefined for undefined data', () => {
		const result = parseGitBlame(repoPath, undefined, undefined);
		assert.strictEqual(result, undefined, 'Should return undefined for undefined data');
	});

	test('parses single commit with single line', () => {
		const data = blameBlock({
			sha: 'abc1234abc1234abc1234abc1234abc1234abc123',
			originalLine: 1,
			line: 1,
			lineCount: 1,
			author: 'John Doe',
			authorEmail: 'john@example.com',
			authorTime: 1700000000,
			committer: 'John Doe',
			committerEmail: 'john@example.com',
			committerTime: 1700000000,
			summary: 'Initial commit',
			filename: 'src/foo.ts',
		});

		const result = parseGitBlame(repoPath, data, undefined);

		assert.ok(result, 'Should return a blame');
		assert.strictEqual(result.commits.size, 1, 'Should have 1 commit');
		assert.strictEqual(result.lines.length, 1, 'Should have 1 line');

		const commit = result.commits.get('abc1234abc1234abc1234abc1234abc1234abc123');
		assert.ok(commit, 'Should find the commit');
		assert.strictEqual(commit.author.name, 'John Doe', 'Should have correct author name');
		assert.strictEqual(commit.author.email, 'john@example.com', 'Should have correct author email');
		assert.strictEqual(commit.sha, 'abc1234abc1234abc1234abc1234abc1234abc123', 'Should have correct SHA');
	});

	test('parses multiple commits across lines', () => {
		const data = [
			blameBlock({
				sha: 'aaa1111aaa1111aaa1111aaa1111aaa1111aaa111',
				originalLine: 1,
				line: 1,
				lineCount: 2,
				author: 'Alice',
				authorEmail: 'alice@example.com',
				authorTime: 1700000000,
				committer: 'Alice',
				committerEmail: 'alice@example.com',
				committerTime: 1700000000,
				summary: 'First commit',
				filename: 'src/foo.ts',
			}),
			blameBlock({
				sha: 'bbb2222bbb2222bbb2222bbb2222bbb2222bbb222',
				originalLine: 1,
				line: 3,
				lineCount: 1,
				author: 'Bob',
				authorEmail: 'bob@example.com',
				authorTime: 1700100000,
				committer: 'Bob',
				committerEmail: 'bob@example.com',
				committerTime: 1700100000,
				summary: 'Second commit',
				filename: 'src/foo.ts',
			}),
		].join('\n');

		const result = parseGitBlame(repoPath, data, undefined);

		assert.ok(result, 'Should return a blame');
		assert.strictEqual(result.commits.size, 2, 'Should have 2 commits');
		assert.strictEqual(result.lines.length, 3, 'Should have 3 lines total');
		assert.strictEqual(
			result.lines[0].sha,
			'aaa1111aaa1111aaa1111aaa1111aaa1111aaa111',
			'Line 1 attributed to Alice',
		);
		assert.strictEqual(
			result.lines[1].sha,
			'aaa1111aaa1111aaa1111aaa1111aaa1111aaa111',
			'Line 2 attributed to Alice',
		);
		assert.strictEqual(
			result.lines[2].sha,
			'bbb2222bbb2222bbb2222bbb2222bbb2222bbb222',
			'Line 3 attributed to Bob',
		);
	});

	test('handles uncommitted lines with SHA of all zeros', () => {
		const uncommittedSha = '0000000000000000000000000000000000000000';
		const currentUser = { name: 'Jane', email: 'jane@example.com' };

		const data = blameBlock({
			sha: uncommittedSha,
			originalLine: 1,
			line: 1,
			lineCount: 1,
			author: 'Not Used',
			authorEmail: 'notused@example.com',
			authorTime: 1700000000,
			committer: 'Not Used',
			committerEmail: 'notused@example.com',
			committerTime: 1700000000,
			summary: 'Not Committed Yet',
			filename: 'src/foo.ts',
		});

		const result = parseGitBlame(repoPath, data, currentUser);

		assert.ok(result, 'Should return a blame');
		const commit = result.commits.get(uncommittedSha);
		assert.ok(commit, 'Should find the uncommitted commit');
		assert.strictEqual(commit.author.name, 'Jane', 'Uncommitted author should use currentUser name');
		assert.strictEqual(commit.author.current, true, 'Uncommitted author should be marked as current user');
		assert.strictEqual(commit.author.email, 'jane@example.com', 'Should use currentUser email for uncommitted');
	});

	test('accumulates author lineCount across multiple commits', () => {
		const data = [
			blameBlock({
				sha: 'aaa1111aaa1111aaa1111aaa1111aaa1111aaa111',
				originalLine: 1,
				line: 1,
				lineCount: 3,
				author: 'Alice',
				authorEmail: 'alice@example.com',
				authorTime: 1700000000,
				committer: 'Alice',
				committerEmail: 'alice@example.com',
				committerTime: 1700000000,
				summary: 'First commit',
				filename: 'src/foo.ts',
			}),
			blameBlock({
				sha: 'bbb2222bbb2222bbb2222bbb2222bbb2222bbb222',
				originalLine: 1,
				line: 4,
				lineCount: 2,
				author: 'Alice',
				authorEmail: 'alice@example.com',
				authorTime: 1700100000,
				committer: 'Alice',
				committerEmail: 'alice@example.com',
				committerTime: 1700100000,
				summary: 'Second commit',
				filename: 'src/foo.ts',
			}),
		].join('\n');

		const result = parseGitBlame(repoPath, data, undefined);

		assert.ok(result, 'Should return a blame');
		const author = result.authors.get('Alice');
		assert.ok(author, 'Should have Alice as an author');
		assert.strictEqual(author.lineCount, 5, 'Alice should have 5 total lines (3 + 2)');
	});

	test('extracts email without angle brackets', () => {
		const data = blameBlock({
			sha: 'abc1234abc1234abc1234abc1234abc1234abc123',
			originalLine: 1,
			line: 1,
			lineCount: 1,
			author: 'John Doe',
			authorEmail: 'john@example.com',
			authorTime: 1700000000,
			committer: 'John Doe',
			committerEmail: 'john@example.com',
			committerTime: 1700000000,
			summary: 'Test commit',
			filename: 'src/foo.ts',
		});

		const result = parseGitBlame(repoPath, data, undefined);

		assert.ok(result, 'Should return a blame');
		const commit = result.commits.get('abc1234abc1234abc1234abc1234abc1234abc123');
		assert.ok(commit, 'Should find the commit');
		assert.strictEqual(commit.author.email, 'john@example.com', 'Email should not contain angle brackets');
		assert.strictEqual(
			commit.committer.email,
			'john@example.com',
			'Committer email should not contain angle brackets',
		);
	});

	test('sorts authors by line count descending', () => {
		const data = [
			blameBlock({
				sha: 'aaa1111aaa1111aaa1111aaa1111aaa1111aaa111',
				originalLine: 1,
				line: 1,
				lineCount: 1,
				author: 'Minor Author',
				authorEmail: 'minor@example.com',
				authorTime: 1700000000,
				committer: 'Minor Author',
				committerEmail: 'minor@example.com',
				committerTime: 1700000000,
				summary: 'Small fix',
				filename: 'src/foo.ts',
			}),
			blameBlock({
				sha: 'bbb2222bbb2222bbb2222bbb2222bbb2222bbb222',
				originalLine: 1,
				line: 2,
				lineCount: 5,
				author: 'Major Author',
				authorEmail: 'major@example.com',
				authorTime: 1700100000,
				committer: 'Major Author',
				committerEmail: 'major@example.com',
				committerTime: 1700100000,
				summary: 'Big feature',
				filename: 'src/foo.ts',
			}),
		].join('\n');

		const result = parseGitBlame(repoPath, data, undefined);

		assert.ok(result, 'Should return a blame');
		const authorNames = [...result.authors.keys()];
		assert.strictEqual(authorNames[0], 'Major Author', 'Author with most lines should be first');
		assert.strictEqual(authorNames[1], 'Minor Author', 'Author with fewer lines should be second');
	});

	test('deduplicates commits with same SHA', () => {
		// When the same SHA appears for multiple line ranges, only one commit is created
		const sha = 'abc1234abc1234abc1234abc1234abc1234abc123';
		const data = [
			blameBlock({
				sha: sha,
				originalLine: 1,
				line: 1,
				lineCount: 2,
				author: 'Alice',
				authorEmail: 'alice@example.com',
				authorTime: 1700000000,
				committer: 'Alice',
				committerEmail: 'alice@example.com',
				committerTime: 1700000000,
				summary: 'Initial commit',
				filename: 'src/foo.ts',
			}),
			blameBlock({
				sha: sha,
				originalLine: 5,
				line: 3,
				lineCount: 1,
				author: 'Alice',
				authorEmail: 'alice@example.com',
				authorTime: 1700000000,
				committer: 'Alice',
				committerEmail: 'alice@example.com',
				committerTime: 1700000000,
				summary: 'Initial commit',
				filename: 'src/foo.ts',
			}),
		].join('\n');

		const result = parseGitBlame(repoPath, data, undefined);

		assert.ok(result, 'Should return a blame');
		assert.strictEqual(result.commits.size, 1, 'Should have only 1 unique commit');
		assert.strictEqual(result.lines.length, 3, 'Should have 3 lines total');
	});

	test('marks author as current user when matching currentUser', () => {
		const currentUser = { name: 'Alice', email: 'alice@example.com' };

		const data = blameBlock({
			sha: 'abc1234abc1234abc1234abc1234abc1234abc123',
			originalLine: 1,
			line: 1,
			lineCount: 1,
			author: 'Alice',
			authorEmail: 'alice@example.com',
			authorTime: 1700000000,
			committer: 'Alice',
			committerEmail: 'alice@example.com',
			committerTime: 1700000000,
			summary: 'My commit',
			filename: 'src/foo.ts',
		});

		const result = parseGitBlame(repoPath, data, currentUser);

		assert.ok(result, 'Should return a blame');
		const commit = result.commits.get('abc1234abc1234abc1234abc1234abc1234abc123');
		assert.ok(commit, 'Should find the commit');
		assert.strictEqual(commit.author.name, 'Alice', 'Author should preserve real name');
		assert.strictEqual(commit.author.current, true, 'Author matching currentUser should be marked as current');
		assert.strictEqual(commit.committer.name, 'Alice', 'Committer should preserve real name');
		assert.strictEqual(
			commit.committer.current,
			true,
			'Committer matching currentUser should be marked as current',
		);
	});

	test('preserves author name when no currentUser match', () => {
		const currentUser = { name: 'Someone Else', email: 'other@example.com' };

		const data = blameBlock({
			sha: 'abc1234abc1234abc1234abc1234abc1234abc123',
			originalLine: 1,
			line: 1,
			lineCount: 1,
			author: 'Alice',
			authorEmail: 'alice@example.com',
			authorTime: 1700000000,
			committer: 'Alice',
			committerEmail: 'alice@example.com',
			committerTime: 1700000000,
			summary: 'My commit',
			filename: 'src/foo.ts',
		});

		const result = parseGitBlame(repoPath, data, currentUser);

		assert.ok(result, 'Should return a blame');
		const commit = result.commits.get('abc1234abc1234abc1234abc1234abc1234abc123');
		assert.ok(commit, 'Should find the commit');
		assert.strictEqual(commit.author.name, 'Alice', 'Author should remain Alice when no match');
	});

	test('parses previous SHA and path', () => {
		const data = blameBlock({
			sha: 'abc1234abc1234abc1234abc1234abc1234abc123',
			originalLine: 1,
			line: 1,
			lineCount: 1,
			author: 'Alice',
			authorEmail: 'alice@example.com',
			authorTime: 1700000000,
			committer: 'Alice',
			committerEmail: 'alice@example.com',
			committerTime: 1700000000,
			summary: 'Rename file',
			filename: 'src/bar.ts',
			previousSha: 'def5678def5678def5678def5678def5678def567',
			previousPath: 'src/foo.ts',
		});

		const result = parseGitBlame(repoPath, data, undefined);

		assert.ok(result, 'Should return a blame');
		const line = result.lines[0];
		assert.ok(line, 'Should have line');
		assert.strictEqual(line.previousSha, 'def5678def5678def5678def5678def5678def567', 'Should have previous SHA');
	});

	test('parses previous path with spaces', () => {
		// The previous line format is: `previous <sha> <path with spaces>`
		// The parser joins lineParts.slice(2) to handle spaces in paths
		const data = blameBlock({
			sha: 'abc1234abc1234abc1234abc1234abc1234abc123',
			originalLine: 1,
			line: 1,
			lineCount: 1,
			author: 'Alice',
			authorEmail: 'alice@example.com',
			authorTime: 1700000000,
			committer: 'Alice',
			committerEmail: 'alice@example.com',
			committerTime: 1700000000,
			summary: 'Rename file',
			filename: 'src/new name.ts',
			previousSha: 'def5678def5678def5678def5678def5678def567',
			previousPath: 'src/old file name.ts',
		});

		const result = parseGitBlame(repoPath, data, undefined);

		assert.ok(result, 'Should return a blame');
		const commit = result.commits.get('abc1234abc1234abc1234abc1234abc1234abc123');
		assert.ok(commit, 'Should find the commit');
		// The file should have the previous path with spaces preserved
		assert.ok(commit.file, 'Should have a file');
		assert.strictEqual(commit.file.originalPath, 'src/old file name.ts', 'Should preserve spaces in previous path');
	});

	test('handles uncommitted entry with modifiedTime override', () => {
		const uncommittedSha = '0000000000000000000000000000000000000000';
		const modifiedTime = 1700500000;

		const data = blameBlock({
			sha: uncommittedSha,
			originalLine: 1,
			line: 1,
			lineCount: 1,
			author: 'Ignored',
			authorEmail: 'ignored@example.com',
			authorTime: 9999999999,
			committer: 'Ignored',
			committerEmail: 'ignored@example.com',
			committerTime: 9999999999,
			summary: 'Not committed',
			filename: 'src/foo.ts',
		});

		const result = parseGitBlame(repoPath, data, undefined, modifiedTime);

		assert.ok(result, 'Should return a blame');
		const commit = result.commits.get(uncommittedSha);
		assert.ok(commit, 'Should find the uncommitted commit');
		// The authorTime should use modifiedTime instead of the value in the data
		assert.strictEqual(
			commit.author.date?.getTime(),
			modifiedTime,
			'Should use modifiedTime for uncommitted author date',
		);
	});

	test('sets correct line and originalLine on commit lines', () => {
		const data = blameBlock({
			sha: 'abc1234abc1234abc1234abc1234abc1234abc123',
			originalLine: 10,
			line: 5,
			lineCount: 3,
			author: 'Alice',
			authorEmail: 'alice@example.com',
			authorTime: 1700000000,
			committer: 'Alice',
			committerEmail: 'alice@example.com',
			committerTime: 1700000000,
			summary: 'Some change',
			filename: 'src/foo.ts',
		});

		const result = parseGitBlame(repoPath, data, undefined);

		assert.ok(result, 'Should return a blame');
		// 3 lines: line 5 (originalLine 10), line 6 (originalLine 11), line 7 (originalLine 12)
		assert.strictEqual(result.lines[4]?.line, 5, 'First line number should be 5');
		assert.strictEqual(result.lines[4]?.originalLine, 10, 'First original line should be 10');
		assert.strictEqual(result.lines[5]?.line, 6, 'Second line number should be 6');
		assert.strictEqual(result.lines[5]?.originalLine, 11, 'Second original line should be 11');
		assert.strictEqual(result.lines[6]?.line, 7, 'Third line number should be 7');
		assert.strictEqual(result.lines[6]?.originalLine, 12, 'Third original line should be 12');
	});

	test('sets repoPath on returned blame', () => {
		const data = blameBlock({
			sha: 'abc1234abc1234abc1234abc1234abc1234abc123',
			originalLine: 1,
			line: 1,
			lineCount: 1,
			author: 'Alice',
			authorEmail: 'alice@example.com',
			authorTime: 1700000000,
			committer: 'Alice',
			committerEmail: 'alice@example.com',
			committerTime: 1700000000,
			summary: 'Test',
			filename: 'src/foo.ts',
		});

		const result = parseGitBlame('/my/repo', data, undefined);

		assert.ok(result, 'Should return a blame');
		assert.strictEqual(result.repoPath, '/my/repo', 'Should set repoPath on the result');
	});
});

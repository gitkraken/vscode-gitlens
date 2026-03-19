import * as assert from 'assert';
import { getReflogParser, parseGitRefLog } from '../reflogParser.js';

// The raw parser uses record separator (\x1E) between entries and
// field separator (\x1D) between fields within an entry.
// Fields are: sha, selector (%gD), subject (%gs)
const RS = '\x1E'; // record separator
const FS = '\x1D'; // field separator

function entry(sha: string, selector: string, date: string, command: string, args?: string, details?: string): string {
	// selector field: "refs/heads/main@{date}"
	const selectorField = `${selector}@{${date}}`;
	// subject field: "command[ args][:details]" — mimics git's %gs output
	let subject = command;
	if (args) {
		subject += ` ${args}`;
	}
	if (details) {
		subject += `:${details}`;
	}
	return `${RS}${sha}${FS}${selectorField}${FS}${subject}${FS}`;
}

const repoPath = '/repo';

suite('Reflog Parser Test Suite', () => {
	const parser = getReflogParser();

	test('returns undefined for empty data', () => {
		const result = parseGitRefLog(parser, '', repoPath, ['checkout'], 0, 0);
		assert.strictEqual(result, undefined, 'Should return undefined for empty string');
	});

	test('returns undefined for undefined-like falsy data', () => {
		// The parser checks `!data`, so any falsy value returns undefined
		const result = parseGitRefLog(parser, undefined as unknown as string, repoPath, ['checkout'], 0, 0);
		assert.strictEqual(result, undefined, 'Should return undefined for undefined data');
	});

	test('parses a single reflog entry', () => {
		const data = [
			entry('aaa1111', 'refs/heads/main', '2024-01-15T10:00:00-05:00', 'checkout', 'from dev to main'),
			// Need a second entry with a different sha to flush the first record
			entry('bbb2222', 'refs/heads/main', '2024-01-15T09:00:00-05:00', 'checkout', 'from main to dev'),
		].join('');

		const result = parseGitRefLog(parser, data, repoPath, ['checkout'], 0, 0);

		assert.ok(result, 'Should return a reflog');
		assert.strictEqual(result.records.length, 1, 'Should have 1 record (second entry flushes first)');
		assert.strictEqual(result.records[0].sha, 'aaa1111', 'Should have correct SHA');
		assert.strictEqual(result.records[0].command, 'checkout', 'Should have correct command');
		assert.strictEqual(result.records[0].previousSha, 'bbb2222', 'Previous SHA should be set from next entry');
	});

	test('parses multiple entries', () => {
		const data = [
			entry('aaa1111', 'refs/heads/main', '2024-01-15T12:00:00-05:00', 'checkout', 'from dev to main'),
			entry('bbb2222', 'refs/heads/dev', '2024-01-15T11:00:00-05:00', 'checkout', 'from feature to dev'),
			entry('ccc3333', 'refs/heads/feature', '2024-01-15T10:00:00-05:00', 'checkout', 'from main to feature'),
		].join('');

		const result = parseGitRefLog(parser, data, repoPath, ['checkout'], 0, 0);

		assert.ok(result, 'Should return a reflog');
		assert.strictEqual(result.records.length, 2, 'Should have 2 records (last entry remains in-progress)');
		assert.strictEqual(result.records[0].sha, 'aaa1111', 'First record SHA');
		assert.strictEqual(result.records[1].sha, 'bbb2222', 'Second record SHA');
	});

	test('deduplicates entries with same SHA and same date', () => {
		const date = '2024-01-15T10:00:00-05:00';
		const data = [
			entry('aaa1111', 'refs/heads/main', date, 'checkout', 'from dev to main'),
			entry('aaa1111', 'refs/heads/main', date, 'checkout', 'duplicate'),
			entry('bbb2222', 'refs/heads/dev', '2024-01-15T09:00:00-05:00', 'checkout', 'from main to dev'),
		].join('');

		const result = parseGitRefLog(parser, data, repoPath, ['checkout'], 0, 0);

		assert.ok(result, 'Should return a reflog');
		assert.strictEqual(result.records.length, 1, 'Should deduplicate same SHA + same date');
		assert.strictEqual(result.records[0].sha, 'aaa1111', 'Should keep the first entry');
	});

	test('HEAD records are tracked but do not create their own entries', () => {
		// HEAD command entries are skipped as records but tracked for selector merging
		const data = [
			entry('aaa1111', 'refs/heads/main', '2024-01-15T10:00:00-05:00', 'checkout', 'from dev to main'),
			entry('bbb2222', 'HEAD', '2024-01-15T09:00:00-05:00', 'HEAD'),
			entry('ccc3333', 'refs/heads/dev', '2024-01-15T08:00:00-05:00', 'checkout', 'from main to dev'),
		].join('');

		const result = parseGitRefLog(parser, data, repoPath, ['checkout'], 0, 0);

		assert.ok(result, 'Should return a reflog');
		// HEAD entries do not produce records of their own
		for (const record of result.records) {
			assert.notStrictEqual(record.command, 'HEAD', 'No record should have HEAD as command');
		}
	});

	test('HEAD record selector merges into previous entry when conditions match', () => {
		const date = '2024-01-15T10:00:00-05:00';
		const data = [
			// First record: selector ends with HEAD (isHEADSelector matches)
			entry('aaa1111', 'HEAD', date, 'checkout', 'from dev to main'),
			// HEAD record with same sha and same date — stored as head/headDate/headSha
			entry('aaa1111', 'refs/heads/main', date, 'HEAD'),
			// Next entry with different sha triggers flush, and since record.selector
			// matches isHEADSelector and headSha === record.sha and headDate === recordDate,
			// record.update(sha, head) is called, replacing the selector with the HEAD value
			entry('bbb2222', 'refs/heads/dev', '2024-01-15T09:00:00-05:00', 'checkout', 'from main to dev'),
		].join('');

		const result = parseGitRefLog(parser, data, repoPath, ['checkout'], 0, 0);

		assert.ok(result, 'Should return a reflog');
		assert.strictEqual(result.records.length, 1, 'Should have 1 record (checkout)');

		// The key behavior: the selector should be updated from 'HEAD' to the HEAD record's selector
		const record = result.records[0];
		assert.strictEqual(record.selector, 'refs/heads/main', 'Selector should be merged from HEAD record');
		assert.strictEqual(record.previousSha, 'bbb2222', 'previousSha should be set from the flushing entry');
	});

	test('filters entries by command list', () => {
		const data = [
			entry('aaa1111', 'refs/heads/main', '2024-01-15T12:00:00-05:00', 'checkout', 'from dev to main'),
			entry('bbb2222', 'refs/heads/dev', '2024-01-15T11:00:00-05:00', 'commit', 'adding feature'),
			entry('ccc3333', 'refs/heads/dev', '2024-01-15T10:00:00-05:00', 'checkout', 'from main to dev'),
		].join('');

		const result = parseGitRefLog(parser, data, repoPath, ['checkout'], 0, 0);

		assert.ok(result, 'Should return a reflog');
		// Only 'checkout' commands should produce records
		for (const record of result.records) {
			assert.strictEqual(record.command, 'checkout', 'All records should be checkout commands');
		}
	});

	test('includes entries matching any command in the commands array', () => {
		const data = [
			entry('aaa1111', 'refs/heads/main', '2024-01-15T12:00:00-05:00', 'checkout', 'from dev to main'),
			entry('bbb2222', 'refs/heads/dev', '2024-01-15T11:00:00-05:00', 'merge', 'branch feature'),
			entry('ccc3333', 'refs/heads/dev', '2024-01-15T10:00:00-05:00', 'commit', 'initial'),
		].join('');

		const result = parseGitRefLog(parser, data, repoPath, ['checkout', 'merge'], 0, 0);

		assert.ok(result, 'Should return a reflog');
		// Both checkout and merge records are flushed (the non-matching commit entry triggers flush of merge)
		assert.strictEqual(result.records.length, 2, 'Should have 2 records matching checkout and merge');
		assert.strictEqual(result.records[0].command, 'checkout', 'First record should be checkout');
		assert.strictEqual(result.records[1].command, 'merge', 'Second record should be merge');
	});

	test('respects limit parameter', () => {
		const data = [
			entry('aaa1111', 'refs/heads/main', '2024-01-15T14:00:00-05:00', 'checkout', 'a'),
			entry('bbb2222', 'refs/heads/dev', '2024-01-15T13:00:00-05:00', 'checkout', 'b'),
			entry('ccc3333', 'refs/heads/feature', '2024-01-15T12:00:00-05:00', 'checkout', 'c'),
			entry('ddd4444', 'refs/heads/main', '2024-01-15T11:00:00-05:00', 'checkout', 'd'),
		].join('');

		const result = parseGitRefLog(parser, data, repoPath, ['checkout'], 1, 0);

		assert.ok(result, 'Should return a reflog');
		assert.strictEqual(result.records.length, 1, 'Should respect limit of 1');
		assert.strictEqual(result.count, 1, 'Count should be 1');
	});

	test('hasMore is true when more entries exist beyond limit', () => {
		const data = [
			entry('aaa1111', 'refs/heads/main', '2024-01-15T14:00:00-05:00', 'checkout', 'a'),
			entry('bbb2222', 'refs/heads/dev', '2024-01-15T13:00:00-05:00', 'checkout', 'b'),
			entry('ccc3333', 'refs/heads/feature', '2024-01-15T12:00:00-05:00', 'checkout', 'c'),
		].join('');

		const result = parseGitRefLog(parser, data, repoPath, ['checkout'], 1, 0);

		assert.ok(result, 'Should return a reflog');
		assert.strictEqual(result.hasMore, true, 'hasMore should be true when limited');
	});

	test('hasMore is false when all entries are within limit', () => {
		const data = [
			entry('aaa1111', 'refs/heads/main', '2024-01-15T12:00:00-05:00', 'checkout', 'a'),
			entry('bbb2222', 'refs/heads/dev', '2024-01-15T11:00:00-05:00', 'checkout', 'b'),
		].join('');

		const result = parseGitRefLog(parser, data, repoPath, ['checkout'], 0, 0);

		assert.ok(result, 'Should return a reflog');
		assert.strictEqual(result.hasMore, false, 'hasMore should be false when no limit exceeded');
	});

	test('hasMore is true when total reaches totalLimit', () => {
		const data = [
			entry('aaa1111', 'refs/heads/main', '2024-01-15T14:00:00-05:00', 'checkout', 'a'),
			entry('bbb2222', 'refs/heads/dev', '2024-01-15T13:00:00-05:00', 'checkout', 'b'),
			entry('ccc3333', 'refs/heads/feature', '2024-01-15T12:00:00-05:00', 'checkout', 'c'),
		].join('');

		const result = parseGitRefLog(parser, data, repoPath, ['checkout'], 0, 3);

		assert.ok(result, 'Should return a reflog');
		assert.strictEqual(result.total, 3, 'Total should be 3');
		assert.strictEqual(result.hasMore, true, 'hasMore should be true when total reaches totalLimit');
	});

	test('parses entry with details after colon', () => {
		const data = [
			entry('aaa1111', 'refs/heads/main', '2024-01-15T12:00:00-05:00', 'pull', '', ' from origin'),
			entry('bbb2222', 'refs/heads/main', '2024-01-15T11:00:00-05:00', 'pull', '', ' initial'),
		].join('');

		const result = parseGitRefLog(parser, data, repoPath, ['pull'], 0, 0);

		assert.ok(result, 'Should return a reflog');
		assert.strictEqual(result.records.length, 1, 'Should have 1 record');
		assert.strictEqual(result.records[0].details, 'from origin', 'Should parse details after colon');
	});

	test('repoPath is set on returned reflog', () => {
		const data = [
			entry('aaa1111', 'refs/heads/main', '2024-01-15T12:00:00-05:00', 'checkout', 'a'),
			entry('bbb2222', 'refs/heads/dev', '2024-01-15T11:00:00-05:00', 'checkout', 'b'),
		].join('');

		const result = parseGitRefLog(parser, data, '/my/repo', ['checkout'], 0, 0);

		assert.ok(result, 'Should return a reflog');
		assert.strictEqual(result.repoPath, '/my/repo', 'Should set repoPath on the result');
	});
});

import * as assert from 'assert';
import type { FilteredGitFeatures } from '@gitlens/git/features.js';
import { getBranchParser, getTagParser } from '../refParser.js';

const recordSep = '\x1E';
const fieldSep = '\x1D';

function buildRecord(fields: string[]): string {
	return fields.join(fieldSep) + fieldSep;
}

function buildData(records: string[]): string {
	return records.map(r => recordSep + r).join('');
}

suite('Ref Parser Test Suite', () => {
	suite('getBranchParser', () => {
		// Branch fields (without worktreePath): current, name, upstream, upstreamTracking, sha, date
		const featuresWithoutWorktree: FilteredGitFeatures<'git:for-each-ref'>[] = [];
		const featuresWithWorktree: FilteredGitFeatures<'git:for-each-ref'>[] = ['git:for-each-ref:worktreePath'];

		test('returns nothing for undefined data', () => {
			const parser = getBranchParser(featuresWithoutWorktree);
			const results = [...parser.parse(undefined)];
			assert.strictEqual(results.length, 0, 'Should yield nothing for undefined data');
		});

		test('returns nothing for empty string data', () => {
			const parser = getBranchParser(featuresWithoutWorktree);
			const results = [...parser.parse('')];
			assert.strictEqual(results.length, 0, 'Should yield nothing for empty string data');
		});

		test('parses a single branch record with all fields populated', () => {
			const parser = getBranchParser(featuresWithoutWorktree);
			const record = buildRecord([
				'*', // current (HEAD)
				'refs/heads/main', // name
				'refs/remotes/origin/main', // upstream
				'[ahead 2, behind 1]', // upstreamTracking
				'abc1234567890', // sha
				'2025-06-15 10:30:00 +0000', // date
			]);
			const data = buildData([record]);

			const results = [...parser.parse(data)];

			assert.strictEqual(results.length, 1, 'Should yield one result');
			const branch = results[0];
			assert.strictEqual(branch.current, '*', 'Should have current indicator');
			assert.strictEqual(branch.name, 'refs/heads/main', 'Should have correct name');
			assert.strictEqual(branch.upstream, 'refs/remotes/origin/main', 'Should have correct upstream');
			assert.strictEqual(branch.upstreamTracking, '[ahead 2, behind 1]', 'Should have correct tracking');
			assert.strictEqual(branch.sha, 'abc1234567890', 'Should have correct sha');
			assert.strictEqual(branch.date, '2025-06-15 10:30:00 +0000', 'Should have correct date');
		});

		test('parses multiple branch records', () => {
			const parser = getBranchParser(featuresWithoutWorktree);
			const record1 = buildRecord([
				'*',
				'refs/heads/main',
				'refs/remotes/origin/main',
				'[ahead 1]',
				'aaa111',
				'2025-01-01 00:00:00 +0000',
			]);
			const record2 = buildRecord([' ', 'refs/heads/feature', '', '', 'bbb222', '2025-02-01 00:00:00 +0000']);
			const record3 = buildRecord([
				' ',
				'refs/heads/develop',
				'refs/remotes/origin/develop',
				'',
				'ccc333',
				'2025-03-01 00:00:00 +0000',
			]);
			const data = buildData([record1, record2, record3]);

			const results = [...parser.parse(data)];

			assert.strictEqual(results.length, 3, 'Should yield three results');
			assert.strictEqual(results[0].name, 'refs/heads/main');
			assert.strictEqual(results[1].name, 'refs/heads/feature');
			assert.strictEqual(results[2].name, 'refs/heads/develop');
		});

		test('handles records with empty fields gracefully', () => {
			const parser = getBranchParser(featuresWithoutWorktree);
			const record = buildRecord([
				' ', // current
				'refs/heads/detached', // name
				'', // upstream (empty)
				'', // upstreamTracking (empty)
				'ddd444', // sha
				'', // date (empty)
			]);
			const data = buildData([record]);

			const results = [...parser.parse(data)];

			assert.strictEqual(results.length, 1, 'Should yield one result');
			assert.strictEqual(results[0].upstream, '', 'Should have empty upstream');
			assert.strictEqual(results[0].upstreamTracking, '', 'Should have empty tracking');
			assert.strictEqual(results[0].date, '', 'Should have empty date');
		});

		test('skips empty records between valid ones', () => {
			const parser = getBranchParser(featuresWithoutWorktree);
			const record = buildRecord(['*', 'refs/heads/main', '', '', 'eee555', '2025-06-01 00:00:00 +0000']);
			// Insert empty records (just record separators with no content)
			const data = `${recordSep}${recordSep}${record}${recordSep}`;

			const results = [...parser.parse(data)];

			assert.strictEqual(results.length, 1, 'Should skip empty records and yield only the valid one');
			assert.strictEqual(results[0].name, 'refs/heads/main');
		});

		test('worktree-enabled and non-worktree parsers are cached independently', () => {
			const parserWithout = getBranchParser(featuresWithoutWorktree);
			const parserWith = getBranchParser(featuresWithWorktree);

			assert.notStrictEqual(parserWithout, parserWith, 'Should return different cached parsers');
			assert.ok(
				!parserWithout.arguments[0].includes('%(worktreepath)'),
				'Non-worktree parser should not include %(worktreepath)',
			);
			assert.ok(
				parserWith.arguments[0].includes('%(worktreepath)'),
				'Worktree parser should include %(worktreepath)',
			);
		});

		test('worktree parser parses worktreePath field', () => {
			const parser = getBranchParser(featuresWithWorktree);
			const record = buildRecord([
				'*',
				'refs/heads/main',
				'refs/remotes/origin/main',
				'',
				'abc123',
				'2025-01-01 00:00:00 +0000',
				'/home/user/worktree',
			]);
			const data = buildData([record]);
			const results = [...parser.parse(data)];

			assert.strictEqual(results.length, 1);
			assert.strictEqual(
				(results[0] as any).worktreePath,
				'/home/user/worktree',
				'Should parse worktreePath field',
			);
		});
	});

	suite('getTagParser', () => {
		// Tag fields: name, tagSha, sha, date, commitDate, message

		test('returns nothing for undefined data', () => {
			const parser = getTagParser();
			const results = [...parser.parse(undefined)];
			assert.strictEqual(results.length, 0, 'Should yield nothing for undefined data');
		});

		test('returns nothing for empty string data', () => {
			const parser = getTagParser();
			const results = [...parser.parse('')];
			assert.strictEqual(results.length, 0, 'Should yield nothing for empty string data');
		});

		test('parses a single tag record with all fields populated', () => {
			const parser = getTagParser();
			const record = buildRecord([
				'refs/tags/v1.0.0', // name
				'aaa111222333', // tagSha
				'bbb444555666', // sha (commit the tag points to)
				'2025-01-15 12:00:00 +0000', // date
				'2025-01-14 10:00:00 +0000', // commitDate
				'Release v1.0.0', // message
			]);
			const data = buildData([record]);

			const results = [...parser.parse(data)];

			assert.strictEqual(results.length, 1, 'Should yield one result');
			const tag = results[0];
			assert.strictEqual(tag.name, 'refs/tags/v1.0.0', 'Should have correct name');
			assert.strictEqual(tag.tagSha, 'aaa111222333', 'Should have correct tagSha');
			assert.strictEqual(tag.sha, 'bbb444555666', 'Should have correct sha');
			assert.strictEqual(tag.date, '2025-01-15 12:00:00 +0000', 'Should have correct date');
			assert.strictEqual(tag.commitDate, '2025-01-14 10:00:00 +0000', 'Should have correct commitDate');
			assert.strictEqual(tag.message, 'Release v1.0.0', 'Should have correct message');
		});

		test('parses multiple tag records', () => {
			const parser = getTagParser();
			const record1 = buildRecord([
				'refs/tags/v1.0.0',
				'aaa111',
				'bbb111',
				'2025-01-01 00:00:00 +0000',
				'2024-12-31 00:00:00 +0000',
				'First release',
			]);
			const record2 = buildRecord([
				'refs/tags/v2.0.0',
				'aaa222',
				'bbb222',
				'2025-06-01 00:00:00 +0000',
				'2025-05-31 00:00:00 +0000',
				'Major update',
			]);
			const data = buildData([record1, record2]);

			const results = [...parser.parse(data)];

			assert.strictEqual(results.length, 2, 'Should yield two results');
			assert.strictEqual(results[0].name, 'refs/tags/v1.0.0');
			assert.strictEqual(results[0].message, 'First release');
			assert.strictEqual(results[1].name, 'refs/tags/v2.0.0');
			assert.strictEqual(results[1].message, 'Major update');
		});

		test('handles lightweight tag with empty sha and commitDate fields', () => {
			const parser = getTagParser();
			const record = buildRecord([
				'refs/tags/v0.1.0', // name
				'ccc333', // tagSha
				'', // sha (empty for lightweight tag)
				'2025-03-01 00:00:00 +0000', // date
				'', // commitDate (empty)
				'', // message (empty)
			]);
			const data = buildData([record]);

			const results = [...parser.parse(data)];

			assert.strictEqual(results.length, 1, 'Should yield one result');
			assert.strictEqual(results[0].sha, '', 'Should have empty sha for lightweight tag');
			assert.strictEqual(results[0].commitDate, '', 'Should have empty commitDate');
			assert.strictEqual(results[0].message, '', 'Should have empty message');
		});
	});
});

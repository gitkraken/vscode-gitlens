import * as assert from 'assert';
import type { FilteredGitFeatures } from '@gitlens/git/features.js';
import { getRefParser } from '../refParser.js';

const recordSep = '\x1E';
const fieldSep = '\x1D';

// Unified RefRecord fields, in mapping declaration order:
// current, name, objectname, peeledObjectname, upstream, upstreamTracking,
// committerDate, creatorDate, authorDate, subject, [worktreePath, upstreamRemote, upstreamRemoteRef], push
function buildRecord(fields: string[]): string {
	return fields.join(fieldSep) + fieldSep;
}

function buildData(records: string[]): string {
	return records.map(r => recordSep + r).join('');
}

suite('Ref Parser Test Suite', () => {
	const featuresWithoutWorktree: FilteredGitFeatures<'git:for-each-ref'>[] = [];
	const featuresWithWorktree: FilteredGitFeatures<'git:for-each-ref'>[] = ['git:for-each-ref:worktreePath'];

	test('returns nothing for undefined data', () => {
		const parser = getRefParser(featuresWithoutWorktree);
		const results = [...parser.parse(undefined)];
		assert.strictEqual(results.length, 0, 'Should yield nothing for undefined data');
	});

	test('returns nothing for empty string data', () => {
		const parser = getRefParser(featuresWithoutWorktree);
		const results = [...parser.parse('')];
		assert.strictEqual(results.length, 0, 'Should yield nothing for empty string data');
	});

	test('parses a branch record with full fields populated', () => {
		const parser = getRefParser(featuresWithoutWorktree);
		const record = buildRecord([
			'*', // current (HEAD)
			'refs/heads/main', // name
			'abc1234567890', // objectname
			'', // peeledObjectname (empty for branches)
			'refs/remotes/origin/main', // upstream
			'[ahead 2, behind 1]', // upstreamTracking
			'2025-06-15 10:30:00 +0000', // committerDate
			'', // creatorDate (empty for branches)
			'', // authorDate (empty for branches)
			'', // subject (empty for branches)
		]);
		const data = buildData([record]);

		const results = [...parser.parse(data)];

		assert.strictEqual(results.length, 1, 'Should yield one result');
		const ref = results[0];
		assert.strictEqual(ref.current, '*');
		assert.strictEqual(ref.name, 'refs/heads/main');
		assert.strictEqual(ref.objectname, 'abc1234567890');
		assert.strictEqual(ref.peeledObjectname, '');
		assert.strictEqual(ref.upstream, 'refs/remotes/origin/main');
		assert.strictEqual(ref.upstreamTracking, '[ahead 2, behind 1]');
		assert.strictEqual(ref.committerDate, '2025-06-15 10:30:00 +0000');
	});

	test('parses a tag record with peeled SHA and dates', () => {
		const parser = getRefParser(featuresWithoutWorktree);
		const record = buildRecord([
			'', // current
			'refs/tags/v1.0.0', // name
			'aaa111222333', // objectname (tag-object SHA for annotated tags)
			'bbb444555666', // peeledObjectname (commit SHA)
			'', // upstream
			'', // upstreamTracking
			'', // committerDate
			'2025-01-15 12:00:00 +0000', // creatorDate
			'2025-01-14 10:00:00 +0000', // authorDate
			'Release v1.0.0', // subject
		]);
		const data = buildData([record]);

		const results = [...parser.parse(data)];

		assert.strictEqual(results.length, 1);
		const ref = results[0];
		assert.strictEqual(ref.name, 'refs/tags/v1.0.0');
		assert.strictEqual(ref.objectname, 'aaa111222333');
		assert.strictEqual(ref.peeledObjectname, 'bbb444555666');
		assert.strictEqual(ref.creatorDate, '2025-01-15 12:00:00 +0000');
		assert.strictEqual(ref.authorDate, '2025-01-14 10:00:00 +0000');
		assert.strictEqual(ref.subject, 'Release v1.0.0');
	});

	test('parses lightweight tag (no peeledObjectname)', () => {
		const parser = getRefParser(featuresWithoutWorktree);
		const record = buildRecord([
			'',
			'refs/tags/v0.1.0',
			'ccc333', // objectname == commit SHA for lightweight tags
			'', // peeledObjectname is empty
			'',
			'',
			'',
			'2025-03-01 00:00:00 +0000',
			'',
			'',
		]);
		const data = buildData([record]);

		const results = [...parser.parse(data)];

		assert.strictEqual(results.length, 1);
		assert.strictEqual(results[0].peeledObjectname, '');
		assert.strictEqual(results[0].objectname, 'ccc333');
	});

	test('parses mixed branch + remote + tag records in a single pass', () => {
		const parser = getRefParser(featuresWithoutWorktree);
		const branch = buildRecord([
			'*',
			'refs/heads/main',
			'aaa111',
			'',
			'refs/remotes/origin/main',
			'[ahead 1]',
			'2025-01-01 00:00:00 +0000',
			'',
			'',
			'',
		]);
		const remote = buildRecord([
			'',
			'refs/remotes/origin/main',
			'aaa111',
			'',
			'',
			'',
			'2025-01-01 00:00:00 +0000',
			'',
			'',
			'',
		]);
		const tag = buildRecord([
			'',
			'refs/tags/v1.0',
			'tag111',
			'ccc222',
			'',
			'',
			'',
			'2025-02-01 00:00:00 +0000',
			'2025-01-31 00:00:00 +0000',
			'First release',
		]);
		const data = buildData([branch, remote, tag]);

		const results = [...parser.parse(data)];

		assert.strictEqual(results.length, 3);
		assert.strictEqual(results[0].name, 'refs/heads/main');
		assert.strictEqual(results[1].name, 'refs/remotes/origin/main');
		assert.strictEqual(results[2].name, 'refs/tags/v1.0');
	});

	test('skips empty records between valid ones', () => {
		const parser = getRefParser(featuresWithoutWorktree);
		const record = buildRecord([
			'*',
			'refs/heads/main',
			'eee555',
			'',
			'',
			'',
			'2025-06-01 00:00:00 +0000',
			'',
			'',
			'',
		]);
		const data = `${recordSep}${recordSep}${record}${recordSep}`;

		const results = [...parser.parse(data)];

		assert.strictEqual(results.length, 1);
		assert.strictEqual(results[0].name, 'refs/heads/main');
	});

	test('worktree-enabled and non-worktree parsers are cached independently', () => {
		const parserWithout = getRefParser(featuresWithoutWorktree);
		const parserWith = getRefParser(featuresWithWorktree);

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
		const parser = getRefParser(featuresWithWorktree);
		const record = buildRecord([
			'*',
			'refs/heads/main',
			'abc123',
			'',
			'refs/remotes/origin/main',
			'',
			'2025-01-01 00:00:00 +0000',
			'',
			'',
			'',
			'/home/user/worktree',
		]);
		const data = buildData([record]);
		const results = [...parser.parse(data)];

		assert.strictEqual(results.length, 1);
		assert.strictEqual(results[0].worktreePath, '/home/user/worktree');
	});

	test('both parsers read %(push) last, after the fields only the worktree parser reads', () => {
		const fields = ['*', 'refs/heads/main', 'abc123', '', 'refs/remotes/origin/main', '', '', '', '', ''];
		for (const [features, gated] of [
			[featuresWithoutWorktree, []],
			[featuresWithWorktree, ['/home/user/worktree', 'origin', 'refs/heads/main']],
		] as const) {
			const parser = getRefParser(features);
			assert.ok(parser.arguments[0].endsWith('%(push)%1D'), 'push is the last field of the format');

			const [result] = [
				...parser.parse(buildData([buildRecord([...fields, ...gated, 'refs/remotes/fork/main'])])),
			];
			assert.strictEqual(result.push, 'refs/remotes/fork/main');
			assert.strictEqual(result.upstream, 'refs/remotes/origin/main');
		}
	});
});

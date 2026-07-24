import * as assert from 'assert';
import type { GitGraphRow } from '../../models/graph.js';
import { appendRowsAtCursor } from '../graph.utils.js';

function row(sha: string, options?: Partial<GitGraphRow>): GitGraphRow {
	return {
		sha: sha,
		parents: [`p-${sha}`],
		author: 'Tester',
		email: 'test@example.com',
		date: 1000,
		message: `commit ${sha}`,
		type: 'commit-node',
		...options,
	};
}

function rows(count: number, prefix = 'sha'): GitGraphRow[] {
	return Array.from({ length: count }, (_, i) => row(`${prefix}${i}`));
}

suite('graph.utils', () => {
	suite('appendRowsAtCursor', () => {
		test('cursor at the end appends the page (plain append)', () => {
			const appended = appendRowsAtCursor(rows(5), 'sha4', rows(3, 'page'));
			assert.deepStrictEqual(
				appended.map(r => r.sha),
				['sha0', 'sha1', 'sha2', 'sha3', 'sha4', 'page0', 'page1', 'page2'],
			);
		});

		test('cursor mid-array trims the rows below it before appending', () => {
			const appended = appendRowsAtCursor(rows(5), 'sha2', rows(2, 'page'));
			assert.deepStrictEqual(
				appended.map(r => r.sha),
				['sha0', 'sha1', 'sha2', 'page0', 'page1'],
			);
		});

		test('missing cursor appends after everything (reducer fallthrough)', () => {
			const appended = appendRowsAtCursor(rows(2), 'nope', rows(1, 'page'));
			assert.deepStrictEqual(
				appended.map(r => r.sha),
				['sha0', 'sha1', 'page0'],
			);
		});

		test('cursor at last row appends without trimming', () => {
			const prior = rows(5);
			const appended = appendRowsAtCursor(prior, 'sha4', rows(3, 'page'));
			assert.deepStrictEqual(
				appended.map(r => r.sha),
				[...prior.map(r => r.sha), 'page0', 'page1', 'page2'],
			);
		});

		test('an empty page keeps the trimmed prior window', () => {
			const prior = rows(4);
			assert.deepStrictEqual(
				appendRowsAtCursor(prior, 'sha1', []).map(r => r.sha),
				['sha0', 'sha1'],
			);
			assert.deepStrictEqual(
				appendRowsAtCursor(prior, 'sha3', []).map(r => r.sha),
				['sha0', 'sha1', 'sha2', 'sha3'],
			);
		});
	});
});

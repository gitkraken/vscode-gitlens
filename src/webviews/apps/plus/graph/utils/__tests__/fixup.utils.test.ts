import * as assert from 'assert';
import type { GitGraphRow } from '@gitlens/git/models/graph.js';
import { GitGraphRowContextFlags } from '@gitlens/git/models/graph.js';
import { findFixupTargetRow, parseFixupSubject } from '../fixup.utils.js';

function row(sha: string, message: string, flags: GitGraphRowContextFlags = GitGraphRowContextFlags.None): GitGraphRow {
	return {
		sha: sha,
		parents: [],
		author: 'Test',
		email: 'test@example.com',
		date: 0,
		message: message,
		kind: 'commit',
		contexts: { flags: flags },
	};
}

suite('parseFixupSubject', () => {
	test('extracts the subject from a plain fixup message', () => {
		assert.strictEqual(parseFixupSubject('fixup! Add widget'), 'Add widget');
	});

	test('returns undefined for a non-fixup message', () => {
		assert.strictEqual(parseFixupSubject('Add widget'), undefined);
	});

	test('strips only the outermost prefix of a chained fixup', () => {
		assert.strictEqual(parseFixupSubject('fixup! fixup! Add widget'), 'fixup! Add widget');
	});

	test('only considers the first line of a multi-line message', () => {
		assert.strictEqual(parseFixupSubject('fixup! Add widget\n\nBody text here'), 'Add widget');
		assert.strictEqual(parseFixupSubject('Add widget\n\nfixup! not the subject'), undefined);
	});

	test('returns undefined when nothing follows the prefix', () => {
		assert.strictEqual(parseFixupSubject('fixup!'), undefined);
		assert.strictEqual(parseFixupSubject('fixup! '), undefined);
		assert.strictEqual(parseFixupSubject('fixup!   '), undefined);
	});
});

suite('findFixupTargetRow', () => {
	test('finds the newest rewriteable row whose first line matches the subject', () => {
		const rows = [
			row('sha-1', 'Add widget', GitGraphRowContextFlags.RewriteableFromHead),
			row('sha-2', 'Add widget', GitGraphRowContextFlags.RewriteableFromHead),
		];

		assert.deepStrictEqual(findFixupTargetRow(rows, 'Add widget'), { sha: 'sha-1', subject: 'Add widget' });
	});

	test('skips rows that are not rewriteable from HEAD', () => {
		const rows = [
			row('sha-1', 'Add widget', GitGraphRowContextFlags.None),
			row('sha-2', 'Add widget', GitGraphRowContextFlags.RewriteableFromHead),
		];

		assert.deepStrictEqual(findFixupTargetRow(rows, 'Add widget'), { sha: 'sha-2', subject: 'Add widget' });
	});

	test('matches only the first line of a multi-line row message', () => {
		const rows = [row('sha-1', 'Add widget\n\nBody text', GitGraphRowContextFlags.RewriteableFromHead)];

		assert.deepStrictEqual(findFixupTargetRow(rows, 'Add widget'), { sha: 'sha-1', subject: 'Add widget' });
	});

	test('returns undefined when no row matches', () => {
		const rows = [row('sha-1', 'Something else', GitGraphRowContextFlags.RewriteableFromHead)];

		assert.strictEqual(findFixupTargetRow(rows, 'Add widget'), undefined);
	});

	test('returns undefined for undefined rows', () => {
		assert.strictEqual(findFixupTargetRow(undefined, 'Add widget'), undefined);
	});
});

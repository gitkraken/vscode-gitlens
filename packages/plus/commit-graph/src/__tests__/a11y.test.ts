import * as assert from 'assert';
import { buildAriaLabel } from '../a11y.js';
import type { CommitKind, GraphCommit } from '../engine/types.js';
import { relativeTimeShort } from '../view.js';

function commit(overrides?: Partial<GraphCommit>): GraphCommit {
	return {
		sha: '1234567890abcdef',
		shortSha: '1234567',
		message: 'Fixes the thing',
		author: 'Ada',
		authorEmail: 'ada@example.com',
		date: 0,
		parents: ['fedcba0987654321'],
		kind: 'commit',
		...overrides,
	};
}

function label(c: GraphCommit, kind: CommitKind | undefined, adornment?: string, relativeDate?: string): string[] {
	return buildAriaLabel(c, kind, adornment, relativeDate).split(', ');
}

suite('a11y/buildAriaLabel', () => {
	test('leads with the row kind and short sha, then author, date, summary', () => {
		assert.deepStrictEqual(label(commit(), 'commit', undefined, '3d'), [
			'Commit 1234567',
			'by Ada',
			'3d',
			'Fixes the thing',
		]);
	});

	test('names a merge from the kind, and from parent count when the kind does not say so', () => {
		assert.strictEqual(label(commit({ kind: 'merge' }), 'merge')[0], 'Merge commit 1234567');
		// A caller that passes no kind must still not announce a merge as an ordinary commit.
		assert.strictEqual(label(commit({ parents: ['a', 'b'] }), undefined)[0], 'Merge commit 1234567');
	});

	test('names a stash', () => {
		assert.strictEqual(label(commit({ kind: 'stash' }), 'stash')[0], 'Stash 1234567');
	});

	// The workdir row's summary carries the worktree/branch name, which is the only thing
	// distinguishing it from every other workdir row — it must be spoken first, not after filler.
	test('a workdir row leads with its summary and never announces a sha', () => {
		const parts = label(commit({ kind: 'workdir', message: 'Working Changes (main)' }), 'workdir', undefined, '2h');
		assert.deepStrictEqual(parts, ['Working Changes (main)', '2h']);
		assert.ok(!parts.some(p => p.includes('1234567')), 'the placeholder sha must not be spoken');
	});

	test('a workdir row with no summary falls back to a generic header', () => {
		assert.strictEqual(label(commit({ kind: 'workdir', message: '   ' }), 'workdir')[0], 'Working directory');
	});

	test('speaks only the first line of a multi-line message, ignoring leading blanks', () => {
		const parts = label(commit({ message: '\n\nSubject line\n\nBody paragraph' }), 'commit');
		assert.ok(parts.includes('Subject line'));
		assert.ok(!parts.some(p => p.includes('Body paragraph')), 'the body belongs to the details panel');
	});

	test('drops the fragments it has nothing to say for', () => {
		assert.deepStrictEqual(label(commit({ author: '', message: '', date: 0 }), 'commit'), ['Commit 1234567']);
	});

	// The spoken date must match the VISIBLE one, so a caller-supplied string always wins over the
	// package's own formatter — otherwise a narrow column showing "3d" could be announced as "4d".
	test("prefers the caller's rendered date over formatting the timestamp itself", () => {
		const now = 1_700_000_000_000;
		const c = commit({ date: now - 3 * 86_400_000 });
		assert.ok(label(c, 'commit', undefined, 'last Tuesday').includes('last Tuesday'));
		assert.ok(!label(c, 'commit', undefined, 'last Tuesday').includes(relativeTimeShort(c.date, now)));
	});

	test('appends an adornment fragment last', () => {
		assert.strictEqual(label(commit(), 'commit', 'on branch main', '3d').at(-1), 'on branch main');
	});
});

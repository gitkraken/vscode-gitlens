import * as assert from 'assert';
import type { RebaseTodoCommitAction } from '@gitlens/git/models/rebase.js';
import type { RebaseEntry } from '../../../rebase/protocol.js';
import { enforceOldestPickable, getEntriesSignature } from '../stateProvider.js';

function commitEntry(id: string, action: RebaseTodoCommitAction, line: number = 0): RebaseEntry {
	return { id: id, type: 'commit', action: action, sha: id, message: `${id} subject`, line: line };
}

function commandEntry(id: string, action: 'break' | 'exec' | 'noop', line: number = 0): RebaseEntry {
	if (action === 'exec') return { id: id, type: 'command', action: action, command: 'echo', line: line };
	return { id: id, type: 'command', action: action, line: line };
}

suite('rebase/stateProvider helpers', () => {
	suite('getEntriesSignature', () => {
		test('stable for the same entries', () => {
			const a = [commitEntry('a', 'pick'), commitEntry('b', 'reword'), commitEntry('c', 'pick')];
			const b = [commitEntry('a', 'pick'), commitEntry('b', 'reword'), commitEntry('c', 'pick')];
			assert.strictEqual(getEntriesSignature(a), getEntriesSignature(b));
		});

		test('differs when entries are reordered', () => {
			const a = [commitEntry('a', 'pick'), commitEntry('b', 'pick'), commitEntry('c', 'pick')];
			const b = [commitEntry('a', 'pick'), commitEntry('c', 'pick'), commitEntry('b', 'pick')];
			assert.notStrictEqual(getEntriesSignature(a), getEntriesSignature(b));
		});

		test('differs when an action changes', () => {
			const a = [commitEntry('a', 'pick'), commitEntry('b', 'pick')];
			const b = [commitEntry('a', 'pick'), commitEntry('b', 'squash')];
			assert.notStrictEqual(getEntriesSignature(a), getEntriesSignature(b));
		});

		test('command entries do not change signature when their action changes', () => {
			// Command entries are reduced to `${id}:cmd` — they have no user-mutable action,
			// so toggling between break/exec/noop for the same id should be a stable signature.
			const a = [commitEntry('a', 'pick'), commandEntry('x', 'break', 1)];
			const b = [commitEntry('a', 'pick'), commandEntry('x', 'exec', 1)];
			assert.strictEqual(getEntriesSignature(a), getEntriesSignature(b));
		});

		test('signature differs when a commit entry and command entry swap positions', () => {
			const a = [commitEntry('a', 'pick'), commandEntry('x', 'break', 1)];
			const b = [commandEntry('x', 'break', 1), commitEntry('a', 'pick')];
			assert.notStrictEqual(getEntriesSignature(a), getEntriesSignature(b));
		});

		test('empty entries returns empty string', () => {
			assert.strictEqual(getEntriesSignature([]), '');
		});
	});

	suite('enforceOldestPickable', () => {
		test('returns the same array reference when no fix is needed', () => {
			const entries = [commitEntry('a', 'pick'), commitEntry('b', 'squash'), commitEntry('c', 'fixup')];
			assert.strictEqual(enforceOldestPickable(entries), entries);
		});

		test('forces oldest squash to pick', () => {
			const entries = [commitEntry('a', 'squash'), commitEntry('b', 'pick')];
			const fixed = enforceOldestPickable(entries);
			assert.notStrictEqual(fixed, entries, 'should return a new array');
			assert.strictEqual(fixed.length, 2);
			assert.strictEqual(fixed[0].type, 'commit');
			assert.strictEqual((fixed[0] as { action: string }).action, 'pick');
			assert.strictEqual((fixed[1] as { action: string }).action, 'pick');
			// Originals untouched
			assert.strictEqual((entries[0] as { action: string }).action, 'squash');
		});

		test('forces oldest fixup to pick', () => {
			const entries = [commitEntry('a', 'fixup'), commitEntry('b', 'pick')];
			const fixed = enforceOldestPickable(entries);
			assert.strictEqual((fixed[0] as { action: string }).action, 'pick');
		});

		test('only the oldest commit entry is rewritten — non-oldest squash/fixup are kept', () => {
			const entries = [commitEntry('a', 'pick'), commitEntry('b', 'squash'), commitEntry('c', 'fixup')];
			const fixed = enforceOldestPickable(entries);
			assert.strictEqual(fixed, entries, 'no fix needed, identity preserved');
		});

		test('finds the oldest commit even when preceded by command entries', () => {
			// Command entries (break, exec, noop) can precede commit entries. The "oldest pickable"
			// rule applies to the first commit entry, not the first entry overall.
			const entries = [commandEntry('cmd1', 'break', 0), commitEntry('a', 'squash', 1)];
			const fixed = enforceOldestPickable(entries);
			assert.notStrictEqual(fixed, entries);
			assert.strictEqual((fixed[1] as { action: string }).action, 'pick');
			// Command entry untouched
			assert.strictEqual(fixed[0], entries[0]);
		});

		test('no-op for empty entries', () => {
			const entries: RebaseEntry[] = [];
			assert.strictEqual(enforceOldestPickable(entries), entries);
		});

		test('no-op when there are no commit entries', () => {
			const entries = [commandEntry('a', 'break', 0), commandEntry('b', 'exec', 1)];
			assert.strictEqual(enforceOldestPickable(entries), entries);
		});
	});
});

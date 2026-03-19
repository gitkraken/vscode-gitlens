import * as assert from 'assert';
import { parseRebaseTodo } from '../rebaseTodoParser.js';

suite('parseRebaseTodo Test Suite', () => {
	suite('empty/undefined input', () => {
		test('returns empty entries for undefined', () => {
			const result = parseRebaseTodo(undefined);
			assert.deepStrictEqual(result, { entries: [] });
		});

		test('returns empty entries for empty string', () => {
			const result = parseRebaseTodo('');
			assert.deepStrictEqual(result, { entries: [] });
		});
	});

	suite('standard commit commands (long form)', () => {
		test('parses pick command', () => {
			const result = parseRebaseTodo('pick abc1234 First commit');
			assert.strictEqual(result.entries.length, 1);
			assert.strictEqual(result.entries[0].action, 'pick');
			assert.strictEqual(result.entries[0].sha, 'abc1234');
			assert.strictEqual(result.entries[0].message, 'First commit');
		});

		test('parses reword command', () => {
			const result = parseRebaseTodo('reword def5678 Second commit');
			assert.strictEqual(result.entries.length, 1);
			assert.strictEqual(result.entries[0].action, 'reword');
			assert.strictEqual(result.entries[0].sha, 'def5678');
			assert.strictEqual(result.entries[0].message, 'Second commit');
		});

		test('parses edit command', () => {
			const result = parseRebaseTodo('edit aaa1111 Edit this');
			assert.strictEqual(result.entries.length, 1);
			assert.strictEqual(result.entries[0].action, 'edit');
			assert.strictEqual(result.entries[0].sha, 'aaa1111');
			assert.strictEqual(result.entries[0].message, 'Edit this');
		});

		test('parses squash command', () => {
			const result = parseRebaseTodo('squash bbb2222 Squash me');
			assert.strictEqual(result.entries.length, 1);
			assert.strictEqual(result.entries[0].action, 'squash');
			assert.strictEqual(result.entries[0].sha, 'bbb2222');
			assert.strictEqual(result.entries[0].message, 'Squash me');
		});

		test('parses fixup command', () => {
			const result = parseRebaseTodo('fixup ccc3333 Fixup commit');
			assert.strictEqual(result.entries.length, 1);
			assert.strictEqual(result.entries[0].action, 'fixup');
			assert.strictEqual(result.entries[0].sha, 'ccc3333');
			assert.strictEqual(result.entries[0].message, 'Fixup commit');
			assert.strictEqual(result.entries[0].flag, undefined);
		});

		test('parses drop command', () => {
			const result = parseRebaseTodo('drop ddd4444 Drop this');
			assert.strictEqual(result.entries.length, 1);
			assert.strictEqual(result.entries[0].action, 'drop');
			assert.strictEqual(result.entries[0].sha, 'ddd4444');
			assert.strictEqual(result.entries[0].message, 'Drop this');
		});
	});

	suite('short form commands', () => {
		test('parses p as pick', () => {
			const result = parseRebaseTodo('p abc1234 Short pick');
			assert.strictEqual(result.entries[0].action, 'pick');
			assert.strictEqual(result.entries[0].sha, 'abc1234');
			assert.strictEqual(result.entries[0].message, 'Short pick');
		});

		test('parses r as reword', () => {
			const result = parseRebaseTodo('r abc1234 Short reword');
			assert.strictEqual(result.entries[0].action, 'reword');
		});

		test('parses e as edit', () => {
			const result = parseRebaseTodo('e abc1234 Short edit');
			assert.strictEqual(result.entries[0].action, 'edit');
		});

		test('parses s as squash', () => {
			const result = parseRebaseTodo('s abc1234 Short squash');
			assert.strictEqual(result.entries[0].action, 'squash');
		});

		test('parses f as fixup', () => {
			const result = parseRebaseTodo('f abc1234 Short fixup');
			assert.strictEqual(result.entries[0].action, 'fixup');
		});

		test('parses d as drop', () => {
			const result = parseRebaseTodo('d abc1234 Short drop');
			assert.strictEqual(result.entries[0].action, 'drop');
		});
	});

	suite('control commands', () => {
		test('parses break command', () => {
			const result = parseRebaseTodo('break');
			assert.strictEqual(result.entries.length, 1);
			assert.strictEqual(result.entries[0].action, 'break');
			assert.strictEqual(result.entries[0].sha, undefined);
			assert.strictEqual(result.entries[0].message, undefined);
		});

		test('parses exec command', () => {
			const result = parseRebaseTodo('exec make test');
			assert.strictEqual(result.entries.length, 1);
			assert.strictEqual(result.entries[0].action, 'exec');
			assert.strictEqual(result.entries[0].command, 'make test');
		});

		test('parses exec with short form x', () => {
			const result = parseRebaseTodo('x echo hello');
			assert.strictEqual(result.entries.length, 1);
			assert.strictEqual(result.entries[0].action, 'exec');
			assert.strictEqual(result.entries[0].command, 'echo hello');
		});

		test('parses noop command', () => {
			const result = parseRebaseTodo('noop');
			assert.strictEqual(result.entries.length, 1);
			assert.strictEqual(result.entries[0].action, 'noop');
		});
	});

	suite('label and reset commands', () => {
		test('parses label command', () => {
			const result = parseRebaseTodo('label my-label');
			assert.strictEqual(result.entries.length, 1);
			assert.strictEqual(result.entries[0].action, 'label');
			assert.strictEqual(result.entries[0].ref, 'my-label');
		});

		test('parses reset command', () => {
			const result = parseRebaseTodo('reset my-label');
			assert.strictEqual(result.entries.length, 1);
			assert.strictEqual(result.entries[0].action, 'reset');
			assert.strictEqual(result.entries[0].ref, 'my-label');
		});

		test('parses label with short form l', () => {
			const result = parseRebaseTodo('l my-label');
			assert.strictEqual(result.entries[0].action, 'label');
			assert.strictEqual(result.entries[0].ref, 'my-label');
		});

		test('parses reset with short form t', () => {
			const result = parseRebaseTodo('t my-label');
			assert.strictEqual(result.entries[0].action, 'reset');
			assert.strictEqual(result.entries[0].ref, 'my-label');
		});
	});

	suite('update-ref command', () => {
		test('parses update-ref command', () => {
			const result = parseRebaseTodo('update-ref refs/heads/feature');
			assert.strictEqual(result.entries.length, 1);
			assert.strictEqual(result.entries[0].action, 'update-ref');
			assert.strictEqual(result.entries[0].ref, 'refs/heads/feature');
		});

		test('parses update-ref with short form u', () => {
			const result = parseRebaseTodo('u refs/heads/feature');
			assert.strictEqual(result.entries[0].action, 'update-ref');
			assert.strictEqual(result.entries[0].ref, 'refs/heads/feature');
		});
	});

	suite('merge command', () => {
		test('parses merge with -C flag, sha, and comment', () => {
			const result = parseRebaseTodo("merge -C abc1234 feature # branch 'feature'");
			assert.strictEqual(result.entries.length, 1);
			assert.strictEqual(result.entries[0].action, 'merge');
			assert.strictEqual(result.entries[0].flag, '-C');
			assert.strictEqual(result.entries[0].sha, 'abc1234');
			assert.strictEqual(result.entries[0].ref, 'feature');
			assert.strictEqual(result.entries[0].message, "branch 'feature'");
		});

		test('parses merge without flag', () => {
			const result = parseRebaseTodo('merge feature');
			assert.strictEqual(result.entries.length, 1);
			assert.strictEqual(result.entries[0].action, 'merge');
			assert.strictEqual(result.entries[0].ref, 'feature');
			assert.strictEqual(result.entries[0].sha, undefined);
		});

		test('parses merge with short form m', () => {
			const result = parseRebaseTodo("m -C abc1234 feature # branch 'feature'");
			assert.strictEqual(result.entries[0].action, 'merge');
			assert.strictEqual(result.entries[0].flag, '-C');
		});
	});

	suite('fixup with amend flag', () => {
		test('parses fixup with -C flag', () => {
			const result = parseRebaseTodo('fixup -C abc1234 Commit msg');
			assert.strictEqual(result.entries.length, 1);
			assert.strictEqual(result.entries[0].action, 'fixup');
			assert.strictEqual(result.entries[0].flag, '-C');
			assert.strictEqual(result.entries[0].sha, 'abc1234');
			assert.strictEqual(result.entries[0].message, 'Commit msg');
		});

		test('parses fixup with -c flag', () => {
			const result = parseRebaseTodo('fixup -c def5678 Another msg');
			assert.strictEqual(result.entries[0].action, 'fixup');
			assert.strictEqual(result.entries[0].flag, '-c');
			assert.strictEqual(result.entries[0].sha, 'def5678');
			assert.strictEqual(result.entries[0].message, 'Another msg');
		});
	});

	suite('header extraction', () => {
		test('extracts rebase info from header comment', () => {
			const data = [
				'# Rebase abc1234..def5678 onto 789abc0 (3 commands)',
				'pick aaa1111 First commit',
				'pick bbb2222 Second commit',
			].join('\n');

			const result = parseRebaseTodo(data);
			assert.ok(result.info);
			assert.strictEqual(result.info.from, 'abc1234');
			assert.strictEqual(result.info.to, 'def5678');
			assert.strictEqual(result.info.onto, '789abc0');
		});

		test('handles header without range (single commit)', () => {
			const data = ['# Rebase abc1234 onto def5678 (1 command)', 'pick aaa1111 Single commit'].join('\n');

			const result = parseRebaseTodo(data);
			assert.ok(result.info);
			assert.strictEqual(result.info.from, 'abc1234');
			assert.strictEqual(result.info.to, undefined);
			assert.strictEqual(result.info.onto, 'def5678');
		});

		test('returns no info when no header present', () => {
			const result = parseRebaseTodo('pick abc1234 First commit');
			assert.strictEqual(result.info, undefined);
		});
	});

	suite('comments and blank lines', () => {
		test('skips comment lines', () => {
			const data = ['# This is a comment', 'pick abc1234 First commit', '# Another comment'].join('\n');

			const result = parseRebaseTodo(data);
			assert.strictEqual(result.entries.length, 1);
			assert.strictEqual(result.entries[0].action, 'pick');
		});

		test('skips blank lines', () => {
			const data = ['', 'pick abc1234 First commit', '', 'pick def5678 Second commit', ''].join('\n');

			const result = parseRebaseTodo(data);
			assert.strictEqual(result.entries.length, 2);
		});
	});

	suite('multiple entries', () => {
		test('parses multiple entries in sequence', () => {
			const data = [
				'pick abc1234 First commit',
				'reword def5678 Second commit',
				'squash aaa1111 Third commit',
				'fixup bbb2222 Fourth commit',
				'drop ccc3333 Fifth commit',
			].join('\n');

			const result = parseRebaseTodo(data);
			assert.strictEqual(result.entries.length, 5);
			assert.strictEqual(result.entries[0].action, 'pick');
			assert.strictEqual(result.entries[1].action, 'reword');
			assert.strictEqual(result.entries[2].action, 'squash');
			assert.strictEqual(result.entries[3].action, 'fixup');
			assert.strictEqual(result.entries[4].action, 'drop');
		});

		test('tracks line numbers correctly with comments and blanks', () => {
			const data = [
				'# header comment',
				'pick abc1234 First commit',
				'',
				'# another comment',
				'reword def5678 Second commit',
			].join('\n');

			const result = parseRebaseTodo(data);
			assert.strictEqual(result.entries.length, 2);
			assert.strictEqual(result.entries[0].line, 1);
			assert.strictEqual(result.entries[1].line, 4);
		});

		test('parses a full realistic rebase todo', () => {
			const data = [
				'# Rebase abc1234..def5678 onto 789abc0 (5 commands)',
				'pick aaa1111 Add feature A',
				'squash bbb2222 WIP: feature A progress',
				'pick ccc3333 Add feature B',
				'update-ref refs/heads/feature-b',
				'exec make test',
				'',
				'# Commands:',
				'# p, pick = use commit',
			].join('\n');

			const result = parseRebaseTodo(data);
			assert.ok(result.info);
			assert.strictEqual(result.info.onto, '789abc0');
			assert.strictEqual(result.entries.length, 5);
			assert.strictEqual(result.entries[0].action, 'pick');
			assert.strictEqual(result.entries[1].action, 'squash');
			assert.strictEqual(result.entries[2].action, 'pick');
			assert.strictEqual(result.entries[3].action, 'update-ref');
			assert.strictEqual(result.entries[3].ref, 'refs/heads/feature-b');
			assert.strictEqual(result.entries[4].action, 'exec');
			assert.strictEqual(result.entries[4].command, 'make test');
		});

		test('parses rebase-merges style todo with label/reset/merge', () => {
			const data = [
				'label onto',
				'reset onto',
				'pick abc1234 Base commit',
				'label feature-branch',
				'reset onto',
				'pick def5678 Main branch commit',
				"merge -C aaa1111 feature-branch # branch 'feature-branch'",
			].join('\n');

			const result = parseRebaseTodo(data);
			assert.strictEqual(result.entries.length, 7);
			assert.strictEqual(result.entries[0].action, 'label');
			assert.strictEqual(result.entries[0].ref, 'onto');
			assert.strictEqual(result.entries[1].action, 'reset');
			assert.strictEqual(result.entries[1].ref, 'onto');
			assert.strictEqual(result.entries[6].action, 'merge');
			assert.strictEqual(result.entries[6].ref, 'feature-branch');
			assert.strictEqual(result.entries[6].message, "branch 'feature-branch'");
		});
	});

	suite('edge cases', () => {
		test('handles commit with empty message', () => {
			const result = parseRebaseTodo('pick abc1234');
			assert.strictEqual(result.entries.length, 1);
			assert.strictEqual(result.entries[0].action, 'pick');
			assert.strictEqual(result.entries[0].sha, 'abc1234');
		});

		test('handles exec command with hash in shell command', () => {
			const result = parseRebaseTodo('exec echo "# comment" >> file');
			assert.strictEqual(result.entries[0].action, 'exec');
			assert.strictEqual(result.entries[0].command, 'echo "# comment" >> file');
		});
	});
});

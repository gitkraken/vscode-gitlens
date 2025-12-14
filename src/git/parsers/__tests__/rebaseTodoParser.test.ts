import * as assert from 'assert';
import { parseRebaseTodo } from '../rebaseTodoParser';

suite('Rebase Todo Parser Test Suite', () => {
	test('parses simple case without comments', () => {
		const content = `pick abc1234 First commit
pick def5678 Second commit
pick 9876543 Third commit`;

		const result = parseRebaseTodo(content);

		assert.strictEqual(result.entries.length, 3, 'Should parse three entries');

		assert.strictEqual(result.entries[0].line, 0, 'First entry should be at line 0');
		assert.strictEqual(result.entries[0].action, 'pick', 'First entry should have pick action');
		assert.strictEqual(result.entries[0].sha, 'abc1234', 'First entry should have correct sha');
		assert.strictEqual(result.entries[0].message, 'First commit', 'First entry should have correct message');

		assert.strictEqual(result.entries[1].line, 1, 'Second entry should be at line 1');
		assert.strictEqual(result.entries[2].line, 2, 'Third entry should be at line 2');
	});

	test('handles comments between entries (main bug fix)', () => {
		const content = `# Rebase abc123..def456 onto abc123
#
# Commands:
# p, pick = use commit
# r, reword = use commit, but edit the commit message
# e, edit = use commit, but stop for amending
# s, squash = use commit, but meld into previous commit
# f, fixup = like "squash", but discard this commit's log message
# d, drop = remove commit
#
pick abc1234 First commit
# This is a comment between entries
pick def5678 Second commit

# Another comment with blank line above
pick 9876543 Third commit`;

		const result = parseRebaseTodo(content);

		assert.strictEqual(result.entries.length, 3, 'Should parse three entries');

		// These line numbers are the absolute positions in the file
		assert.strictEqual(result.entries[0].line, 10, 'First entry should be at line 10');
		assert.strictEqual(result.entries[0].sha, 'abc1234', 'First entry should have correct sha');

		assert.strictEqual(result.entries[1].line, 12, 'Second entry should be at line 12');
		assert.strictEqual(result.entries[1].sha, 'def5678', 'Second entry should have correct sha');

		assert.strictEqual(result.entries[2].line, 15, 'Third entry should be at line 15');
		assert.strictEqual(result.entries[2].sha, '9876543', 'Third entry should have correct sha');
	});

	test('parses all action types with abbreviations', () => {
		const content = `p abc1234 Pick this
r def5678 Reword this
e 1111111 Edit this
s 2222222 Squash this
f 3333333 Fixup this
d 4444444 Drop this`;

		const result = parseRebaseTodo(content);

		assert.strictEqual(result.entries.length, 6, 'Should parse six entries');

		assert.strictEqual(result.entries[0].action, 'pick', 'Should parse pick abbreviation');
		assert.strictEqual(result.entries[1].action, 'reword', 'Should parse reword abbreviation');
		assert.strictEqual(result.entries[2].action, 'edit', 'Should parse edit abbreviation');
		assert.strictEqual(result.entries[3].action, 'squash', 'Should parse squash abbreviation');
		assert.strictEqual(result.entries[4].action, 'fixup', 'Should parse fixup abbreviation');
		assert.strictEqual(result.entries[5].action, 'drop', 'Should parse drop abbreviation');
	});

	test('parses full action names', () => {
		const content = `pick abc1234 Pick this
reword def5678 Reword this
edit 1111111 Edit this
squash 2222222 Squash this
fixup 3333333 Fixup this
drop 4444444 Drop this`;

		const result = parseRebaseTodo(content);

		assert.strictEqual(result.entries.length, 6, 'Should parse six entries');

		assert.strictEqual(result.entries[0].action, 'pick', 'Should parse pick');
		assert.strictEqual(result.entries[1].action, 'reword', 'Should parse reword');
		assert.strictEqual(result.entries[2].action, 'edit', 'Should parse edit');
		assert.strictEqual(result.entries[3].action, 'squash', 'Should parse squash');
		assert.strictEqual(result.entries[4].action, 'fixup', 'Should parse fixup');
		assert.strictEqual(result.entries[5].action, 'drop', 'Should parse drop');
	});

	test('handles blank lines', () => {
		const content = `pick abc1234 First commit

pick def5678 Second commit


pick 9876543 Third commit`;

		const result = parseRebaseTodo(content);

		assert.strictEqual(result.entries.length, 3, 'Should parse three entries');
		assert.strictEqual(result.entries[0].line, 0, 'First entry should be at line 0');
		assert.strictEqual(result.entries[1].line, 2, 'Second entry should be at line 2');
		assert.strictEqual(result.entries[2].line, 5, 'Third entry should be at line 5');
	});

	test('handles only comments (no entries)', () => {
		const content = `# Rebase abc123..def456 onto abc123
# Only comments
# No actual entries
# Should return empty array`;

		const result = parseRebaseTodo(content);

		assert.strictEqual(result.entries.length, 0, 'Should have no entries');
		assert.notStrictEqual(result.info, undefined, 'Should parse header info');
	});

	test('handles empty string', () => {
		const result = parseRebaseTodo('');

		assert.strictEqual(result.entries.length, 0, 'Should have no entries');
		assert.strictEqual(result.info, undefined, 'Should have no info');
	});

	test('handles undefined input', () => {
		const result = parseRebaseTodo(undefined);

		assert.strictEqual(result.entries.length, 0, 'Should have no entries');
		assert.strictEqual(result.info, undefined, 'Should have no info');
	});

	test('extracts rebase info from header', () => {
		const content = `# Rebase abc123..def456 onto 9876543
pick abc1234 First commit`;

		const result = parseRebaseTodo(content);

		assert.notStrictEqual(result.info, undefined, 'Should have rebase info');
		assert.strictEqual(result.info?.from, 'abc123', 'Should parse from sha');
		assert.strictEqual(result.info?.to, 'def456', 'Should parse to sha');
		assert.strictEqual(result.info?.onto, '9876543', 'Should parse onto sha');
	});

	test('handles rebase header without range', () => {
		const content = `# Rebase abc123 onto 9876543
pick abc1234 First commit`;

		const result = parseRebaseTodo(content);

		assert.notStrictEqual(result.info, undefined, 'Should have rebase info');
		assert.strictEqual(result.info?.from, 'abc123', 'Should parse from sha');
		assert.strictEqual(result.info?.to, undefined, 'Should have no to sha');
		assert.strictEqual(result.info?.onto, '9876543', 'Should parse onto sha');
	});

	test('handles commit messages with special characters', () => {
		const content = `pick abc1234 Fix: handle "quotes" and (parens)
pick def5678 feat: add support for UTF-8 émojis 🎉
pick 1111111 Merge branch 'feature' into main`;

		const result = parseRebaseTodo(content);

		assert.strictEqual(result.entries.length, 3, 'Should parse three entries');
		assert.strictEqual(
			result.entries[0].message,
			'Fix: handle "quotes" and (parens)',
			'Should preserve quotes and parens',
		);
		assert.strictEqual(
			result.entries[1].message,
			'feat: add support for UTF-8 émojis 🎉',
			'Should preserve UTF-8 and emojis',
		);
		assert.strictEqual(
			result.entries[2].message,
			"Merge branch 'feature' into main",
			'Should preserve single quotes',
		);
	});

	test('handles leading whitespace in commands', () => {
		const content = `  pick abc1234 First commit
	pick def5678 Second commit
 pick 9876543 Third commit`;

		const result = parseRebaseTodo(content);

		assert.strictEqual(result.entries.length, 3, 'Should parse three entries with leading whitespace');
		assert.strictEqual(result.entries[0].sha, 'abc1234', 'Should parse with spaces');
		assert.strictEqual(result.entries[1].sha, 'def5678', 'Should parse with tab');
		assert.strictEqual(result.entries[2].sha, '9876543', 'Should parse with single space');
	});

	test('handles empty commit messages', () => {
		const content = `pick abc1234
pick def5678
pick 9876543   `;

		const result = parseRebaseTodo(content);

		assert.strictEqual(result.entries.length, 3, 'Should parse three entries');
		assert.strictEqual(result.entries[0].message, '', 'First should have empty message');
		assert.strictEqual(result.entries[1].message, '', 'Second should have empty message');
		assert.strictEqual(result.entries[2].message, '', 'Third should have empty message');
	});

	test('ignores invalid lines', () => {
		const content = `pick abc1234 Valid entry
this is not a valid rebase command
pick def5678 Another valid entry
invalid line without sha
pick 9876543 Final valid entry`;

		const result = parseRebaseTodo(content);

		assert.strictEqual(result.entries.length, 3, 'Should only parse valid entries');
		assert.strictEqual(result.entries[0].sha, 'abc1234', 'Should parse first valid entry');
		assert.strictEqual(result.entries[1].sha, 'def5678', 'Should parse second valid entry');
		assert.strictEqual(result.entries[2].sha, '9876543', 'Should parse third valid entry');
	});

	test('handles various SHA lengths', () => {
		const content = `pick a123456 Short SHA (7 chars)
pick abc1234567890 Medium SHA (15 chars)
pick 1234567890abcdef1234567890abcdef12345678 Full SHA (40 chars)`;

		const result = parseRebaseTodo(content);

		assert.strictEqual(result.entries.length, 3, 'Should parse entries with different SHA lengths');
		assert.strictEqual(result.entries[0].sha, 'a123456', 'Should parse 7-char SHA');
		assert.strictEqual(result.entries[1].sha, 'abc1234567890', 'Should parse 15-char SHA');
		assert.strictEqual(
			result.entries[2].sha,
			'1234567890abcdef1234567890abcdef12345678',
			'Should parse 40-char SHA',
		);
	});

	test('real-world example from Git', () => {
		const content = `# Rebase 019325e..a27b0ee onto 019325e (9 commands)
#
# Commands:
# p, pick <commit> = use commit
# r, reword <commit> = use commit, but edit the commit message
# e, edit <commit> = use commit, but stop for amending
# s, squash <commit> = use commit, but meld into previous commit
# f, fixup [-C | -c] <commit> = like "squash" but keep only the previous
#                    commit's log message, unless -C is used, in which case
#                    keep only this commit's message; -c is same as -C but
#                    opens the editor
# x, exec <command> = run command (the rest of the line) using shell
# b, break = stop here (continue rebase later with 'git rebase --continue')
# d, drop <commit> = remove commit
# l, label <label> = label current HEAD with a name
# t, reset <label> = reset HEAD to a label
# m, merge [-C <commit> | -c <commit>] <label> [# <oneline>]
#         create a merge commit using the original merge commit's
#         message (or the oneline, if no original merge commit was
#         specified); use -c <commit> to reword the commit message
#
# These lines can be re-ordered; they are executed from top to bottom.
#
# If you remove a line here THAT COMMIT WILL BE LOST.
#
# However, if you remove everything, the rebase will be aborted.
#

pick 019325e 0.1.0
pick a4b689d Fetch all dependencies
squash 714a49d Matches keywords to Docker repos
pick d2d1ca3 parseDependencies returns an object of dependencies.
squash e3b6cd9 Clean up packageParser
squash 57acd67 Initial commit
squash 3f3e05e Rough out how we'll make Dockerfiles
squash 9e10b94 Can check for, make Docker files
pick a27b0ee Write docker files`;

		const result = parseRebaseTodo(content);

		assert.strictEqual(result.entries.length, 9, 'Should parse 9 entries');

		// Verify info extraction
		assert.notStrictEqual(result.info, undefined, 'Should have rebase info');
		assert.strictEqual(result.info?.from, '019325e', 'Should parse from sha');
		assert.strictEqual(result.info?.to, 'a27b0ee', 'Should parse to sha');
		assert.strictEqual(result.info?.onto, '019325e', 'Should parse onto sha');

		// Verify entries
		assert.strictEqual(result.entries[0].action, 'pick', 'First should be pick');
		assert.strictEqual(result.entries[0].sha, '019325e', 'First should have correct sha');
		assert.strictEqual(result.entries[0].message, '0.1.0', 'First should have correct message');

		assert.strictEqual(result.entries[2].action, 'squash', 'Third should be squash');
		assert.strictEqual(result.entries[2].sha, '714a49d', 'Third should have correct sha');

		assert.strictEqual(result.entries[8].action, 'pick', 'Last should be pick');
		assert.strictEqual(result.entries[8].sha, 'a27b0ee', 'Last should have correct sha');
		assert.strictEqual(result.entries[8].message, 'Write docker files', 'Last should have correct message');
	});

	test('parses break command', () => {
		const content = `pick abc1234 First commit
break
pick def5678 Second commit
b
pick 1111111 Third commit`;

		const result = parseRebaseTodo(content);

		assert.strictEqual(result.entries.length, 5, 'Should parse five entries');
		assert.strictEqual(result.entries[1].action, 'break', 'Second should be break');
		assert.strictEqual(result.entries[1].sha, undefined, 'Break should have no SHA');
		assert.strictEqual(result.entries[3].action, 'break', 'Fourth should be break (abbreviated)');
	});

	test('parses noop command', () => {
		const content = `noop
pick abc1234 First commit`;

		const result = parseRebaseTodo(content);

		assert.strictEqual(result.entries.length, 2, 'Should parse two entries');
		assert.strictEqual(result.entries[0].action, 'noop', 'First should be noop');
		assert.strictEqual(result.entries[0].sha, undefined, 'Noop should have no SHA');
		assert.strictEqual(result.entries[0].line, 0, 'Noop should be on line 0');
	});

	test('parses exec command with shell commands', () => {
		const content = `pick abc1234 First commit
exec npm test
x make
exec echo "Hello World"
pick def5678 Second commit`;

		const result = parseRebaseTodo(content);

		assert.strictEqual(result.entries.length, 5, 'Should parse five entries');

		assert.strictEqual(result.entries[1].action, 'exec', 'Second should be exec');
		assert.strictEqual(result.entries[1].command, 'npm test', 'Should have correct command');
		assert.strictEqual(result.entries[1].sha, undefined, 'Exec should have no SHA');

		assert.strictEqual(result.entries[2].action, 'exec', 'Third should be exec (abbreviated)');
		assert.strictEqual(result.entries[2].command, 'make', 'Should parse abbreviated exec');

		assert.strictEqual(result.entries[3].action, 'exec', 'Fourth should be exec');
		assert.strictEqual(result.entries[3].command, 'echo "Hello World"', 'Should handle quoted strings');
	});

	test('parses label command', () => {
		const content = `pick abc1234 First commit
label branch-point
l my-label
pick def5678 Second commit`;

		const result = parseRebaseTodo(content);

		assert.strictEqual(result.entries.length, 4, 'Should parse four entries');

		assert.strictEqual(result.entries[1].action, 'label', 'Second should be label');
		assert.strictEqual(result.entries[1].ref, 'branch-point', 'Should have correct label name');
		assert.strictEqual(result.entries[1].sha, undefined, 'Label should have no SHA');

		assert.strictEqual(result.entries[2].action, 'label', 'Third should be label (abbreviated)');
		assert.strictEqual(result.entries[2].ref, 'my-label', 'Should parse abbreviated label');
	});

	test('parses reset command', () => {
		const content = `pick abc1234 First commit
label branch-point
pick def5678 Second commit
reset branch-point
t my-label
pick 1111111 Third commit`;

		const result = parseRebaseTodo(content);

		assert.strictEqual(result.entries.length, 6, 'Should parse six entries');

		assert.strictEqual(result.entries[3].action, 'reset', 'Fourth should be reset');
		assert.strictEqual(result.entries[3].ref, 'branch-point', 'Should have correct label reference');
		assert.strictEqual(result.entries[3].sha, undefined, 'Reset should have no SHA');

		assert.strictEqual(result.entries[4].action, 'reset', 'Fifth should be reset (abbreviated)');
		assert.strictEqual(result.entries[4].ref, 'my-label', 'Should parse abbreviated reset');
	});

	test('parses update-ref command', () => {
		const content = `pick abc1234 First commit
update-ref refs/heads/feature-a
pick def5678 Second commit
u refs/heads/feature-b
pick 1111111 Third commit`;

		const result = parseRebaseTodo(content);

		assert.strictEqual(result.entries.length, 5, 'Should parse five entries');

		assert.strictEqual(result.entries[0].action, 'pick', 'First should be pick');
		assert.strictEqual(result.entries[0].sha, 'abc1234');

		assert.strictEqual(result.entries[1].action, 'update-ref', 'Second should be update-ref');
		assert.strictEqual(result.entries[1].ref, 'refs/heads/feature-a', 'Should have correct ref');
		assert.strictEqual(result.entries[1].sha, undefined, 'update-ref should have no SHA');

		assert.strictEqual(result.entries[2].action, 'pick', 'Third should be pick');

		assert.strictEqual(result.entries[3].action, 'update-ref', 'Fourth should be update-ref (abbreviated)');
		assert.strictEqual(result.entries[3].ref, 'refs/heads/feature-b', 'Should parse abbreviated update-ref');
	});

	test('parses merge command', () => {
		const content = `pick abc1234 First commit
label branch-point
pick def5678 Second commit
merge branch-point
m -C 1234567 feature-branch # Merge feature
merge my-label`;

		const result = parseRebaseTodo(content);

		assert.strictEqual(result.entries.length, 6, 'Should parse six entries');

		// Simple merge
		assert.strictEqual(result.entries[3].action, 'merge', 'Fourth should be merge');
		assert.strictEqual(result.entries[3].ref, 'branch-point', 'Should have correct label reference');
		assert.strictEqual(result.entries[3].sha, undefined, 'Simple merge should have no SHA');

		// Merge with commit message
		assert.strictEqual(result.entries[4].action, 'merge', 'Fifth should be merge with options');
		assert.strictEqual(result.entries[4].sha, '1234567', 'Should have commit SHA');
		assert.strictEqual(result.entries[4].ref, 'feature-branch', 'Should have label reference');
		assert.strictEqual(result.entries[4].message, 'Merge feature', 'Should have merge message');
		assert.strictEqual(result.entries[4].flag, '-C', 'Should capture merge flag');

		// Abbreviated merge
		assert.strictEqual(result.entries[5].action, 'merge', 'Sixth should be merge (abbreviated)');
		assert.strictEqual(result.entries[5].ref, 'my-label', 'Should parse abbreviated merge');
	});

	test('parses fixup with -c and -C flags', () => {
		const content = `pick abc1234 First commit
fixup def5678 Regular fixup
fixup -c 9876543 Fixup with editor
f -C 1111111 Fixup without editor
pick 2222222 Last commit`;

		const result = parseRebaseTodo(content);

		assert.strictEqual(result.entries.length, 5, 'Should parse five entries');

		// Regular fixup (no flag)
		assert.strictEqual(result.entries[1].action, 'fixup', 'Second should be fixup');
		assert.strictEqual(result.entries[1].sha, 'def5678', 'Should have correct SHA');
		assert.strictEqual(result.entries[1].message, 'Regular fixup', 'Should have correct message');
		assert.strictEqual(result.entries[1].flag, undefined, 'Regular fixup should have no flag');

		// fixup -c (use fixup commit's message with editor)
		assert.strictEqual(result.entries[2].action, 'fixup', 'Third should be fixup');
		assert.strictEqual(result.entries[2].sha, '9876543', 'Should have correct SHA');
		assert.strictEqual(result.entries[2].message, 'Fixup with editor', 'Should have correct message');
		assert.strictEqual(result.entries[2].flag, '-c', 'Should capture -c flag');

		// fixup -C (use fixup commit's message without editor)
		assert.strictEqual(result.entries[3].action, 'fixup', 'Fourth should be fixup');
		assert.strictEqual(result.entries[3].sha, '1111111', 'Should have correct SHA');
		assert.strictEqual(result.entries[3].message, 'Fixup without editor', 'Should have correct message');
		assert.strictEqual(result.entries[3].flag, '-C', 'Should capture -C flag');

		// Last commit
		assert.strictEqual(result.entries[4].action, 'pick', 'Last should be pick');
	});

	test('parses mixed command types in realistic scenario', () => {
		const content = `# Rebase abc123..def456 onto abc123
pick abc1234 Initial commit
exec npm install
pick def5678 Add feature
label feature-added
pick 9876543 Fix bug
break
exec npm test
squash 1111111 More fixes
reset feature-added
merge -C abc9999 feature-branch # Merge feature
drop 2222222 Bad commit
pick 3333333 Final commit`;

		const result = parseRebaseTodo(content);

		assert.strictEqual(result.entries.length, 12, 'Should parse 12 entries');

		// Verify different command types are parsed correctly
		assert.strictEqual(result.entries[0].action, 'pick');
		assert.strictEqual(result.entries[1].action, 'exec');
		assert.strictEqual(result.entries[1].command, 'npm install');
		assert.strictEqual(result.entries[3].action, 'label');
		assert.strictEqual(result.entries[3].ref, 'feature-added');
		assert.strictEqual(result.entries[5].action, 'break');
		assert.strictEqual(result.entries[6].action, 'exec');
		assert.strictEqual(result.entries[8].action, 'reset');
		assert.strictEqual(result.entries[9].action, 'merge');
		assert.strictEqual(result.entries[10].action, 'drop');
		assert.strictEqual(result.entries[11].action, 'pick');

		// Verify rebase info
		assert.strictEqual(result.info?.from, 'abc123');
		assert.strictEqual(result.info?.to, 'def456');
		assert.strictEqual(result.info?.onto, 'abc123');
	});

	test('handles all command abbreviations', () => {
		const content = `p abc1234 Pick
r def5678 Reword
e 1111111 Edit
s 2222222 Squash
f 3333333 Fixup
d 4444444 Drop
b
x echo test
l mylabel
t mylabel
m mybranch
u refs/heads/feature`;

		const result = parseRebaseTodo(content);

		assert.strictEqual(result.entries.length, 12, 'Should parse 12 abbreviated commands');
		assert.strictEqual(result.entries[0].action, 'pick');
		assert.strictEqual(result.entries[1].action, 'reword');
		assert.strictEqual(result.entries[2].action, 'edit');
		assert.strictEqual(result.entries[3].action, 'squash');
		assert.strictEqual(result.entries[4].action, 'fixup');
		assert.strictEqual(result.entries[5].action, 'drop');
		assert.strictEqual(result.entries[6].action, 'break');
		assert.strictEqual(result.entries[7].action, 'exec');
		assert.strictEqual(result.entries[8].action, 'label');
		assert.strictEqual(result.entries[9].action, 'reset');
		assert.strictEqual(result.entries[10].action, 'merge');
		assert.strictEqual(result.entries[11].action, 'update-ref');
		assert.strictEqual(result.entries[11].ref, 'refs/heads/feature');
	});
});

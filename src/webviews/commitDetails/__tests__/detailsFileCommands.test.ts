import * as assert from 'assert';
import { toGitignorePattern } from '../detailsFileCommands.js';

// Each case pins a piece of gitignore syntax that would otherwise make the written line match
// something other than the file the user picked — verified against real git.
suite('toGitignorePattern', () => {
	test('anchors a root file so the name is not ignored elsewhere in the tree', () => {
		assert.strictEqual(toGitignorePattern('notes.md'), '/notes.md');
	});

	test('anchors a nested path without touching its separators', () => {
		assert.strictEqual(toGitignorePattern('src/notes.md'), '/src/notes.md');
	});

	test('escapes `[` so the name cannot open a character class', () => {
		assert.strictEqual(toGitignorePattern('weird[1].log'), '/weird\\[1].log');
	});

	test('escapes `*` and `?` so the pattern cannot match neighbouring files', () => {
		assert.strictEqual(toGitignorePattern('a*b?.log'), '/a\\*b\\?.log');
	});

	test('quotes a trailing space, which git would otherwise strip', () => {
		assert.strictEqual(toGitignorePattern('report '), '/report\\ ');
	});

	test('a leading `#` is data, not a comment — the anchor keeps it off the line start', () => {
		assert.strictEqual(toGitignorePattern('#autosave#'), '/#autosave#');
	});

	test('a leading `!` is data, not a negation', () => {
		assert.strictEqual(toGitignorePattern('!draft.md'), '/!draft.md');
	});
});

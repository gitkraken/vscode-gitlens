import * as assert from 'node:assert';
import { applyRebaseActionToTodo } from '../rebaseTodo.js';

// Full 40-char SHAs; todo lines below carry 7-char abbreviations (prefixes of these).
const A = 'a1b2c3d'.padEnd(40, '0');
const B = 'b1b2c3d'.padEnd(40, '0');
const C = 'c1b2c3d'.padEnd(40, '0');
const D = 'd1b2c3d'.padEnd(40, '0');

const todo = [
	'pick a1b2c3d Commit A',
	'pick b1b2c3d Commit B',
	'pick c1b2c3d Commit C',
	'pick d1b2c3d Commit D',
	'',
	'# Rebase a1b2c3d..d1b2c3d onto a1b2c3d (4 commands)',
	'#',
	'# Commands:',
	'# p, pick = use commit',
].join('\n');

suite('applyRebaseActionToTodo', () => {
	test('keeps the oldest selected commit as pick and squashes the rest of the range', () => {
		const result = applyRebaseActionToTodo(todo, [B, C], 'squash');
		const lines = result.split('\n');
		assert.strictEqual(lines[0], 'pick a1b2c3d Commit A', 'unselected commit A stays pick');
		assert.strictEqual(lines[1], 'pick b1b2c3d Commit B', 'oldest selected (B) stays pick — the squash target');
		assert.strictEqual(lines[2], 'squash c1b2c3d Commit C', 'later selected (C) becomes squash');
		assert.strictEqual(lines[3], 'pick d1b2c3d Commit D', 'unselected commit D stays pick');
	});

	test('supports fixup as the action', () => {
		const result = applyRebaseActionToTodo(todo, [B, C], 'fixup');
		assert.strictEqual(result.split('\n')[2], 'fixup c1b2c3d Commit C');
	});

	test('squashes a tip range (oldest selected first, newest last)', () => {
		const result = applyRebaseActionToTodo(todo, [B, C, D], 'squash');
		const lines = result.split('\n');
		assert.strictEqual(lines[1], 'pick b1b2c3d Commit B');
		assert.strictEqual(lines[2], 'squash c1b2c3d Commit C');
		assert.strictEqual(lines[3], 'squash d1b2c3d Commit D');
	});

	test('leaves comments, blank lines, and non-pick lines untouched', () => {
		const withUpdateRef = `${todo}\nupdate-ref refs/heads/feature`;
		const result = applyRebaseActionToTodo(withUpdateRef, [B, C], 'squash');
		const lines = result.split('\n');
		assert.strictEqual(lines[4], '', 'blank line preserved');
		assert.ok(lines[5].startsWith('# Rebase'), 'comment preserved');
		assert.strictEqual(lines.at(-1), 'update-ref refs/heads/feature', 'update-ref line preserved');
	});

	test('matches abbreviated todo SHAs against full selected SHAs', () => {
		// Selected SHAs are full-length; todo carries 7-char abbreviations.
		const result = applyRebaseActionToTodo(todo, [C, D], 'squash');
		const lines = result.split('\n');
		assert.strictEqual(lines[2], 'pick c1b2c3d Commit C', 'oldest selected (C) stays pick');
		assert.strictEqual(lines[3], 'squash d1b2c3d Commit D');
	});

	test('a single selected commit produces no squash', () => {
		const result = applyRebaseActionToTodo(todo, [B], 'squash');
		assert.strictEqual(result, todo, 'one selected commit leaves the todo unchanged');
	});

	test('does not touch unrelated commits', () => {
		assert.ok(!applyRebaseActionToTodo(todo, [B, C], 'squash').includes('squash a1b2c3d'));
		assert.strictEqual(A.length, 40);
	});

	test('drops every selected commit (no pick is kept)', () => {
		const result = applyRebaseActionToTodo(todo, [B, C], 'drop');
		const lines = result.split('\n');
		assert.strictEqual(lines[0], 'pick a1b2c3d Commit A', 'unselected commit A stays pick');
		assert.strictEqual(lines[1], 'drop b1b2c3d Commit B', 'selected B is dropped (not kept as pick)');
		assert.strictEqual(lines[2], 'drop c1b2c3d Commit C', 'selected C is dropped');
		assert.strictEqual(lines[3], 'pick d1b2c3d Commit D', 'unselected commit D stays pick');
	});

	test('drops a single selected commit', () => {
		const result = applyRebaseActionToTodo(todo, [C], 'drop');
		assert.strictEqual(result.split('\n')[2], 'drop c1b2c3d Commit C');
	});

	test('rewords the selected commit (no pick is kept)', () => {
		const result = applyRebaseActionToTodo(todo, [C], 'reword');
		const lines = result.split('\n');
		assert.strictEqual(lines[2], 'reword c1b2c3d Commit C', 'selected C becomes reword');
		assert.strictEqual(lines[1], 'pick b1b2c3d Commit B', 'unselected B stays pick');
	});

	// Git abbreviates the `pick` command to `p` when `rebase.abbreviateCommands=true`.
	const abbreviatedTodo = [
		'p a1b2c3d Commit A',
		'p b1b2c3d Commit B',
		'p c1b2c3d Commit C',
		'p d1b2c3d Commit D',
	].join('\n');

	test('squashes an abbreviated (`p`) todo, rewriting to the full action word', () => {
		const result = applyRebaseActionToTodo(abbreviatedTodo, [B, C], 'squash');
		const lines = result.split('\n');
		assert.strictEqual(lines[0], 'p a1b2c3d Commit A', 'unselected A stays untouched');
		assert.strictEqual(lines[1], 'p b1b2c3d Commit B', 'oldest selected (B) stays the abbreviated pick target');
		assert.strictEqual(lines[2], 'squash c1b2c3d Commit C', 'later selected (C) becomes full `squash`');
		assert.strictEqual(lines[3], 'p d1b2c3d Commit D', 'unselected D stays untouched');
	});

	test('drops selected commits in an abbreviated (`p`) todo', () => {
		const result = applyRebaseActionToTodo(abbreviatedTodo, [B, C], 'drop');
		const lines = result.split('\n');
		assert.strictEqual(lines[1], 'drop b1b2c3d Commit B', 'selected B becomes full `drop`');
		assert.strictEqual(lines[2], 'drop c1b2c3d Commit C', 'selected C becomes full `drop`');
		assert.strictEqual(lines[3], 'p d1b2c3d Commit D', 'unselected D stays untouched');
	});

	test('rewords the selected commit in an abbreviated (`p`) todo', () => {
		const result = applyRebaseActionToTodo(abbreviatedTodo, [C], 'reword');
		assert.strictEqual(result.split('\n')[2], 'reword c1b2c3d Commit C', 'selected C becomes full `reword`');
	});

	test('matches both `pick` and abbreviated `p` lines in a mixed todo', () => {
		const mixedTodo = ['pick a1b2c3d Commit A', 'p b1b2c3d Commit B', 'p c1b2c3d Commit C'].join('\n');
		const result = applyRebaseActionToTodo(mixedTodo, [B, C], 'squash');
		const lines = result.split('\n');
		assert.strictEqual(lines[1], 'p b1b2c3d Commit B', 'oldest selected (B) stays the abbreviated pick target');
		assert.strictEqual(lines[2], 'squash c1b2c3d Commit C', 'later selected (C) becomes squash');
	});
});

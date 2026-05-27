import * as assert from 'node:assert';
import { deriveNameFromPrompt } from '../deriveNameFromPrompt.js';

suite('deriveNameFromPrompt', () => {
	test('returns undefined for undefined', () => {
		assert.strictEqual(deriveNameFromPrompt(undefined), undefined);
	});

	test('returns undefined for empty string', () => {
		assert.strictEqual(deriveNameFromPrompt(''), undefined);
	});

	test('returns undefined for whitespace-only', () => {
		assert.strictEqual(deriveNameFromPrompt('   \n\t  '), undefined);
	});

	test('returns undefined for pure punctuation', () => {
		assert.strictEqual(deriveNameFromPrompt('!?.,;:'), undefined);
	});

	test('capitalizes the first letter', () => {
		assert.strictEqual(deriveNameFromPrompt('fix the bug'), 'Fix the bug');
	});

	test('preserves an already-capitalized first letter', () => {
		assert.strictEqual(deriveNameFromPrompt('Fix the bug'), 'Fix the bug');
	});

	test('strips a single filler prefix', () => {
		assert.strictEqual(deriveNameFromPrompt('please fix the bug'), 'Fix the bug');
	});

	test('strips multi-word filler prefixes', () => {
		assert.strictEqual(deriveNameFromPrompt('can you fix the bug'), 'Fix the bug');
		assert.strictEqual(deriveNameFromPrompt("i'd like to fix the bug"), 'Fix the bug');
		assert.strictEqual(deriveNameFromPrompt("let's fix the bug"), 'Fix the bug');
		assert.strictEqual(deriveNameFromPrompt('help me fix the bug'), 'Fix the bug');
	});

	test('strips chained filler prefixes', () => {
		assert.strictEqual(deriveNameFromPrompt('please can you fix the bug'), 'Fix the bug');
	});

	test('is case-insensitive about filler', () => {
		assert.strictEqual(deriveNameFromPrompt('PLEASE fix the bug'), 'Fix the bug');
		assert.strictEqual(deriveNameFromPrompt('Can You fix the bug'), 'Fix the bug');
	});

	test('strips triple-backtick code blocks', () => {
		const prompt = '```ts\nconst x = 1;\n```\nwhat does this do';
		assert.strictEqual(deriveNameFromPrompt(prompt), 'What does this do');
	});

	test('takes the first non-empty line', () => {
		assert.strictEqual(deriveNameFromPrompt('   \n   \nrefactor the agent'), 'Refactor the agent');
	});

	test('truncates at a word boundary with ellipsis', () => {
		const prompt = 'add a rename command for agent sessions and persist the override in workspace state';
		const result = deriveNameFromPrompt(prompt)!;
		assert.ok(result.length <= 50, `expected <=50 chars, got ${result.length}`);
		assert.ok(result.endsWith('…'), `expected ellipsis suffix, got "${result}"`);
		assert.ok(!result.includes('…'.repeat(2)));
		// Should not split a word — last char before the ellipsis is the end of a word.
		const beforeEllipsis = result.slice(0, -1);
		assert.ok(!/\s$/.test(beforeEllipsis));
	});

	test('does not truncate short prompts', () => {
		assert.strictEqual(deriveNameFromPrompt('fix it'), 'Fix it');
	});

	test('collapses internal whitespace', () => {
		assert.strictEqual(deriveNameFromPrompt('fix  the\t  bug'), 'Fix the bug');
	});

	test('passes through non-ASCII text', () => {
		assert.strictEqual(deriveNameFromPrompt('refactor the こんにちは module'), 'Refactor the こんにちは module');
	});

	test('returns undefined when only code blocks and filler remain', () => {
		assert.strictEqual(deriveNameFromPrompt('```ts\nfoo()\n```'), undefined);
	});
});

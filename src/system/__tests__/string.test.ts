import * as assert from 'assert';
import { interpolate } from '../string';

suite('String Test Suite', () => {
	suite('interpolate', () => {
		test('returns template unchanged when template is null', () => {
			assert.strictEqual(interpolate(null as any, {}), null);
		});

		test('returns template unchanged when template is undefined', () => {
			assert.strictEqual(interpolate(undefined as any, {}), undefined);
		});

		test('returns template unchanged when template is empty string', () => {
			assert.strictEqual(interpolate('', {}), '');
		});

		test('sanitizes tokens when context is null', () => {
			const template = 'Hello ${name}, you have ${count} messages';
			const result = interpolate(template, null);
			// tokenSanitizeRegex removes the tokens, leaving just the literal text
			assert.strictEqual(result, 'Hello , you have  messages');
		});

		test('sanitizes tokens when context is undefined', () => {
			const template = 'Hello ${name}, you have ${count} messages';
			const result = interpolate(template, undefined);
			assert.strictEqual(result, 'Hello , you have  messages');
		});

		test('returns template unchanged when no tokens present', () => {
			const template = 'Hello world, no tokens here';
			const context = { name: 'John', count: '5' };
			const result = interpolate(template, context);
			assert.strictEqual(result, template);
		});

		test('replaces single token with context value', () => {
			const template = 'Hello ${name}';
			const context = { name: 'John' };
			const result = interpolate(template, context);
			assert.strictEqual(result, 'Hello John');
		});

		test('replaces multiple tokens with context values', () => {
			const template = 'Hello ${name}, you have ${count} messages';
			const context = { name: 'John', count: '5' };
			const result = interpolate(template, context);
			assert.strictEqual(result, 'Hello John, you have 5 messages');
		});

		test('replaces missing context values with empty string', () => {
			const template = 'Hello ${name}, you have ${count} messages';
			const context = { name: 'John' }; // missing 'count'
			const result = interpolate(template, context);
			assert.strictEqual(result, 'Hello John, you have  messages');
		});

		test('handles tokens at beginning of template', () => {
			const template = '${greeting} world';
			const context = { greeting: 'Hello' };
			const result = interpolate(template, context);
			assert.strictEqual(result, 'Hello world');
		});

		test('handles tokens at end of template', () => {
			const template = 'Hello ${name}';
			const context = { name: 'world' };
			const result = interpolate(template, context);
			assert.strictEqual(result, 'Hello world');
		});

		test('handles consecutive tokens', () => {
			const template = '${first}${second}${third}';
			const context = { first: 'A', second: 'B', third: 'C' };
			const result = interpolate(template, context);
			assert.strictEqual(result, 'ABC');
		});

		test('handles same token used multiple times', () => {
			const template = '${name} says hello to ${name}';
			const context = { name: 'John' };
			const result = interpolate(template, context);
			assert.strictEqual(result, 'John says hello to John');
		});

		test('handles empty context object', () => {
			const template = 'Hello ${name}, you have ${count} messages';
			const context = {};
			const result = interpolate(template, context);
			assert.strictEqual(result, 'Hello , you have  messages');
		});

		test('handles context with extra unused properties', () => {
			const template = 'Hello ${name}';
			const context = { name: 'John', unused: 'value', extra: 'data' };
			const result = interpolate(template, context);
			assert.strictEqual(result, 'Hello John');
		});

		test('handles numeric values in context', () => {
			const template = 'You have ${count} items';
			const context = { count: 42 };
			const result = interpolate(template, context);
			assert.strictEqual(result, 'You have 42 items');
		});

		test('handles boolean values in context', () => {
			const template = 'Status: ${active}';
			const context = { active: true };
			const result = interpolate(template, context);
			assert.strictEqual(result, 'Status: true');
		});

		test('handles null values in context', () => {
			const template = 'Value: ${value}';
			const context = { value: null };
			const result = interpolate(template, context);
			assert.strictEqual(result, 'Value: ');
		});

		test('handles undefined values in context', () => {
			const template = 'Value: ${value}';
			const context = { value: undefined };
			const result = interpolate(template, context);
			assert.strictEqual(result, 'Value: ');
		});

		test('handles special characters in token values', () => {
			const template = 'Path: ${path}';
			const context = { path: '/home/user/file.txt' };
			const result = interpolate(template, context);
			assert.strictEqual(result, 'Path: /home/user/file.txt');
		});

		test('handles complex real-world URL template', () => {
			const template = 'https://github.com/${repoBase}/${repoPath}/blob/${branch}/${file}${line}';
			const context = {
				repoBase: 'microsoft',
				repoPath: 'vscode',
				branch: 'main',
				file: 'src/main.ts',
				line: '#L42'
			};
			const result = interpolate(template, context);
			assert.strictEqual(result, 'https://github.com/microsoft/vscode/blob/main/src/main.ts#L42');
		});

		test('handles template with no tokens but with context', () => {
			const template = 'No tokens here at all';
			const context = { name: 'John', count: '5' };
			const result = interpolate(template, context);
			assert.strictEqual(result, 'No tokens here at all');
		});

		test('handles malformed tokens (missing closing brace)', () => {
			const template = 'Hello ${name and ${count} messages';
			const context = { name: 'John', count: '5' };
			const result = interpolate(template, context);
			// Should only replace properly formed tokens
			assert.strictEqual(result, 'Hello ${name and 5 messages');
		});

		test('handles empty token names', () => {
			const template = 'Hello ${} world';
			const context = { '': 'empty' };
			const result = interpolate(template, context);
			assert.strictEqual(result, 'Hello empty world');
		});
	});
});

import * as assert from 'node:assert';
import { localizedContent } from '../localizedContent.js';

suite('localizedContent', () => {
	test('preserves existing content when translations reorder and repeat placeholders', () => {
		const link = { existingTemplate: 'link' };
		const code = { existingTemplate: 'code' };
		assert.deepStrictEqual(localizedContent('{code}: {link}, {code}', { link: link, code: code }), [
			'',
			code,
			': ',
			link,
			', ',
			code,
			'',
		]);
	});

	test('keeps translator markup as text and does not recursively expand user data', () => {
		assert.deepStrictEqual(localizedContent('<img onerror="alert(1)">{name}', { name: '{link}' }), [
			'<img onerror="alert(1)">',
			'{link}',
			'',
		]);
	});

	test('keeps missing placeholders visible and never reads inherited properties', () => {
		const original = console.warn;
		console.warn = () => {};

		try {
			assert.deepStrictEqual(localizedContent('{missing}{toString}', {}), [
				'',
				'{missing}',
				'',
				'{toString}',
				'',
			]);
		} finally {
			console.warn = original;
		}
	});

	test('accepts intentionally empty and zero-valued substitutions', () => {
		assert.deepStrictEqual(localizedContent('{empty}/{zero}', { empty: '', zero: 0 }), ['', '', '/', 0, '']);
	});

	test('warns once about a missing placeholder and still renders it literally', () => {
		const calls: unknown[][] = [];
		const original = console.warn;
		console.warn = (...args: unknown[]) => calls.push(args);

		try {
			const result = localizedContent('warn test: {alpha}', {});
			assert.deepStrictEqual(result, ['warn test: ', '{alpha}', '']);
			assert.strictEqual(calls.length, 1);
			assert.match(String(calls[0][0]), /missing values for alpha/);
		} finally {
			console.warn = original;
		}
	});

	test('warns about an unused value and ignores it', () => {
		const calls: unknown[][] = [];
		const original = console.warn;
		console.warn = (...args: unknown[]) => calls.push(args);

		try {
			const result = localizedContent('unused test: {used}', { used: 'x', extra: 'y' });
			assert.deepStrictEqual(result, ['unused test: ', 'x', '']);
			assert.strictEqual(calls.length, 1);
			assert.match(String(calls[0][0]), /unused values extra/);
		} finally {
			console.warn = original;
		}
	});

	test('warns only once when the same inconsistent message is rendered twice', () => {
		const calls: unknown[][] = [];
		const original = console.warn;
		console.warn = (...args: unknown[]) => calls.push(args);

		try {
			localizedContent('repeat test: {beta}', {});
			localizedContent('repeat test: {beta}', {});
			assert.strictEqual(calls.length, 1);
		} finally {
			console.warn = original;
		}
	});

	test('does not warn when the message and values are fully consistent', () => {
		const calls: unknown[][] = [];
		const original = console.warn;
		console.warn = (...args: unknown[]) => calls.push(args);

		try {
			const result = localizedContent('consistent test: {gamma}', { gamma: 'value' });
			assert.deepStrictEqual(result, ['consistent test: ', 'value', '']);
			assert.strictEqual(calls.length, 0);
		} finally {
			console.warn = original;
		}
	});
});

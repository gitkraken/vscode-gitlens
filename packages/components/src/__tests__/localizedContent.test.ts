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
		assert.deepStrictEqual(localizedContent('{missing}{toString}', {}), ['', '{missing}', '', '{toString}', '']);
	});

	test('accepts intentionally empty and zero-valued substitutions', () => {
		assert.deepStrictEqual(localizedContent('{empty}/{zero}', { empty: '', zero: 0 }), ['', '', '/', 0, '']);
	});
});

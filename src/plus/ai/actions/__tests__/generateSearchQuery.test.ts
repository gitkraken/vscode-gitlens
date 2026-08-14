import * as assert from 'node:assert';
import { extractSearchQueryResult } from '../generateSearchQuery.js';

const fullObject = JSON.stringify({
	query: 'author:eamodio',
	explanation: 'Commits authored by eamodio',
	mode: 'highlight',
	alternates: ['author:eamodio after:1.week.ago', 'author:eamodio file:*.ts'],
});

suite('extractSearchQueryResult', () => {
	test('parses a bare JSON object with all fields', () => {
		assert.deepStrictEqual(extractSearchQueryResult(fullObject), {
			query: 'author:eamodio',
			explanation: 'Commits authored by eamodio',
			mode: 'highlight',
			alternates: ['author:eamodio after:1.week.ago', 'author:eamodio file:*.ts'],
		});
	});

	test('strips code fences', () => {
		assert.deepStrictEqual(
			extractSearchQueryResult(`\`\`\`json\n${fullObject}\n\`\`\``),
			extractSearchQueryResult(fullObject),
		);
	});

	test('extracts JSON wrapped in surrounding prose', () => {
		const prose = `Here's the result:\n${fullObject}\nLet me know.`;
		assert.deepStrictEqual(extractSearchQueryResult(prose), extractSearchQueryResult(fullObject));
	});

	test('returns undefined when query is missing', () => {
		const missing = JSON.stringify({ explanation: 'e', mode: 'highlight', alternates: [] });
		assert.strictEqual(extractSearchQueryResult(missing), undefined);
	});

	test('returns undefined when query is not a string', () => {
		const wrongType = JSON.stringify({ query: 123, explanation: 'e', mode: 'highlight', alternates: [] });
		assert.strictEqual(extractSearchQueryResult(wrongType), undefined);
	});

	test('returns undefined when query is empty or whitespace-only', () => {
		const empty = JSON.stringify({ query: '', explanation: 'e', mode: 'highlight', alternates: [] });
		assert.strictEqual(extractSearchQueryResult(empty), undefined);

		const whitespace = JSON.stringify({ query: '   ', explanation: 'e', mode: 'highlight', alternates: [] });
		assert.strictEqual(extractSearchQueryResult(whitespace), undefined);
	});

	test('normalizes an invalid mode to undefined while keeping the rest', () => {
		const bogusMode = JSON.stringify({
			query: 'message:fix',
			explanation: 'A message search',
			mode: 'bogus',
			alternates: [],
		});
		assert.deepStrictEqual(extractSearchQueryResult(bogusMode), {
			query: 'message:fix',
			explanation: 'A message search',
			mode: undefined,
			alternates: [],
		});
	});

	test('caps alternates at 2 entries, keeping the first 2 in order', () => {
		const many = JSON.stringify({
			query: 'message:fix',
			explanation: 'e',
			mode: 'highlight',
			alternates: ['one', 'two', 'three', 'four'],
		});
		const result = extractSearchQueryResult(many);
		assert.deepStrictEqual(result?.alternates, ['one', 'two']);
	});

	test('drops non-string and blank entries from alternates', () => {
		const dirty = JSON.stringify({
			query: 'message:fix',
			explanation: 'e',
			mode: 'highlight',
			alternates: ['', '   ', 'valid-one', 123, null, 'valid-two'],
		});
		const result = extractSearchQueryResult(dirty);
		assert.deepStrictEqual(result?.alternates, ['valid-one', 'valid-two']);
	});

	test('returns undefined on malformed JSON', () => {
		assert.strictEqual(extractSearchQueryResult('not json at all'), undefined);
	});

	test('returns undefined when the query is exactly the prompt example placeholder', () => {
		const echoedPlaceholder = JSON.stringify({
			query: '[search operators here]',
			explanation: 'e',
			mode: 'highlight',
			alternates: [],
		});
		assert.strictEqual(extractSearchQueryResult(echoedPlaceholder), undefined);
	});

	test('returns undefined when the placeholder text appears within a larger query', () => {
		const embeddedPlaceholder = JSON.stringify({
			query: 'message:[search operators here]',
			explanation: 'e',
			mode: 'highlight',
			alternates: [],
		});
		assert.strictEqual(extractSearchQueryResult(embeddedPlaceholder), undefined);
	});
});

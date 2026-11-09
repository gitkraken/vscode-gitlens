import * as assert from 'node:assert';
import type { Source } from '../../../../constants.telemetry.js';
import type { AIService } from '../../aiService.js';
import { extractSearchQueryResult, generateSearchQuery } from '../generateSearchQuery.js';

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

	test('returns undefined when the query mixes message: and -message: operators', () => {
		const mixed = JSON.stringify({
			query: 'message:fix -message:wip',
			explanation: 'e',
			mode: 'highlight',
			alternates: [],
		});
		assert.strictEqual(extractSearchQueryResult(mixed), undefined);
	});

	test('accepts a query using only -message: (no message: present)', () => {
		const excludeOnly = JSON.stringify({
			query: '-message:wip',
			explanation: 'e',
			mode: 'highlight',
			alternates: [],
		});
		assert.deepStrictEqual(extractSearchQueryResult(excludeOnly), {
			query: '-message:wip',
			explanation: 'e',
			mode: 'highlight',
			alternates: [],
		});
	});
});

suite('generateSearchQuery', () => {
	function fakeService(contents: (string | null)[]): { service: AIService; requests: () => number } {
		let calls = 0;
		const service = {
			sendRequest: () => {
				const content = contents[calls++];
				return Promise.resolve({
					model: { id: 'm' },
					promise: Promise.resolve(content == null ? undefined : { content: content, model: { id: 'm' } }),
				});
			},
		} as unknown as AIService;
		return { service: service, requests: () => calls };
	}

	const search = { query: 'my commits', context: undefined };
	const source: Source = { source: 'graph' };

	test('sends exactly one request when the first request fails (null response)', async () => {
		const { service, requests } = fakeService([null, fullObject]);

		assert.strictEqual(await generateSearchQuery(service, search, source), undefined);
		assert.strictEqual(requests(), 1);
	});

	test('still sends the corrective request when the response is unparseable', async () => {
		const { service, requests } = fakeService(['not json', fullObject]);

		const result = await generateSearchQuery(service, search, source);
		assert.strictEqual(requests(), 2);
		assert.notStrictEqual(result, undefined);
		assert.strictEqual(typeof result === 'object' ? result?.result.query : undefined, 'author:eamodio');
	});
});

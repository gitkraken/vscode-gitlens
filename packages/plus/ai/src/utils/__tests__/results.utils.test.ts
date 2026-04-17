import * as assert from 'node:assert';
import { parseSummarizeResult, splitMessageIntoSummaryAndBody } from '../results.utils.js';

suite('parseSummarizeResult', () => {
	test('extracts both summary and body when both tags are present', () => {
		const result = parseSummarizeResult('<summary>Fix crash</summary>\n<body>Null-check the widget.</body>');
		assert.deepStrictEqual(result, { summary: 'Fix crash', body: 'Null-check the widget.' });
	});

	test('treats untagged leftover text as the body when only summary is tagged', () => {
		const result = parseSummarizeResult('<summary>Fix crash</summary>\nNull-check the widget.');
		assert.deepStrictEqual(result, { summary: 'Fix crash', body: 'Null-check the widget.' });
	});

	test('treats untagged leftover text as the summary when only body is tagged', () => {
		const result = parseSummarizeResult('Fix crash\n<body>Null-check the widget.</body>');
		assert.deepStrictEqual(result, { summary: 'Fix crash', body: 'Null-check the widget.' });
	});

	test('recognises a self-closing <body/> as an explicit empty body', () => {
		const result = parseSummarizeResult('<summary>Fix crash</summary>\n<body/>');
		assert.deepStrictEqual(result, { summary: 'Fix crash', body: '' });
	});

	test('falls back to splitting on the first newline when no tags are present', () => {
		const result = parseSummarizeResult('Fix crash\nNull-check the widget.\nAdd a test.');
		assert.deepStrictEqual(result, { summary: 'Fix crash', body: 'Null-check the widget.\nAdd a test.' });
	});

	test('recovers a missing closing summary tag by consuming the rest of the message', () => {
		// The regex uses `(?:</summary>|$)` so an unterminated <summary> grabs everything
		// to EOF; the parser then splits that captured summary on the first newline to
		// produce a separate body.
		const result = parseSummarizeResult('<summary>Fix crash with a long description that spans multiple\nlines');
		assert.deepStrictEqual(result, {
			summary: 'Fix crash with a long description that spans multiple',
			body: 'lines',
		});
	});

	test('returns empty strings for an empty input', () => {
		assert.deepStrictEqual(parseSummarizeResult(''), { summary: '', body: '' });
	});
});

suite('splitMessageIntoSummaryAndBody', () => {
	test('treats a single-line message as summary only', () => {
		assert.deepStrictEqual(splitMessageIntoSummaryAndBody('Fix crash'), { summary: 'Fix crash', body: '' });
	});

	test('splits on the first newline and trims both halves', () => {
		assert.deepStrictEqual(splitMessageIntoSummaryAndBody('Summary line\n\nBody here'), {
			summary: 'Summary line',
			body: 'Body here',
		});
	});

	test('unwraps a surrounding code block before splitting', () => {
		assert.deepStrictEqual(
			splitMessageIntoSummaryAndBody('```\nSummary line\nBody first line\nBody second line\n```'),
			{ summary: 'Summary line', body: 'Body first line\nBody second line' },
		);
	});
});

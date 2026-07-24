import * as assert from 'node:assert';
import type { AIReviewResult } from '../../models/results.js';
import {
	parseReviewResult,
	parseSummarizeResult,
	serializeReviewResult,
	splitMessageIntoSummaryAndBody,
} from '../results.utils.js';

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

suite('serializeReviewResult', () => {
	test('round-trips through parseReviewResult', () => {
		// Explicit `undefined`s (and parser-scheme ids) so deepStrictEqual matches the parse output shape
		const original: AIReviewResult = {
			overview: 'Solid change overall with two risk areas.\nWatch the IO paths.',
			focusAreas: [
				{
					id: 'area-1',
					label: 'Error handling',
					rationale: 'Missing guards around IO boundaries.',
					severity: 'warning',
					files: ['src/a.ts', 'src/b.ts'],
					findings: [
						{
							id: 'area-1-f1',
							severity: 'critical',
							title: 'Unhandled rejection',
							description: 'The promise can reject without a handler.\nWrap it in try/catch.',
							filePath: 'src/a.ts',
							lineRange: { start: 10, end: 12 },
						},
						{
							id: 'area-1-f2',
							severity: 'suggestion',
							title: 'General cleanup',
							description: 'No file anchor on purpose.',
							filePath: undefined,
							lineRange: undefined,
						},
					],
				},
				{
					id: 'area-2',
					label: 'Documentation',
					rationale: 'Overview-style area without findings (two-pass pass 1).',
					severity: 'suggestion',
					files: [],
					findings: undefined,
				},
			],
			mode: 'single-pass',
		};

		assert.deepStrictEqual(parseReviewResult(serializeReviewResult(original), original.mode), original);
	});

	test('round-trips an empty findings block as an empty array, not undefined', () => {
		const original: AIReviewResult = {
			overview: 'Clean change.',
			focusAreas: [
				{
					id: 'area-1',
					label: 'Inspected area',
					rationale: 'Looked risky, turned out fine.',
					severity: 'suggestion',
					files: ['src/a.ts'],
					findings: [],
				},
			],
			mode: 'two-pass',
		};

		assert.deepStrictEqual(parseReviewResult(serializeReviewResult(original), original.mode), original);
	});

	test('sanitizes double-quotes in attribute values so the parser cannot truncate them', () => {
		const original: AIReviewResult = {
			overview: 'Quoted path.',
			focusAreas: [
				{
					id: 'area-1',
					label: 'Quoting',
					rationale: 'Attr safety.',
					severity: 'warning',
					files: ['src/we"ird.ts'],
					findings: undefined,
				},
			],
			mode: 'single-pass',
		};

		const parsed = parseReviewResult(serializeReviewResult(original), original.mode);
		assert.deepStrictEqual(parsed.focusAreas[0].files, ["src/we'ird.ts"]);
	});
});

import * as assert from 'node:assert';
import type { AIReviewResult } from '../../models/results.js';
import {
	parseReviewDetailResult,
	parseReviewDetailResultJson,
	parseReviewResult,
	parseReviewResultJson,
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
	test('round-trips through parseReviewResultJson', () => {
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

		assert.deepStrictEqual(parseReviewResultJson(serializeReviewResult(original), original.mode), original);
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

		assert.deepStrictEqual(parseReviewResultJson(serializeReviewResult(original), original.mode), original);
	});

	test('preserves double-quotes verbatim — JSON escapes them, unlike the legacy XML attributes', () => {
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

		const parsed = parseReviewResultJson(serializeReviewResult(original), original.mode);
		assert.deepStrictEqual(parsed.focusAreas[0].files, ['src/we"ird.ts']);
	});
});

suite('parseReviewResultJson', () => {
	const json = JSON.stringify({
		overview: 'Solid changes overall.',
		focusAreas: [
			{
				label: 'Error handling',
				rationale: 'Missing guards',
				severity: 'warning',
				files: ['src/a.ts', 'src/b.ts'],
				findings: [
					{
						severity: 'critical',
						title: 'Null deref',
						description: 'x may be undefined',
						file: 'src/a.ts',
						lines: { start: 10, end: 12 },
					},
					{
						severity: 'warning',
						title: 'Swallowed error',
						description: 'catch ignores the failure',
						file: null,
						lines: null,
					},
				],
			},
			{
				label: 'Perf',
				rationale: 'Hot path allocation',
				severity: 'suggestion',
				files: ['src/c.ts'],
				findings: null,
			},
		],
	});

	test('parses the JSON shape with positional area/finding ids and null-normalized optionals', () => {
		const result = parseReviewResultJson(json, 'single-pass');

		assert.strictEqual(result.overview, 'Solid changes overall.');
		assert.strictEqual(result.mode, 'single-pass');
		assert.strictEqual(result.focusAreas.length, 2);

		const [area1, area2] = result.focusAreas;
		assert.strictEqual(area1.id, 'area-1');
		assert.strictEqual(area1.severity, 'warning');
		assert.deepStrictEqual(area1.files, ['src/a.ts', 'src/b.ts']);
		assert.strictEqual(area1.findings?.length, 2);
		assert.strictEqual(area1.findings[0].id, 'area-1-f1');
		assert.deepStrictEqual(area1.findings[0].lineRange, { start: 10, end: 12 });
		assert.strictEqual(area1.findings[1].id, 'area-1-f2');
		assert.strictEqual(area1.findings[1].filePath, undefined);
		assert.strictEqual(area1.findings[1].lineRange, undefined);

		assert.strictEqual(area2.id, 'area-2');
		assert.strictEqual(area2.findings, undefined);
	});

	test('accepts code-fenced JSON', () => {
		const result = parseReviewResultJson(`\`\`\`json\n${json}\n\`\`\``, 'two-pass');
		assert.strictEqual(result.focusAreas.length, 2);
		assert.strictEqual(result.mode, 'two-pass');
	});

	test('accepts JSON wrapped in surrounding prose', () => {
		const result = parseReviewResultJson(`Here is the review:\n${json}\nHope this helps!`, 'single-pass');
		assert.strictEqual(result.overview, 'Solid changes overall.');
		assert.strictEqual(result.focusAreas.length, 2);
	});

	test('skips unbalanced prose braces and wrong-shape objects preceding the payload', () => {
		// `render() {` never balances and {"note": ...} parses but isn't the review shape — both
		// must be skipped, not abort the extraction
		const prose = `Note: render() { is missing a guard. Context: {"note": "focused on error handling"}\n${json}`;
		const result = parseReviewResultJson(prose, 'single-pass');
		assert.strictEqual(result.overview, 'Solid changes overall.');
		assert.strictEqual(result.focusAreas.length, 2);
	});

	test('tolerates non-string field values and numeric-string line numbers', () => {
		const result = parseReviewResultJson(
			JSON.stringify({
				overview: 'x',
				focusAreas: [
					{
						label: 123,
						rationale: null,
						severity: 'warning',
						files: [42, 'src/a.ts'],
						findings: [
							{
								severity: 'critical',
								title: 7,
								description: 'd',
								file: 'src/a.ts',
								lines: { start: '10', end: '12' },
							},
						],
					},
				],
			}),
			'single-pass',
		);

		const [area] = result.focusAreas;
		assert.strictEqual(area.label, 'Untitled area');
		assert.strictEqual(area.rationale, '');
		assert.deepStrictEqual(area.files, ['src/a.ts']);
		assert.strictEqual(area.findings?.[0].title, 'Untitled finding');
		assert.deepStrictEqual(area.findings[0].lineRange, { start: 10, end: 12 });
	});

	test('throws on a truncated JSON response instead of returning an empty review', () => {
		assert.throws(() => parseReviewResultJson(json.slice(0, json.length / 2), 'single-pass'));
	});

	test('throws on an unrecognizable non-empty response instead of returning an empty review', () => {
		assert.throws(() => parseReviewResultJson('The changes look good to me!', 'single-pass'));
		assert.throws(() => parseReviewResultJson('{"focusAreas": {}}', 'single-pass'));
	});

	test('throws on an empty response instead of returning a clean review', () => {
		// e.g. a thinking-only reply with no text block, or a proxy failure yielding empty content
		assert.throws(() => parseReviewResultJson('', 'single-pass'));
		assert.throws(() => parseReviewResultJson('  \n', 'single-pass'));
		assert.throws(() => parseReviewDetailResultJson('', 'area-1'));
	});

	test('tolerates shape-invalid containers and entries without crashing', () => {
		// Non-array findings degrade to no findings; null/non-object finding entries are skipped
		const result = parseReviewResultJson(
			JSON.stringify({
				overview: 'x',
				focusAreas: [
					{ label: 'a', rationale: 'r', severity: 'warning', files: 'not-an-array', findings: {} },
					{
						label: 'b',
						rationale: 'r',
						severity: 'warning',
						files: [],
						findings: [
							null,
							{ severity: 'warning', title: 't', description: 'd', file: null, lines: null },
						],
					},
				],
			}),
			'single-pass',
		);

		assert.strictEqual(result.focusAreas.length, 2);
		assert.strictEqual(result.focusAreas[0].findings, undefined);
		assert.deepStrictEqual(result.focusAreas[0].files, []);
		assert.strictEqual(result.focusAreas[1].findings?.length, 1);
		assert.strictEqual(result.focusAreas[1].findings[0].id, 'area-2-f1');
	});

	test('defaults an unknown severity to suggestion', () => {
		const result = parseReviewResultJson(
			JSON.stringify({
				overview: 'x',
				focusAreas: [{ label: 'a', rationale: 'r', severity: 'blocker', files: [], findings: null }],
			}),
			'single-pass',
		);
		assert.strictEqual(result.focusAreas[0].severity, 'suggestion');
	});

	test('keeps finding ids unique across areas', () => {
		const finding = { severity: 'warning', title: 't', description: 'd', file: null, lines: null };
		const result = parseReviewResultJson(
			JSON.stringify({
				overview: 'x',
				focusAreas: [
					{ label: 'a', rationale: 'r', severity: 'warning', files: [], findings: [finding] },
					{ label: 'b', rationale: 'r', severity: 'warning', files: [], findings: [finding] },
				],
			}),
			'single-pass',
		);

		const ids = result.focusAreas.flatMap(a => a.findings?.map(f => f.id) ?? []);
		assert.deepStrictEqual(ids, ['area-1-f1', 'area-2-f1']);
		assert.strictEqual(new Set(ids).size, ids.length);
	});

	test('falls back to the legacy XML parser and produces identical ids for equivalent content', () => {
		const xml = `<overview>Solid changes overall.</overview>
<area severity="warning" files="src/a.ts">
<label>Error handling</label>
<rationale>Missing guards</rationale>
<findings>
<finding severity="critical" file="src/a.ts" lines="10-12">
<title>Null deref</title>
<description>x may be undefined</description>
</finding>
</findings>
</area>`;

		const viaJsonParser = parseReviewResultJson(xml, 'single-pass');
		assert.deepStrictEqual(viaJsonParser, parseReviewResult(xml, 'single-pass'));

		const equivalentJson = JSON.stringify({
			overview: 'Solid changes overall.',
			focusAreas: [
				{
					label: 'Error handling',
					rationale: 'Missing guards',
					severity: 'warning',
					files: ['src/a.ts'],
					findings: [
						{
							severity: 'critical',
							title: 'Null deref',
							description: 'x may be undefined',
							file: 'src/a.ts',
							lines: { start: 10, end: 12 },
						},
					],
				},
			],
		});
		assert.deepStrictEqual(parseReviewResultJson(equivalentJson, 'single-pass'), viaJsonParser);
	});
});

suite('parseReviewDetailResultJson', () => {
	test('parses findings with ids prefixed by the caller focus-area id', () => {
		const result = parseReviewDetailResultJson(
			JSON.stringify({
				findings: [
					{
						severity: 'warning',
						title: 't',
						description: 'd',
						file: 'src/a.ts',
						lines: { start: 5, end: 5 },
					},
				],
			}),
			'area-2',
		);

		assert.strictEqual(result.findings.length, 1);
		assert.strictEqual(result.findings[0].id, 'area-2-f1');
		assert.strictEqual(result.findings[0].filePath, 'src/a.ts');
	});

	test('parses an empty findings array', () => {
		assert.deepStrictEqual(parseReviewDetailResultJson('{"findings": []}', 'area-1'), { findings: [] });
	});

	test('treats a null findings value as no findings', () => {
		assert.deepStrictEqual(parseReviewDetailResultJson('{"findings": null}', 'area-1'), { findings: [] });
	});

	test('skips null finding entries without crashing', () => {
		const result = parseReviewDetailResultJson(
			JSON.stringify({
				findings: [null, { severity: 'warning', title: 't', description: 'd', file: null, lines: null }],
			}),
			'area-1',
		);
		assert.strictEqual(result.findings.length, 1);
		assert.strictEqual(result.findings[0].id, 'area-1-f1');
	});

	test('throws on a truncated or unrecognizable response instead of returning no findings', () => {
		assert.throws(() => parseReviewDetailResultJson('{"findings": [{"severity": "warn', 'area-1'));
		assert.throws(() => parseReviewDetailResultJson('No issues found in this area.', 'area-1'));
	});

	test('falls back to the legacy XML parser for XML responses', () => {
		const xml = `<findings>
<finding severity="suggestion" file="src/a.ts" lines="3">
<title>t</title>
<description>d</description>
</finding>
</findings>`;

		assert.deepStrictEqual(parseReviewDetailResultJson(xml, 'area-1'), parseReviewDetailResult(xml, 'area-1'));
		assert.strictEqual(parseReviewDetailResultJson(xml, 'area-1').findings[0].id, 'area-1-f1');
	});
});

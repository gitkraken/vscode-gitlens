import * as assert from 'node:assert/strict';
import * as l10n from '@vscode/l10n';
import type { AIReviewFinding, AIReviewFocusArea, AIReviewResult } from '@gitlens/ai/models/results.js';
import { formatReviewForAgentContext, getReviewFindingTitle, getReviewFocusAreaLabel } from '../reviewFormat.js';

const finding = {
	id: 'area-1-f1',
	severity: 'warning',
	title: 'Untitled finding',
	description: 'Description',
} satisfies AIReviewFinding;

const area = {
	id: 'area-1',
	label: 'Untitled area',
	rationale: 'Rationale',
	severity: 'warning',
	files: [],
} satisfies AIReviewFocusArea;

suite('review fallback presentation', () => {
	test('translates only parser-authored fallback values', () => {
		l10n.config({
			contents: {
				'Untitled area': 'Área sin título',
				'Untitled finding': 'Hallazgo sin título',
			},
		});
		try {
			assert.equal(getReviewFocusAreaLabel({ ...area, labelIsFallback: true }), 'Área sin título');
			assert.equal(getReviewFindingTitle({ ...finding, titleIsFallback: true }), 'Hallazgo sin título');

			assert.equal(getReviewFocusAreaLabel(area), 'Untitled area');
			assert.equal(getReviewFindingTitle(finding), 'Untitled finding');
		} finally {
			l10n.config({ contents: {} });
		}
	});
});

suite('review as context for the next review', () => {
	test('lists every finding with its id, severity, state, location and notes', () => {
		const result = {
			overview: '',
			mode: 'single-pass',
			focusAreas: [
				{
					...area,
					findings: [
						{
							id: 'a-f1',
							severity: 'critical',
							title: 'Signal ignored',
							description: 'Never checked\nbetween attempts',
							filePath: 'src/retry.ts',
							lineRange: { start: 12, end: 18 },
						},
						{ id: 'a-f2', severity: 'suggestion', title: 'Naming', description: 'Rename it' },
					],
				},
			],
		} as unknown as AIReviewResult;
		const text = formatReviewForAgentContext(
			result,
			new Map([['a-f2', 'dismissed' as const]]),
			new Map([
				['a-f1', [{ author: 'user' as const, text: 'Callers always pass one', at: 1 }]],
				['a-f2', [{ author: 'agent' as const, text: 'Agreed', at: 2 }]],
			]),
		);
		assert.equal(
			text,
			[
				'- id: a-f1 · [CRITICAL] · open · src/retry.ts:12-18',
				'  Signal ignored — Never checked between attempts',
				'  > Reviewer: Callers always pass one',
				'',
				'- id: a-f2 · [SUGGESTION] · dismissed',
				'  Naming — Rename it',
				'  > Agent: Agreed',
			].join('\n'),
		);
	});
});

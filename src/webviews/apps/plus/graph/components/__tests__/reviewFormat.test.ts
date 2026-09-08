import * as assert from 'node:assert/strict';
import * as l10n from '@vscode/l10n';
import type { AIReviewFinding, AIReviewFocusArea } from '@gitlens/ai/models/results.js';
import { getReviewFindingTitle, getReviewFocusAreaLabel } from '../reviewFormat.js';

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

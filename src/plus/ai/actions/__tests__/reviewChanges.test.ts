import * as assert from 'node:assert';
import * as sinon from 'sinon';
import type { AIService } from '../../aiService.js';
import { reviewChanges, reviewFocusArea, reviewOrient, reviewOverview } from '../reviewChanges.js';

// #5781: every review action must ask `sendRequest` to throw AI errors. Without it a terminal failure comes back
// as `undefined`, which the graph maps to `Review was cancelled.` — a failure recorded as a cancel.
suite('review actions — AI failures are thrown, not folded into a cancel', () => {
	const source: Parameters<typeof reviewChanges>[2] = {
		source: 'graph',
		context: { type: 'wip', mode: 'single-pass' },
	};
	const context: Parameters<typeof reviewChanges>[1] = { diff: '', message: '', context: '' };

	const actions: [string, (service: AIService) => unknown][] = [
		['reviewChanges', s => reviewChanges(s, context, source)],
		['reviewOverview', s => reviewOverview(s, { files: '[]', message: '', context: '' }, source)],
		['reviewOrient', s => reviewOrient(s, { files: '[]', message: '', context: '' }, source)],
		[
			'reviewFocusArea',
			s =>
				reviewFocusArea(
					s,
					{ diff: '', overview: '', message: '', focusArea: '', context: '' },
					'area-1',
					source,
				),
		],
	];

	for (const [name, run] of actions) {
		test(`${name} passes throwAIErrors to sendRequest`, async () => {
			const sendRequest = sinon.stub().resolves(undefined);

			await run({ sendRequest: sendRequest } as unknown as AIService);

			sinon.assert.calledOnce(sendRequest);
			const options = sendRequest.firstCall.args[4] as { throwAIErrors?: boolean } | undefined;
			assert.strictEqual(options?.throwAIErrors, true);
		});
	}
});

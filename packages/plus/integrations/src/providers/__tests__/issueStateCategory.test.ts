import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { ProviderIssue } from '../models.js';
import { fromProviderIssue, toIssueShape } from '../models.js';
import { azureIntegration, createProviderIssue, linearIntegration } from './fixtures.js';

/**
 * `CANCELED` is abandoned work (Linear's canceled and duplicate states, Azure's `Removed` category): it ends the issue
 * as `DONE` does, and is kept as its own category so a consumer can tell the two outcomes apart.
 */
function withCategory(category: NonNullable<ProviderIssue['state']>['category']): ProviderIssue {
	return createProviderIssue({ state: { id: '1', name: 'Canceled', color: null, category: category } });
}

suite('issue state categories', () => {
	for (const [name, integration] of [
		['Linear', linearIntegration],
		['Azure DevOps', azureIntegration],
	] as const) {
		test(`${name}: CANCELED closes the issue and keeps its category`, () => {
			const shape = toIssueShape(withCategory('CANCELED'), integration);
			assert.equal(shape?.closed, true);
			assert.equal(shape?.state, 'closed');
			assert.equal(shape?.providerState?.category, 'CANCELED');

			const issue = fromProviderIssue(withCategory('CANCELED'), integration);
			assert.equal(issue.closed, true);
			assert.equal(issue.state, 'closed');
			assert.equal(issue.providerState?.category, 'CANCELED');
		});

		test(`${name}: an open category leaves the issue open`, () => {
			assert.equal(toIssueShape(withCategory('IN_PROGRESS'), integration)?.closed, false);
			assert.equal(fromProviderIssue(withCategory('IN_PROGRESS'), integration).closed, false);
		});
	}
});

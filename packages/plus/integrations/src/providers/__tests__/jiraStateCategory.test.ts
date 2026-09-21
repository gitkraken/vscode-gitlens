import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { toIssueShape } from '../models.js';
import { createProviderIssue, jiraIntegration, jiraServerIntegration, linearIntegration } from './fixtures.js';

/**
 * The Jira state-category gate (#5864). `provider-apis` derives an issue's state category from the LOCALIZED
 * status-category display name and defaults every unrecognized one to `DONE`, so a mapped `DONE` is only
 * trustworthy when the caller mapped Jira's stable status-category key itself and said so. That gate was keyed
 * on the cloud id alone; `jiraHelpers` serves Jira Server through the same mapper, so a self-hosted instance in
 * any non-English locale reported every open issue as closed.
 */
suite('toIssueShape Jira state category (#5864)', () => {
	// `Por hacer` is a To Do category on a Spanish instance; the SDK cannot name-match it, so it arrives DONE.
	const misreadAsDone = createProviderIssue({ state: { id: '1', name: 'Por hacer', color: null, category: 'DONE' } });

	for (const [name, integration] of [
		['Jira Cloud', jiraIntegration],
		['Jira Server', jiraServerIntegration],
	] as const) {
		test(`${name} does not trust an unopted-in DONE category`, () => {
			const issue = toIssueShape(misreadAsDone, integration);
			assert.equal(issue?.closed, false, 'an unreliable DONE must not close the issue');
			assert.equal(issue?.state, 'opened');
		});

		test(`${name} trusts DONE when the caller mapped the stable key`, () => {
			const issue = toIssueShape(misreadAsDone, integration, { reliableStateCategory: true });
			assert.equal(issue?.closed, true);
			assert.equal(issue?.state, 'closed');
		});

		test(`${name} bodies are Jira wiki markup`, () => {
			assert.equal(toIssueShape(createProviderIssue(), integration)?.bodyFormat, 'jira-wiki');
		});
	}

	test('a non-Jira provider keeps trusting its own category', () => {
		// Only Jira routes through the localized-name mapper, so nothing else needs the opt-in.
		const issue = toIssueShape(misreadAsDone, linearIntegration);
		assert.equal(issue?.closed, true);
		assert.equal(issue?.bodyFormat, undefined);
	});
});

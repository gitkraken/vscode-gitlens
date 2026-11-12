import * as assert from 'node:assert/strict';
import type { GitMilestone } from '@gitkraken/provider-apis';
import { suite, test } from 'mocha';
import { fromProviderIssue, toIssueShape } from '../models.js';
import { createProviderIssue, linearIntegration } from './fixtures.js';

/** As provider-apis normalizes a GitHub or GitLab milestone: a per-repository `id` and a host-wide `graphQLId`. */
const hostMilestone: GitMilestone = {
	id: '3',
	graphQLId: 'MI_3',
	number: 3,
	title: 'v1.0',
	description: null,
	isOpen: true,
	url: 'https://github.com/o/r/milestone/3',
	startDate: null,
	dueDate: new Date('2026-12-01T00:00:00Z'),
};

/** As provider-apis normalizes a Linear project milestone: no `graphQLId`, no page, done is closed. */
const linearMilestone: GitMilestone = {
	id: '6f1a2b3c-0000-4000-8000-000000000000',
	number: 1,
	title: 'Beta',
	description: null,
	isOpen: false,
	url: '',
	startDate: null,
	dueDate: null,
};

for (const [name, mapIssue] of [
	['fromProviderIssue', fromProviderIssue],
	['toIssueShape', toIssueShape],
] as const) {
	suite(`${name} milestone`, () => {
		test('keys a host milestone by its GraphQL id, which is unique on the host', () => {
			const issue = mapIssue(createProviderIssue({ milestone: hostMilestone }), linearIntegration);

			assert.deepEqual(issue?.milestone, {
				id: 'MI_3',
				title: 'v1.0',
				state: 'open',
				dueDate: new Date('2026-12-01T00:00:00Z'),
				url: 'https://github.com/o/r/milestone/3',
			});
		});

		test('maps a done Linear project milestone as closed, leaving the absent due date and page off', () => {
			const issue = mapIssue(createProviderIssue({ milestone: linearMilestone }), linearIntegration);

			assert.deepEqual(issue?.milestone, {
				id: '6f1a2b3c-0000-4000-8000-000000000000',
				title: 'Beta',
				state: 'closed',
			});
		});

		test('keeps none (null) apart from a provider that reports no milestone (key absent)', () => {
			const none = mapIssue(createProviderIssue({ milestone: null }), linearIntegration);
			const unreported = mapIssue(createProviderIssue(), linearIntegration);

			assert.ok(none != null && unreported != null);
			assert.equal(none.milestone, null);
			assert.equal(unreported.milestone, undefined);
		});
	});
}

suite('toIssueShape milestone key', () => {
	test("adds no key for a provider that reports no milestone, so the row's keys stay as they were", () => {
		const issue = toIssueShape(createProviderIssue(), linearIntegration);

		assert.ok(issue != null && !('milestone' in issue));
	});
});

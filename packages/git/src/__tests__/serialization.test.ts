import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { IssueShape } from '../models/issue.js';
import type { PullRequest } from '../models/pullRequest.js';
import { PullRequestReviewState } from '../models/pullRequest.js';
import { serializeIssue } from '../utils/issue.utils.js';
import { serializePullRequest } from '../utils/pullRequest.utils.js';

const provider = {
	id: 'github',
	name: 'GitHub',
	domain: 'github.com',
	icon: 'github',
};
const author = { id: 'user-1', name: 'User' };
const now = new Date('2026-07-28T12:00:00.000Z');

suite('provider model serialization', () => {
	test('preserves pull request identity and current-user attribution', () => {
		const pullRequest: PullRequest = {
			type: 'pullrequest',
			provider: provider,
			author: author,
			id: 'pr-1',
			nodeId: 'node-1',
			number: 42,
			title: 'Pull request',
			body: 'Body',
			url: 'https://github.com/gitkraken/vscode-gitlens/pull/42',
			repository: { owner: 'gitkraken', repo: 'vscode-gitlens' },
			state: 'opened',
			createdDate: now,
			updatedDate: now,
			closed: false,
			authoredByMe: true,
			latestReviews: [
				{
					reviewer: { id: 'reviewer-1', name: 'Reviewer' },
					state: PullRequestReviewState.Approved,
					commitOid: 'reviewed-head',
				},
			],
		};

		const serialized = serializePullRequest(pullRequest);

		assert.equal(serialized.number, 42);
		assert.equal(serialized.authoredByMe, true);
		assert.deepEqual(serialized.latestReviews, pullRequest.latestReviews);
	});

	test('preserves an issue provider type', () => {
		const issue = {
			type: 'issue',
			provider: provider,
			author: author,
			assignees: [],
			id: 'issue-1',
			nodeId: 'node-2',
			issueType: 'Bug',
			title: 'Issue',
			body: 'Body',
			bodyFormat: 'jira-wiki',
			providerState: { id: 'state-1', name: 'In Review', color: '#ff0000', category: 'IN_PROGRESS' },
			iterations: [{ id: 'sprint-1', name: 'Sprint 1', isActive: true, startDate: now, endDate: now }],
			url: 'https://github.com/gitkraken/vscode-gitlens/issues/1',
			state: 'opened',
			createdDate: now,
			updatedDate: now,
			closed: false,
		} satisfies IssueShape;

		const serialized = serializeIssue(issue);

		assert.equal(serialized.issueType, 'Bug');
		assert.equal(serialized.bodyFormat, 'jira-wiki');
		assert.deepEqual(serialized.providerState, issue.providerState);
		assert.deepEqual(serialized.iterations, issue.iterations);
	});
});

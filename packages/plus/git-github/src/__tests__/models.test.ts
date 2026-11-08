import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { PullRequestMergeQueueState, PullRequestReviewState } from '@gitlens/git/models/pullRequest.js';
import type { Provider } from '@gitlens/git/models/remoteProvider.js';
import type { GitHubApiConfig } from '../api/config.js';
import { GitHubApi } from '../api/github.js';
import type { GitHubTokenInfo } from '../api/token.js';
import type {
	GitHubIssue,
	GitHubMergeQueueEntryState,
	GitHubMergeQueueEvent,
	GitHubPullRequest,
	GitHubPullRequestLite,
} from '../models.js';
import {
	fromGitHubIssue,
	fromGitHubMergeQueueRemoval,
	fromGitHubPullRequest,
	fromGitHubPullRequestLite,
} from '../models.js';

/**
 * GitHub's GraphQL `Issue.author` is an `Actor` and is nullable — it comes back `null` once the
 * author's account is deleted. Mapping it unguarded threw a `TypeError` that discarded every issue
 * in the response, which surfaced as "No issues found" plus a prompt to connect an integration.
 */

const provider: Provider = {
	id: 'github',
	name: 'GitHub',
	domain: 'github.com',
	icon: 'github',
	getIgnoreSSLErrors: () => false,
	reauthenticate: () => Promise.resolve(),
	trackRequestException: () => {},
};

const token: GitHubTokenInfo = {
	providerId: 'github',
	accessToken: 'token',
	cloud: false,
	type: 'pat',
};

function createIssue(
	number: number,
	author: GitHubIssue['author'],
	milestone: GitHubIssue['milestone'] = null,
): GitHubIssue {
	return {
		id: `issue-${number}`,
		number: number,
		title: `Issue ${number}`,
		url: `https://github.com/gitkraken/vscode-gitlens/issues/${number}`,
		createdAt: '2026-01-01T00:00:00Z',
		updatedAt: '2026-01-02T00:00:00Z',
		closed: false,
		closedAt: null,
		state: 'OPEN',
		author: author,
		assignees: { nodes: [] },
		repository: {
			name: 'vscode-gitlens',
			owner: { login: 'gitkraken' },
			viewerPermission: 'ADMIN',
			url: 'https://github.com/gitkraken/vscode-gitlens',
		},
		milestone: milestone,
		body: '',
	} as unknown as GitHubIssue;
}

const member = { login: 'eamodio', avatarUrl: 'https://avatars/eamodio', url: 'https://github.com/eamodio' };

suite('fromGitHubIssue', () => {
	test('maps a null author to undefined rather than throwing', () => {
		const issue = fromGitHubIssue(createIssue(2701, null), provider);

		assert.equal(issue.author, undefined, 'a deleted account yields no author');
		assert.equal(issue.id, '2701', 'the rest of the issue still maps');
		assert.equal(issue.title, 'Issue 2701');
	});

	test('maps a present author unchanged, carrying the login as the username', () => {
		const issue = fromGitHubIssue(createIssue(1, member), provider);

		assert.deepEqual(issue.author, {
			id: 'eamodio',
			name: 'eamodio',
			username: 'eamodio',
			avatarUrl: 'https://avatars/eamodio',
			url: 'https://github.com/eamodio',
		});
	});
});

/**
 * `stack`/`stackEntry` are only selected against github.com — GitHub Enterprise Server schemas lag and
 * reject the fields — so the mapper sees them absent (Enterprise), `null` (github.com, unstacked), or
 * populated. Only the last case may produce stack info.
 */
function createPullRequestLite(
	stack?: Pick<
		GitHubPullRequestLite,
		'stack' | 'stackEntry' | 'mergeQueueEntry' | 'isMergeQueueEnabled' | 'mergeQueueEvents'
	>,
	milestone: GitHubPullRequestLite['milestone'] = null,
): GitHubPullRequestLite {
	return {
		id: 'pr-5702',
		number: 5702,
		title: 'Route stacked merges through merge-async',
		url: 'https://github.com/gitkraken/vscode-gitlens/pull/5702',
		permalink: 'https://github.com/gitkraken/vscode-gitlens/pull/5702',
		createdAt: '2026-07-30T00:00:00Z',
		updatedAt: '2026-07-30T01:00:00Z',
		closed: false,
		closedAt: null,
		mergedAt: null,
		state: 'OPEN',
		isDraft: false,
		isCrossRepository: false,
		author: member,
		body: null,
		baseRefName: 'feature/stacks-model',
		baseRefOid: 'b21f904',
		headRefName: 'feature/stacks-merge',
		headRefOid: '7d5bdd3',
		headRepository: {
			isFork: false,
			name: 'vscode-gitlens',
			owner: { login: 'gitkraken' },
			sshUrl: 'git@github.com:gitkraken/vscode-gitlens.git',
			url: 'https://github.com/gitkraken/vscode-gitlens',
		},
		repository: {
			isFork: false,
			name: 'vscode-gitlens',
			owner: { login: 'gitkraken' },
			sshUrl: 'git@github.com:gitkraken/vscode-gitlens.git',
			url: 'https://github.com/gitkraken/vscode-gitlens',
			viewerPermission: 'ADMIN',
		},
		milestone: milestone,
		...stack,
	};
}

suite('fromGitHubPullRequestLite stack mapping', () => {
	test('maps a stacked pull request to its layer', () => {
		const pr = fromGitHubPullRequestLite(
			createPullRequestLite({
				stack: { id: 'stack-7', number: 7, size: 3, baseRefName: 'main' },
				stackEntry: { position: 2 },
			}),
			provider,
		);

		assert.deepEqual(pr.stack, { id: 'stack-7', number: 7, size: 3, position: 2, baseRef: 'main' });
	});

	test('keeps the stack base distinct from the pull request base', () => {
		const pr = fromGitHubPullRequestLite(
			createPullRequestLite({
				stack: { id: 'stack-7', number: 7, size: 3, baseRefName: 'main' },
				stackEntry: { position: 2 },
			}),
			provider,
		);

		// `refs.base` is the layer below (what this layer diffs against); `stack.baseRef` is the trunk.
		assert.equal(pr.refs?.base.branch, 'feature/stacks-model');
		assert.equal(pr.stack?.baseRef, 'main');
	});

	test('leaves an unstacked pull request without stack info', () => {
		const pr = fromGitHubPullRequestLite(createPullRequestLite({ stack: null, stackEntry: null }), provider);

		assert.equal(pr.stack, undefined);
	});

	test('leaves stack info off when the fields were never selected (Enterprise)', () => {
		const pr = fromGitHubPullRequestLite(createPullRequestLite(), provider);

		assert.equal(pr.stack, undefined);
	});

	test('requires both halves — a stack without an entry has no position to report', () => {
		const pr = fromGitHubPullRequestLite(
			createPullRequestLite({
				stack: { id: 'stack-7', number: 7, size: 3, baseRefName: 'main' },
				stackEntry: null,
			}),
			provider,
		);

		assert.equal(pr.stack, undefined);
	});
});

function createFullPullRequest(
	latestReviews: GitHubPullRequest['latestReviews']['nodes'],
	viewerLatestReview: GitHubPullRequest['viewerLatestReview'],
	milestone: GitHubPullRequest['milestone'] = null,
): GitHubPullRequest {
	const repository = {
		isFork: false,
		name: 'vscode-gitlens',
		owner: { login: 'gitkraken' },
		sshUrl: 'git@github.com:gitkraken/vscode-gitlens.git',
		url: 'https://github.com/gitkraken/vscode-gitlens',
	};

	return {
		id: 'pr-1',
		number: 1,
		title: 'PR 1',
		url: 'https://github.com/gitkraken/vscode-gitlens/pull/1',
		permalink: 'https://github.com/gitkraken/vscode-gitlens/pull/1',
		state: 'OPEN',
		createdAt: '2026-01-01T00:00:00Z',
		updatedAt: '2026-01-02T00:00:00Z',
		closed: false,
		closedAt: null,
		mergedAt: null,
		author: member,
		body: null,
		baseRefName: 'main',
		baseRefOid: 'base-sha',
		headRefName: 'feature',
		headRefOid: 'head-sha',
		headRepository: repository,
		repository: { ...repository, viewerPermission: 'WRITE' },
		isCrossRepository: false,
		isDraft: false,
		additions: 1,
		deletions: 0,
		changedFiles: 1,
		assignees: { nodes: [] },
		checksUrl: 'https://github.com/gitkraken/vscode-gitlens/pull/1/checks',
		mergeable: 'MERGEABLE',
		reviewDecision: 'REVIEW_REQUIRED',
		latestReviews: { nodes: latestReviews },
		viewerLatestReview: viewerLatestReview,
		reviewRequests: { nodes: [] },
		commits: { totalCount: 0, nodes: [] },
		totalCommentsCount: 0,
		viewerCanUpdate: true,
		milestone: milestone,
	};
}

/**
 * `mergeQueueEntry` is selected only against github.com, like the stack fields, and only for a host that opts in, so
 * the mapper sees it absent (Enterprise, or no opt-in), `null` (not queued), or populated. Only the last may produce a
 * queue entry.
 */
suite('fromGitHubPullRequestLite merge queue mapping', () => {
	const queued = {
		state: 'AWAITING_CHECKS' as GitHubMergeQueueEntryState,
		enqueuedAt: '2026-07-30T02:00:00Z',
		estimatedTimeToMerge: 900,
		mergeQueue: { url: 'https://github.com/gitkraken/vscode-gitlens/queue/main' },
		position: 2,
	};

	test('maps a queued pull request to its entry', () => {
		const before = Date.now();
		const pr = fromGitHubPullRequestLite(createPullRequestLite({ mergeQueueEntry: queued }), provider);
		const after = Date.now();

		// GitHub's estimate is seconds from now, fixed to a date at read time so a held entry counts down.
		const estimatedMergeAt = pr.mergeQueue?.estimatedMergeAt?.getTime();
		assert.ok(
			estimatedMergeAt != null && estimatedMergeAt >= before + 900_000 && estimatedMergeAt <= after + 900_000,
			`expected an estimate 900s after the read, got ${estimatedMergeAt}`,
		);
		assert.deepEqual(pr.mergeQueue, {
			state: PullRequestMergeQueueState.AwaitingChecks,
			enqueuedAt: new Date('2026-07-30T02:00:00Z'),
			estimatedMergeAt: new Date(estimatedMergeAt),
			url: 'https://github.com/gitkraken/vscode-gitlens/queue/main',
			position: 2,
		});
		// Queue membership is extra data, never a state of its own.
		assert.equal(pr.state, 'opened');
	});

	test('leaves a pull request that is not queued without an entry', () => {
		const pr = fromGitHubPullRequestLite(createPullRequestLite({ mergeQueueEntry: null }), provider);

		assert.equal(pr.mergeQueue, undefined);
	});

	test('leaves the entry off when the field was never selected (Enterprise)', () => {
		const pr = fromGitHubPullRequestLite(createPullRequestLite(), provider);

		assert.equal(pr.mergeQueue, undefined);
	});

	test('reports no estimate when GitHub has none, rather than zero', () => {
		const pr = fromGitHubPullRequestLite(
			createPullRequestLite({ mergeQueueEntry: { ...queued, estimatedTimeToMerge: null } }),
			provider,
		);

		assert.notEqual(pr.mergeQueue, undefined);
		assert.equal(pr.mergeQueue?.estimatedMergeAt, undefined);
	});

	test('keeps a pull request in a state GitHub adds later in the queue, as Queued', () => {
		const pr = fromGitHubPullRequestLite(
			createPullRequestLite({
				mergeQueueEntry: { ...queued, state: 'SOMETHING_NEW' as GitHubMergeQueueEntryState },
			}),
			provider,
		);

		assert.equal(pr.mergeQueue?.state, PullRequestMergeQueueState.Queued);
	});

	test('reports no position when GitHub gives none', () => {
		const pr = fromGitHubPullRequestLite(
			createPullRequestLite({ mergeQueueEntry: { ...queued, position: null } }),
			provider,
		);

		assert.notEqual(pr.mergeQueue, undefined);
		assert.equal(pr.mergeQueue?.position, undefined);
	});

	test('maps whether the base branch requires a merge queue, and leaves it unread when never selected', () => {
		const required = fromGitHubPullRequestLite(createPullRequestLite({ isMergeQueueEnabled: true }), provider);
		const notRequired = fromGitHubPullRequestLite(createPullRequestLite({ isMergeQueueEnabled: false }), provider);
		const enterprise = fromGitHubPullRequestLite(createPullRequestLite(), provider);

		assert.equal(required.mergeQueueRequired, true);
		// `false` is a read answer, not a missing one.
		assert.equal(notRequired.mergeQueueRequired, false);
		assert.equal(enterprise.mergeQueueRequired, undefined);
	});
});

/**
 * The latest merge-queue event decides the removal: only a removal that is the latest event (no rejoin since) and
 * didn't merge the pull request is one.
 */
suite('fromGitHubMergeQueueRemoval', () => {
	function removed(reason: string | null, createdAt = '2026-07-30T03:00:00Z'): GitHubMergeQueueEvent {
		return {
			__typename: 'RemovedFromMergeQueueEvent',
			createdAt: createdAt,
			reason: reason,
		};
	}

	test("maps a latest removal, keeping GitHub's raw reason", () => {
		const pr = fromGitHubPullRequestLite(
			createPullRequestLite({
				mergeQueueEntry: null,
				mergeQueueEvents: { nodes: [removed('failed_checks')] },
			}),
			provider,
		);

		assert.deepEqual(pr.mergeQueueRemoval, {
			reason: 'failed_checks',
			removedAt: new Date('2026-07-30T03:00:00Z'),
		});
	});

	test('passes an unrecognized reason through, and a missing one as empty', () => {
		assert.equal(fromGitHubMergeQueueRemoval({ nodes: [removed('something_new')] })?.reason, 'something_new');
		assert.equal(fromGitHubMergeQueueRemoval({ nodes: [removed(null)] })?.reason, '');
	});

	test('a removal that merged the pull request is no removal', () => {
		assert.equal(fromGitHubMergeQueueRemoval({ nodes: [removed('merged')] }), undefined);
		assert.equal(fromGitHubMergeQueueRemoval({ nodes: [removed('MERGED')] }), undefined);
	});

	test('a later rejoin clears the removal', () => {
		assert.equal(
			fromGitHubMergeQueueRemoval({
				nodes: [{ __typename: 'AddedToMergeQueueEvent' }],
			}),
			undefined,
		);
	});

	test('only the latest event counts', () => {
		assert.equal(
			fromGitHubMergeQueueRemoval({
				nodes: [removed('failed_checks'), { __typename: 'AddedToMergeQueueEvent' }],
			}),
			undefined,
		);
		assert.equal(
			fromGitHubMergeQueueRemoval({
				nodes: [{ __typename: 'AddedToMergeQueueEvent' }, removed('manual')],
			})?.reason,
			'manual',
		);
	});

	test('no events, or none selected (Enterprise), is no removal', () => {
		assert.equal(fromGitHubMergeQueueRemoval({ nodes: [] }), undefined);
		assert.equal(fromGitHubMergeQueueRemoval({ nodes: null }), undefined);
		assert.equal(fromGitHubMergeQueueRemoval(null), undefined);
		assert.equal(fromGitHubMergeQueueRemoval(undefined), undefined);
		assert.equal(fromGitHubPullRequestLite(createPullRequestLite(), provider).mergeQueueRemoval, undefined);
	});
});

/**
 * `latestReviews` is capped at 25 and `viewerLatestReview` is the escape hatch for the row a "needs my review"
 * surface is actually asking about, so the union of the two is the delicate part of the full projection: it can
 * lose the viewer's review, duplicate it, or invent one that was never submitted.
 */
suite('fromGitHubPullRequest review projection', () => {
	const otherReview = {
		id: 'review-other',
		author: { login: 'octo', avatarUrl: '', url: 'https://github.com/octo' },
		state: 'COMMENTED' as const,
		commit: { oid: 'other-sha' },
	};

	test('appends the viewer review when it falls outside the capped window, with its commit oid', () => {
		const pr = fromGitHubPullRequest(
			createFullPullRequest([otherReview], {
				id: 'review-viewer',
				author: member,
				state: 'APPROVED',
				commit: { oid: 'viewer-sha' },
			}),
			provider,
		);

		assert.equal(pr.latestReviews?.length, 2);
		const viewer = pr.latestReviews?.find(r => r.reviewer.name === 'eamodio');
		assert.equal(viewer?.state, PullRequestReviewState.Approved);
		assert.equal(viewer?.commitOid, 'viewer-sha', 'the oid the review was submitted against survives');
	});

	test('does not duplicate the viewer review when it is already inside the window', () => {
		const viewerReview = {
			id: 'review-viewer',
			author: member,
			state: 'CHANGES_REQUESTED' as const,
			commit: { oid: 'viewer-sha' },
		};

		const pr = fromGitHubPullRequest(createFullPullRequest([otherReview, viewerReview], viewerReview), provider);

		assert.equal(pr.latestReviews?.length, 2, 'the same review id must not appear twice');
		assert.equal(
			pr.latestReviews?.filter(r => r.reviewer.name === 'eamodio').length,
			1,
			'one row per reviewer, not one per selection it arrived in',
		);
	});

	test('drops an unsubmitted viewer draft rather than reporting it as a submitted review', () => {
		// GitHub exposes a PENDING (unsubmitted) review only to its own author, and only through
		// `viewerLatestReview` — appending it would tell a "needs my review" consumer the review is done.
		const pr = fromGitHubPullRequest(
			createFullPullRequest([otherReview], {
				id: 'review-draft',
				author: member,
				state: 'PENDING',
				commit: { oid: 'draft-sha' },
			}),
			provider,
		);

		assert.equal(pr.latestReviews?.length, 1);
		assert.equal(pr.latestReviews?.[0]?.reviewer.name, 'octo');
	});

	test('keeps a submitted viewer review that supersedes nothing when the window is empty', () => {
		const pr = fromGitHubPullRequest(
			createFullPullRequest([], { id: 'review-viewer', author: member, state: 'APPROVED', commit: null }),
			provider,
		);

		assert.equal(pr.latestReviews?.length, 1);
		assert.equal(pr.latestReviews?.[0]?.commitOid, undefined, 'a review without a commit maps to no oid');
	});
});

/**
 * A milestone comes back `null` when the item has none, which must stay apart from `undefined` (a selection that left
 * it out), so a consumer can tell "no milestone" from "not read".
 */
suite('GitHub milestone mapping', () => {
	const open = {
		id: 'MI_open',
		title: 'v1.0',
		state: 'OPEN',
		dueOn: '2026-12-01T00:00:00Z',
		url: 'https://github.com/gitkraken/vscode-gitlens/milestone/1',
	} as const;
	const closed = {
		id: 'MI_closed',
		title: 'v0.9',
		state: 'CLOSED',
		dueOn: null,
		url: 'https://github.com/gitkraken/vscode-gitlens/milestone/2',
	} as const;

	test('maps an open milestone with a due date on every projection', () => {
		const expected = {
			id: 'MI_open',
			title: 'v1.0',
			state: 'open',
			dueDate: new Date('2026-12-01T00:00:00Z'),
			url: 'https://github.com/gitkraken/vscode-gitlens/milestone/1',
		};

		assert.deepEqual(fromGitHubIssue(createIssue(1, member, open), provider).milestone, expected);
		assert.deepEqual(
			fromGitHubPullRequestLite(createPullRequestLite(undefined, open), provider).milestone,
			expected,
		);
		assert.deepEqual(fromGitHubPullRequest(createFullPullRequest([], null, open), provider).milestone, expected);
	});

	test('maps a closed milestone and leaves an unset due date off', () => {
		const milestone = fromGitHubIssue(createIssue(1, member, closed), provider).milestone;

		assert.deepEqual(milestone, {
			id: 'MI_closed',
			title: 'v0.9',
			state: 'closed',
			url: 'https://github.com/gitkraken/vscode-gitlens/milestone/2',
		});
		assert.ok(milestone != null && !('dueDate' in milestone));
	});

	test('keeps none as null', () => {
		assert.equal(fromGitHubIssue(createIssue(1, member, null), provider).milestone, null);
		assert.equal(fromGitHubPullRequestLite(createPullRequestLite(undefined, null), provider).milestone, null);
		assert.equal(fromGitHubPullRequest(createFullPullRequest([], null, null), provider).milestone, null);
	});

	test('leaves a milestone the selection left out undefined', () => {
		const { milestone: _, ...unselected } = createPullRequestLite();

		assert.equal(fromGitHubPullRequestLite(unselected as GitHubPullRequestLite, provider).milestone, undefined);
	});
});

suite('GitHubApi.searchMyIssues', () => {
	const config: GitHubApiConfig = {
		isWeb: false,
		fetch: () => Promise.reject(new Error('no network in tests')),
		wrapForForcedInsecureSSL: (_ignoreSSLErrors, fn) => fn(),
	};

	/** Stubs the private `graphql` so the search maps a canned response without any network access */
	function createApi(response: unknown): GitHubApi {
		const api = new GitHubApi(config);
		(api as unknown as { graphql: () => Promise<unknown> }).graphql = () => Promise.resolve(response);
		return api;
	}

	test('keeps the other issues when one node is unmappable', async () => {
		const api = createApi({
			authored: { nodes: [createIssue(1, member)] },
			assigned: { nodes: [createIssue(2, member)] },
			// A node that blows up in the mapper must not take the batch down with it
			mentioned: { nodes: [{ id: 'issue-3', number: 3, url: 'https://github.com/o/r/issues/3' }] },
		});

		const issues = await api.searchMyIssues(provider, token);

		assert.deepEqual(
			issues?.values.map(i => i.id),
			['2', '1'],
			'the unmappable node is skipped, the rest survive',
		);

		api.dispose();
	});

	test('maps a ghost-authored issue instead of discarding the batch', async () => {
		const api = createApi({
			authored: { nodes: [createIssue(1, member)] },
			assigned: { nodes: [] },
			mentioned: { nodes: [createIssue(2701, null)] },
		});

		const issues = await api.searchMyIssues(provider, token);

		assert.deepEqual(
			issues?.values.map(i => i.id),
			['2701', '1'],
			'a null author no longer discards every issue in the response',
		);
		assert.equal(issues?.values.find(i => i.id === '2701')?.author, undefined);

		api.dispose();
	});

	test('tolerates a nulled alias and null nodes', async () => {
		const api = createApi({
			authored: null,
			assigned: { nodes: null },
			mentioned: { nodes: [null, createIssue(1, member)] },
		});

		const issues = await api.searchMyIssues(provider, token);

		assert.deepEqual(
			issues?.values.map(i => i.id),
			['1'],
		);

		api.dispose();
	});
});

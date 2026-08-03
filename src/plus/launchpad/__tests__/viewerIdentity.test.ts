import * as assert from 'assert';
import type { Account } from '@gitlens/git/models/author.js';
import type { PullRequestMember } from '@gitlens/git/models/pullRequest.js';
import { PullRequest, PullRequestReviewState } from '@gitlens/git/models/pullRequest.js';
import type { ProviderReference } from '@gitlens/git/models/remoteProvider.js';
import {
	getActionablePullRequests,
	toProviderPullRequestWithUniqueId,
} from '@gitlens/integrations/providers/models.js';
import { canonicalizeViewerIdentity } from '../launchpadProvider.js';

/**
 * The shared categorizer matches the viewer to a pull request's people by `id` alone, so every
 * viewer-relative category depends on the account and the pull request agreeing on an id namespace.
 * They don't on GitHub — the account carries the numeric database id every other provider's account
 * carries, while provider-native pull requests key people by login — and `canonicalizeViewerIdentity`
 * is what bridges that. These pin both shapes so a change to either side has to fail here rather than
 * silently collapse every GitHub pull request into "Other".
 */

const githubProvider: ProviderReference = { id: 'github', name: 'GitHub', domain: 'github.com', icon: 'github' };

function createPullRequest(author: PullRequestMember, reviewer: PullRequestMember): PullRequest {
	return new PullRequest(
		githubProvider,
		author,
		'1',
		'PR_kwNode1',
		'A pull request',
		'https://github.com/owner/repo/pull/1',
		{ owner: 'owner', repo: 'repo' },
		'opened',
		new Date(0),
		new Date(0),
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		false,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		[{ isCodeOwner: false, reviewer: reviewer, state: PullRequestReviewState.ReviewRequested }],
	);
}

function createAccount(id: string, username: string): Account {
	return {
		provider: githubProvider,
		id: id,
		username: username,
		name: undefined,
		email: undefined,
		avatarUrl: undefined,
	};
}

function categorize(pr: PullRequest, account: Account, canonicalize: boolean) {
	const providerPr = toProviderPullRequestWithUniqueId(pr);
	const input = canonicalize ? canonicalizeViewerIdentity(providerPr, pr, account) : providerPr;
	return getActionablePullRequests([input], { id: account.id })[0];
}

suite('Launchpad viewer identity matching', () => {
	test('resolves the viewer on provider-native pull requests, whose people are keyed by login', () => {
		// What `fromGitHubMemberOrGhost` produces: id and username are both the login.
		const viewer: PullRequestMember = { id: 'eamodio', name: 'eamodio', username: 'eamodio' };
		const other: PullRequestMember = { id: 'someone', name: 'someone', username: 'someone' };
		const pr = createPullRequest(other, viewer);
		// What `getCurrentAccount` produces: the provider's own id, plus the login as the handle.
		const account = createAccount('123456', 'eamodio');

		const item = categorize(pr, account, true);
		assert.strictEqual(item.viewer.isReviewer, true);
		assert.strictEqual(item.suggestedActionCategory, 'needsMyReview');

		// Without the canonicalization the login and the database id never meet, and the row falls to `other`
		const uncanonicalized = categorize(pr, account, false);
		assert.strictEqual(uncanonicalized.viewer.isReviewer, false);
	});

	test('resolves the viewer on providers-api pull requests, whose people are keyed by provider id', () => {
		// What `fromProviderAccount` produces: the provider's own id, with the login as the handle.
		const viewer: PullRequestMember = { id: '123456', name: 'Eric Amodio', username: 'eamodio' };
		const other: PullRequestMember = { id: '654321', name: 'Someone', username: 'someone' };
		const pr = createPullRequest(other, viewer);
		const account = createAccount('123456', 'eamodio');

		// Already agrees, so canonicalizing is a no-op — assert it stays one
		for (const canonicalize of [true, false]) {
			const item = categorize(pr, account, canonicalize);
			assert.strictEqual(item.viewer.isReviewer, true, `canonicalize: ${canonicalize}`);
			assert.strictEqual(item.suggestedActionCategory, 'needsMyReview', `canonicalize: ${canonicalize}`);
		}
	});

	test('leaves ids alone when the account handle names nobody, as on Azure DevOps', () => {
		// Azure's account `username` is a display name while its members carry a UPN, so nothing matches on
		// the handle and the id — which already agrees — has to keep carrying the match.
		const viewer: PullRequestMember = { id: 'guid-viewer', name: 'Eric Amodio', username: 'eamodio@example.com' };
		const other: PullRequestMember = { id: 'guid-other', name: 'Someone', username: 'someone@example.com' };
		const pr = createPullRequest(other, viewer);
		const account = createAccount('guid-viewer', 'Eric Amodio');

		const providerPr = toProviderPullRequestWithUniqueId(pr);
		assert.strictEqual(
			canonicalizeViewerIdentity(providerPr, pr, account),
			providerPr,
			'no handle match must return the input untouched',
		);

		const item = categorize(pr, account, true);
		assert.strictEqual(item.viewer.isReviewer, true);
		assert.strictEqual(item.suggestedActionCategory, 'needsMyReview');
	});

	test('rewrites only the viewer, never anyone else', () => {
		const viewer: PullRequestMember = { id: 'eamodio', name: 'eamodio', username: 'eamodio' };
		const other: PullRequestMember = { id: 'someone', name: 'someone', username: 'someone' };
		const pr = createPullRequest(other, viewer);
		const account = createAccount('123456', 'eamodio');

		const canonicalized = canonicalizeViewerIdentity(toProviderPullRequestWithUniqueId(pr), pr, account);
		assert.strictEqual(canonicalized.author?.id, 'someone');
		assert.strictEqual(canonicalized.reviews?.[0].reviewer.id, '123456');
	});
});

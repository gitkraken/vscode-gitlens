import * as assert from 'node:assert/strict';
import type { GitBuildStatus } from '@gitkraken/provider-apis';
import {
	GitBuildStatusState,
	GitPullRequestMergeableState,
	GitPullRequestReviewState,
	GitPullRequestState,
} from '@gitkraken/provider-apis';
import { suite, test } from 'mocha';
import type { GitHubPullRequest } from '@gitlens/git-github/models.js';
import { fromGitHubPullRequest } from '@gitlens/git-github/models.js';
import { RepositoryAccessLevel } from '@gitlens/git/models/issue.js';
import {
	PullRequest,
	PullRequestMergeableState,
	PullRequestReviewDecision,
	PullRequestReviewState,
	PullRequestStatusCheckRollupState,
} from '@gitlens/git/models/pullRequest.js';
import type { Provider } from '@gitlens/git/models/remoteProvider.js';
import type { GitHubPullRequestFixtureOverrides } from '../../__tests__/githubFixtures.js';
import { gitHubPullRequest } from '../../__tests__/githubFixtures.js';
import { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '../../constants.js';
import type { ProviderPullRequest } from '../models.js';
import {
	fromProviderPullRequest,
	getProviderPullRequestIdentity,
	stampNativePullRequest,
	toProviderPullRequest,
	toProviderPullRequestWithUniqueId,
	toPullRequestRow,
} from '../models.js';
import { providerPullRequestReviewStateDismissed, toProviderReviews } from '../pullRequestReviews.js';

/**
 * Covers the clone-URL / fork / cross-repository plumbing added for read-API parity (#5435): the SDK's
 * remoteInfo + isCrossRepository + headRepository.isFork must flow onto PullRequestRefs, and the reverse
 * mapping must reconstruct remoteInfo from the ref clone URLs so round-trips (e.g. Launchpad) don't lose them.
 */
const fakeProvider = {
	id: 'github',
	name: 'GitHub',
	domain: 'github.com',
	icon: 'github',
} as unknown as Provider;

function createProviderPullRequest(overrides?: Partial<ProviderPullRequest>): ProviderPullRequest {
	return {
		id: '1',
		number: 1,
		title: 'PR',
		description: null,
		url: 'https://github.com/base/repo/pull/1',
		state: GitPullRequestState.Open,
		isDraft: false,
		createdDate: new Date(0),
		updatedDate: new Date(0),
		closedDate: null,
		mergedDate: null,
		baseRef: { name: 'main', oid: 'base-sha' },
		headRef: { name: 'feature', oid: 'head-sha' },
		commentCount: null,
		upvoteCount: null,
		commitCount: null,
		fileCount: null,
		additions: null,
		deletions: null,
		author: null,
		assignees: null,
		reviews: null,
		reviewDecision: null,
		isCrossRepository: true,
		repository: {
			id: 'base-id',
			name: 'repo',
			owner: { login: 'base' },
			remoteInfo: {
				cloneUrlHTTPS: 'https://github.com/base/repo.git',
				cloneUrlSSH: 'git@github.com:base/repo.git',
			},
		},
		headRepository: {
			id: 'head-id',
			name: 'repo',
			owner: { login: 'fork' },
			remoteInfo: {
				cloneUrlHTTPS: 'https://github.com/fork/repo.git',
				cloneUrlSSH: 'git@github.com:fork/repo.git',
			},
			isFork: true,
		},
		headCommit: null,
		mergeableState: GitPullRequestMergeableState.Unknown,
		permissions: null,
		...overrides,
	};
}

suite('pull request ref mapping (#5435 clone URLs + fork)', () => {
	test('fromProviderPullRequest maps clone URLs, isFork, and isCrossRepository onto refs', () => {
		const pr = fromProviderPullRequest(createProviderPullRequest(), fakeProvider);

		assert.equal(pr.refs?.isCrossRepository, true, 'isCrossRepository comes from the SDK field');
		assert.equal(pr.refs?.base.cloneHttps, 'https://github.com/base/repo.git');
		assert.equal(pr.refs?.base.cloneSsh, 'git@github.com:base/repo.git');
		assert.equal(pr.refs?.head.cloneHttps, 'https://github.com/fork/repo.git');
		assert.equal(pr.refs?.head.cloneSsh, 'git@github.com:fork/repo.git');
		assert.equal(pr.refs?.head.isFork, true, 'head fork flag propagates');
	});

	test('toProviderPullRequest reconstructs remoteInfo and cross-repo flag from the refs', () => {
		const roundTrip = toProviderPullRequest(fromProviderPullRequest(createProviderPullRequest(), fakeProvider));

		assert.equal(roundTrip.isCrossRepository, true, 'cross-repo flag preserved on the reverse mapping');
		assert.deepEqual(roundTrip.repository.remoteInfo, {
			cloneUrlHTTPS: 'https://github.com/base/repo.git',
			cloneUrlSSH: 'git@github.com:base/repo.git',
		});
		assert.equal(roundTrip.repository.id, 'base-id', 'the provider repository id survives normalization');
		assert.deepEqual(roundTrip.headRepository?.remoteInfo, {
			cloneUrlHTTPS: 'https://github.com/fork/repo.git',
			cloneUrlSSH: 'git@github.com:fork/repo.git',
		});
		assert.equal(roundTrip.headRepository?.isFork, true);
	});

	test('a pull request whose head repository was deleted converts to no head repository, not a blank one', () => {
		const pr = fromGitHubPullRequest(gitHubPullRequestNode({ headRepository: null }), fakeProvider);

		assert.equal(pr.refs?.head.exists, false);
		assert.equal(pr.refs?.head.owner, undefined);
		assert.equal(pr.refs?.head.repo, undefined);
		assert.equal(toProviderPullRequest(pr).headRepository, null);
		assert.equal(
			toProviderPullRequest(
				fromProviderPullRequest(createProviderPullRequest({ headRepository: null }), fakeProvider),
			).headRepository,
			null,
			"provider-apis' rows fill the missing owner and name with '', which reads the same",
		);
	});

	test('same-name repositories in different owners retain distinct pull request identities', () => {
		const first = toProviderPullRequest(
			fromProviderPullRequest(
				createProviderPullRequest({
					id: 'same-pr-id',
					url: '',
					repository: {
						id: '',
						name: 'repo',
						owner: { login: 'first-owner' },
						remoteInfo: null,
					},
				}),
				fakeProvider,
			),
		);
		const second = toProviderPullRequest(
			fromProviderPullRequest(
				createProviderPullRequest({
					id: 'same-pr-id',
					url: '',
					repository: {
						id: '',
						name: 'repo',
						owner: { login: 'second-owner' },
						remoteInfo: null,
					},
				}),
				fakeProvider,
			),
		);

		assert.notEqual(getProviderPullRequestIdentity(first), getProviderPullRequestIdentity(second));
	});

	test('description round-trips through the normalized PullRequest body', () => {
		const roundTrip = toProviderPullRequest(
			fromProviderPullRequest(createProviderPullRequest({ description: 'PR body' }), fakeProvider),
		);

		assert.equal(roundTrip.description, 'PR body');
	});

	test('number and current-account authorship survive normalization', () => {
		const pr = fromProviderPullRequest(
			createProviderPullRequest({
				id: 'provider-global-id',
				number: 42,
				author: {
					id: 'me',
					name: 'Me',
					email: null,
					username: 'me',
					avatarUrl: null,
					url: null,
				},
			}),
			fakeProvider,
			{ currentAccount: { id: 'me' } },
		);

		assert.equal(pr.number, 42, 'the provider-visible PR number is not derived from its opaque id');
		assert.equal(pr.authoredByMe, true, 'authorship is resolved against the selected provider account');
		assert.equal(toProviderPullRequest(pr).number, 42, 'the provider-visible number survives a round-trip');
	});

	test('a GitHub row from our own client is mine when the login matches, even though the ids never can', () => {
		// GitLens' own GitHub GraphQL client keys `author.id` by login, while `currentAccount.id` is GitHub's
		// numeric database id — the two namespaces never intersect, so only the username fallback can resolve
		// authorship on this path.
		const pr = fromProviderPullRequest(
			createProviderPullRequest({
				author: {
					id: 'eamodio',
					name: 'Eric Amodio',
					email: null,
					username: 'eamodio',
					avatarUrl: null,
					url: null,
				},
			}),
			fakeProvider,
			{ currentAccount: { id: '641685', username: 'eamodio' } },
		);

		assert.equal(pr.authoredByMe, true);
		assert.deepEqual(
			pr.viewer,
			{ id: '641685', username: 'eamodio' },
			'the identity authorship was matched against',
		);
	});

	test('a row mapped without the current account has neither authorship nor a viewer', () => {
		const pr = fromProviderPullRequest(createProviderPullRequest({}), fakeProvider);

		assert.equal(pr.authoredByMe, undefined);
		assert.equal(pr.viewer, undefined);
	});

	test('a GitHub row from our own client authored by someone else is not mine', () => {
		const pr = fromProviderPullRequest(
			createProviderPullRequest({
				author: {
					id: 'octocat',
					name: 'The Octocat',
					email: null,
					username: 'octocat',
					avatarUrl: null,
					url: null,
				},
			}),
			fakeProvider,
			{ currentAccount: { id: '641685', username: 'eamodio' } },
		);

		assert.equal(pr.authoredByMe, false);
	});

	test('a provider-apis-shaped GitHub row still matches by id alone', () => {
		// provider-apis' own reads key a row's author by the same numeric database id as the account, so an
		// id match is all this path ever needs — the login fallback must not be required for it to work.
		const pr = fromProviderPullRequest(
			createProviderPullRequest({
				author: {
					id: '641685',
					name: 'Eric Amodio',
					email: null,
					username: 'eamodio',
					avatarUrl: null,
					url: null,
				},
			}),
			fakeProvider,
			{ currentAccount: { id: '641685', username: 'eamodio' } },
		);

		assert.equal(pr.authoredByMe, true);
	});

	test('an Azure DevOps row with a different id but the same username as the account is not mine', () => {
		// `toProviderAccount` fills `username` with a display name outside GitHub, and two Azure DevOps
		// members can share one — the username fallback must stay GitHub-only.
		const azureProvider = {
			id: 'azureDevOps',
			name: 'Azure DevOps',
			domain: 'dev.azure.com',
			icon: 'azure-devops',
		} as unknown as Provider;
		const pr = fromProviderPullRequest(
			createProviderPullRequest({
				author: {
					id: 'other-person',
					name: 'Eric Amodio',
					email: null,
					username: 'Eric Amodio',
					avatarUrl: null,
					url: null,
				},
			}),
			azureProvider,
			{ currentAccount: { id: 'me', username: 'Eric Amodio' } },
		);

		assert.equal(pr.authoredByMe, false);
	});

	test('remoteInfo is left null when a ref carries only a partial clone URL pair', () => {
		const roundTrip = toProviderPullRequest(
			fromProviderPullRequest(
				createProviderPullRequest({
					repository: {
						id: 'base-id',
						name: 'repo',
						owner: { login: 'base' },
						// Only HTTPS present: the reverse mapping must not fabricate an SSH URL.
						remoteInfo: { cloneUrlHTTPS: 'https://github.com/base/repo.git', cloneUrlSSH: '' },
					},
				}),
				fakeProvider,
			),
		);

		assert.equal(roundTrip.repository.remoteInfo, null, 'partial clone info does not produce a remoteInfo');
	});

	test('fromProviderPullRequest tolerates a missing repository payload', () => {
		const providerPr = { ...createProviderPullRequest(), repository: undefined } as unknown as ProviderPullRequest;

		const pr = fromProviderPullRequest(providerPr, fakeProvider);

		assert.equal(pr.repository.owner, '');
		assert.equal(pr.repository.repo, '');
		assert.equal(pr.repository.id, undefined);
		assert.equal(pr.refs?.base.owner, '');
		assert.equal(pr.refs?.base.repo, '');
	});

	test("reads provider-apis' blank repository id as unknown, and hands the SDK its blank one back", () => {
		const blank = fromProviderPullRequest(
			createProviderPullRequest({
				repository: { id: '', name: 'repo', owner: { login: 'base' }, remoteInfo: null },
			}),
			fakeProvider,
		);
		assert.equal(blank.repository.id, undefined, "provider-apis' '' means it doesn't know the id");
		assert.equal(fromProviderPullRequest(createProviderPullRequest(), fakeProvider).repository.id, 'base-id');

		// The SDK's shape requires a string, so the boundary keeps sending `''` for an unknown id.
		assert.equal(toProviderPullRequest(blank).repository.id, '');
	});
});

/**
 * The shared categorizer matches the viewer to a pull request's people by `id` alone, so `toProviderAccount`
 * has to keep emitting the provider's own id — every provider but GitHub keys its account and its pull
 * request people in that one namespace. Azure rules out re-keying to the login: its account's `username` is
 * a display name where its members' is a UPN, so a login-keyed viewer would never match there. `username`
 * stays the display name because Launchpad renders it directly as `@…`.
 */
suite('pull request people keep the provider id the categorizer compares', () => {
	const account = (id: string, username: string, name: string) => ({
		id: id,
		username: username,
		name: name,
		avatarUrl: null,
		url: null,
		email: '',
	});

	const pr = createProviderPullRequest({
		author: account('641685', 'eamodio', 'Eric Amodio'),
		assignees: [account('641685', 'eamodio', 'Eric Amodio')],
		reviews: [{ reviewer: account('583231', 'octocat', 'The Octocat'), state: GitPullRequestReviewState.Approved }],
	});

	test('fromProviderPullRequest keeps the login alongside the provider-internal id', () => {
		const mapped = fromProviderPullRequest(pr, fakeProvider);

		assert.equal(mapped.author.id, '641685', 'the provider-internal id is preserved');
		assert.equal(mapped.author.username, 'eamodio', 'the login is carried through');
		assert.equal(mapped.assignees?.[0].username, 'eamodio');
		assert.equal(mapped.latestReviews?.[0].reviewer.username, 'octocat');
	});

	test('toProviderPullRequest round-trips the provider id, not the login', () => {
		const roundTrip = toProviderPullRequest(fromProviderPullRequest(pr, fakeProvider));

		assert.equal(roundTrip.author?.id, '641685', 'people stay keyed on the provider id');
		assert.equal(roundTrip.assignees?.[0].id, '641685');
		assert.equal(roundTrip.reviews?.[0].reviewer.id, '583231');
	});

	test('a person renders as their display name, which Launchpad shows', () => {
		const roundTrip = toProviderPullRequest(
			fromProviderPullRequest(
				createProviderPullRequest({ author: account('641685', null as unknown as string, 'Eric Amodio') }),
				fakeProvider,
			),
		);

		assert.equal(roundTrip.author?.id, '641685');
		assert.equal(roundTrip.author?.username, 'Eric Amodio', 'no handle still labels the person');
	});
});

/**
 * The head commit's check contexts roll up into the one state the UI reports. Reading a single context (or
 * abstaining on the states with no `PullRequestStatusCheckRollupState` equivalent) lets a success outvote a
 * check that failed, errored, or is still running, which reports "Checks passed" on a pull request nothing
 * verified.
 */
suite('status check rollup precedence', () => {
	function rollupOf(...states: (GitBuildStatusState | null)[]): PullRequestStatusCheckRollupState | undefined {
		const buildStatuses = states.map<GitBuildStatus>(state => ({
			completedAt: null,
			description: null,
			name: null,
			state: state,
			stage: null,
			startedAt: null,
			url: '',
		}));

		return fromProviderPullRequest(
			createProviderPullRequest({ headCommit: { buildStatuses: buildStatuses } }),
			fakeProvider,
		).statusCheckRollupState;
	}

	test('a failed, errored, or action-required context fails the rollup', () => {
		const failed = PullRequestStatusCheckRollupState.Failed;

		assert.equal(rollupOf(GitBuildStatusState.Success, GitBuildStatusState.Failed), failed);
		assert.equal(rollupOf(GitBuildStatusState.Success, GitBuildStatusState.Error), failed, 'errored is not a pass');
		assert.equal(rollupOf(GitBuildStatusState.Success, GitBuildStatusState.ActionRequired), failed);
		assert.equal(
			rollupOf(GitBuildStatusState.Pending, GitBuildStatusState.Failed),
			failed,
			'failure outranks pending',
		);
	});

	test('a pending or running context holds the rollup pending', () => {
		const pending = PullRequestStatusCheckRollupState.Pending;

		assert.equal(rollupOf(GitBuildStatusState.Success, GitBuildStatusState.Pending), pending);
		assert.equal(rollupOf(GitBuildStatusState.Success, GitBuildStatusState.Running), pending, 'still in flight');
		assert.equal(
			rollupOf(GitBuildStatusState.Pending, GitBuildStatusState.Success),
			pending,
			'order does not matter',
		);
	});

	test('success only when every context that votes succeeded', () => {
		assert.equal(
			rollupOf(GitBuildStatusState.Success, GitBuildStatusState.Skipped, GitBuildStatusState.Success),
			PullRequestStatusCheckRollupState.Success,
		);
	});

	test('contexts carrying no verdict abstain rather than decide', () => {
		assert.equal(
			rollupOf(
				GitBuildStatusState.Cancelled,
				GitBuildStatusState.Skipped,
				GitBuildStatusState.Warning,
				GitBuildStatusState.OptionalActionRequired,
				null,
			),
			undefined,
		);
		assert.equal(rollupOf(), undefined, 'no contexts is no verdict');
	});
});

/** Shared across the review suites below, which all need one submitted reviewer and sometimes a second. */
const approver = { id: 'a', username: 'approver', name: 'Approver', email: null, avatarUrl: null, url: null };

/**
 * `commitOid` is a GitLens-local extension of provider-apis' review shape, so it only survives if BOTH
 * directions carry it. It exists so a consumer can compare a review against the PR's current head and tell
 * "the PR moved past my review" from a review still at the tip; a round trip that drops it silently reports
 * every review as being at an unknown commit, which is indistinguishable from a provider that never sent one.
 */
suite('pull request review commitOid round trip', () => {
	test('survives fromProviderPullRequest -> toProviderPullRequest', () => {
		const pr = fromProviderPullRequest(
			createProviderPullRequest({
				reviews: [
					{ reviewer: approver, state: GitPullRequestReviewState.Approved, commitOid: 'reviewed-sha' },
					{
						reviewer: { ...approver, id: 'b', username: 'pending', name: 'Pending' },
						state: GitPullRequestReviewState.ReviewRequested,
					},
				],
			}),
			fakeProvider,
		);

		assert.equal(pr.latestReviews?.length, 1);
		assert.equal(pr.latestReviews?.[0].commitOid, 'reviewed-sha');
		// A pending request has no submitted review and so no commit to carry.
		assert.equal(pr.reviewRequests?.length, 1);
		assert.equal(pr.reviewRequests?.[0]?.commitOid, undefined);

		const roundTrip = toProviderPullRequest(pr);

		const approved = roundTrip.reviews?.find(r => r.state === GitPullRequestReviewState.Approved);
		assert.equal(approved?.commitOid, 'reviewed-sha');
	});

	test('is undefined when the provider did not report one', () => {
		const pr = fromProviderPullRequest(
			createProviderPullRequest({
				reviews: [{ reviewer: approver, state: GitPullRequestReviewState.Approved }],
			}),
			fakeProvider,
		);

		assert.equal(pr.latestReviews?.[0].commitOid, undefined);
	});
});

/**
 * A dismissed review is the canonical "the PR moved past my review": GitHub's `dismiss stale reviews` branch
 * rule flips an approval to DISMISSED on the next push, and `reviewed-by:@me` still returns that PR. Dropping
 * it in the projection would hand a consumer a PR from the reviewed set with NO review row for the current
 * user — indistinguishable from never having reviewed it, which is exactly what `commitOid` exists to detect.
 * provider-apis has no DISMISSED member, so the local fork adds one.
 */
suite('pull request dismissed review projection', () => {
	test('survives the projection with its state and commitOid intact', () => {
		const pr = fromProviderPullRequest(
			createProviderPullRequest({
				reviews: [
					{
						reviewer: approver,
						state: providerPullRequestReviewStateDismissed,
						commitOid: 'stale-sha',
					},
				],
			}),
			fakeProvider,
		);

		assert.equal(pr.latestReviews?.length, 1);
		assert.equal(pr.latestReviews?.[0]?.state, PullRequestReviewState.Dismissed);
		assert.equal(pr.latestReviews?.[0]?.commitOid, 'stale-sha');
		// Dismissed is a submitted verdict, not an outstanding request.
		assert.equal(pr.reviewRequests?.length, 0);

		const roundTrip = toProviderPullRequest(pr);

		assert.equal(roundTrip.reviews?.length, 1);
		assert.equal(roundTrip.reviews?.[0]?.state, providerPullRequestReviewStateDismissed);
		assert.equal(roundTrip.reviews?.[0]?.commitOid, 'stale-sha');
	});

	test('is dropped at the SDK boundary, which has no member for it', () => {
		const pr = fromProviderPullRequest(
			createProviderPullRequest({
				reviews: [
					{ reviewer: approver, state: providerPullRequestReviewStateDismissed },
					{
						reviewer: { ...approver, id: 'b', username: 'other' },
						state: GitPullRequestReviewState.Approved,
					},
				],
			}),
			fakeProvider,
		);

		// `getActionablePullRequests` categorizes by review state and only knows provider-apis' vocabulary, so
		// the widened state must not reach it.
		const forSdk = toProviderPullRequestWithUniqueId(pr);

		assert.deepEqual(
			forSdk.reviews?.map(r => r.state),
			[GitPullRequestReviewState.Approved],
		);
	});

	test("carries a review by one of the user's groups both ways, and nothing for any other reviewer", () => {
		const account = (id: string) => ({ id: id, name: id, username: id, email: null, avatarUrl: null, url: null });
		const pr = fromProviderPullRequest(
			createProviderPullRequest({
				reviews: [
					{ reviewer: account('group'), state: GitPullRequestReviewState.ReviewRequested, isMyGroup: true },
					{ reviewer: account('person'), state: GitPullRequestReviewState.ReviewRequested },
					{ reviewer: account('other-group'), state: GitPullRequestReviewState.Approved, isMyGroup: true },
				],
			}),
			fakeProvider,
		);

		assert.deepEqual(
			pr.reviewRequests?.map(r => [r.reviewer.id, 'isMyGroup' in r ? r.isMyGroup : 'absent']),
			[
				['group', true],
				['person', 'absent'],
			],
		);
		assert.deepEqual(
			pr.latestReviews?.map(r => [r.reviewer.id, r.isMyGroup]),
			[['other-group', true]],
		);
		assert.deepEqual(
			toProviderPullRequest(pr).reviews?.map(r => [r.reviewer.id, 'isMyGroup' in r ? r.isMyGroup : 'absent']),
			[
				['group', true],
				['person', 'absent'],
				['other-group', true],
			],
		);
	});

	/**
	 * An unsubmitted draft carries no verdict and is visible only to its author. It is the ONE state that stays
	 * unmapped, so this pins that it is dropped rather than falling through to the `ReviewRequested` default —
	 * which would report a draft as an outstanding request from that reviewer.
	 */
	test('drops a pending review rather than reporting it as a request', () => {
		const reviewer = { id: 'a', name: 'Approver', username: 'approver' };

		assert.deepEqual(
			toProviderReviews([{ isCodeOwner: false, reviewer: reviewer, state: PullRequestReviewState.Pending }]),
			[],
		);
		assert.deepEqual(
			toProviderReviews([
				{ isCodeOwner: false, reviewer: reviewer, state: PullRequestReviewState.Dismissed },
			])?.map(r => r.state),
			[providerPullRequestReviewStateDismissed],
		);
	});

	/**
	 * provider-apis maps only its four known GitHub review states, so a real dismissed review out of its
	 * `latestReviews` selection arrives as `state: undefined` — a value its own type says cannot occur. Publishing
	 * it would put an unswitchable state on `PullRequestShape.latestReviews`, and mapping back would hit
	 * `toProviderReviews`' `ReviewRequested` fallback and turn a dismissed review into an outstanding request.
	 */
	test('drops an SDK review whose state has no local mapping instead of publishing it', () => {
		const pr = fromProviderPullRequest(
			createProviderPullRequest({
				reviews: [
					{ reviewer: approver, state: undefined as unknown as GitPullRequestReviewState },
					{
						reviewer: { ...approver, id: 'b', username: 'other' },
						state: GitPullRequestReviewState.Approved,
					},
				],
			}),
			fakeProvider,
		);

		assert.deepEqual(
			pr.latestReviews?.map(r => r.reviewer.id),
			['b'],
			'the unmappable row is dropped, the valid sibling survives',
		);
		assert.deepEqual(
			toProviderPullRequest(pr).reviews?.map(r => r.state),
			[GitPullRequestReviewState.Approved],
			'and nothing round-trips into a fabricated review request',
		);
	});
});

/** A full GitHub node as GitLens' own full and stack fragments select it, as `fromGitHubPullRequest` reads it. */
function gitHubPullRequestNode(overrides?: GitHubPullRequestFixtureOverrides): GitHubPullRequest {
	const reviewer = { login: 'reviewer', avatarUrl: '', url: 'https://github.com/reviewer' };
	return gitHubPullRequest(
		1,
		{
			id: 'PR_1',
			title: 'PR',
			body: 'Body',
			updatedAt: '2026-01-02T00:00:00Z',
			author: reviewer,
			baseRefOid: 'base-sha',
			headRefOid: 'head-sha',
			repository: {
				isFork: false,
				name: 'repo',
				owner: { login: 'base' },
				sshUrl: 'git@github.com:base/repo.git',
				url: 'https://github.com/base/repo',
				viewerPermission: 'READ',
			},
			stack: { id: 'S_1', number: 7, size: 2, baseRefName: 'main' },
			stackEntry: { position: 1 },
			additions: 3,
			changedFiles: 2,
			reviewDecision: 'REVIEW_REQUIRED',
			reviewRequests: {
				nodes: [
					{ asCodeOwner: true, requestedReviewer: reviewer },
					{ asCodeOwner: false, requestedReviewer: { ...reviewer, login: 'other' } },
				],
			},
			commits: { totalCount: 1, nodes: [] },
			viewerCanUpdate: false,
			...overrides,
		},
		{ owner: 'base', name: 'repo' },
	);
}

/** GitLens' own GitHub read, as the account-wide and batch reads return it: the native row, tagged for the read. */
function nativeGitHub(
	overrides?: GitHubPullRequestFixtureOverrides,
	currentAccount?: { id: string; username?: string },
): PullRequest {
	return stampNativePullRequest(fromGitHubPullRequest(gitHubPullRequestNode(overrides), fakeProvider), {
		currentAccount: currentAccount,
		projection: 'batch',
	});
}

suite('the GitHub native row keeps what the read fetched, and invents nothing', () => {
	test('keeps the files changed, the stack, the code-owner flags, the viewer and the access level', () => {
		const pr = nativeGitHub();

		assert.equal(pr.filesChanged, 2);
		assert.deepEqual(pr.stack, { id: 'S_1', number: 7, size: 2, position: 1, baseRef: 'main' });
		assert.deepEqual(
			pr.reviewRequests?.map(r => [r.reviewer.id, r.isCodeOwner]),
			[
				['reviewer', true],
				['other', false],
			],
		);
		assert.equal(pr.viewerCanUpdate, false, 'a fetched false is not lost');
		assert.equal(pr.repository.accessLevel, RepositoryAccessLevel.Read);
		assert.equal(pr.mergeableState, PullRequestMergeableState.Mergeable);
	});

	test('keeps a viewer who can update, with the access level it was read with', () => {
		const pr = nativeGitHub({
			viewerCanUpdate: true,
			repository: {
				isFork: false,
				name: 'repo',
				owner: { login: 'base' },
				sshUrl: 'git@github.com:base/repo.git',
				url: 'https://github.com/base/repo',
				viewerPermission: 'ADMIN',
			},
		});

		assert.equal(pr.viewerCanUpdate, true);
		assert.equal(pr.repository.accessLevel, RepositoryAccessLevel.Admin);
	});

	test('carries the number, beside the id rows are keyed by', () => {
		const pr = nativeGitHub({ number: 42 });

		assert.equal(pr.number, 42);
		assert.equal(pr.id, '42');
		assert.equal(pr.nodeId, 'PR_1');
	});

	test("keeps both refs' fork flags, and leaves the unselected repository id unset", () => {
		const pr = nativeGitHub({
			repository: {
				isFork: true,
				name: 'repo',
				owner: { login: 'base' },
				sshUrl: 'git@github.com:base/repo.git',
				url: 'https://github.com/base/repo',
				viewerPermission: 'READ',
			},
		});

		assert.equal(pr.refs?.base.isFork, true);
		assert.equal(pr.refs?.head.isFork, false);
		assert.equal(pr.repository.id, undefined);
	});

	test('a team review request keeps a blank reviewer id, which matches no one', () => {
		const pr = nativeGitHub({
			reviewRequests: { nodes: [{ asCodeOwner: true, requestedReviewer: {} }] },
		});

		assert.equal(pr.reviewRequests?.length, 1);
		assert.equal(pr.reviewRequests?.[0].reviewer.id, '');
		assert.equal(pr.reviewRequests?.[0].isCodeOwner, true);
	});

	test('leaves the unselected reactions unset rather than 0', () => {
		assert.equal(nativeGitHub().thumbsUpCount, undefined);
	});

	test('leaves an unfetched mergeability unset rather than Unknown, and keeps a reported one', () => {
		assert.equal(nativeGitHub({ mergeable: null }).mergeableState, undefined);
		assert.equal(nativeGitHub({ mergeable: 'UNKNOWN' }).mergeableState, PullRequestMergeableState.Unknown);
	});

	test("hands provider-apis' categorizer UNKNOWN for an unfetched mergeability, which its type requires", () => {
		const pr = fromGitHubPullRequest(gitHubPullRequestNode({ mergeable: null }), fakeProvider);

		assert.equal(toProviderPullRequest(pr).mergeableState, undefined);
		assert.equal(toProviderPullRequestWithUniqueId(pr).mergeableState, GitPullRequestMergeableState.Unknown);
	});

	test("keeps GitHub's own review decision: none stays none while a review is requested", () => {
		const noneRequired = nativeGitHub({ reviewDecision: null });
		assert.equal(noneRequired.reviewDecision, undefined);
		assert.equal(noneRequired.reviewRequests?.length, 2);

		assert.equal(nativeGitHub().reviewDecision, PullRequestReviewDecision.ReviewRequired);
		assert.equal(nativeGitHub({ reviewDecision: 'APPROVED' }).reviewDecision, PullRequestReviewDecision.Approved);
	});

	test("still hands provider-apis' categorizer a pending request as REVIEW_REQUESTED where GitHub made no decision", () => {
		const pr = nativeGitHub({ reviewDecision: null });

		assert.equal(toProviderPullRequestWithUniqueId(pr).reviewDecision, GitPullRequestReviewState.ReviewRequested);
	});

	test("derives the categorizer's merge permission from the viewer and the access level it was read with", () => {
		const readOnly = toProviderPullRequest(
			fromGitHubPullRequest(gitHubPullRequestNode({ viewerCanUpdate: true }), fakeProvider),
		);
		assert.deepEqual(readOnly.permissions, { canMerge: false, canMergeAndBypassProtections: false });

		const cannotUpdate = toProviderPullRequest(fromGitHubPullRequest(gitHubPullRequestNode(), fakeProvider));
		assert.deepEqual(cannotUpdate.permissions, { canMerge: false, canMergeAndBypassProtections: false });
	});
});

suite('a GitHub native row is tagged for the read that returned it', () => {
	test('with its projection, on a copy of the mapped row', () => {
		const mapped = fromGitHubPullRequest(gitHubPullRequestNode(), fakeProvider, 'search');
		const stamped = stampNativePullRequest(mapped, { projection: 'batch' });

		assert.ok(stamped instanceof PullRequest);
		assert.notEqual(stamped, mapped);
		assert.equal(stamped.projection, 'batch');
		assert.equal(mapped.projection, 'search', 'the mapped row is left as it was built');
		assert.equal(stamped.closed, false, 'the class getters still answer');
		assert.deepEqual({ ...stamped, projection: 'search' }, { ...mapped });
	});

	test("with authorship by provider-apis rows' rule: the login matches, though the ids never can", () => {
		assert.equal(nativeGitHub(undefined, { id: '641685', username: 'reviewer' }).authoredByMe, true);
		assert.equal(nativeGitHub(undefined, { id: '641685', username: 'eamodio' }).authoredByMe, false);
		assert.equal(nativeGitHub(undefined, { id: 'reviewer' }).authoredByMe, true, 'an id match is enough');
		assert.equal(nativeGitHub().authoredByMe, undefined, 'an unresolved account leaves it unknown');
	});

	test('with the viewer authorship was matched against, present exactly when it was', () => {
		const viewer = { id: '641685', username: 'eamodio' };
		const pr = nativeGitHub(undefined, viewer);

		assert.equal(pr.authoredByMe, false);
		assert.deepEqual(pr.viewer, viewer, 'set whether or not the account authored it');
		assert.equal(nativeGitHub().viewer, undefined, 'an unresolved account leaves no viewer');
	});

	test('a ghost author is nobody the current account can be', () => {
		const pr = nativeGitHub({ author: null }, { id: '641685', username: 'eamodio' });

		assert.deepEqual(pr.author, { id: 'ghost', name: 'ghost', username: 'ghost' });
		assert.equal(pr.authoredByMe, false);
	});

	test("an account-wide row is tagged when it is native, and converted when it is provider-apis'", () => {
		const native = toPullRequestRow(fromGitHubPullRequest(gitHubPullRequestNode(), fakeProvider), fakeProvider, {
			currentAccount: { id: '641685', username: 'reviewer' },
			projection: 'account',
		});
		assert.equal(native.projection, 'account');
		assert.equal(native.authoredByMe, true);
		assert.equal(native.viewerCanUpdate, false, "a value the SDK's shape has no slot for is kept");

		const sdk = toPullRequestRow(createProviderPullRequest({ description: 'From the SDK' }), fakeProvider, {
			projection: 'account-summary',
		});
		assert.equal(sdk.projection, 'account-summary');
		assert.equal(sdk.body, 'From the SDK');
	});

	test('a provider-apis row that grows a `type` key is still converted, not taken for a native one', () => {
		const sdkRow = { ...createProviderPullRequest({ description: 'From the SDK' }), type: 'pullrequest' };

		const pr = toPullRequestRow(sdkRow, fakeProvider, { projection: 'repos' });

		assert.equal(pr.body, 'From the SDK');
		assert.equal(pr.provider, fakeProvider);
		assert.equal(pr.projection, 'repos');
	});
});

suite('the Launchpad boundary for a GitHub row', () => {
	test("hands provider-apis' categorizer the SDK shape, and nothing beyond it", () => {
		const reviewer = { avatarUrl: '', email: '', url: 'https://github.com/reviewer' };
		const remoteInfo = {
			cloneUrlHTTPS: 'https://github.com/base/repo.git',
			cloneUrlSSH: 'git@github.com:base/repo.git',
		};

		assert.deepEqual(toProviderPullRequestWithUniqueId(nativeGitHub()), {
			id: '1',
			graphQLId: 'PR_1',
			number: 1,
			title: 'PR',
			description: 'Body',
			url: 'https://github.com/base/repo/pull/1',
			state: GitPullRequestState.Open,
			isCrossRepository: false,
			isDraft: false,
			createdDate: new Date('2026-01-01T00:00:00Z'),
			updatedDate: new Date('2026-01-02T00:00:00Z'),
			closedDate: null,
			mergedDate: null,
			commentCount: 0,
			upvoteCount: null,
			commitCount: 1,
			fileCount: 2,
			additions: 3,
			deletions: 1,
			author: { ...reviewer, id: 'reviewer', name: 'reviewer', username: 'reviewer' },
			assignees: [],
			baseRef: { name: 'main', oid: 'base-sha' },
			headRef: { name: 'feature', oid: 'head-sha' },
			reviewDecision: GitPullRequestReviewState.ReviewRequested,
			// The SDK's type requires a string, so an unread id goes over blank.
			repository: { id: '', name: 'repo', owner: { login: 'base' }, remoteInfo: remoteInfo },
			headRepository: {
				id: 'repo',
				name: 'repo',
				owner: { login: 'base' },
				remoteInfo: remoteInfo,
				isFork: false,
			},
			headCommit: null,
			// READ can't merge, whatever the viewer can update.
			permissions: { canMerge: false, canMergeAndBypassProtections: false },
			mergeableState: GitPullRequestMergeableState.Mergeable,
			reviews: [
				{
					reviewer: { ...reviewer, id: 'reviewer', name: 'reviewer', username: 'reviewer' },
					state: GitPullRequestReviewState.ReviewRequested,
					commitOid: undefined,
					isCodeOwner: true,
				},
				{
					reviewer: { ...reviewer, id: 'other', name: 'other', username: 'other' },
					state: GitPullRequestReviewState.ReviewRequested,
					commitOid: undefined,
					isCodeOwner: false,
				},
			],
			uuid: '["github","pr","1","","PR_1"]',
		});
	});
});

suite("provider-apis' rows carry no invented viewer", () => {
	test('leaves the access level unset, and reads a viewer only from a permission to merge', () => {
		const canMerge = fromProviderPullRequest(
			createProviderPullRequest({ permissions: { canMerge: true, canMergeAndBypassProtections: false } }),
			fakeProvider,
		);
		assert.equal(canMerge.repository.accessLevel, undefined);
		assert.equal(canMerge.viewerCanUpdate, true);

		// The SDK's `permissions` can't say "can't update", so a refused merge stays unknown.
		const cannotMerge = fromProviderPullRequest(
			createProviderPullRequest({ permissions: { canMerge: false, canMergeAndBypassProtections: false } }),
			fakeProvider,
		);
		assert.equal(cannotMerge.viewerCanUpdate, undefined);

		const noPermissions = fromProviderPullRequest(createProviderPullRequest(), fakeProvider);
		assert.equal(noPermissions.viewerCanUpdate, undefined);
		assert.equal(noPermissions.stack, undefined);
	});

	test('an unknown access level keeps a merge the SDK allowed when the row goes back to the categorizer', () => {
		const pr = fromProviderPullRequest(
			createProviderPullRequest({ permissions: { canMerge: true, canMergeAndBypassProtections: false } }),
			fakeProvider,
		);

		assert.deepEqual(toProviderPullRequestWithUniqueId(pr).permissions, {
			canMerge: true,
			canMergeAndBypassProtections: false,
		});
	});

	test('leaves a review request whose code ownership the SDK never reports unset rather than false', () => {
		const pr = fromProviderPullRequest(
			createProviderPullRequest({
				reviews: [{ reviewer: approver, state: GitPullRequestReviewState.ReviewRequested }],
			}),
			fakeProvider,
		);

		assert.equal(pr.reviewRequests?.length, 1);
		assert.equal(pr.reviewRequests?.[0]?.isCodeOwner, undefined);
	});

	test("keeps provider-apis' own review decision", () => {
		const pr = fromProviderPullRequest(
			createProviderPullRequest({
				reviews: [{ reviewer: approver, state: GitPullRequestReviewState.ReviewRequested }],
				reviewDecision: GitPullRequestReviewState.ReviewRequested,
			}),
			fakeProvider,
		);

		assert.equal(pr.reviewDecision, PullRequestReviewDecision.ReviewRequired);
	});
});

suite("Launchpad's mergeability for a row that has none", () => {
	function unreadMergeability(providerId: string, mergeableState?: GitPullRequestMergeableState): PullRequest {
		return fromProviderPullRequest(createProviderPullRequest({ mergeableState: mergeableState }), {
			...fakeProvider,
			id: providerId,
		});
	}

	test("a Bitbucket Cloud row goes over as MERGEABLE, as provider-apis' own Bitbucket rows do", () => {
		const pr = unreadMergeability(GitCloudHostIntegrationId.Bitbucket);

		assert.equal(pr.mergeableState, undefined, 'the row itself stays honest');
		assert.equal(toProviderPullRequestWithUniqueId(pr).mergeableState, GitPullRequestMergeableState.Mergeable);
	});

	test('a Bitbucket Cloud row keeps a mergeability it has', () => {
		const pr = unreadMergeability(GitCloudHostIntegrationId.Bitbucket, GitPullRequestMergeableState.Conflicts);

		assert.equal(toProviderPullRequestWithUniqueId(pr).mergeableState, GitPullRequestMergeableState.Conflicts);
	});

	test('every other host goes over as UNKNOWN', () => {
		for (const providerId of [
			GitCloudHostIntegrationId.GitHub,
			GitCloudHostIntegrationId.GitLab,
			GitSelfManagedHostIntegrationId.BitbucketServer,
			GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted,
		]) {
			assert.equal(
				toProviderPullRequestWithUniqueId(unreadMergeability(providerId)).mergeableState,
				GitPullRequestMergeableState.Unknown,
				providerId,
			);
		}
	});
});

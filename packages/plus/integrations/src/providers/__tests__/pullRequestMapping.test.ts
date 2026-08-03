import * as assert from 'node:assert/strict';
import type { GitBuildStatus } from '@gitkraken/provider-apis';
import {
	GitBuildStatusState,
	GitPullRequestMergeableState,
	GitPullRequestReviewState,
	GitPullRequestState,
} from '@gitkraken/provider-apis';
import { suite, test } from 'mocha';
import { PullRequestStatusCheckRollupState } from '@gitlens/git/models/pullRequest.js';
import type { Provider } from '@gitlens/git/models/remoteProvider.js';
import type { ProviderPullRequest } from '../models.js';
import { fromProviderPullRequest, toProviderPullRequest } from '../models.js';

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
		assert.deepEqual(roundTrip.headRepository?.remoteInfo, {
			cloneUrlHTTPS: 'https://github.com/fork/repo.git',
			cloneUrlSSH: 'git@github.com:fork/repo.git',
		});
		assert.equal(roundTrip.headRepository?.isFork, true);
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

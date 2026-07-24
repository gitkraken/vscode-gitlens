import * as assert from 'node:assert/strict';
import { GitPullRequestMergeableState, GitPullRequestState } from '@gitkraken/provider-apis';
import { suite, test } from 'mocha';
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
			{ currentAccountId: 'me' },
		);

		assert.equal(pr.number, 42, 'the provider-visible PR number is not derived from its opaque id');
		assert.equal(pr.authoredByMe, true, 'authorship is resolved against the selected provider account');
		assert.equal(toProviderPullRequest(pr).number, 42, 'the provider-visible number survives a round-trip');
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
		assert.equal(pr.repository.id, '');
		assert.equal(pr.refs?.base.owner, '');
		assert.equal(pr.refs?.base.repo, '');
	});
});

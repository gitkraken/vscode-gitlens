import * as assert from 'assert';
import type { PullRequest } from '@gitlens/git/models/pullRequest.js';
import { getRemoteNameFromBranchName } from '@gitlens/utils/gitRefs.js';
import type { GlRepository } from '../../../../../git/models/repository.js';
import { setupPullRequestBranch } from '../startReview.utils.js';

suite('plus/launchpad/utils/-webview/startReview.utils', () => {
	suite('setupPullRequestBranch', () => {
		function pullRequest(owner: string): Pick<PullRequest, 'id' | 'url' | 'refs'> {
			return {
				id: '7',
				url: 'https://gitlab.com/acme/platform/kepler/-/merge_requests/7',
				refs: {
					head: {
						owner: owner,
						repo: 'kepler',
						url: `https://gitlab.com/${owner}/kepler.git`,
						branch: 'feature',
						sha: 'abc',
					},
					base: {
						owner: 'acme/platform',
						repo: 'kepler',
						url: 'https://gitlab.com/acme/platform/kepler.git',
						branch: 'main',
						sha: 'def',
					},
				},
			} as unknown as Pick<PullRequest, 'id' | 'url' | 'refs'>;
		}

		const repo = {
			path: '/repo',
			git: {
				remotes: { getRemotes: () => Promise.resolve([]) },
				branches: { getLocalBranchByUpstream: () => Promise.resolve(undefined) },
			},
		} as unknown as GlRepository;

		test('names the remote for a fork in a nested namespace without a slash', async () => {
			const setup = await setupPullRequestBranch(repo, pullRequest('contrib/team'));

			assert.strictEqual(setup.remoteName, 'contrib-team');
			assert.deepStrictEqual(setup.addRemote, {
				name: 'contrib-team',
				url: 'https://gitlab.com/contrib/team/kepler.git',
			});
			assert.strictEqual(setup.remoteBranchName, 'contrib-team/feature');
			assert.strictEqual(getRemoteNameFromBranchName(setup.remoteBranchName), setup.remoteName);
		});

		test('names the remote for a flat fork after its owner', async () => {
			const setup = await setupPullRequestBranch(repo, pullRequest('contrib'));

			assert.strictEqual(setup.remoteName, 'contrib');
			assert.strictEqual(setup.remoteBranchName, 'contrib/feature');
		});
	});
});

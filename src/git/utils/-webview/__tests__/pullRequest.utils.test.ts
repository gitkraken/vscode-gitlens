import * as assert from 'assert';
import * as sinon from 'sinon';
import { window } from 'vscode';
import type { PullRequest } from '@gitlens/git/models/pullRequest.js';
import { getRemoteNameFromBranchName } from '@gitlens/utils/gitRefs.js';
import type { GlRepository } from '../../../models/repository.js';
import { ensurePullRequestRemote, getRemoteNameForPullRequestOwner } from '../pullRequest.utils.js';

suite('git/-webview/pullRequest.utils', () => {
	suite('getRemoteNameForPullRequestOwner', () => {
		test('keeps a flat owner as is', () => {
			assert.strictEqual(getRemoteNameForPullRequestOwner('contrib'), 'contrib');
		});

		test('names a nested namespace without a slash, so a remote branch name still splits at its remote', () => {
			const name = getRemoteNameForPullRequestOwner('contrib/team');

			assert.strictEqual(name, 'contrib-team');
			assert.strictEqual(getRemoteNameFromBranchName(`${name}/feature`), name);
		});
	});

	suite('ensurePullRequestRemote', () => {
		function pullRequest(owner: string): PullRequest {
			return {
				id: '7',
				url: 'https://gitlab.com/acme/platform/kepler/-/merge_requests/7',
				provider: { id: 'gitlab', domain: 'gitlab.com' },
				repository: { owner: 'acme/platform', repo: 'kepler' },
				refs: {
					head: { owner: owner, repo: 'kepler', url: `https://gitlab.com/${owner}/kepler.git` },
					base: {
						owner: 'acme/platform',
						repo: 'kepler',
						url: 'https://gitlab.com/acme/platform/kepler.git',
					},
				},
			} as unknown as PullRequest;
		}

		let addRemoteWithResult: sinon.SinonStub;
		let repo: GlRepository;

		setup(() => {
			addRemoteWithResult = sinon.stub().resolves(undefined);
			repo = {
				git: { remotes: { getRemotes: () => Promise.resolve([]), addRemoteWithResult: addRemoteWithResult } },
			} as unknown as GlRepository;

			sinon
				.stub(window, 'showInformationMessage')
				.callsFake(
					(_message: string, _options: unknown, confirm: unknown) => Promise.resolve(confirm) as never,
				);
		});

		teardown(() => {
			sinon.restore();
		});

		test('adds the remote for a fork in a nested namespace under a name with no slash', async () => {
			assert.strictEqual(await ensurePullRequestRemote(pullRequest('contrib/team'), repo), true);

			assert.strictEqual(addRemoteWithResult.callCount, 1);
			assert.strictEqual(addRemoteWithResult.firstCall.args[0], 'contrib-team');
			assert.strictEqual(addRemoteWithResult.firstCall.args[1], 'https://gitlab.com/contrib/team/kepler.git');
		});

		test('adds the remote for a flat fork under its owner', async () => {
			assert.strictEqual(await ensurePullRequestRemote(pullRequest('contrib'), repo), true);

			assert.strictEqual(addRemoteWithResult.firstCall.args[0], 'contrib');
		});
	});
});

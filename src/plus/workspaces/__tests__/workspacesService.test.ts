import * as assert from 'assert';
import type { GitRemote } from '@gitlens/git/models/remote.js';
import { AzureDevOpsRemoteProvider } from '@gitlens/git/remotes/azure-devops.js';
import { GitHubRemoteProvider } from '@gitlens/git/remotes/github.js';
import { GitLabRemoteProvider } from '@gitlens/git/remotes/gitlab.js';
import { getRemoteDescriptor } from '../workspacesService.js';

suite('plus/workspaces/workspacesService', () => {
	suite('getRemoteDescriptor', () => {
		function remoteOf(
			provider: GitLabRemoteProvider | GitHubRemoteProvider | AzureDevOpsRemoteProvider,
		): GitRemote {
			return { provider: provider } as unknown as GitRemote;
		}

		test('names a GitLab nested group repository by its whole namespace and its name', async () => {
			const descriptor = await getRemoteDescriptor(
				remoteOf(new GitLabRemoteProvider('gitlab.com', 'Acme/Platform/Kepler')),
			);

			assert.strictEqual(descriptor?.provider, 'gitlab');
			assert.strictEqual(descriptor.owner, 'acme/platform');
			assert.strictEqual(descriptor.repoName, 'kepler');
		});

		test('tells GitLab repositories with the same name under different subgroups apart', async () => {
			const a = await getRemoteDescriptor(remoteOf(new GitLabRemoteProvider('gitlab.com', 'acme/a/kepler')));
			const b = await getRemoteDescriptor(remoteOf(new GitLabRemoteProvider('gitlab.com', 'acme/b/kepler')));

			assert.notStrictEqual(`${a?.owner}/${a?.repoName}`, `${b?.owner}/${b?.repoName}`);
		});

		test('names a flat GitLab repository by its owner and its name', async () => {
			const descriptor = await getRemoteDescriptor(
				remoteOf(new GitLabRemoteProvider('gitlab.com', 'acme/kepler')),
			);

			assert.strictEqual(descriptor?.owner, 'acme');
			assert.strictEqual(descriptor.repoName, 'kepler');
		});

		test('leaves other providers as the provider names them', async () => {
			const github = await getRemoteDescriptor(remoteOf(new GitHubRemoteProvider('github.com', 'Acme/Kepler')));
			assert.strictEqual(github?.provider, 'github');
			assert.strictEqual(github.owner, 'acme');
			assert.strictEqual(github.repoName, 'kepler');

			const azure = await getRemoteDescriptor(
				remoteOf(new AzureDevOpsRemoteProvider('dev.azure.com', 'Org/Project/_git/Repo')),
			);
			assert.strictEqual(azure?.provider, 'azure-devops');
			assert.strictEqual(azure.owner, 'org');
			assert.strictEqual(azure.repoName, 'repo');
		});
	});
});

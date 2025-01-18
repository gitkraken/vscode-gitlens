import { Uri } from 'vscode';
import { GitRemote } from '../../../../../git/models/remote';
import { getRemoteProviderMatcher, loadRemoteProviders } from '../../../../../git/remotes/remoteProviders';
import { RemotesGitProviderBase } from '../../../../../git/sub-providers/remotes';
import { log } from '../../../../../system/decorators/log';
import { configuration } from '../../../../../system/vscode/configuration';

export class RemotesGitSubProvider extends RemotesGitProviderBase {
	@log({ args: { 1: false } })
	// eslint-disable-next-line @typescript-eslint/require-await
	async getRemotes(
		repoPath: string | undefined,
		_options?: { filter?: (remote: GitRemote) => boolean; sort?: boolean },
	): Promise<GitRemote[]> {
		if (repoPath == null) return [];

		const providers = loadRemoteProviders(configuration.get('remotes', null), undefined);

		const uri = Uri.parse(repoPath, true);
		const [, owner, repo] = uri.path.split('/', 3);

		const url = `https://github.com/${owner}/${repo}.git`;
		const domain = 'github.com';
		const path = `${owner}/${repo}`;

		return [
			new GitRemote(
				this.container,
				repoPath,
				'origin',
				'https',
				domain,
				path,
				getRemoteProviderMatcher(this.container, providers)(url, domain, path),
				[
					{ type: 'fetch', url: url },
					{ type: 'push', url: url },
				],
			),
		];
	}
}

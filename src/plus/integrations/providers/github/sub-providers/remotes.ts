import { Uri } from 'vscode';
import { GitRemote } from '../../../../../git/models/remote.js';
import { getRemoteProviderMatcher, loadRemoteProvidersFromConfig } from '../../../../../git/remotes/remoteProviders.js';
import { RemotesGitProviderBase } from '../../../../../git/sub-providers/remotes.js';
import { debug } from '../../../../../system/decorators/log.js';

export class RemotesGitSubProvider extends RemotesGitProviderBase {
	@debug({ args: repoPath => ({ repoPath: repoPath }) })
	async getRemotes(
		repoPath: string | undefined,
		_options?: { filter?: (remote: GitRemote) => boolean; sort?: boolean },
	): Promise<GitRemote[]> {
		if (repoPath == null) return [];

		const providers = loadRemoteProvidersFromConfig(null, undefined);

		const uri = Uri.parse(repoPath, true);
		const [, owner, repo] = uri.path.split('/', 3);

		const url = `https://github.com/${owner}/${repo}.git`;
		const protocol = 'https';
		const domain = 'github.com';
		const path = `${owner}/${repo}`;

		return [
			new GitRemote(
				this.container,
				repoPath,
				'origin',
				protocol,
				domain,
				path,
				(await getRemoteProviderMatcher(this.container, providers))(url, domain, path, protocol),
				[
					{ type: 'fetch', url: url },
					{ type: 'push', url: url },
				],
			),
		];
	}
}

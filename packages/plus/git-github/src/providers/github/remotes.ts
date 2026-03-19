import { GitRemote } from '@gitlens/git/models/remote.js';
import { RemotesGitProviderBase } from '@gitlens/git/providers/shared/remotes.js';
import { GitHubRemoteProvider } from '@gitlens/git/remotes/github.js';
import { createRemoteProviderMatcher } from '@gitlens/git/remotes/matcher.js';
import { debug } from '@gitlens/utils/decorators/log.js';
import { parseUri } from '@gitlens/utils/uri.js';

export class RemotesGitSubProvider extends RemotesGitProviderBase {
	@debug({ args: repoPath => ({ repoPath: repoPath }) })
	async getRemotes(
		repoPath: string | undefined,
		_options?: { filter?: (remote: GitRemote) => boolean; sort?: boolean },
		_cancellation?: AbortSignal,
	): Promise<GitRemote[]> {
		if (repoPath == null) return [];

		const uri = parseUri(repoPath);
		const [, owner, repo] = uri.path.split('/', 3);

		const url = `https://github.com/${owner}/${repo}.git`;
		const protocol = 'https';
		const domain = 'github.com';
		const path = `${owner}/${repo}`;

		const configs = await this.context.remotes?.getCustomProviders?.(repoPath);
		const matcher = createRemoteProviderMatcher(configs, this.context.remotes);
		const provider = matcher(url, domain, path, protocol) ?? new GitHubRemoteProvider(domain, path);

		return [
			new GitRemote(
				repoPath,
				'origin',
				protocol,
				domain,
				path,
				[
					{ type: 'fetch', url: url },
					{ type: 'push', url: url },
				],
				provider,
			),
		];
	}
}

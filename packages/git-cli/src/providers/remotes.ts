import type { Cache } from '@gitlens/git/cache.js';
import type { GitServiceContext } from '@gitlens/git/context.js';
import type { GitRemote } from '@gitlens/git/models/remote.js';
import type { GitRemotesSubProvider } from '@gitlens/git/providers/remotes.js';
import { RemotesGitProviderBase } from '@gitlens/git/providers/shared/remotes.js';
import { createRemoteProviderMatcher } from '@gitlens/git/remotes/matcher.js';
import { sortRemotes } from '@gitlens/git/utils/sorting.js';
import { gate } from '@gitlens/utils/decorators/gate.js';
import { debug } from '@gitlens/utils/decorators/log.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import type { CliGitProviderInternal } from '../cliGitProvider.js';
import type { Git } from '../exec/git.js';
import { parseGitRemotes } from '../parsers/remoteParser.js';

export class RemotesGitSubProvider extends RemotesGitProviderBase implements GitRemotesSubProvider {
	constructor(
		context: GitServiceContext,
		private readonly git: Git,
		cache: Cache,
		provider: CliGitProviderInternal,
	) {
		super(context, cache, provider);
	}

	@debug({ args: repoPath => ({ repoPath: repoPath }) })
	async getRemotes(
		repoPath: string | undefined,
		options?: { filter?: (remote: GitRemote) => boolean; sort?: boolean },
		_cancellation?: AbortSignal,
	): Promise<GitRemote[]> {
		if (repoPath == null) return [];

		const scope = getScopedLogger();

		let remotes = await this.cache.getRemotes(repoPath, async (commonPath, cacheable) => {
			const configs = await this.context.remotes?.getCustomProviders?.(repoPath);
			const remoteProviderMatcher = createRemoteProviderMatcher(configs, this.context.remotes);

			try {
				const result = await this.git.exec(
					{ cwd: repoPath, caching: { cache: this.cache.gitResults, commonPath: commonPath } },
					'remote',
					'-v',
				);

				// Fetch default remote name from GK config before parsing so it's set at construction time
				const defaultName = await this.provider.config.getGkConfig?.(repoPath, 'gk.defaultRemote');
				const remotes = parseGitRemotes(result.stdout, commonPath, remoteProviderMatcher, defaultName);

				return remotes;
			} catch (ex) {
				cacheable.invalidate();
				scope?.error(ex);
				return [];
			}
		});

		if (options?.filter != null) {
			remotes = remotes.filter(options.filter);
		}

		if (options?.sort) {
			sortRemotes(remotes);
		}

		return remotes;
	}

	@gate()
	@debug()
	async addRemote(repoPath: string, name: string, url: string, options?: { fetch?: boolean }): Promise<void> {
		await this.git.exec({ cwd: repoPath }, 'remote', 'add', options?.fetch ? '-f' : undefined, name, url);
		this.context.hooks?.cache?.onReset?.(repoPath, 'remotes');
		this.context.hooks?.repository?.onChanged?.(repoPath, ['remotes']);
	}

	@gate()
	@debug()
	async addRemoteWithResult(
		repoPath: string,
		name: string,
		url: string,
		options?: { fetch?: boolean },
	): Promise<GitRemote | undefined> {
		await this.addRemote(repoPath, name, url, options);
		const [remote] = await this.getRemotes(repoPath, { filter: r => r.url === url });
		return remote;
	}

	@gate()
	@debug()
	async pruneRemote(repoPath: string, name: string): Promise<void> {
		await this.git.exec({ cwd: repoPath }, 'remote', 'prune', name);
		this.context.hooks?.cache?.onReset?.(repoPath, 'remotes', 'branches');
		this.context.hooks?.repository?.onChanged?.(repoPath, ['remotes']);
	}

	@gate()
	@debug()
	async removeRemote(repoPath: string, name: string): Promise<void> {
		await this.git.exec({ cwd: repoPath }, 'remote', 'remove', name);
		this.context.hooks?.cache?.onReset?.(repoPath, 'remotes');
		this.context.hooks?.repository?.onChanged?.(repoPath, ['remotes']);
	}
}

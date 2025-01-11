import type { CancellationToken } from 'vscode';
import type { Container } from '../../../../container';
import type { GitCache } from '../../../../git/cache';
import type { GitRemote } from '../../../../git/models/remote';
import { sortRemotes } from '../../../../git/models/remote';
import { parseGitRemotes } from '../../../../git/parsers/remoteParser';
import { getRemoteProviderMatcher, loadRemoteProviders } from '../../../../git/remotes/remoteProviders';
import { RemotesGitProviderBase } from '../../../../git/sub-providers/remotes';
import { log } from '../../../../system/decorators/log';
import { Logger } from '../../../../system/logger';
import { getLogScope } from '../../../../system/logger.scope';
import { configuration } from '../../../../system/vscode/configuration';
import type { Git } from '../git';
import type { LocalGitProvider } from '../localGitProvider';

export class RemotesGitSubProvider extends RemotesGitProviderBase {
	constructor(
		container: Container,
		private readonly git: Git,
		cache: GitCache,
		provider: LocalGitProvider,
	) {
		super(container, cache, provider);
	}

	@log({ args: { 1: false } })
	async getRemotes(
		repoPath: string | undefined,
		options?: { filter?: (remote: GitRemote) => boolean; sort?: boolean },
		_cancellation?: CancellationToken,
	): Promise<GitRemote[]> {
		if (repoPath == null) return [];

		const scope = getLogScope();

		let remotesPromise = this.cache.remotes?.get(repoPath);
		if (remotesPromise == null) {
			async function load(this: RemotesGitSubProvider): Promise<GitRemote[]> {
				const providers = loadRemoteProviders(
					configuration.get('remotes', this.container.git.getRepository(repoPath!)?.folder?.uri ?? null),
				);

				try {
					const data = await this.git.remote(repoPath!);
					const remotes = parseGitRemotes(
						this.container,
						data,
						repoPath!,
						getRemoteProviderMatcher(this.container, providers),
					);
					return remotes;
				} catch (ex) {
					this.cache.remotes?.delete(repoPath!);
					Logger.error(ex, scope);
					return [];
				}
			}

			remotesPromise = load.call(this);

			this.cache.remotes?.set(repoPath, remotesPromise);
		}

		let remotes = await remotesPromise;
		if (options?.filter != null) {
			remotes = remotes.filter(options.filter);
		}

		if (options?.sort) {
			sortRemotes(remotes);
		}

		return remotes;
	}
}

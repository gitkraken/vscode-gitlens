import type { CancellationToken } from 'vscode';
import type { Container } from '../../../../container';
import type { GitCache } from '../../../../git/cache';
import type { GitRemotesSubProvider } from '../../../../git/gitProvider';
import type { GitRemote } from '../../../../git/models/remote';
import { sortRemotes } from '../../../../git/models/remote';
import { parseGitRemotes } from '../../../../git/parsers/remoteParser';
import { getRemoteProviderMatcher, loadRemoteProviders } from '../../../../git/remotes/remoteProviders';
import { RemotesGitProviderBase } from '../../../../git/sub-providers/remotes';
import { gate } from '../../../../system/decorators/gate';
import { log } from '../../../../system/decorators/log';
import { Logger } from '../../../../system/logger';
import { getLogScope } from '../../../../system/logger.scope';
import { configuration } from '../../../../system/vscode/configuration';
import type { Git } from '../git';
import type { LocalGitProvider } from '../localGitProvider';

export class RemotesGitSubProvider extends RemotesGitProviderBase implements GitRemotesSubProvider {
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
					this.container.integrations.getConfiguredIntegrationDescriptors(),
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

	@gate()
	@log()
	async addRemote(repoPath: string, name: string, url: string, options?: { fetch?: boolean }): Promise<void> {
		await this.git.remote__add(repoPath, name, url, options);
		this.container.events.fire('git:cache:reset', { repoPath: repoPath, caches: ['remotes'] });
	}

	@gate()
	@log()
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
	@log()
	async pruneRemote(repoPath: string, name: string): Promise<void> {
		await this.git.remote__prune(repoPath, name);
		this.container.events.fire('git:cache:reset', { repoPath: repoPath, caches: ['remotes'] });
	}

	@gate()
	@log()
	async removeRemote(repoPath: string, name: string): Promise<void> {
		await this.git.remote__remove(repoPath, name);
		this.container.events.fire('git:cache:reset', { repoPath: repoPath, caches: ['remotes'] });
	}
}

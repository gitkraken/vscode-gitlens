import type { CancellationToken } from 'vscode';
import type { Container } from '../../../../container.js';
import type { GitCache } from '../../../../git/cache.js';
import type { GitRemotesSubProvider } from '../../../../git/gitProvider.js';
import type { GitRemote } from '../../../../git/models/remote.js';
import { parseGitRemotes } from '../../../../git/parsers/remoteParser.js';
import { getRemoteProviderMatcher, loadRemoteProvidersFromConfig } from '../../../../git/remotes/remoteProviders.js';
import { RemotesGitProviderBase } from '../../../../git/sub-providers/remotes.js';
import { sortRemotes } from '../../../../git/utils/-webview/sorting.js';
import { gate } from '../../../../system/decorators/gate.js';
import { log } from '../../../../system/decorators/log.js';
import { Logger } from '../../../../system/logger.js';
import { getLogScope } from '../../../../system/logger.scope.js';
import type { Git } from '../git.js';
import type { LocalGitProvider } from '../localGitProvider.js';

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

		const remotesPromise = this.cache.remotes.getOrCreate(repoPath, async cancellable => {
			const providers = loadRemoteProvidersFromConfig(
				this.container.git.getRepository(repoPath)?.folder?.uri ?? null,
				await this.container.integrations.getConfigured(),
			);

			try {
				const result = await this.git.exec({ cwd: repoPath }, 'remote', '-v');
				const remotes = parseGitRemotes(
					this.container,
					result.stdout,
					repoPath,
					await getRemoteProviderMatcher(this.container, providers),
				);
				return remotes;
			} catch (ex) {
				cancellable.invalidate();
				Logger.error(ex, scope);
				return [];
			}
		});

		if (remotesPromise == null) return [];

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
		await this.git.exec({ cwd: repoPath }, 'remote', 'add', options?.fetch ? '-f' : undefined, name, url);
		this.container.events.fire('git:cache:reset', { repoPath: repoPath, types: ['remotes'] });
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
		await this.git.exec({ cwd: repoPath }, 'remote', 'prune', name);
		this.container.events.fire('git:cache:reset', { repoPath: repoPath, types: ['remotes'] });
	}

	@gate()
	@log()
	async removeRemote(repoPath: string, name: string): Promise<void> {
		await this.git.exec({ cwd: repoPath }, 'remote', 'remove', name);
		this.container.events.fire('git:cache:reset', { repoPath: repoPath, types: ['remotes'] });
	}
}

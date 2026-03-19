import { debug } from '@gitlens/utils/decorators/log.js';
import { sortCompare } from '@gitlens/utils/string.js';
import type { Cache } from '../../cache.js';
import type { GitServiceContext } from '../../context.js';
import type { GitRemote } from '../../models/remote.js';
import type { RemoteProvider } from '../../models/remoteProvider.js';
import { getDefaultRemoteOrHighlander } from '../../utils/remote.utils.js';
import type { GitProvider } from '../provider.js';
import type { GitRemotesSubProvider } from '../remotes.js';

export abstract class RemotesGitProviderBase implements GitRemotesSubProvider {
	constructor(
		protected readonly context: GitServiceContext,
		protected readonly cache: Cache,
		protected readonly provider: GitProvider,
	) {}

	abstract getRemotes(
		repoPath: string | undefined,
		options?: { filter?: (remote: GitRemote) => boolean; sort?: boolean },
		cancellation?: AbortSignal,
	): Promise<GitRemote[]>;

	@debug()
	async getRemote(
		repoPath: string | undefined,
		name: string,
		cancellation?: AbortSignal,
	): Promise<GitRemote | undefined> {
		if (repoPath == null) return undefined;

		const remotes = await this.getRemotes(repoPath, undefined, cancellation);
		return remotes.find(r => r.name === name);
	}

	@debug()
	async getDefaultRemote(repoPath: string, cancellation?: AbortSignal): Promise<GitRemote | undefined> {
		const remotes = await this.getRemotes(repoPath, undefined, cancellation);
		return getDefaultRemoteOrHighlander(remotes);
	}

	@debug()
	async getRemotesWithProviders(
		repoPath: string,
		options?: { sort?: boolean },
		cancellation?: AbortSignal,
	): Promise<GitRemote<RemoteProvider>[]> {
		const remotes = await this.getRemotes(repoPath, options, cancellation);
		return remotes.filter((r): r is GitRemote<RemoteProvider> => r.provider != null);
	}

	@debug()
	async getBestRemoteWithProvider(
		repoPath: string,
		cancellation?: AbortSignal,
	): Promise<GitRemote<RemoteProvider> | undefined> {
		const remotes = await this.getBestRemotesWithProviders(repoPath, cancellation);
		return remotes[0];
	}

	@debug()
	async getBestRemotesWithProviders(
		repoPath: string,
		cancellation?: AbortSignal,
	): Promise<GitRemote<RemoteProvider>[]> {
		if (!repoPath) return [];

		const remotes = this.cache.bestRemotes.getOrCreate(
			repoPath,
			async (_cacheable, aggregateSignal) => {
				const remotes = await this.getRemotesWithProviders(repoPath, { sort: true }, aggregateSignal);
				if (remotes.length === 0) return [];
				if (remotes.length === 1) return [...remotes];

				if (this.context.remotes?.sort != null) {
					return this.context.remotes.sort(remotes, aggregateSignal);
				}

				// Fallback: sort by name when no host sort is provided
				return remotes.toSorted((a, b) => sortCompare(a.name, b.name));
			},
			cancellation,
		);

		return [...(await remotes)];
	}

	@debug()
	async setRemoteAsDefault(repoPath: string, name: string, value: boolean = true): Promise<void> {
		// setGkConfig is optional — providers that don't support git config (e.g. GitHub) silently skip persistence
		await this.provider.config.setGkConfig?.(repoPath, 'gk.defaultRemote', value ? name : undefined);
		this.context.hooks?.cache?.onReset?.(repoPath, 'remotes');
		this.context.hooks?.repository?.onChanged?.(repoPath, ['remotes', 'remoteProviders']);
	}
}

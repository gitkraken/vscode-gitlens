import type { CancellationToken } from 'vscode';
import type { Container } from '../../container';
import { CancellationError } from '../../errors';
import type { GitHostIntegration } from '../../plus/integrations/models/gitHostIntegration';
import { log } from '../../system/decorators/log';
import { sortCompare } from '../../system/string';
import type { GitCache } from '../cache';
import type { GitProvider, GitRemotesSubProvider } from '../gitProvider';
import type { GitRemote } from '../models/remote';
import { RepositoryChange } from '../models/repository';
import type { RemoteProvider } from '../remotes/remoteProvider';
import { getDefaultRemoteOrHighlander } from '../utils/remote.utils';

export abstract class RemotesGitProviderBase implements GitRemotesSubProvider {
	constructor(
		protected readonly container: Container,
		protected readonly cache: GitCache,
		protected readonly provider: GitProvider,
	) {}

	abstract getRemotes(
		repoPath: string | undefined,
		options?: { filter?: (remote: GitRemote) => boolean; sort?: boolean },
		_cancellation?: CancellationToken,
	): Promise<GitRemote[]>;

	@log()
	async getRemote(
		repoPath: string | undefined,
		name: string,
		cancellation?: CancellationToken,
	): Promise<GitRemote | undefined> {
		if (repoPath == null) return undefined;

		const remotes = await this.getRemotes(repoPath, undefined, cancellation);
		return remotes.find(r => r.name === name);
	}

	@log()
	async getDefaultRemote(repoPath: string, _cancellation?: CancellationToken): Promise<GitRemote | undefined> {
		const remotes = await this.getRemotes(repoPath, undefined, _cancellation);
		return getDefaultRemoteOrHighlander(remotes);
	}

	@log()
	async getRemotesWithProviders(
		repoPath: string,
		options?: { sort?: boolean },
		cancellation?: CancellationToken,
	): Promise<GitRemote<RemoteProvider>[]> {
		const remotes = await this.getRemotes(repoPath, options, cancellation);
		return remotes.filter((r: GitRemote): r is GitRemote<RemoteProvider> => r.provider != null);
	}

	@log()
	async getRemotesWithIntegrations(
		repoPath: string,
		options?: { sort?: boolean },
		cancellation?: CancellationToken,
	): Promise<GitRemote<RemoteProvider>[]> {
		const remotes = await this.getRemotes(repoPath, options, cancellation);
		return remotes.filter((r: GitRemote): r is GitRemote<RemoteProvider> => r.supportsIntegration());
	}

	@log()
	async getBestRemoteWithProvider(
		repoPath: string,
		cancellation?: CancellationToken,
	): Promise<GitRemote<RemoteProvider> | undefined> {
		const remotes = await this.getBestRemotesWithProviders(repoPath, cancellation);
		return remotes[0];
	}

	@log()
	async getBestRemotesWithProviders(
		repoPath: string,
		cancellation?: CancellationToken,
	): Promise<GitRemote<RemoteProvider>[]> {
		if (repoPath == null) return [];

		const remotes = this.cache.bestRemotes.getOrCreate(repoPath, async () => {
			const remotes = await this.getRemotesWithProviders(repoPath, { sort: true }, cancellation);
			if (remotes.length === 0) return [];
			if (remotes.length === 1) return [...remotes];

			if (cancellation?.isCancellationRequested) throw new CancellationError();

			const defaultRemote = remotes.find(r => r.default)?.name;
			const currentBranchRemote = (await this.provider.branches.getBranch(remotes[0].repoPath))?.getRemoteName();

			const weighted: [number, GitRemote<RemoteProvider>][] = [];

			let originalFound = false;

			for (const remote of remotes) {
				let weight;
				switch (remote.name) {
					case defaultRemote:
						weight = 1000;
						break;
					case currentBranchRemote:
						weight = 6;
						break;
					case 'upstream':
						weight = 5;
						break;
					case 'origin':
						weight = 4;
						break;
					default:
						weight = 0;
				}

				// Only check remotes that have extra weighting and less than the default
				if (weight > 0 && weight < 1000 && !originalFound) {
					const integration = await remote.getIntegration();
					if (
						integration != null &&
						(integration.maybeConnected ||
							(integration.maybeConnected === undefined && (await integration.isConnected())))
					) {
						if (cancellation?.isCancellationRequested) throw new CancellationError();

						const repo = await integration.getRepositoryMetadata(remote.provider.repoDesc, {
							cancellation: cancellation,
						});

						if (cancellation?.isCancellationRequested) throw new CancellationError();

						if (repo != null) {
							weight += repo.isFork ? -3 : 3;
							// Once we've found the "original" (not a fork) don't bother looking for more
							originalFound = !repo.isFork;
						}
					}
				}

				weighted.push([weight, remote]);
			}

			// Sort by the weight, but if both are 0 (no weight) then sort by name
			weighted.sort(([aw, ar], [bw, br]) => (bw === 0 && aw === 0 ? sortCompare(ar.name, br.name) : bw - aw));
			return weighted.map(wr => wr[1]);
		});

		return [...(await remotes)];
	}

	@log()
	async getBestRemoteWithIntegration(
		repoPath: string,
		options?: {
			filter?: (remote: GitRemote, integration: GitHostIntegration) => boolean;
			includeDisconnected?: boolean;
		},
		cancellation?: CancellationToken,
	): Promise<GitRemote<RemoteProvider> | undefined> {
		const remotes = await this.getBestRemotesWithProviders(repoPath, cancellation);

		const includeDisconnected = options?.includeDisconnected ?? false;
		for (const r of remotes) {
			if (r.supportsIntegration()) {
				const integration = await r.getIntegration();
				if (integration != null) {
					if (options?.filter?.(r, integration) === false) continue;

					if (includeDisconnected || integration.maybeConnected === true) return r;
					if (integration.maybeConnected === undefined && (r.default || remotes.length === 1)) {
						if (await integration.isConnected()) return r;
					}
				}
			}
		}

		return undefined;
	}

	@log()
	async setRemoteAsDefault(repoPath: string, name: string, value: boolean = true): Promise<void> {
		await this.container.storage.storeWorkspace('remote:default', value ? name : undefined);
		this.container.events.fire('git:repo:change', {
			repoPath: repoPath,
			changes: [RepositoryChange.Remotes, RepositoryChange.RemoteProviders],
		});
	}
}

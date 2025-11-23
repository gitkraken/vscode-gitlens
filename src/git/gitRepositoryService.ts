import type { Uri } from 'vscode';
import { GlyphChars } from '../constants';
import type { Features } from '../features';
import { debug, log } from '../system/decorators/log';
import { groupByFilterMap } from '../system/iterable';
import { getSettledValue } from '../system/promise';
import type {
	GitBranchesSubProvider,
	GitCommitsSubProvider,
	GitConfigSubProvider,
	GitContributorsSubProvider,
	GitDiffSubProvider,
	GitGraphSubProvider,
	GitOperationsSubProvider,
	GitPatchSubProvider,
	GitPausedOperationsSubProvider,
	GitProvider,
	GitProviderDescriptor,
	GitRefsSubProvider,
	GitRemotesSubProvider,
	GitRepositoryProvider,
	GitRevisionSubProvider,
	GitStagingSubProvider,
	GitStashSubProvider,
	GitStatusSubProvider,
	GitSubProvider,
	GitSubProviderForRepo,
	GitSubProvidersProps,
	GitTagsSubProvider,
	GitWorktreesSubProvider,
	ScmRepository,
} from './gitProvider';
import { createSubProviderProxyForRepo } from './gitProvider';
import type { GitProviderService } from './gitProviderService';
import type { GitBranch } from './models/branch';
import type { GitFile } from './models/file';
import { deletedOrMissing } from './models/revision';
import type { GitTag } from './models/tag';
import { getRemoteThemeIconString } from './utils/remote.utils';

type GitSubProvidersForRepo = {
	[P in keyof GitProvider as NonNullable<GitProvider[P]> extends GitSubProvider ? P : never]: NonNullable<
		GitProvider[P]
	> extends GitSubProvider
		? GitSubProviderForRepo<NonNullable<GitProvider[P]>>
		: never;
};

type IGitRepositoryService = GitSubProvidersForRepo & {
	[K in Exclude<keyof GitRepositoryProvider, keyof GitSubProvidersForRepo>]: OmitFirstArg<GitRepositoryProvider[K]>;
} & {
	[K in Extract<
		keyof GitProviderService,
		| 'getBestRevisionUri'
		| 'getBranchesAndTagsTipsLookup'
		| 'getRepository'
		| 'getRevisionUri'
		| 'getWorkingUri'
		| 'supports'
	>]: OmitFirstArg<GitProviderService[K]>;
} & {
	[K in Extract<keyof GitProviderService, 'getAbsoluteUri' | 'getRelativePath'>]: GitProviderService[K];
};

export class GitRepositoryService implements IGitRepositoryService {
	constructor(
		svc: GitProviderService,
		private readonly _provider: GitProvider,
		readonly path: string,
	) {
		this.getAbsoluteUri = svc.getAbsoluteUri.bind(svc);
		this.getRelativePath = svc.getRelativePath.bind(svc);
		this.getRepository = svc.getRepository.bind(svc, path);
	}

	@log<GitRepositoryService['excludeIgnoredUris']>({ args: { 0: uris => uris.length } })
	excludeIgnoredUris(uris: Uri[]): Promise<Uri[]> {
		return this._provider.excludeIgnoredUris(this.path, uris);
	}

	getAbsoluteUri: IGitRepositoryService['getAbsoluteUri'];

	@log()
	async getBestRevisionUri(path: string, rev: string | undefined): Promise<Uri | undefined> {
		if (rev === deletedOrMissing) return undefined;

		return this._provider.getBestRevisionUri(this.path, this._provider.getRelativePath(path, this.path), rev);
	}

	@log()
	async getBranchesAndTagsTipsLookup(
		suppressName?: string,
	): Promise<
		(
			sha: string,
			options?: { compact?: boolean; icons?: boolean; pills?: boolean | { cssClass: string } },
		) => string | undefined
	> {
		if (this.path == null) return () => undefined;

		type Tip = { name: string; icon: string; compactName: string | undefined; type: 'branch' | 'tag' };

		const [branchesResult, tagsResult, remotesResult] = await Promise.allSettled([
			this.branches.getBranches(),
			this.tags.getTags(),
			this.remotes.getRemotes(),
		]);

		const branches = getSettledValue(branchesResult)?.values ?? [];
		const tags = getSettledValue(tagsResult)?.values ?? [];
		const remotes = getSettledValue(remotesResult) ?? [];

		const branchesAndTagsBySha = groupByFilterMap(
			(branches as (GitBranch | GitTag)[]).concat(tags as (GitBranch | GitTag)[]),
			bt => bt.sha,
			bt => {
				let icon;
				if (bt.refType === 'branch') {
					if (bt.remote) {
						const remote = remotes.find(r => r.name === bt.getRemoteName());
						icon = `$(${getRemoteThemeIconString(remote)}) `;
					} else {
						icon = bt.current ? '$(target) ' : '$(git-branch) ';
					}
				} else {
					icon = '$(tag) ';
				}

				return {
					name: bt.name,
					icon: icon,
					compactName:
						suppressName && bt.refType === 'branch' && bt.getNameWithoutRemote() === suppressName
							? bt.getRemoteName()
							: undefined,
					type: bt.refType,
				} satisfies Tip;
			},
		);

		return (
			sha: string,
			options?: { compact?: boolean; icons?: boolean; pills?: boolean | { cssClass: string } },
		): string | undefined => {
			const branchesAndTags = branchesAndTagsBySha.get(sha);
			if (!branchesAndTags?.length) return undefined;

			const tips =
				suppressName && options?.compact
					? branchesAndTags.filter(bt => bt.name !== suppressName)
					: branchesAndTags;

			function getIconAndLabel(tip: Tip) {
				const label = (options?.compact ? tip.compactName : undefined) ?? tip.name;
				return `${options?.icons ? `${tip.icon}${options?.pills ? '&nbsp;' : ' '}` : ''}${label}`;
			}

			let results;
			if (options?.compact) {
				if (!tips.length) return undefined;

				const [bt] = tips;
				results = [`${getIconAndLabel(bt)}${tips.length > 1 ? `, ${GlyphChars.Ellipsis}` : ''}`];
			} else {
				results = tips.map(getIconAndLabel);
			}

			if (options?.pills) {
				return results
					.map(
						t =>
							/*html*/ `<span style="color:#ffffff;background-color:#1d76db;border-radius:3px;"${
								typeof options.pills === 'object' ? ` class="${options.pills.cssClass}"` : ''
							}>&nbsp;${t}&nbsp;&nbsp;</span>`,
					)
					.join('&nbsp;&nbsp;');
			}
			return results.join(', ');
		};
	}

	@debug({ exit: true })
	getLastFetchedTimestamp(): Promise<number | undefined> {
		return this._provider.getLastFetchedTimestamp(this.path);
	}

	getRelativePath: IGitRepositoryService['getRelativePath'];
	getRepository: IGitRepositoryService['getRepository'];

	@log()
	getRevisionUri(rev: string, pathOrFile: string | GitFile): Uri {
		const path = typeof pathOrFile === 'string' ? pathOrFile : (pathOrFile?.originalPath ?? pathOrFile?.path ?? '');
		return this._provider.getRevisionUri(this.path, rev, this._provider.getRelativePath(path, this.path));
	}

	@log()
	getScmRepository(): Promise<ScmRepository | undefined> {
		return this._provider.getScmRepository(this.path);
	}

	@log()
	getOrOpenScmRepository(): Promise<ScmRepository | undefined> {
		return this._provider.getOrOpenScmRepository(this.path);
	}

	@log({ exit: true })
	async getUniqueRepositoryId(): Promise<string | undefined> {
		return this.commits.getInitialCommitSha?.();
	}

	@log()
	getWorkingUri(uri: Uri): Promise<Uri | undefined> {
		return this._provider.getWorkingUri(this.path, uri);
	}

	@debug({ exit: true })
	supports(feature: Features): Promise<boolean> {
		return this._provider.supports(feature);
	}

	get provider(): GitProviderDescriptor {
		return this._provider.descriptor;
	}
	get branches(): GitSubProviderForRepo<GitBranchesSubProvider> {
		return this.getSubProviderProxy('branches');
	}
	get commits(): GitSubProviderForRepo<GitCommitsSubProvider> {
		return this.getSubProviderProxy('commits');
	}
	get config(): GitSubProviderForRepo<GitConfigSubProvider> {
		return this.getSubProviderProxy('config');
	}
	get contributors(): GitSubProviderForRepo<GitContributorsSubProvider> {
		return this.getSubProviderProxy('contributors');
	}
	get diff(): GitSubProviderForRepo<GitDiffSubProvider> {
		return this.getSubProviderProxy('diff');
	}
	get graph(): GitSubProviderForRepo<GitGraphSubProvider> {
		return this.getSubProviderProxy('graph');
	}
	get ops(): GitSubProviderForRepo<GitOperationsSubProvider> | undefined {
		return this.getSubProviderProxy('ops');
	}
	get patch(): GitSubProviderForRepo<GitPatchSubProvider> | undefined {
		return this.getSubProviderProxy('patch');
	}
	get pausedOps(): GitSubProviderForRepo<GitPausedOperationsSubProvider> | undefined {
		return this.getSubProviderProxy('pausedOps');
	}
	get refs(): GitSubProviderForRepo<GitRefsSubProvider> {
		return this.getSubProviderProxy('refs');
	}
	get remotes(): GitSubProviderForRepo<GitRemotesSubProvider> {
		return this.getSubProviderProxy('remotes');
	}
	get revision(): GitSubProviderForRepo<GitRevisionSubProvider> {
		return this.getSubProviderProxy('revision');
	}
	get staging(): GitSubProviderForRepo<GitStagingSubProvider> | undefined {
		return this.getSubProviderProxy('staging');
	}
	get stash(): GitSubProviderForRepo<GitStashSubProvider> | undefined {
		return this.getSubProviderProxy('stash');
	}
	get status(): GitSubProviderForRepo<GitStatusSubProvider> {
		return this.getSubProviderProxy('status');
	}
	get tags(): GitSubProviderForRepo<GitTagsSubProvider> {
		return this.getSubProviderProxy('tags');
	}
	get worktrees(): GitSubProviderForRepo<GitWorktreesSubProvider> | undefined {
		return this.getSubProviderProxy('worktrees');
	}

	private proxies = new Map<string, GitSubProviderForRepo<any>>();

	private getSubProviderProxy<T extends GitSubProvidersProps>(
		prop: T,
	): GitSubProviderForRepo<NonNullable<GitProvider[T]>> {
		let proxy = this.proxies.get(prop);
		if (proxy == null) {
			const subProvider = this._provider[prop];
			if (subProvider == null) return undefined!;

			proxy = createSubProviderProxyForRepo(subProvider, this.path);
			this.proxies.set(prop, proxy);
		}
		return proxy;
	}
}

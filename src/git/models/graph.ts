import type {
	GraphRow,
	Head,
	HostingServiceType,
	Remote,
	RowContexts,
	RowStats,
	Tag,
} from '@gitkraken/gitkraken-components';
import type { GkProviderId } from '../../gk/models/repositoryIdentities';
import type { Brand, Unbrand } from '../../system/brand';
import type { GitBranch } from './branch';
import type { GitStashCommit } from './commit';
import type { GitRemote } from './remote';
import type { GitWorktree } from './worktree';

export type GitGraphHostingServiceType = HostingServiceType;

export type GitGraphRowHead = Head;
export type GitGraphRowRemoteHead = Remote;
export type GitGraphRowTag = Tag;
export type GitGraphRowContexts = RowContexts;
export type GitGraphRowStats = RowStats;
export type GitGraphRowType =
	| 'commit-node'
	| 'merge-node'
	| 'stash-node'
	| 'work-dir-changes'
	| 'merge-conflict-node'
	| 'unsupported-rebase-warning-node';

export interface GitGraphRow extends GraphRow {
	type: GitGraphRowType;
	heads?: GitGraphRowHead[];
	remotes?: GitGraphRowRemoteHead[];
	tags?: GitGraphRowTag[];
	contexts?: GitGraphRowContexts;
}

export interface GitGraph {
	readonly repoPath: string;
	/** A map of all avatar urls */
	readonly avatars: Map<string, string>;
	/** A set of all "seen" commit ids */
	readonly ids: Set<string>;
	readonly includes: { stats?: boolean } | undefined;
	/** A set of all remapped commit ids -- typically for stash index/untracked commits
	 * (key = remapped from id, value = remapped to id)
	 */
	readonly remappedIds?: Map<string, string>;
	readonly branches: Map<string, GitBranch>;
	readonly remotes: Map<string, GitRemote>;
	readonly downstreams: Map<string, string[]>;
	readonly stashes: Map<string, GitStashCommit> | undefined;
	readonly worktrees: GitWorktree[] | undefined;
	readonly worktreesByBranch: Map<string, GitWorktree> | undefined;

	/** The rows for the set of commits requested */
	readonly rows: GitGraphRow[];
	readonly id?: string;

	readonly rowsStats?: GitGraphRowsStats;
	readonly rowsStatsDeferred?: { isLoaded: () => boolean; promise: Promise<void> };

	readonly paging?: {
		readonly limit: number | undefined;
		readonly startingCursor: string | undefined;
		readonly hasMore: boolean;
	};

	more?(limit: number, id?: string): Promise<GitGraph | undefined>;
}

export type GitGraphRowsStats = Map<string, GitGraphRowStats>;

export function convertHostingServiceTypeToGkProviderId(type: GitGraphHostingServiceType): GkProviderId | undefined {
	switch (type) {
		case 'github':
			return 'github' satisfies Unbrand<GkProviderId> as Brand<GkProviderId>;
		case 'githubEnterprise':
			return 'githubEnterprise' satisfies Unbrand<GkProviderId> as Brand<GkProviderId>;
		case 'gitlab':
			return 'gitlab' satisfies Unbrand<GkProviderId> as Brand<GkProviderId>;
		case 'gitlabSelfHosted':
			return 'gitlabSelfHosted' satisfies Unbrand<GkProviderId> as Brand<GkProviderId>;
		case 'bitbucket':
			return 'bitbucket' satisfies Unbrand<GkProviderId> as Brand<GkProviderId>;
		case 'bitbucketServer':
			return 'bitbucketServer' satisfies Unbrand<GkProviderId> as Brand<GkProviderId>;
		case 'azureDevops':
			return 'azureDevops' satisfies Unbrand<GkProviderId> as Brand<GkProviderId>;
		default:
			return undefined;
	}
}

export function getGkProviderThemeIconString(
	providerIdOrHostingType: GkProviderId | GitGraphHostingServiceType | undefined,
): string {
	switch (providerIdOrHostingType) {
		case 'azureDevops':
			return 'gitlens-provider-azdo';
		case 'bitbucket':
		case 'bitbucketServer':
			return 'gitlens-provider-bitbucket';
		case 'github':
		case 'githubEnterprise':
			return 'gitlens-provider-github';
		case 'gitlab':
		case 'gitlabSelfHosted':
			return 'gitlens-provider-gitlab';
		default:
			return 'cloud';
	}
}

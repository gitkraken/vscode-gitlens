import { Cache } from '@gitlens/git/cache.js';
import type { GitProvider, GitProviderDescriptor } from '@gitlens/git/providers/provider.js';
import type { Uri } from '@gitlens/utils/uri.js';
import type { GitHubProviderContext, GitHubRepositoryContext } from '../context.js';
import { BlameGitHubSubProvider } from './github/blame.js';
import { BranchesGitSubProvider } from './github/branches.js';
import { CommitsGitSubProvider } from './github/commits.js';
import { ConfigGitSubProvider } from './github/config.js';
import { ContributorsGitSubProvider } from './github/contributors.js';
import { DiffGitSubProvider } from './github/diff.js';
import { GraphGitSubProvider } from './github/graph.js';
import { RefsGitSubProvider } from './github/refs.js';
import { RemotesGitSubProvider } from './github/remotes.js';
import { RevisionGitSubProvider } from './github/revision.js';
import { StatusGitSubProvider } from './github/status.js';
import { TagsGitSubProvider } from './github/tags.js';
import type { GitHubGitProviderInternal } from './githubProvider.js';

export interface GitHubGitProviderOptions {
	/** Context providing config, GitHub-specific hooks, and abstracted file system */
	context: GitHubProviderContext;
	/** Authentication provider ID (e.g. 'github', 'github-enterprise') */
	authenticationProviderId: string;
	/** Use an existing Cache instance, or one will be created */
	cache?: Cache;
}

/**
 * A fully-wired GitHub Git provider that implements both `GitHubGitProviderInternal`
 * (for internal sub-provider wiring) and `GitProvider` (for registration
 * in the unified provider registry).
 *
 * @example
 * ```typescript
 * const provider = new GitHubGitProvider({
 *   context: githubContext,
 *   authenticationProviderId: 'github',
 * });
 *
 * const branches = await provider.branches.getBranches(repoPath);
 * const commit = await provider.commits.getCommit(repoPath, 'HEAD');
 * ```
 */
export class GitHubGitProvider implements GitHubGitProviderInternal, GitProvider {
	readonly descriptor: GitProviderDescriptor = { id: 'github', name: 'GitHub', virtual: true };

	private readonly _cache: Cache;
	private readonly _cacheOwned: boolean;

	readonly context: GitHubProviderContext;
	readonly authenticationProviderId: string;

	constructor(options: GitHubGitProviderOptions) {
		this.context = options.context;
		this.authenticationProviderId = options.authenticationProviderId;
		this._cacheOwned = !(options.cache instanceof Cache);
		this._cache = options.cache instanceof Cache ? options.cache : new Cache();
	}

	/** The underlying cache instance */
	get cache(): Cache {
		return this._cache;
	}

	private _blame: BlameGitHubSubProvider | undefined;
	get blame(): BlameGitHubSubProvider {
		return (this._blame ??= new BlameGitHubSubProvider(this._cache, this));
	}

	private _branches: BranchesGitSubProvider | undefined;
	get branches(): BranchesGitSubProvider {
		return (this._branches ??= new BranchesGitSubProvider(this._cache, this));
	}

	private _commits: CommitsGitSubProvider | undefined;
	get commits(): CommitsGitSubProvider {
		return (this._commits ??= new CommitsGitSubProvider(this._cache, this));
	}

	private _config: ConfigGitSubProvider | undefined;
	get config(): ConfigGitSubProvider {
		return (this._config ??= new ConfigGitSubProvider(this._cache, this));
	}

	private _contributors: ContributorsGitSubProvider | undefined;
	get contributors(): ContributorsGitSubProvider {
		return (this._contributors ??= new ContributorsGitSubProvider(this._cache, this));
	}

	private _diff: DiffGitSubProvider | undefined;
	get diff(): DiffGitSubProvider {
		return (this._diff ??= new DiffGitSubProvider(this._cache, this));
	}

	private _graph: GraphGitSubProvider | undefined;
	get graph(): GraphGitSubProvider {
		return (this._graph ??= new GraphGitSubProvider(this));
	}

	private _refs: RefsGitSubProvider | undefined;
	get refs(): RefsGitSubProvider {
		return (this._refs ??= new RefsGitSubProvider(this._cache, this));
	}

	private _remotes: RemotesGitSubProvider | undefined;
	get remotes(): RemotesGitSubProvider {
		return (this._remotes ??= new RemotesGitSubProvider(this.context, this._cache, this));
	}

	private _revision: RevisionGitSubProvider | undefined;
	get revision(): RevisionGitSubProvider {
		return (this._revision ??= new RevisionGitSubProvider(this));
	}

	private _status: StatusGitSubProvider | undefined;
	get status(): StatusGitSubProvider {
		return (this._status ??= new StatusGitSubProvider(this));
	}

	private _tags: TagsGitSubProvider | undefined;
	get tags(): TagsGitSubProvider {
		return (this._tags ??= new TagsGitSubProvider(this._cache, this));
	}

	async ensureRepositoryContext(repoPath: string, open?: boolean): Promise<GitHubRepositoryContext> {
		return this.context.resolveRepositoryContext(repoPath, open);
	}

	getRelativePath(pathOrUri: Uri | string, base: Uri | string): string {
		return this.context.uris.getRelativePath(pathOrUri, base);
	}

	createProviderUri(repoPath: string, rev: string, path?: string): Uri {
		return this.context.uris.createProviderUri(repoPath, rev, path);
	}

	createVirtualUri(repoPath: string, rev: string | undefined, path?: string): Uri {
		return this.context.uris.createVirtualUri(repoPath, rev, path);
	}

	getBestRevisionUri(repoPath: string, path: string, rev: string | undefined): Promise<Uri | undefined> {
		return this.context.uris.getBestRevisionUri(repoPath, path, rev);
	}

	getAbsoluteUri(pathOrUri: string | Uri, base: string | Uri): Uri {
		return this.context.uris.getAbsoluteUri(pathOrUri, base);
	}

	getProviderRootUri(uri: Uri): Uri {
		return this.context.uris.getProviderRootUri(uri);
	}

	getPagingLimit(limit?: number): number {
		if (limit === 0) return 0;
		limit = Math.min(limit ?? this.context.config?.paging?.limit ?? 100, 100);
		if (limit !== 0 && limit < 100) {
			limit = Math.max(limit, 1);
		}
		return limit;
	}

	dispose(): void {
		if (this._cacheOwned) {
			this._cache.dispose();
		}
	}
}

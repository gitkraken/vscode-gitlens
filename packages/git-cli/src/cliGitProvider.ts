import * as path from 'node:path';
import { Cache } from '@gitlens/git/cache.js';
import type { GitServiceContext } from '@gitlens/git/context.js';
import type { GitFileStatus } from '@gitlens/git/models/fileStatus.js';
import { deletedOrMissing } from '@gitlens/git/models/revision.js';
import type { GitProvider, GitProviderDescriptor } from '@gitlens/git/providers/provider.js';
import { parseGitRemoteUrl } from '@gitlens/git/utils/remote.utils.js';
import { isUncommitted } from '@gitlens/git/utils/revision.utils.js';
import { GitIgnoreFilter } from '@gitlens/git/watching/gitIgnoreFilter.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import { joinPaths, maybeUri, normalizePath, splitPath } from '@gitlens/utils/path.js';
import type { Uri } from '@gitlens/utils/uri.js';
import { fileUri, joinUriPath, parseUri, toFsPath } from '@gitlens/utils/uri.js';
import { fsExists } from './exec/exec.js';
import type { FilteredGitFeatures, GitFeatureOrPrefix, GitFeatures } from './exec/features.js';
import type { GitOptions } from './exec/git.js';
import { Git } from './exec/git.js';
import type { GitLocation } from './exec/locator.js';
import { BlameGitSubProvider } from './providers/blame.js';
import { BranchesGitSubProvider } from './providers/branches.js';
import { CommitsGitSubProvider } from './providers/commits.js';
import { ConfigGitSubProvider } from './providers/config.js';
import { ContributorsGitSubProvider } from './providers/contributors.js';
import { DiffGitSubProvider } from './providers/diff.js';
import { GraphGitSubProvider } from './providers/graph.js';
import { OperationsGitSubProvider } from './providers/operations.js';
import { PatchGitSubProvider } from './providers/patch.js';
import { PausedOperationsGitSubProvider } from './providers/pausedOperations.js';
import { RefsGitSubProvider } from './providers/refs.js';
import { RemotesGitSubProvider } from './providers/remotes.js';
import { RevisionGitSubProvider } from './providers/revision.js';
import { StagingGitSubProvider } from './providers/staging.js';
import { StashGitSubProvider } from './providers/stash.js';
import { StatusGitSubProvider } from './providers/status.js';
import { TagsGitSubProvider } from './providers/tags.js';
import { WorktreesGitSubProvider } from './providers/worktrees.js';

export interface CliGitProviderOptions {
	/** Use an existing Cache instance, or one will be created */
	cache?: Cache;
	/** Context providing config and event bus hooks */
	context: GitServiceContext;
	/** Function that resolves the git binary location (path + version) */
	locator: () => Promise<GitLocation>;
	/** Pre-built Git executor — when provided, used instead of creating a new Git from locator/options */
	git?: Git;
	/** Git execution options (timeout, trust, queue config, hooks, etc.) */
	gitOptions?: GitOptions;
}

/**
 * Exposes `isTrackedWithDetails` as a callable method for sub-providers.
 * The class declares it as a regular method, but TypeScript's structural
 * typing makes it inaccessible through the class type alone when consumed
 * internally — this type re-maps it to ensure sub-providers can call it.
 */
export type CliGitProviderInternal = Omit<CliGitProvider, 'isTrackedWithDetails'> & {
	isTrackedWithDetails: CliGitProvider['isTrackedWithDetails'];
};

/**
 * A fully-wired CLI-based git provider that executes git commands via `child_process`.
 * Implements both `CliGitProviderInternal` (for internal sub-provider wiring)
 * and `GitProvider` (for registration in a provider registry).
 *
 * @example
 * ```typescript
 * const provider = new CliGitProvider({
 *   context: { events: myEvents },
 *   locator: () => findGitPath(null),
 *   gitOptions: { gitTimeout: 30000 },
 * });
 *
 * const branches = await provider.branches.getBranches(repoPath);
 * const status = await provider.status.getStatus(repoPath);
 * ```
 */
export class CliGitProvider implements GitProvider {
	readonly descriptor: GitProviderDescriptor = { id: 'git', name: 'Git', virtual: false };

	private readonly _cache: Cache;
	private readonly _cacheOwned: boolean;
	private readonly _git: Git;

	readonly context: GitServiceContext;

	constructor(options: CliGitProviderOptions) {
		this.context = options.context;
		this._git =
			options.git ??
			new Git(options.locator, {
				...options.gitOptions,
				isTrusted:
					options.context.workspace?.isTrusted != null
						? () => options.context.workspace!.isTrusted!
						: undefined,
			});
		this._cacheOwned = !(options.cache instanceof Cache);
		this._cache = options.cache instanceof Cache ? options.cache : new Cache();
	}

	/** The underlying cache instance (for repo path registration, etc.) */
	get cache(): Cache {
		return this._cache;
	}

	/** The underlying git execution instance (for sub-providers that need direct exec/stream access) */
	get git(): Git {
		return this._git;
	}

	/** Returns whether the installed git version supports the given feature. */
	supports(feature: GitFeatures): boolean | Promise<boolean> {
		return this._git.supports(feature);
	}

	/** Returns all features matching the prefix that the installed git version supports. */
	supported<T extends GitFeatureOrPrefix>(feature: T): FilteredGitFeatures<T>[] | Promise<FilteredGitFeatures<T>[]> {
		return this._git.supported(feature);
	}

	/** Throws if the installed git version does not support the given feature. */
	async ensureSupports(feature: GitFeatures, prefix: string, suffix: string): Promise<void> {
		return this._git.ensureSupports(feature, prefix, suffix);
	}

	/** Returns the installed git version string. */
	async version(): Promise<string> {
		return this._git.version();
	}

	/** Returns the resolved git binary path. */
	async path(): Promise<string> {
		return this._git.path();
	}

	async clone(url: string, parentPath: string): Promise<string | undefined> {
		let count = 0;
		const [, , remotePath] = parseGitRemoteUrl(url);
		const remoteName = remotePath.split('/').pop();
		if (!remoteName) return undefined;

		let folderPath = joinPaths(parentPath, remoteName);
		while ((await fsExists(folderPath)) && count < 20) {
			count++;
			folderPath = joinPaths(parentPath, `${remoteName}-${count}`);
		}

		await this._git.exec({ cwd: parentPath }, 'clone', url, folderPath);

		return folderPath;
	}

	private _blame: BlameGitSubProvider | undefined;
	get blame(): BlameGitSubProvider {
		return (this._blame ??= new BlameGitSubProvider(
			this._git,
			this._cache,
			this as unknown as CliGitProviderInternal,
		));
	}

	private _branches: BranchesGitSubProvider | undefined;
	get branches(): BranchesGitSubProvider {
		return (this._branches ??= new BranchesGitSubProvider(
			this.context,
			this._git,
			this._cache,
			this as unknown as CliGitProviderInternal,
		));
	}

	private _commits: CommitsGitSubProvider | undefined;
	get commits(): CommitsGitSubProvider {
		return (this._commits ??= new CommitsGitSubProvider(
			this.context,
			this._git,
			this._cache,
			this as unknown as CliGitProviderInternal,
		));
	}

	private _config: ConfigGitSubProvider | undefined;
	get config(): ConfigGitSubProvider {
		return (this._config ??= new ConfigGitSubProvider(
			this.context,
			this._git,
			this._cache,
			this as unknown as CliGitProviderInternal,
		));
	}

	private _contributors: ContributorsGitSubProvider | undefined;
	get contributors(): ContributorsGitSubProvider {
		return (this._contributors ??= new ContributorsGitSubProvider(
			this.context,
			this._git,
			this._cache,
			this as unknown as CliGitProviderInternal,
		));
	}

	private _diff: DiffGitSubProvider | undefined;
	get diff(): DiffGitSubProvider {
		return (this._diff ??= new DiffGitSubProvider(
			this.context,
			this._git,
			this._cache,
			this as unknown as CliGitProviderInternal,
		));
	}

	private _graph: GraphGitSubProvider | undefined;
	get graph(): GraphGitSubProvider {
		return (this._graph ??= new GraphGitSubProvider(
			this.context,
			this._git,
			this._cache,
			this as unknown as CliGitProviderInternal,
		));
	}

	private _ops: OperationsGitSubProvider | undefined;
	get ops(): OperationsGitSubProvider {
		return (this._ops ??= new OperationsGitSubProvider(
			this.context,
			this._git,
			this._cache,
			this as unknown as CliGitProviderInternal,
		));
	}

	private _patch: PatchGitSubProvider | undefined;
	get patch(): PatchGitSubProvider {
		return (this._patch ??= new PatchGitSubProvider(
			this.context,
			this._git,
			this._cache,
			this as unknown as CliGitProviderInternal,
		));
	}

	private _pausedOps: PausedOperationsGitSubProvider | undefined;
	get pausedOps(): PausedOperationsGitSubProvider {
		return (this._pausedOps ??= new PausedOperationsGitSubProvider(
			this.context,
			this._git,
			this._cache,
			this as unknown as CliGitProviderInternal,
		));
	}

	private _refs: RefsGitSubProvider | undefined;
	get refs(): RefsGitSubProvider {
		return (this._refs ??= new RefsGitSubProvider(
			this.context,
			this._git,
			this._cache,
			this as unknown as CliGitProviderInternal,
		));
	}

	private _remotes: RemotesGitSubProvider | undefined;
	get remotes(): RemotesGitSubProvider {
		return (this._remotes ??= new RemotesGitSubProvider(
			this.context,
			this._git,
			this._cache,
			this as unknown as CliGitProviderInternal,
		));
	}

	private _revision: RevisionGitSubProvider | undefined;
	get revision(): RevisionGitSubProvider {
		return (this._revision ??= new RevisionGitSubProvider(
			this.context,
			this._git,
			this._cache,
			this as unknown as CliGitProviderInternal,
		));
	}

	private _staging: StagingGitSubProvider | undefined;
	get staging(): StagingGitSubProvider {
		return (this._staging ??= new StagingGitSubProvider(
			this.context,
			this._git,
			this._cache,
			this as unknown as CliGitProviderInternal,
		));
	}

	private _stash: StashGitSubProvider | undefined;
	get stash(): StashGitSubProvider {
		return (this._stash ??= new StashGitSubProvider(
			this.context,
			this._git,
			this._cache,
			this as unknown as CliGitProviderInternal,
		));
	}

	private _status: StatusGitSubProvider | undefined;
	get status(): StatusGitSubProvider {
		return (this._status ??= new StatusGitSubProvider(
			this.context,
			this._git,
			this._cache,
			this as unknown as CliGitProviderInternal,
		));
	}

	private _tags: TagsGitSubProvider | undefined;
	get tags(): TagsGitSubProvider {
		return (this._tags ??= new TagsGitSubProvider(
			this.context,
			this._git,
			this._cache,
			this as unknown as CliGitProviderInternal,
		));
	}

	private _worktrees: WorktreesGitSubProvider | undefined;
	get worktrees(): WorktreesGitSubProvider {
		return (this._worktrees ??= new WorktreesGitSubProvider(
			this.context,
			this._git,
			this._cache,
			this as unknown as CliGitProviderInternal,
		));
	}

	getAbsoluteUri(pathOrUri: string | Uri, base: string | Uri): Uri {
		const baseUri = typeof base !== 'string' ? base : fileUri(base);
		if (typeof pathOrUri !== 'string') return pathOrUri;
		if (maybeUri(pathOrUri)) return parseUri(pathOrUri);
		if (path.isAbsolute(pathOrUri)) return fileUri(pathOrUri);
		return joinUriPath(baseUri, pathOrUri);
	}

	getRelativePath(pathOrUri: string | Uri, base: string | Uri): string {
		const [relativePath] = splitPath(toFsPath(pathOrUri), toFsPath(base));
		return relativePath;
	}

	async excludeIgnoredUris(repoPath: string, uris: Uri[]): Promise<Uri[]> {
		const filter = this.getIgnoreFilter(repoPath);
		await filter.ready();
		return uris.filter(uri => {
			const relativePath = normalizePath(path.relative(repoPath, toFsPath(uri)));
			return !relativePath || !filter.isIgnored(relativePath);
		});
	}

	async getIgnoredUrisFilter(repoPath: string): Promise<(uri: Uri) => boolean> {
		const filter = this.getIgnoreFilter(repoPath);
		await filter.ready();
		return (uri: Uri) => {
			const relativePath = normalizePath(path.relative(repoPath, toFsPath(uri)));
			return relativePath ? filter.isIgnored(relativePath) : false;
		};
	}

	async getLastFetchedTimestamp(repoPath: string): Promise<number | undefined> {
		return this._cache.getLastFetchedTimestamp(repoPath, async (commonPath): Promise<number | undefined> => {
			const gitDir = await this.config.getGitDir?.(commonPath);
			if (gitDir == null) return undefined;

			const gitDirUri = gitDir.commonUri ?? gitDir.uri;
			const fetchHeadUri = joinUriPath(gitDirUri, 'FETCH_HEAD');
			const stats = await this.context.fs.stat(fetchHeadUri);
			// If the file is empty, assume the fetch failed, and don't update the timestamp
			if (stats != null && stats.size > 0) return stats.mtime;

			return undefined;
		});
	}

	getIgnoreFilter(repoPath: string): GitIgnoreFilter {
		let filter = this._cache.gitIgnore.get(repoPath);
		if (filter == null) {
			const gitDir = this._cache.gitDir.get(repoPath);
			const gitDirPath = gitDir?.uri.fsPath ?? `${repoPath}/.git`;
			filter = new GitIgnoreFilter({
				repoPath: repoPath,
				gitDirPath: gitDirPath,
				fs: this.context.fs,
				getGlobalExcludesPath:
					this.config.getConfig != null
						? async () => this.config.getConfig(repoPath, 'core.excludesFile')
						: undefined,
			});
			this._cache.gitIgnore.set(repoPath, filter);
		}
		return filter;
	}

	private async isTrackedWithDetails(
		filePath: string,
		repoPath: string,
		rev?: string,
	): Promise<{ path: string; status?: GitFileStatus; originalPath?: string } | undefined> {
		if (rev === deletedOrMissing) return undefined;

		const scope = getScopedLogger();

		try {
			const [relativePath, root] = splitPath(filePath, repoPath);

			// Check if the file exists in the working tree first (better cache reuse)
			let tracked = await this.revision.exists(root, relativePath);
			if (tracked) return { path: relativePath };

			// If a specific revision was provided, check there too
			if (rev && !isUncommitted(rev)) {
				tracked = await this.revision.exists(root, relativePath, rev);
				if (!tracked) {
					// Check the parent revision (file might have been deleted in this rev)
					tracked = await this.revision.exists(root, relativePath, `${rev}^`);
				}
			}

			return tracked ? { path: relativePath } : undefined;
		} catch (ex) {
			scope?.error(ex);
			return undefined;
		}
	}

	dispose(): void {
		this._git.dispose();
		if (this._cacheOwned) {
			this._cache.dispose();
		}
	}
}

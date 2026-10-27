import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import * as path from 'node:path';
import { env } from 'node:process';
import type { CachedGitTypes, MergeTargetsChangeEvent } from '@gitlens/git/cache.js';
import { Cache, resetDropsPendingRuns } from '@gitlens/git/cache.js';
import type { GitServiceContext } from '@gitlens/git/context.js';
import type { GitFileStatus } from '@gitlens/git/models/fileStatus.js';
import type { RepositoryChange } from '@gitlens/git/models/repository.js';
import { deletedOrMissing } from '@gitlens/git/models/revision.js';
import type { GitOperationRunOptions } from '@gitlens/git/providers/operations.js';
import type {
	AnnouncedRepositoryChanges,
	GitProvider,
	GitProviderDescriptor,
} from '@gitlens/git/providers/provider.js';
import type { GitCommandPriority } from '@gitlens/git/run.types.js';
import { parseGitRemoteUrl } from '@gitlens/git/utils/remote.utils.js';
import { isUncommitted } from '@gitlens/git/utils/revision.utils.js';
import { getRefChangeKind } from '@gitlens/git/watching/changeEvent.js';
import { GitIgnoreFilter } from '@gitlens/git/watching/gitIgnoreFilter.js';
import { sanitizeIgnoredWorktreeFolders } from '@gitlens/git/watching/watcherPatterns.js';
import { isCancellationError } from '@gitlens/utils/cancellation.js';
import type { Event } from '@gitlens/utils/event.js';
import { Emitter } from '@gitlens/utils/event.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import { joinPaths, maybeUri, normalizePath, splitPath } from '@gitlens/utils/path.js';
import { cancellable } from '@gitlens/utils/promise.js';
import { iterateByDelimiter } from '@gitlens/utils/string.js';
import type { Uri } from '@gitlens/utils/uri.js';
import { fileUri, joinUriPath, parseUri, toFsPath } from '@gitlens/utils/uri.js';
import { worktreeSharedChanges } from './exec/commandClassifier.js';
import { fsExists } from './exec/exec.js';
import type { FilteredGitFeatures, GitFeatureOrPrefix, GitFeatures } from './exec/features.js';
import type { GitFeatureUnsupportedMessage, GitOptions, NamedRefs } from './exec/git.js';
import { batchLiteralPathspecs, Git, gitConfigsStatus } from './exec/git.js';
import { readCommonGitDir, readHeadState } from './exec/headState.js';
import type { GitLocation } from './exec/locator.js';
import { foldMatchingIgnored } from './parsers/statusParser.js';
import { BlameGitSubProvider } from './providers/blame.js';
import { BranchesGitSubProvider } from './providers/branches.js';
import { CommitsGitSubProvider } from './providers/commits.js';
import { ConfigGitSubProvider, isGitBooleanFalse, parseGitBoolean } from './providers/config.js';
import { ContributorsGitSubProvider } from './providers/contributors.js';
import { DiffGitSubProvider } from './providers/diff.js';
import { GraphGitSubProvider } from './providers/graph.js';
import { MaintenanceGitSubProvider } from './providers/maintenance.js';
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

/** How long reading the folders whose worktrees are ignored may take before it counts as failed (a hung mount) */
const ignoredWorktreeRootsTimeoutMs = 5000;

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
	/**
	 * Whether repositories reached through this provider are on the LOCAL filesystem. `false` disables the
	 * maintenance sub-provider entirely (Live Share): its probes stat local paths, and its writes are
	 * rejected by the host's command allowlist, so inheriting it yields empty reports and swallowed
	 * failures rather than an honest "unsupported here". Defaults to `true`.
	 */
	localRepositories?: boolean;
	/**
	 * Folders, relative to a repository's common git dir, whose worktrees core acts as if didn't exist: they are left out
	 * of worktree lists, and their add, remove, lock, unlock or move run through `notify: 'infer'`, and the watcher's
	 * reports of their admin entries, raise no `worktrees` change. The typed worktree writes still announce one. A host
	 * registers one for a tool's throwaway worktrees, which no host shows (sync-tools' `sync-tools-worktrees`, for one).
	 * Nothing else is ignored, since a user may keep real worktrees anywhere, the git dir included. A folder that isn't
	 * a literal path strictly inside the common git dir, or that lies under `worktrees`, is dropped.
	 */
	ignoredWorktreeFolders?: readonly string[];
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
	/** The host's own hooks, before the provider wraps `cache.onReset` with its own clearing */
	private readonly _hostHooks: GitServiceContext['hooks'];
	private readonly _localRepositories: boolean;
	private readonly _ignoredWorktreeFolders: readonly string[];
	/** By common git dir, the folders whose worktrees are ignored there: a common git dir never moves while it is open */
	private readonly _ignoredWorktreeRoots = new Map<string, Promise<readonly string[]>>();

	constructor(options: CliGitProviderOptions) {
		// Every typed write announces itself through `onReset`, so the provider clears its own state there
		// rather than trusting each host to: a host with no handler still reads fresh after a write. A write
		// hard-evicts, so a caller after it never joins a read that started before it; watcher-driven clears
		// reach `Cache.clearCaches` directly and keep sharing in-flight reads.
		const hostHooks = options.context.hooks;
		this._hostHooks = hostHooks;
		this.context = {
			...options.context,
			hooks: {
				...hostHooks,
				cache: {
					...hostHooks?.cache,
					onReset: (repoPath, ...types) => {
						this._cache.evictCaches(repoPath, ...types);
						if (resetDropsPendingRuns(types)) {
							this._git.clearPendingCommands(this.getRepositoryPaths(repoPath));
						}
						hostHooks?.cache?.onReset?.(repoPath, ...types);
					},
				},
				repository: {
					...hostHooks?.repository,
					onChanged: (repoPath, changes, refs, options) => {
						// Everything the watcher would have cleared for the write, since its own file events are
						// dropped once it is announced (the typed write's `onReset` names only what it must evict)
						this.resetForChanges(repoPath, changes, undefined);
						// Worktrees share refs, tags, stash, remotes and config, so a typed write in one changes what
						// its siblings show; the host hears the shared part of it for each, and they read fresh.
						// Every path is reset before any is announced, so a read the host starts on hearing one path
						// isn't evicted by the next path's reset
						const siblings = this.getSiblingChanges(repoPath, changes);
						for (const [path, shared] of siblings) {
							this.resetForChanges(path, shared, undefined, true);
						}

						this.announceChanged(repoPath, changes, refs, options);
						if (siblings.size === 0) return;

						// Siblings share the one `.git/config`, so the write's config is as confined for them
						const sharedRefs = refs?.length ? getSharedRefs(changes, refs) : undefined;
						for (const [path, shared] of siblings) {
							this.announceChanged(path, shared, sharedRefs, options);
						}
					},
				},
			},
		};
		this._localRepositories = options.localRepositories ?? true;
		this._ignoredWorktreeFolders = sanitizeIgnoredWorktreeFolders(options.ignoredWorktreeFolders);
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

		// Wires a raw `git.run({ notify })` call back to this provider's own cache/host announcement —
		// unconditionally, so a host-supplied `options.git` gets bound exactly like one we construct here.
		this._git.bindChangeNotifier((repoPaths, changes, sharedPaths, named) =>
			this.notifyChangedCore(repoPaths, changes, undefined, sharedPaths, named),
		);
		this._git.bindHeadReader(path => readHeadState(path, this.context.fs, this._cache));
		// Bound even with no folder registered, so a `Git` shared with another provider never keeps that one's folders
		this._git.bindIgnoredWorktreeRootsReader(path => this.getIgnoredWorktreeRoots(path));
	}

	/** The underlying cache instance (for repo path registration, etc.) */
	get cache(): Cache {
		return this._cache;
	}

	get onDidChangeMergeTargets(): Event<MergeTargetsChangeEvent> {
		return this._cache.onDidChangeMergeTargets;
	}

	getIgnoredWorktreeFolders(_repoPath: string): readonly string[] {
		return this._ignoredWorktreeFolders;
	}

	/**
	 * `[]`, reading nothing, when no folder is registered. Read once per common git dir, since a worktree list rebuild
	 * and every inferred worktree write ask for them; a read that fails or doesn't settle in time (a hung mount) rejects,
	 * and isn't kept, so the next call reads again
	 */
	async getIgnoredWorktreeRoots(repoPath: string): Promise<readonly string[]> {
		if (!this._ignoredWorktreeFolders.length) return [];

		const commonGitDir = await cancellable(this.findCommonGitDir(repoPath), ignoredWorktreeRootsTimeoutMs);
		let roots = this._ignoredWorktreeRoots.get(commonGitDir);
		if (roots == null) {
			const read = cancellable(this.readIgnoredWorktreeRoots(commonGitDir), ignoredWorktreeRootsTimeoutMs);
			const entry = read.then(r => r.roots);
			roots = entry;
			this._ignoredWorktreeRoots.set(commonGitDir, entry);
			const forget = () => {
				if (this._ignoredWorktreeRoots.get(commonGitDir) === entry) {
					this._ignoredWorktreeRoots.delete(commonGitDir);
				}
			};
			// Roots missing the resolved spelling still serve this call, but a later one resolves again
			void read.then(r => (r.resolved ? undefined : forget()), forget);
		}
		return roots;
	}

	/**
	 * From the cached git dir, or the repository's own files, without running git; a repository whose files don't
	 * show it (a bare one) runs git once, and the git dir it finds is cached with the repository
	 */
	private async findCommonGitDir(repoPath: string): Promise<string> {
		const commonGitDir = await readCommonGitDir(repoPath, this.context.fs, this._cache);
		if (commonGitDir != null) return commonGitDir;

		const gitDir = await this.config.getGitDir(repoPath);
		return (gitDir.commonUri ?? gitDir.uri).fsPath;
	}

	/** `resolved` is false when the common git dir's resolved spelling couldn't be read */
	private async readIgnoredWorktreeRoots(
		commonGitDir: string,
	): Promise<{ readonly roots: readonly string[]; readonly resolved: boolean }> {
		const roots = new Set(this._ignoredWorktreeFolders.map(f => normalizePath(joinPaths(commonGitDir, f))));
		if (!this._localRepositories) return { roots: [...roots], resolved: true };

		// Only the common git dir is resolved: a folder doesn't exist until its tool first makes a worktree there
		const realCommonGitDir = await fs.realpath(commonGitDir).catch(() => undefined);
		if (realCommonGitDir == null) return { roots: [...roots], resolved: false };

		for (const folder of this._ignoredWorktreeFolders) {
			roots.add(normalizePath(joinPaths(realCommonGitDir, folder)));
		}
		return { roots: [...roots], resolved: true };
	}

	getCommonPath(repoPath: string): string | undefined {
		// An unregistered path is its own common path in the cache, which would hide a sibling worktree's writes
		return this._cache.isRegistered(repoPath) ? this._cache.getCommonPath(repoPath) : undefined;
	}

	private readonly _onDidAnnounceChanges = new Emitter<AnnouncedRepositoryChanges>();
	get onDidAnnounceChanges(): Event<AnnouncedRepositoryChanges> {
		return this._onDidAnnounceChanges.event;
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
	async ensureSupports(feature: GitFeatures, prefix: string, suffix: string): Promise<void>;
	async ensureSupports(feature: GitFeatures, message: GitFeatureUnsupportedMessage): Promise<void>;
	async ensureSupports(
		feature: GitFeatures,
		prefixOrMessage: string | GitFeatureUnsupportedMessage,
		suffix?: string,
	): Promise<void> {
		return typeof prefixOrMessage === 'function'
			? this._git.ensureSupports(feature, prefixOrMessage)
			: this._git.ensureSupports(feature, prefixOrMessage, suffix!);
	}

	/** Returns the installed git version string. */
	async version(): Promise<string> {
		return this._git.version();
	}

	/** Returns the resolved git binary path. */
	async path(): Promise<string> {
		return this._git.path();
	}

	async clone(
		url: string,
		parentPath: string,
		options?: { folderName?: string },
		runOptions?: GitOperationRunOptions,
	): Promise<string | undefined> {
		let folderPath: string;
		if (options?.folderName) {
			folderPath = joinPaths(parentPath, options.folderName);
		} else {
			const [, , remotePath] = parseGitRemoteUrl(url);
			const remoteName = remotePath.split('/').pop();
			if (!remoteName) return undefined;

			let count = 0;
			folderPath = joinPaths(parentPath, remoteName);
			while ((await fsExists(folderPath)) && count < 20) {
				count++;
				folderPath = joinPaths(parentPath, `${remoteName}-${count}`);
			}
		}

		// `throw`: the default handler swallows `remoteConnectionError`, which would return a folder never cloned
		await this._git.run({ cwd: parentPath, errors: 'throw', ...runOptions }, 'clone', url, folderPath);

		return folderPath;
	}

	/** Creates a new repository at `targetPath` (`git init`), creating it first if it doesn't yet exist. */
	async init(targetPath: string, options?: { defaultBranch?: string; bare?: boolean }): Promise<void> {
		await fs.mkdir(targetPath, { recursive: true });

		const args = ['init'];
		if (options?.defaultBranch) {
			args.push('-b', options.defaultBranch);
		}
		if (options?.bare) {
			args.push('--bare');
		}

		// Run inside the target rather than naming it from its parent: a relative `targetPath` would otherwise
		// be resolved against the parent a second time
		await this._git.run({ cwd: targetPath }, ...args);
	}

	/**
	 * Notifies the provider that `repoPath` was mutated outside of a typed sub-provider method — e.g. a
	 * consumer that ran a command through the raw `git.run`/`provider.git.run` escape hatch. Fires the same
	 * `cache.onReset`/`repository.onChanged` hooks a typed mutator would, so, exactly as after a typed write,
	 * the provider hard-evicts its own caches for `repoPath` and drops its pending commands for the repository
	 * (its sibling worktrees included) before the host's handlers run.
	 *
	 * What is reset: `options.cache` when given (`'all'` for everything, `[]` for nothing); otherwise the
	 * cache types `changes` map to, the same mapping a file watcher's changes get, status clock included.
	 * An empty `changes`, or one naming `'unknown'` or `'closed'`, resets everything. Changes that map to
	 * no cache type (e.g. `'starred'`) reset nothing, and `onReset` doesn't fire; `onChanged` always fires.
	 */
	notifyChanged(
		repoPath: string,
		changes: readonly RepositoryChange[],
		options?: { cache?: readonly CachedGitTypes[] | 'all' },
	): void {
		this.notifyChangedCore([repoPath], changes, options);
	}

	/**
	 * {@link notifyChanged} for one change seen from several paths, e.g. a `-C` shared-state verb announced
	 * for both its target and the caller's `cwd`. Each path's caches are reset and the host's `onReset` fires
	 * for each, since a host may keep per-worktree state, but a repository's pending commands are dropped once
	 * however many of its worktrees are named.
	 *
	 * Each path hears the announcement once: `repoPaths` hear all of `changes`, `sharedPaths` (reset and
	 * `onReset`-ed like `repoPaths`) and then the other registered worktrees sharing a repository with any of
	 * them (reset like a typed write's, with no `onReset`) hear the shared part of it, see
	 * {@link getSiblingChanges}. `names.refs` reach `repoPaths` whole and the others as {@link getSharedRefs}.
	 */
	private notifyChangedCore(
		repoPaths: readonly string[],
		changes: readonly RepositoryChange[],
		options?: { cache?: readonly CachedGitTypes[] | 'all' },
		sharedPaths?: readonly string[],
		names?: NamedRefs,
	): void {
		const announcements = new Map<string, readonly RepositoryChange[]>();
		for (const repoPath of repoPaths) {
			announcements.set(repoPath, [...changes]);
		}
		const shared = sharedPaths?.length ? this.getSharedChanges(changes) : undefined;
		if (shared != null) {
			for (const path of sharedPaths!) {
				if (!announcements.has(path)) {
					announcements.set(path, shared);
				}
			}
		}

		const resets: { repoPath: string; types: CachedGitTypes[] }[] = [];
		const pendingPaths = new Set<string>();
		for (const [repoPath, announced] of announcements) {
			const types = this.resetForChanges(repoPath, announced, options?.cache);
			if (types == null) {
				// A gk config change is reconciled outside the cache types, but its re-read must not join a pre-write run
				if (options?.cache == null && announced.includes('gkConfig')) {
					for (const path of this.getRepositoryPaths(repoPath)) {
						pendingPaths.add(path);
					}
				}
				continue;
			}

			resets.push({ repoPath: repoPath, types: types });
			if (resetDropsPendingRuns(types)) {
				for (const path of this.getRepositoryPaths(repoPath)) {
					pendingPaths.add(path);
				}
			}
		}

		// The worktrees no one named: their shared refs, tags, stash, remotes and config just changed too
		const named = [...announcements.keys()];
		for (const repoPath of named) {
			for (const [path, siblingChanges] of this.getSiblingChanges(repoPath, changes)) {
				if (announcements.has(path)) continue;

				announcements.set(path, siblingChanges);
				this.resetForChanges(path, siblingChanges, options?.cache, true);
			}
		}

		if (pendingPaths.size) {
			this._git.clearPendingCommands([...pendingPaths]);
		}
		for (const { repoPath, types } of resets) {
			this._hostHooks?.cache?.onReset?.(repoPath, ...types);
		}
		// The host's own hook: `context.hooks.repository.onChanged` also fans out to siblings, which would
		// announce a path a second time
		const sharedRefs = names?.refs.length ? getSharedRefs(changes, names.refs) : undefined;
		for (const [path, announced] of announcements) {
			this.announceChanged(path, [...announced], repoPaths.includes(path) ? names?.refs : sharedRefs, names);
		}
	}

	/**
	 * Tells only the host's own `repository.onChanged` about `changes` — for a follow-up that is not a write of
	 * core's, such as re-announcing an outside change once it was reconciled. Nothing is evicted, no sibling hears
	 * it, and the watch layer doesn't take it for a write's announcement.
	 */
	notifyHost(repoPath: string, changes: RepositoryChange[]): void {
		this._hostHooks?.repository?.onChanged?.(repoPath, changes);
	}

	/**
	 * Tells the host about a write for one path, after its caches were reset — the watch layer hears of it first.
	 * `refs` are the full ref names the write moved, when it knows them, and `options.configConfinedToRefs` confines
	 * its `config` change to the sections of the local branches among them (see `GitServiceHooks.repository.onChanged`);
	 * the confinement is passed on only with `config` among `changes` and a branch in `refs` to confine it to.
	 */
	private announceChanged(
		repoPath: string,
		changes: RepositoryChange[],
		refs?: readonly string[],
		options?: { readonly configConfinedToRefs?: boolean },
	): void {
		if (refs?.length) {
			if (
				options?.configConfinedToRefs === true &&
				changes.includes('config') &&
				refs.some(r => r.startsWith('refs/heads/'))
			) {
				this._onDidAnnounceChanges.fire({
					repoPath: repoPath,
					changes: changes,
					refs: refs,
					configConfinedToRefs: true,
				});
				this._hostHooks?.repository?.onChanged?.(repoPath, changes, refs, { configConfinedToRefs: true });
				return;
			}

			this._onDidAnnounceChanges.fire({ repoPath: repoPath, changes: changes, refs: refs });
			this._hostHooks?.repository?.onChanged?.(repoPath, changes, refs);
			return;
		}

		this._onDidAnnounceChanges.fire({ repoPath: repoPath, changes: changes });
		this._hostHooks?.repository?.onChanged?.(repoPath, changes);
	}

	/**
	 * What the worktrees sharing a repository hear of `changes` that ran in one of them: the part worktrees
	 * share (see {@link worktreeSharedChanges}), or `undefined` when `changes` has none. An empty `changes` or
	 * `'unknown'` means everything may have changed, so it reaches them as every shared kind — never as
	 * `'unknown'` itself, which a host treats as the end of a watch session; `'closed'` concerns the one path
	 * alone and reaches none.
	 */
	private getSharedChanges(changes: readonly RepositoryChange[]): RepositoryChange[] | undefined {
		if (changes.includes('closed')) return undefined;
		if (!changes.length || changes.includes('unknown')) return [...worktreeSharedChanges];

		const shared = changes.filter(c => worktreeSharedChanges.has(c));
		return shared.length ? shared : undefined;
	}

	/** What each registered worktree sharing `repoPath`'s repository, other than `repoPath`, hears of `changes`. */
	private getSiblingChanges(repoPath: string, changes: readonly RepositoryChange[]): Map<string, RepositoryChange[]> {
		const siblings = new Map<string, RepositoryChange[]>();
		const shared = this.getSharedChanges(changes);
		if (shared == null) return siblings;

		const self = normalizePath(repoPath);
		for (const path of this._cache.getWorktreePaths(this._cache.getCommonPath(repoPath))) {
			if (path !== self) {
				siblings.set(path, [...shared]);
			}
		}
		return siblings;
	}

	/**
	 * Evicts what a notified change reset for `repoPath`: the types reset (`[]` = all), or `undefined` for none.
	 * A `sibling` shares its repository with a path already reset for the same change, which evicted the shared
	 * entries for every worktree, so the changes evict only its own entries and advance its status clock.
	 */
	private resetForChanges(
		repoPath: string,
		changes: readonly RepositoryChange[],
		cache: readonly CachedGitTypes[] | 'all' | undefined,
		sibling: boolean = false,
	): CachedGitTypes[] | undefined {
		if (cache != null && cache !== 'all') {
			if (!cache.length) return undefined;

			this._cache.evictCaches(repoPath, ...cache);
			return [...cache];
		}

		if (cache === 'all' || !changes.length || changes.some(c => c === 'unknown' || c === 'closed')) {
			this._cache.evictCaches(repoPath);
			return [];
		}

		const types = this._cache.applyRepositoryChanges(
			repoPath,
			changes,
			'evict',
			sibling ? { worktreeOnly: true } : undefined,
		);
		return types.length ? types : undefined;
	}

	/** `repoPath` and every worktree registered as sharing its repository, since a shared-ref write moves them all. */
	private getRepositoryPaths(repoPath: string): string[] {
		const commonPath = this._cache.getCommonPath(repoPath);
		return [...new Set([repoPath, commonPath, ...this._cache.getWorktreePaths(commonPath)])];
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

	private _maintenance: MaintenanceGitSubProvider | undefined;
	// Optional so subclasses whose repos aren't local can report the capability as absent — see
	// `VslsGitProvider`. Consumers already treat `maintenance == null` as "unsupported here" (web builds
	// never register it at all).
	get maintenance(): MaintenanceGitSubProvider | undefined {
		if (!this._localRepositories) return undefined;

		return (this._maintenance ??= new MaintenanceGitSubProvider(
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
			this._ignoredWorktreeFolders.length ? path => this.getIgnoredWorktreeRoots(path) : undefined,
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
				// Resolved the way git resolves it; unset, git reads its default location instead
				getGlobalExcludesPath: async () => {
					const { excludesFile: configured } = await this.config.getIgnoreConfig(repoPath);
					return configured != null
						? resolveGitPathConfig(configured, repoPath)
						: getDefaultGlobalExcludesPath();
				},
				// `info/exclude` lives in the COMMON git dir — a linked worktree's own git dir has none
				getInfoExcludePath: async () => {
					const gitDir = await this.config.getGitDir?.(repoPath);
					if (gitDir == null) return undefined;

					return `${(gitDir.commonUri ?? gitDir.uri).fsPath}/info/exclude`;
				},
				getGitIgnorePaths: () => this.getGitIgnorePaths(repoPath),
				getIgnoreCase: async () => {
					const { ignoreCase: value } = await this.config.getIgnoreConfig(repoPath);
					if (value == null) return undefined;
					if (parseGitBoolean(value)) return true;

					return isGitBooleanFalse(value) ? false : undefined;
				},
			});
			this._cache.gitIgnore.set(repoPath, filter);
		}
		return filter;
	}

	async getIgnoredDirectories(repoPath: string, cancellation?: AbortSignal): Promise<string[]> {
		// `--directory` collapses a directory to one entry when everything in it is ignored — which includes
		// directories no rule matches whose current contents merely happen to be ignored (a `logs/` holding only
		// `*.log` files under a `*.log` rule), so each candidate is confirmed against the rules below
		const listed = await this._git.run(
			{ cwd: repoPath, errors: 'throw', cancellation: cancellation },
			'ls-files',
			'-z',
			'--others',
			'--ignored',
			'--exclude-standard',
			'--directory',
		);

		const candidates: string[] = [];
		for (const entry of iterateByDelimiter(listed.stdout, '\0')) {
			if (entry.length > 1 && entry.endsWith('/')) {
				candidates.push(entry);
			}
		}
		if (!candidates.length) return [];

		const confirmed = await this.getIgnoredPaths(repoPath, candidates, undefined, cancellation);

		const directories: string[] = [];
		for (const entry of confirmed) {
			// Never `.git` itself, and no name a watcher would read as a pattern
			if (entry.length < 2 || !entry.endsWith('/') || /[*?[\]{}()!+@\\]/.test(entry)) continue;

			const directory = entry.substring(0, entry.length - 1);
			if (directory === '.git') continue;

			directories.push(directory);
		}

		// A path sorts after every prefix of it, so an entry's ancestors have already been kept (or not) by the time it
		// is checked — and the kept set comes out sorted
		directories.sort();

		const kept = new Set<string>();
		for (const directory of directories) {
			let beneathKept = false;
			for (let i = directory.indexOf('/'); i !== -1; i = directory.indexOf('/', i + 1)) {
				if (kept.has(directory.substring(0, i))) {
					beneathKept = true;
					break;
				}
			}
			if (!beneathKept) {
				kept.add(directory);
			}
		}

		return [...kept];
	}

	async getIgnoredEntries(
		repoPath: string,
		options?: { paths?: readonly string[]; priority?: GitCommandPriority },
		cancellation?: AbortSignal,
	): Promise<string[]> {
		let paths = options?.paths;
		// No pathspec means "everything" to git, which is not what an empty list asks for
		if (paths != null && !paths.length) return [];

		// A scope inside an ignored folder makes git list the folder itself, or fail outright, so a scope that is
		// itself ignored is answered here, as one entry, and left out of the listing
		const scopedEntries = new Set<string>();
		if (paths != null) {
			const scopes = [...new Set(paths.map(p => (p.length > 1 ? p.replace(/\/+$/, '') : p)))];
			const ignoredScopes = await this.getIgnoredScopes(
				repoPath,
				scopes.filter(p => p !== ''),
				options?.priority,
				cancellation,
			);

			const ignored = [...ignoredScopes];
			// `lstat`, as git lists a symlink as a file even when it points at a folder
			const listed = await Promise.allSettled(
				ignored.map(async scope => {
					const fullPath = path.join(repoPath, scope);
					if (!(await fs.lstat(fullPath)).isDirectory()) return scope;

					return (await hasNonDirectoryEntry(fullPath)) ? `${scope}/` : undefined;
				}),
			);
			for (const result of listed) {
				// Not on disk, so nothing is ignored there
				if (result.status === 'fulfilled' && result.value != null) {
					scopedEntries.add(result.value);
				}
			}

			paths = scopes.filter(p => !ignoredScopes.has(p));
			if (!paths.length) return [...scopedEntries].sort();
		}

		// `status --ignored` walks every ignored tree, and `ls-files --directory` drops the ignored entries inside a
		// new untracked folder, so status is asked only about those folders
		const args = ['ls-files', '-z', '--others', '--exclude-standard', '--directory', '--no-empty-directory'];
		const runOptions = {
			cwd: repoPath,
			errors: 'throw',
			cancellation: cancellation,
			priority: options?.priority,
		} as const;

		const readListing = async (extra: readonly string[]): Promise<Set<string>> => {
			const listed = new Set<string>();
			const prefix = [...args, ...extra];
			for (const batch of paths != null ? batchLiteralPathspecs(paths, prefix) : [undefined]) {
				const result = await this._git.run(runOptions, ...prefix, ...(batch != null ? ['--', ...batch] : []));
				for (const entry of iterateByDelimiter(result.stdout, '\0')) {
					if (entry !== '') {
						listed.add(entry);
					}
				}
			}
			return listed;
		};

		const [ignoredResult, untrackedResult] = await Promise.allSettled([
			readListing(['--ignored']),
			readListing([]),
		]);
		if (ignoredResult.status === 'rejected') throw ignoredResult.reason;
		if (untrackedResult.status === 'rejected') throw untrackedResult.reason;

		const entries = new Set<string>(scopedEntries);
		for (const entry of ignoredResult.value) {
			if (entry !== '.git/') {
				entries.add(entry);
			}
		}

		const folders: string[] = [];
		for (const entry of untrackedResult.value) {
			if (entry.endsWith('/')) {
				folders.push(entry);
			}
		}
		if (!folders.length) return [...entries].sort();

		// `matching` reports a folder an ignore rule matches without walking it, but lists each file of a folder that is
		// ignored only because all of its files are, so `all` untracked files are needed to fold those back
		const matching = await this._git.supports('git:status:ignored-matching');
		const prefix = [
			'status',
			'--porcelain',
			'-z',
			matching ? '--ignored=matching' : '--ignored',
			matching ? '--untracked-files=all' : '--untracked-files=normal',
			'--ignore-submodules=all',
		];

		const records: string[] = [];
		for (const batch of batchLiteralPathspecs(folders, prefix)) {
			const listed = await this._git.run(
				{
					...runOptions,
					configs: [...gitConfigsStatus, '-c', 'status.renames=false'],
					env: { GIT_OPTIONAL_LOCKS: '0' },
				},
				...prefix,
				'--',
				...batch,
			);

			// Only untracked folders are in scope, so there are no tracked entries, and no rename pairs, to step over
			for (const record of iterateByDelimiter(listed.stdout, '\0')) {
				if (matching) {
					records.push(record);
				} else if (record.startsWith('!! ')) {
					entries.add(record.substring(3));
				}
			}
		}

		if (matching) {
			for (const entry of foldMatchingIgnored(records)) {
				entries.add(entry);
			}
		}
		return [...entries].sort();
	}

	/**
	 * Which of `scopes` are ignored. `check-ignore` dies on a path inside a submodule or beyond a symlink, where this
	 * repository ignores nothing, so a failed batch is bisected, one half at a time, and a scope that fails alone is
	 * not ignored. That costs about 2·k·log2(N) runs for k bad scopes, rather than a burst of N at once.
	 */
	private async getIgnoredScopes(
		repoPath: string,
		scopes: readonly string[],
		priority: GitCommandPriority | undefined,
		cancellation: AbortSignal | undefined,
	): Promise<Set<string>> {
		try {
			return await this.getIgnoredPaths(repoPath, scopes, { priority: priority }, cancellation);
		} catch (ex) {
			if (isCancellationError(ex)) throw ex;
			if (scopes.length < 2) return new Set();
		}

		const middle = scopes.length >> 1;
		const ignored = await this.getIgnoredScopes(repoPath, scopes.slice(0, middle), priority, cancellation);
		for (const scope of await this.getIgnoredScopes(repoPath, scopes.slice(middle), priority, cancellation)) {
			ignored.add(scope);
		}
		return ignored;
	}

	async getIgnoredPaths(
		repoPath: string,
		paths: readonly string[],
		options?: { priority?: GitCommandPriority },
		cancellation?: AbortSignal,
	): Promise<Set<string>> {
		if (!paths.length) return new Set();

		// check-ignore reads each line as a pathspec, so a leading `:` would be parsed as magic; `./` makes it a literal path
		let prefixed: Map<string, string> | undefined;
		const lines = paths.map(p => {
			if (!p.startsWith(':')) return p;

			const sent = `./${p}`;
			(prefixed ??= new Map()).set(sent, p);
			return sent;
		});

		// Exits 1 when nothing matches, which is an answer
		const result = await this._git.run(
			{
				cwd: repoPath,
				errors: 'throw',
				cancellation: cancellation,
				priority: options?.priority,
				stdin: `${lines.join('\0')}\0`,
				expectedExitCodes: [1],
			},
			'check-ignore',
			'-z',
			'--stdin',
		);

		const ignored = new Set<string>();
		let given: Set<string> | undefined;
		for (const entry of iterateByDelimiter(result.stdout, '\0')) {
			if (!entry.length) continue;

			const original = prefixed?.get(entry);
			if (original != null) {
				ignored.add(original);
				// The caller may have spelled the same file as `./:…` too, and gets that spelling back as well
				if (!(given ??= new Set(paths)).has(entry)) continue;
			}

			ignored.add(entry);
		}
		return ignored;
	}

	/** Every `.gitignore` git reads in the working tree (tracked, or untracked and not itself ignored), root included */
	private async getGitIgnorePaths(repoPath: string): Promise<string[]> {
		const result = await this._git.run(
			{ cwd: repoPath, errors: 'throw' },
			'ls-files',
			'-z',
			'--cached',
			'--others',
			'--exclude-standard',
			'--',
			':(glob)**/.gitignore',
		);

		const paths: string[] = [];
		for (const line of iterateByDelimiter(result.stdout, '\0')) {
			if (!line.length) continue;

			paths.push(line);
		}
		return paths;
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
		this._onDidAnnounceChanges.dispose();
		this._git.dispose();
		if (this._cacheOwned) {
			this._cache.dispose();
		}
	}
}

/**
 * The names in `refs` a sibling worktree hears with the shared part of `changes`: those of a shared ref kind among
 * `changes`. An empty `changes` or `'unknown'` reaches siblings as every shared kind, unnamed, so none.
 */
function getSharedRefs(changes: readonly RepositoryChange[], refs: readonly string[]): string[] | undefined {
	if (!changes.length || changes.includes('unknown')) return undefined;

	const shared = refs.filter(r => {
		if (!r.startsWith('refs/')) return false;

		const kind = getRefChangeKind(r);
		return kind != null && changes.includes(kind) && worktreeSharedChanges.has(kind);
	});
	return shared.length ? shared : undefined;
}

/**
 * Resolves a pathname config value the way git does: a leading `~/` (or a bare `~`) is the home directory, and a
 * relative path is taken from the repository root. Done here rather than with `git config --type=path`, which needs
 * git 2.18, newer than the minimum supported version.
 */
function resolveGitPathConfig(value: string, repoPath: string): string {
	if (value === '~' || value.startsWith('~/')) {
		return path.join(env.HOME || homedir(), value.substring(1));
	}

	return path.resolve(repoPath, value);
}

/** Where git reads global excludes when `core.excludesFile` is unset: `$XDG_CONFIG_HOME/git/ignore`, else `$HOME/.config/git/ignore` */
function getDefaultGlobalExcludesPath(): string | undefined {
	const xdgConfigHome = env.XDG_CONFIG_HOME;
	if (xdgConfigHome) return path.join(xdgConfigHome, 'git', 'ignore');

	const home = env.HOME || homedir();
	return home ? path.join(home, '.config', 'git', 'ignore') : undefined;
}

/** Whether a folder holds a file or symlink anywhere below it, as git lists no folder without one; an unreadable folder holds none */
async function hasNonDirectoryEntry(folder: string): Promise<boolean> {
	const pending = [folder];
	while (pending.length) {
		const current = pending.pop()!;
		try {
			for (const entry of await fs.readdir(current, { withFileTypes: true })) {
				if (!entry.isDirectory()) return true;

				pending.push(path.join(current, entry.name));
			}
		} catch {}
	}
	return false;
}

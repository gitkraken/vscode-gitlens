import { env } from 'node:process';
import { GitService } from '@gitlens/git/service.js';
import type { FileWatchingProvider } from '@gitlens/git/watching/provider.js';
import { UnwatchedCacheValidator } from '@gitlens/git/watching/unwatchedCacheValidator.js';
import { isNotFound } from '@gitlens/git/watching/watchGroup.js';
import type { WatchPollingOptions } from '@gitlens/git/watching/watchService.js';
import type { WorktreeSummaryServiceOptions } from '@gitlens/git/watching/worktreeSummary.js';
import { fileUri } from '@gitlens/utils/uri.js';
import type { CliGitProviderOptions } from './cliGitProvider.js';
import { CliGitProvider } from './cliGitProvider.js';
import type { GitLocation } from './exec/locator.js';
import { findGitPath } from './exec/locator.js';

/**
 * Options for {@link createCliGitService}.
 */
export interface CliGitServiceOptions {
	/**
	 * Path(s) to the git binary.
	 * Auto-detected if omitted (searches PATH, platform-specific locations).
	 * Ignored when {@link locator} is provided.
	 */
	gitPath?: string | string[];

	/**
	 * Custom git binary resolver. When provided, used instead of the
	 * default `findGitPath(gitPath)` lookup.
	 */
	locator?: () => Promise<GitLocation>;

	/** Host-provided context hooks (cache events, workspace, integrations, telemetry, fs) */
	context: CliGitProviderOptions['context'];

	/**
	 * Git execution options passed through to the underlying Git executor. `gitOptions.isTrusted(repoPath)` is the
	 * per-repository trust gate: a `false` answer rejects git runs in that path with `WorkspaceUntrustedError` before
	 * any process starts. It applies only when `context.workspace.isTrusted` is unset; that flag wins when present.
	 */
	gitOptions?: CliGitProviderOptions['gitOptions'];

	/** Use an existing Cache instance, or one will be created */
	cache?: CliGitProviderOptions['cache'];

	/** Folders, relative to a repository's common git dir, whose worktrees core acts as if didn't exist */
	ignoredWorktreeFolders?: CliGitProviderOptions['ignoredWorktreeFolders'];

	/** Refreshes a checkout's index after core's own writes rewrote it (see `CliGitProviderOptions`); off by default */
	refreshIndexAfterWrites?: CliGitProviderOptions['refreshIndexAfterWrites'];

	/**
	 * Filesystem watching provider. When provided, the {@link GitService}
	 * will watch repositories for changes (file creates, edits, deletes).
	 */
	watchingProvider?: FileWatchingProvider;

	/**
	 * Polls in place of (or beside) the watchers {@link watchingProvider} reports it can't trust. When omitted, no
	 * watcher is asked.
	 */
	watchPolling?: WatchPollingOptions;

	/**
	 * Keeps the caches that never expire (branches, current branch, refs, tags, remotes, worktrees, stashes, gk config,
	 * paused operation, and what derives from them) fresh for repositories whose `.git` directory nothing watches:
	 * before such a read, stats the files a watcher would have reported, and lists the ref directories and worktree
	 * admin entries, applying what moved as a watcher event would. Files git writes by rename are read only once the
	 * directory they're in moved, so a read of an idle repository costs a stat per git dir, per ref directory, per
	 * linked worktree and per file git writes in place, at most once per 250ms per repository; a watched one costs
	 * nothing, unless its watch is suspended, which holds what it hears until it resumes. Never runs git: a repository
	 * whose git dir nothing resolved yet is read from its own files, and one whose files can't show it (bare, a
	 * submodule, `--separate-git-dir`, `core.worktree`) isn't validated until a read resolves it, its files looked at
	 * again every 30 seconds. What moves in a worktree under an {@link ignoredWorktreeFolders} folder clears nothing. Without a
	 * {@link watchingProvider}, every repository counts as unwatched. A read waits at most `timeoutMs` (default 1000)
	 * for the stats, then is served from the cache, and the stats run one at a time per repository and two at once
	 * overall. A stat on a hung mount holds one of Node's file-system threads until it returns; one outstanding past
	 * `timeoutMs` lets other repositories' stats go on, as long as the stats hold all but two of the threads
	 * (`UV_THREADPOOL_SIZE`, default 4), which leaves the host two. Off by default.
	 */
	validateUnwatchedCaches?: boolean | { readonly timeoutMs?: number };

	/** For tests only; production never passes it (see `WorktreeSummaryServiceOptions.verifyBaseRemeasure`) */
	verifyBaseRemeasure?: WorktreeSummaryServiceOptions['verifyBaseRemeasure'];
}

/**
 * Creates a ready-to-use {@link GitService} backed by the CLI git provider.
 *
 * This is the primary entry point for standalone (non-VS Code) consumers
 * of the `@gitlens/git-cli` library. It creates a singleton {@link GitService},
 * wires up a {@link CliGitProvider}, and registers it for all repository paths.
 *
 * @example
 * ```typescript
 * const git = createCliGitService({ context: {} });
 *
 * const repo = git.forRepo('/path/to/repo')!;
 * const branches = await repo.branches.getBranches();
 * const status = await repo.status.getStatus();
 * await repo.ops!.fetch({ remote: 'origin' });
 *
 * git.dispose(); // cleans up provider, cache, and module-level state
 * ```
 */
export function createCliGitService(options: CliGitServiceOptions): GitService {
	const service = GitService.createSingleton(options.watchingProvider, {
		watchPolling: options.watchPolling,
		verifyBaseRemeasure: options.verifyBaseRemeasure,
		// The host's file system reads the shared `.git/config` the watch service compares reports of
		readFile: path => options.context.fs.readFile(fileUri(path)),
		// And lists the directory the admin entries of its worktrees are in
		readDirectory: path => options.context.fs.readDirectory(fileUri(path)),
	});

	const locator = options.locator ?? (() => findGitPath(options.gitPath ?? null));
	const provider = new CliGitProvider({
		context: options.context,
		locator: locator,
		gitOptions: options.gitOptions,
		cache: options.cache,
		ignoredWorktreeFolders: options.ignoredWorktreeFolders,
		refreshIndexAfterWrites: options.refreshIndexAfterWrites,
	});

	service.register(provider, () => true);

	if (options.validateUnwatchedCaches) {
		const fs = options.context.fs;
		const validator = new UnwatchedCacheValidator({
			cache: provider.cache,
			timeoutMs:
				typeof options.validateUnwatchedCaches === 'object'
					? options.validateUnwatchedCaches.timeoutMs
					: undefined,
			maxFsThreads: getThreadPoolSize() - 2,
			stat: async path => {
				try {
					const stat = await fs.stat(fileUri(path));
					return stat != null ? { mtime: stat.mtime, size: stat.size } : undefined;
				} catch (ex) {
					if (isNotFound(ex)) return undefined;

					throw ex;
				}
			},
			readDirectory: path => fs.readDirectory(fileUri(path)),
			readFile: async path => {
				try {
					return await fs.readFile(fileUri(path));
				} catch (ex) {
					if (isNotFound(ex)) return undefined;

					throw ex;
				}
			},
			// Only for a path whose git dir is cached, which it finds the common git dir from without running git
			getIgnoredWorktreeRoots: repoPath =>
				provider.cache.gitDir.get(repoPath) != null
					? provider.getIgnoredWorktreeRoots(repoPath)
					: Promise.resolve([]),
			resolveGitDir: repoPath => provider.config.resolveGitDirWithoutGit(repoPath),
			// The watch service keys repositories as the cache does (`getRepositoryKey` normalizes a file path alike)
			isWatched: repoPath => service.watchService?.isRepoWatched(repoPath) ?? false,
		});
		provider.cache.setReadValidator(
			repoPath => validator.validate(repoPath),
			() => validator.getResourceUsage(),
		);
		service.watchService?.onDidChangeRepoWatched(e => {
			if (e.watched) {
				validator.onWatched(e.repoPath);
			} else {
				validator.onUnwatched(e.repoPath);
			}
		});
	}

	// Advance the provider cache's status generation clock from the watch session's global events — the standalone
	// analogue of what the VS Code host wires in `GitProviderService`. Without this, a consumer that passes a
	// `watchingProvider` and drives watch sessions gets FS events but a FROZEN clock, so `dedupeByStatusGeneration`
	// degrades to the pre-change/post-change stale-join this branch exists to fix. Standalone has no `Repository`
	// models, so there are no force-fired `closed`/`lastFetched` bypassing the session for the global repo event to
	// miss. Subscriptions are torn down with the service (its `watchService`'s emitters are disposed on dispose).
	service.watchService?.onDidChangeWorkingTree(repoPath => provider.cache.onWorkingTreeChanged(repoPath));
	// Announced kinds were evicted when core announced its write; evicting them again would discard what the host
	// re-read since
	service.watchService?.onDidChangeRepository(e => {
		const changes = e.getUnannouncedChanges();
		if (changes.length) {
			provider.cache.onRepositoryChanged(e.repoPath, changes, { movedWorktrees: e.movedWorktrees });
		}
	});
	// FETCH_HEAD maps to no session change, and there's no `Repository` model here to force-fire `lastFetched` (as
	// the VS Code host does), so bridge it straight to the cache or the last-fetched time is never re-read.
	service.watchService?.onDidChangeFetchHead(repoPath =>
		provider.cache.onRepositoryChanged(repoPath, ['lastFetched']),
	);
	return service;
}

/** The size of libuv's thread pool, which runs Node's file-system calls, as libuv reads it at its first use */
function getThreadPoolSize(): number {
	const size = Number.parseInt(env.UV_THREADPOOL_SIZE ?? '', 10);
	return Number.isNaN(size) ? 4 : Math.min(Math.max(size, 1), 1024);
}

import { GitService } from '@gitlens/git/service.js';
import type { FileWatchingProvider } from '@gitlens/git/watching/provider.js';
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

	/** Git execution options passed through to the underlying Git executor */
	gitOptions?: CliGitProviderOptions['gitOptions'];

	/** Use an existing Cache instance, or one will be created */
	cache?: CliGitProviderOptions['cache'];

	/** Folders, relative to a repository's common git dir, whose worktrees core acts as if didn't exist */
	ignoredWorktreeFolders?: CliGitProviderOptions['ignoredWorktreeFolders'];

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
	});

	service.register(provider, () => true);

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
			provider.cache.onRepositoryChanged(e.repoPath, changes);
		}
	});
	// FETCH_HEAD maps to no session change, and there's no `Repository` model here to force-fire `lastFetched` (as
	// the VS Code host does), so bridge it straight to the cache or the last-fetched time is never re-read.
	service.watchService?.onDidChangeFetchHead(repoPath =>
		provider.cache.onRepositoryChanged(repoPath, ['lastFetched']),
	);
	return service;
}

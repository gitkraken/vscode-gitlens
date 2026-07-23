import { GitService } from '@gitlens/git/service.js';
import type { FileWatchingProvider } from '@gitlens/git/watching/provider.js';
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

	/**
	 * Filesystem watching provider. When provided, the {@link GitService}
	 * will watch repositories for changes (file creates, edits, deletes).
	 */
	watchingProvider?: FileWatchingProvider;
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
	const service = GitService.createSingleton(options.watchingProvider);

	const locator = options.locator ?? (() => findGitPath(options.gitPath ?? null));
	const provider = new CliGitProvider({
		context: options.context,
		locator: locator,
		gitOptions: options.gitOptions,
		cache: options.cache,
	});

	service.register(provider, () => true);

	// Advance the provider cache's status generation clock from the watch session's global events — the standalone
	// analogue of what the VS Code host wires in `GitProviderService`. Without this, a consumer that passes a
	// `watchingProvider` and drives watch sessions gets FS events but a FROZEN clock, so `dedupeByStatusGeneration`
	// degrades to the pre-change/post-change stale-join this branch exists to fix. Standalone has no `Repository`
	// models, so there are no force-fired `closed`/`lastFetched` bypassing the session for the global repo event to
	// miss. Subscriptions are torn down with the service (its `watchService`'s emitters are disposed on dispose).
	service.watchService?.onDidChangeWorkingTree(repoPath => provider.cache.onWorkingTreeChanged(repoPath));
	service.watchService?.onDidChangeRepository(e => provider.cache.onRepositoryChanged(e.repoPath, e.changes));

	return service;
}

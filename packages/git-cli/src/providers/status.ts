import type { Cache } from '@gitlens/git/cache.js';
import type { GitServiceContext } from '@gitlens/git/context.js';
import type { GitFile } from '@gitlens/git/models/file.js';
import { GitFileWorkingTreeStatus } from '@gitlens/git/models/fileStatus.js';
import type { GitConflictFile } from '@gitlens/git/models/staging.js';
import { GitStatus } from '@gitlens/git/models/status.js';
import type { GitStatusFile } from '@gitlens/git/models/statusFile.js';
import type { GitStatusSubProvider, GitWorkingChangesState } from '@gitlens/git/providers/status.js';
import type { GitCommandPriority } from '@gitlens/git/run.types.js';
import { isCancellationError, raceWithTimeout } from '@gitlens/utils/cancellation.js';
import { debug } from '@gitlens/utils/decorators/log.js';
import { createDisposable } from '@gitlens/utils/disposable.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import { normalizePath, splitPath, stripFolderGlob } from '@gitlens/utils/path.js';
import { getSettledValue } from '@gitlens/utils/promise.js';
import { PromiseMap } from '@gitlens/utils/promiseCache.js';
import { iterateByDelimiter } from '@gitlens/utils/string.js';
import type { Uri } from '@gitlens/utils/uri.js';
import { fileUri, joinUriPath, toFsPath } from '@gitlens/utils/uri.js';
import type { CliGitProviderInternal } from '../cliGitProvider.js';
import type { GitResult } from '../exec/exec.types.js';
import type { Git } from '../exec/git.js';
import { gitConfigsStatus } from '../exec/git.js';
import { parseGitConflictFiles } from '../parsers/indexParser.js';
import { parseGitStatus } from '../parsers/statusParser.js';

/** Backstop when `advanced.git.timeout` is disabled (0). Independent of the command timeout so disabling it can't
 *  also disable deadlock recovery — mirrors `@gate`'s always-on 5-min force-clear. */
const disabledTimeoutBackstopMs = 1000 * 60 * 5;

/**
 * Deadlock-backstop duration for a status read (see `dedupeByStatusGeneration`), exported for testing.
 * Always returns a value so a wedged read recovers even with `advanced.git.timeout` disabled (which bounds git
 * *commands*, not deadlock recovery). With a timeout set, `gitTimeout * 2` sits above the per-command timeout so
 * `git.run` reads reject at their own timeout first; the backstop's real job is bounding the timeout-less
 * `git.stream` reads (`hasUntrackedFiles`/`hasConflictingFiles`).
 */
export function computeDeadlockBackstopMs(gitTimeout: number | undefined): number {
	const timeout = gitTimeout ?? 60000;
	return timeout > 0 ? timeout * 2 : disabledTimeoutBackstopMs;
}

export class StatusGitSubProvider implements GitStatusSubProvider {
	constructor(
		private readonly context: GitServiceContext,
		private readonly git: Git,
		private readonly cache: Cache,
		private readonly provider: CliGitProviderInternal,
	) {}

	/** In-flight reads, keyed by `<read>\0<repoPath>\0<generation>`. `PromiseMap` (not a bare Map) so joiners
	 *  get per-caller cancellation: the shared run aborts only when ALL current callers do. */
	private readonly _pendingReads = new PromiseMap<string, unknown>();

	/**
	 * Single-flight for point-in-time reads of mutable working-tree state — replaces `@gate`, which dedups on
	 * repoPath with no notion of *when* a run started and so joins a pre-change read to a post-change caller
	 * (see {@link Cache.getStatusGeneration}). Same-generation callers share one run (via a `PromiseMap`, so a
	 * joiner cancelling can't reject the others); a caller in a newer generation gets a different key and a
	 * fresh run; a `force` read advances the clock first, so it fences every later reader too, not just itself.
	 * The exec-layer command dedup (`Git.pendingCommands`) is fenced automatically: each run carries this entry's
	 * aggregate signal, whose id is part of the exec cache key, so a newer-generation run never joins an older
	 * one's process; the generation-derived `correlationKey` is a readable second guard on that key. A `raceWithTimeout` backstop (scaled to `advanced.git.timeout`, see
	 * {@link computeDeadlockBackstopMs}) replaces `@gate`'s 5-min force-clear so a never-settling read (a hung
	 * `git.stream`, which has no per-command timeout) can't wedge same-generation callers — including blocking
	 * awaiters like the commit flow — indefinitely.
	 */
	private dedupeByStatusGeneration<T>(
		repoPath: string,
		read: string,
		run: (correlationKey: string, signal: AbortSignal | undefined) => Promise<T>,
		cancellation?: AbortSignal,
		force?: boolean,
	): Promise<T> {
		// A `force` (user refresh) read is the user asserting the working tree may have changed without the watcher
		// observing it — the same class of event as a watcher tick, so it ADVANCES the clock rather than carving out
		// a private key for itself. A one-shot nonce would fence only this caller: the pre-assertion run stays
		// joinable, so the very next ordinary reader still picks up pre-change content — and, stamped with a newer
		// `Wip.revision` (assigned at producer start, not read start), applies it right back over the refreshed
		// result. Advancing is also CHEAPER than a nonce: concurrent readers join the one fresh read instead of each
		// spawning a private one.
		if (force) {
			this.cache.incrementStatusGeneration(repoPath);
		}
		const generation = this.cache.getStatusGeneration(repoPath);
		// `\0` separators: `read`/`repoPath` are free-form (paths can contain `:`), so a printable delimiter could
		// collide (`getStatusForPath:/a:x` vs `getStatusForPath:/a` + `:x`).
		const key = `${read}\0${repoPath}\0${generation}`;
		const correlationKey = `status:${generation}`;
		const backstopMs = computeDeadlockBackstopMs(this.git.options.gitTimeout);

		return this._pendingReads.getOrCreate(
			key,
			(cacheable, signal) => {
				// Point-in-time read: never memoize a settled value. `invalidate()` at the start makes the entry
				// self-evict on settle, so a later caller in this same generation re-reads (a newer generation
				// already gets a different key). `signal` is the aggregate — the run aborts only if every caller
				// cancels, so one caller's abort can't reject the others. The backstop rejects a wedged read so
				// waiters unblock and the entry self-evicts; it ALSO aborts the underlying git op (via `backstop`
				// linked into the run's signal) so a wedged read releases its GitQueue slot/process rather than
				// running orphaned — best-effort, since a truly-stuck process may ignore the abort.
				cacheable.invalidate();
				const backstop = new AbortController();
				const runSignal = signal != null ? AbortSignal.any([signal, backstop.signal]) : backstop.signal;
				return raceWithTimeout(run(correlationKey, runSignal), backstopMs, backstop);
			},
			cancellation,
		) as Promise<T>;
	}

	@debug()
	getStatus(
		repoPath: string | undefined,
		options?: { priority?: GitCommandPriority; force?: boolean },
		cancellation?: AbortSignal,
	): Promise<GitStatus | undefined> {
		if (repoPath == null) return Promise.resolve(undefined);

		return this.dedupeByStatusGeneration(
			repoPath,
			'getStatus',
			(correlationKey, signal) =>
				this.getStatusCore(repoPath, { ...options, correlationKey: correlationKey }, signal),
			cancellation,
			options?.force,
		);
	}

	private async getStatusCore(
		repoPath: string,
		options?: { priority?: GitCommandPriority; correlationKey?: string },
		cancellation?: AbortSignal,
	): Promise<GitStatus | undefined> {
		const porcelainVersion = (await this.git.supports('git:status:porcelain-v2')) ? 2 : 1;

		const result = await this.statusCore(
			repoPath,
			porcelainVersion,
			{
				similarityThreshold: this.context.config?.commits.similarityThreshold,
				priority: options?.priority,
				correlationKey: options?.correlationKey,
			},
			cancellation,
		);
		const repoUri = fileUri(normalizePath(repoPath));
		const status = parseGitStatus(result.stdout, repoPath, porcelainVersion, p =>
			joinUriPath(repoUri, normalizePath(p)),
		);

		if (status?.detached) {
			const pausedOpStatus = await this.provider.pausedOps?.getPausedOperationStatus?.(
				repoPath,
				undefined,
				cancellation,
			);
			if (pausedOpStatus?.type === 'rebase') {
				return new GitStatus(
					repoPath,
					pausedOpStatus.incoming.name,
					status.sha,
					status.files,
					status.upstream,
					true,
				);
			}
		}
		return status;
	}

	@debug()
	async getStatusForFile(
		repoPath: string,
		pathOrUri: string | Uri,
		options?: { renames?: boolean },
		cancellation?: AbortSignal,
	): Promise<GitStatusFile | undefined> {
		const files = await this.getStatusForPathCore(
			repoPath,
			toFsPath(pathOrUri),
			{ ...options, exact: true },
			cancellation,
		);
		return files?.[0];
	}

	@debug()
	async getStatusForPath(
		repoPath: string,
		pathOrUri: string | Uri,
		options?: { renames?: boolean },
		cancellation?: AbortSignal,
	): Promise<GitStatusFile[] | undefined> {
		return this.getStatusForPathCore(repoPath, toFsPath(pathOrUri), { ...options, exact: false }, cancellation);
	}

	private async getStatusForPathCore(
		repoPath: string,
		pathOrUri: string,
		options: { exact: boolean; renames?: boolean },
		cancellation?: AbortSignal,
	): Promise<GitStatusFile[] | undefined> {
		const relativePath = stripFolderGlob(splitPath(pathOrUri, repoPath)[0]);

		// Rename-aware queries can't scope by pathspec (that disables Git's rename detection), so they run the
		// SAME full `git status` as `getStatus`. Delegate to it — sharing one process/dedup entry — and filter,
		// rather than spawning a second identical `git status`.
		if (options.renames !== false) {
			const status = await this.getStatus(repoPath, undefined, cancellation);
			if (status == null) return undefined;

			if (options.exact) {
				const file = status.files.find(f => f.path === relativePath);
				return file ? [file] : undefined;
			}
			return status.files.filter(f => f.path.startsWith(relativePath));
		}

		// Non-rename query: pathspec-scoped `git status` (a distinct command), deduped on its own key. `exact`
		// is NOT in the key — the pathspec-scoped command is identical for exact/non-exact, so both share one run.
		return this.dedupeByStatusGeneration(
			repoPath,
			// Free-form `relativePath` (may contain `:`) goes LAST so the prefix can't be shifted into it.
			`getStatusForPath:${relativePath}`,
			(correlationKey, signal) => this.getStatusForPathScoped(repoPath, relativePath, correlationKey, signal),
			cancellation,
		);
	}

	private async getStatusForPathScoped(
		repoPath: string,
		relativePath: string,
		correlationKey: string,
		cancellation?: AbortSignal,
	): Promise<GitStatusFile[] | undefined> {
		const porcelainVersion = (await this.git.supports('git:status:porcelain-v2')) ? 2 : 1;
		const result = await this.statusCore(
			repoPath,
			porcelainVersion,
			{ similarityThreshold: this.context.config?.commits.similarityThreshold, correlationKey: correlationKey },
			cancellation,
			relativePath,
		);

		const repoUri = fileUri(normalizePath(repoPath));
		const status = parseGitStatus(result.stdout, repoPath, porcelainVersion, p =>
			joinUriPath(repoUri, normalizePath(p)),
		);
		return status?.files;
	}

	private async statusCore(
		repoPath: string,
		porcelainVersion: number = 1,
		options?: { similarityThreshold?: number | null; priority?: GitCommandPriority; correlationKey?: string },
		cancellation?: AbortSignal,
		...pathspecs: string[]
	): Promise<GitResult> {
		const params = [
			'status',
			porcelainVersion >= 2 ? `--porcelain=v${porcelainVersion}` : '--porcelain',
			'--branch',
			'-u',
		];
		if (await this.git.supports('git:status:find-renames')) {
			params.push(
				`--find-renames${options?.similarityThreshold == null ? '' : `=${options.similarityThreshold}%`}`,
			);
		}

		return this.git.run(
			{
				cwd: repoPath,
				cancellation: cancellation,
				configs: gitConfigsStatus,
				env: { GIT_OPTIONAL_LOCKS: '0' },
				correlationKey: options?.correlationKey,
				...(options?.priority != null ? { priority: options.priority } : undefined),
			},
			...params,
			'--',
			...pathspecs,
		);
	}

	@debug()
	hasWorkingChanges(
		repoPath: string,
		options?: { staged?: boolean; unstaged?: boolean; untracked?: boolean; throwOnError?: boolean },
		cancellation?: AbortSignal,
	): Promise<boolean> {
		const scope = getScopedLogger();

		const staged = options?.staged ?? true;
		const unstaged = options?.unstaged ?? true;
		const untracked = options?.untracked ?? true;
		// `throwOnError` is in the key because it changes the RESULT on git failure (throw vs `false`) — a
		// throwing caller must not join, and be silently satisfied by, a non-throwing caller's graceful run.
		const throwOnError = options?.throwOnError ?? false;

		return this.dedupeByStatusGeneration(
			repoPath,
			`hasWorkingChanges:${staged}:${unstaged}:${untracked}:${throwOnError}`,
			async (correlationKey, signal) => {
				try {
					if (staged || unstaged) {
						const result = await this.git.run(
							{ cwd: repoPath, cancellation: signal, errors: 'ignore', correlationKey: correlationKey },
							'diff',
							'--quiet',
							staged && unstaged ? 'HEAD' : staged ? '--staged' : undefined,
						);
						if (result.exitCode === 1) {
							if (staged && unstaged) {
								scope?.addExitInfo('has staged and unstaged changes');
							} else if (staged) {
								scope?.addExitInfo('has staged changes');
							} else {
								scope?.addExitInfo('has unstaged changes');
							}
							return true;
						}
					}

					// Check for untracked files
					if (untracked) {
						const hasUntracked = await this.hasUntrackedFiles(repoPath, signal);
						if (hasUntracked) {
							scope?.addExitInfo('has untracked files');
							return true;
						}
					}

					scope?.addExitInfo('no working changes');
					return false;
				} catch (ex) {
					// Re-throw cancellation errors
					if (isCancellationError(ex)) throw ex;

					// Log other errors and return false for graceful degradation
					scope?.error(ex);
					scope?.addExitInfo('error checking for changes');
					if (throwOnError) throw ex;
					return false;
				}
			},
			cancellation,
		);
	}

	@debug()
	getWorkingChangesState(repoPath: string, cancellation?: AbortSignal): Promise<GitWorkingChangesState> {
		const scope = getScopedLogger();

		return this.dedupeByStatusGeneration(
			repoPath,
			'getWorkingChangesState',
			async (correlationKey, signal) => {
				try {
					const [stagedResult, unstagedResult, untrackedResult] = await Promise.allSettled([
						// Check for staged changes
						this.git.run(
							{ cwd: repoPath, cancellation: signal, errors: 'ignore', correlationKey: correlationKey },
							'diff',
							'--quiet',
							'--staged',
						),
						// Check for unstaged changes
						this.git.run(
							{ cwd: repoPath, cancellation: signal, errors: 'ignore', correlationKey: correlationKey },
							'diff',
							'--quiet',
						),
						// Check for untracked files
						this.hasUntrackedFiles(repoPath, signal),
					]);

					const result = {
						staged: getSettledValue(stagedResult)?.exitCode === 1,
						unstaged: getSettledValue(unstagedResult)?.exitCode === 1,
						untracked: getSettledValue(untrackedResult) === true,
					};

					scope?.addExitInfo(
						result.staged || result.unstaged || result.untracked
							? `has ${result.staged ? 'staged' : ''}${result.unstaged ? (result.staged ? ', unstaged' : 'unstaged ') : ''}${
									result.untracked
										? result.staged || result.unstaged
											? ', untracked'
											: 'untracked'
										: ''
								} changes`
							: 'no working changes',
					);

					return result;
				} catch (ex) {
					if (isCancellationError(ex)) throw ex;

					scope?.error(ex);
					scope?.addExitInfo('error checking for changes');
					// Return all false on error for graceful degradation
					return { staged: false, unstaged: false, untracked: false };
				}
			},
			cancellation,
		);
	}

	hasConflictingFiles(repoPath: string, cancellation?: AbortSignal): Promise<boolean> {
		// Route through `dedupeByStatusGeneration` (like every other point-in-time read here) for the join-fence
		// and the `raceWithTimeout` backstop — a bare `git.stream` has no per-command timeout and could wedge.
		return this.dedupeByStatusGeneration(
			repoPath,
			'hasConflictingFiles',
			async (_correlationKey, signal) => {
				try {
					const stream = this.git.stream({ cwd: repoPath, cancellation: signal }, 'ls-files', '--unmerged');
					using _streamDisposer = createDisposable(() => void stream.return?.(undefined));

					// Early exit on first chunk - breaking causes SIGPIPE, killing git process
					for await (const _chunk of stream) {
						return true;
					}

					return false;
				} catch (ex) {
					// Re-throw cancellation errors
					if (isCancellationError(ex)) throw ex;

					return false;
				}
			},
			cancellation,
		);
	}

	@debug()
	getConflictingFiles(repoPath: string, cancellation?: AbortSignal): Promise<GitConflictFile[]> {
		const scope = getScopedLogger();

		return this.dedupeByStatusGeneration(
			repoPath,
			'getConflictingFiles',
			async (correlationKey, signal) => {
				try {
					const result = await this.git.run(
						{ cwd: repoPath, cancellation: signal, errors: 'ignore', correlationKey: correlationKey },
						'ls-files',
						'-z',
						'--unmerged',
					);

					if (!result.stdout) {
						scope?.addExitInfo('no conflicting files');
						return [];
					}

					const files = parseGitConflictFiles(result.stdout, repoPath);
					scope?.addExitInfo(`${String(files.length)} conflicting file(s)`);
					return files;
				} catch (ex) {
					// Re-throw cancellation errors
					if (isCancellationError(ex)) throw ex;

					// Log other errors and return empty array for graceful degradation
					scope?.error(ex);
					scope?.addExitInfo('error getting conflicting files');
					return [];
				}
			},
			cancellation,
		);
	}

	private async hasUntrackedFiles(repoPath: string, cancellation?: AbortSignal): Promise<boolean> {
		try {
			const stream = this.git.stream(
				{ cwd: repoPath, cancellation: cancellation },
				'ls-files',
				// '-z', // Unneeded since we are only looking for presence
				'--others',
				'--exclude-standard',
			);
			using _streamDisposer = createDisposable(() => void stream.return?.(undefined));

			// Early exit on first chunk - breaking causes SIGPIPE, killing git process
			for await (const _chunk of stream) {
				return true;
			}

			return false;
		} catch (ex) {
			// Re-throw cancellation errors
			if (isCancellationError(ex)) throw ex;

			// Treat other errors as "no untracked files" for graceful degradation
			return false;
		}
	}

	@debug()
	getUntrackedFiles(repoPath: string, cancellation?: AbortSignal): Promise<GitFile[]> {
		const scope = getScopedLogger();

		return this.dedupeByStatusGeneration(
			repoPath,
			'getUntrackedFiles',
			async (correlationKey, signal) => {
				try {
					const result = await this.git.run(
						{ cwd: repoPath, cancellation: signal, errors: 'ignore', correlationKey: correlationKey },
						'ls-files',
						'-z',
						'--others',
						'--exclude-standard',
					);

					if (!result.stdout) {
						scope?.addExitInfo('no untracked files');
						return [];
					}

					const files: GitFile[] = [];

					for (const line of iterateByDelimiter(result.stdout, '\0')) {
						if (!line.length) continue;

						files.push({ path: line, repoPath: repoPath, status: GitFileWorkingTreeStatus.Untracked });
					}

					scope?.addExitInfo(`${String(files.length)} untracked file(s)`);
					return files;
				} catch (ex) {
					// Re-throw cancellation errors
					if (isCancellationError(ex)) throw ex;

					// Log other errors and return empty array for graceful degradation
					scope?.error(ex);
					scope?.addExitInfo('error getting untracked files');
					return [];
				}
			},
			cancellation,
		);
	}
}

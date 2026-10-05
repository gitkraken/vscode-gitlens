import type { Cache } from '@gitlens/git/cache.js';
import type { GitServiceContext } from '@gitlens/git/context.js';
import type { GitFile } from '@gitlens/git/models/file.js';
import { GitFileWorkingTreeStatus } from '@gitlens/git/models/fileStatus.js';
import type { GitConflictFile } from '@gitlens/git/models/staging.js';
import { GitStatus } from '@gitlens/git/models/status.js';
import type { GitStatusFile } from '@gitlens/git/models/statusFile.js';
import type { GitStatusSubProvider, GitWorkingChangesState } from '@gitlens/git/providers/status.js';
import type { GitCommandPriority, GitErrorHandling } from '@gitlens/git/run.types.js';
import { raceWithTimeout } from '@gitlens/utils/cancellation.js';
import { debug } from '@gitlens/utils/decorators/log.js';
import { createDisposable } from '@gitlens/utils/disposable.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import { normalizePath, splitPath, stripFolderGlob } from '@gitlens/utils/path.js';
import { getSettledValue } from '@gitlens/utils/promise.js';
import { PromiseMap } from '@gitlens/utils/promiseCache.js';
import { iterateByDelimiter } from '@gitlens/utils/string.js';
import type { Uri } from '@gitlens/utils/uri.js';
import { toFsPath } from '@gitlens/utils/uri.js';
import type { CliGitProviderInternal } from '../cliGitProvider.js';
import type { GitResult } from '../exec/exec.types.js';
import type { Git } from '../exec/git.js';
import { defaultExceptionHandler, gitConfigsStatus, GitErrors } from '../exec/git.js';
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

/**
 * A non-default `untracked`/`branch` gets its own key, so a full-status caller never joins a narrower run; the
 * default stays `'getStatus'`, which `getStatusForPathCore`'s rename path joins.
 */
function getStatusReadKey(options?: { untracked?: 'no' | 'normal' | 'all'; branch?: false }): string {
	if (options?.untracked == null && options?.branch !== false) return 'getStatus';

	const parts: string[] = [];
	if (options?.untracked != null) {
		parts.push(`untracked=${options.untracked}`);
	}
	if (options?.branch === false) {
		parts.push('branch=false');
	}
	return `getStatus:${parts.join(':')}`;
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
		options?: {
			priority?: GitCommandPriority;
			force?: boolean;
			untracked?: 'no' | 'normal' | 'all';
			branch?: false;
		},
		cancellation?: AbortSignal,
	): Promise<GitStatus | undefined> {
		if (repoPath == null) return Promise.resolve(undefined);

		// `-u` already means `-uall`, so an explicit `'all'` shares the default run
		const opts = options?.untracked === 'all' ? { ...options, untracked: undefined } : options;

		return this.dedupeByStatusGeneration(
			repoPath,
			getStatusReadKey(opts),
			(correlationKey, signal) =>
				this.getStatusCore(repoPath, { ...opts, correlationKey: correlationKey }, signal),
			cancellation,
			opts?.force,
		);
	}

	private async getStatusCore(
		repoPath: string,
		options?: {
			priority?: GitCommandPriority;
			correlationKey?: string;
			untracked?: 'no' | 'normal' | 'all';
			branch?: false;
		},
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
				untracked: options?.untracked,
				branch: options?.branch,
				errors: 'throw',
			},
			cancellation,
		);
		const status = parseGitStatus(result.stdout, repoPath, porcelainVersion);

		if (options?.branch === false) {
			// Without `--branch` a clean tree prints nothing at all, which the parser reads as no status
			if (status == null && result.completion.status === 'exited' && result.exitCode === 0) {
				return new GitStatus(normalizePath(repoPath), '', '', []);
			}
			// No branch name either, which `GitStatus` reads as detached, so there is no paused rebase to look up
			return status;
		}

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
			// The rename path keeps the default handling the scoped read gets
			const status = await this.getStatus(repoPath, undefined, cancellation).catch((ex: unknown) => {
				defaultExceptionHandler(ex as Error, repoPath);
				return undefined;
			});
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

		const status = parseGitStatus(result.stdout, repoPath, porcelainVersion);
		return status?.files;
	}

	private async statusCore(
		repoPath: string,
		porcelainVersion: number = 1,
		options?: {
			similarityThreshold?: number | null;
			priority?: GitCommandPriority;
			correlationKey?: string;
			untracked?: 'no' | 'normal' | 'all';
			branch?: false;
			errors?: GitErrorHandling;
		},
		cancellation?: AbortSignal,
		...pathspecs: string[]
	): Promise<GitResult> {
		const params = ['status', porcelainVersion >= 2 ? `--porcelain=v${porcelainVersion}` : '--porcelain'];
		if (options?.branch !== false) {
			params.push('--branch');
		}
		params.push(options?.untracked != null ? `-u${options.untracked}` : '-u');
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
				...(options?.errors != null ? { errors: options.errors } : undefined),
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
		options?: {
			staged?: boolean;
			unstaged?: boolean;
			untracked?: boolean;
			priority?: GitCommandPriority;
		},
		cancellation?: AbortSignal,
	): Promise<boolean> {
		const scope = getScopedLogger();

		const staged = options?.staged ?? true;
		const unstaged = options?.unstaged ?? true;
		const untracked = options?.untracked ?? true;
		// `priority` is in the key even though it doesn't change the answer: a joiner INHERITS the in-flight run's
		// scheduling. `GitQueue` refuses to start background work while anything is waiting at normal/interactive,
		// so letting a foreground caller (the overview's dirty pill, the Worktrees view) join a `background` probe
		// would strand it for the whole graph load. Splitting the two lanes costs at most one extra spawn; joining
		// costs unbounded foreground latency.
		const priority = options?.priority ?? 'default';

		return this.dedupeByStatusGeneration(
			repoPath,
			`hasWorkingChanges:${staged}:${unstaged}:${untracked}:${priority}`,
			async (correlationKey, signal) => {
				if (staged || unstaged) {
					const diffQuiet = (revision: string | undefined) =>
						this.git.run(
							{
								cwd: repoPath,
								cancellation: signal,
								errors: 'throw',
								expectedExitCodes: [1],
								correlationKey: correlationKey,
								...(options?.priority != null ? { priority: options.priority } : undefined),
							},
							'diff',
							'--quiet',
							revision,
							'--',
						);

					let result;
					if (staged && unstaged) {
						try {
							result = await diffQuiet('HEAD');
						} catch (ex) {
							// Before the first commit HEAD names nothing; everything staged or modified is a change
							// against the empty tree. `diff HEAD --` names only HEAD, so its "bad revision" is that case
							// without re-validating HEAD (a corrupt HEAD then reads as dirty, the safe answer)
							if (GitErrors.badRevision.exec(String(ex))?.[1]?.toUpperCase() !== 'HEAD') throw ex;

							result = await diffQuiet(await this.provider.revision.getEmptyTreeSha(repoPath));
						}
					} else {
						result = await diffQuiet(staged ? '--staged' : undefined);
					}

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

				// Check for untracked files. NOTE: this runs through `git.stream`, which spawns directly
				// and never enters the queue — so `priority` above doesn't reach it. Only clean worktrees
				// get this far (a dirty one already returned above), and callers fanning out across many
				// worktrees are expected to bound their own concurrency.
				if (untracked) {
					const hasUntracked = await this.hasUntrackedFiles(repoPath, signal);
					if (hasUntracked) {
						scope?.addExitInfo('has untracked files');
						return true;
					}
				}

				scope?.addExitInfo('no working changes');
				return false;
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
				const [stagedResult, unstagedResult, untrackedResult] = await Promise.allSettled([
					// Check for staged changes
					this.git.run(
						{
							cwd: repoPath,
							cancellation: signal,
							errors: 'throw',
							expectedExitCodes: [1],
							correlationKey: correlationKey,
						},
						'diff',
						'--quiet',
						'--staged',
					),
					// Check for unstaged changes
					this.git.run(
						{
							cwd: repoPath,
							cancellation: signal,
							errors: 'throw',
							expectedExitCodes: [1],
							correlationKey: correlationKey,
						},
						'diff',
						'--quiet',
					),
					// Check for untracked files
					this.hasUntrackedFiles(repoPath, signal),
				]);

				for (const settled of [stagedResult, unstagedResult, untrackedResult]) {
					if (settled.status === 'rejected') throw settled.reason;
				}

				const result = {
					staged: getSettledValue(stagedResult)?.exitCode === 1,
					unstaged: getSettledValue(unstagedResult)?.exitCode === 1,
					untracked: getSettledValue(untrackedResult) === true,
				};

				scope?.addExitInfo(
					result.staged || result.unstaged || result.untracked
						? `has ${result.staged ? 'staged' : ''}${result.unstaged ? (result.staged ? ', unstaged' : 'unstaged ') : ''}${
								result.untracked ? (result.staged || result.unstaged ? ', untracked' : 'untracked') : ''
							} changes`
						: 'no working changes',
				);

				return result;
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
				const stream = this.git.stream({ cwd: repoPath, cancellation: signal }, 'ls-files', '--unmerged');
				using _streamDisposer = createDisposable(() => void stream.return?.(undefined));

				// Early exit on first chunk - breaking causes SIGPIPE, killing git process
				for await (const _chunk of stream) {
					return true;
				}

				return false;
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
				const result = await this.git.run(
					{ cwd: repoPath, cancellation: signal, errors: 'throw', correlationKey: correlationKey },
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
			},
			cancellation,
		);
	}

	private async hasUntrackedFiles(repoPath: string, cancellation?: AbortSignal): Promise<boolean> {
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
	}

	@debug()
	getUntrackedFiles(repoPath: string, cancellation?: AbortSignal): Promise<GitFile[]> {
		const scope = getScopedLogger();

		return this.dedupeByStatusGeneration(
			repoPath,
			'getUntrackedFiles',
			async (correlationKey, signal) => {
				const result = await this.git.run(
					{ cwd: repoPath, cancellation: signal, errors: 'throw', correlationKey: correlationKey },
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
			},
			cancellation,
		);
	}
}

import { exec } from 'child_process';
import { promises as fs } from 'fs';
import { join, resolve } from 'path';
import * as l10n from '@vscode/l10n';
import type { Cache } from '@gitlens/git/cache.js';
import type { GitServiceContext } from '@gitlens/git/context.js';
import { WorktreeCreateError, WorktreeDeleteError } from '@gitlens/git/errors.js';
import type { GitBranch } from '@gitlens/git/models/branch.js';
import type { WorkspaceFolderResolver } from '@gitlens/git/models/worktree.js';
import { GitWorktree } from '@gitlens/git/models/worktree.js';
import type { GitOperationRunOptions } from '@gitlens/git/providers/operations.js';
import type { GitWorktreesSubProvider } from '@gitlens/git/providers/worktrees.js';
import { isCancellationError } from '@gitlens/utils/cancellation.js';
import { debug } from '@gitlens/utils/decorators/log.js';
import { isWindows } from '@gitlens/utils/env/node/platform.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import { basename, isDescendant, normalizePath } from '@gitlens/utils/path.js';
import { getSettledValue } from '@gitlens/utils/promise.js';
import type { CacheController } from '@gitlens/utils/promiseCache.js';
import type { Uri } from '@gitlens/utils/uri.js';
import { fileUri, toFsPath } from '@gitlens/utils/uri.js';
import type { CliGitProviderInternal } from '../cliGitProvider.js';
import { mayWriteTracking } from '../exec/commandClassifier.js';
import type { Git, GitError } from '../exec/git.js';
import { getGitCommandError, GitErrors, isRunHookFailure } from '../exec/git.js';
import { parseGitWorktrees } from '../parsers/worktreeParser.js';

/** Extracts the lock reason from Git's `cannot remove a locked working tree` output, when it provides one */
function getLockReason(ex: GitError): string | undefined {
	return GitErrors.worktreeLockedReason.exec(ex.stderr || ex.stdout || ex.message || '')?.[1].trim() || undefined;
}

/**
 * The branch `git worktree add` says it created, from the `Preparing worktree (new branch '<name>')` line it writes to
 * stderr (git 2.17+, in English since every run sets `LC_ALL=C`)
 */
function getNewWorktreeBranch(stderr: string | undefined): string | undefined {
	return stderr ? /^Preparing worktree \(new branch '(.+)'\)$/m.exec(stderr)?.[1] : undefined;
}

const unbornSha = /^0+$/;

/**
 * Where `git worktree list` contradicts the branch list it was paired with, or `undefined` when they agree. `switched`
 * holds the worktrees whose checked-out branch differs from the one the branch list places there.
 */
function findStaleBranches(
	worktrees: readonly GitWorktree[],
	branches: readonly GitBranch[],
	/** Whether git says where each branch is checked out (`%(worktreepath)`); before it, only the current branch's is known */
	knowsPaths: boolean,
): { switched: string[] } | undefined {
	if (!worktrees.length) return undefined;

	const byName = new Map<string, GitBranch>();
	const byPath = new Map<string, GitBranch>();
	for (const b of branches) {
		// A detached HEAD's stand-in branch names no ref
		if (b.remote || b.detached) continue;

		byName.set(b.name, b);
		// A rebasing branch's worktree lists as detached
		if (b.worktree && !b.rebasing) {
			byPath.set(normalizePath(b.worktree.path), b);
		}
	}

	// Git places a branch checked out in several worktrees (`worktree add --force`) at only one of them
	const listedBranches = new Map(worktrees.map(w => [w.path, w.branchName]));

	let stale = false;
	const switched: string[] = [];
	for (const w of worktrees) {
		// A bare repository checks nothing out, though git places the branch its HEAD names there
		if (w.type === 'bare') {
			byPath.delete(w.path);
			continue;
		}

		const listed = byPath.get(w.path);
		if (listed != null) {
			byPath.delete(w.path);
			if (listed.name !== w.branchName) {
				switched.push(w.path);
				stale = true;
			}
		} else if (knowsPaths && w.branchName != null) {
			// Detached, or not yet a worktree, when the branches were read
			switched.push(w.path);
		}

		// An unborn branch has no ref for the branch list to know
		if (w.branchName == null || !w.sha || unbornSha.test(w.sha)) continue;

		const branch = byName.get(w.branchName);
		if (
			branch == null ||
			(branch.sha != null && branch.sha !== w.sha) ||
			branch.worktree === false ||
			(branch.worktree != null && listedBranches.get(normalizePath(branch.worktree.path)) !== w.branchName)
		) {
			stale = true;
		}
	}

	// A branch placed in a worktree that no longer lists it was removed or switched away
	if (byPath.size) {
		stale = true;
	}

	return stale ? { switched: switched } : undefined;
}

export class WorktreesGitSubProvider implements GitWorktreesSubProvider {
	/** Per common path, the read whose `git worktree list` hasn't started yet */
	private readonly _unspawnedReads = new Map<string, object>();
	/**
	 * Per common path, the `git worktree list` output a fresh branch list still contradicted: a layout where git's two
	 * listings never agree, which re-reading the branches again can't fix until the list changes
	 */
	private readonly _lastingDisagreements = new Map<string, string>();

	constructor(
		private readonly context: GitServiceContext,
		private readonly git: Git,
		private readonly cache: Cache,
		private readonly provider: CliGitProviderInternal,
		/**
		 * Reads the absolute folders whose worktrees a repository's list leaves out, rejecting (or answering `undefined`)
		 * when they can't be read; given only when folders are registered
		 */
		private readonly readIgnoredWorktreeRoots?: (repoPath: string) => Promise<readonly string[] | undefined>,
	) {}

	/**
	 * Creates a worktree (`git worktree add`). `runOptions` are spread into the underlying `git.run` call, so a
	 * large checkout can run without the default command timeout (`{ timeout: 0 }`) and still be cancelled.
	 */
	@debug()
	async createWorktree(
		repoPath: string,
		path: string,
		options?: {
			commitish?: string;
			createBranch?: string;
			detach?: boolean;
			force?: boolean;
			noTracking?: boolean;
		},
		runOptions?: GitOperationRunOptions,
	): Promise<void> {
		const scope = getScopedLogger();

		const args = ['worktree', 'add'];
		if (options?.force) {
			args.push('--force');
		}
		if (options?.createBranch) {
			args.push('-b', options.createBranch);
		}
		if (options?.createBranch && options.noTracking) {
			args.push('--no-track');
		}
		if (options?.detach) {
			args.push('--detach');
		}
		args.push(path);
		if (options?.commitish) {
			args.push(options.commitish);
		}

		// Without `-b`, git may still create a branch: from a remote branch of the commitish's name, or named after the
		// path when no commitish is given
		let createdBranch = options?.createBranch;
		// A cancelled or timed-out run, or a host-rejected retry, leaves no output to name the branch git may have created
		let mayHaveCreatedBranch = false;
		try {
			const result = await this.git.run({ cwd: repoPath, ...runOptions }, ...args);
			createdBranch ??= getNewWorktreeBranch(result.stderr);
		} catch (ex) {
			scope?.error(ex);
			// `?.`: a host's index-lock retry hook may reject with anything, `undefined` included
			createdBranch ??= getNewWorktreeBranch((ex as GitError | undefined)?.stderr);

			// A cancelled or timed-out checkout, or a host-rejected index-lock retry, is not git refusing the worktree
			if (isCancellationError(ex) || isRunHookFailure(ex)) {
				mayHaveCreatedBranch = createdBranch == null && !options?.detach;
				throw ex;
			}

			throw getGitCommandError(
				'worktree-create',
				ex as GitError,
				reason =>
					new WorktreeCreateError(
						{ reason: reason, gitCommand: { repoPath: repoPath, args: args } },
						ex as GitError,
					),
			);
		} finally {
			// A failed or cancelled add may already have created the branch (and its tracking in `.git/config`) or
			// the worktree directory.
			//
			// The tracking isn't announced as a `config` change, only evicted: git may also write repository-wide
			// keys (`extensions.relativeWorktrees` under `worktree.useRelativePaths`), so the write can't claim its
			// config change is confined to the new branch, and an unconfined one would refresh every worktree on each
			// add. The watcher's report of the file says what changed in it instead.
			if (createdBranch) {
				// Evict the cached base only — see `checkout -b` for why the persisted keys are left alone.
				this.cache.deleteBaseBranchName(repoPath, createdBranch);
				// A branch git created on its own may track a remote branch, whatever the commitish looks like
				this.context.hooks?.cache?.onReset?.(
					repoPath,
					...(!options?.createBranch || mayWriteTracking(options.commitish, options.noTracking)
						? (['branches', 'config', 'worktrees'] as const)
						: (['branches', 'worktrees'] as const)),
				);
				this.context.hooks?.repository?.onChanged?.(
					repoPath,
					['worktrees', 'worktreeHead', 'heads'],
					[`refs/heads/${createdBranch}`],
				);
			} else if (mayHaveCreatedBranch) {
				// Git creates the branch before checking it out, so a run cut short may have left one it never named
				this.context.hooks?.cache?.onReset?.(repoPath, 'branches', 'config', 'worktrees');
				this.context.hooks?.repository?.onChanged?.(repoPath, ['worktrees', 'worktreeHead', 'heads']);
			} else {
				this.context.hooks?.cache?.onReset?.(repoPath, 'worktrees');
				this.context.hooks?.repository?.onChanged?.(repoPath, ['worktrees', 'worktreeHead']);
			}
		}
	}

	async createWorktreeWithResult(
		repoPath: string,
		path: string,
		options?: {
			commitish?: string;
			createBranch?: string;
			detach?: boolean;
			force?: boolean;
			noTracking?: boolean;
		},
		runOptions?: GitOperationRunOptions,
	): Promise<GitWorktree | undefined> {
		await this.createWorktree(repoPath, path, options, runOptions);
		const normalized = normalizePath(path);
		return this.getWorktree(
			repoPath,
			w => normalizePath(w.path) === normalized,
			undefined,
			runOptions?.cancellation,
		);
	}

	@debug({ quiet: true })
	async getWorktree(
		repoPath: string,
		predicate: (w: GitWorktree) => boolean,
		options?: { force?: boolean },
		cancellation?: AbortSignal,
	): Promise<GitWorktree | undefined> {
		return (await this.getWorktrees(repoPath, options, cancellation)).find(predicate);
	}

	@debug({ quiet: true })
	async getWorktrees(
		repoPath: string,
		options?: { force?: boolean },
		cancellation?: AbortSignal,
	): Promise<GitWorktree[]> {
		// A pending read that hasn't started `git worktree list` will see the state as of this call, so it is joined,
		// whether it was pending as the call started or is once the call would evict (another forced read's, say)
		let force = options?.force === true && !this._unspawnedReads.has(this.cache.getCommonPath(repoPath));

		await this.git.ensureSupports('git:worktrees', (requiredVersion, installedVersion) =>
			l10n.t(
				'Displaying worktrees requires a newer version of Git (>= {0}) than is currently installed ({1}). Please install a more recent version of Git and try again.',
				requiredVersion,
				installedVersion,
			),
		);

		if (force && this._unspawnedReads.has(this.cache.getCommonPath(repoPath))) {
			force = false;
		}

		return this.cache.getWorktrees(
			repoPath,
			async (commonPath, cacheable, signal) => {
				const unspawned = {};
				this._unspawnedReads.set(commonPath, unspawned);
				const onSpawned = () => {
					if (this._unspawnedReads.get(commonPath) === unspawned) {
						this._unspawnedReads.delete(commonPath);
					}
				};

				try {
					return await this.readWorktrees(repoPath, commonPath, cacheable, signal ?? cancellation, onSpawned);
				} finally {
					onSpawned();
				}
			},
			force ? { force: true } : undefined,
			cancellation,
		);
	}

	private async readWorktrees(
		repoPath: string,
		commonPath: string,
		cacheable: CacheController,
		signal: AbortSignal | undefined,
		onSpawn: () => void,
	): Promise<GitWorktree[]> {
		// Read beside the list, which it doesn't depend on. `commonPath` is the main worktree, not the git dir,
		// so the roots come from the repository's own git dir
		const rootsRead = this.readIgnoredWorktreeRoots?.(repoPath).catch(() => undefined);
		const [dataResult, branchesResult] = await Promise.allSettled([
			this.git.run(
				{ cwd: commonPath, cancellation: signal, onSpawn: onSpawn },
				'worktree',
				'list',
				'--porcelain',
			),
			this.provider.branches.getBranches(commonPath, undefined, signal),
		]);

		if (dataResult.status === 'rejected') {
			// Don't cache a bogus empty result for a transient command failure — retry on next access.
			cacheable.invalidate();
		}

		const getWorkspaceFolder: WorkspaceFolderResolver | undefined = this.context.workspace
			? uri => {
					const folder = this.context.workspace!.getFolder(uri.fsPath);
					if (folder == null) return undefined;
					return { uri: fileUri(folder.path), name: basename(folder.path) };
				}
			: undefined;

		const data = getSettledValue(dataResult)?.stdout;
		let worktrees = parseGitWorktrees(
			data,
			commonPath,
			getSettledValue(branchesResult)?.values ?? [],
			getWorkspaceFolder,
		);

		// The branches come from the cache, which can lag the list just read (a forced read pairs a fresh list with
		// them). Where the list contradicts them it proves them stale, so they are re-read, once
		const knowsPaths = await this.git.supports('git:for-each-ref:worktreePath');
		const stale =
			branchesResult.status === 'fulfilled'
				? findStaleBranches(worktrees, branchesResult.value.values, knowsPaths)
				: undefined;
		if (stale == null) {
			this._lastingDisagreements.delete(commonPath);
		} else if (this._lastingDisagreements.get(commonPath) !== data) {
			this.context.hooks?.cache?.onReset?.(commonPath, 'branches');
			for (const path of stale.switched) {
				this.context.hooks?.cache?.onReset?.(path, 'branch');
			}

			let branches: GitBranch[] | undefined;
			try {
				({ values: branches } = await this.provider.branches.getBranches(commonPath, undefined, signal));
			} catch {
				// Keep the branches matched from the stale list, but not in the cache
				cacheable.invalidate();
			}

			if (branches != null) {
				worktrees = parseGitWorktrees(data, commonPath, branches, getWorkspaceFolder);
				if (data != null && findStaleBranches(worktrees, branches, knowsPaths) != null) {
					this._lastingDisagreements.set(commonPath, data);
				}
				// The host's views show the branches the watcher missed a change of; which moved is unknown. Only the
				// host hears it: announced as a write of core's, the watch layer would take an outside `heads` report
				// arriving meanwhile for its echo and drop it, though nothing of the kind was evicted for it
				for (const path of new Set([commonPath, ...this.cache.getWorktreePaths(commonPath)])) {
					this.provider.notifyHost(path, ['heads']);
				}
			}
		}

		if (rootsRead != null) {
			const roots = await rootsRead;
			if (roots == null) {
				// The folders couldn't be read: an unfiltered list would keep ignored worktrees in the shared
				// cache until the next change
				cacheable.invalidate();
			} else if (roots.length) {
				worktrees = worktrees.filter(w => !roots.some(root => isDescendant(normalizePath(w.path), root)));
			}
		}

		// Older git prints a bare `locked` even when a reason exists; recover it from the admin dir
		if (await this.git.supports('git:worktree:list:lock-reason')) return worktrees;

		return Promise.all(worktrees.map(w => this.withLockReason(w)));
	}

	private async withLockReason(worktree: GitWorktree): Promise<GitWorktree> {
		if (worktree.locked !== true || worktree.isDefault || worktree.type === 'bare') return worktree;

		try {
			// A linked worktree's `.git` is a file: `gitdir: <admin dir>`, relative to the worktree when not absolute
			const dotGit = join(worktree.uri.fsPath, '.git');
			const match = /^gitdir:\s*(.+?)\s*$/m.exec(await fs.readFile(dotGit, 'utf8'));
			if (match == null) return worktree;

			const reason = (await fs.readFile(join(resolve(worktree.uri.fsPath, match[1]), 'locked'), 'utf8')).trim();
			if (!reason) return worktree;

			return new GitWorktree(
				worktree.isDefault,
				worktree.type,
				worktree.repoPath,
				worktree.uri,
				reason,
				worktree.prunable,
				worktree.sha,
				worktree.branch,
				worktree.workspaceFolder,
				worktree.branchName,
			);
		} catch {
			return worktree;
		}
	}

	@debug({ quiet: true })
	getWorktreesDefaultUri(repoPath: string): Uri | undefined {
		return this.context.workspace?.getWorktreeDefaultUri?.(repoPath);
	}

	/**
	 * Deletes a worktree (`git worktree remove`). Pass `force: 'locked'` to also override a locked worktree.
	 *
	 * `runOptions` are spread into the underlying `git.run` call (e.g. `{ timeout: 0 }` for a large worktree
	 * whose removal may exceed the default command timeout).
	 *
	 * On failure, the thrown {@link WorktreeDeleteError}'s `original` property carries the raw
	 * {@link GitError} (stderr/stdout/exit code) untouched — a caller that needs to classify a
	 * platform-specific failure (e.g. a Windows file-lock retry) can read it directly rather than parsing
	 * the typed error's message.
	 */
	@debug()
	async deleteWorktree(
		repoPath: string,
		path: string | Uri,
		options?: { force?: boolean | 'locked' },
		runOptions?: GitOperationRunOptions,
	): Promise<void> {
		const scope = getScopedLogger();

		await this.git.ensureSupports('git:worktrees', (requiredVersion, installedVersion) =>
			l10n.t(
				'Deleting worktrees requires a newer version of Git (>= {0}) than is currently installed ({1}). Please install a more recent version of Git and try again.',
				requiredVersion,
				installedVersion,
			),
		);

		const args = ['worktree', 'remove'];
		if (options?.force) {
			args.push('--force');
			// Git requires a second `--force` to remove a locked worktree
			if (options.force === 'locked') {
				args.push('--force');
			}
		}

		const pathStr = normalizePath(toFsPath(path));
		args.push(pathStr);

		let deleted = false;
		try {
			await this.git.run({ cwd: repoPath, errors: 'throw', ...runOptions }, ...args);
			deleted = true;
		} catch (ex) {
			scope?.error(ex);
			// A cancelled or timed-out removal (`runOptions.cancellation`/`timeout`), or a host-rejected index-lock
			// retry, is not git refusing it, and wrapping it would hand the caller a `WorktreeDeleteError` whose
			// `original` is no `GitError` at all
			if (isCancellationError(ex) || isRunHookFailure(ex)) throw ex;

			const gitError = getGitCommandError(
				'worktree-delete',
				ex as GitError,
				reason =>
					new WorktreeDeleteError(
						{
							reason: reason,
							lockReason: reason === 'locked' ? getLockReason(ex as GitError) : undefined,
							gitCommand: { repoPath: repoPath, args: args },
						},
						ex as GitError,
					),
			);

			if (gitError.details.reason === 'directoryNotEmpty') {
				scope?.warn(
					`Failed to fully delete worktree '${pathStr}' because it is not empty. Attempting to delete it manually.`,
				);
				try {
					await fs.rm(pathStr, { force: true, recursive: true });
					deleted = true;
					return;
				} catch (ex) {
					if (isWindows) {
						const match = /EPERM: operation not permitted, unlink '(.*?)'/i.exec((ex as GitError).message);
						if (match != null) {
							scope?.warn(
								`Failed to manually delete '${pathStr}' because it is in use. Attempting to forcefully delete it.`,
							);

							// Windows-specific: `del` via cmd.exe to force-remove a locked symlink.
							// Node's fs.rm/unlink fails with EPERM when the symlink target is in use.
							function deleteInUseSymlink(symlink: string) {
								return new Promise((resolve, reject) => {
									exec(`del "${symlink}"`, (ex, stdout, stderr) => {
										if (ex) {
											reject(ex instanceof Error ? ex : new Error(String(ex)));
										} else if (stderr) {
											reject(new Error(stderr));
										} else {
											resolve(stdout);
										}
									});
								});
							}

							const [, file] = match;
							try {
								await deleteInUseSymlink(file);
								await fs.rm(pathStr, { force: true, recursive: true, maxRetries: 1, retryDelay: 1 });
								deleted = true;
								return;
							} catch (ex) {
								scope?.error(ex, `Failed to forcefully delete '${pathStr}' because it is in use.`);
							}
						}
					}
				}
			}

			throw gitError;
		} finally {
			if (deleted) {
				// Clean up Cache registry + per-worktree cache entries for the deleted worktree.
				// Order matters: unregister before emitting the repo-level change so any listener
				// that re-queries worktree-aware state sees the registry already updated.
				this.cache.unregisterRepoPath(pathStr);
			}
			// A failed or cancelled removal may already have taken the worktree's files or admin entry
			this.context.hooks?.cache?.onReset?.(repoPath, 'worktrees');
			this.context.hooks?.repository?.onChanged?.(repoPath, ['worktrees', 'worktreeHead']);
		}
	}

	@debug()
	async pruneWorktrees(repoPath: string, options?: { expire?: string }): Promise<void> {
		await this.git.ensureSupports('git:worktrees', (requiredVersion, installedVersion) =>
			l10n.t(
				'Pruning worktrees requires a newer version of Git (>= {0}) than is currently installed ({1}). Please install a more recent version of Git and try again.',
				requiredVersion,
				installedVersion,
			),
		);

		const before = await this.listWorktreePaths(repoPath);

		const args = ['worktree', 'prune'];
		if (options?.expire) {
			args.push('--expire', options.expire);
		}

		try {
			await this.git.run({ cwd: repoPath, errors: 'throw' }, ...args);

			const after = await this.listWorktreePaths(repoPath);

			// Order matters (see `deleteWorktree`): unregister before emitting the repo-level change so any
			// listener that re-queries worktree-aware state sees the registry already updated.
			if (before != null && after != null) {
				for (const path of before) {
					if (!after.has(path)) {
						this.cache.unregisterRepoPath(path);
					}
				}
			}
		} finally {
			this.context.hooks?.cache?.onReset?.(repoPath, 'worktrees');
			this.context.hooks?.repository?.onChanged?.(repoPath, ['worktrees', 'worktreeHead']);
		}
	}

	/**
	 * Raw worktree paths currently known to git (`worktree <path>` lines from `--porcelain`), normalized the
	 * same way {@link deleteWorktree} does. A failed listing (`errors: 'ignore'`) yields an empty set rather
	 * than throwing — used by `pruneWorktrees` to diff before/after, where a transient read failure must not
	 * be mistaken for every worktree having vanished.
	 */
	private async listWorktreePaths(repoPath: string): Promise<Set<string> | undefined> {
		const result = await this.git.run({ cwd: repoPath, errors: 'ignore' }, 'worktree', 'list', '--porcelain');
		// A failed listing is not an empty one: read as empty, the after-prune one would unregister everything
		if (result.completion.status !== 'exited' || result.exitCode !== 0) return undefined;

		const paths = new Set<string>();
		for (const line of result.stdout.split('\n')) {
			if (line.startsWith('worktree ')) {
				paths.add(normalizePath(toFsPath(line.slice('worktree '.length).trim())));
			}
		}
		return paths;
	}

	@debug()
	async lockWorktree(repoPath: string, path: string | Uri, options?: { reason?: string }): Promise<void> {
		await this.git.ensureSupports('git:worktrees', (requiredVersion, installedVersion) =>
			l10n.t(
				'Locking worktrees requires a newer version of Git (>= {0}) than is currently installed ({1}). Please install a more recent version of Git and try again.',
				requiredVersion,
				installedVersion,
			),
		);

		const args = ['worktree', 'lock'];
		if (options?.reason) {
			args.push('--reason', options.reason);
		}
		args.push(normalizePath(toFsPath(path)));

		try {
			await this.git.run({ cwd: repoPath, errors: 'throw' }, ...args);
		} finally {
			// A lock touches no worktree's HEAD, so no worktree's git results or merge targets
			this.context.hooks?.cache?.onReset?.(repoPath, 'worktreeList');
			this.context.hooks?.repository?.onChanged?.(repoPath, ['worktrees']);
		}
	}

	@debug()
	async unlockWorktree(repoPath: string, path: string | Uri): Promise<void> {
		await this.git.ensureSupports('git:worktrees', (requiredVersion, installedVersion) =>
			l10n.t(
				'Unlocking worktrees requires a newer version of Git (>= {0}) than is currently installed ({1}). Please install a more recent version of Git and try again.',
				requiredVersion,
				installedVersion,
			),
		);

		const pathStr = normalizePath(toFsPath(path));
		try {
			await this.git.run({ cwd: repoPath, errors: 'throw' }, 'worktree', 'unlock', pathStr);
		} finally {
			this.context.hooks?.cache?.onReset?.(repoPath, 'worktreeList');
			this.context.hooks?.repository?.onChanged?.(repoPath, ['worktrees']);
		}
	}
}

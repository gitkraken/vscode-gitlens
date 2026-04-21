import { exec } from 'child_process';
import { promises as fs } from 'fs';
import type { Cache } from '@gitlens/git/cache.js';
import type { GitServiceContext } from '@gitlens/git/context.js';
import { WorktreeCreateError, WorktreeDeleteError } from '@gitlens/git/errors.js';
import type { GitWorktree, WorkspaceFolderResolver } from '@gitlens/git/models/worktree.js';
import type { GitWorktreesSubProvider } from '@gitlens/git/providers/worktrees.js';
import { debug } from '@gitlens/utils/decorators/log.js';
import { isWindows } from '@gitlens/utils/env/node/platform.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import { basename, normalizePath } from '@gitlens/utils/path.js';
import { getSettledValue } from '@gitlens/utils/promise.js';
import type { Uri } from '@gitlens/utils/uri.js';
import { fileUri, toFsPath } from '@gitlens/utils/uri.js';
import type { CliGitProviderInternal } from '../cliGitProvider.js';
import type { Git, GitError } from '../exec/git.js';
import { getGitCommandError } from '../exec/git.js';
import { parseGitWorktrees } from '../parsers/worktreeParser.js';

export class WorktreesGitSubProvider implements GitWorktreesSubProvider {
	constructor(
		private readonly context: GitServiceContext,
		private readonly git: Git,
		private readonly cache: Cache,
		private readonly provider: CliGitProviderInternal,
	) {}

	@debug()
	async createWorktree(
		repoPath: string,
		path: string,
		options?: { commitish?: string; createBranch?: string; detach?: boolean; force?: boolean },
	): Promise<void> {
		const scope = getScopedLogger();

		const args = ['worktree', 'add'];
		if (options?.force) {
			args.push('--force');
		}
		if (options?.createBranch) {
			args.push('-b', options.createBranch);
		}
		if (options?.detach) {
			args.push('--detach');
		}
		args.push(path);
		if (options?.commitish) {
			args.push(options.commitish);
		}

		try {
			await this.git.exec({ cwd: repoPath }, ...args);

			this.context.hooks?.cache?.onReset?.(
				repoPath,
				...(options?.createBranch ? (['branches', 'worktrees'] as const) : (['worktrees'] as const)),
			);
			this.context.hooks?.repository?.onChanged?.(
				repoPath,
				options?.createBranch ? ['worktrees', 'heads'] : ['worktrees'],
			);
		} catch (ex) {
			scope?.error(ex);
			throw getGitCommandError(
				'worktree-create',
				ex as GitError,
				reason =>
					new WorktreeCreateError(
						{ reason: reason, gitCommand: { repoPath: repoPath, args: args } },
						ex as GitError,
					),
			);
		}
	}

	async createWorktreeWithResult(
		repoPath: string,
		path: string,
		options?: { commitish?: string; createBranch?: string; detach?: boolean; force?: boolean },
	): Promise<GitWorktree | undefined> {
		await this.createWorktree(repoPath, path, options);
		const normalized = normalizePath(path);
		return this.getWorktree(repoPath, w => normalizePath(w.path) === normalized);
	}

	@debug()
	async getWorktree(
		repoPath: string,
		predicate: (w: GitWorktree) => boolean,
		cancellation?: AbortSignal,
	): Promise<GitWorktree | undefined> {
		return (await this.getWorktrees(repoPath, cancellation)).find(predicate);
	}

	@debug()
	async getWorktrees(repoPath: string, cancellation?: AbortSignal): Promise<GitWorktree[]> {
		await this.git.ensureSupports(
			'git:worktrees',
			'Displaying worktrees',
			' Please install a more recent version of Git and try again.',
		);

		return this.cache.getWorktrees(
			repoPath,
			async (commonPath, _cacheable, signal) => {
				// Prefer the aggregate signal from the cache; fall back to the caller's cancellation.
				signal ??= cancellation;
				const [dataResult, branchesResult] = await Promise.allSettled([
					this.git.exec({ cwd: commonPath, cancellation: signal }, 'worktree', 'list', '--porcelain'),
					this.provider.branches.getBranches(commonPath, undefined, signal),
				]);

				const getWorkspaceFolder: WorkspaceFolderResolver | undefined = this.context.workspace
					? uri => {
							const folder = this.context.workspace!.getFolder(uri.fsPath);
							if (folder == null) return undefined;
							return { uri: fileUri(folder.path), name: basename(folder.path) };
						}
					: undefined;

				return parseGitWorktrees(
					getSettledValue(dataResult)?.stdout,
					commonPath,
					getSettledValue(branchesResult)?.values ?? [],
					getWorkspaceFolder,
				);
			},
			cancellation,
		);
	}

	@debug()
	getWorktreesDefaultUri(repoPath: string): Uri | undefined {
		return this.context.workspace?.getWorktreeDefaultUri?.(repoPath);
	}

	@debug()
	async deleteWorktree(repoPath: string, path: string | Uri, options?: { force?: boolean }): Promise<void> {
		const scope = getScopedLogger();

		await this.git.ensureSupports(
			'git:worktrees',
			'Deleting worktrees',
			' Please install a more recent version of Git and try again.',
		);

		const args = ['worktree', 'remove'];
		if (options?.force) {
			args.push('--force');
		}

		const pathStr = normalizePath(toFsPath(path));
		args.push(pathStr);

		let deleted = false;
		try {
			await this.git.exec({ cwd: repoPath, errors: 'throw' }, ...args);
			deleted = true;
		} catch (ex) {
			scope?.error(ex);
			const gitError = getGitCommandError(
				'worktree-delete',
				ex as GitError,
				reason =>
					new WorktreeDeleteError(
						{ reason: reason, gitCommand: { repoPath: repoPath, args: args } },
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
				this.context.hooks?.cache?.onReset?.(repoPath, 'worktrees');
				this.context.hooks?.repository?.onChanged?.(repoPath, ['worktrees']);
			}
		}
	}
}

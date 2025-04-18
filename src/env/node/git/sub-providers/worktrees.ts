import { exec } from 'child_process';
import { promises as fs } from 'fs';
import { homedir } from 'os';
import { Uri } from 'vscode';
import type { Container } from '../../../../container';
import type { GitCache } from '../../../../git/cache';
import { GitErrorHandling } from '../../../../git/commandOptions';
import {
	WorktreeCreateError,
	WorktreeCreateErrorReason,
	WorktreeDeleteError,
	WorktreeDeleteErrorReason,
} from '../../../../git/errors';
import type { GitWorktreesSubProvider } from '../../../../git/gitProvider';
import type { GitWorktree } from '../../../../git/models/worktree';
import { parseGitWorktrees } from '../../../../git/parsers/worktreeParser';
import { configuration } from '../../../../system/-webview/configuration';
import { log } from '../../../../system/decorators/log';
import { Logger } from '../../../../system/logger';
import { getLogScope } from '../../../../system/logger.scope';
import { joinPaths, normalizePath } from '../../../../system/path';
import { getSettledValue } from '../../../../system/promise';
import { interpolate } from '../../../../system/string';
import type { Git } from '../git';
import { GitErrors } from '../git';
import type { LocalGitProvider } from '../localGitProvider';
import { isWindows } from '../shell';

export class WorktreesGitSubProvider implements GitWorktreesSubProvider {
	constructor(
		private readonly container: Container,
		private readonly git: Git,
		private readonly cache: GitCache,
		private readonly provider: LocalGitProvider,
	) {}

	@log()
	async createWorktree(
		repoPath: string,
		path: string,
		options?: { commitish?: string; createBranch?: string; detach?: boolean; force?: boolean },
	): Promise<void> {
		const scope = getLogScope();

		try {
			await this.git.exec(
				{ cwd: repoPath },
				'worktree',
				'add',
				options?.force ? '--force' : undefined,
				...(options?.createBranch ? ['-b', options.createBranch] : []),
				options?.detach ? '--detach' : undefined,
				path,
				options?.commitish || undefined,
			);

			this.container.events.fire('git:cache:reset', {
				repoPath: repoPath,
				types: options?.createBranch ? ['branches', 'worktrees'] : ['worktrees'],
			});
		} catch (ex) {
			Logger.error(ex, scope);

			const msg = String(ex);

			if (GitErrors.alreadyCheckedOut.test(msg)) {
				throw new WorktreeCreateError(WorktreeCreateErrorReason.AlreadyCheckedOut, ex);
			}

			if (GitErrors.alreadyExists.test(msg)) {
				throw new WorktreeCreateError(WorktreeCreateErrorReason.AlreadyExists, ex);
			}

			throw new WorktreeCreateError(undefined, ex);
		}
	}

	async createWorktreeWithResult(
		repoPath: string,
		path: string,
		options?: { commitish?: string; createBranch?: string; detach?: boolean; force?: boolean },
	): Promise<GitWorktree | undefined> {
		await this.createWorktree(repoPath, path, options);
		const normalized = normalizePath(path);
		return this.getWorktree(repoPath, w => normalizePath(w.uri.fsPath) === normalized);
	}

	@log()
	async getWorktree(repoPath: string, predicate: (w: GitWorktree) => boolean): Promise<GitWorktree | undefined> {
		return (await this.getWorktrees(repoPath)).find(predicate);
	}

	@log()
	async getWorktrees(repoPath: string): Promise<GitWorktree[]> {
		await this.git.ensureSupports(
			'git:worktrees',
			'Displaying worktrees',
			' Please install a more recent version of Git and try again.',
		);

		let worktrees = this.cache.worktrees?.get(repoPath);
		if (worktrees == null) {
			async function load(this: WorktreesGitSubProvider) {
				try {
					const [dataResult, branchesResult] = await Promise.allSettled([
						this.git.exec({ cwd: repoPath }, 'worktree', 'list', '--porcelain'),
						this.provider.branches.getBranches(repoPath),
					]);

					return parseGitWorktrees(
						this.container,
						getSettledValue(dataResult, ''),
						repoPath,
						getSettledValue(branchesResult)?.values ?? [],
					);
				} catch (ex) {
					this.cache.worktrees?.delete(repoPath);

					throw ex;
				}
			}

			worktrees = load.call(this);

			this.cache.worktrees?.set(repoPath, worktrees);
		}

		return worktrees;
	}

	@log()
	async getWorktreesDefaultUri(repoPath: string): Promise<Uri | undefined> {
		let defaultUri = this.getWorktreesDefaultUriCore(repoPath);
		if (defaultUri != null) return defaultUri;

		// If we don't have a default set, default it to the parent folder of the repo folder
		const repo = this.container.git.getRepository(repoPath);
		defaultUri = (await repo?.getCommonRepositoryUri()) ?? repo?.uri;
		if (defaultUri != null) {
			defaultUri = Uri.joinPath(defaultUri, '..');
		}
		return defaultUri;
	}

	private getWorktreesDefaultUriCore(repoPath: string): Uri | undefined {
		let location = configuration.get('worktrees.defaultLocation');
		if (location == null) return undefined;

		if (location.startsWith('~')) {
			location = joinPaths(homedir(), location.slice(1));
		}

		const folder = this.container.git.getRepository(repoPath)?.folder;
		location = interpolate(location, {
			userHome: homedir(),
			workspaceFolder: folder?.uri.fsPath,
			workspaceFolderBasename: folder?.name,
		});

		return this.provider.getAbsoluteUri(location, repoPath);
	}

	@log()
	async deleteWorktree(repoPath: string, path: string | Uri, options?: { force?: boolean }): Promise<void> {
		const scope = getLogScope();

		await this.git.ensureSupports(
			'git:worktrees',
			'Deleting worktrees',
			' Please install a more recent version of Git and try again.',
		);

		path = normalizePath(typeof path === 'string' ? path : path.fsPath);
		try {
			await this.git.exec(
				{ cwd: repoPath, errors: GitErrorHandling.Throw },
				'worktree',
				'remove',
				options?.force ? '--force' : undefined,
				path,
			);
		} catch (ex) {
			Logger.error(ex, scope);

			const msg = String(ex);

			if (GitErrors.mainWorkingTree.test(msg)) {
				throw new WorktreeDeleteError(WorktreeDeleteErrorReason.DefaultWorkingTree, ex);
			}

			if (GitErrors.uncommittedChanges.test(msg)) {
				throw new WorktreeDeleteError(WorktreeDeleteErrorReason.HasChanges, ex);
			}

			if (GitErrors.failedToDeleteDirectoryNotEmpty.test(msg)) {
				Logger.warn(
					scope,
					`Failed to fully delete worktree '${path}' because it is not empty. Attempting to delete it manually.`,
					scope,
				);
				try {
					await fs.rm(path, { force: true, recursive: true });
					return;
				} catch (ex) {
					if (isWindows) {
						const match = /EPERM: operation not permitted, unlink '(.*?)'/i.exec(ex.message);
						if (match != null) {
							Logger.warn(
								scope,
								`Failed to manually delete '${path}' because it is in use. Attempting to forcefully delete it.`,
								scope,
							);

							function deleteInUseSymlink(symlink: string) {
								return new Promise((resolve, reject) => {
									exec(`del "${symlink}"`, (ex, stdout, stderr) => {
										if (ex) {
											reject(ex instanceof Error ? ex : new Error(ex));
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
								await fs.rm(path, { force: true, recursive: true, maxRetries: 1, retryDelay: 1 });
								return;
							} catch (ex) {
								Logger.error(
									ex,
									scope,
									`Failed to forcefully delete '${path}' because it is in use.`,
									scope,
								);
							}
						}
					}

					throw new WorktreeDeleteError(WorktreeDeleteErrorReason.DirectoryNotEmpty, ex);
				}
			}

			throw new WorktreeDeleteError(undefined, ex);
		} finally {
			this.container.events.fire('git:cache:reset', { repoPath: repoPath, types: ['worktrees'] });
		}
	}
}

import { exec } from 'child_process';
import { promises as fs } from 'fs';
import { homedir } from 'os';
import type { CancellationToken } from 'vscode';
import { Uri } from 'vscode';
import type { Container } from '../../../../container';
import type { GitCache } from '../../../../git/cache';
import { GitErrorHandling } from '../../../../git/commandOptions';
import { WorktreeCreateError, WorktreeDeleteError } from '../../../../git/errors';
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
import { getGitCommandError } from '../git';
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

			this.container.events.fire('git:cache:reset', {
				repoPath: repoPath,
				types: options?.createBranch ? ['branches', 'worktrees'] : ['worktrees'],
			});
		} catch (ex) {
			Logger.error(ex, scope);
			throw getGitCommandError(
				'worktree-create',
				ex,
				reason =>
					new WorktreeCreateError({ reason: reason, gitCommand: { repoPath: repoPath, args: args } }, ex),
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
		return this.getWorktree(repoPath, w => normalizePath(w.uri.fsPath) === normalized);
	}

	@log()
	async getWorktree(
		repoPath: string,
		predicate: (w: GitWorktree) => boolean,
		cancellation?: CancellationToken,
	): Promise<GitWorktree | undefined> {
		return (await this.getWorktrees(repoPath, cancellation)).find(predicate);
	}

	@log()
	async getWorktrees(repoPath: string, cancellation?: CancellationToken): Promise<GitWorktree[]> {
		await this.git.ensureSupports(
			'git:worktrees',
			'Displaying worktrees',
			' Please install a more recent version of Git and try again.',
		);
		const worktrees = this.cache.worktrees.getOrCreate(repoPath, async () => {
			const [dataResult, branchesResult] = await Promise.allSettled([
				this.git.exec({ cwd: repoPath, cancellation: cancellation }, 'worktree', 'list', '--porcelain'),
				this.provider.branches.getBranches(repoPath, undefined, cancellation),
			]);

			return parseGitWorktrees(
				this.container,
				getSettledValue(dataResult)?.stdout,
				repoPath,
				getSettledValue(branchesResult)?.values ?? [],
			);
		});

		if (worktrees == null) {
			const [dataResult, branchesResult] = await Promise.allSettled([
				this.git.exec({ cwd: repoPath, cancellation: cancellation }, 'worktree', 'list', '--porcelain'),
				this.provider.branches.getBranches(repoPath, undefined, cancellation),
			]);

			return parseGitWorktrees(
				this.container,
				getSettledValue(dataResult)?.stdout,
				repoPath,
				getSettledValue(branchesResult)?.values ?? [],
			);
		}

		return worktrees;
	}

	@log()
	getWorktreesDefaultUri(repoPath: string): Uri | undefined {
		let defaultUri = this.getWorktreesDefaultUriCore(repoPath);
		if (defaultUri != null) return defaultUri;

		// If we don't have a default set, default it to the parent folder of the repo folder
		const repo = this.container.git.getRepository(repoPath);
		defaultUri = repo?.commonUri ?? repo?.uri;
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

		const args = ['worktree', 'remove'];
		if (options?.force) {
			args.push('--force');
		}

		path = normalizePath(typeof path === 'string' ? path : path.fsPath);
		args.push(path);

		try {
			await this.git.exec({ cwd: repoPath, errors: GitErrorHandling.Throw }, ...args);
		} catch (ex) {
			Logger.error(ex, scope);
			const gitError = getGitCommandError(
				'worktree-delete',
				ex,
				reason =>
					new WorktreeDeleteError({ reason: reason, gitCommand: { repoPath: repoPath, args: args } }, ex),
			);

			if (gitError.details.reason === 'directoryNotEmpty') {
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
				}
			}

			throw gitError;
		} finally {
			this.container.events.fire('git:cache:reset', { repoPath: repoPath, types: ['worktrees'] });
		}
	}
}

import { exec } from 'child_process';
import { promises as fs } from 'fs';
import { homedir } from 'os';
import type { CancellationToken } from 'vscode';
import { Uri } from 'vscode';
import type { Container } from '../../../../container.js';
import type { GitCache } from '../../../../git/cache.js';
import { WorktreeCreateError, WorktreeDeleteError } from '../../../../git/errors.js';
import type { GitWorktreesSubProvider } from '../../../../git/gitProvider.js';
import type { GitWorktree } from '../../../../git/models/worktree.js';
import { parseGitWorktrees } from '../../../../git/parsers/worktreeParser.js';
import { configuration } from '../../../../system/-webview/configuration.js';
import { debug } from '../../../../system/decorators/log.js';
import { getScopedLogger } from '../../../../system/logger.scope.js';
import { joinPaths, normalizePath } from '../../../../system/path.js';
import { getSettledValue } from '../../../../system/promise.js';
import { interpolate } from '../../../../system/string.js';
import type { Git } from '../git.js';
import { getGitCommandError } from '../git.js';
import type { LocalGitProviderInternal } from '../localGitProvider.js';
import { isWindows } from '../shell.js';

export class WorktreesGitSubProvider implements GitWorktreesSubProvider {
	constructor(
		private readonly container: Container,
		private readonly git: Git,
		private readonly cache: GitCache,
		private readonly provider: LocalGitProviderInternal,
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

			this.container.events.fire('git:cache:reset', {
				repoPath: repoPath,
				types: options?.createBranch ? ['branches', 'worktrees'] : ['worktrees'],
			});
		} catch (ex) {
			scope?.error(ex);
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

	@debug()
	async getWorktree(
		repoPath: string,
		predicate: (w: GitWorktree) => boolean,
		cancellation?: CancellationToken,
	): Promise<GitWorktree | undefined> {
		return (await this.getWorktrees(repoPath, cancellation)).find(predicate);
	}

	@debug()
	async getWorktrees(repoPath: string, cancellation?: CancellationToken): Promise<GitWorktree[]> {
		await this.git.ensureSupports(
			'git:worktrees',
			'Displaying worktrees',
			' Please install a more recent version of Git and try again.',
		);

		return this.cache.getWorktrees(repoPath, async (commonPath, _cacheable) => {
			const [dataResult, branchesResult] = await Promise.allSettled([
				this.git.exec({ cwd: commonPath, cancellation: cancellation }, 'worktree', 'list', '--porcelain'),
				// Use commonPath to get shared branches (repoPath=commonPath, current=false)
				// The worktree mapper will remap branches to the requester's context
				this.provider.branches.getBranches(commonPath, undefined, cancellation),
			]);

			return parseGitWorktrees(
				this.container,
				getSettledValue(dataResult)?.stdout,
				commonPath,
				getSettledValue(branchesResult)?.values ?? [],
			);
		});
	}

	@debug()
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

		path = normalizePath(typeof path === 'string' ? path : path.fsPath);
		args.push(path);

		try {
			await this.git.exec({ cwd: repoPath, errors: 'throw' }, ...args);
		} catch (ex) {
			scope?.error(ex);
			const gitError = getGitCommandError(
				'worktree-delete',
				ex,
				reason =>
					new WorktreeDeleteError({ reason: reason, gitCommand: { repoPath: repoPath, args: args } }, ex),
			);

			if (gitError.details.reason === 'directoryNotEmpty') {
				scope?.warn(
					`Failed to fully delete worktree '${path}' because it is not empty. Attempting to delete it manually.`,
				);
				try {
					await fs.rm(path, { force: true, recursive: true });
					return;
				} catch (ex) {
					if (isWindows) {
						const match = /EPERM: operation not permitted, unlink '(.*?)'/i.exec(ex.message);
						if (match != null) {
							scope?.warn(
								`Failed to manually delete '${path}' because it is in use. Attempting to forcefully delete it.`,
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
								scope?.error(ex, `Failed to forcefully delete '${path}' because it is in use.`);
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

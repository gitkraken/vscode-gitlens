import { window } from 'vscode';
import type { Container } from '../../../../container';
import { CancellationError } from '../../../../errors';
import {
	ApplyPatchCommitError,
	ApplyPatchCommitErrorReason,
	CherryPickError,
	CherryPickErrorReason,
	StashPushError,
	WorktreeCreateError,
} from '../../../../git/errors';
import type { GitPatchSubProvider } from '../../../../git/gitProvider';
import type { GitCommit, GitCommitIdentityShape } from '../../../../git/models/commit';
import { log } from '../../../../system/decorators/log';
import { Logger } from '../../../../system/logger';
import { getLogScope } from '../../../../system/logger.scope';
import type { Git } from '../git';
import { gitConfigsLog } from '../git';
import type { LocalGitProvider } from '../localGitProvider';

export class PatchGitSubProvider implements GitPatchSubProvider {
	constructor(
		private readonly container: Container,
		private readonly git: Git,
		private readonly provider: LocalGitProvider,
	) {}

	@log()
	async applyUnreachableCommitForPatch(
		repoPath: string,
		rev: string,
		options?: {
			branchName?: string;
			createBranchIfNeeded?: boolean;
			createWorktreePath?: string;
			stash?: boolean | 'prompt';
		},
	): Promise<void> {
		const scope = getLogScope();

		if (options?.stash) {
			// Stash any changes first
			const hasChanges = await this.provider.status?.hasWorkingChanges(repoPath);
			if (hasChanges) {
				if (options.stash === 'prompt') {
					const confirm = { title: 'Stash Changes' };
					const cancel = { title: 'Cancel', isCloseAffordance: true };
					const result = await window.showWarningMessage(
						'You have changes in your working tree.\nDo you want to stash them before applying the patch?',
						{ modal: true },
						confirm,
						cancel,
					);

					if (result !== confirm) throw new CancellationError();
				}

				try {
					await this.git.stash__push(repoPath, undefined, { includeUntracked: true });
				} catch (ex) {
					Logger.error(ex, scope);
					throw new ApplyPatchCommitError(
						ApplyPatchCommitErrorReason.StashFailed,
						`Unable to apply patch; failed stashing working changes changes${
							ex instanceof StashPushError ? `: ${ex.message}` : ''
						}`,
						ex,
					);
				}
			}
		}

		let targetPath = repoPath;
		const currentBranch = await this.provider.branches.getBranch(repoPath);
		const branchExists =
			options?.branchName == null ||
			currentBranch?.name === options.branchName ||
			(await this.provider.branches.getBranches(repoPath, { filter: b => b.name === options.branchName }))?.values
				?.length > 0;
		const shouldCreate = options?.branchName != null && !branchExists && options.createBranchIfNeeded;

		// TODO: Worktree creation should ideally be handled before calling this, and then
		// applyPatchCommit should be pointing to the worktree path. If done here, the newly created
		// worktree cannot be opened and we cannot handle issues elegantly.
		if (options?.createWorktreePath != null) {
			if (options?.branchName === null || options.branchName === currentBranch?.name) {
				throw new ApplyPatchCommitError(
					ApplyPatchCommitErrorReason.CreateWorktreeFailed,
					'Unable to apply patch; failed creating worktree',
				);
			}

			try {
				const worktree = await this.provider.worktrees.createWorktreeWithResult(
					repoPath,
					options.createWorktreePath,
					{
						commitish:
							options?.branchName != null && branchExists ? options.branchName : currentBranch?.name,
						createBranch: shouldCreate ? options.branchName : undefined,
					},
				);
				if (worktree == null) {
					throw new ApplyPatchCommitError(
						ApplyPatchCommitErrorReason.CreateWorktreeFailed,
						'Unable to apply patch; failed creating worktree',
					);
				}

				targetPath = worktree.uri.fsPath;
			} catch (ex) {
				Logger.error(ex, scope);
				throw new ApplyPatchCommitError(
					ApplyPatchCommitErrorReason.CreateWorktreeFailed,
					`Unable to apply patch; failed creating worktree${
						ex instanceof WorktreeCreateError ? `: ${ex.message}` : ''
					}`,
					ex,
				);
			}
		}

		if (options?.branchName != null && currentBranch?.name !== options.branchName) {
			const checkoutRef = shouldCreate ? (currentBranch?.ref ?? 'HEAD') : options.branchName;
			await this.provider.ops.checkout(targetPath, checkoutRef, {
				createBranch: shouldCreate ? options.branchName : undefined,
			});
		}

		// Apply the patch using a cherry pick without committing
		try {
			await this.provider.ops.cherryPick(targetPath, [rev], { noCommit: true });
		} catch (ex) {
			Logger.error(ex, scope);
			if (ex instanceof CherryPickError) {
				if (ex.reason === CherryPickErrorReason.Conflicts) {
					throw new ApplyPatchCommitError(
						ApplyPatchCommitErrorReason.AppliedWithConflicts,
						`Patch applied with conflicts`,
						ex,
					);
				}

				if (ex.reason === CherryPickErrorReason.AbortedWouldOverwrite) {
					throw new ApplyPatchCommitError(
						ApplyPatchCommitErrorReason.ApplyAbortedWouldOverwrite,
						`Unable to apply patch as some local changes would be overwritten`,
						ex,
					);
				}
			}

			throw new ApplyPatchCommitError(
				ApplyPatchCommitErrorReason.ApplyFailed,
				`Unable to apply patch${ex instanceof CherryPickError ? `: ${ex.message}` : ''}`,
				ex,
			);
		}
	}

	@log({ args: { 2: '<message>', 3: '<patch>' } })
	async createUnreachableCommitForPatch(
		repoPath: string,
		base: string,
		message: string,
		patch: string,
	): Promise<GitCommit | undefined> {
		// Create a temporary index file
		await using disposableIndex = await this.provider.staging!.createTemporaryIndex(repoPath, base);
		const { env } = disposableIndex;

		const sha = await this.createUnreachableCommitForPatchCore(env, repoPath, base, message, patch);
		// eslint-disable-next-line no-return-await -- await is needed for the disposableIndex to be disposed properly after
		return await this.provider.commits.getCommit(repoPath, sha);
	}

	@log<PatchGitSubProvider['createUnreachableCommitsFromPatches']>({ args: { 2: p => p.length } })
	async createUnreachableCommitsFromPatches(
		repoPath: string,
		base: string | undefined,
		patches: { message: string; patch: string; author?: GitCommitIdentityShape }[],
	): Promise<string[]> {
		// Create a temporary index file
		await using disposableIndex = await this.provider.staging!.createTemporaryIndex(repoPath, base);
		const { env } = disposableIndex;

		const shas: string[] = [];

		for (const { message, patch, author } of patches) {
			const sha = await this.createUnreachableCommitForPatchCore(env, repoPath, base, message, patch, author);
			shas.push(sha);
			base = sha;
		}

		return shas;
	}

	private async createUnreachableCommitForPatchCore(
		env: Record<string, any>,
		repoPath: string,
		base: string | undefined,
		message: string,
		patch: string,
		author?: GitCommitIdentityShape,
	): Promise<string> {
		const scope = getLogScope();

		if (!patch.endsWith('\n')) {
			patch += '\n';
		}

		try {
			// Apply the patch to our temp index, without touching the working directory
			await this.git.exec(
				{ cwd: repoPath, configs: gitConfigsLog, env: env, stdin: patch },
				'apply',
				'--cached',
				'-',
			);

			// Create a new tree from our patched index
			let result = await this.git.exec({ cwd: repoPath, env: env }, 'write-tree');
			const tree = result.stdout.trim();

			// Set the author if provided
			const commitEnv = author
				? {
						...env,
						GIT_AUTHOR_NAME: author.name,
						GIT_AUTHOR_EMAIL: author.email || '',
					}
				: env;

			// Create new commit from the tree
			result = await this.git.exec(
				{ cwd: repoPath, env: commitEnv },
				'commit-tree',
				tree,
				...(base ? ['-p', base] : []),
				'-m',
				message,
			);
			const sha = result.stdout.trim();

			return sha;
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;

			throw ex;
		}
	}

	async createEmptyInitialCommit(repoPath: string): Promise<string> {
		const emptyTree = await this.git.exec({ cwd: repoPath }, 'hash-object', '-t', 'tree', '/dev/null');
		const result = await this.git.exec({ cwd: repoPath }, 'commit-tree', emptyTree.stdout.trim(), '-m', 'temp');
		// create ref/heaads/main and point to it
		await this.git.exec({ cwd: repoPath }, 'update-ref', 'refs/heads/main', result.stdout.trim());
		// point HEAD to the branch
		await this.git.exec({ cwd: repoPath }, 'symbolic-ref', 'HEAD', 'refs/heads/main');
		return result.stdout.trim();
	}

	@log({ args: { 1: false } })
	async validatePatch(repoPath: string | undefined, contents: string): Promise<boolean> {
		try {
			await this.git.exec({ cwd: repoPath, configs: gitConfigsLog, stdin: contents }, 'apply', '--check', '-');
			return true;
		} catch (ex) {
			if (ex instanceof Error && ex.message) {
				if (ex.message.includes('No valid patches in input')) {
					return false;
				}

				return true;
			}

			return false;
		}
	}
}

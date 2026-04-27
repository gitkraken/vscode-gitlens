import type { Cache } from '@gitlens/git/cache.js';
import type { GitServiceContext } from '@gitlens/git/context.js';
import type { GitCommandContext } from '@gitlens/git/errors.js';
import { ApplyPatchCommitError, CherryPickError, SigningError } from '@gitlens/git/errors.js';
import type { GitCommit, GitCommitIdentityShape } from '@gitlens/git/models/commit.js';
import type { SigningFormat } from '@gitlens/git/models/signature.js';
import type { GitPatchSubProvider } from '@gitlens/git/providers/patch.js';
import { debug } from '@gitlens/utils/decorators/log.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import { getSettledValue } from '@gitlens/utils/promise.js';
import type { CliGitProviderInternal } from '../cliGitProvider.js';
import { RunError } from '../exec/exec.errors.js';
import type { Git } from '../exec/git.js';
import { classifySigningError, gitConfigsLog, GitError } from '../exec/git.js';

export class PatchGitSubProvider implements GitPatchSubProvider {
	constructor(
		private readonly context: GitServiceContext,
		private readonly git: Git,
		private readonly cache: Cache,
		private readonly provider: CliGitProviderInternal,
	) {}

	@debug()
	async apply(repoPath: string, patch: string, options?: { threeWay?: boolean }): Promise<void> {
		const args = ['apply', '--whitespace=warn'];
		if (options?.threeWay) {
			args.push('--3way');
		}
		await this.git.exec({ cwd: repoPath, stdin: patch }, ...args);
	}

	@debug()
	async applyUnreachableCommitForPatch(
		repoPath: string,
		rev: string,
		options?: {
			branchName?: string;
			createBranchIfNeeded?: boolean;
			createWorktreePath?: string;
			stash?: boolean;
		},
	): Promise<void> {
		const scope = getScopedLogger();

		if (options?.stash) {
			// Stash any changes first
			const hasChanges = await this.provider.status?.hasWorkingChanges(repoPath);
			if (hasChanges) {
				try {
					await this.provider.stash.saveStash(repoPath, undefined, undefined, {
						includeUntracked: true,
					});
				} catch (ex) {
					scope?.error(ex);
					throw new ApplyPatchCommitError({ reason: 'stashFailed' }, ex as Error);
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

		if (options?.createWorktreePath != null) {
			if (options?.branchName === null || options.branchName === currentBranch?.name) {
				throw new ApplyPatchCommitError({ reason: 'createWorktreeFailed' });
			}

			try {
				const worktree = await this.provider.worktrees?.createWorktreeWithResult(
					repoPath,
					options.createWorktreePath,
					{
						commitish:
							options?.branchName != null && branchExists ? options.branchName : currentBranch?.name,
						createBranch: shouldCreate ? options.branchName : undefined,
					},
				);
				if (worktree == null) {
					throw new ApplyPatchCommitError({ reason: 'createWorktreeFailed' });
				}

				targetPath = worktree.path;
			} catch (ex) {
				scope?.error(ex);
				throw new ApplyPatchCommitError({ reason: 'createWorktreeFailed' }, ex as Error);
			}
		}

		if (options?.branchName != null && currentBranch?.name !== options.branchName) {
			const checkoutRef = shouldCreate ? (currentBranch?.ref ?? 'HEAD') : options.branchName;
			try {
				await this.provider.ops?.checkout(targetPath, checkoutRef, {
					createBranch: shouldCreate ? options.branchName : undefined,
				});
			} catch (ex) {
				scope?.error(ex);
				throw new ApplyPatchCommitError({ reason: 'checkoutFailed', branch: options.branchName }, ex as Error);
			}
		}

		// Apply the patch using a cherry pick without committing
		try {
			const result = await this.provider.ops?.cherryPick(targetPath, [rev], { noCommit: true });
			if (result?.conflicted) {
				throw new ApplyPatchCommitError({ reason: 'appliedWithConflicts' });
			}
		} catch (ex) {
			if (ex instanceof ApplyPatchCommitError) throw ex;
			scope?.error(ex);

			if (CherryPickError.is(ex, 'wouldOverwriteChanges')) {
				throw new ApplyPatchCommitError({ reason: 'wouldOverwriteChanges' }, ex);
			}

			throw new ApplyPatchCommitError({ reason: 'applyFailed' }, ex as Error);
		}
	}

	@debug({
		args: (repoPath, base, _message, _patch) => ({
			repoPath: repoPath,
			base: base,
			message: '<message>',
			patch: '<patch>',
		}),
	})
	async createUnreachableCommitForPatch(
		repoPath: string,
		base: string,
		message: string,
		patch: string,
		options?: { sign?: boolean; source?: unknown },
	): Promise<GitCommit | undefined> {
		// Create a temporary index file from the base ref
		await using disposableIndex = await this.provider.staging.createTemporaryIndex(repoPath, 'ref', base);
		const { env } = disposableIndex;

		const sha = await this.createUnreachableCommitForPatchCore(
			env,
			repoPath,
			base,
			message,
			patch,
			undefined,
			options,
		);
		// await is needed for the disposableIndex to be disposed properly after
		return await this.provider.commits.getCommit(repoPath, sha);
	}

	@debug({ args: (repoPath, base, patches) => ({ repoPath: repoPath, base: base, patches: patches.length }) })
	async createUnreachableCommitsFromPatches(
		repoPath: string,
		base: string | undefined,
		patches: { message: string; patch: string; author?: GitCommitIdentityShape }[],
		options?: { sign?: boolean; source?: unknown },
	): Promise<string[]> {
		// Create a temporary index file - use empty index if no base (orphan commits)
		await using disposableIndex = base
			? await this.provider.staging.createTemporaryIndex(repoPath, 'ref', base)
			: await this.provider.staging.createTemporaryIndex(repoPath, 'empty');
		const { env } = disposableIndex;

		const shas: string[] = [];

		for (const { message, patch, author } of patches) {
			const sha = await this.createUnreachableCommitForPatchCore(
				env,
				repoPath,
				base,
				message,
				patch,
				author,
				options,
			);
			shas.push(sha);
			base = sha;
		}

		return shas;
	}

	private async createUnreachableCommitForPatchCore(
		env: Record<string, string>,
		repoPath: string,
		base: string | undefined,
		message: string,
		patch: string,
		author?: GitCommitIdentityShape,
		options?: { sign?: boolean; source?: unknown },
	): Promise<string> {
		const scope = getScopedLogger();

		if (!patch.endsWith('\n')) {
			patch += '\n';
		}

		let shouldSign = options?.sign;
		let _signingFormat: SigningFormat = 'gpg';

		try {
			const [signingConfigResult, applyResult] = await Promise.allSettled([
				this.provider.config.getSigningConfig?.(repoPath),
				// Apply the patch to our temp index, without touching the working directory
				this.git.exec(
					{ cwd: repoPath, configs: gitConfigsLog, env: env, stdin: patch },
					'apply',
					'--cached',
					'-',
				),
			]);
			if (applyResult.status === 'rejected') throw applyResult.reason;

			// Check if we should sign
			const signingConfig = getSettledValue(signingConfigResult);
			shouldSign ??= signingConfig?.enabled ?? false;
			_signingFormat = signingConfig?.format ?? 'gpg';

			// Create a new tree from our patched index
			let result = await this.git.exec({ cwd: repoPath, env: env }, 'write-tree');
			const tree = result.stdout.trim();

			// Set the author if provided
			let finalEnv = env;
			if (author) {
				finalEnv = { ...env, GIT_AUTHOR_NAME: author.name, GIT_AUTHOR_EMAIL: author.email || '' };
			}

			// Create new commit from the tree
			const args = ['commit-tree', tree];
			if (base) {
				args.push('-p', base);
			}

			// Add signing flag if enabled
			if (shouldSign) {
				args.push('-S');
			}

			args.push('-m', message);

			// Create new commit from the tree
			result = await this.git.exec({ cwd: repoPath, env: finalEnv }, ...args);
			const sha = result.stdout.trim();

			if (shouldSign) {
				this.context.hooks?.commits?.onSigned?.(_signingFormat, options?.source);
			}

			return sha;
		} catch (ex) {
			scope?.error(ex);

			// Handle signing-specific errors
			if (shouldSign && ex instanceof Error) {
				const reason = classifySigningError(ex);
				if (reason != null) {
					const gitCommand: GitCommandContext = { repoPath: repoPath, args: ['commit-tree'] };
					const signingError = new SigningError({ reason: reason, gitCommand: gitCommand }, ex);
					this.context.hooks?.commits?.onSigningFailed?.(reason, _signingFormat, options?.source);
					throw signingError;
				}
			}

			throw ex;
		}
	}

	async createEmptyInitialCommit(repoPath: string): Promise<string> {
		const emptyTree = await this.git.exec({ cwd: repoPath, stdin: '' }, 'hash-object', '-t', 'tree', '--stdin');
		const result = await this.git.exec({ cwd: repoPath }, 'commit-tree', emptyTree.stdout.trim(), '-m', 'temp');
		// create refs/heads/main and point to it
		await this.git.exec({ cwd: repoPath }, 'update-ref', 'refs/heads/main', result.stdout.trim());
		// point HEAD to the branch
		await this.git.exec({ cwd: repoPath }, 'symbolic-ref', 'HEAD', 'refs/heads/main');
		return result.stdout.trim();
	}

	@debug({ args: repoPath => ({ repoPath: repoPath }) })
	async validatePatch(repoPath: string | undefined, contents: string): Promise<boolean> {
		try {
			await this.git.exec({ cwd: repoPath, configs: gitConfigsLog, stdin: contents }, 'apply', '--check', '-');
			return true;
		} catch (ex) {
			if (ex instanceof RunError || ex instanceof GitError) {
				if ((ex.stderr ?? '').includes('No valid patches in input')) {
					return false;
				}

				// Other git errors mean the patch had content but couldn't apply cleanly
				return true;
			}

			return false;
		}
	}
}

import { window } from 'vscode';
import type { Source } from '../../../../constants.telemetry.js';
import type { Container } from '../../../../container.js';
import { CancellationError } from '../../../../errors.js';
import type { GitCommandContext, SigningErrorReason } from '../../../../git/errors.js';
import { ApplyPatchCommitError, CherryPickError, SigningError } from '../../../../git/errors.js';
import type { GitPatchSubProvider } from '../../../../git/gitProvider.js';
import type { GitCommit, GitCommitIdentityShape } from '../../../../git/models/commit.js';
import type { SigningFormat } from '../../../../git/models/signature.js';
import { debug } from '../../../../system/decorators/log.js';
import { getScopedLogger } from '../../../../system/logger.scope.js';
import { getSettledValue } from '../../../../system/promise.js';
import type { Git } from '../git.js';
import { gitConfigsLog } from '../git.js';
import type { LocalGitProviderInternal } from '../localGitProvider.js';

export class PatchGitSubProvider implements GitPatchSubProvider {
	constructor(
		private readonly container: Container,
		private readonly git: Git,
		private readonly provider: LocalGitProviderInternal,
	) {}

	@debug()
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
		const scope = getScopedLogger();

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
					scope?.error(ex);
					throw new ApplyPatchCommitError({ reason: 'stashFailed' }, ex);
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
				throw new ApplyPatchCommitError({ reason: 'createWorktreeFailed' });
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
					throw new ApplyPatchCommitError({ reason: 'createWorktreeFailed' });
				}

				targetPath = worktree.uri.fsPath;
			} catch (ex) {
				scope?.error(ex);
				throw new ApplyPatchCommitError({ reason: 'createWorktreeFailed' }, ex);
			}
		}

		if (options?.branchName != null && currentBranch?.name !== options.branchName) {
			const checkoutRef = shouldCreate ? (currentBranch?.ref ?? 'HEAD') : options.branchName;
			try {
				await this.provider.ops.checkout(targetPath, checkoutRef, {
					createBranch: shouldCreate ? options.branchName : undefined,
				});
			} catch (ex) {
				scope?.error(ex);
				throw new ApplyPatchCommitError({ reason: 'checkoutFailed', branch: options.branchName }, ex);
			}
		}

		// Apply the patch using a cherry pick without committing
		try {
			await this.provider.ops.cherryPick(targetPath, [rev], { noCommit: true });
		} catch (ex) {
			scope?.error(ex);
			if (CherryPickError.is(ex, 'conflicts')) {
				throw new ApplyPatchCommitError({ reason: 'appliedWithConflicts' }, ex);
			}

			if (CherryPickError.is(ex, 'wouldOverwriteChanges')) {
				throw new ApplyPatchCommitError({ reason: 'wouldOverwriteChanges' }, ex);
			}

			throw new ApplyPatchCommitError({ reason: 'applyFailed' }, ex);
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
		options?: { sign?: boolean; source?: Source },
	): Promise<GitCommit | undefined> {
		// Create a temporary index file from the base ref
		await using disposableIndex = await this.provider.staging!.createTemporaryIndex(repoPath, 'ref', base);
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
		// eslint-disable-next-line no-return-await -- await is needed for the disposableIndex to be disposed properly after
		return await this.provider.commits.getCommit(repoPath, sha);
	}

	@debug({ args: (repoPath, base, patches) => ({ repoPath: repoPath, base: base, patches: patches.length }) })
	async createUnreachableCommitsFromPatches(
		repoPath: string,
		base: string | undefined,
		patches: { message: string; patch: string; author?: GitCommitIdentityShape }[],
		options?: { sign?: boolean; source?: Source },
	): Promise<string[]> {
		// Create a temporary index file - use empty index if no base (orphan commits)
		await using disposableIndex = base
			? await this.provider.staging!.createTemporaryIndex(repoPath, 'ref', base)
			: await this.provider.staging!.createTemporaryIndex(repoPath, 'empty');
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
		env: Record<string, any>,
		repoPath: string,
		base: string | undefined,
		message: string,
		patch: string,
		author?: GitCommitIdentityShape,
		options?: { sign?: boolean; source?: Source },
	): Promise<string> {
		const scope = getScopedLogger();

		if (!patch.endsWith('\n')) {
			patch += '\n';
		}

		let shouldSign = options?.sign;
		let signingFormat: SigningFormat = 'gpg';

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
			signingFormat = signingConfig?.format ?? 'gpg';

			// Create a new tree from our patched index
			let result = await this.git.exec({ cwd: repoPath, env: env }, 'write-tree');
			const tree = result.stdout.trim();

			// Set the author if provided
			if (author) {
				env = { ...env, GIT_AUTHOR_NAME: author.name, GIT_AUTHOR_EMAIL: author.email || '' };
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
			result = await this.git.exec({ cwd: repoPath, env: env }, ...args);
			const sha = result.stdout.trim();

			// Send telemetry for successful signed commit
			if (shouldSign) {
				this.container.telemetry.sendEvent('commit/signed', { format: signingFormat }, options?.source);
			}

			return sha;
		} catch (ex) {
			scope?.error(ex);

			// Handle signing-specific errors
			if (shouldSign && ex instanceof Error) {
				const errorMessage = ex.message.toLowerCase();
				const gitCommand: GitCommandContext = { repoPath: repoPath, args: ['commit-tree'] };
				let signingError: SigningError | undefined;

				if (errorMessage.includes('gpg failed to sign') || errorMessage.includes('error: gpg')) {
					signingError = new SigningError({ reason: 'passphraseFailed', gitCommand: gitCommand }, ex);
				} else if (
					errorMessage.includes('secret key not available') ||
					errorMessage.includes('no secret key') ||
					errorMessage.includes('no signing key')
				) {
					signingError = new SigningError({ reason: 'noKey', gitCommand: gitCommand }, ex);
				} else if (
					errorMessage.includes('gpg: command not found') ||
					(errorMessage.includes('gpg') && errorMessage.includes('not found'))
				) {
					signingError = new SigningError({ reason: 'gpgNotFound', gitCommand: gitCommand }, ex);
				} else if (errorMessage.includes('ssh-keygen') && errorMessage.includes('not found')) {
					signingError = new SigningError({ reason: 'sshNotFound', gitCommand: gitCommand }, ex);
				}

				if (signingError != null) {
					// Send telemetry for signing failure
					this.container.telemetry.sendEvent(
						'commit/signing/failed',
						{ reason: this.getSigningFailureReason(signingError.details.reason), format: signingFormat },
						options?.source,
					);
					throw signingError;
				}
			}

			debugger;
			throw ex;
		}
	}

	private getSigningFailureReason(reason: SigningErrorReason | undefined): SigningErrorReason {
		return reason ?? 'unknown';
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

	@debug({ args: repoPath => ({ repoPath: repoPath }) })
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

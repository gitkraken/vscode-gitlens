import type { Cache } from '@gitlens/git/cache.js';
import type { GitConflictCommand, GitServiceContext } from '@gitlens/git/context.js';
import {
	CheckoutError,
	CherryPickError,
	CommitError,
	FetchError,
	MergeError,
	PullError,
	PushError,
	RebaseError,
	ResetError,
	RevertError,
	SigningError,
} from '@gitlens/git/errors.js';
import type { GitBranchReference, GitReference } from '@gitlens/git/models/reference.js';
import type { SigningFormat } from '@gitlens/git/models/signature.js';
import type { GitConflictFile } from '@gitlens/git/models/staging.js';
import type { GitOperationResult, GitOperationsSubProvider } from '@gitlens/git/providers/operations.js';
import { getBranchNameAndRemote, getBranchTrackingWithoutRemote } from '@gitlens/git/utils/branch.utils.js';
import { isBranchReference } from '@gitlens/git/utils/reference.utils.js';
import { debug } from '@gitlens/utils/decorators/log.js';
import { sequentialize } from '@gitlens/utils/decorators/sequentialize.js';
import { Logger } from '@gitlens/utils/logger.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import { normalizePath, splitPath } from '@gitlens/utils/path.js';
import type { CliGitProviderInternal } from '../cliGitProvider.js';
import type { Git, PushForceOptions } from '../exec/git.js';
import {
	classifySigningError,
	getGitCommandError,
	gitConfigsPull,
	GitErrors,
	inferSigningFormatFromError,
} from '../exec/git.js';

export class OperationsGitSubProvider implements GitOperationsSubProvider {
	constructor(
		private readonly context: GitServiceContext,
		private readonly git: Git,
		private readonly cache: Cache,
		private readonly provider: CliGitProviderInternal,
	) {}

	@debug()
	async checkout(
		repoPath: string,
		ref: string,
		options?: { createBranch?: string } | { path?: string },
	): Promise<void> {
		const scope = getScopedLogger();

		try {
			await this.checkoutCore(repoPath, ref, options);
			this.context.hooks?.cache?.onReset?.(repoPath, 'branches', 'status');
			this.context.hooks?.repository?.onChanged?.(repoPath, ['head', 'heads', 'index']);
		} catch (ex) {
			scope?.error(ex);
			throw ex;
		}
	}

	private async checkoutCore(
		repoPath: string,
		ref: string,
		{ createBranch, path }: { createBranch?: string; path?: string } = {},
	): Promise<void> {
		const params = ['checkout'];
		if (createBranch) {
			params.push('-b', createBranch, ref, '--');
		} else {
			params.push(ref, '--');

			if (path) {
				[path, repoPath] = splitPath(path, repoPath, true);
				params.push(path);
			}
		}

		try {
			await this.git.exec({ cwd: repoPath }, ...params);
		} catch (ex) {
			throw getGitCommandError(
				'checkout',
				ex,
				reason =>
					new CheckoutError(
						{ reason: reason ?? 'other', ref: ref, gitCommand: { repoPath: repoPath, args: params } },
						ex,
					),
			);
		}
	}

	@sequentialize({ getQueueKey: rp => rp })
	@debug()
	async cherryPick(
		repoPath: string,
		revs: string[],
		options?: { edit?: boolean; noCommit?: boolean; source?: unknown },
	): Promise<GitOperationResult> {
		const scope = getScopedLogger();

		const args = ['cherry-pick'];
		if (options?.edit) {
			args.push('-e');
		}
		if (options?.noCommit) {
			args.push('-n');
		}

		if (revs.length > 1) {
			// Sort commits in topological order (oldest ancestor first) so cherry-pick applies them correctly
			const revsSet = new Set(revs);
			const result = await this.git.exec({ cwd: repoPath }, 'rev-list', '--topo-order', '--reverse', ...revs);

			const ordered: string[] = [];
			for (const sha of result.stdout.trim().split('\n')) {
				if (sha && revsSet.has(sha)) {
					ordered.push(sha);
					if (ordered.length === revs.length) break; // Early exit once we have all
				}
			}

			if (ordered.length === revs.length) {
				revs = ordered;
			}
			// If we didn't get all commits (shouldn't happen), keep original order
		}

		args.push(...revs);

		try {
			await this.git.exec({ cwd: repoPath, errors: 'throw' }, ...args);
			this.context.hooks?.cache?.onReset?.(repoPath, 'branches', 'status');
			this.context.hooks?.repository?.onChanged?.(repoPath, ['head', 'heads', 'index']);
			return { conflicted: false };
		} catch (ex) {
			scope?.error(ex);
			await this.throwIfSigningError(repoPath, args, ex, options?.source);
			const mapped = getGitCommandError(
				'cherry-pick',
				ex,
				reason =>
					new CherryPickError(
						{ reason: reason ?? 'other', revs: revs, gitCommand: { repoPath: repoPath, args: args } },
						ex as Error,
					),
			);
			if (CherryPickError.is(mapped, 'conflicts')) {
				return this.createConflictResult(repoPath, 'cherry-pick');
			}
			throw mapped;
		}
	}

	@sequentialize({ getQueueKey: rp => rp })
	@debug()
	async commit(
		repoPath: string,
		message: string,
		options?: {
			all?: boolean;
			allowEmpty?: boolean;
			amend?: boolean;
			author?: string;
			date?: string;
			signoff?: boolean;
			source?: unknown;
		},
	): Promise<void> {
		const scope = getScopedLogger();

		const params = ['commit'];
		if (options?.all) {
			params.push('--all');
		}
		if (options?.allowEmpty) {
			params.push('--allow-empty');
		}
		if (options?.amend) {
			params.push('--amend');
		}
		if (options?.signoff) {
			params.push('--signoff');
		}
		if (options?.author) {
			params.push(`--author=${options.author}`);
		}
		if (options?.date) {
			params.push(`--date=${options.date}`);
		}
		// Read commit message from stdin via -F - to avoid shell escaping issues
		params.push('-F', '-');

		try {
			await this.git.exec({ cwd: repoPath, stdin: message, stdinEncoding: 'utf8', errors: 'throw' }, ...params);
			this.context.hooks?.cache?.onReset?.(repoPath, 'branches', 'status');
			this.context.hooks?.repository?.onChanged?.(repoPath, ['head', 'heads', 'index']);
		} catch (ex) {
			scope?.error(ex);
			await this.throwIfSigningError(repoPath, params, ex, options?.source);
			throw getGitCommandError(
				'commit',
				ex,
				reason =>
					new CommitError(
						{ reason: reason ?? 'other', gitCommand: { repoPath: repoPath, args: params } },
						ex,
					),
			);
		}
	}

	@sequentialize({ getQueueKey: rp => rp })
	@debug()
	async fetch(
		repoPath: string,
		options?: { all?: boolean; branch?: GitBranchReference; prune?: boolean; pull?: boolean; remote?: string },
	): Promise<void> {
		const scope = getScopedLogger();

		const { branch, ...opts } = options ?? {};
		try {
			if (isBranchReference(branch)) {
				const [branchName, remoteName] = getBranchNameAndRemote(branch);
				if (remoteName == null) return;

				await this.fetchCore(repoPath, {
					branch: branchName,
					remote: remoteName,
					upstream: getBranchTrackingWithoutRemote(branch)!,
					pull: options?.pull,
				});
			} else {
				await this.fetchCore(repoPath, opts);
			}

			this.context.hooks?.cache?.onReset?.(repoPath, 'branches', 'tags');
			this.context.hooks?.repository?.onChanged?.(repoPath, ['remotes']);
		} catch (ex) {
			scope?.error(ex);
			throw ex;
		}
	}

	private async fetchCore(
		repoPath: string,
		options:
			| { all?: boolean; branch?: undefined; prune?: boolean; pull?: boolean; remote?: string }
			| {
					all?: undefined;
					branch: string;
					prune?: undefined;
					pull?: boolean;
					remote: string;
					upstream: string;
			  },
	): Promise<void> {
		const params = ['fetch'];

		if (options.prune) {
			params.push('--prune');
		}

		if (options.branch && options.remote) {
			if (options.upstream && options.pull) {
				params.push('-u', options.remote, `${options.upstream}:${options.branch}`);
			} else {
				params.push(options.remote, options.upstream || options.branch);
			}
		} else if (options.remote) {
			params.push(options.remote);
		} else if (options.all) {
			params.push('--all');
		}

		try {
			await this.git.exec({ cwd: repoPath }, ...params);
		} catch (ex) {
			throw getGitCommandError(
				'fetch',
				ex,
				reason =>
					new FetchError(
						{
							reason: reason ?? 'other',
							branch: options?.branch,
							remote: options?.remote,
							gitCommand: { repoPath: repoPath, args: params },
						},
						ex,
					),
			);
		}
	}

	@sequentialize({ getQueueKey: rp => rp })
	@debug()
	async merge(
		repoPath: string,
		ref: string,
		options?: { fastForward?: boolean | 'only'; noCommit?: boolean; squash?: boolean; source?: unknown },
	): Promise<GitOperationResult> {
		const scope = getScopedLogger();

		const args = ['merge'];

		if (options?.fastForward === 'only') {
			args.push('--ff-only');
		} else if (options?.fastForward === true) {
			args.push('--ff');
		} else if (options?.fastForward === false) {
			args.push('--no-ff');
		}
		if (options?.squash) {
			args.push('--squash');
		}
		if (options?.noCommit) {
			args.push('--no-commit');
		}

		args.push(ref);

		try {
			await this.git.exec(
				// Avoid a timeout since merges can take a long time (set to 0 to disable)
				{ cwd: repoPath, errors: 'throw', timeout: 0 },
				...args,
			);

			this.context.hooks?.cache?.onReset?.(repoPath, 'branches', 'status');
			this.context.hooks?.repository?.onChanged?.(repoPath, ['head', 'heads', 'index']);
			return { conflicted: false };
		} catch (ex) {
			scope?.error(ex);
			await this.throwIfSigningError(repoPath, args, ex, options?.source);
			const mapped = getGitCommandError(
				'merge',
				ex,
				reason =>
					new MergeError(
						{ reason: reason ?? 'other', ref: ref, gitCommand: { repoPath: repoPath, args: args } },
						ex as Error,
					),
			);
			if (MergeError.is(mapped, 'conflicts')) {
				return this.createConflictResult(repoPath, 'merge');
			}
			throw mapped;
		}
	}

	@sequentialize({ getQueueKey: rp => rp })
	@debug()
	async pull(
		repoPath: string,
		options?: { branch?: GitBranchReference; rebase?: boolean; tags?: boolean; source?: unknown },
	): Promise<void> {
		const scope = getScopedLogger();

		try {
			if (isBranchReference(options?.branch)) {
				const branch = options.branch;
				// Find the worktree where this branch is checked out (if any)
				const worktree = await this.provider.worktrees?.getWorktree(
					repoPath,
					wt => wt.branch?.name === branch.name,
				);
				if (worktree != null) {
					// Branch is checked out in a worktree — run git pull in that worktree's directory
					await this.pullCore(normalizePath(worktree.uri.fsPath), {
						rebase: options?.rebase,
						tags: options?.tags,
						source: options?.source,
					});
					this.context.hooks?.cache?.onReset?.(repoPath, 'branches', 'status', 'tags');
					this.context.hooks?.repository?.onChanged?.(repoPath, ['head', 'heads', 'remotes', 'index']);
				} else {
					// Branch is not checked out anywhere — can only fetch (no working tree to merge into)
					await this.fetch(repoPath, { branch: branch });
				}
				return;
			}

			await this.pullCore(repoPath, {
				rebase: options?.rebase,
				tags: options?.tags,
				source: options?.source,
			});

			this.context.hooks?.cache?.onReset?.(repoPath, 'branches', 'status', 'tags');
			this.context.hooks?.repository?.onChanged?.(repoPath, ['head', 'heads', 'remotes', 'index']);
		} catch (ex) {
			scope?.error(ex);
			throw ex;
		}
	}

	private async pullCore(
		repoPath: string,
		options: { rebase?: boolean; tags?: boolean; source?: unknown },
	): Promise<void> {
		const params = ['pull'];

		if (options.tags) {
			params.push('--tags');
		}

		if (options.rebase) {
			params.push('-r');
		}

		try {
			await this.git.exec({ cwd: repoPath, configs: gitConfigsPull }, ...params);
		} catch (ex) {
			await this.throwIfSigningError(repoPath, params, ex, options.source);
			throw getGitCommandError(
				'pull',
				ex,
				reason =>
					new PullError({ reason: reason ?? 'other', gitCommand: { repoPath: repoPath, args: params } }, ex),
			);
		}
	}

	@sequentialize({ getQueueKey: rp => rp })
	@debug()
	async push(
		repoPath: string,
		options?: { reference?: GitReference; force?: boolean; publish?: { remote: string } },
	): Promise<void> {
		const scope = getScopedLogger();

		let branchName: string;
		let remoteName: string | undefined;
		let upstreamName: string | undefined;
		let setUpstream:
			| {
					branch: string;
					remote: string;
					remoteBranch: string;
			  }
			| undefined;

		if (isBranchReference(options?.reference)) {
			if (options.publish != null) {
				branchName = options.reference.name;
				remoteName = options.publish.remote;
			} else {
				[branchName, remoteName] = getBranchNameAndRemote(options.reference);
			}
			upstreamName = getBranchTrackingWithoutRemote(options.reference);
		} else {
			const branch = await this.provider.branches.getBranch(repoPath);
			if (branch == null) return;

			branchName =
				options?.reference != null
					? `${options.reference.ref}:${
							options?.publish != null ? 'refs/heads/' : ''
						}${branch.nameWithoutRemote}`
					: branch.name;
			remoteName = branch.remoteName ?? options?.publish?.remote;
			upstreamName = options?.reference == null && options?.publish != null ? branch.name : undefined;

			// Git can't setup upstream tracking when publishing a new branch to a specific commit, so we'll need to do it after the push
			if (options?.publish?.remote != null && options?.reference != null) {
				setUpstream = {
					branch: branch.nameWithoutRemote,
					remote: remoteName!,
					remoteBranch: branch.nameWithoutRemote,
				};
			}
		}

		if (options?.publish == null && remoteName == null && upstreamName == null) {
			throw new PushError({ reason: 'other' });
		}

		let forceOpts: PushForceOptions | undefined;
		if (options?.force) {
			forceOpts = {
				withLease: true,
				ifIncludes: true,
			};
		}

		try {
			await this.pushCore(repoPath, {
				branch: branchName,
				remote: remoteName,
				upstream: upstreamName,
				force: forceOpts,
				publish: options?.publish != null,
			});

			// Since Git can't setup upstream tracking when publishing a new branch to a specific commit, do it now
			if (setUpstream != null) {
				await this.git.exec(
					{ cwd: repoPath },
					'branch',
					'--set-upstream-to',
					`${setUpstream.remote}/${setUpstream.remoteBranch}`,
					setUpstream.branch,
				);
			}

			this.context.hooks?.cache?.onReset?.(repoPath, 'branches');
			this.context.hooks?.repository?.onChanged?.(repoPath, ['remotes']);
		} catch (ex) {
			scope?.error(ex);
			throw ex;
		}
	}

	private async pushCore(
		repoPath: string,
		options: {
			branch?: string;
			force?: PushForceOptions;
			publish?: boolean;
			remote?: string;
			upstream?: string;
			delete?: { remote: string; branch: string };
		},
	): Promise<void> {
		const params = ['push'];

		if (options.force != null) {
			if (options.force.withLease) {
				params.push('--force-with-lease');
				if (options.force.ifIncludes) {
					if (await this.git.supports('git:push:force-if-includes')) {
						params.push('--force-if-includes');
					}
				}
			} else {
				params.push('--force');
			}
		}

		if (options.branch && options.remote) {
			if (options.upstream) {
				params.push('-u', options.remote, `${options.branch}:${options.upstream}`);
			} else if (options.publish) {
				params.push('--set-upstream', options.remote, options.branch);
			} else {
				params.push(options.remote, options.branch);
			}
		} else if (options.remote) {
			params.push(options.remote);
		} else if (options.delete) {
			params.push(options.delete.remote, `:${options.delete.branch}`);
		}

		try {
			await this.git.exec({ cwd: repoPath }, ...params);
		} catch (ex) {
			const error = getGitCommandError(
				'push',
				ex,
				reason =>
					new PushError(
						{
							reason: reason,
							branch: options?.branch || options?.delete?.branch,
							remote: options?.remote || options?.delete?.remote,
							gitCommand: { repoPath: repoPath, args: params },
						},
						ex,
					),
			);

			if (options?.force?.withLease && error.details.reason === 'rejected') {
				if (ex.stderr && /! \[rejected\].*\(stale info\)/m.test(ex.stderr)) {
					throw new PushError(
						{
							reason: 'rejectedWithLease',
							branch: options?.branch || options?.delete?.branch,
							remote: options?.remote || options?.delete?.remote,
							gitCommand: { repoPath: repoPath, args: params },
						},
						ex,
					);
				}
				if (
					options.force.ifIncludes &&
					ex.stderr &&
					/! \[rejected\].*\(remote ref updated since checkout\)/m.test(ex.stderr)
				) {
					throw new PushError(
						{
							reason: 'rejectedWithLeaseIfIncludes',
							branch: options?.branch || options?.delete?.branch,
							remote: options?.remote || options?.delete?.remote,
							gitCommand: { repoPath: repoPath, args: params },
						},
						ex,
					);
				}
				if (ex.stderr && GitErrors.pushRejectedRefDoesNotExists.test(ex.stderr)) {
					throw new PushError(
						{
							reason: 'rejectedRefDoesNotExist',
							branch: options?.branch || options?.delete?.branch,
							remote: options?.remote || options?.delete?.remote,
							gitCommand: { repoPath: repoPath, args: params },
						},
						ex,
					);
				}
			}
			throw error;
		}
	}

	@sequentialize({ getQueueKey: rp => rp })
	@debug()
	async rebase(
		repoPath: string,
		upstream: string,
		options?: {
			autoStash?: boolean;
			branch?: string;
			editor?: string;
			interactive?: boolean;
			onto?: string;
			updateRefs?: boolean;
			source?: unknown;
		},
	): Promise<GitOperationResult> {
		const scope = getScopedLogger();

		const args = ['rebase'];
		let configs: string[] | undefined;

		if (options?.autoStash !== false) {
			args.push('--autostash');
		}

		if (options?.interactive) {
			args.push('--interactive');

			if (options.editor) {
				configs = ['-c', `sequence.editor=${options.editor}`];
			}
		}

		if (options?.updateRefs) {
			args.push('--update-refs');
		}

		if (options?.onto) {
			args.push('--onto', options.onto);
		}

		args.push(upstream);

		if (options?.branch) {
			args.push(options.branch);
		}

		try {
			await this.git.exec(
				// Avoid a timeout since rebases can take a long time (set to 0 to disable)
				{ cwd: repoPath, errors: 'throw', configs: configs, timeout: 0 },
				...args,
			);
			this.context.hooks?.cache?.onReset?.(repoPath, 'branches', 'status');
			this.context.hooks?.repository?.onChanged?.(repoPath, ['head', 'heads', 'index']);
			return { conflicted: false };
		} catch (ex) {
			scope?.error(ex);
			await this.throwIfSigningError(repoPath, args, ex, options?.source);
			const mapped = getGitCommandError(
				'rebase',
				ex,
				reason =>
					new RebaseError(
						{
							reason: reason ?? 'other',
							upstream: upstream,
							gitCommand: { repoPath: repoPath, args: args },
						},
						ex as Error,
					),
			);
			if (RebaseError.is(mapped, 'conflicts')) {
				return this.createConflictResult(repoPath, 'rebase');
			}
			throw mapped;
		}
	}

	@debug()
	async reset(
		repoPath: string,
		rev: string,
		options?: { mode?: 'hard' | 'keep' | 'merge' | 'mixed' | 'soft' },
	): Promise<void> {
		const scope = getScopedLogger();

		try {
			await this.resetCore(repoPath, rev, options?.mode);
			this.context.hooks?.cache?.onReset?.(repoPath, 'branches', 'status');
			this.context.hooks?.repository?.onChanged?.(repoPath, ['head', 'heads', 'index']);
		} catch (ex) {
			scope?.error(ex);
			throw ex;
		}
	}

	private async resetCore(
		repoPath: string,
		rev: string,
		mode?: 'hard' | 'keep' | 'merge' | 'mixed' | 'soft',
	): Promise<void> {
		const params = ['reset', '-q'];
		if (mode) {
			params.push(`--${mode}`);
		}
		params.push(rev, '--');

		try {
			await this.git.exec({ cwd: repoPath }, ...params);
		} catch (ex) {
			throw getGitCommandError(
				'reset',
				ex,
				reason =>
					new ResetError({ reason: reason ?? 'other', gitCommand: { repoPath: repoPath, args: params } }, ex),
			);
		}
	}

	@sequentialize({ getQueueKey: rp => rp })
	@debug()
	async revert(
		repoPath: string,
		refs: string[],
		options?: { editMessage?: boolean; source?: unknown },
	): Promise<GitOperationResult> {
		const scope = getScopedLogger();

		const args = ['revert'];

		if (options?.editMessage === true) {
			args.push('--edit');
		} else if (options?.editMessage === false) {
			args.push('--no-edit');
		}

		args.push(...refs);

		try {
			await this.git.exec(
				// Avoid a timeout since reverts can take a long time (set to 0 to disable)
				{ cwd: repoPath, errors: 'throw', timeout: 0 },
				...args,
			);

			this.context.hooks?.cache?.onReset?.(repoPath, 'branches', 'status');
			this.context.hooks?.repository?.onChanged?.(repoPath, ['head', 'heads', 'index']);
			return { conflicted: false };
		} catch (ex) {
			scope?.error(ex);
			await this.throwIfSigningError(repoPath, args, ex, options?.source);

			const mapped = getGitCommandError(
				'revert',
				ex,
				reason =>
					new RevertError(
						{ reason: reason ?? 'other', refs: refs, gitCommand: { repoPath: repoPath, args: args } },
						ex as Error,
					),
			);
			if (RevertError.is(mapped, 'conflicts')) {
				return this.createConflictResult(repoPath, 'revert');
			}
			throw mapped;
		}
	}

	/**
	 * Classifies `ex` as a signing failure; if so, fires the `commits.onSigningFailed`
	 * hook and throws a typed {@link SigningError}. Callers should invoke this first
	 * in their catch blocks, before falling through to command-specific error mapping
	 * via {@link getGitCommandError}.
	 *
	 * `SigningFormat` is read opportunistically from `config.getSigningConfig`, with
	 * {@link inferSigningFormatFromError} as a stderr-based fallback and `'gpg'` as
	 * the final default.
	 */
	private async throwIfSigningError(
		repoPath: string,
		args: readonly (string | undefined)[],
		ex: unknown,
		source?: unknown,
	): Promise<void> {
		const reason = classifySigningError(ex);
		if (reason == null) return;

		let format: SigningFormat | undefined;
		try {
			format = (await this.provider.config.getSigningConfig?.(repoPath))?.format;
		} catch {
			// Fall through — config read failed; use stderr-inferred format or gpg default
		}
		format ??= inferSigningFormatFromError(ex) ?? 'gpg';

		this.context.hooks?.commits?.onSigningFailed?.(reason, format, source);
		throw new SigningError(
			{ reason: reason, gitCommand: { repoPath: repoPath, args: args } },
			ex instanceof Error ? ex : undefined,
		);
	}

	private async createConflictResult(repoPath: string, command: GitConflictCommand): Promise<GitOperationResult> {
		let conflicts: GitConflictFile[] | undefined;
		try {
			conflicts = await this.provider.status.getConflictingFiles(repoPath);
		} catch (ex) {
			// Don't let a secondary status-read failure mask the original conflict signal
			Logger.warn(`Unable to read conflicting files after ${command}: ${ex}`);
		}
		// A conflicted op mutates the working tree, index, and paused-op state — invalidate caches
		// and fire repository-change the same way the success path does, so downstream views refresh.
		this.context.hooks?.cache?.onReset?.(repoPath, 'branches', 'status');
		this.context.hooks?.repository?.onChanged?.(repoPath, ['head', 'heads', 'index']);
		this.context.hooks?.operations?.onConflicted?.(command, conflicts);
		return { conflicted: true, conflicts: conflicts };
	}
}

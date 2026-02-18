import type { Container } from '../../../../container.js';
import type { GitCache } from '../../../../git/cache.js';
import { CherryPickError, MergeError, PushError, RebaseError, RevertError } from '../../../../git/errors.js';
import type { GitOperationsSubProvider } from '../../../../git/gitProvider.js';
import type { GitBranchReference, GitReference } from '../../../../git/models/reference.js';
import { getBranchNameAndRemote, getBranchTrackingWithoutRemote } from '../../../../git/utils/branch.utils.js';
import { isBranchReference } from '../../../../git/utils/reference.utils.js';
import { configuration } from '../../../../system/-webview/configuration.js';
import { getHostEditorCommand } from '../../../../system/-webview/vscode.js';
import { debug } from '../../../../system/decorators/log.js';
import { sequentialize } from '../../../../system/decorators/sequentialize.js';
import { getScopedLogger } from '../../../../system/logger.scope.js';
import type { Git, PushForceOptions } from '../git.js';
import { getGitCommandError } from '../git.js';
import type { LocalGitProviderInternal } from '../localGitProvider.js';

export class OperationsGitSubProvider implements GitOperationsSubProvider {
	constructor(
		private readonly container: Container,
		private readonly git: Git,
		private readonly cache: GitCache,
		private readonly provider: LocalGitProviderInternal,
	) {}

	@debug()
	async checkout(
		repoPath: string,
		ref: string,
		options?: { createBranch?: string } | { path?: string },
	): Promise<void> {
		const scope = getScopedLogger();

		try {
			await this.git.checkout(repoPath, ref, options);
			this.container.events.fire('git:cache:reset', { repoPath: repoPath, types: ['branches', 'status'] });
		} catch (ex) {
			scope?.error(ex);
			throw ex;
		}
	}

	@debug()
	async cherryPick(
		repoPath: string,
		revs: string[],
		options?: { edit?: boolean; noCommit?: boolean },
	): Promise<void> {
		const scope = getScopedLogger();

		const args = ['cherry-pick'];
		if (options?.edit) {
			args.push('-e');
		}
		if (options?.noCommit) {
			args.push('-n');
		}

		if (revs.length > 1) {
			// Get commits in topological order (oldest ancestor first) using git rev-list
			// This traverses history from the specified commits, so we filter to only include the commits we actually want to cherry-pick
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
		} catch (ex) {
			scope?.error(ex);
			throw getGitCommandError(
				'cherry-pick',
				ex,
				reason =>
					new CherryPickError(
						{ reason: reason ?? 'other', revs: revs, gitCommand: { repoPath: repoPath, args: args } },
						ex,
					),
			);
		}
	}

	@sequentialize<OperationsGitSubProvider['fetch']>({ getQueueKey: rp => rp })
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
				if (remoteName == null) return undefined;

				await this.git.fetch(repoPath, {
					branch: branchName,
					remote: remoteName,
					upstream: getBranchTrackingWithoutRemote(branch)!,
					pull: options?.pull,
				});
			} else {
				await this.git.fetch(repoPath, opts);
			}

			this.container.events.fire('git:cache:reset', { repoPath: repoPath });
		} catch (ex) {
			scope?.error(ex);
			throw ex;
		}
	}

	@debug()
	async merge(
		repoPath: string,
		ref: string,
		options?: { fastForward?: boolean | 'only'; noCommit?: boolean; squash?: boolean },
	): Promise<void> {
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

			this.container.events.fire('git:cache:reset', { repoPath: repoPath });
		} catch (ex) {
			scope?.error(ex);
			throw getGitCommandError(
				'merge',
				ex,
				reason =>
					new MergeError(
						{ reason: reason ?? 'other', ref: ref, gitCommand: { repoPath: repoPath, args: args } },
						ex,
					),
			);
		}
	}

	@sequentialize<OperationsGitSubProvider['pull']>({ getQueueKey: rp => rp })
	@debug()
	async pull(repoPath: string, options?: { rebase?: boolean; tags?: boolean }): Promise<void> {
		const scope = getScopedLogger();

		try {
			await this.git.pull(repoPath, {
				rebase: options?.rebase,
				tags: options?.tags,
			});

			this.container.events.fire('git:cache:reset', { repoPath: repoPath });
		} catch (ex) {
			scope?.error(ex);
			throw ex;
		}
	}

	@sequentialize<OperationsGitSubProvider['push']>({ getQueueKey: rp => rp })
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
						}${branch.getNameWithoutRemote()}`
					: branch.name;
			remoteName = branch.getRemoteName() ?? options?.publish?.remote;
			upstreamName = options?.reference == null && options?.publish != null ? branch.name : undefined;

			// Git can't setup upstream tracking when publishing a new branch to a specific commit, so we'll need to do it after the push
			if (options?.publish?.remote != null && options?.reference != null) {
				setUpstream = {
					branch: branch.getNameWithoutRemote(),
					remote: remoteName!,
					remoteBranch: branch.getNameWithoutRemote(),
				};
			}
		}

		if (options?.publish == null && remoteName == null && upstreamName == null) {
			debugger;
			throw new PushError({ reason: 'other' });
		}

		let forceOpts: PushForceOptions | undefined;
		if (options?.force) {
			const withLease = configuration.getCore('git.useForcePushWithLease') ?? true;
			if (withLease) {
				forceOpts = {
					withLease: withLease,
					ifIncludes: configuration.getCore('git.useForcePushIfIncludes') ?? true,
				};
			} else {
				forceOpts = {
					withLease: withLease,
				};
			}
		}

		try {
			await this.git.push(repoPath, {
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

			this.container.events.fire('git:cache:reset', { repoPath: repoPath });
		} catch (ex) {
			scope?.error(ex);
			throw ex;
		}
	}

	@debug()
	async rebase(
		repoPath: string,
		upstream: string,
		options?: { autoStash?: boolean; branch?: string; interactive?: boolean; onto?: string; updateRefs?: boolean },
	): Promise<void> {
		const scope = getScopedLogger();

		const args = ['rebase'];
		let configs;

		if (options?.autoStash !== false) {
			args.push('--autostash');
		}

		if (options?.interactive) {
			args.push('--interactive');

			const editor = await getHostEditorCommand(true);
			configs = ['-c', `sequence.editor=${editor}`];
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
		} catch (ex) {
			scope?.error(ex);
			throw getGitCommandError(
				'rebase',
				ex,
				reason =>
					new RebaseError(
						{
							reason: reason ?? 'other',
							upstream: upstream,
							gitCommand: { repoPath: repoPath, args: args },
						},
						ex,
					),
			);
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
			await this.git.reset(repoPath, [], { ...options, rev: rev });
		} catch (ex) {
			scope?.error(ex);
			throw ex;
		}
	}

	@debug()
	async revert(repoPath: string, refs: string[], options?: { editMessage?: boolean }): Promise<void> {
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

			this.container.events.fire('git:cache:reset', { repoPath: repoPath });
		} catch (ex) {
			scope?.error(ex);

			throw getGitCommandError(
				'revert',
				ex,
				reason =>
					new RevertError(
						{ reason: reason ?? 'other', refs: refs, gitCommand: { repoPath: repoPath, args: args } },
						ex,
					),
			);
		}
	}
}

import type { Container } from '../../../../container';
import type { GitCache } from '../../../../git/cache';
import { GitErrorHandling } from '../../../../git/commandOptions';
import {
	CherryPickError,
	CherryPickErrorReason,
	MergeError,
	MergeErrorReason,
	PushError,
	PushErrorReason,
	RebaseError,
	RebaseErrorReason,
	RevertError,
	RevertErrorReason,
} from '../../../../git/errors';
import type { GitOperationsSubProvider } from '../../../../git/gitProvider';
import type { GitBranchReference, GitReference } from '../../../../git/models/reference';
import { getShaAndDatesLogParser } from '../../../../git/parsers/logParser';
import { getBranchNameAndRemote, getBranchTrackingWithoutRemote } from '../../../../git/utils/branch.utils';
import { isBranchReference } from '../../../../git/utils/reference.utils';
import { configuration } from '../../../../system/-webview/configuration';
import { getHostEditorCommand } from '../../../../system/-webview/vscode';
import { log } from '../../../../system/decorators/log';
import { sequentialize } from '../../../../system/decorators/sequentialize';
import { join } from '../../../../system/iterable';
import { Logger } from '../../../../system/logger';
import { getLogScope } from '../../../../system/logger.scope';
import type { Git, PushForceOptions } from '../git';
import { GitErrors } from '../git';
import type { LocalGitProviderInternal } from '../localGitProvider';

export class OperationsGitSubProvider implements GitOperationsSubProvider {
	constructor(
		private readonly container: Container,
		private readonly git: Git,
		private readonly cache: GitCache,
		private readonly provider: LocalGitProviderInternal,
	) {}

	@log()
	async checkout(
		repoPath: string,
		ref: string,
		options?: { createBranch?: string } | { path?: string },
	): Promise<void> {
		const scope = getLogScope();

		try {
			await this.git.checkout(repoPath, ref, options);
			this.container.events.fire('git:cache:reset', { repoPath: repoPath, types: ['branches', 'status'] });
		} catch (ex) {
			Logger.error(ex, scope);
			throw ex;
		}
	}

	@log()
	async cherryPick(
		repoPath: string,
		revs: string[],
		options?: { edit?: boolean; noCommit?: boolean },
	): Promise<void> {
		const scope = getLogScope();

		const args = ['cherry-pick'];
		if (options?.edit) {
			args.push('-e');
		}
		if (options?.noCommit) {
			args.push('-n');
		}

		if (revs.length > 1) {
			const parser = getShaAndDatesLogParser();
			// Ensure the revs are in reverse committer date order
			const result = await this.git.exec(
				{ cwd: repoPath, stdin: join(revs, '\n') },
				'log',
				'--no-walk',
				'--stdin',
				...parser.arguments,
				'--',
			);
			const commits = [...parser.parse(result.stdout)].sort(
				(c1, c2) =>
					Number(c1.committerDate) - Number(c2.committerDate) ||
					Number(c1.authorDate) - Number(c2.authorDate),
			);
			revs = commits.map(c => c.sha);
		}

		args.push(...revs);

		try {
			await this.git.exec({ cwd: repoPath, errors: GitErrorHandling.Throw }, ...args);
		} catch (ex) {
			Logger.error(ex, scope);
			const msg: string = ex?.toString() ?? '';

			let reason: CherryPickErrorReason = CherryPickErrorReason.Other;
			if (
				GitErrors.changesWouldBeOverwritten.test(msg) ||
				GitErrors.changesWouldBeOverwritten.test(ex.stderr ?? '')
			) {
				reason = CherryPickErrorReason.AbortedWouldOverwrite;
			} else if (GitErrors.conflict.test(msg) || GitErrors.conflict.test(ex.stdout ?? '')) {
				reason = CherryPickErrorReason.Conflicts;
			} else if (GitErrors.emptyPreviousCherryPick.test(msg)) {
				reason = CherryPickErrorReason.EmptyCommit;
			}

			debugger;
			throw new CherryPickError(reason, ex, revs, { repoPath: repoPath, args: args });
		}
	}

	@sequentialize<OperationsGitSubProvider['fetch']>({ getQueueKey: rp => rp })
	@log()
	async fetch(
		repoPath: string,
		options?: { all?: boolean; branch?: GitBranchReference; prune?: boolean; pull?: boolean; remote?: string },
	): Promise<void> {
		const scope = getLogScope();

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
			Logger.error(ex, scope);
			throw ex;
		}
	}

	@log()
	async merge(
		repoPath: string,
		ref: string,
		options?: { fastForward?: boolean | 'only'; noCommit?: boolean; squash?: boolean },
	): Promise<void> {
		const scope = getLogScope();

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
				{ cwd: repoPath, errors: GitErrorHandling.Throw, timeout: 0 },
				...args,
			);

			this.container.events.fire('git:cache:reset', { repoPath: repoPath });
		} catch (ex) {
			Logger.error(ex, scope);
			const msg: string = ex?.toString() ?? '';

			let reason: MergeErrorReason = MergeErrorReason.Other;
			if (GitErrors.uncommittedChanges.test(msg) || GitErrors.uncommittedChanges.test(ex.stderr ?? '')) {
				reason = MergeErrorReason.WorkingChanges;
			} else if (
				GitErrors.changesWouldBeOverwritten.test(msg) ||
				GitErrors.changesWouldBeOverwritten.test(ex.stderr ?? '')
			) {
				reason = MergeErrorReason.OverwrittenChanges;
			} else if (GitErrors.mergeInProgress.test(msg) || GitErrors.mergeInProgress.test(ex.stdout ?? '')) {
				reason = MergeErrorReason.InProgress;
			} else if (GitErrors.unresolvedConflicts.test(msg) || GitErrors.unresolvedConflicts.test(ex.stdout ?? '')) {
				reason = MergeErrorReason.Conflicts;
			} else if (GitErrors.mergeAborted.test(msg) || GitErrors.mergeAborted.test(ex.stdout ?? '')) {
				reason = MergeErrorReason.Aborted;
			}

			throw new MergeError(reason, ex, ref, { repoPath: repoPath, args: args });
		}
	}

	@sequentialize<OperationsGitSubProvider['pull']>({ getQueueKey: rp => rp })
	@log()
	async pull(repoPath: string, options?: { rebase?: boolean; tags?: boolean }): Promise<void> {
		const scope = getLogScope();

		try {
			await this.git.pull(repoPath, {
				rebase: options?.rebase,
				tags: options?.tags,
			});

			this.container.events.fire('git:cache:reset', { repoPath: repoPath });
		} catch (ex) {
			Logger.error(ex, scope);
			throw ex;
		}
	}

	@sequentialize<OperationsGitSubProvider['push']>({ getQueueKey: rp => rp })
	@log()
	async push(
		repoPath: string,
		options?: { reference?: GitReference; force?: boolean; publish?: { remote: string } },
	): Promise<void> {
		const scope = getLogScope();

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
			throw new PushError(PushErrorReason.Other);
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
			Logger.error(ex, scope);
			throw ex;
		}
	}

	@log()
	async rebase(
		repoPath: string,
		rev: string,
		options?: { autoStash?: boolean; interactive?: boolean },
	): Promise<void> {
		const scope = getLogScope();

		const args = ['rebase'];
		let configs;

		if (options?.autoStash !== false) {
			args.push('--autostash');
		}

		if (options?.interactive) {
			args.push('--interactive');

			const editor = await getHostEditorCommand();
			configs = ['-c', `sequence.editor=${editor}`];
		}

		args.push(rev);

		try {
			await this.git.exec(
				// Avoid a timeout since rebases can take a long time (set to 0 to disable)
				{ cwd: repoPath, errors: GitErrorHandling.Throw, configs: configs, timeout: 0 },
				...args,
			);
		} catch (ex) {
			Logger.error(ex, scope);
			const msg: string = ex?.toString() ?? '';

			let reason: RebaseErrorReason = RebaseErrorReason.Other;
			if (GitErrors.uncommittedChanges.test(msg) || GitErrors.uncommittedChanges.test(ex.stderr ?? '')) {
				reason = RebaseErrorReason.WorkingChanges;
			} else if (
				GitErrors.changesWouldBeOverwritten.test(msg) ||
				GitErrors.changesWouldBeOverwritten.test(ex.stderr ?? '')
			) {
				reason = RebaseErrorReason.OverwrittenChanges;
			} else if (GitErrors.rebaseInProgress.test(msg) || GitErrors.rebaseInProgress.test(ex.stdout ?? '')) {
				reason = RebaseErrorReason.InProgress;
			} else if (GitErrors.unresolvedConflicts.test(msg) || GitErrors.unresolvedConflicts.test(ex.stdout ?? '')) {
				reason = RebaseErrorReason.Conflicts;
			} else if (GitErrors.rebaseAborted.test(msg) || GitErrors.rebaseAborted.test(ex.stdout ?? '')) {
				reason = RebaseErrorReason.Aborted;
			}

			debugger;
			throw new RebaseError(reason, ex, rev, { repoPath: repoPath, args: args });
		}
	}

	@log()
	async reset(
		repoPath: string,
		rev: string,
		options?: { mode?: 'hard' | 'keep' | 'merge' | 'mixed' | 'soft' },
	): Promise<void> {
		const scope = getLogScope();

		try {
			await this.git.reset(repoPath, [], { ...options, rev: rev });
		} catch (ex) {
			Logger.error(ex, scope);
			throw ex;
		}
	}

	@log()
	async revert(repoPath: string, refs: string[], options?: { editMessage?: boolean }): Promise<void> {
		const scope = getLogScope();

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
				{ cwd: repoPath, errors: GitErrorHandling.Throw, timeout: 0 },
				...args,
			);

			this.container.events.fire('git:cache:reset', { repoPath: repoPath });
		} catch (ex) {
			Logger.error(ex, scope);
			const msg: string = ex?.toString() ?? '';

			let reason: RevertErrorReason = RevertErrorReason.Other;
			if (GitErrors.uncommittedChanges.test(msg) || GitErrors.uncommittedChanges.test(ex.stderr ?? '')) {
				reason = RevertErrorReason.WorkingChanges;
			} else if (
				GitErrors.changesWouldBeOverwritten.test(msg) ||
				GitErrors.changesWouldBeOverwritten.test(ex.stderr ?? '')
			) {
				reason = RevertErrorReason.OverwrittenChanges;
			} else if (GitErrors.revertInProgress.test(msg) || GitErrors.revertInProgress.test(ex.stdout ?? '')) {
				reason = RevertErrorReason.InProgress;
			} else if (GitErrors.unresolvedConflicts.test(msg) || GitErrors.unresolvedConflicts.test(ex.stdout ?? '')) {
				reason = RevertErrorReason.Conflicts;
			} else if (GitErrors.revertAborted.test(msg) || GitErrors.revertAborted.test(ex.stdout ?? '')) {
				reason = RevertErrorReason.Aborted;
			}

			throw new RevertError(reason, ex, refs, { repoPath: repoPath, args: args });
		}
	}
}

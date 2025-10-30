import { window } from 'vscode';
import type { Container } from '../../../../container';
import type { GitCache } from '../../../../git/cache';
import { GitErrorHandling } from '../../../../git/commandOptions';
import {
	CherryPickError,
	CherryPickErrorReason,
	FetchError,
	PullError,
	PushError,
	PushErrorReason,
} from '../../../../git/errors';
import type { GitOperationsSubProvider } from '../../../../git/gitProvider';
import type { GitBranchReference, GitReference } from '../../../../git/models/reference';
import { getShaAndDatesLogParser } from '../../../../git/parsers/logParser';
import { getBranchNameAndRemote, getBranchTrackingWithoutRemote } from '../../../../git/utils/branch.utils';
import { isBranchReference } from '../../../../git/utils/reference.utils';
import { showGenericErrorMessage } from '../../../../messages';
import { configuration } from '../../../../system/-webview/configuration';
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
			const msg: string = ex?.toString() ?? '';
			if (/overwritten by checkout/i.test(msg)) {
				void showGenericErrorMessage(
					`Unable to checkout '${ref}'. Please commit or stash your changes before switching branches`,
				);
				return;
			}

			Logger.error(ex, scope);
			void showGenericErrorMessage(`Unable to checkout '${ref}'`);
		}
	}

	@log()
	async cherryPick(
		repoPath: string,
		revs: string[],
		options?: { edit?: boolean; noCommit?: boolean },
	): Promise<void> {
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
			throw new CherryPickError(reason, ex, revs);
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
			if (!FetchError.is(ex)) throw ex;

			void window.showErrorMessage(ex.message);
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
			if (!PullError.is(ex)) throw ex;

			void window.showErrorMessage(ex.message);
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
			if (!PushError.is(ex)) throw ex;

			void window.showErrorMessage(ex.message);
		}
	}

	@log()
	async reset(
		repoPath: string,
		rev: string,
		options?: { mode?: 'hard' | 'keep' | 'merge' | 'mixed' | 'soft' },
	): Promise<void> {
		await this.git.reset(repoPath, [], { ...options, rev: rev });
	}
}

import { readdir } from 'fs';
import type { CancellationToken } from 'vscode';
import type { Container } from '../../../../container';
import { CancellationError } from '../../../../errors';
import type { GitCache } from '../../../../git/cache';
import { GitErrorHandling } from '../../../../git/commandOptions';
import {
	PausedOperationAbortError,
	PausedOperationAbortErrorReason,
	PausedOperationContinueError,
	PausedOperationContinueErrorReason,
} from '../../../../git/errors';
import type { GitPausedOperationsSubProvider } from '../../../../git/gitProvider';
import type {
	GitCherryPickStatus,
	GitMergeStatus,
	GitPausedOperationStatus,
	GitRebaseStatus,
	GitRevertStatus,
} from '../../../../git/models/pausedOperationStatus';
import type { GitBranchReference, GitTagReference } from '../../../../git/models/reference';
import { createReference } from '../../../../git/utils/reference.utils';
import { gate } from '../../../../system/decorators/gate';
import { log } from '../../../../system/decorators/log';
import { Logger } from '../../../../system/logger';
import { getLogScope, setLogScopeExit } from '../../../../system/logger.scope';
import { getSettledValue } from '../../../../system/promise';
import type { Git } from '../git';
import { GitErrors } from '../git';
import type { LocalGitProviderInternal } from '../localGitProvider';

type Operation = 'cherry-pick' | 'merge' | 'rebase-apply' | 'rebase-merge' | 'revert';

const orderedOperations: Operation[] = ['rebase-apply', 'rebase-merge', 'merge', 'cherry-pick', 'revert'];

export class PausedOperationsGitSubProvider implements GitPausedOperationsSubProvider {
	constructor(
		private readonly container: Container,
		private readonly git: Git,
		private readonly cache: GitCache,
		private readonly provider: LocalGitProviderInternal,
	) {}

	@log()
	async getPausedOperationStatus(
		repoPath: string,
		cancellation?: CancellationToken,
	): Promise<GitPausedOperationStatus | undefined> {
		const scope = getLogScope();

		const status = this.cache.pausedOperationStatus?.getOrCreate(repoPath, async _cancellable => {
			const gitDir = await this.provider.config.getGitDir(repoPath);

			const operations = await new Promise<Set<Operation>>((resolve, _) => {
				readdir(gitDir.uri.fsPath, { withFileTypes: true }, (err, entries) => {
					const operations = new Set<Operation>();
					if (err != null) {
						resolve(operations);
						return;
					}

					if (entries.length === 0) {
						resolve(operations);
						return;
					}

					let entry;
					for (entry of entries) {
						if (entry.isFile()) {
							switch (entry.name) {
								case 'CHERRY_PICK_HEAD':
									operations.add('cherry-pick');
									break;
								case 'MERGE_HEAD':
									operations.add('merge');
									break;
								case 'REVERT_HEAD':
									operations.add('revert');
									break;
							}
						} else if (entry.isDirectory()) {
							switch (entry.name) {
								case 'rebase-apply':
									operations.add('rebase-apply');
									break;
								case 'rebase-merge':
									operations.add('rebase-merge');
									break;
							}
						}
					}

					resolve(operations);
				});
			});

			if (!operations.size) return undefined;
			if (cancellation?.isCancellationRequested) throw new CancellationError();

			const sortedOperations = [...operations].sort(
				(a, b) => orderedOperations.indexOf(a) - orderedOperations.indexOf(b),
			);
			Logger.log(`Detected paused operations: ${sortedOperations.join(', ')}`);

			const operation = sortedOperations[0];
			switch (operation) {
				case 'cherry-pick': {
					const result = await this.git.exec(
						{ cwd: repoPath, cancellation: cancellation, errors: GitErrorHandling.Ignore },
						'rev-parse',
						'--quiet',
						'--verify',
						'CHERRY_PICK_HEAD',
					);
					if (result.cancelled || cancellation?.isCancellationRequested) {
						throw new CancellationError();
					}

					const cherryPickHead = result.stdout.trim();
					if (!cherryPickHead) {
						setLogScopeExit(scope, 'No CHERRY_PICK_HEAD found');
						return undefined;
					}

					const current = (await this.provider.branches.getCurrentBranchReference(repoPath, cancellation))!;

					return {
						type: 'cherry-pick',
						repoPath: repoPath,
						// TODO: Validate that these are correct
						HEAD: createReference(cherryPickHead, repoPath, { refType: 'revision' }),
						current: current,
						incoming: createReference(cherryPickHead, repoPath, { refType: 'revision' }),
					} satisfies GitCherryPickStatus;
				}
				case 'merge': {
					const result = await this.git.exec(
						{ cwd: repoPath, cancellation: cancellation, errors: GitErrorHandling.Ignore },
						'rev-parse',
						'--quiet',
						'--verify',
						'MERGE_HEAD',
					);
					if (result.cancelled || cancellation?.isCancellationRequested) {
						throw new CancellationError();
					}

					const mergeHead = result.stdout.trim();
					if (!mergeHead) {
						setLogScopeExit(scope, 'No MERGE_HEAD found');
						return undefined;
					}

					const [branchResult, mergeBaseResult, possibleSourceBranchesResult] = await Promise.allSettled([
						this.provider.branches.getCurrentBranchReference(repoPath, cancellation),
						this.provider.refs.getMergeBase(repoPath, 'MERGE_HEAD', 'HEAD', undefined, cancellation),
						this.provider.branches.getBranchesWithCommits(
							repoPath,
							['MERGE_HEAD'],
							undefined,
							{ all: true, mode: 'pointsAt' },
							cancellation,
						),
					]);

					if (cancellation?.isCancellationRequested) throw new CancellationError();

					const current = getSettledValue(branchResult)!;
					const mergeBase = getSettledValue(mergeBaseResult);
					const possibleSourceBranches = getSettledValue(possibleSourceBranchesResult);

					return {
						type: 'merge',
						repoPath: repoPath,
						mergeBase: mergeBase,
						HEAD: createReference(mergeHead, repoPath, { refType: 'revision' }),
						current: current,
						incoming:
							possibleSourceBranches?.length === 1
								? createReference(possibleSourceBranches[0], repoPath, {
										refType: 'branch',
										name: possibleSourceBranches[0],
										remote: false,
									})
								: createReference(mergeHead, repoPath, { refType: 'revision' }),
					} satisfies GitMergeStatus;
				}
				case 'revert': {
					const result = await this.git.exec(
						{ cwd: repoPath, cancellation: cancellation, errors: GitErrorHandling.Ignore },
						'rev-parse',
						'--quiet',
						'--verify',
						'REVERT_HEAD',
					);
					if (result.cancelled || cancellation?.isCancellationRequested) {
						throw new CancellationError();
					}

					const revertHead = result.stdout.trim();
					if (!revertHead) {
						setLogScopeExit(scope, 'No REVERT_HEAD found');
						return undefined;
					}

					const current = (await this.provider.branches.getCurrentBranchReference(repoPath, cancellation))!;

					return {
						type: 'revert',
						repoPath: repoPath,
						HEAD: createReference(revertHead, repoPath, { refType: 'revision' }),
						current: current,
						incoming: createReference(revertHead, repoPath, { refType: 'revision' }),
					} satisfies GitRevertStatus;
				}
				case 'rebase-apply':
				case 'rebase-merge': {
					let branch = await this.git.readDotGitFile(gitDir, [operation, 'head-name']);
					if (!branch) {
						setLogScopeExit(scope, `No '${operation}/head-name' found`);
						return undefined;
					}

					const [
						rebaseHeadResult,
						origHeadResult,
						ontoResult,
						stepsNumberResult,
						stepsTotalResult,
						stepsMessageResult,
					] = await Promise.allSettled([
						this.git.exec(
							{ cwd: repoPath, cancellation: cancellation, errors: GitErrorHandling.Ignore },
							'rev-parse',
							'--quiet',
							'--verify',
							'REBASE_HEAD',
						),
						this.git.readDotGitFile(gitDir, [operation, 'orig-head']),
						this.git.readDotGitFile(gitDir, [operation, 'onto']),
						this.git.readDotGitFile(gitDir, [operation, 'msgnum'], { numeric: true }),
						this.git.readDotGitFile(gitDir, [operation, 'end'], { numeric: true }),
						this.git
							.readDotGitFile(gitDir, [operation, 'message'], { throw: true })
							.catch(() => this.git.readDotGitFile(gitDir, [operation, 'message-squashed'])),
					]);

					if (cancellation?.isCancellationRequested) throw new CancellationError();

					const origHead = getSettledValue(origHeadResult);
					const onto = getSettledValue(ontoResult);
					if (origHead == null || onto == null) {
						setLogScopeExit(scope, `Neither '${operation}/orig-head' nor '${operation}/onto' found`);
						return undefined;
					}

					const rebaseHead = getSettledValue(rebaseHeadResult)?.stdout.trim();

					if (branch.startsWith('refs/heads/')) {
						branch = branch.substring(11).trim();
					}

					const [mergeBaseResult, branchTipsResult, tagTipsResult] = await Promise.allSettled([
						rebaseHead != null
							? this.provider.refs.getMergeBase(repoPath, rebaseHead, 'HEAD', undefined, cancellation)
							: this.provider.refs.getMergeBase(repoPath, onto, origHead, undefined, cancellation),
						this.provider.branches.getBranchesWithCommits(
							repoPath,
							[onto],
							undefined,
							{
								all: true,
								mode: 'pointsAt',
							},
							cancellation,
						),
						this.provider.tags.getTagsWithCommit(repoPath, onto, { mode: 'pointsAt' }, cancellation),
					]);

					if (cancellation?.isCancellationRequested) throw new CancellationError();

					const mergeBase = getSettledValue(mergeBaseResult);
					const branchTips = getSettledValue(branchTipsResult);
					const tagTips = getSettledValue(tagTipsResult);

					let ontoRef: GitBranchReference | GitTagReference | undefined;
					if (branchTips != null) {
						for (const ref of branchTips) {
							if (ref.startsWith('(no branch, rebasing')) continue;

							ontoRef = createReference(ref, repoPath, {
								refType: 'branch',
								name: ref,
								remote: false,
							});
							break;
						}
					}
					if (ontoRef == null && tagTips != null) {
						for (const ref of tagTips) {
							if (ref.startsWith('(no branch, rebasing')) continue;

							ontoRef = createReference(ref, repoPath, {
								refType: 'tag',
								name: ref,
							});
							break;
						}
					}

					return {
						type: 'rebase',
						repoPath: repoPath,
						mergeBase: mergeBase,
						HEAD: createReference(rebaseHead ?? origHead, repoPath, { refType: 'revision' }),
						onto: createReference(onto, repoPath, { refType: 'revision' }),
						current: ontoRef,
						incoming: createReference(branch, repoPath, {
							refType: 'branch',
							name: branch,
							remote: false,
						}),
						steps: {
							current: {
								number: getSettledValue(stepsNumberResult) ?? 0,
								commit:
									rebaseHead != null
										? createReference(rebaseHead, repoPath, {
												refType: 'revision',
												message: getSettledValue(stepsMessageResult),
											})
										: undefined,
							},
							total: getSettledValue(stepsTotalResult) ?? 0,
						},
					} satisfies GitRebaseStatus;
				}
			}
		});

		return status;
	}

	@gate<PausedOperationsGitSubProvider['abortPausedOperation']>((rp, o) => `${rp ?? ''}:${o?.quit ?? false}`)
	@log()
	async abortPausedOperation(repoPath: string, options?: { quit?: boolean }): Promise<void> {
		const status = await this.getPausedOperationStatus(repoPath);
		if (status == null) return;

		try {
			switch (status.type) {
				case 'cherry-pick':
					await this.git.exec(
						{ cwd: repoPath, errors: GitErrorHandling.Throw },
						'cherry-pick',
						options?.quit ? '--quit' : '--abort',
					);
					break;

				case 'merge':
					await this.git.exec(
						{ cwd: repoPath, errors: GitErrorHandling.Throw },
						'merge',
						options?.quit ? '--quit' : '--abort',
					);
					break;

				case 'rebase':
					await this.git.exec(
						{ cwd: repoPath, errors: GitErrorHandling.Throw },
						'rebase',
						options?.quit ? '--quit' : '--abort',
					);
					break;

				case 'revert':
					await this.git.exec(
						{ cwd: repoPath, errors: GitErrorHandling.Throw },
						'revert',
						options?.quit ? '--quit' : '--abort',
					);
					break;
			}
		} catch (ex) {
			debugger;
			Logger.error(ex);
			const msg: string = ex?.toString() ?? '';
			if (GitErrors.noPausedOperation.test(msg)) {
				throw new PausedOperationAbortError(
					PausedOperationAbortErrorReason.NothingToAbort,
					status.type,
					`Cannot abort as there is no ${status.type} operation in progress`,
					ex,
				);
			}

			throw new PausedOperationAbortError(undefined, status.type, `Cannot abort ${status.type}; ${msg}`, ex);
		}
	}

	@gate<PausedOperationsGitSubProvider['continuePausedOperation']>((rp, o) => `${rp ?? ''}:${o?.skip ?? false}`)
	@log()
	async continuePausedOperation(repoPath: string, options?: { skip?: boolean }): Promise<void> {
		const status = await this.getPausedOperationStatus(repoPath);
		if (status == null) return;

		try {
			switch (status.type) {
				case 'cherry-pick':
					await this.git.exec(
						{ cwd: repoPath, errors: GitErrorHandling.Throw },
						'cherry-pick',
						options?.skip ? '--skip' : '--continue',
					);
					break;

				case 'merge':
					if (options?.skip) throw new Error('Skipping a merge is not supported');
					await this.git.exec({ cwd: repoPath, errors: GitErrorHandling.Throw }, 'merge', '--continue');
					break;

				case 'rebase':
					await this.git.exec(
						{ cwd: repoPath, errors: GitErrorHandling.Throw },
						'rebase',
						options?.skip ? '--skip' : '--continue',
					);
					break;

				case 'revert':
					await this.git.exec(
						{ cwd: repoPath, errors: GitErrorHandling.Throw },
						'revert',
						options?.skip ? '--skip' : '--abort',
					);
					break;
			}
		} catch (ex) {
			debugger;
			Logger.error(ex);

			const msg: string = ex?.toString() ?? '';
			if (GitErrors.emptyPreviousCherryPick.test(msg)) {
				throw new PausedOperationContinueError(
					PausedOperationContinueErrorReason.EmptyCommit,
					status,
					`Cannot continue ${status.type} as the previous cherry-pick is empty`,
					ex,
				);
			}

			if (GitErrors.noPausedOperation.test(msg)) {
				throw new PausedOperationContinueError(
					PausedOperationContinueErrorReason.NothingToContinue,
					status,
					`Cannot ${options?.skip ? 'skip' : 'continue'} as there is no ${status.type} operation in progress`,
					ex,
				);
			}

			if (GitErrors.uncommittedChanges.test(msg)) {
				throw new PausedOperationContinueError(
					PausedOperationContinueErrorReason.UncommittedChanges,
					status,
					`Cannot ${options?.skip ? 'skip' : `continue ${status.type}`} as there are uncommitted changes`,
					ex,
				);
			}

			if (GitErrors.unmergedFiles.test(msg)) {
				throw new PausedOperationContinueError(
					PausedOperationContinueErrorReason.UnmergedFiles,
					status,
					`Cannot ${options?.skip ? 'skip' : `continue ${status.type}`} as there are unmerged files`,
					ex,
				);
			}

			if (GitErrors.unresolvedConflicts.test(msg)) {
				throw new PausedOperationContinueError(
					PausedOperationContinueErrorReason.UnresolvedConflicts,
					status,
					`Cannot ${options?.skip ? 'skip' : `continue ${status.type}`} as there are unresolved conflicts`,
					ex,
				);
			}

			if (GitErrors.unstagedChanges.test(msg)) {
				throw new PausedOperationContinueError(
					PausedOperationContinueErrorReason.UnstagedChanges,
					status,
					`Cannot ${options?.skip ? 'skip' : `continue ${status.type}`} as there are unstaged changes`,
					ex,
				);
			}

			if (GitErrors.changesWouldBeOverwritten.test(msg)) {
				throw new PausedOperationContinueError(
					PausedOperationContinueErrorReason.WouldOverwrite,
					status,
					`Cannot ${
						options?.skip ? 'skip' : `continue ${status.type}`
					} as local changes would be overwritten`,
					ex,
				);
			}

			throw new PausedOperationContinueError(
				undefined,
				status,
				`Cannot ${options?.skip ? 'skip' : `continue ${status.type}`}; ${msg}`,
				ex,
			);
		}
	}
}

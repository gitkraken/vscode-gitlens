import { readdir } from 'fs';
import { GitErrorHandling } from '../../../../git/commandOptions';
import {
	PausedOperationAbortError,
	PausedOperationAbortErrorReason,
	PausedOperationContinueError,
	PausedOperationContinueErrorReason,
} from '../../../../git/errors';
import type {
	GitCherryPickStatus,
	GitMergeStatus,
	GitPausedOperationStatus,
	GitRebaseStatus,
	GitRevertStatus,
} from '../../../../git/models/pausedOperationStatus';
import type { GitBranchReference, GitTagReference } from '../../../../git/models/reference';
import { createReference, getReferenceFromBranch } from '../../../../git/models/reference.utils';
import { Logger } from '../../../../system/logger';
import { getSettledValue } from '../../../../system/promise';
import { GitErrors } from '../git';
import type { LocalGitProvider } from '../localGitProvider';

export async function getPausedOperationStatus(
	this: LocalGitProvider,
	repoPath: string,
	cache: Map<string, Promise<GitPausedOperationStatus | undefined>> | undefined,
): Promise<GitPausedOperationStatus | undefined> {
	let status = cache?.get(repoPath);
	if (status == null) {
		async function getCore(this: LocalGitProvider): Promise<GitPausedOperationStatus | undefined> {
			const gitDir = await this.getGitDir(repoPath);

			type Operation = 'cherry-pick' | 'merge' | 'rebase-apply' | 'rebase-merge' | 'revert';
			const operation = await new Promise<Operation | undefined>((resolve, _) => {
				readdir(gitDir.uri.fsPath, { withFileTypes: true }, (err, entries) => {
					if (err != null) {
						resolve(undefined);
						return;
					}

					if (entries.length === 0) {
						resolve(undefined);
						return;
					}

					let entry;
					for (entry of entries) {
						if (entry.isFile()) {
							switch (entry.name) {
								case 'CHERRY_PICK_HEAD':
									resolve('cherry-pick');
									return;
								case 'MERGE_HEAD':
									resolve('merge');
									return;
								case 'REVERT_HEAD':
									resolve('revert');
									return;
							}
						} else if (entry.isDirectory()) {
							switch (entry.name) {
								case 'rebase-apply':
									resolve('rebase-apply');
									return;
								case 'rebase-merge':
									resolve('rebase-merge');
									return;
							}
						}
					}

					resolve(undefined);
				});
			});

			if (operation == null) return undefined;

			switch (operation) {
				case 'cherry-pick': {
					const cherryPickHead = (
						await this.git.exec<string>(
							{ cwd: repoPath, errors: GitErrorHandling.Ignore },
							'rev-parse',
							'--quiet',
							'--verify',
							'CHERRY_PICK_HEAD',
						)
					)?.trim();
					if (!cherryPickHead) return undefined;

					const branch = (await this.getBranch(repoPath))!;

					return {
						type: 'cherry-pick',
						repoPath: repoPath,
						// TODO: Validate that these are correct
						HEAD: createReference(cherryPickHead, repoPath, { refType: 'revision' }),
						current: getReferenceFromBranch(branch),
						incoming: createReference(cherryPickHead, repoPath, { refType: 'revision' }),
					} satisfies GitCherryPickStatus;
				}
				case 'merge': {
					const mergeHead = (
						await this.git.exec<string>(
							{ cwd: repoPath, errors: GitErrorHandling.Ignore },
							'rev-parse',
							'--quiet',
							'--verify',
							'MERGE_HEAD',
						)
					)?.trim();
					if (!mergeHead) return undefined;

					const [branchResult, mergeBaseResult, possibleSourceBranchesResult] = await Promise.allSettled([
						this.getBranch(repoPath),
						this.getMergeBase(repoPath, 'MERGE_HEAD', 'HEAD'),
						this.getCommitBranches(repoPath, ['MERGE_HEAD'], undefined, {
							all: true,
							mode: 'pointsAt',
						}),
					]);

					const branch = getSettledValue(branchResult)!;
					const mergeBase = getSettledValue(mergeBaseResult);
					const possibleSourceBranches = getSettledValue(possibleSourceBranchesResult);

					return {
						type: 'merge',
						repoPath: repoPath,
						mergeBase: mergeBase,
						HEAD: createReference(mergeHead, repoPath, { refType: 'revision' }),
						current: getReferenceFromBranch(branch),
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
					const revertHead = (
						await this.git.exec<string>(
							{ cwd: repoPath, errors: GitErrorHandling.Ignore },
							'rev-parse',
							'--quiet',
							'--verify',
							'REVERT_HEAD',
						)
					)?.trim();
					if (!revertHead) return undefined;

					const branch = (await this.getBranch(repoPath))!;

					return {
						type: 'revert',
						repoPath: repoPath,
						HEAD: createReference(revertHead, repoPath, { refType: 'revision' }),
						current: getReferenceFromBranch(branch),
						incoming: createReference(revertHead, repoPath, { refType: 'revision' }),
					} satisfies GitRevertStatus;
				}
				case 'rebase-apply':
				case 'rebase-merge': {
					let branch = await this.git.readDotGitFile(gitDir, [operation, 'head-name']);
					if (!branch) return undefined;

					const [
						rebaseHeadResult,
						origHeadResult,
						ontoResult,
						stepsNumberResult,
						stepsTotalResult,
						stepsMessageResult,
					] = await Promise.allSettled([
						await this.git.exec<string>(
							{ cwd: repoPath, errors: GitErrorHandling.Ignore },
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

					const origHead = getSettledValue(origHeadResult);
					const onto = getSettledValue(ontoResult);
					if (origHead == null || onto == null) return undefined;

					let mergeBase;
					const rebaseHead = getSettledValue(rebaseHeadResult);
					if (rebaseHead != null) {
						mergeBase = await this.getMergeBase(repoPath, rebaseHead, 'HEAD');
					} else {
						mergeBase = await this.getMergeBase(repoPath, onto, origHead);
					}

					if (branch.startsWith('refs/heads/')) {
						branch = branch.substring(11).trim();
					}

					const [branchTipsResult, tagTipsResult] = await Promise.allSettled([
						this.getCommitBranches(repoPath, [onto], undefined, { all: true, mode: 'pointsAt' }),
						this.getCommitTags(repoPath, onto, { mode: 'pointsAt' }),
					]);

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
		}

		status = getCore.call(this);
		if (cache != null) {
			cache.set(repoPath, status);
		}
	}

	return status;
}

export async function abortPausedOperation(
	this: LocalGitProvider,
	repoPath: string,
	options?: { quit?: boolean },
): Promise<void> {
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

export async function continuePausedOperation(
	this: LocalGitProvider,
	repoPath: string,
	options?: { skip?: boolean },
): Promise<void> {
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
		if (GitErrors.noPausedOperation.test(msg)) {
			throw new PausedOperationContinueError(
				PausedOperationContinueErrorReason.NothingToContinue,
				status.type,
				`Cannot ${options?.skip ? 'skip' : 'continue'} as there is no ${status.type} operation in progress`,
				ex,
			);
		}

		if (GitErrors.uncommittedChanges.test(msg)) {
			throw new PausedOperationContinueError(
				PausedOperationContinueErrorReason.UncommittedChanges,
				status.type,
				`Cannot ${options?.skip ? 'skip' : `continue ${status.type}`} as there are uncommitted changes`,
				ex,
			);
		}

		if (GitErrors.unmergedFiles.test(msg)) {
			throw new PausedOperationContinueError(
				PausedOperationContinueErrorReason.UnmergedFiles,
				status.type,
				`Cannot ${options?.skip ? 'skip' : `continue ${status.type}`} as there are unmerged files`,
				ex,
			);
		}

		if (GitErrors.unresolvedConflicts.test(msg)) {
			throw new PausedOperationContinueError(
				PausedOperationContinueErrorReason.UnresolvedConflicts,
				status.type,
				`Cannot ${options?.skip ? 'skip' : `continue ${status.type}`} as there are unresolved conflicts`,
				ex,
			);
		}

		if (GitErrors.unstagedChanges.test(msg)) {
			throw new PausedOperationContinueError(
				PausedOperationContinueErrorReason.UnstagedChanges,
				status.type,
				`Cannot ${options?.skip ? 'skip' : `continue ${status.type}`} as there are unstaged changes`,
				ex,
			);
		}

		if (GitErrors.changesWouldBeOverwritten.test(msg)) {
			throw new PausedOperationContinueError(
				PausedOperationContinueErrorReason.WouldOverwrite,
				status.type,
				`Cannot ${options?.skip ? 'skip' : `continue ${status.type}`} as local changes would be overwritten`,
				ex,
			);
		}

		throw new PausedOperationContinueError(
			undefined,
			status.type,
			`Cannot ${options?.skip ? 'skip' : `continue ${status.type}`}; ${msg}`,
			ex,
		);
	}
}

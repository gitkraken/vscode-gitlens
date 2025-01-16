import { readdir } from 'fs';
import type { Uri } from 'vscode';
import type { Container } from '../../../../container';
import type { GitCache } from '../../../../git/cache';
import { GitErrorHandling } from '../../../../git/commandOptions';
import {
	PausedOperationAbortError,
	PausedOperationAbortErrorReason,
	PausedOperationContinueError,
	PausedOperationContinueErrorReason,
} from '../../../../git/errors';
import type { GitStatusSubProvider } from '../../../../git/gitProvider';
import type {
	GitCherryPickStatus,
	GitMergeStatus,
	GitPausedOperationStatus,
	GitRebaseStatus,
	GitRevertStatus,
} from '../../../../git/models/pausedOperationStatus';
import type { GitBranchReference, GitTagReference } from '../../../../git/models/reference';
import { createReference, getReferenceFromBranch } from '../../../../git/models/reference.utils';
import type { GitStatusFile } from '../../../../git/models/status';
import { GitStatus } from '../../../../git/models/status';
import { parseGitStatus } from '../../../../git/parsers/statusParser';
import { gate } from '../../../../system/decorators/gate';
import { log } from '../../../../system/decorators/log';
import { Logger } from '../../../../system/logger';
import { getSettledValue } from '../../../../system/promise';
import { configuration } from '../../../../system/vscode/configuration';
import { splitPath } from '../../../../system/vscode/path';
import type { Git } from '../git';
import { GitErrors } from '../git';
import type { LocalGitProvider } from '../localGitProvider';

export class StatusGitSubProvider implements GitStatusSubProvider {
	constructor(
		private readonly container: Container,
		private readonly git: Git,
		private readonly cache: GitCache,
		private readonly provider: LocalGitProvider,
	) {}

	@gate()
	@log()
	async getPausedOperationStatus(repoPath: string): Promise<GitPausedOperationStatus | undefined> {
		let status = this.cache.pausedOperationStatus?.get(repoPath);
		if (status == null) {
			async function getCore(this: StatusGitSubProvider): Promise<GitPausedOperationStatus | undefined> {
				const gitDir = await this.provider.getGitDir(repoPath);

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

						const branch = (await this.provider.branches.getBranch(repoPath))!;

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
							this.provider.branches.getBranch(repoPath),
							this.provider.branches.getMergeBase(repoPath, 'MERGE_HEAD', 'HEAD'),
							this.provider.branches.getBranchesForCommit(repoPath, ['MERGE_HEAD'], undefined, {
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

						const branch = (await this.provider.branches.getBranch(repoPath))!;

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
							this.git.exec<string>(
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

						const rebaseHead = getSettledValue(rebaseHeadResult)?.trim();

						if (branch.startsWith('refs/heads/')) {
							branch = branch.substring(11).trim();
						}

						const [mergeBaseResult, branchTipsResult, tagTipsResult] = await Promise.allSettled([
							rebaseHead != null
								? this.provider.branches.getMergeBase(repoPath, rebaseHead, 'HEAD')
								: this.provider.branches.getMergeBase(repoPath, onto, origHead),
							this.provider.branches.getBranchesForCommit(repoPath, [onto], undefined, {
								all: true,
								mode: 'pointsAt',
							}),
							this.provider.getCommitTags(repoPath, onto, { mode: 'pointsAt' }),
						]);

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
			}

			status = getCore.call(this);
			this.cache.pausedOperationStatus?.set(repoPath, status);
		}

		return status;
	}

	@gate()
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

	@gate()
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
					`Cannot ${
						options?.skip ? 'skip' : `continue ${status.type}`
					} as local changes would be overwritten`,
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

	@gate()
	@log()
	async getStatus(repoPath: string | undefined): Promise<GitStatus | undefined> {
		if (repoPath == null) return undefined;

		const porcelainVersion = (await this.git.isAtLeastVersion('2.11')) ? 2 : 1;

		const data = await this.git.status(repoPath, porcelainVersion, {
			similarityThreshold: configuration.get('advanced.similarityThreshold') ?? undefined,
		});
		const status = parseGitStatus(data, repoPath, porcelainVersion);

		if (status?.detached) {
			const pausedOpStatus = await this.getPausedOperationStatus(repoPath);
			if (pausedOpStatus?.type === 'rebase') {
				return new GitStatus(
					repoPath,
					pausedOpStatus.incoming.name,
					status.sha,
					status.files,
					status.state,
					status.upstream,
					true,
				);
			}
		}
		return status;
	}

	@gate()
	@log()
	async getStatusForFile(repoPath: string, pathOrUri: string | Uri): Promise<GitStatusFile | undefined> {
		const status = await this.getStatus(repoPath);
		if (!status?.files.length) return undefined;

		const [relativePath] = splitPath(pathOrUri, repoPath);
		const file = status.files.find(f => f.path === relativePath);
		return file;
	}

	@gate()
	@log()
	async getStatusForFiles(repoPath: string, pathOrGlob: Uri): Promise<GitStatusFile[] | undefined> {
		let [relativePath] = splitPath(pathOrGlob, repoPath);
		if (!relativePath.endsWith('/*')) {
			return this.getStatusForFile(repoPath, pathOrGlob).then(f => (f != null ? [f] : undefined));
		}

		relativePath = relativePath.substring(0, relativePath.length - 1);
		const status = await this.getStatus(repoPath);
		if (!status?.files.length) return undefined;

		const files = status.files.filter(f => f.path.startsWith(relativePath));
		return files;
	}
}

import { readdir } from 'fs';
import type { CancellationToken } from 'vscode';
import { Uri } from 'vscode';
import type { Container } from '../../../../container.js';
import { CancellationError } from '../../../../errors.js';
import type { GitCache } from '../../../../git/cache.js';
import { PausedOperationAbortError, PausedOperationContinueError } from '../../../../git/errors.js';
import type { GitPausedOperationsSubProvider } from '../../../../git/gitProvider.js';
import type {
	GitCherryPickStatus,
	GitMergeStatus,
	GitPausedOperationStatus,
	GitRebaseStatus,
	GitRevertStatus,
} from '../../../../git/models/pausedOperationStatus.js';
import type { GitBranchReference, GitTagReference } from '../../../../git/models/reference.js';
import { createReference } from '../../../../git/utils/reference.utils.js';
import { exists } from '../../../../system/-webview/vscode/uris.js';
import { gate } from '../../../../system/decorators/gate.js';
import { debug } from '../../../../system/decorators/log.js';
import { getScopedLogger } from '../../../../system/logger.scope.js';
import { getSettledValue } from '../../../../system/promise.js';
import type { Git } from '../git.js';
import { getGitCommandError } from '../git.js';
import type { LocalGitProviderInternal } from '../localGitProvider.js';

const todoCommitRegex = /^(?:p(?:ick)?|revert)\s+([a-f0-9]+)/i;

type Operation = 'cherry-pick' | 'merge' | 'rebase-apply' | 'rebase-merge' | 'revert' | 'sequencer';

// Note: 'sequencer' is checked after specific HEAD files since those take precedence
// The sequencer directory is used for multi-commit cherry-picks/reverts
const orderedOperations: Operation[] = ['rebase-apply', 'rebase-merge', 'merge', 'cherry-pick', 'revert', 'sequencer'];

export class PausedOperationsGitSubProvider implements GitPausedOperationsSubProvider {
	constructor(
		private readonly container: Container,
		private readonly git: Git,
		private readonly cache: GitCache,
		private readonly provider: LocalGitProviderInternal,
	) {}

	@debug()
	async getPausedOperationStatus(
		repoPath: string,
		cancellation?: CancellationToken,
	): Promise<GitPausedOperationStatus | undefined> {
		const scope = getScopedLogger();

		const status = this.cache.pausedOperationStatus.getOrCreate(repoPath, async _cancellable => {
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
								case 'sequencer':
									// The sequencer directory is used for multi-commit cherry-picks/reverts
									// We'll determine the type by reading the todo file later
									operations.add('sequencer');
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
			scope?.info(`Detected paused operations: ${sortedOperations.join(', ')}`);

			const operation = sortedOperations[0];
			switch (operation) {
				case 'cherry-pick': {
					const result = await this.git.exec(
						{ cwd: repoPath, cancellation: cancellation, errors: 'ignore' },
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
						scope?.addExitInfo('No CHERRY_PICK_HEAD found');
						return undefined;
					}

					const current = (await this.provider.branches.getCurrentBranchReference(repoPath, cancellation))!;

					return {
						type: 'cherry-pick',
						repoPath: repoPath,
						HEAD: createReference(cherryPickHead, repoPath, { refType: 'revision' }),
						current: current,
						incoming: createReference(cherryPickHead, repoPath, { refType: 'revision' }),
					} satisfies GitCherryPickStatus;
				}
				case 'merge': {
					const result = await this.git.exec(
						{ cwd: repoPath, cancellation: cancellation, errors: 'ignore' },
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
						scope?.addExitInfo('No MERGE_HEAD found');
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
						{ cwd: repoPath, cancellation: cancellation, errors: 'ignore' },
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
						scope?.addExitInfo('No REVERT_HEAD found');
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
						scope?.addExitInfo(`No '${operation}/head-name' found`);
						return undefined;
					}

					const [
						rebaseHeadResult,
						origHeadResult,
						ontoResult,
						stepsNumberResult,
						stepsTotalResult,
						stepsMessageResult,
						isInteractiveResult,
					] = await Promise.allSettled([
						this.git.exec(
							{ cwd: repoPath, cancellation: cancellation, errors: 'ignore' },
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
						exists(Uri.joinPath(gitDir.uri, operation, 'interactive')),
					]);

					if (cancellation?.isCancellationRequested) throw new CancellationError();

					const origHead = getSettledValue(origHeadResult);
					const onto = getSettledValue(ontoResult);
					if (origHead == null || onto == null) {
						scope?.addExitInfo(`Neither '${operation}/orig-head' nor '${operation}/onto' found`);
						return undefined;
					}

					const rebaseHead = getSettledValue(rebaseHeadResult)?.stdout.trim();

					if (branch.startsWith('refs/heads/')) {
						branch = branch.substring(11).trim();
					}

					const [mergeBaseResult, branchTipsResult, tagTipsResult] = await Promise.allSettled([
						rebaseHead
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

					const stepsNumber = getSettledValue(stepsNumberResult) ?? 0;

					return {
						type: 'rebase',
						repoPath: repoPath,
						mergeBase: mergeBase,
						HEAD: createReference(rebaseHead ?? origHead, repoPath, { refType: 'revision' }),
						onto: createReference(onto, repoPath, { refType: 'revision' }),
						source: createReference(origHead, repoPath, { refType: 'revision' }),
						current: ontoRef,
						incoming: createReference(branch, repoPath, {
							refType: 'branch',
							name: branch,
							remote: false,
						}),
						steps: {
							current: {
								number: stepsNumber,
								commit: rebaseHead
									? createReference(rebaseHead, repoPath, {
											refType: 'revision',
											message: getSettledValue(stepsMessageResult),
										})
									: undefined,
							},
							total: getSettledValue(stepsTotalResult) ?? 0,
						},
						hasStarted: stepsNumber > 0,
						// REBASE_HEAD only exists when git is paused and waiting for user action
						isPaused: stepsNumber > 0 && rebaseHead != null,
						// 'interactive' file exists for `git rebase -i`, absent for `git pull --rebase`
						isInteractive: getSettledValue(isInteractiveResult) ?? false,
					} satisfies GitRebaseStatus;
				}
				case 'sequencer': {
					// Used for multi-commit cherry-picks/reverts when CHERRY_PICK_HEAD/REVERT_HEAD don't exist
					const todoContent = await this.git.readDotGitFile(gitDir, ['sequencer', 'todo']);
					if (!todoContent) {
						scope?.addExitInfo('No sequencer/todo file found');
						return undefined;
					}

					// Get the first line and determine if it's a cherry-pick or revert
					const firstLine = todoContent.split('\n')[0]?.trim();
					if (!firstLine) {
						scope?.addExitInfo('Empty sequencer/todo file');
						return undefined;
					}

					// Check if it's a pick (cherry-pick) or revert command
					// Format: "pick <sha> <message>" or "p <sha> <message>" or "revert <sha> <message>"
					const isCherryPick = /^p(?:ick)?\s/.test(firstLine);
					const isRevert = /^revert\s/.test(firstLine);

					if (!isCherryPick && !isRevert) {
						scope?.addExitInfo(`Unknown sequencer command: ${firstLine}`);
						return undefined;
					}

					// Parse the commit sha being applied from the todo file
					const match = firstLine.match(todoCommitRegex);
					const currentCommitSha = match?.[1];
					if (!currentCommitSha) {
						scope?.addExitInfo('Could not parse commit sha from sequencer/todo');
						return undefined;
					}

					const current = (await this.provider.branches.getCurrentBranchReference(repoPath, cancellation))!;

					if (isCherryPick) {
						return {
							type: 'cherry-pick',
							repoPath: repoPath,
							HEAD: createReference(currentCommitSha, repoPath, { refType: 'revision' }),
							current: current,
							incoming: createReference(currentCommitSha, repoPath, { refType: 'revision' }),
						} satisfies GitCherryPickStatus;
					}

					return {
						type: 'revert',
						repoPath: repoPath,
						HEAD: createReference(currentCommitSha, repoPath, { refType: 'revision' }),
						current: current,
						incoming: createReference(currentCommitSha, repoPath, { refType: 'revision' }),
					} satisfies GitRevertStatus;
				}
			}
		});

		return status;
	}

	@gate<PausedOperationsGitSubProvider['abortPausedOperation']>((rp, o) => `${rp ?? ''}:${o?.quit ?? false}`)
	@debug()
	async abortPausedOperation(repoPath: string, options?: { quit?: boolean }): Promise<void> {
		const scope = getScopedLogger();

		const status = await this.getPausedOperationStatus(repoPath);
		if (status == null) return;

		const args = [status.type, options?.quit ? '--quit' : '--abort'];

		try {
			await this.git.exec({ cwd: repoPath, errors: 'throw' }, ...args);
		} catch (ex) {
			debugger;
			scope?.error(ex);
			throw getGitCommandError(
				'paused-operation-abort',
				ex,
				reason =>
					new PausedOperationAbortError(
						{
							reason: reason,
							operation: status,
							gitCommand: { repoPath: repoPath, args: args },
						},
						ex,
					),
			);
		}
	}

	@gate<PausedOperationsGitSubProvider['continuePausedOperation']>((rp, o) => `${rp ?? ''}:${o?.skip ?? false}`)
	@debug()
	async continuePausedOperation(repoPath: string, options?: { skip?: boolean }): Promise<void> {
		const scope = getScopedLogger();

		const status = await this.getPausedOperationStatus(repoPath);
		if (status == null) return;

		if (status.type === 'merge' && options?.skip) {
			throw new Error('Skipping a merge is not supported');
		}

		const args = [status.type, options?.skip ? '--skip' : '--continue'];

		try {
			await this.git.exec({ cwd: repoPath, errors: 'throw' }, ...args);
		} catch (ex) {
			debugger;
			scope?.error(ex);
			throw getGitCommandError(
				'paused-operation-continue',
				ex,
				reason =>
					new PausedOperationContinueError(
						{
							reason: reason,
							operation: status,
							skip: options?.skip ?? false,
							gitCommand: { repoPath: repoPath, args: args },
						},
						ex,
					),
			);
		}
	}
}

import { env, Uri, window, workspace } from 'vscode';
import type { Container } from '../../../../container';
import type { GitCache } from '../../../../git/cache';
import { GitErrorHandling } from '../../../../git/commandOptions';
import type {
	GitDiffSubProvider,
	NextComparisonUrisResult,
	PreviousComparisonUrisResult,
	PreviousLineComparisonUrisResult,
} from '../../../../git/gitProvider';
import { GitUri } from '../../../../git/gitUri';
import type { GitDiff, GitDiffFiles, GitDiffFilter, GitDiffShortStat } from '../../../../git/models/diff';
import type { GitFile } from '../../../../git/models/file';
import type { GitRevisionRange } from '../../../../git/models/revision';
import { deletedOrMissing, uncommitted, uncommittedStaged } from '../../../../git/models/revision';
import {
	parseGitApplyFiles,
	parseGitDiffNameStatusFiles,
	parseGitDiffShortStat,
} from '../../../../git/parsers/diffParser';
import {
	parseGitLogSimple,
	parseGitLogSimpleFormat,
	parseGitLogSimpleRenamed,
} from '../../../../git/parsers/logParser';
import { isUncommittedStaged } from '../../../../git/utils/revision.utils';
import { showGenericErrorMessage } from '../../../../messages';
import { configuration } from '../../../../system/-webview/configuration';
import { splitPath } from '../../../../system/-webview/path';
import { log } from '../../../../system/decorators/log';
import { Logger } from '../../../../system/logger';
import { getLogScope } from '../../../../system/logger.scope';
import type { Git } from '../git';
import { GitErrors } from '../git';
import type { LocalGitProvider } from '../localGitProvider';

export class DiffGitSubProvider implements GitDiffSubProvider {
	constructor(
		private readonly container: Container,
		private readonly git: Git,
		private readonly cache: GitCache,
		private readonly provider: LocalGitProvider,
	) {}

	@log()
	async getChangedFilesCount(repoPath: string, ref?: string): Promise<GitDiffShortStat | undefined> {
		const data = await this.git.diff__shortstat(repoPath, ref);
		if (!data) return undefined;

		return parseGitDiffShortStat(data);
	}

	@log()
	async getDiff(
		repoPath: string,
		to: string,
		from?: string,
		options?:
			| { context?: number; includeUntracked?: never; uris?: never }
			| { context?: number; includeUntracked?: never; uris: Uri[] }
			| { context?: number; includeUntracked: boolean; uris?: never },
	): Promise<GitDiff | undefined> {
		const scope = getLogScope();
		const params = [`-U${options?.context ?? 3}`];

		if (to === uncommitted) {
			if (from != null) {
				params.push(from);
			} else {
				// Get only unstaged changes
				from = 'HEAD';
			}
		} else if (to === uncommittedStaged) {
			params.push('--staged');
			if (from != null) {
				params.push(from);
			} else {
				// Get only staged changes
				from = 'HEAD';
			}
		} else if (from == null) {
			if (to === '' || to.toUpperCase() === 'HEAD') {
				from = 'HEAD';
				params.push(from);
			} else {
				from = `${to}^`;
				params.push(from, to);
			}
		} else if (to === '') {
			params.push(from);
		} else {
			params.push(from, to);
		}

		let untrackedPaths: string[] | undefined;

		if (options?.uris) {
			params.push('--', ...options.uris.map(u => u.fsPath));
		} else if (options?.includeUntracked && to === uncommitted) {
			const status = await this.provider.status?.getStatus(repoPath);
			untrackedPaths = status?.untrackedChanges.map(f => f.path);
			if (untrackedPaths?.length) {
				await this.provider.staging?.stageFiles(repoPath, untrackedPaths, { intentToAdd: true });
			}
		}

		let data;
		try {
			data = await this.git.diff2(repoPath, { errors: GitErrorHandling.Throw }, ...params);
		} catch (ex) {
			debugger;
			Logger.error(ex, scope);
			return undefined;
		} finally {
			if (untrackedPaths != null) {
				await this.provider.staging?.unstageFiles(repoPath, untrackedPaths);
			}
		}

		const diff: GitDiff = { contents: data, from: from, to: to };
		return diff;
	}

	@log({ args: { 1: false } })
	async getDiffFiles(repoPath: string, contents: string): Promise<GitDiffFiles | undefined> {
		const data = await this.git.apply2(repoPath, { stdin: contents }, '--numstat', '--summary', '-z');
		if (!data) return undefined;

		const files = parseGitApplyFiles(this.container, data, repoPath);
		return {
			files: files,
		};
	}

	@log()
	async getDiffStatus(
		repoPath: string,
		ref1OrRange: string | GitRevisionRange,
		ref2?: string,
		options?: { filters?: GitDiffFilter[]; path?: string; similarityThreshold?: number },
	): Promise<GitFile[] | undefined> {
		try {
			const data = await this.git.diff__name_status(repoPath, ref1OrRange, ref2, {
				similarityThreshold: configuration.get('advanced.similarityThreshold') ?? undefined,
				...options,
			});
			if (!data) return undefined;

			const files = parseGitDiffNameStatusFiles(data, repoPath);
			return files == null || files.length === 0 ? undefined : files;
		} catch (_ex) {
			return undefined;
		}
	}

	@log()
	async getDiffTool(repoPath?: string): Promise<string | undefined> {
		return (
			(await this.git.config__get('diff.guitool', repoPath, { local: true })) ??
			this.git.config__get('diff.tool', repoPath, { local: true })
		);
	}

	@log()
	async getNextComparisonUris(
		repoPath: string,
		uri: Uri,
		ref: string | undefined,
		skip: number = 0,
	): Promise<NextComparisonUrisResult | undefined> {
		// If we have no ref (or staged ref) there is no next commit
		if (!ref) return undefined;

		const relativePath = this.provider.getRelativePath(uri, repoPath);

		if (isUncommittedStaged(ref)) {
			return {
				current: GitUri.fromFile(relativePath, repoPath, ref),
				next: GitUri.fromFile(relativePath, repoPath, undefined),
			};
		}

		const next = await this.getNextUri(repoPath, uri, ref, skip);
		if (next == null) {
			const status = await this.provider.status?.getStatusForFile(repoPath, uri);
			if (status != null) {
				// If the file is staged, diff with the staged version
				if (status.indexStatus != null) {
					return {
						current: GitUri.fromFile(relativePath, repoPath, ref),
						next: GitUri.fromFile(relativePath, repoPath, uncommittedStaged),
					};
				}
			}

			return {
				current: GitUri.fromFile(relativePath, repoPath, ref),
				next: GitUri.fromFile(relativePath, repoPath, undefined),
			};
		}

		return {
			current:
				skip === 0
					? GitUri.fromFile(relativePath, repoPath, ref)
					: (await this.getNextUri(repoPath, uri, ref, skip - 1))!,
			next: next,
		};
	}

	@log()
	private async getNextUri(
		repoPath: string,
		uri: Uri,
		ref?: string,
		skip: number = 0,
		// editorLine?: number
	): Promise<GitUri | undefined> {
		// If we have no ref (or staged ref) there is no next commit
		if (!ref || isUncommittedStaged(ref)) return undefined;

		let filters: GitDiffFilter[] | undefined;
		if (ref === deletedOrMissing) {
			// If we are trying to move next from a deleted or missing ref then get the first commit
			ref = undefined;
			filters = ['A'];
		}

		const relativePath = this.provider.getRelativePath(uri, repoPath);
		let data = await this.git.log__file(repoPath, relativePath, ref, {
			argsOrFormat: parseGitLogSimpleFormat,
			fileMode: 'simple',
			filters: filters,
			limit: skip + 1,
			ordering: configuration.get('advanced.commitOrdering'),
			reverse: true,
			// startLine: editorLine != null ? editorLine + 1 : undefined,
		});
		if (data == null || data.length === 0) return undefined;

		const [nextRef, file, status] = parseGitLogSimple(data, skip);
		// If the file was deleted, check for a possible rename
		if (status === 'D') {
			data = await this.git.log__file(repoPath, '.', nextRef, {
				argsOrFormat: parseGitLogSimpleFormat,
				fileMode: 'simple',
				filters: ['R', 'C'],
				limit: 1,
				ordering: configuration.get('advanced.commitOrdering'),
				// startLine: editorLine != null ? editorLine + 1 : undefined
			});
			if (data == null || data.length === 0) {
				return GitUri.fromFile(file ?? relativePath, repoPath, nextRef);
			}

			const [nextRenamedRef, renamedFile] = parseGitLogSimpleRenamed(data, file ?? relativePath);
			return GitUri.fromFile(
				renamedFile ?? file ?? relativePath,
				repoPath,
				nextRenamedRef ?? nextRef ?? deletedOrMissing,
			);
		}

		return GitUri.fromFile(file ?? relativePath, repoPath, nextRef);
	}

	@log()
	async getPreviousComparisonUris(
		repoPath: string,
		uri: Uri,
		ref: string | undefined,
		skip: number = 0,
	): Promise<PreviousComparisonUrisResult | undefined> {
		if (ref === deletedOrMissing) return undefined;

		const relativePath = this.provider.getRelativePath(uri, repoPath);

		// If we are at the working tree (i.e. no ref), we need to dig deeper to figure out where to go
		if (!ref) {
			// First, check the file status to see if there is anything staged
			const status = await this.provider.status?.getStatusForFile(repoPath, uri);
			if (status != null) {
				// If the file is staged with working changes, diff working with staged (index)
				// If the file is staged without working changes, diff staged with HEAD
				if (status.indexStatus != null) {
					// Backs up to get to HEAD
					if (status.workingTreeStatus == null) {
						skip++;
					}

					if (skip === 0) {
						// Diff working with staged
						return {
							current: GitUri.fromFile(relativePath, repoPath, undefined),
							previous: GitUri.fromFile(relativePath, repoPath, uncommittedStaged),
						};
					}

					return {
						// Diff staged with HEAD (or prior if more skips)
						current: GitUri.fromFile(relativePath, repoPath, uncommittedStaged),
						previous: await this.getPreviousUri(repoPath, uri, ref, skip - 1),
					};
				} else if (status.workingTreeStatus != null) {
					if (skip === 0) {
						return {
							current: GitUri.fromFile(relativePath, repoPath, undefined),
							previous: await this.getPreviousUri(repoPath, uri, undefined, skip),
						};
					}
				}
			} else if (skip === 0) {
				skip++;
			}
		}
		// If we are at the index (staged), diff staged with HEAD
		else if (isUncommittedStaged(ref)) {
			const current =
				skip === 0
					? GitUri.fromFile(relativePath, repoPath, ref)
					: (await this.getPreviousUri(repoPath, uri, undefined, skip - 1))!;
			if (current == null || current.sha === deletedOrMissing) return undefined;

			return {
				current: current,
				previous: await this.getPreviousUri(repoPath, uri, undefined, skip),
			};
		}

		// If we are at a commit, diff commit with previous
		const current =
			skip === 0
				? GitUri.fromFile(relativePath, repoPath, ref)
				: (await this.getPreviousUri(repoPath, uri, ref, skip - 1))!;
		if (current == null || current.sha === deletedOrMissing) return undefined;

		return {
			current: current,
			previous: await this.getPreviousUri(repoPath, uri, ref, skip),
		};
	}

	@log()
	async getPreviousComparisonUrisForLine(
		repoPath: string,
		uri: Uri,
		editorLine: number, // 0-based, Git is 1-based
		ref: string | undefined,
		skip: number = 0,
	): Promise<PreviousLineComparisonUrisResult | undefined> {
		if (ref === deletedOrMissing) return undefined;

		let relativePath = this.provider.getRelativePath(uri, repoPath);

		let previous;

		// If we are at the working tree (i.e. no ref), we need to dig deeper to figure out where to go
		if (!ref) {
			// First, check the blame on the current line to see if there are any working/staged changes
			const gitUri = new GitUri(uri, repoPath);

			const document = await workspace.openTextDocument(uri);
			const blameLine = document.isDirty
				? await this.provider.getBlameForLineContents(gitUri, editorLine, document.getText())
				: await this.provider.getBlameForLine(gitUri, editorLine);
			if (blameLine == null) return undefined;

			// If line is uncommitted, we need to dig deeper to figure out where to go (because blame can't be trusted)
			if (blameLine.commit.isUncommitted) {
				// Check the file status to see if there is anything staged
				const status = await this.provider.status?.getStatusForFile(repoPath, uri);
				if (status != null) {
					// If the file is staged, diff working with staged (index)
					// If the file is not staged, diff working with HEAD
					if (status.indexStatus != null) {
						// Diff working with staged
						return {
							current: GitUri.fromFile(relativePath, repoPath, undefined),
							previous: GitUri.fromFile(relativePath, repoPath, uncommittedStaged),
							line: editorLine,
						};
					}
				}

				// Diff working with HEAD (or prior if more skips)
				return {
					current: GitUri.fromFile(relativePath, repoPath, undefined),
					previous: await this.getPreviousUri(repoPath, uri, undefined, skip, editorLine),
					line: editorLine,
				};
			}

			// If line is committed, diff with line ref with previous
			ref = blameLine.commit.sha;
			relativePath = blameLine.commit.file?.path ?? blameLine.commit.file?.originalPath ?? relativePath;
			uri = this.provider.getAbsoluteUri(relativePath, repoPath);
			editorLine = blameLine.line.originalLine - 1;

			if (skip === 0 && blameLine.commit.file?.previousSha) {
				previous = GitUri.fromFile(relativePath, repoPath, blameLine.commit.file.previousSha);
			}
		} else {
			if (isUncommittedStaged(ref)) {
				const current =
					skip === 0
						? GitUri.fromFile(relativePath, repoPath, ref)
						: (await this.getPreviousUri(repoPath, uri, undefined, skip - 1, editorLine))!;
				if (current.sha === deletedOrMissing) return undefined;

				return {
					current: current,
					previous: await this.getPreviousUri(repoPath, uri, undefined, skip, editorLine),
					line: editorLine,
				};
			}

			const gitUri = new GitUri(uri, { repoPath: repoPath, sha: ref });
			const blameLine = await this.provider.getBlameForLine(gitUri, editorLine);
			if (blameLine == null) return undefined;

			// Diff with line ref with previous
			ref = blameLine.commit.sha;
			relativePath = blameLine.commit.file?.path ?? blameLine.commit.file?.originalPath ?? relativePath;
			uri = this.provider.getAbsoluteUri(relativePath, repoPath);
			editorLine = blameLine.line.originalLine - 1;

			if (skip === 0 && blameLine.commit.file?.previousSha) {
				previous = GitUri.fromFile(relativePath, repoPath, blameLine.commit.file.previousSha);
			}
		}

		const current =
			skip === 0
				? GitUri.fromFile(relativePath, repoPath, ref)
				: (await this.getPreviousUri(repoPath, uri, ref, skip - 1, editorLine))!;
		if (current.sha === deletedOrMissing) return undefined;

		return {
			current: current,
			previous: previous ?? (await this.getPreviousUri(repoPath, uri, ref, skip, editorLine)),
			line: editorLine,
		};
	}

	@log()
	private async getPreviousUri(
		repoPath: string,
		uri: Uri,
		ref?: string,
		skip: number = 0,
		editorLine?: number,
	): Promise<GitUri | undefined> {
		if (ref === deletedOrMissing) return undefined;

		const scope = getLogScope();

		if (ref === uncommitted) {
			ref = undefined;
		}

		const relativePath = this.provider.getRelativePath(uri, repoPath);

		// TODO: Add caching
		let data;
		try {
			data = await this.git.log__file(repoPath, relativePath, ref, {
				argsOrFormat: parseGitLogSimpleFormat,
				fileMode: 'simple',
				limit: skip + 2,
				ordering: configuration.get('advanced.commitOrdering'),
				startLine: editorLine != null ? editorLine + 1 : undefined,
			});
		} catch (ex) {
			const msg: string = ex?.toString() ?? '';
			// If the line count is invalid just fallback to the most recent commit
			if ((ref == null || isUncommittedStaged(ref)) && GitErrors.invalidLineCount.test(msg)) {
				if (ref == null) {
					const status = await this.provider.status?.getStatusForFile(repoPath, uri);
					if (status?.indexStatus != null) {
						return GitUri.fromFile(relativePath, repoPath, uncommittedStaged);
					}
				}

				ref = await this.git.log__file_recent(repoPath, relativePath, {
					ordering: configuration.get('advanced.commitOrdering'),
				});
				return GitUri.fromFile(relativePath, repoPath, ref ?? deletedOrMissing);
			}

			Logger.error(ex, scope);
			throw ex;
		}
		if (data == null || data.length === 0) return undefined;

		const [previousRef, file] = parseGitLogSimple(data, skip, ref);
		// If the previous ref matches the ref we asked for assume we are at the end of the history
		if (ref != null && ref === previousRef) return undefined;

		return GitUri.fromFile(file ?? relativePath, repoPath, previousRef ?? deletedOrMissing);
	}

	@log()
	async openDiffTool(
		repoPath: string,
		uri: Uri,
		options?: { ref1?: string; ref2?: string; staged?: boolean; tool?: string },
	): Promise<void> {
		const scope = getLogScope();
		const [relativePath, root] = splitPath(uri, repoPath);

		try {
			let tool = options?.tool;
			if (!tool) {
				const scope = getLogScope();

				tool = configuration.get('advanced.externalDiffTool') || (await this.getDiffTool(root));
				if (tool == null) throw new Error('No diff tool found');

				Logger.log(scope, `Using tool=${tool}`);
			}

			await this.git.difftool(root, relativePath, tool, options);
		} catch (ex) {
			const msg: string = ex?.toString() ?? '';
			if (msg === 'No diff tool found' || /Unknown .+? tool/.test(msg)) {
				const viewDocs = 'View Git Docs';
				const result = await window.showWarningMessage(
					'Unable to open changes because the specified diff tool cannot be found or no Git diff tool is configured',
					viewDocs,
				);
				if (result === viewDocs) {
					void env.openExternal(
						Uri.parse('https://git-scm.com/docs/git-config#Documentation/git-config.txt-difftool'),
					);
				}

				return;
			}

			Logger.error(ex, scope);
			void showGenericErrorMessage('Unable to open compare');
		}
	}

	@log()
	async openDirectoryCompare(repoPath: string, ref1: string, ref2?: string, tool?: string): Promise<void> {
		const scope = getLogScope();

		try {
			if (!tool) {
				const scope = getLogScope();

				tool = configuration.get('advanced.externalDirectoryDiffTool') || (await this.getDiffTool(repoPath));
				if (tool == null) throw new Error('No diff tool found');

				Logger.log(scope, `Using tool=${tool}`);
			}

			await this.git.difftool__dir_diff(repoPath, tool, ref1, ref2);
		} catch (ex) {
			const msg: string = ex?.toString() ?? '';
			if (msg === 'No diff tool found' || /Unknown .+? tool/.test(msg)) {
				const viewDocs = 'View Git Docs';
				const result = await window.showWarningMessage(
					'Unable to open directory compare because the specified diff tool cannot be found or no Git diff tool is configured',
					viewDocs,
				);
				if (result === viewDocs) {
					void env.openExternal(
						Uri.parse('https://git-scm.com/docs/git-config#Documentation/git-config.txt-difftool'),
					);
				}

				return;
			}

			Logger.error(ex, scope);
			void showGenericErrorMessage('Unable to open directory compare');
		}
	}
}

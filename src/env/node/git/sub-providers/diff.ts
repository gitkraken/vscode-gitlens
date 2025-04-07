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
import type { GitRevisionRange, GitRevisionRangeNotation } from '../../../../git/models/revision';
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
import { getRevisionRangeParts, isRevisionRange, isUncommittedStaged } from '../../../../git/utils/revision.utils';
import { showGenericErrorMessage } from '../../../../messages';
import { configuration } from '../../../../system/-webview/configuration';
import { splitPath } from '../../../../system/-webview/path';
import { getOpenTextDocument } from '../../../../system/-webview/vscode/documents';
import { log } from '../../../../system/decorators/log';
import { Logger } from '../../../../system/logger';
import { getLogScope } from '../../../../system/logger.scope';
import type { Git } from '../git';
import { gitDiffDefaultConfigs, GitErrors, gitLogDefaultConfigs } from '../git';
import type { LocalGitProvider } from '../localGitProvider';

export class DiffGitSubProvider implements GitDiffSubProvider {
	constructor(
		private readonly container: Container,
		private readonly git: Git,
		private readonly cache: GitCache,
		private readonly provider: LocalGitProvider,
	) {}

	@log()
	async getChangedFilesCount(
		repoPath: string,
		to?: string,
		from?: string,
		options?: { uris?: Uri[] },
	): Promise<GitDiffShortStat | undefined> {
		const scope = getLogScope();

		const args: string[] = [];
		if (to != null) {
			// Handle revision ranges specially if there is no `from`, otherwise `prepareToFromDiffArgs` will duplicate the range
			if (isRevisionRange(to) && from == null) {
				args.push(to);
			} else {
				prepareToFromDiffArgs(to, from, args);
			}
		}

		try {
			const data = await this.git.exec(
				{ cwd: repoPath, configs: gitDiffDefaultConfigs },
				'diff',
				'--shortstat',
				'--no-ext-diff',
				...args,
				'--',
				options?.uris?.map(u => this.provider.getRelativePath(u, repoPath)) ?? undefined,
			);
			if (!data) return undefined;
			return parseGitDiffShortStat(data);
		} catch (ex) {
			const msg: string = ex?.toString() ?? '';
			if (GitErrors.noMergeBase.test(msg)) {
				return undefined;
			}

			Logger.error(scope, ex);
			throw ex;
		}
	}

	@log()
	async getDiff(
		repoPath: string,
		to: string,
		from?: string,
		options?: { context?: number; includeUntracked?: boolean; notation?: GitRevisionRangeNotation; uris?: Uri[] },
	): Promise<GitDiff | undefined> {
		const scope = getLogScope();
		const args = [`-U${options?.context ?? 3}`];

		if (to != null && isRevisionRange(to)) {
			const parts = getRevisionRangeParts(to);
			if (parts != null) {
				to = parts.right ?? '';
				from = parts.left;
				options = { ...options, notation: parts.notation };
			}
		}

		from = prepareToFromDiffArgs(to, from, args, options?.notation);

		let paths: Set<string> | undefined;
		let untrackedPaths: string[] | undefined;

		if (options?.uris) {
			paths = new Set<string>(options.uris.map(u => this.provider.getRelativePath(u, repoPath)));
			args.push('--', ...paths);
		}

		if (options?.includeUntracked && to === uncommitted) {
			const status = await this.provider.status?.getStatus(repoPath);

			untrackedPaths = status?.untrackedChanges.map(f => f.path);

			if (untrackedPaths?.length) {
				if (paths?.size) {
					untrackedPaths = untrackedPaths.filter(p => paths.has(p));
				}

				if (untrackedPaths.length) {
					await this.provider.staging?.stageFiles(repoPath, untrackedPaths, { intentToAdd: true });
				}
			}
		}

		let data;
		try {
			data = await this.git.exec(
				{ cwd: repoPath, configs: gitLogDefaultConfigs, errors: GitErrorHandling.Throw },
				'diff',
				...args,
				args.includes('--') ? undefined : '--',
			);
		} catch (ex) {
			debugger;
			Logger.error(ex, scope);
			return undefined;
		} finally {
			if (untrackedPaths?.length) {
				await this.provider.staging?.unstageFiles(repoPath, untrackedPaths);
			}
		}

		const diff: GitDiff = { contents: data, from: from, to: to, notation: options?.notation };
		return diff;
	}

	@log({ args: { 1: false } })
	async getDiffFiles(repoPath: string, contents: string): Promise<GitDiffFiles | undefined> {
		// const data = await this.git.apply2(repoPath, { stdin: contents }, '--numstat', '--summary', '-z');
		const data = await this.git.exec(
			{ cwd: repoPath, configs: gitLogDefaultConfigs, stdin: contents },
			'apply',
			'--numstat',
			'--summary',
			'-z',
			'-',
		);

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
			const similarityThreshold =
				options?.similarityThreshold ?? configuration.get('advanced.similarityThreshold') ?? undefined;
			const data = await this.git.exec(
				{ cwd: repoPath, configs: gitDiffDefaultConfigs },
				'diff',
				'--name-status',
				`-M${similarityThreshold == null ? '' : `${similarityThreshold}%`}`,
				'--no-ext-diff',
				'-z',
				options?.filters?.length ? `--diff-filter=${options.filters.join('')}` : undefined,
				ref1OrRange ? ref1OrRange : undefined,
				ref2 ? ref2 : undefined,
				'--',
				options?.path ? options.path : undefined,
			);
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
			} else {
				const workingUri = GitUri.fromFile(relativePath, repoPath, undefined);
				const isDirty = getOpenTextDocument(workingUri)?.isDirty;
				if (!isDirty) {
					return {
						current: (await this.getPreviousUri(repoPath, uri, ref, 0))!,
						next: workingUri,
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
		dirty?: boolean,
	): Promise<PreviousComparisonUrisResult | undefined> {
		if (ref === deletedOrMissing) return undefined;

		const relativePath = this.provider.getRelativePath(uri, repoPath);
		let skipPrev = 0;

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
				}

				if (status.workingTreeStatus != null) {
					if (skip === 0) {
						return {
							current: GitUri.fromFile(relativePath, repoPath, undefined),
							previous: await this.getPreviousUri(repoPath, uri, undefined, skip),
						};
					}
				}
			} else if (!dirty && skip === 0) {
				skipPrev++;
			}
		} else if (isUncommittedStaged(ref)) {
			// If we are at the index (staged), diff staged with HEAD

			const current =
				skip === 0
					? GitUri.fromFile(relativePath, repoPath, ref)
					: (await this.getPreviousUri(repoPath, uri, undefined, skip + skipPrev - 1))!;
			if (current == null || current.sha === deletedOrMissing) return undefined;

			return {
				current: current,
				previous: await this.getPreviousUri(repoPath, uri, undefined, skip + skipPrev),
			};
		}

		// If we are at a commit, diff commit with previous
		const current =
			skip === 0
				? GitUri.fromFile(relativePath, repoPath, ref)
				: (await this.getPreviousUri(repoPath, uri, ref, skip + skipPrev - 1))!;
		if (current == null || current.sha === deletedOrMissing) return undefined;

		return {
			current: current,
			previous: await this.getPreviousUri(repoPath, uri, ref, skip + skipPrev),
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

		if (ref === 'HEAD' && skip === 0) {
			skip++;
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

			await this.git.exec(
				{ cwd: root },
				'difftool',
				'--no-prompt',
				`--tool=${tool}`,
				options?.staged ? '--staged' : undefined,
				options?.ref1 ? options.ref1 : undefined,
				options?.ref2 ? options.ref2 : undefined,
				'--',
				relativePath,
			);
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

			await this.git.exec({ cwd: repoPath }, 'difftool', '--dir-diff', `--tool=${tool}`, ref1, ref2);
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
function prepareToFromDiffArgs(
	to: string,
	from: string | undefined,
	args: string[],
	notation?: GitRevisionRangeNotation,
): string {
	if (to === uncommitted) {
		if (from != null) {
			args.push(from);
		} else {
			// Get only unstaged changes
			from = 'HEAD';
		}
	} else if (to === uncommittedStaged) {
		args.push('--staged');
		if (from != null) {
			args.push(from);
		} else {
			// Get only staged changes
			from = 'HEAD';
		}
	} else if (from == null) {
		if (to === '' || to.toUpperCase() === 'HEAD') {
			from = 'HEAD';
			args.push(from);
		} else {
			from = `${to}^`;
			args.push(from, to);
		}
	} else if (to === '') {
		args.push(from);
	} else if (notation != null) {
		args.push(`${from}${notation}${to}`);
	} else {
		args.push(from, to);
	}
	return from;
}

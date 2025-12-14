import { env, Uri, window } from 'vscode';
import type { Container } from '../../../../container';
import type { GitCache } from '../../../../git/cache';
import { GitErrorHandling } from '../../../../git/commandOptions';
import type {
	DiffRange,
	GitDiffSubProvider,
	NextComparisonUrisResult,
	PreviousComparisonUrisResult,
	PreviousRangeComparisonUrisResult,
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
import type { LogParsedFile } from '../../../../git/parsers/logParser';
import { getShaAndFileRangeLogParser, getShaAndFileSummaryLogParser } from '../../../../git/parsers/logParser';
import {
	getRevisionRangeParts,
	isRevisionRange,
	isUncommitted,
	isUncommittedStaged,
} from '../../../../git/utils/revision.utils';
import { showGenericErrorMessage } from '../../../../messages';
import { configuration } from '../../../../system/-webview/configuration';
import { splitPath } from '../../../../system/-webview/path';
import { log } from '../../../../system/decorators/log';
import { first } from '../../../../system/iterable';
import { Logger } from '../../../../system/logger';
import { getLogScope } from '../../../../system/logger.scope';
import type { Git, GitResult } from '../git';
import { gitConfigsDiff, gitConfigsLog, GitErrors } from '../git';
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
			const result = await this.git.exec(
				{ cwd: repoPath, configs: gitConfigsDiff },
				'diff',
				'--shortstat',
				'--no-ext-diff',
				...args,
				'--',
				...(options?.uris?.map(u => this.provider.getRelativePath(u, repoPath)) ?? []),
			);
			if (!result.stdout) return undefined;

			return parseGitDiffShortStat(result.stdout);
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
		options?: { context?: number; notation?: GitRevisionRangeNotation; uris?: Uri[] },
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
		if (options?.uris) {
			paths = new Set<string>(options.uris.map(u => this.provider.getRelativePath(u, repoPath)));
			args.push('--', ...paths);
		}

		let result;
		try {
			result = await this.git.exec(
				{ cwd: repoPath, configs: gitConfigsDiff, errors: GitErrorHandling.Throw },
				'diff',
				...args,
				args.includes('--') ? undefined : '--',
			);
		} catch (ex) {
			debugger;
			Logger.error(ex, scope);
			return undefined;
		}

		const diff: GitDiff = { contents: result.stdout, from: from, to: to, notation: options?.notation };
		return diff;
	}

	@log({ args: { 1: false } })
	async getDiffFiles(repoPath: string, contents: string): Promise<GitDiffFiles | undefined> {
		const result = await this.git.exec(
			{ cwd: repoPath, configs: gitConfigsLog, stdin: contents },
			'apply',
			'--numstat',
			'--summary',
			'-z',
			'-',
		);
		if (!result.stdout) return undefined;

		const files = parseGitApplyFiles(this.container, result.stdout, repoPath);
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
			const result = await this.git.exec(
				{ cwd: repoPath, configs: gitConfigsDiff },
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
			if (!result.stdout) return undefined;

			const files = parseGitDiffNameStatusFiles(result.stdout, repoPath);
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
		rev: string | undefined,
		skip: number = 0,
	): Promise<NextComparisonUrisResult | undefined> {
		// If we have no revision there is no next commit
		if (!rev) return undefined;

		const scope = getLogScope();

		let relativePath = this.provider.getRelativePath(uri, repoPath);

		if (isUncommittedStaged(rev)) {
			return {
				current: GitUri.fromFile(relativePath, repoPath, rev),
				next: GitUri.fromFile(relativePath, repoPath, undefined),
			};
		} else if (isUncommitted(rev)) {
			return undefined;
		}

		try {
			const parser = getShaAndFileSummaryLogParser();
			const args = ['log', ...parser.arguments];

			const ordering = configuration.get('advanced.commitOrdering');
			if (ordering) {
				args.push(`--${ordering}-order`);
			}

			args.push(
				// Use reverse to get the next commits (oldest to newest instead of newest to oldest)
				'--reverse',
			);

			if (rev !== deletedOrMissing) {
				args.push(
					// Ancestry path to ensure we only follow the path from the given revision to HEAD
					'--ancestry-path',
					// Range from the given revision to HEAD
					`${rev}..HEAD`,
				);
			}

			// Follow file history and specify the file path
			args.push('--follow', '--', relativePath);

			const result = await this.git.exec({ cwd: repoPath, configs: gitConfigsLog }, ...args);

			let currentSha;
			let currentPath;

			if (skip === 0) {
				currentSha = rev;
				currentPath = relativePath;
			} else {
				skip--;
			}

			let nextSha;
			let nextPath;

			let file;
			for (const commit of parser.parse(result.stdout)) {
				const path = relativePath;
				file = commit.files.find(f => f.path === path || f.originalPath === path);
				// Keep track of the file changing paths
				if (file?.path && file.path !== relativePath) {
					relativePath = file.path;
				}

				if (skip > 0) {
					skip--;
					continue;
				}

				if (currentSha == null) {
					currentSha = commit.sha;
					currentPath = file?.path ?? relativePath;
				} else if (nextSha == null) {
					// if (commit.sha === rev) continue;

					nextSha = commit.sha;
					nextPath = file?.path ?? relativePath;

					break;
				}
			}

			if (currentSha == null || currentPath == null) {
				const status = await this.provider.status?.getStatusForFile(repoPath, relativePath);
				if (status != null) {
					if (status.indexStatus != null) {
						currentSha = uncommittedStaged;
						currentPath = status.originalPath ?? status.path;
						nextSha = '';
						nextPath = status.path;
					} else {
						debugger;
						return undefined;
					}
				} else {
					debugger;
					return undefined;
				}
			}

			if (nextSha == null || nextPath == null) {
				const status = await this.provider.status?.getStatusForFile(repoPath, relativePath);
				if (status != null) {
					if (status.indexStatus != null) {
						nextSha = uncommittedStaged;
						nextPath = status.originalPath ?? status.path;
					} else {
						nextSha = '';
						nextPath = status.path;
					}
				} else {
					nextSha = '';
					nextPath = relativePath;
				}
			}

			return {
				current: GitUri.fromFile(currentPath, repoPath, currentSha || undefined),
				next: GitUri.fromFile(nextPath ?? currentPath, repoPath, (nextSha ?? deletedOrMissing) || undefined),
			};
		} catch (ex) {
			Logger.error(ex, scope);
			throw ex;
		}
	}

	@log()
	async getPreviousComparisonUris(
		repoPath: string,
		uri: Uri,
		rev: string | undefined,
		skip: number = 0,
		unsaved?: boolean,
	): Promise<PreviousComparisonUrisResult | undefined> {
		if (rev === deletedOrMissing) return undefined;

		const scope = getLogScope();

		if (rev === uncommitted) {
			rev = undefined;
		}

		/* Rules:
		 * Starting from working tree (rev is empty or undefined):
		 *   1. Check file status:
		 *      1.1. If file has both staged and working (or unsaved) changes:
		 *          - If skip=0: diff working with staged
		 *          - If skip>0: skip through revs starting at HEAD
		 *
		 *      1.2. If file has only staged changes:
		 *          - If skip=0: diff working with HEAD
		 *          - If skip>0: skip through revs starting at HEAD
		 *
		 *      1.3. If file has only working changes:
		 *          - If skip=0: diff working with HEAD
		 *          - If skip>0: skip through revs starting at HEAD
		 *
		 *      1.4. If file has no changes (or no status found):
		 *          - If skip=0: diff working with HEAD~1
		 *          - If skip>0: skip through revs starting at HEAD~1
		 *
		 * Starting from staged (rev is uncommittedStaged):
		 *   1. Check file status:
		 *      1.1. If status exists:
		 *          - If skip=0: diff staged with HEAD
		 *          - If skip>0: skip through revs starting at HEAD
		 *
		 *      1.2. If status doesn't exist:
		 *          - If skip=0: diff HEAD with HEAD~1
		 *          - If skip>0: skip through revs starting at HEAD
		 *
		 * Starting from a commit (rev is a SHA):
		 *   - If skip=0: diff SHA with SHA^
		 *   - If skip>0: skip through revs starting at SHA
		 */

		let relativePath = this.provider.getRelativePath(uri, repoPath);
		let skipPrev = 0;

		let revs: [string, string][] = [];
		if (!rev) {
			revs = [['', relativePath]];

			const status = await this.provider.status?.getStatusForFile(repoPath, uri);
			if (status != null) {
				if (status.indexStatus != null) {
					revs.push([uncommittedStaged, status.originalPath ?? status.path]);
				}

				revs.push(['HEAD', status.originalPath ?? status.path]);
				if (status.workingTreeStatus == null && !unsaved) {
					if (skip === 0 || status.indexStatus == null) {
						// Skip over the HEAD commit to get a diff, because working and HEAD are the same
						skipPrev++;
					}
				}
			} else {
				revs.push(['HEAD', relativePath]);
				if (!unsaved) {
					// Skip over the HEAD commit to get a diff, because working and HEAD are the same
					skipPrev++;
				}
			}
		} else if (isUncommittedStaged(rev)) {
			const status = await this.provider.status?.getStatusForFile(repoPath, uri);
			if (status != null) {
				revs = [
					[uncommittedStaged, status.originalPath ?? status.path],
					['HEAD', status.originalPath ?? status.path],
				];
			} else {
				// Even though we supposedly started at staged, there is no staged version
				revs = [['HEAD', relativePath]];
				if (skip > 0) {
					skip--;
				}
			}
		}

		let currentSha;
		let currentPath;

		if (revs.length) {
			skip++;
			while (revs.length && skip > 0) {
				skip--;
				[rev, relativePath] = revs.shift()!;
			}

			if (rev !== 'HEAD') {
				currentSha = rev;
				currentPath = relativePath;

				skipPrev++;
				while (revs.length && skipPrev > 0) {
					skipPrev--;
					[rev, relativePath] = revs.shift()!;
				}

				if (skipPrev > 0) {
					skip += skipPrev;
					skipPrev = 0;
				}

				if (rev !== 'HEAD' && skip === 0) {
					return {
						current: GitUri.fromFile(currentPath, repoPath, currentSha),
						previous: GitUri.fromFile(relativePath, repoPath, rev),
					};
				}
			}
		}

		try {
			const parser = getShaAndFileSummaryLogParser();
			const args = ['log', ...parser.arguments, `-n${skip + 2}`]; // Don't use --skip as it doesn't work with --follow

			const ordering = configuration.get('advanced.commitOrdering');
			if (ordering) {
				args.push(`--${ordering}-order`);
			}

			args.push('--follow', rev!, '--', relativePath);

			const result = await this.git.exec({ cwd: repoPath, configs: gitConfigsLog }, ...args);

			let previousSha;
			let previousPath;
			let file;

			for (const commit of parser.parse(result.stdout)) {
				const path = relativePath;
				file = commit.files.find(f => f.path === path || f.originalPath === path);
				// Keep track of the file changing paths
				if (file?.originalPath && file.originalPath !== relativePath) {
					relativePath = file.originalPath;
				}

				if (skip > 0) {
					skip--;
					continue;
				}

				if (currentSha == null) {
					currentSha = commit.sha;
					currentPath = file?.path ?? relativePath;
				} else if (previousSha == null) {
					if (commit.sha === rev) continue;

					previousSha = commit.sha;
					previousPath = file?.path ?? relativePath;

					break;
				}
			}

			if (currentSha == null || currentPath == null) return undefined;

			return {
				current: GitUri.fromFile(currentPath, repoPath, currentSha || undefined),
				previous: GitUri.fromFile(previousPath ?? currentPath, repoPath, previousSha ?? deletedOrMissing),
			};
		} catch (ex) {
			Logger.error(ex, scope);
			throw ex;
		}
	}

	@log()
	async getPreviousComparisonUrisForRange(
		repoPath: string,
		uri: Uri,
		rev: string | undefined,
		range: DiffRange,
		options?: { skipFirstRev?: boolean },
	): Promise<PreviousRangeComparisonUrisResult | undefined> {
		if (rev === deletedOrMissing) return undefined;

		const scope = getLogScope();

		if (rev === uncommitted) {
			rev = undefined;
		}

		let currentSha;
		let currentPath;
		let relativePath = this.provider.getRelativePath(uri, repoPath);
		const skipFirstRev = options?.skipFirstRev ?? true;

		// If we are at the working tree (i.e. no ref), we need to dig deeper to figure out where to go
		if (!rev) {
			const status = await this.provider.status?.getStatusForFile(repoPath, uri);
			if (status != null) {
				if (status.indexStatus != null) {
					if (status.workingTreeStatus != null && !skipFirstRev) {
						return {
							current: GitUri.fromFile(relativePath, repoPath, undefined),
							previous: GitUri.fromFile(relativePath, repoPath, uncommittedStaged),
							range: range,
						};
					}

					currentSha = uncommittedStaged;
					currentPath = status.originalPath ?? status.path;
					if (status.originalPath != null) {
						relativePath = status.originalPath;
					}
					rev = uncommittedStaged;
				} else if (status.workingTreeStatus != null && !skipFirstRev) {
					currentSha = '';
					currentPath = relativePath;
					rev = '';
				}
			}
		} else if (!skipFirstRev) {
			currentSha = rev;
			currentPath = relativePath;
		}

		try {
			const parser = getShaAndFileRangeLogParser();
			const args = ['log', ...parser.arguments, '-n2']; // Don't use --skip as it doesn't work with --follow

			const ordering = configuration.get('advanced.commitOrdering');
			if (ordering) {
				args.push(`--${ordering}-order`);
			}

			if (rev && !isUncommittedStaged(rev)) {
				args.push(rev);
			}

			args.push(`-L${range.startLine},${range.endLine}:${relativePath}`);

			let result: GitResult<string>;
			try {
				result = await this.git.exec({ cwd: repoPath, configs: gitConfigsLog }, ...args);
			} catch (ex) {
				if (rev && !isUncommittedStaged(rev)) throw ex;

				// If the line count is invalid reset to a valid range
				const match = GitErrors.invalidLineCount.exec(ex?.toString() ?? '');
				if (match == null) throw ex;

				const line = parseInt(match[1], 10);
				if (isNaN(line)) throw ex;

				const index = args.findIndex(a => a.startsWith('-L'));
				if (index === -1) throw ex;

				range = {
					startLine: Math.min(range.startLine, line),
					endLine: Math.min(range.endLine, line),
					active: range.active,
				};

				args.splice(index, 1, `-L${range.startLine},${range.endLine}:${relativePath}`);
				result = await this.git.exec({ cwd: repoPath, configs: gitConfigsLog }, ...args);
			}

			let currentRange;
			let previousSha;
			let previousPath;
			let file;

			for (const commit of parser.parse(result.stdout)) {
				const path = relativePath;
				file = commit.files.find(f => f.path === path || f.originalPath === path);
				// If we couldn't find the file, but there is only one file in the commit, use that one and assume the filename changed
				if (file == null && commit.files.length === 1) {
					file = commit.files[0];
					relativePath = file.path;
				}
				// Keep track of the file changing paths
				if (file?.originalPath && file.originalPath !== relativePath) {
					relativePath = file.originalPath;
				}

				if (currentSha == null) {
					currentSha = commit.sha;
					currentPath = file?.path ?? relativePath;
					currentRange = file?.range;
				} else if (previousSha == null) {
					if (commit.sha === rev) continue;

					previousSha = commit.sha;
					previousPath = file?.path ?? relativePath;

					break;
				}
			}

			if (currentSha == null || currentPath == null) return undefined;

			return {
				current: GitUri.fromFile(currentPath, repoPath, currentSha || undefined),
				previous: GitUri.fromFile(previousPath ?? currentPath, repoPath, previousSha ?? deletedOrMissing),
				range: currentRange ?? range,
			};
		} catch (ex) {
			Logger.error(ex, scope);
			throw ex;
		}
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

export async function findPathStatusChanged(
	git: Git,
	repoPath: string,
	pathspec: string,
	rev: string | undefined,
	options?: { filters?: GitDiffFilter[]; ordering?: 'date' | 'author-date' | 'topo' | null },
): Promise<{ sha: string; file: LogParsedFile | undefined } | undefined> {
	const parser = getShaAndFileSummaryLogParser();

	const ordering = options?.ordering ?? configuration.get('advanced.commitOrdering');

	const result = await git.exec(
		{ cwd: repoPath, configs: gitConfigsLog },
		'log',
		...parser.arguments,
		ordering ? `--${ordering}-order` : undefined,
		'-n1',
		`--diff-filter=${options?.filters?.length ? options.filters.join('') : 'RCD'}`,
		rev,
		'--',
	);

	const commit = first(parser.parse(result.stdout));
	if (commit == null) return undefined;

	const file = commit.files.find(f => f.path === pathspec || f.originalPath === pathspec);
	return { sha: commit.sha, file: file };
}

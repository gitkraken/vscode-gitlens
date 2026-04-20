import type { Cache } from '@gitlens/git/cache.js';
import type { GitServiceContext } from '@gitlens/git/context.js';
import type {
	GitDiff,
	GitDiffFiles,
	GitDiffFilter,
	GitDiffShortStat,
	ParsedGitDiffHunks,
} from '@gitlens/git/models/diff.js';
import type { GitFile } from '@gitlens/git/models/file.js';
import type { GitRevisionRange, GitRevisionRangeNotation } from '@gitlens/git/models/revision.js';
import { deletedOrMissing, rootSha, uncommitted, uncommittedStaged } from '@gitlens/git/models/revision.js';
import {
	parseGitApplyFiles,
	parseGitDiffNumStatFiles,
	parseGitDiffShortStat,
	parseGitFileDiff,
} from '@gitlens/git/parsers/diffParser.js';
import type {
	GitDiffSubProvider,
	NextComparisonUrisResult,
	PreviousComparisonUrisResult,
	PreviousRangeComparisonUrisResult,
} from '@gitlens/git/providers/diff.js';
import type { DisposableTemporaryGitIndex } from '@gitlens/git/providers/staging.js';
import type { DiffRange, RevisionUri } from '@gitlens/git/providers/types.js';
import {
	getRevisionRangeParts,
	isRevisionRange,
	isUncommitted,
	isUncommittedStaged,
} from '@gitlens/git/utils/revision.utils.js';
import { encodeGitLensRevisionUriAuthority } from '@gitlens/git/utils/uriAuthority.js';
import { debug } from '@gitlens/utils/decorators/log.js';
import { fnv1aHash } from '@gitlens/utils/hash.js';
import { first } from '@gitlens/utils/iterable.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import { normalizePath, splitPath } from '@gitlens/utils/path.js';
import type { Uri } from '@gitlens/utils/uri.js';
import { fromUri, toFsPath } from '@gitlens/utils/uri.js';
import type { CliGitProviderInternal } from '../cliGitProvider.js';
import type { GitResult } from '../exec/exec.types.js';
import type { Git } from '../exec/git.js';
import { gitConfigsDiff, gitConfigsLog, GitError, GitErrors } from '../exec/git.js';
import type { LogParsedFile } from '../parsers/logParser.js';
import { getShaAndFileRangeLogParser, getShaAndFileSummaryLogParser } from '../parsers/logParser.js';

export class DiffGitSubProvider implements GitDiffSubProvider {
	constructor(
		private readonly context: GitServiceContext,
		private readonly git: Git,
		private readonly cache: Cache,
		private readonly provider: CliGitProviderInternal,
	) {}

	@debug()
	async getChangedFilesCount(
		repoPath: string,
		to?: string,
		from?: string,
		options?: { uris?: (string | Uri)[] },
		_cancellation?: AbortSignal,
	): Promise<GitDiffShortStat | undefined> {
		const scope = getScopedLogger();

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
				...(options?.uris?.map(p => this.provider.getRelativePath(p, repoPath)) ?? []),
			);
			if (!result.stdout) return undefined;

			return parseGitDiffShortStat(result.stdout);
		} catch (ex) {
			const msg: string = ex?.toString() ?? '';
			if (GitErrors.noMergeBase.test(msg)) {
				return undefined;
			}

			scope?.error(ex);
			throw ex;
		}
	}

	@debug()
	async getDiff(
		repoPath: string,
		to: string,
		from?: string,
		options?: {
			context?: number;
			index?: DisposableTemporaryGitIndex;
			notation?: GitRevisionRangeNotation;
			uris?: (string | Uri)[];
		},
		_cancellation?: AbortSignal,
	): Promise<GitDiff | undefined> {
		const scope = getScopedLogger();
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
			paths = new Set<string>(options.uris.map(p => this.provider.getRelativePath(p, repoPath)));
			args.push('--', ...paths);
		}

		let result;
		try {
			result = await this.git.exec(
				{ cwd: repoPath, configs: gitConfigsDiff, errors: 'throw', env: options?.index?.env },
				'diff',
				...args,
				args.includes('--') ? undefined : '--',
			);
		} catch (ex) {
			scope?.error(ex);
			return undefined;
		}

		const diff: GitDiff = { contents: result.stdout, from: from, to: to, notation: options?.notation };
		return diff;
	}

	@debug({ args: repoPath => ({ repoPath: repoPath }) })
	async getDiffFiles(
		repoPath: string,
		contents: string,
		_cancellation?: AbortSignal,
	): Promise<GitDiffFiles | undefined> {
		const result = await this.git.exec(
			{ cwd: repoPath, configs: gitConfigsLog, stdin: contents },
			'apply',
			'--numstat',
			'--summary',
			'-z',
			'-',
		);
		if (!result.stdout) return undefined;

		const files = parseGitApplyFiles(result.stdout, repoPath);
		return {
			files: files,
		};
	}

	@debug()
	async getDiffStatus(
		repoPath: string,
		ref1OrRange: string | GitRevisionRange,
		ref2?: string,
		options?: { filters?: GitDiffFilter[]; path?: string; renameLimit?: number; similarityThreshold?: number },
	): Promise<GitFile[] | undefined> {
		try {
			const similarityThreshold = options?.similarityThreshold;
			const configs =
				options?.renameLimit != null
					? [...gitConfigsDiff, '-c', `diff.renameLimit=${options.renameLimit}`]
					: gitConfigsDiff;
			const result = await this.git.exec(
				{ cwd: repoPath, configs: configs },
				'diff',
				'--numstat',
				'--summary',
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

			return parseGitDiffNumStatFiles(result.stdout, repoPath);
		} catch (_ex) {
			return undefined;
		}
	}

	@debug()
	async getDiffTool(repoPath?: string): Promise<string | undefined> {
		return (
			(await this.provider.config.getConfig?.(repoPath, 'diff.guitool', { runGitLocally: true })) ??
			this.provider.config.getConfig?.(repoPath, 'diff.tool', { runGitLocally: true })
		);
	}

	@debug()
	async getNextComparisonUris(
		repoPath: string,
		pathOrUri: string | Uri,
		rev: string | undefined,
		skip: number = 0,
		options?: { ordering?: 'date' | 'author-date' | 'topo' | null },
		_cancellation?: AbortSignal,
	): Promise<NextComparisonUrisResult | undefined> {
		// If we have no revision there is no next commit
		if (!rev) return undefined;

		const scope = getScopedLogger();

		let relativePath = this.provider.getRelativePath(pathOrUri, repoPath);

		if (isUncommittedStaged(rev)) {
			return {
				current: createRevisionUri(this.provider, repoPath, relativePath, rev),
				next: createRevisionUri(this.provider, repoPath, relativePath, undefined),
			};
		} else if (isUncommitted(rev)) {
			return undefined;
		}

		try {
			const parser = getShaAndFileSummaryLogParser();
			const args = ['log', ...parser.arguments];

			const ordering = options?.ordering ?? this.context.config?.commits.ordering;
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
				const status = await this.provider.status?.getStatusForFile?.(repoPath, relativePath);
				if (status != null) {
					if (status.indexStatus != null) {
						currentSha = uncommittedStaged;
						currentPath = status.originalPath ?? status.path;
						nextSha = '';
						nextPath = status.path;
					} else {
						return undefined;
					}
				} else {
					return undefined;
				}
			}

			if (nextSha == null || nextPath == null) {
				const status = await this.provider.status?.getStatusForFile?.(repoPath, relativePath);
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
				current: createRevisionUri(this.provider, repoPath, currentPath, currentSha || undefined),
				next: createRevisionUri(
					this.provider,
					repoPath,
					nextPath ?? currentPath,
					(nextSha ?? deletedOrMissing) || undefined,
				),
			};
		} catch (ex) {
			scope?.error(ex);
			throw ex;
		}
	}

	@debug()
	async getPreviousComparisonUris(
		repoPath: string,
		pathOrUri: string | Uri,
		rev: string | undefined,
		skip: number = 0,
		unsaved?: boolean,
		options?: { ordering?: 'date' | 'author-date' | 'topo' | null },
		_cancellation?: AbortSignal,
	): Promise<PreviousComparisonUrisResult | undefined> {
		if (rev === deletedOrMissing) return undefined;

		const scope = getScopedLogger();

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

		let relativePath = this.provider.getRelativePath(pathOrUri, repoPath);
		let skipPrev = 0;

		let revs: [string, string][] = [];
		if (!rev) {
			revs = [['', relativePath]];

			const status = await this.provider.status?.getStatusForFile?.(repoPath, pathOrUri);
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
			const status = await this.provider.status?.getStatusForFile?.(repoPath, pathOrUri);
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
				}

				if (rev !== 'HEAD' && skip === 0) {
					return {
						current: createRevisionUri(this.provider, repoPath, currentPath, currentSha),
						previous: createRevisionUri(this.provider, repoPath, relativePath, rev),
					};
				}
			}
		}

		try {
			const parser = getShaAndFileSummaryLogParser();
			const args = ['log', ...parser.arguments, `-n${skip + 2}`]; // Don't use --skip as it doesn't work with --follow

			const ordering = options?.ordering ?? this.context.config?.commits.ordering;
			if (ordering) {
				args.push(`--${ordering}-order`);
			}

			args.push('--follow', rev!, '--', relativePath);

			const result = await this.git.exec(
				{
					cwd: repoPath,
					configs: gitConfigsLog,
					caching: { cache: this.cache.gitResults, options: { accessTTL: 5 * 60 * 1000 } },
				},
				...args,
			);

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
				current: createRevisionUri(this.provider, repoPath, currentPath, currentSha || undefined),
				previous: createRevisionUri(
					this.provider,
					repoPath,
					previousPath ?? currentPath,
					previousSha ?? deletedOrMissing,
				),
			};
		} catch (ex) {
			scope?.error(ex);
			throw ex;
		}
	}

	@debug()
	async getPreviousComparisonUrisForRange(
		repoPath: string,
		pathOrUri: string | Uri,
		rev: string | undefined,
		range: DiffRange,
		options?: { ordering?: 'date' | 'author-date' | 'topo' | null; skipFirstRev?: boolean },
		_cancellation?: AbortSignal,
	): Promise<PreviousRangeComparisonUrisResult | undefined> {
		if (rev === deletedOrMissing) return undefined;

		const scope = getScopedLogger();

		if (rev === uncommitted) {
			rev = undefined;
		}

		let currentSha;
		let currentPath;
		let relativePath = this.provider.getRelativePath(pathOrUri, repoPath);
		const skipFirstRev = options?.skipFirstRev ?? true;

		// If we are at the working tree (i.e. no ref), we need to dig deeper to figure out where to go
		if (!rev) {
			const status = await this.provider.status?.getStatusForFile?.(repoPath, pathOrUri);
			if (status != null) {
				if (status.indexStatus != null) {
					if (status.workingTreeStatus != null && !skipFirstRev) {
						return {
							current: createRevisionUri(this.provider, repoPath, relativePath, undefined),
							previous: createRevisionUri(this.provider, repoPath, relativePath, uncommittedStaged),
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

			const ordering = options?.ordering ?? this.context.config?.commits.ordering;
			if (ordering) {
				args.push(`--${ordering}-order`);
			}

			if (rev && !isUncommittedStaged(rev)) {
				args.push(rev);
			}

			args.push(`-L${range.startLine},${range.endLine}:${relativePath}`);

			let result: GitResult;
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
					startCharacter: range.startCharacter,
					endLine: Math.min(range.endLine, line),
					endCharacter: range.endCharacter,
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
					currentRange =
						file?.range != null ? { ...file.range, startCharacter: 1, endCharacter: 1 } : undefined;
				} else if (previousSha == null) {
					if (commit.sha === rev) continue;

					previousSha = commit.sha;
					previousPath = file?.path ?? relativePath;

					break;
				}
			}

			if (currentSha == null || currentPath == null) return undefined;

			// If we have no previous SHA but have a real current SHA, resolve the parent commit.
			// This handles the case where a line is newly added — the line has no prior history,
			// but the file likely existed at the parent commit
			if (previousSha == null && currentSha) {
				previousSha =
					(await this.provider.refs.validateReference(repoPath, `${currentSha}^`)) ?? deletedOrMissing;
			}

			return {
				current: createRevisionUri(this.provider, repoPath, currentPath, currentSha || undefined),
				previous: createRevisionUri(
					this.provider,
					repoPath,
					previousPath ?? currentPath,
					previousSha ?? deletedOrMissing,
				),
				range: currentRange ?? range,
			};
		} catch (ex) {
			scope?.error(ex);
			throw ex;
		}
	}

	/** Returns raw diff output for a file between two revisions. */
	async diff(
		repoPath: string,
		fileName: string,
		ref1?: string,
		ref2?: string,
		options?: {
			encoding?: string;
			filters?: GitDiffFilter[];
			linesOfContext?: number;
			renames?: boolean;
			similarityThreshold?: number | null;
		},
	): Promise<GitResult> {
		const params = ['diff', '--no-ext-diff', '--minimal'];

		if (options?.linesOfContext != null) {
			params.push(`-U${options.linesOfContext}`);
		}

		if (options?.renames) {
			params.push(`-M${options.similarityThreshold == null ? '' : `${options.similarityThreshold}%`}`);
		}

		if (options?.filters != null && options.filters.length !== 0) {
			params.push(`--diff-filter=${options.filters.join('')}`);
		}

		if (ref1) {
			// <sha>^3 signals an untracked file in a stash and if we are trying to find its parent, use the root sha
			if (ref1.endsWith('^3^')) {
				ref1 = rootSha;
			}
			params.push(isUncommittedStaged(ref1) ? '--staged' : ref1);
		}
		if (ref2) {
			params.push(isUncommittedStaged(ref2) ? '--staged' : ref2);
		}

		try {
			return await this.git.exec(
				{ cwd: repoPath, configs: gitConfigsDiff, encoding: options?.encoding },
				...params,
				'--',
				fileName,
			);
		} catch (ex) {
			const match = GitErrors.badRevision.exec(ex.message);
			if (match !== null) {
				const [, ref] = match;

				// If the bad ref is trying to find a parent ref, assume we hit to the last commit, so try again using the root sha
				if (ref === ref1 && ref?.endsWith('^')) {
					return this.diff(repoPath, fileName, rootSha, ref2, options);
				}
			}

			throw ex;
		}
	}

	/** Returns raw diff output comparing a file's revision with given contents via stdin. */
	async diffContents(
		repoPath: string,
		fileName: string,
		ref: string,
		contents: string,
		options?: { encoding?: string; filters?: GitDiffFilter[]; similarityThreshold?: number | null },
	): Promise<string> {
		const params = [
			'diff',
			`-M${options?.similarityThreshold == null ? '' : `${options.similarityThreshold}%`}`,
			'--no-ext-diff',
			'-U0',
			'--minimal',
		];

		if (options?.filters != null && options.filters.length !== 0) {
			params.push(`--diff-filter=${options.filters.join('')}`);
		}

		params.push('--no-index');

		try {
			const result = await this.git.exec(
				{
					cwd: repoPath,
					configs: gitConfigsDiff,
					encoding: options?.encoding,
					stdin: contents,
				},
				...params,
				'--',
				fileName,
				// Pipe the contents to stdin
				'-',
			);
			return result.stdout;
		} catch (ex) {
			if (ex instanceof GitError && ex.stdout) {
				return ex.stdout;
			}

			const match = GitErrors.badRevision.exec(ex.message);
			if (match !== null) {
				const [, matchedRef] = match;

				// If the bad ref is trying to find a parent ref, assume we hit to the last commit, so try again using the root sha
				if (matchedRef === ref && matchedRef?.endsWith('^')) {
					return this.diffContents(repoPath, fileName, rootSha, contents, options);
				}
			}

			throw ex;
		}
	}

	/** Returns parsed diff hunks for a file between two revisions. */
	@debug()
	getDiffForFile(
		repoPath: string,
		fileName: string,
		ref1: string | undefined,
		ref2?: string,
		options?: { encoding?: string },
	): Promise<ParsedGitDiffHunks | undefined> {
		const cacheKey = `${normalizePath(fileName)}:${ref1 ?? ''}:${ref2 ?? ''}`;
		return this.cache.diff.getOrCreate(
			repoPath,
			cacheKey,
			() => this.getDiffForFileCore(repoPath, fileName, ref1, ref2, options),
			{ errorTTL: 1000 * 60 },
		);
	}

	private async getDiffForFileCore(
		repoPath: string,
		fileName: string,
		ref1: string | undefined,
		ref2: string | undefined,
		options: { encoding?: string } | undefined,
	): Promise<ParsedGitDiffHunks | undefined> {
		// Include renames (R) and copies (C) so content diffs on renamed files still surface;
		// --diff-filter runs after `-M` rename detection, so 'M' alone would drop valid rename diffs.
		const result = await this.diff(repoPath, fileName, ref1, ref2, {
			encoding: options?.encoding,
			filters: ['M', 'R', 'C'],
			linesOfContext: 0,
			renames: true,
			similarityThreshold: this.context.config?.commits.similarityThreshold,
		});
		return parseGitFileDiff(result.stdout);
	}

	/** Returns parsed diff hunks comparing a file's revision with given contents via stdin. */
	@debug()
	getDiffForFileContents(
		repoPath: string,
		fileName: string,
		ref: string,
		contents: string,
		options?: { encoding?: string },
	): Promise<ParsedGitDiffHunks | undefined> {
		const cacheKey = `${normalizePath(fileName)}:${ref}:~${fnv1aHash(contents)}`;
		return this.cache.diff.getOrCreate(
			repoPath,
			cacheKey,
			() => this.getDiffForFileContentsCore(repoPath, fileName, ref, contents, options),
			{ errorTTL: 1000 * 60 },
		);
	}

	private async getDiffForFileContentsCore(
		repoPath: string,
		fileName: string,
		ref: string,
		contents: string,
		options: { encoding?: string } | undefined,
	): Promise<ParsedGitDiffHunks | undefined> {
		const data = await this.diffContents(repoPath, fileName, ref, contents, {
			encoding: options?.encoding,
			filters: ['M', 'R', 'C'],
			similarityThreshold: this.context.config?.commits.similarityThreshold,
		});
		return parseGitFileDiff(data);
	}

	/** Finds the most recent commit where the given path was copied, renamed, or deleted. */
	@debug()
	async findPathStatusChanged(
		repoPath: string,
		pathspec: string,
		rev: string | undefined,
		options?: { filters?: GitDiffFilter[]; ordering?: 'date' | 'author-date' | 'topo' | null },
	): Promise<{ sha: string; file: LogParsedFile | undefined } | undefined> {
		return findPathStatusChanged(this.git, repoPath, pathspec, rev, options);
	}

	@debug()
	async openDiffTool(
		repoPath: string,
		pathOrUri: string | Uri,
		options?: { ref1?: string; ref2?: string; staged?: boolean; tool?: string },
	): Promise<void> {
		const scope = getScopedLogger();
		const [relativePath, root] = splitPath(toFsPath(pathOrUri), repoPath);

		try {
			let tool = options?.tool;
			if (!tool) {
				const scope = getScopedLogger();

				tool = await this.getDiffTool(root);
				if (tool == null) throw new Error('No diff tool found');

				scope?.debug(`Using tool=${tool}`);
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
				throw new Error(
					'Unable to open changes because the specified diff tool cannot be found or no Git diff tool is configured',
					{ cause: ex },
				);
			}

			scope?.error(ex);
			throw ex;
		}
	}

	@debug()
	async openDirectoryCompare(repoPath: string, ref1: string, ref2?: string, tool?: string): Promise<void> {
		const scope = getScopedLogger();

		try {
			if (!tool) {
				const scope = getScopedLogger();

				tool = await this.getDiffTool(repoPath);
				if (tool == null) throw new Error('No diff tool found');

				scope?.debug(`Using tool=${tool}`);
			}

			await this.git.exec({ cwd: repoPath }, 'difftool', '--dir-diff', `--tool=${tool}`, ref1, ref2);
		} catch (ex) {
			const msg: string = ex?.toString() ?? '';
			if (msg === 'No diff tool found' || /Unknown .+? tool/.test(msg)) {
				throw new Error(
					'Unable to open directory compare because the specified diff tool cannot be found or no Git diff tool is configured',
					{ cause: ex },
				);
			}

			scope?.error(ex);
			throw ex;
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

function createRevisionUri(
	provider: CliGitProviderInternal,
	repoPath: string,
	relativePath: string,
	sha: string | undefined,
): RevisionUri {
	return {
		uri: sha
			? fromUri({
					scheme: 'gitlens',
					authority: encodeGitLensRevisionUriAuthority({ ref: sha, repoPath: repoPath }),
					path: provider.getAbsoluteUri(relativePath, repoPath).path,
				})
			: provider.getAbsoluteUri(relativePath, repoPath),
		path: relativePath,
		sha: sha,
		repoPath: repoPath,
	};
}

export async function findPathStatusChanged(
	git: Git,
	repoPath: string,
	pathspec: string,
	rev: string | undefined,
	options?: { filters?: GitDiffFilter[]; ordering?: 'date' | 'author-date' | 'topo' | null },
): Promise<{ sha: string; file: LogParsedFile | undefined } | undefined> {
	const parser = getShaAndFileSummaryLogParser();

	const ordering = options?.ordering;

	const result = await git.exec(
		{ cwd: repoPath, configs: gitConfigsLog },
		'log',
		...parser.arguments,
		ordering ? `--${ordering}-order` : undefined,
		'--no-walk',
		`--diff-filter=${options?.filters?.length ? options.filters.join('') : 'RCD'}`,
		rev,
		// Note: --no-walk constrains to the exact commit (no ancestor search). Pathspec is omitted
		// because git suppresses rename detection with pathspecs (shows D instead of R, losing the destination path).
		'--',
	);

	const commit = first(parser.parse(result.stdout));
	if (commit == null) return undefined;

	const file = commit.files.find(f => f.path === pathspec || f.originalPath === pathspec);
	return { sha: commit.sha, file: file };
}

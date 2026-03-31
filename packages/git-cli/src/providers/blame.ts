import { stat } from 'fs/promises';
import type { Cache } from '@gitlens/git/cache.js';
import { BlameIgnoreRevsFileBadRevisionError, BlameIgnoreRevsFileError } from '@gitlens/git/errors.js';
import type {
	GitBlame,
	GitBlameAuthor,
	GitBlameLine,
	GitBlameProgressEvent,
	ProgressiveGitBlame,
	ProgressiveGitBlameWriter,
} from '@gitlens/git/models/blame.js';
import type { GitCommitLine } from '@gitlens/git/models/commit.js';
import { GitCommit, GitCommitIdentity } from '@gitlens/git/models/commit.js';
import { GitFileChange } from '@gitlens/git/models/fileChange.js';
import { GitFileIndexStatus } from '@gitlens/git/models/fileStatus.js';
import { uncommitted } from '@gitlens/git/models/revision.js';
import type { GitUser } from '@gitlens/git/models/user.js';
import type { GitBlameOptions, GitBlameSubProvider } from '@gitlens/git/providers/blame.js';
import type { DiffRange } from '@gitlens/git/providers/types.js';
import { getBlameRange } from '@gitlens/git/utils/blame.utils.js';
import { isUncommittedStaged } from '@gitlens/git/utils/revision.utils.js';
import { isUserMatch } from '@gitlens/git/utils/user.utils.js';
import { Emitter } from '@gitlens/utils/event.js';
import { fnv1aHash } from '@gitlens/utils/hash.js';
import { first } from '@gitlens/utils/iterable.js';
import { isAbsolute, joinPaths, normalizePath, splitPath } from '@gitlens/utils/path.js';
import { defer, isPromise } from '@gitlens/utils/promise.js';
import type { Uri } from '@gitlens/utils/uri.js';
import { fileUri, joinUriPath } from '@gitlens/utils/uri.js';
import type { CliGitProviderInternal } from '../cliGitProvider.js';
import { fsExists } from '../exec/exec.js';
import type { Git } from '../exec/git.js';
import { GitErrors } from '../exec/git.js';
import type { BlameEntry } from '../parsers/blameParser.js';
import { parseGitBlame, parseGitBlameAsync } from '../parsers/blameParser.js';

const ignoreRevsFileArgRegex = /^--ignore-revs-file\s*=?\s*(.*)$/;

/** Minimum interval between progressive blame updates (ms) */
const progressiveBatchIntervalMs = 750;

type BlameArgOptions = ({ ref: string | undefined; contents?: never } | { contents: string; ref?: never }) & {
	args?: string[] | null;
	ignoreWhitespace?: boolean;
	startLine?: number;
	endLine?: number;
};

export class BlameGitSubProvider implements GitBlameSubProvider {
	constructor(
		private readonly git: Git,
		private readonly cache: Cache,
		private readonly provider: CliGitProviderInternal,
	) {}

	async getBlame(
		repoPath: string,
		path: string,
		rev?: string,
		contents?: string,
		options?: GitBlameOptions,
	): Promise<GitBlame | undefined> {
		const progressive = await this.getProgressiveBlame(repoPath, path, rev, contents, options);
		return progressive?.completed;
	}

	async getProgressiveBlame(
		repoPath: string,
		path: string,
		rev?: string,
		contents?: string,
		options?: GitBlameOptions,
	): Promise<ProgressiveGitBlame | undefined> {
		const cacheKey = `${normalizePath(path)}:${rev ?? `~${fnv1aHash(contents ?? '')}`}`;
		return this.cache.blame.getOrCreate(
			repoPath,
			cacheKey,
			() => this.getProgressiveBlameCore(repoPath, path, cacheKey, rev, contents, options),
			{
				onError: ex => {
					if (ex instanceof BlameIgnoreRevsFileError || ex instanceof BlameIgnoreRevsFileBadRevisionError) {
						// Non-retriable — cache as undefined for 5 minutes
						return { value: undefined, createTTL: 1000 * 60 * 5 };
					}
					// Other errors — cache as undefined for 1 minute to avoid hammering git
					return { value: undefined, createTTL: 1000 * 60 };
				},
			},
		);
	}

	private async getProgressiveBlameCore(
		repoPath: string,
		path: string,
		cacheKey: string,
		rev?: string,
		contents?: string,
		options?: GitBlameOptions,
	): Promise<ProgressiveGitBlame> {
		const [user, mtime] = await Promise.all([
			this.provider.config.getCurrentUser(repoPath),
			this.getFileMtime(repoPath, path),
		]);

		const { progressive, writer } = createProgressiveGitBlame(repoPath);
		const blameOptions: BlameArgOptions = {
			...(contents != null ? { contents: contents } : { ref: rev }),
			args: options?.args,
			ignoreWhitespace: options?.ignoreWhitespace,
		};

		// Start streaming in the background
		void this.streamBlame(writer, repoPath, path, blameOptions, user, mtime);

		// If streaming fails, progressive.completed rejects. Evict the cache entry
		// so the next call retries instead of serving the failed GitBlameProgressive.
		void progressive.completed.catch(() => {
			this.cache.blame.delete(repoPath, cacheKey);
		});

		return progressive;
	}

	private async streamBlame(
		writer: ProgressiveGitBlameWriter,
		repoPath: string,
		path: string,
		options: BlameArgOptions,
		currentUser: GitUser | undefined,
		modifiedTime: number | undefined,
	): Promise<void> {
		try {
			const { root, file, params, stdin } = await this.buildBlameArgs(repoPath, path, options);
			const stream = this.git.stream({ cwd: root, stdin: stdin }, ...params, '--', file);

			const normalizedRepoPath = normalizePath(repoPath);
			const repoUri = fileUri(normalizedRepoPath);

			const authors = new Map<string, GitBlameAuthor>();
			const commits = new Map<string, GitCommit>();
			const lines: GitCommitLine[] = [];

			let cachedPath: string | undefined;
			let cachedPathUri: Uri | undefined;
			const getPathUri = (entryPath: string): Uri => {
				if (entryPath !== cachedPath) {
					cachedPath = entryPath;
					cachedPathUri = joinUriPath(repoUri, normalizePath(entryPath));
				}
				return cachedPathUri!;
			};

			let cachedPreviousPath: string | undefined;
			let cachedPreviousPathUri: Uri | undefined;
			const getPreviousPathUri = (prevPath: string): Uri => {
				if (prevPath !== cachedPreviousPath) {
					cachedPreviousPath = prevPath;
					cachedPreviousPathUri = joinUriPath(repoUri, normalizePath(prevPath));
				}
				return cachedPreviousPathUri!;
			};

			let lastUpdateTime = Date.now();
			let batchNewLines: number[] = [];

			for await (const entry of parseGitBlameAsync(stream)) {
				applyBlameEntry(
					entry,
					repoPath,
					authors,
					commits,
					lines,
					currentUser,
					modifiedTime,
					getPathUri,
					getPreviousPathUri,
				);

				// Track which line indices were resolved in this entry
				for (let i = 0; i < entry.lineCount; i++) {
					batchNewLines.push(entry.line + i - 1); // 1-based → 0-based
				}

				const now = Date.now();
				if (now - lastUpdateTime >= progressiveBatchIntervalMs) {
					writer.update(
						{ repoPath: repoPath, authors: authors, commits: commits, lines: lines },
						batchNewLines,
					);
					batchNewLines = [];
					lastUpdateTime = now;
				}
			}

			// Flush any remaining lines from the final sub-interval batch
			if (batchNewLines.length > 0) {
				writer.update({ repoPath: repoPath, authors: authors, commits: commits, lines: lines }, batchNewLines);
			}

			const sortedAuthors = new Map([...authors.entries()].sort((a, b) => b[1].lineCount - a[1].lineCount));

			writer.complete({ repoPath: repoPath, authors: sortedAuthors, commits: commits, lines: lines });
		} catch (ex) {
			if (ex instanceof Error) {
				let match = GitErrors.invalidObjectNameList.exec(ex.message);
				if (match != null) {
					writer.fail(new BlameIgnoreRevsFileError(match[1], ex));
					return;
				}

				match = GitErrors.invalidObjectName.exec(ex.message);
				if (match != null) {
					writer.fail(new BlameIgnoreRevsFileBadRevisionError(match[1], ex));
					return;
				}
			}

			writer.fail(ex);
		}
	}

	async getBlameForLine(
		repoPath: string,
		path: string,
		editorLine: number,
		rev?: string,
		contents?: string,
		options?: { forceSingleLine?: boolean } & GitBlameOptions,
	): Promise<GitBlameLine | undefined> {
		if (!options?.forceSingleLine) {
			const blame = await this.getBlame(repoPath, path, rev, contents, options);
			if (blame == null) return undefined;

			let blameLine = blame.lines[editorLine];
			if (blameLine == null) {
				if (blame.lines.length !== editorLine) return undefined;
				blameLine = blame.lines[editorLine - 1];
			}

			const commit = blame.commits.get(blameLine.sha);
			if (commit == null) return undefined;

			const author = blame.authors.get(commit.author.name);
			return {
				author: author != null ? { ...author, lineCount: commit.lines.length } : undefined,
				commit: commit,
				line: blameLine,
			};
		}

		const lineToBlame = editorLine + 1;
		const [result, user, mtime] = await Promise.all([
			this.blameExecCore(repoPath, path, {
				...(contents != null ? { contents: contents } : { ref: rev }),
				args: options?.args,
				ignoreWhitespace: options?.ignoreWhitespace,
				startLine: lineToBlame,
				endLine: lineToBlame,
			}),
			this.provider.config.getCurrentUser(repoPath),
			this.getFileMtime(repoPath, path),
		]);
		const blame = parseGitBlame(repoPath, result?.stdout, user, mtime);
		if (blame == null) return undefined;

		return {
			author: first(blame.authors.values()),
			commit: first(blame.commits.values())!,
			line: blame.lines[editorLine],
		};
	}

	async getBlameForRange(
		repoPath: string,
		path: string,
		range: DiffRange,
		rev?: string,
		contents?: string,
		options?: GitBlameOptions,
	): Promise<GitBlame | undefined> {
		const blame = await this.getBlame(repoPath, path, rev, contents, options);
		if (blame == null) return undefined;

		return getBlameRange(blame, range);
	}

	private async getFileMtime(repoPath: string, path: string): Promise<number | undefined> {
		const filePath = isAbsolute(path) ? path : joinPaths(repoPath, path);
		try {
			return Math.floor((await stat(filePath)).mtimeMs);
		} catch {
			return undefined;
		}
	}

	/** Builds the git blame command arguments. Shared between buffered and streaming paths. */
	private async buildBlameArgs(
		repoPath: string | undefined,
		fileName: string,
		options?: BlameArgOptions,
	): Promise<{ root: string; file: string; params: string[]; stdin: string | undefined }> {
		const [file, root] = splitPath(fileName, repoPath, true);

		const params = ['blame', '--root', '--incremental'];

		if (options?.ignoreWhitespace) {
			params.push('-w');
		}
		if (options?.startLine != null && options.endLine != null) {
			params.push(`-L ${options.startLine},${options.endLine}`);
		}
		if (options?.args != null) {
			// See if the args contain `--ignore-revs-file <file>` or `--ignore-revs-file=<file>` —
			// if so, split it into two separate args to account for user error
			const argIndex = options.args.findIndex(
				arg => arg !== '--ignore-revs-file' && arg.startsWith('--ignore-revs-file'),
			);
			if (argIndex !== -1) {
				const match = ignoreRevsFileArgRegex.exec(options.args[argIndex]);
				if (match != null) {
					options.args.splice(argIndex, 1, '--ignore-revs-file', match[1]);
				}
			}

			params.push(...options.args);
		}

		// Ensure the version of Git supports the --ignore-revs-file flag, otherwise the blame will fail
		const supportsIgnoreRevsFileResult = this.git.supports('git:ignoreRevsFile');
		let supportsIgnoreRevsFile = isPromise(supportsIgnoreRevsFileResult)
			? await supportsIgnoreRevsFileResult
			: supportsIgnoreRevsFileResult;

		const ignoreRevsIndex = params.indexOf('--ignore-revs-file');

		if (supportsIgnoreRevsFile) {
			let ignoreRevsFile;
			if (ignoreRevsIndex !== -1) {
				ignoreRevsFile = params[ignoreRevsIndex + 1];
				if (!isAbsolute(ignoreRevsFile)) {
					ignoreRevsFile = joinPaths(root, ignoreRevsFile);
				}
			} else {
				ignoreRevsFile = joinPaths(root, '.git-blame-ignore-revs');
			}

			// Cache keyed by repo path (not file path) so per-repo cache resets work correctly.
			// The ignoreRevsFile path is captured in the factory closure for the actual check.
			supportsIgnoreRevsFile = await this.cache.ignoreRevsFile.getOrCreate(root, async () => {
				// Ensure the specified --ignore-revs-file exists, otherwise the blame will fail
				try {
					return await fsExists(ignoreRevsFile);
				} catch {
					return false;
				}
			});
		}

		if (!supportsIgnoreRevsFile && ignoreRevsIndex !== -1) {
			params.splice(ignoreRevsIndex, 2);
		} else if (supportsIgnoreRevsFile && ignoreRevsIndex === -1) {
			params.push('--ignore-revs-file', '.git-blame-ignore-revs');
		}

		let stdin: string | undefined;
		if (options?.contents != null) {
			// Pipe the blame contents to stdin
			params.push('--contents', '-');
			stdin = options.contents;
		} else if (options?.ref) {
			if (isUncommittedStaged(options.ref)) {
				// Pipe the blame contents to stdin
				params.push('--contents', '-');
				// Get the file contents for the staged version using `:`
				stdin = await this.provider.revision.getRevisionContentText(repoPath, fileName, ':');
			} else {
				params.push(options.ref);
			}
		}

		return { root: root, file: file, params: params, stdin: stdin };
	}

	/** Buffered git blame execution. Used for single-line blame where streaming adds no benefit. */
	private async blameExecCore(
		repoPath: string | undefined,
		fileName: string,
		options?: BlameArgOptions,
	): Promise<{ stdout: string }> {
		const { root, file, params, stdin } = await this.buildBlameArgs(repoPath, fileName, options);

		try {
			return await this.git.exec({ cwd: root, stdin: stdin }, ...params, '--', file);
		} catch (ex) {
			// Since `-c blame.ignoreRevsFile=` doesn't work (despite what the docs suggest),
			// detect the error and throw a more helpful one
			let match = GitErrors.invalidObjectNameList.exec(ex.message);
			if (match != null) {
				throw new BlameIgnoreRevsFileError(match[1], ex);
			}

			match = GitErrors.invalidObjectName.exec(ex.message);
			if (match != null) {
				throw new BlameIgnoreRevsFileBadRevisionError(match[1], ex);
			}

			throw ex;
		}
	}
}

/** Applies a parsed BlameEntry to the growing blame state (commits, authors, lines). */
function applyBlameEntry(
	entry: BlameEntry,
	repoPath: string,
	authors: Map<string, GitBlameAuthor>,
	commits: Map<string, GitCommit>,
	lines: GitCommitLine[],
	currentUser: GitUser | undefined,
	modifiedTime: number | undefined,
	getPathUri: (path: string) => Uri,
	getPreviousPathUri: (path: string) => Uri,
): void {
	const entryPath = entry.path ?? '';
	const isUncommittedEntry = entry.sha === uncommitted;

	let commit = commits.get(entry.sha);
	if (commit == null) {
		let authorName: string;
		let authorEmail: string | undefined;
		let authorTime: number;
		let authorCurrent: boolean | undefined;
		let committerName: string;
		let committerEmail: string | undefined;
		let committerTime: number;
		let committerCurrent: boolean | undefined;

		if (isUncommittedEntry) {
			authorName = currentUser?.name ?? '';
			authorEmail = currentUser?.email;
			authorTime = modifiedTime ?? 0;
			authorCurrent = true;
			committerName = authorName;
			committerEmail = authorEmail;
			committerTime = authorTime;
			committerCurrent = true;
		} else {
			authorName = entry.author ?? '';
			authorEmail = entry.authorEmail;
			authorTime = entry.authorTime ?? 0;
			committerName = entry.committer ?? '';
			committerEmail = entry.committerEmail;
			committerTime = entry.committerTime ?? 0;

			if (isUserMatch(currentUser, authorName, authorEmail)) {
				authorCurrent = true;
			}
			if (isUserMatch(currentUser, committerName, committerEmail)) {
				committerCurrent = true;
			}
		}

		let author = authors.get(authorName);
		if (author == null) {
			author = { name: authorName, lineCount: 0, current: authorCurrent };
			authors.set(authorName, author);
		}

		const pathUri = getPathUri(entryPath);

		let previousPath: string | undefined;
		let previousPathUri: Uri | undefined;
		if (entry.previousPath != null && entry.previousPath !== entryPath) {
			previousPath = entry.previousPath;
			previousPathUri = getPreviousPathUri(previousPath);
		}

		const file = new GitFileChange(
			repoPath,
			entryPath,
			GitFileIndexStatus.Modified,
			pathUri,
			previousPath,
			previousPathUri,
			entry.previousSha,
		);

		commit = new GitCommit(
			repoPath,
			entry.sha,
			new GitCommitIdentity(authorName, authorEmail, new Date(authorTime), undefined, authorCurrent),
			new GitCommitIdentity(committerName, committerEmail, new Date(committerTime), undefined, committerCurrent),
			entry.summary ?? '',
			[],
			undefined,
			{ files: undefined, filtered: { files: [file], pathspec: entryPath } },
			undefined,
			[],
		);

		commits.set(entry.sha, commit);
	}

	const authorName = commit.author.name;
	if (authorName) {
		const author = authors.get(authorName);
		if (author != null) {
			author.lineCount += entry.lineCount;
		}
	}

	const previousSha = entry.previousSha ?? commit.file?.previousSha;
	for (let i = 0, count = entry.lineCount; i < count; i++) {
		const l: GitCommitLine = {
			sha: entry.sha,
			previousSha: previousSha,
			originalLine: entry.originalLine + i,
			line: entry.line + i,
		};

		commit.lines.push(l);
		lines[l.line - 1] = l;
	}
}

/**
 * Creates a progressive blame with a read-only consumer interface and a producer writer.
 * The writer is used by `streamBlame` to push data; the progressive is returned to consumers.
 */
function createProgressiveGitBlame(repoPath: string): {
	progressive: ProgressiveGitBlame;
	writer: ProgressiveGitBlameWriter;
} {
	let current: GitBlame = { repoPath: repoPath, authors: new Map(), commits: new Map(), lines: [] };
	let isComplete = false;
	const allResolvedIndices: number[] = [];

	const completed = defer<GitBlame>();
	// Prevent unhandled rejection if fail() is called before anyone awaits completed
	completed.promise.catch(() => {});

	const onDidProgress = new Emitter<GitBlameProgressEvent>();

	const progressive: ProgressiveGitBlame = {
		get current() {
			return current;
		},
		get isComplete() {
			return isComplete;
		},
		completed: completed.promise,

		onDidProgress: (listener, thisArgs?, disposables?) => {
			const disposable = onDidProgress.event(listener, thisArgs, disposables);
			// Replay all resolved indices so late-registering listeners catch up on ALL missed updates
			if (allResolvedIndices.length > 0 && !isComplete) {
				listener.call(thisArgs, { blame: current, complete: false, newLineIndices: allResolvedIndices });
			}
			return disposable;
		},
	};

	const writer: ProgressiveGitBlameWriter = {
		update: function (blame: GitBlame, newLineIndices: number[]): void {
			current = blame;
			for (const idx of newLineIndices) {
				allResolvedIndices.push(idx);
			}
			onDidProgress.fire({ blame: blame, complete: false, newLineIndices: newLineIndices });
		},

		complete: function (blame: GitBlame): void {
			current = blame;
			isComplete = true;
			onDidProgress.fire({ blame: blame, complete: true, newLineIndices: [] });
			onDidProgress.dispose();
			completed.fulfill(blame);
		},

		fail: function (reason: unknown): void {
			isComplete = true;
			onDidProgress.dispose();
			completed.cancel(reason instanceof Error ? reason : new Error(String(reason)));
		},
	};

	return { progressive: progressive, writer: writer };
}

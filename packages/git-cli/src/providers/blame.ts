import { stat } from 'fs/promises';
import type { Cache } from '@gitlens/git/cache.js';
import { BlameIgnoreRevsFileBadRevisionError, BlameIgnoreRevsFileError } from '@gitlens/git/errors.js';
import type { GitBlame, GitBlameLine } from '@gitlens/git/models/blame.js';
import type { GitBlameOptions, GitBlameSubProvider } from '@gitlens/git/providers/blame.js';
import type { DiffRange } from '@gitlens/git/providers/types.js';
import { getBlameRange } from '@gitlens/git/utils/blame.utils.js';
import { isUncommittedStaged } from '@gitlens/git/utils/revision.utils.js';
import { fnv1aHash } from '@gitlens/utils/hash.js';
import { first } from '@gitlens/utils/iterable.js';
import { isAbsolute, joinPaths, normalizePath, splitPath } from '@gitlens/utils/path.js';
import { isPromise } from '@gitlens/utils/promise.js';
import type { CliGitProviderInternal } from '../cliGitProvider.js';
import { fsExists } from '../exec/exec.js';
import type { Git } from '../exec/git.js';
import { GitErrors } from '../exec/git.js';
import { parseGitBlame } from '../parsers/blameParser.js';

const ignoreRevsFileArgRegex = /^--ignore-revs-file\s*=?\s*(.*)$/;

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
		const cacheKey = `${normalizePath(path)}:${rev ?? `~${fnv1aHash(contents ?? '')}`}`;
		return this.cache.blame.getOrCreate(
			repoPath,
			cacheKey,
			() => this.getBlameCore(repoPath, path, rev, contents, options),
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

	private async getBlameCore(
		repoPath: string,
		path: string,
		rev?: string,
		contents?: string,
		options?: GitBlameOptions,
	): Promise<GitBlame | undefined> {
		const [result, user, mtime] = await Promise.all([
			this.blameCore(repoPath, path, {
				...(contents != null ? { contents: contents } : { ref: rev }),
				args: options?.args,
				ignoreWhitespace: options?.ignoreWhitespace,
			}),
			this.provider.config.getCurrentUser(repoPath),
			this.getFileMtime(repoPath, path),
		]);
		return parseGitBlame(repoPath, result?.stdout, user, mtime);
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
			this.blameCore(repoPath, path, {
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

	private async blameCore(
		repoPath: string | undefined,
		fileName: string,
		options?: ({ ref: string | undefined; contents?: never } | { contents: string; ref?: never }) & {
			args?: string[] | null;
			correlationKey?: string;
			ignoreWhitespace?: boolean;
			startLine?: number;
			endLine?: number;
		},
	): Promise<{ stdout: string }> {
		const [file, root] = splitPath(fileName, repoPath, true);

		const params = ['blame', '--root', '--incremental'];

		if (options?.ignoreWhitespace) {
			params.push('-w');
		}
		if (options?.startLine != null && options.endLine != null) {
			params.push(`-L ${options.startLine},${options.endLine}`);
		}
		if (options?.args != null) {
			// See if the args contains a value like: `--ignore-revs-file <file>` or `--ignore-revs-file=<file>` to account for user error
			// If so split it up into two args
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

		let stdin;
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

		try {
			const result = await this.git.exec(
				{ cwd: root, stdin: stdin, correlationKey: options?.correlationKey },
				...params,
				'--',
				file,
			);
			return result;
		} catch (ex) {
			// Since `-c blame.ignoreRevsFile=` doesn't seem to work (unlike as the docs suggest), try to detect the error and throw a more helpful one
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

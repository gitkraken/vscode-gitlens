import type { Cache } from '@gitlens/git/cache.js';
import type { GitServiceContext } from '@gitlens/git/context.js';
import type { GitFile } from '@gitlens/git/models/file.js';
import { GitFileWorkingTreeStatus } from '@gitlens/git/models/fileStatus.js';
import type { GitConflictFile } from '@gitlens/git/models/staging.js';
import { GitStatus } from '@gitlens/git/models/status.js';
import type { GitStatusFile } from '@gitlens/git/models/statusFile.js';
import type { GitStatusSubProvider, GitWorkingChangesState } from '@gitlens/git/providers/status.js';
import { isCancellationError } from '@gitlens/utils/cancellation.js';
import { gate } from '@gitlens/utils/decorators/gate.js';
import { debug } from '@gitlens/utils/decorators/log.js';
import { createDisposable } from '@gitlens/utils/disposable.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import { normalizePath, splitPath, stripFolderGlob } from '@gitlens/utils/path.js';
import { getSettledValue } from '@gitlens/utils/promise.js';
import { iterateByDelimiter } from '@gitlens/utils/string.js';
import type { Uri } from '@gitlens/utils/uri.js';
import { fileUri, joinUriPath, toFsPath } from '@gitlens/utils/uri.js';
import type { CliGitProviderInternal } from '../cliGitProvider.js';
import type { GitResult } from '../exec/exec.types.js';
import type { Git } from '../exec/git.js';
import { gitConfigsStatus } from '../exec/git.js';
import { parseGitConflictFiles } from '../parsers/indexParser.js';
import { parseGitStatus } from '../parsers/statusParser.js';

export class StatusGitSubProvider implements GitStatusSubProvider {
	constructor(
		private readonly context: GitServiceContext,
		private readonly git: Git,
		private readonly cache: Cache,
		private readonly provider: CliGitProviderInternal,
	) {}

	@gate(rp => rp ?? '')
	@debug()
	async getStatus(repoPath: string | undefined, cancellation?: AbortSignal): Promise<GitStatus | undefined> {
		if (repoPath == null) return undefined;

		const porcelainVersion = (await this.git.supports('git:status:porcelain-v2')) ? 2 : 1;

		const result = await this.statusCore(repoPath, porcelainVersion, {}, cancellation);
		const repoUri = fileUri(normalizePath(repoPath));
		const status = parseGitStatus(result.stdout, repoPath, porcelainVersion, p =>
			joinUriPath(repoUri, normalizePath(p)),
		);

		if (status?.detached) {
			const pausedOpStatus = await this.provider.pausedOps?.getPausedOperationStatus?.(repoPath, cancellation);
			if (pausedOpStatus?.type === 'rebase') {
				return new GitStatus(
					repoPath,
					pausedOpStatus.incoming.name,
					status.sha,
					status.files,
					status.upstream,
					true,
				);
			}
		}
		return status;
	}

	@debug()
	async getStatusForFile(
		repoPath: string,
		pathOrUri: string | Uri,
		options?: { renames?: boolean },
		cancellation?: AbortSignal,
	): Promise<GitStatusFile | undefined> {
		const files = await this.getStatusForPathCore(
			repoPath,
			toFsPath(pathOrUri),
			{ ...options, exact: true },
			cancellation,
		);
		return files?.[0];
	}

	@debug()
	async getStatusForPath(
		repoPath: string,
		pathOrUri: string | Uri,
		options?: { renames?: boolean },
		cancellation?: AbortSignal,
	): Promise<GitStatusFile[] | undefined> {
		return this.getStatusForPathCore(repoPath, toFsPath(pathOrUri), { ...options, exact: false }, cancellation);
	}

	@gate((rp, pathOrUri, options) => `${rp ?? ''}:${pathOrUri}:${options?.exact ?? ''}:${options?.renames ?? ''}`)
	private async getStatusForPathCore(
		repoPath: string,
		pathOrUri: string,
		options: { exact: boolean; renames?: boolean },
		cancellation?: AbortSignal,
	): Promise<GitStatusFile[] | undefined> {
		let [relativePath] = splitPath(pathOrUri, repoPath);
		relativePath = stripFolderGlob(relativePath);

		const porcelainVersion = (await this.git.supports('git:status:porcelain-v2')) ? 2 : 1;
		const renames = options.renames !== false;

		const result = await this.statusCore(
			repoPath,
			porcelainVersion,
			{},
			cancellation,
			// If we want renames, don't include the path as Git won't do rename detection
			...(renames ? [] : [relativePath]),
		);

		const repoUri = fileUri(normalizePath(repoPath));
		const status = parseGitStatus(result.stdout, repoPath, porcelainVersion, p =>
			joinUriPath(repoUri, normalizePath(p)),
		);
		if (!renames) return status?.files;

		if (options.exact) {
			const file = status?.files.find(f => f.path === relativePath);
			return file ? [file] : undefined;
		}

		const files = status?.files.filter(f => f.path.startsWith(relativePath));
		return files;
	}

	private async statusCore(
		repoPath: string,
		porcelainVersion: number = 1,
		options?: { similarityThreshold?: number },
		cancellation?: AbortSignal,
		...pathspecs: string[]
	): Promise<GitResult> {
		const params = [
			'status',
			porcelainVersion >= 2 ? `--porcelain=v${porcelainVersion}` : '--porcelain',
			'--branch',
			'-u',
		];
		if (await this.git.supports('git:status:find-renames')) {
			params.push(
				`--find-renames${options?.similarityThreshold == null ? '' : `=${options.similarityThreshold}%`}`,
			);
		}

		return this.git.exec(
			{
				cwd: repoPath,
				cancellation: cancellation,
				configs: gitConfigsStatus,
				env: { GIT_OPTIONAL_LOCKS: '0' },
			},
			...params,
			'--',
			...pathspecs,
		);
	}

	@gate((rp, o) => `${rp ?? ''}:${o?.staged ?? true}:${o?.unstaged ?? true}:${o?.untracked ?? true}`)
	@debug()
	async hasWorkingChanges(
		repoPath: string,
		options?: { staged?: boolean; unstaged?: boolean; untracked?: boolean; throwOnError?: boolean },
		cancellation?: AbortSignal,
	): Promise<boolean> {
		const scope = getScopedLogger();

		try {
			const staged = options?.staged ?? true;
			const unstaged = options?.unstaged ?? true;
			if (staged || unstaged) {
				const result = await this.git.exec(
					{ cwd: repoPath, cancellation: cancellation, errors: 'ignore' },
					'diff',
					'--quiet',
					staged && unstaged ? 'HEAD' : staged ? '--staged' : undefined,
				);
				if (result.exitCode === 1) {
					if (staged && unstaged) {
						scope?.addExitInfo('has staged and unstaged changes');
					} else if (staged) {
						scope?.addExitInfo('has staged changes');
					} else {
						scope?.addExitInfo('has unstaged changes');
					}
					return true;
				}
			}

			// Check for untracked files
			const untracked = options?.untracked ?? true;
			if (untracked) {
				const hasUntracked = await this.hasUntrackedFiles(repoPath, cancellation);
				if (hasUntracked) {
					scope?.addExitInfo('has untracked files');
					return true;
				}
			}

			scope?.addExitInfo('no working changes');
			return false;
		} catch (ex) {
			// Re-throw cancellation errors
			if (isCancellationError(ex)) throw ex;

			// Log other errors and return false for graceful degradation
			scope?.error(ex);
			scope?.addExitInfo('error checking for changes');
			if (options?.throwOnError) throw ex;
			return false;
		}
	}

	@gate(rp => rp ?? '')
	@debug()
	async getWorkingChangesState(repoPath: string, cancellation?: AbortSignal): Promise<GitWorkingChangesState> {
		const scope = getScopedLogger();

		try {
			const [stagedResult, unstagedResult, untrackedResult] = await Promise.allSettled([
				// Check for staged changes
				this.git.exec(
					{ cwd: repoPath, cancellation: cancellation, errors: 'ignore' },
					'diff',
					'--quiet',
					'--staged',
				),
				// Check for unstaged changes
				this.git.exec({ cwd: repoPath, cancellation: cancellation, errors: 'ignore' }, 'diff', '--quiet'),
				// Check for untracked files
				this.hasUntrackedFiles(repoPath, cancellation),
			]);

			const result = {
				staged: getSettledValue(stagedResult)?.exitCode === 1,
				unstaged: getSettledValue(unstagedResult)?.exitCode === 1,
				untracked: getSettledValue(untrackedResult) === true,
			};

			scope?.addExitInfo(
				result.staged || result.unstaged || result.untracked
					? `has ${result.staged ? 'staged' : ''}${result.unstaged ? (result.staged ? ', unstaged' : 'unstaged ') : ''}${
							result.untracked ? (result.staged || result.unstaged ? ', untracked' : 'untracked') : ''
						} changes`
					: 'no working changes',
			);

			return result;
		} catch (ex) {
			if (isCancellationError(ex)) throw ex;
			scope?.error(ex);
			scope?.addExitInfo('error checking for changes');
			// Return all false on error for graceful degradation
			return { staged: false, unstaged: false, untracked: false };
		}
	}

	async hasConflictingFiles(repoPath: string, cancellation?: AbortSignal): Promise<boolean> {
		try {
			const stream = this.git.stream({ cwd: repoPath, cancellation: cancellation }, 'ls-files', '--unmerged');
			using _streamDisposer = createDisposable(() => void stream.return?.(undefined));

			// Early exit on first chunk - breaking causes SIGPIPE, killing git process
			for await (const _chunk of stream) {
				return true;
			}

			return false;
		} catch (ex) {
			// Re-throw cancellation errors
			if (isCancellationError(ex)) throw ex;

			return false;
		}
	}

	@gate(rp => rp ?? '')
	@debug()
	async getConflictingFiles(repoPath: string, cancellation?: AbortSignal): Promise<GitConflictFile[]> {
		const scope = getScopedLogger();

		try {
			const result = await this.git.exec(
				{ cwd: repoPath, cancellation: cancellation, errors: 'ignore' },
				'ls-files',
				'-z',
				'--unmerged',
			);

			if (!result.stdout) {
				scope?.addExitInfo('no conflicting files');
				return [];
			}

			const files = parseGitConflictFiles(result.stdout, repoPath);
			scope?.addExitInfo(`${String(files.length)} conflicting file(s)`);
			return files;
		} catch (ex) {
			// Re-throw cancellation errors
			if (isCancellationError(ex)) throw ex;

			// Log other errors and return empty array for graceful degradation
			scope?.error(ex);
			scope?.addExitInfo('error getting conflicting files');
			return [];
		}
	}

	private async hasUntrackedFiles(repoPath: string, cancellation?: AbortSignal): Promise<boolean> {
		try {
			const stream = this.git.stream(
				{ cwd: repoPath, cancellation: cancellation },
				'ls-files',
				// '-z', // Unneeded since we are only looking for presence
				'--others',
				'--exclude-standard',
			);
			using _streamDisposer = createDisposable(() => void stream.return?.(undefined));

			// Early exit on first chunk - breaking causes SIGPIPE, killing git process
			for await (const _chunk of stream) {
				return true;
			}

			return false;
		} catch (ex) {
			// Re-throw cancellation errors
			if (isCancellationError(ex)) throw ex;

			// Treat other errors as "no untracked files" for graceful degradation
			return false;
		}
	}

	@gate(rp => rp ?? '')
	@debug()
	async getUntrackedFiles(repoPath: string, cancellation?: AbortSignal): Promise<GitFile[]> {
		const scope = getScopedLogger();

		try {
			const result = await this.git.exec(
				{ cwd: repoPath, cancellation: cancellation, errors: 'ignore' },
				'ls-files',
				'-z',
				'--others',
				'--exclude-standard',
			);

			if (!result.stdout) {
				scope?.addExitInfo('no untracked files');
				return [];
			}

			const files: GitFile[] = [];

			for (const line of iterateByDelimiter(result.stdout, '\0')) {
				if (!line.length) continue;

				files.push({ path: line, repoPath: repoPath, status: GitFileWorkingTreeStatus.Untracked });
			}

			scope?.addExitInfo(`${String(files.length)} untracked file(s)`);
			return files;
		} catch (ex) {
			// Re-throw cancellation errors
			if (isCancellationError(ex)) throw ex;

			// Log other errors and return empty array for graceful degradation
			scope?.error(ex);
			scope?.addExitInfo('error getting untracked files');
			return [];
		}
	}
}

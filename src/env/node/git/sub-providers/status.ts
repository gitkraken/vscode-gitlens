import type { CancellationToken, Uri } from 'vscode';
import type { Container } from '../../../../container';
import { isCancellationError } from '../../../../errors';
import type { GitCache } from '../../../../git/cache';
import { GitErrorHandling } from '../../../../git/commandOptions';
import type { GitStatusSubProvider, GitWorkingChangesState } from '../../../../git/gitProvider';
import type { GitConflictFile } from '../../../../git/models';
import type { GitFile } from '../../../../git/models/file';
import { GitFileWorkingTreeStatus } from '../../../../git/models/fileStatus';
import { GitStatus } from '../../../../git/models/status';
import type { GitStatusFile } from '../../../../git/models/statusFile';
import { parseGitConflictFiles } from '../../../../git/parsers/indexParser';
import { parseGitStatus } from '../../../../git/parsers/statusParser';
import { configuration } from '../../../../system/-webview/configuration';
import { splitPath } from '../../../../system/-webview/path';
import { gate } from '../../../../system/decorators/gate';
import { log } from '../../../../system/decorators/log';
import { Logger } from '../../../../system/logger';
import { getLogScope, setLogScopeExit } from '../../../../system/logger.scope';
import { stripFolderGlob } from '../../../../system/path';
import { iterateByDelimiter } from '../../../../system/string';
import { createDisposable } from '../../../../system/unifiedDisposable';
import type { Git } from '../git';
import type { LocalGitProvider } from '../localGitProvider';

export class StatusGitSubProvider implements GitStatusSubProvider {
	constructor(
		private readonly container: Container,
		private readonly git: Git,
		private readonly cache: GitCache,
		private readonly provider: LocalGitProvider,
	) {}

	@gate<StatusGitSubProvider['getStatus']>(rp => rp ?? '')
	@log()
	async getStatus(repoPath: string | undefined, cancellation?: CancellationToken): Promise<GitStatus | undefined> {
		if (repoPath == null) return undefined;

		const porcelainVersion = (await this.git.supports('git:status:porcelain-v2')) ? 2 : 1;

		const result = await this.git.status(
			repoPath,
			porcelainVersion,
			{ similarityThreshold: configuration.get('advanced.similarityThreshold') ?? undefined },
			cancellation,
		);
		const status = parseGitStatus(this.container, result.stdout, repoPath, porcelainVersion);

		if (status?.detached) {
			const pausedOpStatus = await this.provider.pausedOps.getPausedOperationStatus?.(repoPath, cancellation);
			if (pausedOpStatus?.type === 'rebase') {
				return new GitStatus(
					this.container,
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

	@log()
	async getStatusForFile(
		repoPath: string,
		pathOrUri: string | Uri,
		options?: { renames?: boolean },
		cancellation?: CancellationToken,
	): Promise<GitStatusFile | undefined> {
		const files = await this.getStatusForPathCore(repoPath, pathOrUri, { ...options, exact: true }, cancellation);
		return files?.[0];
	}

	@log()
	async getStatusForPath(
		repoPath: string,
		pathOrUri: string | Uri,
		options?: { renames?: boolean },
		cancellation?: CancellationToken,
	): Promise<GitStatusFile[] | undefined> {
		return this.getStatusForPathCore(repoPath, pathOrUri, { ...options, exact: false }, cancellation);
	}

	@gate<StatusGitSubProvider['getStatusForPathCore']>(rp => rp ?? '')
	private async getStatusForPathCore(
		repoPath: string,
		pathOrUri: string | Uri,
		options: { exact: boolean; renames?: boolean },
		cancellation?: CancellationToken,
	): Promise<GitStatusFile[] | undefined> {
		let [relativePath] = splitPath(pathOrUri, repoPath);
		relativePath = stripFolderGlob(relativePath);

		const porcelainVersion = (await this.git.supports('git:status:porcelain-v2')) ? 2 : 1;
		const renames = options.renames !== false;

		const result = await this.git.status(
			repoPath,
			porcelainVersion,
			{ similarityThreshold: configuration.get('advanced.similarityThreshold') ?? undefined },
			cancellation,
			// If we want renames, don't include the path as Git won't do rename detection
			...(renames ? [] : [relativePath]),
		);

		const status = parseGitStatus(this.container, result.stdout, repoPath, porcelainVersion);
		if (!renames) return status?.files;

		if (options.exact) {
			const file = status?.files.find(f => f.path === relativePath);
			return file ? [file] : undefined;
		}

		const files = status?.files.filter(f => f.path.startsWith(relativePath));
		return files;
	}

	@gate<StatusGitSubProvider['hasWorkingChanges']>(
		(rp, o) => `${rp ?? ''}:${o?.staged ?? true}:${o?.unstaged ?? true}:${o?.untracked ?? true}`,
	)
	@log()
	async hasWorkingChanges(
		repoPath: string,
		options?: { staged?: boolean; unstaged?: boolean; untracked?: boolean; throwOnError?: boolean },
		cancellation?: CancellationToken,
	): Promise<boolean> {
		const scope = getLogScope();

		try {
			const staged = options?.staged ?? true;
			const unstaged = options?.unstaged ?? true;
			if (staged || unstaged) {
				const result = await this.git.exec(
					{ cwd: repoPath, cancellation: cancellation, errors: GitErrorHandling.Ignore },
					'diff',
					'--quiet',
					staged && unstaged ? 'HEAD' : staged ? '--staged' : undefined,
				);
				if (result.exitCode === 1) {
					if (staged && unstaged) {
						setLogScopeExit(scope, ' \u2022 has staged and unstaged changes');
					} else if (staged) {
						setLogScopeExit(scope, ' \u2022 has staged changes');
					} else {
						setLogScopeExit(scope, ' \u2022 has unstaged changes');
					}
					return true;
				}
			}

			// Check for untracked files
			const untracked = options?.untracked ?? true;
			if (untracked) {
				const hasUntracked = await this.hasUntrackedFiles(repoPath, cancellation);
				if (hasUntracked) {
					setLogScopeExit(scope, ' \u2022 has untracked files');
					return true;
				}
			}

			setLogScopeExit(scope, ' \u2022 no working changes');
			return false;
		} catch (ex) {
			// Re-throw cancellation errors
			if (isCancellationError(ex)) throw ex;

			// Log other errors and return false for graceful degradation
			Logger.error(ex, scope);
			setLogScopeExit(scope, ' \u2022 error checking for changes');
			if (options?.throwOnError) throw ex;
			return false;
		}
	}

	@gate<StatusGitSubProvider['getWorkingChangesState']>(rp => rp ?? '')
	@log()
	async getWorkingChangesState(repoPath: string, cancellation?: CancellationToken): Promise<GitWorkingChangesState> {
		const scope = getLogScope();

		try {
			const [stagedResult, unstagedResult, untrackedResult] = await Promise.allSettled([
				// Check for staged changes
				this.git.exec(
					{ cwd: repoPath, cancellation: cancellation, errors: GitErrorHandling.Ignore },
					'diff',
					'--quiet',
					'--staged',
				),
				// Check for unstaged changes
				this.git.exec(
					{ cwd: repoPath, cancellation: cancellation, errors: GitErrorHandling.Ignore },
					'diff',
					'--quiet',
				),
				// Check for untracked files
				this.hasUntrackedFiles(repoPath, cancellation),
			]);

			const result = {
				staged: Boolean(stagedResult.status === 'fulfilled' && stagedResult.value.exitCode === 1),
				unstaged: Boolean(unstagedResult.status === 'fulfilled' && unstagedResult.value.exitCode === 1),
				untracked: untrackedResult.status === 'fulfilled' && untrackedResult.value === true,
			};

			setLogScopeExit(
				scope,
				result.staged || result.unstaged || result.untracked
					? ` \u2022 has ${result.staged ? 'staged' : ''}${result.unstaged ? (result.staged ? ', unstaged' : 'unstaged ') : ''}${
							result.untracked ? (result.staged || result.unstaged ? ', untracked' : 'untracked') : ''
						} changes`
					: ' \u2022 no working changes',
			);

			return result;
		} catch (ex) {
			if (isCancellationError(ex)) throw ex;
			Logger.error(ex, scope);
			setLogScopeExit(scope, ' \u2022 error checking for changes');
			// Return all false on error for graceful degradation
			return { staged: false, unstaged: false, untracked: false };
		}
	}

	async hasConflictingFiles(repoPath: string, cancellation?: CancellationToken): Promise<boolean> {
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

	@gate<StatusGitSubProvider['getConflictingFiles']>(rp => rp ?? '')
	@log()
	async getConflictingFiles(repoPath: string, cancellation?: CancellationToken): Promise<GitConflictFile[]> {
		const scope = getLogScope();

		try {
			const result = await this.git.exec(
				{ cwd: repoPath, cancellation: cancellation, errors: GitErrorHandling.Ignore },
				'ls-files',
				'-z',
				'--unmerged',
			);

			if (!result.stdout) {
				setLogScopeExit(scope, ' \u2022 no conflicting files');
				return [];
			}

			const files = parseGitConflictFiles(result.stdout, repoPath);
			setLogScopeExit(scope, ` \u2022 ${files.length} conflicting file(s)`);
			return files;
		} catch (ex) {
			// Re-throw cancellation errors
			if (isCancellationError(ex)) throw ex;

			// Log other errors and return empty array for graceful degradation
			Logger.error(ex, scope);
			setLogScopeExit(scope, ' \u2022 error getting conflicting files');
			return [];
		}
	}

	private async hasUntrackedFiles(repoPath: string, cancellation?: CancellationToken): Promise<boolean> {
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

	@gate<StatusGitSubProvider['getUntrackedFiles']>(rp => rp ?? '')
	@log()
	async getUntrackedFiles(repoPath: string, cancellation?: CancellationToken): Promise<GitFile[]> {
		const scope = getLogScope();

		try {
			const result = await this.git.exec(
				{ cwd: repoPath, cancellation: cancellation, errors: GitErrorHandling.Ignore },
				'ls-files',
				'-z',
				'--others',
				'--exclude-standard',
			);

			if (!result.stdout) {
				setLogScopeExit(scope, ' \u2022 no untracked files');
				return [];
			}

			const files: GitFile[] = [];

			for (const line of iterateByDelimiter(result.stdout, '\0')) {
				if (!line.length) continue;

				files.push({ path: line, repoPath: repoPath, status: GitFileWorkingTreeStatus.Untracked });
			}

			setLogScopeExit(scope, ` \u2022 ${files.length} untracked file(s)`);
			return files;
		} catch (ex) {
			// Re-throw cancellation errors
			if (isCancellationError(ex)) throw ex;

			// Log other errors and return empty array for graceful degradation
			Logger.error(ex, scope);
			setLogScopeExit(scope, ' \u2022 error getting untracked files');
			return [];
		}
	}
}

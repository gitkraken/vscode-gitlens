import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import * as l10n from '@vscode/l10n';
import type { Cache } from '@gitlens/git/cache.js';
import type { GitServiceContext } from '@gitlens/git/context.js';
import type { GitOperationRunOptions } from '@gitlens/git/providers/operations.js';
import type { DisposableTemporaryGitIndex, GitStagingSubProvider } from '@gitlens/git/providers/staging.js';
import { countStringLength } from '@gitlens/utils/array.js';
import { debug } from '@gitlens/utils/decorators/log.js';
import { mixinAsyncDisposable } from '@gitlens/utils/disposable.js';
import { chunk } from '@gitlens/utils/iterable.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import { joinPaths } from '@gitlens/utils/path.js';
import type { Uri } from '@gitlens/utils/uri.js';
import { toFsPath } from '@gitlens/utils/uri.js';
import type { CliGitProviderInternal } from '../cliGitProvider.js';
import type { Git } from '../exec/git.js';
import { maxGitCliLength } from '../exec/git.js';

export class StagingGitSubProvider implements GitStagingSubProvider {
	constructor(
		private readonly context: GitServiceContext,
		private readonly git: Git,
		private readonly cache: Cache,
		private readonly provider: CliGitProviderInternal,
	) {}

	@debug()
	async createTemporaryIndex(
		repoPath: string,
		from: 'empty' | 'current' | 'ref',
		ref?: string,
	): Promise<DisposableTemporaryGitIndex> {
		const scope = getScopedLogger();

		// Create a temporary index file
		const tempDir = await fs.mkdtemp(joinPaths(tmpdir(), 'gl-'));
		const tempIndex = joinPaths(tempDir, 'index');

		async function dispose() {
			// Delete the temporary index file
			try {
				await fs.rm(tempDir, { recursive: true });
			} catch {
				// ignore cleanup errors
			}
		}

		try {
			// Tell Git to use our soon to be created index file
			const env = { GIT_INDEX_FILE: tempIndex };

			switch (from) {
				case 'empty':
					// Leave the temp index empty
					break;
				case 'current': {
					// Copy the current index to preserve staged state
					const gitDir = await this.provider.config.getGitDir?.(repoPath);
					if (gitDir == null) throw new Error(l10n.t('Unable to determine git directory for {0}', repoPath));

					const currentIndex = joinPaths(gitDir.uri.fsPath, 'index');
					try {
						await fs.copyFile(currentIndex, tempIndex);
					} catch (ex) {
						// A repo that has never staged anything has no index file yet; git reads a missing
						// `GIT_INDEX_FILE` as an empty index, which is what 'current' means there. Any other
						// failure is real — don't silently hand back an index claiming everything is deleted.
						if ((ex as NodeJS.ErrnoException)?.code !== 'ENOENT') throw ex;
					}
					break;
				}
				case 'ref': {
					if (ref == null) throw new Error(l10n.t("ref is required when from is 'ref'"));

					// Create the temp index file from a base ref/sha
					const newIndexResult = await this.git.run(
						{ cwd: repoPath, env: env },
						'ls-tree',
						'-z',
						'-r',
						'--full-name',
						ref,
					);

					if (newIndexResult.stdout.trim()) {
						// Write the tree to our temp index
						await this.git.run(
							{ cwd: repoPath, env: env, stdin: newIndexResult.stdout },
							'update-index',
							'-z',
							'--index-info',
						);
					}

					break;
				}
			}

			return mixinAsyncDisposable({ path: tempIndex, env: { GIT_INDEX_FILE: tempIndex } }, dispose);
		} catch (ex) {
			scope?.error(ex);

			void dispose();
			throw ex;
		}
	}

	@debug()
	async stageFile(repoPath: string, pathOrUri: string | Uri): Promise<void> {
		await this.git.run({ cwd: repoPath }, 'add', '-A', '--', toFsPath(pathOrUri));
		this.announceIndexChanged(repoPath);
	}

	@debug()
	async stageFiles(
		repoPath: string,
		pathsOrUris: (string | Uri)[],
		options?: { intentToAdd?: boolean; index?: DisposableTemporaryGitIndex },
	): Promise<void> {
		const paths = pathsOrUris.map(toFsPath);
		if (!paths.length) return;

		// Calculate a safe batch size based on average path length
		const avgPathLength = countStringLength(paths) / paths.length;
		const batchSize = Math.max(1, Math.floor(maxGitCliLength / avgPathLength));

		// Process files in batches (will be a single batch if under the limit)
		const batches = chunk(paths, batchSize);
		try {
			for (const batch of batches) {
				await this.git.run(
					{ cwd: repoPath, env: options?.index?.env },
					'add',
					options?.intentToAdd ? '-N' : '-A',
					'--',
					...batch,
				);
			}
		} finally {
			// Announced even when a later batch fails, since the earlier ones already changed the index. A
			// temporary index (used for partial-stage previews / diff building) is not the repository's real
			// index — firing repo-change hooks for it would invalidate status caches for a mutation nothing
			// else can observe.
			if (options?.index == null) {
				this.announceIndexChanged(repoPath);
			}
		}
	}

	@debug()
	async stageDirectory(repoPath: string, directoryOrUri: string | Uri): Promise<void> {
		await this.git.run({ cwd: repoPath }, 'add', '-A', '--', toFsPath(directoryOrUri));
		this.announceIndexChanged(repoPath);
	}

	@debug()
	async unstageFile(repoPath: string, pathOrUri: string | Uri): Promise<void> {
		await this.git.run({ cwd: repoPath }, 'reset', '-q', '--', toFsPath(pathOrUri));
		this.announceIndexChanged(repoPath);
	}

	@debug()
	async unstageFiles(repoPath: string, pathsOrUris: (string | Uri)[]): Promise<void> {
		const paths = pathsOrUris.map(toFsPath);
		if (!paths.length) return;

		// Calculate a safe batch size based on average path length
		const avgPathLength = countStringLength(paths) / paths.length;
		const batchSize = Math.max(1, Math.floor(maxGitCliLength / avgPathLength));

		// Process files in batches (will be a single batch if under the limit)
		const batches = chunk(paths, batchSize);
		try {
			for (const batch of batches) {
				await this.git.run({ cwd: repoPath }, 'reset', '-q', '--', ...batch);
			}
		} finally {
			// Even when a later batch fails, the earlier ones already changed the index
			this.announceIndexChanged(repoPath);
		}
	}

	@debug()
	async unstageDirectory(repoPath: string, directoryOrUri: string | Uri): Promise<void> {
		await this.git.run({ cwd: repoPath }, 'reset', '-q', '--', toFsPath(directoryOrUri));
		this.announceIndexChanged(repoPath);
	}

	@debug()
	async removeFile(repoPath: string, pathOrUri: string | Uri, options?: { force?: boolean }): Promise<void> {
		const args = ['rm'];
		if (options?.force) {
			args.push('-f');
		}
		args.push('--', toFsPath(pathOrUri));
		await this.git.run({ cwd: repoPath }, ...args);
		this.announceIndexChanged(repoPath);
	}

	@debug()
	async removeFiles(repoPath: string, pathsOrUris: (string | Uri)[], options?: { force?: boolean }): Promise<void> {
		const paths = pathsOrUris.map(toFsPath);
		if (!paths.length) return;

		const args: string[] = ['rm'];
		if (options?.force) {
			args.push('-f');
		}
		args.push('--');

		// Calculate a safe batch size based on average path length
		const avgPathLength = countStringLength(paths) / paths.length;
		const batchSize = Math.max(1, Math.floor(maxGitCliLength / avgPathLength));

		// Process files in batches (will be a single batch if under the limit)
		const batches = chunk(paths, batchSize);
		try {
			for (const batch of batches) {
				await this.git.run({ cwd: repoPath }, ...args, ...batch);
			}
		} finally {
			// Even when a later batch fails, the earlier ones already changed the index
			this.announceIndexChanged(repoPath);
		}
	}

	@debug()
	async stageAll(repoPath: string): Promise<void> {
		await this.git.run({ cwd: repoPath }, 'add', '-A');
		this.announceIndexChanged(repoPath);
	}

	@debug()
	async unstageAll(repoPath: string): Promise<void> {
		await this.git.run({ cwd: repoPath }, 'reset', '-q');
		this.announceIndexChanged(repoPath);
	}

	@debug()
	async clean(
		repoPath: string,
		options?: {
			paths?: (string | Uri)[];
			directories?: boolean;
			force?: boolean;
			ignored?: boolean;
		},
		runOptions?: GitOperationRunOptions,
	): Promise<void> {
		const args = ['clean'];
		if (options?.force ?? true) {
			args.push('-f');
		}
		if (options?.directories) {
			args.push('-d');
		}
		if (options?.ignored) {
			args.push('-x');
		}

		if (options?.paths == null) {
			try {
				await this.git.run({ cwd: repoPath, errors: 'throw', ...runOptions }, ...args);
			} finally {
				// A clean that failed or was cancelled partway may already have removed files
				this.announceIndexChanged(repoPath);
			}
			return;
		}

		const paths = options.paths.map(toFsPath);
		if (!paths.length) return;

		// Calculate a safe batch size based on average path length
		const avgPathLength = countStringLength(paths) / paths.length;
		const batchSize = Math.max(1, Math.floor(maxGitCliLength / avgPathLength));

		// Process paths in batches (will be a single batch if under the limit)
		const batches = chunk(paths, batchSize);
		try {
			for (const batch of batches) {
				await this.git.run({ cwd: repoPath, errors: 'throw', ...runOptions }, ...args, '--', ...batch);
			}
		} finally {
			// Even when a later batch fails, the earlier ones already removed files
			this.announceIndexChanged(repoPath);
		}
	}

	/** What every index or working-tree mutation announces, so cached status is re-read and hosts are told. */
	private announceIndexChanged(repoPath: string): void {
		// `diff` and `tracking` too, as a watcher-observed index change clears them: a file's working-vs-index
		// diff and whether it is tracked both change when it is staged, unstaged or removed
		this.context.hooks?.cache?.onReset?.(repoPath, 'status', 'diff', 'tracking');
		this.context.hooks?.repository?.onChanged?.(repoPath, ['index']);
	}
}

import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import type { Cache } from '@gitlens/git/cache.js';
import type { GitServiceContext } from '@gitlens/git/context.js';
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
					if (gitDir == null) throw new Error(`Unable to determine git directory for ${repoPath}`);
					const currentIndex = joinPaths(gitDir.uri.fsPath, 'index');
					await fs.copyFile(currentIndex, tempIndex);
					break;
				}
				case 'ref': {
					if (ref == null) throw new Error(`ref is required when from is 'ref'`);

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
		for (const batch of batches) {
			await this.git.run(
				{ cwd: repoPath, env: options?.index?.env },
				'add',
				options?.intentToAdd ? '-N' : '-A',
				'--',
				...batch,
			);
		}
	}

	@debug()
	async stageDirectory(repoPath: string, directoryOrUri: string | Uri): Promise<void> {
		await this.git.run({ cwd: repoPath }, 'add', '-A', '--', toFsPath(directoryOrUri));
	}

	@debug()
	async unstageFile(repoPath: string, pathOrUri: string | Uri): Promise<void> {
		await this.git.run({ cwd: repoPath }, 'reset', '-q', '--', toFsPath(pathOrUri));
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
		for (const batch of batches) {
			await this.git.run({ cwd: repoPath }, 'reset', '-q', '--', ...batch);
		}
	}

	@debug()
	async unstageDirectory(repoPath: string, directoryOrUri: string | Uri): Promise<void> {
		await this.git.run({ cwd: repoPath }, 'reset', '-q', '--', toFsPath(directoryOrUri));
	}

	@debug()
	async removeFile(repoPath: string, pathOrUri: string | Uri, options?: { force?: boolean }): Promise<void> {
		const args = ['rm'];
		if (options?.force) {
			args.push('-f');
		}
		args.push('--', toFsPath(pathOrUri));
		await this.git.run({ cwd: repoPath }, ...args);
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
		for (const batch of batches) {
			await this.git.run({ cwd: repoPath }, ...args, ...batch);
		}
	}

	@debug()
	async stageAll(repoPath: string): Promise<void> {
		await this.git.run({ cwd: repoPath }, 'add', '-A');
	}

	@debug()
	async unstageAll(repoPath: string): Promise<void> {
		await this.git.run({ cwd: repoPath }, 'reset', '-q');
	}
}

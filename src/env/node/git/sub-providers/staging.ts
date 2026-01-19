import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import type { Uri } from 'vscode';
import type { Container } from '../../../../container.js';
import type { DisposableTemporaryGitIndex, GitStagingSubProvider } from '../../../../git/gitProvider.js';
import { splitPath } from '../../../../system/-webview/path.js';
import { chunk, countStringLength } from '../../../../system/array.js';
import { log } from '../../../../system/decorators/log.js';
import { Logger } from '../../../../system/logger.js';
import { joinPaths } from '../../../../system/path.js';
import { mixinAsyncDisposable } from '../../../../system/unifiedDisposable.js';
import { scope } from '../../../../webviews/commitDetails/protocol.js';
import type { Git } from '../git.js';
import { maxGitCliLength } from '../git.js';
import type { LocalGitProviderInternal } from '../localGitProvider.js';

export class StagingGitSubProvider implements GitStagingSubProvider {
	constructor(
		private readonly container: Container,
		private readonly git: Git,
		private readonly provider: LocalGitProviderInternal,
	) {}

	@log()
	async createTemporaryIndex(
		repoPath: string,
		from: 'empty' | 'current' | 'ref',
		ref?: string,
	): Promise<DisposableTemporaryGitIndex> {
		// Create a temporary index file
		const tempDir = await fs.mkdtemp(joinPaths(tmpdir(), 'gl-'));
		const tempIndex = joinPaths(tempDir, 'index');

		async function dispose() {
			// Delete the temporary index file
			try {
				await fs.rm(tempDir, { recursive: true });
			} catch (_ex) {
				debugger;
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
					const gitDir = await this.provider.config.getGitDir(repoPath);
					const currentIndex = joinPaths(gitDir.uri.fsPath, 'index');
					await fs.copyFile(currentIndex, tempIndex);
					break;
				}
				case 'ref': {
					if (ref == null) throw new Error(`ref is required when from is 'ref'`);

					// Create the temp index file from a base ref/sha
					const newIndexResult = await this.git.exec(
						{ cwd: repoPath, env: env },
						'ls-tree',
						'-z',
						'-r',
						'--full-name',
						ref,
					);

					if (newIndexResult.stdout.trim()) {
						// Write the tree to our temp index
						await this.git.exec(
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
			Logger.error(ex, scope);
			debugger;

			void dispose();
			throw ex;
		}
	}

	@log()
	async stageFile(repoPath: string, pathOrUri: string | Uri): Promise<void> {
		await this.git.exec(
			{ cwd: repoPath },
			'add',
			'-A',
			'--',
			typeof pathOrUri === 'string' ? pathOrUri : splitPath(pathOrUri, repoPath)[0],
		);
	}

	@log()
	async stageFiles(
		repoPath: string,
		pathOrUri: string[] | Uri[],
		options?: { intentToAdd?: boolean; index?: DisposableTemporaryGitIndex },
	): Promise<void> {
		const pathspecs = pathOrUri.map(p => (typeof p === 'string' ? p : splitPath(p, repoPath)[0]));

		// Calculate a safe batch size based on average path length
		const avgPathLength = countStringLength(pathspecs) / pathspecs.length;
		const batchSize = Math.max(1, Math.floor(maxGitCliLength / avgPathLength));

		// Process files in batches (will be a single batch if under the limit)
		const batches = chunk(pathspecs, batchSize);
		for (const batch of batches) {
			await this.git.exec(
				{ cwd: repoPath, env: options?.index?.env },
				'add',
				options?.intentToAdd ? '-N' : '-A',
				'--',
				...batch,
			);
		}
	}

	@log()
	async stageDirectory(repoPath: string, directoryOrUri: string | Uri): Promise<void> {
		await this.git.exec(
			{ cwd: repoPath },
			'add',
			'-A',
			'--',
			typeof directoryOrUri === 'string' ? directoryOrUri : splitPath(directoryOrUri, repoPath)[0],
		);
	}

	@log()
	async unstageFile(repoPath: string, pathOrUri: string | Uri): Promise<void> {
		await this.git.reset(repoPath, [typeof pathOrUri === 'string' ? pathOrUri : splitPath(pathOrUri, repoPath)[0]]);
	}

	@log()
	async unstageFiles(repoPath: string, pathOrUri: string[] | Uri[]): Promise<void> {
		const pathspecs = pathOrUri.map(p => (typeof p === 'string' ? p : splitPath(p, repoPath)[0]));

		// Calculate a safe batch size based on average path length
		const avgPathLength = countStringLength(pathspecs) / pathspecs.length;
		const batchSize = Math.max(1, Math.floor(maxGitCliLength / avgPathLength));

		// Process files in batches (will be a single batch if under the limit)
		const batches = chunk(pathspecs, batchSize);
		for (const batch of batches) {
			await this.git.reset(repoPath, batch);
		}
	}

	@log()
	async unstageDirectory(repoPath: string, directoryOrUri: string | Uri): Promise<void> {
		await this.git.reset(repoPath, [
			typeof directoryOrUri === 'string' ? directoryOrUri : splitPath(directoryOrUri, repoPath)[0],
		]);
	}
}

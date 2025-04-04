import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import type { Uri } from 'vscode';
import type { Container } from '../../../../container';
import type { DisposableTemporaryGitIndex, GitStagingSubProvider } from '../../../../git/gitProvider';
import { splitPath } from '../../../../system/-webview/path';
import { log } from '../../../../system/decorators/log';
import { Logger } from '../../../../system/logger';
import { joinPaths } from '../../../../system/path';
import { mixinAsyncDisposable } from '../../../../system/unifiedDisposable';
import { scope } from '../../../../webviews/commitDetails/protocol';
import type { Git } from '../git';

export class StagingGitSubProvider implements GitStagingSubProvider {
	constructor(
		private readonly container: Container,
		private readonly git: Git,
	) {}

	@log()
	async createTemporaryIndex(repoPath: string, base: string): Promise<DisposableTemporaryGitIndex> {
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

			// Create the temp index file from a base ref/sha

			// Get the tree of the base
			const newIndex = await this.git.exec(
				{
					cwd: repoPath,
					env: env,
				},
				'ls-tree',
				'-z',
				'-r',
				'--full-name',
				base,
			);

			// Write the tree to our temp index
			await this.git.exec(
				{
					cwd: repoPath,
					env: env,
					stdin: newIndex,
				},
				'update-index',
				'-z',
				'--index-info',
			);

			return mixinAsyncDisposable(
				{
					path: tempIndex,
					env: { GIT_INDEX_FILE: tempIndex },
				},
				dispose,
			);
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;

			void dispose();
			throw ex;
		}
	}

	@log()
	async stageFile(repoPath: string, pathOrUri: string | Uri, options?: { intentToAdd?: boolean }): Promise<void> {
		await this.git.exec({ cwd: repoPath }, 'add', options?.intentToAdd ? '-N' : '-A', '--', [
			typeof pathOrUri === 'string' ? pathOrUri : splitPath(pathOrUri, repoPath)[0],
		]);
	}

	@log()
	async stageFiles(
		repoPath: string,
		pathOrUri: string[] | Uri[],
		options?: { intentToAdd?: boolean },
	): Promise<void> {
		await this.git.exec(
			{ cwd: repoPath },
			'add',
			options?.intentToAdd ? '-N' : '-A',
			'--',
			...pathOrUri.map(p => (typeof p === 'string' ? p : splitPath(p, repoPath)[0])),
		);
	}

	@log()
	async stageDirectory(
		repoPath: string,
		directoryOrUri: string | Uri,
		options?: { intentToAdd?: boolean },
	): Promise<void> {
		await this.git.exec({ cwd: repoPath }, 'add', options?.intentToAdd ? '-N' : '-A', '--', [
			typeof directoryOrUri === 'string' ? directoryOrUri : splitPath(directoryOrUri, repoPath)[0],
		]);
	}

	@log()
	async unstageFile(repoPath: string, pathOrUri: string | Uri): Promise<void> {
		await this.git.reset(repoPath, [typeof pathOrUri === 'string' ? pathOrUri : splitPath(pathOrUri, repoPath)[0]]);
	}

	@log()
	async unstageFiles(repoPath: string, pathOrUri: string[] | Uri[]): Promise<void> {
		await this.git.reset(
			repoPath,
			pathOrUri.map(p => (typeof p === 'string' ? p : splitPath(p, repoPath)[0])),
		);
	}

	@log()
	async unstageDirectory(repoPath: string, directoryOrUri: string | Uri): Promise<void> {
		await this.git.reset(repoPath, [
			typeof directoryOrUri === 'string' ? directoryOrUri : splitPath(directoryOrUri, repoPath)[0],
		]);
	}
}

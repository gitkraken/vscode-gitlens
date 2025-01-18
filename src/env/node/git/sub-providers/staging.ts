import type { Uri } from 'vscode';
import type { Container } from '../../../../container';
import type { GitStagingSubProvider } from '../../../../git/gitProvider';
import { log } from '../../../../system/decorators/log';
import { splitPath } from '../../../../system/vscode/path';
import type { Git } from '../git';

export class StagingGitSubProvider implements GitStagingSubProvider {
	constructor(
		private readonly container: Container,
		private readonly git: Git,
	) {}

	@log()
	async stageFile(repoPath: string, pathOrUri: string | Uri, options?: { intentToAdd?: boolean }): Promise<void> {
		await this.git.add(
			repoPath,
			[typeof pathOrUri === 'string' ? pathOrUri : splitPath(pathOrUri, repoPath)[0]],
			options?.intentToAdd ? '-N' : '-A',
		);
	}

	@log()
	async stageFiles(
		repoPath: string,
		pathOrUri: string[] | Uri[],
		options?: { intentToAdd?: boolean },
	): Promise<void> {
		await this.git.add(
			repoPath,
			pathOrUri.map(p => (typeof p === 'string' ? p : splitPath(p, repoPath)[0])),
			options?.intentToAdd ? '-N' : '-A',
		);
	}

	@log()
	async stageDirectory(
		repoPath: string,
		directoryOrUri: string | Uri,
		options?: { intentToAdd?: boolean },
	): Promise<void> {
		await this.git.add(
			repoPath,
			[typeof directoryOrUri === 'string' ? directoryOrUri : splitPath(directoryOrUri, repoPath)[0]],
			options?.intentToAdd ? '-N' : '-A',
		);
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

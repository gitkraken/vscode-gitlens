import type { Disposable } from 'vscode';
import type { Container } from '../../../container';
import type { PathProvider } from '../../../path/pathProvider';

export class WebPathProvider implements PathProvider, Disposable {
	constructor(private readonly _container: Container) {}

	dispose() {}

	async getLocalRepoPaths(_options: {
		remoteUrl?: string;
		repoInfo?: { provider: string; owner: string; repoName: string };
	}): Promise<string[]> {
		return [];
	}

	async writeLocalRepoPath(
		_options: { remoteUrl?: string; repoInfo?: { provider: string; owner: string; repoName: string } },
		_localPath: string,
	): Promise<void> {}
}

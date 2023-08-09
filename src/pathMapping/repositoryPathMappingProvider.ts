import type { Disposable } from 'vscode';

export interface RepositoryPathMappingProvider extends Disposable {
	getLocalRepoPaths(options: {
		remoteUrl?: string;
		repoInfo?: { provider?: string; owner?: string; repoName?: string };
	}): Promise<string[]>;

	writeLocalRepoPath(
		options: { remoteUrl?: string; repoInfo?: { provider?: string; owner?: string; repoName?: string } },
		localPath: string,
	): Promise<void>;
}

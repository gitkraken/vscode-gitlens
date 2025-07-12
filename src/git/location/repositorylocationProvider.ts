import type { Disposable } from 'vscode';

export interface RepositoryLocationProvider extends Disposable {
	getLocation(
		remoteUrl: string | undefined,
		repoInfo?: { provider?: string; owner?: string; repoName?: string },
	): Promise<string[]>;

	storeLocation(
		path: string,
		remoteUrl: string | undefined,
		repoInfo?: { provider?: string; owner?: string; repoName?: string },
	): Promise<void>;
}

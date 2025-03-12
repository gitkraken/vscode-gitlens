import type { Container } from '../../container';
import type { GitCommandOptions } from '../../git/commandOptions';
// Force import of GitHub since dynamic imports are not supported in the WebWorker ExtensionHost
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { GitProvider } from '../../git/gitProvider';
import type { RepositoryLocationProvider } from '../../git/location/repositorylocationProvider';
import { GitHubGitProvider } from '../../plus/integrations/providers/github/githubGitProvider';
import type { SharedGkStorageLocationProvider } from '../../plus/repos/sharedGkStorageLocationProvider';
import type { GkWorkspacesSharedStorageProvider } from '../../plus/workspaces/workspacesSharedStorageProvider';

export function git(_options: GitCommandOptions, ..._args: any[]): Promise<string | Buffer> {
	return Promise.resolve('');
}

export function gitLogStreamTo(
	_repoPath: string,
	_sha: string,
	_limit: number,
	_options?: { configs?: readonly string[]; stdin?: string },
	..._args: string[]
): Promise<[data: string[], count: number]> {
	return Promise.resolve([[''], 0]);
}

export function getSupportedGitProviders(container: Container): Promise<GitProvider[]> {
	return Promise.resolve([new GitHubGitProvider(container)]);
}

export function getSharedGKStorageLocationProvider(_container: Container): SharedGkStorageLocationProvider | undefined {
	return undefined;
}

export function getSupportedRepositoryLocationProvider(
	_container: Container,
	_sharedStorage: SharedGkStorageLocationProvider | undefined,
): RepositoryLocationProvider | undefined {
	return undefined;
}

export function getSupportedWorkspacesStorageProvider(
	_container: Container,
	_sharedStorage: SharedGkStorageLocationProvider | undefined,
): GkWorkspacesSharedStorageProvider | undefined {
	return undefined;
}

export function getGkCliIntegrationProvider(_container: Container): undefined {
	return undefined;
}

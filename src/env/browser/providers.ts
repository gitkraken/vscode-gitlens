import type { Container } from '../../container';
import type { GitCommandOptions } from '../../git/commandOptions';
// Force import of GitHub since dynamic imports are not supported in the WebWorker ExtensionHost
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { GitProvider } from '../../git/gitProvider';
import type { RepositoryLocationProvider } from '../../git/location/repositorylocationProvider';
import { GitHubGitProvider } from '../../plus/integrations/providers/github/githubGitProvider';
import type { SharedGkStorageLocationProvider } from '../../plus/repos/sharedGkStorageLocationProvider';
import type { GkWorkspacesSharedStorageProvider } from '../../plus/workspaces/workspacesSharedStorageProvider';
import type { GitResult } from '../node/git/git';

export function git(
	_container: Container,
	_options: GitCommandOptions,
	..._args: any[]
): Promise<GitResult<string | Buffer>> {
	return Promise.resolve({ stdout: '', exitCode: 0 });
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

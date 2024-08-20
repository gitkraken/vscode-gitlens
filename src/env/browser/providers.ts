import type { Container } from '../../container';
import type { GitCommandOptions } from '../../git/commandOptions';
// Force import of GitHub since dynamic imports are not supported in the WebWorker ExtensionHost
import type { GitProvider } from '../../git/gitProvider';
import type { IntegrationAuthenticationService } from '../../plus/integrations/authentication/integrationAuthentication';
import { GitHubGitProvider } from '../../plus/integrations/providers/github/githubGitProvider';
import { RepositoryWebPathMappingProvider } from './pathMapping/repositoryWebPathMappingProvider';
import { WorkspacesWebPathMappingProvider } from './pathMapping/workspacesWebPathMappingProvider';

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

// eslint-disable-next-line @typescript-eslint/require-await
export async function getSupportedGitProviders(
	container: Container,
	authenticationService: IntegrationAuthenticationService,
): Promise<GitProvider[]> {
	return [new GitHubGitProvider(container, authenticationService)];
}

export function getSupportedRepositoryPathMappingProvider(container: Container) {
	return new RepositoryWebPathMappingProvider(container);
}

export function getSupportedWorkspacesPathMappingProvider() {
	return new WorkspacesWebPathMappingProvider();
}

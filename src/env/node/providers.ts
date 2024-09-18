import type { Container } from '../../container';
import type { GitCommandOptions } from '../../git/commandOptions';
import type { GitProvider } from '../../git/gitProvider';
import type { IntegrationAuthenticationService } from '../../plus/integrations/authentication/integrationAuthentication';
import { configuration } from '../../system/vscode/configuration';
// import { GitHubGitProvider } from '../../plus/github/githubGitProvider';
import { Git } from './git/git';
import { LocalGitProvider } from './git/localGitProvider';
import { VslsGit, VslsGitProvider } from './git/vslsGitProvider';
import { RepositoryLocalPathMappingProvider } from './pathMapping/repositoryLocalPathMappingProvider';
import { WorkspacesLocalPathMappingProvider } from './pathMapping/workspacesLocalPathMappingProvider';

let gitInstance: Git | undefined;
function ensureGit() {
	if (gitInstance == null) {
		gitInstance = new Git();
	}
	return gitInstance;
}

export function git(options: GitCommandOptions, ...args: any[]): Promise<string | Buffer> {
	return ensureGit().git(options, ...args);
}

export function gitLogStreamTo(
	repoPath: string,
	sha: string,
	limit: number,
	options?: { configs?: readonly string[]; stdin?: string },
	...args: string[]
): Promise<[data: string[], count: number]> {
	return ensureGit().logStreamTo(repoPath, sha, limit, options, ...args);
}

export async function getSupportedGitProviders(
	container: Container,
	authenticationService: IntegrationAuthenticationService,
): Promise<GitProvider[]> {
	const git = ensureGit();

	const providers: GitProvider[] = [
		new LocalGitProvider(container, git),
		new VslsGitProvider(container, new VslsGit(git)),
	];

	if (configuration.get('virtualRepositories.enabled')) {
		providers.push(
			new (
				await import(
					/* webpackChunkName: "integrations" */ '../../plus/integrations/providers/github/githubGitProvider'
				)
			).GitHubGitProvider(container, authenticationService),
		);
	}

	return providers;
}

export function getSupportedRepositoryPathMappingProvider(container: Container) {
	return new RepositoryLocalPathMappingProvider(container);
}

export function getSupportedWorkspacesPathMappingProvider() {
	return new WorkspacesLocalPathMappingProvider();
}

import { Container } from '../../container';
import { GitCommandOptions } from '../../git/commandOptions';
// Force import of GitHub since dynamic imports are not supported in the WebWorker ExtensionHost
import { GitHubGitProvider } from '../../plus/github/githubGitProvider';
import { GitProvider } from '../../git/gitProvider';
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

export async function getSupportedGitProviders(container: Container): Promise<GitProvider[]> {
	return [new GitHubGitProvider(container)];
}

export function getSupportedRepositoryPathMappingProvider(container: Container) {
	return new RepositoryWebPathMappingProvider(container);
}

export function getSupportedWorkspacesPathMappingProvider() {
	return new WorkspacesWebPathMappingProvider();
}

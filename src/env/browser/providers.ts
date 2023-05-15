import { Container } from '../../container';
import { GitCommandOptions } from '../../git/commandOptions';
// Force import of GitHub since dynamic imports are not supported in the WebWorker ExtensionHost
import { GitHubGitProvider } from '../../plus/github/githubGitProvider';
import { GitProvider } from '../../git/gitProvider';
import { WebPathProvider } from './path/webPathProvider';
import { WorkspacesWebPathProvider } from './path/workspacesWebPathProvider';

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

export function getSupportedPathProvider(container: Container) {
	return new WebPathProvider(container);
}

export function getSupportedWorkspacesPathProvider() {
	return new WorkspacesWebPathProvider();
}

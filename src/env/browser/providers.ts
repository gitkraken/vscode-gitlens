import { Container } from '../../container';
import { GitCommandOptions } from '../../git/commandOptions';
// Force import of GitHub since dynamic imports are not supported in the WebWorker ExtensionHost
import { GitHubGitProvider } from '../../plus/github/githubGitProvider';
import { GitProvider } from '../../git/gitProvider';

export function git(_options: GitCommandOptions, ..._args: any[]): Promise<string | Buffer> {
	return Promise.resolve('');
}

export async function getSupportedGitProviders(container: Container): Promise<GitProvider[]> {
	return [new GitHubGitProvider(container)];
}

import { Container } from '../../container';
import { GitCommandOptions } from '../../git/commandOptions';
import { GitHubGitProvider } from '../../premium/github/githubGitProvider';
import { GitProvider } from '../../git/gitProvider';
// Force import of GitHub since dynamic imports are not supported in the WebWorker ExtensionHost
import * as GitHub from '../../premium/github/github';

export function git(_options: GitCommandOptions, ..._args: any[]): Promise<string | Buffer> {
	return Promise.resolve('');
}

export function getSupportedGitProviders(container: Container): GitProvider[] {
	GitHub.GitHubApi;
	return [new GitHubGitProvider(container)];
}

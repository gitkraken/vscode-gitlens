import type { Container } from '../../container';
import type { GitCommandOptions } from '../../git/commandOptions';
import type { GitProvider } from '../../git/gitProvider';
import { configuration } from '../../system/configuration';
// import { GitHubGitProvider } from '../../plus/github/githubGitProvider';
import { Git } from './git/git';
import { LocalGitProvider } from './git/localGitProvider';
import { VslsGit, VslsGitProvider } from './git/vslsGitProvider';
import { LocalPathProvider } from './path/localPathProvider';
import { WorkspacesLocalPathProvider } from './path/workspacesLocalPathProvider';

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

export async function getSupportedGitProviders(container: Container): Promise<GitProvider[]> {
	const git = ensureGit();

	const providers: GitProvider[] = [
		new LocalGitProvider(container, git),
		new VslsGitProvider(container, new VslsGit(git)),
	];

	if (configuration.get('virtualRepositories.enabled')) {
		const GitHubGitProvider = (await import(/* webpackChunkName: "github" */ '../../plus/github/githubGitProvider'))
			.GitHubGitProvider;
		providers.push(new GitHubGitProvider(container));
	}

	return providers;
}

export function getSupportedPathProvider(container: Container) {
	return new LocalPathProvider(container);
}

export function getSupportedWorkspacesPathProvider() {
	return new WorkspacesLocalPathProvider();
}

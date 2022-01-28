import { Container } from '../../container';
import { GitCommandOptions } from '../../git/commandOptions';
import { GitProvider } from '../../git/gitProvider';
import { GitHubGitProvider } from '../../premium/github/githubGitProvider';
import { Git } from './git/git';
import { LocalGitProvider } from './git/localGitProvider';
import { VslsGit, VslsGitProvider } from './git/vslsGitProvider';

let gitInstance: Git | undefined;
function ensureGit() {
	if (gitInstance == null) {
		gitInstance = new Git();
	}
	return gitInstance;
}

export function git(_options: GitCommandOptions, ..._args: any[]): Promise<string | Buffer> {
	return ensureGit().git(_options, ..._args);
}

export function getSupportedGitProviders(container: Container): GitProvider[] {
	const git = ensureGit();

	const providers: GitProvider[] = [
		new LocalGitProvider(container, git),
		new VslsGitProvider(container, new VslsGit(git)),
	];

	if (container.config.experimental.virtualRepositories.enabled) {
		providers.push(new GitHubGitProvider(container));
	}

	return providers;
}

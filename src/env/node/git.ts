import { Container } from '../../container';
import { GitProvider } from '../../git/gitProvider';
import { GitHubGitProvider } from '../../premium/github/githubGitProvider';
import { LocalGitProvider } from './git/localGitProvider';

export { git } from './git/git';

export function getSupportedGitProviders(container: Container): GitProvider[] {
	return container.config.experimental.virtualRepositories.enabled
		? [new LocalGitProvider(container), new GitHubGitProvider(container)]
		: [new LocalGitProvider(container)];
}

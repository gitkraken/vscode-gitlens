import { Container } from '../../container';
import { GitProvider } from '../../git/gitProvider';
import { LocalGitProvider } from './git/localGitProvider';
import { isWeb } from './platform';

export { git } from './git/git';

export function getSupportedGitProviders(container: Container): GitProvider[] {
	if (isWeb) return [];

	return [new LocalGitProvider(container)];
}

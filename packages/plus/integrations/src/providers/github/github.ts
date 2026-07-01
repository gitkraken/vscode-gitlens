import type { GitHubApiConfig } from '@gitlens/git-github/api/config.js';
import { GitHubApi } from '@gitlens/git-github/api/github.js';
import { AuthenticationErrorReason } from '@gitlens/git/errors.js';
import type { Provider } from '@gitlens/git/models/remoteProvider.js';
import type { IntegrationServiceContext } from '../../context.js';

export { GitHubApi } from '@gitlens/git-github/api/github.js';

export function createGitHubApi(ctx: IntegrationServiceContext): GitHubApi {
	const launchpad = () => ctx.config.getLaunchpadOptions();

	const config: GitHubApiConfig = {
		isWeb: ctx.http.isWeb,
		fetch: ctx.http.fetch.bind(ctx.http),
		wrapForForcedInsecureSSL: ctx.http.wrapForForcedInsecureSSL.bind(ctx.http),

		onConfigChanged: (listener: () => void) =>
			ctx.config.onDidChange(e => {
				if (e.httpProxy) {
					listener();
				}
			}),

		onAuthenticationFailure: async (error, provider: Provider | undefined) => {
			if (
				error.reason === AuthenticationErrorReason.Unauthorized ||
				error.reason === AuthenticationErrorReason.Forbidden
			) {
				const reauthenticate = await ctx.hooks?.onReauthenticationRequired?.(
					`${error.message}. Would you like to try reauthenticating${
						error.reason === AuthenticationErrorReason.Forbidden ? ' to provide additional access' : ''
					}?`,
				);

				if (reauthenticate) {
					await provider?.reauthenticate();
					return true;
				}
			} else {
				ctx.hooks?.ui?.onError?.(error.message);
			}
			return false;
		},

		onRequestError: (provider: Provider | undefined, message: string) => {
			if (message.includes('timeout')) {
				ctx.hooks?.ui?.onRequestTimedOut?.(provider?.name ?? 'GitHub');
			} else {
				ctx.hooks?.ui?.onRequestFailed?.(message);
			}
		},

		onDebugError: (message: string) => {
			ctx.hooks?.ui?.onError?.(message);
		},

		getLaunchpadQueryLimit: () => launchpad().queryLimit ?? 100,
		getLaunchpadIgnoredRepositories: () => [...(launchpad().ignoredRepositories ?? [])],
		getLaunchpadIncludedOrganizations: () => [...(launchpad().includedOrganizations ?? [])],
		getLaunchpadIgnoredOrganizations: () => [...(launchpad().ignoredOrganizations ?? [])],
	};

	return new GitHubApi(config);
}

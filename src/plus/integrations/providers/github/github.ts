import { window } from 'vscode';
import { fetch, wrapForForcedInsecureSSL } from '@env/fetch.js';
import { isWeb } from '@env/platform.js';
import { AuthenticationErrorReason } from '@gitlens/git/errors.js';
import type { Provider } from '@gitlens/git/models/remoteProvider.js';
import type { GitHubApiConfig } from '@gitlens/git-github/api/config.js';
import { GitHubApi } from '@gitlens/git-github/api/github.js';
import {
	showIntegrationRequestFailed500WarningMessage,
	showIntegrationRequestTimedOutWarningMessage,
} from '../../../../messages.js';
import { configuration } from '../../../../system/-webview/configuration.js';

export { GitHubApi } from '@gitlens/git-github/api/github.js';

export function createGitHubApi(): GitHubApi {
	const config: GitHubApiConfig = {
		isWeb: isWeb,
		fetch: fetch as unknown as GitHubApiConfig['fetch'],
		wrapForForcedInsecureSSL: wrapForForcedInsecureSSL,

		onConfigChanged: (listener: () => void) => {
			return configuration.onDidChangeAny(e => {
				if (configuration.changedCore(e, ['http.proxy', 'http.proxyStrictSSL'])) {
					listener();
				}
			});
		},

		onAuthenticationFailure: async (error, provider: Provider | undefined) => {
			if (
				error.reason === AuthenticationErrorReason.Unauthorized ||
				error.reason === AuthenticationErrorReason.Forbidden
			) {
				const confirm = 'Reauthenticate';
				const result = await window.showErrorMessage(
					`${error.message}. Would you like to try reauthenticating${
						error.reason === AuthenticationErrorReason.Forbidden ? ' to provide additional access' : ''
					}?`,
					confirm,
				);

				if (result === confirm) {
					await provider?.reauthenticate();
					return true;
				}
			} else {
				void window.showErrorMessage(error.message);
			}
			return false;
		},

		onRequestError: (provider: Provider | undefined, message: string) => {
			if (message.includes('timeout')) {
				void showIntegrationRequestTimedOutWarningMessage(provider?.name ?? 'GitHub');
			} else {
				void showIntegrationRequestFailed500WarningMessage(message);
			}
		},

		onDebugError: (message: string) => {
			void window.showErrorMessage(message);
		},

		getLaunchpadQueryLimit: () => configuration.get('launchpad.experimental.queryLimit') ?? 100,
		getLaunchpadIgnoredRepositories: () => configuration.get('launchpad.ignoredRepositories') ?? [],
		getLaunchpadIncludedOrganizations: () => configuration.get('launchpad.includedOrganizations') ?? [],
		getLaunchpadIgnoredOrganizations: () => configuration.get('launchpad.ignoredOrganizations') ?? [],
	};

	return new GitHubApi(config);
}

import type { Disposable, QuickInputButton } from 'vscode';
import { authentication, env, ThemeIcon, Uri, window } from 'vscode';
import { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '../../../constants.integrations';
import type { Sources } from '../../../constants.telemetry';
import type { Container } from '../../../container';
import { getBuiltInIntegrationSession } from '../../gk/utils/-webview/integrationAuthentication.utils';
import type { ConfiguredIntegrationService } from './configuredIntegrationService';
import type { IntegrationAuthenticationSessionDescriptor } from './integrationAuthenticationProvider';
import {
	CloudIntegrationAuthenticationProvider,
	LocalIntegrationAuthenticationProvider,
} from './integrationAuthenticationProvider';
import type { IntegrationAuthenticationService } from './integrationAuthenticationService';
import type { ProviderAuthenticationSession } from './models';

export class GitHubAuthenticationProvider extends CloudIntegrationAuthenticationProvider<GitCloudHostIntegrationId.GitHub> {
	constructor(
		container: Container,
		authenticationService: IntegrationAuthenticationService,
		configuredIntegrationService: ConfiguredIntegrationService,
	) {
		super(container, authenticationService, configuredIntegrationService);
		this.disposables.push(
			authentication.onDidChangeSessions(e => {
				if (e.provider.id === this.authProviderId) {
					this.fireChange();
				}
			}),
		);
	}

	protected override get authProviderId(): GitCloudHostIntegrationId.GitHub {
		return GitCloudHostIntegrationId.GitHub;
	}

	public override async getSession(
		descriptor: IntegrationAuthenticationSessionDescriptor,
		options?: { createIfNeeded?: boolean; forceNewSession?: boolean; source?: Sources },
	): Promise<ProviderAuthenticationSession | undefined> {
		let session = await getBuiltInIntegrationSession(this.container, this.authProviderId, descriptor, {
			silent: true,
		});
		if (session != null && options?.forceNewSession) {
			session = await getBuiltInIntegrationSession(this.container, this.authProviderId, descriptor, {
				forceNewSession: true,
			});
		}

		if (session != null) return session;

		return super.getSession(descriptor, options);
	}
}

export class GitHubEnterpriseCloudAuthenticationProvider extends CloudIntegrationAuthenticationProvider<GitSelfManagedHostIntegrationId.CloudGitHubEnterprise> {
	protected override get authProviderId(): GitSelfManagedHostIntegrationId.CloudGitHubEnterprise {
		return GitSelfManagedHostIntegrationId.CloudGitHubEnterprise;
	}
}

export class GitHubEnterpriseAuthenticationProvider extends LocalIntegrationAuthenticationProvider<GitSelfManagedHostIntegrationId.GitHubEnterprise> {
	protected override get authProviderId(): GitSelfManagedHostIntegrationId.GitHubEnterprise {
		return GitSelfManagedHostIntegrationId.GitHubEnterprise;
	}

	override async createSession(
		descriptor: IntegrationAuthenticationSessionDescriptor,
	): Promise<ProviderAuthenticationSession | undefined> {
		const input = window.createInputBox();
		input.ignoreFocusOut = true;

		const disposables: Disposable[] = [];

		let token;
		try {
			const infoButton: QuickInputButton = {
				iconPath: new ThemeIcon(`link-external`),
				tooltip: 'Open the GitHub Access Tokens Page',
			};

			token = await new Promise<string | undefined>(resolve => {
				disposables.push(
					input.onDidHide(() => resolve(undefined)),
					input.onDidChangeValue(() => (input.validationMessage = undefined)),
					input.onDidAccept(() => {
						const value = input.value.trim();
						if (!value) {
							input.validationMessage = 'A personal access token is required';
							return;
						}

						resolve(value);
					}),
					input.onDidTriggerButton(e => {
						if (e === infoButton) {
							void env.openExternal(Uri.parse(`https://${descriptor.domain}/settings/tokens`));
						}
					}),
				);

				input.password = true;
				input.title = `GitHub Authentication  \u2022 ${descriptor.domain}`;
				input.placeholder = `Requires a classic token with ${descriptor.scopes.join(', ')} scopes`;
				input.prompt = `Paste your [GitHub Personal Access Token](https://${descriptor.domain}/settings/tokens "Get your GitHub Access Token")`;

				input.buttons = [infoButton];

				input.show();
			});
		} finally {
			input.dispose();
			disposables.forEach(d => void d.dispose());
		}

		if (!token) return undefined;

		return {
			id: this.configuredIntegrationService.getSessionId(descriptor),
			accessToken: token,
			scopes: descriptor?.scopes ?? [],
			account: {
				id: '',
				label: '',
			},
			cloud: false,
			domain: descriptor.domain,
		};
	}
}

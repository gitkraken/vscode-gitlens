import { wrapForForcedInsecureSSL } from '@env/fetch';
import type { Disposable, QuickInputButton } from 'vscode';
import { authentication, env, ThemeIcon, Uri, window } from 'vscode';
import { HostingIntegrationId, SelfHostedIntegrationId } from '../../../constants.integrations';
import type { Sources } from '../../../constants.telemetry';
import type { Container } from '../../../container';
import type { IntegrationAuthenticationSessionDescriptor } from './integrationAuthentication';
import {
	CloudIntegrationAuthenticationProvider,
	LocalIntegrationAuthenticationProvider,
} from './integrationAuthentication';
import type { ProviderAuthenticationSession } from './models';

export class GitHubAuthenticationProvider extends CloudIntegrationAuthenticationProvider<HostingIntegrationId.GitHub> {
	constructor(container: Container) {
		super(container);
		this.disposables.push(
			authentication.onDidChangeSessions(e => {
				if (e.provider.id === this.authProviderId) {
					this.fireDidChange();
				}
			}),
		);
	}

	protected override get authProviderId(): HostingIntegrationId.GitHub {
		return HostingIntegrationId.GitHub;
	}

	private async getBuiltInExistingSession(
		descriptor?: IntegrationAuthenticationSessionDescriptor,
		forceNewSession?: boolean,
	): Promise<ProviderAuthenticationSession | undefined> {
		if (descriptor == null) return undefined;

		return wrapForForcedInsecureSSL(
			this.container.integrations.ignoreSSLErrors({ id: this.authProviderId, domain: descriptor?.domain }),
			async () => {
				const session = await authentication.getSession(this.authProviderId, descriptor.scopes, {
					forceNewSession: forceNewSession ? true : undefined,
					silent: forceNewSession ? undefined : true,
				});
				if (session == null) return undefined;
				return {
					...session,
					cloud: false,
				};
			},
		);
	}

	public override async getSession(
		descriptor?: IntegrationAuthenticationSessionDescriptor,
		options?: { createIfNeeded?: boolean; forceNewSession?: boolean; source?: Sources },
	): Promise<ProviderAuthenticationSession | undefined> {
		let vscodeSession = await this.getBuiltInExistingSession(descriptor);

		if (vscodeSession != null && options?.forceNewSession) {
			vscodeSession = await this.getBuiltInExistingSession(descriptor, true);
		}

		if (vscodeSession != null) return vscodeSession;

		return super.getSession(descriptor, options);
	}

	protected override getCompletionInputTitle(): string {
		return 'Connect to GitHub';
	}
}

export class GitHubEnterpriseAuthenticationProvider extends LocalIntegrationAuthenticationProvider<SelfHostedIntegrationId.GitHubEnterprise> {
	protected override get authProviderId(): SelfHostedIntegrationId.GitHubEnterprise {
		return SelfHostedIntegrationId.GitHubEnterprise;
	}

	override async createSession(
		descriptor?: IntegrationAuthenticationSessionDescriptor,
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
							void env.openExternal(
								Uri.parse(`https://${descriptor?.domain ?? 'github.com'}/settings/tokens`),
							);
						}
					}),
				);

				input.password = true;
				input.title = `GitHub Authentication${descriptor?.domain ? `  \u2022 ${descriptor.domain}` : ''}`;
				input.placeholder = `Requires a classic token with ${descriptor?.scopes.join(', ') ?? 'all'} scopes`;
				input.prompt = `Paste your [GitHub Personal Access Token](https://${
					descriptor?.domain ?? 'github.com'
				}/settings/tokens "Get your GitHub Access Token")`;

				input.buttons = [infoButton];

				input.show();
			});
		} finally {
			input.dispose();
			disposables.forEach(d => void d.dispose());
		}

		if (!token) return undefined;

		return {
			id: this.getSessionId(descriptor),
			accessToken: token,
			scopes: descriptor?.scopes ?? [],
			account: {
				id: '',
				label: '',
			},
			cloud: false,
		};
	}
}

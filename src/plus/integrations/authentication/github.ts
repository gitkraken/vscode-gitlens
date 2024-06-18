import type { AuthenticationSession, Disposable, QuickInputButton } from 'vscode';
import { authentication, env, ThemeIcon, Uri, window } from 'vscode';
import { wrapForForcedInsecureSSL } from '@env/fetch';
import type { Container } from '../../../container';
import { HostingIntegrationId, SelfHostedIntegrationId } from '../providers/models';
import type { IntegrationAuthenticationSessionDescriptor } from './integrationAuthentication';
import { IntegrationAuthenticationProvider } from './integrationAuthentication';

export class GitHubAuthenticationProvider extends IntegrationAuthenticationProvider {
	constructor(container: Container) {
		super(container, HostingIntegrationId.GitHub);
	}

	override async createSession(
		descriptor?: IntegrationAuthenticationSessionDescriptor,
		options?: { authorizeIfNeeded?: boolean; createIfNeeded?: boolean; forceNewSession?: boolean },
	): Promise<AuthenticationSession | undefined> {
		if (descriptor != null) {
			const { createIfNeeded, forceNewSession } = options ?? {};
			const session = wrapForForcedInsecureSSL(
				this.container.integrations.ignoreSSLErrors({ id: this.authProviderId, domain: descriptor?.domain }),
				() =>
					authentication.getSession(this.authProviderId, descriptor.scopes, {
						createIfNone: forceNewSession ? undefined : createIfNeeded,
						silent: !createIfNeeded && !forceNewSession ? true : undefined,
						forceNewSession: forceNewSession ? true : undefined,
					}),
			);

			if (session != null) {
				return session;
			}
		}
		return super.createSession(descriptor, options);
	}

	protected override getCompletionInputTitle(): string {
		throw new Error('Method not implemented.');
	}
}

export class GitHubEnterpriseAuthenticationProvider extends IntegrationAuthenticationProvider {
	constructor(container: Container) {
		super(container, SelfHostedIntegrationId.GitHubEnterprise);
	}

	override async createSession(
		descriptor?: IntegrationAuthenticationSessionDescriptor,
	): Promise<AuthenticationSession | undefined> {
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
		};
	}

	protected override getCompletionInputTitle(): string {
		throw new Error('Method not implemented');
	}
}

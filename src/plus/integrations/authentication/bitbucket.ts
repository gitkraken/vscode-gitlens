import type { Disposable, QuickInputButton } from 'vscode';
import { env, ThemeIcon, Uri, window } from 'vscode';
import { HostingIntegrationId } from '../../../constants.integrations';
import { base64 } from '../../../system/string';
import type { IntegrationAuthenticationSessionDescriptor } from './integrationAuthentication';
import { LocalIntegrationAuthenticationProvider } from './integrationAuthentication';
import type { ProviderAuthenticationSession } from './models';

export class BitbucketAuthenticationProvider extends LocalIntegrationAuthenticationProvider<HostingIntegrationId.Bitbucket> {
	protected override get authProviderId(): HostingIntegrationId.Bitbucket {
		return HostingIntegrationId.Bitbucket;
	}

	override async createSession(
		descriptor?: IntegrationAuthenticationSessionDescriptor,
	): Promise<ProviderAuthenticationSession | undefined> {
		let bitbucketUsername: string | undefined = descriptor?.username as string | undefined;
		if (!bitbucketUsername) {
			const infoButton: QuickInputButton = {
				iconPath: new ThemeIcon(`link-external`),
				tooltip: 'Open the Bitbucket Settings Page',
			};

			const usernameInput = window.createInputBox();
			usernameInput.ignoreFocusOut = true;
			const usernameInputDisposables: Disposable[] = [];
			try {
				bitbucketUsername = await new Promise<string | undefined>(resolve => {
					usernameInputDisposables.push(
						usernameInput.onDidHide(() => resolve(undefined)),
						usernameInput.onDidChangeValue(() => (usernameInput.validationMessage = undefined)),
						usernameInput.onDidAccept(() => {
							const value = usernameInput.value.trim();
							if (!value) {
								usernameInput.validationMessage = 'A Bitbucket username is required';
								return;
							}

							resolve(value);
						}),
						usernameInput.onDidTriggerButton(e => {
							if (e === infoButton) {
								void env.openExternal(
									Uri.parse(`https://${descriptor?.domain ?? 'bitbucket.org'}/account/settings/`),
								);
							}
						}),
					);

					usernameInput.title = `Bitbucket Authentication${
						descriptor?.domain ? `  \u2022 ${descriptor.domain}` : ''
					}`;
					usernameInput.placeholder = 'Username';
					usernameInput.prompt = `Enter your [Bitbucket Username](https://${
						descriptor?.domain ?? 'bitbucket.org'
					}/account/settings/ "Get your Bitbucket App Password")`;
					usernameInput.show();
				});
			} finally {
				usernameInput.dispose();
				usernameInputDisposables.forEach(d => void d.dispose());
			}
		}

		if (!bitbucketUsername) return undefined;

		const appPasswordInput = window.createInputBox();
		appPasswordInput.ignoreFocusOut = true;

		const disposables: Disposable[] = [];

		let appPassword;
		try {
			const infoButton: QuickInputButton = {
				iconPath: new ThemeIcon(`link-external`),
				tooltip: 'Open the Bitbucket App Passwords Page',
			};

			appPassword = await new Promise<string | undefined>(resolve => {
				disposables.push(
					appPasswordInput.onDidHide(() => resolve(undefined)),
					appPasswordInput.onDidChangeValue(() => (appPasswordInput.validationMessage = undefined)),
					appPasswordInput.onDidAccept(() => {
						const value = appPasswordInput.value.trim();
						if (!value) {
							appPasswordInput.validationMessage = 'An app password is required';
							return;
						}

						resolve(value);
					}),
					appPasswordInput.onDidTriggerButton(e => {
						if (e === infoButton) {
							void env.openExternal(
								Uri.parse(
									`https://${descriptor?.domain ?? 'bitbucket.org'}/account/settings/app-passwords/`,
								),
							);
						}
					}),
				);

				appPasswordInput.password = true;
				appPasswordInput.title = `Bitbucket Authentication${
					descriptor?.domain ? `  \u2022 ${descriptor.domain}` : ''
				}`;
				appPasswordInput.placeholder = `Requires ${descriptor?.scopes.join(', ') ?? 'all'} scopes`;
				appPasswordInput.prompt = `Paste your [Bitbucket App Password](https://${
					descriptor?.domain ?? 'bitbucket.org'
				}/account/settings/app-passwords/ "Get your Bitbucket App Password")`;
				appPasswordInput.buttons = [infoButton];

				appPasswordInput.show();
			});
		} finally {
			appPasswordInput.dispose();
			disposables.forEach(d => void d.dispose());
		}

		if (!appPassword) return undefined;

		return {
			id: this.getSessionId(descriptor),
			accessToken: base64(`${bitbucketUsername}:${appPassword}`),
			scopes: descriptor?.scopes ?? [],
			account: {
				id: '',
				label: '',
			},
			cloud: false,
		};
	}
}

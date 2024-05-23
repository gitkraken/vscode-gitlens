import type { AuthenticationSession, Disposable, QuickInputButton } from 'vscode';
import { env, ThemeIcon, Uri, window } from 'vscode';
import { base64 } from '../../../system/string';
import type {
	IntegrationAuthenticationProvider,
	IntegrationAuthenticationSessionDescriptor,
} from './integrationAuthentication';

export class AzureDevOpsAuthenticationProvider implements IntegrationAuthenticationProvider {
	getSessionId(descriptor?: IntegrationAuthenticationSessionDescriptor): string {
		return descriptor?.domain ?? '';
	}

	async createSession(
		descriptor?: IntegrationAuthenticationSessionDescriptor,
	): Promise<AuthenticationSession | undefined> {
		let azureOrganization: string | undefined = descriptor?.organization as string | undefined;
		if (!azureOrganization) {
			const orgInput = window.createInputBox();
			orgInput.ignoreFocusOut = true;
			const orgInputDisposables: Disposable[] = [];
			try {
				azureOrganization = await new Promise<string | undefined>(resolve => {
					orgInputDisposables.push(
						orgInput.onDidHide(() => resolve(undefined)),
						orgInput.onDidChangeValue(() => (orgInput.validationMessage = undefined)),
						orgInput.onDidAccept(() => {
							const value = orgInput.value.trim();
							if (!value) {
								orgInput.validationMessage = 'An organization is required';
								return;
							}

							resolve(value);
						}),
					);

					orgInput.title = `Azure DevOps Authentication${
						descriptor?.domain ? `  \u2022 ${descriptor.domain}` : ''
					}`;
					orgInput.placeholder = 'Organization';
					orgInput.prompt = 'Enter your Azure DevOps organization';
					orgInput.show();
				});
			} finally {
				orgInput.dispose();
				orgInputDisposables.forEach(d => void d.dispose());
			}
		}

		if (!azureOrganization) return undefined;

		const tokenInput = window.createInputBox();
		tokenInput.ignoreFocusOut = true;

		const disposables: Disposable[] = [];

		let token;
		try {
			const infoButton: QuickInputButton = {
				iconPath: new ThemeIcon(`link-external`),
				tooltip: 'Open the Azure DevOps Access Tokens Page',
			};

			token = await new Promise<string | undefined>(resolve => {
				disposables.push(
					tokenInput.onDidHide(() => resolve(undefined)),
					tokenInput.onDidChangeValue(() => (tokenInput.validationMessage = undefined)),
					tokenInput.onDidAccept(() => {
						const value = tokenInput.value.trim();
						if (!value) {
							tokenInput.validationMessage = 'A personal access token is required';
							return;
						}

						resolve(value);
					}),
					tokenInput.onDidTriggerButton(e => {
						if (e === infoButton) {
							void env.openExternal(
								Uri.parse(
									`https://${
										descriptor?.domain ?? 'dev.azure.com'
									}/${azureOrganization}/_usersSettings/tokens`,
								),
							);
						}
					}),
				);

				tokenInput.password = true;
				tokenInput.title = `Azure DevOps Authentication${
					descriptor?.domain ? `  \u2022 ${descriptor.domain}` : ''
				}`;
				tokenInput.placeholder = `Requires ${descriptor?.scopes.join(', ') ?? 'all'} scopes`;
				tokenInput.prompt = `Paste your [Azure DevOps Personal Access Token](https://${
					descriptor?.domain ?? 'dev.azure.com'
				}/${azureOrganization}/_usersSettings/tokens "Get your Azure DevOps Access Token")`;
				tokenInput.buttons = [infoButton];

				tokenInput.show();
			});
		} finally {
			tokenInput.dispose();
			disposables.forEach(d => void d.dispose());
		}

		if (!token) return undefined;

		return {
			id: this.getSessionId(descriptor),
			accessToken: base64(`:${token}`),
			scopes: descriptor?.scopes ?? [],
			account: {
				id: '',
				label: '',
			},
		};
	}
}

import type { AuthenticationSession, Disposable, QuickInputButton } from 'vscode';
import { env, ThemeIcon, Uri, window } from 'vscode';
import { supportedInVSCodeVersion } from '../../../system/utils';
import type {
	IntegrationAuthenticationProvider,
	IntegrationAuthenticationSessionDescriptor,
} from './integrationAuthentication';

export class GitLabAuthenticationProvider implements IntegrationAuthenticationProvider {
	getSessionId(descriptor?: IntegrationAuthenticationSessionDescriptor): string {
		return descriptor?.domain ?? '';
	}

	async createSession(
		descriptor?: IntegrationAuthenticationSessionDescriptor,
	): Promise<AuthenticationSession | undefined> {
		const input = window.createInputBox();
		input.ignoreFocusOut = true;

		const disposables: Disposable[] = [];

		let token;
		try {
			const infoButton: QuickInputButton = {
				iconPath: new ThemeIcon(`link-external`),
				tooltip: 'Open the GitLab Access Tokens Page',
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
								Uri.parse(
									`https://${descriptor?.domain ?? 'gitlab.com'}/-/profile/personal_access_tokens`,
								),
							);
						}
					}),
				);

				input.password = true;
				input.title = `GitLab Authentication${descriptor?.domain ? `  \u2022 ${descriptor.domain}` : ''}`;
				input.placeholder = `Requires ${descriptor?.scopes.join(', ') ?? 'all'} scopes`;
				input.prompt = supportedInVSCodeVersion('input-prompt-links')
					? `Paste your [GitLab Personal Access Token](https://${
							descriptor?.domain ?? 'gitlab.com'
					  }/-/profile/personal_access_tokens "Get your GitLab Access Token")`
					: 'Paste your GitLab Personal Access Token';
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
}

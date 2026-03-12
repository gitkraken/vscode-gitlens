import type { Disposable, QuickInputButton } from 'vscode';
import { env, ThemeIcon, Uri, window } from 'vscode';
import type { Container } from '../container.js';
import { command } from '../system/-webview/command.js';
import { GlCommandBase } from './commandBase.js';

@command()
export class SetMergeMateApiKeyCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.setMergeMateApiKey');
	}

	async execute(): Promise<void> {
		const mergeMate = await this.container.mergeMate;
		if (mergeMate == null) return;

		const input = window.createInputBox();
		input.ignoreFocusOut = true;

		const disposables: Disposable[] = [];

		const clearButton: QuickInputButton = {
			iconPath: new ThemeIcon('trash'),
			tooltip: 'Clear Stored API Key',
		};

		const docsButton: QuickInputButton = {
			iconPath: new ThemeIcon('link-external'),
			tooltip: 'Open Merge Mate Documentation',
		};

		const existingKey = await mergeMate.getApiKey();

		try {
			const apiKey = await new Promise<string | undefined>(resolve => {
				disposables.push(
					input.onDidHide(() => resolve(undefined)),
					input.onDidAccept(() => {
						const value = input.value.trim();
						if (!value) {
							input.validationMessage = 'Please enter an API key';
							return;
						}
						resolve(value);
					}),
					input.onDidTriggerButton(e => {
						if (e === clearButton) {
							void mergeMate.deleteApiKey().then(
								() => {
									void window.showInformationMessage('Merge Mate API key has been removed.');
									resolve(undefined);
									input.hide();
								},
								() => {
									void window.showWarningMessage('Failed to remove Merge Mate API key.');
								},
							);
						} else if (e === docsButton) {
							void env.openExternal(Uri.parse('https://github.com/gitkraken/merge-mate-cli'));
						}
					}),
				);

				input.password = true;
				input.title = 'Merge Mate API Key';
				input.placeholder = existingKey
					? 'Enter a new API key to replace the existing one'
					: 'Enter your API key';
				input.prompt = 'Stored securely and passed to merge-mate via environment variable';
				input.buttons = existingKey ? [clearButton, docsButton] : [docsButton];

				input.show();
			});

			if (apiKey == null) return;

			await mergeMate.storeApiKey(apiKey);
			void window.showInformationMessage('Merge Mate API key has been saved.');
		} finally {
			input.dispose();
			disposables.forEach(d => void d.dispose());
		}
	}
}

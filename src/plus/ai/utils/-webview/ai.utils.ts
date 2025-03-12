import type { Disposable, QuickInputButton } from 'vscode';
import { env, ThemeIcon, Uri, window } from 'vscode';
import type { AIProviders } from '../../../../constants.ai';
import { configuration } from '../../../../system/-webview/configuration';
import type { Storage } from '../../../../system/-webview/storage';
import { formatNumeric } from '../../../../system/date';
import { getPossessiveForm } from '../../../../system/string';
import type { AIActionType, AIModel } from '../../models/model';

export function getActionName(action: AIActionType): string {
	switch (action) {
		case 'generate-commitMessage':
			return 'Generate Commit Message';
		case 'generate-stashMessage':
			return 'Generate Stash Message';
		case 'generate-changelog':
			return 'Generate Changelog';
		case 'generate-create-cloudPatch':
			return 'Create Cloud Patch Details';
		case 'generate-create-codeSuggestion':
			return 'Create Code Suggestion Details';
		case 'explain-changes':
			return 'Explain Changes';
		default:
			return 'Unknown Action';
	}
}

export function getMaxCharacters(model: AIModel, outputLength: number, overrideInputTokens?: number): number {
	const charactersPerToken = 3.1;
	const max = (overrideInputTokens ?? model.maxTokens.input) * charactersPerToken - outputLength / charactersPerToken;
	return Math.floor(max - max * 0.1);
}

export async function getOrPromptApiKey(
	storage: Storage,
	provider: { id: AIProviders; name: string; validator: (value: string) => boolean; url?: string },
): Promise<string | undefined> {
	let apiKey = await storage.getSecret(`gitlens.${provider.id}.key`);
	if (!apiKey) {
		const input = window.createInputBox();
		input.ignoreFocusOut = true;

		const disposables: Disposable[] = [];

		try {
			const infoButton: QuickInputButton = {
				iconPath: new ThemeIcon(`link-external`),
				tooltip: `Open the ${provider.name} API Key Page`,
			};

			apiKey = await new Promise<string | undefined>(resolve => {
				disposables.push(
					input.onDidHide(() => resolve(undefined)),
					input.onDidChangeValue(value => {
						if (value && !provider.validator(value)) {
							input.validationMessage = `Please enter a valid ${provider.name} API key`;
							return;
						}
						input.validationMessage = undefined;
					}),
					input.onDidAccept(() => {
						const value = input.value.trim();
						if (!value || !provider.validator(value)) {
							input.validationMessage = `Please enter a valid ${provider.name} API key`;
							return;
						}

						resolve(value);
					}),
					input.onDidTriggerButton(e => {
						if (e === infoButton && provider.url) {
							void env.openExternal(Uri.parse(provider.url));
						}
					}),
				);

				input.password = true;
				input.title = `Connect to ${provider.name}`;
				input.placeholder = `Please enter your ${provider.name} API key to use this feature`;
				input.prompt = `Enter your [${provider.name} API Key](${provider.url} "Get your ${provider.name} API key")`;
				if (provider.url) {
					input.buttons = [infoButton];
				}

				input.show();
			});
		} finally {
			input.dispose();
			disposables.forEach(d => void d.dispose());
		}

		if (!apiKey) return undefined;

		void storage.storeSecret(`gitlens.${provider.id}.key`, apiKey).catch();
	}

	return apiKey;
}

export function getValidatedTemperature(modelTemperature?: number | null): number | undefined {
	if (modelTemperature === null) return undefined;
	if (modelTemperature != null) return modelTemperature;
	return Math.max(0, Math.min(configuration.get('ai.modelOptions.temperature'), 2));
}

export function showDiffTruncationWarning(maxCodeCharacters: number, model: AIModel): void {
	void window.showWarningMessage(
		`The diff of the changes had to be truncated to ${formatNumeric(
			maxCodeCharacters,
		)} characters to fit within the ${getPossessiveForm(model.provider.name)} limits.`,
	);
}

export function showPromptTruncationWarning(maxCodeCharacters: number, model: AIModel): void {
	void window.showWarningMessage(
		`The prompt had to be truncated to ${formatNumeric(
			maxCodeCharacters,
		)} characters to fit within the ${getPossessiveForm(model.provider.name)} limits.`,
	);
}

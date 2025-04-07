import type { Disposable, QuickInputButton } from 'vscode';
import { env, ThemeIcon, Uri, window } from 'vscode';
import type { AIProviders } from '../../../../constants.ai';
import type { Container } from '../../../../container';
import { createDirectiveQuickPickItem, Directive } from '../../../../quickpicks/items/directive';
import { configuration } from '../../../../system/-webview/configuration';
import { openSettingsEditor } from '../../../../system/-webview/vscode/editors';
import { formatNumeric } from '../../../../system/date';
import { getPossessiveForm, pluralize } from '../../../../system/string';
import { ensureAccountQuickPick } from '../../../gk/utils/-webview/acount.utils';
import type { AIActionType, AIModel } from '../../models/model';

export function ensureAccount(container: Container, silent: boolean): Promise<boolean> {
	return ensureAccountQuickPick(
		container,
		createDirectiveQuickPickItem(Directive.Noop, undefined, {
			label: 'Use AI-powered GitLens features like Generate Commit Message, Explain Commit, and more',
			iconPath: new ThemeIcon('sparkle'),
		}),
		{ source: 'ai' },
		silent,
	);
}

export function getActionName(action: AIActionType): string {
	switch (action) {
		case 'generate-commitMessage':
			return 'Generate Commit Message';
		case 'generate-stashMessage':
			return 'Generate Stash Message';
		case 'generate-changelog':
			return 'Generate Changelog (Preview)';
		case 'generate-create-cloudPatch':
			return 'Create Cloud Patch Details';
		case 'generate-create-codeSuggestion':
			return 'Create Code Suggestion Details';
		case 'generate-create-pullRequest':
			return 'Create Pull Request Details (Preview)';
		case 'explain-changes':
			return 'Explain Changes';
		default:
			return 'Unknown Action';
	}
}

export const estimatedCharactersPerToken = 3.1;

export async function getOrPromptApiKey(
	container: Container,
	provider: {
		readonly id: AIProviders;
		readonly name: string;
		readonly requiresAccount: boolean;
		readonly validator: (value: string) => boolean;
		readonly url?: string;
	},
	silent?: boolean,
): Promise<string | undefined> {
	let apiKey = await container.storage.getSecret(`gitlens.${provider.id}.key`);
	if (apiKey) return apiKey;
	if (silent) return undefined;

	if (provider.requiresAccount) {
		const result = await ensureAccount(container, false);
		if (!result) return undefined;
	}

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

	void container.storage.storeSecret(`gitlens.${provider.id}.key`, apiKey).catch();

	return apiKey;
}

export function getValidatedTemperature(modelTemperature?: number | null): number | undefined {
	if (modelTemperature === null) return undefined;
	if (modelTemperature != null) return modelTemperature;
	return Math.max(0, Math.min(configuration.get('ai.modelOptions.temperature'), 2));
}

export async function showLargePromptWarning(estimatedTokens: number, threshold: number): Promise<boolean> {
	const confirm = { title: 'Continue' };
	const changeThreshold = { title: `Change Threshold` };
	const cancel = { title: 'Cancel', isCloseAffordance: true };
	const result = await window.showWarningMessage(
		`This request will use approximately ${pluralize(
			'token',
			estimatedTokens,
		)}, which exceeds the configured ${formatNumeric(
			threshold,
		)} token threshold for large prompts.\n\nDo you want to continue?`,
		{ modal: true },
		confirm,
		changeThreshold,
		cancel,
	);

	if (result === changeThreshold) {
		void openSettingsEditor({ query: 'gitlens.ai.largePromptWarningThreshold' });
	}
	return result === confirm;
}

export function showPromptTruncationWarning(model: AIModel): void {
	void window.showWarningMessage(
		`The prompt was truncated to fit within the ${getPossessiveForm(model.provider.name)} limits.`,
	);
}

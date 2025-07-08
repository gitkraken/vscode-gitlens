import type { Disposable, QuickInputButton } from 'vscode';
import { env, ThemeIcon, Uri, window } from 'vscode';
import { getMarkdownDocument } from '../../../../commands/aiFeedback';
import { Schemes } from '../../../../constants';
import type { AIProviders } from '../../../../constants.ai';
import type { Container } from '../../../../container';
import type { MarkdownContentMetadata } from '../../../../documents/markdown';
import { decodeGitLensRevisionUriAuthority } from '../../../../git/gitUri.authority';
import { createDirectiveQuickPickItem, Directive } from '../../../../quickpicks/items/directive';
import { configuration } from '../../../../system/-webview/configuration';
import { getContext } from '../../../../system/-webview/context';
import { openSettingsEditor } from '../../../../system/-webview/vscode/editors';
import { formatNumeric } from '../../../../system/date';
import { Logger } from '../../../../system/logger';
import { getPossessiveForm, pluralize } from '../../../../system/string';
import type { OrgAIConfig, OrgAIProvider } from '../../../gk/models/organization';
import { ensureAccountQuickPick } from '../../../gk/utils/-webview/acount.utils';
import type { AIResult, AIResultContext } from '../../aiProviderService';
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
		case 'explain-changes':
			return 'Explain Changes';
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
		case 'generate-rebase':
			return 'Generate Rebase (Preview)';
		case 'generate-searchQuery':
			return 'Generate Search Query (Preview)';
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
			input.prompt = `Enter your ${
				provider.url
					? `[${provider.name} API Key](${provider.url} "Get your ${provider.name} API key")`
					: `${provider.name} API Key`
			}`;
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

export function isAzureUrl(url: string): boolean {
	return url.includes('.azure.com');
}

export function getOrgAIConfig(): OrgAIConfig {
	return {
		aiEnabled: getContext('gitlens:gk:organization:ai:enabled', true),
		enforceAiProviders: getContext('gitlens:gk:organization:ai:enforceProviders', false),
		aiProviders: getContext('gitlens:gk:organization:ai:providers', {}),
	};
}

export function getOrgAIProviderOfType(type: AIProviders, orgAiConfig?: OrgAIConfig): OrgAIProvider {
	orgAiConfig ??= getOrgAIConfig();
	if (!orgAiConfig.aiEnabled) return { type: type, enabled: false };
	if (!orgAiConfig.enforceAiProviders) return { type: type, enabled: true };
	return orgAiConfig.aiProviders[type] ?? { type: type, enabled: false };
}

export function isProviderEnabledByOrg(type: AIProviders, orgAiConfig?: OrgAIConfig): boolean {
	return getOrgAIProviderOfType(type, orgAiConfig).enabled;
}

/**
 * If the input value (userUrl) matches to the org configuration it returns it.
 */
export function ensureOrgConfiguredUrl(type: AIProviders, userUrl: null | undefined | string): string | undefined {
	const provider = getOrgAIProviderOfType(type);
	if (!provider.enabled) return undefined;

	return provider.url || userUrl || undefined;
}

export async function ensureAccess(options?: { showPicker?: boolean }): Promise<boolean> {
	const showPicker = options?.showPicker ?? false;

	if (!getContext('gitlens:gk:organization:ai:enabled', true)) {
		if (showPicker) {
			await window.showQuickPick([{ label: 'OK' }], {
				title: 'AI is Disabled',
				placeHolder: 'GitLens AI features have been disabled by your GitKraken admin',
				canPickMany: false,
			});
		} else {
			await window.showErrorMessage(`AI features have been disabled by your GitKraken admin.`);
		}

		return false;
	}

	if (!configuration.get('ai.enabled')) {
		let reenable = false;
		if (showPicker) {
			const enable = { label: 'Re-enable AI Features' };
			const pick = await window.showQuickPick([{ label: 'OK' }, enable], {
				title: 'AI is Disabled',
				placeHolder: 'GitLens AI features have been disabled via settings',
				canPickMany: false,
			});
			if (pick === enable) {
				reenable = true;
			}
		} else {
			const enable = { title: 'Re-enable AI Features' };
			const result = await window.showErrorMessage(
				`AI features have been disabled via GitLens settings.`,
				{ modal: true },
				enable,
			);
			if (result === enable) {
				reenable = true;
			}
		}

		if (reenable) {
			await configuration.updateEffective('ai.enabled', true);
			return true;
		}

		return false;
	}

	return true;
}

export function getAIResultContext(result: AIResult): AIResultContext {
	return {
		id: result.id,
		type: result.type,
		feature: result.feature,
		model: result.model,
		usage:
			result.usage != null
				? {
						promptTokens: result.usage.promptTokens,
						completionTokens: result.usage.completionTokens,
						totalTokens: result.usage.totalTokens,
						limits:
							result.usage.limits != null
								? {
										used: result.usage.limits.used,
										limit: result.usage.limits.limit,
										resetsOn: result.usage.limits.resetsOn.toISOString(),
									}
								: undefined,
					}
				: undefined,
	};
}

export function extractAIResultContext(container: Container, uri: Uri | undefined): AIResultContext | undefined {
	if (uri?.scheme === Schemes.GitLensAIMarkdown) {
		const { authority } = uri;
		if (!authority) return undefined;

		try {
			const context: AIResultContext | undefined = getMarkdownDocument(uri.toString());
			if (context) return context;

			const metadata = decodeGitLensRevisionUriAuthority<MarkdownContentMetadata>(authority);
			return metadata.context;
		} catch (ex) {
			Logger.error(ex, 'extractResultContext');
			return undefined;
		}
	}

	// Check for untitled documents with stored changelog feedback context
	if (uri?.scheme === 'untitled') {
		try {
			return container.aiFeedback.getChangelogFeedback(uri.toString());
		} catch {
			return undefined;
		}
	}

	return undefined;
}

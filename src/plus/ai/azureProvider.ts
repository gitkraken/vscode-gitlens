import type { Disposable } from 'vscode';
import { window } from 'vscode';
import { azureProviderDescriptor as provider } from '../../constants.ai';
import { configuration } from '../../system/-webview/configuration';
import type { AIActionType, AIModel } from './models/model';
import { openAIModels } from './models/model';
import { OpenAICompatibleProviderBase } from './openAICompatibleProviderBase';
import { ensureOrgConfiguredUrl, getOrgAIProviderOfType, isAzureUrl } from './utils/-webview/ai.utils';

type AzureModel = AIModel<typeof provider.id>;
const models: AzureModel[] = openAIModels(provider);

export class AzureProvider extends OpenAICompatibleProviderBase<typeof provider.id> {
	readonly id = provider.id;
	readonly name = provider.name;
	protected readonly descriptor = provider;
	protected readonly config = {
		keyUrl: undefined,
		keyValidator: /(?:sk-)?[a-zA-Z0-9]{32,}/,
	};

	getModels(): Promise<readonly AIModel<typeof provider.id>[]> {
		return Promise.resolve(models);
	}

	protected getUrl(_model?: AIModel<typeof provider.id>): string | undefined {
		return ensureOrgConfiguredUrl(this.id, configuration.get('ai.azure.url'));
	}

	private async getOrPromptBaseUrl(silent: boolean, hasApiKey: boolean): Promise<string | undefined> {
		const orgConf = getOrgAIProviderOfType(this.id);
		if (!orgConf.enabled) return undefined;
		if (orgConf.url) return orgConf.url;

		let url: string | undefined = this.getUrl();

		if (silent || (url != null && hasApiKey)) return url;

		const input = window.createInputBox();
		input.ignoreFocusOut = true;
		if (url) {
			input.value = url;
		}

		const disposables: Disposable[] = [];

		try {
			url = await new Promise<string | undefined>(resolve => {
				disposables.push(
					input.onDidHide(() => resolve(undefined)),
					input.onDidChangeValue(value => {
						if (value) {
							try {
								new URL(value);
							} catch {
								input.validationMessage = `Please enter a valid URL`;
								return;
							}
						}
						input.validationMessage = undefined;
					}),
					input.onDidAccept(() => {
						const value = input.value.trim();
						if (!value) {
							input.validationMessage = `Please enter a valid URL`;
							return;
						}

						try {
							new URL(value);
						} catch {
							input.validationMessage = `Please enter a valid URL`;
							return;
						}

						if (!isAzureUrl(value)) {
							input.validationMessage = `Please enter a valid Azure OpenAI URL`;
							return;
						}

						resolve(value);
					}),
				);

				input.title = `Connect to Azure OpenAI Provider`;
				input.placeholder = `Please enter your provider's URL to use this feature`;
				input.prompt = `Enter your Azure OpenAI Provider URL`;

				input.show();
			});
		} finally {
			input.dispose();
			disposables.forEach(d => void d.dispose());
		}

		if (url) {
			void configuration.updateEffective('ai.azure.url', url);
		}

		return url;
	}

	override async configured(silent: boolean): Promise<boolean> {
		const hasApiKey = await super.configured(true);

		const url = await this.getOrPromptBaseUrl(silent, hasApiKey);
		if (!url) return false;

		return silent ? hasApiKey : super.configured(silent);
	}

	protected override getHeaders<TAction extends AIActionType>(
		_action: TAction,
		apiKey: string,
		_model: AIModel<typeof provider.id>,
		_url: string,
	): Record<string, string> | Promise<Record<string, string>> {
		return {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			'api-key': apiKey,
		};
	}
}

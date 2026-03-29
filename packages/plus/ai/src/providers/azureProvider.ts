import { azureProviderDescriptor as provider } from '../constants.js';
import type { AIActionType, AIModel } from '../models/model.js';
import { openAIModels } from '../models/model.js';
import { isAzureUrl } from '../utils/ai.utils.js';
import { OpenAICompatibleProviderBase } from './openAICompatibleProviderBase.js';

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
		const cfg = this.context.getProviderConfig(this.id);
		if (!cfg.enabled) return undefined;

		return cfg.url || undefined;
	}

	private async getOrPromptBaseUrl(silent: boolean, hasApiKey: boolean): Promise<string | undefined> {
		const cfg = this.context.getProviderConfig(this.id);
		if (!cfg.enabled) return undefined;

		if (cfg.url) return cfg.url;

		const url = this.getUrl();
		if (silent || (url != null && hasApiKey)) return url;

		return (
			(await this.context.getOrPromptUrl(
				this.id,
				{
					currentUrl: url,
					title: 'Connect to Azure OpenAI Provider',
					placeholder: `Please enter your provider's URL to use this feature`,
					validator: u => (isAzureUrl(u) ? undefined : 'Please enter a valid Azure OpenAI URL'),
				},
				silent,
			)) ?? url
		);
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

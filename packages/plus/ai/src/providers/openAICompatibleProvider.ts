import { openAICompatibleProviderDescriptor as provider } from '../constants.js';
import type { AIModel } from '../models/model.js';
import { openAIModels } from '../models/model.js';
import { isAzureUrl } from '../utils/ai.utils.js';
import { OpenAICompatibleProviderBase } from './openAICompatibleProviderBase.js';

type OpenAICompatibleModel = AIModel<typeof provider.id>;
const models: OpenAICompatibleModel[] = openAIModels(provider);

export class OpenAICompatibleProvider extends OpenAICompatibleProviderBase<typeof provider.id> {
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
		const orgConf = this.context.getProviderConfig(this.id);
		if (!orgConf.enabled) return undefined;
		if (orgConf.url) return orgConf.url;

		const url = this.getUrl();

		if (silent || (url != null && hasApiKey)) return url;

		return this.context.getOrPromptUrl(
			this.id,
			{
				currentUrl: url,
				title: 'Connect to OpenAI-Compatible Provider',
				placeholder: `Please enter your provider's URL to use this feature`,
				validator: u => (isAzureUrl(u) ? 'Use the Azure OpenAI provider instead' : undefined),
			},
			silent,
		);
	}

	override async configured(silent: boolean): Promise<boolean> {
		const hasApiKey = await super.configured(true);

		const url = await this.getOrPromptBaseUrl(silent, hasApiKey);
		if (!url || isAzureUrl(url)) return false;

		return silent ? hasApiKey : super.configured(silent);
	}
}

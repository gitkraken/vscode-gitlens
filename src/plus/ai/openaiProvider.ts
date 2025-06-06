import { openAIProviderDescriptor as provider } from '../../constants.ai';
import { configuration } from '../../system/-webview/configuration';
import type { AIActionType, AIModel } from './models/model';
import { openAIModels } from './models/model';
import { OpenAICompatibleProviderBase } from './openAICompatibleProviderBase';
import { ensureOrgConfiguredUrl, isAzureUrl } from './utils/-webview/ai.utils';

type OpenAIModel = AIModel<typeof provider.id>;
const models: OpenAIModel[] = openAIModels(provider);

export class OpenAIProvider extends OpenAICompatibleProviderBase<typeof provider.id> {
	readonly id = provider.id;
	readonly name = provider.name;
	protected readonly descriptor = provider;
	protected readonly config = {
		keyUrl: 'https://platform.openai.com/account/api-keys',
		keyValidator: /(?:sk-)?[a-zA-Z0-9]{32,}/,
	};

	getModels(): Promise<readonly AIModel<typeof provider.id>[]> {
		return Promise.resolve(models);
	}

	protected getUrl(_model: AIModel<typeof provider.id>): string {
		return (
			ensureOrgConfiguredUrl(this.id, configuration.get('ai.openai.url')) ||
			'https://api.openai.com/v1/chat/completions'
		);
	}

	protected override getHeaders<TAction extends AIActionType>(
		action: TAction,
		apiKey: string,
		model: AIModel<typeof provider.id>,
		url: string,
	): Record<string, string> | Promise<Record<string, string>> {
		if (isAzureUrl(url)) {
			return {
				Accept: 'application/json',
				'Content-Type': 'application/json',
				'api-key': apiKey,
			};
		}

		return super.getHeaders(action, apiKey, model, url);
	}
}

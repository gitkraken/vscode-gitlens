import type { CancellationToken } from 'vscode';
import type { AIModel } from './aiProviderService';
import { getMaxCharacters } from './aiProviderService';
import type { ChatMessage, SystemMessage } from './openAICompatibleProvider';
import { OpenAICompatibleProvider } from './openAICompatibleProvider';

const provider = { id: 'anthropic', name: 'Anthropic' } as const;

type AnthropicModel = AIModel<typeof provider.id>;

const models: AnthropicModel[] = [
	{
		id: 'claude-3-5-sonnet-latest',
		name: 'Claude 3.5 Sonnet',
		maxTokens: { input: 204800, output: 8192 },
		provider: provider,
	},
	{
		id: 'claude-3-5-sonnet-20240620',
		name: 'Claude 3.5 Sonnet',
		maxTokens: { input: 204800, output: 8192 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'claude-3-5-haiku-latest',
		name: 'Claude 3.5 Haiku',
		maxTokens: { input: 204800, output: 8192 },
		provider: provider,
	},
	{
		id: 'claude-3-5-haiku-20241022',
		name: 'Claude 3.5 Haiku',
		maxTokens: { input: 204800, output: 8192 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'claude-3-opus-latest',
		name: 'Claude 3 Opus',
		maxTokens: { input: 204800, output: 4096 },
		provider: provider,
	},
	{
		id: 'claude-3-opus-20240229',
		name: 'Claude 3 Opus',
		maxTokens: { input: 204800, output: 4096 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'claude-3-sonnet-20240229',
		name: 'Claude 3 Sonnet',
		maxTokens: { input: 204800, output: 4096 },
		provider: provider,
	},
	{
		id: 'claude-3-haiku-20240307',
		name: 'Claude 3 Haiku',
		maxTokens: { input: 204800, output: 4096 },
		provider: provider,
		default: true,
	},
	{
		id: 'claude-2.1',
		name: 'Claude 2.1',
		maxTokens: { input: 204800, output: 4096 },
		provider: provider,
	},
];

export class AnthropicProvider extends OpenAICompatibleProvider<typeof provider.id> {
	readonly id = provider.id;
	readonly name = provider.name;
	protected readonly config = {
		keyUrl: 'https://console.anthropic.com/account/keys',
		keyValidator: /(?:sk-)?[a-zA-Z0-9-_]{32,}/,
	};

	getModels(): Promise<readonly AIModel<typeof provider.id>[]> {
		return Promise.resolve(models);
	}

	protected getUrl(_model: AIModel<typeof provider.id>): string {
		return 'https://api.anthropic.com/v1/messages';
	}

	protected override getHeaders(
		_model: AIModel<typeof provider.id>,
		_url: string,
		apiKey: string,
	): Record<string, string> {
		return {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			Authorization: `Bearer ${apiKey}`,
			'x-api-key': apiKey,
			'anthropic-version': '2023-06-01',
		};
	}

	override async fetch(
		model: AIModel<typeof provider.id>,
		apiKey: string,
		messages: (maxCodeCharacters: number, retries: number) => [SystemMessage, ...ChatMessage[]],
		outputTokens: number,
		cancellation: CancellationToken | undefined,
	): Promise<[result: string, maxCodeCharacters: number]> {
		let retries = 0;
		let maxCodeCharacters = getMaxCharacters(model, 2600);

		while (true) {
			// Split the system message from the rest of the messages
			const [system, ...msgs] = messages(maxCodeCharacters, retries);

			const request: AnthropicMessageRequest = {
				model: model.id,
				messages: msgs,
				system: system.content,
				stream: false,
				max_tokens: Math.min(outputTokens, model.maxTokens.output),
			};

			const rsp = await this.fetchCore(model, apiKey, request, cancellation);
			if (!rsp.ok) {
				if (rsp.status === 404) {
					throw new Error(`Your API key doesn't seem to have access to the selected '${model.id}' model`);
				}
				if (rsp.status === 429) {
					throw new Error(
						`(${this.name}:${rsp.status}) Too many requests (rate limit exceeded) or your API key is associated with an expired trial`,
					);
				}

				let json;
				try {
					json = (await rsp.json()) as AnthropicError | undefined;
				} catch {}

				debugger;

				if (
					retries++ < 2 &&
					json?.error?.type === 'invalid_request_error' &&
					json?.error?.message?.includes('prompt is too long')
				) {
					maxCodeCharacters -= 500 * retries;
					continue;
				}

				throw new Error(`(${this.name}:${rsp.status}) ${json?.error?.message || rsp.statusText})`);
			}

			const data: AnthropicMessageResponse = await rsp.json();
			const result = data.content
				.map(c => c.text)
				.join('\n')
				.trim();
			return [result, maxCodeCharacters];
		}
	}
}

interface AnthropicError {
	type: 'error';
	error: {
		type:
			| 'invalid_request_error'
			| 'authentication_error'
			| 'permission_error'
			| 'not_found_error'
			| 'rate_limit_error'
			| 'api_error'
			| 'overloaded_error';
		message: string;
	};
}

interface AnthropicMessageRequest {
	model: AnthropicModel['id'];
	messages: ChatMessage[];
	system?: string;

	max_tokens: number;
	metadata?: object;
	stop_sequences?: string[];
	stream?: boolean;
	temperature?: number;
	top_p?: number;
	top_k?: number;
}

interface AnthropicMessageResponse {
	id: string;
	type: 'message';
	role: 'assistant';
	content: { type: 'text'; text: string }[];
	model: string;
	stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence';
	stop_sequence: string | null;
	usage: {
		input_tokens: number;
		output_tokens: number;
	};
}

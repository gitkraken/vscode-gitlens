import type { CancellationToken } from 'vscode';
import type { Response } from '@env/fetch';
import { mistralProviderDescriptor as provider } from '../../constants.ai';
import { AIError, AIErrorReason } from '../../errors';
import type { AIActionType, AIModel } from './models/model';
import { OpenAICompatibleProviderBase } from './openAICompatibleProviderBase';

type MistralModel = AIModel<typeof provider.id>;
const models: MistralModel[] = [
	{
		id: 'mistral-medium-latest',
		name: 'Mistral Medium',
		maxTokens: { input: 131072, output: 4096 },
		provider: provider,
	},
	{
		id: 'mistral-medium-2505',
		name: 'Mistral Medium',
		maxTokens: { input: 131072, output: 4096 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'codestral-latest',
		name: 'Codestral',
		maxTokens: { input: 262144, output: 4096 },
		provider: provider,
		default: true,
	},
	{
		id: 'codestral-2501',
		name: 'Codestral',
		maxTokens: { input: 262144, output: 4096 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'mistral-large-latest',
		name: 'Mistral Large',
		maxTokens: { input: 131072, output: 4096 },
		provider: provider,
	},
	{
		id: 'mistral-large-2411',
		name: 'Mistral Large',
		maxTokens: { input: 131072, output: 4096 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'devstral-small-latest',
		name: 'Devstral Small',
		maxTokens: { input: 131072, output: 4096 },
		provider: provider,
	},
	{
		id: 'devstral-small-2505',
		name: 'Devstral Small',
		maxTokens: { input: 131072, output: 4096 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'mistral-small-latest',
		name: 'Mistral Small',
		maxTokens: { input: 131072, output: 4096 },
		provider: provider,
	},
	{
		id: 'mistral-small-2503',
		name: 'Mistral Small',
		maxTokens: { input: 131072, output: 4096 },
		provider: provider,
		hidden: true,
	},
];

export class MistralProvider extends OpenAICompatibleProviderBase<typeof provider.id> {
	readonly id = provider.id;
	readonly name = provider.name;
	protected readonly descriptor = provider;
	protected readonly config = {
		keyUrl: 'https://console.mistral.ai/api-keys',
		keyValidator: /^[a-zA-Z0-9]{32}$/,
	};

	getModels(): Promise<readonly AIModel<typeof provider.id>[]> {
		return Promise.resolve(models);
	}

	protected getUrl(_model: AIModel<typeof provider.id>): string {
		return 'https://api.mistral.ai/v1/chat/completions';
	}

	protected override fetchCore<TAction extends AIActionType>(
		action: TAction,
		model: AIModel<typeof provider.id>,
		apiKey: string,
		request: object,
		cancellation: CancellationToken | undefined,
	): Promise<Response> {
		if ('max_completion_tokens' in request) {
			const { max_completion_tokens: max, ...rest } = request;
			request = max ? { max_tokens: max, ...rest } : rest;
		}
		return super.fetchCore(action, model, apiKey, request, cancellation);
	}

	protected override async handleFetchFailure<TAction extends AIActionType>(
		rsp: Response,
		action: TAction,
		model: AIModel<typeof provider.id>,
		retries: number,
		maxInputTokens: number,
	): Promise<{ retry: true; maxInputTokens: number }> {
		if (rsp.status !== 404 && rsp.status !== 429) {
			let json;
			try {
				json = (await rsp.json()) as MistralError | undefined;
			} catch {}

			debugger;

			const message = `${json?.type}: ${json?.message?.detail
				?.map(d => `${d.msg} (${d.type} @ ${d.loc.join(',')})`)
				.join(', ')}`;

			if (json?.type === 'invalid_request_error') {
				if (message?.includes('prompt is too long')) {
					if (retries < 2) {
						return { retry: true, maxInputTokens: maxInputTokens - 200 * (retries || 1) };
					}

					throw new AIError(
						AIErrorReason.RequestTooLarge,
						new Error(`(${this.name}) ${rsp.status}: ${message || rsp.statusText}`),
					);
				}
			}

			throw new Error(`(${this.name}) ${rsp.status}: ${message || rsp.statusText}`);
		}

		return super.handleFetchFailure(rsp, action, model, retries, maxInputTokens);
	}
}

interface MistralError {
	object: 'error';
	type: 'invalid_request_error' | string;
	message: {
		detail: {
			type: string;
			msg: string;
			loc: string[];
			input: number;
		}[];
	};
	code: unknown | null;
	param: unknown | null;
}

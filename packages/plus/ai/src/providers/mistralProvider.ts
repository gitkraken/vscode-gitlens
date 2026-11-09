import { mistralProviderDescriptor as provider } from '../constants.js';
import { AIError, AIErrorReason } from '../errors.js';
import type { AIActionType, AIModel } from '../models/model.js';
import { getReducedMaxInputTokens } from '../utils/ai.utils.js';
import { OpenAICompatibleProviderBase } from './openAICompatibleProviderBase.js';

type MistralModel = AIModel<typeof provider.id>;
const models: MistralModel[] = [
	{
		id: 'mistral-large-4',
		name: 'Mistral Large 4',
		maxTokens: { input: 1000000, output: 4096 },
		provider: provider,
	},
	{
		id: 'zai-glm-5-3',
		name: 'GLM 5.3',
		maxTokens: { input: 1000000, output: 128000 },
		provider: provider,
	},
	{
		id: 'zai-glm-5-3-flash',
		name: 'GLM 5.3 Flash',
		maxTokens: { input: 1000000, output: 128000 },
		provider: provider,
	},
	{
		id: 'mistral-medium-latest',
		name: 'Mistral Medium (latest)',
		maxTokens: { input: 262144, output: 4096 },
		provider: provider,
	},
	{
		id: 'mistral-medium-3-5',
		name: 'Mistral Medium 3.5',
		maxTokens: { input: 262144, output: 4096 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'mistral-small-latest',
		name: 'Mistral Small (latest)',
		maxTokens: { input: 262144, output: 4096 },
		provider: provider,
		default: true,
	},
	{
		id: 'mistral-small-2603',
		name: 'Mistral Small 4',
		maxTokens: { input: 262144, output: 4096 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'mistral-large-latest',
		name: 'Mistral Large (latest)',
		maxTokens: { input: 262144, output: 4096 },
		provider: provider,
	},
	{
		id: 'mistral-large-2512',
		name: 'Mistral Large 3',
		maxTokens: { input: 262144, output: 4096 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'ministral-14b-latest',
		name: 'Ministral 14B (latest)',
		maxTokens: { input: 262144, output: 4096 },
		provider: provider,
	},
	{
		id: 'ministral-14b-2512',
		name: 'Ministral 3 14B',
		maxTokens: { input: 262144, output: 4096 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'ministral-8b-latest',
		name: 'Ministral 8B (latest)',
		maxTokens: { input: 262144, output: 4096 },
		provider: provider,
	},
	{
		id: 'ministral-8b-2512',
		name: 'Ministral 3 8B',
		maxTokens: { input: 262144, output: 4096 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'ministral-3b-latest',
		name: 'Ministral 3B (latest)',
		maxTokens: { input: 262144, output: 4096 },
		provider: provider,
	},
	{
		id: 'ministral-3b-2512',
		name: 'Ministral 3 3B',
		maxTokens: { input: 262144, output: 4096 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'codestral-latest',
		name: 'Codestral (latest)',
		maxTokens: { input: 131072, output: 4096 },
		provider: provider,
	},
	{
		id: 'codestral-2508',
		name: 'Codestral',
		maxTokens: { input: 131072, output: 4096 },
		provider: provider,
		hidden: true,
	},
];

export class MistralProvider extends OpenAICompatibleProviderBase<typeof provider.id> {
	readonly id = provider.id;
	readonly name = provider.name;
	readonly supportsTools = true;
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
		signal: AbortSignal | undefined,
	): Promise<Response> {
		if ('max_completion_tokens' in request) {
			const { max_completion_tokens: max, ...rest } = request;
			request = max ? { max_tokens: max, ...rest } : rest;
		}
		return super.fetchCore(action, model, apiKey, request, signal);
	}

	protected override async handleFetchFailure<TAction extends AIActionType>(
		rsp: Response,
		action: TAction,
		model: AIModel<typeof provider.id>,
		retries: number,
		maxInputTokens: number,
		body?: string,
		sentTools?: boolean,
	): Promise<{ retry: true; maxInputTokens: number; withoutTools?: boolean }> {
		// 401/403 fall through to the base, which maps them to `AIError(Unauthorized)`
		if (rsp.status !== 404 && rsp.status !== 429 && rsp.status !== 401 && rsp.status !== 403) {
			let json;
			try {
				json = (body != null ? JSON.parse(body) : await rsp.json()) as MistralError | undefined;
			} catch {}

			debugger;

			const message = `${json?.type}: ${json?.message?.detail
				?.map(d => `${d.msg} (${d.type} @ ${d.loc.join(',')})`)
				.join(', ')}`;

			if (json?.type === 'invalid_request_error') {
				if (message?.includes('prompt is too long')) {
					if (retries < 3) {
						return { retry: true, maxInputTokens: getReducedMaxInputTokens(maxInputTokens, retries + 1) };
					}

					throw new AIError(
						AIErrorReason.RequestTooLarge,
						new Error(`(${this.name}) ${rsp.status}: ${message || rsp.statusText}`),
					);
				}
			}

			// This override throws for every non-404/429 status, so the base class's tools-rejection
			// recovery would never run for Mistral — check it here to keep the text-only fallback
			if (sentTools && this.isToolsRejection(rsp.status, message)) {
				return { retry: true, maxInputTokens: maxInputTokens, withoutTools: true };
			}

			throw new Error(`(${this.name}) ${rsp.status}: ${message || rsp.statusText}`);
		}

		return super.handleFetchFailure(rsp, action, model, retries, maxInputTokens, body, sentTools);
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

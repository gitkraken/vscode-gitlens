import { anthropicProviderDescriptor as provider } from '../constants.js';
import { AIError, AIErrorReason } from '../errors.js';
import type { AIActionType, AIModel } from '../models/model.js';
import type { AIChatMessage, AIChatMessageRole, AIResponseFormat, AIToolDefinition } from '../models/provider.js';
import { getReducedMaxInputTokens } from '../utils/ai.utils.js';
import type { ChatCompletionRequest } from './openAICompatibleProviderBase.js';
import { OpenAICompatibleProviderBase } from './openAICompatibleProviderBase.js';

type AnthropicModel = AIModel<typeof provider.id>;
const models: AnthropicModel[] = [
	{
		id: 'claude-opus-5',
		name: 'Claude Opus 5',
		maxTokens: { input: 1000000, output: 128000 },
		provider: provider,
		temperature: null, // Sampling params removed on Opus 4.7+/Sonnet 5 (rejected with 400)
	},
	{
		id: 'claude-fable-5',
		name: 'Claude Fable 5',
		maxTokens: { input: 1000000, output: 128000 },
		provider: provider,
		// Requires 30-day data retention; ZDR orgs get a 400 on every request
		temperature: null, // Sampling params removed on Opus 4.7+/Sonnet 5 (rejected with 400)
	},
	{
		id: 'claude-sonnet-5',
		name: 'Claude Sonnet 5',
		maxTokens: { input: 1000000, output: 128000 },
		provider: provider,
		temperature: null, // Sampling params removed on Opus 4.7+/Sonnet 5 (rejected with 400)
	},
	{
		id: 'claude-opus-4-8',
		name: 'Claude Opus 4.8',
		maxTokens: { input: 1000000, output: 128000 },
		provider: provider,
		temperature: null, // Sampling params removed on Opus 4.7+/Sonnet 5 (rejected with 400)
	},
	{
		id: 'claude-opus-4-7',
		name: 'Claude Opus 4.7',
		maxTokens: { input: 1000000, output: 128000 },
		provider: provider,
		temperature: null, // Sampling params removed on Opus 4.7+/Sonnet 5 (rejected with 400)
	},
	{
		id: 'claude-sonnet-4-6',
		name: 'Claude Sonnet 4.6',
		maxTokens: { input: 1000000, output: 128000 },
		provider: provider,
	},
	{
		id: 'claude-opus-4-6',
		name: 'Claude Opus 4.6',
		maxTokens: { input: 1000000, output: 128000 },
		provider: provider,
	},
	{
		id: 'claude-haiku-4-5',
		name: 'Claude Haiku 4.5',
		maxTokens: { input: 200000, output: 64000 },
		provider: provider,
		default: true,
	},
	{
		id: 'claude-haiku-4-5-20251001',
		name: 'Claude Haiku 4.5',
		maxTokens: { input: 200000, output: 64000 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'claude-sonnet-4-5',
		name: 'Claude Sonnet 4.5',
		maxTokens: { input: 200000, output: 64000 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'claude-sonnet-4-5-20250929',
		name: 'Claude Sonnet 4.5',
		maxTokens: { input: 200000, output: 64000 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'claude-opus-4-5',
		name: 'Claude Opus 4.5',
		maxTokens: { input: 200000, output: 64000 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'claude-opus-4-5-20251101',
		name: 'Claude Opus 4.5',
		maxTokens: { input: 200000, output: 64000 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'claude-opus-4-1',
		name: 'Claude Opus 4.1',
		maxTokens: { input: 200000, output: 32000 },
		provider: provider,
		hidden: true,
		// Structured outputs require the 4.5 generation or newer (this and every entry below)
		supportsStructuredOutputs: false,
	},
	{
		id: 'claude-opus-4-1-20250805',
		name: 'Claude Opus 4.1',
		maxTokens: { input: 200000, output: 32000 },
		provider: provider,
		hidden: true,
		supportsStructuredOutputs: false,
	},
	{
		id: 'claude-opus-4-0',
		name: 'Claude Opus 4',
		maxTokens: { input: 200000, output: 32000 },
		provider: provider,
		hidden: true,
		supportsStructuredOutputs: false,
	},
	{
		id: 'claude-opus-4-20250514',
		name: 'Claude Opus 4',
		maxTokens: { input: 200000, output: 32000 },
		provider: provider,
		hidden: true,
		supportsStructuredOutputs: false,
	},
	{
		id: 'claude-sonnet-4-0',
		name: 'Claude Sonnet 4',
		maxTokens: { input: 200000, output: 64000 },
		provider: provider,
		hidden: true,
		supportsStructuredOutputs: false,
	},
	{
		id: 'claude-sonnet-4-20250514',
		name: 'Claude Sonnet 4',
		maxTokens: { input: 200000, output: 64000 },
		provider: provider,
		hidden: true,
		supportsStructuredOutputs: false,
	},
	{
		id: 'claude-3-7-sonnet-latest',
		name: 'Claude Sonnet 3.7',
		maxTokens: { input: 200000, output: 64000 },
		provider: provider,
		hidden: true,
		supportsStructuredOutputs: false,
	},
	{
		id: 'claude-3-7-sonnet-20250219',
		name: 'Claude Sonnet 3.7',
		maxTokens: { input: 200000, output: 64000 },
		provider: provider,
		hidden: true,
		supportsStructuredOutputs: false,
	},
	{
		id: 'claude-3-5-sonnet-latest',
		name: 'Claude Sonnet 3.5',
		maxTokens: { input: 200000, output: 8192 },
		provider: provider,
		hidden: true,
		supportsStructuredOutputs: false,
	},
	{
		id: 'claude-3-5-sonnet-20241022',
		name: 'Claude Sonnet 3.5',
		maxTokens: { input: 200000, output: 8192 },
		provider: provider,
		hidden: true,
		supportsStructuredOutputs: false,
	},
	{
		id: 'claude-3-5-sonnet-20240620',
		name: 'Claude Sonnet 3.5',
		maxTokens: { input: 200000, output: 8192 },
		provider: provider,
		hidden: true,
		supportsStructuredOutputs: false,
	},
	{
		id: 'claude-3-5-haiku-latest',
		name: 'Claude Haiku 3.5',
		maxTokens: { input: 200000, output: 8192 },
		provider: provider,
		hidden: true,
		supportsStructuredOutputs: false,
	},
	{
		id: 'claude-3-5-haiku-20241022',
		name: 'Claude Haiku 3.5',
		maxTokens: { input: 200000, output: 8192 },
		provider: provider,
		hidden: true,
		supportsStructuredOutputs: false,
	},
	{
		id: 'claude-3-opus-latest',
		name: 'Claude Opus 3',
		maxTokens: { input: 200000, output: 4096 },
		provider: provider,
		hidden: true,
		supportsStructuredOutputs: false,
	},
	{
		id: 'claude-3-opus-20240229',
		name: 'Claude Opus 3',
		maxTokens: { input: 200000, output: 4096 },
		provider: provider,
		hidden: true,
		supportsStructuredOutputs: false,
	},
	{
		id: 'claude-3-sonnet-latest',
		name: 'Claude Sonnet 3',
		maxTokens: { input: 200000, output: 4096 },
		provider: provider,
		hidden: true,
		supportsStructuredOutputs: false,
	},
	{
		id: 'claude-3-sonnet-20240229',
		name: 'Claude Sonnet 3',
		maxTokens: { input: 200000, output: 4096 },
		provider: provider,
		hidden: true,
		supportsStructuredOutputs: false,
	},
	{
		id: 'claude-3-haiku-latest',
		name: 'Claude Haiku 3',
		maxTokens: { input: 200000, output: 4096 },
		provider: provider,
		hidden: true,
		supportsStructuredOutputs: false,
	},
	{
		id: 'claude-3-haiku-20240307',
		name: 'Claude Haiku 3',
		maxTokens: { input: 200000, output: 4096 },
		provider: provider,
		hidden: true,
		supportsStructuredOutputs: false,
	},
	{
		id: 'claude-2.1',
		name: 'Claude 2.1',
		maxTokens: { input: 200000, output: 4096 },
		provider: provider,
		hidden: true,
		supportsStructuredOutputs: false,
	},
];

export class AnthropicProvider extends OpenAICompatibleProviderBase<typeof provider.id> {
	readonly id = provider.id;
	readonly name = provider.name;
	readonly supportsTools = true;
	protected readonly descriptor = provider;
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

	// Anthropic uses `output_config.format` (no name/strict — enforcement is unconditional) and
	// rejects unknown fields, so this must fully replace the base's `response_format` translation
	protected override applyResponseFormat(
		request: ChatCompletionRequest,
		_model: AIModel<typeof provider.id>,
		responseFormat: AIResponseFormat,
	): void {
		request.output_config = { format: { type: 'json_schema', schema: responseFormat.schema } };
	}

	protected override getHeaders<TAction extends AIActionType>(
		_action: TAction,
		apiKey: string,
		_model: AIModel<typeof provider.id>,
		_url: string,
	): Record<string, string> {
		return {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			Authorization: `Bearer ${apiKey}`,
			'x-api-key': apiKey,
			'anthropic-version': '2023-06-01',
		};
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

	protected override extractSystemPrompt(messages: AIChatMessage<AIChatMessageRole>[]): {
		messages: AIChatMessage<AIChatMessageRole>[];
		system?: string;
	} {
		// Anthropic's Messages API rejects `system`-role entries in `messages` and requires the initial
		// system prompt in the top-level `system` field, so pull any such messages out.
		const systemMessages = messages.filter(m => m.role === 'system');
		if (!systemMessages.length) return { messages: messages };

		return {
			system: systemMessages.map(m => m.content).join('\n\n'),
			messages: messages.filter(m => m.role !== 'system'),
		};
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
		if (rsp.status !== 404 && rsp.status !== 429) {
			// Read into `body` (not the response) so `super.handleFetchFailure` below can still
			// use it; consuming the response here would lose Anthropic's error for the fallback.
			body ??= await rsp
				.clone()
				.text()
				.catch(() => undefined);
			let json;
			try {
				json = (body != null ? JSON.parse(body) : undefined) as AnthropicError | undefined;
			} catch {}

			debugger;

			if (json?.error?.type === 'invalid_request_error') {
				if (json?.error?.message?.includes('prompt is too long')) {
					if (retries < 3) {
						// Extract actual token count from error to calculate smarter reduction
						const match = /prompt is too long: (\d+) tokens/.exec(json?.error?.message);
						const estimatedTokens = match?.[1] != null ? parseInt(match[1], 10) : undefined;

						return {
							retry: true,
							maxInputTokens: getReducedMaxInputTokens(maxInputTokens, retries + 1, estimatedTokens),
						};
					}

					throw new AIError(
						AIErrorReason.RequestTooLarge,
						new Error(`(${this.name}) ${rsp.status}: ${json?.error?.message || rsp.statusText}`),
					);
				}

				if (json?.error?.message?.includes('balance is too low')) {
					throw new AIError(
						AIErrorReason.RateLimitOrFundsExceeded,
						new Error(`(${this.name}) ${rsp.status}: ${json?.error?.message || rsp.statusText}`),
					);
				}
			}
		}

		return super.handleFetchFailure(rsp, action, model, retries, maxInputTokens, body, sentTools);
	}

	protected override serializeTools(tools: readonly AIToolDefinition[]): { tools: unknown[] } {
		// Anthropic names the schema field `input_schema` and has no `function` envelope.
		return {
			tools: tools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters })),
		};
	}

	protected override serializeMessages(messages: AIChatMessage<AIChatMessageRole>[]): unknown[] {
		const out: unknown[] = [];

		for (const m of messages) {
			// Anthropic carries tool results as `tool_result` blocks on a *user* message, not a
			// `tool`-role message. Consecutive results are batched into one user turn, matching how the
			// API expects a multi-tool-call round to be answered.
			if (m.role === 'tool') {
				// See the base provider: a result with no call id can't be addressed, so it goes as plain
				// text instead of a `tool_use_id: undefined` block the API rejects.
				if (m.toolCallId == null) {
					out.push({ role: 'user', content: m.content });
					continue;
				}

				const block = { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content };
				const last = out.at(-1) as { role?: string; content?: unknown[] } | undefined;
				if (last?.role === 'user' && Array.isArray(last.content) && isToolResultBlocks(last.content)) {
					last.content.push(block);
				} else {
					out.push({ role: 'user', content: [block] });
				}
				continue;
			}

			if (m.role === 'assistant' && m.toolCalls?.length) {
				out.push({
					role: 'assistant',
					content: [
						...(m.content ? [{ type: 'text', text: m.content }] : []),
						...m.toolCalls.map(c => ({ type: 'tool_use', id: c.id, name: c.name, input: c.args })),
					],
				});
				continue;
			}

			out.push({ role: m.role, content: m.content });
		}

		return out;
	}
}

/** Whether an assembled user message's content is a batch of `tool_result` blocks we can append to. */
function isToolResultBlocks(content: unknown[]): content is { type: string }[] {
	return content.every(b => (b as { type?: string })?.type === 'tool_result');
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

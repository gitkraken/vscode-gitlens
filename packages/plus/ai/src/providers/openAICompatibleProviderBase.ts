import { CancellationError, isCancellationError } from '@gitlens/utils/cancellation.js';
import { uuid } from '@gitlens/utils/crypto.js';
import { getLoggableName } from '@gitlens/utils/logger.js';
import { maybeStartScopedLogger } from '@gitlens/utils/logger.scoped.js';
import type { AIProviders } from '../constants.js';
import { AIError, AIErrorReason } from '../errors.js';
import type { AIActionType, AIModel, AIProviderDescriptor } from '../models/model.js';
import type {
	AIChatMessage,
	AIChatMessageRole,
	AIProvider,
	AIProviderResponse,
	AIToolCall,
	AIToolDefinition,
} from '../models/provider.js';
import { getActionName, getReducedMaxInputTokens, getValidatedTemperature } from '../utils/ai.utils.js';
import type { AIProviderContext } from './context.js';

export abstract class OpenAICompatibleProviderBase<T extends AIProviders> implements AIProvider<T> {
	constructor(protected readonly context: AIProviderContext) {}

	dispose(): void {}
	[Symbol.dispose](): void {
		this.dispose();
	}

	abstract readonly id: T;
	abstract readonly name: string;
	protected abstract readonly descriptor: AIProviderDescriptor<T>;
	protected abstract readonly config: { keyUrl?: string; keyValidator?: RegExp };

	async configured(silent: boolean): Promise<boolean> {
		try {
			const apiKey = await this.getApiKey(silent);
			return apiKey != null;
		} catch (ex) {
			if (isCancellationError(ex)) return false;

			throw ex;
		}
	}

	async getApiKey(silent: boolean): Promise<string | undefined> {
		const orgConf = this.context.getProviderConfig(this.id);
		if (!orgConf.enabled) return undefined;
		if (orgConf.key) return orgConf.key;

		const { keyUrl, keyValidator } = this.config;

		return this.context.getApiKey(
			{
				id: this.id,
				name: this.name,
				requiresAccount: this.descriptor.requiresAccount,
				validator: keyValidator != null ? v => keyValidator.test(v) : () => true,
				url: keyUrl,
			},
			silent,
		);
	}

	abstract getModels(): Promise<readonly AIModel<T>[]>;

	protected abstract getUrl(_model: AIModel<T>): string | undefined;

	protected getHeaders<TAction extends AIActionType>(
		_action: TAction,
		apiKey: string,
		_model: AIModel<T>,
		_url: string,
		// Deliberately unused here: only the GitKraken provider forwards the conversation ID (as
		// `GK-Conversation-ID`); it must never reach third-party APIs.
		_conversationId?: string,
	): Record<string, string> | Promise<Record<string, string>> {
		return {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			Authorization: `Bearer ${apiKey}`,
		};
	}

	async sendRequest<TAction extends AIActionType>(
		action: TAction,
		model: AIModel<T>,
		apiKey: string,
		getMessages: (maxInputTokens: number, retries: number) => Promise<AIChatMessage<AIChatMessageRole>[]>,
		options: {
			signal: AbortSignal;
			modelOptions?: { outputTokens?: number; temperature?: number };
			conversationId?: string;
			tools?: readonly AIToolDefinition[];
		},
	): Promise<AIProviderResponse<void> | undefined> {
		using scope = maybeStartScopedLogger(`${getLoggableName(this)}.sendRequest`);

		try {
			const result = await this.fetch(
				action,
				model,
				apiKey,
				getMessages,
				options.modelOptions,
				options.signal,
				options.conversationId,
				options.tools,
			);
			return result;
		} catch (ex) {
			if (isCancellationError(ex)) {
				scope?.error(ex, `Cancelled request to ${getActionName(action)}: (${model.provider.name})`);
				throw ex;
			}

			scope?.error(ex, `Unable to ${getActionName(action)}: (${model.provider.name})`);
			if (ex instanceof AIError) throw ex;

			debugger;
			throw new Error(`Unable to ${getActionName(action)}: (${model.provider.name}) ${ex.message}`, {
				cause: ex,
			});
		}
	}

	protected async fetch<TAction extends AIActionType>(
		action: TAction,
		model: AIModel<T>,
		apiKey: string,
		messages: (maxInputTokens: number, retries: number) => Promise<AIChatMessage<AIChatMessageRole>[]>,
		modelOptions?: { outputTokens?: number; temperature?: number },
		signal?: AbortSignal,
		conversationId?: string,
		tools?: readonly AIToolDefinition[],
	): Promise<AIProviderResponse<void>> {
		let retries = 0;
		let maxInputTokens = model.maxTokens.input;
		// Latched when the provider rejects the `tools` field, so the retry drops tools entirely and
		// the caller can stop offering them for the rest of the session.
		let toolsRejected = false;

		while (true) {
			const useTools = tools?.length && !toolsRejected ? tools : undefined;
			const { messages: msgs, system } = this.extractSystemPrompt(await messages(maxInputTokens, retries));
			const request: ChatCompletionRequest = {
				model: model.id,
				messages: this.serializeMessages(msgs),
				...(system != null ? { system: system } : undefined),
				...(useTools != null ? this.serializeTools(useTools) : undefined),
				stream: false,
				max_completion_tokens: model.maxTokens.output
					? Math.min(modelOptions?.outputTokens ?? Infinity, model.maxTokens.output)
					: modelOptions?.outputTokens,
				temperature: getValidatedTemperature(
					model,
					modelOptions?.temperature ?? model.temperature,
					this.context.defaultTemperature,
				),
			};

			const rsp = await this.fetchCore(action, model, apiKey, request, signal, conversationId);
			if (!rsp.ok) {
				const result = await this.handleFetchFailure(
					rsp,
					action,
					model,
					retries,
					maxInputTokens,
					useTools != null,
				);
				if (result.retry) {
					maxInputTokens = result.maxInputTokens;
					if (result.withoutTools) {
						toolsRejected = true;
					}
					retries++;
					continue;
				}
			}

			const data: ChatCompletionResponse = (await rsp.json()) as ChatCompletionResponse;
			const toolCalls = this.parseToolCalls(data);
			const result: AIProviderResponse<void> = {
				id: data.id ?? uuid(),
				// A tool-call-only turn has no content (the GitKraken proxy sends `null`), which correctly
				// collapses to '' here — the tool calls are carried separately below.
				content: data.choices?.[0].message.content?.trim() ?? getAnthropicText(data)?.trim() ?? '',
				model: model,
				...(toolCalls?.length ? { toolCalls: toolCalls } : undefined),
				...(toolsRejected ? { toolsRejected: true } : undefined),
				usage: {
					promptTokens: data.usage?.prompt_tokens ?? data.usage?.input_tokens,
					completionTokens: data.usage?.completion_tokens ?? data.usage?.output_tokens,
					totalTokens: data.usage?.total_tokens,
					limits:
						data?.usage?.gk != null
							? {
									used: data.usage.gk.used,
									limit: data.usage.gk.limit,
									resetsOn: new Date(data.usage.gk.resets_on),
								}
							: undefined,
				},
				result: undefined,
			};
			return result;
		}
	}

	/**
	 * Returns the message-related request fields. The default sends every message inline (OpenAI
	 * Chat Completions semantics); providers whose API carries the initial system prompt separately
	 * (e.g. Anthropic's top-level `system`) override this to extract it from the messages.
	 */
	protected extractSystemPrompt(messages: AIChatMessage<AIChatMessageRole>[]): {
		messages: AIChatMessage<AIChatMessageRole>[];
		system?: string;
	} {
		return { messages: messages };
	}

	/**
	 * Maps messages onto the provider's wire shape. The default is OpenAI Chat Completions: assistant
	 * tool calls go in `tool_calls` with `arguments` JSON-stringified, and tool results are `tool`-role
	 * entries keyed by `tool_call_id`. Providers with a different tool encoding (e.g. Anthropic's
	 * content blocks) override this.
	 */
	protected serializeMessages(messages: AIChatMessage<AIChatMessageRole>[]): unknown[] {
		return messages.map(m => {
			if (m.role === 'tool') {
				// A tool result is only addressable by the id of the call it answers. Without one, send it
				// as plain text — the same shape used for providers that can't carry tool calls at all —
				// rather than a `tool_call_id: undefined` the provider rejects with nothing to trace it to.
				if (m.toolCallId == null) return { role: 'user', content: m.content };

				return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
			}

			if (m.role === 'assistant' && m.toolCalls?.length) {
				return {
					role: 'assistant',
					// OpenAI requires `content` to be present, but allows null on a tool-call-only turn
					content: m.content || null,
					tool_calls: m.toolCalls.map(c => ({
						id: c.id,
						type: 'function',
						function: { name: c.name, arguments: JSON.stringify(c.args) },
						// Only the GitKraken proxy mints these, so the field can only ever be present on a
						// conversation with that proxy — no other provider sees it.
						...(c.providerSignature != null ? { thought_signature: c.providerSignature } : undefined),
					})),
				};
			}

			return { role: m.role, content: m.content };
		});
	}

	/** Returns the tool-related request fields. The default is the OpenAI `function` envelope. */
	protected serializeTools(tools: readonly AIToolDefinition[]): { tools: unknown[] } {
		return {
			tools: tools.map(t => ({
				type: 'function',
				function: { name: t.name, description: t.description, parameters: t.parameters },
			})),
		};
	}

	/**
	 * Extracts tool calls from a response, handling both the OpenAI shape
	 * (`choices[].message.tool_calls`, whose `arguments` is a JSON string) and the Anthropic shape
	 * (`content[]` blocks of type `tool_use`) — mirroring how {@link fetch} already reads content
	 * from both.
	 */
	protected parseToolCalls(data: ChatCompletionResponse): AIToolCall[] | undefined {
		const calls: AIToolCall[] = [];

		for (const call of data.choices?.[0]?.message?.tool_calls ?? []) {
			let args: Record<string, unknown> = {};
			try {
				// Providers can emit '' for a no-argument call
				args = call.function.arguments ? (JSON.parse(call.function.arguments) as Record<string, unknown>) : {};
			} catch {
				// Leave args empty — the tool dispatcher reports the resulting validation error back to
				// the model, which is more recoverable than failing the whole request here.
			}

			calls.push({
				id: call.id,
				name: call.function.name,
				args: args,
				...(call.thought_signature != null ? { providerSignature: call.thought_signature } : undefined),
			});
		}

		for (const block of data.content ?? []) {
			if (block.type !== 'tool_use' || block.id == null || block.name == null) continue;

			calls.push({ id: block.id, name: block.name, args: block.input ?? {} });
		}

		return calls.length ? calls : undefined;
	}

	protected async handleFetchFailure<TAction extends AIActionType>(
		rsp: Response,
		_action: TAction,
		model: AIModel<T>,
		retries: number,
		maxInputTokens: number,
		sentTools?: boolean,
	): Promise<{ retry: true; maxInputTokens: number; withoutTools?: boolean }> {
		if (rsp.status === 404) {
			throw new AIError(
				AIErrorReason.Unauthorized,
				new Error(`Your API key doesn't seem to have access to the selected '${model.id}' model`),
			);
		}
		if (rsp.status === 429) {
			throw new AIError(
				AIErrorReason.RateLimitOrFundsExceeded,
				new Error(
					`(${this.name}) ${rsp.status}: Too many requests (rate limit exceeded) or your account is out of funds`,
				),
			);
		}

		let json;
		try {
			json = (await rsp.json()) as { error?: { code: string; message: string } } | undefined;
		} catch {}

		if (Array.isArray(json)) {
			json = json[0];
		}
		if (json?.error?.code === 'context_length_exceeded') {
			if (retries < 3) {
				return { retry: true, maxInputTokens: getReducedMaxInputTokens(maxInputTokens, retries + 1) };
			}

			throw new AIError(
				AIErrorReason.RequestTooLarge,
				new Error(`(${this.name}) ${rsp.status}: ${json?.error?.message || rsp.statusText}`),
			);
		}

		// A provider that advertises the OpenAI shape but rejects `tools` (an older or partial
		// implementation) gets one retry without them, so the caller degrades to text-only instead of
		// failing outright.
		if (sentTools && rsp.status === 400 && isToolsRejection(json?.error?.message)) {
			return { retry: true, maxInputTokens: maxInputTokens, withoutTools: true };
		}

		throw new Error(`(${this.name}) ${rsp.status}: ${json?.error?.message || rsp.statusText}`);
	}

	protected async fetchCore<TAction extends AIActionType>(
		action: TAction,
		model: AIModel<T>,
		apiKey: string,
		request: object,
		signal: AbortSignal | undefined,
		conversationId?: string,
	): Promise<Response> {
		const url = this.getUrl(model);
		if (!url) {
			throw new Error(`(${this.name}) ${getActionName(action)}: No URL configured`);
		}

		try {
			return await this.context.fetch(url, {
				headers: await this.getHeaders(action, apiKey, model, url, conversationId),
				method: 'POST',
				body: JSON.stringify(request),
				signal: signal,
			});
		} catch (ex) {
			if (ex.name === 'AbortError') throw new CancellationError(ex);
			throw ex;
		}
	}
}

/** Whether a 400's message reads as a rejection of the `tools` field rather than a prompt problem. */
function isToolsRejection(message: string | undefined): boolean {
	if (!message) return false;

	const m = message.toLowerCase();
	return (
		(m.includes('tool') || m.includes('function')) &&
		(m.includes('unsupported') ||
			m.includes('not supported') ||
			m.includes('unknown') ||
			m.includes('unrecognized') ||
			m.includes('invalid') ||
			m.includes('unexpected'))
	);
}

/** Joins the text blocks of an Anthropic-shaped response, skipping any `tool_use` blocks. */
function getAnthropicText(data: ChatCompletionResponse): string | undefined {
	if (data.content == null) return undefined;

	const text = data.content
		.map(b => (b.type === 'text' ? b.text : undefined))
		.filter(t => t != null)
		.join('');
	return text || undefined;
}

interface ChatCompletionRequest {
	model: string;
	/** Provider-shaped messages from {@link OpenAICompatibleProviderBase.serializeMessages} */
	messages: unknown[];

	/** Anthropic carries the initial system prompt here instead of as a `system`-role message */
	system?: string;

	/** Tool definitions, shaped by {@link OpenAICompatibleProviderBase.serializeTools} */
	tools?: unknown[];

	/** @deprecated but used by Anthropic & Gemini */
	max_tokens?: number;
	/** Currently can't be used for Anthropic & Gemini */
	max_completion_tokens?: number;
	metadata?: Record<string, string>;
	stream?: boolean;
	temperature?: number;
	top_p?: number;

	/** Not supported by many models/providers */
	reasoning_effort?: 'low' | 'medium' | 'high';
}

interface ChatCompletionResponse {
	id: string;
	model: string;
	/** OpenAI compatible output */
	choices?: {
		index: number;
		message: {
			role: string;
			content: string | null;
			refusal: string | null;
			tool_calls?: {
				id: string;
				type: string;
				function: { name: string; arguments: string };
				/** GitKraken proxy only — an opaque provider reasoning token to round-trip */
				thought_signature?: string;
			}[];
		};
		finish_reason: string;
	}[];
	/** Anthropic output */
	content?: (
		| { type: 'text'; text: string }
		| { type: 'tool_use'; id: string; name: string; input?: Record<string, unknown> }
	)[];
	usage: {
		/** OpenAI compatible */
		prompt_tokens?: number;
		completion_tokens?: number;
		total_tokens?: number;

		/** Anthropic */
		input_tokens?: number;
		output_tokens?: number;

		/** GitKraken */
		gk: {
			used: number;
			limit: number;
			resets_on: string;
		};
	};
}

import { CancellationError, isCancellationError } from '@gitlens/utils/cancellation.js';
import { uuid } from '@gitlens/utils/crypto.js';
import { getLoggableName, Logger } from '@gitlens/utils/logger.js';
import { maybeStartScopedLogger } from '@gitlens/utils/logger.scoped.js';
import type { AIProviders } from '../constants.js';
import { AIError, AIErrorReason } from '../errors.js';
import type { AIActionType, AIModel, AIProviderDescriptor } from '../models/model.js';
import type {
	AIChatMessage,
	AIChatMessageRole,
	AIFinishReason,
	AIProvider,
	AIProviderResponse,
	AIResponseFormat,
	AIToolCall,
	AIToolDefinition,
	JSONSchema,
} from '../models/provider.js';
import { getActionName, getReducedMaxInputTokens, getValidatedTemperature } from '../utils/ai.utils.js';
import type { AIProviderContext } from './context.js';
import { isResponseFormatRejected, rememberResponseFormatRejection } from './responseFormatCache.js';

// Native-format rejection wording varies by provider ("response_format", "structured outputs",
// Gemini's "Json mode is not enabled", and its OpenAI-compat layer's `generation_config.response_schema`
// path in INVALID_ARGUMENT bodies, ...)
const formatRejectionRegex =
	/response[_ ]?(?:format|schema)|structured[_ ]?output|output_config|json_schema|json[_ ]?mode/i;

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

	protected isResponseFormatSessionRejected(model: AIModel<T>, responseFormat: AIResponseFormat): boolean {
		return isResponseFormatRejected(this.id, model, responseFormat);
	}

	protected rememberResponseFormatRejection(model: AIModel<T>, responseFormat: AIResponseFormat): void {
		rememberResponseFormatRejection(this.id, model, responseFormat);
	}

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
			responseFormat?: AIResponseFormat;
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
				options.responseFormat,
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
		responseFormat?: AIResponseFormat,
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
			if (
				responseFormat != null &&
				!this.isResponseFormatSessionRejected(model, responseFormat) &&
				this.supportsResponseFormat(model)
			) {
				this.applyResponseFormat(request, model, responseFormat);
			}

			let rsp = await this.fetchCore(action, model, apiKey, request, signal, conversationId);
			// Read once and forward to `handleFetchFailure` so the error body isn't decoded twice
			let errorBody: string | undefined;
			if (!rsp.ok && (request.response_format != null || request.output_config != null)) {
				// If the native format was rejected (stale model snapshot, older Azure api-version,
				// proxy converter gaps, OpenRouter's require_parameters matching no endpoint), strip
				// it and resend the same request — the prompt still describes the JSON. Resending
				// directly avoids re-running the (non-idempotent) prompt build and its side effects
				// Leave it `undefined` (not '') when the read fails, so `handleFetchFailure` falls
				// back to reading the still-unconsumed response instead of parsing an empty string
				errorBody = await rsp
					.clone()
					.text()
					.catch(() => undefined);
				if (this.isResponseFormatRejection(rsp.status, errorBody ?? '')) {
					Logger.warn(
						`(${this.name}) ${model.id}: native response format was rejected (${rsp.status}); retrying without it`,
					);
					const rejected = responseFormat;
					responseFormat = undefined;
					delete request.response_format;
					delete request.output_config;
					delete request.provider;
					rsp = await this.fetchCore(action, model, apiKey, request, signal, conversationId);
					errorBody = undefined;
					// Memoize only when stripping fixed it — proof the format (not e.g. an oversized
					// prompt behind the same wrapped status) caused the failure
					if (rsp.ok && rejected != null) {
						this.rememberResponseFormatRejection(model, rejected);
					}
				}
			}

			if (!rsp.ok) {
				const result = await this.handleFetchFailure(
					rsp,
					action,
					model,
					retries,
					maxInputTokens,
					errorBody,
					useTools != null,
				);
				if (result.retry) {
					maxInputTokens = result.maxInputTokens;
					if (result.withoutTools) {
						// Say so explicitly: the caller degrades silently by design, so the only remaining
						// evidence would be `toolCalls=0` — indistinguishable from a model that simply chose
						// not to consult the repository. That ambiguity is the whole reason to log it.
						Logger.warn(
							`(${this.name}) ${model.id}: tools were rejected (${rsp.status}); retrying without them — repository consultation is unavailable for the rest of this session`,
						);
						toolsRejected = true;
					}
					retries++;
					continue;
				}
			}

			const data: ChatCompletionResponse = (await rsp.json()) as ChatCompletionResponse;
			const toolCalls = this.parseToolCalls(data);
			// A tool-call-only turn carries no text, which `extractContent` correctly reports as '' — it
			// selects the text block by type, so a `tool_use` (or thinking) block is never mistaken for one.
			// The calls ride alongside on `toolCalls` below.
			const content = this.extractContent(data);
			// Some providers/proxies (e.g. OpenRouter) report upstream failures as an OK response
			// carrying an error envelope and no choices — surface that instead of empty content
			if (!content && toolCalls == null && data.error != null) {
				if (data.error.code === 429 || data.error.code === '429') {
					throw new AIError(
						AIErrorReason.RateLimitOrFundsExceeded,
						new Error(`(${this.name}) ${data.error.message || 'Rate limit exceeded'}`),
					);
				}
				throw new Error(`(${this.name}) ${data.error.message || 'Unknown error'}`);
			}

			const result: AIProviderResponse<void> = {
				id: data.id ?? uuid(),
				content: content,
				finishReason: this.extractFinishReason(data),
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

	/** Whether the given model accepts a native response-format/schema field; when false the
	 *  prompt's JSON description is the only format control (the request is unchanged).
	 *  Dynamic-catalog providers (GitKraken, OpenRouter) populate
	 *  {@link AIModel.supportsStructuredOutputs}; static providers override with id-based gates */
	protected supportsResponseFormat(model: AIModel<T>): boolean {
		return model.supportsStructuredOutputs ?? true;
	}

	/**
	 * Whether a failed response reads as a rejection of the `tools` field rather than a problem with the
	 * prompt — the trigger for one retry without tools, so a tool-using feature degrades to single-shot
	 * instead of failing outright.
	 *
	 * Providers that wrap upstream rejections in their own envelope (e.g. GitKraken) must override this:
	 * the wrapper's prose names neither "tool" nor "function", so the text match here cannot see through
	 * it and the fallback would never fire.
	 */
	protected isToolsRejection(status: number, message: string | undefined): boolean {
		if (status !== 400 || !message) return false;

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

	/** Whether a failed response means the native response format itself was rejected — the
	 *  trigger for stripping it and retrying via the prompt-described JSON. Providers that wrap
	 *  upstream rejections in their own envelope (e.g. GitKraken) extend this */
	protected isResponseFormatRejection(status: number, body: string): boolean {
		return (
			(status === 400 && formatRejectionRegex.test(body)) ||
			// OpenRouter answers 404 when `require_parameters` matches no serving endpoint
			(status === 404 && /no endpoints found/i.test(body))
		);
	}

	/** Translates the canonical response format onto the request; called only when
	 *  {@link supportsResponseFormat} allows it. Base emits the OpenAI `response_format.json_schema`
	 *  envelope. Overrides must REPLACE this for providers with a different native field
	 *  (e.g. Anthropic `output_config`) — never leave both on the request. */
	protected applyResponseFormat(
		request: ChatCompletionRequest,
		_model: AIModel<T>,
		responseFormat: AIResponseFormat,
	): void {
		request.response_format = {
			type: 'json_schema',
			json_schema: {
				name: responseFormat.name,
				strict: true,
				schema: responseFormat.schema,
			},
		};
	}

	// Finds the text block by type rather than position — with some Anthropic models (e.g. Sonnet 5,
	// where thinking runs by default) a thinking block can precede the text block
	protected extractContent(data: ChatCompletionResponse): string {
		return (
			data.choices?.[0]?.message?.content?.trim() ??
			data.content?.find(b => b.type === 'text')?.text?.trim() ??
			''
		);
	}

	/** Normalizes abnormal completion signals (all arrive as HTTP 200) so consumers can
	 *  distinguish truncated/filtered/refused output from a malformed-but-complete reply */
	protected extractFinishReason(data: ChatCompletionResponse): AIFinishReason | undefined {
		const choice = data.choices?.[0];
		if (choice != null) {
			// Truthy check — some OpenAI-compatible servers serialize `"refusal": ""` on normal replies
			if (choice.message?.refusal) return 'refusal';
			if (choice.finish_reason === 'length') return 'length';
			if (choice.finish_reason === 'content_filter') return 'content_filter';
			return undefined;
		}

		switch (data.stop_reason) {
			// `model_context_window_exceeded` means the context filled before the output limit — the
			// reply is truncated all the same
			case 'max_tokens':
			case 'model_context_window_exceeded':
				return 'length';
			case 'refusal':
				return 'refusal';
			default:
				return undefined;
		}
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
		/** The already-read error body, when the caller had to read it (avoids a second decode) */
		body?: string,
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
			json = (body != null ? JSON.parse(body) : await rsp.json()) as
				| { error?: { code: string; message: string } }
				| undefined;
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
		if (sentTools && this.isToolsRejection(rsp.status, json?.error?.message)) {
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

		const body = JSON.stringify(request);

		// A rejected request is otherwise undiagnosable: a proxying backend reports only its own
		// "upstream AI provider error (<provider> HTTP <status>)", so which field the upstream objected to
		// can only be inferred. Log the request's shape — which fields were sent, and how much — but not
		// the messages, which carry the user's source code.
		Logger.trace(
			`(${this.name}) ${getActionName(action)} → ${model.id}: fields=[${Object.keys(request)
				.sort()
				.join(',')}] bytes=${body.length}`,
		);

		try {
			return await this.context.fetch(url, {
				headers: await this.getHeaders(action, apiKey, model, url, conversationId),
				method: 'POST',
				body: body,
				signal: signal,
			});
		} catch (ex) {
			if (ex.name === 'AbortError') throw new CancellationError(ex);
			throw ex;
		}
	}
}

export interface ChatCompletionRequest {
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

	/** OpenAI-compatible structured output (set via {@link OpenAICompatibleProviderBase.applyResponseFormat}) */
	response_format?: { type: 'json_schema'; json_schema: { name: string; strict: boolean; schema: JSONSchema } };
	/** Anthropic-native structured output (set only by the Anthropic override) */
	output_config?: { format: { type: 'json_schema'; schema: JSONSchema } };
	/** OpenRouter-only routing constraint (set only by the OpenRouter override) */
	provider?: { require_parameters: boolean };
}

export interface ChatCompletionResponse {
	id: string;
	model: string;
	/** OpenAI compatible output */
	choices?: {
		index: number;
		message: {
			role: string;
			content: string | null;
			/** OpenAI-only; most OpenAI-compatible servers omit it entirely */
			refusal?: string | null;
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
	/** Anthropic output (non-text blocks, e.g. thinking, carry no text). `tool_use` blocks add the
	 *  call fields, which is why `id`/`name` are optional here — {@link parseToolCalls} narrows on
	 *  `type` and then checks them. */
	content?: { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }[];
	/** Error envelope some providers/proxies return with an OK status (e.g. OpenRouter upstream failures) */
	error?: { message?: string; code?: number | string } | null;
	/** Anthropic stop reason */
	stop_reason?: string;
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

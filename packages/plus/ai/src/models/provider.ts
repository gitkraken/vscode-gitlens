import type { UnifiedDisposable } from '@gitlens/utils/disposable.js';
import type { Event } from '@gitlens/utils/event.js';
import type { AIProviders } from '../constants.js';
import type { AIActionType, AIModel } from './model.js';

export type AIChatMessageRole = 'assistant' | 'system' | 'tool' | 'user';

/** A tool the model may call. `parameters` is a JSON Schema object — it maps to OpenAI's
 *  `function.parameters` and Anthropic's `input_schema` unchanged. */
export interface AIToolDefinition {
	readonly name: string;
	readonly description: string;
	readonly parameters: Record<string, unknown>;
}

export interface AIToolCall {
	readonly id: string;
	readonly name: string;
	readonly args: Record<string, unknown>;
	/** Opaque provider reasoning token (the GitKraken proxy's `thought_signature`), base64-encoded.
	 *  Must be echoed back on the next turn's assistant message or Anthropic rejects the tool result. */
	readonly providerSignature?: string;
}

export type AISystemChatMessage = AIChatMessage<'system'>;
export interface AIChatMessage<T extends AIChatMessageRole = 'assistant' | 'user'> {
	role: T;
	content: string;
	/** Tool calls this assistant turn requested. Only sent to providers with `supportsTools`. */
	toolCalls?: readonly AIToolCall[];
	/** On `tool`-role messages, the {@link AIToolCall.id} this result answers. */
	toolCallId?: string;
	/** On `tool`-role messages, the name of the tool that produced this result. */
	toolName?: string;
}

export type JSONSchemaType = 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';

/** Portable JSON Schema subset accepted by every capable provider (OpenAI strict, Azure, Anthropic,
 *  Gemini, Mistral, xAI, Ollama). Keep schemas within it: object root, `additionalProperties: false`
 *  on every object, every property in `required` (model optionals as `['x', 'null']` unions), and no
 *  pattern/format/min/max/recursion. */
export type JSONSchema = {
	readonly type: JSONSchemaType | readonly JSONSchemaType[];
	readonly description?: string;
	readonly properties?: Readonly<Record<string, JSONSchema>>;
	readonly required?: readonly string[];
	readonly items?: JSONSchema;
	readonly enum?: readonly string[];
	readonly additionalProperties?: boolean;
};

/** Canonical response format, shaped like OpenAI's `response_format.json_schema`; providers
 *  translate it (the OpenAI envelope is always sent `strict: true`) */
export type AIResponseFormat = {
	/** OpenAI-envelope only ([a-zA-Z0-9_-], ≤64 chars); Anthropic/Ollama drop it */
	readonly name: string;
	readonly schema: JSONSchema;
};

export type AIFinishReason = 'length' | 'content_filter' | 'refusal';

export interface AIProviderResponse<T> {
	readonly id: string;
	readonly content: string;
	readonly model: AIModel;

	/** Abnormal completion only (truncated/filtered/refused); undefined on a normal stop */
	readonly finishReason?: AIFinishReason;

	/** Tool calls the model requested. Present only when `tools` were sent and the model used them. */
	readonly toolCalls?: readonly AIToolCall[];
	/** Set when the request was retried without tools because the provider rejected them, so the
	 *  caller can stop offering tools for the rest of the session. */
	readonly toolsRejected?: boolean;

	readonly usage?: {
		readonly promptTokens?: number;
		readonly completionTokens?: number;
		readonly totalTokens?: number;

		readonly limits?: { readonly used: number; readonly limit: number; readonly resetsOn: Date };
	};

	readonly result: T;
}

export type AIProviderResult<T> = {
	readonly model: AIModel;

	readonly promise: Promise<AIProviderResponse<T> | 'cancelled' | undefined>;
};

export interface AIProvider<Provider extends AIProviders = AIProviders> extends UnifiedDisposable {
	readonly id: Provider;
	readonly name: string;

	/** Whether this provider's wire format carries tool definitions, tool calls, and tool results.
	 *  Providers that omit it never receive tool-shaped messages — callers fall back to text-only. */
	readonly supportsTools?: boolean;

	onDidChange?: Event<void>;

	configured(silent: boolean): Promise<boolean>;
	getApiKey(silent: boolean): Promise<string | undefined>;
	getModels(): Promise<readonly AIModel<Provider>[]>;
	sendRequest<T extends AIActionType>(
		action: T,
		model: AIModel<Provider>,
		apiKey: string,
		getMessages: (maxInputTokens: number, retries: number) => Promise<AIChatMessage<AIChatMessageRole>[]>,
		options: {
			signal: AbortSignal;
			modelOptions?: { outputTokens?: number; temperature?: number };
			/** Opaque session ID the GitKraken provider sends as `GK-Conversation-ID` so the backend
			 *  charges its per-feature fee once per session; ignored by all other providers. */
			conversationId?: string;
			/** Schema for the provider to enforce natively when the model supports it; providers
			 *  without support ignore it and the prompt's JSON description carries the load. */
			responseFormat?: AIResponseFormat;
			/** Tools to advertise to the model. Only passed to providers with `supportsTools`. */
			tools?: readonly AIToolDefinition[];
		},
	): Promise<AIProviderResponse<void> | undefined>;
}

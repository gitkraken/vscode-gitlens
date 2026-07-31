import { uuid } from '@gitlens/utils/crypto.js';
import { Logger } from '@gitlens/utils/logger.js';
import { ollamaProviderDescriptor as provider } from '../constants.js';
import type { AIActionType, AIModel } from '../models/model.js';
import type {
	AIChatMessage,
	AIChatMessageRole,
	AIProviderResponse,
	AIResponseFormat,
	JSONSchema,
} from '../models/provider.js';
import { OpenAICompatibleProviderBase } from './openAICompatibleProviderBase.js';

type OllamaModel = AIModel<typeof provider.id>;

const defaultBaseUrl = 'http://localhost:11434';

export class OllamaProvider extends OpenAICompatibleProviderBase<typeof provider.id> {
	readonly id = provider.id;
	readonly name = provider.name;
	protected readonly descriptor = provider;
	protected readonly config = {
		keyUrl: 'https://ollama.com/download',
	};

	override async configured(silent: boolean): Promise<boolean> {
		const url = await this.getOrPromptBaseUrl(silent);
		if (url === undefined) {
			return false;
		}
		// Ollama doesn't require an API key, but we'll check if the base URL is reachable
		return this.validateUrl(url);
	}

	override getApiKey(_silent: boolean): Promise<string | undefined> {
		// Ollama doesn't require an API key — account enrollment is handled by the context's getApiKey
		return Promise.resolve('<not applicable>');
	}

	async getModels(): Promise<readonly AIModel<typeof provider.id>[]> {
		try {
			const url = this.getBaseUrl();
			const rsp = await this.context.fetch(`${url}/api/tags`, {
				headers: {
					Accept: 'application/json',
					'Content-Type': 'application/json',
				},
				method: 'GET',
			});

			if (!rsp.ok) {
				throw new Error(`Getting models failed: ${rsp.status} (${rsp.statusText})`);
			}

			interface OllamaModelsResponse {
				models: {
					name: string;
					model: string;
					modified_at: string;
					size: number;
					details?: {
						parameter_size?: string;
						quantization_level?: string;
					};
				}[];
			}

			const result: OllamaModelsResponse = (await rsp.json()) as OllamaModelsResponse;

			// If there are models installed on the user's Ollama instance, use those
			if (result.models?.length) {
				return result.models.map<OllamaModel>(m => ({
					id: m.name,
					name: m.name,
					maxTokens: { input: 8192, output: 8192 },
					provider: provider,
					default: m.name === 'llama3',
				}));
			}
		} catch {}

		return [];
	}

	private async getOrPromptBaseUrl(silent: boolean): Promise<string | undefined> {
		const cfg = this.context.getProviderConfig(this.id);
		if (!cfg.enabled) return undefined;

		if (cfg.url) return cfg.url;

		const url = await this.context.getOrPromptUrl(
			this.id,
			{
				currentUrl: defaultBaseUrl,
				title: 'Connect to Ollama',
				placeholder: 'Please enter your Ollama server URL to use this feature',
				validator: async (u: string) => {
					const valid = await this.validateUrl(u);
					return valid
						? undefined
						: 'Could not connect to Ollama server. Make sure Ollama is installed and running locally.';
				},
			},
			silent,
		);
		return url ?? defaultBaseUrl;
	}

	private async validateUrl(url: string): Promise<boolean> {
		try {
			const rsp = await this.context.fetch(`${url}/api/tags`, {
				headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
				method: 'GET',
			});
			return rsp.ok;
		} catch {
			return false;
		}
	}

	private getBaseUrl(): string | undefined {
		const orgConf = this.context.getProviderConfig(this.id);
		if (!orgConf.enabled) return undefined;
		return orgConf.url || defaultBaseUrl;
	}

	protected getUrl(_model: AIModel<typeof provider.id>): string | undefined {
		const url = this.getBaseUrl();
		return url ? `${url}/api/chat` : undefined;
	}

	// Ollama < 0.5.0 rejects a schema-valued `format` (accepts only 'json')
	protected override isResponseFormatRejection(status: number, body: string): boolean {
		return status === 400 && /format/i.test(body);
	}

	protected override getHeaders<TAction extends AIActionType>(
		_action: TAction,
		_apiKey: string,
		_model: AIModel<typeof provider.id>,
		_url: string,
	): Record<string, string> {
		return {
			Accept: 'application/json',
			'Content-Type': 'application/json',
		};
	}

	protected override async fetch<TAction extends AIActionType>(
		action: TAction,
		model: AIModel<typeof provider.id>,
		apiKey: string,
		messages: (maxInputTokens: number, retries: number) => Promise<AIChatMessage<AIChatMessageRole>[]>,
		modelOptions?: { outputTokens?: number; temperature?: number },
		responseFormat?: AIResponseFormat,
		signal?: AbortSignal,
	): Promise<AIProviderResponse<void>> {
		let retries = 0;
		let maxInputTokens = model.maxTokens.input;

		while (true) {
			// Get messages and prepare request payload for Ollama
			const chatMessages = await messages(maxInputTokens, retries);

			// Convert to the format expected by Ollama
			const ollamaMessages = chatMessages.map(msg => ({
				role: msg.role,
				content: msg.content,
			}));

			// Ensure temperature is within valid range for Ollama (0.0-1.0)
			const temperature = Math.min(Math.max(modelOptions?.temperature ?? 0.7, 0), 1);

			const format =
				responseFormat != null &&
				!this.isResponseFormatSessionRejected(model, responseFormat) &&
				this.supportsResponseFormat(model)
					? responseFormat.schema
					: undefined;

			const request: OllamaChatRequest = {
				model: model.id,
				messages: ollamaMessages,
				stream: false,
				// Ollama takes the bare JSON schema (grammar-constrained sampling, any model)
				format: format,
				options: {
					temperature: temperature,
					// Add num_predict if outputTokens is specified
					...(modelOptions?.outputTokens ? { num_predict: modelOptions.outputTokens } : {}),
				},
			};

			let rsp = await this.fetchCore(action, model, apiKey, request, signal);
			let errorBody: string | undefined;
			if (!rsp.ok && rsp.status === 400 && request.format != null) {
				// If the schema-valued format was rejected (Ollama < 0.5.0 accepts only 'json'),
				// resend the same request without it — the prompt still describes the JSON
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
					delete request.format;
					rsp = await this.fetchCore(action, model, apiKey, request, signal);
					errorBody = undefined;
					if (rsp.ok && rejected != null) {
						this.rememberResponseFormatRejection(model, rejected);
					}
				}
			}

			if (!rsp.ok) {
				const result = await this.handleFetchFailure(rsp, action, model, retries, maxInputTokens, errorBody);
				if (result.retry) {
					maxInputTokens = result.maxInputTokens;
					retries++;
					continue;
				}
			}

			try {
				// Parse response from Ollama
				const data = (await rsp.json()) as OllamaChatResponse;

				if (!data.message?.content) {
					throw new Error(`Empty response from Ollama model: ${model.id}`);
				}

				return {
					id: uuid(),
					content: data.message.content,
					finishReason: data.done_reason === 'length' ? 'length' : undefined,
					model: model,
					usage: {
						promptTokens: data.prompt_eval_count ?? 0,
						completionTokens: data.eval_count ?? 0,
						totalTokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
					},
					result: undefined,
				};
			} catch (err) {
				throw new Error(
					`Failed to parse Ollama response: ${err instanceof Error ? err.message : String(err)}`,
					{ cause: err },
				);
			}
		}
	}
}

// Define Ollama API types
interface OllamaChatRequest {
	model: string;
	messages: Array<{
		role: string;
		content: string;
	}>;
	stream: boolean;
	/** 'json' for JSON mode, or a JSON schema object for structured output (Ollama ≥0.5.0) */
	format?: 'json' | JSONSchema;
	options?: {
		temperature?: number;
		top_p?: number;
		top_k?: number;
		num_predict?: number;
	};
}

interface OllamaChatResponse {
	model: string;
	created_at: string;
	message: {
		role: string;
		content: string;
	};
	done: boolean;
	done_reason?: string;
	total_duration?: number;
	load_duration?: number;
	prompt_eval_count?: number;
	eval_count?: number;
	prompt_eval_duration?: number;
	eval_duration?: number;
}

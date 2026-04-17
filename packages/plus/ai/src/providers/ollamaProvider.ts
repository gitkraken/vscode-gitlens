import { uuid } from '@gitlens/utils/crypto.js';
import { ollamaProviderDescriptor as provider } from '../constants.js';
import type { AIActionType, AIModel } from '../models/model.js';
import type { AIChatMessage, AIProviderResponse } from '../models/provider.js';
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
		messages: (maxInputTokens: number, retries: number) => Promise<AIChatMessage[]>,
		modelOptions?: { outputTokens?: number; temperature?: number },
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

			const request: OllamaChatRequest = {
				model: model.id,
				messages: ollamaMessages,
				stream: false,
				options: {
					temperature: temperature,
					// Add num_predict if outputTokens is specified
					...(modelOptions?.outputTokens ? { num_predict: modelOptions.outputTokens } : {}),
				},
			};

			const rsp = await this.fetchCore(action, model, apiKey, request, signal);
			if (!rsp.ok) {
				const result = await this.handleFetchFailure(rsp, action, model, retries, maxInputTokens);
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
	total_duration?: number;
	load_duration?: number;
	prompt_eval_count?: number;
	eval_count?: number;
	prompt_eval_duration?: number;
	eval_duration?: number;
}

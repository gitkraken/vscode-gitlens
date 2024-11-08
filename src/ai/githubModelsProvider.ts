import { fetch } from '@env/fetch';
import type { CancellationToken } from 'vscode';
import type { TelemetryEvents } from '../constants.telemetry';
import type { Container } from '../container';
import { CancellationError } from '../errors';
import { sum } from '../system/iterable';
import { interpolate } from '../system/string';
import { configuration } from '../system/vscode/configuration';
import type { Storage } from '../system/vscode/storage';
import type { AIModel, AIProvider } from './aiProviderService';
import { getApiKey as getApiKeyCore, getMaxCharacters, showDiffTruncationWarning } from './aiProviderService';
import {
	explainChangesSystemPrompt,
	explainChangesUserPrompt,
	generateCloudPatchMessageSystemPrompt,
	generateCloudPatchMessageUserPrompt,
	generateCodeSuggestMessageSystemPrompt,
	generateCodeSuggestMessageUserPrompt,
	generateCommitMessageSystemPrompt,
	generateCommitMessageUserPrompt,
} from './prompts';

const provider = { id: 'github', name: 'GitHub Models' } as const;

type GitHubModelsModel = AIModel<typeof provider.id>;
const models: GitHubModelsModel[] = [
	{
		id: 'o1-preview',
		name: 'o1 preview',
		maxTokens: 128000,
		provider: provider,
	},
	{
		id: 'o1-mini',
		name: 'o1 mini',
		maxTokens: 128000,
		provider: provider,
	},
	{
		id: 'gpt-4o',
		name: 'GPT-4o',
		maxTokens: 128000,
		provider: provider,
	},
	{
		id: 'gpt-4o-mini',
		name: 'GPT-4o mini',
		maxTokens: 128000,
		provider: provider,
	},
	{
		id: 'Phi-3.5-MoE-instruct',
		name: 'Phi 3.5 MoE',
		maxTokens: 134144,
		provider: provider,
	},
	{
		id: 'Phi-3.5-mini-instruct',
		name: 'Phi 3.5 mini',
		maxTokens: 134144,
		provider: provider,
	},
	{
		id: 'AI21-Jamba-1.5-Large',
		name: 'Jamba 1.5 Large',
		maxTokens: 268288,
		provider: provider,
	},
	{
		id: 'AI21-Jamba-1.5-Mini',
		name: 'Jamba 1.5 Mini',
		maxTokens: 268288,
		provider: provider,
	},
];

export class GitHubModelsProvider implements AIProvider<typeof provider.id> {
	readonly id = provider.id;
	readonly name = provider.name;

	constructor(private readonly container: Container) {}

	dispose() {}

	getModels(): Promise<readonly AIModel<typeof provider.id>[]> {
		return Promise.resolve(models);
	}

	async generateMessage(
		model: GitHubModelsModel,
		diff: string,
		reporting: TelemetryEvents['ai/generate'],
		promptConfig: {
			type: 'commit' | 'cloud-patch' | 'code-suggestion';
			systemPrompt: string;
			userPrompt: string;
			customInstructions?: string;
		},
		options?: { cancellation?: CancellationToken; context?: string },
	): Promise<string | undefined> {
		const apiKey = await getApiKey(this.container.storage);
		if (apiKey == null) return undefined;

		let retries = 0;
		let maxCodeCharacters = getMaxCharacters(model, 2600);
		while (true) {
			const request: GitHubModelsChatCompletionRequest = {
				model: model.id,
				messages: [
					{
						role: 'system',
						content: promptConfig.systemPrompt,
					},
					{
						role: 'user',
						content: interpolate(promptConfig.userPrompt, {
							diff: diff.substring(0, maxCodeCharacters),
							context: options?.context ?? '',
							instructions: promptConfig.customInstructions ?? '',
						}),
					},
				],
			};

			reporting['retry.count'] = retries;
			reporting['input.length'] = (reporting['input.length'] ?? 0) + sum(request.messages, m => m.content.length);

			const rsp = await this.fetch(apiKey, request, options?.cancellation);
			if (!rsp.ok) {
				if (rsp.status === 404) {
					throw new Error(
						`Unable to generate ${promptConfig.type} message: Your API key doesn't seem to have access to the selected '${model.id}' model`,
					);
				}
				if (rsp.status === 429) {
					throw new Error(
						`Unable to generate ${promptConfig.type} message: (${this.name}:${rsp.status}) Too many requests (rate limit exceeded) or your API key is associated with an expired trial`,
					);
				}

				let json;
				try {
					json = (await rsp.json()) as { error?: { code: string; message: string } } | undefined;
				} catch {}

				debugger;

				if (retries++ < 2 && json?.error?.code === 'context_length_exceeded') {
					maxCodeCharacters -= 500 * retries;
					continue;
				}

				throw new Error(
					`Unable to generate ${promptConfig.type} message: (${this.name}:${rsp.status}) ${
						json?.error?.message || rsp.statusText
					}`,
				);
			}

			if (diff.length > maxCodeCharacters) {
				showDiffTruncationWarning(maxCodeCharacters, model);
			}

			const data: GitHubModelsChatCompletionResponse = await rsp.json();
			const message = data.choices[0].message.content.trim();
			return message;
		}
	}

	async generateDraftMessage(
		model: GitHubModelsModel,
		diff: string,
		reporting: TelemetryEvents['ai/generate'],
		options?: {
			cancellation?: CancellationToken;
			context?: string;
			codeSuggestion?: boolean | undefined;
		},
	): Promise<string | undefined> {
		let codeSuggestion;
		if (options != null) {
			({ codeSuggestion, ...options } = options ?? {});
		}

		return this.generateMessage(
			model,
			diff,
			reporting,
			codeSuggestion
				? {
						type: 'code-suggestion',
						systemPrompt: generateCodeSuggestMessageSystemPrompt,
						userPrompt: generateCodeSuggestMessageUserPrompt,
						customInstructions: configuration.get('ai.generateCodeSuggestMessage.customInstructions'),
				  }
				: {
						type: 'cloud-patch',
						systemPrompt: generateCloudPatchMessageSystemPrompt,
						userPrompt: generateCloudPatchMessageUserPrompt,
						customInstructions: configuration.get('ai.generateCloudPatchMessage.customInstructions'),
				  },
			options,
		);
	}

	async generateCommitMessage(
		model: GitHubModelsModel,
		diff: string,
		reporting: TelemetryEvents['ai/generate'],
		options?: { cancellation?: CancellationToken; context?: string },
	): Promise<string | undefined> {
		return this.generateMessage(
			model,
			diff,
			reporting,
			{
				type: 'commit',
				systemPrompt: generateCommitMessageSystemPrompt,
				userPrompt: generateCommitMessageUserPrompt,
				customInstructions: configuration.get('ai.generateCommitMessage.customInstructions'),
			},
			options,
		);
	}

	async explainChanges(
		model: GitHubModelsModel,
		message: string,
		diff: string,
		reporting: TelemetryEvents['ai/explain'],
		options?: { cancellation?: CancellationToken },
	): Promise<string | undefined> {
		const apiKey = await getApiKey(this.container.storage);
		if (apiKey == null) return undefined;

		let retries = 0;
		let maxCodeCharacters = getMaxCharacters(model, 3000);
		while (true) {
			const code = diff.substring(0, maxCodeCharacters);

			const request: GitHubModelsChatCompletionRequest = {
				model: model.id,
				messages: [
					{
						role: 'system',
						content: explainChangesSystemPrompt,
					},
					{
						role: 'user',
						content: interpolate(explainChangesUserPrompt, { diff: code, message: message }),
					},
				],
			};

			reporting['retry.count'] = retries;
			reporting['input.length'] = (reporting['input.length'] ?? 0) + sum(request.messages, m => m.content.length);

			const rsp = await this.fetch(apiKey, request, options?.cancellation);
			if (!rsp.ok) {
				if (rsp.status === 404) {
					throw new Error(
						`Unable to explain changes: Your API key doesn't seem to have access to the selected '${model.id}' model`,
					);
				}
				if (rsp.status === 429) {
					throw new Error(
						`Unable to explain changes: (${this.name}:${rsp.status}) Too many requests (rate limit exceeded) or your API key is associated with an expired trial`,
					);
				}

				let json;
				try {
					json = (await rsp.json()) as { error?: { code: string; message: string } } | undefined;
				} catch {}

				debugger;

				if (retries++ < 2 && json?.error?.code === 'context_length_exceeded') {
					maxCodeCharacters -= 500 * retries;
					continue;
				}

				throw new Error(
					`Unable to explain changes: (${this.name}:${rsp.status}) ${json?.error?.message || rsp.statusText}`,
				);
			}

			if (diff.length > maxCodeCharacters) {
				showDiffTruncationWarning(maxCodeCharacters, model);
			}

			const data: GitHubModelsChatCompletionResponse = await rsp.json();
			const result = data.choices[0].message.content.trim();
			return result;
		}
	}

	private async fetch(
		apiKey: string,
		request: GitHubModelsChatCompletionRequest,
		cancellation: CancellationToken | undefined,
	) {
		let aborter: AbortController | undefined;
		if (cancellation != null) {
			aborter = new AbortController();
			cancellation.onCancellationRequested(() => aborter?.abort());
		}

		try {
			return await fetch('https://models.inference.ai.azure.com/chat/completions', {
				headers: {
					Accept: 'application/json',
					'Content-Type': 'application/json',
					'api-key': apiKey,
				},
				method: 'POST',
				body: JSON.stringify(request),
				signal: aborter?.signal,
			});
		} catch (ex) {
			if (ex.name === 'AbortError') throw new CancellationError(ex);

			throw ex;
		}
	}
}

async function getApiKey(storage: Storage): Promise<string | undefined> {
	return getApiKeyCore(storage, {
		id: provider.id,
		name: provider.name,
		validator: v => /(?:ghp-)?[a-zA-Z0-9]{32,}/.test(v),
		url: 'https://github.com/settings/tokens',
	});
}

interface GitHubModelsChatCompletionRequest {
	model: GitHubModelsModel['id'];
	messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
	temperature?: number;
	top_p?: number;
	n?: number;
	stream?: boolean;
	stop?: string | string[];
	max_tokens?: number;
	presence_penalty?: number;
	frequency_penalty?: number;
	logit_bias?: Record<string, number>;
	user?: string;
}

interface GitHubModelsChatCompletionResponse {
	id: string;
	object: 'chat.completion';
	created: number;
	model: string;
	choices: {
		index: number;
		message: {
			role: 'system' | 'user' | 'assistant';
			content: string;
		};
		finish_reason: string;
	}[];
	usage: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
	};
}

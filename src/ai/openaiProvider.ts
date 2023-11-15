import type { Disposable, QuickInputButton } from 'vscode';
import { env, ThemeIcon, Uri, window } from 'vscode';
import { fetch } from '@env/fetch';
import type { Container } from '../container';
import { configuration } from '../system/configuration';
import type { Storage } from '../system/storage';
import { supportedInVSCodeVersion } from '../system/utils';
import type { AIProvider } from './aiProviderService';

export class OpenAIProvider implements AIProvider {
	readonly id = 'openai';
	readonly name = 'OpenAI';

	private get model(): OpenAIModels {
		return configuration.get('ai.experimental.openai.model') || 'gpt-3.5-turbo';
	}

	constructor(private readonly container: Container) {}

	dispose() {}

	private get url(): string {
		return configuration.get('ai.experimental.openai.url') || 'https://api.openai.com/v1/chat/completions';
	}

	async generateCommitMessage(diff: string, options?: { context?: string }): Promise<string | undefined> {
		const apiKey = await getApiKey(this.container.storage);
		if (apiKey == null) return undefined;

		const model = this.model;
		const maxCodeCharacters = getMaxCharacters(model, 1600);

		const code = diff.substring(0, maxCodeCharacters);
		if (diff.length > maxCodeCharacters) {
			void window.showWarningMessage(
				`The diff of the staged changes had to be truncated to ${maxCodeCharacters} characters to fit within the OpenAI's limits.`,
			);
		}

		let customPrompt = configuration.get('experimental.generateCommitMessagePrompt');
		if (!customPrompt.endsWith('.')) {
			customPrompt += '.';
		}

		const request: OpenAIChatCompletionRequest = {
			model: model,
			messages: [
				{
					role: 'system',
					content: `You are an advanced AI programming assistant tasked with summarizing code changes into a concise and meaningful commit message. Compose a commit message that:
- Strictly synthesizes meaningful information from the provided code diff
- Utilizes any additional user-provided context to comprehend the rationale behind the code changes
- Is clear and brief, with an informal yet professional tone, and without superfluous descriptions
- Avoids unnecessary phrases such as "this commit", "this change", and the like
- Avoids direct mention of specific code identifiers, names, or file names, unless they are crucial for understanding the purpose of the changes
- Most importantly emphasizes the 'why' of the change, its benefits, or the problem it addresses rather than only the 'what' that changed

Follow the user's instructions carefully, don't repeat yourself, don't include the code in the output, or make anything up!`,
				},
				{
					role: 'user',
					content: `Here is the code diff to use to generate the commit message:\n\n${code}`,
				},
				...(options?.context
					? [
							{
								role: 'user' as const,
								content: `Here is additional context which should be taken into account when generating the commit message:\n\n${options.context}`,
							},
					  ]
					: []),
				{
					role: 'user',
					content: customPrompt,
				},
			],
		};

		const rsp = await this.fetch(apiKey, request);
		if (!rsp.ok) {
			debugger;
			if (rsp.status === 429) {
				throw new Error(
					`Unable to generate commit message: (${this.name}:${rsp.status}) Too many requests (rate limit exceeded) or your API key is associated with an expired trial`,
				);
			}
			throw new Error(`Unable to generate commit message: (${this.name}:${rsp.status}) ${rsp.statusText}`);
		}

		const data: OpenAIChatCompletionResponse = await rsp.json();
		const message = data.choices[0].message.content.trim();
		return message;
	}

	async explainChanges(message: string, diff: string): Promise<string | undefined> {
		const apiKey = await getApiKey(this.container.storage);
		if (apiKey == null) return undefined;

		const model = this.model;
		const maxCodeCharacters = getMaxCharacters(model, 2400);

		const code = diff.substring(0, maxCodeCharacters);
		if (diff.length > maxCodeCharacters) {
			void window.showWarningMessage(
				`The diff of the commit changes had to be truncated to ${maxCodeCharacters} characters to fit within the OpenAI's limits.`,
			);
		}

		const request: OpenAIChatCompletionRequest = {
			model: model,
			messages: [
				{
					role: 'system',
					content: `You are an advanced AI programming assistant tasked with summarizing code changes into an explanation that is both easy to understand and meaningful. Construct an explanation that:
- Concisely synthesizes meaningful information from the provided code diff
- Incorporates any additional context provided by the user to understand the rationale behind the code changes
- Places the emphasis on the 'why' of the change, clarifying its benefits or addressing the problem that necessitated the change, beyond just detailing the 'what' has changed

Do not make any assumptions or invent details that are not supported by the code diff or the user-provided context.`,
				},
				{
					role: 'user',
					content: `Here is additional context provided by the author of the changes, which should provide some explanation to why these changes where made. Please strongly consider this information when generating your explanation:\n\n${message}`,
				},
				{
					role: 'user',
					content: `Now, kindly explain the following code diff in a way that would be clear to someone reviewing or trying to understand these changes:\n\n${code}`,
				},
				{
					role: 'user',
					content:
						'Remember to frame your explanation in a way that is suitable for a reviewer to quickly grasp the essence of the changes, the issues they resolve, and their implications on the codebase.',
				},
			],
		};

		const rsp = await this.fetch(apiKey, request);
		if (!rsp.ok) {
			debugger;
			if (rsp.status === 404) {
				throw new Error(
					`Unable to explain commit: Your API key doesn't seem to have access to the selected '${model}' model`,
				);
			}
			if (rsp.status === 429) {
				throw new Error(
					`Unable to explain commit: (${this.name}:${rsp.status}) Too many requests (rate limit exceeded) or your API key is associated with an expired trial`,
				);
			}
			throw new Error(`Unable to explain commit: (${this.name}:${rsp.status}) ${rsp.statusText}`);
		}

		const data: OpenAIChatCompletionResponse = await rsp.json();
		const summary = data.choices[0].message.content.trim();
		return summary;
	}

	private fetch(apiKey: string, request: OpenAIChatCompletionRequest) {
		const url = this.url;
		const isAzure = url.includes('.azure.com');
		return fetch(url, {
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
				...(isAzure ? { 'api-key': apiKey } : { Authorization: `Bearer ${apiKey}` }),
			},
			method: 'POST',
			body: JSON.stringify(request),
		});
	}
}

async function getApiKey(storage: Storage): Promise<string | undefined> {
	let openaiApiKey = await storage.getSecret('gitlens.openai.key');
	if (!openaiApiKey) {
		const input = window.createInputBox();
		input.ignoreFocusOut = true;

		const disposables: Disposable[] = [];

		try {
			const infoButton: QuickInputButton = {
				iconPath: new ThemeIcon(`link-external`),
				tooltip: 'Open the OpenAI API Key Page',
			};

			openaiApiKey = await new Promise<string | undefined>(resolve => {
				disposables.push(
					input.onDidHide(() => resolve(undefined)),
					input.onDidChangeValue(value => {
						if (value && !/(?:sk-)?[a-zA-Z0-9]{32,}/.test(value)) {
							input.validationMessage = 'Please enter a valid OpenAI API key';
							return;
						}
						input.validationMessage = undefined;
					}),
					input.onDidAccept(() => {
						const value = input.value.trim();
						if (!value || !/(?:sk-)?[a-zA-Z0-9]{32,}/.test(value)) {
							input.validationMessage = 'Please enter a valid OpenAI API key';
							return;
						}

						resolve(value);
					}),
					input.onDidTriggerButton(e => {
						if (e === infoButton) {
							void env.openExternal(Uri.parse('https://platform.openai.com/account/api-keys'));
						}
					}),
				);

				input.password = true;
				input.title = 'Connect to OpenAI';
				input.placeholder = 'Please enter your OpenAI API key to use this feature';
				input.prompt = supportedInVSCodeVersion('input-prompt-links')
					? 'Enter your [OpenAI API Key](https://platform.openai.com/account/api-keys "Get your OpenAI API key")'
					: 'Enter your OpenAI API Key';
				input.buttons = [infoButton];

				input.show();
			});
		} finally {
			input.dispose();
			disposables.forEach(d => void d.dispose());
		}

		if (!openaiApiKey) return undefined;

		void storage.storeSecret('gitlens.openai.key', openaiApiKey);
	}

	return openaiApiKey;
}

function getMaxCharacters(model: OpenAIModels, outputLength: number): number {
	let tokens;
	switch (model) {
		case 'gpt-4-1106-preview': // 128,000 tokens (4,096 max output tokens)
			tokens = 128000;
			break;
		case 'gpt-4-32k': // 32,768 tokens
		case 'gpt-4-32k-0613':
			tokens = 32768;
			break;
		case 'gpt-4': // 8,192 tokens
		case 'gpt-4-0613':
			tokens = 8192;
			break;
		case 'gpt-3.5-turbo-1106': // 16,385 tokens (4,096 max output tokens)
			tokens = 16385;
			break;
		case 'gpt-3.5-turbo-16k': // 16,385 tokens; Will point to gpt-3.5-turbo-1106 starting Dec 11, 2023
			tokens = 16385;
			break;
		case 'gpt-3.5-turbo': // Will point to gpt-3.5-turbo-1106 starting Dec 11, 2023
		default: // 4,096 tokens
			tokens = 4096;
			break;
	}

	return tokens * 4 - outputLength / 4;
}

export type OpenAIModels =
	| 'gpt-3.5-turbo-1106'
	| 'gpt-3.5-turbo'
	| 'gpt-3.5-turbo-16k'
	| 'gpt-3.5-turbo-0613'
	| 'gpt-4'
	| 'gpt-4-0613'
	| 'gpt-4-32k'
	| 'gpt-4-32k-0613'
	| 'gpt-4-1106-preview';

interface OpenAIChatCompletionRequest {
	model: OpenAIModels;
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

interface OpenAIChatCompletionResponse {
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

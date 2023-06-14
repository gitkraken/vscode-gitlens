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

	async generateCommitMessage(diff: string, options?: { context?: string }): Promise<string | undefined> {
		const apiKey = await getApiKey(this.container.storage);
		if (apiKey == null) return undefined;

		const model = this.model;
		const maxCodeCharacters = getMaxCharacters(model);

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
					content:
						"You are an AI programming assistant tasked with writing a meaningful commit message by summarizing code changes.\n\n- Follow the user's instructions carefully & to the letter!\n- Don't repeat yourself or make anything up!\n- Minimize any other prose.",
				},
				{
					role: 'user',
					content: `${customPrompt}\n- Avoid phrases like "this commit", "this change", etc.`,
				},
			],
		};

		if (options?.context) {
			request.messages.push({
				role: 'user',
				content: `Use "${options.context}" to help craft the commit message.`,
			});
		}
		request.messages.push({
			role: 'user',
			content: `Write a meaningful commit message for the following code changes:\n\n${code}`,
		});

		const rsp = await fetch('https://api.openai.com/v1/chat/completions', {
			headers: {
				Accept: 'application/json',
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json',
			},
			method: 'POST',
			body: JSON.stringify(request),
		});

		if (!rsp.ok) {
			debugger;
			throw new Error(`Unable to generate commit message: ${rsp.status}: ${rsp.statusText}`);
		}

		const data: OpenAIChatCompletionResponse = await rsp.json();
		const message = data.choices[0].message.content.trim();
		return message;
	}

	async explainChanges(message: string, diff: string): Promise<string | undefined> {
		const apiKey = await getApiKey(this.container.storage);
		if (apiKey == null) return undefined;

		const model = this.model;
		const maxCodeCharacters = getMaxCharacters(model);

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
					content:
						"You are an AI programming assistant tasked with providing an easy to understand but detailed explanation of a commit by summarizing the code changes while also using the commit message as additional context and framing.\n\n- Don't make anything up!",
				},
				{
					role: 'user',
					content: `Use the following user-provided commit message, which should provide some explanation to why these changes where made, when attempting to generate the rich explanation:\n\n${message}`,
				},
				{
					role: 'assistant',
					content: 'OK',
				},
				{
					role: 'user',
					content: `Explain the following code changes:\n\n${code}`,
				},
			],
		};

		const rsp = await fetch('https://api.openai.com/v1/chat/completions', {
			headers: {
				Accept: 'application/json',
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json',
			},
			method: 'POST',
			body: JSON.stringify(request),
		});

		if (!rsp.ok) {
			debugger;
			throw new Error(`Unable to explain commit: ${rsp.status}: ${rsp.statusText}`);
		}

		const data: OpenAIChatCompletionResponse = await rsp.json();
		const summary = data.choices[0].message.content.trim();
		return summary;
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
						if (value && !/sk-[a-zA-Z0-9]{32}/.test(value)) {
							input.validationMessage = 'Please enter a valid OpenAI API key';
							return;
						}
						input.validationMessage = undefined;
					}),
					input.onDidAccept(() => {
						const value = input.value.trim();
						if (!value || !/sk-[a-zA-Z0-9]{32}/.test(value)) {
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

function getMaxCharacters(model: OpenAIModels): number {
	switch (model) {
		case 'gpt-4-32k':
		case 'gpt-4-32k-0314':
		case 'gpt-4-32k-0613':
			return 43000;
		case 'gpt-3.5-turbo-16k':
			return 21000;
		default:
			return 12000;
	}
}

export type OpenAIModels =
	| 'gpt-3.5-turbo'
	| 'gpt-3.5-turbo-16k'
	| 'gpt-3.5-turbo-0301'
	| 'gpt-3.5-turbo-0613'
	| 'gpt-4'
	| 'gpt-4-0314'
	| 'gpt-4-0613'
	| 'gpt-4-32k'
	| 'gpt-4-32k-0314'
	| 'gpt-4-32k-0613';

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
	logit_bias?: { [token: string]: number };
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

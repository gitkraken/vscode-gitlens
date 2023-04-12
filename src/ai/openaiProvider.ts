import type { Disposable, QuickInputButton } from 'vscode';
import { env, ThemeIcon, Uri, window } from 'vscode';
import { fetch } from '@env/fetch';
import type { Container } from '../container';
import { configuration } from '../system/configuration';
import type { Storage } from '../system/storage';
import { supportedInVSCodeVersion } from '../system/utils';
import type { AIProvider } from './aiProviderService';

const maxCodeCharacters = 12000;

export class OpenAIProvider implements AIProvider {
	readonly id = 'openai';
	readonly name = 'OpenAI';

	constructor(private readonly container: Container) {}

	dispose() {}

	async generateCommitMessage(diff: string, options?: { context?: string }): Promise<string | undefined> {
		const openaiApiKey = await getApiKey(this.container.storage);
		if (openaiApiKey == null) return undefined;

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

		const data: OpenAIChatCompletionRequest = {
			model: 'gpt-3.5-turbo',
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
			data.messages.push({
				role: 'user',
				content: `Use "${options.context}" to help craft the commit message.`,
			});
		}
		data.messages.push({
			role: 'user',
			content: `Write a meaningful commit message for the following code changes:\n\n${code}`,
		});

		const rsp = await fetch('https://api.openai.com/v1/chat/completions', {
			headers: {
				Authorization: `Bearer ${openaiApiKey}`,
				'Content-Type': 'application/json',
			},
			method: 'POST',
			body: JSON.stringify(data),
		});

		if (!rsp.ok) {
			debugger;
			throw new Error(`Unable to generate commit message: ${rsp.status}: ${rsp.statusText}`);
		}

		const completion: OpenAIChatCompletionResponse = await rsp.json();
		const message = completion.choices[0].message.content.trim();
		return message;
	}

	async explainChanges(message: string, diff: string): Promise<string | undefined> {
		const openaiApiKey = await getApiKey(this.container.storage);
		if (openaiApiKey == null) return undefined;

		const code = diff.substring(0, maxCodeCharacters);
		if (diff.length > maxCodeCharacters) {
			void window.showWarningMessage(
				`The diff of the commit changes had to be truncated to ${maxCodeCharacters} characters to fit within the OpenAI's limits.`,
			);
		}

		const data: OpenAIChatCompletionRequest = {
			model: 'gpt-3.5-turbo',
			messages: [
				{
					role: 'system',
					content:
						"You are an AI programming assistant tasked with providing a detailed explanation of a commit by summarizing the code changes while also using the commit message as additional context and framing.\n\n- Don't make anything up!",
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
				Authorization: `Bearer ${openaiApiKey}`,
				'Content-Type': 'application/json',
			},
			method: 'POST',
			body: JSON.stringify(data),
		});

		if (!rsp.ok) {
			debugger;
			throw new Error(`Unable to explain commit: ${rsp.status}: ${rsp.statusText}`);
		}

		const completion: OpenAIChatCompletionResponse = await rsp.json();
		const summary = completion.choices[0].message.content.trim();
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

interface OpenAIChatCompletionRequest {
	model: 'gpt-3.5-turbo' | 'gpt-3.5-turbo-0301';
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

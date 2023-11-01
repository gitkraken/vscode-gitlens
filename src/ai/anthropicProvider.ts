import type { Disposable, QuickInputButton } from 'vscode';
import { env, ThemeIcon, Uri, window } from 'vscode';
import { fetch } from '@env/fetch';
import type { Container } from '../container';
import { configuration } from '../system/configuration';
import type { Storage } from '../system/storage';
import { supportedInVSCodeVersion } from '../system/utils';
import type { AIProvider } from './aiProviderService';

export class AnthropicProvider implements AIProvider {
	readonly id = 'anthropic';
	readonly name = 'Anthropic';

	private get model(): AnthropicModels {
		return configuration.get('ai.experimental.anthropic.model') || 'claude-v1';
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
				`The diff of the staged changes had to be truncated to ${maxCodeCharacters} characters to fit within the Anthropic's limits.`,
			);
		}

		let customPrompt = configuration.get('experimental.generateCommitMessagePrompt');
		if (!customPrompt.endsWith('.')) {
			customPrompt += '.';
		}

		let prompt =
			"\n\nHuman: You are an AI programming assistant tasked with writing a meaningful commit message by summarizing code changes.\n- Follow the user's instructions carefully & to the letter!\n- Don't repeat yourself or make anything up!\n- Minimize any other prose.";
		prompt += `\n${customPrompt}\n- Avoid phrases like "this commit", "this change", etc.`;
		prompt += '\n\nAssistant: OK';
		if (options?.context) {
			prompt += `\n\nHuman: Use "${options.context}" to help craft the commit message.\n\nAssistant: OK`;
		}
		prompt += `\n\nHuman: Write a meaningful commit message for the following code changes:\n\n${code}`;
		prompt += '\n\nAssistant:';

		const request: AnthropicCompletionRequest = {
			model: model,
			prompt: prompt,
			stream: false,
			max_tokens_to_sample: 5000,
			stop_sequences: ['\n\nHuman:'],
		};
		const rsp = await this.fetch(apiKey, request);
		if (!rsp.ok) {
			let json;
			try {
				json = (await rsp.json()) as { error: { type: string; message: string } } | undefined;
			} catch {}

			debugger;
			throw new Error(
				`Unable to generate commit message: (${this.name}:${rsp.status}) ${
					json?.error.message || rsp.statusText
				})`,
			);
		}

		const data: AnthropicCompletionResponse = await rsp.json();
		const message = data.completion.trim();
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

		let prompt =
			"\n\nHuman: You are an AI programming assistant tasked with providing an easy to understand but detailed explanation of a commit by summarizing the code changes while also using the commit message as additional context and framing.\nDon't make anything up!";
		prompt += `\nUse the following user-provided commit message, which should provide some explanation to why these changes where made, when attempting to generate the rich explanation:\n\n${message}`;
		prompt += '\n\nAssistant: OK';
		prompt += `\n\nHuman: Explain the following code changes:\n\n${code}`;
		prompt += '\n\nAssistant:';

		const request: AnthropicCompletionRequest = {
			model: model,
			prompt: prompt,
			stream: false,
			max_tokens_to_sample: 5000,
			stop_sequences: ['\n\nHuman:'],
		};

		const rsp = await this.fetch(apiKey, request);
		if (!rsp.ok) {
			let json;
			try {
				json = (await rsp.json()) as { error: { type: string; message: string } } | undefined;
			} catch {}

			debugger;
			throw new Error(
				`Unable to explain commit: (${this.name}:${rsp.status}) ${json?.error.message || rsp.statusText})`,
			);
		}

		const data: AnthropicCompletionResponse = await rsp.json();
		const summary = data.completion.trim();
		return summary;
	}

	private fetch(apiKey: string, request: AnthropicCompletionRequest) {
		return fetch('https://api.anthropic.com/v1/complete', {
			headers: {
				Accept: 'application/json',
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json',
				'X-API-Key': apiKey,
				'anthropic-version': '2023-06-01',
			},
			method: 'POST',
			body: JSON.stringify(request),
		});
	}
}

async function getApiKey(storage: Storage): Promise<string | undefined> {
	let apiKey = await storage.getSecret('gitlens.anthropic.key');
	if (!apiKey) {
		const input = window.createInputBox();
		input.ignoreFocusOut = true;

		const disposables: Disposable[] = [];

		try {
			const infoButton: QuickInputButton = {
				iconPath: new ThemeIcon(`link-external`),
				tooltip: 'Open the Anthropic API Key Page',
			};

			apiKey = await new Promise<string | undefined>(resolve => {
				disposables.push(
					input.onDidHide(() => resolve(undefined)),
					input.onDidChangeValue(value => {
						if (value && !/(?:sk-)?[a-zA-Z0-9-_]{32,}/.test(value)) {
							input.validationMessage = 'Please enter a valid Anthropic API key';
							return;
						}
						input.validationMessage = undefined;
					}),
					input.onDidAccept(() => {
						const value = input.value.trim();
						if (!value || !/(?:sk-)?[a-zA-Z0-9-_]{32,}/.test(value)) {
							input.validationMessage = 'Please enter a valid Anthropic API key';
							return;
						}

						resolve(value);
					}),
					input.onDidTriggerButton(e => {
						if (e === infoButton) {
							void env.openExternal(Uri.parse('https://console.anthropic.com/account/keys'));
						}
					}),
				);

				input.password = true;
				input.title = 'Connect to Anthropic';
				input.placeholder = 'Please enter your Anthropic API key to use this feature';
				input.prompt = supportedInVSCodeVersion('input-prompt-links')
					? 'Enter your [Anthropic API Key](https://console.anthropic.com/account/keys "Get your Anthropic API key")'
					: 'Enter your Anthropic API Key';
				input.buttons = [infoButton];

				input.show();
			});
		} finally {
			input.dispose();
			disposables.forEach(d => void d.dispose());
		}

		if (!apiKey) return undefined;

		void storage.storeSecret('gitlens.anthropic.key', apiKey);
	}

	return apiKey;
}

function getMaxCharacters(model: AnthropicModels): number {
	if (model === 'claude-2' || model === 'claude-v1-100k' || model === 'claude-instant-v1-100k') {
		return 135000;
	}
	return 12000;
}
export type AnthropicModels =
	| 'claude-v1'
	| 'claude-v1-100k'
	| 'claude-instant-v1'
	| 'claude-instant-v1-100k'
	| 'claude-2';

interface AnthropicCompletionRequest {
	model: string;
	prompt: string;
	stream: boolean;

	max_tokens_to_sample: number;
	stop_sequences: string[];

	temperature?: number;
	top_k?: number;
	top_p?: number;
	tags?: Record<string, string>;
}

interface AnthropicCompletionResponse {
	completion: string;
	stop: string | null;
	stop_reason: 'stop_sequence' | 'max_tokens';
	truncated: boolean;
	exception: string | null;
	log_id: string;
}

import type { Disposable, QuickInputButton } from 'vscode';
import { env, ThemeIcon, Uri, window } from 'vscode';
import { fetch } from '@env/fetch';
import type { Container } from '../container';
import { configuration } from '../system/configuration';
import type { Storage } from '../system/storage';
import { supportedInVSCodeVersion } from '../system/utils';
import type { AIProvider } from './aiProviderService';
import { getMaxCharacters } from './aiProviderService';

export class AnthropicProvider implements AIProvider {
	readonly id = 'anthropic';
	readonly name = 'Anthropic';

	private get model(): AnthropicModels {
		return configuration.get('ai.experimental.anthropic.model') || 'claude-instant-1';
	}

	constructor(private readonly container: Container) {}

	dispose() {}

	async generateCommitMessage(diff: string, options?: { context?: string }): Promise<string | undefined> {
		const apiKey = await getApiKey(this.container.storage);
		if (apiKey == null) return undefined;

		const model = this.model;

		let retries = 0;
		let maxCodeCharacters = getMaxCharacters(model, 2600);
		while (true) {
			const code = diff.substring(0, maxCodeCharacters);

			let customPrompt = configuration.get('experimental.generateCommitMessagePrompt');
			if (!customPrompt.endsWith('.')) {
				customPrompt += '.';
			}

			const prompt = `\n\nHuman: You are an advanced AI programming assistant tasked with summarizing code changes into a concise and meaningful commit message. Compose a commit message that:
- Strictly synthesizes meaningful information from the provided code diff
- Utilizes any additional user-provided context to comprehend the rationale behind the code changes
- Is clear and brief, with an informal yet professional tone, and without superfluous descriptions
- Avoids unnecessary phrases such as "this commit", "this change", and the like
- Avoids direct mention of specific code identifiers, names, or file names, unless they are crucial for understanding the purpose of the changes
- Most importantly emphasizes the 'why' of the change, its benefits, or the problem it addresses rather than only the 'what' that changed

Follow the user's instructions carefully, don't repeat yourself, don't include the code in the output, or make anything up!

Human: Here is the code diff to use to generate the commit message:

${code}

${
	options?.context
		? `Human: Here is additional context which should be taken into account when generating the commit message:\n\n${options.context}`
		: ''
}

Human: ${customPrompt}

Assistant:`;

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
					json = (await rsp.json()) as { error?: { type: string; message: string } } | undefined;
				} catch {}

				debugger;

				if (
					retries++ < 2 &&
					json?.error?.type === 'invalid_request_error' &&
					json?.error?.message?.includes('prompt is too long')
				) {
					maxCodeCharacters -= 500 * retries;
					continue;
				}

				throw new Error(
					`Unable to generate commit message: (${this.name}:${rsp.status}) ${
						json?.error?.message || rsp.statusText
					})`,
				);
			}

			if (diff.length > maxCodeCharacters) {
				void window.showWarningMessage(
					`The diff of the staged changes had to be truncated to ${maxCodeCharacters} characters to fit within the Anthropic's limits.`,
				);
			}

			const data: AnthropicCompletionResponse = await rsp.json();
			const message = data.completion.trim();
			return message;
		}
	}

	async explainChanges(message: string, diff: string): Promise<string | undefined> {
		const apiKey = await getApiKey(this.container.storage);
		if (apiKey == null) return undefined;

		const model = this.model;

		let retries = 0;
		let maxCodeCharacters = getMaxCharacters(model, 3000);
		while (true) {
			const code = diff.substring(0, maxCodeCharacters);

			const prompt = `\n\nHuman: You are an advanced AI programming assistant tasked with summarizing code changes into an explanation that is both easy to understand and meaningful. Construct an explanation that:
			- Concisely synthesizes meaningful information from the provided code diff
			- Incorporates any additional context provided by the user to understand the rationale behind the code changes
			- Places the emphasis on the 'why' of the change, clarifying its benefits or addressing the problem that necessitated the change, beyond just detailing the 'what' has changed

			Do not make any assumptions or invent details that are not supported by the code diff or the user-provided context.

Human: Here is additional context provided by the author of the changes, which should provide some explanation to why these changes where made. Please strongly consider this information when generating your explanation:

${message}

Human: Now, kindly explain the following code diff in a way that would be clear to someone reviewing or trying to understand these changes:

${code}

Human: Remember to frame your explanation in a way that is suitable for a reviewer to quickly grasp the essence of the changes, the issues they resolve, and their implications on the codebase.

Assistant:`;

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
					json = (await rsp.json()) as { error?: { type: string; message: string } } | undefined;
				} catch {}

				debugger;

				if (
					retries++ < 2 &&
					json?.error?.type === 'invalid_request_error' &&
					json?.error?.message?.includes('prompt is too long')
				) {
					maxCodeCharacters -= 500 * retries;
					continue;
				}

				throw new Error(
					`Unable to explain commit: (${this.name}:${rsp.status}) ${json?.error?.message || rsp.statusText})`,
				);
			}

			if (diff.length > maxCodeCharacters) {
				void window.showWarningMessage(
					`The diff of the commit changes had to be truncated to ${maxCodeCharacters} characters to fit within the OpenAI's limits.`,
				);
			}

			const data: AnthropicCompletionResponse = await rsp.json();
			const summary = data.completion.trim();
			return summary;
		}
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

export type AnthropicModels = 'claude-instant-1' | 'claude-2';

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

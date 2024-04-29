import type { CancellationToken, LanguageModelChatMessage } from 'vscode';
import {
	CancellationTokenSource,
	LanguageModelChatSystemMessage,
	LanguageModelChatUserMessage,
	lm,
	window,
} from 'vscode';
import type { Container } from '../container';
import { showAIModelPicker } from '../quickpicks/aiModelPicker';
import { configuration } from '../system/configuration';
import type { AIModel, AIProvider } from './aiProviderService';
import { getMaxCharacters } from './aiProviderService';

const provider = { id: 'copilot', name: 'GitHub' } as const;

export type CopilotModels = 'copilot-gpt-4' | 'copilot-gpt-3.5-turbo';
type CopilotModel = AIModel<typeof provider.id>;
const models: CopilotModel[] = [
	{
		id: 'copilot-gpt-4',
		name: 'Copilot GPT-4',
		maxTokens: 4096,
		provider: provider,
		default: true,
	},
	{
		id: 'copilot-gpt-3.5-turbo',
		name: 'Copilot GPT-3.5 Turbo',
		maxTokens: 4096,
		provider: provider,
	},
];

export class CopilotProvider implements AIProvider<typeof provider.id> {
	readonly id = provider.id;
	readonly name = provider.name;

	constructor(private readonly container: Container) {}

	dispose() {}

	async getModels(): Promise<readonly AIModel<typeof provider.id>[]> {
		const supported = models.filter(m => lm.languageModels.includes(m.id));
		return Promise.resolve(supported);
	}

	private get model(): CopilotModels | null {
		return configuration.get('ai.experimental.copilot.model') || null;
	}

	private async getOrChooseModel(): Promise<CopilotModel | undefined> {
		let model = this.model;
		if (model == null) {
			const pick = await showAIModelPicker(this.container, this.id);
			if (pick == null) return undefined;

			await configuration.updateEffective(`ai.experimental.${pick.provider}.model`, pick.model);
			model = pick.model;
		}
		return models.find(m => m.id === model);
	}

	async generateCommitMessage(
		diff: string,
		options?: { cancellation?: CancellationToken; context?: string },
	): Promise<string | undefined> {
		const model = await this.getOrChooseModel();
		if (model == null) return undefined;

		let cancellation;
		let cancellationSource;
		if (options?.cancellation == null) {
			cancellationSource = new CancellationTokenSource();
			cancellation = cancellationSource.token;
		} else {
			cancellation = options.cancellation;
		}

		// let retries = 0;
		const maxCodeCharacters = getMaxCharacters(model, 2600);
		while (true) {
			const code = diff.substring(0, maxCodeCharacters);

			let customPrompt = configuration.get('experimental.generateCommitMessagePrompt');
			if (!customPrompt.endsWith('.')) {
				customPrompt += '.';
			}

			const messages: LanguageModelChatMessage[] = [
				new LanguageModelChatSystemMessage(`You are an advanced AI programming assistant tasked with summarizing code changes into a concise and meaningful commit message. Compose a commit message that:
- Strictly synthesizes meaningful information from the provided code diff
- Utilizes any additional user-provided context to comprehend the rationale behind the code changes
- Is clear and brief, with an informal yet professional tone, and without superfluous descriptions
- Avoids unnecessary phrases such as "this commit", "this change", and the like
- Avoids direct mention of specific code identifiers, names, or file names, unless they are crucial for understanding the purpose of the changes
- Most importantly emphasizes the 'why' of the change, its benefits, or the problem it addresses rather than only the 'what' that changed

Follow the user's instructions carefully, don't repeat yourself, don't include the code in the output, or make anything up!`),
				new LanguageModelChatUserMessage(
					`Here is the code diff to use to generate the commit message:\n\n${code}`,
				),
				...(options?.context
					? [
							new LanguageModelChatUserMessage(
								`Here is additional context which should be taken into account when generating the commit message:\n\n${options.context}`,
							),
					  ]
					: []),
				new LanguageModelChatUserMessage(customPrompt),
			];

			try {
				const rsp = await lm.sendChatRequest(model.id, messages, {}, cancellation);
				// if (!rsp.ok) {
				// 	if (rsp.status === 404) {
				// 		throw new Error(
				// 			`Unable to generate commit message: Your API key doesn't seem to have access to the selected '${model}' model`,
				// 		);
				// 	}
				// 	if (rsp.status === 429) {
				// 		throw new Error(
				// 			`Unable to generate commit message: (${this.name}:${rsp.status}) Too many requests (rate limit exceeded) or your API key is associated with an expired trial`,
				// 		);
				// 	}

				// 	let json;
				// 	try {
				// 		json = (await rsp.json()) as { error?: { code: string; message: string } } | undefined;
				// 	} catch {}

				// 	debugger;

				// 	if (retries++ < 2 && json?.error?.code === 'context_length_exceeded') {
				// 		maxCodeCharacters -= 500 * retries;
				// 		continue;
				// 	}

				// 	throw new Error(
				// 		`Unable to generate commit message: (${this.name}:${rsp.status}) ${
				// 			json?.error?.message || rsp.statusText
				// 		}`,
				// 	);
				// }

				if (diff.length > maxCodeCharacters) {
					void window.showWarningMessage(
						`The diff of the changes had to be truncated to ${maxCodeCharacters} characters to fit within the OpenAI's limits.`,
					);
				}

				let message = '';
				for await (const fragment of rsp.stream) {
					message += fragment;
				}

				return message.trim();
			} catch (ex) {
				debugger;
			} finally {
				cancellationSource?.dispose();
			}
		}
	}

	async explainChanges(
		message: string,
		diff: string,
		options?: { cancellation?: CancellationToken },
	): Promise<string | undefined> {
		const model = await this.getOrChooseModel();
		if (model == null) return undefined;

		let cancellation;
		let cancellationSource;
		if (options?.cancellation == null) {
			cancellationSource = new CancellationTokenSource();
			cancellation = cancellationSource.token;
		} else {
			cancellation = options.cancellation;
		}

		// let retries = 0;
		const maxCodeCharacters = getMaxCharacters(model, 3000);
		while (true) {
			const code = diff.substring(0, maxCodeCharacters);

			const messages: LanguageModelChatMessage[] = [
				new LanguageModelChatSystemMessage(`You are an advanced AI programming assistant tasked with summarizing code changes into an explanation that is both easy to understand and meaningful. Construct an explanation that:
- Concisely synthesizes meaningful information from the provided code diff
- Incorporates any additional context provided by the user to understand the rationale behind the code changes
- Places the emphasis on the 'why' of the change, clarifying its benefits or addressing the problem that necessitated the change, beyond just detailing the 'what' has changed

Do not make any assumptions or invent details that are not supported by the code diff or the user-provided context.`),
				new LanguageModelChatUserMessage(
					`Here is additional context provided by the author of the changes, which should provide some explanation to why these changes where made. Please strongly consider this information when generating your explanation:\n\n${message}`,
				),
				new LanguageModelChatUserMessage(
					`Now, kindly explain the following code diff in a way that would be clear to someone reviewing or trying to understand these changes:\n\n${code}`,
				),
				new LanguageModelChatUserMessage(
					'Remember to frame your explanation in a way that is suitable for a reviewer to quickly grasp the essence of the changes, the issues they resolve, and their implications on the codebase.',
				),
			];

			try {
				const rsp = await lm.sendChatRequest(model.id, messages, {}, cancellation);
				// if (!rsp.ok) {
				// 	if (rsp.status === 404) {
				// 		throw new Error(
				// 			`Unable to explain commit: Your API key doesn't seem to have access to the selected '${model}' model`,
				// 		);
				// 	}
				// 	if (rsp.status === 429) {
				// 		throw new Error(
				// 			`Unable to explain commit: (${this.name}:${rsp.status}) Too many requests (rate limit exceeded) or your API key is associated with an expired trial`,
				// 		);
				// 	}

				// 	let json;
				// 	try {
				// 		json = (await rsp.json()) as { error?: { code: string; message: string } } | undefined;
				// 	} catch {}

				// 	debugger;

				// 	if (retries++ < 2 && json?.error?.code === 'context_length_exceeded') {
				// 		maxCodeCharacters -= 500 * retries;
				// 		continue;
				// 	}

				// 	throw new Error(
				// 		`Unable to explain commit: (${this.name}:${rsp.status}) ${json?.error?.message || rsp.statusText}`,
				// 	);
				// }

				if (diff.length > maxCodeCharacters) {
					void window.showWarningMessage(
						`The diff of the changes had to be truncated to ${maxCodeCharacters} characters to fit within the OpenAI's limits.`,
					);
				}

				let summary = '';
				for await (const fragment of rsp.stream) {
					summary += fragment;
				}

				return summary.trim();
			} catch (ex) {
				debugger;
			} finally {
				cancellationSource?.dispose();
			}
		}
	}
}

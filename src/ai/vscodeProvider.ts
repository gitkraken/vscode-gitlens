import type { CancellationToken, LanguageModelChat, LanguageModelChatSelector } from 'vscode';
import { CancellationTokenSource, LanguageModelChatMessage, lm, window } from 'vscode';
import type { Container } from '../container';
import { configuration } from '../system/configuration';
import { capitalize } from '../system/string';
import type { AIModel, AIProvider } from './aiProviderService';
import { getMaxCharacters } from './aiProviderService';

const provider = { id: 'vscode', name: 'VS Code Provided' } as const;

export type VSCodeAIModels = `${string}:${string}`;
type VSCodeAIModel = AIModel<typeof provider.id> & { vendor: string; selector: LanguageModelChatSelector };
export function isVSCodeAIModel(model: AIModel): model is AIModel<typeof provider.id> {
	return model.provider.id === provider.id;
}

export class VSCodeAIProvider implements AIProvider<typeof provider.id> {
	readonly id = provider.id;

	private _name: string | undefined;
	get name() {
		return this._name ?? provider.name;
	}

	constructor(private readonly container: Container) {}

	dispose() {}

	async getModels(): Promise<readonly AIModel<typeof provider.id>[]> {
		const models = await lm.selectChatModels();
		return models.map(getModelFromChatModel);
	}

	private async getChatModel(model: VSCodeAIModel): Promise<LanguageModelChat | undefined> {
		const models = await lm.selectChatModels(model.selector);
		return models?.[0];
	}

	async generateCommitMessage(
		model: VSCodeAIModel,
		diff: string,
		options?: { cancellation?: CancellationToken; context?: string },
	): Promise<string | undefined> {
		const chatModel = await this.getChatModel(model);
		if (chatModel == null) return undefined;

		let cancellation;
		let cancellationSource;
		if (options?.cancellation == null) {
			cancellationSource = new CancellationTokenSource();
			cancellation = cancellationSource.token;
		} else {
			cancellation = options.cancellation;
		}

		let retries = 0;
		let maxCodeCharacters = getMaxCharacters(model, 2600) - 1000; // TODO: Use chatModel.countTokens

		try {
			while (true) {
				const code = diff.substring(0, maxCodeCharacters);

				let customPrompt = configuration.get('experimental.generateCommitMessagePrompt');
				if (!customPrompt.endsWith('.')) {
					customPrompt += '.';
				}

				const messages: LanguageModelChatMessage[] = [
					LanguageModelChatMessage.User(`You are an advanced AI programming assistant tasked with summarizing code changes into a concise and meaningful commit message. Compose a commit message that:
- Strictly synthesizes meaningful information from the provided code diff
- Utilizes any additional user-provided context to comprehend the rationale behind the code changes
- Is clear and brief, with an informal yet professional tone, and without superfluous descriptions
- Avoids unnecessary phrases such as "this commit", "this change", and the like
- Avoids direct mention of specific code identifiers, names, or file names, unless they are crucial for understanding the purpose of the changes
- Most importantly emphasizes the 'why' of the change, its benefits, or the problem it addresses rather than only the 'what' that changed

Follow the user's instructions carefully, don't repeat yourself, don't include the code in the output, or make anything up!`),
					LanguageModelChatMessage.User(
						`Here is the code diff to use to generate the commit message:\n\n${code}`,
					),
					...(options?.context
						? [
								LanguageModelChatMessage.User(
									`Here is additional context which should be taken into account when generating the commit message:\n\n${options.context}`,
								),
						  ]
						: []),
					LanguageModelChatMessage.User(customPrompt),
				];

				try {
					const rsp = await chatModel.sendRequest(messages, {}, cancellation);

					if (diff.length > maxCodeCharacters) {
						void window.showWarningMessage(
							`The diff of the changes had to be truncated to ${maxCodeCharacters} characters to fit within ${getPossessiveForm(
								model.provider.name,
							)} limits.`,
						);
					}

					let message = '';
					for await (const fragment of rsp.text) {
						message += fragment;
					}

					return message.trim();
				} catch (ex) {
					debugger;

					let message = ex instanceof Error ? ex.message : String(ex);

					if (ex instanceof Error && 'cause' in ex && ex.cause instanceof Error) {
						message += `\n${ex.cause.message}`;

						if (retries++ < 2 && ex.cause.message.includes('exceeds token limit')) {
							maxCodeCharacters -= 500 * retries;
							continue;
						}
					}

					throw new Error(
						`Unable to generate commit message: (${getPossessiveForm(model.provider.name)}:${
							ex.code
						}) ${message}`,
					);
				}
			}
		} finally {
			cancellationSource?.dispose();
		}
	}

	async explainChanges(
		model: VSCodeAIModel,
		message: string,
		diff: string,
		options?: { cancellation?: CancellationToken },
	): Promise<string | undefined> {
		const chatModel = await this.getChatModel(model);
		if (chatModel == null) return undefined;

		let cancellation;
		let cancellationSource;
		if (options?.cancellation == null) {
			cancellationSource = new CancellationTokenSource();
			cancellation = cancellationSource.token;
		} else {
			cancellation = options.cancellation;
		}

		let retries = 0;
		let maxCodeCharacters = getMaxCharacters(model, 3000) - 1000;

		try {
			while (true) {
				const code = diff.substring(0, maxCodeCharacters);

				const messages: LanguageModelChatMessage[] = [
					LanguageModelChatMessage.User(`You are an advanced AI programming assistant tasked with summarizing code changes into an explanation that is both easy to understand and meaningful. Construct an explanation that:
- Concisely synthesizes meaningful information from the provided code diff
- Incorporates any additional context provided by the user to understand the rationale behind the code changes
- Places the emphasis on the 'why' of the change, clarifying its benefits or addressing the problem that necessitated the change, beyond just detailing the 'what' has changed

Do not make any assumptions or invent details that are not supported by the code diff or the user-provided context.`),
					LanguageModelChatMessage.User(
						`Here is additional context provided by the author of the changes, which should provide some explanation to why these changes where made. Please strongly consider this information when generating your explanation:\n\n${message}`,
					),
					LanguageModelChatMessage.User(
						`Now, kindly explain the following code diff in a way that would be clear to someone reviewing or trying to understand these changes:\n\n${code}`,
					),
					LanguageModelChatMessage.User(
						'Remember to frame your explanation in a way that is suitable for a reviewer to quickly grasp the essence of the changes, the issues they resolve, and their implications on the codebase.',
					),
				];

				try {
					const rsp = await chatModel.sendRequest(messages, {}, cancellation);

					if (diff.length > maxCodeCharacters) {
						void window.showWarningMessage(
							`The diff of the changes had to be truncated to ${maxCodeCharacters} characters to fit within ${getPossessiveForm(
								model.provider.name,
							)} limits.`,
						);
					}

					let summary = '';
					for await (const fragment of rsp.text) {
						summary += fragment;
					}

					return summary.trim();
				} catch (ex) {
					debugger;
					let message = ex instanceof Error ? ex.message : String(ex);

					if (ex instanceof Error && 'cause' in ex && ex.cause instanceof Error) {
						message += `\n${ex.cause.message}`;

						if (retries++ < 2 && ex.cause.message.includes('exceeds token limit')) {
							maxCodeCharacters -= 500 * retries;
							continue;
						}
					}

					throw new Error(
						`Unable to explain changes: (${getPossessiveForm(model.provider.name)}:${ex.code}) ${message}`,
					);
				}
			}
		} finally {
			cancellationSource?.dispose();
		}
	}
}

function getModelFromChatModel(model: LanguageModelChat): VSCodeAIModel {
	return {
		id: `${model.vendor}:${model.family}`,
		name: `${capitalize(model.vendor)} ${model.name}`,
		vendor: model.vendor,
		selector: {
			vendor: model.vendor,
			family: model.family,
		},
		maxTokens: model.maxInputTokens,
		provider: { id: provider.id, name: capitalize(model.vendor) },
	};
}

function getPossessiveForm(name: string) {
	return name.endsWith('s') ? `${name}'` : `${name}'s`;
}

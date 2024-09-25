import type { CancellationToken, LanguageModelChat, LanguageModelChatSelector } from 'vscode';
import { CancellationTokenSource, LanguageModelChatMessage, lm, window } from 'vscode';
import type { TelemetryEvents } from '../constants.telemetry';
import type { Container } from '../container';
import { sum } from '../system/iterable';
import { capitalize } from '../system/string';
import { configuration } from '../system/vscode/configuration';
import type { AIModel, AIProvider } from './aiProviderService';
import { getMaxCharacters } from './aiProviderService';
import { cloudPatchMessageSystemPrompt, codeSuggestMessageSystemPrompt, commitMessageSystemPrompt } from './prompts';

const provider = { id: 'vscode', name: 'VS Code Provided' } as const;

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

	async generateMessage(
		model: VSCodeAIModel,
		diff: string,
		reporting: TelemetryEvents['ai/generate'],
		promptConfig: {
			systemPrompt: string;
			customPrompt: string;
			contextName: string;
		},
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

				const messages: LanguageModelChatMessage[] = [
					LanguageModelChatMessage.User(promptConfig.systemPrompt),
					LanguageModelChatMessage.User(
						`Here is the code diff to use to generate the ${promptConfig.contextName}:\n\n${code}`,
					),
					...(options?.context
						? [
								LanguageModelChatMessage.User(
									`Here is additional context which should be taken into account when generating the ${promptConfig.contextName}:\n\n${options.context}`,
								),
						  ]
						: []),
					LanguageModelChatMessage.User(promptConfig.customPrompt),
				];

				reporting['retry.count'] = retries;
				reporting['input.length'] = (reporting['input.length'] ?? 0) + sum(messages, m => m.content.length);

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

	async generateDraftMessage(
		model: VSCodeAIModel,
		diff: string,
		reporting: TelemetryEvents['ai/generate'],
		options?: {
			cancellation?: CancellationToken | undefined;
			context?: string | undefined;
			codeSuggestion?: boolean | undefined;
		},
	): Promise<string | undefined> {
		let customPrompt =
			options?.codeSuggestion === true
				? configuration.get('experimental.generateCodeSuggestionMessagePrompt')
				: configuration.get('experimental.generateCloudPatchMessagePrompt');
		if (!customPrompt.endsWith('.')) {
			customPrompt += '.';
		}

		return this.generateMessage(
			model,
			diff,
			reporting,
			{
				systemPrompt:
					options?.codeSuggestion === true ? codeSuggestMessageSystemPrompt : cloudPatchMessageSystemPrompt,
				customPrompt: customPrompt,
				contextName:
					options?.codeSuggestion === true
						? 'code suggestion title and description'
						: 'cloud patch title and description',
			},
			options != null
				? {
						cancellation: options.cancellation,
						context: options.context,
				  }
				: undefined,
		);
	}

	async generateCommitMessage(
		model: VSCodeAIModel,
		diff: string,
		reporting: TelemetryEvents['ai/generate'],
		options?: {
			cancellation?: CancellationToken | undefined;
			context?: string | undefined;
		},
	): Promise<string | undefined> {
		let customPrompt = configuration.get('experimental.generateCommitMessagePrompt');
		if (!customPrompt.endsWith('.')) {
			customPrompt += '.';
		}

		return this.generateMessage(
			model,
			diff,
			reporting,
			{
				systemPrompt: commitMessageSystemPrompt,
				customPrompt: customPrompt,
				contextName: 'commit message',
			},
			options,
		);
	}

	async explainChanges(
		model: VSCodeAIModel,
		message: string,
		diff: string,
		reporting: TelemetryEvents['ai/explain'],
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

				reporting['retry.count'] = retries;
				reporting['input.length'] = (reporting['input.length'] ?? 0) + sum(messages, m => m.content.length);

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

import type { CancellationToken, LanguageModelChat, LanguageModelChatSelector } from 'vscode';
import { CancellationTokenSource, LanguageModelChatMessage, lm } from 'vscode';
import type { VSCodeAIModels } from '../constants.ai';
import type { TelemetryEvents } from '../constants.telemetry';
import type { Container } from '../container';
import { configuration } from '../system/-webview/configuration';
import { sum } from '../system/iterable';
import { capitalize, interpolate } from '../system/string';
import type { AIGenerateChangelogChange, AIModel, AIProvider } from './aiProviderService';
import {
	getMaxCharacters,
	getValidatedTemperature,
	showDiffTruncationWarning,
	showPromptTruncationWarning,
} from './aiProviderService';
import {
	explainChangesUserPrompt,
	generateChangelogUserPrompt,
	generateCloudPatchMessageUserPrompt,
	generateCodeSuggestMessageUserPrompt,
	generateCommitMessageUserPrompt,
	generateStashMessageUserPrompt,
} from './prompts';

const provider = { id: 'vscode', name: 'VS Code Provided' } as const;

type VSCodeAIModel = AIModel<typeof provider.id> & { vendor: string; selector: LanguageModelChatSelector };

export function isVSCodeAIModel(model: AIModel): model is AIModel<typeof provider.id, VSCodeAIModels> {
	return model.provider.id === provider.id;
}

const accessJustification =
	'GitLens leverages Copilot for AI-powered features to improve your workflow and development experience.';

export class VSCodeAIProvider implements AIProvider<typeof provider.id> {
	readonly id = provider.id;

	private _name: string | undefined;
	get name(): string {
		return this._name ?? provider.name;
	}

	constructor(private readonly container: Container) {}

	dispose(): void {}

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
			type: 'commit' | 'cloud-patch' | 'code-suggestion' | 'stash';
			userPrompt: string;
			customInstructions?: string;
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
				const messages: LanguageModelChatMessage[] = [
					LanguageModelChatMessage.User(
						interpolate(promptConfig.userPrompt, {
							diff: diff.substring(0, maxCodeCharacters),
							context: options?.context ?? '',
							instructions: promptConfig.customInstructions ?? '',
						}),
					),
				];

				reporting['retry.count'] = retries;
				reporting['input.length'] = (reporting['input.length'] ?? 0) + sum(messages, m => m.content.length);

				try {
					const rsp = await chatModel.sendRequest(
						messages,
						{
							justification: accessJustification,
							modelOptions: { temperature: getValidatedTemperature(model.temperature) },
						},
						cancellation,
					);

					if (diff.length > maxCodeCharacters) {
						showDiffTruncationWarning(maxCodeCharacters, model);
					}

					let message = '';
					for await (const fragment of rsp.text) {
						message += fragment;
					}

					return message.trim();
				} catch (ex) {
					debugger;

					let message = ex instanceof Error ? ex.message : String(ex);

					if (ex instanceof Error && 'code' in ex && ex.code === 'NoPermissions') {
						throw new Error(`User denied access to ${model.provider.name}`);
					}

					if (ex instanceof Error && 'cause' in ex && ex.cause instanceof Error) {
						message += `\n${ex.cause.message}`;

						if (retries++ < 2 && ex.cause.message.includes('exceeds token limit')) {
							maxCodeCharacters -= 500 * retries;
							continue;
						}
					}

					throw new Error(
						`Unable to generate ${promptConfig.type} message: (${model.provider.name}${
							ex.code ? `:${ex.code}` : ''
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
						userPrompt: generateCodeSuggestMessageUserPrompt,
						customInstructions: configuration.get('ai.generateCodeSuggestMessage.customInstructions'),
				  }
				: {
						type: 'cloud-patch',
						userPrompt: generateCloudPatchMessageUserPrompt,
						customInstructions: configuration.get('ai.generateCloudPatchMessage.customInstructions'),
				  },
			options,
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
		return this.generateMessage(
			model,
			diff,
			reporting,
			{
				type: 'commit',
				userPrompt: generateCommitMessageUserPrompt,
				customInstructions: configuration.get('ai.generateCommitMessage.customInstructions'),
			},
			options,
		);
	}

	async generateStashMessage(
		model: VSCodeAIModel,
		diff: string,
		reporting: TelemetryEvents['ai/generate'],
		options?: {
			cancellation?: CancellationToken | undefined;
			context?: string | undefined;
		},
	): Promise<string | undefined> {
		return this.generateMessage(
			model,
			diff,
			reporting,
			{
				type: 'stash',
				userPrompt: generateStashMessageUserPrompt,
				customInstructions: configuration.get('ai.generateStashMessage.customInstructions'),
			},
			options,
		);
	}

	async generateChangelog(
		model: VSCodeAIModel,
		changes: AIGenerateChangelogChange[],
		reporting: TelemetryEvents['ai/generate'],
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
				const data = JSON.stringify(changes);

				const messages: LanguageModelChatMessage[] = [
					LanguageModelChatMessage.User(
						interpolate(generateChangelogUserPrompt, {
							data: data.substring(0, maxCodeCharacters),
							instructions: configuration.get('ai.generateChangelog.customInstructions') ?? '',
						}),
					),
				];

				reporting['retry.count'] = retries;
				reporting['input.length'] = (reporting['input.length'] ?? 0) + sum(messages, m => m.content.length);

				try {
					const rsp = await chatModel.sendRequest(
						messages,
						{
							justification: accessJustification,
							modelOptions: model.temperature != null ? { temperature: model.temperature } : undefined,
						},
						cancellation,
					);

					if (data.length > maxCodeCharacters) {
						showPromptTruncationWarning(maxCodeCharacters, model);
					}

					let result = '';
					for await (const fragment of rsp.text) {
						result += fragment;
					}

					return result.trim();
				} catch (ex) {
					debugger;
					let message = ex instanceof Error ? ex.message : String(ex);

					if (ex instanceof Error && 'code' in ex && ex.code === 'NoPermissions') {
						throw new Error(`User denied access to ${model.provider.name}`);
					}

					if (ex instanceof Error && 'cause' in ex && ex.cause instanceof Error) {
						message += `\n${ex.cause.message}`;

						if (retries++ < 2 && ex.cause.message.includes('exceeds token limit')) {
							maxCodeCharacters -= 500 * retries;
							continue;
						}
					}

					throw new Error(
						`Unable to generate changelog: (${model.provider.name}${
							ex.code ? `:${ex.code}` : ''
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
				const messages: LanguageModelChatMessage[] = [
					LanguageModelChatMessage.User(
						interpolate(explainChangesUserPrompt, {
							diff: diff.substring(0, maxCodeCharacters),
							message: message,
							instructions: configuration.get('ai.explainChanges.customInstructions') ?? '',
						}),
					),
				];

				reporting['retry.count'] = retries;
				reporting['input.length'] = (reporting['input.length'] ?? 0) + sum(messages, m => m.content.length);

				try {
					const rsp = await chatModel.sendRequest(
						messages,
						{
							justification: accessJustification,
							modelOptions: model.temperature != null ? { temperature: model.temperature } : undefined,
						},
						cancellation,
					);

					if (diff.length > maxCodeCharacters) {
						showDiffTruncationWarning(maxCodeCharacters, model);
					}

					let result = '';
					for await (const fragment of rsp.text) {
						result += fragment;
					}

					return result.trim();
				} catch (ex) {
					debugger;
					let message = ex instanceof Error ? ex.message : String(ex);

					if (ex instanceof Error && 'code' in ex && ex.code === 'NoPermissions') {
						throw new Error(`User denied access to ${model.provider.name}`);
					}

					if (ex instanceof Error && 'cause' in ex && ex.cause instanceof Error) {
						message += `\n${ex.cause.message}`;

						if (retries++ < 2 && ex.cause.message.includes('exceeds token limit')) {
							maxCodeCharacters -= 500 * retries;
							continue;
						}
					}

					throw new Error(
						`Unable to explain changes: (${model.provider.name}${ex.code ? `:${ex.code}` : ''}) ${message}`,
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
		maxTokens: { input: model.maxInputTokens, output: 4096 },
		provider: { id: provider.id, name: capitalize(model.vendor) },
	};
}

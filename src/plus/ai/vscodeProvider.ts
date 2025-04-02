import type { CancellationToken, Event, LanguageModelChat, LanguageModelChatSelector } from 'vscode';
import { CancellationTokenSource, Disposable, EventEmitter, LanguageModelChatMessage, lm } from 'vscode';
import { vscodeProviderDescriptor } from '../../constants.ai';
import type { TelemetryEvents } from '../../constants.telemetry';
import type { Container } from '../../container';
import { CancellationError } from '../../errors';
import { getLoggableName, Logger } from '../../system/logger';
import { startLogScope } from '../../system/logger.scope';
import { capitalize } from '../../system/string';
import type { ServerConnection } from '../gk/serverConnection';
import type { AIActionType, AIModel } from './models/model';
import type { PromptTemplate, PromptTemplateContext } from './models/promptTemplates';
import type { AIProvider, AIRequestResult } from './models/provider';
import { getMaxCharacters, getValidatedTemperature, showPromptTruncationWarning } from './utils/-webview/ai.utils';
import { getLocalPromptTemplate, resolvePrompt } from './utils/-webview/prompt.utils';

const provider = vscodeProviderDescriptor;

type VSCodeAIModel = AIModel<typeof provider.id> & { vendor: string; selector: LanguageModelChatSelector };

const accessJustification =
	'GitLens leverages Copilot for AI-powered features to improve your workflow and development experience.';

export class VSCodeAIProvider implements AIProvider<typeof provider.id> {
	readonly id = provider.id;

	private _name: string | undefined;
	get name(): string {
		return this._name ?? provider.name;
	}

	private _onDidChange = new EventEmitter<void>();
	get onDidChange(): Event<void> {
		return this._onDidChange.event;
	}

	private readonly _disposable: Disposable;

	constructor(
		private readonly container: Container,
		private readonly connection: ServerConnection,
	) {
		this._disposable = Disposable.from(
			this._onDidChange,
			lm.onDidChangeChatModels(() => this._onDidChange.fire()),
		);
	}

	dispose(): void {
		this._disposable.dispose();
	}

	async configured(_silent: boolean): Promise<boolean> {
		return (await this.getModels()).length !== 0;
	}

	async getModels(): Promise<readonly AIModel<typeof provider.id>[]> {
		const models = await lm.selectChatModels();
		return models.map(getModelFromChatModel);
	}

	async getPromptTemplate<T extends AIActionType>(
		action: T,
		model: VSCodeAIModel,
	): Promise<PromptTemplate | undefined> {
		return Promise.resolve(getLocalPromptTemplate(action, model));
	}

	private async getChatModel(model: VSCodeAIModel): Promise<LanguageModelChat | undefined> {
		const models = await lm.selectChatModels(model.selector);
		return models?.[0];
	}

	async sendRequest<TAction extends AIActionType>(
		action: TAction,
		context: PromptTemplateContext<TAction>,
		model: VSCodeAIModel,
		reporting: TelemetryEvents['ai/generate' | 'ai/explain'],
		options?: { cancellation?: CancellationToken; outputTokens?: number },
	): Promise<AIRequestResult | undefined> {
		using scope = startLogScope(`${getLoggableName(this)}.sendRequest`, false);

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

		const promptTemplate = await this.getPromptTemplate(action, model);
		if (promptTemplate == null) {
			debugger;
			Logger.error(undefined, scope, `Unable to find prompt template for '${action}'`);
			return undefined;
		}

		let retries = 0;
		let maxCodeCharacters = getMaxCharacters(model, 2600) - 1000; // TODO: Use chatModel.countTokens

		try {
			let truncated = false;
			while (true) {
				let prompt;
				({ prompt, truncated } = await resolvePrompt(
					action,
					promptTemplate,
					context,
					maxCodeCharacters,
					retries,
					reporting,
				));

				const messages: LanguageModelChatMessage[] = [LanguageModelChatMessage.User(prompt)];

				try {
					const rsp = await chatModel.sendRequest(
						messages,
						{
							justification: accessJustification,
							modelOptions: { temperature: getValidatedTemperature(model.temperature) },
						},
						cancellation,
					);

					if (truncated) {
						showPromptTruncationWarning(maxCodeCharacters, model);
					}

					let message = '';
					for await (const fragment of rsp.text) {
						message += fragment;
					}

					return { content: message.trim(), model: model } satisfies AIRequestResult;
				} catch (ex) {
					if (ex instanceof CancellationError) {
						Logger.error(
							ex,
							scope,
							`Cancelled request to ${promptTemplate.name}: (${model.provider.name})`,
						);
						throw ex;
					}

					debugger;

					let message = ex instanceof Error ? ex.message : String(ex);

					if (ex instanceof Error && 'code' in ex && ex.code === 'NoPermissions') {
						Logger.error(ex, scope, `User denied access to ${model.provider.name}`);
						throw new Error(`User denied access to ${model.provider.name}`);
					}

					if (ex instanceof Error && 'cause' in ex && ex.cause instanceof Error) {
						message += `\n${ex.cause.message}`;

						if (retries++ < 2 && ex.cause.message.includes('exceeds token limit')) {
							maxCodeCharacters -= 500 * retries;
							continue;
						}
					}

					Logger.error(ex, scope, `Unable to ${promptTemplate.name}: (${model.provider.name})`);
					throw new Error(
						`Unable to ${promptTemplate.name}: (${model.provider.name}${
							ex.code ? `:${ex.code}` : ''
						}) ${message}`,
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
		name: model.vendor === 'copilot' ? model.name : `${capitalize(model.vendor)} ${model.name}`,
		vendor: model.vendor,
		selector: {
			vendor: model.vendor,
			family: model.family,
		},
		maxTokens: { input: model.maxInputTokens, output: 4096 },
		provider: { id: provider.id, name: capitalize(model.vendor) },
	};
}

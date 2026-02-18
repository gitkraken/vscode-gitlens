import type { CancellationToken, Event, LanguageModelChat, LanguageModelChatSelector } from 'vscode';
import { Disposable, EventEmitter, LanguageModelChatMessage, lm } from 'vscode';
import { uuid } from '@env/crypto.js';
import { vscodeProviderDescriptor } from '../../constants.ai.js';
import type { Container } from '../../container.js';
import { AIError, AIErrorReason, CancellationError } from '../../errors.js';
import { getLoggableName } from '../../system/logger.js';
import { maybeStartLoggableScope } from '../../system/logger.scope.js';
import { capitalize } from '../../system/string.js';
import type { ServerConnection } from '../gk/serverConnection.js';
import type { AIActionType, AIModel } from './models/model.js';
import type { AIChatMessage, AIProvider, AIProviderResponse } from './models/provider.js';
import { getActionName, getReducedMaxInputTokens, getValidatedTemperature } from './utils/-webview/ai.utils.js';

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

	getApiKey(_silent: boolean): Promise<string | undefined> {
		return Promise.resolve('<not applicable>');
	}

	async getModels(): Promise<readonly AIModel<typeof provider.id>[]> {
		const models = await lm.selectChatModels();
		return models.map(getModelFromChatModel);
	}

	private async getChatModel(model: VSCodeAIModel): Promise<LanguageModelChat | undefined> {
		const models = await lm.selectChatModels(model.selector);
		return models?.[0];
	}

	async sendRequest<TAction extends AIActionType>(
		action: TAction,
		model: VSCodeAIModel,
		_apiKey: string,
		getMessages: (maxInputTokens: number, retries: number) => Promise<AIChatMessage[]>,
		options: { cancellation: CancellationToken; modelOptions?: { outputTokens?: number; temperature?: number } },
	): Promise<AIProviderResponse<void> | undefined> {
		using scope = maybeStartLoggableScope(`${getLoggableName(this)}.sendRequest`);

		const chatModel = await this.getChatModel(model);
		if (chatModel == null) return undefined;

		let retries = 0;
		let maxInputTokens = model.maxTokens.input;

		while (true) {
			try {
				const messages = (await getMessages(maxInputTokens, retries)).map(m => {
					switch (m.role) {
						case 'assistant':
							return LanguageModelChatMessage.Assistant(m.content);
						default:
							return LanguageModelChatMessage.User(m.content);
					}
				});

				const rsp = await chatModel.sendRequest(
					messages,
					{
						justification: accessJustification,
						modelOptions: {
							outputTokens: model.maxTokens.output
								? Math.min(options.modelOptions?.outputTokens ?? Infinity, model.maxTokens.output)
								: options.modelOptions?.outputTokens,
							temperature: getValidatedTemperature(model, model.temperature),
						},
					},
					options.cancellation,
				);

				if (options.cancellation.isCancellationRequested) {
					throw new CancellationError();
				}

				let message = '';
				for await (const fragment of rsp.text) {
					if (options.cancellation.isCancellationRequested) {
						throw new CancellationError();
					}

					message += fragment;
				}

				return {
					content: message.trim(),
					model: model,
					id: uuid(),
					result: undefined,
				} satisfies AIProviderResponse<void>;
			} catch (ex) {
				if (ex instanceof CancellationError) {
					scope?.error(ex, `Cancelled request to ${getActionName(action)}: (${model.provider.name})`);
					throw ex;
				}

				debugger;

				let message = ex instanceof Error ? ex.message : String(ex);

				if (ex instanceof Error && 'code' in ex && ex.code === 'NoPermissions') {
					scope?.error(ex, `User denied access to ${model.provider.name}`);
					throw new AIError(AIErrorReason.DeniedByUser, ex);
				}

				if (ex instanceof Error && 'cause' in ex && ex.cause instanceof Error) {
					message += `\n${ex.cause.message}`;
				}

				if (message.includes('exceeds token limit')) {
					if (++retries <= 3) {
						maxInputTokens = getReducedMaxInputTokens(maxInputTokens, retries);
						continue;
					}

					scope?.error(ex, `Unable to ${getActionName(action)}: (${model.provider.name})`);
					throw new AIError(AIErrorReason.RequestTooLarge, ex);
				}

				scope?.error(ex, `Unable to ${getActionName(action)}: (${model.provider.name})`);

				if (message.includes('Model is not supported for this request')) {
					throw new AIError(AIErrorReason.ModelNotSupported, ex);
				}

				throw new Error(
					`Unable to ${getActionName(action)}: (${model.provider.name}${
						ex.code ? `:${ex.code}` : ''
					}) ${message}`,
				);
			}
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
		maxTokens: { input: model.maxInputTokens, output: undefined },
		provider: { id: provider.id, name: capitalize(model.vendor) },
	};
}

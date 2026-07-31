import type { LanguageModelChat, LanguageModelChatSelector, LanguageModelChatTool } from 'vscode';
import {
	CancellationTokenSource,
	Disposable,
	EventEmitter,
	LanguageModelChatMessage,
	LanguageModelChatToolMode,
	LanguageModelTextPart,
	LanguageModelToolCallPart,
	LanguageModelToolResultPart,
	lm,
} from 'vscode';
import { vscodeProviderDescriptor } from '@gitlens/ai/constants.js';
import type { AIActionType, AIModel } from '@gitlens/ai/models/model.js';
import type {
	AIChatMessage,
	AIChatMessageRole,
	AIProvider,
	AIProviderResponse,
	AIToolCall,
	AIToolDefinition,
} from '@gitlens/ai/models/provider.js';
import type { AIProviderContext } from '@gitlens/ai/providers/context.js';
import { getActionName, getReducedMaxInputTokens, getValidatedTemperature } from '@gitlens/ai/utils/ai.utils.js';
import { CancellationError, isCancellationError } from '@gitlens/utils/cancellation.js';
import { uuid } from '@gitlens/utils/crypto.js';
import type { Event } from '@gitlens/utils/event.js';
import { getLoggableName } from '@gitlens/utils/logger.js';
import { maybeStartScopedLogger } from '@gitlens/utils/logger.scoped.js';
import { capitalize } from '@gitlens/utils/string.js';
import { AIError, AIErrorReason } from '../../errors.js';

const provider = vscodeProviderDescriptor;

type VSCodeAIModel = AIModel<typeof provider.id> & { vendor: string; selector: LanguageModelChatSelector };

const accessJustification =
	'GitLens leverages Copilot for AI-powered features to improve your workflow and development experience.';

export class VSCodeAIProvider implements AIProvider<typeof provider.id> {
	readonly id = provider.id;
	// The LM API carries tools on every model; individual Copilot families may still decline them, so
	// the caller's runtime fallback is what covers the rest.
	readonly supportsTools = true;

	private _name: string | undefined;
	get name(): string {
		return this._name ?? provider.name;
	}

	private _onDidChange = new EventEmitter<void>();
	get onDidChange(): Event<void> {
		return this._onDidChange.event as unknown as Event<void>;
	}

	private readonly _disposable: Disposable;

	constructor(private readonly context: AIProviderContext) {
		this._disposable = Disposable.from(
			this._onDidChange,
			lm.onDidChangeChatModels(() => this._onDidChange.fire()),
		);
	}

	dispose(): void {
		this._disposable.dispose();
	}
	[Symbol.dispose](): void {
		this.dispose();
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
		getMessages: (maxInputTokens: number, retries: number) => Promise<AIChatMessage<AIChatMessageRole>[]>,
		options: {
			signal: AbortSignal;
			modelOptions?: { outputTokens?: number; temperature?: number };
			tools?: readonly AIToolDefinition[];
		},
	): Promise<AIProviderResponse<void> | undefined> {
		using scope = maybeStartScopedLogger(`${getLoggableName(this)}.sendRequest`);

		const chatModel = await this.getChatModel(model);
		if (chatModel == null) return undefined;

		// Convert AbortSignal to VS Code CancellationToken for the Language Model API
		const cancellationSource = new CancellationTokenSource();
		if (options.signal.aborted) {
			cancellationSource.cancel();
		} else {
			options.signal.addEventListener('abort', () => cancellationSource.cancel(), { once: true });
		}
		const cancellation = cancellationSource.token;

		let retries = 0;
		let maxInputTokens = model.maxTokens.input;

		try {
			while (true) {
				try {
					const messages = (await getMessages(maxInputTokens, retries)).map(m => {
						switch (m.role) {
							case 'assistant':
								// A tool-call turn must replay the calls as content parts, or the model can't
								// match the tool results that follow it.
								if (m.toolCalls?.length) {
									return LanguageModelChatMessage.Assistant([
										...(m.content ? [new LanguageModelTextPart(m.content)] : []),
										...m.toolCalls.map(c => new LanguageModelToolCallPart(c.id, c.name, c.args)),
									]);
								}
								return LanguageModelChatMessage.Assistant(m.content);
							case 'tool':
								// The LM API carries tool results as a user message holding result parts,
								// keyed by the call they answer. Without an id, fall back to plain text
								// rather than asserting one exists — see the base provider.
								if (m.toolCallId == null) return LanguageModelChatMessage.User(m.content);

								return LanguageModelChatMessage.User([
									new LanguageModelToolResultPart(m.toolCallId, [
										new LanguageModelTextPart(m.content),
									]),
								]);
							default:
								return LanguageModelChatMessage.User(m.content);
						}
					});

					const tools: LanguageModelChatTool[] | undefined = options.tools?.length
						? options.tools.map(t => ({
								name: t.name,
								description: t.description,
								inputSchema: t.parameters,
							}))
						: undefined;

					const rsp = await chatModel.sendRequest(
						messages,
						{
							justification: accessJustification,
							...(tools != null ? { tools: tools, toolMode: LanguageModelChatToolMode.Auto } : undefined),
							modelOptions: {
								outputTokens: model.maxTokens.output
									? Math.min(options.modelOptions?.outputTokens ?? Infinity, model.maxTokens.output)
									: options.modelOptions?.outputTokens,
								temperature: getValidatedTemperature(
									model,
									model.temperature,
									this.context.defaultTemperature,
								),
							},
						},
						cancellation,
					);

					if (cancellation.isCancellationRequested) {
						throw new CancellationError();
					}

					// Consume `stream` rather than `text` — `text` yields only text parts, silently dropping
					// any tool calls the model made.
					let message = '';
					const toolCalls: AIToolCall[] = [];
					for await (const part of rsp.stream) {
						if (cancellation.isCancellationRequested) {
							throw new CancellationError();
						}

						if (part instanceof LanguageModelTextPart) {
							message += part.value;
						} else if (part instanceof LanguageModelToolCallPart) {
							toolCalls.push({
								id: part.callId,
								name: part.name,
								args: (part.input ?? {}) as Record<string, unknown>,
							});
						}
					}

					return {
						content: message.trim(),
						model: model,
						id: uuid(),
						...(toolCalls.length ? { toolCalls: toolCalls } : undefined),
						result: undefined,
					} satisfies AIProviderResponse<void>;
				} catch (ex) {
					if (isCancellationError(ex)) {
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
						{ cause: ex },
					);
				}
			}
		} finally {
			cancellationSource.dispose();
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

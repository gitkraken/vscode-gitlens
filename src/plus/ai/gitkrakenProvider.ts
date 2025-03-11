import type { CancellationToken } from 'vscode';
import type { Response } from '@env/fetch';
import { fetch } from '@env/fetch';
import { debug } from '../../system/decorators/log';
import { Logger } from '../../system/logger';
import { getLogScope } from '../../system/logger.scope';
import type { AIActionType, AIModel } from './models/model';
import type { PromptTemplate } from './models/promptTemplates';
import { OpenAICompatibleProvider } from './openAICompatibleProvider';
import { getActionName } from './utils/-webview/ai.utils';

const provider = { id: 'gitkraken', name: 'GitKraken AI (Preview)' } as const;

type GitKrakenModel = AIModel<typeof provider.id>;

export class GitKrakenProvider extends OpenAICompatibleProvider<typeof provider.id> {
	readonly id = provider.id;
	readonly name = provider.name;
	protected readonly config = {};

	@debug()
	async getModels(): Promise<readonly AIModel<typeof provider.id>[]> {
		const scope = getLogScope();

		try {
			const rsp = await fetch(this.container.urls.getGkAIApiUrl('providers/message-prompt'), {
				headers: await this.connection.getGkHeaders(undefined, undefined, {
					Accept: 'application/json',
				}),
			});

			interface ModelsResponse {
				data: {
					providerId: string;
					providerName: string;
					modelId: string;
					modelName: string;
					preferred: boolean;
					maxInputTokens: number;
					maxOutputTokens: number;
				}[];
				error?: null;
			}

			const result: ModelsResponse = await rsp.json();

			if (result.error == null) {
				const models: GitKrakenModel[] = result.data.map(
					m =>
						({
							id: m.modelId,
							name: m.modelName,
							maxTokens: { input: m.maxInputTokens, output: m.maxOutputTokens },
							provider: provider,
							default: m.preferred,
							temperature: null,
						}) satisfies GitKrakenModel,
				);
				return models;
			}

			debugger;
			Logger.error(undefined, scope, `${String(result.error)}: Unable to get models`);
		} catch (ex) {
			debugger;
			Logger.error(ex, scope, `Unable to get models`);
		}

		return [];
	}

	override async getPromptTemplate<TAction extends AIActionType>(
		action: TAction,
		model: AIModel<typeof provider.id>,
	): Promise<PromptTemplate | undefined> {
		const scope = getLogScope();

		try {
			const rsp = await fetch(this.container.urls.getGkAIApiUrl(`templates/message-prompt/${action}`), {
				headers: await this.connection.getGkHeaders(undefined, undefined, {
					Accept: 'application/json',
				}),
			});

			interface PromptResponse {
				data: {
					id: string;
					template: string;
					variables: string[];
				};
				error?: null;
			}

			const result: PromptResponse = await rsp.json();
			if (result.error == null) {
				return {
					id: result.data.id,
					name: getActionName(action),
					template: result.data.template,
					variables: result.data.variables,
				};
			}

			debugger;
			Logger.error(undefined, scope, `${String(result.error)}: Unable to get prompt template for '${action}'`);
		} catch (ex) {
			debugger;
			Logger.error(ex, scope, `Unable to get prompt template for '${action}'`);
		}

		return super.getPromptTemplate(action, model);
	}

	protected override getApiKey(): Promise<string | undefined> {
		return Promise.resolve('');
	}

	protected getUrl(_model: AIModel<typeof provider.id>): string {
		return this.container.urls.getGkAIApiUrl('chat/completions');
	}

	protected override getHeaders<TAction extends AIActionType>(
		action: TAction,
		_model: AIModel<typeof provider.id>,
		_url: string,
		_apiKey: string,
	): Promise<Record<string, string>> {
		return this.connection.getGkHeaders(undefined, undefined, {
			Accept: 'application/json',
			'GK-Action': action,
		});
	}

	protected override fetchCore<TAction extends AIActionType>(
		action: TAction,
		model: AIModel<typeof provider.id>,
		_apiKey: string,
		request: object,
		cancellation: CancellationToken | undefined,
	): Promise<Response> {
		return super.fetchCore(action, model, _apiKey, request, cancellation);
	}
}

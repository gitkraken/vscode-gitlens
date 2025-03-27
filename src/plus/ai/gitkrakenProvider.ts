import type { Disposable } from 'vscode';
import { fetch } from '@env/fetch';
import { gitKrakenProviderDescriptor as provider } from '../../constants.ai';
import type { Container } from '../../container';
import { AuthenticationRequiredError } from '../../errors';
import { debug } from '../../system/decorators/log';
import { Logger } from '../../system/logger';
import { getLogScope } from '../../system/logger.scope';
import { PromiseCache } from '../../system/promiseCache';
import type { ServerConnection } from '../gk/serverConnection';
import type { AIActionType, AIModel } from './models/model';
import type { PromptTemplate } from './models/promptTemplates';
import { OpenAICompatibleProvider } from './openAICompatibleProvider';
import { ensureAccount, getActionName } from './utils/-webview/ai.utils';

type GitKrakenModel = AIModel<typeof provider.id>;

export class GitKrakenProvider extends OpenAICompatibleProvider<typeof provider.id> {
	readonly id = provider.id;
	readonly name = provider.name;
	protected readonly descriptor = provider;
	protected readonly config = {};

	private readonly _disposable: Disposable;
	private readonly _promptTemplates = new PromiseCache<AIActionType, PromptTemplate>({
		createTTL: 12 * 60 * 60 * 1000, // 12 hours
		expireOnError: true,
	});

	constructor(container: Container, connection: ServerConnection) {
		super(container, connection);

		this._disposable = this.container.subscription.onDidChange(() => this._promptTemplates.clear());
	}

	override dispose(): void {
		this._disposable.dispose();
	}

	@debug()
	async getModels(): Promise<readonly AIModel<typeof provider.id>[]> {
		const scope = getLogScope();

		try {
			const url = this.container.urls.getGkAIApiUrl('providers/message-prompt');
			const rsp = await fetch(url, {
				headers: await this.connection.getGkHeaders(undefined, undefined, {
					Accept: 'application/json',
				}),
			});
			if (!rsp.ok) {
				throw new Error(`Getting models (${url}) failed: ${rsp.status} (${rsp.statusText})`);
			}

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
			if (result.error != null) {
				throw new Error(`Getting models (${url}) failed: ${String(result.error)}`);
			}

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
		} catch (ex) {
			if (!(ex instanceof AuthenticationRequiredError)) {
				debugger;
				Logger.error(ex, scope, `Unable to get models`);
			}
		}

		return [];
	}

	override async getPromptTemplate<TAction extends AIActionType>(
		action: TAction,
		model: AIModel<typeof provider.id>,
	): Promise<PromptTemplate | undefined> {
		const scope = getLogScope();

		try {
			return await this._promptTemplates.get(action, async () => {
				const url = this.container.urls.getGkAIApiUrl(`templates/message-prompt/${action}`);
				const rsp = await fetch(url, {
					headers: await this.connection.getGkHeaders(undefined, undefined, {
						Accept: 'application/json',
					}),
				});
				if (!rsp.ok) {
					throw new Error(`Getting prompt template (${url}) failed: ${rsp.status} (${rsp.statusText})`);
				}

				interface PromptResponse {
					data: {
						id: string;
						template: string;
						variables: string[];
					};
					error?: null;
				}

				const result: PromptResponse = await rsp.json();
				if (result.error != null) {
					throw new Error(`Getting prompt template (${url}) failed: ${String(result.error)}`);
				}

				return {
					id: result.data.id,
					name: getActionName(action),
					template: result.data.template,
					variables: result.data.variables,
				};
			});
		} catch (ex) {
			if (!(ex instanceof AuthenticationRequiredError)) {
				debugger;
				Logger.error(ex, scope, `Unable to get prompt template for '${action}'`);
			}
		}

		return super.getPromptTemplate(action, model);
	}

	protected override async getApiKey(silent: boolean): Promise<string | undefined> {
		let session = await this.container.subscription.getAuthenticationSession();
		if (session?.accessToken) return session.accessToken;
		if (silent) return undefined;

		const result = await ensureAccount(this.container, silent);
		if (!result) return undefined;

		session = await this.container.subscription.getAuthenticationSession();
		return session?.accessToken;
	}

	protected getUrl(_model: AIModel<typeof provider.id>): string {
		return this.container.urls.getGkAIApiUrl('chat/completions');
	}

	protected override getHeaders<TAction extends AIActionType>(
		action: TAction,
		_model: AIModel<typeof provider.id>,
		_url: string,
		apiKey: string,
	): Promise<Record<string, string>> {
		return this.connection.getGkHeaders(apiKey, undefined, {
			Accept: 'application/json',
			'GK-Action': action,
		});
	}
}

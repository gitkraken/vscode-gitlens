import type { Response } from '@env/fetch';
import { fetch } from '@env/fetch';
import { gitKrakenProviderDescriptor as provider } from '../../constants.ai';
import { AIError, AIErrorReason, AuthenticationRequiredError } from '../../errors';
import { debug } from '../../system/decorators/log';
import { Logger } from '../../system/logger';
import { getLogScope } from '../../system/logger.scope';
import type { AIActionType, AIModel } from './models/model';
import { OpenAICompatibleProvider } from './openAICompatibleProvider';
import { ensureAccount } from './utils/-webview/ai.utils';

type GitKrakenModel = AIModel<typeof provider.id>;

export class GitKrakenProvider extends OpenAICompatibleProvider<typeof provider.id> {
	readonly id = provider.id;
	readonly name = provider.name;
	protected readonly descriptor = provider;
	protected readonly config = {};

	override async getApiKey(silent: boolean): Promise<string | undefined> {
		let session = await this.container.subscription.getAuthenticationSession();
		if (session?.accessToken) return session.accessToken;
		if (silent) return undefined;

		const result = await ensureAccount(this.container, silent);
		if (!result) return undefined;

		session = await this.container.subscription.getAuthenticationSession();
		return session?.accessToken;
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

			const models = result.data.map<GitKrakenModel>(
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

	protected getUrl(_model: AIModel<typeof provider.id>): string {
		return this.container.urls.getGkAIApiUrl('chat/completions');
	}

	protected override getHeaders<TAction extends AIActionType>(
		action: TAction,
		apiKey: string,
		_model: AIModel<typeof provider.id>,
		_url: string,
	): Promise<Record<string, string>> {
		return this.connection.getGkHeaders(apiKey, undefined, {
			Accept: 'application/json',
			'GK-Action': action,
		});
	}

	protected override async handleFetchFailure<TAction extends AIActionType>(
		rsp: Response,
		_action: TAction,
		_model: AIModel<typeof provider.id>,
		retries: number,
		maxInputTokens: number,
	): Promise<{ retry: true; maxInputTokens: number }> {
		type ErrorResponse = {
			error?: { code: string; message: string; data?: any };
		};

		let json;
		try {
			json = (await rsp.json()) as ErrorResponse | undefined;
		} catch {}

		let message = json?.error?.message || rsp.statusText;

		let status: string | number;
		let code: string | number;
		[status, code] = json?.error?.code?.split('.') ?? [];

		status = status ? parseInt(status, 10) : rsp.status;
		code = code ? parseInt(code, 10) : 0;

		switch (status) {
			case 400: // Bad Request
				// CodeValidation         = "400.1"
				throw new Error(`(${this.name}) ${status}.${code}: ${message}`);
			case 401:
				// CodeAuthentication     = "401.1"
				throw new AuthenticationRequiredError();
			case 403:
				// CodeAuthorization      = "403.1"
				// CodeEntitlement        = "403.2"
				// CodeFeatureDisabled    = "403.3"

				// Entitlement Error
				if (code === 2) {
					type EntitlementErrorData = {
						entitlementId?: string;
						entitlementValue?: string | number;
						currentValue?: string | number;
					};

					const data = json?.error?.data as EntitlementErrorData;
					const entitlementId = data?.entitlementId;
					if (entitlementId != null) {
						message += `; entitlement=${data.entitlementId} ${JSON.stringify(data)}`;
					}

					throw new AIError(
						// If there is an `entitlementValue` then we are over the limit, otherwise it is an entitlement error
						data?.entitlementValue ? AIErrorReason.UserQuotaExceeded : AIErrorReason.NoEntitlement,
						new Error(`(${this.name}) ${status}.${code}: ${message}`),
					);
				} else if (code === 3) {
					throw new AIError(
						AIErrorReason.DeniedByOrganization,
						new Error(`(${this.name}) ${status}.${code}: ${message}`),
					);
				}
				throw new AIError(
					AIErrorReason.Unauthorized,
					new Error(`(${this.name}) ${status}.${code}: ${message}`),
				);
				throw new Error(`(${this.name}) ${status}.${code}: ${message}`);
			case 404:
				// CodeNotFound           = "404.1"
				throw new Error(`(${this.name}) ${status}.${code}: ${message}`);
			case 408:
				// CodeTimeout            = "408.1"
				throw new Error(`(${this.name}) ${status}.${code}: ${message}`);
			case 413:
				// CodeRequestTooLarge    = "413.1"

				// Request too large
				if (code === 1) {
					if (retries < 2) {
						return { retry: true, maxInputTokens: maxInputTokens - 200 * (retries || 1) };
					}
					throw new AIError(
						AIErrorReason.RequestTooLarge,
						new Error(`(${this.name}) ${status}.${code}: ${message}`),
					);
				}
				throw new Error(`(${this.name}) ${status}.${code}: ${message}`);
			case 429:
				// CodeTooManyRequests    = "429.1"

				// Too many requests
				if (code === 1) {
					throw new AIError(
						AIErrorReason.RateLimitExceeded,
						new Error(`(${this.name}) ${status}.${code}: ${message}`),
					);
				}
				throw new Error(`(${this.name}) ${status}.${code}: ${message}`);
			case 499:
				// CodeRequestCanceled    = "499.1"
				throw new Error(`(${this.name}) ${status}.${code}: ${message}`);
			case 500:
				// CodeServerError        = "500.1"
				throw new Error(`(${this.name}) ${status}.${code}: ${message}`);
			case 503:
				// CodeServiceUnavailable = "503.1"

				// Service unavailable
				if (code === 1) {
					if (message === 'Agent Error: too many requests') {
						throw new AIError(
							AIErrorReason.ServiceCapacityExceeded,
							new Error(`(${this.name}) ${status}.${code}: ${message}`),
						);
					}
				}
				throw new Error(`(${this.name}) ${status}.${code}: ${message}`);
			default:
				throw new Error(`(${this.name}) ${status}.${code}: ${message}`);
		}
	}
}

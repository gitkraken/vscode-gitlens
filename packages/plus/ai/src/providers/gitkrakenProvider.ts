import { trace } from '@gitlens/utils/decorators/log.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import { gitKrakenProviderDescriptor as provider } from '../constants.js';
import { AIError, AIErrorReason, AuthenticationRequiredError } from '../errors.js';
import type { AIActionType, AIModel } from '../models/model.js';
import { getReducedMaxInputTokens } from '../utils/ai.utils.js';
import { OpenAICompatibleProviderBase } from './openAICompatibleProviderBase.js';

type GitKrakenModel = AIModel<typeof provider.id>;

/** Opt-out flag the models endpoint reports in `disabledAttributes` for models whose upstream
 *  translation doesn't cover native structured outputs */
const structuredOutputAttribute = 'structured_output';

export class GitKrakenProvider extends OpenAICompatibleProviderBase<typeof provider.id> {
	readonly id = provider.id;
	readonly name = provider.name;
	readonly supportsTools = true;
	protected readonly descriptor = provider;
	protected readonly config = {};

	override async getApiKey(silent: boolean): Promise<string | undefined> {
		return this.context.getApiKey(
			{
				id: this.id,
				name: this.name,
				requiresAccount: this.descriptor.requiresAccount,
				validator: () => true,
			},
			silent,
		);
	}

	@trace()
	async getModels(): Promise<readonly AIModel<typeof provider.id>[]> {
		const scope = getScopedLogger();

		try {
			const rsp = await this.context.fetch('providers/message-prompt', {
				headers: { Accept: 'application/json' },
			});
			if (!rsp.ok) {
				throw new Error(`Getting models failed: ${rsp.status} (${rsp.statusText})`);
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
					disabledAttributes?: string[];
					consumptionRateLabel?: string;
				}[];
				error?: null;
			}

			const result = (await rsp.json()) as ModelsResponse;
			if (result.error != null) {
				throw new Error(`Getting models failed: ${String(result.error)}`);
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
						consumptionRateLabel: m.consumptionRateLabel,
						// The backend owns the per-upstream `response_format` translation, so it's the
						// authority on which models it covers. A schema an upstream's converter still
						// rejects is recovered per-request via isResponseFormatRejection below
						supportsStructuredOutputs: !m.disabledAttributes?.includes(structuredOutputAttribute),
					}) satisfies GitKrakenModel,
			);
			return models;
		} catch (ex) {
			if (!(ex instanceof AuthenticationRequiredError)) {
				debugger;
				scope?.error(ex, `Unable to get models`);
			}
		}

		return [];
	}

	protected getUrl(_model: AIModel<typeof provider.id>): string {
		return 'chat/completions';
	}

	protected override isResponseFormatRejection(status: number, body: string): boolean {
		if (super.isResponseFormatRejection(status, body)) return true;

		// The backend wraps upstream schema rejections as its own 500.1 carrying only the upstream
		// status (e.g. its Gemini schema converter mangles null-union types → Gemini 400s). A
		// non-schema upstream 400 also matches — the strip-and-resend probe is cheap and rejection
		// is only memoized when the resend succeeds, so misclassification self-corrects.
		return status === 500 && getWrappedUpstreamStatus(body) === 400;
	}

	protected override getHeaders<TAction extends AIActionType>(
		action: TAction,
		apiKey: string,
		_model: AIModel<typeof provider.id>,
		_url: string,
		conversationId?: string,
	): Record<string, string> {
		return {
			Accept: 'application/json',
			Authorization: `Bearer ${apiKey}`,
			'GK-Action': action,
			// Scopes the backend's once-per-conversation feature fee — without it every request in a
			// multi-call session (e.g. conflict resolution) is charged the full flat fee.
			...(conversationId ? { 'GK-Conversation-ID': conversationId } : {}),
		};
	}

	protected override async handleFetchFailure<TAction extends AIActionType>(
		rsp: Response,
		_action: TAction,
		_model: AIModel<typeof provider.id>,
		retries: number,
		maxInputTokens: number,
		body?: string,
	): Promise<{ retry: true; maxInputTokens: number }> {
		type ErrorResponse = {
			error?: { code: string; message: string; data?: any };
		};

		let json;
		try {
			json = (body != null ? JSON.parse(body) : await rsp.json()) as ErrorResponse | undefined;
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
					if (retries < 3) {
						return { retry: true, maxInputTokens: getReducedMaxInputTokens(maxInputTokens, retries + 1) };
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
			case 500: {
				// CodeServerError        = "500.1"

				// The backend wraps ALL upstream provider failures as 500.1, carrying only the
				// upstream HTTP status in the message — recover the actionable ones from it
				if (getWrappedUpstreamStatus(message) === 429) {
					throw new AIError(
						AIErrorReason.RateLimitExceeded,
						new Error(`(${this.name}) ${status}.${code}: ${message}`),
					);
				}
				throw new Error(`(${this.name}) ${status}.${code}: ${message}`);
			}
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

/** Extracts the upstream HTTP status from the backend's 500.1 upstream-error prose wrapper */
function getWrappedUpstreamStatus(text: string): number | undefined {
	const status = /upstream ai provider error[\s\S]*?http (\d{3})/i.exec(text)?.[1];
	return status != null ? parseInt(status, 10) : undefined;
}

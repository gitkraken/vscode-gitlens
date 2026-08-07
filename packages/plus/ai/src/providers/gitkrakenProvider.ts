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

	protected override isToolsRejection(status: number, message: string | undefined): boolean {
		if (super.isToolsRejection(status, message)) return true;
		if (message == null) return false;

		// The backend forwards an upstream refusal as its own envelope carrying only "upstream AI provider
		// error (<provider> HTTP 400)", naming neither "tool" nor "function" — so the base's text match can
		// never fire here. Treat any wrapped upstream 400 as a candidate and let the retry decide: `tools`
		// is the only field a tool-using request sends that a plain completion doesn't, the probe costs one
		// request, and the caller latches the rejection only when dropping tools actually fixes it. A
		// misread therefore self-corrects — the same bargain `isResponseFormatRejection` below makes.
		return getWrappedUpstreamStatus(message) === 400;
	}

	protected override isResponseFormatRejection(status: number, body: string): boolean {
		if (super.isResponseFormatRejection(status, body)) return true;

		// The backend wraps upstream schema rejections in its own envelope, carrying only the upstream
		// status (e.g. its Gemini schema converter mangles null-union types → Gemini 400s). Match on the
		// wrapper, NOT the envelope code — that varies by backend (500.1 on prod, 400.1 seen on staging),
		// and keying off it means the probe silently stops firing. A non-schema upstream 400 also matches,
		// which is fine: the strip-and-resend probe is cheap and rejection is only memoized when the
		// resend succeeds, so misclassification self-corrects.
		return getWrappedUpstreamStatus(body) === 400;
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
		sentTools?: boolean,
	): Promise<{ retry: true; maxInputTokens: number; withoutTools?: boolean }> {
		type ErrorResponse = {
			error?: { code: string; message: string; data?: any };
		};

		let json;
		try {
			json = (body != null ? JSON.parse(body) : await rsp.json()) as ErrorResponse | undefined;
		} catch {}

		// The backend's own prose says only "upstream AI provider error (<provider> HTTP <status>)" and
		// puts the provider's actual complaint in `data`. Dropping it (as every branch but the
		// entitlement one did) leaves nothing naming a cause, so a request the upstream rejected is
		// indistinguishable from any other 400 — and the only way to find out is to guess.
		let message = json?.error?.message || rsp.statusText;
		const detail = formatErrorData(json?.error?.data);
		if (detail != null) {
			message += `; ${detail}`;
		}

		let status: string | number;
		let code: string | number;
		[status, code] = json?.error?.code?.split('.') ?? [];

		status = status ? parseInt(status, 10) : rsp.status;
		code = code ? parseInt(code, 10) : 0;

		// Classify a wrapped upstream failure by the status it carries, not by the envelope's own code:
		// prod reports these as 500.1, but staging has been seen using 400.1, and keying off the outer
		// code means an upstream rate limit arrives as a bare Error with no reason — so no "Switch
		// Model" action and no retry, just an opaque message.
		const upstreamStatus = getWrappedUpstreamStatus(message);
		if (upstreamStatus != null) {
			const wrapped = new Error(`(${this.name}) ${status}.${code}: ${message}`);
			switch (upstreamStatus) {
				case 429:
					throw new AIError(AIErrorReason.RateLimitExceeded, wrapped);
				case 413:
					throw new AIError(AIErrorReason.RequestTooLarge, wrapped);
				case 401:
				case 403:
					throw new AIError(AIErrorReason.Unauthorized, wrapped);
				// Anything else is the upstream refusing the request itself. There's nothing to recover
				// automatically, so fall through and surface it with the detail folded in above.
			}
		}

		// Recover a tools rejection BEFORE the switch below. This override owns the 400 case and throws,
		// so it never reaches `super.handleFetchFailure` — which is the only place the base's
		// retry-without-tools fallback lives, leaving it unreachable for this provider.
		if (sentTools && this.isToolsRejection(status, message)) {
			return { retry: true, maxInputTokens: maxInputTokens, withoutTools: true };
		}

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
				// Wrapped upstream failures are classified above, before this switch — the backend has
				// used more than one envelope code for them, so that can't key off `status`.
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

/** Max characters of `error.data` folded into a message — enough to name a cause, bounded so a large
 *  payload can't dominate a notification or a log line. */
const maxErrorDetailLength = 500;

/**
 * Renders the backend's `error.data` as a short detail string. This is where the upstream provider's
 * own complaint arrives, so it's the difference between "upstream AI provider error (OpenAI HTTP 400)"
 * and knowing which field it rejected.
 *
 * Strings pass through; objects are JSON-encoded. A common shape is the upstream's own error envelope,
 * so a nested `message` is preferred when present rather than dumping the whole object.
 */
function formatErrorData(data: unknown): string | undefined {
	if (data == null) return undefined;

	let text: string | undefined;
	if (typeof data === 'string') {
		text = data;
	} else if (typeof data === 'object') {
		const nested =
			(data as { error?: { message?: unknown }; message?: unknown }).error?.message ??
			(data as { message?: unknown }).message;
		if (typeof nested === 'string' && nested) {
			text = nested;
		} else {
			try {
				text = JSON.stringify(data);
			} catch {
				return undefined;
			}
		}
	} else if (typeof data === 'number' || typeof data === 'boolean') {
		text = String(data);
	}

	text = text?.trim();
	if (!text || text === '{}' || text === 'null') return undefined;

	return text.length > maxErrorDetailLength ? `${text.slice(0, maxErrorDetailLength)}…` : text;
}

/** Extracts the upstream HTTP status from the backend's upstream-error prose wrapper. The envelope code
 *  varies (500.1 on prod, 400.1 seen on staging), so callers must key off this, not the outer code. */
function getWrappedUpstreamStatus(text: string): number | undefined {
	const status = /upstream ai provider error[\s\S]*?http (\d{3})/i.exec(text)?.[1];
	return status != null ? parseInt(status, 10) : undefined;
}

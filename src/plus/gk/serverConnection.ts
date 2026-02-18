import type { RequestError } from '@octokit/request-error';
import type { CancellationToken } from 'vscode';
import { version as codeVersion, env, Uri, window } from 'vscode';
import type { RequestInfo, RequestInit, Response } from '@env/fetch.js';
import { fetch as _fetch, getProxyAgent } from '@env/fetch.js';
import { getPlatform } from '@env/platform.js';
import type { Disposable } from '../../api/gitlens.d.js';
import type { Container } from '../../container.js';
import {
	AuthenticationError,
	AuthenticationErrorReason,
	AuthenticationRequiredError,
	CancellationError,
	RequestClientError,
	RequestGoneError,
	RequestNotFoundError,
	RequestRateLimitError,
	RequestsAreBlockedTemporarilyError,
	RequestUnprocessableEntityError,
} from '../../errors.js';
import {
	showGkDisconnectedTooManyFailedRequestsWarningMessage,
	showGkRequestFailed500WarningMessage,
	showGkRequestTimedOutWarningMessage,
} from '../../messages.js';
import { trace } from '../../system/decorators/log.js';
import { memoize } from '../../system/decorators/memoize.js';
import { Logger } from '../../system/logger.js';
import type { ScopedLogger } from '../../system/logger.scope.js';
import { getScopedLogger } from '../../system/logger.scope.js';
import type { TokenInfo } from '../integrations/authentication/models.js';
import { toTokenInfo } from '../integrations/authentication/models.js';
import type { UrlsProvider } from './urlsProvider.js';

interface FetchOptions {
	cancellation?: CancellationToken;
	timeout?: number;
}

interface GKFetchOptions extends FetchOptions {
	token?: string | false;
	organizationId?: string | false;
	query?: string;
}

export class ServerConnection implements Disposable {
	constructor(
		private readonly container: Container,
		public readonly urls: UrlsProvider,
	) {}

	dispose(): void {}

	@memoize()
	get userAgent(): string {
		// TODO@eamodio figure out standardized format/structure for our user agents
		return `${this.container.debugging ? 'GitLens-Debug' : this.container.prerelease ? 'GitLens-Pre' : 'GitLens'}/${
			this.container.version
		} (${env.appName}/${codeVersion}; ${getPlatform()})`;
	}

	@memoize()
	get clientName(): string {
		return this.container.debugging
			? 'gitlens-vsc-debug'
			: this.container.prerelease
				? 'gitlens-vsc-pre'
				: 'gitlens-vsc';
	}

	@trace({
		args: (url, _, options) => ({
			url: typeof url === 'string' ? url : 'href' in url ? url.href : 'url' in url ? url.url : 'unknown',
			options: options,
		}),
	})
	async fetch(url: RequestInfo, init?: RequestInit, options?: FetchOptions): Promise<Response> {
		const scope = getScopedLogger();

		if (options?.cancellation?.isCancellationRequested) throw new CancellationError();

		const aborter = new AbortController();

		let timeout;
		if (options?.cancellation != null) {
			timeout = options.timeout; // Don't set a default timeout if we have a cancellation token
			options.cancellation.onCancellationRequested(() => aborter.abort());
		} else {
			timeout = options?.timeout ?? 60 * 1000;
		}

		const timer = timeout != null ? setTimeout(() => aborter.abort(), timeout) : undefined;

		try {
			const promise = _fetch(url, {
				agent: getProxyAgent(),
				...init,
				headers: {
					'User-Agent': this.userAgent,
					...init?.headers,
				},
				signal: aborter?.signal,
			});
			void promise.finally(() => clearTimeout(timer));
			return await promise;
		} catch (ex) {
			scope?.error(ex);
			if (ex.name === 'AbortError') throw new CancellationError(ex);

			throw ex;
		}
	}

	@trace({
		args: (path, _, options) => ({ path: path, token: options?.token, organizationId: options?.organizationId }),
	})
	async fetchGkApi(path: string, init?: RequestInit, options?: GKFetchOptions): Promise<Response> {
		return this.gkFetch(this.urls.getGkApiUrl(path), init, options);
	}

	@trace({
		args: (path, _, options) => ({ path: path, options: options }),
	})
	async fetchGkConfig(path: string, init?: RequestInit, options?: FetchOptions): Promise<Response> {
		return this.fetch(this.urls.getGkConfigUrl(path), init, options);
	}

	async fetchGkApiGraphQL(
		path: string,
		request: GraphQLRequest,
		init?: RequestInit,
		options?: GKFetchOptions,
	): Promise<Response> {
		return this.fetchGkApi(path, { method: 'POST', ...init, body: JSON.stringify(request) }, options);
	}

	async getGkHeaders(
		token?: string | false,
		organizationId?: string | false,
		init?: Record<string, string>,
	): Promise<Record<string, string>> {
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
			'Client-Name': this.clientName,
			'Client-Version': this.container.version,
			'User-Agent': this.userAgent,
			...init,
		};

		token ??= await this.getAccessToken();
		if (token) {
			headers.Authorization = `Bearer ${token}`;
		}

		// only check for cached subscription or we'll get into an infinite loop
		organizationId ??= (await this.container.subscription.getSubscription(true)).activeOrganization?.id;
		if (organizationId) {
			headers['gk-org-id'] = organizationId;
		}

		return headers;
	}

	@trace({
		args: (url, _, options) => ({
			url: typeof url === 'string' ? url : 'href' in url ? url.href : 'url' in url ? url.url : 'unknown',
			token: options?.token,
			organizationId: options?.organizationId,
		}),
	})
	private async gkFetch(url: RequestInfo, init?: RequestInit, options?: GKFetchOptions): Promise<Response> {
		if (this.requestsAreBlocked) throw new RequestsAreBlockedTemporarilyError();

		const scope = getScopedLogger();

		try {
			const headers = await this.getGkHeaders(
				options?.token,
				options?.organizationId,
				init?.headers ? { ...(init?.headers as Record<string, string>) } : undefined,
			);

			if (options?.query != null) {
				if (url instanceof URL) {
					url.search = options.query;
				} else if (typeof url === 'string') {
					url = `${url}?${options.query}`;
				}
			}

			const rsp = await this.fetch(url, { ...init, headers: headers }, options);
			if (!rsp.ok) {
				await this.handleGkUnsuccessfulResponse(rsp, scope);
			} else {
				this.resetRequestExceptionCount();
			}
			return rsp;
		} catch (ex) {
			this.handleGkRequestError(options?.token || undefined, ex, scope);
			throw ex;
		}
	}

	private buildRequestRateLimitError(token: string | undefined, ex: RequestError) {
		let resetAt: number | undefined;

		const reset = ex.response?.headers?.['x-ratelimit-reset'];
		if (reset != null) {
			resetAt = parseInt(reset, 10);
			if (Number.isNaN(resetAt)) {
				resetAt = undefined;
			}
		}
		return new RequestRateLimitError(ex, token, resetAt);
	}

	private async handleGkUnsuccessfulResponse(rsp: Response, scope: ScopedLogger | undefined): Promise<void> {
		let content;
		switch (rsp.status) {
			// Forbidden
			case 403:
				if (rsp.statusText.includes('rate limit')) {
					this.trackRequestException();
				}
				return;
			// Too Many Requests
			case 429:
				this.trackRequestException();
				return;
			// Internal Server Error
			case 500:
				this.trackRequestException();
				void showGkRequestFailed500WarningMessage(
					'GitKraken failed to respond and might be experiencing issues. Please visit the [GitKraken status page](https://cloud.gitkrakenstatus.com) for more information.',
				);
				return;
			// Bad Gateway
			case 502: {
				// Be sure to clone the response so we don't impact any upstream consumers
				content = await rsp.clone().text();

				scope?.error(undefined, `GitKraken request failed: ${content} (${rsp.statusText})`);
				if (content.includes('timeout')) {
					this.trackRequestException();
					void showGkRequestTimedOutWarningMessage();
				}
				return;
			}
			// Service Unavailable
			case 503: {
				// Be sure to clone the response so we don't impact any upstream consumers
				content = await rsp.clone().text();

				scope?.error(undefined, `GitKraken request failed: ${content} (${rsp.statusText})`);
				this.trackRequestException();
				void showGkRequestFailed500WarningMessage(
					'GitKraken failed to respond and might be experiencing issues. Please visit the [GitKraken status page](https://cloud.gitkrakenstatus.com) for more information.',
				);
				return;
			}
		}

		if (rsp.status >= 400 && rsp.status < 500) return;

		if (Logger.isDebugging) {
			// Be sure to clone the response so we don't impact any upstream consumers
			content ??= await rsp.clone().text();
			void window.showErrorMessage(`DEBUGGING: GitKraken request failed: ${content} (${rsp.statusText})`);
		}
	}

	private handleGkRequestError(
		token: string | undefined,
		ex: RequestError | (Error & { name: 'AbortError' }),
		scope: ScopedLogger | undefined,
	): void {
		if (ex instanceof CancellationError) throw ex;
		if (ex.name === 'AbortError') throw new CancellationError(ex);

		const gitkrakenTokenInfo: TokenInfo<'gitkraken'> = toTokenInfo('gitkraken', token, {
			cloud: true,
			type: undefined,
			scopes: undefined,
		});

		switch (ex.status) {
			case 404: // Not found
				throw new RequestNotFoundError(ex);
			case 410: // Gone
				throw new RequestGoneError(ex);
			case 422: // Unprocessable Entity
				throw new RequestUnprocessableEntityError(ex);
			case 401: // Unauthorized
				throw new AuthenticationError(gitkrakenTokenInfo, AuthenticationErrorReason.Unauthorized, ex);
			case 429: //Too Many Requests
				this.trackRequestException();
				throw this.buildRequestRateLimitError(token, ex);
			case 403: // Forbidden
				if (ex.message.includes('rate limit')) {
					this.trackRequestException();
					throw this.buildRequestRateLimitError(token, ex);
				}
				throw new AuthenticationError(gitkrakenTokenInfo, AuthenticationErrorReason.Forbidden, ex);
			case 500: // Internal Server Error
				scope?.error(ex);
				if (ex.response != null) {
					this.trackRequestException();
					void showGkRequestFailed500WarningMessage(
						'GitKraken failed to respond and might be experiencing issues. Please visit the [GitKraken status page](https://cloud.gitkrakenstatus.com) for more information.',
					);
				}
				return;
			case 502: // Bad Gateway
				scope?.error(ex);
				if (ex.message.includes('timeout')) {
					this.trackRequestException();
					void showGkRequestTimedOutWarningMessage();
				}
				break;
			case 503: // Service Unavailable
				scope?.error(ex);
				this.trackRequestException();
				void showGkRequestFailed500WarningMessage(
					'GitKraken failed to respond and might be experiencing issues. Please visit the [GitKraken status page](https://cloud.gitkrakenstatus.com) for more information.',
				);
				return;
			default:
				if (ex.status >= 400 && ex.status < 500) throw new RequestClientError(ex);
				break;
		}

		if (Logger.isDebugging) {
			void window.showErrorMessage(
				`DEBUGGING: GitKraken request failed: ${(ex.response as any)?.errors?.[0]?.message ?? ex.message}`,
			);
		}
	}

	private async getAccessToken() {
		const session = await this.container.subscription.getAuthenticationSession();
		if (session != null) return session.accessToken;

		throw new AuthenticationRequiredError();
	}

	private requestExceptionCount = 0;
	private requestsAreBlocked = false;

	resetRequestExceptionCount(): void {
		this.requestExceptionCount = 0;
		this.requestsAreBlocked = false;
	}

	trackRequestException(): void {
		this.requestExceptionCount++;

		if (this.requestExceptionCount >= 5 && !this.requestsAreBlocked) {
			void showGkDisconnectedTooManyFailedRequestsWarningMessage();
			this.requestsAreBlocked = true;
			this.requestExceptionCount = 0;
		}
	}
}

export interface GraphQLRequest {
	query: string;
	operationName?: string;
	variables?: Record<string, unknown>;
}

export function getUrl(base: Uri, ...pathSegments: string[]): string {
	return Uri.joinPath(base, ...pathSegments).toString();
}

import type { CancellationToken, Disposable } from 'vscode';
import { version as codeVersion, env, Uri } from 'vscode';
import type { HeadersInit, RequestInfo, RequestInit, Response } from '@env/fetch';
import { fetch as _fetch, getProxyAgent } from '@env/fetch';
import { getPlatform } from '@env/platform';
import type { Container } from '../../container';
import { AuthenticationRequiredError, CancellationError } from '../../errors';
import { memoize } from '../../system/decorators/memoize';
import { Logger } from '../../system/logger';
import { getLogScope } from '../../system/logger.scope';

interface FetchOptions {
	cancellation?: CancellationToken;
	timeout?: number;
}

interface GKFetchOptions extends FetchOptions {
	token?: string;
	unAuthenticated?: boolean;
	query?: string;
	organizationId?: string | false;
}

export class ServerConnection implements Disposable {
	constructor(private readonly container: Container) {}

	dispose() {}

	@memoize()
	private get baseApiUri(): Uri {
		if (this.container.env === 'staging') {
			return Uri.parse('https://stagingapi.gitkraken.com');
		}

		if (this.container.env === 'dev') {
			return Uri.parse('https://devapi.gitkraken.com');
		}

		return Uri.parse('https://api.gitkraken.com');
	}

	getApiUrl(...pathSegments: string[]) {
		return Uri.joinPath(this.baseApiUri, ...pathSegments).toString();
	}

	@memoize()
	private get baseGkDevApiUri(): Uri {
		if (this.container.env === 'staging') {
			return Uri.parse('https://staging-api.gitkraken.dev');
		}

		if (this.container.env === 'dev') {
			return Uri.parse('https://dev-api.gitkraken.dev');
		}

		return Uri.parse('https://api.gitkraken.dev');
	}

	getGkDevApiUrl(...pathSegments: string[]) {
		return Uri.joinPath(this.baseGkDevApiUri, ...pathSegments).toString();
	}

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

	async fetch(url: RequestInfo, init?: RequestInit, options?: FetchOptions): Promise<Response> {
		const scope = getLogScope();

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
			Logger.error(ex, scope);
			if (ex.name === 'AbortError') throw new CancellationError(ex);

			throw ex;
		}
	}

	async fetchApi(path: string, init?: RequestInit, options?: GKFetchOptions): Promise<Response> {
		return this.gkFetch(this.getApiUrl(path), init, options);
	}

	async fetchApiGraphQL(path: string, request: GraphQLRequest, init?: RequestInit, options?: GKFetchOptions) {
		return this.fetchApi(
			path,
			{
				method: 'POST',
				...init,
				body: JSON.stringify(request),
			},
			options,
		);
	}

	async fetchGkDevApi(path: string, init?: RequestInit, options?: GKFetchOptions): Promise<Response> {
		return this.gkFetch(this.getGkDevApiUrl(path), init, options);
	}

	private async gkFetch(url: RequestInfo, init?: RequestInit, options?: GKFetchOptions): Promise<Response> {
		const scope = getLogScope();

		try {
			let token;
			({ token, ...options } = options ?? {});
			if (!options?.unAuthenticated) {
				token ??= await this.getAccessToken();
			}

			const headers: Record<string, unknown> = {
				Authorization: `Bearer ${token}`,
				'Content-Type': 'application/json',
				'Client-Name': this.clientName,
				'Client-Version': this.container.version,
				...init?.headers,
			};

			// only check for cached subscription or we'll get into an infinite loop
			let organizationId = options?.organizationId;
			if (organizationId === undefined) {
				organizationId = (await this.container.subscription.getSubscription(true)).activeOrganization?.id;
			}

			if (organizationId) {
				headers['gk-org-id'] = organizationId;
			}

			if (options?.query != null) {
				if (url instanceof URL) {
					url.search = options.query;
				} else if (typeof url === 'string') {
					url = `${url}?${options.query}`;
				}
			}
			// TODO@eamodio handle common response errors

			return this.fetch(
				url,
				{
					...init,
					headers: headers as HeadersInit,
				},
				options,
			);
		} catch (ex) {
			Logger.error(ex, scope);
			throw ex;
		}
	}

	private async getAccessToken() {
		const session = await this.container.subscription.getAuthenticationSession();
		if (session != null) return session.accessToken;

		throw new AuthenticationRequiredError();
	}
}

export interface GraphQLRequest {
	query: string;
	operationName?: string;
	variables?: Record<string, unknown>;
}

export function getUrl(base: Uri, ...pathSegments: string[]) {
	return Uri.joinPath(base, ...pathSegments).toString();
}

import type { Disposable } from 'vscode';
import { Uri } from 'vscode';
import type { RequestInfo, RequestInit, Response } from '@env/fetch';
import { fetch as _fetch, getProxyAgent } from '@env/fetch';
import type { Container } from '../../container';
import { memoize } from '../../system/decorators/memoize';
import { Logger } from '../../system/logger';
import { getLogScope } from '../../system/logger.scope';

export class ServerConnection implements Disposable {
	constructor(private readonly container: Container) {}

	dispose() {}

	@memoize()
	private get accountsUri(): Uri {
		if (this.container.env === 'staging') {
			return Uri.parse('https://stagingapp.gitkraken.com');
		}

		if (this.container.env === 'dev') {
			return Uri.parse('https://devapp.gitkraken.com');
		}

		return Uri.parse('https://app.gitkraken.com');
	}

	getAccountsUri(path?: string, query?: string) {
		let uri = path != null ? Uri.joinPath(this.accountsUri, path) : this.accountsUri;
		if (query != null) {
			uri = uri.with({ query: query });
		}
		return uri;
	}

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
	get siteUri(): Uri {
		const { env } = this.container;
		if (env === 'staging') {
			return Uri.parse('https://staging.gitkraken.com');
		}

		if (env === 'dev') {
			return Uri.parse('https://dev.gitkraken.com');
		}

		return Uri.parse('https://gitkraken.com');
	}

	getSiteUri(path?: string, query?: string) {
		let uri = path != null ? Uri.joinPath(this.siteUri, path) : this.siteUri;
		if (query != null) {
			uri = uri.with({ query: query });
		}
		return uri;
	}

	@memoize()
	get userAgent(): string {
		// TODO@eamodio figure out standardized format/structure for our user agents
		return 'Visual-Studio-Code-GitLens';
	}

	async fetch(url: RequestInfo, init?: RequestInit, token?: string): Promise<Response> {
		const scope = getLogScope();

		try {
			token ??= await this.getAccessToken();
			const options = {
				agent: getProxyAgent(),
				...init,
				headers: {
					Authorization: `Bearer ${token}`,
					'User-Agent': this.userAgent,
					'Content-Type': 'application/json',
					...init?.headers,
				},
			};

			// TODO@eamodio handle common response errors

			return await _fetch(url, options);
		} catch (ex) {
			Logger.error(ex, scope);
			throw ex;
		}
	}

	async fetchApi(path: string, init?: RequestInit, token?: string): Promise<Response> {
		return this.fetch(this.getApiUrl(path), init, token);
	}

	async fetchApiGraphQL(path: string, request: GraphQLRequest, init?: RequestInit) {
		return this.fetchApi(path, {
			method: 'POST',
			...init,
			body: JSON.stringify(request),
		});
	}

	async fetchGkDevApi(path: string, init?: RequestInit, token?: string): Promise<Response> {
		return this.fetch(this.getGkDevApiUrl(path), init, token);
	}

	async fetchRaw(url: RequestInfo, init?: RequestInit): Promise<Response> {
		const scope = getLogScope();

		try {
			const options = {
				agent: getProxyAgent(),
				...init,
				headers: {
					'User-Agent': this.userAgent,
					...init?.headers,
				},
			};
			return await _fetch(url, options);
		} catch (ex) {
			Logger.error(ex, scope);
			throw ex;
		}
	}

	private async getAccessToken() {
		const session = await this.container.subscription.getAuthenticationSession();
		if (session != null) return session.accessToken;

		throw new Error('Authentication required');
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

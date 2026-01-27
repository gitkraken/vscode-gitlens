import { Uri } from 'vscode';
import type { Environment } from '../../container.js';
import { getHostAppName } from '../../system/-webview/vscode.js';
import { memoize } from '../../system/decorators/memoize.js';

export class UrlsProvider {
	constructor(private readonly env: Environment) {}

	@memoize()
	private get baseGkApiUri(): Uri {
		if (this.env === 'staging') {
			return Uri.parse('https://staging-api.gitkraken.dev');
		}

		if (this.env === 'dev') {
			return Uri.parse('https://dev-api.gitkraken.dev');
		}

		return Uri.parse('https://api.gitkraken.dev');
	}

	@memoize()
	private get baseGkDevUri(): Uri {
		if (this.env === 'staging') {
			return Uri.parse('https://staging.gitkraken.dev');
		}

		if (this.env === 'dev') {
			return Uri.parse('https://dev.gitkraken.dev');
		}

		return Uri.parse('https://gitkraken.dev');
	}

	getGkAIApiUrl(...pathSegments: string[]): string {
		return Uri.joinPath(this.baseGkApiUri, 'v1', 'ai-tasks', ...pathSegments).toString();
	}

	getGkApiUrl(...pathSegments: string[]): string {
		return Uri.joinPath(this.baseGkApiUri, ...pathSegments).toString();
	}

	getGkConfigUrl(...pathSegments: string[]): string {
		if (this.env === 'dev' || this.env === 'staging') {
			pathSegments = ['staging', ...pathSegments];
		}
		return Uri.joinPath(Uri.parse('https://configs.gitkraken.dev'), 'gitlens', ...pathSegments).toString();
	}

	async getGkDevUrl(pathSegments?: string | string[], query?: string | URLSearchParams): Promise<string> {
		const ide = (await getHostAppName()) ?? 'unknown';
		query = this.provideQueryWithIdeArg(query, ide);
		query = this.provideQueryWithSourceArg(query);
		const uri = this.buildGkDevUri(pathSegments, query);
		return uri.toString(true);
	}

	getGkDevUrlWithoutIdeArg(pathSegments?: string | string[], query?: string | URLSearchParams): string {
		query = this.provideQueryWithSourceArg(query);
		const uri = this.buildGkDevUri(pathSegments, query);
		return uri.toString(true);
	}

	private buildGkDevUri(pathSegments: undefined | string | string[], query: string | URLSearchParams): Uri {
		pathSegments ??= [];
		if (typeof pathSegments === 'string') {
			pathSegments = [pathSegments];
		}
		const uri = pathSegments.length ? Uri.joinPath(this.baseGkDevUri, ...pathSegments) : this.baseGkDevUri;
		return uri.with({ query: query.toString() });
	}

	private provideQueryWithIdeArg(query: undefined | string | URLSearchParams, ide: string): string | URLSearchParams {
		if (query == null) {
			return `ide=${encodeURIComponent(ide)}`;
		}
		if (typeof query === 'string') {
			query = new URLSearchParams(query);
		}
		if (!query.has('ide')) {
			query.set('ide', ide);
		}
		return query;
	}

	private provideQueryWithSourceArg(query?: string | URLSearchParams): string | URLSearchParams {
		if (query == null) {
			return 'source=gitlens';
		}
		if (typeof query === 'string') {
			query = new URLSearchParams(query);
		}
		if (!query.has('source')) {
			query.set('source', 'gitlens');
		}
		return query;
	}
}

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
		pathSegments ??= [];
		if (typeof pathSegments === 'string') {
			pathSegments = [pathSegments];
		}

		let uri = pathSegments.length ? Uri.joinPath(this.baseGkDevUri, ...pathSegments) : this.baseGkDevUri;

		const ide = (await getHostAppName()) ?? 'unknown';
		query ??= `source=gitlens&ide=${encodeURIComponent(ide)}`;
		if (typeof query === 'string') {
			query = new URLSearchParams(query);
		}
		if (!query.has('source')) {
			query.set('source', 'gitlens');
		}
		if (!query.has('ide')) {
			query.set('ide', ide);
		}
		uri = uri.with({ query: query.toString() });

		return uri.toString(true);
	}
}

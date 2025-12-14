import { Uri } from 'vscode';
import type { Environment } from '../../container';
import { memoize } from '../../system/decorators/memoize';

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

	getGkDevUrl(pathSegments?: string | string[], query?: string | URLSearchParams): string {
		pathSegments ??= [];
		if (typeof pathSegments === 'string') {
			pathSegments = [pathSegments];
		}

		let uri = pathSegments.length ? Uri.joinPath(this.baseGkDevUri, ...pathSegments) : this.baseGkDevUri;

		query ??= 'source=gitlens';
		if (typeof query === 'string') {
			if (!query.includes('source=gitlens')) {
				query = `source=gitlens&${query}`;
			}
			uri = uri.with({ query: query });
		} else {
			if (!query.has('source')) {
				query.set('source', 'gitlens');
			}
			uri = uri.with({ query: query.toString() });
		}

		return uri.toString(true);
	}
}

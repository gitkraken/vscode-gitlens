/* eslint-disable @typescript-eslint/no-restricted-imports */ /* TODO need to deal with sharing rich class shapes to webviews */
import type { Container } from '../../container';
import type { HostingIntegration } from '../../plus/integrations/integration';
import { memoize } from '../../system/decorators/-webview/memoize';
import { equalsIgnoreCase } from '../../system/string';
import { parseGitRemoteUrl } from '../parsers/remoteParser';
import type { RemoteProvider } from '../remotes/remoteProvider';

export function isRemote(remote: unknown): remote is GitRemote {
	return remote instanceof GitRemote;
}

export class GitRemote<TProvider extends RemoteProvider | undefined = RemoteProvider | undefined> {
	constructor(
		private readonly container: Container,
		public readonly repoPath: string,
		public readonly name: string,
		public readonly scheme: string,
		private readonly _domain: string,
		private readonly _path: string,
		public readonly provider: TProvider,
		public readonly urls: { type: GitRemoteType; url: string }[],
	) {}

	get default() {
		const defaultRemote = this.container.storage.getWorkspace('remote:default');
		// Check for `this.remoteKey` matches to handle previously saved data
		return this.name === defaultRemote || this.remoteKey === defaultRemote;
	}

	@memoize()
	get domain() {
		return this.provider?.domain ?? this._domain;
	}

	@memoize()
	get id() {
		return `${this.name}/${this.remoteKey}`;
	}

	get maybeIntegrationConnected(): boolean | undefined {
		return this.container.integrations.isMaybeConnected(this);
	}

	@memoize()
	get path() {
		return this.provider?.path ?? this._path;
	}

	@memoize()
	get remoteKey() {
		return this._domain ? `${this._domain}/${this._path}` : this.path;
	}

	@memoize()
	get url(): string {
		let bestUrl: string | undefined;
		for (const remoteUrl of this.urls) {
			if (remoteUrl.type === 'push') {
				return remoteUrl.url;
			}

			if (bestUrl == null) {
				bestUrl = remoteUrl.url;
			}
		}

		return bestUrl!;
	}

	async getIntegration(): Promise<HostingIntegration | undefined> {
		return this.provider != null ? this.container.integrations.getByRemote(this) : undefined;
	}

	hasIntegration(): this is GitRemote<RemoteProvider> {
		return this.provider != null && this.container.integrations.supports(this.provider.id);
	}

	matches(url: string): boolean;
	matches(domain: string, path: string): boolean;
	matches(urlOrDomain: string, path?: string): boolean {
		if (path == null) {
			if (equalsIgnoreCase(urlOrDomain, this.url)) return true;
			[, urlOrDomain, path] = parseGitRemoteUrl(urlOrDomain);
		}

		return equalsIgnoreCase(urlOrDomain, this.domain) && equalsIgnoreCase(path, this.path);
	}

	async setAsDefault(value: boolean = true) {
		await this.container.git.remotes(this.repoPath).setRemoteAsDefault(this.name, value);
	}
}

export type GitRemoteType = 'fetch' | 'push';

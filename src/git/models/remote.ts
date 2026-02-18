/* eslint-disable @typescript-eslint/no-restricted-imports -- TODO need to deal with sharing rich class shapes to webviews */
import { GitCloudHostIntegrationId } from '../../constants.integrations.js';
import type { Container } from '../../container.js';
import type { GitHostIntegration } from '../../plus/integrations/models/gitHostIntegration.js';
import {
	getIntegrationConnectedKey,
	getIntegrationIdForRemote,
} from '../../plus/integrations/utils/-webview/integration.utils.js';
import { loggable } from '../../system/decorators/log.js';
import { memoize } from '../../system/decorators/memoize.js';
import { equalsIgnoreCase } from '../../system/string.js';
import { parseGitRemoteUrl } from '../parsers/remoteParser.js';
import type { RemoteProvider } from '../remotes/remoteProvider.js';

export function isRemote(remote: unknown): remote is GitRemote {
	return remote instanceof GitRemote;
}

@loggable(i => i.id)
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

	get default(): boolean {
		const defaultRemote = this.container.storage.getWorkspace('remote:default');
		// Check for `this.remoteKey` matches to handle previously saved data
		return this.name === defaultRemote || this.remoteKey === defaultRemote;
	}

	@memoize()
	get domain(): string {
		return this.provider?.domain ?? this._domain;
	}

	@memoize()
	get id(): string {
		return `${this.name}/${this.remoteKey}`;
	}

	get maybeIntegrationConnected(): boolean | undefined {
		if (!this.provider?.id) return false;

		const integrationId = getIntegrationIdForRemote(this.provider);
		if (integrationId == null) return false;

		// Special case for GitHub, since we support the legacy GitHub integration
		if (integrationId === GitCloudHostIntegrationId.GitHub) {
			const configured = this.container.integrations.getConfiguredLite(integrationId, { cloud: true });
			if (configured.length) {
				return this.container.storage.getWorkspace(getIntegrationConnectedKey(integrationId)) !== false;
			}

			return undefined;
		}

		const configured = this.container.integrations.getConfiguredLite(
			integrationId,
			this.provider.custom ? { domain: this.provider.domain } : undefined,
		);

		if (configured.length) {
			return (
				this.container.storage.getWorkspace(getIntegrationConnectedKey(integrationId, this.provider.domain)) !==
				false
			);
		}
		return false;
	}

	@memoize()
	get path(): string {
		return this.provider?.path ?? this._path;
	}

	@memoize()
	get remoteKey(): string {
		return this._domain ? `${this._domain}/${this._path}` : this.path;
	}

	@memoize()
	get url(): string {
		let bestUrl: string | undefined;
		for (const remoteUrl of this.urls) {
			if (remoteUrl.type === 'push') {
				return remoteUrl.url;
			}

			bestUrl ??= remoteUrl.url;
		}

		return bestUrl!;
	}

	async getIntegration(): Promise<GitHostIntegration | undefined> {
		const integrationId = getIntegrationIdForRemote(this.provider);
		return integrationId && this.container.integrations.get(integrationId, this.provider?.domain);
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

	async setAsDefault(value: boolean = true): Promise<void> {
		await this.container.git.getRepositoryService(this.repoPath).remotes.setRemoteAsDefault(this.name, value);
	}

	supportsIntegration(): this is GitRemote<RemoteProvider> {
		return Boolean(getIntegrationIdForRemote(this.provider));
	}

	/** Creates a copy of this remote with a different repoPath — ONLY used for worktree-aware caching */
	withRepoPath(repoPath: string): GitRemote<TProvider> {
		return repoPath === this.repoPath
			? this
			: new GitRemote<TProvider>(
					this.container,
					repoPath,
					this.name,
					this.scheme,
					this._domain,
					this._path,
					this.provider,
					this.urls,
				);
	}
}

export type GitRemoteType = 'fetch' | 'push';

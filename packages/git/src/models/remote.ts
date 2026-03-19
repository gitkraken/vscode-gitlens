import { loggable } from '@gitlens/utils/decorators/log.js';
import { memoize } from '@gitlens/utils/decorators/memoize.js';
import { serializable } from '@gitlens/utils/decorators/serializable.js';
import { equalsIgnoreCase } from '@gitlens/utils/string.js';
import type { Shape } from '@gitlens/utils/types.js';
import { parseGitRemoteUrl } from '../utils/remote.utils.js';
import type { RemoteProvider } from './remoteProvider.js';

export type GitRemoteShape = Shape<GitRemote>;
export type GitRemoteType = 'fetch' | 'push';

@loggable(i => i.id)
@serializable
export class GitRemote<TProvider extends RemoteProvider | undefined = RemoteProvider | undefined> {
	constructor(
		public readonly repoPath: string,
		public readonly name: string,
		public readonly scheme: string,
		private readonly _domain: string,
		private readonly _path: string,
		public readonly urls: { type: GitRemoteType; url: string }[],
		/** Remote provider instance for URL generation and identity */
		public readonly provider: TProvider = undefined as TProvider,
		isDefault: boolean = false,
	) {
		this._default = isDefault;
	}

	private readonly _default: boolean;
	/** Whether this remote is the user-designated default for the repository */
	get default(): boolean {
		return this._default;
	}

	@memoize()
	get domain(): string {
		return this.provider?.domain ?? this._domain;
	}

	@memoize()
	get id(): string {
		return `${this.name}/${this.remoteKey}`;
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

		return bestUrl ?? '';
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

	/** Creates a copy of this remote with a different repoPath — ONLY used for worktree-aware caching */
	withRepoPath(repoPath: string): GitRemote<TProvider> {
		if (repoPath === this.repoPath) return this;

		return new GitRemote<TProvider>(
			repoPath,
			this.name,
			this.scheme,
			this._domain,
			this._path,
			this.urls,
			this.provider,
			this.default,
		);
	}

	static is(remote: unknown): remote is GitRemote {
		return remote instanceof GitRemote;
	}
}

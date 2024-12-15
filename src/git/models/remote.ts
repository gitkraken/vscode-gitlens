import { GlyphChars } from '../../constants';
import type { Container } from '../../container';
import type { HostingIntegration } from '../../plus/integrations/integration';
import { memoize } from '../../system/decorators/memoize';
import { equalsIgnoreCase, sortCompare } from '../../system/string';
import { parseGitRemoteUrl } from '../parsers/remoteParser';
import type { RemoteProvider } from '../remotes/remoteProvider';

export type GitRemoteType = 'fetch' | 'push';

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
		const repository = this.container.git.getRepository(this.repoPath);
		await repository?.setRemoteAsDefault(this, value);
	}
}

export function getDefaultRemoteOrHighlander<T extends GitRemote>(remotes: T[]): T | undefined {
	return remotes.length === 1 ? remotes[0] : remotes.find(r => r.default);
}

export function getHighlanderProviders(remotes: GitRemote<RemoteProvider>[]) {
	if (remotes.length === 0) return undefined;

	const remote = getDefaultRemoteOrHighlander(remotes);
	if (remote != null) return [remote.provider];

	const providerName = remotes[0].provider.name;
	if (remotes.every(r => r.provider.name === providerName)) return remotes.map(r => r.provider);

	return undefined;
}

export function getHighlanderProviderName(remotes: GitRemote<RemoteProvider>[]) {
	if (remotes.length === 0) return undefined;

	const remote = getDefaultRemoteOrHighlander(remotes);
	if (remote != null) return remote.provider.name;

	const providerName = remotes[0].provider.name;
	// Only use the real provider name if there is only 1 type of provider
	if (remotes.every(r => r.provider.name === providerName)) return providerName;

	return undefined;
}

export function getRemoteArrowsGlyph(remote: GitRemote): GlyphChars {
	let arrows;
	let left;
	let right;
	for (const { type } of remote.urls) {
		if (type === 'fetch') {
			left = true;

			if (right) break;
		} else if (type === 'push') {
			right = true;

			if (left) break;
		}
	}

	if (left && right) {
		arrows = GlyphChars.ArrowsRightLeft;
	} else if (right) {
		arrows = GlyphChars.ArrowRight;
	} else if (left) {
		arrows = GlyphChars.ArrowLeft;
	} else {
		arrows = GlyphChars.Dash;
	}

	return arrows;
}

export function getRemoteThemeIconString(remote: GitRemote | undefined): string {
	return getRemoteProviderThemeIconString(remote?.provider);
}

export function getRemoteProviderThemeIconString(provider: RemoteProvider | undefined): string {
	return provider != null ? `gitlens-provider-${provider.icon}` : 'cloud';
}

export function getRemoteUpstreamDescription(remote: GitRemote): string {
	const arrows = getRemoteArrowsGlyph(remote);

	const { provider } = remote;
	if (provider != null) {
		return `${arrows}${GlyphChars.Space} ${provider.name} ${GlyphChars.Space}${GlyphChars.Dot}${GlyphChars.Space} ${provider.displayPath}`;
	}

	return `${arrows}${GlyphChars.Space} ${
		remote.domain ? `${remote.domain} ${GlyphChars.Space}${GlyphChars.Dot}${GlyphChars.Space} ` : ''
	}${remote.path}`;
}

export function getVisibilityCacheKey(remote: GitRemote): string;
export function getVisibilityCacheKey(remotes: GitRemote[]): string;
export function getVisibilityCacheKey(remotes: GitRemote | GitRemote[]): string {
	if (!Array.isArray(remotes)) return remotes.remoteKey;
	return remotes
		.map(r => r.remoteKey)
		.sort()
		.join(',');
}

export function isRemote(remote: any): remote is GitRemote {
	return remote instanceof GitRemote;
}

export function sortRemotes<T extends GitRemote>(remotes: T[]) {
	return remotes.sort(
		(a, b) =>
			(a.default ? -1 : 1) - (b.default ? -1 : 1) ||
			(a.name === 'origin' ? -1 : 1) - (b.name === 'origin' ? -1 : 1) ||
			(a.name === 'upstream' ? -1 : 1) - (b.name === 'upstream' ? -1 : 1) ||
			sortCompare(a.name, b.name),
	);
}

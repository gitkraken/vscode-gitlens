import { GlyphChars } from '../../constants';
import type { GitRemote } from '../models/remote';
import type { RemoteProvider } from '../remotes/remoteProvider';

export function getDefaultRemoteOrHighlander<T extends GitRemote>(remotes: T[]): T | undefined {
	return remotes.length === 1 ? remotes[0] : remotes.find(r => r.default);
}

export function getHighlanderProviderName(remotes: GitRemote<RemoteProvider>[]): string | undefined {
	if (remotes.length === 0) return undefined;

	const remote = getDefaultRemoteOrHighlander(remotes);
	if (remote != null) return remote.provider.name;

	const providerName = remotes[0].provider.name;
	// Only use the real provider name if there is only 1 type of provider
	if (remotes.every(r => r.provider.name === providerName)) return providerName;

	return undefined;
}

export function getHighlanderProviders(remotes: GitRemote<RemoteProvider>[]): RemoteProvider[] | undefined {
	if (remotes.length === 0) return undefined;

	const remote = getDefaultRemoteOrHighlander(remotes);
	if (remote != null) return [remote.provider];

	const providerName = remotes[0].provider.name;
	if (remotes.every(r => r.provider.name === providerName)) return remotes.map(r => r.provider);

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

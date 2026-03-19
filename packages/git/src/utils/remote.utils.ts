import type { GitRemote } from '../models/remote.js';
import type { RemoteProvider } from '../models/remoteProvider.js';
import type { RemoteResource } from '../models/remoteResource.js';
import { RemoteResourceType } from '../models/remoteResource.js';

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

export function getRemoteArrowsGlyph(remote: GitRemote): string {
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
		arrows = '\u21c4'; // ArrowsRightLeft
	} else if (right) {
		arrows = '\u2192'; // ArrowRight
	} else if (left) {
		arrows = '\u2190'; // ArrowLeft
	} else {
		arrows = '\u2014'; // Dash
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
		return `${arrows}\u00a0 ${provider.name} \u00a0\u2022\u00a0 ${provider.displayPath}`;
	}

	return `${arrows}\u00a0 ${remote.domain ? `${remote.domain} \u00a0\u2022\u00a0 ` : ''}${remote.path}`;
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

export const gitSuffixRegex = /\.git\/?$/;

// Test git urls
/*
http://host.xz/user/project.git
https://host.xz/user/project.git
git@host.xz:user/project.git
git://host.xz/path/to/repo.git/
ssh://host.xz/project.git
ssh://user@host.xz/path/to/repo.git
user@host.xz:path/to/repo.git
*/
export const remoteUrlRegex =
	/^(?:(git:\/\/)(.*?)\/|(https?:\/\/)(?:.*?@)?(.*?)\/|git@(.*):|(ssh:\/\/)(?:.*@)?(.*?)(?::.*?)?(?:\/|(?=~))|(?:.*?@)(.*?):)(.*)$/;

export function parseGitRemoteUrl(url: string): [scheme: string, domain: string, path: string] {
	const match = remoteUrlRegex.exec(url);
	if (match == null) return ['', '', url];

	return [
		match[1] || match[3] || match[6],
		match[2] || match[4] || match[5] || match[7] || match[8],
		match[9].replace(gitSuffixRegex, ''),
	];
}

export function getNameFromRemoteResource(resource: RemoteResource): string {
	switch (resource.type) {
		case RemoteResourceType.Branch:
			return 'Branch';
		case RemoteResourceType.Branches:
			return 'Branches';
		case RemoteResourceType.Commit:
			return 'Commit';
		case RemoteResourceType.Comparison:
			return 'Comparison';
		case RemoteResourceType.CreatePullRequest:
			return 'Create Pull Request';
		case RemoteResourceType.File:
			return 'File';
		case RemoteResourceType.Repo:
			return 'Repository';
		case RemoteResourceType.Revision:
			return 'File';
		default:
			return '';
	}
}

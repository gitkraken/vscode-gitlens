import type { ColorTheme } from 'vscode';
import { Uri, window } from 'vscode';
import { GlyphChars } from '../../constants';
import { Container } from '../../container';
import { memoize } from '../../system/decorators/memoize';
import { equalsIgnoreCase, sortCompare } from '../../system/string';
import { isLightTheme } from '../../system/utils';
import { parseGitRemoteUrl } from '../parsers/remoteParser';
import type { RemoteProvider } from '../remotes/remoteProvider';
import type { RichRemoteProvider } from '../remotes/richRemoteProvider';

export const enum GitRemoteType {
	Fetch = 'fetch',
	Push = 'push',
}

export class GitRemote<TProvider extends RemoteProvider | undefined = RemoteProvider | RichRemoteProvider | undefined> {
	static getHighlanderProviders(remotes: GitRemote<RemoteProvider | RichRemoteProvider>[]) {
		if (remotes.length === 0) return undefined;

		const remote = remotes.length === 1 ? remotes[0] : remotes.find(r => r.default);
		if (remote != null) return [remote.provider];

		const providerName = remotes[0].provider.name;
		if (remotes.every(r => r.provider.name === providerName)) return remotes.map(r => r.provider);

		return undefined;
	}

	static getHighlanderProviderName(remotes: GitRemote<RemoteProvider | RichRemoteProvider>[]) {
		if (remotes.length === 0) return undefined;

		const remote = remotes.length === 1 ? remotes[0] : remotes.find(r => r.default);
		if (remote != null) return remote.provider.name;

		const providerName = remotes[0].provider.name;
		// Only use the real provider name if there is only 1 type of provider
		if (remotes.every(r => r.provider.name === providerName)) return providerName;

		return undefined;
	}

	static is(remote: any): remote is GitRemote {
		return remote instanceof GitRemote;
	}

	static sort(remotes: GitRemote[]) {
		return remotes.sort(
			(a, b) =>
				(a.default ? -1 : 1) - (b.default ? -1 : 1) ||
				(a.name === 'origin' ? -1 : 1) - (b.name === 'origin' ? -1 : 1) ||
				(a.name === 'upstream' ? -1 : 1) - (b.name === 'upstream' ? -1 : 1) ||
				sortCompare(a.name, b.name),
		);
	}

	constructor(
		public readonly repoPath: string,
		public readonly id: string,
		public readonly name: string,
		public readonly scheme: string,
		public readonly domain: string,
		public readonly path: string,
		public readonly provider: TProvider,
		public readonly urls: { type: GitRemoteType; url: string }[],
	) {}

	get default() {
		const defaultRemote = Container.instance.storage.getWorkspace('remote:default');
		return this.id === defaultRemote;
	}

	@memoize()
	get url(): string {
		let bestUrl: string | undefined;
		for (const remoteUrl of this.urls) {
			if (remoteUrl.type === GitRemoteType.Push) {
				return remoteUrl.url;
			}

			if (bestUrl == null) {
				bestUrl = remoteUrl.url;
			}
		}

		return bestUrl!;
	}

	hasRichProvider(): this is GitRemote<RichRemoteProvider> {
		return this.provider?.hasRichIntegration() ?? false;
	}

	matches(url: string): boolean;
	// eslint-disable-next-line @typescript-eslint/unified-signatures
	matches(domain: string, path: string): boolean;
	matches(urlOrDomain: string, path?: string): boolean {
		if (path == null) {
			if (equalsIgnoreCase(urlOrDomain, this.url)) return true;
			[, urlOrDomain, path] = parseGitRemoteUrl(urlOrDomain);
		}

		return equalsIgnoreCase(urlOrDomain, this.domain) && equalsIgnoreCase(path, this.path);
	}

	async setAsDefault(value: boolean = true) {
		const repository = Container.instance.git.getRepository(this.repoPath);
		await repository?.setRemoteAsDefault(this, value);
	}
}

export function getRemoteArrowsGlyph(remote: GitRemote): GlyphChars {
	let arrows;
	let left;
	let right;
	for (const { type } of remote.urls) {
		if (type === GitRemoteType.Fetch) {
			left = true;

			if (right) break;
		} else if (type === GitRemoteType.Push) {
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

export function getRemoteIconUri(
	container: Container,
	remote: GitRemote,
	asWebviewUri?: (uri: Uri) => Uri,
	theme: ColorTheme = window.activeColorTheme,
): Uri | undefined {
	if (remote.provider?.icon == null) return undefined;

	const uri = Uri.joinPath(
		container.context.extensionUri,
		`images/${isLightTheme(theme) ? 'light' : 'dark'}/icon-${remote.provider.icon}.svg`,
	);
	return asWebviewUri != null ? asWebviewUri(uri) : uri;
}

export function getVisibilityCacheKey(remote: GitRemote): string;
export function getVisibilityCacheKey(remotes: GitRemote[]): string;
export function getVisibilityCacheKey(remotes: GitRemote | GitRemote[]): string {
	if (!Array.isArray(remotes)) return remotes.id;
	return remotes
		.map(r => r.id)
		.sort()
		.join(',');
}

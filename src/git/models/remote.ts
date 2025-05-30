import type { ColorTheme } from 'vscode';
import { Uri, window } from 'vscode';
import { Container } from '../../container';
import { sortCompare } from '../../system/string';
import { isLightTheme } from '../../system/utils';
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

	async setAsDefault(value: boolean = true) {
		const repository = Container.instance.git.getRepository(this.repoPath);
		await repository?.setRemoteAsDefault(this, value);
	}
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

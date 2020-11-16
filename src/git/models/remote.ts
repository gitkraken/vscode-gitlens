'use strict';
import { WorkspaceState } from '../../constants';
import { Container } from '../../container';
import { RemoteProvider, RemoteProviderWithApi } from '../remotes/factory';

export enum GitRemoteType {
	Fetch = 'fetch',
	Push = 'push',
}

export class GitRemote<
	TProvider extends RemoteProvider | undefined = RemoteProvider | RemoteProviderWithApi | undefined
> {
	static getHighlanderProviders(remotes: GitRemote<RemoteProvider>[]) {
		if (remotes.length === 0) return undefined;

		const remote = remotes.length === 1 ? remotes[0] : remotes.find(r => r.default);
		if (remote != null) return [remote.provider];

		const providerName = remotes[0].provider.name;
		if (remotes.every(r => r.provider.name === providerName)) return remotes.map(r => r.provider);

		return undefined;
	}

	static getHighlanderProviderName(remotes: GitRemote<RemoteProvider>[]) {
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
				a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
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
		public readonly types: { type: GitRemoteType; url: string }[],
	) {}

	get default() {
		const defaultRemote = Container.context.workspaceState.get<string>(WorkspaceState.DefaultRemote);
		return this.id === defaultRemote;
	}

	async setAsDefault(state: boolean = true, updateViews: boolean = true) {
		void (await Container.context.workspaceState.update(WorkspaceState.DefaultRemote, state ? this.id : undefined));

		// TODO@eamodio this is UGLY
		if (updateViews) {
			void (await Container.remotesView.refresh());
			void (await Container.repositoriesView.refresh());
		}
	}
}

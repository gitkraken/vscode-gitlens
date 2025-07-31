import type { Container } from '../container';
import type { GitCommit } from '../git/models/commit';
import type { GitRemote } from '../git/models/remote';
import { isRemote } from '../git/models/remote';
import type { Repository } from '../git/models/repository';
import type { RemoteProvider } from '../git/remotes/remoteProvider';
import { showRepositoryPicker } from '../quickpicks/repositoryPicker';
import { command } from '../system/-webview/command';
import { createMarkdownCommandLink } from '../system/commands';
import { first } from '../system/iterable';
import { GlCommandBase } from './commandBase';
import type { CommandContext } from './commandContext';
import { isCommandContextViewNodeHasRemote } from './commandContext.utils';

export interface ConnectRemoteProviderCommandArgs {
	remote?: string;
	repoPath: string;
}

@command()
export class ConnectRemoteProviderCommand extends GlCommandBase {
	static createMarkdownCommandLink(args: ConnectRemoteProviderCommandArgs): string;
	static createMarkdownCommandLink(remote: GitRemote): string;
	static createMarkdownCommandLink(argsOrRemote: ConnectRemoteProviderCommandArgs | GitRemote): string {
		let args: ConnectRemoteProviderCommandArgs | GitCommit;
		if (isRemote(argsOrRemote)) {
			args = {
				remote: argsOrRemote.name,
				repoPath: argsOrRemote.repoPath,
			};
		} else {
			args = argsOrRemote;
		}

		return createMarkdownCommandLink<ConnectRemoteProviderCommandArgs>('gitlens.connectRemoteProvider', args);
	}

	constructor(private readonly container: Container) {
		super('gitlens.connectRemoteProvider');
	}

	protected override preExecute(context: CommandContext, args?: ConnectRemoteProviderCommandArgs): Promise<any> {
		if (isCommandContextViewNodeHasRemote(context)) {
			args = { ...args, remote: context.node.remote.name, repoPath: context.node.remote.repoPath };
		}

		return this.execute(args);
	}

	async execute(args?: ConnectRemoteProviderCommandArgs): Promise<any> {
		let remote: GitRemote<RemoteProvider> | undefined;
		let remotes: GitRemote[] | undefined;
		let repoPath;
		if (args?.repoPath == null) {
			const repos = new Map<Repository, GitRemote<RemoteProvider>>();

			for (const repo of this.container.git.openRepositories) {
				const remote = await repo.git.remotes.getBestRemoteWithIntegration({ includeDisconnected: true });
				if (remote?.provider != null) {
					repos.set(repo, remote);
				}
			}

			if (repos.size === 0) return false;
			if (repos.size === 1) {
				let repo;
				[repo, remote] = first(repos)!;
				repoPath = repo.path;
			} else {
				const pick = await showRepositoryPicker(
					undefined,
					'Choose which repository to connect to the remote provider',
					[...repos.keys()],
				);
				if (pick == null) return undefined;

				repoPath = pick.path;
				remote = repos.get(pick)!;
			}
		} else if (args?.remote == null) {
			repoPath = args.repoPath;

			remote = await this.container.git
				.getRepositoryService(repoPath)
				.remotes.getBestRemoteWithIntegration({ includeDisconnected: true });
			if (remote == null) return false;
		} else {
			repoPath = args.repoPath;

			remotes = await this.container.git.getRepositoryService(repoPath).remotes.getRemotesWithProviders();
			remote = remotes.find(r => r.name === args.remote) as GitRemote<RemoteProvider> | undefined;
			if (!remote?.supportsIntegration()) return false;
		}

		const integration = await remote.getIntegration();
		if (integration == null) return false;

		const connected = await integration.connect('remoteProvider');

		if (
			connected &&
			!(
				remotes ?? (await this.container.git.getRepositoryService(repoPath).remotes.getRemotesWithProviders())
			).some(r => r.default)
		) {
			await remote.setAsDefault(true);
		}
		return connected;
	}
}

export interface DisconnectRemoteProviderCommandArgs {
	remote: string;
	repoPath: string;
}

@command()
export class DisconnectRemoteProviderCommand extends GlCommandBase {
	static createMarkdownCommandLink(args: DisconnectRemoteProviderCommandArgs): string;
	static createMarkdownCommandLink(remote: GitRemote): string;
	static createMarkdownCommandLink(argsOrRemote: DisconnectRemoteProviderCommandArgs | GitRemote): string {
		let args: DisconnectRemoteProviderCommandArgs | GitCommit;
		if (isRemote(argsOrRemote)) {
			args = {
				remote: argsOrRemote.name,
				repoPath: argsOrRemote.repoPath,
			};
		} else {
			args = argsOrRemote;
		}

		return createMarkdownCommandLink<DisconnectRemoteProviderCommandArgs>('gitlens.disconnectRemoteProvider', args);
	}

	constructor(private readonly container: Container) {
		super('gitlens.disconnectRemoteProvider');
	}

	protected override preExecute(context: CommandContext, args?: DisconnectRemoteProviderCommandArgs): Promise<void> {
		if (isCommandContextViewNodeHasRemote(context)) {
			args = { ...args, remote: context.node.remote.name, repoPath: context.node.remote.repoPath };
		}

		return this.execute(args);
	}

	async execute(args?: DisconnectRemoteProviderCommandArgs): Promise<void> {
		let remote: GitRemote<RemoteProvider> | undefined;
		let repoPath;
		if (args?.repoPath == null) {
			const repos = new Map<Repository, GitRemote<RemoteProvider>>();

			for (const repo of this.container.git.openRepositories) {
				const remote = await repo.git.remotes.getBestRemoteWithIntegration({ includeDisconnected: false });
				if (remote != null) {
					repos.set(repo, remote);
				}
			}

			if (repos.size === 0) return;
			if (repos.size === 1) {
				let repo;
				[repo, remote] = first(repos)!;
				repoPath = repo.path;
			} else {
				const pick = await showRepositoryPicker(
					undefined,
					'Choose which repository to disconnect from the remote provider',
					[...repos.keys()],
				);
				if (pick == null) return;

				repoPath = pick.path;
				remote = repos.get(pick)!;
			}
		} else if (args?.remote == null) {
			repoPath = args.repoPath;

			remote = await this.container.git
				.getRepositoryService(repoPath)
				.remotes.getBestRemoteWithIntegration({ includeDisconnected: false });
			if (remote == null) return;
		} else {
			repoPath = args.repoPath;

			remote = (await this.container.git.getRepositoryService(repoPath).remotes.getRemotesWithProviders()).find(
				r => r.name === args.remote,
			);
			if (!remote?.supportsIntegration()) return;
		}

		const integration = await remote.getIntegration();
		return integration?.disconnect();
	}
}

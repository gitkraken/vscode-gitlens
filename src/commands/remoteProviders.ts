import { GlCommand } from '../constants.commands';
import type { Container } from '../container';
import type { GitCommit } from '../git/models/commit';
import type { GitRemote } from '../git/models/remote';
import { isRemote } from '../git/models/remote';
import type { Repository } from '../git/models/repository';
import type { RemoteProvider } from '../git/remotes/remoteProvider';
import { showRepositoryPicker } from '../quickpicks/repositoryPicker';
import { createMarkdownCommandLink } from '../system/commands';
import { first } from '../system/iterable';
import { command } from '../system/vscode/command';
import type { CommandContext } from './base';
import { GlCommandBase, isCommandContextViewNodeHasRemote } from './base';

export interface ConnectRemoteProviderCommandArgs {
	remote: string;
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

		return createMarkdownCommandLink<ConnectRemoteProviderCommandArgs>(GlCommand.ConnectRemoteProvider, args);
	}

	constructor(private readonly container: Container) {
		super(GlCommand.ConnectRemoteProvider);
	}

	protected override preExecute(context: CommandContext, args?: ConnectRemoteProviderCommandArgs) {
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
				const remote = await repo.git.getBestRemoteWithIntegration({ includeDisconnected: true });
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

			remote = await this.container.git.getBestRemoteWithIntegration(repoPath, { includeDisconnected: true });
			if (remote == null) return false;
		} else {
			repoPath = args.repoPath;

			remotes = await this.container.git.getRemotesWithProviders(repoPath);
			remote = remotes.find(r => r.name === args.remote) as GitRemote<RemoteProvider> | undefined;
			if (!remote?.hasIntegration()) return false;
		}

		const integration = await this.container.integrations.getByRemote(remote);
		if (integration == null) return false;

		const connected = await integration.connect('remoteProvider');

		if (
			connected &&
			!(remotes ?? (await this.container.git.getRemotesWithProviders(repoPath))).some(r => r.default)
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

		return createMarkdownCommandLink<DisconnectRemoteProviderCommandArgs>(GlCommand.DisconnectRemoteProvider, args);
	}

	constructor(private readonly container: Container) {
		super(GlCommand.DisconnectRemoteProvider);
	}

	protected override preExecute(context: CommandContext, args?: DisconnectRemoteProviderCommandArgs) {
		if (isCommandContextViewNodeHasRemote(context)) {
			args = { ...args, remote: context.node.remote.name, repoPath: context.node.remote.repoPath };
		}

		return this.execute(args);
	}

	async execute(args?: DisconnectRemoteProviderCommandArgs): Promise<any> {
		let remote: GitRemote<RemoteProvider> | undefined;
		let repoPath;
		if (args?.repoPath == null) {
			const repos = new Map<Repository, GitRemote<RemoteProvider>>();

			for (const repo of this.container.git.openRepositories) {
				const remote = await repo.git.getBestRemoteWithIntegration({ includeDisconnected: false });
				if (remote != null) {
					repos.set(repo, remote);
				}
			}

			if (repos.size === 0) return undefined;
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
				if (pick == null) return undefined;

				repoPath = pick.path;
				remote = repos.get(pick)!;
			}
		} else if (args?.remote == null) {
			repoPath = args.repoPath;

			remote = await this.container.git.getBestRemoteWithIntegration(repoPath, { includeDisconnected: false });
			if (remote == null) return undefined;
		} else {
			repoPath = args.repoPath;

			remote = (await this.container.git.getRemotesWithProviders(repoPath)).find(r => r.name === args.remote);
			if (!remote?.hasIntegration()) return undefined;
		}

		const integration = await this.container.integrations.getByRemote(remote);
		return integration?.disconnect();
	}
}

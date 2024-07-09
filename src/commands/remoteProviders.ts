import { Commands } from '../constants';
import type { Container } from '../container';
import type { GitCommit } from '../git/models/commit';
import type { GitRemote } from '../git/models/remote';
import { isRemote } from '../git/models/remote';
import type { Repository } from '../git/models/repository';
import type { RemoteProvider } from '../git/remotes/remoteProvider';
import { isSupportedCloudIntegrationId } from '../plus/integrations/authentication/models';
import { showRepositoryPicker } from '../quickpicks/repositoryPicker';
import { command } from '../system/command';
import { first } from '../system/iterable';
import type { CommandContext } from './base';
import { Command, isCommandContextViewNodeHasRemote } from './base';

export interface ConnectRemoteProviderCommandArgs {
	remote: string;
	repoPath: string;
}

@command()
export class ConnectRemoteProviderCommand extends Command {
	static getMarkdownCommandArgs(args: ConnectRemoteProviderCommandArgs): string;
	static getMarkdownCommandArgs(remote: GitRemote): string;
	static getMarkdownCommandArgs(argsOrRemote: ConnectRemoteProviderCommandArgs | GitRemote): string {
		let args: ConnectRemoteProviderCommandArgs | GitCommit;
		if (isRemote(argsOrRemote)) {
			args = {
				remote: argsOrRemote.name,
				repoPath: argsOrRemote.repoPath,
			};
		} else {
			args = argsOrRemote;
		}

		return super.getMarkdownCommandArgsCore<ConnectRemoteProviderCommandArgs>(Commands.ConnectRemoteProvider, args);
	}

	constructor(private readonly container: Container) {
		super(Commands.ConnectRemoteProvider);
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
				const remote = await repo.getBestRemoteWithIntegration({ includeDisconnected: true });
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

		// Some integrations does not require managmement of Cloud Integrations (e.g. GitHub that can take a built-in VS Code session),
		// therefore we try to connect them right away.
		// Only if our attempt fails, we fall to manageCloudIntegrations flow.
		let connected = await integration.connect();

		if (!connected) {
			if (isSupportedCloudIntegrationId(integration.id)) {
				await this.container.integrations.manageCloudIntegrations(
					{ integrationId: integration.id, skipIfConnected: true },
					{
						source: 'remoteProvider',
						detail: {
							action: 'connect',
							integration: integration.id,
						},
					},
				);
				connected = await integration.connect();
			}
		}

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
export class DisconnectRemoteProviderCommand extends Command {
	static getMarkdownCommandArgs(args: DisconnectRemoteProviderCommandArgs): string;
	static getMarkdownCommandArgs(remote: GitRemote): string;
	static getMarkdownCommandArgs(argsOrRemote: DisconnectRemoteProviderCommandArgs | GitRemote): string {
		let args: DisconnectRemoteProviderCommandArgs | GitCommit;
		if (isRemote(argsOrRemote)) {
			args = {
				remote: argsOrRemote.name,
				repoPath: argsOrRemote.repoPath,
			};
		} else {
			args = argsOrRemote;
		}

		return super.getMarkdownCommandArgsCore<DisconnectRemoteProviderCommandArgs>(
			Commands.DisconnectRemoteProvider,
			args,
		);
	}

	constructor(private readonly container: Container) {
		super(Commands.DisconnectRemoteProvider);
	}

	protected override preExecute(context: CommandContext, args?: ConnectRemoteProviderCommandArgs) {
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
				const remote = await repo.getBestRemoteWithIntegration({ includeDisconnected: false });
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

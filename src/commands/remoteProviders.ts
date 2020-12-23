'use strict';
import { GitCommit, GitRemote, Repository, RichRemoteProvider } from '../git/git';
import { command, Command, CommandContext, Commands, isCommandContextViewNodeHasRemote } from './common';
import { Container } from '../container';
import { RepositoryPicker } from '../quickpicks/repositoryPicker';
import { Iterables } from '../system';

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
		if (GitRemote.is(argsOrRemote)) {
			args = {
				remote: argsOrRemote.id,
				repoPath: argsOrRemote.repoPath,
			};
		} else {
			args = argsOrRemote;
		}

		return super.getMarkdownCommandArgsCore<ConnectRemoteProviderCommandArgs>(Commands.ConnectRemoteProvider, args);
	}

	constructor() {
		super(Commands.ConnectRemoteProvider);
	}

	protected preExecute(context: CommandContext, args?: ConnectRemoteProviderCommandArgs) {
		if (isCommandContextViewNodeHasRemote(context)) {
			args = { ...args, remote: context.node.remote.id, repoPath: context.node.remote.repoPath };
		}

		return this.execute(args);
	}

	async execute(args?: ConnectRemoteProviderCommandArgs): Promise<any> {
		let remote: GitRemote<RichRemoteProvider> | undefined;
		let remotes: GitRemote[] | undefined;
		let repoPath;
		if (args?.repoPath == null) {
			const repos = new Map<Repository, GitRemote<RichRemoteProvider>>();

			for (const repo of await Container.git.getOrderedRepositories()) {
				const remote = await repo.getRichRemote();
				if (remote?.provider != null && !(await remote.provider.isConnected())) {
					repos.set(repo, remote);
				}
			}

			if (repos.size === 0) return false;
			if (repos.size === 1) {
				let repo;
				[repo, remote] = Iterables.first(repos);
				repoPath = repo.path;
			} else {
				const pick = await RepositoryPicker.show(
					undefined,
					'Choose which repository to connect to the remote provider',
					[...repos.keys()],
				);
				if (pick?.item == null) return undefined;

				repoPath = pick.repoPath;
				remote = repos.get(pick.item)!;
			}
		} else if (args?.remote == null) {
			repoPath = args.repoPath;

			remote = await Container.git.getRichRemoteProvider(repoPath, { includeDisconnected: true });
			if (remote == null) return false;
		} else {
			repoPath = args.repoPath;

			remotes = await Container.git.getRemotes(repoPath);
			remote = remotes.find(r => r.id === args.remote) as GitRemote<RichRemoteProvider> | undefined;
			if (!remote?.provider.hasApi()) return false;
		}

		const connected = await remote.provider.connect();
		if (connected && !(remotes ?? (await Container.git.getRemotes(repoPath))).some(r => r.default)) {
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
		if (GitRemote.is(argsOrRemote)) {
			args = {
				remote: argsOrRemote.id,
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

	constructor() {
		super(Commands.DisconnectRemoteProvider);
	}

	protected preExecute(context: CommandContext, args?: ConnectRemoteProviderCommandArgs) {
		if (isCommandContextViewNodeHasRemote(context)) {
			args = { ...args, remote: context.node.remote.id, repoPath: context.node.remote.repoPath };
		}

		return this.execute(args);
	}

	async execute(args?: DisconnectRemoteProviderCommandArgs): Promise<any> {
		let remote: GitRemote<RichRemoteProvider> | undefined;
		let repoPath;
		if (args?.repoPath == null) {
			const repos = new Map<Repository, GitRemote<RichRemoteProvider>>();

			for (const repo of await Container.git.getOrderedRepositories()) {
				const remote = await repo.getRichRemote(true);
				if (remote != null) {
					repos.set(repo, remote);
				}
			}

			if (repos.size === 0) return undefined;
			if (repos.size === 1) {
				let repo;
				[repo, remote] = Iterables.first(repos);
				repoPath = repo.path;
			} else {
				const pick = await RepositoryPicker.show(
					undefined,
					'Choose which repository to disconnect from the remote provider',
					[...repos.keys()],
				);
				if (pick?.item == null) return undefined;

				repoPath = pick.repoPath;
				remote = repos.get(pick.item)!;
			}
		} else if (args?.remote == null) {
			repoPath = args.repoPath;

			remote = await Container.git.getRichRemoteProvider(repoPath, { includeDisconnected: false });
			if (remote == null) return undefined;
		} else {
			repoPath = args.repoPath;

			remote = (await Container.git.getRemotes(repoPath)).find(r => r.id === args.remote) as
				| GitRemote<RichRemoteProvider>
				| undefined;
			if (!remote?.provider.hasApi()) return undefined;
		}

		return remote.provider.disconnect();
	}
}

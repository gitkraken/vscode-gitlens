import { Commands } from '../constants';
import type { Container } from '../container';
import type { GitCommit } from '../git/models/commit';
import { GitRemote } from '../git/models/remote';
import type { Repository } from '../git/models/repository';
import type { RichRemoteProvider } from '../git/remotes/richRemoteProvider';
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

	constructor(private readonly container: Container) {
		super(Commands.ConnectRemoteProvider);
	}

	protected override preExecute(context: CommandContext, args?: ConnectRemoteProviderCommandArgs) {
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

			for (const repo of this.container.git.openRepositories) {
				const remote = await repo.getRichRemote();
				if (remote?.provider != null && !(await remote.provider.isConnected())) {
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
				if (pick?.item == null) return undefined;

				repoPath = pick.repoPath;
				remote = repos.get(pick.item)!;
			}
		} else if (args?.remote == null) {
			repoPath = args.repoPath;

			remote = await this.container.git.getBestRemoteWithRichProvider(repoPath, { includeDisconnected: true });
			if (remote == null) return false;
		} else {
			repoPath = args.repoPath;

			remotes = await this.container.git.getRemotesWithProviders(repoPath);
			remote = remotes.find(r => r.id === args.remote) as GitRemote<RichRemoteProvider> | undefined;
			if (!remote?.hasRichProvider()) return false;
		}

		const connected = await remote.provider.connect();
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

	constructor(private readonly container: Container) {
		super(Commands.DisconnectRemoteProvider);
	}

	protected override preExecute(context: CommandContext, args?: ConnectRemoteProviderCommandArgs) {
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

			for (const repo of this.container.git.openRepositories) {
				const remote = await repo.getRichRemote(true);
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
				if (pick?.item == null) return undefined;

				repoPath = pick.repoPath;
				remote = repos.get(pick.item)!;
			}
		} else if (args?.remote == null) {
			repoPath = args.repoPath;

			remote = await this.container.git.getBestRemoteWithRichProvider(repoPath, { includeDisconnected: false });
			if (remote == null) return undefined;
		} else {
			repoPath = args.repoPath;

			remote = (await this.container.git.getRemotesWithProviders(repoPath)).find(r => r.id === args.remote) as
				| GitRemote<RichRemoteProvider>
				| undefined;
			if (!remote?.hasRichProvider()) return undefined;
		}

		return remote.provider.disconnect();
	}
}

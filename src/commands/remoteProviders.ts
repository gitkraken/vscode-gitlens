import type { GitCommit } from '@gitlens/git/models/commit.js';
import { GitRemote } from '@gitlens/git/models/remote.js';
import { first } from '@gitlens/utils/iterable.js';
import type { Source } from '../constants.telemetry.js';
import type { Container } from '../container.js';
import type { GlRepository } from '../git/models/repository.js';
import {
	getBestRemoteWithIntegration,
	getRemoteIntegration,
	remoteSupportsIntegration,
	setRemoteAsDefault,
} from '../git/utils/-webview/remote.utils.js';
import { showRepositoryPicker } from '../quickpicks/repositoryPicker.js';
import { command } from '../system/-webview/command.js';
import { createMarkdownCommandLink } from '../system/commands.js';
import { GlCommandBase } from './commandBase.js';
import type { CommandContext } from './commandContext.js';
import { isCommandContextViewNodeHasRemote } from './commandContext.utils.js';

export interface ConnectRemoteProviderCommandArgs {
	remote: string;
	repoPath: string;
	source?: Source;
}

@command()
export class ConnectRemoteProviderCommand extends GlCommandBase {
	static createMarkdownCommandLink(args: ConnectRemoteProviderCommandArgs): string;
	static createMarkdownCommandLink(remote: GitRemote, source: Source): string;
	static createMarkdownCommandLink(
		argsOrRemote: ConnectRemoteProviderCommandArgs | GitRemote,
		source?: Source,
	): string {
		let args: ConnectRemoteProviderCommandArgs | GitCommit;
		if (GitRemote.is(argsOrRemote)) {
			args = {
				remote: argsOrRemote.name,
				repoPath: argsOrRemote.repoPath,
				source: source,
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
		let remote: GitRemote | undefined;
		let remotes: GitRemote[] | undefined;
		let repoPath;
		if (args?.repoPath == null) {
			const repos = new Map<GlRepository, GitRemote>();

			for (const repo of this.container.git.openRepositories) {
				const remote = await getBestRemoteWithIntegration(repo.path, { includeDisconnected: true });
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
					this.container,
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

			remote = await getBestRemoteWithIntegration(repoPath, { includeDisconnected: true });
			if (remote == null) return false;
		} else {
			repoPath = args.repoPath;

			remotes = await this.container.git.getRepositoryService(repoPath).remotes.getRemotesWithProviders();
			remote = remotes.find(r => r.name === args.remote);
			if (!remote || !remoteSupportsIntegration(remote)) return false;
		}

		const integration = await getRemoteIntegration(remote);
		if (integration == null) return false;

		const connected = await integration.connect('remoteProvider');

		if (
			connected &&
			!(
				remotes ?? (await this.container.git.getRepositoryService(repoPath).remotes.getRemotesWithProviders())
			).some((r: GitRemote) => r.default)
		) {
			await setRemoteAsDefault(remote, true);
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
		if (GitRemote.is(argsOrRemote)) {
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
		let remote: GitRemote | undefined;
		let repoPath;
		if (args?.repoPath == null) {
			const repos = new Map<GlRepository, GitRemote>();

			for (const repo of this.container.git.openRepositories) {
				const remote = await getBestRemoteWithIntegration(repo.path, { includeDisconnected: false });
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
					this.container,
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

			remote = await getBestRemoteWithIntegration(repoPath, { includeDisconnected: false });
			if (remote == null) return;
		} else {
			repoPath = args.repoPath;

			remote = (await this.container.git.getRepositoryService(repoPath).remotes.getRemotesWithProviders()).find(
				(r: GitRemote) => r.name === args.remote,
			);
			if (!remote || !remoteSupportsIntegration(remote)) return;
		}

		const integration = await getRemoteIntegration(remote);
		return integration?.disconnect();
	}
}

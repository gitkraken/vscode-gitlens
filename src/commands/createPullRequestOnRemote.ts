import { Commands } from '../constants';
import type { Container } from '../container';
import type { GitRemote } from '../git/models/remote';
import type { RemoteResource } from '../git/models/remoteResource';
import { RemoteResourceType } from '../git/models/remoteResource';
import type { RemoteProvider } from '../git/remotes/remoteProvider';
import { command, executeCommand } from '../system/command';
import { Command } from './base';
import type { OpenOnRemoteCommandArgs } from './openOnRemote';

export interface CreatePullRequestOnRemoteCommandArgs {
	base?: string;
	compare: string;
	remote: string;
	repoPath: string;

	clipboard?: boolean;
}

@command()
export class CreatePullRequestOnRemoteCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.CreatePullRequestOnRemote);
	}

	async execute(args?: CreatePullRequestOnRemoteCommandArgs) {
		if (args?.repoPath == null) return;

		const repo = this.container.git.getRepository(args.repoPath);
		if (repo == null) return;

		const compareRemote = await repo.getRemote(args.remote);
		if (compareRemote?.provider == null) return;

		const providerId = compareRemote.provider.id;
		const remotes = (await repo.getRemotes({
			filter: r => r.provider?.id === providerId,
			sort: true,
		})) as GitRemote<RemoteProvider>[];

		const resource: RemoteResource = {
			type: RemoteResourceType.CreatePullRequest,
			base: {
				branch: args.base,
				remote: undefined!,
			},
			compare: {
				branch: args.compare,
				remote: { path: compareRemote.path, url: compareRemote.url },
			},
		};

		void (await executeCommand<OpenOnRemoteCommandArgs>(Commands.OpenOnRemote, {
			resource: resource,
			remotes: remotes,
		}));
	}
}

import { window } from 'vscode';
import { Commands } from '../constants.commands';
import type { Container } from '../container';
import { getRemoteNameFromBranchName } from '../git/models/branch';
import type { GitRemote } from '../git/models/remote';
import type { RemoteResource } from '../git/models/remoteResource';
import { RemoteResourceType } from '../git/models/remoteResource';
import type { RemoteProvider } from '../git/remotes/remoteProvider';
import { getRepositoryOrShowPicker } from '../quickpicks/repositoryPicker';
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
		let repo;
		if (args?.repoPath != null) {
			repo = this.container.git.getRepository(args.repoPath);
		}
		repo ??= await getRepositoryOrShowPicker('Create Pull Request', undefined, undefined);
		if (repo == null) return;

		if (args == null) {
			const branch = await repo.getBranch();
			if (branch?.upstream == null) {
				void window.showErrorMessage(
					`Unable to create a pull request for branch \`${branch?.name}\` because it has no upstream branch`,
				);
				return;
			}

			args = {
				base: undefined,
				compare: branch.name,
				remote: getRemoteNameFromBranchName(branch.upstream.name),
				repoPath: repo.path,
			};
		}

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

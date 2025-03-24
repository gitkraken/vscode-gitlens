import { window } from 'vscode';
import type { Container } from '../container';
import type { GitRemote } from '../git/models/remote';
import type { RemoteResource } from '../git/models/remoteResource';
import { RemoteResourceType } from '../git/models/remoteResource';
import type { RemoteProvider } from '../git/remotes/remoteProvider';
import { getRemoteNameFromBranchName } from '../git/utils/branch.utils';
import { getRepositoryOrShowPicker } from '../quickpicks/repositoryPicker';
import { command, executeCommand } from '../system/-webview/command';
import { GlCommandBase } from './commandBase';
import type { OpenOnRemoteCommandArgs } from './openOnRemote';

export interface CreatePullRequestOnRemoteCommandArgs {
	base?: string;
	compare: string;
	remote: string;
	repoPath: string;

	clipboard?: boolean;
}

@command()
export class CreatePullRequestOnRemoteCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.createPullRequestOnRemote');
	}

	async execute(args?: CreatePullRequestOnRemoteCommandArgs): Promise<void> {
		let repo;
		if (args?.repoPath != null) {
			repo = this.container.git.getRepository(args.repoPath);
		}
		repo ??= await getRepositoryOrShowPicker('Create Pull Request', undefined, undefined);
		if (repo == null) return;

		if (args == null) {
			const branch = await repo.git.branches().getBranch();
			if (branch?.upstream == null) {
				void window.showErrorMessage(
					`Unable to create a pull request for branch \`${branch?.name}\` as it hasn't been published to a remote.`,
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

		const compareRemote = await repo.git.remotes().getRemote(args.remote);
		if (compareRemote?.provider == null) {
			void window.showErrorMessage(
				`Unable to create a pull request for branch \`${args.compare}\` because it is not associated with a supported remote provider.`,
			);
			return;
		}

		const providerId = compareRemote.provider.id;
		const remotes = (await repo.git.remotes().getRemotes({
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

		void (await executeCommand<OpenOnRemoteCommandArgs>('gitlens.openOnRemote', {
			resource: resource,
			remotes: remotes,
		}));
	}
}

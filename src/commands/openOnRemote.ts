import { Commands, GlyphChars } from '../constants';
import type { Container } from '../container';
import { createRevisionRange, shortenRevision } from '../git/models/reference';
import { GitRemote } from '../git/models/remote';
import type { RemoteResource } from '../git/models/remoteResource';
import { RemoteResourceType } from '../git/models/remoteResource';
import type { RemoteProvider } from '../git/remotes/remoteProvider';
import { showGenericErrorMessage } from '../messages';
import { showRemoteProviderPicker } from '../quickpicks/remoteProviderPicker';
import { command } from '../system/command';
import { Logger } from '../system/logger';
import { pad, splitSingle } from '../system/string';
import { Command } from './base';

export type OpenOnRemoteCommandArgs =
	| {
			resource: RemoteResource;
			repoPath: string;

			remote?: string;
			clipboard?: boolean;
	  }
	| {
			resource: RemoteResource;
			remotes: GitRemote<RemoteProvider>[];

			remote?: string;
			clipboard?: boolean;
	  };

@command()
export class OpenOnRemoteCommand extends Command {
	constructor(private readonly container: Container) {
		super([Commands.OpenOnRemote, Commands.Deprecated_OpenInRemote]);
	}

	async execute(args?: OpenOnRemoteCommandArgs) {
		if (args?.resource == null) return;

		let remotes =
			'remotes' in args ? args.remotes : await this.container.git.getRemotesWithProviders(args.repoPath);

		if (args.remote != null) {
			const filtered = remotes.filter(r => r.name === args.remote);
			// Only filter if we get some results
			if (remotes.length > 0) {
				remotes = filtered;
			}
		}

		try {
			if (args.resource.type === RemoteResourceType.Branch) {
				// Check to see if the remote is in the branch
				const [remoteName, branchName] = splitSingle(args.resource.branch, '/');
				if (branchName != null) {
					const remote = remotes.find(r => r.name === remoteName);
					if (remote != null) {
						args.resource.branch = branchName;
						remotes = [remote];
					}
				}
			} else if (args.resource.type === RemoteResourceType.Revision) {
				const { commit, fileName } = args.resource;
				if (commit != null) {
					const file = await commit.findFile(fileName);
					if (file?.status === 'D') {
						// Resolve to the previous commit to that file
						args.resource.sha = await this.container.git.resolveReference(
							commit.repoPath,
							`${commit.sha}^`,
							fileName,
						);
					} else {
						args.resource.sha = commit.sha;
					}
				}
			}

			const providers = GitRemote.getHighlanderProviders(remotes);
			const provider = providers?.length ? providers[0].name : 'Remote';

			const options: Parameters<typeof showRemoteProviderPicker>[4] = {
				autoPick: 'default',
				clipboard: args.clipboard,
				setDefault: true,
			};

			let title;
			let placeHolder = `Choose which remote to ${args.clipboard ? 'copy the link for' : 'open on'}`;

			function getTitlePrefix(type: string): string {
				return args?.clipboard ? `Copy Link to ${type} for ${provider}` : `Open Branch on ${provider}`;
			}

			switch (args.resource.type) {
				case RemoteResourceType.Branch:
					title = `${getTitlePrefix('Branch')}${pad(GlyphChars.Dot, 2, 2)}${args.resource.branch}`;
					break;

				case RemoteResourceType.Branches:
					title = getTitlePrefix('Branches');
					break;

				case RemoteResourceType.Commit:
					title = `${getTitlePrefix('Commit')}${pad(GlyphChars.Dot, 2, 2)}${shortenRevision(
						args.resource.sha,
					)}`;
					break;

				case RemoteResourceType.Comparison:
					title = `${getTitlePrefix('Comparison')}${pad(GlyphChars.Dot, 2, 2)}${createRevisionRange(
						args.resource.base,
						args.resource.compare,
						args.resource.notation ?? '...',
					)}`;
					break;

				case RemoteResourceType.CreatePullRequest:
					options.autoPick = true;
					options.setDefault = false;

					title = `${
						args.clipboard
							? `Copy Create Pull Request Link for ${provider}`
							: `Create Pull Request on ${provider}`
					}${pad(GlyphChars.Dot, 2, 2)}${
						args.resource.base?.branch
							? createRevisionRange(args.resource.base.branch, args.resource.compare.branch, '...')
							: args.resource.compare.branch
					}`;

					placeHolder = `Choose which remote to ${
						args.clipboard ? 'copy the create pull request link for' : 'create the pull request on'
					}`;
					break;

				case RemoteResourceType.File:
					title = `${getTitlePrefix('File')}${pad(GlyphChars.Dot, 2, 2)}${args.resource.fileName}`;
					break;

				case RemoteResourceType.Repo:
					title = getTitlePrefix('Repository');
					break;

				case RemoteResourceType.Revision: {
					title = `${getTitlePrefix('File')}${pad(GlyphChars.Dot, 2, 2)}${shortenRevision(
						args.resource.sha,
					)}${pad(GlyphChars.Dot, 1, 1)}${args.resource.fileName}`;
					break;
				}

				// case RemoteResourceType.Tag: {
				// 	title = `${getTitlePrefix('Tag')}${pad(GlyphChars.Dot, 2, 2)}${args.resource.tag}`;
				// 	break;
				// }
			}

			const pick = await showRemoteProviderPicker(title, placeHolder, args.resource, remotes, options);
			await pick?.execute();
		} catch (ex) {
			Logger.error(ex, 'OpenOnRemoteCommand');
			void showGenericErrorMessage('Unable to open in remote provider');
		}
	}
}

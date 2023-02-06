import { Commands, GlyphChars } from '../constants';
import type { Container } from '../container';
import { GitRevision } from '../git/models/reference';
import { GitRemote } from '../git/models/remote';
import type { RemoteResource } from '../git/models/remoteResource';
import { RemoteResourceType } from '../git/models/remoteResource';
import type { RemoteProvider } from '../git/remotes/remoteProvider';
import { Logger } from '../logger';
import { showGenericErrorMessage } from '../messages';
import { RemoteProviderPicker } from '../quickpicks/remoteProviderPicker';
import { command } from '../system/command';
import { pad, splitSingle } from '../system/string';
import { Command } from './base';

export type OpenOnRemoteCommandArgs =
	| {
			resource: RemoteResource;
			repoPath: string;

			remote?: string;
			preSelectRemote?: boolean;
			clipboard?: boolean;
			deepLink?: boolean;
	  }
	| {
			resource: RemoteResource;
			remotes: GitRemote<RemoteProvider>[];

			remote?: string;
			preSelectRemote?: boolean;
			clipboard?: boolean;
			deepLink?: boolean;
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

		if (args.remote != null && !args.preSelectRemote) {
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
						if (!args.preSelectRemote) {
							remotes = [remote];
						}
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

			const options: Parameters<typeof RemoteProviderPicker.show>[4] = {
				autoPick: 'default',
				clipboard: args.clipboard,
				deepLink: args.deepLink,
				setDefault: true,
			};

			if (args.remote != null && args.preSelectRemote) {
				options.preSelected = args.remote;
			}

			let title;
			let placeHolder = `Choose which remote to ${args.clipboard ? 'copy the URL for' : 'open on'}`;

			const getCopyPrefix = (type: string): string => {
				return args.deepLink ? `Copy deep link to ${type} on ${provider}` : `Copy ${provider} ${type} URL`;
			};

			switch (args.resource.type) {
				case RemoteResourceType.Branch:
					title = `${args.clipboard ? getCopyPrefix('Branch') : `Open Branch on ${provider}`}${pad(
						GlyphChars.Dot,
						2,
						2,
					)}${args.resource.branch}`;
					break;

				case RemoteResourceType.Branches:
					title = `${args.clipboard ? `Copy ${provider} Branches URL` : `Open Branches on ${provider}`}`;
					break;

				case RemoteResourceType.Commit:
					title = `${args.clipboard ? getCopyPrefix('Commit') : `Open Commit on ${provider}`}${pad(
						GlyphChars.Dot,
						2,
						2,
					)}${GitRevision.shorten(args.resource.sha)}`;
					break;

				case RemoteResourceType.Comparison:
					title = `${
						args.clipboard ? `Copy ${provider} Comparison URL` : `Open Comparison on ${provider}`
					}${pad(GlyphChars.Dot, 2, 2)}${GitRevision.createRange(
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
							? `Copy ${provider} Create Pull Request URL`
							: `Create Pull Request on ${provider}`
					}${pad(GlyphChars.Dot, 2, 2)}${
						args.resource.base?.branch
							? GitRevision.createRange(args.resource.base.branch, args.resource.compare.branch, '...')
							: args.resource.compare.branch
					}`;

					placeHolder = `Choose which remote to ${
						args.clipboard ? 'copy the create pull request URL for' : 'create the pull request on'
					}`;
					break;

				case RemoteResourceType.File:
					title = `${args.clipboard ? `Copy ${provider} File URL` : `Open File on ${provider}`}${pad(
						GlyphChars.Dot,
						2,
						2,
					)}${args.resource.fileName}`;
					break;

				case RemoteResourceType.Repo:
					title = `${args.clipboard ? getCopyPrefix('Repository') : `Open Repository on ${provider}`}`;
					break;

				case RemoteResourceType.Revision: {
					title = `${args.clipboard ? `Copy ${provider} File URL` : `Open File on ${provider}`}${pad(
						GlyphChars.Dot,
						2,
						2,
					)}${GitRevision.shorten(args.resource.sha)}${pad(GlyphChars.Dot, 1, 1)}${args.resource.fileName}`;
					break;
				}

				case RemoteResourceType.Tag: {
					title = `${args.clipboard ? getCopyPrefix('Tag') : `Open Tag on ${provider}`}${pad(
						GlyphChars.Dot,
						2,
						2,
					)}${args.resource.tag}`;
					break;
				}
			}

			const pick = await RemoteProviderPicker.show(title, placeHolder, args.resource, remotes, options);
			await pick?.execute();
		} catch (ex) {
			Logger.error(ex, 'OpenOnRemoteCommand');
			void showGenericErrorMessage('Unable to open in remote provider');
		}
	}
}

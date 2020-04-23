'use strict';
import { Command, command, Commands } from './common';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { GitRemote, GitRevision, RemoteProvider, RemoteResource, RemoteResourceType } from '../git/git';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { CopyOrOpenRemoteCommandQuickPickItem, RemoteProviderPicker } from '../quickpicks';
import { Strings } from '../system';

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
	constructor() {
		super(Commands.OpenOnRemote);
	}

	async execute(args?: OpenOnRemoteCommandArgs) {
		if (args?.resource == null) return;

		let remotes = 'remotes' in args ? args.remotes : await Container.git.getRemotes(args.repoPath);

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
				const [remoteName, branchName] = Strings.splitSingle(args.resource.branch, '/');
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
					const file = commit?.files.find(f => f.fileName === fileName);
					if (file?.status === 'D') {
						// Resolve to the previous commit to that file
						args.resource.sha = await Container.git.resolveReference(
							commit.repoPath,
							`${commit.sha}^`,
							fileName,
						);
					} else {
						args.resource.sha = commit.sha;
					}
				}
			}

			// If there is only one or a default just execute it directly
			const remote = remotes.length === 1 ? remotes[0] : remotes.find(r => r.default);
			if (remote != null) {
				void (await new CopyOrOpenRemoteCommandQuickPickItem(remote, args.resource, args.clipboard).execute());
				return;
			}

			let title;
			switch (args.resource.type) {
				case RemoteResourceType.Branch:
					title = `${args.clipboard ? 'Copy Branch Url' : 'Open Branch'}${Strings.pad(GlyphChars.Dot, 2, 2)}${
						args.resource.branch
					}`;
					break;

				case RemoteResourceType.Branches:
					title = `${args.clipboard ? 'Copy Branches Url' : 'Open Branches'}`;
					break;

				case RemoteResourceType.Commit:
					title = `${args.clipboard ? 'Copy Commit Url' : 'Open Commit'}${Strings.pad(
						GlyphChars.Dot,
						2,
						2,
					)}${GitRevision.shorten(args.resource.sha)}`;
					break;

				case RemoteResourceType.File:
					title = `${args.clipboard ? 'Copy File Url' : 'Open File'}${Strings.pad(GlyphChars.Dot, 2, 2)}${
						args.resource.fileName
					}`;
					break;

				case RemoteResourceType.Repo:
					title = `${args.clipboard ? 'Copy Repository Url' : 'Open Repository'}`;
					break;

				case RemoteResourceType.Revision: {
					title = `${args.clipboard ? 'Copy File Url' : 'Open File'}${Strings.pad(
						GlyphChars.Dot,
						2,
						2,
					)}${GitRevision.shorten(args.resource.sha)}${Strings.pad(GlyphChars.Dot, 2, 2)}${
						args.resource.fileName
					}`;
					break;
				}
			}

			const pick = await RemoteProviderPicker.show(
				title,
				`Choose which remote to ${args.clipboard ? 'copy the url from' : 'open on'}`,
				args.resource,
				remotes,
				args.clipboard,
			);
			void (await pick?.execute());
		} catch (ex) {
			Logger.error(ex, 'OpenOnRemoteCommand');
			Messages.showGenericErrorMessage('Unable to open in remote provider');
		}
	}
}

import * as nls from 'vscode-nls';
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

const localize = nls.loadMessageBundle();

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

			const options: Parameters<typeof RemoteProviderPicker.show>[4] = {
				autoPick: 'default',
				clipboard: args.clipboard,
				setDefault: true,
			};
			let title;
			let placeHolder = args.clipboard
				? localize('chooseWhichRemoteToCopyUrlFor', 'Choose which remote to copy the url for')
				: localize('chooseWhichRemoteToOpenOn', 'Choose which remote to open on');

			switch (args.resource.type) {
				case RemoteResourceType.Branch:
					title = `${
						args.clipboard
							? providers?.length
								? localize('copyProviderBranchUrl', 'Copy {0} Branch Url', providers[0].name)
								: localize('copyRemoteBranchUrl', 'Copy Remote Branch Url')
							: providers?.length
							? localize('openBranchOnProvider', 'Open Branch on {0}', providers[0].name)
							: localize('openBranchOnRemote', 'Open Branch on Remote')
					}${pad(GlyphChars.Dot, 2, 2)}${args.resource.branch}`;
					break;

				case RemoteResourceType.Branches:
					title = args.clipboard
						? providers?.length
							? localize('copyProviderBranchesUrl', 'Copy {0} Branches Url', providers[0].name)
							: localize('copyRemoteBranchesUrl', 'Copy Remote Branches Url')
						: providers?.length
						? localize('openBranchesOnProvider', 'Open Branches on {0}', providers[0].name)
						: localize('openBranchesOnRemote', 'Open Branches on Remote');
					break;

				case RemoteResourceType.Commit:
					title = `${
						args.clipboard
							? providers?.length
								? localize('copyProviderCommitUrl', 'Copy {0} Commit Url', providers[0].name)
								: localize('copyRemoteCommitUrl', 'Copy Remote Commit Url')
							: providers?.length
							? localize('openCommitOnProvider', 'Open Commit on {0}', providers[0].name)
							: localize('openCommitOnRemote', 'Open Commit on Remote')
					}${pad(GlyphChars.Dot, 2, 2)}${GitRevision.shorten(args.resource.sha)}`;
					break;

				case RemoteResourceType.Comparison:
					title = `${
						args.clipboard
							? providers?.length
								? localize('copyProviderComparisonUrl', 'Copy {0} Comparison Url', providers[0].name)
								: localize('copyRemoteComparisonUrl', 'Copy Remote Comparison Url')
							: providers?.length
							? localize('openComparisonOnProvider', 'Open Comparison on {0}', providers[0].name)
							: localize('openComparisonOnRemote', 'Open Comparison on Remote')
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
							? providers?.length
								? localize(
										'copyProviderCreatePullRequestUrl',
										'Copy {0} Create Pull Request Url',
										providers[0].name,
								  )
								: localize('copyRemoteCreatePullRequestUrl', 'Copy Remote Create Pull Request Url')
							: providers?.length
							? localize('createPullRequestOnProvider', 'Create Pull Request on {0}', providers[0].name)
							: localize('createPullRequestOnRemote', 'Create Pull Request on Remote')
					}${pad(GlyphChars.Dot, 2, 2)}${
						args.resource.base?.branch
							? GitRevision.createRange(args.resource.base.branch, args.resource.compare.branch, '...')
							: args.resource.compare.branch
					}`;

					placeHolder = args.clipboard
						? localize(
								'chooseRemoteToCopyCreatePullRequestUrlFor',
								'Choose which remote to copy the create pull request url for',
						  )
						: localize(
								'chooseRemoteToCreatePullRequestOn',
								'Choose which remote to create the pull request on',
						  );
					break;

				case RemoteResourceType.File:
					title = `${
						args.clipboard
							? providers?.length
								? localize('copyProviderFileUrl', 'Copy {0} File Url', providers[0].name)
								: localize('copyRemoteFileUrl', 'Copy Remote File Url')
							: providers?.length
							? localize('openFileOnProvider', 'Open File on {0}', providers[0].name)
							: localize('openFileOnRemote', 'Open File on Remote')
					}${pad(GlyphChars.Dot, 2, 2)}${args.resource.fileName}`;
					break;

				case RemoteResourceType.Repo:
					title = args.clipboard
						? providers?.length
							? localize('copyProviderRepositoryUrl', 'Copy {0} Repository Url', providers[0].name)
							: localize('copyRemoteRepositoryUrl', 'Copy Remote Repository Url')
						: providers?.length
						? localize('openRepositoryOnProvider', 'Open Repository on {0}', providers[0].name)
						: localize('openRepositoryOnRemote', 'Open Repository on Remote');
					break;

				case RemoteResourceType.Revision: {
					title = `${
						args.clipboard
							? providers?.length
								? localize('copyProviderFileUrl', 'Copy {0} File Url', providers[0].name)
								: localize('copyRemoteFileUrl', 'Copy Remote File Url')
							: providers?.length
							? localize('openFileOnProvider', 'Open File on {0}', providers[0].name)
							: localize('openFileOnRemote', 'Open File on Remote')
					}${pad(GlyphChars.Dot, 2, 2)}${GitRevision.shorten(args.resource.sha)}${pad(GlyphChars.Dot, 1, 1)}${
						args.resource.fileName
					}`;
					break;
				}
			}

			const pick = await RemoteProviderPicker.show(title, placeHolder, args.resource, remotes, options);
			await pick?.execute();
		} catch (ex) {
			Logger.error(ex, 'OpenOnRemoteCommand');
			void showGenericErrorMessage(localize('unableToOpenInRemoteProvider', 'Unable to open in remote provider'));
		}
	}
}

import { GlyphChars } from '../constants';
import { GlCommand } from '../constants.commands';
import type { Container } from '../container';
import type { GitRemote } from '../git/models/remote';
import { getHighlanderProviders } from '../git/models/remote';
import type { RemoteResource } from '../git/models/remoteResource';
import { RemoteResourceType } from '../git/models/remoteResource';
import { createRevisionRange, shortenRevision } from '../git/models/revision.utils';
import type { RemoteProvider } from '../git/remotes/remoteProvider';
import { showGenericErrorMessage } from '../messages';
import { showRemoteProviderPicker } from '../quickpicks/remoteProviderPicker';
import { ensureArray } from '../system/array';
import { Logger } from '../system/logger';
import { pad, splitSingle } from '../system/string';
import { command } from '../system/vscode/command';
import { GlCommandBase } from './base';

export type OpenOnRemoteCommandArgs =
	| {
			resource: RemoteResource | RemoteResource[];
			repoPath: string;

			remote?: string;
			clipboard?: boolean;
	  }
	| {
			resource: RemoteResource | RemoteResource[];
			remotes: GitRemote<RemoteProvider>[];

			remote?: string;
			clipboard?: boolean;
	  };

@command()
export class OpenOnRemoteCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super([GlCommand.OpenOnRemote, GlCommand.Deprecated_OpenInRemote]);
	}

	async execute(args?: OpenOnRemoteCommandArgs) {
		if (args?.resource == null) return;

		let remotes =
			'remotes' in args
				? args.remotes
				: await this.container.git.getRemotesWithProviders(args.repoPath, { sort: true });

		if (args.remote != null) {
			const filtered = remotes.filter(r => r.name === args.remote);
			// Only filter if we get some results
			if (remotes.length > 0) {
				remotes = filtered;
			}
		}

		async function processResource(this: OpenOnRemoteCommand, resource: RemoteResource) {
			try {
				if (resource.type === RemoteResourceType.Branch) {
					// Check to see if the remote is in the branch
					const [remoteName, branchName] = splitSingle(resource.branch, '/');
					if (branchName != null) {
						const remote = remotes.find(r => r.name === remoteName);
						if (remote != null) {
							resource.branch = branchName;
							remotes = [remote];
						}
					}
				} else if (resource.type === RemoteResourceType.Revision) {
					const { commit, fileName } = resource;
					if (commit != null) {
						const file = await commit.findFile(fileName);
						if (file?.status === 'D') {
							// Resolve to the previous commit to that file
							resource.sha = await this.container.git.resolveReference(
								commit.repoPath,
								`${commit.sha}^`,
								fileName,
							);
						} else {
							resource.sha = commit.sha;
						}
					}
				}
			} catch (ex) {
				debugger;
				Logger.error(ex, 'OpenOnRemoteCommand.processResource');
			}
		}

		try {
			const resources = ensureArray(args.resource);
			for (const resource of resources) {
				await processResource.call(this, resource);
			}

			const providers = getHighlanderProviders(remotes);
			const provider = providers?.length ? providers[0].name : 'Remote';

			const options: Parameters<typeof showRemoteProviderPicker>[4] = {
				autoPick: 'default',
				clipboard: args.clipboard,
				setDefault: true,
			};

			let title;
			let placeholder = `Choose which remote to ${
				args.clipboard ? `copy the link${resources.length > 1 ? 's' : ''} for` : 'open on'
			} (or use the gear to set it as default)`;

			function getTitlePrefix(type: string): string {
				return args?.clipboard
					? `Copy ${provider} ${type} Link${resources.length > 1 ? 's' : ''}`
					: `Open ${type} on ${provider}`;
			}

			const [resource] = resources;
			switch (resource.type) {
				case RemoteResourceType.Branch:
					title = getTitlePrefix('Branch');
					if (resources.length === 1) {
						title += `${pad(GlyphChars.Dot, 2, 2)}${resource.branch}`;
					}
					break;

				case RemoteResourceType.Branches:
					title = getTitlePrefix('Branches');
					break;

				case RemoteResourceType.Commit:
					title = getTitlePrefix('Commit');
					if (resources.length === 1) {
						title += `${pad(GlyphChars.Dot, 2, 2)}${shortenRevision(resource.sha)}`;
					}
					break;

				case RemoteResourceType.Comparison:
					title = getTitlePrefix('Comparisons');
					if (resources.length === 1) {
						title += `${pad(GlyphChars.Dot, 2, 2)}${createRevisionRange(
							resource.base,
							resource.compare,
							resource.notation ?? '...',
						)}`;
					}
					break;

				case RemoteResourceType.CreatePullRequest:
					options.autoPick = true;
					options.setDefault = false;

					if (resources.length > 1) {
						title = args.clipboard
							? `Copy ${provider} Create Pull Request Links`
							: `Create Pull Requests on ${provider}`;

						placeholder = `Choose which remote to ${
							args.clipboard ? 'copy the create pull request links for' : 'create the pull requests on'
						}`;
					} else {
						title = `${
							args.clipboard
								? `Copy ${provider} Create Pull Request Link`
								: `Create Pull Request on ${provider}`
						}${pad(GlyphChars.Dot, 2, 2)}${
							resource.base?.branch
								? createRevisionRange(resource.base.branch, resource.compare.branch, '...')
								: resource.compare.branch
						}`;

						placeholder = `Choose which remote to ${
							args.clipboard ? 'copy the create pull request link for' : 'create the pull request on'
						}`;
					}
					break;

				case RemoteResourceType.File:
					title = getTitlePrefix('File');
					if (resources.length === 1) {
						title += `${pad(GlyphChars.Dot, 2, 2)}${resource.fileName}`;
					}
					break;

				case RemoteResourceType.Repo:
					title = getTitlePrefix('Repository');
					break;

				case RemoteResourceType.Revision: {
					title = getTitlePrefix('File');
					if (resources.length === 1) {
						title += `${pad(GlyphChars.Dot, 2, 2)}${shortenRevision(resource.sha)}${pad(
							GlyphChars.Dot,
							1,
							1,
						)}${resource.fileName}`;
					}
					break;
				}

				// case RemoteResourceType.Tag: {
				// 	title = getTitlePrefix('Tag');
				// 	if (resources.length === 1) {
				// 		title += `${pad(GlyphChars.Dot, 2, 2)}${args.resource.tag}`;
				// 	}
				// 	break;
				// }
			}

			const pick = await showRemoteProviderPicker(title, placeholder, resources, remotes, options);
			await pick?.execute();
		} catch (ex) {
			Logger.error(ex, 'OpenOnRemoteCommand');
			void showGenericErrorMessage('Unable to open in remote provider');
		}
	}
}

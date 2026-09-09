import { l10n } from 'vscode';
import type { GitRemote } from '@gitlens/git/models/remote.js';
import type { RemoteProvider } from '@gitlens/git/models/remoteProvider.js';
import type { RemoteResource } from '@gitlens/git/models/remoteResource.js';
import { RemoteResourceType } from '@gitlens/git/models/remoteResource.js';
import { getHighlanderProviders } from '@gitlens/git/utils/remote.utils.js';
import { createRevisionRange, shortenRevision } from '@gitlens/git/utils/revision.utils.js';
import { ensureArray } from '@gitlens/utils/array.js';
import { Logger } from '@gitlens/utils/logger.js';
import { formatPlural } from '@gitlens/utils/plural.js';
import { pad, splitSingle } from '@gitlens/utils/string.js';
import { GlyphChars } from '../constants.js';
import type { Container } from '../container.js';
import { findCommitFile } from '../git/utils/-webview/commit.utils.js';
import { showGenericErrorMessage } from '../messages.js';
import { showRemoteProviderPicker } from '../quickpicks/remoteProviderPicker.js';
import { command } from '../system/-webview/command.js';
import { GlCommandBase } from './commandBase.js';

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
		super(['gitlens.openOnRemote'], ['gitlens.openInRemote']);
	}

	async execute(args?: OpenOnRemoteCommandArgs): Promise<void> {
		if (args?.resource == null) return;

		let remotes =
			'remotes' in args
				? args.remotes
				: await this.container.git
						.getRepositoryService(args.repoPath)
						.remotes.getRemotesWithProviders({ sort: true });

		if (args.remote != null) {
			const filtered = remotes.filter((r: GitRemote) => r.name === args.remote);
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
						const remote = remotes.find((r: GitRemote) => r.name === remoteName);
						if (remote != null) {
							resource.branch = branchName;
							remotes = [remote];
						}
					}
				} else if (resource.type === RemoteResourceType.Revision) {
					const { commit, fileName } = resource;
					if (commit != null) {
						const file = await findCommitFile(commit, fileName);
						if (file?.status === 'D') {
							// Resolve to the previous commit to that file
							resource.sha = (
								await this.container.git
									.getRepositoryService(commit.repoPath)
									.revision.resolveRevision(`${commit.sha}^`, fileName)
							).sha;
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
			const provider = providers?.length ? providers[0].name : l10n.t('Remote');

			const options: Parameters<typeof showRemoteProviderPicker>[4] = {
				autoPick: 'default',
				clipboard: args.clipboard,
				setDefault: true,
			};

			let title;
			let placeholder = args.clipboard
				? formatPlural(
						l10n.t(
							'{0, plural, one{Choose which remote to copy the link for (or use the gear to set it as default)} other{Choose which remote to copy the links for (or use the gear to set it as default)}}',
						),
						[resources.length],
					)
				: l10n.t('Choose which remote to open on (or use the gear to set it as default)');
			const titleSeparator = pad(GlyphChars.Dot, 2, 2);

			const [resource] = resources;
			switch (resource.type) {
				case RemoteResourceType.Branch:
					title = args.clipboard
						? formatPlural(
								l10n.t('{3, plural, one{Copy {0} Branch Link{1}{2}} other{Copy {0} Branch Links}}'),
								[provider, titleSeparator, resource.branch, resources.length],
							)
						: formatPlural(l10n.t('{3, plural, one{Open Branch on {0}{1}{2}} other{Open Branch on {0}}}'), [
								provider,
								titleSeparator,
								resource.branch,
								resources.length,
							]);
					break;

				case RemoteResourceType.Branches:
					title = args.clipboard
						? formatPlural(
								l10n.t('{1, plural, one{Copy {0} Branches Link} other{Copy {0} Branches Links}}'),
								[provider, resources.length],
							)
						: l10n.t('Open Branches on {0}', provider);
					break;

				case RemoteResourceType.Commit:
					title = args.clipboard
						? formatPlural(
								l10n.t('{3, plural, one{Copy {0} Commit Link{1}{2}} other{Copy {0} Commit Links}}'),
								[provider, titleSeparator, shortenRevision(resource.sha), resources.length],
							)
						: formatPlural(l10n.t('{3, plural, one{Open Commit on {0}{1}{2}} other{Open Commit on {0}}}'), [
								provider,
								titleSeparator,
								shortenRevision(resource.sha),
								resources.length,
							]);
					break;

				case RemoteResourceType.Comparison: {
					const range = createRevisionRange(resource.base, resource.head, resource.notation ?? '...');
					title = args.clipboard
						? formatPlural(
								l10n.t(
									'{3, plural, one{Copy {0} Comparisons Link{1}{2}} other{Copy {0} Comparisons Links}}',
								),
								[provider, titleSeparator, range, resources.length],
							)
						: formatPlural(
								l10n.t(
									'{3, plural, one{Open Comparisons on {0}{1}{2}} other{Open Comparisons on {0}}}',
								),
								[provider, titleSeparator, range, resources.length],
							);
					break;
				}

				case RemoteResourceType.CreatePullRequest: {
					options.autoPick = true;
					options.setDefault = false;

					const range = resource.base?.branch
						? createRevisionRange(resource.base.branch, resource.head.branch, '...')
						: resource.head.branch;
					title = args.clipboard
						? formatPlural(
								l10n.t(
									'{3, plural, one{Copy {0} Create Pull Request Link{1}{2}} other{Copy {0} Create Pull Request Links}}',
								),
								[provider, titleSeparator, range, resources.length],
							)
						: formatPlural(
								l10n.t(
									'{3, plural, one{Create Pull Request on {0}{1}{2}} other{Create Pull Requests on {0}}}',
								),
								[provider, titleSeparator, range, resources.length],
							);

					placeholder = args.clipboard
						? formatPlural(
								l10n.t(
									'{0, plural, one{Choose which remote to copy the create pull request link for} other{Choose which remote to copy the create pull request links for}}',
								),
								[resources.length],
							)
						: formatPlural(
								l10n.t(
									'{0, plural, one{Choose which remote to create the pull request on} other{Choose which remote to create the pull requests on}}',
								),
								[resources.length],
							);
					break;
				}

				case RemoteResourceType.File:
					title = args.clipboard
						? formatPlural(
								l10n.t('{3, plural, one{Copy {0} File Link{1}{2}} other{Copy {0} File Links}}'),
								[provider, titleSeparator, resource.fileName, resources.length],
							)
						: formatPlural(l10n.t('{3, plural, one{Open File on {0}{1}{2}} other{Open File on {0}}}'), [
								provider,
								titleSeparator,
								resource.fileName,
								resources.length,
							]);
					break;

				case RemoteResourceType.Repo:
					title = args.clipboard
						? formatPlural(
								l10n.t('{1, plural, one{Copy {0} Repository Link} other{Copy {0} Repository Links}}'),
								[provider, resources.length],
							)
						: l10n.t('Open Repository on {0}', provider);
					break;

				case RemoteResourceType.Revision: {
					const fileSeparator = pad(GlyphChars.Dot, 1, 1);
					title = args.clipboard
						? formatPlural(
								l10n.t('{5, plural, one{Copy {0} File Link{1}{2}{3}{4}} other{Copy {0} File Links}}'),
								[
									provider,
									titleSeparator,
									shortenRevision(resource.sha),
									fileSeparator,
									resource.fileName,
									resources.length,
								],
							)
						: formatPlural(
								l10n.t('{5, plural, one{Open File on {0}{1}{2}{3}{4}} other{Open File on {0}}}'),
								[
									provider,
									titleSeparator,
									shortenRevision(resource.sha),
									fileSeparator,
									resource.fileName,
									resources.length,
								],
							);
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
			void showGenericErrorMessage(l10n.t('Unable to open in remote provider'));
		}
	}
}

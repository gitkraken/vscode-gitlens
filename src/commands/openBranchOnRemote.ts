import type { TextEditor, Uri } from 'vscode';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import { RemoteResourceType } from '../git/models/remoteResource';
import { getBranchNameWithoutRemote, getRemoteNameFromBranchName } from '../git/utils/branch.utils';
import { showGenericErrorMessage } from '../messages';
import { CommandQuickPickItem } from '../quickpicks/items/common';
import { showReferencePicker2 } from '../quickpicks/referencePicker';
import { getBestRepositoryOrShowPicker } from '../quickpicks/repositoryPicker';
import { command, executeCommand } from '../system/-webview/command';
import { Logger } from '../system/logger';
import { ActiveEditorCommand } from './commandBase';
import { getCommandUri } from './commandBase.utils';
import type { CommandContext } from './commandContext';
import { isCommandContextViewNodeHasBranch } from './commandContext.utils';
import type { OpenOnRemoteCommandArgs } from './openOnRemote';

export interface OpenBranchOnRemoteCommandArgs {
	branch?: string;
	clipboard?: boolean;
	remote?: string;
}

@command()
export class OpenBranchOnRemoteCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super(['gitlens.openBranchOnRemote', 'gitlens.copyRemoteBranchUrl'], ['gitlens.openBranchInRemote']);
	}

	protected override preExecute(context: CommandContext, args?: OpenBranchOnRemoteCommandArgs): Promise<void> {
		if (isCommandContextViewNodeHasBranch(context)) {
			args = {
				...args,
				branch: context.node.branch.name,
				remote: context.node.branch.getRemoteName(),
			};
		}

		if (context.command === 'gitlens.copyRemoteBranchUrl') {
			args = { ...args, clipboard: true };
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: OpenBranchOnRemoteCommandArgs): Promise<void> {
		uri = getCommandUri(uri, editor);

		const gitUri = uri != null ? await GitUri.fromUri(uri) : undefined;

		const repoPath = (
			await getBestRepositoryOrShowPicker(
				this.container,
				gitUri,
				editor,
				args?.clipboard ? 'Copy Remote Branch URL' : 'Open Branch On Remote',
			)
		)?.path;
		if (!repoPath) return;

		args = { ...args };

		try {
			if (args.branch == null) {
				const result = await showReferencePicker2(
					repoPath,
					args.clipboard ? 'Copy Remote Branch URL' : 'Open Branch On Remote',
					args.clipboard ? 'Choose a branch to copy the URL from' : 'Choose a branch to open',
					{
						autoPick: true,
						// checkmarks: false,
						filter: { branches: b => b.upstream != null },
						include: ['branches'],
						sort: { branches: { current: true }, tags: {} },
					},
				);
				if (result.value == null || result.value instanceof CommandQuickPickItem) return;

				const pick = result.value;

				if (pick.refType === 'branch') {
					if (pick.remote || (pick.upstream != null && !pick.upstream.missing)) {
						const name = pick.remote ? pick.name : pick.upstream!.name;
						args.branch = getBranchNameWithoutRemote(name);
						args.remote = getRemoteNameFromBranchName(name);
					} else {
						args.branch = pick.name;
					}
				} else {
					args.branch = pick.ref;
				}
			}

			void (await executeCommand<OpenOnRemoteCommandArgs>('gitlens.openOnRemote', {
				resource: {
					type: RemoteResourceType.Branch,
					branch: args.branch || 'HEAD',
				},
				repoPath: repoPath,
				remote: args.remote,
				clipboard: args.clipboard,
			}));
		} catch (ex) {
			Logger.error(ex, 'OpenBranchOnRemoteCommand');
			void showGenericErrorMessage('Unable to open branch on remote provider');
		}
	}
}

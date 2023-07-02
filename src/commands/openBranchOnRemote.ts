import type { TextEditor, Uri } from 'vscode';
import { Commands } from '../constants';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import { RemoteResourceType } from '../git/models/remoteResource';
import { showGenericErrorMessage } from '../messages';
import { CommandQuickPickItem } from '../quickpicks/items/common';
import { ReferencesQuickPickIncludes, showReferencePicker } from '../quickpicks/referencePicker';
import { getBestRepositoryOrShowPicker } from '../quickpicks/repositoryPicker';
import { command, executeCommand } from '../system/command';
import { Logger } from '../system/logger';
import type { CommandContext } from './base';
import { ActiveEditorCommand, getCommandUri, isCommandContextViewNodeHasBranch } from './base';
import type { OpenOnRemoteCommandArgs } from './openOnRemote';

export interface OpenBranchOnRemoteCommandArgs {
	branch?: string;
	clipboard?: boolean;
	remote?: string;
}

@command()
export class OpenBranchOnRemoteCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super([Commands.OpenBranchOnRemote, Commands.Deprecated_OpenBranchInRemote, Commands.CopyRemoteBranchUrl]);
	}

	protected override preExecute(context: CommandContext, args?: OpenBranchOnRemoteCommandArgs) {
		if (isCommandContextViewNodeHasBranch(context)) {
			args = {
				...args,
				branch: context.node.branch.name,
				remote: context.node.branch.getRemoteName(),
			};
		}

		if (context.command === Commands.CopyRemoteBranchUrl) {
			args = { ...args, clipboard: true };
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: OpenBranchOnRemoteCommandArgs) {
		uri = getCommandUri(uri, editor);

		const gitUri = uri != null ? await GitUri.fromUri(uri) : undefined;

		const repoPath = (
			await getBestRepositoryOrShowPicker(
				gitUri,
				editor,
				args?.clipboard ? 'Copy Remote Branch URL' : 'Open Branch On Remote',
			)
		)?.path;
		if (!repoPath) return;

		args = { ...args };

		try {
			if (args.branch == null) {
				const pick = await showReferencePicker(
					repoPath,
					args.clipboard ? 'Copy Remote Branch URL' : 'Open Branch On Remote',
					args.clipboard ? 'Choose a branch to copy the URL from' : 'Choose a branch to open',
					{
						autoPick: true,
						// checkmarks: false,
						filter: { branches: b => b.upstream != null },
						include: ReferencesQuickPickIncludes.Branches,
						sort: { branches: { current: true }, tags: {} },
					},
				);
				if (pick == null || pick instanceof CommandQuickPickItem) return;

				args.branch = pick.ref;
			}

			void (await executeCommand<OpenOnRemoteCommandArgs>(Commands.OpenOnRemote, {
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

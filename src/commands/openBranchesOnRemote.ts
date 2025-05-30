import type { TextEditor, Uri } from 'vscode';
import { window } from 'vscode';
import { Commands } from '../constants';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import { RemoteResourceType } from '../git/models/remoteResource';
import { Logger } from '../logger';
import { RepositoryPicker } from '../quickpicks/repositoryPicker';
import { command, executeCommand } from '../system/command';
import type { CommandContext } from './base';
import { ActiveEditorCommand, getCommandUri, isCommandContextViewNodeHasRemote } from './base';
import type { OpenOnRemoteCommandArgs } from './openOnRemote';

export interface OpenBranchesOnRemoteCommandArgs {
	clipboard?: boolean;
	remote?: string;
}

@command()
export class OpenBranchesOnRemoteCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super([
			Commands.OpenBranchesOnRemote,
			Commands.Deprecated_OpenBranchesInRemote,
			Commands.CopyRemoteBranchesUrl,
		]);
	}

	protected override preExecute(context: CommandContext, args?: OpenBranchesOnRemoteCommandArgs) {
		if (isCommandContextViewNodeHasRemote(context)) {
			args = { ...args, remote: context.node.remote.name };
		}

		if (context.command === Commands.CopyRemoteBranchesUrl) {
			args = { ...args, clipboard: true };
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: OpenBranchesOnRemoteCommandArgs) {
		uri = getCommandUri(uri, editor);

		const gitUri = uri != null ? await GitUri.fromUri(uri) : undefined;

		const repoPath = (
			await RepositoryPicker.getBestRepositoryOrShow(
				gitUri,
				editor,
				args?.clipboard ? 'Copy Remote Branches URL' : 'Open Branches on Remote',
			)
		)?.path;
		if (!repoPath) return;

		try {
			void (await executeCommand<OpenOnRemoteCommandArgs>(Commands.OpenOnRemote, {
				resource: {
					type: RemoteResourceType.Branches,
				},
				repoPath: repoPath,
				remote: args?.remote,
				clipboard: args?.clipboard,
			}));
		} catch (ex) {
			Logger.error(ex, 'OpenBranchesOnRemoteCommand');
			void window.showErrorMessage(
				'Unable to open branches on remote provider. See output channel for more details',
			);
		}
	}
}

import type { TextEditor, Uri } from 'vscode';
import { GlCommand } from '../constants.commands';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import { RemoteResourceType } from '../git/models/remoteResource';
import { showGenericErrorMessage } from '../messages';
import { getBestRepositoryOrShowPicker } from '../quickpicks/repositoryPicker';
import { Logger } from '../system/logger';
import { command, executeCommand } from '../system/vscode/command';
import type { CommandContext } from './base';
import { ActiveEditorCommand, getCommandUri, isCommandContextViewNodeHasRemote } from './base';
import type { OpenOnRemoteCommandArgs } from './openOnRemote';

export interface OpenRepoOnRemoteCommandArgs {
	clipboard?: boolean;
	remote?: string;
}

@command()
export class OpenRepoOnRemoteCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super([GlCommand.OpenRepoOnRemote, GlCommand.Deprecated_OpenRepoInRemote, GlCommand.CopyRemoteRepositoryUrl]);
	}

	protected override preExecute(context: CommandContext, args?: OpenRepoOnRemoteCommandArgs) {
		if (isCommandContextViewNodeHasRemote(context)) {
			args = { ...args, remote: context.node.remote.name };
		}

		if (context.command === GlCommand.CopyRemoteRepositoryUrl) {
			args = { ...args, clipboard: true };
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: OpenRepoOnRemoteCommandArgs) {
		uri = getCommandUri(uri, editor);

		const gitUri = uri != null ? await GitUri.fromUri(uri) : undefined;

		const repoPath = (
			await getBestRepositoryOrShowPicker(
				gitUri,
				editor,
				args?.clipboard
					? 'Choose which repository to copy the url from'
					: 'Choose which repository to open on remote',
			)
		)?.path;
		if (!repoPath) return;

		try {
			void (await executeCommand<OpenOnRemoteCommandArgs>(GlCommand.OpenOnRemote, {
				resource: {
					type: RemoteResourceType.Repo,
				},
				repoPath: repoPath,
				remote: args?.remote,
				clipboard: args?.clipboard,
			}));
		} catch (ex) {
			Logger.error(ex, 'OpenRepoOnRemoteCommand');
			void showGenericErrorMessage('Unable to open repository on remote provider');
		}
	}
}

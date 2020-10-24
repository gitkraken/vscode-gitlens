'use strict';
import { TextEditor, Uri, window } from 'vscode';
import {
	ActiveEditorCommand,
	command,
	CommandContext,
	Commands,
	executeCommand,
	getCommandUri,
	getRepoPathOrActiveOrPrompt,
	isCommandContextViewNodeHasRemote,
} from './common';
import { RemoteResourceType } from '../git/git';
import { GitUri } from '../git/gitUri';
import { Logger } from '../logger';
import { OpenOnRemoteCommandArgs } from './openOnRemote';

export interface OpenRepoOnRemoteCommandArgs {
	clipboard?: boolean;
	remote?: string;
}

@command()
export class OpenRepoOnRemoteCommand extends ActiveEditorCommand {
	constructor() {
		super([Commands.OpenRepoInRemote, Commands.CopyRemoteRepositoryUrl]);
	}

	protected preExecute(context: CommandContext, args?: OpenRepoOnRemoteCommandArgs) {
		if (isCommandContextViewNodeHasRemote(context)) {
			args = { ...args, remote: context.node.remote.name };
		}

		if (context.command === Commands.CopyRemoteRepositoryUrl) {
			args = { ...args, clipboard: true };
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: OpenRepoOnRemoteCommandArgs) {
		uri = getCommandUri(uri, editor);

		const gitUri = uri != null ? await GitUri.fromUri(uri) : undefined;

		const repoPath = await getRepoPathOrActiveOrPrompt(
			gitUri,
			editor,
			args?.clipboard
				? 'Choose which repository to copy the url from'
				: 'Choose which repository to open on remote',
		);
		if (!repoPath) return;

		try {
			void (await executeCommand<OpenOnRemoteCommandArgs>(Commands.OpenInRemote, {
				resource: {
					type: RemoteResourceType.Repo,
				},
				repoPath: repoPath,
				remote: args?.remote,
				clipboard: args?.clipboard,
			}));
		} catch (ex) {
			Logger.error(ex, 'OpenRepoOnRemoteCommand');
			void window.showErrorMessage(
				'Unable to open repository on remote provider. See output channel for more details',
			);
		}
	}
}

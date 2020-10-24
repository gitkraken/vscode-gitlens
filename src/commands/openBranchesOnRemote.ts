'use strict';
import { TextEditor, Uri, window } from 'vscode';
import { RemoteResourceType } from '../git/git';
import { GitUri } from '../git/gitUri';
import { Logger } from '../logger';
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
import { OpenOnRemoteCommandArgs } from './openOnRemote';

export interface OpenBranchesOnRemoteCommandArgs {
	clipboard?: boolean;
	remote?: string;
}

@command()
export class OpenBranchesOnRemoteCommand extends ActiveEditorCommand {
	constructor() {
		super([Commands.OpenBranchesInRemote, Commands.CopyRemoteBranchesUrl]);
	}

	protected preExecute(context: CommandContext, args?: OpenBranchesOnRemoteCommandArgs) {
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

		const repoPath = await getRepoPathOrActiveOrPrompt(
			gitUri,
			editor,
			args?.clipboard ? 'Copy Remote Branches Url' : 'Open Branches on Remote',
		);
		if (!repoPath) return;

		try {
			void (await executeCommand<OpenOnRemoteCommandArgs>(Commands.OpenInRemote, {
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

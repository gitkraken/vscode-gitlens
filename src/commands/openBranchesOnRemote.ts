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
	isCommandViewContextWithRemote,
} from './common';
import { OpenOnRemoteCommandArgs } from './openOnRemote';

export interface OpenBranchesOnRemoteCommandArgs {
	remote?: string;
}

@command()
export class OpenBranchesOnRemoteCommand extends ActiveEditorCommand {
	constructor() {
		super(Commands.OpenBranchesInRemote);
	}

	protected preExecute(context: CommandContext, args?: OpenBranchesOnRemoteCommandArgs) {
		if (isCommandViewContextWithRemote(context)) {
			args = { ...args };
			args.remote = context.node.remote.name;
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: OpenBranchesOnRemoteCommandArgs) {
		uri = getCommandUri(uri, editor);

		const gitUri = uri && (await GitUri.fromUri(uri));

		const repoPath = await getRepoPathOrActiveOrPrompt(gitUri, editor, 'Open Branches on Remote');
		if (!repoPath) return;

		try {
			void (await executeCommand<OpenOnRemoteCommandArgs>(Commands.OpenOnRemote, {
				resource: {
					type: RemoteResourceType.Branches,
				},
				repoPath: repoPath,
				remote: args?.remote,
			}));
		} catch (ex) {
			Logger.error(ex, 'OpenBranchesOnRemoteCommand');
			void window.showErrorMessage(
				'Unable to open branches on remote provider. See output channel for more details',
			);
		}
	}
}

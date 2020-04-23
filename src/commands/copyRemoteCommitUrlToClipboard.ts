'use strict';
import { TextEditor, Uri } from 'vscode';
import {
	ActiveEditorCommand,
	command,
	CommandContext,
	Commands,
	executeEditorCommand,
	isCommandViewContextWithCommit,
} from './common';
import { OpenCommitOnRemoteCommandArgs } from './openCommitOnRemote';

export interface CopyRemoteCommitUrlToClipboardCommandArgs extends OpenCommitOnRemoteCommandArgs {
	sha?: string;
}

@command()
export class CopyRemoteCommitUrlToClipboardCommand extends ActiveEditorCommand {
	constructor() {
		super(Commands.CopyRemoteCommitUrlToClipboard);
	}

	protected preExecute(context: CommandContext, args?: CopyRemoteCommitUrlToClipboardCommandArgs) {
		if (context.type === 'uris' || context.type === 'scm-states') {
			args = { ...args };
		} else if (isCommandViewContextWithCommit(context)) {
			if (context.node.commit.isUncommitted) return Promise.resolve(undefined);

			args = { ...args, sha: context.node.commit.sha };
			return this.execute(
				context.editor,
				context.node.commit.isFile ? context.node.commit.uri : context.node.uri,
				args,
			);
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: CopyRemoteCommitUrlToClipboardCommandArgs) {
		void (await executeEditorCommand<OpenCommitOnRemoteCommandArgs>(Commands.OpenCommitInRemote, uri, {
			...args,
			clipboard: true,
		}));
	}
}

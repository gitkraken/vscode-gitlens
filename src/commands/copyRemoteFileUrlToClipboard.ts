'use strict';
import { TextEditor, Uri } from 'vscode';
import {
	ActiveEditorCommand,
	command,
	CommandContext,
	Commands,
	executeEditorCommand,
	getCommandUri,
	isCommandViewContextWithCommit,
} from './common';
import { Container } from '../container';
import { GitUri } from '../git/gitUri';
import { OpenFileOnRemoteCommandArgs } from './openFileOnRemote';
import { StatusFileNode } from '../views/nodes';

export interface CopyRemoteFileUrlToClipboardCommandArgs {
	range?: boolean;
	sha?: string;
}

@command()
export class CopyRemoteFileUrlToClipboardCommand extends ActiveEditorCommand {
	constructor() {
		super(Commands.CopyRemoteFileUrlToClipboard);
	}

	protected preExecute(context: CommandContext, args?: CopyRemoteFileUrlToClipboardCommandArgs) {
		if (context.type === 'uris' || context.type === 'scm-states') {
			args = { ...args, range: false };
		} else if (isCommandViewContextWithCommit(context)) {
			args = { ...args, range: false, sha: context.node.commit.sha };

			// If it is a StatusFileNode then don't include the sha, since it hasn't been pushed yet
			if (context.node instanceof StatusFileNode) {
				args.sha = undefined;
			}

			return this.execute(
				context.editor,
				context.node.commit.isFile ? context.node.commit.uri : context.node.uri,
				args,
			);
		} else if (context.type === 'viewItem') {
			args = { ...args, range: false };
			return this.execute(context.editor, context.node.uri ?? context.uri, args);
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: CopyRemoteFileUrlToClipboardCommandArgs) {
		args = { range: true, ...args };

		if (args.sha == null) {
			uri = getCommandUri(uri, editor);
			if (uri == null) return;

			const gitUri = await GitUri.fromUri(uri);
			if (!gitUri.repoPath) return;

			args = { ...args };
			if (gitUri.sha == null) {
				const commit = await Container.git.getCommitForFile(gitUri.repoPath, gitUri.fsPath, {
					firstIfNotFound: true,
				});

				if (commit != null) {
					args.sha = commit.sha;
				}
			} else {
				args.sha = gitUri.sha;
			}
		}

		void (await executeEditorCommand<OpenFileOnRemoteCommandArgs>(Commands.OpenFileInRemote, uri, {
			...args,
			clipboard: true,
		}));
	}
}

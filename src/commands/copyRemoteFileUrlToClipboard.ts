'use strict';
import { commands, TextEditor, Uri } from 'vscode';
import { Container } from '../container';
import { GitUri } from '../git/gitService';
import { StatusFileNode } from '../views/nodes';
import {
	ActiveEditorCommand,
	command,
	CommandContext,
	Commands,
	getCommandUri,
	isCommandViewContextWithCommit,
} from './common';
import { OpenFileInRemoteCommandArgs } from './openFileInRemote';

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

		if (args.sha === undefined) {
			uri = getCommandUri(uri, editor);
			if (uri == null) return undefined;

			const gitUri = await GitUri.fromUri(uri);
			if (!gitUri.repoPath) return undefined;

			args = { ...args };
			if (gitUri.sha === undefined) {
				const commit = await Container.git.getCommitForFile(gitUri.repoPath, gitUri.fsPath, {
					firstIfNotFound: true,
				});

				if (commit !== undefined) {
					args.sha = commit.sha;
				}
			} else {
				args.sha = gitUri.sha;
			}
		}

		const commandArgs: OpenFileInRemoteCommandArgs = { ...args, clipboard: true };
		return commands.executeCommand(Commands.OpenFileInRemote, uri, commandArgs);
	}
}

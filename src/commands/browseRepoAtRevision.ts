'use strict';
import * as paths from 'path';
import { commands, TextEditor, Uri } from 'vscode';
import { ActiveEditorCommand, command, CommandContext, Commands, getCommandUri, openWorkspace } from './common';
import { BuiltInCommands } from '../constants';
import { toGitLensFSUri } from '../git/fsProvider';
import { GitUri } from '../git/gitUri';
import { Logger } from '../logger';
import { Messages } from '../messages';

export interface BrowseRepoAtRevisionCommandArgs {
	uri?: Uri;

	openInNewWindow?: boolean;
}

@command()
export class BrowseRepoAtRevisionCommand extends ActiveEditorCommand {
	constructor() {
		super([Commands.BrowseRepoAtRevision, Commands.BrowseRepoAtRevisionInNewWindow]);
	}

	protected preExecute(context: CommandContext, args?: BrowseRepoAtRevisionCommandArgs) {
		if (context.command === Commands.BrowseRepoAtRevisionInNewWindow) {
			args = { ...args, openInNewWindow: true };
		}

		return this.execute(context.editor!, context.uri, args);
	}

	async execute(editor: TextEditor, uri?: Uri, args?: BrowseRepoAtRevisionCommandArgs) {
		args = { ...args };

		try {
			if (args.uri == null) {
				uri = getCommandUri(uri, editor);
				if (uri == null) return;
			} else {
				uri = args.uri;
			}

			let gitUri = await GitUri.fromUri(uri);
			if (gitUri.sha == null) return;

			uri = toGitLensFSUri(gitUri.sha, gitUri.repoPath!);
			gitUri = GitUri.fromRevisionUri(uri);

			openWorkspace(uri, `${paths.basename(gitUri.repoPath!)} @ ${gitUri.shortSha}`, {
				openInNewWindow: args.openInNewWindow,
			});

			if (!args.openInNewWindow) {
				void commands.executeCommand(BuiltInCommands.FocusFilesExplorer);
			}
		} catch (ex) {
			Logger.error(ex, 'BrowseRepoAtRevisionCommand');
			Messages.showGenericErrorMessage('Unable to open the repository at the specified revision');
		}
	}
}

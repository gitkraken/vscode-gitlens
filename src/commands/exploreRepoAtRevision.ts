'use strict';
import * as paths from 'path';
import { commands, TextEditor, Uri } from 'vscode';
import { GitUri } from '../git/gitService';
import { ActiveEditorCommand, command, Commands, getCommandUri, openWorkspace } from './common';
import { toGitLensFSUri } from '../git/fsProvider';
import { BuiltInCommands } from '../constants';
import { Logger } from '../logger';
import { Messages } from '../messages';

export interface ExploreRepoAtRevisionCommandArgs {
	uri?: Uri;
}

@command()
export class ExploreRepoAtRevisionCommand extends ActiveEditorCommand {
	constructor() {
		super(Commands.ExploreRepoAtRevision);
	}

	async execute(editor: TextEditor, uri?: Uri, args?: ExploreRepoAtRevisionCommandArgs) {
		args = { ...args };

		try {
			if (args.uri == null) {
				uri = getCommandUri(uri, editor);
				if (uri == null) return undefined;
			} else {
				uri = args.uri;
			}

			let gitUri = await GitUri.fromUri(uri);
			if (gitUri.sha === undefined) return undefined;

			uri = toGitLensFSUri(gitUri.sha, gitUri.repoPath!);
			gitUri = GitUri.fromRevisionUri(uri);

			openWorkspace(uri, `${paths.basename(gitUri.repoPath!)} @ ${gitUri.shortSha}`);

			void commands.executeCommand(BuiltInCommands.FocusFilesExplorer);

			return undefined;
		} catch (ex) {
			Logger.error(ex, 'ExploreRepoAtRevisionCommand');
			return Messages.showGenericErrorMessage('Unable to open the repository to the specified revision');
		}
	}
}

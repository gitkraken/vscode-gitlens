'use strict';
import { TextEditor, Uri } from 'vscode';
import { ActiveEditorCommand, command, Commands, executeCommand, getCommandUri } from './common';
import { Container } from '../container';
import { Logger } from '../logger';
import { GitUri } from '../git/gitUri';
import { OpenPullRequestOnRemoteCommandArgs } from './openPullRequestOnRemote';

@command()
export class OpenAssociatedPullRequestOnRemoteCommand extends ActiveEditorCommand {
	constructor() {
		super(Commands.OpenAssociatedPullRequestOnRemote);
	}

	async execute(editor?: TextEditor, uri?: Uri) {
		if (editor == null) return;

		uri = getCommandUri(uri, editor);
		if (uri == null) return;

		const gitUri = await GitUri.fromUri(uri);

		const blameline = editor.selection.active.line;
		if (blameline < 0) return;

		try {
			const blame = await Container.git.getBlameForLine(gitUri, blameline);
			if (blame == null) return;

			await executeCommand<OpenPullRequestOnRemoteCommandArgs>(Commands.OpenPullRequestOnRemote, {
				clipboard: false,
				ref: blame.commit.sha,
				repoPath: blame.commit.repoPath,
			});
		} catch (ex) {
			Logger.error(ex, 'OpenAssociatedPullRequestOnRemoteCommand', `getBlameForLine(${blameline})`);
		}
	}
}

'use strict';

import { env , TextEditor , Uri , window } from 'vscode';
import { GitService } from '../git/gitService';
import { GitUri } from '../git/gitUri';
import { Logger } from '../logger';
import { ActiveEditorCommand, command, Commands, getCommandUri, getRepoPathOrActiveOrPrompt } from './common';

@command()
export class CopyCurrentBranch extends ActiveEditorCommand {
	constructor() {
		super(Commands.CopyCurrentBranch);
	}

	async execute(editor?: TextEditor, uri?: Uri) {
		uri = getCommandUri(uri, editor);

		const gitUri = uri != null ? await GitUri.fromUri(uri) : undefined;

		const repoPath = await getRepoPathOrActiveOrPrompt(gitUri, editor, 'Copy Current Branch');
		if (!repoPath) return;

		const service = new GitService();

		try {
			const gitBranch = await service.getBranch(repoPath);
			if (gitBranch?.name) await env.clipboard.writeText(gitBranch?.name);
		} catch (ex) {
			Logger.error(ex, 'CopyCurrentBranch');
			void window.showErrorMessage('Unable to copy current branch. See output channel for more details');
		}
	}
}

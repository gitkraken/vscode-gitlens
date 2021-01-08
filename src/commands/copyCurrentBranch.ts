'use strict';
import { env, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, command, Commands, getCommandUri, getRepoPathOrActiveOrPrompt } from './common';
import { Container } from '../container';
import { GitUri } from '../git/gitUri';
import { Logger } from '../logger';

@command()
export class CopyCurrentBranchCommand extends ActiveEditorCommand {
	constructor() {
		super(Commands.CopyCurrentBranch);
	}

	async execute(editor?: TextEditor, uri?: Uri) {
		uri = getCommandUri(uri, editor);

		const gitUri = uri != null ? await GitUri.fromUri(uri) : undefined;

		const repoPath = await getRepoPathOrActiveOrPrompt(gitUri, editor, 'Copy Current Branch Name');
		if (!repoPath) return;

		try {
			const branch = await Container.git.getBranch(repoPath);
			if (branch?.name) {
				await env.clipboard.writeText(branch.name);
			}
		} catch (ex) {
			Logger.error(ex, 'CopyCurrentBranchCommand');
			void window.showErrorMessage('Unable to copy current branch name. See output channel for more details');
		}
	}
}

'use strict';
import { env, TextEditor, Uri } from 'vscode';
import { ActiveEditorCommand, command, Commands, getCommandUri } from './common';
import { Container } from '../container';

@command()
export class CopyRelativePathCommand extends ActiveEditorCommand {
	constructor() {
		super(Commands.CopyRelativePathToClipboard);
	}
	async execute(editor?: TextEditor, uri?: Uri) {
		uri = getCommandUri(uri, editor);
		const repoPath = await Container.git.getActiveRepoPath(editor);
		let relativePath = '';
		if (uri != null && repoPath != null) {
			const pathSplit = uri.path.split(repoPath);
			if (pathSplit.length > 0) {
				relativePath = pathSplit[pathSplit.length - 1];
			}
		}
		void (await env.clipboard.writeText(relativePath));
		return undefined;
	}
}

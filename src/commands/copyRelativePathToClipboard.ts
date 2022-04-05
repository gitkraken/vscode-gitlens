import { env, TextEditor, Uri } from 'vscode';
import { Commands } from '../constants';
import type { Container } from '../container';
import { command } from '../system/command';
import { ActiveEditorCommand, getCommandUri } from './base';

@command()
export class CopyRelativePathToClipboardCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super(Commands.CopyRelativePathToClipboard);
	}

	async execute(editor?: TextEditor, uri?: Uri) {
		uri = getCommandUri(uri, editor);
		let relativePath = '';
		if (uri != null) {
			const repoPath = this.container.git.getBestRepository(editor)?.uri;
			if (repoPath != null) {
				relativePath = this.container.git.getRelativePath(uri, repoPath);
			}
		}

		void (await env.clipboard.writeText(relativePath));
		return undefined;
	}
}

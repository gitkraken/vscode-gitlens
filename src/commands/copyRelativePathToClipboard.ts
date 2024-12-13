import type { TextEditor, Uri } from 'vscode';
import { env } from 'vscode';
import { GlCommand } from '../constants.commands';
import type { Container } from '../container';
import { command } from '../system/vscode/command';
import type { CommandContext } from './base';
import { ActiveEditorCommand, getCommandUri, isCommandContextViewNodeHasFileCommit } from './base';

@command()
export class CopyRelativePathToClipboardCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super(GlCommand.CopyRelativePathToClipboard);
	}

	protected override preExecute(context: CommandContext) {
		if (isCommandContextViewNodeHasFileCommit(context)) {
			return this.execute(context.editor, context.node.commit.file!.uri);
		}

		return this.execute(context.editor, context.uri);
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

		await env.clipboard.writeText(relativePath);
		return undefined;
	}
}

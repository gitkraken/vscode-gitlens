import type { TextEditor, Uri } from 'vscode';
import { env } from 'vscode';
import type { Container } from '../container';
import { command } from '../system/-webview/command';
import { ActiveEditorCommand } from './commandBase';
import { getCommandUri } from './commandBase.utils';
import type { CommandContext } from './commandContext';
import { isCommandContextViewNodeHasFileCommit } from './commandContext.utils';

@command()
export class CopyRelativePathToClipboardCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super('gitlens.copyRelativePathToClipboard');
	}

	protected override preExecute(context: CommandContext): Promise<void> {
		if (isCommandContextViewNodeHasFileCommit(context)) {
			return this.execute(context.editor, context.node.commit.file!.uri);
		}

		return this.execute(context.editor, context.uri);
	}

	async execute(editor?: TextEditor, uri?: Uri): Promise<void> {
		uri = getCommandUri(uri, editor);
		let relativePath = '';
		if (uri != null) {
			const repoPath = this.container.git.getBestRepository(editor)?.uri;
			if (repoPath != null) {
				relativePath = this.container.git.getRelativePath(uri, repoPath);
			}
		}

		await env.clipboard.writeText(relativePath);
	}
}

import type { TextDocumentShowOptions, Uri } from 'vscode';
import { workspace } from 'vscode';
import { Logger } from '../logger';
import { executeCoreCommand } from './command';

export async function showMarkdownPreview(
	uriOrContent: Uri | string,
	options: TextDocumentShowOptions = {
		preview: false,
	},
): Promise<void> {
	try {
		if (typeof uriOrContent === 'string') {
			const document = await workspace.openTextDocument({ language: 'markdown', content: uriOrContent });

			uriOrContent = document.uri;
		}

		void executeCoreCommand('vscode.openWith', uriOrContent, 'vscode.markdown.preview.editor', options);
	} catch (ex) {
		Logger.error(ex, 'showMarkdownPreview');
		debugger;
	}
}

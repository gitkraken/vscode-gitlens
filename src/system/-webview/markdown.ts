import type { TextDocumentShowOptions, Uri } from 'vscode';
import type { Container } from '../../container.js';
import type { MarkdownContentMetadata } from '../../documents/markdown.js';
import { Logger } from '../logger.js';
import { executeCoreCommand } from './command.js';

export function showMarkdownPreview(
	uriOrContent: Uri | string,
	options: TextDocumentShowOptions = {
		preview: false,
	},
): void {
	try {
		void executeCoreCommand('vscode.openWith', uriOrContent, 'vscode.markdown.preview.editor', options);
	} catch (ex) {
		Logger.error(ex, 'showMarkdownPreview');
		debugger;
	}
}

export function createGLMarkdownDocument(
	container: Container,
	content: string,
	path: string,
	label: string,
	metadata?: MarkdownContentMetadata,
): Uri {
	return container.markdown.openDocument(content, path, label, metadata);
}

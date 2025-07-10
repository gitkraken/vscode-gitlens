import type { TextEditor, Uri } from 'vscode';
import { window } from 'vscode';
import { Schemes } from '../constants';
import type { MarkdownContentMetadata } from '../documents/markdown';
import { decodeGitLensRevisionUriAuthority } from '../git/gitUri.authority';
import { command, executeCommand } from '../system/-webview/command';
import { Logger } from '../system/logger';
import { ActiveEditorCommand } from './commandBase';
import { getCommandUri } from './commandBase.utils';

@command()
export class RegenerateMarkdownDocumentCommand extends ActiveEditorCommand {
	constructor() {
		super('gitlens.regenerateMarkdownDocument');
	}

	async execute(editor?: TextEditor, uri?: Uri): Promise<void> {
		uri = getCommandUri(uri, editor);
		if (uri == null) return;

		// Only work with gitlens-ai-markdown scheme documents
		if (uri.scheme !== Schemes.GitLensAIMarkdown) {
			void window.showErrorMessage('This action can only be used on GitLens AI markdown documents.');
			return;
		}

		// Extract the command from the authority
		const authority = uri.authority;
		if (authority == null || authority.length === 0) {
			void window.showErrorMessage('No regeneration command found for this document.');
			return;
		}

		try {
			const metadata = decodeGitLensRevisionUriAuthority<MarkdownContentMetadata>(authority);

			if (metadata.command == null) {
				void window.showErrorMessage('No regeneration command found for this document.');
				return;
			}

			// Execute the command that was encoded in the authority
			// The openDocument method in the regeneration command will automatically
			// detect content changes and fire the _onDidChange event to refresh the preview
			await executeCommand(metadata.command.name, metadata.command.args);
		} catch (ex) {
			Logger.error(ex, 'RegenerateMarkdownDocumentCommand');
			void window.showErrorMessage('Failed to regenerate document. See output for more details.');
		}
	}
}

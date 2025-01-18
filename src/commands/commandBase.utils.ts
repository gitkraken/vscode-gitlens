import type { TextEditor, Uri } from 'vscode';

export function getCommandUri(uri?: Uri, editor?: TextEditor): Uri | undefined {
	// Always use the editor.uri (if we have one), so we are correct for a split diff
	return editor?.document?.uri ?? uri;
}

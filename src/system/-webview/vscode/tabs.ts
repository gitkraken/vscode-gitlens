import type { Tab } from 'vscode';
import { Uri } from 'vscode';

export function getTabUri(tab: Tab | undefined): Uri | undefined {
	const input = tab?.input;
	if (input == null || typeof input !== 'object') return undefined;

	if ('uri' in input && input.uri instanceof Uri) {
		return input.uri;
	}

	if ('modified' in input && input.modified instanceof Uri) {
		return input.modified;
	}

	return undefined;
}

export function tabContainsUri(tab: Tab | undefined, uri: Uri | undefined): boolean {
	const input = tab?.input;
	if (uri == null || input == null || typeof input !== 'object') return false;

	const uriString = uri.toString();
	if ('uri' in input && input.uri instanceof Uri) {
		return input.uri.toString() === uriString;
	}

	if ('modified' in input && input.modified instanceof Uri) {
		return input.modified.toString() === uriString;
	}

	if ('original' in input && input.original instanceof Uri) {
		return input.original.toString() === uriString;
	}

	return false;
}

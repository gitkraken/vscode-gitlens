import type { Tab } from 'vscode';
import { Uri, window } from 'vscode';
import { uriEquals } from '../../uri';

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

export function getTabUris(
	tab: Tab | undefined,
): { modified: undefined; original?: undefined } | { modified: Uri; original?: Uri | undefined } {
	const input = tab?.input;
	if (input == null || typeof input !== 'object') return { modified: undefined };

	if ('uri' in input && input.uri instanceof Uri) {
		return { modified: input.uri };
	}

	if ('modified' in input && input.modified instanceof Uri) {
		if ('original' in input && input.original instanceof Uri) {
			return { modified: input.modified, original: input.original };
		}
		return { modified: input.modified };
	}

	return { modified: undefined };
}

export function getVisibleTabs(uri: Uri): Tab[] {
	return window.tabGroups.all
		.flatMap(g => g.tabs)
		.filter(t => t.isActive && tabContainsUri(t, uri))
		.sort((a, b) => (a.group.isActive ? -1 : 1) - (b.group.isActive ? -1 : 1));
}

export function tabContainsUri(tab: Tab | undefined, uri: Uri | undefined): boolean {
	if (uri == null) return false;

	const input = tab?.input;
	if (input == null || typeof input !== 'object') return false;

	function equals(uri: Uri, inputUri: unknown): boolean {
		return inputUri instanceof Uri && uriEquals(uri, inputUri);
	}

	return (
		('uri' in input && equals(uri, input.uri)) ||
		('modified' in input && equals(uri, input.modified)) ||
		('original' in input && equals(uri, input.original))
	);
}

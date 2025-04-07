import type { Uri } from 'vscode';

export function uriEquals(a: Uri | undefined, b: Uri | undefined): boolean {
	if (a === b) return true;
	if (a == null || b == null) return false;

	return a.toString() === b.toString();
}

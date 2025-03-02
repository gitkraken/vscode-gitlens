import type { Uri } from 'vscode';

export function uriEquals(lhs: Uri | undefined, rhs: Uri | undefined): boolean {
	if (lhs === rhs) return true;
	if (lhs == null || rhs == null) return false;

	return lhs.toString() === rhs.toString();
}

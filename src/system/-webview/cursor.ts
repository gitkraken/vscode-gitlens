import { env } from 'vscode';

/**
 * Checks if the current IDE is Cursor
 * @returns true if the current IDE is Cursor, false otherwise
 */
export function isCursor(): boolean {
	return env.appName === 'Cursor';
}

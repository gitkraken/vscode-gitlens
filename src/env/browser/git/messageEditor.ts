import type { Container } from '../../../container.js';

/**
 * Browser stub. Automatic rebase isn't available in VS Code Web (the conflict-tools integration
 * gates it off), so there's never a run to supply a message editor for — callers fall back to a
 * headless `true` editor when this returns `undefined`.
 */
export function getAutoRebaseMessageEditor(
	_container: Container,
): Promise<{ editor: string; env: Record<string, string> } | undefined> {
	return Promise.resolve(undefined);
}

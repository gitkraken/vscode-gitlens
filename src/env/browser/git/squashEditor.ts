import type { Container } from '../../../container.js';

/**
 * Browser stub. The headless squash/drop/reword relies on running `git rebase` with a Node
 * sequence-editor, which isn't available in VS Code Web. The graph actions are gated off in virtual
 * workspaces, so this is never reached — it throws defensively if it ever is.
 */
export function getSquashSequenceEditor(_container: Container): { editor: string; env: Record<string, string> } {
	throw new Error('Squashing commits is not supported in this environment');
}

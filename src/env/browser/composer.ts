import type { Container } from '../../container.js';
import type { ComposeToolsIntegration } from '../../plus/composer/composeToolsIntegration.js';

/**
 * Browser stub for the compose-tools integration.
 *
 * `@gitkraken/compose-tools` is Node-only (transitive `node:*` imports).
 * Returning `undefined` here lets the webview provider skip the library route
 * in VS Code Web — the legacy `aiActions.generateCommits` path handles it.
 */
export function createComposeToolsIntegration(_container: Container): ComposeToolsIntegration | undefined {
	return undefined;
}

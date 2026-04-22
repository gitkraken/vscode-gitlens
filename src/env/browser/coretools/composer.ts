import type { Container } from '../../../container.js';
import type { ComposerComposeIntegration } from '../../../webviews/plus/composer/compose/integration.js';
import type { GraphComposeIntegration } from '../../../webviews/plus/graph/compose/integration.js';

/**
 * Browser stub for the compose-tools integrations.
 *
 * `@gitkraken/compose-tools` is Node-only (transitive `node:*` imports).
 * Returning `undefined` here lets the webview providers skip the library route
 * in VS Code Web — the legacy `aiActions.generateCommits` path handles the
 * composer webview; the graph compose panel is gated off entirely.
 */
export function createComposerComposeIntegration(_container: Container): ComposerComposeIntegration | undefined {
	return undefined;
}

export function createGraphComposeIntegration(_container: Container): GraphComposeIntegration | undefined {
	return undefined;
}

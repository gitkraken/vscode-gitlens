import type { Container } from '../../../container.js';
import type { GraphComposeIntegration } from '../../../webviews/plus/graph/compose/integration.js';

/**
 * Browser stub for the compose-tools integration.
 *
 * `@gitkraken/compose-tools` is Node-only (transitive `node:*` imports).
 * Returning `undefined` here lets the graph compose panel gate itself off
 * entirely in VS Code Web.
 */
export function createGraphComposeIntegration(_container: Container): GraphComposeIntegration | undefined {
	return undefined;
}

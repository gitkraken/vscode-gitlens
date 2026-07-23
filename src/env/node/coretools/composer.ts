import type { Container } from '../../../container.js';
import { GraphComposeIntegration } from '../../../webviews/plus/graph/compose/integration.js';

/**
 * Node-only factory for the compose-tools integration.
 *
 * Lives under `@env/coretools/composer.js` so the webworker build resolves to
 * the browser stub instead — `@gitkraken/compose-tools` transitively imports
 * `node:child_process`, `node:fs`, `node:os`, `node:path`, and `node:crypto`,
 * none of which webpack's worker target can resolve.
 */
export function createGraphComposeIntegration(container: Container): GraphComposeIntegration | undefined {
	return new GraphComposeIntegration(container);
}

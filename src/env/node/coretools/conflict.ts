import type { Container } from '../../../container.js';
import { ConflictToolsIntegration } from '../../../plus/coretools/conflict/integration.js';

/**
 * Node-only factory for the conflict-tools integration.
 *
 * Lives under `@env/coretools/conflict.js` so the webworker build resolves to the browser stub
 * instead — `@gitkraken/conflict-tools` transitively imports `node:*` modules that webpack's
 * worker target can't resolve, and conflict resolution operates on the working tree, which only
 * exists in the desktop (Node) environment.
 */
export function createConflictToolsIntegration(container: Container): ConflictToolsIntegration | undefined {
	return new ConflictToolsIntegration(container);
}

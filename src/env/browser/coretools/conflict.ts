import type { Container } from '../../../container.js';
import type { ConflictToolsIntegration } from '../../../plus/coretools/conflict/integration.js';

/**
 * Browser stub for the conflict-tools integration.
 *
 * `@gitkraken/conflict-tools` is Node-only (transitive `node:*` imports) and conflict resolution
 * operates on the working tree, which doesn't exist in VS Code Web. Returning `undefined` lets
 * callers gate the feature off entirely in the webworker environment.
 */
export function createConflictToolsIntegration(_container: Container): ConflictToolsIntegration | undefined {
	return undefined;
}

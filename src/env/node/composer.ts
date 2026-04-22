import type { Container } from '../../container.js';
import { ComposeToolsIntegration } from '../../plus/composer/composeToolsIntegration.js';

/**
 * Node-only factory for the compose-tools integration.
 *
 * Lives under `@env/composer.js` so the webworker build resolves to the
 * browser stub instead — `@gitkraken/compose-tools` transitively imports
 * `node:child_process`, `node:fs`, `node:os`, `node:path`, and `node:crypto`,
 * none of which webpack's worker target can resolve.
 */
export function createComposeToolsIntegration(container: Container): ComposeToolsIntegration | undefined {
	return new ComposeToolsIntegration(container);
}

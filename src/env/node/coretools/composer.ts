import type { Container } from '../../../container.js';
import { ComposerComposeIntegration } from '../../../webviews/plus/composer/compose/integration.js';
import { GraphComposeIntegration } from '../../../webviews/plus/graph/compose/integration.js';

/**
 * Node-only factories for the compose-tools integrations.
 *
 * Lives under `@env/coretools/composer.js` so the webworker build resolves to
 * the browser stub instead — `@gitkraken/compose-tools` transitively imports
 * `node:child_process`, `node:fs`, `node:os`, `node:path`, and `node:crypto`,
 * none of which webpack's worker target can resolve.
 *
 * Two factories — one per consumer — so each webview gets a type narrowed to
 * the integration that actually exposes the methods it calls.
 */
export function createComposerComposeIntegration(container: Container): ComposerComposeIntegration | undefined {
	return new ComposerComposeIntegration(container);
}

export function createGraphComposeIntegration(container: Container): GraphComposeIntegration | undefined {
	return new GraphComposeIntegration(container);
}

import type { Container } from '../../../container.js';
import { ConflictToolsIntegration } from '../../../plus/coretools/conflict/integration.js';

export function createConflictToolsIntegration(container: Container): ConflictToolsIntegration | undefined {
	return new ConflictToolsIntegration(container);
}

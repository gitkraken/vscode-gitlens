import '@gitlens/components/components/codeIcon.js';
import '@gitlens/components/components/overlays/popover.js';
import '@gitlens/components/components/overlays/tooltip.js';
import { GlCommitGraph } from './graph.js';

export const commitGraphElementName = 'gl-commit-graph';

/** Explicit and idempotent: helper/type imports never define the graph element. */
export function registerCommitGraphElements(registry: CustomElementRegistry = customElements): void {
	if (registry.get(commitGraphElementName) == null) {
		registry.define(commitGraphElementName, GlCommitGraph);
	}
}

import type { GraphDisplayMode } from '../../../plus/graph/protocol.js';
import type { graphStateContext } from './context.js';

/** Resolves the effective {@link GraphDisplayMode} after gating raw `displayMode === 'kanban'`
 *  against the experimental config flag. The persisted raw value can survive across the user
 *  disabling `gitlens.graph.experimental.kanban.enabled`; consumers that drive what the user
 *  actually sees (body content, search-box inert state, sidebar toggle highlight, host-side mode
 *  notifications) MUST resolve through this helper so they stay coherent. Consumers that
 *  legitimately need the raw persisted value (mode-leave cleanup that compares against the prior
 *  raw write, the close-button-resets-displayMode-to-graph path) can still read
 *  `graphState.displayMode` directly. */
export function getEffectiveDisplayMode(graphState: typeof graphStateContext.__context__): GraphDisplayMode {
	const raw: GraphDisplayMode = graphState.displayMode ?? 'graph';
	if (raw === 'kanban' && graphState.config?.experimentalKanbanEnabled !== true) {
		return 'graph';
	}
	return raw;
}

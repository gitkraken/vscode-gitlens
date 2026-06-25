import { createContext } from '@lit/context';
import type { Signal } from '@lit-labs/signals';
import { signal as litSignal } from '@lit-labs/signals';
import type { LaunchpadSummaryResult } from '../../../../plus/launchpad/launchpadIndicator.js';

/** Shared Launchpad summary state for the Graph webview. The fetch + `onLaunchpadChanged`
 *  subscription are owned by `gl-graph-app` (the common ancestor); both the header's Launchpad
 *  indicator and the WIP details "empty pane" read the SAME instance so there is a single fetch
 *  and a single source of truth. Provided via {@link graphLaunchpadContext}.
 *
 *  Note: `connected` lives here (derived by the owner from `integrations.getIntegrationStates()`)
 *  so the always-visible header indicator can show its not-connected state without depending on
 *  the details panel's own `hasIntegrationsConnected` signal — that one stays in `detailsState`
 *  for its other (compare/multi-commit) consumers. */
export interface GraphLaunchpadState {
	readonly summary: Signal.State<LaunchpadSummaryResult | { error: Error } | undefined>;
	readonly loading: Signal.State<boolean>;
	/** `undefined` until the first integration-state probe resolves; then `true`/`false`. */
	readonly connected: Signal.State<boolean | undefined>;
	/** Force an immediate refetch (manual refresh button). Assigned by `gl-graph-app`, the owner
	 *  of the fetch; a no-op until then. */
	refresh: () => void;
}

export function createGraphLaunchpadState(): GraphLaunchpadState {
	return {
		summary: litSignal<LaunchpadSummaryResult | { error: Error } | undefined>(undefined),
		loading: litSignal(false),
		connected: litSignal<boolean | undefined>(undefined),
		refresh: () => {},
	};
}

export const graphLaunchpadContext = createContext<GraphLaunchpadState>('graph-launchpad-context');

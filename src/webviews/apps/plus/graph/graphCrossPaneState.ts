import { createContext } from '@lit/context';
import type { Signal } from '@lit-labs/signals';
import { signal as litSignal } from '@lit-labs/signals';
import type { AnchorKey } from './components/anchorKey.js';
import type { RunningOperationBucket } from './components/detailsState.js';

/** Per-anchor memory of the last-active review/compose mode. Lets a return to a previously-
 *  visited anchor restore the mode the user was in (e.g. switching away from a WIP row in
 *  Compose, then back, lands in Compose again instead of the default WIP view). User-explicit
 *  close (X / toggle-off / destroy / Cancel) forgets; anchor navigation preserves. Compare is
 *  excluded — it's already sticky/entry-time anchored, so per-anchor memory doesn't apply. */
export type RememberedMode = 'review' | 'compose' | 'resolve';

/** Signals that originate in one pane of the Graph webview but need to be observable by
 *  another. Provided by `gl-graph-app` (the common ancestor); written by the details-panel
 *  workflow controller and read by the graph row component for adornments. The bucket map
 *  lets a single anchor hold both a running review AND a running compose simultaneously. */
export interface GraphCrossPaneState {
	readonly runningOperations: Signal.State<ReadonlyMap<AnchorKey, RunningOperationBucket>>;
	readonly lastModeByAnchor: Signal.State<ReadonlyMap<AnchorKey, RememberedMode>>;
}

export function createGraphCrossPaneState(): GraphCrossPaneState {
	return {
		runningOperations: litSignal<ReadonlyMap<AnchorKey, RunningOperationBucket>>(new Map()),
		lastModeByAnchor: litSignal<ReadonlyMap<AnchorKey, RememberedMode>>(new Map()),
	};
}

/** Abort every in-flight AI run and clear the registry. Shared by `gl-graph-app` teardown and the
 *  controller's repo-switch reset; clearing avoids stranding a `'generating'` entry behind an aborted run. */
export function abortRunningOperations(state: GraphCrossPaneState): void {
	const current = state.runningOperations.get();
	for (const bucket of current.values()) {
		bucket.review?.abortController?.abort();
		bucket.compose?.abortController?.abort();
		bucket.generateMessage?.abortController?.abort();
	}
	if (current.size > 0) {
		state.runningOperations.set(new Map());
	}
}

export const graphCrossPaneContext = createContext<GraphCrossPaneState>('graph-cross-pane-context');

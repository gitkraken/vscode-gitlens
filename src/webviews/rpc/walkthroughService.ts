/**
 * Standalone Walkthrough progress RPC service.
 *
 * This is independent of any specific webview — any webview embedding
 * a walkthrough progress display can compose this service into its service interface.
 */

import type {
	GraphWalkthroughContextKeys,
	GraphWalkthroughProgress,
	WalkthroughContextKeys,
	WalkthroughProgress,
} from '../../constants.walkthroughs.js';
import type { Container } from '../../container.js';
import type { EventVisibilityBuffer, SubscriptionTracker } from './eventVisibilityBuffer.js';
import { createRpcEventSubscription } from './eventVisibilityBuffer.js';
import type { RpcEventSubscription } from './services/types.js';

/**
 * Combined progress of both walkthroughs — the host fires a single change event covering both,
 * so one payload keeps consumers to one subscription.
 */
export interface WalkthroughProgressPayload {
	readonly main: WalkthroughProgress;
	readonly graph: GraphWalkthroughProgress;
}

/**
 * The RPC-facing surface of {@link WalkthroughService} — the shape webviews compose into
 * their services interface (the class also carries private host-only state). Any webview
 * embedding a walkthrough progress display can reference this.
 */
export interface WalkthroughProgressService {
	readonly onProgressChanged: RpcEventSubscription<WalkthroughProgressPayload>;
	getProgress(): Promise<WalkthroughProgressPayload | undefined>;
}

export class WalkthroughService implements WalkthroughProgressService {
	readonly #container: Container;

	/**
	 * Fired when either the main (7-step) or graph (6-step) walkthrough's progress changes.
	 */
	readonly onProgressChanged: RpcEventSubscription<WalkthroughProgressPayload>;

	constructor(container: Container, buffer: EventVisibilityBuffer | undefined, tracker?: SubscriptionTracker) {
		this.#container = container;

		this.onProgressChanged = createRpcEventSubscription<WalkthroughProgressPayload>(
			buffer,
			'walkthroughProgress',
			'save-last',
			buffered => container.walkthrough.onDidChangeProgress(() => buffered(this.getProgressState())),
			undefined,
			tracker,
		);
	}

	/**
	 * Get current progress of both the main (7-step) and graph (6-step) walkthroughs.
	 */
	getProgress(): Promise<WalkthroughProgressPayload | undefined> {
		return Promise.resolve(this.getProgressState());
	}

	private getProgressState(): WalkthroughProgressPayload {
		const walkthrough = this.#container.walkthrough;
		return {
			main: {
				allCount: walkthrough.walkthroughSize,
				doneCount: walkthrough.doneCount,
				progress: walkthrough.progress,
				state: Object.fromEntries(walkthrough.getState()) as Record<WalkthroughContextKeys, boolean>,
			},
			graph: {
				allCount: walkthrough.graphWalkthroughSize,
				doneCount: walkthrough.graphDoneCount,
				progress: walkthrough.graphProgress,
				state: Object.fromEntries(walkthrough.getGraphState()) as Record<GraphWalkthroughContextKeys, boolean>,
			},
		};
	}
}

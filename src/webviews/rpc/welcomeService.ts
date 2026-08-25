/**
 * Standalone Welcome RPC service.
 *
 * Carries the two host→webview events that fire when an already-loaded Welcome
 * webview is shown again — switching the active walkthrough mode and focusing
 * it — so the surface needs no legacy IPC notifications of its own.
 */

import type { WalkthroughMode } from '../welcome/protocol.js';
import type { EventVisibilityBuffer, SubscriptionTracker } from './eventVisibilityBuffer.js';
import { createRpcEvent } from './eventVisibilityBuffer.js';
import type { SharedWebviewServices } from './services/common.js';
import type { RpcEventSubscription } from './services/types.js';
import type { WalkthroughProgressService } from './walkthroughService.js';

/**
 * The RPC-facing surface of {@link WelcomeService} — the shape the Welcome webview composes
 * into its services interface (the class carries only private fire methods).
 */
export interface WelcomeViewService {
	/** Fired when an already-loaded Welcome webview is shown again with a walkthrough mode arg. */
	readonly onDidSwitchWalkthroughMode: RpcEventSubscription<{ mode: WalkthroughMode }>;
	/** Fired when an already-loaded Welcome webview is shown again — focuses the active walkthrough. */
	readonly onDidFocusWalkthrough: RpcEventSubscription<void>;
}

/** RPC services for the Welcome webview. */
export interface WelcomeServices extends SharedWebviewServices {
	/** Progress of both Get Started walkthroughs. */
	readonly walkthrough: WalkthroughProgressService;
	readonly welcome: WelcomeViewService;
}

export class WelcomeService implements WelcomeViewService {
	readonly onDidSwitchWalkthroughMode: RpcEventSubscription<{ mode: WalkthroughMode }>;

	readonly onDidFocusWalkthrough: RpcEventSubscription<void>;

	readonly #didSwitchWalkthroughMode = createRpcEvent<{ mode: WalkthroughMode }>(
		'walkthroughModeSwitched',
		'save-last',
	);
	readonly #didFocusWalkthrough = createRpcEvent<void>('walkthroughFocused', 'save-last');

	constructor(buffer: EventVisibilityBuffer | undefined, tracker?: SubscriptionTracker) {
		this.onDidSwitchWalkthroughMode = this.#didSwitchWalkthroughMode.subscribe(buffer, tracker);
		this.onDidFocusWalkthrough = this.#didFocusWalkthrough.subscribe(buffer, tracker);
	}

	fireDidSwitchWalkthroughMode(mode: WalkthroughMode): void {
		this.#didSwitchWalkthroughMode.fire({ mode: mode });
	}

	fireDidFocusWalkthrough(): void {
		this.#didFocusWalkthrough.fire(undefined);
	}
}

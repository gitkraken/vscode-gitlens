/**
 * Onboarding service — centralized dismissible/onboarding UI state for webviews.
 *
 * Provides methods to check, dismiss, and reset onboarding items,
 * plus an event subscription for state changes. Any webview that needs
 * to show or hide dismissible UI (banners, walkthroughs, onboarding flows)
 * can use this shared service.
 */

import type { OnboardingItemState, OnboardingKeys } from '../../../constants.onboarding.js';
import type { Container } from '../../../container.js';
import type { OnboardingChangeEvent } from '../../../onboarding/onboardingService.js';
import type { EventVisibilityBuffer, SubscriptionTracker } from '../eventVisibilityBuffer.js';
import { createRpcEventSubscription } from '../eventVisibilityBuffer.js';
import type { RpcEventSubscription } from './types.js';

export class OnboardingRpcService {
	readonly #container: Container;

	/** Fired when any onboarding item is dismissed or re-shown. */
	readonly onDidChange: RpcEventSubscription<OnboardingChangeEvent>;

	constructor(container: Container, buffer: EventVisibilityBuffer | undefined, tracker?: SubscriptionTracker) {
		this.#container = container;

		this.onDidChange = createRpcEventSubscription<OnboardingChangeEvent>(
			buffer,
			'onboardingChanged',
			'save-last',
			buffered => container.onboarding.onDidChange(e => buffered(e)),
			undefined,
			tracker,
		);
	}

	/** Check if an onboarding item is dismissed (respects reshowAfter logic). */
	isDismissed(key: OnboardingKeys): boolean {
		return this.#container.onboarding.isDismissed(key);
	}

	/** Dismiss an onboarding item. */
	async dismiss(key: OnboardingKeys): Promise<void> {
		await this.#container.onboarding.dismiss(key);
	}

	/** Get typed state for an item (runs schema migrations if needed). */
	getItemState<T extends OnboardingKeys>(key: T): OnboardingItemState<T> | undefined {
		return this.#container.onboarding.getItemState(key);
	}

	/** Set typed state for an item. */
	async setItemState<T extends OnboardingKeys>(key: T, state: OnboardingItemState<T>): Promise<void> {
		await this.#container.onboarding.setItemState(key, state);
	}

	/** Reset a specific onboarding item. */
	async reset(key: OnboardingKeys): Promise<void> {
		await this.#container.onboarding.reset(key);
	}

	/** Reset all onboarding state. */
	async resetAll(): Promise<void> {
		await this.#container.onboarding.resetAll();
	}
}

/**
 * Subscription service — GitKraken subscription state and change events.
 *
 * Exposes both event subscribers (for side-effect-driven consumers) and
 * `Signal.State` properties (for reactive bridging via Supertalk's SignalHandler).
 * The signals are the canonical host-side mirrors of Container state — portable
 * across all webviews that use this shared service.
 */

import { Signal } from 'signal-polyfill';
import { getAvatarUriFromGravatarEmail } from '../../../avatars.js';
import type { Container } from '../../../container.js';
import type { Subscription } from '../../../plus/gk/models/subscription.js';
import { getContext, onDidChangeContext } from '../../../system/-webview/context.js';
import { serialize } from '../../../system/serialize.js';
import type { EventVisibilityBuffer, SubscriptionTracker } from '../eventVisibilityBuffer.js';
import { createEventSubscription } from '../eventVisibilityBuffer.js';
import type { EventSubscriber, OrgSettings } from './types.js';

export class WebviewSubscriptionService {
	readonly #container: Container;

	// ── Reactive signals (auto-synced to webview via SignalHandler) ──

	/**
	 * Current subscription state as a reactive signal.
	 * Starts `undefined` and is set asynchronously during construction.
	 * By the time the webview connects (deferred handshake), the value is available.
	 */
	readonly subscriptionState = new Signal.State<Subscription | undefined>(undefined);

	/**
	 * Whether the user has a GitKraken account (signed in).
	 * Derived from `subscriptionState` — updated in sync with it.
	 */
	readonly hasAccountState = new Signal.State<boolean>(false);

	/**
	 * User avatar URL (Gravatar derived from account email).
	 * Derived from `subscriptionState` — updated in sync with it.
	 */
	readonly avatarState = new Signal.State<string | undefined>(undefined);

	/**
	 * Number of organizations the current user belongs to.
	 * Re-fetched when subscription changes (org membership can change with account changes).
	 */
	readonly organizationsCountState = new Signal.State<number>(0);

	/**
	 * Organization settings as a reactive signal.
	 * Initialized synchronously from extension context.
	 */
	readonly orgSettingsState: Signal.State<OrgSettings>;

	// ── Event subscribers (for side-effect-driven consumers) ──

	/**
	 * Fired when subscription state changes.
	 * Includes the current subscription — derive `hasAccount` from
	 * `subscription.account != null`.
	 */
	readonly onSubscriptionChanged: EventSubscriber<Subscription>;

	/**
	 * Fired when organization settings change (AI enabled, drafts enabled).
	 */
	readonly onOrgSettingsChanged: EventSubscriber<OrgSettings>;

	constructor(container: Container, buffer: EventVisibilityBuffer | undefined, tracker?: SubscriptionTracker) {
		this.#container = container;

		// Initialize orgSettings synchronously from context
		this.orgSettingsState = new Signal.State<OrgSettings>({
			ai: getContext('gitlens:gk:organization:ai:enabled', false),
			drafts: getContext('gitlens:gk:organization:drafts:enabled', false),
		});

		// Initialize subscription asynchronously — resolves before webview connects
		void container.subscription.getSubscription().then(sub => {
			const serialized = serialize(sub);
			this.subscriptionState.set(serialized);
			this.#updateDerivedState(serialized);
		});

		this.onSubscriptionChanged = createEventSubscription<Subscription>(
			buffer,
			'subscriptionChanged',
			'save-last',
			buffered =>
				container.subscription.onDidChange(e => {
					const serialized = serialize(e.current);
					this.subscriptionState.set(serialized);
					this.#updateDerivedState(serialized);
					buffered(serialized);
				}),
			undefined,
			tracker,
		);

		this.onOrgSettingsChanged = createEventSubscription<OrgSettings>(
			buffer,
			'orgSettingsChanged',
			'save-last',
			buffered =>
				onDidChangeContext(key => {
					if (
						key === 'gitlens:gk:organization:ai:enabled' ||
						key === 'gitlens:gk:organization:drafts:enabled'
					) {
						const settings: OrgSettings = {
							ai: getContext('gitlens:gk:organization:ai:enabled', false),
							drafts: getContext('gitlens:gk:organization:drafts:enabled', false),
						};
						this.orgSettingsState.set(settings);
						buffered(settings);
					}
				}),
			undefined,
			tracker,
		);
	}

	/**
	 * Update all subscription-derived signals from a (serialized) subscription.
	 */
	#updateDerivedState(sub: Subscription): void {
		this.hasAccountState.set(sub.account != null);
		this.avatarState.set(
			sub.account?.email != null ? getAvatarUriFromGravatarEmail(sub.account.email, 34).toString() : undefined,
		);
		// Orgs count may change with subscription changes (org membership tied to account)
		void this.#container.organizations.getOrganizations().then(orgs => {
			this.organizationsCountState.set(orgs?.length ?? 0);
		});
	}

	/**
	 * Get current subscription state.
	 */
	async getSubscription(): Promise<Subscription> {
		const sub = await this.#container.subscription.getSubscription();
		return serialize(sub);
	}

	/**
	 * Check if a feature is available.
	 */
	async isFeatureEnabled(_feature: string): Promise<boolean> {
		// Check if user has an active paid subscription
		const sub = await this.#container.subscription.getSubscription();
		return sub.account?.verified === true && sub.plan.effective.id !== 'community';
	}

	/**
	 * Get the avatar URL for the current user.
	 * Returns a Gravatar URL derived from the account email, or undefined if no account.
	 */
	async getAvatar(): Promise<string | undefined> {
		const sub = await this.#container.subscription.getSubscription();
		if (sub.account?.email) {
			return getAvatarUriFromGravatarEmail(sub.account.email, 34).toString();
		}
		return undefined;
	}

	/**
	 * Get the number of organizations the current user belongs to.
	 */
	async getOrganizationsCount(): Promise<number> {
		const orgs = await this.#container.organizations.getOrganizations();
		return orgs?.length ?? 0;
	}

	/**
	 * Check if the user has a GitKraken account (signed in).
	 */
	async hasAccount(): Promise<boolean> {
		const sub = await this.#container.subscription.getSubscription();
		return sub.account != null;
	}

	/**
	 * Get organization settings (AI enabled, drafts enabled).
	 */
	getOrgSettings(): Promise<OrgSettings> {
		return Promise.resolve({
			ai: getContext('gitlens:gk:organization:ai:enabled', false),
			drafts: getContext('gitlens:gk:organization:drafts:enabled', false),
		} satisfies OrgSettings);
	}
}

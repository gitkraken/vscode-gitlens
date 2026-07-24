/**
 * Subscription service — GitKraken subscription state and change events.
 *
 * Exposes event subscribers (for side-effect-driven consumers) and `Signal.State` properties
 * (reactive bridges via Supertalk's SignalHandler). Signal freshness is structural: a single eager
 * listener per source (registered in the constructor) both updates the signal and fires the RPC
 * event — so bridged signals stay fresh even for webviews that read without subscribing (#5513).
 * Released via `dispose()` (`disposeServices`) at webview teardown.
 */

import { Signal } from 'signal-polyfill';
import { Disposable } from 'vscode';
import { getAvatarUriFromGravatarEmail } from '../../../avatars.js';
import type { Container } from '../../../container.js';
import type { Subscription } from '../../../plus/gk/models/subscription.js';
import { getContext, onDidChangeContext } from '../../../system/-webview/context.js';
import { serialize } from '../../../system/serialize.js';
import type { EventVisibilityBuffer, SubscriptionTracker } from '../eventVisibilityBuffer.js';
import { createRpcEvent } from '../eventVisibilityBuffer.js';
import type { OrgSettings, RpcEventSubscription } from './types.js';

export class SubscriptionService implements Disposable {
	readonly #container: Container;
	readonly #disposable: Disposable;
	#orgsFetchSeq = 0;

	/**
	 * Current subscription state as a reactive signal.
	 * Starts `undefined`; set asynchronously during construction, before the webview connects.
	 */
	readonly subscriptionState = new Signal.State<Subscription | undefined>(undefined);

	/** Whether the user has a GitKraken account (signed in). Derived from `subscriptionState`. */
	readonly hasAccountState = new Signal.State<boolean>(false);

	/** User avatar URL (Gravatar from account email). Derived from `subscriptionState`. */
	readonly avatarState = new Signal.State<string | undefined>(undefined);

	/** Number of organizations the current user belongs to. Re-fetched when subscription changes. */
	readonly organizationsCountState = new Signal.State<number>(0);

	/** Organization settings. Initialized synchronously from extension context. */
	readonly orgSettingsState: Signal.State<OrgSettings>;

	/** Fired when subscription state changes. Derive `hasAccount` from `subscription.account != null`. */
	readonly onSubscriptionChanged: RpcEventSubscription<Subscription>;

	/** Fired when organization settings change (AI enabled, drafts enabled). */
	readonly onOrgSettingsChanged: RpcEventSubscription<OrgSettings>;

	constructor(container: Container, buffer: EventVisibilityBuffer | undefined, tracker?: SubscriptionTracker) {
		this.#container = container;

		this.orgSettingsState = new Signal.State<OrgSettings>(this.#readOrgSettings());

		const subscriptionChanged = createRpcEvent<Subscription>('subscriptionChanged', 'save-last');
		const orgSettingsChanged = createRpcEvent<OrgSettings>('orgSettingsChanged', 'save-last');
		this.onSubscriptionChanged = subscriptionChanged.subscribe(buffer, tracker);
		this.onOrgSettingsChanged = orgSettingsChanged.subscribe(buffer, tracker);

		// One eager listener per source keeps the signal fresh AND fires the RPC event — see class doc (#5513).
		// Outlives `tracker.reset()` (RPC reconnection) by design; released by `dispose()` at teardown.
		this.#disposable = Disposable.from(
			container.subscription.onDidChange(e => {
				const serialized = serialize(e.current);
				this.subscriptionState.set(serialized);
				this.#updateDerivedState(serialized);
				subscriptionChanged.fire(serialized);
			}),
			onDidChangeContext(key => {
				if (key === 'gitlens:gk:organization:ai:enabled' || key === 'gitlens:gk:organization:drafts:enabled') {
					const settings = this.#readOrgSettings();
					this.orgSettingsState.set(settings);
					orgSettingsChanged.fire(settings);
				}
			}),
		);

		// Seed asynchronously — resolves before the webview connects. If a change event already
		// populated the signal, keep it (the event's state is at least as fresh as this snapshot).
		void container.subscription.getSubscription().then(sub => {
			if (this.subscriptionState.get() !== undefined) return;

			const serialized = serialize(sub);
			this.subscriptionState.set(serialized);
			this.#updateDerivedState(serialized);
		});
	}

	dispose(): void {
		this.#disposable.dispose();
	}

	/** Update all subscription-derived signals from a (serialized) subscription. */
	#updateDerivedState(sub: Subscription): void {
		this.hasAccountState.set(sub.account != null);
		this.avatarState.set(
			sub.account?.email != null ? getAvatarUriFromGravatarEmail(sub.account.email, 34).toString() : undefined,
		);
		// Orgs count may change with subscription changes (org membership tied to account).
		// `getOrganizations` is `@gate()`d, so a later change's callback can receive an earlier change's
		// gated result — drop stale answers by only applying the latest fetch's result.
		const seq = ++this.#orgsFetchSeq;
		void this.#container.organizations.getOrganizations().then(orgs => {
			if (seq !== this.#orgsFetchSeq) return;

			this.organizationsCountState.set(orgs?.length ?? 0);
		});
	}

	/** Read current organization settings (AI enabled, drafts enabled) from extension context. */
	#readOrgSettings(): OrgSettings {
		return {
			ai: getContext('gitlens:gk:organization:ai:enabled', false),
			drafts: getContext('gitlens:gk:organization:drafts:enabled', false),
		};
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
		return Promise.resolve(this.#readOrgSettings());
	}
}

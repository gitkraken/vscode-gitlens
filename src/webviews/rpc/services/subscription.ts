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
import type { AiUsageInfo, OrgSettings, RpcEventSubscription } from './types.js';

export class SubscriptionService implements Disposable {
	readonly #container: Container;
	readonly #disposable: Disposable;
	#orgsFetchSeq = 0;
	#usageFetchSeq = 0;

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

	/**
	 * GitKraken AI weekly usage standing. Three distinct states that consumers must keep distinct:
	 * `undefined` = not yet resolved (the seed below is async, so a webview CAN connect before the first
	 * fetch lands); `null` = resolved but unavailable (signed out, an on-premise org, or a failed fetch);
	 * a value = a real allowance. Consumers render the two nullish states differently — a skeleton for
	 * `undefined`, an error row with a Retry for `null` — so collapsing them would either strand a loading
	 * skeleton forever or accuse a slow fetch of having failed.
	 *
	 * Lives on the subscription service rather than `AIService` because the allowance is plan-scoped and
	 * its invalidation trigger is precisely the subscription change this class already observes, and this
	 * class is the established home for host-bridged `Signal.State` with an eager-listener + async-seed
	 * lifecycle. `AIService` has neither a signal nor a subscription listener, so hosting it there would
	 * mean duplicating this whole pattern for one value.
	 */
	readonly aiUsageState = new Signal.State<AiUsageInfo | null | undefined>(undefined);

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
				// The AI allowance doesn't move with every subscription tick — this event also fires on no-op
				// ones like a session refresh, and a forced refetch on each would be a wasted round trip per
				// open webview — so it's filtered out of the derived-state pass above and re-read only when
				// one of its own inputs moved.
				//
				// Those inputs are every input to the allowance's cache key (`${accountId}|${orgId}` in
				// `AIProviderService.getUsage`) plus the plan, which changes the allowance's SIZE under an
				// unchanged key. The organization is easy to miss here: `AIProviderService` filters on
				// account and plan alone when clearing that cache, but it doesn't need the org, because an
				// org switch changes the key and simply misses the old entry. This filter has the opposite
				// job — deciding whether to re-read — so leaving the org out stranded anyone switching
				// between two same-tier orgs on the previous org's allowance and shared-pool split.
				if (
					e.current.account?.id !== e.previous.account?.id ||
					e.current.activeOrganization?.id !== e.previous.activeOrganization?.id ||
					e.current.plan?.actual?.id !== e.previous.plan?.actual?.id
				) {
					this.#updateAiUsageState(serialized, true);
				}

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
			// Unforced, unlike the change path: nothing has invalidated the allowance yet, so a warm entry
			// left by another open webview is exactly the value we want. Forcing here would turn opening a
			// second and third view into two more identical round trips.
			this.#updateAiUsageState(serialized, false);
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

	/**
	 * Refresh `aiUsageState` for a (serialized) subscription. Deliberately NOT part of
	 * `#updateDerivedState` — unlike the signals there, this one is fetched only when the account or plan
	 * actually moved, and with a different cache policy depending on which caller asked (see `force`).
	 */
	#updateAiUsageState(sub: Subscription, force: boolean): void {
		// Same stale-answer guard as the orgs fetch above: a later change's fetch can resolve before an
		// earlier one's, so only the latest sequence is allowed to publish.
		const seq = ++this.#usageFetchSeq;
		// A signed-out user has no allowance to fetch, so resolve synchronously — this is what makes the
		// usage surface disappear on sign-out instead of lingering across a round trip that can only
		// return nothing anyway.
		if (sub.account == null) {
			this.aiUsageState.set(null);
			return;
		}

		// On the change path `force` is load-bearing, not belt-and-braces: `AIProviderService` clears its own
		// usage cache from its own `container.subscription.onDidChange` listener, and listener order between
		// it and this class is NOT guaranteed. Without it, this class running first would read and publish
		// the PRE-change cached allowance. Forcing evicts the entry here, making the read order-independent.
		void this.#container.ai
			.getUsage({ force: force })
			.then(usage => {
				if (seq !== this.#usageFetchSeq) return;

				// Copied field-by-field rather than forwarded, so a future field on the host type doesn't
				// silently widen what crosses the RPC boundary — the nested org pool included.
				this.aiUsageState.set(
					usage != null
						? {
								limit: usage.limit,
								used: usage.used,
								resetsOn: usage.resetsOn,
								organization:
									usage.organization != null
										? { used: usage.organization.used, limit: usage.organization.limit }
										: undefined,
								sharedUsed: usage.sharedUsed,
							}
						: null,
				);
			})
			.catch(() => {
				if (seq !== this.#usageFetchSeq) return;

				// A failure is resolved-but-unavailable, never "still loading" — publish `null` so consumers
				// hide the surface rather than skeletoning forever. Nothing escapes: every caller of this
				// method is fire-and-forget.
				this.aiUsageState.set(null);
			});
	}

	/** Read current organization settings (AI enabled, drafts enabled) from extension context.
	 *  `ai` is fail-open by design: an unset key (no org settings fetched yet, or signed out) must
	 *  read as enabled, matching `AIProviderService` and the org service's own `?? true` default. */
	#readOrgSettings(): OrgSettings {
		return {
			ai: getContext('gitlens:gk:organization:ai:enabled', true),
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

	/**
	 * Re-fetch the AI allowance on request — what the Settings Account card's Retry asks for after the
	 * allowance resolved unavailable. Deliberately a request rather than a webview-side write: the host
	 * stays the single writer of `aiUsageState`, which is what removed the two-writer ordering race
	 * (b76b89b6c). The stale-answer guard inside `#updateAiUsageState` covers a retry racing a
	 * subscription change, so no extra coordination is needed here.
	 */
	refreshAiUsage(): Promise<void> {
		const sub = this.subscriptionState.get();
		// Nothing seeded yet means the constructor's async seed is still in flight and will publish a first
		// value on its own — there's no subscription to retry against, and clearing the signal would only
		// re-announce a loading state that's already true.
		if (sub === undefined) return Promise.resolve();

		// Back to the loading state for the duration of the retry. Without this the card keeps showing the
		// failed state it's retrying out of, so Retry reads as inert until the fetch resolves.
		this.aiUsageState.set(undefined);
		this.#updateAiUsageState(sub, true);

		return Promise.resolve();
	}
}

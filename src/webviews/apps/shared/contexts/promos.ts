import type { Connection, Remote, Subscription } from '@eamodio/supertalk';
import { subscribe } from '@eamodio/supertalk';
import { signal as litSignal } from '@lit-labs/signals';
import { createContext } from '@lit/context';
import { defer } from '@gitlens/utils/promise.js';
import type { Deferred } from '@gitlens/utils/promise.js';
import type { PlansContent } from '../../../../plus/gk/models/plans.js';
import { defaultPlansContent } from '../../../../plus/gk/models/plans.js';
import type { Promo, PromoLocation, PromoPlans } from '../../../../plus/gk/models/promo.js';
import type {
	ApplicablePromoParams,
	ApplicablePromoResponse,
	ApplicablePromoService,
} from '../../../rpc/promosService.js';
import type { SubscriptionService } from '../../../rpc/services/subscription.js';
import type { Disposable } from '../events.js';
import { subscribeAll } from '../events/subscriptions.js';
import type { ReadableSignal } from '../state/signals.js';

/** The promos service as seen over the webview's RPC session (its methods proxied to promises). */
type RemoteApplicablePromoService = Awaited<Remote<{ promos: ApplicablePromoService }>['promos']>;

export class PromosContext implements Disposable {
	private _connection: Connection | undefined;
	private _subscription: Subscription | undefined;

	/** The current RPC session's promos service proxy — re-resolved by the subscription below on
	 * every reconnect handshake, so a dead session's proxy never outlives its replacement. */
	private _service: RemoteApplicablePromoService | undefined;
	/** Fetches made before the first (or between) handshakes wait here; `connect()` wakes them,
	 * mirroring how the legacy IPC request sat pending until the host answered. `disconnect()`
	 * cancels them (consumers surface that as "no promo") and clears the deferred so a stale
	 * one is never reused. */
	private _waitingForService: Deferred<RemoteApplicablePromoService> | undefined;

	private _promos = new Map<
		`${PromoPlans | undefined}|${PromoLocation | undefined}|${boolean}`,
		Promise<Promo | undefined>
	>();

	private readonly _generationSignal = litSignal(0);
	/** Bumped whenever the cache is invalidated. There's no ordering guarantee between the invalidation
	 * event and a subscription signal update — a consumer that re-requested on the latter may have hit
	 * the cache just before it cleared. Keying a memoized promise on this signal as well closes that
	 * race: whichever of the two lands last triggers one more request against the fresh cache. */
	get generation(): ReadableSignal<number> {
		return this._generationSignal;
	}

	private readonly _plansSignal = litSignal<PlansContent>(defaultPlansContent);
	/** Plan marketing copy (AI credit figures, feature bullets) — seeded with the built-in defaults so
	 * first paint is always correct, then replaced once the host's product config resolves. */
	get plans(): ReadableSignal<PlansContent> {
		return this._plansSignal;
	}

	/**
	 * Wire the RPC session whose promos service serves fetches and whose subscription changes
	 * invalidate the promo cache. One-time: the library re-runs the subscription on every
	 * reconnect, so repeat calls from `_onRpcReady` no-op (idempotent for the same connection),
	 * and each handshake re-delivers a fresh session proxy. Surfaces without RPC never connect and
	 * simply never invalidate — the same as before, since a webview only ever received its own
	 * surface's notifications.
	 */
	connect(connection: Connection): void {
		if (this._connection === connection) return;

		this.disconnect();
		this._connection = connection;
		this._subscription = subscribe<{ promos: ApplicablePromoService; subscription: SubscriptionService }>(
			connection,
			async remote => {
				const [promos, subscription] = await Promise.all([remote.promos, remote.subscription]);

				this._service = promos;
				void promos.getPlans().then(
					p => this._plansSignal.set(p),
					() => {},
				);
				this._waitingForService?.fulfill(promos);
				this._waitingForService = undefined;

				return subscribeAll([() => subscription.onSubscriptionChanged(() => this.invalidate())]);
			},
		);
	}

	disconnect(): void {
		this._subscription?.unsubscribe();
		this._subscription = undefined;
		this._connection = undefined;
		this._service = undefined;
		// Settle pre-connect waiters so a fetch issued on a dying mount can't hang forever, and
		// don't cache the dead deferred — the next connect() creates a fresh one. Consumers treat
		// a rejected fetch as "no promo", which is correct for a disconnected surface.
		this._waitingForService?.cancel(new Error('PromosContext disconnected'));
		this._waitingForService = undefined;
	}

	private invalidate(): void {
		this._promos.clear();
		this._generationSignal.set(this._generationSignal.get() + 1);
	}

	async getApplicablePromo(
		plan?: PromoPlans,
		location?: PromoLocation,
		expiringOnly: boolean = false,
	): Promise<Promo | undefined> {
		const cacheKey = `${plan}|${location}|${expiringOnly}` as const;
		let promise = this._promos.get(cacheKey);
		if (promise == null) {
			promise = this.fetch({
				plan: plan,
				location: location,
				expiringOnly: expiringOnly,
			}).then(
				rsp => rsp.promo,
				() => undefined,
			);
			this._promos.set(cacheKey, promise);
		}
		const promo = await promise;
		return promo;
	}

	/** Resolves against the current session's promos service — or, before the first handshake,
	 * waits for `connect()` rather than failing (a request issued during the not-yet-connected
	 * window used to sit pending on the legacy IPC promise machinery until the host answered). */
	private async fetch(params: ApplicablePromoParams): Promise<ApplicablePromoResponse> {
		const service = this._service;
		if (service != null) return service.getApplicablePromo(params);

		this._waitingForService ??= defer<RemoteApplicablePromoService>();
		const pending = this._waitingForService.promise;
		const resolved = await pending;
		return resolved.getApplicablePromo(params);
	}

	dispose(): void {
		this.disconnect();
	}
}

export const promosContext = createContext<PromosContext>('promos');

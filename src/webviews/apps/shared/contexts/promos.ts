import type { Connection, Subscription } from '@eamodio/supertalk';
import { subscribe } from '@eamodio/supertalk';
import { signal as litSignal } from '@lit-labs/signals';
import { createContext } from '@lit/context';
import type { Promo, PromoLocation, PromoPlans } from '../../../../plus/gk/models/promo.js';
import { ApplicablePromoRequest } from '../../../protocol.js';
import type { SubscriptionService } from '../../../rpc/services/subscription.js';
import type { Disposable } from '../events.js';
import { subscribeAll } from '../events/subscriptions.js';
import type { HostIpc } from '../ipc.js';
import type { ReadableSignal } from '../state.js';

export class PromosContext implements Disposable {
	private readonly ipc: HostIpc;

	private _connection: Connection | undefined;
	private _subscription: Subscription | undefined;

	constructor(ipc: HostIpc) {
		this.ipc = ipc;
	}

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

	/**
	 * Wire the subscription service whose changes invalidate the promo cache. One-time: the library
	 * re-runs the subscription on every reconnect, so repeat calls from `_onRpcReady` no-op
	 * (idempotent for the same connection). Surfaces without RPC never connect and simply never
	 * invalidate — the same as before, since a webview only ever received its own surface's
	 * notifications.
	 */
	connect(connection: Connection): void {
		if (this._connection === connection) return;

		this.disconnect();
		this._connection = connection;
		this._subscription = subscribe<{ subscription: SubscriptionService }>(connection, async remote => {
			const subscription = await remote.subscription;
			return subscribeAll([() => subscription.onSubscriptionChanged(() => this.invalidate())]);
		});
	}

	disconnect(): void {
		this._subscription?.unsubscribe();
		this._subscription = undefined;
		this._connection = undefined;
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
			promise = this.ipc
				.sendRequest(ApplicablePromoRequest, {
					plan: plan,
					location: location,
					expiringOnly: expiringOnly,
				})
				.then(
					rsp => rsp.promo,
					() => undefined,
				);
			this._promos.set(cacheKey, promise);
		}
		const promo = await promise;
		return promo;
	}

	dispose(): void {
		this.disconnect();
	}
}

export const promosContext = createContext<PromosContext>('promos');

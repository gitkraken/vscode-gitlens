import type { Remote } from '@eamodio/supertalk';
import { signal as litSignal } from '@lit-labs/signals';
import { createContext } from '@lit/context';
import { Logger } from '@gitlens/utils/logger.js';
import type { Promo, PromoLocation, PromoPlans } from '../../../../plus/gk/models/promo.js';
import { ApplicablePromoRequest } from '../../../protocol.js';
import type { SubscriptionService } from '../../../rpc/services/subscription.js';
import type { Unsubscribe } from '../../../rpc/services/types.js';
import type { Disposable } from '../events.js';
import { subscribeAll } from '../events/subscriptions.js';
import type { HostIpc } from '../ipc.js';
import type { ReadableSignal } from '../state.js';

type SubscriptionRemote = Awaited<Remote<{ subscription: SubscriptionService }>['subscription']>;

export class PromosContext implements Disposable {
	private readonly ipc: HostIpc;

	/** Connection era — bumped by `connect()`/`disconnect()` so a superseded resolution no-ops. */
	private _generation = 0;
	private _unsubscribe: Promise<Unsubscribe> | undefined;

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
	 * Wire (or re-wire after an RPC reconnect) the subscription service whose changes invalidate the
	 * promo cache. Surfaces without RPC never connect and simply never invalidate — the same as
	 * before, since a webview only ever received its own surface's notifications.
	 */
	connect(subscription: SubscriptionRemote | PromiseLike<SubscriptionRemote>): void {
		const gen = ++this._generation;
		void Promise.resolve(subscription).then(
			resolved => {
				// Superseded by a newer connect() or disconnect()
				if (gen !== this._generation) return;

				this.stopListening();
				this._unsubscribe = subscribeAll([() => resolved.onSubscriptionChanged(() => this.invalidate())]);
			},
			(ex: unknown) => Logger.error(ex, 'PromosContext: failed to connect'),
		);
	}

	disconnect(): void {
		this._generation++;
		this.stopListening();
	}

	private stopListening(): void {
		void this._unsubscribe?.then(unsub => {
			if (typeof unsub === 'function') {
				unsub();
			}
		});
		this._unsubscribe = undefined;
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

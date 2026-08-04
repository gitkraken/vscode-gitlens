import { signal as litSignal } from '@lit-labs/signals';
import { createContext } from '@lit/context';
import type { Promo, PromoLocation, PromoPlans } from '../../../../plus/gk/models/promo.js';
import { DidChangeSubscription } from '../../../home/protocol.js';
import { DidChangeSubscriptionNotification } from '../../../plus/graph/protocol.js';
import { DidChangeNotification } from '../../../plus/timeline/protocol.js';
import { ApplicablePromoRequest } from '../../../protocol.js';
import type { Disposable } from '../events.js';
import type { HostIpc } from '../ipc.js';
import type { ReadableSignal } from '../state.js';

export class PromosContext implements Disposable {
	private readonly ipc: HostIpc;
	private readonly disposables: Disposable[] = [];

	constructor(ipc: HostIpc) {
		this.ipc = ipc;
		this.disposables.push(
			this.ipc.onReceiveMessage(msg => {
				if (
					DidChangeSubscription.is(msg) ||
					DidChangeSubscriptionNotification.is(msg) ||
					DidChangeNotification.is(msg)
				) {
					this._promos.clear();
					this._generation.set(this._generation.get() + 1);
				}
			}),
		);
	}

	private _promos = new Map<
		`${PromoPlans | undefined}|${PromoLocation | undefined}|${boolean}`,
		Promise<Promo | undefined>
	>();

	private readonly _generation = litSignal(0);
	/** Bumped whenever the cache is invalidated. There's no ordering guarantee between the invalidation
	 * message and a subscription signal update — a consumer that re-requested on the latter may have hit
	 * the cache just before it cleared. Keying a memoized promise on this signal as well closes that
	 * race: whichever of the two lands last triggers one more request against the fresh cache. */
	get generation(): ReadableSignal<number> {
		return this._generation;
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
		this.disposables.forEach(d => d.dispose());
	}
}

export const promosContext = createContext<PromosContext>('promos');

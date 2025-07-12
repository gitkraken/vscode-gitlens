import { createContext } from '@lit/context';
import type { Promo, PromoLocation, PromoPlans } from '../../../../plus/gk/models/promo';
import { DidChangeSubscription } from '../../../home/protocol';
import { DidChangeSubscriptionNotification } from '../../../plus/graph/protocol';
import { DidChangeNotification } from '../../../plus/timeline/protocol';
import { ApplicablePromoRequest } from '../../../protocol';
import type { Disposable } from '../events';
import type { HostIpc } from '../ipc';

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
				}
			}),
		);
	}

	private _promos = new Map<`${PromoPlans | undefined}|${PromoLocation | undefined}`, Promise<Promo | undefined>>();

	async getApplicablePromo(plan?: PromoPlans, location?: PromoLocation): Promise<Promo | undefined> {
		const cacheKey = `${plan}|${location}` as const;
		let promise = this._promos.get(cacheKey);
		if (promise == null) {
			promise = this.ipc.sendRequest(ApplicablePromoRequest, { plan: plan, location: location }).then(
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

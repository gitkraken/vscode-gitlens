import { createContext } from '@lit/context';
import type { Promo, PromoLocation } from '../../../../plus/gk/models/promo';
import { ApplicablePromoRequest } from '../../../protocol';
import type { Disposable } from '../events';
import type { HostIpc } from '../ipc';

export class PromosContext implements Disposable {
	private readonly ipc: HostIpc;
	private readonly disposables: Disposable[] = [];

	constructor(ipc: HostIpc) {
		this.ipc = ipc;
	}

	private _promos: Map<PromoLocation | undefined, Promise<Promo | undefined>> = new Map();

	async getApplicablePromo(location?: PromoLocation): Promise<Promo | undefined> {
		let promise = this._promos.get(location);
		if (promise == null) {
			promise = this.ipc.sendRequest(ApplicablePromoRequest, { location: location }).then(
				rsp => rsp.promo,
				() => undefined,
			);
			this._promos.set(location, promise);
		}
		const promo = await promise;
		return promo;
	}

	dispose(): void {
		this.disposables.forEach(d => d.dispose());
	}
}

export const promosContext = createContext<PromosContext>('promos');

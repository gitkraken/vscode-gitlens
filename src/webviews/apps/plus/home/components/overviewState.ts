import { createContext } from '@lit/context';
import { signal } from '@lit-labs/signals';
import { SignalArray } from 'signal-utils/array';
import type { GetOverviewResponse } from '../../../../home/protocol';
import { DidChangeRepositoryWip, GetOverview, GetOverviewFilterState } from '../../../../home/protocol';
import { AsyncComputedState } from '../../../shared/components/signal-utils';
import type { Disposable } from '../../../shared/events';
import type { HostIpc } from '../../../shared/ipc';

export type Overview = GetOverviewResponse;

export class OverviewState extends AsyncComputedState<Overview> {
	private _disposable: Disposable | undefined;

	constructor(
		private _ipc: HostIpc,
		options?: {
			runImmediately?: boolean;
			initial?: Overview;
		},
	) {
		super(async _abortSignal => {
			const rsp: Overview = await this._ipc.sendRequest(GetOverview, {});

			return rsp;
		}, options);

		this._disposable = this._ipc.onReceiveMessage(msg => {
			switch (true) {
				case DidChangeRepositoryWip.is(msg):
					this.run(true);
					break;
			}
		});
		void this._ipc.sendRequest(GetOverviewFilterState, undefined).then(rsp => {
			this.filter.set(rsp.recent.ownerFilter);
		});
	}

	dispose() {
		this._disposable?.dispose();
	}

	filter = signal([]);
}

export const overviewStateContext = createContext<Overview>('overviewState');

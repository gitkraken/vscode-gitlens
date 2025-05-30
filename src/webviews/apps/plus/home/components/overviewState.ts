import { createContext } from '@lit/context';
import { signalObject } from 'signal-utils/object';
import type { GetOverviewResponse, OverviewFilters } from '../../../../home/protocol';
import { DidChangeRepositoryWip, GetOverview, GetOverviewFilterState } from '../../../../home/protocol';
import { AsyncComputedState } from '../../../shared/components/signal-utils';
import type { Disposable } from '../../../shared/events';
import type { HostIpc } from '../../../shared/ipc';

export type Overview = GetOverviewResponse;

export class OverviewState extends AsyncComputedState<Overview> {
	private readonly _disposable: Disposable | undefined;

	constructor(
		private readonly _ipc: HostIpc,
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
			this.filter.recent = rsp.recent;
			this.filter.stale = rsp.stale;
		});
	}

	dispose() {
		this._disposable?.dispose();
	}

	filter = signalObject<Partial<OverviewFilters>>({});
}

export const overviewStateContext = createContext<Overview>('overviewState');

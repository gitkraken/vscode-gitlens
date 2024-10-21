import { createContext } from '@lit/context';
import type { GetOverviewResponse } from '../../../../home/protocol';
import { GetOverview } from '../../../../home/protocol';
import { AsyncComputedState } from '../../../shared/components/signal-utils';
import type { HostIpc } from '../../../shared/ipc';

export type Overview = GetOverviewResponse;

export class OverviewState extends AsyncComputedState<Overview> {
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
	}
}

export const overviewStateContext = createContext<Overview>('overviewState');

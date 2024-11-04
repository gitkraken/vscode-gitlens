import { createContext } from '@lit/context';
import type { GetOverviewResponse } from '../../../../home/protocol';
import { DidChangeRepositoryWip, GetOverview } from '../../../../home/protocol';
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
	}

	dispose() {
		this._disposable?.dispose();
	}
}

export const overviewStateContext = createContext<Overview>('overviewState');

import { createContext } from '@lit/context';
import { signalObject } from 'signal-utils/object';
import type { GetOverviewResponse, OverviewFilters } from '../../../../home/protocol';
import {
	ChangeOverviewRepository,
	DidChangeOverviewFilter,
	DidChangeRepositories,
	DidChangeRepositoryWip,
	DidCompleteDiscoveringRepositories,
	GetOverview,
	GetOverviewFilterState,
} from '../../../../home/protocol';
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
				case DidCompleteDiscoveringRepositories.is(msg):
					if (msg.params.repositories.openCount > 0) {
						this.run(true);
					}
					break;
				case DidChangeRepositories.is(msg):
					this.run(true);
					break;
				case DidChangeRepositoryWip.is(msg):
					this.run(true);
					break;
				case DidChangeOverviewFilter.is(msg):
					this.filter.recent = msg.params.filter.recent;
					this.filter.stale = msg.params.filter.stale;
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

	async changeRepository() {
		await this._ipc.sendRequest(ChangeOverviewRepository, undefined);
		this.run(true);
	}
}

export const overviewStateContext = createContext<Overview>('overviewState');

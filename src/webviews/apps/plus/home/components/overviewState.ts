import { createContext } from '@lit/context';
import { signalObject } from 'signal-utils/object';
import type {
	GetActiveOverviewResponse,
	GetInactiveOverviewResponse,
	OverviewFilters,
} from '../../../../home/protocol';
import {
	ChangeOverviewRepositoryCommand,
	DidChangeIntegrationsConnections,
	DidChangeOverviewFilter,
	DidChangeOverviewRepository,
	DidChangeRepositories,
	DidChangeRepositoryWip,
	GetActiveOverview,
	GetInactiveOverview,
	GetOverviewFilterState,
} from '../../../../home/protocol';
import { AsyncComputedState } from '../../../shared/components/signal-utils';
import type { Disposable } from '../../../shared/events';
import type { HostIpc } from '../../../shared/ipc';

export type ActiveOverview = GetActiveOverviewResponse;
export type InactiveOverview = GetInactiveOverviewResponse;

export class ActiveOverviewState extends AsyncComputedState<ActiveOverview> {
	private readonly _disposable: Disposable | undefined;

	constructor(
		private readonly _ipc: HostIpc,
		options?: {
			runImmediately?: boolean;
			initial?: ActiveOverview;
		},
	) {
		super(async _abortSignal => {
			const rsp: ActiveOverview = await this._ipc.sendRequest(GetActiveOverview, undefined);
			return rsp;
		}, options);

		this._disposable = this._ipc.onReceiveMessage(msg => {
			switch (true) {
				case DidChangeIntegrationsConnections.is(msg):
					this.run(true);
					break;
				case DidChangeRepositories.is(msg):
					this.run(true);
					break;
				case DidChangeRepositoryWip.is(msg):
					this.run(true);
					break;
				case DidChangeOverviewRepository.is(msg):
					this.run(true);
					break;
			}
		});
	}

	dispose() {
		this._disposable?.dispose();
	}

	changeRepository(): void {
		this._ipc.sendCommand(ChangeOverviewRepositoryCommand, undefined);
	}
}

export class InactiveOverviewState extends AsyncComputedState<InactiveOverview> {
	private readonly _disposable: Disposable | undefined;
	filter = signalObject<Partial<OverviewFilters>>({});

	constructor(
		private readonly _ipc: HostIpc,
		options?: {
			runImmediately?: boolean;
			initial?: InactiveOverview;
		},
	) {
		super(async _abortSignal => {
			const rsp: InactiveOverview = await this._ipc.sendRequest(GetInactiveOverview, undefined);
			return rsp;
		}, options);

		this._disposable = this._ipc.onReceiveMessage(msg => {
			switch (true) {
				case DidChangeRepositories.is(msg):
					this.run(true);
					break;
				case DidChangeOverviewFilter.is(msg):
					this.filter.recent = msg.params.filter.recent;
					this.filter.stale = msg.params.filter.stale;
					this.run(true);
					break;
				case DidChangeOverviewRepository.is(msg):
					this.run(true);
					break;
			}
		});
		void this._ipc.sendRequest(GetOverviewFilterState, undefined).then(rsp => {
			this.filter.recent = rsp.recent;
			this.filter.stale = rsp.stale;
		});
	}

	dispose(): void {
		this._disposable?.dispose();
	}
}

export const activeOverviewStateContext = createContext<ActiveOverview>('activeOverviewState');
export const inactiveOverviewStateContext = createContext<InactiveOverview>('inactiveOverviewState');

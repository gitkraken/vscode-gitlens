'use strict';
import { CancellationToken, Disposable, window, WorkspaceFolder } from 'vscode';
import { LiveShare, SharedServiceProxy } from 'vsls';
import { CommandContext, setCommandContext } from '../constants';
import { GitCommandOptions, Repository, RepositoryChangeEvent } from '../git/git';
import { Logger } from '../logger';
import { debug, log } from '../system';
import { VslsHostService } from './host';
import { GitCommandRequestType, RepositoriesInFolderRequestType, RepositoryProxy, RequestType } from './protocol';

export class VslsGuestService implements Disposable {
	@log()
	static async connect(api: LiveShare) {
		const cc = Logger.getCorrelationContext();

		try {
			const service = await api.getSharedService(VslsHostService.ServiceId);
			if (service == null) {
				throw new Error('Failed to connect to host service');
			}

			return new VslsGuestService(api, service);
		} catch (ex) {
			Logger.error(ex, cc);
			return undefined;
		}
	}

	constructor(private readonly _api: LiveShare, private readonly _service: SharedServiceProxy) {
		_service.onDidChangeIsServiceAvailable(this.onAvailabilityChanged.bind(this));
		this.onAvailabilityChanged(_service.isServiceAvailable);
	}

	dispose() {
		// nothing to dispose
	}

	@log()
	private onAvailabilityChanged(available: boolean) {
		if (available) {
			void setCommandContext(CommandContext.Enabled, true);
			return;
		}

		void setCommandContext(CommandContext.Enabled, false);
		void window.showWarningMessage(
			'GitLens features will be unavailable. Unable to connect to the host GitLens service. The host may have disabled GitLens guest access or may not have GitLens installed.',
		);
	}

	@log()
	async git<TOut extends string | Buffer>(options: GitCommandOptions, ...args: any[]) {
		const response = await this.sendRequest(GitCommandRequestType, { options: options, args: args });

		if (response.isBuffer) {
			return new Buffer(response.data, 'binary') as TOut;
		}
		return response.data as TOut;
	}

	@log()
	async getRepositoriesInFolder(
		folder: WorkspaceFolder,
		onAnyRepositoryChanged: (repo: Repository, e: RepositoryChangeEvent) => void,
	): Promise<Repository[]> {
		const response = await this.sendRequest(RepositoriesInFolderRequestType, {
			folderUri: folder.uri.toString(true),
		});

		return response.repositories.map(
			(r: RepositoryProxy) =>
				new Repository(folder, r.path, r.root, onAnyRepositoryChanged, !window.state.focused, r.closed),
		);
	}

	@debug()
	private sendRequest<TRequest, TResponse>(
		requestType: RequestType<TRequest, TResponse>,
		request: TRequest,
		_cancellation?: CancellationToken,
	): Promise<TResponse> {
		return this._service.request(requestType.name, [request]);
	}
}

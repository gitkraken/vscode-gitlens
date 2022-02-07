import { CancellationToken, Disposable, Uri, window } from 'vscode';
import type { LiveShare, SharedServiceProxy } from '../@types/vsls';
import { Container } from '../container';
import { GitCommandOptions } from '../git/commandOptions';
import { Logger } from '../logger';
import { debug, log } from '../system/decorators/log';
import { VslsHostService } from './host';
import { GetRepositoriesForUriRequestType, GitCommandRequestType, RepositoryProxy, RequestType } from './protocol';

export class VslsGuestService implements Disposable {
	@log()
	static async connect(api: LiveShare, container: Container) {
		const cc = Logger.getCorrelationContext();

		try {
			const service = await api.getSharedService(VslsHostService.ServiceId);
			if (service == null) {
				throw new Error('Failed to connect to host service');
			}

			return new VslsGuestService(api, service, container);
		} catch (ex) {
			Logger.error(ex, cc);
			return undefined;
		}
	}

	constructor(
		private readonly _api: LiveShare,
		private readonly _service: SharedServiceProxy,
		private readonly container: Container,
	) {
		_service.onDidChangeIsServiceAvailable(this.onAvailabilityChanged.bind(this));
		this.onAvailabilityChanged(_service.isServiceAvailable);
	}

	dispose() {
		// nothing to dispose
	}

	@log()
	private onAvailabilityChanged(available: boolean) {
		if (available) {
			void this.container.git.setEnabledContext(true);

			return;
		}

		void this.container.git.setEnabledContext(false);
		void window.showWarningMessage(
			'GitLens features will be unavailable. Unable to connect to the host GitLens service. The host may have disabled GitLens guest access or may not have GitLens installed.',
		);
	}

	@log()
	async git<TOut extends string | Buffer>(options: GitCommandOptions, ...args: any[]) {
		const response = await this.sendRequest(GitCommandRequestType, { options: options, args: args });

		if (response.isBuffer) {
			return Buffer.from(response.data, 'binary') as TOut;
		}
		return response.data as TOut;
	}

	@log()
	async getRepositoriesForUri(uri: Uri): Promise<RepositoryProxy[]> {
		const response = await this.sendRequest(GetRepositoriesForUriRequestType, {
			folderUri: uri.toString(),
		});

		return response.repositories;
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

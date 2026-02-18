import type { CancellationToken, Disposable, Uri } from 'vscode';
import { window } from 'vscode';
import type { LiveShare, SharedServiceProxy } from '../@types/vsls.d.js';
import type { Container } from '../container.js';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- Allowed since it is a type import
import type {} from '../env/node/git/git.js';
import type { GitExecOptions, GitResult } from '../git/execTypes.js';
import { debug, trace } from '../system/decorators/log.js';
import { getScopedLogger } from '../system/logger.scope.js';
import { VslsHostService } from './host.js';
import type { RepositoryProxy, RequestType } from './protocol.js';
import { GetRepositoriesForUriRequestType, GitCommandRequestType } from './protocol.js';

export class VslsGuestService implements Disposable {
	@debug()
	static async connect(api: LiveShare, container: Container): Promise<VslsGuestService | undefined> {
		const scope = getScopedLogger();

		try {
			const service = await api.getSharedService(VslsHostService.ServiceId);
			if (service == null) {
				throw new Error('Failed to connect to host service');
			}

			return new VslsGuestService(api, service, container);
		} catch (ex) {
			scope?.error(ex);
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

	dispose(): void {
		// nothing to dispose
	}

	@debug()
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

	@debug()
	async git<TOut extends string | Buffer>(options: GitExecOptions, ...args: any[]): Promise<GitResult<TOut>> {
		const response = await this.sendRequest(GitCommandRequestType, {
			__type: 'gitlens',
			options: options,
			args: args,
		});

		return {
			stdout: (response.isBuffer ? Buffer.from(response.data, 'binary') : response.data) as TOut,
			exitCode: 0,
		};
	}

	@debug()
	async getRepositoriesForUri(uri: Uri): Promise<RepositoryProxy[]> {
		const response = await this.sendRequest(GetRepositoriesForUriRequestType, {
			__type: 'gitlens',
			folderUri: uri.toString(),
		});

		return response.repositories;
	}

	@trace()
	private sendRequest<TRequest, TResponse>(
		requestType: RequestType<TRequest, TResponse>,
		request: TRequest & { __type: string },
		cancellation?: CancellationToken,
	): Promise<TResponse> {
		return this._service.request<TResponse>(requestType.name, [request], cancellation);
	}
}

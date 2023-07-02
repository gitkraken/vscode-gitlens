import type { CancellationToken, Disposable, Uri } from 'vscode';
import { window } from 'vscode';
import type { LiveShare, SharedServiceProxy } from '../@types/vsls';
import type { Container } from '../container';
import type { GitCommandOptions } from '../git/commandOptions';
import { debug, log } from '../system/decorators/log';
import { Logger } from '../system/logger';
import { getLogScope } from '../system/logger.scope';
import { VslsHostService } from './host';
import type { RepositoryProxy, RequestType } from './protocol';
import { GetRepositoriesForUriRequestType, GitCommandRequestType, GitLogStreamToCommandRequestType } from './protocol';

export class VslsGuestService implements Disposable {
	@log()
	static async connect(api: LiveShare, container: Container) {
		const scope = getLogScope();

		try {
			const service = await api.getSharedService(VslsHostService.ServiceId);
			if (service == null) {
				throw new Error('Failed to connect to host service');
			}

			return new VslsGuestService(api, service, container);
		} catch (ex) {
			Logger.error(ex, scope);
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
	async git<TOut extends string | Buffer>(options: GitCommandOptions, ...args: any[]): Promise<TOut> {
		const response = await this.sendRequest(GitCommandRequestType, {
			__type: 'gitlens',
			options: options,
			args: args,
		});

		if (response.isBuffer) {
			return Buffer.from(response.data, 'binary') as TOut;
		}
		return response.data as TOut;
	}

	@log()
	async gitLogStreamTo(
		repoPath: string,
		sha: string,
		limit: number,
		options?: { configs?: readonly string[]; stdin?: string },
		...args: string[]
	): Promise<[data: string[], count: number]> {
		const response = await this.sendRequest(GitLogStreamToCommandRequestType, {
			__type: 'gitlens',
			repoPath: repoPath,
			sha: sha,
			limit: limit,
			options: options,
			args: args,
		});

		return [response.data, response.count];
	}

	@log()
	async getRepositoriesForUri(uri: Uri): Promise<RepositoryProxy[]> {
		const response = await this.sendRequest(GetRepositoriesForUriRequestType, {
			__type: 'gitlens',
			folderUri: uri.toString(),
		});

		return response.repositories;
	}

	@debug()
	private sendRequest<TRequest, TResponse>(
		requestType: RequestType<TRequest, TResponse>,
		request: TRequest & { __type: string },
		cancellation?: CancellationToken,
	): Promise<TResponse> {
		return this._service.request<TResponse>(requestType.name, [request], cancellation);
	}
}

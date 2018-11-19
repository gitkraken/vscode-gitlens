'use strict';
import { CancellationToken, Disposable, window, WorkspaceFolder } from 'vscode';
import { LiveShare, SharedServiceProxy } from 'vsls';
import { CommandContext, setCommandContext } from '../constants';
import { GitCommandOptions, Repository, RepositoryChange } from '../git/git';
import { Logger } from '../logger';
import { debug, log } from '../system';
import { VslsHostService } from './host';
import {
    GitCommandRequestType,
    RepositoriesInFolderRequestType,
    RepositoryProxy,
    RequestType,
    WorkspaceFileExistsRequestType
} from './protocol';

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
        }
        catch (ex) {
            Logger.error(ex, cc);
            return undefined;
        }
    }

    constructor(
        private readonly _api: LiveShare,
        private readonly _service: SharedServiceProxy
    ) {
        _service.onDidChangeIsServiceAvailable(this.onAvailabilityChanged.bind(this));
        this.onAvailabilityChanged(_service.isServiceAvailable);
    }

    dispose() {}

    @log()
    private async onAvailabilityChanged(available: boolean) {
        if (available) {
            setCommandContext(CommandContext.Enabled, true);
            return;
        }

        setCommandContext(CommandContext.Enabled, false);
        void window.showWarningMessage(
            `GitLens features will be unavailable. Unable to connect to the host GitLens service. The host may have disabled GitLens guest access or may not have GitLens installed.`
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
        onAnyRepositoryChanged: (repo: Repository, reason: RepositoryChange) => void
    ): Promise<Repository[]> {
        const response = await this.sendRequest(RepositoriesInFolderRequestType, {
            folderUri: folder.uri.toString(true)
        });

        return response.repositories.map(
            (r: RepositoryProxy) => new Repository(folder, r.path, r.root, onAnyRepositoryChanged, false, r.closed)
        );
    }

    @log()
    async fileExists(
        repoPath: string,
        fileName: string,
        options: { ensureCase: boolean } = { ensureCase: false }
    ): Promise<boolean> {
        const response = await this.sendRequest(WorkspaceFileExistsRequestType, {
            fileName: fileName,
            repoPath: repoPath,
            options: options
        });

        return response.exists;
    }

    @debug()
    private sendRequest<TRequest, TResponse>(
        requestType: RequestType<TRequest, TResponse>,
        request: TRequest,
        cancellation?: CancellationToken
    ): Promise<TResponse> {
        return this._service.request(requestType.name, [request]);
    }
}

'use strict';
import { CancellationToken, Disposable, Uri, workspace, WorkspaceFoldersChangeEvent } from 'vscode';
import { LiveShare, SharedService } from 'vsls';
import { Container } from '../container';
import { git } from '../git/git';
import { GitUri } from '../git/gitUri';
import { Logger } from '../logger';
import { debug, Iterables, log, Strings } from '../system';
import {
    GitCommandRequest,
    GitCommandRequestType,
    GitCommandResponse,
    RepositoriesInFolderRequest,
    RepositoriesInFolderRequestType,
    RepositoriesInFolderResponse,
    RequestType,
    WorkspaceFileExistsRequest,
    WorkspaceFileExistsRequestType,
    WorkspaceFileExistsResponse
} from './protocol';
import { vslsUriRootRegex } from './vsls';

const defaultWhitelistFn = () => true;
const gitWhitelist = new Map<string, ((args: any[]) => boolean)>([
    ['blame', defaultWhitelistFn],
    ['branch', args => args[1] === '-vv' || args[1] === '--contains'],
    ['cat-file', defaultWhitelistFn],
    ['config', args => args[1] === '--get' || args[1] === '--get-regex'],
    ['diff', defaultWhitelistFn],
    ['difftool', defaultWhitelistFn],
    ['log', defaultWhitelistFn],
    ['ls-files', defaultWhitelistFn],
    ['ls-tree', defaultWhitelistFn],
    ['merge-base', defaultWhitelistFn],
    ['remote', args => args[1] === '-v' || args[1] === 'get-url'],
    ['rev-parse', defaultWhitelistFn],
    ['show', defaultWhitelistFn],
    ['show-ref', defaultWhitelistFn],
    ['stash', args => args[1] === 'list'],
    ['status', defaultWhitelistFn],
    ['symbolic-ref', defaultWhitelistFn],
    ['tag', args => args[1] === '-l']
]);

const leadingSlashRegex = /^[\/|\\]/;

export class VslsHostService implements Disposable {
    static ServiceId = 'proxy';

    @log()
    static async share(api: LiveShare) {
        const service = await api.shareService(this.ServiceId);
        if (service == null) {
            throw new Error('Failed to share host service');
        }

        return new VslsHostService(api, service);
    }

    private readonly _disposable: Disposable;
    private _localPathsRegex: RegExp | undefined;
    private _localToSharedPaths = new Map<string, string>();
    private _sharedPathsRegex: RegExp | undefined;
    private _sharedToLocalPaths = new Map<string, string>();

    constructor(
        private readonly _api: LiveShare,
        private readonly _service: SharedService
    ) {
        _service.onDidChangeIsServiceAvailable(this.onAvailabilityChanged.bind(this));

        this._disposable = Disposable.from(workspace.onDidChangeWorkspaceFolders(this.onWorkspaceFoldersChanged, this));

        this.onRequest(GitCommandRequestType, this.onGitCommandRequest.bind(this));
        this.onRequest(RepositoriesInFolderRequestType, this.onRepositoriesInFolderRequest.bind(this));
        this.onRequest(WorkspaceFileExistsRequestType, this.onWorkspaceFileExistsRequest.bind(this));

        void this.onWorkspaceFoldersChanged();
    }

    dispose() {
        this._disposable.dispose();
        void this._api.unshareService(VslsHostService.ServiceId);
    }

    private onRequest<TRequest, TResponse>(
        requestType: RequestType<TRequest, TResponse>,
        handler: (request: TRequest, cancellation: CancellationToken) => Promise<TResponse>
    ) {
        this._service.onRequest(requestType.name, (args: any[], cancellation: CancellationToken) =>
            handler(args[0], cancellation)
        );
    }

    @log()
    private onAvailabilityChanged(available: boolean) {
        // TODO
    }

    @debug()
    private async onWorkspaceFoldersChanged(e?: WorkspaceFoldersChangeEvent) {
        if (workspace.workspaceFolders === undefined || workspace.workspaceFolders.length === 0) return;

        const cc = Logger.getCorrelationContext();

        this._localToSharedPaths.clear();
        this._sharedToLocalPaths.clear();

        let localPath;
        let sharedPath;
        for (const f of workspace.workspaceFolders) {
            localPath = Strings.normalizePath(f.uri.fsPath);
            sharedPath = Strings.normalizePath(this.convertLocalUriToShared(f.uri).fsPath);

            Logger.debug(cc, `shared='${sharedPath}' \u2194 local='${localPath}'`);
            this._localToSharedPaths.set(localPath, sharedPath);
            this._sharedToLocalPaths.set(sharedPath, localPath);
        }

        let localPaths = Iterables.join(this._sharedToLocalPaths.values(), '|');
        localPaths = localPaths.replace(/(\/|\\)/g, '[\\\\/|\\\\]');
        this._localPathsRegex = new RegExp(`(${localPaths})`, 'gi');

        let sharedPaths = Iterables.join(this._localToSharedPaths.values(), '|');
        sharedPaths = sharedPaths.replace(/(\/|\\)/g, '[\\\\/|\\\\]');
        this._sharedPathsRegex = new RegExp(`^(${sharedPaths})`, 'i');
    }

    @log()
    private async onGitCommandRequest(
        request: GitCommandRequest,
        cancellation: CancellationToken
    ): Promise<GitCommandResponse> {
        const { options, args } = request;

        const fn = gitWhitelist.get(request.args[0]);
        if (fn === undefined || !fn(request.args)) throw new Error(`Git ${request.args[0]} command is not allowed`);

        let isRootWorkspace = false;
        if (options.cwd !== undefined && options.cwd.length > 0 && this._sharedToLocalPaths !== undefined) {
            // This is all so ugly, but basically we are converting shared paths to local paths
            if (this._sharedPathsRegex !== undefined && this._sharedPathsRegex.test(options.cwd)) {
                options.cwd = Strings.normalizePath(options.cwd).replace(this._sharedPathsRegex, (match, shared) => {
                    if (!isRootWorkspace) {
                        isRootWorkspace = shared === '/~0';
                    }

                    const local = this._sharedToLocalPaths.get(shared);
                    return local != null ? local : shared;
                });
            }
            else if (leadingSlashRegex.test(options.cwd)) {
                const localCwd = this._sharedToLocalPaths.get('/~0');
                if (localCwd !== undefined) {
                    isRootWorkspace = true;
                    options.cwd = GitUri.resolve(options.cwd, localCwd);
                }
            }
        }

        let files = false;
        let i = -1;
        for (const arg of args) {
            i++;
            if (arg === '--') {
                files = true;
                continue;
            }

            if (!files) continue;

            if (typeof arg === 'string') {
                // If we are the "root" workspace, then we need to remove the leading slash off the path (otherwise it will not be treated as a relative path)
                if (isRootWorkspace && leadingSlashRegex.test(arg[0])) {
                    args.splice(i, 1, arg.substr(1));
                }

                if (this._sharedPathsRegex !== undefined && this._sharedPathsRegex.test(arg)) {
                    args.splice(
                        i,
                        1,
                        Strings.normalizePath(arg).replace(this._sharedPathsRegex, (match, shared) => {
                            const local = this._sharedToLocalPaths.get(shared);
                            return local != null ? local : shared;
                        })
                    );
                }
            }
        }

        let data = await git(options, ...args);
        if (typeof data === 'string') {
            // And then we convert local paths to shared paths
            if (this._localPathsRegex !== undefined && data.length > 0) {
                data = data.replace(this._localPathsRegex, (match, local) => {
                    const shared = this._localToSharedPaths.get(local);
                    return shared != null ? shared : local;
                });
            }

            return { data: data };
        }

        return { data: data.toString('binary'), isBuffer: true };
    }

    @log()
    private async onRepositoriesInFolderRequest(
        request: RepositoriesInFolderRequest,
        cancellation: CancellationToken
    ): Promise<RepositoriesInFolderResponse> {
        const uri = this.convertSharedUriToLocal(Uri.parse(request.folderUri));
        const normalized = Strings.normalizePath(uri.fsPath, { stripTrailingSlash: true }).toLowerCase();

        const repos = [
            ...Iterables.filterMap(await Container.git.getRepositories(), r => {
                if (!r.normalizedPath.startsWith(normalized)) return undefined;

                const vslsUri = this.convertLocalUriToShared(r.folder.uri);
                return {
                    folderUri: vslsUri.toString(true),
                    path: vslsUri.path,
                    root: r.root,
                    closed: r.closed
                };
            })
        ];

        return {
            repositories: repos
        };
    }

    @log()
    private async onWorkspaceFileExistsRequest(
        request: WorkspaceFileExistsRequest,
        cancellation: CancellationToken
    ): Promise<WorkspaceFileExistsResponse> {
        let { repoPath } = request;
        if (this._sharedPathsRegex !== undefined && this._sharedPathsRegex.test(repoPath)) {
            repoPath = Strings.normalizePath(repoPath).replace(this._sharedPathsRegex, (match, shared) => {
                const local = this._sharedToLocalPaths!.get(shared);
                return local != null ? local : shared;
            });
        }

        // TODO: Lock this to be only in the contained workspaces

        return { exists: await Container.git.fileExists(repoPath, request.fileName, request.options) };
    }

    @debug({
        exit: result => `returned ${result.toString(true)}`
    })
    private convertLocalUriToShared(localUri: Uri) {
        const cc = Logger.getCorrelationContext();

        let sharedUri = this._api.convertLocalUriToShared(localUri);
        Logger.debug(
            cc,
            `LiveShare.convertLocalUriToShared(${localUri.toString(true)}) returned ${sharedUri.toString(true)}`
        );

        const localPath = localUri.path;
        let sharedPath = sharedUri.path;
        if (sharedUri.authority.length > 0) {
            sharedPath = `/${sharedUri.authority}${sharedPath}`;
        }

        if (new RegExp(`${localPath}$`, 'i').test(sharedPath)) {
            if (sharedPath.length === localPath.length) {
                const folder = workspace.getWorkspaceFolder(localUri)!;
                sharedUri = sharedUri.with({ path: `/~${folder.index}` });
            }
            else {
                sharedUri = sharedUri.with({ path: sharedPath.substr(0, sharedPath.length - localPath.length) });
            }
        }
        else if (!sharedPath.startsWith('/~')) {
            const folder = workspace.getWorkspaceFolder(localUri)!;
            sharedUri = sharedUri.with({ path: `/~${folder.index}${sharedPath}` });
        }

        return sharedUri;
    }

    private convertSharedUriToLocal(sharedUri: Uri) {
        if (vslsUriRootRegex.test(sharedUri.path)) {
            sharedUri = sharedUri.with({ path: `${sharedUri.path}/` });
        }

        const localUri = this._api.convertSharedUriToLocal(sharedUri);

        const localPath = localUri.path;
        const sharedPath = sharedUri.path;
        if (localPath.endsWith(sharedPath)) {
            return localUri.with({ path: localPath.substr(0, localPath.length - sharedPath.length) });
        }
        return localUri;
    }
}

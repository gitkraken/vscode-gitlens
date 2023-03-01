import type { CancellationToken, WorkspaceFoldersChangeEvent } from 'vscode';
import { Disposable, Uri, workspace } from 'vscode';
import { git } from '@env/providers';
import type { LiveShare, SharedService } from '../@types/vsls';
import type { Container } from '../container';
import { debug, log } from '../system/decorators/log';
import { join } from '../system/iterable';
import { Logger } from '../system/logger';
import { getLogScope } from '../system/logger.scope';
import { isVslsRoot, normalizePath } from '../system/path';
import type {
	GetRepositoriesForUriRequest,
	GetRepositoriesForUriResponse,
	GitCommandRequest,
	GitCommandResponse,
	RepositoryProxy,
	RequestType,
} from './protocol';
import { GetRepositoriesForUriRequestType, GitCommandRequestType } from './protocol';

const defaultWhitelistFn = () => true;
const gitWhitelist = new Map<string, (args: any[]) => boolean>([
	['blame', defaultWhitelistFn],
	['branch', args => args[1] === '--contains'],
	['cat-file', defaultWhitelistFn],
	['check-mailmap', defaultWhitelistFn],
	['check-ref-format', defaultWhitelistFn],
	['config', args => args[1] === '--get' || args[1] === '--get-regex'],
	['diff', defaultWhitelistFn],
	['difftool', defaultWhitelistFn],
	['for-each-ref', defaultWhitelistFn],
	['log', defaultWhitelistFn],
	['ls-files', defaultWhitelistFn],
	['ls-tree', defaultWhitelistFn],
	['merge-base', defaultWhitelistFn],
	['remote', args => args[1] === '-v' || args[1] === 'get-url'],
	['rev-list', defaultWhitelistFn],
	['rev-parse', defaultWhitelistFn],
	['show', defaultWhitelistFn],
	['show-ref', defaultWhitelistFn],
	['stash', args => args[1] === 'list'],
	['status', defaultWhitelistFn],
	['symbolic-ref', defaultWhitelistFn],
	['tag', args => args[1] === '-l'],
]);

const leadingSlashRegex = /^[/|\\]/;
const slash = 47; //CharCode.Slash;

export class VslsHostService implements Disposable {
	static ServiceId = 'proxy';

	@log()
	static async share(api: LiveShare, container: Container) {
		const service = await api.shareService(this.ServiceId);
		if (service == null) {
			throw new Error('Failed to share host service');
		}

		return new VslsHostService(api, service, container);
	}

	private readonly _disposable: Disposable;
	private _localPathsRegex: RegExp | undefined;
	private _localToSharedPaths = new Map<string, string>();
	private _sharedPathsRegex: RegExp | undefined;
	private _sharedToLocalPaths = new Map<string, string>();

	constructor(
		private readonly _api: LiveShare,
		private readonly _service: SharedService,
		private readonly container: Container,
	) {
		_service.onDidChangeIsServiceAvailable(this.onAvailabilityChanged.bind(this));

		this._disposable = Disposable.from(workspace.onDidChangeWorkspaceFolders(this.onWorkspaceFoldersChanged, this));

		this.onRequest(GitCommandRequestType, this.onGitCommandRequest.bind(this));
		this.onRequest(GetRepositoriesForUriRequestType, this.onGetRepositoriesForUriRequest.bind(this));

		this.onWorkspaceFoldersChanged();
	}

	dispose() {
		this._disposable.dispose();
		void this._api.unshareService(VslsHostService.ServiceId);
	}

	private onRequest<TRequest, TResponse>(
		requestType: RequestType<TRequest, TResponse>,
		handler: (request: TRequest, cancellation: CancellationToken) => Promise<TResponse>,
	) {
		this._service.onRequest(requestType.name, (args: any[], cancellation: CancellationToken) =>
			handler(args[0], cancellation),
		);
	}

	@log()
	private onAvailabilityChanged(_available: boolean) {
		// TODO
	}

	@debug()
	private onWorkspaceFoldersChanged(_e?: WorkspaceFoldersChangeEvent) {
		if (workspace.workspaceFolders == null || workspace.workspaceFolders.length === 0) return;

		const scope = getLogScope();

		this._localToSharedPaths.clear();
		this._sharedToLocalPaths.clear();

		let localPath;
		let sharedPath;
		for (const f of workspace.workspaceFolders) {
			localPath = normalizePath(f.uri.fsPath);
			sharedPath = normalizePath(this.convertLocalUriToShared(f.uri).toString());

			Logger.debug(scope, `shared='${sharedPath}' \u2194 local='${localPath}'`);
			this._localToSharedPaths.set(localPath, sharedPath);
			this._sharedToLocalPaths.set(sharedPath, localPath);
		}

		let localPaths = join(this._sharedToLocalPaths.values(), '|');
		localPaths = localPaths.replace(/(\/|\\)/g, '[\\\\/|\\\\]');
		this._localPathsRegex = new RegExp(`(${localPaths})`, 'gi');

		let sharedPaths = join(this._localToSharedPaths.values(), '|');
		sharedPaths = sharedPaths.replace(/(\/|\\)/g, '[\\\\/|\\\\]');
		this._sharedPathsRegex = new RegExp(`^(${sharedPaths})`, 'i');
	}

	@log()
	private async onGitCommandRequest(
		request: GitCommandRequest,
		_cancellation: CancellationToken,
	): Promise<GitCommandResponse> {
		const { options, args } = request;

		const fn = gitWhitelist.get(request.args[0]);
		if (fn == null || !fn(request.args)) throw new Error(`Git ${request.args[0]} command is not allowed`);

		let isRootWorkspace = false;
		if (options.cwd != null && options.cwd.length > 0 && this._sharedToLocalPaths != null) {
			// This is all so ugly, but basically we are converting shared paths to local paths
			if (this._sharedPathsRegex?.test(options.cwd)) {
				options.cwd = normalizePath(options.cwd).replace(this._sharedPathsRegex, (match, shared: string) => {
					if (!isRootWorkspace) {
						isRootWorkspace = shared === '/~0';
					}

					const local = this._sharedToLocalPaths.get(shared);
					return local != null ? local : shared;
				});
			} else if (leadingSlashRegex.test(options.cwd)) {
				const localCwd = this._sharedToLocalPaths.get('vsls:/~0');
				if (localCwd != null) {
					isRootWorkspace = true;
					options.cwd = normalizePath(this.container.git.getAbsoluteUri(options.cwd, localCwd).fsPath);
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

				if (this._sharedPathsRegex?.test(arg)) {
					args.splice(
						i,
						1,
						normalizePath(arg).replace(this._sharedPathsRegex, (match, shared: string) => {
							const local = this._sharedToLocalPaths.get(shared);
							return local != null ? local : shared;
						}),
					);
				}
			}
		}

		let data = await git(options, ...args);
		if (typeof data === 'string') {
			// And then we convert local paths to shared paths
			if (this._localPathsRegex != null && data.length > 0) {
				data = data.replace(this._localPathsRegex, (match, local: string) => {
					const shared = this._localToSharedPaths.get(normalizePath(local));
					return shared != null ? shared : local;
				});
			}

			return { data: data };
		}

		return { data: data.toString('binary'), isBuffer: true };
	}

	// eslint-disable-next-line @typescript-eslint/require-await
	@log()
	private async onGetRepositoriesForUriRequest(
		request: GetRepositoriesForUriRequest,
		_cancellation: CancellationToken,
	): Promise<GetRepositoriesForUriResponse> {
		const repositories: RepositoryProxy[] = [];

		const uri = this.convertSharedUriToLocal(Uri.parse(request.folderUri, true));
		const repository = this.container.git.getRepository(uri);

		if (repository != null) {
			const vslsUri = this.convertLocalUriToShared(repository.uri);
			repositories.push({
				folderUri: vslsUri.toString(),
				// uri: vslsUri.toString(),
				root: repository.root,
				closed: repository.closed,
			});
		}

		return { repositories: repositories };
	}

	@debug({
		exit: result => `returned ${result.toString(true)}`,
	})
	private convertLocalUriToShared(localUri: Uri) {
		const scope = getLogScope();

		let sharedUri = this._api.convertLocalUriToShared(localUri);
		Logger.debug(
			scope,
			`LiveShare.convertLocalUriToShared(${localUri.toString(true)}) returned ${sharedUri.toString(true)}`,
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
			} else {
				sharedUri = sharedUri.with({ path: sharedPath.substr(0, sharedPath.length - localPath.length) });
			}
		} else if (!sharedPath.startsWith('/~')) {
			const folder = workspace.getWorkspaceFolder(localUri)!;
			sharedUri = sharedUri.with({ path: `/~${folder.index}${sharedPath}` });
		}

		return sharedUri;
	}

	private convertSharedUriToLocal(sharedUri: Uri) {
		if (isVslsRoot(sharedUri.path)) {
			sharedUri = sharedUri.with({ path: `${sharedUri.path}/` });
		}

		const localUri = this._api.convertSharedUriToLocal(sharedUri);

		let localPath = localUri.path;
		const sharedPath = sharedUri.path;
		if (localPath.endsWith(sharedPath)) {
			localPath = localPath.substr(0, localPath.length - sharedPath.length);
		}

		if (localPath.charCodeAt(localPath.length - 1) === slash) {
			localPath = localPath.slice(0, -1);
		}

		return localUri.with({ path: localPath });
	}
}

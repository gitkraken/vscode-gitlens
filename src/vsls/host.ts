import { git, gitLogStreamTo } from '@env/providers';
import type { CancellationToken, WorkspaceFoldersChangeEvent } from 'vscode';
import { Disposable, Uri, workspace } from 'vscode';
import type { LiveShare, SharedService } from '../@types/vsls';
import type { Container } from '../container';
import { debug, log } from '../system/decorators/log';
import { join } from '../system/iterable';
import { Logger } from '../system/logger';
import { getLogScope } from '../system/logger.scope';
import { normalizePath } from '../system/path';
import { isVslsRoot } from '../system/vscode/path';
import type {
	GetRepositoriesForUriRequest,
	GetRepositoriesForUriResponse,
	GitCommandRequest,
	GitCommandResponse,
	GitLogStreamToCommandRequest,
	GitLogStreamToCommandResponse,
	RepositoryProxy,
	RequestType,
} from './protocol';
import { GetRepositoriesForUriRequestType, GitCommandRequestType, GitLogStreamToCommandRequestType } from './protocol';

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
	['worktree', args => args[1] === 'list'],
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
		this.onRequest(GitLogStreamToCommandRequestType, this.onGitLogStreamToCommandRequest.bind(this));
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
		// eslint-disable-next-line prefer-arrow-callback
		this._service.onRequest(requestType.name, function (args: any[], cancellation: CancellationToken) {
			let request;
			for (const arg of args) {
				if (typeof arg === 'object' && '__type' in arg) {
					request = arg;
					break;
				}
			}
			return handler(request ?? args[0], cancellation);
		});
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
		const fn = gitWhitelist.get(request.args[0]);
		if (!fn?.(request.args)) throw new Error(`Git ${request.args[0]} command is not allowed`);

		const { options, args } = request;
		const [cwd, isRootWorkspace] = this.convertGitCommandCwd(options.cwd);
		options.cwd = cwd;

		let data = await git(options, ...this.convertGitCommandArgs(args, isRootWorkspace));
		if (typeof data === 'string') {
			// Convert local paths to shared paths
			if (this._localPathsRegex != null && data.length > 0) {
				data = data.replace(this._localPathsRegex, (_match, local: string) => {
					const shared = this._localToSharedPaths.get(normalizePath(local));
					return shared != null ? shared : local;
				});
			}

			return { data: data };
		}

		return { data: data.toString('binary'), isBuffer: true };
	}

	@log()
	private async onGitLogStreamToCommandRequest(
		request: GitLogStreamToCommandRequest,
		_cancellation: CancellationToken,
	): Promise<GitLogStreamToCommandResponse> {
		const { options, args } = request;
		const [cwd, isRootWorkspace] = this.convertGitCommandCwd(request.repoPath);

		let [data, count] = await gitLogStreamTo(
			cwd,
			request.sha,
			request.limit,
			options,
			...this.convertGitCommandArgs(args, isRootWorkspace),
		);
		if (this._localPathsRegex != null && data.length > 0) {
			// Convert local paths to shared paths
			data = data.map(d =>
				d.replace(this._localPathsRegex!, (_match, local: string) => {
					const shared = this._localToSharedPaths.get(normalizePath(local));
					return shared != null ? shared : local;
				}),
			);
		}
		return { data: data, count: count };
	}

	@log()
	// eslint-disable-next-line @typescript-eslint/require-await
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

	@debug({ exit: true })
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
				sharedUri = sharedUri.with({ authority: '', path: `/~${folder.index}` });
			} else {
				sharedUri = sharedUri.with({
					authority: '',
					path: sharedPath.substring(0, sharedPath.length - localPath.length),
				});
			}
		} else if (!sharedPath.startsWith('/~')) {
			const folder = workspace.getWorkspaceFolder(localUri)!;
			sharedUri = sharedUri.with({ authority: '', path: `/~${folder.index}${sharedPath}` });
		}

		return sharedUri;
	}

	private convertGitCommandCwd(cwd: string): [cwd: string, root: boolean];
	private convertGitCommandCwd(cwd: string | undefined): [cwd: string | undefined, root: boolean];
	private convertGitCommandCwd(cwd: string | undefined): [cwd: string | undefined, root: boolean] {
		let isRootWorkspace = false;
		if (cwd != null && cwd.length > 0 && this._sharedToLocalPaths != null) {
			// This is all so ugly, but basically we are converting shared paths to local paths
			if (this._sharedPathsRegex?.test(cwd)) {
				cwd = normalizePath(cwd).replace(this._sharedPathsRegex, (_match, shared: string) => {
					if (!isRootWorkspace) {
						isRootWorkspace = shared === '/~0';
					}

					const local = this._sharedToLocalPaths.get(shared);
					return local != null ? local : shared;
				});
			} else if (leadingSlashRegex.test(cwd)) {
				const localCwd = this._sharedToLocalPaths.get('vsls:/~0');
				if (localCwd != null) {
					isRootWorkspace = true;
					cwd = normalizePath(this.container.git.getAbsoluteUri(cwd, localCwd).fsPath);
				}
			}
		}

		return [cwd, isRootWorkspace];
	}

	private convertGitCommandArgs(args: any[], isRootWorkspace: boolean): any[] {
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
					args.splice(i, 1, arg.substring(1));
				}

				if (this._sharedPathsRegex?.test(arg)) {
					args.splice(
						i,
						1,
						normalizePath(arg).replace(this._sharedPathsRegex, (_match, shared: string) => {
							const local = this._sharedToLocalPaths.get(shared);
							return local != null ? local : shared;
						}),
					);
				}
			}
		}

		return args;
	}

	private convertSharedUriToLocal(sharedUri: Uri) {
		if (isVslsRoot(sharedUri.path)) {
			sharedUri = sharedUri.with({ path: `${sharedUri.path}/` });
		}

		const localUri = this._api.convertSharedUriToLocal(sharedUri);

		let localPath = localUri.path;
		const sharedPath = sharedUri.path;
		if (localPath.endsWith(sharedPath)) {
			localPath = localPath.substring(0, localPath.length - sharedPath.length);
		}

		if (localPath.charCodeAt(localPath.length - 1) === slash) {
			localPath = localPath.slice(0, -1);
		}

		return localUri.with({ path: localPath });
	}
}

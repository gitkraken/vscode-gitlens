import { Disposable, env, EventEmitter, ProgressLocation, Uri, window, workspace } from 'vscode';
import type { StoredDeepLinkContext } from '../../constants';
import { Commands } from '../../constants';
import type { Container } from '../../container';
import { getBranchNameWithoutRemote } from '../../git/models/branch';
import type { GitReference } from '../../git/models/reference';
import { createReference } from '../../git/models/reference';
import type { GitRemote } from '../../git/models/remote';
import { parseGitRemoteUrl } from '../../git/parsers/remoteParser';
import type { ShowInCommitGraphCommandArgs } from '../../plus/webviews/graph/protocol';
import { executeCommand } from '../../system/command';
import { configuration } from '../../system/configuration';
import { once } from '../../system/event';
import { Logger } from '../../system/logger';
import { openWorkspace, OpenWorkspaceLocation } from '../../system/utils';
import type { DeepLink, DeepLinkProgress, DeepLinkServiceContext } from './deepLink';
import {
	DeepLinkRepoOpenType,
	DeepLinkServiceAction,
	DeepLinkServiceState,
	deepLinkStateToProgress,
	deepLinkStateTransitionTable,
	DeepLinkType,
	parseDeepLinkUri,
	UriTypes,
} from './deepLink';

export class DeepLinkService implements Disposable {
	private readonly _disposables: Disposable[] = [];
	private _context: DeepLinkServiceContext;
	private readonly _onDeepLinkProgressUpdated: EventEmitter<DeepLinkProgress>;

	constructor(private readonly container: Container) {
		this._context = {
			state: DeepLinkServiceState.Idle,
		};

		this._onDeepLinkProgressUpdated = new EventEmitter<DeepLinkProgress>();

		this._disposables.push(
			container.uri.onDidReceiveUri(async (uri: Uri) => {
				const link = parseDeepLinkUri(uri);
				if (link == null) return;

				if (this._context.state === DeepLinkServiceState.Idle) {
					if (!link.repoId || !link.type || !link.remoteUrl) {
						void window.showErrorMessage('Unable to resolve link');
						Logger.warn(`Unable to resolve link - missing basic properties: ${uri.toString()}`);
						return;
					}

					if (!Object.values(DeepLinkType).includes(link.type)) {
						void window.showErrorMessage('Unable to resolve link');
						Logger.warn(`Unable to resolve link - unknown link type: ${uri.toString()}`);
						return;
					}

					if (link.type !== DeepLinkType.Repository && !link.targetId) {
						void window.showErrorMessage('Unable to resolve link');
						Logger.warn(`Unable to resolve link - no target id provided: ${uri.toString()}`);
						return;
					}

					this.setContextFromDeepLink(link, uri.toString());

					await this.processDeepLink();
				}
			}),
		);

		const pendingDeepLink = this.container.storage.get('deepLinks:pending');
		if (pendingDeepLink != null) {
			void this.container.storage.delete('deepLinks:pending');
			void this.processPendingDeepLink(pendingDeepLink);
		}
	}

	dispose() {
		Disposable.from(...this._disposables).dispose();
	}

	private resetContext() {
		this._context = {
			state: DeepLinkServiceState.Idle,
			url: undefined,
			repoId: undefined,
			repo: undefined,
			remoteUrl: undefined,
			remote: undefined,
			targetId: undefined,
			targetType: undefined,
			targetSha: undefined,
		};
	}

	private setContextFromDeepLink(link: DeepLink, url: string) {
		this._context = {
			...this._context,
			repoId: link.repoId,
			targetType: link.type,
			url: url,
			remoteUrl: link.remoteUrl,
			targetId: link.targetId,
		};
	}

	private async processPendingDeepLink(pendingDeepLink: StoredDeepLinkContext) {
		if (pendingDeepLink.url == null) return;

		const link = parseDeepLinkUri(Uri.parse(pendingDeepLink.url));
		if (link == null) return;

		this._context = { state: DeepLinkServiceState.CloneOrAddRepo };
		this.setContextFromDeepLink(link, pendingDeepLink.url);

		let action = DeepLinkServiceAction.OpenRepo;

		if (pendingDeepLink.repoPath != null) {
			const repoOpenUri = Uri.parse(pendingDeepLink.repoPath);
			try {
				const repo = await this.container.git.getOrOpenRepository(repoOpenUri, { detectNested: false });
				if (repo != null) {
					this._context.repo = repo;
					action = DeepLinkServiceAction.RepoOpened;
				}
			} catch {}
		}

		queueMicrotask(() => {
			void this.processDeepLink(action);
		});
	}

	private async getShaForTarget(): Promise<string | undefined> {
		const { repo, remote, targetType, targetId } = this._context;
		if (!repo || !remote || targetType === DeepLinkType.Repository || !targetId) {
			return undefined;
		}

		if (targetType === DeepLinkType.Branch) {
			// Form the target branch name using the remote name and branch name
			const branchName = `${remote.name}/${targetId}`;
			let branch = await repo.getBranch(branchName);
			if (branch) {
				return branch.sha;
			}

			// If it doesn't exist on the target remote, it may still exist locally.
			branch = await repo.getBranch(targetId);
			if (branch) {
				return branch.sha;
			}

			return undefined;
		}

		if (targetType === DeepLinkType.Tag) {
			const tag = await repo.getTag(targetId);
			if (tag) {
				return tag.sha;
			}

			return undefined;
		}

		if (targetType === DeepLinkType.Commit) {
			if (await this.container.git.validateReference(repo.path, targetId)) {
				return targetId;
			}

			return undefined;
		}

		return undefined;
	}

	private async showOpenTypePrompt(): Promise<DeepLinkRepoOpenType | undefined> {
		const openTypeResult = await window.showInformationMessage(
			'No matching repository found. Please choose an option.',
			{ modal: true },
			{ title: 'Open Folder', action: DeepLinkRepoOpenType.Folder },
			{ title: 'Open Workspace', action: DeepLinkRepoOpenType.Workspace },
			{ title: 'Clone', action: DeepLinkRepoOpenType.Clone },
			{ title: 'Cancel', isCloseAffordance: true },
		);

		return openTypeResult?.action;
	}

	private async showOpenLocationPrompt(openType: DeepLinkRepoOpenType): Promise<OpenWorkspaceLocation | undefined> {
		// Only add the "add to workspace" option if openType is DeepLinkRepoOpenType.Folder
		const openOptions: { title: string; action?: OpenWorkspaceLocation; isCloseAffordance?: boolean }[] = [
			{ title: 'Open', action: OpenWorkspaceLocation.CurrentWindow },
			{ title: 'Open in New Window', action: OpenWorkspaceLocation.NewWindow },
		];

		if (openType !== DeepLinkRepoOpenType.Workspace) {
			openOptions.push({ title: 'Add to Workspace', action: OpenWorkspaceLocation.AddToWorkspace });
		}

		openOptions.push({ title: 'Cancel', isCloseAffordance: true });
		const openLocationResult = await window.showInformationMessage(
			`Please choose an option to open the repository ${
				openType === DeepLinkRepoOpenType.Clone ? 'after cloning' : openType
			}.`,
			{ modal: true },
			...openOptions,
		);

		return openLocationResult?.action;
	}

	private async showFetchPrompt(): Promise<boolean> {
		const fetchResult = await window.showInformationMessage(
			"The link target couldn't be found. Would you like to fetch from the remote?",
			{ modal: true },
			{ title: 'Fetch', action: true },
			{ title: 'Cancel', isCloseAffordance: true },
		);

		return fetchResult?.action || false;
	}

	private async showAddRemotePrompt(remoteUrl: string, existingRemoteNames: string[]): Promise<string | undefined> {
		let remoteName = undefined;
		const result = await window.showInformationMessage(
			`Unable to find a remote for '${remoteUrl}'. Would you like to add a new remote?`,
			{ modal: true },
			{ title: 'Yes' },
			{ title: 'No', isCloseAffordance: true },
		);
		if (result?.title !== 'Yes') return remoteName;

		remoteName = await window.showInputBox({
			prompt: 'Enter a name for the remote',
			validateInput: value => {
				if (!value) return 'A name is required';
				if (existingRemoteNames.includes(value)) return 'A remote with that name already exists';
				return undefined;
			},
		});

		return remoteName;
	}

	private async processDeepLink(
		initialAction: DeepLinkServiceAction = DeepLinkServiceAction.DeepLinkEventFired,
	): Promise<void> {
		let message = '';
		let action = initialAction;

		// Remote match
		let matchingRemotes: GitRemote[] = [];
		let remoteDomain = '';
		let remotePath = '';
		let remoteName = undefined;

		// Repo open/clone
		let repoOpenType;
		let repoOpenLocation;
		let repoOpenUri: Uri | undefined = undefined;
		let repoClonePath: string | undefined = undefined;

		queueMicrotask(
			() =>
				void window.withProgress(
					{
						cancellable: true,
						location: ProgressLocation.Notification,
						title: `Opening repository for link: ${this._context.url}}`,
					},
					(progress, token) => {
						progress.report({ increment: 0 });
						return new Promise<void>(resolve => {
							token.onCancellationRequested(() => {
								queueMicrotask(() => this.processDeepLink(DeepLinkServiceAction.DeepLinkCancelled));
								resolve();
							});

							this._disposables.push(
								this._onDeepLinkProgressUpdated.event(({ message, increment }) => {
									progress.report({ message: message, increment: increment });
									if (increment === 100) {
										resolve();
									}
								}),
							);
						});
					},
				),
		);

		while (true) {
			this._context.state = deepLinkStateTransitionTable[this._context.state][action];
			const { state, repoId, repo, url, remoteUrl, remote, targetSha, targetType } = this._context;
			this._onDeepLinkProgressUpdated.fire(deepLinkStateToProgress[state]);
			switch (state) {
				case DeepLinkServiceState.Idle:
					if (action === DeepLinkServiceAction.DeepLinkErrored) {
						void window.showErrorMessage('Unable to resolve link');
						Logger.warn(`Unable to resolve link - ${message}: ${url}`);
					}

					// Deep link processing complete. Reset the context and return.
					this.resetContext();
					return;
				case DeepLinkServiceState.RepoMatch:
				case DeepLinkServiceState.AddedRepoMatch:
					if (!repoId || !remoteUrl) {
						action = DeepLinkServiceAction.DeepLinkErrored;
						message = 'No repository id or remote url was provided.';
						break;
					}

					[, remoteDomain, remotePath] = parseGitRemoteUrl(remoteUrl);
					// Try to match a repo using the remote URL first, since that saves us some steps.
					// As a fallback, try to match using the repo id.
					for (const repo of this.container.git.repositories) {
						// eslint-disable-next-line no-loop-func
						matchingRemotes = await repo.getRemotes({ filter: r => r.matches(remoteDomain, remotePath) });
						if (matchingRemotes.length > 0) {
							this._context.repo = repo;
							this._context.remote = matchingRemotes[0];
							action = DeepLinkServiceAction.RepoMatchedWithRemoteUrl;
							break;
						}

						// Repo ID can be any valid SHA in the repo, though standard practice is to use the
						// first commit SHA.
						if (await this.container.git.validateReference(repo.path, repoId)) {
							this._context.repo = repo;
							action = DeepLinkServiceAction.RepoMatchedWithId;
							break;
						}
					}

					if (!this._context.repo) {
						if (state === DeepLinkServiceState.RepoMatch) {
							action = DeepLinkServiceAction.RepoMatchFailed;
						} else {
							action = DeepLinkServiceAction.DeepLinkErrored;
							message = 'No matching repository found.';
						}
					}

					break;

				case DeepLinkServiceState.CloneOrAddRepo:
					if (!repoId || !remoteUrl) {
						action = DeepLinkServiceAction.DeepLinkErrored;
						message = 'Missing repository id or remote url.';
						break;
					}

					repoOpenType = await this.showOpenTypePrompt();
					if (!repoOpenType) {
						action = DeepLinkServiceAction.DeepLinkCancelled;
						break;
					}

					repoOpenLocation = await this.showOpenLocationPrompt(repoOpenType);
					if (!repoOpenLocation) {
						action = DeepLinkServiceAction.DeepLinkCancelled;
						break;
					}

					repoOpenUri = (
						await window.showOpenDialog({
							title: `Choose a ${
								repoOpenType === DeepLinkRepoOpenType.Workspace ? 'workspace' : 'folder'
							} to ${
								repoOpenType === DeepLinkRepoOpenType.Clone
									? 'clone the repository to'
									: 'open the repository'
							}`,
							canSelectFiles: repoOpenType === DeepLinkRepoOpenType.Workspace,
							canSelectFolders: repoOpenType !== DeepLinkRepoOpenType.Workspace,
							canSelectMany: false,
							...(repoOpenType === DeepLinkRepoOpenType.Workspace && {
								filters: { Workspaces: ['code-workspace'] },
							}),
						})
					)?.[0];

					if (!repoOpenUri) {
						action = DeepLinkServiceAction.DeepLinkCancelled;
						break;
					}

					if (repoOpenUri != null && repoOpenType === DeepLinkRepoOpenType.Clone) {
						// clone the repository, then set repoOpenUri to the repo path
						try {
							repoClonePath = await window.withProgress(
								{
									location: ProgressLocation.Notification,
									title: `Cloning repository for link: ${this._context.url}}`,
								},
								// eslint-disable-next-line no-loop-func
								async () => this.container.git.clone(remoteUrl, repoOpenUri?.fsPath ?? ''),
							);
						} catch {
							action = DeepLinkServiceAction.DeepLinkErrored;
							message = 'Unable to clone repository';
							break;
						}

						if (!repoClonePath) {
							action = DeepLinkServiceAction.DeepLinkErrored;
							message = 'Unable to clone repository';
							break;
						}

						repoOpenUri = Uri.file(repoClonePath);
					}

					if (
						repoOpenLocation === OpenWorkspaceLocation.AddToWorkspace &&
						(workspace.workspaceFolders?.length || 0) > 1
					) {
						action = DeepLinkServiceAction.OpenRepo;
					} else {
						// Deep link will resolve in a different service instance
						await this.container.storage.store('deepLinks:pending', {
							url: this._context.url,
							repoPath: repoOpenUri.toString(),
						});
						action = DeepLinkServiceAction.DeepLinkStored;
					}

					openWorkspace(repoOpenUri, { location: repoOpenLocation });
					break;

				case DeepLinkServiceState.OpeningRepo:
					this._disposables.push(
						once(this.container.git.onDidChangeRepositories)(() => {
							queueMicrotask(() => this.processDeepLink(DeepLinkServiceAction.RepoAdded));
						}),
					);
					return;

				case DeepLinkServiceState.RemoteMatch:
					if (!repo || !remoteUrl) {
						action = DeepLinkServiceAction.DeepLinkErrored;
						message = 'Missing repository or remote url.';
						break;
					}

					matchingRemotes = await repo.getRemotes({ filter: r => r.url === remoteUrl });
					if (matchingRemotes.length > 0) {
						this._context.remote = matchingRemotes[0];
						action = DeepLinkServiceAction.RemoteMatched;
						break;
					}

					if (!this._context.remote) {
						action = DeepLinkServiceAction.RemoteMatchFailed;
					}

					break;

				case DeepLinkServiceState.AddRemote:
					if (!repo || !remoteUrl) {
						action = DeepLinkServiceAction.DeepLinkErrored;
						message = 'Missing repository or remote url.';
						break;
					}

					remoteName = await this.showAddRemotePrompt(
						remoteUrl,
						(await repo.getRemotes()).map(r => r.name),
					);

					if (!remoteName) {
						action = DeepLinkServiceAction.DeepLinkCancelled;
						break;
					}

					try {
						await repo.addRemote(remoteName, remoteUrl, { fetch: true });
					} catch {
						action = DeepLinkServiceAction.DeepLinkErrored;
						message = 'Failed to add remote.';
						break;
					}

					[this._context.remote] = await repo.getRemotes({ filter: r => r.url === remoteUrl });
					if (!this._context.remote) {
						action = DeepLinkServiceAction.DeepLinkErrored;
						message = 'Failed to add remote.';
						break;
					}

					action = DeepLinkServiceAction.RemoteAdded;
					break;

				case DeepLinkServiceState.TargetMatch:
				case DeepLinkServiceState.FetchedTargetMatch:
					if (!repo || !remote || !targetType) {
						action = DeepLinkServiceAction.DeepLinkErrored;
						message = 'Missing repository, remote, or target type.';
						break;
					}

					if (targetType === DeepLinkType.Repository) {
						action = DeepLinkServiceAction.TargetMatched;
						break;
					}

					this._context.targetSha = await this.getShaForTarget();
					if (!this._context.targetSha) {
						if (state === DeepLinkServiceState.TargetMatch) {
							action = DeepLinkServiceAction.TargetMatchFailed;
						} else {
							action = DeepLinkServiceAction.DeepLinkErrored;
							message = 'No matching target found.';
						}
						break;
					}

					action = DeepLinkServiceAction.TargetMatched;
					break;

				case DeepLinkServiceState.Fetch:
					if (!repo || !remote) {
						action = DeepLinkServiceAction.DeepLinkErrored;
						message = 'Missing repository or remote.';
						break;
					}

					if (!(await this.showFetchPrompt())) {
						action = DeepLinkServiceAction.DeepLinkCancelled;
						break;
					}

					try {
						await repo.fetch({ remote: remote.name, progress: true });
					} catch {
						action = DeepLinkServiceAction.DeepLinkErrored;
						message = 'Error fetching remote.';
						break;
					}

					action = DeepLinkServiceAction.TargetFetched;
					break;

				case DeepLinkServiceState.OpenGraph:
					if (!repo || !targetType) {
						action = DeepLinkServiceAction.DeepLinkErrored;
						message = 'Missing repository or target type.';
						break;
					}

					if (targetType === DeepLinkType.Repository) {
						void (await executeCommand(Commands.ShowInCommitGraph, repo));
						action = DeepLinkServiceAction.DeepLinkResolved;
						break;
					}

					if (!targetSha) {
						action = DeepLinkServiceAction.DeepLinkErrored;
						message = `Cannot find target ${targetType} in repo.`;
						break;
					}

					void (await executeCommand<ShowInCommitGraphCommandArgs>(Commands.ShowInCommitGraph, {
						ref: createReference(targetSha, repo.path),
					}));

					action = DeepLinkServiceAction.DeepLinkResolved;
					break;

				default:
					action = DeepLinkServiceAction.DeepLinkErrored;
					message = 'Unknown state.';
					break;
			}
		}
	}

	async copyDeepLinkUrl(ref: GitReference, remoteUrl: string): Promise<void>;
	async copyDeepLinkUrl(
		repoPath: string,
		remoteUrl: string,
		targetType?: DeepLinkType,
		targetId?: string,
	): Promise<void>;
	async copyDeepLinkUrl(
		refOrRepoPath: string | GitReference,
		remoteUrl: string,
		targetType?: DeepLinkType,
		targetId?: string,
	): Promise<void> {
		const url = await (typeof refOrRepoPath !== 'string'
			? this.generateDeepLinkUrl(refOrRepoPath, remoteUrl)
			: this.generateDeepLinkUrl(refOrRepoPath, remoteUrl, targetType, targetId));
		await env.clipboard.writeText(url.toString());
	}

	async generateDeepLinkUrl(ref: GitReference, remoteUrl: string): Promise<URL>;
	async generateDeepLinkUrl(
		repoPath: string,
		remoteUrl: string,
		targetType?: DeepLinkType,
		targetId?: string,
	): Promise<URL>;
	async generateDeepLinkUrl(
		refOrRepoPath: string | GitReference,
		remoteUrl: string,
		targetType?: DeepLinkType,
		targetId?: string,
	): Promise<URL> {
		const repoPath = typeof refOrRepoPath !== 'string' ? refOrRepoPath.repoPath : refOrRepoPath;
		const repoId = (await this.container.git.getUniqueRepositoryId(repoPath)) ?? '0';

		if (typeof refOrRepoPath !== 'string') {
			switch (refOrRepoPath.refType) {
				case 'branch':
					targetType = DeepLinkType.Branch;
					targetId = refOrRepoPath.remote
						? getBranchNameWithoutRemote(refOrRepoPath.name)
						: refOrRepoPath.name;
					break;
				case 'revision':
					targetType = DeepLinkType.Commit;
					targetId = refOrRepoPath.ref;
					break;
				case 'tag':
					targetType = DeepLinkType.Tag;
					targetId = refOrRepoPath.name;
					break;
			}
		}

		const schemeOverride = configuration.get('deepLinks.schemeOverride');
		const scheme = !schemeOverride ? 'vscode' : schemeOverride === true ? env.uriScheme : schemeOverride;
		const target = targetType != null && targetType !== DeepLinkType.Repository ? `/${targetType}/${targetId}` : '';

		// Start with the prefix, add the repo prefix and the repo ID to the URL, and then add the target tag and target ID to the URL (if applicable)
		const url = new URL(
			`${scheme}://${this.container.context.extension.id}/${UriTypes.DeepLink}/${DeepLinkType.Repository}/${repoId}${target}`,
		);

		// Add the remote URL as a query parameter
		url.searchParams.set('url', remoteUrl);
		const params = new URLSearchParams();
		params.set('url', remoteUrl);
		return url;
	}
}

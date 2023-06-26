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
import { normalizePath } from '../../system/path';
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
					if (!link.type || (!link.repoId && !link.remoteUrl && !link.repoPath)) {
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

					if (link.type === DeepLinkType.Comparison && !link.secondaryTargetId) {
						void window.showErrorMessage('Unable to resolve link');
						Logger.warn(`Unable to resolve link - no secondary target id provided: ${uri.toString()}`);
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
			repoPath: undefined,
			targetId: undefined,
			secondaryTargetId: undefined,
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
			repoPath: link.repoPath,
			targetId: link.targetId,
			secondaryTargetId: link.secondaryTargetId,
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

	private async getShaForBranch(targetId: string): Promise<string | undefined> {
		const { repo, remote } = this._context;
		if (!repo) return undefined;

		// Form the target branch name using the remote name and branch name
		const branchName = remote != null ? `${remote.name}/${targetId}` : targetId;
		let branch = await repo.getBranch(branchName);
		if (branch?.sha != null) {
			return branch.sha;
		}

		// If it doesn't exist on the target remote, it may still exist locally.
		branch = await repo.getBranch(targetId);
		if (branch?.sha != null) {
			return branch.sha;
		}

		return undefined;
	}

	private async getShaForTag(targetId: string): Promise<string | undefined> {
		const { repo } = this._context;
		if (!repo) return undefined;
		const tag = await repo.getTag(targetId);
		if (tag?.sha != null) {
			return tag.sha;
		}

		return undefined;
	}

	private async getShaForCommit(targetId: string): Promise<string | undefined> {
		const { repo } = this._context;
		if (!repo) return undefined;
		if (await this.container.git.validateReference(repo.path, targetId)) {
			return targetId;
		}

		return undefined;
	}

	private async getShasForComparison(
		targetId: string,
		secondaryTargetId: string,
	): Promise<[string, string] | undefined> {
		// try treating each id as a commit sha first, then a branch if that fails, then a tag if that fails
		const sha1 =
			(await this.getShaForCommit(targetId)) ??
			(await this.getShaForBranch(targetId)) ??
			(await this.getShaForTag(targetId));
		if (sha1 == null) return undefined;
		const sha2 =
			(await this.getShaForCommit(secondaryTargetId)) ??
			(await this.getShaForBranch(secondaryTargetId)) ??
			(await this.getShaForTag(secondaryTargetId));
		if (sha2 == null) return undefined;
		return [sha1, sha2];
	}

	private async getShasForTargets(): Promise<string | string[] | undefined> {
		const { repo, targetType, targetId, secondaryTargetId } = this._context;
		if (repo == null || targetType === DeepLinkType.Repository || targetId == null) return undefined;
		if (targetType === DeepLinkType.Branch) {
			return this.getShaForBranch(targetId);
		}

		if (targetType === DeepLinkType.Tag) {
			return this.getShaForTag(targetId);
		}

		if (targetType === DeepLinkType.Commit) {
			return this.getShaForCommit(targetId);
		}

		if (targetType === DeepLinkType.Comparison) {
			if (secondaryTargetId == null) return undefined;
			return this.getShasForComparison(targetId, secondaryTargetId);
		}

		return undefined;
	}

	private async showOpenTypePrompt(): Promise<DeepLinkRepoOpenType | undefined> {
		const options: { title: string; action?: DeepLinkRepoOpenType; isCloseAffordance?: boolean }[] = [
			{ title: 'Open Folder', action: DeepLinkRepoOpenType.Folder },
			{ title: 'Open Workspace', action: DeepLinkRepoOpenType.Workspace },
		];

		if (this._context.remoteUrl != null) {
			options.push({ title: 'Clone', action: DeepLinkRepoOpenType.Clone });
		}

		options.push({ title: 'Cancel', isCloseAffordance: true });
		const openTypeResult = await window.showInformationMessage(
			'No matching repository found. Please choose an option.',
			{ modal: true },
			...options,
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
			"The link target(s) couldn't be found. Would you like to fetch from the remote?",
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
			const { state, repoId, repo, url, remoteUrl, remote, repoPath, targetSha, secondaryTargetSha, targetType } =
				this._context;
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
					if (!repoId && !remoteUrl && !repoPath) {
						action = DeepLinkServiceAction.DeepLinkErrored;
						message = 'No repository id, remote url or path was provided.';
						break;
					}

					if (remoteUrl != null) {
						[, remoteDomain, remotePath] = parseGitRemoteUrl(remoteUrl);
					}
					// Try to match a repo using the remote URL first, since that saves us some steps.
					// As a fallback, try to match using the repo id.
					for (const repo of this.container.git.repositories) {
						if (
							repoPath != null &&
							normalizePath(repo.path.toLowerCase()) === normalizePath(repoPath.toLowerCase())
						) {
							this._context.repo = repo;
							action = DeepLinkServiceAction.RepoMatchedWithPath;
							break;
						}

						if (remoteDomain != null && remotePath != null) {
							matchingRemotes = await repo.getRemotes({
								// eslint-disable-next-line no-loop-func
								filter: r => r.matches(remoteDomain, remotePath),
							});
							if (matchingRemotes.length > 0) {
								this._context.repo = repo;
								this._context.remote = matchingRemotes[0];
								action = DeepLinkServiceAction.RepoMatchedWithRemoteUrl;
								break;
							}
						}

						if (repoId != null && repoId !== '-') {
							// Repo ID can be any valid SHA in the repo, though standard practice is to use the
							// first commit SHA.
							if (await this.container.git.validateReference(repo.path, repoId)) {
								this._context.repo = repo;
								action = DeepLinkServiceAction.RepoMatchedWithId;
								break;
							}
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
					if (!repoId && !remoteUrl && !repoPath) {
						action = DeepLinkServiceAction.DeepLinkErrored;
						message = 'Missing repository id, remote url and path.';
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

					if (repoOpenUri != null && remoteUrl != null && repoOpenType === DeepLinkRepoOpenType.Clone) {
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
					if (!repo || !targetType) {
						action = DeepLinkServiceAction.DeepLinkErrored;
						message = 'Missing repository or target type.';
						break;
					}

					if (targetType === DeepLinkType.Repository) {
						action = DeepLinkServiceAction.TargetMatched;
						break;
					}

					if (targetType === DeepLinkType.Comparison) {
						[this._context.targetSha, this._context.secondaryTargetSha] =
							(await this.getShasForTargets()) ?? [];
					} else {
						this._context.targetSha = (await this.getShasForTargets()) as string | undefined;
					}

					if (
						this._context.targetSha == null ||
						(this._context.secondaryTargetSha == null && targetType === DeepLinkType.Comparison)
					) {
						if (state === DeepLinkServiceState.TargetMatch && remote != null) {
							action = DeepLinkServiceAction.TargetMatchFailed;
						} else {
							action = DeepLinkServiceAction.DeepLinkErrored;
							message = `No matching ${targetSha == null ? 'target' : 'secondary target'} found.`;
						}
						break;
					}

					action =
						targetType === DeepLinkType.Comparison
							? DeepLinkServiceAction.TargetsMatched
							: DeepLinkServiceAction.TargetMatched;
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

				case DeepLinkServiceState.OpenComparison:
					if (!repo) {
						action = DeepLinkServiceAction.DeepLinkErrored;
						message = 'Missing repository.';
						break;
					}

					if (!targetSha || !secondaryTargetSha) {
						action = DeepLinkServiceAction.DeepLinkErrored;
						message = 'Missing target or secondary target.';
						break;
					}

					await this.container.searchAndCompareView.compare(repo.path, targetSha, secondaryTargetSha);
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
		const repoId = await this.container.git.getUniqueRepositoryId(repoPath);

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

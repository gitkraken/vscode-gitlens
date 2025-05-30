import { Disposable, env, EventEmitter, ProgressLocation, Range, Uri, window, workspace } from 'vscode';
import type { StoredDeepLinkContext, StoredNamedRef } from '../../constants';
import { Commands } from '../../constants';
import type { Container } from '../../container';
import { executeGitCommand } from '../../git/actions';
import { openFileAtRevision } from '../../git/actions/commit';
import type { GitBranch } from '../../git/models/branch';
import { getBranchNameWithoutRemote } from '../../git/models/branch';
import type { GitCommit } from '../../git/models/commit';
import type { GitReference } from '../../git/models/reference';
import { createReference, isSha } from '../../git/models/reference';
import type { GitTag } from '../../git/models/tag';
import { parseGitRemoteUrl } from '../../git/parsers/remoteParser';
import type { RepositoryIdentity } from '../../gk/models/repositoryIdentities';
import { missingRepositoryId } from '../../gk/models/repositoryIdentities';
import { ensureAccount, ensurePaidPlan } from '../../plus/utils';
import type { ShowInCommitGraphCommandArgs } from '../../plus/webviews/graph/protocol';
import { executeCommand } from '../../system/command';
import { configuration } from '../../system/configuration';
import { once } from '../../system/event';
import { Logger } from '../../system/logger';
import { normalizePath } from '../../system/path';
import type { OpenWorkspaceLocation } from '../../system/utils';
import { findOrOpenEditor, openWorkspace } from '../../system/utils';
import type { DeepLink, DeepLinkProgress, DeepLinkRepoOpenType, DeepLinkServiceContext, UriTypes } from './deepLink';
import {
	AccountDeepLinkTypes,
	DeepLinkServiceAction,
	DeepLinkServiceState,
	deepLinkStateToProgress,
	deepLinkStateTransitionTable,
	DeepLinkType,
	deepLinkTypeToString,
	PaidDeepLinkTypes,
	parseDeepLinkUri,
} from './deepLink';

export class DeepLinkService implements Disposable {
	private readonly _disposables: Disposable[] = [];
	private _context: DeepLinkServiceContext;
	private readonly _onDeepLinkProgressUpdated = new EventEmitter<DeepLinkProgress>();

	constructor(private readonly container: Container) {
		this._context = {
			state: DeepLinkServiceState.Idle,
		};

		this._disposables.push(
			container.uri.onDidReceiveUri(async (uri: Uri) => {
				const link = parseDeepLinkUri(uri);
				if (link == null) return;

				if (this._context.state === DeepLinkServiceState.Idle) {
					if (this.container.git.isDiscoveringRepositories) {
						await this.container.git.isDiscoveringRepositories;
					}

					if (!link.type || (!link.mainId && !link.remoteUrl && !link.repoPath && !link.targetId)) {
						void window.showErrorMessage('Unable to resolve link');
						Logger.warn(`Unable to resolve link - missing basic properties: ${uri.toString()}`);
						return;
					}

					if (!Object.values(DeepLinkType).includes(link.type)) {
						void window.showErrorMessage('Unable to resolve link');
						Logger.warn(`Unable to resolve link - unknown link type: ${uri.toString()}`);
						return;
					}

					if (link.type !== DeepLinkType.Repository && link.targetId == null && link.mainId == null) {
						void window.showErrorMessage('Unable to resolve link');
						Logger.warn(`Unable to resolve link - no main/target id provided: ${uri.toString()}`);
						return;
					}

					if (link.type === DeepLinkType.Comparison && link.secondaryTargetId == null) {
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
			mainId: undefined,
			repo: undefined,
			remoteUrl: undefined,
			remote: undefined,
			secondaryRemote: undefined,
			repoPath: undefined,
			filePath: undefined,
			targetId: undefined,
			secondaryTargetId: undefined,
			secondaryRemoteUrl: undefined,
			targetType: undefined,
			targetSha: undefined,
			action: undefined,
		};
	}

	private setContextFromDeepLink(link: DeepLink, url: string) {
		this._context = {
			...this._context,
			mainId: link.mainId,
			targetType: link.type,
			url: url,
			remoteUrl: link.remoteUrl,
			repoPath: link.repoPath,
			filePath: link.filePath,
			targetId: link.targetId,
			secondaryTargetId: link.secondaryTargetId,
			secondaryRemoteUrl: link.secondaryRemoteUrl,
			action: link.action,
		};
	}

	private async processPendingDeepLink(pendingDeepLink: StoredDeepLinkContext) {
		if (pendingDeepLink.url == null) return;

		const link = parseDeepLinkUri(Uri.parse(pendingDeepLink.url));
		if (link == null) return;

		this._context = { state: DeepLinkServiceState.CloneOrAddRepo };
		this.setContextFromDeepLink(link, pendingDeepLink.url);

		let action = DeepLinkServiceAction.OpenRepo;

		if (this.container.git.isDiscoveringRepositories) {
			await this.container.git.isDiscoveringRepositories;
		}

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

	private async getBranch(targetId: string): Promise<GitBranch | undefined> {
		const { repo, remote, secondaryRemote } = this._context;
		if (!repo) return undefined;

		let branchName: string = targetId;

		// If the branch name doesn't start with a remote name, first try using the primary and secondary remotes
		if (remote != null && !branchName.startsWith(`${remote.name}/`)) {
			branchName = `${remote.name}/${branchName}`;
		} else if (secondaryRemote != null && !branchName.startsWith(`${secondaryRemote.name}/`)) {
			branchName = `${secondaryRemote.name}/${branchName}`;
		}

		let branch = await repo.getBranch(branchName);
		if (branch != null) {
			return branch;
		}

		// If that fails, try matching to any existing remote using its path.
		if (targetId.includes(':')) {
			const [providerRepoInfo, branchBaseName] = targetId.split(':');
			if (providerRepoInfo != null && branchName != null) {
				const [owner, repoName] = providerRepoInfo.split('/');
				if (owner != null && repoName != null) {
					const remotes = await repo.getRemotes();
					for (const remote of remotes) {
						if (remote.provider?.owner === owner) {
							branchName = `${remote.name}/${branchBaseName}`;
							branch = await repo.getBranch(branchName);
							if (branch != null) {
								return branch;
							}
						}
					}
				}
			}
		}

		// If the above don't work, it may still exist locally.
		return repo.getBranch(targetId);
	}

	private async getCommit(targetId: string): Promise<GitCommit | undefined> {
		const { repo } = this._context;
		if (!repo) return undefined;
		if (await this.container.git.validateReference(repo.path, targetId)) {
			return repo.getCommit(targetId);
		}

		return undefined;
	}

	private async getTag(targetId: string): Promise<GitTag | undefined> {
		const { repo } = this._context;
		return repo?.getTag(targetId);
	}

	private async getShaForBranch(targetId: string): Promise<string | undefined> {
		return (await this.getBranch(targetId))?.sha;
	}

	private async getShaForTag(targetId: string): Promise<string | undefined> {
		return (await this.getTag(targetId))?.sha;
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
		const sha1 = await this.getRefSha(targetId);
		if (sha1 == null) return undefined;
		const sha2 = await this.getRefSha(secondaryTargetId);
		if (sha2 == null) return undefined;
		return [sha1, sha2];
	}

	private async getRefSha(ref: string) {
		// try treating each id as a commit sha first, then a branch if that fails, then a tag if that fails.
		// Note: a blank target id will be treated as 'Working Tree' and will resolve to a blank Sha.

		if (ref === '') return ref;

		if (isSha(ref)) return this.getShaForCommit(ref);

		const normalized = ref.toLocaleLowerCase();
		if (!normalized.startsWith('refs/tags/') && !normalized.startsWith('tags/')) {
			const branchSha = await this.getShaForBranch(ref);
			if (branchSha != null) return branchSha;
		}

		const tagSha = await this.getShaForTag(ref);
		if (tagSha != null) return tagSha;

		return this.getShaForCommit(ref);
	}

	private async getTargetRef(ref: string): Promise<GitReference | undefined> {
		if (ref === '') return undefined;
		if (isSha(ref)) return this.getCommit(ref);

		const normalized = ref.toLocaleLowerCase();
		if (!normalized.startsWith('refs/tags/') && !normalized.startsWith('tags/')) {
			const branch = await this.getBranch(ref);
			if (branch != null) return branch;
		}

		const tag = await this.getTag(ref);
		if (tag != null) return tag;

		return this.getCommit(ref);
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

		if (targetType === DeepLinkType.File) {
			return this.getRefSha(targetId);
		}

		if (targetType === DeepLinkType.Comparison) {
			if (secondaryTargetId == null) return undefined;
			return this.getShasForComparison(targetId, secondaryTargetId);
		}

		return undefined;
	}

	private async showOpenTypePrompt(options?: {
		includeCurrent?: boolean;
		customMessage?: string;
	}): Promise<DeepLinkRepoOpenType | undefined> {
		const openOptions: { title: string; action?: DeepLinkRepoOpenType; isCloseAffordance?: boolean }[] = [
			{ title: 'Open Folder', action: 'folder' },
			{ title: 'Open Workspace', action: 'workspace' },
		];

		if (this._context.remoteUrl != null) {
			openOptions.push({ title: 'Clone', action: 'clone' });
		}

		if (options?.includeCurrent) {
			openOptions.push({ title: 'Use Current Window', action: 'current' });
		}

		openOptions.push({ title: 'Cancel', isCloseAffordance: true });
		const openTypeResult = await window.showInformationMessage(
			options?.customMessage ?? 'No matching repository found. Please choose an option.',
			{ modal: true },
			...openOptions,
		);

		return openTypeResult?.action;
	}

	private async showOpenLocationPrompt(openType: DeepLinkRepoOpenType): Promise<OpenWorkspaceLocation | undefined> {
		// Only add the "add to workspace" option if openType is 'folder'
		const openOptions: { title: string; action?: OpenWorkspaceLocation; isCloseAffordance?: boolean }[] = [
			{ title: 'Open', action: 'currentWindow' },
			{ title: 'Open in New Window', action: 'newWindow' },
		];

		if (openType !== 'workspace') {
			openOptions.push({ title: 'Add to Workspace', action: 'addToWorkspace' });
		}

		openOptions.push({ title: 'Cancel', isCloseAffordance: true });
		const openLocationResult = await window.showInformationMessage(
			`Please choose an option to open the repository ${openType === 'clone' ? 'after cloning' : openType}.`,
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
		if (action === DeepLinkServiceAction.DeepLinkCancelled && this._context.state === DeepLinkServiceState.Idle) {
			return;
		}

		//Repo match
		let matchingLocalRepoPaths: string[] = [];
		const { targetType } = this._context;

		queueMicrotask(
			() =>
				void window.withProgress(
					{
						cancellable: true,
						location: ProgressLocation.Notification,
						title: `Opening ${deepLinkTypeToString(targetType ?? DeepLinkType.Repository)} link...`,
					},
					(progress, token) => {
						progress.report({ increment: 0 });
						return new Promise<void>(resolve => {
							token.onCancellationRequested(() => {
								queueMicrotask(() => this.processDeepLink(DeepLinkServiceAction.DeepLinkCancelled));
								resolve();
							});

							this._onDeepLinkProgressUpdated.event(({ message, increment }) => {
								progress.report({ message: message, increment: increment });
								if (increment === 100) {
									resolve();
								}
							});
						});
					},
				),
		);

		while (true) {
			this._context.state = deepLinkStateTransitionTable[this._context.state][action];
			const {
				state,
				mainId,
				repo,
				url,
				remoteUrl,
				secondaryRemoteUrl,
				remote,
				secondaryRemote,
				repoPath,
				filePath,
				targetId,
				secondaryTargetId,
				targetSha,
				secondaryTargetSha,
				targetType,
			} = this._context;
			this._onDeepLinkProgressUpdated.fire(deepLinkStateToProgress[state]);
			switch (state) {
				case DeepLinkServiceState.Idle: {
					if (action === DeepLinkServiceAction.DeepLinkErrored) {
						void window.showErrorMessage('Unable to resolve link');
						Logger.warn(`Unable to resolve link - ${message}: ${url}`);
					}

					// Deep link processing complete. Reset the context and return.
					this.resetContext();
					return;
				}
				case DeepLinkServiceState.AccountCheck: {
					if (targetType == null) {
						action = DeepLinkServiceAction.DeepLinkErrored;
						message = 'No link type provided.';
						break;
					}
					if (!AccountDeepLinkTypes.includes(targetType)) {
						action = DeepLinkServiceAction.AccountCheckPassed;
						break;
					}

					if (
						!(await ensureAccount(
							`Opening ${deepLinkTypeToString(targetType)} links requires a GitKraken account.`,
							this.container,
						))
					) {
						action = DeepLinkServiceAction.DeepLinkErrored;
						message = 'Account required to open link';
						break;
					}

					action = DeepLinkServiceAction.AccountCheckPassed;
					break;
				}
				case DeepLinkServiceState.PlanCheck: {
					if (targetType == null) {
						action = DeepLinkServiceAction.DeepLinkErrored;
						message = 'No link type provided.';
						break;
					}
					if (!PaidDeepLinkTypes.includes(targetType)) {
						action = DeepLinkServiceAction.PlanCheckPassed;
						break;
					}

					if (
						!(await ensurePaidPlan(
							`A paid plan is required to open ${deepLinkTypeToString(targetType)} links.`,
							this.container,
						))
					) {
						action = DeepLinkServiceAction.DeepLinkErrored;
						message = 'Paid plan required to open link';
						break;
					}

					action = DeepLinkServiceAction.PlanCheckPassed;
					break;
				}
				case DeepLinkServiceState.TypeMatch: {
					switch (targetType) {
						case DeepLinkType.Draft:
							action = DeepLinkServiceAction.LinkIsDraftType;
							break;
						case DeepLinkType.Workspace:
							action = DeepLinkServiceAction.LinkIsWorkspaceType;
							break;
						default:
							action = DeepLinkServiceAction.LinkIsRepoType;
							break;
					}

					break;
				}
				case DeepLinkServiceState.RepoMatch:
				case DeepLinkServiceState.AddedRepoMatch: {
					if (!mainId && !remoteUrl && !repoPath) {
						action = DeepLinkServiceAction.DeepLinkErrored;
						message = 'No repository id, remote url or path was provided.';
						break;
					}

					let repoIdentity: RepositoryIdentity | undefined;

					let mainIdToSearch = mainId;
					let remoteUrlToSearch = remoteUrl;

					if (repoIdentity != null) {
						this._context.remoteUrl = repoIdentity.remote?.url ?? undefined;
						remoteUrlToSearch = repoIdentity.remote?.url;
						this._context.mainId = repoIdentity.initialCommitSha ?? undefined;
						mainIdToSearch = repoIdentity.initialCommitSha;
					}

					let remoteDomain = '';
					let remotePath = '';
					if (remoteUrlToSearch != null) {
						[, remoteDomain, remotePath] = parseGitRemoteUrl(remoteUrlToSearch);
					}
					// Try to match a repo using the remote URL first, since that saves us some steps.
					// As a fallback, try to match using the repo id.
					for (const repo of this.container.git.repositories) {
						if (
							repoPath != null &&
							normalizePath(repo.path.toLowerCase()) === normalizePath(repoPath.toLowerCase())
						) {
							this._context.repo = repo;
							action = DeepLinkServiceAction.RepoMatched;
							break;
						}

						if (remoteDomain != null && remotePath != null) {
							const matchingRemotes = await repo.getRemotes({
								filter: r => r.matches(remoteDomain, remotePath),
							});
							if (matchingRemotes.length > 0) {
								this._context.repo = repo;
								this._context.remote = matchingRemotes[0];
								action = DeepLinkServiceAction.RepoMatched;
								break;
							}
						}

						if (mainIdToSearch != null && mainIdToSearch !== missingRepositoryId) {
							// Repo ID can be any valid SHA in the repo, though standard practice is to use the
							// first commit SHA.
							if (await this.container.git.validateReference(repo.path, mainIdToSearch)) {
								this._context.repo = repo;
								action = DeepLinkServiceAction.RepoMatched;
								break;
							}
						}
					}

					if (!this._context.repo && state === DeepLinkServiceState.RepoMatch) {
						matchingLocalRepoPaths = await this.container.repositoryPathMapping.getLocalRepoPaths({
							remoteUrl: remoteUrlToSearch,
						});
						if (matchingLocalRepoPaths.length > 0) {
							for (const repo of this.container.git.repositories) {
								if (
									matchingLocalRepoPaths.some(
										p => normalizePath(repo.path.toLowerCase()) === normalizePath(p.toLowerCase()),
									)
								) {
									this._context.repo = repo;
									action = DeepLinkServiceAction.RepoMatched;
									break;
								}
							}

							if (this._context.repo == null) {
								action = DeepLinkServiceAction.RepoMatchedInLocalMapping;
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
				}
				case DeepLinkServiceState.CloneOrAddRepo: {
					if (!mainId && !remoteUrl && !repoPath) {
						action = DeepLinkServiceAction.DeepLinkErrored;
						message = 'Missing repository id, remote url and path.';
						break;
					}

					let chosenRepoPath: string | undefined;
					let repoOpenType: DeepLinkRepoOpenType | undefined;
					let repoOpenUri: Uri | undefined;

					if (matchingLocalRepoPaths.length > 0) {
						chosenRepoPath = await window.showQuickPick(
							[...matchingLocalRepoPaths, 'Choose a different location'],
							{ placeHolder: 'Matching repository found. Choose a location to open it.' },
						);

						if (chosenRepoPath == null) {
							action = DeepLinkServiceAction.DeepLinkCancelled;
							break;
						} else if (chosenRepoPath !== 'Choose a different location') {
							repoOpenUri = Uri.file(chosenRepoPath);
							repoOpenType = 'folder';
						}
					}

					if (repoOpenType == null) {
						repoOpenType = await this.showOpenTypePrompt({
							customMessage:
								chosenRepoPath === 'Choose a different location'
									? 'Please choose an option to open the repository'
									: undefined,
						});
					}

					if (!repoOpenType) {
						action = DeepLinkServiceAction.DeepLinkCancelled;
						break;
					}

					const repoOpenLocation = await this.showOpenLocationPrompt(repoOpenType);
					if (!repoOpenLocation) {
						action = DeepLinkServiceAction.DeepLinkCancelled;
						break;
					}

					if (repoOpenUri == null) {
						repoOpenUri = (
							await window.showOpenDialog({
								title: `Choose a ${repoOpenType === 'workspace' ? 'workspace' : 'folder'} to ${
									repoOpenType === 'clone' ? 'clone the repository to' : 'open the repository'
								}`,
								canSelectFiles: repoOpenType === 'workspace',
								canSelectFolders: repoOpenType !== 'workspace',
								canSelectMany: false,
								...(repoOpenType === 'workspace' && {
									filters: { Workspaces: ['code-workspace'] },
								}),
							})
						)?.[0];
					}

					if (!repoOpenUri) {
						action = DeepLinkServiceAction.DeepLinkCancelled;
						break;
					}

					if (repoOpenUri != null && remoteUrl != null && repoOpenType === 'clone') {
						// clone the repository, then set repoOpenUri to the repo path
						let repoClonePath;
						try {
							repoClonePath = await window.withProgress(
								{
									location: ProgressLocation.Notification,
									title: `Cloning repository for link: ${this._context.url}}`,
								},

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

					// Add the repo to the repo path mapping if it exists
					if (
						repoOpenType !== 'current' &&
						repoOpenType !== 'workspace' &&
						!matchingLocalRepoPaths.includes(repoOpenUri.fsPath)
					) {
						const chosenRepo = await this.container.git.getOrOpenRepository(repoOpenUri, {
							closeOnOpen: true,
							detectNested: false,
						});
						if (chosenRepo != null) {
							await this.container.repositoryPathMapping.writeLocalRepoPath(
								{ remoteUrl: remoteUrl },
								chosenRepo.uri.fsPath,
							);
						}
					}

					if (repoOpenLocation === 'addToWorkspace' && (workspace.workspaceFolders?.length || 0) > 1) {
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
				}
				case DeepLinkServiceState.OpeningRepo: {
					this._disposables.push(
						once(this.container.git.onDidChangeRepositories)(() => {
							queueMicrotask(() => this.processDeepLink(DeepLinkServiceAction.RepoAdded));
						}),
					);
					return;
				}
				case DeepLinkServiceState.RemoteMatch: {
					if (repoPath && repo && !remoteUrl && !secondaryRemoteUrl) {
						action = DeepLinkServiceAction.RemoteMatchUnneeded;
						break;
					}

					if (!repo || (!remoteUrl && !secondaryRemoteUrl)) {
						action = DeepLinkServiceAction.DeepLinkErrored;
						message = 'Missing repository or remote url.';
						break;
					}

					if (remoteUrl && !remote) {
						const matchingRemotes = await repo.getRemotes({ filter: r => r.url === remoteUrl });
						if (matchingRemotes.length > 0) {
							this._context.remote = matchingRemotes[0];
						}
					}

					if (secondaryRemoteUrl && !secondaryRemote) {
						const matchingRemotes = await repo.getRemotes({ filter: r => r.url === secondaryRemoteUrl });
						if (matchingRemotes.length > 0) {
							this._context.secondaryRemote = matchingRemotes[0];
						}
					}

					if (
						(remoteUrl && !this._context.remote) ||
						(secondaryRemoteUrl && !this._context.secondaryRemote)
					) {
						action = DeepLinkServiceAction.RemoteMatchFailed;
					} else {
						action = DeepLinkServiceAction.RemoteMatched;
					}

					break;
				}
				case DeepLinkServiceState.AddRemote: {
					if (!repo || (!remoteUrl && !secondaryRemoteUrl)) {
						action = DeepLinkServiceAction.DeepLinkErrored;
						message = 'Missing repository or remote url.';
						break;
					}

					let remoteName: string | undefined;
					let secondaryRemoteName: string | undefined;

					if (remoteUrl && !remote) {
						remoteName = await this.showAddRemotePrompt(
							remoteUrl,
							(await repo.getRemotes()).map(r => r.name),
						);

						if (remoteName) {
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
						}
					}

					if (secondaryRemoteUrl && !secondaryRemote) {
						secondaryRemoteName = await this.showAddRemotePrompt(
							secondaryRemoteUrl,
							(await repo.getRemotes()).map(r => r.name),
						);

						if (secondaryRemoteName) {
							try {
								await repo.addRemote(secondaryRemoteName, secondaryRemoteUrl, { fetch: true });
							} catch {
								action = DeepLinkServiceAction.DeepLinkErrored;
								message = 'Failed to add remote.';
								break;
							}

							[this._context.secondaryRemote] = await repo.getRemotes({
								filter: r => r.url === secondaryRemoteUrl,
							});
							if (!this._context.secondaryRemote) {
								action = DeepLinkServiceAction.DeepLinkErrored;
								message = 'Failed to add remote.';
								break;
							}
						}
					}

					if (this._context.secondaryRemote && !this._context.remote) {
						this._context.remote = this._context.secondaryRemote;
					}

					if (!remoteName && !secondaryRemoteName) {
						action = DeepLinkServiceAction.DeepLinkCancelled;
					} else if (!this._context.remote) {
						action = DeepLinkServiceAction.DeepLinkErrored;
						message = 'Failed to add remote.';
					}

					action = DeepLinkServiceAction.RemoteAdded;
					break;
				}
				case DeepLinkServiceState.TargetMatch:
				case DeepLinkServiceState.FetchedTargetMatch: {
					if (!repo || !targetType) {
						action = DeepLinkServiceAction.DeepLinkErrored;
						message = 'Missing repository or target type.';
						break;
					}

					if (targetType === DeepLinkType.Repository) {
						if (this._context.action === 'switch') {
							action = DeepLinkServiceAction.TargetMatchedForSwitch;
						} else {
							action = DeepLinkServiceAction.TargetMatchedForGraph;
						}
						break;
					}

					if (targetType === DeepLinkType.Comparison) {
						[this._context.targetSha, this._context.secondaryTargetSha] =
							(await this.getShasForTargets()) ?? [];
					} else if (targetType === DeepLinkType.File && targetId == null) {
						action = DeepLinkServiceAction.TargetMatchedForFile;
						break;
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

					switch (targetType) {
						case DeepLinkType.File:
							action = DeepLinkServiceAction.TargetMatchedForFile;
							break;
						case DeepLinkType.Comparison:
							action = DeepLinkServiceAction.TargetsMatchedForComparison;
							break;
						default:
							if (this._context.action === 'switch') {
								action = DeepLinkServiceAction.TargetMatchedForSwitch;
							} else {
								action = DeepLinkServiceAction.TargetMatchedForGraph;
							}
							break;
					}

					break;
				}
				case DeepLinkServiceState.Fetch: {
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

					if (secondaryRemote && secondaryRemote.name !== remote.name) {
						try {
							await repo.fetch({ remote: secondaryRemote.name, progress: true });
						} catch {}
					}

					action = DeepLinkServiceAction.TargetFetched;
					break;
				}
				case DeepLinkServiceState.OpenGraph: {
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
				}
				case DeepLinkServiceState.OpenComparison: {
					if (!repo) {
						action = DeepLinkServiceAction.DeepLinkErrored;
						message = 'Missing repository.';
						break;
					}

					if (
						targetId == null ||
						secondaryTargetId == null ||
						targetSha == null ||
						secondaryTargetSha == null
					) {
						action = DeepLinkServiceAction.DeepLinkErrored;
						message = 'Missing target or secondary target.';
						break;
					}

					await this.container.searchAndCompareView.compare(
						repo.path,
						secondaryTargetId === '' || isSha(secondaryTargetId)
							? secondaryTargetId
							: { label: secondaryTargetId, ref: secondaryTargetSha },
						targetId === '' || isSha(targetId) ? targetId : { label: targetId, ref: targetSha },
					);
					action = DeepLinkServiceAction.DeepLinkResolved;
					break;
				}
				case DeepLinkServiceState.OpenDraft: {
					if (!targetId) {
						action = DeepLinkServiceAction.DeepLinkErrored;
						message = 'Missing cloud patch id.';
						break;
					}

					void (await executeCommand(Commands.OpenCloudPatch, {
						id: targetId,
						patchId: secondaryTargetId,
					}));
					action = DeepLinkServiceAction.DeepLinkResolved;
					break;
				}
				case DeepLinkServiceState.OpenWorkspace: {
					if (!mainId) {
						action = DeepLinkServiceAction.DeepLinkErrored;
						message = 'Missing workspace id.';
						break;
					}

					await this.container.workspacesView.revealWorkspaceNode(mainId, {
						select: true,
						focus: true,
						expand: true,
					});

					action = DeepLinkServiceAction.DeepLinkResolved;
					break;
				}
				case DeepLinkServiceState.OpenFile: {
					if (filePath == null || !repo) {
						action = DeepLinkServiceAction.DeepLinkErrored;
						message = 'Missing file path.';
						break;
					}

					let selection: Range | undefined;
					if (secondaryTargetId != null) {
						// secondary target id can be a single number or a range separated with a dash. If it's a single number, form a range from it. If it's a range, parse it.
						const range = secondaryTargetId.split('-');
						if (range.length === 1) {
							const lineNumber = parseInt(range[0]);
							if (!isNaN(lineNumber)) {
								selection = new Range(lineNumber < 1 ? 0 : lineNumber - 1, 0, lineNumber, 0);
							}
						} else if (range.length === 2) {
							const startLineNumber = parseInt(range[0]);
							const endLineNumber = parseInt(range[1]);
							if (!isNaN(startLineNumber) && !isNaN(endLineNumber)) {
								selection = new Range(
									startLineNumber < 1 ? 0 : startLineNumber - 1,
									0,
									endLineNumber,
									0,
								);
							}
						}
					}

					if (targetSha == null) {
						try {
							await findOrOpenEditor(Uri.file(`${repo.path}/${filePath}`), {
								preview: false,
								selection: selection,
								throwOnError: true,
							});
							action = DeepLinkServiceAction.DeepLinkResolved;
							break;
						} catch (ex) {
							action = DeepLinkServiceAction.DeepLinkErrored;
							message = `Unable to open file${ex?.message ? `: ${ex.message}` : ''}`;
							break;
						}
					}

					let revisionUri: Uri | undefined;
					try {
						revisionUri = this.container.git.getRevisionUri(
							targetSha,
							filePath,
							repoPath ?? repo.uri.fsPath,
						);
					} catch {}
					if (revisionUri == null) {
						action = DeepLinkServiceAction.DeepLinkErrored;
						message = 'Unable to get revision uri.';
						break;
					}

					try {
						await openFileAtRevision(revisionUri, {
							preview: false,
							selection: selection,
						});
						action = DeepLinkServiceAction.DeepLinkResolved;
						break;
					} catch {
						action = DeepLinkServiceAction.DeepLinkErrored;
						message = 'Unable to open file.';
						break;
					}
				}
				case DeepLinkServiceState.SwitchToRef: {
					if (!repo || !targetType || !targetId) {
						action = DeepLinkServiceAction.DeepLinkErrored;
						message = 'Missing repository or target type.';
						break;
					}

					const ref = await this.getTargetRef(targetId);
					if (ref == null) {
						action = DeepLinkServiceAction.DeepLinkErrored;
						message = 'Unable to find link target in the repository.';
						break;
					}

					await executeGitCommand({
						command: 'switch',
						state: { repos: repo, reference: ref },
					});

					action = DeepLinkServiceAction.DeepLinkResolved;
					break;
				}
				default: {
					action = DeepLinkServiceAction.DeepLinkErrored;
					message = 'Unknown state.';
					break;
				}
			}
		}
	}

	async copyDeepLinkUrl(workspaceId: string): Promise<void>;
	async copyDeepLinkUrl(ref: GitReference, remoteUrl: string): Promise<void>;
	async copyDeepLinkUrl(
		repoPath: string,
		remoteUrl: string,
		compareRef?: StoredNamedRef,
		compareWithRef?: StoredNamedRef,
	): Promise<void>;
	async copyDeepLinkUrl(
		refOrIdOrRepoPath: string | GitReference,
		remoteUrl?: string,
		compareRef?: StoredNamedRef,
		compareWithRef?: StoredNamedRef,
	): Promise<void> {
		const url = await (typeof refOrIdOrRepoPath === 'string'
			? remoteUrl != null
				? this.generateDeepLinkUrl(refOrIdOrRepoPath, remoteUrl, compareRef, compareWithRef)
				: this.generateDeepLinkUrl(refOrIdOrRepoPath)
			: this.generateDeepLinkUrl(refOrIdOrRepoPath, remoteUrl!));
		await env.clipboard.writeText(url.toString());
	}

	async copyFileDeepLinkUrl(
		repoPath: string,
		filePath: string,
		remoteUrl: string,
		lines?: number[],
		ref?: GitReference,
	): Promise<void> {
		const url = await this.generateFileDeepLinkUr(repoPath, filePath, remoteUrl, lines, ref);
		await env.clipboard.writeText(url.toString());
	}

	async generateDeepLinkUrl(workspaceId: string): Promise<URL>;
	async generateDeepLinkUrl(ref: GitReference, remoteUrl: string): Promise<URL>;
	async generateDeepLinkUrl(
		repoPath: string,
		remoteUrl: string,
		compareRef?: StoredNamedRef,
		compareWithRef?: StoredNamedRef,
	): Promise<URL>;
	async generateDeepLinkUrl(
		refOrIdOrRepoPath: string | GitReference,
		remoteUrl?: string,
		compareRef?: StoredNamedRef,
		compareWithRef?: StoredNamedRef,
	): Promise<URL> {
		let targetType: DeepLinkType | undefined;
		let targetId: string | undefined;
		let compareWithTargetId: string | undefined;
		const schemeOverride = configuration.get('deepLinks.schemeOverride');
		const scheme = !schemeOverride ? 'vscode' : schemeOverride === true ? env.uriScheme : schemeOverride;
		let modePrefixString = '';
		if (this.container.env === 'dev') {
			modePrefixString = 'dev.';
		} else if (this.container.env === 'staging') {
			modePrefixString = 'staging.';
		}

		if (remoteUrl == null && typeof refOrIdOrRepoPath === 'string') {
			const deepLinkRedirectUrl = new URL(
				`https://${modePrefixString}gitkraken.dev/link/workspaces/${refOrIdOrRepoPath}`,
			);
			deepLinkRedirectUrl.searchParams.set('origin', 'gitlens');
			return deepLinkRedirectUrl;
		}

		const repoPath = typeof refOrIdOrRepoPath !== 'string' ? refOrIdOrRepoPath.repoPath : refOrIdOrRepoPath;
		const repoId = (await this.container.git.getUniqueRepositoryId(repoPath)) ?? missingRepositoryId;

		if (typeof refOrIdOrRepoPath !== 'string') {
			switch (refOrIdOrRepoPath.refType) {
				case 'branch':
					targetType = DeepLinkType.Branch;
					targetId = refOrIdOrRepoPath.remote
						? getBranchNameWithoutRemote(refOrIdOrRepoPath.name)
						: refOrIdOrRepoPath.name;
					break;
				case 'revision':
					targetType = DeepLinkType.Commit;
					targetId = refOrIdOrRepoPath.ref;
					break;
				case 'tag':
					targetType = DeepLinkType.Tag;
					targetId = refOrIdOrRepoPath.name;
					break;
			}
		}

		if (compareRef != null && compareWithRef != null) {
			targetType = DeepLinkType.Comparison;
			targetId = compareRef.label ?? compareRef.ref;
			compareWithTargetId = compareWithRef.label ?? compareWithRef.ref;
		}

		let target;
		if (targetType === DeepLinkType.Comparison) {
			target = `/${targetType}/${compareWithTargetId}...${targetId}`;
		} else if (targetType != null && targetType !== DeepLinkType.Repository) {
			target = `/${targetType}/${targetId}`;
		} else {
			target = '';
		}

		// Start with the prefix, add the repo prefix and the repo ID to the URL, and then add the target tag and target ID to the URL (if applicable)
		const deepLink = new URL(
			`${scheme}://${this.container.context.extension.id}/${'link' satisfies UriTypes}/${
				DeepLinkType.Repository
			}/${repoId}${target}`,
		);

		if (remoteUrl != null) {
			// Add the remote URL as a query parameter
			deepLink.searchParams.set('url', remoteUrl);
		}

		const deepLinkRedirectUrl = new URL(
			`https://${modePrefixString}gitkraken.dev/link/${encodeURIComponent(
				Buffer.from(deepLink.href).toString('base64'),
			)}`,
		);

		deepLinkRedirectUrl.searchParams.set('origin', 'gitlens');
		return deepLinkRedirectUrl;
	}

	async generateFileDeepLinkUr(
		repoPath: string,
		filePath: string,
		remoteUrl: string,
		lines?: number[],
		ref?: GitReference,
	): Promise<URL> {
		const targetType = DeepLinkType.File;
		const targetId = filePath;
		const schemeOverride = configuration.get('deepLinks.schemeOverride');
		const scheme = !schemeOverride ? 'vscode' : schemeOverride === true ? env.uriScheme : schemeOverride;
		let modePrefixString = '';
		if (this.container.env === 'dev') {
			modePrefixString = 'dev.';
		} else if (this.container.env === 'staging') {
			modePrefixString = 'staging.';
		}

		const repoId = (await this.container.git.getUniqueRepositoryId(repoPath)) ?? missingRepositoryId;
		let linesString = '';
		if (lines != null) {
			if (lines.length === 1) {
				linesString = `${lines[0]}`;
			} else if (lines.length === 2) {
				if (lines[0] === lines[1]) {
					linesString = `${lines[0]}`;
				} else if (lines[0] < lines[1]) {
					linesString = `${lines[0]}-${lines[1]}`;
				}
			}
		}

		const deepLink = new URL(
			`${scheme}://${this.container.context.extension.id}/${'link' satisfies UriTypes}/${
				DeepLinkType.Repository
			}/${repoId}/${targetType}/${targetId}`,
		);

		deepLink.searchParams.set('url', remoteUrl);
		if (linesString !== '') {
			deepLink.searchParams.set('lines', linesString);
		}

		if (ref != null) {
			switch (ref.refType) {
				case 'branch':
					deepLink.searchParams.set('ref', ref.name);
					break;
				case 'revision':
					deepLink.searchParams.set('ref', ref.ref);
					break;
				case 'tag':
					deepLink.searchParams.set('ref', ref.name);
					break;
			}
		}

		const deepLinkRedirectUrl = new URL(
			`https://${modePrefixString}gitkraken.dev/link/${encodeURIComponent(
				Buffer.from(deepLink.href).toString('base64'),
			)}`,
		);

		deepLinkRedirectUrl.searchParams.set('origin', 'gitlens');
		return deepLinkRedirectUrl;
	}
}

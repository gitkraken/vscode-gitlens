import { Disposable, env, EventEmitter, ProgressLocation, Uri, window, workspace } from 'vscode';
import type { StoredDeepLinkContext, StoredNamedRef } from '../../constants';
import { Commands } from '../../constants';
import type { Container } from '../../container';
import { getBranchNameWithoutRemote } from '../../git/models/branch';
import type { GitReference } from '../../git/models/reference';
import { createReference, isSha } from '../../git/models/reference';
import { parseGitRemoteUrl } from '../../git/parsers/remoteParser';
import type { ShowInCommitGraphCommandArgs } from '../../plus/webviews/graph/protocol';
import { executeCommand } from '../../system/command';
import { configuration } from '../../system/configuration';
import { once } from '../../system/event';
import { Logger } from '../../system/logger';
import { normalizePath } from '../../system/path';
import type { OpenWorkspaceLocation } from '../../system/utils';
import { openWorkspace } from '../../system/utils';
import type { DeepLink, DeepLinkProgress, DeepLinkRepoOpenType, DeepLinkServiceContext, UriTypes } from './deepLink';
import {
	DeepLinkServiceAction,
	DeepLinkServiceState,
	deepLinkStateToProgress,
	deepLinkStateTransitionTable,
	DeepLinkType,
	parseDeepLinkUri,
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
					if (this.container.git.isDiscoveringRepositories) {
						await this.container.git.isDiscoveringRepositories;
					}

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

					if (link.type !== DeepLinkType.Repository && link.targetId == null) {
						void window.showErrorMessage('Unable to resolve link');
						Logger.warn(`Unable to resolve link - no target id provided: ${uri.toString()}`);
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
			repoId: undefined,
			repo: undefined,
			remoteUrl: undefined,
			remote: undefined,
			secondaryRemote: undefined,
			repoPath: undefined,
			targetId: undefined,
			secondaryTargetId: undefined,
			secondaryRemoteUrl: undefined,
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
			secondaryRemoteUrl: link.secondaryRemoteUrl,
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

	private async getShaForBranch(targetId: string): Promise<string | undefined> {
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
		if (branch?.sha != null) {
			return branch.sha;
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
							if (branch?.sha != null) {
								return branch.sha;
							}
						}
					}
				}
			}
		}

		// If the above don't work, it may still exist locally.
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
		const sha1 = await this.getComparisonRefSha(targetId);
		if (sha1 == null) return undefined;
		const sha2 = await this.getComparisonRefSha(secondaryTargetId);
		if (sha2 == null) return undefined;
		return [sha1, sha2];
	}

	private async getComparisonRefSha(ref: string) {
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

		//Repo match
		let matchingLocalRepoPaths: string[] = [];

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
			const {
				state,
				repoId,
				repo,
				url,
				remoteUrl,
				secondaryRemoteUrl,
				remote,
				secondaryRemote,
				repoPath,
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
				case DeepLinkServiceState.RepoMatch:
				case DeepLinkServiceState.AddedRepoMatch: {
					if (!repoId && !remoteUrl && !repoPath) {
						action = DeepLinkServiceAction.DeepLinkErrored;
						message = 'No repository id, remote url or path was provided.';
						break;
					}

					let remoteDomain = '';
					let remotePath = '';
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

						if (repoId != null && repoId !== '-') {
							// Repo ID can be any valid SHA in the repo, though standard practice is to use the
							// first commit SHA.
							if (await this.container.git.validateReference(repo.path, repoId)) {
								this._context.repo = repo;
								action = DeepLinkServiceAction.RepoMatched;
								break;
							}
						}
					}

					if (!this._context.repo && state === DeepLinkServiceState.RepoMatch) {
						matchingLocalRepoPaths = await this.container.repositoryPathMapping.getLocalRepoPaths({
							remoteUrl: remoteUrl,
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
					if (!repoId && !remoteUrl && !repoPath) {
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
				default: {
					action = DeepLinkServiceAction.DeepLinkErrored;
					message = 'Unknown state.';
					break;
				}
			}
		}
	}

	async copyDeepLinkUrl(ref: GitReference, remoteUrl: string): Promise<void>;
	async copyDeepLinkUrl(
		repoPath: string,
		remoteUrl: string,
		compareRef?: StoredNamedRef,
		compareWithRef?: StoredNamedRef,
	): Promise<void>;
	async copyDeepLinkUrl(
		refOrRepoPath: string | GitReference,
		remoteUrl: string,
		compareRef?: StoredNamedRef,
		compareWithRef?: StoredNamedRef,
	): Promise<void> {
		const url = await (typeof refOrRepoPath === 'string'
			? this.generateDeepLinkUrl(refOrRepoPath, remoteUrl, compareRef, compareWithRef)
			: this.generateDeepLinkUrl(refOrRepoPath, remoteUrl));
		await env.clipboard.writeText(url.toString());
	}

	async generateDeepLinkUrl(ref: GitReference, remoteUrl: string): Promise<URL>;
	async generateDeepLinkUrl(
		repoPath: string,
		remoteUrl: string,
		compareRef?: StoredNamedRef,
		compareWithRef?: StoredNamedRef,
	): Promise<URL>;
	async generateDeepLinkUrl(
		refOrRepoPath: string | GitReference,
		remoteUrl: string,
		compareRef?: StoredNamedRef,
		compareWithRef?: StoredNamedRef,
	): Promise<URL> {
		const repoPath = typeof refOrRepoPath !== 'string' ? refOrRepoPath.repoPath : refOrRepoPath;
		let repoId;
		try {
			repoId = await this.container.git.getUniqueRepositoryId(repoPath);
		} catch {
			repoId = '-';
		}

		let targetType: DeepLinkType | undefined;
		let targetId: string | undefined;
		let compareWithTargetId: string | undefined;
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

		if (compareRef != null && compareWithRef != null) {
			targetType = DeepLinkType.Comparison;
			targetId = compareRef.label ?? compareRef.ref;
			compareWithTargetId = compareWithRef.label ?? compareWithRef.ref;
		}

		const schemeOverride = configuration.get('deepLinks.schemeOverride');

		const scheme = !schemeOverride ? 'vscode' : schemeOverride === true ? env.uriScheme : schemeOverride;
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

		// Add the remote URL as a query parameter
		deepLink.searchParams.set('url', remoteUrl);
		const params = new URLSearchParams();
		params.set('url', remoteUrl);

		let modePrefixString = '';
		if (this.container.env === 'dev') {
			modePrefixString = 'dev.';
		} else if (this.container.env === 'staging') {
			modePrefixString = 'staging.';
		}

		const deepLinkRedirectUrl = new URL(
			`https://${modePrefixString}gitkraken.dev/link/${encodeURIComponent(
				Buffer.from(deepLink.href).toString('base64'),
			)}`,
		);
		return deepLinkRedirectUrl;
	}
}

import type { QuickPickItem } from 'vscode';
import { Disposable, env, EventEmitter, ProgressLocation, Range, Uri, window, workspace } from 'vscode';
import { GlCommand } from '../../constants.commands';
import type { StoredDeepLinkContext, StoredNamedRef } from '../../constants.storage';
import type { Container } from '../../container';
import { executeGitCommand } from '../../git/actions';
import { openComparisonChanges, openFileAtRevision } from '../../git/actions/commit';
import type { GitBranch } from '../../git/models/branch';
import { getBranchNameWithoutRemote } from '../../git/models/branch.utils';
import type { GitCommit } from '../../git/models/commit';
import type { GitReference } from '../../git/models/reference';
import { createReference } from '../../git/models/reference.utils';
import type { Repository, RepositoryChangeEvent } from '../../git/models/repository';
import { RepositoryChange, RepositoryChangeComparisonMode } from '../../git/models/repository';
import { isSha } from '../../git/models/revision.utils';
import type { GitTag } from '../../git/models/tag';
import { parseGitRemoteUrl } from '../../git/parsers/remoteParser';
import type { RepositoryIdentity } from '../../gk/models/repositoryIdentities';
import { missingRepositoryId } from '../../gk/models/repositoryIdentities';
import { ensureAccount, ensurePaidPlan } from '../../plus/utils';
import { createQuickPickSeparator } from '../../quickpicks/items/common';
import { debug } from '../../system/decorators/log';
import { once } from '../../system/event';
import { Logger } from '../../system/logger';
import { normalizePath } from '../../system/path';
import { fromBase64 } from '../../system/string';
import { executeCommand } from '../../system/vscode/command';
import { configuration } from '../../system/vscode/configuration';
import type { OpenWorkspaceLocation } from '../../system/vscode/utils';
import { findOrOpenEditor, openWorkspace } from '../../system/vscode/utils';
import { showInspectView } from '../../webviews/commitDetails/actions';
import type { ShowWipArgs } from '../../webviews/commitDetails/protocol';
import type { ShowInCommitGraphCommandArgs } from '../../webviews/plus/graph/protocol';
import type { DeepLink, DeepLinkProgress, DeepLinkRepoOpenType, DeepLinkServiceContext, UriTypes } from './deepLink';
import {
	AccountDeepLinkTypes,
	DeepLinkActionType,
	DeepLinkCommandTypeToCommand,
	DeepLinkServiceAction,
	DeepLinkServiceState,
	deepLinkStateToProgress,
	deepLinkStateTransitionTable,
	DeepLinkType,
	deepLinkTypeToString,
	isDeepLinkCommandType,
	PaidDeepLinkTypes,
	parseDeepLinkUri,
} from './deepLink';

type OpenQuickPickItem = {
	label: string;
	action?: DeepLinkRepoOpenType;
};

type OpenLocationQuickPickItem = {
	label: string;
	action?: OpenWorkspaceLocation;
};

export class DeepLinkService implements Disposable {
	private readonly _disposables: Disposable[] = [];
	private _context: DeepLinkServiceContext;
	private readonly _onDeepLinkProgressUpdated = new EventEmitter<DeepLinkProgress>();

	constructor(private readonly container: Container) {
		this._context = {
			state: DeepLinkServiceState.Idle,
		};

		this._disposables.push(container.uri.onDidReceiveUri(async (uri: Uri) => this.processDeepLinkUri(uri)));

		const pendingDeepLink = this.container.storage.get('deepLinks:pending');
		void this.processPendingDeepLink(pendingDeepLink);
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
			repoOpenLocation: undefined,
			repoOpenUri: undefined,
			params: undefined,
			currentBranch: undefined,
		};
	}

	private setContextFromDeepLink(link: DeepLink, url: string, repo?: Repository) {
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
			params: link.params,
		};

		if (repo != null) {
			this._context.repo = repo;
			this._context.repoPath = repo.path;
		}
	}

	async processDeepLinkUri(uri: Uri, useProgress: boolean = true, repo?: Repository) {
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

			this.setContextFromDeepLink(link, uri.toString(), repo);

			await this.processDeepLink(undefined, useProgress);
		}
	}

	private getServiceActionFromPendingContext(): DeepLinkServiceAction {
		switch (this._context.state) {
			case DeepLinkServiceState.MaybeOpenRepo:
				return this._context.repo != null
					? DeepLinkServiceAction.RepoOpened
					: DeepLinkServiceAction.RepoOpening;
			case DeepLinkServiceState.SwitchToRef: {
				if (this._context.repo == null) {
					return DeepLinkServiceAction.DeepLinkErrored;
				}

				switch (this._context.action) {
					case DeepLinkActionType.SwitchToPullRequest:
					case DeepLinkActionType.SwitchToPullRequestWorktree:
					case DeepLinkActionType.SwitchToAndSuggestPullRequest:
						return DeepLinkServiceAction.OpenInspect;
					default:
						return DeepLinkServiceAction.DeepLinkResolved;
				}
			}
			default:
				return DeepLinkServiceAction.DeepLinkErrored;
		}
	}

	private async findMatchingRepositoryFromCurrentWindow(
		repoPath: string | undefined,
		remoteUrl: string | undefined,
		repoId: string | undefined,
		isPending?: boolean,
	): Promise<void> {
		if (repoPath != null && isPending) {
			const repoOpenUri = Uri.parse(repoPath);
			try {
				const openRepo = await this.container.git.getOrOpenRepository(repoOpenUri, { detectNested: false });
				if (openRepo != null) {
					this._context.repo = openRepo;
					return;
				}
			} catch {}
		}

		let remoteDomain: string | undefined;
		let remotePath: string | undefined;
		if (remoteUrl != null) {
			[, remoteDomain, remotePath] = parseGitRemoteUrl(remoteUrl);
		}

		// Try to match a repo using the remote URL first, since that saves us some steps.
		// As a fallback, try to match using the repo id.
		for (const repo of this.container.git.repositories) {
			if (repoPath != null && normalizePath(repo.path.toLowerCase()) === normalizePath(repoPath.toLowerCase())) {
				this._context.repo = repo;
				return;
			}

			if (remoteDomain != null && remotePath != null) {
				const matchingRemotes = await repo.git.getRemotes({
					filter: r => r.matches(remoteDomain, remotePath),
				});
				if (matchingRemotes.length > 0) {
					this._context.repo = repo;
					this._context.remote = matchingRemotes[0];
					return;
				}
			}

			if (repoId != null && repoId !== missingRepositoryId) {
				// Repo ID can be any valid SHA in the repo, though standard practice is to use the
				// first commit SHA.
				if (await this.container.git.validateReference(repo.path, repoId)) {
					this._context.repo = repo;
					return;
				}
			}
		}
	}

	@debug()
	private async processPendingDeepLink(pendingDeepLink: StoredDeepLinkContext | undefined) {
		if (pendingDeepLink == null) return;
		void this.container.storage.delete('deepLinks:pending');
		if (pendingDeepLink?.url == null) return;
		const link = parseDeepLinkUri(Uri.parse(pendingDeepLink.url));
		if (link == null) return;

		this._context = { state: pendingDeepLink.state ?? DeepLinkServiceState.MaybeOpenRepo };
		this.setContextFromDeepLink(link, pendingDeepLink.url);
		this._context.targetSha = pendingDeepLink.targetSha;
		this._context.secondaryTargetSha = pendingDeepLink.secondaryTargetSha;
		this._context.repoPath = pendingDeepLink.repoPath;

		if (this.container.git.isDiscoveringRepositories) {
			await this.container.git.isDiscoveringRepositories;
		}

		await this.findMatchingRepositoryFromCurrentWindow(
			this._context.repoPath,
			this._context.remoteUrl,
			this._context.mainId,
			true,
		);

		const action = this.getServiceActionFromPendingContext();
		queueMicrotask(() => {
			void this.processDeepLink(action, pendingDeepLink.useProgress);
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

		let branch = await repo.git.getBranch(branchName);
		if (branch != null) {
			return branch;
		}

		// If that fails, try matching to any existing remote using its path.
		if (targetId.includes(':')) {
			const [providerRepoInfo, branchBaseName] = targetId.split(':');
			if (providerRepoInfo != null && branchName != null) {
				const [owner, repoName] = providerRepoInfo.split('/');
				if (owner != null && repoName != null) {
					const remotes = await repo.git.getRemotes();
					for (const remote of remotes) {
						if (remote.provider?.owner === owner) {
							branchName = `${remote.name}/${branchBaseName}`;
							branch = await repo.git.getBranch(branchName);
							if (branch != null) {
								return branch;
							}
						}
					}
				}
			}
		}

		// If the above don't work, it may still exist locally.
		return repo.git.getBranch(targetId);
	}

	private async getCommit(targetId: string): Promise<GitCommit | undefined> {
		const { repo } = this._context;
		if (!repo) return undefined;
		if (await this.container.git.validateReference(repo.path, targetId)) {
			return repo.git.getCommit(targetId);
		}

		return undefined;
	}

	private async getTag(targetId: string): Promise<GitTag | undefined> {
		const { repo } = this._context;
		return repo?.git.getTag(targetId);
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
		const openOptions: OpenQuickPickItem[] = [
			{ label: 'Choose a Local Folder...', action: 'folder' },
			{ label: 'Choose a Workspace File...', action: 'workspace' },
		];

		if (this._context.remoteUrl != null) {
			openOptions.push({ label: 'Clone Repository...', action: 'clone' });
		}

		if (options?.includeCurrent) {
			openOptions.push(createQuickPickSeparator(), { label: 'Use Current Window', action: 'current' });
		}

		openOptions.push(createQuickPickSeparator(), { label: 'Cancel' });
		const openTypeResult = await window.showQuickPick(openOptions, {
			title: 'Locating Repository',
			placeHolder:
				options?.customMessage ?? 'Unable to locate a matching repository, please choose how to locate it',
		});

		return openTypeResult?.action;
	}

	private async showOpenLocationPrompt(openType: DeepLinkRepoOpenType): Promise<OpenWorkspaceLocation | undefined> {
		// Only add the "add to workspace" option if openType is 'folder'
		const openOptions: OpenLocationQuickPickItem[] = [
			{ label: 'Open in Current Window', action: 'currentWindow' },
			{ label: 'Open in New Window', action: 'newWindow' },
		];

		if (openType !== 'workspace') {
			openOptions.push({ label: 'Add Folder to Workspace', action: 'addToWorkspace' });
		}

		let suffix;
		switch (openType) {
			case 'clone':
				suffix = ' \u00a0\u2022\u00a0 Clone';
				break;
			case 'folder':
				suffix = ' \u00a0\u2022\u00a0 Folder';
				break;
			case 'workspace':
				suffix = ' \u00a0\u2022\u00a0 Workspace from File';
				break;
			case 'current':
				suffix = '';
				break;
		}

		openOptions.push(createQuickPickSeparator(), { label: 'Cancel' });
		const openLocationResult = await window.showQuickPick(openOptions, {
			title: `Locating Repository${suffix}`,
			placeHolder: `Please choose where to open the repository ${
				openType === 'clone' ? 'after cloning' : openType
			}`,
		});

		return openLocationResult?.action;
	}

	private async showAddRemotePrompt(remoteUrl: string, existingRemoteNames: string[]): Promise<string | undefined> {
		const add: QuickPickItem = { label: 'Add Remote' };
		const cancel: QuickPickItem = { label: 'Cancel' };
		const result = await window.showQuickPick([add, cancel], {
			title: `Locating Remote`,
			placeHolder: `Unable to find remote for '${remoteUrl}', would you like to add a new remote?`,
		});
		if (result !== add) return undefined;

		const remoteName = await window.showInputBox({
			prompt: 'Enter a name for the remote',
			value: getMaybeRemoteNameFromRemoteUrl(remoteUrl),
			validateInput: value => {
				if (!value) return 'A name is required';
				if (existingRemoteNames.includes(value)) return 'A remote with that name already exists';
				return undefined;
			},
		});

		return remoteName;
	}

	// TODO @axosoft-ramint: Move all the logic for matching a repo, prompting to add repo, matching remote, etc. for a target (branch, PR, etc.)
	// to a separate service where it can be used outside of the context of deep linking. Then the deep link service should leverage it,
	// and we should stop using deep links to process things like Launchpad switch actions, Open in Worktree command, etc.
	@debug()
	private async processDeepLink(
		initialAction: DeepLinkServiceAction = DeepLinkServiceAction.DeepLinkEventFired,
		useProgress: boolean = true,
	): Promise<void> {
		let message = '';
		let action = initialAction;
		if (action === DeepLinkServiceAction.DeepLinkCancelled && this._context.state === DeepLinkServiceState.Idle) {
			return;
		}

		//Repo match
		let matchingLocalRepoPaths: string[] = [];
		const { targetType } = this._context;

		if (useProgress) {
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
		}

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
				repoOpenLocation,
				repoOpenUri,
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
							this.container,
							`Opening ${deepLinkTypeToString(
								targetType,
							)} links is a Preview feature and requires an account.`,
							{
								source: 'deeplink',
								detail: {
									action: 'open',
									type: targetType,
									friendlyType: deepLinkTypeToString(targetType),
								},
							},
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
							this.container,
							`Opening ${deepLinkTypeToString(targetType)} links is a Pro feature.`,
							{
								source: 'deeplink',
								detail: {
									action: 'open',
									type: targetType,
									friendlyType: deepLinkTypeToString(targetType),
								},
							},
						))
					) {
						action = DeepLinkServiceAction.DeepLinkErrored;
						message = 'GitLens Pro is required to open link';
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
						case DeepLinkType.Command:
							action = DeepLinkServiceAction.LinkIsCommandType;
							break;
						default:
							action = DeepLinkServiceAction.LinkIsRepoType;
							break;
					}

					break;
				}
				case DeepLinkServiceState.RepoMatch:
				case DeepLinkServiceState.AddedRepoMatch: {
					if (repo != null) {
						action = DeepLinkServiceAction.RepoMatched;
						break;
					}

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

					// Try to match a repo using the remote URL first, since that saves us some steps.
					// As a fallback, try to match using the repo id.
					await this.findMatchingRepositoryFromCurrentWindow(repoPath, remoteUrlToSearch, mainIdToSearch);
					if (this._context.repo != null) {
						action = DeepLinkServiceAction.RepoMatched;
						break;
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

					if (matchingLocalRepoPaths.length > 0) {
						chosenRepoPath = await window.showQuickPick(
							[...matchingLocalRepoPaths, 'Choose a different location'],
							{ placeHolder: 'Matching repository found. Choose a location to open it.' },
						);

						if (chosenRepoPath == null) {
							action = DeepLinkServiceAction.DeepLinkCancelled;
							break;
						} else if (chosenRepoPath !== 'Choose a different location') {
							this._context.repoOpenUri = Uri.file(chosenRepoPath);
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
					this._context.repoOpenLocation = repoOpenLocation;

					if (this._context.repoOpenUri == null) {
						this._context.repoOpenUri = (
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

					if (!this._context.repoOpenUri) {
						action = DeepLinkServiceAction.DeepLinkCancelled;
						break;
					}

					if (this._context.repoOpenUri != null && remoteUrl != null && repoOpenType === 'clone') {
						// clone the repository, then set repoOpenUri to the repo path
						let repoClonePath;
						try {
							repoClonePath = await window.withProgress(
								{
									location: ProgressLocation.Notification,
									title: `Cloning repository for link: ${this._context.url}}`,
								},

								async () =>
									this.container.git.clone(remoteUrl, this._context.repoOpenUri?.fsPath ?? ''),
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

						this._context.repoOpenUri = Uri.file(repoClonePath);
					}

					// Add the chosen repo as closed
					const chosenRepo = await this.container.git.getOrOpenRepository(this._context.repoOpenUri, {
						closeOnOpen: true,
						detectNested: false,
					});
					if (chosenRepo != null) {
						this._context.repo = chosenRepo;
						// Add the repo to the repo path mapping if it exists
						if (
							repoOpenType !== 'current' &&
							repoOpenType !== 'workspace' &&
							!matchingLocalRepoPaths.includes(this._context.repoOpenUri.fsPath)
						) {
							await this.container.repositoryPathMapping.writeLocalRepoPath(
								{ remoteUrl: remoteUrl },
								chosenRepo.uri.fsPath,
							);
						}
					}

					action = DeepLinkServiceAction.RepoAdded;
					break;
				}
				case DeepLinkServiceState.RemoteMatch:
				case DeepLinkServiceState.EnsureRemoteMatch: {
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
						const matchingRemotes = await repo.git.getRemotes({ filter: r => r.url === remoteUrl });
						if (matchingRemotes.length > 0) {
							this._context.remote = matchingRemotes[0];
						}
					}

					if (secondaryRemoteUrl && !secondaryRemote) {
						const matchingRemotes = await repo.git.getRemotes({
							filter: r => r.url === secondaryRemoteUrl,
						});
						if (matchingRemotes.length > 0) {
							this._context.secondaryRemote = matchingRemotes[0];
						}
					}

					if (
						(remoteUrl && !this._context.remote) ||
						(secondaryRemoteUrl && !this._context.secondaryRemote)
					) {
						if (state === DeepLinkServiceState.RemoteMatch) {
							action = DeepLinkServiceAction.RemoteMatchFailed;
						} else {
							action = DeepLinkServiceAction.DeepLinkErrored;
							message = 'No matching remote found.';
						}
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
							(await repo.git.getRemotes()).map(r => r.name),
						);

						if (remoteName) {
							try {
								await repo.addRemote(remoteName, remoteUrl, { fetch: true });
							} catch {
								action = DeepLinkServiceAction.DeepLinkErrored;
								message = 'Failed to add remote.';
								break;
							}

							[this._context.remote] = await repo.git.getRemotes({ filter: r => r.url === remoteUrl });
							if (!this._context.remote) {
								action = DeepLinkServiceAction.DeepLinkErrored;
								message = 'Failed to add remote.';
								break;
							}
						} else {
							action = DeepLinkServiceAction.DeepLinkCancelled;
							break;
						}
					}

					if (secondaryRemoteUrl && !secondaryRemote) {
						secondaryRemoteName = await this.showAddRemotePrompt(
							secondaryRemoteUrl,
							(await repo.git.getRemotes()).map(r => r.name),
						);

						if (secondaryRemoteName) {
							try {
								await repo.addRemote(secondaryRemoteName, secondaryRemoteUrl, { fetch: true });
							} catch {
								action = DeepLinkServiceAction.DeepLinkErrored;
								message = 'Failed to add remote.';
								break;
							}

							[this._context.secondaryRemote] = await repo.git.getRemotes({
								filter: r => r.url === secondaryRemoteUrl,
							});
							if (!this._context.secondaryRemote) {
								action = DeepLinkServiceAction.DeepLinkErrored;
								message = 'Failed to add remote.';
								break;
							}
						} else {
							action = DeepLinkServiceAction.DeepLinkCancelled;
							break;
						}
					}

					if (this._context.secondaryRemote && !this._context.remote) {
						this._context.remote = this._context.secondaryRemote;
					}

					if (!remoteName && !secondaryRemoteName) {
						action = DeepLinkServiceAction.DeepLinkCancelled;
						break;
					} else if (!this._context.remote) {
						action = DeepLinkServiceAction.DeepLinkErrored;
						message = 'Failed to add remote.';
						break;
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
					} else if (targetType === DeepLinkType.File && targetId == null) {
						action = DeepLinkServiceAction.TargetMatched;
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

					action = DeepLinkServiceAction.TargetMatched;
					break;
				}
				case DeepLinkServiceState.Fetch: {
					if (!repo || !remote) {
						action = DeepLinkServiceAction.DeepLinkErrored;
						message = 'Missing repository or remote.';
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
				case DeepLinkServiceState.MaybeOpenRepo: {
					if (repoOpenLocation != null && repoOpenUri != null) {
						action = DeepLinkServiceAction.RepoOpening;
						if (!(repoOpenLocation === 'addToWorkspace' && (workspace.workspaceFolders?.length || 0) > 1)) {
							// Deep link will resolve in a different service instance
							await this.container.storage.store('deepLinks:pending', {
								url: this._context.url,
								repoPath: repoOpenUri.toString(),
								targetSha: this._context.targetSha,
								secondaryTargetSha: this._context.secondaryTargetSha,
								useProgress: useProgress,
							});
							action = DeepLinkServiceAction.DeepLinkStored;
						}

						openWorkspace(repoOpenUri, { location: repoOpenLocation });
					} else {
						action = DeepLinkServiceAction.RepoOpened;
					}
					break;
				}
				case DeepLinkServiceState.RepoOpening: {
					this._disposables.push(
						once(this.container.git.onDidChangeRepositories)(() => {
							queueMicrotask(() => this.processDeepLink(DeepLinkServiceAction.RepoOpened));
						}),
					);
					return;
				}
				case DeepLinkServiceState.GoToTarget: {
					// Need to re-fetch the remotes in case we opened in a new window
					if (targetType === DeepLinkType.Repository) {
						if (
							this._context.action === DeepLinkActionType.Switch ||
							this._context.action === DeepLinkActionType.SwitchToPullRequest ||
							this._context.action === DeepLinkActionType.SwitchToPullRequestWorktree ||
							this._context.action === DeepLinkActionType.SwitchToAndSuggestPullRequest
						) {
							action = DeepLinkServiceAction.OpenSwitch;
						} else {
							action = DeepLinkServiceAction.OpenGraph;
						}
						break;
					}

					switch (targetType) {
						case DeepLinkType.File:
							action = DeepLinkServiceAction.OpenFile;
							break;
						case DeepLinkType.Comparison:
							action = DeepLinkServiceAction.OpenComparison;
							break;
						default:
							if (
								this._context.action === DeepLinkActionType.Switch ||
								this._context.action === DeepLinkActionType.SwitchToPullRequest ||
								this._context.action === DeepLinkActionType.SwitchToPullRequestWorktree ||
								this._context.action === DeepLinkActionType.SwitchToAndSuggestPullRequest
							) {
								action = DeepLinkServiceAction.OpenSwitch;
							} else {
								action = DeepLinkServiceAction.OpenGraph;
							}
							break;
					}
					break;
				}
				case DeepLinkServiceState.OpenGraph: {
					if (!repo || !targetType) {
						action = DeepLinkServiceAction.DeepLinkErrored;
						message = 'Missing repository or target type.';
						break;
					}

					if (targetType === DeepLinkType.Repository) {
						void (await executeCommand(GlCommand.ShowInCommitGraph, repo));
						action = DeepLinkServiceAction.DeepLinkResolved;
						break;
					}

					if (!targetSha) {
						action = DeepLinkServiceAction.DeepLinkErrored;
						message = `Cannot find target ${targetType} in repo.`;
						break;
					}

					void (await executeCommand<ShowInCommitGraphCommandArgs>(GlCommand.ShowInCommitGraph, {
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

					await this.container.views.searchAndCompare.compare(
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

					const type = this._context.params?.get('type');
					let prEntityId = this._context.params?.get('prEntityId');
					if (prEntityId != null) {
						prEntityId = fromBase64(prEntityId).toString();
					}

					void (await executeCommand(GlCommand.OpenCloudPatch, {
						type: type === 'suggested_pr_change' ? 'code_suggestion' : 'patch',
						id: targetId,
						patchId: secondaryTargetId,
						prEntityId: prEntityId,
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

					await this.container.views.workspaces.revealWorkspaceNode(mainId, {
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

					let skipSwitch = false;
					if (targetType === DeepLinkType.Branch) {
						// Check if the branch is already checked out. If so, we are done.
						const currentBranch = await repo.git.getBranch();
						this._context.currentBranch = currentBranch?.name;
						const targetBranch = await this.getBranch(targetId);
						if (
							currentBranch != null &&
							targetBranch != null &&
							// TODO: When we create a new local branch during switch, it should set its upstream to the original remote branch target.
							// Then this can be updated to just check the upstream of `currentBranch`.
							currentBranch.getNameWithoutRemote() === targetBranch.getNameWithoutRemote()
						) {
							skipSwitch = true;
						}
					}

					if (!skipSwitch) {
						const ref = await this.getTargetRef(targetId);
						if (ref == null) {
							action = DeepLinkServiceAction.DeepLinkErrored;
							message = 'Unable to find link target in the repository.';
							break;
						}

						const pendingDeepLink = {
							url: this._context.url,
							repoPath: repo.path,
							targetSha: this._context.targetSha,
							secondaryTargetSha: this._context.secondaryTargetSha,
							useProgress: useProgress,
							state: this._context.state,
						};

						// Form a new link URL with PR info stripped out in case we are opening an existing PR worktree,
						// in which case we do not want to advance to the  "Open All PR Changes" step in the flow.
						// We should only advance to that step if a worktree is newly created in the flow.
						const oldUrl = Uri.parse(this._context.url ?? '').toString(true);
						const urlParams = new URL(oldUrl).searchParams;
						urlParams.delete('prId');
						urlParams.delete('prTitle');
						urlParams.delete('prBaseRef');
						urlParams.delete('prHeadRef');
						const newUrlParams = urlParams.toString();
						const nonPrUrl =
							newUrlParams.length > 0 ? `${oldUrl.split('?')[0]}?${newUrlParams}` : oldUrl.split('?')[0];

						// Storing link info in case the switch causes a new window to open
						const onWorkspaceChanging = async (isNewWorktree?: boolean) =>
							this.container.storage.store(
								'deepLinks:pending',
								isNewWorktree ? pendingDeepLink : { ...pendingDeepLink, url: nonPrUrl },
							);

						await executeGitCommand({
							command: 'switch',
							state: {
								repos: repo,
								reference: ref,
								onWorkspaceChanging: onWorkspaceChanging,
								skipWorktreeConfirmations:
									this._context.action === DeepLinkActionType.SwitchToPullRequestWorktree,
							},
						});

						// Only proceed if the branch switch occurred in the current window. This is necessary because the switch flow may
						// open a new window, and if it does, we need to end things here.
						const didChangeBranch = await Promise.race([
							new Promise<boolean>(resolve => setTimeout(() => resolve(false), 10000)),
							new Promise<boolean>(resolve =>
								once(repo.onDidChange)(async (e: RepositoryChangeEvent) => {
									if (e.changed(RepositoryChange.Head, RepositoryChangeComparisonMode.Any)) {
										if ((await repo.git.getBranch())?.name !== this._context.currentBranch) {
											resolve(true);
										} else {
											resolve(false);
										}
									}
								}),
							),
						]);

						if (!didChangeBranch) {
							action = DeepLinkServiceAction.DeepLinkResolved;
							break;
						}
					}

					if (
						this._context.action === DeepLinkActionType.SwitchToPullRequest ||
						this._context.action === DeepLinkActionType.SwitchToPullRequestWorktree ||
						this._context.action === DeepLinkActionType.SwitchToAndSuggestPullRequest
					) {
						action = DeepLinkServiceAction.OpenInspect;
					} else {
						action = DeepLinkServiceAction.DeepLinkResolved;
					}
					break;
				}
				case DeepLinkServiceState.OpenInspect: {
					// If we arrive at this step, clear any stored data used for the "new window" option
					await this.container.storage.delete('deepLinks:pending');
					if (!repo) {
						action = DeepLinkServiceAction.DeepLinkErrored;
						message = 'Missing repository.';
						break;
					}

					await showInspectView({
						type: 'wip',
						inReview: this._context.action === DeepLinkActionType.SwitchToAndSuggestPullRequest,
						repository: repo,
						source: 'launchpad',
					} satisfies ShowWipArgs);
					const { params } = this._context;
					if (
						this._context.action === DeepLinkActionType.SwitchToPullRequestWorktree &&
						params != null &&
						(params.get('prId') != null || params.get('prTitle') != null) &&
						params.get('prBaseRef') != null &&
						params.get('prHeadRef') != null
					) {
						action = DeepLinkServiceAction.OpenAllPrChanges;
						break;
					}

					action = DeepLinkServiceAction.DeepLinkResolved;
					break;
				}
				case DeepLinkServiceState.OpenAllPrChanges: {
					const prId = this._context.params?.get('prId');
					const prHeadRef = this._context.params?.get('prHeadRef');
					const prBaseRef = this._context.params?.get('prBaseRef');
					const prTitle = this._context.params?.get('prTitle');
					if (!repoPath || (!prId && !prTitle) || !prHeadRef || !prBaseRef) {
						action = DeepLinkServiceAction.DeepLinkErrored;
						if (!repoPath) {
							message = 'No repository path was provided.';
						} else if (!prId) {
							message = 'No pull request id provided.';
						} else {
							message = 'No pull request refs was provided.';
						}
						break;
					}
					await openComparisonChanges(
						this.container,
						{
							repoPath: repoPath,
							lhs: prBaseRef,
							rhs: prHeadRef,
						},
						{ title: `Changes in Pull Request ${prTitle ? `"${prTitle}"` : `#${prId}`}` },
					);
					action = DeepLinkServiceAction.DeepLinkResolved;
					break;
				}
				case DeepLinkServiceState.RunCommand: {
					if (mainId == null || !isDeepLinkCommandType(mainId)) {
						action = DeepLinkServiceAction.DeepLinkErrored;
						message = 'Invalid command type.';
						break;
					}

					const command = DeepLinkCommandTypeToCommand.get(mainId);
					if (command == null) {
						action = DeepLinkServiceAction.DeepLinkErrored;
						message = 'Invalid command.';
						break;
					}

					await executeCommand(command, { source: 'deeplink' });
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
			targetId = compareRef.ref ?? compareRef.label;
			compareWithTargetId = compareWithRef.ref ?? compareWithRef.label;
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

export function getMaybeRemoteNameFromRemoteUrl(remoteUrl: string): string | undefined {
	const remoteUrlParts = remoteUrl.split('/');
	if (remoteUrlParts.length < 3) return undefined;
	return remoteUrlParts[remoteUrlParts.length - 2];
}

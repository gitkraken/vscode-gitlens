import type { Disposable, Uri } from 'vscode';
import { env, ProgressLocation, window, workspace } from 'vscode';
import { configuration } from '../../configuration';
import { Commands } from '../../constants';
import type { Container } from '../../container';
import { GitReference } from '../../git/models/reference';
import type { GitRemote } from '../../git/models/remote';
import { Logger } from '../../logger';
import type { ShowInCommitGraphCommandArgs } from '../../plus/webviews/graph/graphWebview';
import { executeCommand } from '../../system/command';
import { once } from '../../system/event';
import { openWorkspace } from '../../system/utils';
import type { DeepLinkServiceContext } from './deepLink';
import {
	DeepLinkRepoOpenAction,
	deepLinkRepoOpenActionToOpenWorkspaceLocation,
	DeepLinkServiceAction,
	DeepLinkServiceState,
	deepLinkStateTransitionTable,
	DeepLinkType,
	parseDeepLinkUri,
	UriTypes,
} from './deepLink';

export class DeepLinkService implements Disposable {
	private _onDeepLinkEvent: Disposable | undefined;
	private _onRepositoryChanged: Disposable | undefined;
	private _context: DeepLinkServiceContext;

	constructor(private readonly container: Container) {
		this._context = {
			state: DeepLinkServiceState.Idle,
		};

		this._onDeepLinkEvent = container.uri.onDidReceiveUri(async (uri: Uri) => {
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

				this._context = {
					...this._context,
					repoId: link.repoId,
					targetType: link.type,
					uri: uri.toString(),
					remoteUrl: link.remoteUrl,
					targetId: link.targetId,
				};

				await this.processDeepLink();
			}
		});

		const pendingDeepLink = this.container.storage.get('deepLinks:pending');
		if (pendingDeepLink != null) {
			void this.container.storage.delete('deepLinks:pending');
			this._context = {
				state: pendingDeepLink.state,
				uri: pendingDeepLink.uri,
				repoId: pendingDeepLink.repoId,
				remoteUrl: pendingDeepLink.remoteUrl,
				targetId: pendingDeepLink.targetId,
				targetType: pendingDeepLink.targetType as DeepLinkType,
			};

			queueMicrotask(() => {
				void this.processDeepLink(pendingDeepLink.action);
			});
		}
	}

	dispose() {
		this._onDeepLinkEvent?.dispose();
		this._onRepositoryChanged?.dispose();
	}

	private resetContext() {
		this._context = {
			state: DeepLinkServiceState.Idle,
			uri: undefined,
			repoId: undefined,
			repo: undefined,
			remoteUrl: undefined,
			remote: undefined,
			targetId: undefined,
			targetType: undefined,
			targetSha: undefined,
		};
	}

	private async getShaForTarget(): Promise<string | undefined> {
		const { repo, remote, targetType, targetId } = this._context;
		if (!repo || !remote || targetType === DeepLinkType.Repository || !targetId) {
			return undefined;
		}

		if (targetType === DeepLinkType.Branch) {
			// Form the target branch name using the remote name and branch name
			const branchName = `${remote.name}/${targetId}`;
			const branch = await repo.getBranch(branchName);
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

	private async showOpenRepoPrompt(): Promise<DeepLinkRepoOpenAction> {
		const result = await window.showInformationMessage(
			`No matching repository found. Please choose an option to open the repository.`,
			{ modal: true },
			{ title: DeepLinkRepoOpenAction.OpenInCurrentWindow },
			{ title: DeepLinkRepoOpenAction.OpenInNewWindow },
			{ title: DeepLinkRepoOpenAction.AddToWorkspace },
			{ title: DeepLinkRepoOpenAction.Cancel, isCloseAffordance: true },
		);

		return result?.title ?? DeepLinkRepoOpenAction.Cancel;
	}

	private async processDeepLink(
		initialAction: DeepLinkServiceAction = DeepLinkServiceAction.DeepLinkEventFired,
	): Promise<void> {
		let message = '';
		let matchingRemotes: GitRemote[] = [];
		let action = initialAction;
		let repoOpenAction = DeepLinkRepoOpenAction.Cancel;
		let repoOpenUri: Uri | undefined = undefined;
		while (true) {
			this._context.state = deepLinkStateTransitionTable[this._context.state][action];
			const { state, repoId, repo, uri, remoteUrl, remote, targetSha, targetType } = this._context;
			switch (state) {
				case DeepLinkServiceState.Idle:
					if (action === DeepLinkServiceAction.DeepLinkErrored) {
						void window.showErrorMessage('Unable to resolve link');
						Logger.warn(`Unable to resolve link - ${message}: ${uri}`);
					}

					// Deep link processing complete. Reset the context and return.
					this.resetContext();
					return;
				case DeepLinkServiceState.RepoMatch:
				case DeepLinkServiceState.AddedRepoMatch:
					if (!repoId) {
						action = DeepLinkServiceAction.DeepLinkErrored;
						message = 'No repo id was provided.';
						break;
					}

					// Try to match a repo using the remote URL first, since that saves us some steps.
					// As a fallback, try to match using the repo id.
					for (const repo of this.container.git.repositories) {
						matchingRemotes = await repo.getRemotes({ filter: r => r.url === remoteUrl });
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
							message = 'No matching repo found.';
						}
					}

					break;

				case DeepLinkServiceState.CloneOrAddRepo:
					if (!repoId || !remoteUrl) {
						action = DeepLinkServiceAction.DeepLinkErrored;
						message = 'Missing repo id or remote url.';
						break;
					}

					repoOpenAction = await this.showOpenRepoPrompt();
					if (repoOpenAction === DeepLinkRepoOpenAction.Cancel) {
						action = DeepLinkServiceAction.DeepLinkCancelled;
						break;
					}

					// TODO@ramint Add cloning
					repoOpenUri = (
						await window.showOpenDialog({
							title: 'Open Repository for Link',
							canSelectFiles: false,
							canSelectFolders: true,
							canSelectMany: false,
						})
					)?.[0];

					if (!repoOpenUri) {
						action = DeepLinkServiceAction.DeepLinkCancelled;
						break;
					}

					if (
						repoOpenAction === DeepLinkRepoOpenAction.AddToWorkspace &&
						(workspace.workspaceFolders?.length || 0) > 1
					) {
						action = DeepLinkServiceAction.OpenRepo;
					} else {
						// Deep link will resolve in a different service instance
						await this.container.storage.store('deepLinks:pending', {
							state: this._context.state,
							action: DeepLinkServiceAction.OpenRepo,
							uri: this._context.uri,
							repoId: this._context.repoId,
							remoteUrl: this._context.remoteUrl,
							targetType: this._context.targetType,
							targetId: this._context.targetId,
						});
						action = DeepLinkServiceAction.DeepLinkCancelled;
					}

					openWorkspace(repoOpenUri, {
						location: deepLinkRepoOpenActionToOpenWorkspaceLocation[repoOpenAction],
					});
					break;

				case DeepLinkServiceState.OpeningRepo:
					queueMicrotask(
						() =>
							void window.withProgress(
								{
									cancellable: true,
									location: ProgressLocation.Notification,
									title: `Opening repo for link: ${uri}`,
								},
								(progress, token) => {
									return new Promise<void>(resolve => {
										token.onCancellationRequested(() => {
											queueMicrotask(() =>
												this.processDeepLink(DeepLinkServiceAction.DeepLinkCancelled),
											);
											resolve();
										});

										this._onRepositoryChanged = once(this.container.git.onDidChangeRepositories)(
											() => {
												queueMicrotask(() =>
													this.processDeepLink(DeepLinkServiceAction.RepoAdded),
												);
												resolve();
											},
										);
									});
								},
							),
					);
					return;

				case DeepLinkServiceState.RemoteMatch:
					if (!repo || !remoteUrl) {
						action = DeepLinkServiceAction.DeepLinkErrored;
						message = 'Missing repo or remote url.';
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
						message = 'Missing repo or remote url.';
						break;
					}

					// TODO@ramint Instead of erroring here, prompt the user to add the remote, wait for the response,
					// and then choose an action based on whether the remote is successfully added, of the user
					// cancels, or if there is an error.
					action = DeepLinkServiceAction.DeepLinkErrored;
					message = 'No matching remote found.';
					break;

				case DeepLinkServiceState.TargetMatch:
				case DeepLinkServiceState.FetchedTargetMatch:
					if (!repo || !remote || !targetType) {
						action = DeepLinkServiceAction.DeepLinkErrored;
						message = 'Missing repo, remote, or target type.';
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
						message = 'Missing repo or remote.';
						break;
					}

					// TODO@ramint Instead of erroring here, prompt the user to fetch, wait for the response,
					// and then choose an action based on whether the fetch was successful, of the user
					// cancels, or if there is an error.
					action = DeepLinkServiceAction.DeepLinkErrored;
					message = 'No matching target found.';
					break;

				case DeepLinkServiceState.OpenGraph:
					if (!repo || !targetType) {
						action = DeepLinkServiceAction.DeepLinkErrored;
						message = 'Missing repo or target type.';
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
						ref: GitReference.create(targetSha, repo.path),
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
	async copyDeepLinkUrl(repoPath: string, remoteUrl: string): Promise<void>;
	async copyDeepLinkUrl(
		repoPath: string,
		remoteUrl: string,
		targetType: DeepLinkType,
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
			: this.generateDeepLinkUrl(refOrRepoPath, remoteUrl, targetType!, targetId));
		await env.clipboard.writeText(url.toString());
	}

	async generateDeepLinkUrl(ref: GitReference, remoteUrl: string): Promise<URL>;
	async generateDeepLinkUrl(repoPath: string, remoteUrl: string): Promise<URL>;
	async generateDeepLinkUrl(
		repoPath: string,
		remoteUrl: string,
		targetType: DeepLinkType,
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
					targetId = refOrRepoPath.name;
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

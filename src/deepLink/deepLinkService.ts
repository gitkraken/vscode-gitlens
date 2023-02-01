import type { Disposable, Uri } from 'vscode';
import { EventEmitter, window } from 'vscode';
import { Commands } from '../constants';
import type { Container } from '../container';
import { GitReference } from '../git/models/reference';
import type { GitRemote } from '../git/models/remote';
import type { Repository } from '../git/models/repository';
import type { ShowInCommitGraphCommandArgs } from '../plus/webviews/graph/graphWebview';
import { executeCommand } from '../system/command';
import type { UriEvent } from '../uri/uri';
import { UriTypes } from '../uri/uri';
import type { DeepLinkType } from './deepLink';
import { DeepLinkTypes } from './deepLink';

enum DeepLinkServiceStates {
	Idle = 'Idle',
	RepoMatch = 'RepoMatch',
	CloneOrAddRepo = 'CloneOrAddRepo',
	AddedRepoMatch = 'AddedRepoMatch',
	RemoteMatch = 'RemoteMatch',
	AddRemote = 'AddRemote',
	TargetMatch = 'TargetMatch',
	Fetch = 'Fetch',
	FetchedTargetMatch = 'FetchedTargetMatch',
	OpenGraph = 'OpenGraph',
}

enum DeepLinkServiceActions {
	DeepLinkEventFired = 'DeepLinkEventFired',
	DeepLinkCanceled = 'DeepLinkCanceled',
	DeepLinkResolved = 'DeepLinkResolved',
	DeepLinkErrored = 'DeepLinkErrored',
	RepoMatchedWithId = 'RepoMatchedWithId',
	RepoMatchedWithRemoteUrl = 'RepoMatchedWithRemoteUrl',
	RepoMatchFailed = 'RepoMatchFailed',
	RepoAdded = 'RepoAdded',
	RemoteMatched = 'RemoteMatched',
	RemoteMatchFailed = 'RemoteMatchFailed',
	RemoteAdded = 'RemoteAdded',
	TargetIsRemote = 'TargetIsRemote',
	TargetMatched = 'TargetMatched',
	TargetMatchFailed = 'TargetMatchFailed',
	TargetFetched = 'TargetFetched',
}

type DeepLinkServiceState = DeepLinkServiceStates;
type DeepLinkServiceAction = DeepLinkServiceActions;

interface DeepLinkServiceStateChange {
	state: DeepLinkServiceState;
	action: DeepLinkServiceAction;
	data?: any;
}

interface DeepLinkServiceContext {
	state: DeepLinkServiceState;
	uri?: Uri | undefined;
	repoId?: string | undefined;
	repo?: Repository | undefined;
	remoteUrl?: string | undefined;
	remote?: GitRemote | undefined;
	targetId?: string | undefined;
	targetType?: DeepLinkType | undefined;
	targetSha?: string | undefined;
}

export class DeepLinkService implements Disposable {
	private _disposables: Disposable[] = [];
	private _context: DeepLinkServiceContext;
	private _stateChange = new EventEmitter<DeepLinkServiceStateChange>();
	private _transitionTable: { [state: string]: { [action: string]: DeepLinkServiceState } } = {
		[DeepLinkServiceStates.Idle]: {
			[DeepLinkServiceActions.DeepLinkEventFired]: DeepLinkServiceStates.RepoMatch,
		},
		[DeepLinkServiceStates.RepoMatch]: {
			[DeepLinkServiceActions.RepoMatchedWithId]: DeepLinkServiceStates.RemoteMatch,
			[DeepLinkServiceActions.RepoMatchedWithRemoteUrl]: DeepLinkServiceStates.TargetMatch,
			[DeepLinkServiceActions.RepoMatchFailed]: DeepLinkServiceStates.CloneOrAddRepo,
		},
		[DeepLinkServiceStates.CloneOrAddRepo]: {
			[DeepLinkServiceActions.RepoAdded]: DeepLinkServiceStates.AddedRepoMatch,
			[DeepLinkServiceActions.DeepLinkErrored]: DeepLinkServiceStates.Idle,
			[DeepLinkServiceActions.DeepLinkCanceled]: DeepLinkServiceStates.Idle,
		},
		[DeepLinkServiceStates.AddedRepoMatch]: {
			[DeepLinkServiceActions.RepoMatchedWithId]: DeepLinkServiceStates.RemoteMatch,
			[DeepLinkServiceActions.RepoMatchedWithRemoteUrl]: DeepLinkServiceStates.TargetMatch,
			[DeepLinkServiceActions.DeepLinkErrored]: DeepLinkServiceStates.Idle,
		},
		[DeepLinkServiceStates.RemoteMatch]: {
			[DeepLinkServiceActions.RemoteMatched]: DeepLinkServiceStates.TargetMatch,
			[DeepLinkServiceActions.RemoteMatchFailed]: DeepLinkServiceStates.AddRemote,
		},
		[DeepLinkServiceStates.AddRemote]: {
			[DeepLinkServiceActions.RemoteAdded]: DeepLinkServiceStates.OpenGraph,
			[DeepLinkServiceActions.DeepLinkErrored]: DeepLinkServiceStates.Idle,
			[DeepLinkServiceActions.DeepLinkCanceled]: DeepLinkServiceStates.Idle,
		},
		[DeepLinkServiceStates.TargetMatch]: {
			[DeepLinkServiceActions.TargetIsRemote]: DeepLinkServiceStates.OpenGraph,
			[DeepLinkServiceActions.TargetMatched]: DeepLinkServiceStates.OpenGraph,
			[DeepLinkServiceActions.TargetMatchFailed]: DeepLinkServiceStates.Fetch,
		},
		[DeepLinkServiceStates.Fetch]: {
			[DeepLinkServiceActions.TargetFetched]: DeepLinkServiceStates.FetchedTargetMatch,
			[DeepLinkServiceActions.DeepLinkErrored]: DeepLinkServiceStates.Idle,
			[DeepLinkServiceActions.DeepLinkCanceled]: DeepLinkServiceStates.Idle,
		},
		[DeepLinkServiceStates.FetchedTargetMatch]: {
			[DeepLinkServiceActions.TargetMatched]: DeepLinkServiceStates.OpenGraph,
			[DeepLinkServiceActions.DeepLinkErrored]: DeepLinkServiceStates.Idle,
		},
		[DeepLinkServiceStates.OpenGraph]: {
			[DeepLinkServiceActions.DeepLinkResolved]: DeepLinkServiceStates.Idle,
			[DeepLinkServiceActions.DeepLinkErrored]: DeepLinkServiceStates.Idle,
		},
	};

	constructor(private readonly container: Container) {
		this._context = {
			state: DeepLinkServiceStates.Idle,
		};

		this._disposables = [
			container.uri.onDidReceiveUri((event: UriEvent) => {
				if (event.type === UriTypes.DeepLink && this._context.state === DeepLinkServiceStates.Idle) {
					if (!event.repoId || !event.linkType || !event.uri || !event.remoteUrl) {
						void window.showErrorMessage(`Error resolving deep link: missing required properties.`);
						return;
					}

					if (!Object.values(DeepLinkTypes).includes(event.linkType)) {
						void window.showErrorMessage(`Error resolving deep link: unknown link type.`);
						return;
					}

					if (event.linkType !== DeepLinkTypes.Remote && !event.targetId) {
						void window.showErrorMessage(
							`Error resolving deep link of type ${event.linkType}: no target id provided.`,
						);
						return;
					}

					this._context = {
						...this._context,
						repoId: event.repoId,
						targetType: event.linkType,
						uri: event.uri,
						remoteUrl: event.remoteUrl,
						targetId: event.targetId,
					};

					this._stateChange.fire({
						state: this._context.state,
						action: DeepLinkServiceActions.DeepLinkEventFired,
					});
				}
			}),
			this._stateChange.event(async (serviceStateChange: DeepLinkServiceStateChange) => {
				await this.handleDeepLinkStateChange(serviceStateChange);
			}),
		];
	}

	resetContext() {
		this._context = {
			state: DeepLinkServiceStates.Idle,
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

	dispose() {
		this._disposables.forEach((disposable: Disposable) => void disposable.dispose());
	}

	async getShaForTarget(): Promise<string | undefined> {
		const { repo, remote, targetType, targetId } = this._context;
		if (!repo || !remote || targetType === DeepLinkTypes.Remote || !targetId) {
			return undefined;
		}

		if (targetType === DeepLinkTypes.Branch) {
			// Form the target branch name using the remote name and branch name
			const branchName = `${remote.name}/${targetId}`;
			const branch = await repo.getBranch(branchName);
			if (branch) {
				return branch.sha;
			}

			return undefined;
		}

		if (targetType === DeepLinkTypes.Tag) {
			const tag = await repo.getTag(targetId);
			if (tag) {
				return tag.sha;
			}

			return undefined;
		}

		if (targetType === DeepLinkTypes.Commit) {
			if (await this.container.git.validateReference(repo.path, targetId)) {
				return targetId;
			}

			return undefined;
		}

		return undefined;
	}

	async handleDeepLinkStateChange(serviceStateChange: DeepLinkServiceStateChange) {
		const { action, data } = serviceStateChange;
		const { state: previousState, repoId, repo, uri, remoteUrl, remote, targetSha, targetType } = this._context;
		let nextState = this._transitionTable[previousState][action];
		let nextData: any;
		let matchingRemotes: GitRemote[] = [];
		let nextAction: DeepLinkServiceAction = DeepLinkServiceActions.DeepLinkErrored;
		if (!nextState) {
			nextState = DeepLinkServiceStates.Idle;
		}

		this._context.state = nextState;
		switch (nextState) {
			case DeepLinkServiceStates.Idle:
				if (action === DeepLinkServiceActions.DeepLinkResolved) {
					void window.showInformationMessage(`Deep link resolved: ${uri?.toString()}`);
				} else if (action === DeepLinkServiceActions.DeepLinkCanceled) {
					void window.showInformationMessage(`Deep link cancelled: ${uri?.toString()}`);
				} else if (action === DeepLinkServiceActions.DeepLinkErrored) {
					void window.showErrorMessage(`Error resolving deep link: ${data?.message ?? 'unknown error'}`);
				}

				this.resetContext();
				return;

			case DeepLinkServiceStates.RepoMatch:
			case DeepLinkServiceStates.AddedRepoMatch:
				if (!repoId) {
					nextAction = DeepLinkServiceActions.DeepLinkErrored;
					nextData = { message: 'No repo id was provided.' };
					break;
				}

				// Try to match a repo using the remote URL first, since that saves us some steps.
				// As a fallback, try to match using the repo id.
				for (const repo of this.container.git.repositories) {
					matchingRemotes = await repo.getRemotes({ filter: r => r.url === remoteUrl });
					if (matchingRemotes.length > 0) {
						this._context.repo = repo;
						this._context.remote = matchingRemotes[0];
						nextAction = DeepLinkServiceActions.RepoMatchedWithRemoteUrl;
						break;
					}

					// Repo ID can be any valid SHA in the repo, though standard practice is to use the
					// first commit SHA.
					if (await this.container.git.validateReference(repo.path, repoId)) {
						this._context.repo = repo;
						nextAction = DeepLinkServiceActions.RepoMatchedWithId;
						break;
					}
				}

				if (!this._context.repo) {
					if (nextState === DeepLinkServiceStates.RepoMatch) {
						nextAction = DeepLinkServiceActions.RepoMatchFailed;
					} else {
						nextAction = DeepLinkServiceActions.DeepLinkErrored;
						nextData = { message: 'No matching repo found.' };
					}
				}

				break;

			case DeepLinkServiceStates.CloneOrAddRepo:
				if (!repoId || !remoteUrl) {
					nextAction = DeepLinkServiceActions.DeepLinkErrored;
					nextData = { message: 'Missing repo id or remote url.' };
					break;
				}

				// TODO@ramint Instead of erroring, prompt the user to clone or add the repo, wait for the response,
				// and then choose an action based on whether the repo is successfully cloned/added, of the user
				// cancels, or if there is an error.
				nextAction = DeepLinkServiceActions.DeepLinkErrored;
				nextData = { message: 'No matching repo found.' };
				break;

			case DeepLinkServiceStates.RemoteMatch:
				if (!repo || !remoteUrl) {
					nextAction = DeepLinkServiceActions.DeepLinkErrored;
					nextData = { message: 'Missing repo or remote url.' };
					break;
				}

				matchingRemotes = await repo.getRemotes({ filter: r => r.url === remoteUrl });
				if (matchingRemotes.length > 0) {
					this._context.remote = matchingRemotes[0];
					nextAction = DeepLinkServiceActions.RemoteMatched;
					break;
				}

				if (!this._context.remote) {
					nextAction = DeepLinkServiceActions.RemoteMatchFailed;
				}

				break;

			case DeepLinkServiceStates.AddRemote:
				if (!repo || !remoteUrl) {
					nextAction = DeepLinkServiceActions.DeepLinkErrored;
					nextData = { message: 'Missing repo or remote url.' };
					break;
				}

				// TODO@ramint Instead of erroring here, prompt the user to add the remote, wait for the response,
				// and then choose an action based on whether the remote is successfully added, of the user
				// cancels, or if there is an error.
				nextAction = DeepLinkServiceActions.DeepLinkErrored;
				nextData = { message: 'No matching remote found.' };
				break;

			case DeepLinkServiceStates.TargetMatch:
			case DeepLinkServiceStates.FetchedTargetMatch:
				if (!repo || !remote || !targetType) {
					nextAction = DeepLinkServiceActions.DeepLinkErrored;
					nextData = { message: 'Missing repo, remote, or target type.' };
					break;
				}

				if (targetType === DeepLinkTypes.Remote) {
					nextAction = DeepLinkServiceActions.TargetMatched;
					break;
				}

				this._context.targetSha = await this.getShaForTarget();
				if (!this._context.targetSha) {
					if (nextState === DeepLinkServiceStates.TargetMatch) {
						nextAction = DeepLinkServiceActions.TargetMatchFailed;
					} else {
						nextAction = DeepLinkServiceActions.DeepLinkErrored;
						nextData = { message: 'No matching target found.' };
					}
					break;
				}

				nextAction = DeepLinkServiceActions.TargetMatched;
				break;

			case DeepLinkServiceStates.Fetch:
				if (!repo || !remote) {
					nextAction = DeepLinkServiceActions.DeepLinkErrored;
					nextData = { message: 'Missing repo or remote.' };
					break;
				}

				// TODO@ramint Instead of erroring here, prompt the user to fetch, wait for the response,
				// and then choose an action based on whether the fetch was successful, of the user
				// cancels, or if there is an error.
				nextAction = DeepLinkServiceActions.DeepLinkErrored;
				nextData = { message: 'No matching target found.' };
				break;

			case DeepLinkServiceStates.OpenGraph:
				if (!repo || !targetType) {
					nextAction = DeepLinkServiceActions.DeepLinkErrored;
					nextData = { message: 'Missing repo or target type.' };
					break;
				}

				if (targetType === DeepLinkTypes.Remote) {
					void executeCommand(Commands.ShowGraphPage, repo);
					nextAction = DeepLinkServiceActions.DeepLinkResolved;
					break;
				}

				if (!targetSha) {
					nextAction = DeepLinkServiceActions.DeepLinkErrored;
					nextData = { message: `Cannot find target ${targetType} in repo.` };
					break;
				}

				void (await executeCommand<ShowInCommitGraphCommandArgs>(Commands.ShowInCommitGraph, {
					ref: GitReference.create(targetSha, repo.path),
				}));

				nextAction = DeepLinkServiceActions.DeepLinkResolved;
				break;

			default:
				nextAction = DeepLinkServiceActions.DeepLinkErrored;
				nextData = { message: 'Unknown state.' };
				break;
		}

		const nextStateChange: DeepLinkServiceStateChange = {
			state: this._context.state,
			action: nextAction,
		};

		if (nextData) {
			nextStateChange.data = nextData;
		}

		this._stateChange.fire(nextStateChange);
	}
}

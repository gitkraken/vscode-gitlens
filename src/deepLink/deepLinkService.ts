import type { Disposable, Uri } from 'vscode';
import { EventEmitter } from 'vscode';
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
	RepoMatched = 'RepoMatched',
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

export class DeepLinkService implements Disposable {
	private _disposables: Disposable[] = [];
	private _state: DeepLinkServiceState = DeepLinkServiceStates.Idle;
	private _stateChange = new EventEmitter<DeepLinkServiceStateChange>();
	private _uri: Uri | undefined;
	private _repoId: string | undefined;
	private _repo: Repository | undefined;
	private _remoteUrl: string | undefined;
	private _remote: GitRemote | undefined;
	private _targetId: string | undefined;
	private _targetType: DeepLinkType | undefined;
	private _targetSha: string | undefined;
	private _transitionTable: { [state: string]: { [action: string]: DeepLinkServiceState } } = {
		[DeepLinkServiceStates.Idle]: {
			[DeepLinkServiceActions.DeepLinkEventFired]: DeepLinkServiceStates.RepoMatch,
		},
		[DeepLinkServiceStates.RepoMatch]: {
			[DeepLinkServiceActions.RepoMatched]: DeepLinkServiceStates.RemoteMatch,
			[DeepLinkServiceActions.RepoMatchFailed]: DeepLinkServiceStates.CloneOrAddRepo,
		},
		[DeepLinkServiceStates.CloneOrAddRepo]: {
			[DeepLinkServiceActions.RepoAdded]: DeepLinkServiceStates.AddedRepoMatch,
			[DeepLinkServiceActions.DeepLinkErrored]: DeepLinkServiceStates.Idle,
			[DeepLinkServiceActions.DeepLinkCanceled]: DeepLinkServiceStates.Idle,
		},
		[DeepLinkServiceStates.AddedRepoMatch]: {
			[DeepLinkServiceActions.RepoMatched]: DeepLinkServiceStates.RemoteMatch,
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
		this._state = DeepLinkServiceStates.Idle;
		this._disposables = [
			container.uri.onUri((event: UriEvent) => {
				if (event.type === UriTypes.DeepLink && this._state === DeepLinkServiceStates.Idle) {
					if (!Object.values(DeepLinkTypes).includes(event.linkType)) {
						// TODO@ramint Give an error message.
						return;
					}

					if (!event.repoId || !event.linkType || !event.uri || !event.remoteUrl) {
						// TODO@ramint Give an error message.
						return;
					}

					if (event.linkType !== DeepLinkTypes.Remote && !event.targetId) {
						// TODO@ramint Give an error message.
						return;
					}

					this._repoId = event.repoId;
					this._targetType = event.linkType;
					this._uri = event.uri;
					this._remoteUrl = event.remoteUrl;
					this._targetId = event.targetId;

					this._stateChange.fire({
						state: this._state,
						action: DeepLinkServiceActions.DeepLinkEventFired,
					});
				}
			}),
			this._stateChange.event(async (serviceStateChange: DeepLinkServiceStateChange) => {
				await this.handleDeepLinkStateChange(serviceStateChange);
			}),
		];
	}

	dispose() {
		this._disposables.forEach((disposable: Disposable) => void disposable.dispose());
	}

	async getShaForTarget(): Promise<string | undefined> {
		if (!this._repo || !this._remote || this._targetType === DeepLinkTypes.Remote || !this._targetId) {
			return undefined;
		}

		if (this._targetType === DeepLinkTypes.Branch) {
			// Form the target branch name using the remote name and branch name
			const branchName = `${this._remote.name}/${this._targetId}`;
			const branch = await this._repo.getBranch(branchName);
			if (branch) {
				return branch.sha;
			}

			return undefined;
		}

		if (this._targetType === DeepLinkTypes.Tag) {
			const tag = await this._repo.getTag(this._targetId);
			if (tag) {
				return tag.sha;
			}

			return undefined;
		}

		if (this._targetType === DeepLinkTypes.Commit) {
			if (await this.container.git.validateReference(this._repo.path, this._targetId)) {
				return this._targetId;
			}

			return undefined;
		}

		return undefined;
	}

	async handleDeepLinkStateChange(serviceStateChange: DeepLinkServiceStateChange) {
		const { state, action } = serviceStateChange;
		let nextState = this._transitionTable[state][action];
		let nextData: any;
		let nextAction: DeepLinkServiceAction = DeepLinkServiceActions.DeepLinkErrored;
		if (!nextState) {
			nextState = DeepLinkServiceStates.Idle;
		}

		this._state = nextState;
		switch (nextState) {
			case DeepLinkServiceStates.Idle:
				this._repoId = undefined;
				this._repo = undefined;
				this._remoteUrl = undefined;
				this._remote = undefined;
				this._targetId = undefined;
				this._targetSha = undefined;

				if (action === DeepLinkServiceActions.DeepLinkResolved) {
					// TODO@ramint Show a message that the deep link was resolved.
				}

				if (action === DeepLinkServiceActions.DeepLinkCanceled) {
					// TODO@ramint Show a message that the deep link was canceled.
				}

				if (action === DeepLinkServiceActions.DeepLinkErrored) {
					// TODO@ramint Show a message that the deep link errored.
				}

				return;

			case DeepLinkServiceStates.RepoMatch:
			case DeepLinkServiceStates.AddedRepoMatch:
				if (!this._repoId) {
					nextAction = DeepLinkServiceActions.DeepLinkErrored;
					nextData = { message: 'No repo id was provided.' };
					break;
				}

				for (const repo of this.container.git.repositories) {
					if (await this.container.git.validateReference(repo.path, this._repoId)) {
						this._repo = repo;
						nextAction = DeepLinkServiceActions.RepoMatched;
						break;
					}
				}

				if (!this._repo) {
					if (nextState === DeepLinkServiceStates.RepoMatch) {
						nextAction = DeepLinkServiceActions.RepoMatchFailed;
					} else {
						nextAction = DeepLinkServiceActions.DeepLinkErrored;
						nextData = { message: 'No matching repo found.' };
					}
				}

				break;

			case DeepLinkServiceStates.CloneOrAddRepo:
				if (!this._repoId || !this._remoteUrl) {
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
				if (!this._repo || !this._remoteUrl) {
					nextAction = DeepLinkServiceActions.DeepLinkErrored;
					nextData = { message: 'Missing repo or remote url.' };
					break;
				}

				for (const remote of await this._repo.getRemotes()) {
					if (remote.url === this._remoteUrl) {
						this._remote = remote;
						nextAction = DeepLinkServiceActions.RemoteMatched;
						break;
					}
				}

				if (!this._remote) {
					nextAction = DeepLinkServiceActions.RemoteMatchFailed;
				}

				break;

			case DeepLinkServiceStates.AddRemote:
				if (!this._repo || !this._remoteUrl) {
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
				if (!this._repo || !this._remote || !this._targetType) {
					nextAction = DeepLinkServiceActions.DeepLinkErrored;
					nextData = { message: 'Missing repo, remote, or target type.' };
					break;
				}

				if (this._targetType === DeepLinkTypes.Remote) {
					nextAction = DeepLinkServiceActions.TargetMatched;
					break;
				}

				this._targetSha = await this.getShaForTarget();
				if (!this._targetSha) {
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
				if (!this._repo || !this._remote) {
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
				if (!this._repo || !this._targetType) {
					nextAction = DeepLinkServiceActions.DeepLinkErrored;
					nextData = { message: 'Missing repo or target type.' };
					break;
				}

				if (this._targetType === DeepLinkTypes.Remote) {
					void executeCommand(Commands.ShowGraphPage, { repoUri: this._repo.uri });
					nextAction = DeepLinkServiceActions.DeepLinkResolved;
					break;
				}

				if (!this._targetSha) {
					nextAction = DeepLinkServiceActions.DeepLinkErrored;
					nextData = { message: `Cannot find target ${this._targetType} in repo.` };
					break;
				}

				void (await executeCommand<ShowInCommitGraphCommandArgs>(Commands.ShowInCommitGraph, {
					ref: GitReference.create(this._targetSha, this._repo.path),
				}));

				nextAction = DeepLinkServiceActions.DeepLinkResolved;
				break;

			default:
				nextAction = DeepLinkServiceActions.DeepLinkErrored;
				nextData = { message: 'Unknown state.' };
				break;
		}

		const nextStateChange: DeepLinkServiceStateChange = {
			state: this._state,
			action: nextAction,
		};

		if (nextData) {
			nextStateChange.data = nextData;
		}

		this._stateChange.fire(nextStateChange);
	}
}

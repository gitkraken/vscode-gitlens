import type { Uri } from 'vscode';
import type { GitRemote } from '../git/models/remote';
import type { Repository } from '../git/models/repository';

export enum DeepLinkType {
	Branch = 'b',
	Commit = 'c',
	Repository = 'r',
	Tag = 't',
}

export const enum DeepLinkServiceState {
	Idle,
	RepoMatch,
	CloneOrAddRepo,
	AddedRepoMatch,
	RemoteMatch,
	AddRemote,
	TargetMatch,
	Fetch,
	FetchedTargetMatch,
	OpenGraph,
}

export const enum DeepLinkServiceAction {
	DeepLinkEventFired,
	DeepLinkCancelled,
	DeepLinkResolved,
	DeepLinkErrored,
	RepoMatchedWithId,
	RepoMatchedWithRemoteUrl,
	RepoMatchFailed,
	RepoAdded,
	RemoteMatched,
	RemoteMatchFailed,
	RemoteAdded,
	TargetIsRemote,
	TargetMatched,
	TargetMatchFailed,
	TargetFetched,
}

export interface DeepLinkServiceContext {
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

export const deepLinkStateTransitionTable: { [state: string]: { [action: string]: DeepLinkServiceState } } = {
	[DeepLinkServiceState.Idle]: {
		[DeepLinkServiceAction.DeepLinkEventFired]: DeepLinkServiceState.RepoMatch,
	},
	[DeepLinkServiceState.RepoMatch]: {
		[DeepLinkServiceAction.RepoMatchedWithId]: DeepLinkServiceState.RemoteMatch,
		[DeepLinkServiceAction.RepoMatchedWithRemoteUrl]: DeepLinkServiceState.TargetMatch,
		[DeepLinkServiceAction.RepoMatchFailed]: DeepLinkServiceState.CloneOrAddRepo,
	},
	[DeepLinkServiceState.CloneOrAddRepo]: {
		[DeepLinkServiceAction.RepoAdded]: DeepLinkServiceState.AddedRepoMatch,
		[DeepLinkServiceAction.DeepLinkErrored]: DeepLinkServiceState.Idle,
		[DeepLinkServiceAction.DeepLinkCancelled]: DeepLinkServiceState.Idle,
	},
	[DeepLinkServiceState.AddedRepoMatch]: {
		[DeepLinkServiceAction.RepoMatchedWithId]: DeepLinkServiceState.RemoteMatch,
		[DeepLinkServiceAction.RepoMatchedWithRemoteUrl]: DeepLinkServiceState.TargetMatch,
		[DeepLinkServiceAction.DeepLinkErrored]: DeepLinkServiceState.Idle,
	},
	[DeepLinkServiceState.RemoteMatch]: {
		[DeepLinkServiceAction.RemoteMatched]: DeepLinkServiceState.TargetMatch,
		[DeepLinkServiceAction.RemoteMatchFailed]: DeepLinkServiceState.AddRemote,
	},
	[DeepLinkServiceState.AddRemote]: {
		[DeepLinkServiceAction.RemoteAdded]: DeepLinkServiceState.OpenGraph,
		[DeepLinkServiceAction.DeepLinkErrored]: DeepLinkServiceState.Idle,
		[DeepLinkServiceAction.DeepLinkCancelled]: DeepLinkServiceState.Idle,
	},
	[DeepLinkServiceState.TargetMatch]: {
		[DeepLinkServiceAction.TargetIsRemote]: DeepLinkServiceState.OpenGraph,
		[DeepLinkServiceAction.TargetMatched]: DeepLinkServiceState.OpenGraph,
		[DeepLinkServiceAction.TargetMatchFailed]: DeepLinkServiceState.Fetch,
	},
	[DeepLinkServiceState.Fetch]: {
		[DeepLinkServiceAction.TargetFetched]: DeepLinkServiceState.FetchedTargetMatch,
		[DeepLinkServiceAction.DeepLinkErrored]: DeepLinkServiceState.Idle,
		[DeepLinkServiceAction.DeepLinkCancelled]: DeepLinkServiceState.Idle,
	},
	[DeepLinkServiceState.FetchedTargetMatch]: {
		[DeepLinkServiceAction.TargetMatched]: DeepLinkServiceState.OpenGraph,
		[DeepLinkServiceAction.DeepLinkErrored]: DeepLinkServiceState.Idle,
	},
	[DeepLinkServiceState.OpenGraph]: {
		[DeepLinkServiceAction.DeepLinkResolved]: DeepLinkServiceState.Idle,
		[DeepLinkServiceAction.DeepLinkErrored]: DeepLinkServiceState.Idle,
	},
};

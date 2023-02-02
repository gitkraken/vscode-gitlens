import type { Uri } from 'vscode';
import type { GitRemote } from '../../git/models/remote';
import type { Repository } from '../../git/models/repository';

export const enum UriTypes {
	DeepLink = 'link',
}

export enum DeepLinkType {
	Branch = 'b',
	Commit = 'c',
	Repository = 'r',
	Tag = 't',
}

export interface DeepLink {
	type: DeepLinkType;
	uri: Uri;
	repoId: string;
	remoteUrl: string;
	targetId?: string;
}

export function parseDeepLinkUri(uri: Uri): DeepLink | undefined {
	// The link target id is everything after the link target.
	// For example, if the uri is /link/r/{repoId}/b/{branchName}?url={remoteUrl},
	// the link target id is {branchName}
	const [, type, prefix, repoId, target, ...targetId] = uri.path.split('/');
	if (type !== UriTypes.DeepLink || prefix !== DeepLinkType.Repository) return undefined;

	const remoteUrl = new URLSearchParams(uri.query).get('url');
	if (!remoteUrl) return undefined;

	if (target == null) {
		return {
			type: DeepLinkType.Repository,
			uri: uri,
			repoId: repoId,
			remoteUrl: remoteUrl,
		};
	}

	return {
		type: target as DeepLinkType,
		uri: uri,
		repoId: repoId,
		remoteUrl: remoteUrl,
		targetId: targetId.join('/'),
	};
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

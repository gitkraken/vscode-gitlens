import type { Uri } from 'vscode';
import type { GitReference } from '../../git/models/reference';
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

export function deepLinkTypeToString(type: DeepLinkType): string {
	switch (type) {
		case DeepLinkType.Branch:
			return 'Branch';
		case DeepLinkType.Commit:
			return 'Commit';
		case DeepLinkType.Repository:
			return 'Repository';
		case DeepLinkType.Tag:
			return 'Tag';
		default:
			debugger;
			return 'Unknown';
	}
}

export function refTypeToDeepLinkType(refType: GitReference['refType']): DeepLinkType {
	switch (refType) {
		case 'branch':
			return DeepLinkType.Branch;
		case 'revision':
			return DeepLinkType.Commit;
		case 'tag':
			return DeepLinkType.Tag;
		default:
			return DeepLinkType.Repository;
	}
}

export interface DeepLink {
	type: DeepLinkType;
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
			repoId: repoId,
			remoteUrl: remoteUrl,
		};
	}

	return {
		type: target as DeepLinkType,
		repoId: repoId,
		remoteUrl: remoteUrl,
		targetId: targetId.join('/'),
	};
}

export const enum DeepLinkServiceState {
	Idle,
	RepoMatch,
	CloneOrAddRepo,
	OpeningRepo,
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
	DeepLinkStored,
	DeepLinkErrored,
	OpenRepo,
	RepoMatchedWithId,
	RepoMatchedWithRemoteUrl,
	RepoMatchFailed,
	RepoAdded,
	RepoOpened,
	RemoteMatched,
	RemoteMatchFailed,
	RemoteAdded,
	TargetMatched,
	TargetMatchFailed,
	TargetFetched,
}

export const enum DeepLinkRepoOpenType {
	Folder = 'folder',
	Workspace = 'workspace',
}

export interface DeepLinkServiceContext {
	state: DeepLinkServiceState;
	url?: string | undefined;
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
		[DeepLinkServiceAction.DeepLinkErrored]: DeepLinkServiceState.Idle,
		[DeepLinkServiceAction.RepoMatchedWithId]: DeepLinkServiceState.RemoteMatch,
		[DeepLinkServiceAction.RepoMatchedWithRemoteUrl]: DeepLinkServiceState.TargetMatch,
		[DeepLinkServiceAction.RepoMatchFailed]: DeepLinkServiceState.CloneOrAddRepo,
	},
	[DeepLinkServiceState.CloneOrAddRepo]: {
		[DeepLinkServiceAction.OpenRepo]: DeepLinkServiceState.OpeningRepo,
		[DeepLinkServiceAction.RepoOpened]: DeepLinkServiceState.RemoteMatch,
		[DeepLinkServiceAction.DeepLinkErrored]: DeepLinkServiceState.Idle,
		[DeepLinkServiceAction.DeepLinkCancelled]: DeepLinkServiceState.Idle,
		[DeepLinkServiceAction.DeepLinkStored]: DeepLinkServiceState.Idle,
	},
	[DeepLinkServiceState.OpeningRepo]: {
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
		[DeepLinkServiceAction.DeepLinkErrored]: DeepLinkServiceState.Idle,
		[DeepLinkServiceAction.RemoteMatched]: DeepLinkServiceState.TargetMatch,
		[DeepLinkServiceAction.RemoteMatchFailed]: DeepLinkServiceState.AddRemote,
	},
	[DeepLinkServiceState.AddRemote]: {
		[DeepLinkServiceAction.RemoteAdded]: DeepLinkServiceState.TargetMatch,
		[DeepLinkServiceAction.DeepLinkErrored]: DeepLinkServiceState.Idle,
		[DeepLinkServiceAction.DeepLinkCancelled]: DeepLinkServiceState.Idle,
	},
	[DeepLinkServiceState.TargetMatch]: {
		[DeepLinkServiceAction.DeepLinkErrored]: DeepLinkServiceState.Idle,
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

export interface DeepLinkProgress {
	message: string;
	increment: number;
}

export const deepLinkStateToProgress: { [state: string]: DeepLinkProgress } = {
	[DeepLinkServiceState.Idle]: { message: 'Done.', increment: 100 },
	[DeepLinkServiceState.RepoMatch]: { message: 'Finding a matching repository...', increment: 10 },
	[DeepLinkServiceState.CloneOrAddRepo]: { message: 'Adding repository...', increment: 20 },
	[DeepLinkServiceState.OpeningRepo]: { message: 'Opening repository...', increment: 30 },
	[DeepLinkServiceState.AddedRepoMatch]: { message: 'Finding a matching repository...', increment: 40 },
	[DeepLinkServiceState.RemoteMatch]: { message: 'Finding a matching remote...', increment: 50 },
	[DeepLinkServiceState.AddRemote]: { message: 'Adding remote...', increment: 60 },
	[DeepLinkServiceState.TargetMatch]: { message: 'finding a matching target...', increment: 70 },
	[DeepLinkServiceState.Fetch]: { message: 'Fetching...', increment: 80 },
	[DeepLinkServiceState.FetchedTargetMatch]: { message: 'Finding a matching target...', increment: 90 },
	[DeepLinkServiceState.OpenGraph]: { message: 'Opening graph...', increment: 95 },
};

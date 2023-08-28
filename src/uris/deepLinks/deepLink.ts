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
	Comparison = 'compare',
	Patch = 'drafts',
	Repository = 'r',
	Tag = 't',
}

export function deepLinkTypeToString(type: DeepLinkType): string {
	switch (type) {
		case DeepLinkType.Branch:
			return 'Branch';
		case DeepLinkType.Commit:
			return 'Commit';
		case DeepLinkType.Comparison:
			return 'Comparison';
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
	repoId?: string;
	remoteUrl?: string;
	repoPath?: string;
	targetId?: string;
	secondaryTargetId?: string;
	secondaryRemoteUrl?: string;
}

export function parseDeepLinkUri(uri: Uri): DeepLink | undefined {
	// The link target id is everything after the link target.
	// For example, if the uri is /link/r/{repoId}/b/{branchName}?url={remoteUrl},
	// the link target id is {branchName}
	const [, type, prefix, baseId, target, ...rest] = uri.path.split('/');
	if (type !== UriTypes.DeepLink || (prefix !== DeepLinkType.Repository && prefix !== DeepLinkType.Patch)) {
		return undefined;
	}

	const urlParams = new URLSearchParams(uri.query);
	switch (prefix) {
		case DeepLinkType.Repository: {
			let remoteUrl = urlParams.get('url') ?? undefined;
			if (remoteUrl != null) {
				remoteUrl = decodeURIComponent(remoteUrl);
			}
			let repoPath = urlParams.get('path') ?? undefined;
			if (repoPath != null) {
				repoPath = decodeURIComponent(repoPath);
			}
			if (!remoteUrl && !repoPath) return undefined;

			if (target == null) {
				return {
					type: DeepLinkType.Repository,
					repoId: baseId,
					remoteUrl: remoteUrl,
					repoPath: repoPath,
				};
			}

			if (rest == null || rest.length === 0) return undefined;

			let targetId: string;
			let secondaryTargetId: string | undefined;
            let secondaryRemoteUrl: string | undefined;
			const joined = rest.join('/');

			if (target === DeepLinkType.Comparison) {
				const split = joined.split(/(\.\.\.|\.\.)/);
				if (split.length !== 3) return undefined;
				targetId = split[0];
				secondaryTargetId = split[2];
                secondaryRemoteUrl = urlParams.get('prRepoUrl') ?? undefined;
                if (secondaryRemoteUrl != null) {
			        secondaryRemoteUrl = decodeURIComponent(secondaryRemoteUrl);
		        }
			} else {
				targetId = joined;
			}

			return {
				type: target as DeepLinkType,
				repoId: baseId,
				remoteUrl: remoteUrl,
				repoPath: repoPath,
				targetId: targetId,
				secondaryTargetId: secondaryTargetId,
                secondaryRemoteUrl: secondaryRemoteUrl,
			};
		}
		case DeepLinkType.Patch: {
			if (baseId == null || baseId.match(/^v\d+$/)) return undefined;

			let patchId = urlParams.get('patch') ?? undefined;
			if (patchId != null) {
				patchId = decodeURIComponent(patchId);
			}

			return {
				type: DeepLinkType.Patch,
				targetId: baseId,
				secondaryTargetId: patchId,
			};
		}

		default:
			return undefined;
	}
}

export const enum DeepLinkServiceState {
	Idle,
	TypeMatch,
	OpenPatch,
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
	OpenComparison,
}

export const enum DeepLinkServiceAction {
	DeepLinkEventFired,
	DeepLinkCancelled,
	DeepLinkResolved,
	DeepLinkStored,
	DeepLinkErrored,
	PatchTypeMatched,
	RepoTypeMatched,
	OpenRepo,
	RepoMatched,
	RepoMatchedInLocalMapping,
	RepoMatchFailed,
	RepoAdded,
	RepoOpened,
	RemoteMatched,
	RemoteMatchFailed,
	RemoteMatchUnneeded,
	RemoteAdded,
	TargetMatched,
	TargetsMatched,
	TargetMatchFailed,
	TargetFetched,
}

export const enum DeepLinkRepoOpenType {
	Clone = 'clone',
	Folder = 'folder',
	Workspace = 'workspace',
	Current = 'current',
}

export interface DeepLinkServiceContext {
	state: DeepLinkServiceState;
	url?: string | undefined;
	repoId?: string | undefined;
	repo?: Repository | undefined;
	remoteUrl?: string | undefined;
	remote?: GitRemote | undefined;
	secondaryRemote?: GitRemote | undefined;
	repoPath?: string | undefined;
	targetId?: string | undefined;
	secondaryTargetId?: string | undefined;
	secondaryRemoteUrl?: string | undefined;
	targetType?: DeepLinkType | undefined;
	targetSha?: string | undefined;
	secondaryTargetSha?: string | undefined;
}

export const deepLinkStateTransitionTable: Record<string, Record<string, DeepLinkServiceState>> = {
	[DeepLinkServiceState.Idle]: {
		[DeepLinkServiceAction.DeepLinkEventFired]: DeepLinkServiceState.TypeMatch,
	},
	[DeepLinkServiceState.TypeMatch]: {
		[DeepLinkServiceAction.DeepLinkErrored]: DeepLinkServiceState.Idle,
		[DeepLinkServiceAction.PatchTypeMatched]: DeepLinkServiceState.OpenPatch,
		[DeepLinkServiceAction.RepoTypeMatched]: DeepLinkServiceState.RepoMatch,
	},
	[DeepLinkServiceState.OpenPatch]: {
		[DeepLinkServiceAction.DeepLinkResolved]: DeepLinkServiceState.Idle,
		[DeepLinkServiceAction.DeepLinkErrored]: DeepLinkServiceState.Idle,
	},
	[DeepLinkServiceState.RepoMatch]: {
		[DeepLinkServiceAction.DeepLinkErrored]: DeepLinkServiceState.Idle,
		[DeepLinkServiceAction.RepoMatched]: DeepLinkServiceState.RemoteMatch,
		[DeepLinkServiceAction.RepoMatchedInLocalMapping]: DeepLinkServiceState.CloneOrAddRepo,
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
		[DeepLinkServiceAction.RepoMatched]: DeepLinkServiceState.RemoteMatch,
		[DeepLinkServiceAction.DeepLinkErrored]: DeepLinkServiceState.Idle,
	},
	[DeepLinkServiceState.RemoteMatch]: {
		[DeepLinkServiceAction.DeepLinkErrored]: DeepLinkServiceState.Idle,
		[DeepLinkServiceAction.RemoteMatched]: DeepLinkServiceState.TargetMatch,
		[DeepLinkServiceAction.RemoteMatchFailed]: DeepLinkServiceState.AddRemote,
		[DeepLinkServiceAction.RemoteMatchUnneeded]: DeepLinkServiceState.TargetMatch,
	},
	[DeepLinkServiceState.AddRemote]: {
		[DeepLinkServiceAction.RemoteAdded]: DeepLinkServiceState.TargetMatch,
		[DeepLinkServiceAction.DeepLinkErrored]: DeepLinkServiceState.Idle,
		[DeepLinkServiceAction.DeepLinkCancelled]: DeepLinkServiceState.Idle,
	},
	[DeepLinkServiceState.TargetMatch]: {
		[DeepLinkServiceAction.DeepLinkErrored]: DeepLinkServiceState.Idle,
		[DeepLinkServiceAction.TargetMatched]: DeepLinkServiceState.OpenGraph,
		[DeepLinkServiceAction.TargetsMatched]: DeepLinkServiceState.OpenComparison,
		[DeepLinkServiceAction.TargetMatchFailed]: DeepLinkServiceState.Fetch,
	},
	[DeepLinkServiceState.Fetch]: {
		[DeepLinkServiceAction.TargetFetched]: DeepLinkServiceState.FetchedTargetMatch,
		[DeepLinkServiceAction.DeepLinkErrored]: DeepLinkServiceState.Idle,
		[DeepLinkServiceAction.DeepLinkCancelled]: DeepLinkServiceState.Idle,
	},
	[DeepLinkServiceState.FetchedTargetMatch]: {
		[DeepLinkServiceAction.TargetMatched]: DeepLinkServiceState.OpenGraph,
		[DeepLinkServiceAction.TargetsMatched]: DeepLinkServiceState.OpenComparison,
		[DeepLinkServiceAction.DeepLinkErrored]: DeepLinkServiceState.Idle,
	},
	[DeepLinkServiceState.OpenGraph]: {
		[DeepLinkServiceAction.DeepLinkResolved]: DeepLinkServiceState.Idle,
		[DeepLinkServiceAction.DeepLinkErrored]: DeepLinkServiceState.Idle,
	},
	[DeepLinkServiceState.OpenComparison]: {
		[DeepLinkServiceAction.DeepLinkResolved]: DeepLinkServiceState.Idle,
		[DeepLinkServiceAction.DeepLinkErrored]: DeepLinkServiceState.Idle,
	},
};

export interface DeepLinkProgress {
	message: string;
	increment: number;
}

export const deepLinkStateToProgress: Record<string, DeepLinkProgress> = {
	[DeepLinkServiceState.Idle]: { message: 'Done.', increment: 100 },
	[DeepLinkServiceState.TypeMatch]: { message: 'Matching link type...', increment: 5 },
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
	[DeepLinkServiceState.OpenComparison]: { message: 'Opening comparison...', increment: 95 },
	[DeepLinkServiceState.OpenPatch]: { message: 'Opening cloud patch...', increment: 95 },
};

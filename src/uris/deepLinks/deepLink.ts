import type { Uri } from 'vscode';
import type { Commands } from '../../constants.commands';
import { GlCommand } from '../../constants.commands';
import type { GitReference } from '../../git/models/reference';
import type { GitRemote } from '../../git/models/remote';
import type { Repository } from '../../git/models/repository';
import type { OpenWorkspaceLocation } from '../../system/vscode/utils';

export type UriTypes = 'link';

export enum DeepLinkType {
	Branch = 'b',
	Command = 'command',
	Commit = 'c',
	Comparison = 'compare',
	Draft = 'drafts',
	File = 'f',
	Repository = 'r',
	Tag = 't',
	Workspace = 'workspace',
}

export enum DeepLinkCommandType {
	CloudPatches = 'cloud-patches',
	Graph = 'graph',
	Home = 'home',
	Inspect = 'inspect',
	Launchpad = 'launchpad',
	Walkthrough = 'walkthrough',
	Worktrees = 'worktrees',
}

export function isDeepLinkCommandType(type: string): type is DeepLinkCommandType {
	return Object.values(DeepLinkCommandType).includes(type as DeepLinkCommandType);
}

export const DeepLinkCommandTypeToCommand = new Map<DeepLinkCommandType, Commands>([
	[DeepLinkCommandType.CloudPatches, GlCommand.ShowDraftsView],
	[DeepLinkCommandType.Graph, GlCommand.ShowGraph],
	[DeepLinkCommandType.Home, GlCommand.ShowHomeView],
	[DeepLinkCommandType.Inspect, GlCommand.ShowCommitDetailsView],
	[DeepLinkCommandType.Launchpad, GlCommand.ShowLaunchpad],
	[DeepLinkCommandType.Walkthrough, GlCommand.GetStarted],
	[DeepLinkCommandType.Worktrees, GlCommand.ShowWorktreesView],
]);

export enum DeepLinkActionType {
	Switch = 'switch',
	SwitchToPullRequest = 'switch-to-pr',
	SwitchToPullRequestWorktree = 'switch-to-pr-worktree',
	SwitchToAndSuggestPullRequest = 'switch-to-and-suggest-pr',
}

export const AccountDeepLinkTypes: DeepLinkType[] = [DeepLinkType.Draft, DeepLinkType.Workspace];
export const PaidDeepLinkTypes: DeepLinkType[] = [];

export function deepLinkTypeToString(type: DeepLinkType): string {
	switch (type) {
		case DeepLinkType.Branch:
			return 'Branch';
		case DeepLinkType.Command:
			return 'Command';
		case DeepLinkType.Commit:
			return 'Commit';
		case DeepLinkType.Comparison:
			return 'Comparison';
		case DeepLinkType.Draft:
			return 'Cloud Patch';
		case DeepLinkType.File:
			return 'File';
		case DeepLinkType.Repository:
			return 'Repository';
		case DeepLinkType.Tag:
			return 'Tag';
		case DeepLinkType.Workspace:
			return 'Workspace';
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
	mainId?: string;
	remoteUrl?: string;
	repoPath?: string;
	filePath?: string;
	targetId?: string;
	secondaryTargetId?: string;
	secondaryRemoteUrl?: string;
	action?: string;
	prId?: string;
	params?: URLSearchParams;
}

export function parseDeepLinkUri(uri: Uri): DeepLink | undefined {
	// The link target id is everything after the link target.
	// For example, if the uri is /link/r/{repoId}/b/{branchName}?url={remoteUrl},
	// the link target id is {branchName}
	const [, type, prefix, mainId, target, ...rest] = uri.path.split('/');
	if (type !== 'link') return undefined;

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

			const action = urlParams.get('action') ?? undefined;

			if (target == null) {
				return {
					type: DeepLinkType.Repository,
					mainId: mainId,
					remoteUrl: remoteUrl,
					repoPath: repoPath,
				};
			}

			if (rest == null || rest.length === 0) return undefined;

			let targetId: string | undefined;
			let secondaryTargetId: string | undefined;
			let secondaryRemoteUrl: string | undefined;
			let filePath: string | undefined;
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
			} else if (target === DeepLinkType.File) {
				filePath = joined;
				let ref = urlParams.get('ref') ?? undefined;
				if (ref != null) {
					ref = decodeURIComponent(ref);
				}
				targetId = ref;
				let lines = urlParams.get('lines') ?? undefined;
				if (lines != null) {
					lines = decodeURIComponent(lines);
				}
				secondaryTargetId = lines;
			} else {
				targetId = joined;
			}

			return {
				type: target as DeepLinkType,
				mainId: mainId,
				remoteUrl: remoteUrl,
				repoPath: repoPath,
				filePath: filePath,
				targetId: targetId,
				secondaryTargetId: secondaryTargetId,
				secondaryRemoteUrl: secondaryRemoteUrl,
				action: action,
				params: urlParams,
				prId: urlParams.get('prId') ?? undefined,
			};
		}
		case DeepLinkType.Draft: {
			if (mainId == null || mainId.match(/^v\d+$/)) return undefined;

			let patchId = urlParams.get('patch') ?? undefined;
			if (patchId != null) {
				patchId = decodeURIComponent(patchId);
			}

			return {
				type: DeepLinkType.Draft,
				targetId: mainId,
				secondaryTargetId: patchId,
				params: urlParams,
			};
		}
		case DeepLinkType.Workspace: {
			return {
				type: DeepLinkType.Workspace,
				mainId: mainId,
				params: urlParams,
			};
		}
		case DeepLinkType.Command: {
			return {
				type: DeepLinkType.Command,
				mainId: mainId,
				params: urlParams,
			};
		}
		default:
			return undefined;
	}
}

export const enum DeepLinkServiceState {
	Idle,
	AccountCheck,
	PlanCheck,
	TypeMatch,
	RepoMatch,
	CloneOrAddRepo,
	AddedRepoMatch,
	RemoteMatch,
	AddRemote,
	TargetMatch,
	Fetch,
	FetchedTargetMatch,
	MaybeOpenRepo,
	RepoOpening,
	EnsureRemoteMatch,
	GoToTarget,
	OpenGraph,
	OpenComparison,
	OpenDraft,
	OpenWorkspace,
	OpenFile,
	OpenInspect,
	SwitchToRef,
	RunCommand,
	OpenAllPrChanges,
}

export const enum DeepLinkServiceAction {
	AccountCheckPassed,
	DeepLinkEventFired,
	DeepLinkCancelled,
	DeepLinkResolved,
	DeepLinkStored,
	DeepLinkErrored,
	LinkIsCommandType,
	LinkIsRepoType,
	LinkIsDraftType,
	LinkIsWorkspaceType,
	PlanCheckPassed,
	RepoMatched,
	RepoMatchedInLocalMapping,
	RepoMatchFailed,
	RepoAdded,
	RemoteMatched,
	RemoteMatchFailed,
	RemoteMatchUnneeded,
	RemoteAdded,
	TargetMatched,
	TargetMatchFailed,
	TargetFetched,
	RepoOpened,
	RepoOpening,
	OpenGraph,
	OpenComparison,
	OpenFile,
	OpenInspect,
	OpenSwitch,
	OpenAllPrChanges,
}

export type DeepLinkRepoOpenType = 'clone' | 'folder' | 'workspace' | 'current';

export interface DeepLinkServiceContext {
	state: DeepLinkServiceState;
	url?: string | undefined;
	mainId?: string | undefined;
	repo?: Repository | undefined;
	remoteUrl?: string | undefined;
	remote?: GitRemote | undefined;
	secondaryRemote?: GitRemote | undefined;
	repoPath?: string | undefined;
	filePath?: string | undefined;
	targetId?: string | undefined;
	secondaryTargetId?: string | undefined;
	secondaryRemoteUrl?: string | undefined;
	targetType?: DeepLinkType | undefined;
	targetSha?: string | undefined;
	secondaryTargetSha?: string | undefined;
	action?: string | undefined;
	repoOpenLocation?: OpenWorkspaceLocation | undefined;
	repoOpenUri?: Uri | undefined;
	params?: URLSearchParams | undefined;
	currentBranch?: string | undefined;
}

export const deepLinkStateTransitionTable: Record<string, Record<string, DeepLinkServiceState>> = {
	[DeepLinkServiceState.Idle]: {
		[DeepLinkServiceAction.DeepLinkEventFired]: DeepLinkServiceState.AccountCheck,
		[DeepLinkServiceAction.DeepLinkCancelled]: DeepLinkServiceState.Idle,
	},
	[DeepLinkServiceState.AccountCheck]: {
		[DeepLinkServiceAction.AccountCheckPassed]: DeepLinkServiceState.PlanCheck,
		[DeepLinkServiceAction.DeepLinkErrored]: DeepLinkServiceState.Idle,
		[DeepLinkServiceAction.DeepLinkCancelled]: DeepLinkServiceState.Idle,
	},
	[DeepLinkServiceState.PlanCheck]: {
		[DeepLinkServiceAction.PlanCheckPassed]: DeepLinkServiceState.TypeMatch,
		[DeepLinkServiceAction.DeepLinkErrored]: DeepLinkServiceState.Idle,
		[DeepLinkServiceAction.DeepLinkCancelled]: DeepLinkServiceState.Idle,
	},
	[DeepLinkServiceState.TypeMatch]: {
		[DeepLinkServiceAction.DeepLinkErrored]: DeepLinkServiceState.Idle,
		[DeepLinkServiceAction.DeepLinkCancelled]: DeepLinkServiceState.Idle,
		[DeepLinkServiceAction.LinkIsCommandType]: DeepLinkServiceState.RunCommand,
		[DeepLinkServiceAction.LinkIsRepoType]: DeepLinkServiceState.RepoMatch,
		[DeepLinkServiceAction.LinkIsDraftType]: DeepLinkServiceState.OpenDraft,
		[DeepLinkServiceAction.LinkIsWorkspaceType]: DeepLinkServiceState.OpenWorkspace,
	},
	[DeepLinkServiceState.RepoMatch]: {
		[DeepLinkServiceAction.DeepLinkErrored]: DeepLinkServiceState.Idle,
		[DeepLinkServiceAction.DeepLinkCancelled]: DeepLinkServiceState.Idle,
		[DeepLinkServiceAction.RepoMatched]: DeepLinkServiceState.RemoteMatch,
		[DeepLinkServiceAction.RepoMatchedInLocalMapping]: DeepLinkServiceState.CloneOrAddRepo,
		[DeepLinkServiceAction.RepoMatchFailed]: DeepLinkServiceState.CloneOrAddRepo,
	},
	[DeepLinkServiceState.CloneOrAddRepo]: {
		[DeepLinkServiceAction.RepoAdded]: DeepLinkServiceState.AddedRepoMatch,
		[DeepLinkServiceAction.DeepLinkErrored]: DeepLinkServiceState.Idle,
		[DeepLinkServiceAction.DeepLinkCancelled]: DeepLinkServiceState.Idle,
	},
	[DeepLinkServiceState.AddedRepoMatch]: {
		[DeepLinkServiceAction.RepoMatched]: DeepLinkServiceState.RemoteMatch,
		[DeepLinkServiceAction.DeepLinkErrored]: DeepLinkServiceState.Idle,
		[DeepLinkServiceAction.DeepLinkCancelled]: DeepLinkServiceState.Idle,
	},
	[DeepLinkServiceState.RemoteMatch]: {
		[DeepLinkServiceAction.DeepLinkErrored]: DeepLinkServiceState.Idle,
		[DeepLinkServiceAction.DeepLinkCancelled]: DeepLinkServiceState.Idle,
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
		[DeepLinkServiceAction.DeepLinkCancelled]: DeepLinkServiceState.Idle,
		[DeepLinkServiceAction.TargetMatched]: DeepLinkServiceState.MaybeOpenRepo,
		[DeepLinkServiceAction.TargetMatchFailed]: DeepLinkServiceState.Fetch,
	},
	[DeepLinkServiceState.Fetch]: {
		[DeepLinkServiceAction.TargetFetched]: DeepLinkServiceState.FetchedTargetMatch,
		[DeepLinkServiceAction.DeepLinkErrored]: DeepLinkServiceState.Idle,
		[DeepLinkServiceAction.DeepLinkCancelled]: DeepLinkServiceState.Idle,
	},
	[DeepLinkServiceState.FetchedTargetMatch]: {
		[DeepLinkServiceAction.TargetMatched]: DeepLinkServiceState.MaybeOpenRepo,
		[DeepLinkServiceAction.DeepLinkErrored]: DeepLinkServiceState.Idle,
		[DeepLinkServiceAction.DeepLinkCancelled]: DeepLinkServiceState.Idle,
	},
	[DeepLinkServiceState.MaybeOpenRepo]: {
		[DeepLinkServiceAction.RepoOpened]: DeepLinkServiceState.EnsureRemoteMatch,
		[DeepLinkServiceAction.RepoOpening]: DeepLinkServiceState.RepoOpening,
		[DeepLinkServiceAction.DeepLinkStored]: DeepLinkServiceState.Idle,
		[DeepLinkServiceAction.DeepLinkErrored]: DeepLinkServiceState.Idle,
		[DeepLinkServiceAction.DeepLinkCancelled]: DeepLinkServiceState.Idle,
	},
	[DeepLinkServiceState.RepoOpening]: {
		[DeepLinkServiceAction.RepoOpened]: DeepLinkServiceState.EnsureRemoteMatch,
		[DeepLinkServiceAction.DeepLinkErrored]: DeepLinkServiceState.Idle,
		[DeepLinkServiceAction.DeepLinkCancelled]: DeepLinkServiceState.Idle,
	},
	[DeepLinkServiceState.EnsureRemoteMatch]: {
		[DeepLinkServiceAction.DeepLinkErrored]: DeepLinkServiceState.Idle,
		[DeepLinkServiceAction.DeepLinkCancelled]: DeepLinkServiceState.Idle,
		[DeepLinkServiceAction.RemoteMatched]: DeepLinkServiceState.GoToTarget,
	},
	[DeepLinkServiceState.GoToTarget]: {
		[DeepLinkServiceAction.OpenGraph]: DeepLinkServiceState.OpenGraph,
		[DeepLinkServiceAction.OpenFile]: DeepLinkServiceState.OpenFile,
		[DeepLinkServiceAction.OpenSwitch]: DeepLinkServiceState.SwitchToRef,
		[DeepLinkServiceAction.OpenComparison]: DeepLinkServiceState.OpenComparison,
		[DeepLinkServiceAction.DeepLinkErrored]: DeepLinkServiceState.Idle,
		[DeepLinkServiceAction.DeepLinkCancelled]: DeepLinkServiceState.Idle,
	},
	[DeepLinkServiceState.OpenGraph]: {
		[DeepLinkServiceAction.DeepLinkResolved]: DeepLinkServiceState.Idle,
		[DeepLinkServiceAction.DeepLinkErrored]: DeepLinkServiceState.Idle,
		[DeepLinkServiceAction.DeepLinkCancelled]: DeepLinkServiceState.Idle,
	},
	[DeepLinkServiceState.OpenComparison]: {
		[DeepLinkServiceAction.DeepLinkResolved]: DeepLinkServiceState.Idle,
		[DeepLinkServiceAction.DeepLinkErrored]: DeepLinkServiceState.Idle,
		[DeepLinkServiceAction.DeepLinkCancelled]: DeepLinkServiceState.Idle,
	},
	[DeepLinkServiceState.OpenDraft]: {
		[DeepLinkServiceAction.DeepLinkResolved]: DeepLinkServiceState.Idle,
		[DeepLinkServiceAction.DeepLinkErrored]: DeepLinkServiceState.Idle,
		[DeepLinkServiceAction.DeepLinkCancelled]: DeepLinkServiceState.Idle,
	},
	[DeepLinkServiceState.OpenWorkspace]: {
		[DeepLinkServiceAction.DeepLinkResolved]: DeepLinkServiceState.Idle,
		[DeepLinkServiceAction.DeepLinkErrored]: DeepLinkServiceState.Idle,
		[DeepLinkServiceAction.DeepLinkCancelled]: DeepLinkServiceState.Idle,
	},
	[DeepLinkServiceState.OpenFile]: {
		[DeepLinkServiceAction.DeepLinkResolved]: DeepLinkServiceState.Idle,
		[DeepLinkServiceAction.DeepLinkErrored]: DeepLinkServiceState.Idle,
		[DeepLinkServiceAction.DeepLinkCancelled]: DeepLinkServiceState.Idle,
	},
	[DeepLinkServiceState.OpenInspect]: {
		[DeepLinkServiceAction.OpenAllPrChanges]: DeepLinkServiceState.OpenAllPrChanges,
		[DeepLinkServiceAction.DeepLinkResolved]: DeepLinkServiceState.Idle,
		[DeepLinkServiceAction.DeepLinkErrored]: DeepLinkServiceState.Idle,
		[DeepLinkServiceAction.DeepLinkCancelled]: DeepLinkServiceState.Idle,
	},
	[DeepLinkServiceState.OpenAllPrChanges]: {
		[DeepLinkServiceAction.DeepLinkResolved]: DeepLinkServiceState.Idle,
		[DeepLinkServiceAction.DeepLinkErrored]: DeepLinkServiceState.Idle,
		[DeepLinkServiceAction.DeepLinkCancelled]: DeepLinkServiceState.Idle,
	},
	[DeepLinkServiceState.SwitchToRef]: {
		[DeepLinkServiceAction.OpenInspect]: DeepLinkServiceState.OpenInspect,
		[DeepLinkServiceAction.DeepLinkResolved]: DeepLinkServiceState.Idle,
		[DeepLinkServiceAction.DeepLinkErrored]: DeepLinkServiceState.Idle,
		[DeepLinkServiceAction.DeepLinkCancelled]: DeepLinkServiceState.Idle,
	},
	[DeepLinkServiceState.RunCommand]: {
		[DeepLinkServiceAction.DeepLinkResolved]: DeepLinkServiceState.Idle,
		[DeepLinkServiceAction.DeepLinkErrored]: DeepLinkServiceState.Idle,
		[DeepLinkServiceAction.DeepLinkCancelled]: DeepLinkServiceState.Idle,
	},
};

export interface DeepLinkProgress {
	message: string;
	increment: number;
}

export const deepLinkStateToProgress: Record<string, DeepLinkProgress> = {
	[DeepLinkServiceState.Idle]: { message: 'Done.', increment: 100 },
	[DeepLinkServiceState.AccountCheck]: { message: 'Checking account...', increment: 1 },
	[DeepLinkServiceState.PlanCheck]: { message: 'Checking plan...', increment: 2 },
	[DeepLinkServiceState.TypeMatch]: { message: 'Matching link type...', increment: 5 },
	[DeepLinkServiceState.RepoMatch]: { message: 'Finding a matching repository...', increment: 10 },
	[DeepLinkServiceState.CloneOrAddRepo]: { message: 'Adding repository...', increment: 20 },
	[DeepLinkServiceState.AddedRepoMatch]: { message: 'Finding a matching repository...', increment: 25 },
	[DeepLinkServiceState.RemoteMatch]: { message: 'Finding a matching remote...', increment: 30 },
	[DeepLinkServiceState.AddRemote]: { message: 'Adding remote...', increment: 40 },
	[DeepLinkServiceState.TargetMatch]: { message: 'finding a matching target...', increment: 50 },
	[DeepLinkServiceState.Fetch]: { message: 'Fetching...', increment: 60 },
	[DeepLinkServiceState.FetchedTargetMatch]: { message: 'Finding a matching target...', increment: 65 },
	[DeepLinkServiceState.MaybeOpenRepo]: { message: 'Opening repository...', increment: 70 },
	[DeepLinkServiceState.RepoOpening]: { message: 'Opening repository...', increment: 75 },
	[DeepLinkServiceState.GoToTarget]: { message: 'Opening target...', increment: 80 },
	[DeepLinkServiceState.OpenGraph]: { message: 'Opening graph...', increment: 90 },
	[DeepLinkServiceState.OpenComparison]: { message: 'Opening comparison...', increment: 90 },
	[DeepLinkServiceState.OpenDraft]: { message: 'Opening cloud patch...', increment: 90 },
	[DeepLinkServiceState.OpenWorkspace]: { message: 'Opening workspace...', increment: 90 },
	[DeepLinkServiceState.OpenFile]: { message: 'Opening file...', increment: 90 },
	[DeepLinkServiceState.OpenInspect]: { message: 'Opening inspect...', increment: 90 },
	[DeepLinkServiceState.SwitchToRef]: { message: 'Switching to ref...', increment: 90 },
	[DeepLinkServiceState.RunCommand]: { message: 'Running command...', increment: 90 },
};

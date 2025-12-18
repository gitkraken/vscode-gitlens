import type { Config } from '../../config';
import type { MergeConflict } from '../../git/models/mergeConflict';
import type {
	ProcessedRebaseCommitEntry as _RebaseCommitEntry,
	ProcessedRebaseCommandEntry,
	ProcessedRebaseCommitEntry,
	RebaseTodoCommitAction,
} from '../../git/models/rebase';
import type { Subscription } from '../../plus/gk/models/subscription';
import type { IpcScope, WebviewState } from '../protocol';
import { IpcCommand, IpcNotification, IpcRequest } from '../protocol';

export const scope: IpcScope = 'rebase';

export interface State extends WebviewState<'gitlens.rebase'> {
	branch: string;
	onto: { sha: string; commit?: Commit } | undefined;

	/** True if the commits are already on top of onto */
	isInPlace: boolean;

	/** Pending entries that can still be edited */
	entries: RebaseEntry[];
	/** Entries that have already been applied (only present during active rebase) */
	doneEntries?: RebaseEntry[];
	authors: Record<string, Author>;

	ascending: boolean;

	/**
	 * True if this is a complex rebase (--rebase-merges) that should be read-only.
	 * Complex rebases contain label/reset/merge commands that form a DAG structure.
	 */
	isReadOnly?: boolean;

	/** Where to reveal commits when clicking on links or double-clicking rows */
	revealLocation: Config['rebaseEditor']['revealLocation'];
	/** When to automatically reveal commits */
	revealBehavior: Config['rebaseEditor']['revealBehavior'];

	/** Active rebase status - undefined if starting a new rebase */
	rebaseStatus?: RebaseActiveStatus;

	/** Repository path for the rebase */
	repoPath: string;

	/** Subscription state for Pro feature gating */
	subscription?: Subscription;
}

/** Reason the rebase is paused */
export type RebasePauseReason = 'edit' | 'reword' | 'break' | 'conflict' | 'exec';

/** Status information for an active (in-progress) rebase */
export interface RebaseActiveStatus {
	/** Current step number (1-based) - from Git's rebase progress */
	currentStep: number;
	/** Total number of steps - from Git's rebase progress */
	totalSteps: number;
	/** SHA of commit currently being processed (REBASE_HEAD) */
	currentCommit?: string;
	/** True if there are conflicts to resolve */
	hasConflicts?: boolean;
	/** Reason the rebase is paused (undefined if not paused/in progress) */
	pauseReason?: RebasePauseReason;
}

export interface RebaseCommandEntry extends ProcessedRebaseCommandEntry {
	commit?: never;
}
/** Commit-based rebase entry (pick, reword, edit, squash, fixup, drop) */
export interface RebaseCommitEntry extends ProcessedRebaseCommitEntry {
	commit?: Commit;
}

export type RebaseEntry = RebaseCommitEntry | RebaseCommandEntry;

/** Checks if an entry is a commit entry */
export function isCommitEntry(entry: RebaseEntry): entry is RebaseCommitEntry {
	return entry.type === 'commit';
}

/** Checks if an entry is a command entry */
export function isCommandEntry(entry: RebaseEntry): entry is ProcessedRebaseCommandEntry {
	return entry.type === 'command';
}

export interface Author {
	readonly author: string;
	avatarUrl: string | undefined;
	readonly avatarFallbackUrl?: string | undefined;
	readonly email: string | undefined;
}

export interface Commit {
	readonly sha: string;
	readonly author: string;
	readonly committer: string;
	readonly date: string;
	readonly formattedDate: string;
	readonly message: string;
}

// COMMANDS

export const AbortCommand = new IpcCommand(scope, 'abort');
export const ContinueCommand = new IpcCommand(scope, 'continue');
export const SearchCommand = new IpcCommand(scope, 'search');
export const SkipCommand = new IpcCommand(scope, 'skip');
export const StartCommand = new IpcCommand(scope, 'start');
export const SwitchCommand = new IpcCommand(scope, 'switch');

export interface ReorderParams {
	ascending: boolean;
}
export const ReorderCommand = new IpcCommand<ReorderParams>(scope, 'reorder');

export interface ChangeEntryParams {
	sha: string;
	action: RebaseTodoCommitAction;
}
export const ChangeEntryCommand = new IpcCommand<ChangeEntryParams>(scope, 'change/entry');

export interface ChangeEntriesParams {
	entries: { sha: string; action: RebaseTodoCommitAction }[];
}
export const ChangeEntriesCommand = new IpcCommand<ChangeEntriesParams>(scope, 'change/entries');

export interface MoveEntryParams {
	/** Entry identifier - sha for commits, line number for command entries */
	id: string;
	to: number;
	relative: boolean;
}
export const MoveEntryCommand = new IpcCommand<MoveEntryParams>(scope, 'move/entry');

export interface MoveEntriesParams {
	/** Entry identifiers - sha for commits, line number for command entries */
	ids: string[];
	to: number;
}
export const MoveEntriesCommand = new IpcCommand<MoveEntriesParams>(scope, 'move/entries');

export interface ShiftEntriesParams {
	/** Entry identifiers - sha for commits, line number for command entries */
	ids: string[];
	direction: 'up' | 'down';
}
export const ShiftEntriesCommand = new IpcCommand<ShiftEntriesParams>(scope, 'shift/entries');

export interface UpdateSelectionParams {
	sha: string;
}
export const UpdateSelectionCommand = new IpcCommand<UpdateSelectionParams>(scope, 'selection/update');

export interface RevealRefParams {
	type: 'branch' | 'commit';
	ref: string;
}
export const RevealRefCommand = new IpcCommand<RevealRefParams>(scope, 'revealRef');

// Avatar commands - similar to Graph's missing avatars pattern
export interface GetMissingAvatarsParams {
	/** Map of email → sha for commits that need avatar fetching */
	emails: Record<string, string>;
}
export const GetMissingAvatarsCommand = new IpcCommand<GetMissingAvatarsParams>(scope, 'avatars/get');

// Commit enrichment commands - on-demand loading pattern
export interface GetMissingCommitsParams {
	/** Array of commit SHAs that need enrichment */
	shas: string[];
}
export const GetMissingCommitsCommand = new IpcCommand<GetMissingCommitsParams>(scope, 'commits/get');

export const RecomposeCommand = new IpcCommand(scope, 'recompose/open');

// REQUESTS

export interface GetPotentialConflictsParams {
	branch: string;
	onto: string;
}
export interface DidGetPotentialConflictsParams {
	conflicts?: MergeConflict;
}
export const GetPotentialConflictsRequest = new IpcRequest<GetPotentialConflictsParams, DidGetPotentialConflictsParams>(
	scope,
	'conflicts/get',
);

// NOTIFICATIONS

export interface DidChangeParams {
	state: State;
}
export const DidChangeNotification = new IpcNotification<DidChangeParams>(scope, 'didChange');

export interface DidChangeAvatarsParams {
	/** Map of author name → avatar URL */
	avatars: Record<string, string>;
}
export const DidChangeAvatarsNotification = new IpcNotification<DidChangeAvatarsParams>(scope, 'avatars/didChange');

export interface DidChangeCommitsParams {
	/** Map of commit SHA → enriched commit data */
	commits: Record<string, Commit>;
	/** Map of author name → author info (for new authors from fetched commits) */
	authors: Record<string, Author>;
	/** True if the commits are already on top of onto (recalculated when commits are enriched) */
	isInPlace?: boolean;
}
export const DidChangeCommitsNotification = new IpcNotification<DidChangeCommitsParams>(scope, 'commits/didChange');

export interface DidChangeSubscriptionParams {
	subscription: Subscription;
}
export const DidChangeSubscriptionNotification = new IpcNotification<DidChangeSubscriptionParams>(
	scope,
	'subscription/didChange',
);

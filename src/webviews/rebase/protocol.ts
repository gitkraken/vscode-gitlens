import type { GitFileConflictStatus } from '@gitlens/git/models/fileStatus.js';
import type {
	ProcessedRebaseCommandEntry,
	ProcessedRebaseCommitEntry,
	RebaseTodoCommitAction,
} from '@gitlens/git/models/rebase.js';
import type { Config } from '../../config.js';
import type { Subscription } from '../../plus/gk/models/subscription.js';
import type { WebviewItemContext } from '../../system/webview.js';
import type { WebviewState } from '../protocol.js';

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
	 * True if this is a --rebase-merges rebase with actual merge commits.
	 * Reordering is disabled to preserve the DAG structure, but action changes are allowed.
	 */
	preservesMerges?: boolean;

	/** Layout density */
	density: Config['rebaseEditor']['density'];
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

	/** Conflicted files when rebase is paused due to conflicts */
	conflictFiles?: ConflictFileInfo[];

	/** Whether the close-warning banner has been dismissed */
	closeWarningDismissed?: boolean;

	/** Whether AI features are allowed (user-enabled and org-permitted) — gates the Resolve Conflicts action */
	aiAllowed?: boolean;
}

export interface ConflictFileInfo {
	path: string;
	conflictStatus: GitFileConflictStatus;
	/** Number of conflict markers in the file */
	conflictCount?: number;
}

export interface ConflictFileContextValue {
	type: 'rebaseConflict';
	path: string;
	conflictStatus: GitFileConflictStatus;
}

export type ConflictFileWebviewContext = WebviewItemContext<ConflictFileContextValue>;

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
	isPaused: boolean;
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

// PARAMS

export interface ReorderParams {
	ascending: boolean;
}

export interface ChangeEntryParams {
	sha: string;
	action: RebaseTodoCommitAction;
}

export interface ChangeEntriesParams {
	entries: { sha: string; action: RebaseTodoCommitAction }[];
}

export interface MoveEntryParams {
	/** Entry identifier - sha for commits, line number for command entries */
	id: string;
	to: number;
	relative: boolean;
}

export interface MoveEntriesParams {
	/** Entry identifiers - sha for commits, line number for command entries */
	ids: string[];
	to: number;
}

export interface ShiftEntriesParams {
	/** Entry identifiers - sha for commits, line number for command entries */
	ids: string[];
	direction: 'up' | 'down';
}

export interface UpdateSelectionParams {
	sha: string;
}

export interface RevealRefParams {
	type: 'branch' | 'commit';
	ref: string;
}

/** Map of email → sha for commits that need avatar fetching */
export interface GetMissingAvatarsParams {
	emails: Record<string, string>;
}

/** Array of commit SHAs that need enrichment */
export interface GetMissingCommitsParams {
	shas: string[];
}

export interface OpenConflictFileParams {
	path: string;
}

export interface OpenConflictChangesParams {
	path: string;
	side: 'current' | 'incoming';
}

export interface ResolveConflictParams {
	path: string;
	resolution: 'current' | 'incoming';
}

export interface StageConflictParams {
	path: string;
}

export interface ResolveAllConflictsParams {
	resolution: 'current' | 'incoming';
}

export interface GetConflictsParams {
	/** Distinguishes initial (on-load / upgrade) checks from dynamic (plan-modification / rebase-advance) checks */
	trigger: 'initial' | 'todo';
	/** The onto target SHA */
	onto: string;
	/** Commit SHAs to check for conflicts, in plan order */
	commits: string[];
	/** Optional base override (e.g. 'HEAD' during an active rebase). Defaults to `onto`. */
	base?: string;
	/** Only honored when `trigger === 'initial'`. */
	stopOnFirstConflict?: boolean;
}

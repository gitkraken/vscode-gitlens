import type { GitCommitIdentityShape, GitCommitStats } from '@gitlens/git/models/commit.js';
import type { GitFileChangeShape, GitFileChangeStats } from '@gitlens/git/models/fileChange.js';
import type { GitFileStatus } from '@gitlens/git/models/fileStatus.js';
import type { IssueOrPullRequest } from '@gitlens/git/models/issueOrPullRequest.js';
import type { GitPausedOperationStatus } from '@gitlens/git/models/pausedOperationStatus.js';
import type { PullRequestShape } from '@gitlens/git/models/pullRequest.js';
import type { GitBranchReference } from '@gitlens/git/models/reference.js';
import type { GitCommitSearchContext } from '@gitlens/git/models/search.js';
import type { CurrentUserNameStyle } from '@gitlens/git/utils/commit.utils.js';
import type { DateTimeFormat } from '@gitlens/utils/date.js';
import type { Config, DateStyle } from '../../config.js';
import type { Sources } from '../../constants.telemetry.js';
import type { GlRepository } from '../../git/models/repository.js';
import type { WebviewItemContext } from '../../system/webview.js';
import { serializeWebviewItemContext } from '../../system/webview.js';
import type { IpcScope } from '../ipc/models/ipc.js';
import type { WebviewState } from '../protocol.js';
import type { FileShowOptions, WipChange } from '../rpc/services/types.js';

export type { FileShowOptions } from '../rpc/services/types.js';
// Re-export from shared types — canonical definition is in rpc/services/types.ts
export type { CommitSignatureShape, WipChange, WipFileChange } from '../rpc/services/types.js';

export const scope: IpcScope = 'commitDetails';
export const messageHeadlineSplitterToken = '\x00\n\x00';

export interface CommitSummary {
	sha: string;
	shortSha: string;
	// summary: string;
	message: string;
	author: GitCommitIdentityShape & { avatar: string | undefined };
	committer: GitCommitIdentityShape & { avatar: string | undefined };
	parents: string[];
	repoPath: string;
	stashNumber?: string;
	stashOnRef?: string;
}

export type CommitFileChange = GitFileChangeShape & { stats?: GitFileChangeStats; conflictMarkers?: number };

export interface CommitDetails extends CommitSummary {
	files?: readonly CommitFileChange[];
	stats?: GitCommitStats;
	/**
	 * `true` when the commit is reachable from a worktree other than the one this panel is scoped to,
	 * so its files have a working copy elsewhere. Drives the file context-menu's "Open Worktree File".
	 */
	reachableFromOtherWorktrees?: boolean;
}

export interface CompareDiff {
	files: readonly CommitFileChange[];
	stats?: GitCommitStats;
	commitCount?: number;
}

/** Sort order for the working (WIP) file list, mirroring VS Code's `scm.defaultViewSortKey`. */
export type WorkingFileSorting = 'name' | 'path' | 'status';

export interface Preferences {
	pullRequestExpanded: boolean;
	avatars: boolean;
	currentUserNameStyle: CurrentUserNameStyle;
	dateFormat: DateTimeFormat | string;
	dateStyle: DateStyle;
	files: Config['views']['commitDetails']['files'];
	indent: number | undefined;
	indentGuides: 'none' | 'onHover' | 'always';
	/** Working (WIP) file list sort, honoring VS Code's `scm.defaultViewSortKey` (list layout only). */
	workingFilesOrderBy: WorkingFileSorting;
	aiEnabled: boolean;
	enableSmartCommit: boolean;
	showSignatureBadges: boolean;
	/** Whether the file-tree search box is visible. Persisted per workspace; defaults to `true`. */
	showSearchBox: boolean;
	/** Search-box presentation: `true` filters (hides) non-matches, `false` dims them. */
	searchBoxFilter: boolean;
}
export type UpdateablePreferences = Partial<Pick<Preferences, 'pullRequestExpanded' | 'files'>>;

export type Mode = 'commit' | 'wip';

export interface GitBranchShape {
	name: string;
	repoPath: string;
	upstream?: { name: string; missing: boolean };
	tracking?: {
		ahead: number;
		behind: number;
	};
	/** Full reference, for command-link args (associate-issue, etc.) that need a GitBranchReference. */
	reference?: GitBranchReference;
}

/**
 * Git-authoritative working-tree counts, computed host-side from `status.diffStatus` and embedded
 * IN the {@link Wip} so the file list and its summary counts travel as one atomic object — they
 * can never drift. Header / row badges read these (via the derived `workingTreeStats`); the panel
 * reads them directly. Structurally assignable to graph's `GraphWorkingTreeStats` (which is
 * `WorkDirStats & { hasConflicts?; conflictsCount?; pausedOpStatus? }`); `context` is the
 * serialized `GraphItemContext` string for the WIP row's right-click menu.
 */
export interface WipStats {
	added: number;
	deleted: number;
	modified: number;
	renamed?: number;
	hasConflicts?: boolean;
	conflictsCount?: number;
	pausedOpStatus?: GitPausedOperationStatus;
	context?: string;
}

export interface Wip {
	changes: WipChange | undefined;
	repositoryCount: number;
	branch?: GitBranchShape;
	repo: {
		uri: string;
		name: string;
		path: string;
		/** True when this repo is a linked worktree (`git worktree`), false for the primary/main worktree. */
		isWorktree: boolean;
		provider?: {
			supportedFeatures: { createPullRequestWithDetails?: boolean };
		};
	};
	/**
	 * Git-authoritative counts for this wip's working tree — see {@link WipStats}. Optional at the
	 * type level because the standalone commitDetails webview constructs `Wip` without computing
	 * diffStatus; the Graph's `getWipForRepoAndStats` ALWAYS populates it, so Graph consumers can
	 * rely on it in practice (guard with `?.` for the shared-type contract).
	 */
	stats?: WipStats;
}

export interface DraftState {
	inReview: boolean;
}

export interface State extends WebviewState<'gitlens.views.commitDetails'> {
	mode: Mode;

	pinned: boolean;
	preferences: Preferences;
	orgSettings: {
		ai: boolean;
		drafts: boolean;
	};

	commit?: CommitDetails;
	autolinksEnabled: boolean;
	autolinkedIssues?: IssueOrPullRequest[];
	pullRequest?: PullRequestShape;
	wip?: Wip;
	inReview?: boolean;
	hasAccount: boolean;
	hasIntegrationsConnected: boolean;
	searchContext?: GitCommitSearchContext;
}

export type ShowCommitDetailsViewCommandArgs = string[];

export interface ShowWipArgs {
	type: 'wip';
	inReview?: boolean;
	repository?: GlRepository;
	source: Sources;
}

// COMMANDS

// Param types for RPC methods (kept for backwards compatibility)

export interface ExecuteCommitActionsParams {
	action: 'graph' | 'more' | 'scm' | 'sha';
	alt?: boolean;
}

export interface ExecuteFileActionParams extends GitFileChangeShape {
	/** Commit ref (SHA) for this file action. Required for committed files. */
	ref?: string;
	/**
	 * `true` when `ref` is a stash — routes the lookup through the stash sub-provider so
	 * untracked-file entries (which live in `stash^3` and are absent from `git log`-based
	 * fetches) resolve correctly.
	 */
	stash?: boolean;
	showOptions?: FileShowOptions;
}

// Context menu types

export type DetailsItemContext = WebviewItemContext<DetailsItemContextValue>;
export type DetailsItemContextValue = DetailsItemTypedContextValue;

export type DetailsItemTypedContext<T = DetailsItemTypedContextValue> = WebviewItemContext<T>;
export type DetailsItemTypedContextValue = DetailsFileContextValue | DetailsFolderContextValue;

export interface DetailsFileContextValue {
	type: 'file';
	path: string;
	repoPath: string;
	sha?: string;
	comparisonSha?: string;
	stashNumber?: string;
	staged?: boolean;
	status?: GitFileStatus;
}

export interface DetailsFolderContextValue {
	type: 'folder';
	path: string;
	repoPath: string;
}

export function buildFolderContext(repoPath: string | undefined, folder: { relativePath: string }): string | undefined {
	if (!repoPath) return undefined;

	const context: DetailsItemTypedContext = {
		webviewItem: 'gitlens:folder',
		webviewItemValue: { type: 'folder', path: folder.relativePath, repoPath: repoPath },
	};
	return serializeWebviewItemContext(context);
}

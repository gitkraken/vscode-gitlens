import type { Config, DateStyle } from '../../config.js';
import type { Sources } from '../../constants.telemetry.js';
import type { GitCommitIdentityShape, GitCommitStats } from '../../git/models/commit.js';
import type { GitFileChangeShape } from '../../git/models/fileChange.js';
import type { GitFileStatus } from '../../git/models/fileStatus.js';
import type { IssueOrPullRequest } from '../../git/models/issueOrPullRequest.js';
import type { PullRequestShape } from '../../git/models/pullRequest.js';
import type { Repository } from '../../git/models/repository.js';
import type { GitCommitSearchContext } from '../../git/search.js';
import type { DateTimeFormat } from '../../system/date.js';
import type { WebviewItemContext } from '../../system/webview.js';
import type { FileShowOptions } from '../apps/shared/actions/file.js';
import type { IpcScope } from '../ipc/models/ipc.js';
import type { WebviewState } from '../protocol.js';

export type { FileShowOptions } from '../apps/shared/actions/file.js';

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
}

export interface CommitSignatureShape {
	status: 'good' | 'bad' | 'unknown' | 'expired' | 'revoked' | 'error';
	format?: 'gpg' | 'ssh' | 'x509' | 'openpgp';
	signer?: string;
	keyId?: string;
	fingerprint?: string;
	trustLevel?: 'ultimate' | 'full' | 'marginal' | 'never' | 'unknown';
	errorMessage?: string;
}

export interface CommitDetails extends CommitSummary {
	files?: readonly GitFileChangeShape[];
	stats?: GitCommitStats;
}

export interface Preferences {
	pullRequestExpanded: boolean;
	avatars: boolean;
	dateFormat: DateTimeFormat | string;
	dateStyle: DateStyle;
	files: Config['views']['commitDetails']['files'];
	indent: number | undefined;
	indentGuides: 'none' | 'onHover' | 'always';
	aiEnabled: boolean;
	showSignatureBadges: boolean;
}
export type UpdateablePreferences = Partial<Pick<Preferences, 'pullRequestExpanded' | 'files'>>;

export interface WipChange {
	branchName: string;
	repository: { name: string; path: string; uri: string };
	files: GitFileChangeShape[];
}

export type Mode = 'commit' | 'wip';

export interface GitBranchShape {
	name: string;
	repoPath: string;
	upstream?: { name: string; missing: boolean };
	tracking?: {
		ahead: number;
		behind: number;
	};
}

export interface Wip {
	changes: WipChange | undefined;
	repositoryCount: number;
	branch?: GitBranchShape;
	repo: {
		uri: string;
		name: string;
		path: string;
	};
}

export interface DraftState {
	inReview: boolean;
}

export interface State extends WebviewState<'gitlens.views.commitDetails' | 'gitlens.views.graphDetails'> {
	mode: Mode;

	pinned: boolean;
	navigationStack: {
		count: number;
		position: number;
		hint?: string;
	};
	preferences: Preferences;
	orgSettings: {
		ai: boolean;
		drafts: boolean;
	};

	commit?: CommitDetails;
	autolinksEnabled: boolean;
	experimentalComposerEnabled: boolean;
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
	repository?: Repository;
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
	showOptions?: FileShowOptions;
}

// Context menu types

export type DetailsItemContext = WebviewItemContext<DetailsItemContextValue>;
export type DetailsItemContextValue = DetailsItemTypedContextValue;

export type DetailsItemTypedContext<T = DetailsItemTypedContextValue> = WebviewItemContext<T>;
export type DetailsItemTypedContextValue = DetailsFileContextValue;

export interface DetailsFileContextValue {
	type: 'file';
	path: string;
	repoPath: string;
	sha?: string;
	stashNumber?: string;
	staged?: boolean;
	status?: GitFileStatus;
}

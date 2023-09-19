import type { TextDocumentShowOptions } from 'vscode';
import type { Autolink } from '../../annotations/autolinks';
import type { Config } from '../../config';
import type { WebviewIds, WebviewViewIds } from '../../constants';
import type { GitCommitIdentityShape, GitCommitStats } from '../../git/models/commit';
import type { GitFileChangeShape } from '../../git/models/file';
import type { IssueOrPullRequest } from '../../git/models/issue';
import type { PullRequestShape } from '../../git/models/pullRequest';
import type { DateTimeFormat } from '../../system/date';
import type { Serialized } from '../../system/serialize';
import { IpcCommandType, IpcNotificationType } from '../protocol';

export const messageHeadlineSplitterToken = '\x00\n\x00';

export type FileShowOptions = TextDocumentShowOptions;

export interface CommitSummary {
	sha: string;
	shortSha: string;
	// summary: string;
	message: string;
	author: GitCommitIdentityShape & { avatar: string | undefined };
	// committer: GitCommitIdentityShape & { avatar: string | undefined };
	parents: string[];
	repoPath: string;
	stashNumber?: string;
}

export interface CommitDetails extends CommitSummary {
	autolinks?: Autolink[];
	files?: (GitFileChangeShape & { icon: { dark: string; light: string } })[];
	stats?: GitCommitStats;
}

export interface Preferences {
	autolinksExpanded: boolean;
	avatars: boolean;
	dateFormat: DateTimeFormat | string;
	files: Config['views']['commitDetails']['files'];
	// indent: number;
	indentGuides: 'none' | 'onHover' | 'always';
}
export type UpdateablePreferences = Partial<Pick<Preferences, 'autolinksExpanded' | 'files'>>;

export interface Wip {
	changes: number; //{ staged: number; unstaged: number };
	branchName: string;
	repository: { name: string; path: string };
}

export interface State {
	webviewId: WebviewIds | WebviewViewIds;
	timestamp: number;

	pinned: boolean;
	navigationStack: {
		count: number;
		position: number;
		hint?: string;
	};
	preferences: Preferences;
	includeRichContent?: boolean;

	commit?: CommitDetails;
	autolinkedIssues?: IssueOrPullRequest[];
	pullRequest?: PullRequestShape;
	wip?: Wip;
}

export type ShowCommitDetailsViewCommandArgs = string[];

// COMMANDS

export interface CommitActionsParams {
	action: 'graph' | 'more' | 'scm' | 'sha';
	alt?: boolean;
}
export const CommitActionsCommandType = new IpcCommandType<CommitActionsParams>('commit/actions');

export interface FileActionParams {
	path: string;
	repoPath: string;
	staged: boolean | undefined;

	showOptions?: TextDocumentShowOptions;
}
export const FileActionsCommandType = new IpcCommandType<FileActionParams>('commit/file/actions');
export const OpenFileCommandType = new IpcCommandType<FileActionParams>('commit/file/open');
export const OpenFileOnRemoteCommandType = new IpcCommandType<FileActionParams>('commit/file/openOnRemote');
export const OpenFileCompareWorkingCommandType = new IpcCommandType<FileActionParams>('commit/file/compareWorking');
export const OpenFileComparePreviousCommandType = new IpcCommandType<FileActionParams>('commit/file/comparePrevious');

export const StageFileCommandType = new IpcCommandType<FileActionParams>('commit/file/stage');
export const UnstageFileCommandType = new IpcCommandType<FileActionParams>('commit/file/unstage');

export const PickCommitCommandType = new IpcCommandType<undefined>('commit/pickCommit');
export const SearchCommitCommandType = new IpcCommandType<undefined>('commit/searchCommit');

export interface ShowWipParams {
	repoPath?: string;
}
export const ShowWipCommandType = new IpcCommandType<ShowWipParams>('commit/showWip');

export const AutolinkSettingsCommandType = new IpcCommandType<undefined>('commit/autolinkSettings');

export const ExplainCommandType = new IpcCommandType<undefined>('commit/explain');

export interface PinParams {
	pin: boolean;
}
export const PinCommitCommandType = new IpcCommandType<PinParams>('commit/pin');

export interface NavigateParams {
	direction: 'back' | 'forward';
}
export const NavigateCommitCommandType = new IpcCommandType<NavigateParams>('commit/navigate');

export type UpdatePreferenceParams = UpdateablePreferences;
export const UpdatePreferencesCommandType = new IpcCommandType<UpdatePreferenceParams>('commit/preferences/update');

// NOTIFICATIONS

export interface DidChangeParams {
	state: Serialized<State>;
}
export const DidChangeNotificationType = new IpcNotificationType<DidChangeParams>('commit/didChange', true);

// export type DidChangeRichStateParams = {
// 	formattedMessage?: string;
// 	autolinkedIssues?: IssueOrPullRequest[];
// 	pullRequest?: PullRequestShape;
// };
// export const DidChangeRichStateNotificationType = new IpcNotificationType<DidChangeRichStateParams>(
// 	'commit/didChange/rich',
// );

export type DidChangeWipStateParams = Pick<State, 'wip'>;
export const DidChangeWipStateNotificationType = new IpcNotificationType<DidChangeWipStateParams>(
	'commit/didChange/wip',
);

export type DidExplainParams =
	| {
			summary: string | undefined;
			error?: undefined;
	  }
	| { error: { message: string } };
export const DidExplainCommandType = new IpcNotificationType<DidExplainParams>('commit/didExplain');

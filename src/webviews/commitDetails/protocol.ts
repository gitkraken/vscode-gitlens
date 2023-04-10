import type { TextDocumentShowOptions } from 'vscode';
import type { Autolink } from '../../annotations/autolinks';
import type { Config } from '../../config';
import type { GitCommitIdentityShape, GitCommitStats } from '../../git/models/commit';
import type { GitFileChangeShape } from '../../git/models/file';
import type { IssueOrPullRequest } from '../../git/models/issue';
import type { PullRequestShape } from '../../git/models/pullRequest';
import type { Serialized } from '../../system/serialize';
import { IpcCommandType, IpcNotificationType } from '../protocol';

export const messageHeadlineSplitterToken = '\x00\n\x00';

export type FileShowOptions = TextDocumentShowOptions;
export type CommitDetailsDismissed = 'sidebar';

export type CommitSummary = {
	sha: string;
	shortSha: string;
	// summary: string;
	message: string;
	author: GitCommitIdentityShape & { avatar: string | undefined };
	// committer: GitCommitIdentityShape & { avatar: string | undefined };
	isStash: boolean;
};

export type CommitDetails = CommitSummary & {
	autolinks?: Autolink[];
	files?: (GitFileChangeShape & { icon: { dark: string; light: string } })[];
	stats?: GitCommitStats;
};

export type Preferences = {
	autolinksExpanded?: boolean;
	avatars?: boolean;
	dismissed?: CommitDetailsDismissed[];
	files?: Config['views']['commitDetails']['files'];
};

export type State = {
	pinned: boolean;
	preferences?: Preferences;
	// commits?: CommitSummary[];
	includeRichContent?: boolean;

	selected?: CommitDetails;
	autolinkedIssues?: IssueOrPullRequest[];
	pullRequest?: PullRequestShape;

	dateFormat: string;
	// indent: number;
	indentGuides: 'none' | 'onHover' | 'always';
	navigationStack: {
		count: number;
		position: number;
		hint?: string;
	};
};

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

	showOptions?: TextDocumentShowOptions;
}
export const FileActionsCommandType = new IpcCommandType<FileActionParams>('commit/file/actions');
export const OpenFileCommandType = new IpcCommandType<FileActionParams>('commit/file/open');
export const OpenFileOnRemoteCommandType = new IpcCommandType<FileActionParams>('commit/file/openOnRemote');
export const OpenFileCompareWorkingCommandType = new IpcCommandType<FileActionParams>('commit/file/compareWorking');
export const OpenFileComparePreviousCommandType = new IpcCommandType<FileActionParams>('commit/file/comparePrevious');

export const PickCommitCommandType = new IpcCommandType<undefined>('commit/pickCommit');
export const SearchCommitCommandType = new IpcCommandType<undefined>('commit/searchCommit');
export const AutolinkSettingsCommandType = new IpcCommandType<undefined>('commit/autolinkSettings');

export interface PinParams {
	pin: boolean;
}
export const PinCommitCommandType = new IpcCommandType<PinParams>('commit/pin');

export interface NavigateParams {
	direction: 'back' | 'forward';
}
export const NavigateCommitCommandType = new IpcCommandType<NavigateParams>('commit/navigate');

export interface PreferenceParams {
	autolinksExpanded?: boolean;
	avatars?: boolean;
	dismissed?: CommitDetailsDismissed[];
	files?: Config['views']['commitDetails']['files'];
}
export const PreferencesCommandType = new IpcCommandType<PreferenceParams>('commit/preferences');

// NOTIFICATIONS

export interface DidChangeParams {
	state: Serialized<State>;
}
export const DidChangeNotificationType = new IpcNotificationType<DidChangeParams>('commit/didChange', true);

export type DidChangeRichStateParams = {
	formattedMessage?: string;
	autolinkedIssues?: IssueOrPullRequest[];
	pullRequest?: PullRequestShape;
};
export const DidChangeRichStateNotificationType = new IpcNotificationType<DidChangeRichStateParams>(
	'commit/didChange/rich',
);

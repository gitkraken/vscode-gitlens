import type { TextDocumentShowOptions } from 'vscode';
import type { Config } from '../../../config';
import type { GitCommitIdentityShape, GitCommitStats } from '../../../git/models/commit';
import type { GitFileChangeShape } from '../../../git/models/file';
import type { IssueOrPullRequest } from '../../../git/models/issue';
import type { PullRequestShape } from '../../../git/models/pullRequest';
import type { Serialized } from '../../../system/serialize';
import { IpcCommandType, IpcNotificationType } from '../../../webviews/protocol';

export const messageHeadlineSplitterToken = '\x00\n\x00';

export type FileShowOptions = TextDocumentShowOptions;

interface LocalPatchDetails {
	type: 'local';

	message?: string;
	files?: (GitFileChangeShape & { icon: { dark: string; light: string } })[];
	stats?: GitCommitStats;

	author?: undefined;
}

interface CloudPatchDetails {
	type: 'cloud';

	message?: string;
	files?: (GitFileChangeShape & { icon: { dark: string; light: string } })[];
	stats?: GitCommitStats;

	author: GitCommitIdentityShape & { avatar: string | undefined };
	repoPath: string;
}

export type PatchDetails = LocalPatchDetails | CloudPatchDetails;

export interface Preferences {
	avatars?: boolean;
	files?: Config['views']['patchDetails']['files'];
}

export interface State {
	timestamp: number;

	preferences?: Preferences;
	// includeRichContent?: boolean;

	patch?: PatchDetails;
	// autolinkedIssues?: IssueOrPullRequest[];

	dateFormat: string;
	// indent: number;
	indentGuides: 'none' | 'onHover' | 'always';
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

export const ExplainCommitCommandType = new IpcCommandType<undefined>('commit/explain');

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
	files?: Config['views']['patchDetails']['files'];
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

export type DidExplainCommitParams =
	| {
			summary: string | undefined;
			error?: undefined;
	  }
	| { error: { message: string } };
export const DidExplainCommitCommandType = new IpcNotificationType<DidExplainCommitParams>('commit/didExplain');

import type { TextDocumentShowOptions } from 'vscode';
import type { Autolink } from '../../annotations/autolinks';
import type { Config, DateStyle } from '../../config';
import type { GitCommitIdentityShape, GitCommitStats } from '../../git/models/commit';
import type { GitFileChangeShape } from '../../git/models/file';
import type { IssueOrPullRequest } from '../../git/models/issue';
import type { PullRequestShape } from '../../git/models/pullRequest';
import type { DraftVisibility } from '../../gk/models/drafts';
import type { Change, DraftUserSelection } from '../../plus/webviews/patchDetails/protocol';
import type { DateTimeFormat } from '../../system/date';
import type { Serialized } from '../../system/serialize';
import type { IpcScope, WebviewState } from '../protocol';
import { IpcCommand, IpcNotification, IpcRequest } from '../protocol';

export const scope: IpcScope = 'commitDetails';

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
	files?: readonly GitFileChangeShape[];
	stats?: GitCommitStats;
}

export interface Preferences {
	autolinksExpanded: boolean;
	avatars: boolean;
	dateFormat: DateTimeFormat | string;
	dateStyle: DateStyle;
	files: Config['views']['commitDetails']['files'];
	indent: number | undefined;
	indentGuides: 'none' | 'onHover' | 'always';
}
export type UpdateablePreferences = Partial<Pick<Preferences, 'autolinksExpanded' | 'files'>>;

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
	pullRequest?: PullRequestShape;
	repo: {
		uri: string;
		name: string;
		path: string;
	};
}

export interface DraftState {
	inReview: boolean;
}

export interface State extends WebviewState {
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
	includeRichContent?: boolean;

	commit?: CommitDetails;
	autolinkedIssues?: IssueOrPullRequest[];
	pullRequest?: PullRequestShape;
	wip?: Wip;
}

export type ShowCommitDetailsViewCommandArgs = string[];

// COMMANDS

export interface SuggestChangesParams {
	title: string;
	description?: string;
	visibility: DraftVisibility;
	changesets: Record<string, Change>;
	userSelections: DraftUserSelection[] | undefined;
}
export const SuggestChangesCommand = new IpcCommand<SuggestChangesParams>(scope, 'commit/suggestChanges');

export interface ExecuteCommitActionsParams {
	action: 'graph' | 'more' | 'scm' | 'sha';
	alt?: boolean;
}
export const ExecuteCommitActionCommand = new IpcCommand<ExecuteCommitActionsParams>(scope, 'commit/actions/execute');

export interface ExecuteFileActionParams extends GitFileChangeShape {
	showOptions?: TextDocumentShowOptions;
}
export const ExecuteFileActionCommand = new IpcCommand<ExecuteFileActionParams>(scope, 'file/actions/execute');
export const OpenFileCommand = new IpcCommand<ExecuteFileActionParams>(scope, 'file/open');
export const OpenFileOnRemoteCommand = new IpcCommand<ExecuteFileActionParams>(scope, 'file/openOnRemote');
export const OpenFileCompareWorkingCommand = new IpcCommand<ExecuteFileActionParams>(scope, 'file/compareWorking');
export const OpenFileComparePreviousCommand = new IpcCommand<ExecuteFileActionParams>(scope, 'file/comparePrevious');

export const StageFileCommand = new IpcCommand<ExecuteFileActionParams>(scope, 'file/stage');
export const UnstageFileCommand = new IpcCommand<ExecuteFileActionParams>(scope, 'file/unstage');

export const PickCommitCommand = new IpcCommand(scope, 'pickCommit');
export const SearchCommitCommand = new IpcCommand(scope, 'searchCommit');

export interface SwitchModeParams {
	repoPath?: string;
	mode: Mode;
}
export const SwitchModeCommand = new IpcCommand<SwitchModeParams>(scope, 'switchMode');

export const AutolinkSettingsCommand = new IpcCommand(scope, 'autolinkSettings');

export interface PinParams {
	pin: boolean;
}
export const PinCommand = new IpcCommand<PinParams>(scope, 'pin');

export interface NavigateParams {
	direction: 'back' | 'forward';
}
export const NavigateCommand = new IpcCommand<NavigateParams>(scope, 'navigate');

export type UpdatePreferenceParams = UpdateablePreferences;
export const UpdatePreferencesCommand = new IpcCommand<UpdatePreferenceParams>(scope, 'preferences/update');

export interface CreatePatchFromWipParams {
	changes: WipChange;
	checked: boolean | 'staged';
}
export const CreatePatchFromWipCommand = new IpcCommand<CreatePatchFromWipParams>(scope, 'wip/createPatch');

export const FetchCommand = new IpcCommand(scope, 'fetch');
export const PublishCommand = new IpcCommand(scope, 'publish');
export const PushCommand = new IpcCommand(scope, 'push');
export const PullCommand = new IpcCommand(scope, 'pull');
export const SwitchCommand = new IpcCommand(scope, 'switch');

// REQUESTS

export type DidExplainParams =
	| {
			summary: string | undefined;
			error?: undefined;
	  }
	| { error: { message: string } };
export const ExplainRequest = new IpcRequest<void, DidExplainParams>(scope, 'explain');

// NOTIFICATIONS

export interface DidChangeParams {
	state: Serialized<State>;
}
export const DidChangeNotification = new IpcNotification<DidChangeParams>(scope, 'didChange', true);

export type DidChangeWipStateParams = Pick<Serialized<State>, 'wip'>;
export const DidChangeWipStateNotification = new IpcNotification<DidChangeWipStateParams>(scope, 'didChange/wip');

export type DidChangeOrgSettings = Pick<Serialized<State>, 'orgSettings'>;
export const DidChangeOrgSettingsNotification = new IpcNotification<DidChangeOrgSettings>(
	scope,
	'org/settings/didChange',
);

export interface DidChangeDraftStateParams {
	inReview: boolean;
}
export const DidChangeDraftStateNotification = new IpcNotification<DidChangeDraftStateParams>(scope, 'didChange/patch');

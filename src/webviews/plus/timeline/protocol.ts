import type { Uri } from 'vscode';
import type { FeatureAccess } from '../../../features';
import type { GitReference } from '../../../git/models/reference';
import type { RepositoryShape } from '../../../git/models/repositoryShape';
import type { Serialized } from '../../../system/serialize';
import type { IpcScope, WebviewState } from '../../protocol';
import { IpcCommand, IpcNotification, IpcRequest } from '../../protocol';

export const scope: IpcScope = 'timeline';

export interface State extends WebviewState<'gitlens.timeline' | 'gitlens.views.timeline'> {
	dataset?: Promise<TimelineDatum[]>;
	config: {
		showAllBranches: boolean;
		period: TimelinePeriod;
		sliceBy: TimelineSliceBy;

		abbreviatedShaLength: number;
		dateFormat: string;
		shortDateFormat: string;
	};

	scope: TimelineScopeSerialized | undefined;
	repository: (RepositoryShape & { ref: GitReference | undefined }) | undefined;
	repositories: { count: number; openCount: number };

	access: FeatureAccess;
}

export interface TimelineDatum {
	sha: string;
	author: string;
	date: string;
	message: string;

	branches?: string[];

	files: number | undefined;
	additions: number | undefined;
	deletions: number | undefined;

	sort: number;
}

export interface TimelineScope {
	type: TimelineScopeType;
	uri: Uri;
	head?: GitReference;
	base?: GitReference;
}
export type TimelineScopeSerialized = Required<Serialized<TimelineScope> & { relativePath: string }>;

export type TimelineScopeType = 'file' | 'folder' | 'repo';
export type TimelinePeriod = `${number}|${'D' | 'M' | 'Y'}` | 'all';
export type TimelineSliceBy = 'author' | 'branch';

// REQUESTS
export type ChooseRefParams = { scope: State['scope']; type: 'base' | 'head' };
export type DidChooseRefParams =
	| { type: 'base' | 'head'; ref: GitReference | /** All Branches */ null | undefined }
	| undefined;
export const ChooseRefRequest = new IpcRequest<ChooseRefParams, DidChooseRefParams>(scope, 'ref/choose');

export interface ChoosePathParams {
	repoUri: string;
	ref: GitReference | undefined;
	title: string;
	initialPath?: string;
}
export interface DidChoosePathParams {
	picked?: { type: 'file' | 'folder'; relativePath: string };
}
export const ChoosePathRequest = new IpcRequest<ChoosePathParams, DidChoosePathParams>(scope, 'path/choose');

// COMMANDS

export interface SelectDataPointParams {
	scope: State['scope'];
	id: string | undefined;
	shift: boolean;
}
export const SelectDataPointCommand = new IpcCommand<SelectDataPointParams>(scope, 'point/open');

export interface UpdateConfigParams {
	changes: Partial<State['config']>;
}
export const UpdateConfigCommand = new IpcCommand<UpdateConfigParams>(scope, 'config/update');

export interface UpdateScopeParams {
	scope: State['scope'];
	changes:
		| {
				type?: Exclude<TimelineScopeType, 'repo'>;
				head?: GitReference | null;
				base?: GitReference | null;
				relativePath?: string;
		  }
		| {
				type?: Extract<TimelineScopeType, 'repo'>;
				head?: GitReference | null;
				base?: GitReference | null;
				relativePath?: never;
		  };
	altOrShift?: boolean;
}
export const UpdateScopeCommand = new IpcCommand<UpdateScopeParams>(scope, 'scope/update');

// NOTIFICATIONS

export interface DidChangeParams {
	state: State;
}
export const DidChangeNotification = new IpcNotification<DidChangeParams>(scope, 'didChange');

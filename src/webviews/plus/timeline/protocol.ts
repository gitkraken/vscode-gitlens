import type { FeatureAccess } from '../../../features';
import type { GitReference } from '../../../git/models/reference';
import type { IpcScope, WebviewState } from '../../protocol';
import { IpcCommand, IpcNotification, IpcRequest } from '../../protocol';

export const scope: IpcScope = 'timeline';

export interface State extends WebviewState {
	dataset?: Promise<TimelineDatum[]>;
	config: {
		base: GitReference | undefined;
		showAllBranches: boolean;
		period: TimelinePeriod;
		sliceBy: TimelineSliceBy;

		abbreviatedShaLength: number;
		dateFormat: string;
		shortDateFormat: string;
	};

	uri?: string;
	item: {
		type: TimelineItemType;
		path: string;
	};
	repository:
		| {
				id: string;
				uri: string;
				name: string;
				ref: GitReference | undefined;
		  }
		| undefined;

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

export type TimelineItemType = 'file' | 'folder';
export type TimelinePeriod = `${number}|${'D' | 'M' | 'Y'}` | 'all';
export type TimelineSliceBy = 'author' | 'branch';

// COMMANDS

export type DidChooseRefParams = { ref: GitReference | undefined } | undefined;
export const ChooseRefRequest = new IpcRequest<void, DidChooseRefParams>(scope, 'ref/choose');

export interface SelectDataPointParams {
	id: string | undefined;
	itemType: TimelineItemType;
	shift: boolean;
}
export const SelectDataPointCommand = new IpcCommand<SelectDataPointParams>(scope, 'point/open');

export interface UpdateConfigParams {
	period?: TimelinePeriod;
	showAllBranches?: boolean;
	sliceBy?: TimelineSliceBy;
}
export const UpdateConfigCommand = new IpcCommand<UpdateConfigParams>(scope, 'config/update');

export interface UpdateUriParams {
	uri?: string;
	path?: string;
}
export const UpdateUriCommand = new IpcCommand<UpdateUriParams>(scope, 'uri/update');

// NOTIFICATIONS

export interface DidChangeParams {
	state: State;
}
export const DidChangeNotification = new IpcNotification<DidChangeParams>(scope, 'didChange');

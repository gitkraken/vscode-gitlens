import type { FeatureAccess } from '../../../features';
import { IpcCommandType, IpcNotificationType } from '../../../webviews/protocol';

export interface State {
	timestamp: number;

	dataset?: Commit[];
	period: Period;
	title?: string;
	sha?: string;
	uri?: string;

	dateFormat: string;
	shortDateFormat: string;
	access: FeatureAccess;
}

export interface Commit {
	commit: string;
	author: string;
	date: string;
	message: string;

	additions: number | undefined;
	deletions: number | undefined;

	sort: number;
}

export type Period = `${number}|${'D' | 'M' | 'Y'}` | 'all';

export interface DidChangeParams {
	state: State;
}
export const DidChangeNotificationType = new IpcNotificationType<DidChangeParams>('timeline/didChange');

export interface OpenDataPointParams {
	data?: {
		id: string;
		selected: boolean;
	};
}
export const OpenDataPointCommandType = new IpcCommandType<OpenDataPointParams>('timeline/point/open');

export interface UpdatePeriodParams {
	period: Period;
}
export const UpdatePeriodCommandType = new IpcCommandType<UpdatePeriodParams>('timeline/period/update');

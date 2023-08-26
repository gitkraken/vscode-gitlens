import type { CustomEditorIds } from '../../constants';
import { IpcCommandType, IpcNotificationType } from '../protocol';

export interface State {
	webviewId: CustomEditorIds;
	timestamp: number;

	branch: string;
	onto: { sha: string; commit?: Commit } | undefined;

	entries: RebaseEntry[];
	authors: Record<string, Author>;
	commands: {
		commit: string;
	};

	ascending: boolean;
}

export interface RebaseEntry {
	readonly action: RebaseEntryAction;
	readonly sha: string;
	readonly message: string;
	readonly index: number;

	commit?: Commit;
}

export type RebaseEntryAction = 'pick' | 'reword' | 'edit' | 'squash' | 'fixup' | 'break' | 'drop';

export interface Author {
	readonly author: string;
	readonly avatarUrl: string;
	readonly email: string | undefined;
}

export interface Commit {
	readonly sha: string;
	readonly author: string;
	readonly committer: string;
	// readonly avatarUrl: string;
	readonly date: string;
	readonly dateFromNow: string;
	// readonly email: string | undefined;
	readonly message: string;
	// readonly command: string;
}

// COMMANDS

export const AbortCommandType = new IpcCommandType('rebase/abort');
export const DisableCommandType = new IpcCommandType('rebase/disable');
export const SearchCommandType = new IpcCommandType('rebase/search');
export const StartCommandType = new IpcCommandType('rebase/start');
export const SwitchCommandType = new IpcCommandType('rebase/switch');

export interface ReorderParams {
	ascending: boolean;
}
export const ReorderCommandType = new IpcCommandType<ReorderParams>('rebase/reorder');

export interface ChangeEntryParams {
	sha: string;
	action: RebaseEntryAction;
}
export const ChangeEntryCommandType = new IpcCommandType<ChangeEntryParams>('rebase/change/entry');

export interface MoveEntryParams {
	sha: string;
	to: number;
	relative: boolean;
}
export const MoveEntryCommandType = new IpcCommandType<MoveEntryParams>('rebase/move/entry');

export interface UpdateSelectionParams {
	sha: string;
}
export const UpdateSelectionCommandType = new IpcCommandType<UpdateSelectionParams>('rebase/selection/update');

// NOTIFICATIONS

export interface DidChangeParams {
	state: State;
}
export const DidChangeNotificationType = new IpcNotificationType<DidChangeParams>('rebase/didChange');

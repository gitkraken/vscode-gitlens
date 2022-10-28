import { IpcCommandType, IpcNotificationType } from '../protocol';

export interface State {
	branch: string;
	onto: string;

	entries: RebaseEntry[];
	authors: Author[];
	commits: Commit[];
	commands: {
		commit: string;
	};

	ascending: boolean;
}

export interface RebaseEntry {
	readonly action: RebaseEntryAction;
	readonly ref: string;
	readonly message: string;
	readonly index: number;
}

export type RebaseEntryAction = 'pick' | 'reword' | 'edit' | 'squash' | 'fixup' | 'break' | 'drop';

export interface Author {
	readonly author: string;
	readonly avatarUrl: string;
	readonly email: string | undefined;
}

export interface Commit {
	readonly ref: string;
	readonly author: string;
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
	ref: string;
	action: RebaseEntryAction;
}
export const ChangeEntryCommandType = new IpcCommandType<ChangeEntryParams>('rebase/change/entry');

export interface MoveEntryParams {
	ref: string;
	to: number;
	relative: boolean;
}
export const MoveEntryCommandType = new IpcCommandType<MoveEntryParams>('rebase/move/entry');

// NOTIFICATIONS

export interface DidChangeParams {
	state: State;
}
export const DidChangeNotificationType = new IpcNotificationType<DidChangeParams>('rebase/didChange');

import type { CustomEditorIds } from '../../constants.views';
import type { IpcScope, WebviewState } from '../protocol';
import { IpcCommand, IpcNotification } from '../protocol';

export const scope: IpcScope = 'rebase';

export interface State extends WebviewState<CustomEditorIds> {
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

export const AbortCommand = new IpcCommand(scope, 'abort');
export const DisableCommand = new IpcCommand(scope, 'disable');
export const SearchCommand = new IpcCommand(scope, 'search');
export const StartCommand = new IpcCommand(scope, 'start');
export const SwitchCommand = new IpcCommand(scope, 'switch');

export interface ReorderParams {
	ascending: boolean;
}
export const ReorderCommand = new IpcCommand<ReorderParams>(scope, 'reorder');

export interface ChangeEntryParams {
	sha: string;
	action: RebaseEntryAction;
}
export const ChangeEntryCommand = new IpcCommand<ChangeEntryParams>(scope, 'change/entry');

export interface MoveEntryParams {
	sha: string;
	to: number;
	relative: boolean;
}
export const MoveEntryCommand = new IpcCommand<MoveEntryParams>(scope, 'move/entry');

export interface UpdateSelectionParams {
	sha: string;
}
export const UpdateSelectionCommand = new IpcCommand<UpdateSelectionParams>(scope, 'selection/update');

// NOTIFICATIONS

export interface DidChangeParams {
	state: State;
}
export const DidChangeNotification = new IpcNotification<DidChangeParams>(scope, 'didChange');

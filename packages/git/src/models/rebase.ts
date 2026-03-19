export type RebaseTodoAction = RebaseTodoCommitAction | RebaseTodoCommandAction | RebaseTodoMergesAction | 'update-ref';
export type RebaseTodoCommitAction = 'pick' | 'reword' | 'edit' | 'squash' | 'fixup' | 'drop';
export type RebaseTodoCommandAction = 'exec' | 'break' | 'noop';
export type RebaseTodoMergesAction = 'label' | 'reset' | 'merge';

export interface RebaseTodoEntry<T extends RebaseTodoAction = RebaseTodoAction> {
	readonly action: T;
	readonly line: number;
	// Optional fields depending on command type:
	readonly sha?: string; // Not present for: break, exec, label, reset
	readonly message?: string; // Commit message or command/label text
	readonly ref?: string; // For label, reset, merge (label name)
	readonly command?: string; // For exec (shell command)
	readonly flag?: string; // For fixup (-c, -C) or merge (-c, -C) options
}

export interface RebaseTodoInfo {
	readonly from?: string;
	readonly to?: string;
	readonly onto: string;
}

export interface ParsedRebaseTodo {
	readonly entries: RebaseTodoEntry[];
	readonly info?: RebaseTodoInfo;
}

/** Info about an update-ref entry attached to a commit */
export interface UpdateRefInfo {
	readonly ref: string;
	readonly line: number;
}

/** A processed commit entry with type discriminator */
export interface ProcessedRebaseCommitEntry extends RebaseTodoEntry<RebaseTodoCommitAction> {
	readonly type: 'commit';
	readonly id: string;
	readonly done?: boolean;
	readonly sha: string;
	readonly message: string;

	readonly updateRefs?: UpdateRefInfo[];
}

/** A processed command entry with type discriminator */
export interface ProcessedRebaseCommandEntry extends RebaseTodoEntry<RebaseTodoCommandAction> {
	readonly type: 'command';
	readonly id: string;
	readonly done?: boolean;
}

export type ProcessedRebaseEntry = ProcessedRebaseCommitEntry | ProcessedRebaseCommandEntry;

export interface ProcessedRebaseTodo {
	/** Flat list of entries in file order with type discriminators */
	readonly entries: ProcessedRebaseEntry[];
	readonly commits: Map<string, ProcessedRebaseCommitEntry>;
	/** Whether this rebase preserves merges (--rebase-merges with label/reset/merge) */
	readonly preservesMerges: boolean;
}

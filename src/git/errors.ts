export class GitSearchError extends Error {
	constructor(public readonly original: Error) {
		super(original.message);

		Error.captureStackTrace?.(this, GitSearchError);
	}
}

export const enum StashApplyErrorReason {
	WorkingChanges = 1,
}

export class StashApplyError extends Error {
	static is(ex: any, reason?: StashApplyErrorReason): ex is StashApplyError {
		return ex instanceof StashApplyError && (reason == null || ex.reason === reason);
	}

	readonly original?: Error;
	readonly reason: StashApplyErrorReason | undefined;

	constructor(reason?: StashApplyErrorReason, original?: Error);
	constructor(message?: string, original?: Error);
	constructor(messageOrReason: string | StashApplyErrorReason | undefined, original?: Error) {
		let message;
		let reason: StashApplyErrorReason | undefined;
		if (messageOrReason == null) {
			message = 'Unable to apply stash';
		} else if (typeof messageOrReason === 'string') {
			message = messageOrReason;
			reason = undefined;
		} else {
			reason = messageOrReason;
			message =
				'Unable to apply stash. Your working tree changes would be overwritten. Please commit or stash your changes before trying again';
		}
		super(message);

		this.original = original;
		this.reason = reason;
		Error.captureStackTrace?.(this, StashApplyError);
	}
}

export const enum StashPushErrorReason {
	ConflictingStagedAndUnstagedLines = 1,
}

export class StashPushError extends Error {
	static is(ex: any, reason?: StashPushErrorReason): ex is StashPushError {
		return ex instanceof StashPushError && (reason == null || ex.reason === reason);
	}

	readonly original?: Error;
	readonly reason: StashPushErrorReason | undefined;

	constructor(reason?: StashPushErrorReason, original?: Error);
	constructor(message?: string, original?: Error);
	constructor(messageOrReason: string | StashPushErrorReason | undefined, original?: Error) {
		let message;
		let reason: StashPushErrorReason | undefined;
		if (messageOrReason == null) {
			message = 'Unable to stash';
		} else if (typeof messageOrReason === 'string') {
			message = messageOrReason;
			reason = undefined;
		} else {
			reason = messageOrReason;
			switch (reason) {
				case StashPushErrorReason.ConflictingStagedAndUnstagedLines:
					message =
						'Stash was created, but the working tree cannot be updated because at least one file has staged and unstaged changes on the same line(s).\n\nDo you want to try again by stashing both your staged and unstaged changes?';
					break;
				default:
					message = 'Unable to stash';
			}
		}
		super(message);

		this.original = original;
		this.reason = reason;
		Error.captureStackTrace?.(this, StashApplyError);
	}
}
export const enum WorktreeCreateErrorReason {
	AlreadyCheckedOut = 1,
	AlreadyExists = 2,
}

export class WorktreeCreateError extends Error {
	static is(ex: any, reason?: WorktreeCreateErrorReason): ex is WorktreeCreateError {
		return ex instanceof WorktreeCreateError && (reason == null || ex.reason === reason);
	}

	readonly original?: Error;
	readonly reason: WorktreeCreateErrorReason | undefined;

	constructor(reason?: WorktreeCreateErrorReason, original?: Error);
	constructor(message?: string, original?: Error);
	constructor(messageOrReason: string | WorktreeCreateErrorReason | undefined, original?: Error) {
		let message;
		let reason: WorktreeCreateErrorReason | undefined;
		if (messageOrReason == null) {
			message = 'Unable to create worktree';
		} else if (typeof messageOrReason === 'string') {
			message = messageOrReason;
			reason = undefined;
		} else {
			reason = messageOrReason;
			switch (reason) {
				case WorktreeCreateErrorReason.AlreadyCheckedOut:
					message = 'Unable to create worktree because it is already checked out';
					break;
				case WorktreeCreateErrorReason.AlreadyExists:
					message = 'Unable to create worktree because it already exists';
					break;
			}
		}
		super(message);

		this.original = original;
		this.reason = reason;
		Error.captureStackTrace?.(this, WorktreeCreateError);
	}
}

export const enum WorktreeDeleteErrorReason {
	HasChanges = 1,
	MainWorkingTree = 2,
}

export class WorktreeDeleteError extends Error {
	static is(ex: any, reason?: WorktreeDeleteErrorReason): ex is WorktreeDeleteError {
		return ex instanceof WorktreeDeleteError && (reason == null || ex.reason === reason);
	}

	readonly original?: Error;
	readonly reason: WorktreeDeleteErrorReason | undefined;

	constructor(reason?: WorktreeDeleteErrorReason, original?: Error);
	constructor(message?: string, original?: Error);
	constructor(messageOrReason: string | WorktreeDeleteErrorReason | undefined, original?: Error) {
		let message;
		let reason: WorktreeDeleteErrorReason | undefined;
		if (messageOrReason == null) {
			message = 'Unable to delete worktree';
		} else if (typeof messageOrReason === 'string') {
			message = messageOrReason;
			reason = undefined;
		} else {
			reason = messageOrReason;
			switch (reason) {
				case WorktreeDeleteErrorReason.HasChanges:
					message = 'Unable to delete worktree because there are uncommitted changes';
					break;
				case WorktreeDeleteErrorReason.MainWorkingTree:
					message = 'Unable to delete worktree because it is a main working tree';
					break;
			}
		}
		super(message);

		this.original = original;
		this.reason = reason;
		Error.captureStackTrace?.(this, WorktreeDeleteError);
	}
}

export class GitSearchError extends Error {
	constructor(public readonly original: Error) {
		super(original.message);

		Error.captureStackTrace?.(this, GitSearchError);
	}
}

export const enum ApplyPatchCommitErrorReason {
	StashFailed,
	CreateWorktreeFailed,
	ApplyFailed,
	ApplyAbortedWouldOverwrite,
	AppliedWithConflicts,
}

export class ApplyPatchCommitError extends Error {
	static is(ex: unknown, reason?: ApplyPatchCommitErrorReason): ex is ApplyPatchCommitError {
		return ex instanceof ApplyPatchCommitError && (reason == null || ex.reason === reason);
	}

	readonly original?: Error;
	readonly reason: ApplyPatchCommitErrorReason | undefined;

	constructor(reason: ApplyPatchCommitErrorReason, message?: string, original?: Error) {
		message ||= 'Unable to apply patch';
		super(message);

		this.original = original;
		this.reason = reason;
		Error.captureStackTrace?.(this, ApplyPatchCommitError);
	}
}

export class BlameIgnoreRevsFileError extends Error {
	static is(ex: unknown): ex is BlameIgnoreRevsFileError {
		return ex instanceof BlameIgnoreRevsFileError;
	}

	constructor(
		public readonly fileName: string,
		public readonly original?: Error,
	) {
		super(`Invalid blame.ignoreRevsFile: '${fileName}'`);

		Error.captureStackTrace?.(this, BlameIgnoreRevsFileError);
	}
}

export class BlameIgnoreRevsFileBadRevisionError extends Error {
	static is(ex: unknown): ex is BlameIgnoreRevsFileBadRevisionError {
		return ex instanceof BlameIgnoreRevsFileBadRevisionError;
	}

	constructor(
		public readonly revision: string,
		public readonly original?: Error,
	) {
		super(`Invalid revision in blame.ignoreRevsFile: '${revision}'`);

		Error.captureStackTrace?.(this, BlameIgnoreRevsFileBadRevisionError);
	}
}

export const enum StashApplyErrorReason {
	WorkingChanges,
}

export class StashApplyError extends Error {
	static is(ex: unknown, reason?: StashApplyErrorReason): ex is StashApplyError {
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
	ConflictingStagedAndUnstagedLines,
	NothingToSave,
}

export class StashPushError extends Error {
	static is(ex: unknown, reason?: StashPushErrorReason): ex is StashPushError {
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
						'Changes were stashed, but the working tree cannot be updated because at least one file has staged and unstaged changes on the same line(s)';
					break;
				case StashPushErrorReason.NothingToSave:
					message = 'No files to stash';
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

export const enum PushErrorReason {
	RemoteAhead,
	TipBehind,
	PushRejected,
	PushRejectedWithLease,
	PushRejectedWithLeaseIfIncludes,
	PermissionDenied,
	RemoteConnection,
	NoUpstream,
	Other,
}

export class PushError extends Error {
	static is(ex: unknown, reason?: PushErrorReason): ex is PushError {
		return ex instanceof PushError && (reason == null || ex.reason === reason);
	}

	readonly original?: Error;
	readonly reason: PushErrorReason | undefined;

	constructor(reason?: PushErrorReason, original?: Error, branch?: string, remote?: string);
	constructor(message?: string, original?: Error);
	constructor(
		messageOrReason: string | PushErrorReason | undefined,
		original?: Error,
		branch?: string,
		remote?: string,
	) {
		let message;
		const baseMessage = `Unable to push${branch ? ` branch '${branch}'` : ''}${remote ? ` to ${remote}` : ''}`;
		let reason: PushErrorReason | undefined;
		if (messageOrReason == null) {
			message = baseMessage;
		} else if (typeof messageOrReason === 'string') {
			message = messageOrReason;
			reason = undefined;
		} else {
			reason = messageOrReason;

			switch (reason) {
				case PushErrorReason.RemoteAhead:
					message = `${baseMessage} because the remote contains work that you do not have locally. Try fetching first.`;
					break;
				case PushErrorReason.TipBehind:
					message = `${baseMessage} as it is behind its remote counterpart. Try pulling first.`;
					break;
				case PushErrorReason.PushRejected:
					message = `${baseMessage} because some refs failed to push or the push was rejected. Try pulling first.`;
					break;
				case PushErrorReason.PushRejectedWithLease:
				case PushErrorReason.PushRejectedWithLeaseIfIncludes:
					message = `Unable to force push${branch ? ` branch '${branch}'` : ''}${
						remote ? ` to ${remote}` : ''
					} because some refs failed to push or the push was rejected. The tip of the remote-tracking branch has been updated since the last checkout. Try pulling first.`;
					break;
				case PushErrorReason.PermissionDenied:
					message = `${baseMessage} because you don't have permission to push to this remote repository.`;
					break;
				case PushErrorReason.RemoteConnection:
					message = `${baseMessage} because the remote repository could not be reached.`;
					break;
				case PushErrorReason.NoUpstream:
					message = `${baseMessage} because it has no upstream branch.`;
					break;
				default:
					message = baseMessage;
			}
		}
		super(message);

		this.original = original;
		this.reason = reason;
		Error.captureStackTrace?.(this, PushError);
	}
}

export const enum PullErrorReason {
	Conflict,
	GitIdentity,
	RemoteConnection,
	UnstagedChanges,
	UnmergedFiles,
	UncommittedChanges,
	OverwrittenChanges,
	RefLocked,
	RebaseMultipleBranches,
	TagConflict,
	Other,
}

export class PullError extends Error {
	static is(ex: unknown, reason?: PullErrorReason): ex is PullError {
		return ex instanceof PullError && (reason == null || ex.reason === reason);
	}

	readonly original?: Error;
	readonly reason: PullErrorReason | undefined;

	constructor(reason?: PullErrorReason, original?: Error, branch?: string, remote?: string);
	constructor(message?: string, original?: Error);
	constructor(messageOrReason: string | PullErrorReason | undefined, original?: Error) {
		let message;
		let reason: PullErrorReason | undefined;
		const baseMessage = `Unable to pull`;
		if (messageOrReason == null) {
			message = baseMessage;
		} else if (typeof messageOrReason === 'string') {
			message = messageOrReason;
			reason = undefined;
		} else {
			reason = messageOrReason;
			switch (reason) {
				case PullErrorReason.Conflict:
					message = `${baseMessage} due to conflicts.`;
					break;
				case PullErrorReason.GitIdentity:
					message = `${baseMessage} because you have not yet set up your Git identity.`;
					break;
				case PullErrorReason.RemoteConnection:
					message = `${baseMessage} because the remote repository could not be reached.`;
					break;
				case PullErrorReason.UnstagedChanges:
					message = `${baseMessage} because you have unstaged changes.`;
					break;
				case PullErrorReason.UnmergedFiles:
					message = `${baseMessage} because you have unmerged files.`;
					break;
				case PullErrorReason.UncommittedChanges:
					message = `${baseMessage} because you have uncommitted changes.`;
					break;
				case PullErrorReason.OverwrittenChanges:
					message = `${baseMessage} because local changes to some files would be overwritten.`;
					break;
				case PullErrorReason.RefLocked:
					message = `${baseMessage} because a local ref could not be updated.`;
					break;
				case PullErrorReason.RebaseMultipleBranches:
					message = `${baseMessage} because you are trying to rebase onto multiple branches.`;
					break;
				case PullErrorReason.TagConflict:
					message = `${baseMessage} because a local tag would be overwritten.`;
					break;
				default:
					message = baseMessage;
			}
		}
		super(message);

		this.original = original;
		this.reason = reason;
		Error.captureStackTrace?.(this, PullError);
	}
}

export const enum FetchErrorReason {
	NoFastForward,
	NoRemote,
	RemoteConnection,
	Other,
}

export class FetchError extends Error {
	static is(ex: unknown, reason?: FetchErrorReason): ex is FetchError {
		return ex instanceof FetchError && (reason == null || ex.reason === reason);
	}

	readonly original?: Error;
	readonly reason: FetchErrorReason | undefined;

	constructor(reason?: FetchErrorReason, original?: Error, branch?: string, remote?: string);
	constructor(message?: string, original?: Error);
	constructor(
		messageOrReason: string | FetchErrorReason | undefined,
		original?: Error,
		branch?: string,
		remote?: string,
	) {
		let message;
		const baseMessage = `Unable to fetch${branch ? ` branch '${branch}'` : ''}${remote ? ` from ${remote}` : ''}`;
		let reason: FetchErrorReason | undefined;
		if (messageOrReason == null) {
			message = baseMessage;
		} else if (typeof messageOrReason === 'string') {
			message = messageOrReason;
			reason = undefined;
		} else {
			reason = messageOrReason;
			switch (reason) {
				case FetchErrorReason.NoFastForward:
					message = `${baseMessage} as it cannot be fast-forwarded`;
					break;
				case FetchErrorReason.NoRemote:
					message = `${baseMessage} without a remote repository specified.`;
					break;
				case FetchErrorReason.RemoteConnection:
					message = `${baseMessage}. Could not connect to the remote repository.`;
					break;
				default:
					message = baseMessage;
			}
		}
		super(message);

		this.original = original;
		this.reason = reason;
		Error.captureStackTrace?.(this, FetchError);
	}
}

export const enum CherryPickErrorReason {
	Conflicts,
	AbortedWouldOverwrite,
	Other,
}

export class CherryPickError extends Error {
	static is(ex: unknown, reason?: CherryPickErrorReason): ex is CherryPickError {
		return ex instanceof CherryPickError && (reason == null || ex.reason === reason);
	}

	readonly original?: Error;
	readonly reason: CherryPickErrorReason | undefined;

	constructor(reason?: CherryPickErrorReason, original?: Error, sha?: string);
	constructor(message?: string, original?: Error);
	constructor(messageOrReason: string | CherryPickErrorReason | undefined, original?: Error, sha?: string) {
		let message;
		const baseMessage = `Unable to cherry-pick${sha ? ` commit '${sha}'` : ''}`;
		let reason: CherryPickErrorReason | undefined;
		if (messageOrReason == null) {
			message = baseMessage;
		} else if (typeof messageOrReason === 'string') {
			message = messageOrReason;
			reason = undefined;
		} else {
			reason = messageOrReason;
			switch (reason) {
				case CherryPickErrorReason.AbortedWouldOverwrite:
					message = `${baseMessage} as some local changes would be overwritten.`;
					break;
				case CherryPickErrorReason.Conflicts:
					message = `${baseMessage} due to conflicts.`;
					break;
				default:
					message = baseMessage;
			}
		}
		super(message);

		this.original = original;
		this.reason = reason;
		Error.captureStackTrace?.(this, CherryPickError);
	}
}

export class WorkspaceUntrustedError extends Error {
	constructor() {
		super('Unable to perform Git operations because the current workspace is untrusted');

		Error.captureStackTrace?.(this, WorkspaceUntrustedError);
	}
}

export const enum WorktreeCreateErrorReason {
	AlreadyCheckedOut,
	AlreadyExists,
}

export class WorktreeCreateError extends Error {
	static is(ex: unknown, reason?: WorktreeCreateErrorReason): ex is WorktreeCreateError {
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
	HasChanges,
	DefaultWorkingTree,
	DirectoryNotEmpty,
}

export class WorktreeDeleteError extends Error {
	static is(ex: unknown, reason?: WorktreeDeleteErrorReason): ex is WorktreeDeleteError {
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
				case WorktreeDeleteErrorReason.DefaultWorkingTree:
					message = 'Cannot delete worktree because it is the default working tree';
					break;
			}
		}
		super(message);

		this.original = original;
		this.reason = reason;
		Error.captureStackTrace?.(this, WorktreeDeleteError);
	}
}

export const enum TagErrorReason {
	TagAlreadyExists,
	TagNotFound,
	InvalidTagName,
	PermissionDenied,
	RemoteRejected,
	Other,
}

export class TagError extends Error {
	static is(ex: unknown, reason?: TagErrorReason): ex is TagError {
		return ex instanceof TagError && (reason == null || ex.reason === reason);
	}

	readonly original?: Error;
	readonly reason: TagErrorReason | undefined;
	action?: string;
	tag?: string;

	private static buildTagErrorMessage(reason?: TagErrorReason, tag?: string, action?: string): string {
		let baseMessage: string;
		if (action != null) {
			baseMessage = `Unable to ${action} tag ${tag ? `'${tag}'` : ''}`;
		} else {
			baseMessage = `Unable to perform action${tag ? ` with tag '${tag}'` : 'on tag'}`;
		}

		switch (reason) {
			case TagErrorReason.TagAlreadyExists:
				return `${baseMessage} because it already exists`;
			case TagErrorReason.TagNotFound:
				return `${baseMessage} because it does not exist`;
			case TagErrorReason.InvalidTagName:
				return `${baseMessage} because the tag name is invalid`;
			case TagErrorReason.PermissionDenied:
				return `${baseMessage} because you don't have permission to push to this remote repository.`;
			case TagErrorReason.RemoteRejected:
				return `${baseMessage} because the remote repository rejected the push.`;
			default:
				return baseMessage;
		}
	}

	constructor(reason?: TagErrorReason, original?: Error, tag?: string, action?: string);
	constructor(message?: string, original?: Error);
	constructor(messageOrReason: string | TagErrorReason | undefined, original?: Error, tag?: string, action?: string) {
		let reason: TagErrorReason | undefined;
		if (typeof messageOrReason !== 'string') {
			reason = messageOrReason as TagErrorReason;
		} else {
			super(messageOrReason);
		}
		const message =
			typeof messageOrReason === 'string'
				? messageOrReason
				: TagError.buildTagErrorMessage(messageOrReason as TagErrorReason, tag, action);
		super(message);

		this.original = original;
		this.reason = reason;
		this.tag = tag;
		this.action = action;
		Error.captureStackTrace?.(this, TagError);
	}

	WithTag(tag: string) {
		this.tag = tag;
		this.message = TagError.buildTagErrorMessage(this.reason, tag, this.action);
		return this;
	}

	WithAction(action: string) {
		this.action = action;
		this.message = TagError.buildTagErrorMessage(this.reason, this.tag, action);
		return this;
	}
}

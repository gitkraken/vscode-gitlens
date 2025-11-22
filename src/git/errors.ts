import { pluralize } from '../system/string';
import type { GitPausedOperation, GitPausedOperationStatus } from './models/pausedOperationStatus';

export interface GitCommandContext {
	readonly repoPath: string;
	readonly args: readonly (string | undefined)[];
}

export abstract class GitCommandError extends Error {
	static is(ex: unknown): ex is GitCommandError {
		return ex instanceof GitCommandError;
	}

	readonly original?: Error;

	private _gitCommand?: GitCommandContext;
	get gitCommand(): GitCommandContext | undefined {
		return this._gitCommand;
	}

	constructor(message: string, original?: Error, gitCommand?: GitCommandContext) {
		super(message);
		this.original = original;
		this._gitCommand = gitCommand;
		Error.captureStackTrace?.(this, new.target);
	}

	update(changes: { gitCommand?: GitCommandContext }): this {
		this._gitCommand = changes.gitCommand ?? this.gitCommand;
		return this;
	}
}

export class GitSearchError extends Error {
	constructor(public readonly original: Error) {
		super(original.message);

		Error.captureStackTrace?.(this, new.target);
	}
}

export const enum ApplyPatchCommitErrorReason {
	StashFailed,
	CreateWorktreeFailed,
	CheckoutFailed,
	ApplyFailed,
	ApplyAbortedWouldOverwrite,
	AppliedWithConflicts,
}

export class ApplyPatchCommitError extends GitCommandError {
	static override is(ex: unknown, reason?: ApplyPatchCommitErrorReason): ex is ApplyPatchCommitError {
		return ex instanceof ApplyPatchCommitError && (reason == null || ex.reason === reason);
	}

	readonly reason: ApplyPatchCommitErrorReason | undefined;

	constructor(
		reason: ApplyPatchCommitErrorReason,
		message?: string,
		original?: Error,
		gitCommand?: GitCommandContext,
	) {
		message ||= 'Unable to apply patch';
		super(message, original, gitCommand);

		this.reason = reason;
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

		Error.captureStackTrace?.(this, new.target);
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

		Error.captureStackTrace?.(this, new.target);
	}
}

export const enum StashApplyErrorReason {
	WorkingChanges,
}

export class StashApplyError extends GitCommandError {
	static override is(ex: unknown, reason?: StashApplyErrorReason): ex is StashApplyError {
		return ex instanceof StashApplyError && (reason == null || ex.reason === reason);
	}

	readonly reason: StashApplyErrorReason | undefined;

	constructor(reason?: StashApplyErrorReason, original?: Error, gitCommand?: GitCommandContext);
	constructor(message?: string, original?: Error, gitCommand?: GitCommandContext);
	constructor(
		messageOrReason: string | StashApplyErrorReason | undefined,
		original?: Error,
		gitCommand?: GitCommandContext,
	) {
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
		super(message, original, gitCommand);

		this.reason = reason;
	}
}

export const enum StashPushErrorReason {
	ConflictingStagedAndUnstagedLines,
	NothingToSave,
}

export class StashPushError extends GitCommandError {
	static override is(ex: unknown, reason?: StashPushErrorReason): ex is StashPushError {
		return ex instanceof StashPushError && (reason == null || ex.reason === reason);
	}

	readonly reason: StashPushErrorReason | undefined;

	constructor(reason?: StashPushErrorReason, original?: Error, gitCommand?: GitCommandContext);
	constructor(message?: string, original?: Error, gitCommand?: GitCommandContext);
	constructor(
		messageOrReason: string | StashPushErrorReason | undefined,
		original?: Error,
		gitCommand?: GitCommandContext,
	) {
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
		super(message, original, gitCommand);

		this.reason = reason;
	}
}

export const enum PushErrorReason {
	RemoteAhead,
	TipBehind,
	PushRejected,
	PushRejectedRefNotExists,
	PushRejectedWithLease,
	PushRejectedWithLeaseIfIncludes,
	PermissionDenied,
	RemoteConnection,
	NoUpstream,
	Other,
}

export class PushError extends GitCommandError {
	static override is(ex: unknown, reason?: PushErrorReason): ex is PushError {
		return ex instanceof PushError && (reason == null || ex.reason === reason);
	}

	readonly reason: PushErrorReason | undefined;

	constructor(
		reason?: PushErrorReason,
		original?: Error,
		branch?: string,
		remote?: string,
		gitCommand?: GitCommandContext,
	);
	constructor(message?: string, original?: Error);
	constructor(
		messageOrReason: string | PushErrorReason | undefined,
		original?: Error,
		branch?: string,
		remote?: string,
		gitCommand?: GitCommandContext,
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
				case PushErrorReason.PushRejectedRefNotExists:
					message = `Unable to delete remote branch${branch ? ` '${branch}'` : ''}${
						remote ? ` from ${remote}` : ''
					}, the remote reference does not exist`;
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
		super(message, original, typeof branch === 'object' ? branch : gitCommand);

		this.reason = reason;
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

export class PullError extends GitCommandError {
	static override is(ex: unknown, reason?: PullErrorReason): ex is PullError {
		return ex instanceof PullError && (reason == null || ex.reason === reason);
	}

	readonly reason: PullErrorReason | undefined;

	constructor(reason?: PullErrorReason, original?: Error, gitCommand?: GitCommandContext);
	constructor(message?: string, original?: Error);
	constructor(
		messageOrReason: string | PullErrorReason | undefined,
		original?: Error,
		gitCommand?: GitCommandContext,
	) {
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
					message = `Unable to complete pull due to conflicts which must be resolved.`;
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
		super(message, original, gitCommand);

		this.reason = reason;
	}
}

export const enum FetchErrorReason {
	NoFastForward,
	NoRemote,
	RemoteConnection,
	Other,
}

export class FetchError extends GitCommandError {
	static override is(ex: unknown, reason?: FetchErrorReason): ex is FetchError {
		return ex instanceof FetchError && (reason == null || ex.reason === reason);
	}

	readonly reason: FetchErrorReason | undefined;

	constructor(
		reason?: FetchErrorReason,
		original?: Error,
		branch?: string,
		remote?: string,
		gitCommand?: GitCommandContext,
	);
	constructor(message?: string, original?: Error);
	constructor(
		messageOrReason: string | FetchErrorReason | undefined,
		original?: Error,
		branch?: string,
		remote?: string,
		gitCommand?: GitCommandContext,
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
		super(message, original, typeof branch === 'object' ? branch : gitCommand);

		this.reason = reason;
	}
}

export const enum CherryPickErrorReason {
	AbortedWouldOverwrite,
	Conflicts,
	EmptyCommit,
	Other,
}

export class CherryPickError extends GitCommandError {
	static override is(ex: unknown, reason?: CherryPickErrorReason): ex is CherryPickError {
		return ex instanceof CherryPickError && (reason == null || ex.reason === reason);
	}

	private static buildErrorMessage(reason?: CherryPickErrorReason, revs?: string[]): string {
		const baseMessage = `Unable to cherry-pick${
			revs?.length ? (revs.length === 1 ? ` commit '${revs[0]}'` : ` ${pluralize('commit', revs.length)}`) : ''
		}`;

		switch (reason) {
			case CherryPickErrorReason.AbortedWouldOverwrite:
				return `${baseMessage} as some local changes would be overwritten.`;
			case CherryPickErrorReason.Conflicts:
				return `${baseMessage} due to conflicts.`;
			default:
				return baseMessage;
		}
	}

	readonly reason: CherryPickErrorReason | undefined;
	private _revs?: string[];
	get revs(): string[] | undefined {
		return this._revs;
	}

	constructor(reason?: CherryPickErrorReason, original?: Error, revs?: string[], gitCommand?: GitCommandContext);
	constructor(message?: string, original?: Error);
	constructor(
		messageOrReason: string | CherryPickErrorReason | undefined,
		original?: Error,
		revs?: string[],
		gitCommand?: GitCommandContext,
	) {
		let message;
		let reason: CherryPickErrorReason | undefined;
		if (messageOrReason == null || typeof messageOrReason !== 'string') {
			reason = messageOrReason;
			message = CherryPickError.buildErrorMessage(reason, revs);
		} else {
			message = messageOrReason;
		}
		super(message, original, gitCommand);

		this.reason = reason;
		this._revs = revs;
	}

	override update(changes: { gitCommand?: GitCommandContext; revs?: string[] }): this {
		super.update({ gitCommand: changes.gitCommand });
		this._revs = changes.revs === null ? undefined : (changes.revs ?? this._revs);
		this.message = CherryPickError.buildErrorMessage(this.reason, this._revs);
		return this;
	}
}

export class WorkspaceUntrustedError extends Error {
	constructor() {
		super('Unable to perform Git operations because the current workspace is untrusted');

		Error.captureStackTrace?.(this, new.target);
	}
}

export const enum WorktreeCreateErrorReason {
	AlreadyCheckedOut,
	AlreadyExists,
}

export class WorktreeCreateError extends GitCommandError {
	static override is(ex: unknown, reason?: WorktreeCreateErrorReason): ex is WorktreeCreateError {
		return ex instanceof WorktreeCreateError && (reason == null || ex.reason === reason);
	}

	readonly reason: WorktreeCreateErrorReason | undefined;

	constructor(reason?: WorktreeCreateErrorReason, original?: Error, gitCommand?: GitCommandContext);
	constructor(message?: string, original?: Error);
	constructor(
		messageOrReason: string | WorktreeCreateErrorReason | undefined,
		original?: Error,
		gitCommand?: GitCommandContext,
	) {
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
		super(message, original, gitCommand);

		this.reason = reason;
	}
}

export const enum WorktreeDeleteErrorReason {
	HasChanges,
	DefaultWorkingTree,
	DirectoryNotEmpty,
}

export class WorktreeDeleteError extends GitCommandError {
	static override is(ex: unknown, reason?: WorktreeDeleteErrorReason): ex is WorktreeDeleteError {
		return ex instanceof WorktreeDeleteError && (reason == null || ex.reason === reason);
	}

	readonly reason: WorktreeDeleteErrorReason | undefined;

	constructor(reason?: WorktreeDeleteErrorReason, original?: Error, gitCommand?: GitCommandContext);
	constructor(message?: string, original?: Error);
	constructor(
		messageOrReason: string | WorktreeDeleteErrorReason | undefined,
		original?: Error,
		gitCommand?: GitCommandContext,
	) {
		let message: string;
		let reason: WorktreeDeleteErrorReason | undefined;
		if (messageOrReason == null) {
			message = 'Unable to delete worktree';
		} else if (typeof messageOrReason === 'string') {
			message = messageOrReason;
			reason = undefined;
		} else {
			reason = messageOrReason;
			message = 'Unable to delete worktree';
			switch (reason) {
				case WorktreeDeleteErrorReason.HasChanges:
					message = 'Unable to delete worktree because there are uncommitted changes';
					break;
				case WorktreeDeleteErrorReason.DefaultWorkingTree:
					message = 'Cannot delete worktree because it is the default working tree';
					break;
			}
		}
		super(message, original, gitCommand);

		this.reason = reason;
	}
}

export const enum BranchErrorReason {
	BranchAlreadyExists,
	BranchNotFullyMerged,
	NoRemoteReference,
	InvalidBranchName,
	Other,
}

export class BranchError extends GitCommandError {
	static override is(ex: unknown, reason?: BranchErrorReason): ex is BranchError {
		return ex instanceof BranchError && (reason == null || ex.reason === reason);
	}

	private static buildErrorMessage(reason?: BranchErrorReason, branch?: string, action?: string): string {
		let baseMessage: string;
		if (action != null) {
			baseMessage = `Unable to ${action} branch ${branch ? `'${branch}'` : ''}`;
		} else {
			baseMessage = `Unable to perform action ${branch ? `with branch '${branch}'` : 'on branch'}`;
		}
		switch (reason) {
			case BranchErrorReason.BranchAlreadyExists:
				return `${baseMessage} because it already exists`;
			case BranchErrorReason.BranchNotFullyMerged:
				return `${baseMessage} because it is not fully merged`;
			case BranchErrorReason.NoRemoteReference:
				return `${baseMessage} because the remote reference does not exist`;
			case BranchErrorReason.InvalidBranchName:
				return `${baseMessage} because the branch name is invalid`;
			default:
				return baseMessage;
		}
	}

	readonly reason: BranchErrorReason | undefined;
	private _branch?: string;
	get branch(): string | undefined {
		return this._branch;
	}
	private _action?: string;
	get action(): string | undefined {
		return this._action;
	}

	constructor(
		reason?: BranchErrorReason,
		original?: Error,
		branch?: string,
		action?: string,
		gitCommand?: GitCommandContext,
	);
	constructor(message?: string, original?: Error);
	constructor(
		messageOrReason: string | BranchErrorReason | undefined,
		original?: Error,
		branch?: string,
		action?: string,
		gitCommand?: GitCommandContext,
	) {
		let message;
		let reason: BranchErrorReason | undefined;
		if (messageOrReason == null || typeof messageOrReason !== 'string') {
			reason = messageOrReason;
			message = BranchError.buildErrorMessage(reason, branch, action);
		} else {
			message = messageOrReason;
		}
		super(message, original, gitCommand);

		this.reason = reason;
		this._branch = branch;
		this._action = action;
	}

	override update(changes: { gitCommand?: GitCommandContext; branch?: string; action?: string }): this {
		super.update({ gitCommand: changes.gitCommand });
		this._branch = changes.branch === null ? undefined : (changes.branch ?? this._branch);
		this._action = changes.action === null ? undefined : (changes.action ?? this._action);
		this.message = BranchError.buildErrorMessage(this.reason, this._branch, this._action);
		return this;
	}
}

export const enum CheckoutErrorReason {
	ChangesWouldBeOverwritten,
	PathspecNotFound,
	InvalidRef,
	Other,
}

export class CheckoutError extends GitCommandError {
	static override is(ex: unknown, reason?: CheckoutErrorReason): ex is CheckoutError {
		return ex instanceof CheckoutError && (reason == null || ex.reason === reason);
	}

	private static buildErrorMessage(reason?: CheckoutErrorReason, ref?: string): string {
		const baseMessage = `Unable to checkout${ref ? ` '${ref}'` : ''}`;
		switch (reason) {
			case CheckoutErrorReason.ChangesWouldBeOverwritten:
				return `${baseMessage}. Your local changes would be overwritten. Please commit or stash your changes before switching branches.`;
			case CheckoutErrorReason.PathspecNotFound:
				return `${baseMessage} because the path or reference does not exist`;
			case CheckoutErrorReason.InvalidRef:
				return `${baseMessage} because the reference is invalid`;
			default:
				return baseMessage;
		}
	}

	readonly reason: CheckoutErrorReason | undefined;
	private _ref?: string;
	get ref(): string | undefined {
		return this._ref;
	}

	constructor(reason?: CheckoutErrorReason, original?: Error, ref?: string, gitCommand?: GitCommandContext);
	constructor(message?: string, original?: Error);
	constructor(
		messageOrReason: string | CheckoutErrorReason | undefined,
		original?: Error,
		ref?: string,
		gitCommand?: GitCommandContext,
	) {
		let message;
		let reason: CheckoutErrorReason | undefined;
		if (messageOrReason == null || typeof messageOrReason !== 'string') {
			reason = messageOrReason;
			message = CheckoutError.buildErrorMessage(reason, ref);
		} else {
			message = messageOrReason;
		}
		super(message, original, gitCommand);

		this.reason = reason;
		this._ref = ref;
	}

	override update(changes: { gitCommand?: GitCommandContext; ref?: string }): this {
		super.update({ gitCommand: changes.gitCommand });
		this._ref = changes.ref === null ? undefined : (changes.ref ?? this._ref);
		this.message = CheckoutError.buildErrorMessage(this.reason, this._ref);
		return this;
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

export class TagError extends GitCommandError {
	static override is(ex: unknown, reason?: TagErrorReason): ex is TagError {
		return ex instanceof TagError && (reason == null || ex.reason === reason);
	}

	private static buildErrorMessage(reason?: TagErrorReason, tag?: string, action?: string): string {
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

	readonly reason: TagErrorReason | undefined;
	private _tag?: string;
	get tag(): string | undefined {
		return this._tag;
	}
	private _action?: string;
	get action(): string | undefined {
		return this._action;
	}

	constructor(
		reason?: TagErrorReason,
		original?: Error,
		tag?: string,
		action?: string,
		gitCommand?: GitCommandContext,
	);
	constructor(message?: string, original?: Error);
	constructor(
		messageOrReason: string | TagErrorReason | undefined,
		original?: Error,
		tag?: string,
		action?: string,
		gitCommand?: GitCommandContext,
	) {
		let message;
		let reason: TagErrorReason | undefined;
		if (messageOrReason == null || typeof messageOrReason !== 'string') {
			reason = messageOrReason;
			message = TagError.buildErrorMessage(reason, tag, action);
		} else {
			message = messageOrReason;
		}
		super(message, original, gitCommand);

		this.reason = reason;
		this._tag = tag;
		this._action = action;
	}

	override update(changes: { gitCommand?: GitCommandContext; tag?: string; action?: string }): this {
		super.update({ gitCommand: changes.gitCommand });
		this._tag = changes.tag === null ? undefined : (changes.tag ?? this._tag);
		this._action = changes.action === null ? undefined : (changes.action ?? this._action);
		this.message = TagError.buildErrorMessage(this.reason, this._tag, this._action);
		return this;
	}
}

export const enum PausedOperationAbortErrorReason {
	NothingToAbort,
}

export class PausedOperationAbortError extends GitCommandError {
	static override is(ex: unknown, reason?: PausedOperationAbortErrorReason): ex is PausedOperationAbortError {
		return ex instanceof PausedOperationAbortError && (reason == null || ex.reason === reason);
	}

	readonly reason: PausedOperationAbortErrorReason | undefined;
	readonly operation: GitPausedOperation;

	constructor(
		reason: PausedOperationAbortErrorReason | undefined,
		operation: GitPausedOperation,
		message?: string,
		original?: Error,
		gitCommand?: GitCommandContext,
	) {
		message ||= 'Unable to abort operation';
		super(message, original, gitCommand);

		this.reason = reason;
		this.operation = operation;
	}
}

export const enum PausedOperationContinueErrorReason {
	EmptyCommit,
	NothingToContinue,
	UnmergedFiles,
	UncommittedChanges,
	UnstagedChanges,
	UnresolvedConflicts,
	WouldOverwrite,
}

export class PausedOperationContinueError extends GitCommandError {
	static override is(ex: unknown, reason?: PausedOperationContinueErrorReason): ex is PausedOperationContinueError {
		return ex instanceof PausedOperationContinueError && (reason == null || ex.reason === reason);
	}

	readonly reason: PausedOperationContinueErrorReason | undefined;
	readonly operation: GitPausedOperationStatus;

	constructor(
		reason: PausedOperationContinueErrorReason | undefined,
		operation: GitPausedOperationStatus,
		message?: string,
		original?: Error,
		gitCommand?: GitCommandContext,
	) {
		message ||= 'Unable to continue operation';
		super(message, original, gitCommand);

		this.reason = reason;
		this.operation = operation;
	}
}

export const enum RebaseErrorReason {
	WorkingChanges,
	OverwrittenChanges,
	Conflicts,
	InProgress,
	Aborted,
	Other,
}

export class RebaseError extends GitCommandError {
	static override is(ex: unknown, reason?: RebaseErrorReason): ex is RebaseError {
		return ex instanceof RebaseError && (reason == null || ex.reason === reason);
	}

	private static buildErrorMessage(reason?: RebaseErrorReason, rev?: string): string {
		const baseMessage = `Unable to rebase${rev ? ` onto '${rev}'` : ''}`;

		switch (reason) {
			case RebaseErrorReason.WorkingChanges:
				return `${baseMessage} because there are uncommitted changes`;
			case RebaseErrorReason.OverwrittenChanges:
				return `${baseMessage} because some local changes would be overwritten`;
			case RebaseErrorReason.Conflicts:
				return `${baseMessage} due to conflicts. Resolve the conflicts first and continue the rebase`;
			case RebaseErrorReason.InProgress:
				return `${baseMessage} because a rebase is already in progress`;
			case RebaseErrorReason.Aborted:
				return `Rebase${rev ? ` onto '${rev}'` : ''} was aborted`;
			default:
				return baseMessage;
		}
	}

	readonly reason: RebaseErrorReason | undefined;
	private _rev?: string;
	get rev(): string | undefined {
		return this._rev;
	}

	constructor(reason?: RebaseErrorReason, original?: Error, rev?: string, gitCommand?: GitCommandContext);
	constructor(message?: string, original?: Error);
	constructor(
		messageOrReason: string | RebaseErrorReason | undefined,
		original?: Error,
		rev?: string,
		gitCommand?: GitCommandContext,
	) {
		let message;
		let reason: RebaseErrorReason | undefined;
		if (messageOrReason == null || typeof messageOrReason !== 'string') {
			reason = messageOrReason;
			message = RebaseError.buildErrorMessage(reason, rev);
		} else {
			message = messageOrReason;
		}
		super(message, original, gitCommand);

		this.reason = reason;
		this._rev = rev;
	}

	override update(changes: { gitCommand?: GitCommandContext; rev?: string }): this {
		super.update({ gitCommand: changes.gitCommand });
		this._rev = changes.rev === null ? undefined : (changes.rev ?? this._rev);
		this.message = RebaseError.buildErrorMessage(this.reason, this._rev);
		return this;
	}
}

export const enum MergeErrorReason {
	WorkingChanges,
	OverwrittenChanges,
	Conflicts,
	InProgress,
	Aborted,
	Other,
}

export class MergeError extends GitCommandError {
	static override is(ex: unknown, reason?: MergeErrorReason): ex is MergeError {
		return ex instanceof MergeError && (reason == null || ex.reason === reason);
	}

	private static buildErrorMessage(reason?: MergeErrorReason, ref?: string): string {
		const baseMessage = `Unable to merge${ref ? ` '${ref}'` : ''}`;

		switch (reason) {
			case MergeErrorReason.WorkingChanges:
				return `${baseMessage} because there are uncommitted changes`;
			case MergeErrorReason.OverwrittenChanges:
				return `${baseMessage} because some local changes would be overwritten`;
			case MergeErrorReason.Conflicts:
				return `${baseMessage} due to conflicts. Resolve the conflicts first and continue the merge`;
			case MergeErrorReason.InProgress:
				return `${baseMessage} because a merge is already in progress`;
			case MergeErrorReason.Aborted:
				return `Merge${ref ? ` of '${ref}'` : ''} was aborted`;
			default:
				return baseMessage;
		}
	}

	readonly reason: MergeErrorReason | undefined;
	private _ref?: string;
	get ref(): string | undefined {
		return this._ref;
	}

	constructor(reason?: MergeErrorReason, original?: Error, ref?: string, gitCommand?: GitCommandContext);
	constructor(message?: string, original?: Error);
	constructor(
		messageOrReason: string | MergeErrorReason | undefined,
		original?: Error,
		ref?: string,
		gitCommand?: GitCommandContext,
	) {
		let message;
		let reason: MergeErrorReason | undefined;
		if (messageOrReason == null || typeof messageOrReason !== 'string') {
			reason = messageOrReason;
			message = MergeError.buildErrorMessage(reason, ref);
		} else {
			message = messageOrReason;
		}
		super(message, original, gitCommand);

		this.reason = reason;
		this._ref = ref;
	}

	override update(changes: { gitCommand?: GitCommandContext; ref?: string }): this {
		super.update({ gitCommand: changes.gitCommand });
		this._ref = changes.ref === null ? undefined : (changes.ref ?? this._ref);
		this.message = MergeError.buildErrorMessage(this.reason, this._ref);
		return this;
	}
}

export const enum RevertErrorReason {
	WorkingChanges,
	OverwrittenChanges,
	Conflicts,
	InProgress,
	Aborted,
	Other,
}

export class RevertError extends GitCommandError {
	static override is(ex: unknown, reason?: RevertErrorReason): ex is RevertError {
		return ex instanceof RevertError && (reason == null || ex.reason === reason);
	}

	private static buildErrorMessage(reason?: RevertErrorReason, refs?: string[]): string {
		const baseMessage = `Unable to revert${refs?.length ? ` ${refs.join(', ')}` : ''}`;

		switch (reason) {
			case RevertErrorReason.WorkingChanges:
				return `${baseMessage} because there are uncommitted changes`;
			case RevertErrorReason.OverwrittenChanges:
				return `${baseMessage} because some local changes would be overwritten`;
			case RevertErrorReason.Conflicts:
				return `${baseMessage} due to conflicts. Resolve the conflicts first and continue the revert`;
			case RevertErrorReason.InProgress:
				return `${baseMessage} because a revert is already in progress`;
			case RevertErrorReason.Aborted:
				return `Revert${refs?.length ? ` of ${refs.join(', ')}` : ''} was aborted`;
			default:
				return baseMessage;
		}
	}

	readonly reason: RevertErrorReason | undefined;
	private _refs?: string[];
	get refs(): string[] | undefined {
		return this._refs;
	}

	constructor(reason?: RevertErrorReason, original?: Error, refs?: string[], gitCommand?: GitCommandContext);
	constructor(message?: string, original?: Error);
	constructor(
		messageOrReason: string | RevertErrorReason | undefined,
		original?: Error,
		refs?: string[],
		gitCommand?: GitCommandContext,
	) {
		let message;
		let reason: RevertErrorReason | undefined;
		if (messageOrReason == null || typeof messageOrReason !== 'string') {
			reason = messageOrReason;
			message = RevertError.buildErrorMessage(reason, refs);
		} else {
			message = messageOrReason;
		}
		super(message, original, gitCommand);

		this.reason = reason;
		this._refs = refs;
	}

	override update(changes: { gitCommand?: GitCommandContext; refs?: string[] }): this {
		super.update({ gitCommand: changes.gitCommand });
		this._refs = changes.refs === null ? undefined : (changes.refs ?? this._refs);
		this.message = RevertError.buildErrorMessage(this.reason, this._refs);
		return this;
	}
}

export const enum ResetErrorReason {
	AmbiguousArgument,
	ChangesWouldBeOverwritten,
	DetachedHead,
	EntryNotUpToDate,
	PermissionDenied,
	RefLocked,
	Other,
	UnmergedChanges,
}

export class ResetError extends GitCommandError {
	static override is(ex: unknown, reason?: ResetErrorReason): ex is ResetError {
		return ex instanceof ResetError && (reason == null || ex.reason === reason);
	}

	readonly reason: ResetErrorReason | undefined;
	constructor(reason?: ResetErrorReason, original?: Error, gitCommand?: GitCommandContext);
	constructor(message?: string, original?: Error);
	constructor(
		messageOrReason: string | ResetErrorReason | undefined,
		original?: Error,
		gitCommand?: GitCommandContext,
	) {
		let message;
		let reason: ResetErrorReason | undefined;
		if (messageOrReason == null) {
			message = 'Unable to reset';
		} else if (typeof messageOrReason === 'string') {
			message = messageOrReason;
			reason = undefined;
		} else {
			reason = messageOrReason;
			message = 'Unable to reset';
			switch (reason) {
				case ResetErrorReason.UnmergedChanges:
					message = `${message} because there are unmerged changes`;
					break;
				case ResetErrorReason.AmbiguousArgument:
					message = `${message} because the argument is ambiguous`;
					break;
				case ResetErrorReason.EntryNotUpToDate:
					message = `${message} because the index is not up to date (you may have unresolved merge conflicts)`;
					break;
				case ResetErrorReason.RefLocked:
					message = `${message} because the ref is locked`;
					break;
				case ResetErrorReason.PermissionDenied:
					message = `${message} because you don't have permission to modify affected files`;
					break;
				case ResetErrorReason.DetachedHead:
					message = `${message} because you are in a detached HEAD state`;
					break;
				case ResetErrorReason.ChangesWouldBeOverwritten:
					message = `${message} because your local changes would be overwritten`;
					break;
			}
		}
		super(message, original, gitCommand);

		this.reason = reason;
	}
}

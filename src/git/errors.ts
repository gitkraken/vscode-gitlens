import { pluralize } from '../system/string';
import type { GitPausedOperationStatus } from './models/pausedOperationStatus';

export interface GitCommandContext {
	readonly repoPath: string;
	readonly args: readonly (string | undefined)[];
}

export abstract class GitCommandError<Details extends { gitCommand?: GitCommandContext }> extends Error {
	static is(ex: unknown): ex is GitCommandError<any> {
		return ex instanceof GitCommandError;
	}

	private _details!: Details;
	get details(): Details {
		return this._details;
	}
	private set details(details: Details) {
		this._details = details;
		this.message = this.buildErrorMessage(details);
	}

	readonly original?: Error;

	constructor(message: string, details: Details, original: Error | undefined) {
		super(message);
		this.original = original;
		this.details = details;
		Error.captureStackTrace?.(this, new.target);
	}

	protected abstract buildErrorMessage(details: Details): string;

	update(changes: Details): this {
		this.details = { ...this.details, ...changes };
		return this;
	}
}

export class GitSearchError extends Error {
	constructor(public readonly original: Error) {
		super(original.message);

		Error.captureStackTrace?.(this, new.target);
	}
}

export type ApplyPatchCommitErrorReason =
	| 'appliedWithConflicts'
	| 'applyFailed'
	| 'checkoutFailed'
	| 'createWorktreeFailed'
	| 'stashFailed'
	| 'wouldOverwriteChanges';
interface ApplyPatchCommitErrorDetails {
	reason?: ApplyPatchCommitErrorReason;
	branch?: string;
	gitCommand?: GitCommandContext;
}

export class ApplyPatchCommitError extends GitCommandError<ApplyPatchCommitErrorDetails> {
	static override is(ex: unknown, reason?: ApplyPatchCommitErrorReason): ex is ApplyPatchCommitError {
		return ex instanceof ApplyPatchCommitError && (reason == null || ex.details.reason === reason);
	}

	constructor(details: ApplyPatchCommitErrorDetails, original?: Error) {
		super('Unable to apply patch', details, original);
	}

	override buildErrorMessage(details: ApplyPatchCommitErrorDetails): string {
		const baseMessage = 'Unable to apply patch';
		switch (details.reason) {
			case 'applyFailed':
				return `${baseMessage}${this.original instanceof CherryPickError ? `. ${this.original.message}` : ''}`;
			case 'appliedWithConflicts':
				return 'Patch applied with conflicts';
			case 'checkoutFailed':
				return `${baseMessage} as we were unable to checkout the branch '${details.branch}'${
					this.original instanceof CheckoutError ? `. ${this.original.message}` : ''
				}`;
			case 'createWorktreeFailed':
				return `${baseMessage} as we were unable to create a worktree${
					this.original instanceof WorktreeCreateError ? `. ${this.original.message}` : ''
				}`;
			case 'stashFailed':
				return `${baseMessage} as we were unable to stash your working changes${
					this.original instanceof StashPushError ? `. ${this.original.message}` : ''
				}`;
			case 'wouldOverwriteChanges':
				return `${baseMessage} as some local changes would be overwritten`;
			default:
				return baseMessage;
		}
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

export type BranchErrorReason = 'alreadyExists' | 'notFullyMerged' | 'invalidName' | 'noRemoteReference' | 'other';
interface BranchErrorDetails {
	reason?: BranchErrorReason;
	action?: string;
	branch?: string;
	gitCommand?: GitCommandContext;
}

export class BranchError extends GitCommandError<BranchErrorDetails> {
	static override is(ex: unknown, reason?: BranchErrorReason): ex is BranchError {
		return ex instanceof BranchError && (reason == null || ex.details.reason === reason);
	}

	constructor(details: BranchErrorDetails, original?: Error) {
		super('Unable to perform action on branch', details, original);
	}

	protected override buildErrorMessage(details: BranchErrorDetails): string {
		let baseMessage: string;
		if (details.action != null) {
			baseMessage = `Unable to ${details.action} branch ${details.branch ? `'${details.branch}'` : ''}`;
		} else {
			baseMessage = `Unable to perform action ${details.branch ? `with branch '${details.branch}'` : 'on branch'}`;
		}
		switch (details.reason) {
			case 'alreadyExists':
				return `${baseMessage} because it already exists`;
			case 'notFullyMerged':
				return `${baseMessage} because it is not fully merged`;
			case 'invalidName':
				return `${baseMessage} because the branch name is invalid`;
			case 'noRemoteReference':
				return `${baseMessage} because the remote reference does not exist`;
			default:
				return baseMessage;
		}
	}
}

export type CheckoutErrorReason = 'invalidRef' | 'pathspecNotFound' | 'wouldOverwriteChanges' | 'other';
interface CheckoutErrorDetails {
	reason?: CheckoutErrorReason;
	ref?: string;
	gitCommand?: GitCommandContext;
}

export class CheckoutError extends GitCommandError<CheckoutErrorDetails> {
	static override is(ex: unknown, reason?: CheckoutErrorReason): ex is CheckoutError {
		return ex instanceof CheckoutError && (reason == null || ex.details.reason === reason);
	}

	constructor(details: CheckoutErrorDetails, original?: Error) {
		super('Unable to checkout', details, original);
	}

	protected override buildErrorMessage(details: CheckoutErrorDetails): string {
		const baseMessage = `Unable to checkout${details.ref ? ` '${details.ref}'` : ''}`;
		switch (details.reason) {
			case 'invalidRef':
				return `${baseMessage} because the reference is invalid`;
			case 'pathspecNotFound':
				return `${baseMessage} because the path or reference does not exist`;
			case 'wouldOverwriteChanges':
				return `${baseMessage}. Your local changes would be overwritten. Please commit or stash your changes before switching branches.`;
			default:
				return baseMessage;
		}
	}
}

export type CherryPickErrorReason =
	| 'aborted'
	| 'alreadyInProgress'
	| 'conflicts'
	| 'emptyCommit'
	| 'wouldOverwriteChanges'
	| 'other';
interface CherryPickErrorDetails {
	reason?: CherryPickErrorReason;
	revs?: string[];
	gitCommand?: GitCommandContext;
}

export class CherryPickError extends GitCommandError<CherryPickErrorDetails> {
	static override is(ex: unknown, reason?: CherryPickErrorReason): ex is CherryPickError {
		return ex instanceof CherryPickError && (reason == null || ex.details.reason === reason);
	}

	constructor(details: CherryPickErrorDetails, original?: Error) {
		super('Unable to cherry-pick', details, original);
	}

	protected override buildErrorMessage(details: CherryPickErrorDetails): string {
		const baseMessage = `Unable to cherry-pick${
			details.revs?.length
				? details.revs.length === 1
					? ` commit '${details.revs[0]}'`
					: ` ${pluralize('commit', details.revs.length)}`
				: ''
		}`;

		switch (details.reason) {
			case 'aborted':
				return `${baseMessage} as it was aborted.`;
			case 'alreadyInProgress':
				return `${baseMessage} as a cherry-pick is already in progress.`;
			case 'conflicts':
				return `${baseMessage} due to conflicts.`;
			case 'emptyCommit':
				return `${baseMessage} because it is an empty commit.`;
			case 'wouldOverwriteChanges':
				return `${baseMessage} as some local changes would be overwritten.`;
			default:
				return baseMessage;
		}
	}
}

export type FetchErrorReason = 'noFastForward' | 'noRemote' | 'remoteConnectionFailed' | 'other';
interface FetchErrorDetails {
	reason?: FetchErrorReason;
	branch?: string;
	remote?: string;
	gitCommand?: GitCommandContext;
}

export class FetchError extends GitCommandError<FetchErrorDetails> {
	static override is(ex: unknown, reason?: FetchErrorReason): ex is FetchError {
		return ex instanceof FetchError && (reason == null || ex.details.reason === reason);
	}

	constructor(details: FetchErrorDetails, original?: Error) {
		super('Unable to fetch', details, original);
	}

	protected override buildErrorMessage(details: FetchErrorDetails): string {
		const baseMessage = `Unable to fetch${details.branch ? ` branch '${details.branch}'` : ''}${
			details.remote ? ` from ${details.remote}` : ''
		}`;
		switch (details.reason) {
			case 'noFastForward':
				return `${baseMessage} as it cannot be fast-forwarded`;
			case 'noRemote':
				return `${baseMessage} without a remote repository specified.`;
			case 'remoteConnectionFailed':
				return `${baseMessage}. Could not connect to the remote repository.`;
			default:
				return baseMessage;
		}
	}
}

export type MergeErrorReason =
	| 'aborted'
	| 'alreadyInProgress'
	| 'conflicts'
	| 'uncommittedChanges'
	| 'wouldOverwriteChanges'
	| 'other';
interface MergeErrorDetails {
	reason?: MergeErrorReason;
	ref?: string;
	gitCommand?: GitCommandContext;
}
export class MergeError extends GitCommandError<MergeErrorDetails> {
	static override is(ex: unknown, reason?: MergeErrorReason): ex is MergeError {
		return ex instanceof MergeError && (reason == null || ex.details.reason === reason);
	}

	constructor(details: MergeErrorDetails, original?: Error) {
		super('Unable to merge', details, original);
	}

	protected override buildErrorMessage(details: MergeErrorDetails): string {
		const baseMessage = `Unable to merge${details.ref ? ` '${details.ref}'` : ''}`;

		switch (details.reason) {
			case 'aborted':
				return `Merge${details.ref ? ` of '${details.ref}'` : ''} was aborted`;
			case 'alreadyInProgress':
				return `${baseMessage} because a merge is already in progress`;
			case 'conflicts':
				return `${baseMessage} due to conflicts. Resolve the conflicts first and continue the merge`;
			case 'uncommittedChanges':
				return `${baseMessage} because there are uncommitted changes`;
			case 'wouldOverwriteChanges':
				return `${baseMessage} because some local changes would be overwritten`;
			default:
				return baseMessage;
		}
	}
}

export type PausedOperationAbortErrorReason = 'nothingToAbort';
interface PausedOperationAbortErrorDetails {
	reason?: PausedOperationAbortErrorReason;
	operation: GitPausedOperationStatus;
	gitCommand?: GitCommandContext;
}

export class PausedOperationAbortError extends GitCommandError<PausedOperationAbortErrorDetails> {
	static override is(ex: unknown, reason?: PausedOperationAbortErrorReason): ex is PausedOperationAbortError {
		return ex instanceof PausedOperationAbortError && (reason == null || ex.details.reason === reason);
	}

	constructor(details: PausedOperationAbortErrorDetails, original?: Error) {
		super('Unable to abort operation', details, original);
	}

	protected override buildErrorMessage(details: PausedOperationAbortErrorDetails): string {
		switch (details.reason) {
			case 'nothingToAbort':
				return `Cannot abort as there is no ${details.operation.type} operation in progress`;
			default:
				return `Unable to abort the ${details.operation.type} operation${this.original ? `: ${this.original.message}` : ''}`;
		}
	}
}

export type PausedOperationContinueErrorReason =
	| 'conflicts'
	| 'emptyCommit'
	| 'nothingToContinue'
	| 'uncommittedChanges'
	| 'unmergedFiles'
	| 'unstagedChanges'
	| 'wouldOverwriteChanges';
interface PausedOperationContinueErrorDetails {
	reason?: PausedOperationContinueErrorReason;
	operation: GitPausedOperationStatus;
	skip?: boolean;
	gitCommand?: GitCommandContext;
}

export class PausedOperationContinueError extends GitCommandError<PausedOperationContinueErrorDetails> {
	static override is(ex: unknown, reason?: PausedOperationContinueErrorReason): ex is PausedOperationContinueError {
		return ex instanceof PausedOperationContinueError && (reason == null || ex.details.reason === reason);
	}

	constructor(details: PausedOperationContinueErrorDetails, original?: Error) {
		super('Unable to continue operation', details, original);
	}

	protected override buildErrorMessage(details: PausedOperationContinueErrorDetails): string {
		switch (details.reason) {
			case 'conflicts':
				return `Cannot ${details.skip ? 'skip' : 'continue'} the ${details.operation.type} operation as there are unresolved conflicts`;
			case 'emptyCommit':
				return `Cannot ${details.skip ? 'skip' : 'continue'} the ${details.operation.type} operation as the previous commit is empty`;
			case 'nothingToContinue':
				return `Cannot ${details.skip ? 'skip' : 'continue'} the ${details.operation.type} operation as there is no ${details.operation.type} in progress`;
			case 'uncommittedChanges':
				return `Cannot ${details.skip ? 'skip' : 'continue'} the ${details.operation.type} operation as there are uncommitted changes`;
			case 'unmergedFiles':
				return `Cannot ${details.skip ? 'skip' : 'continue'} the ${details.operation.type} operation as there are unmerged files`;
			case 'unstagedChanges':
				return `Cannot ${details.skip ? 'skip' : 'continue'} the ${details.operation.type} operation as there are unstaged changes`;
			case 'wouldOverwriteChanges':
				return `Cannot ${details.skip ? 'skip' : 'continue'} the ${details.operation.type} operation as some local changes would be overwritten`;
			default:
				return `Unable to ${details.skip ? 'skip' : 'continue'} the ${details.operation.type} operation${this.original ? `: ${this.original.message}` : ''}`;
		}
	}
}

export type PullErrorReason =
	| 'conflict'
	| 'gitIdentity'
	| 'rebaseMultipleBranches'
	| 'refLocked'
	| 'remoteConnectionFailed'
	| 'tagConflict'
	| 'uncommittedChanges'
	| 'unmergedFiles'
	| 'unstagedChanges'
	| 'wouldOverwriteChanges'
	| 'other';
interface PullErrorDetails {
	reason?: PullErrorReason;
	gitCommand?: GitCommandContext;
}

export class PullError extends GitCommandError<PullErrorDetails> {
	static override is(ex: unknown, reason?: PullErrorReason): ex is PullError {
		return ex instanceof PullError && (reason == null || ex.details.reason === reason);
	}

	constructor(details: PullErrorDetails, original?: Error) {
		super('Unable to pull', details, original);
	}

	protected override buildErrorMessage(details: PullErrorDetails): string {
		const baseMessage = 'Unable to pull';
		switch (details.reason) {
			case 'conflict':
				return 'Unable to complete pull due to conflicts which must be resolved.';
			case 'gitIdentity':
				return `${baseMessage} because you have not yet set up your Git identity.`;
			case 'rebaseMultipleBranches':
				return `${baseMessage} because you are trying to rebase onto multiple branches.`;
			case 'refLocked':
				return `${baseMessage} because a local ref could not be updated.`;
			case 'remoteConnectionFailed':
				return `${baseMessage} because the remote repository could not be reached.`;
			case 'tagConflict':
				return `${baseMessage} because a local tag would be overwritten.`;
			case 'uncommittedChanges':
				return `${baseMessage} because you have uncommitted changes.`;
			case 'unmergedFiles':
				return `${baseMessage} because you have unmerged files.`;
			case 'unstagedChanges':
				return `${baseMessage} because you have unstaged changes.`;
			case 'wouldOverwriteChanges':
				return `${baseMessage} because local changes to some files would be overwritten.`;
			default:
				return baseMessage;
		}
	}
}

export type PushErrorReason =
	| 'noUpstream'
	| 'permissionDenied'
	| 'rejected'
	| 'rejectedRefDoesNotExist'
	| 'rejectedWithLease'
	| 'rejectedWithLeaseIfIncludes'
	| 'remoteAhead'
	| 'remoteConnectionFailed'
	| 'tipBehind'
	| 'other';
interface PushErrorDetails {
	reason?: PushErrorReason;
	branch?: string;
	remote?: string;
	gitCommand?: GitCommandContext;
}

export class PushError extends GitCommandError<PushErrorDetails> {
	static override is(ex: unknown, reason?: PushErrorReason): ex is PushError {
		return ex instanceof PushError && (reason == null || ex.details.reason === reason);
	}

	constructor(details: PushErrorDetails, original?: Error) {
		super('Unable to push', details, original);
	}

	protected override buildErrorMessage(details: PushErrorDetails): string {
		const baseMessage = `Unable to push${details.branch ? ` branch '${details.branch}'` : ''}${
			details.remote ? ` to ${details.remote}` : ''
		}`;
		switch (details.reason) {
			case 'noUpstream':
				return `${baseMessage} because it has no upstream branch.`;
			case 'permissionDenied':
				return `${baseMessage} because you don't have permission to push to this remote repository.`;
			case 'rejected':
				return `${baseMessage} because some refs failed to push or the push was rejected. Try pulling first.`;
			case 'rejectedRefDoesNotExist':
				return `Unable to delete remote branch${details.branch ? ` '${details.branch}'` : ''}${
					details.remote ? ` from ${details.remote}` : ''
				}, the remote reference does not exist`;
			case 'rejectedWithLease':
			case 'rejectedWithLeaseIfIncludes':
				return `Unable to force push${details.branch ? ` branch '${details.branch}'` : ''}${
					details.remote ? ` to ${details.remote}` : ''
				} because some refs failed to push or the push was rejected. The tip of the remote-tracking branch has been updated since the last checkout. Try pulling first.`;
			case 'remoteAhead':
				return `${baseMessage} because the remote contains work that you do not have locally. Try fetching first.`;
			case 'remoteConnectionFailed':
				return `${baseMessage} because the remote repository could not be reached.`;
			case 'tipBehind':
				return `${baseMessage} as it is behind its remote counterpart. Try pulling first.`;
			default:
				return baseMessage;
		}
	}
}

export type RebaseErrorReason =
	| 'aborted'
	| 'alreadyInProgress'
	| 'conflicts'
	| 'uncommittedChanges'
	| 'wouldOverwriteChanges'
	| 'other';
interface RebaseErrorDetails {
	reason?: RebaseErrorReason;
	upstream?: string;
	gitCommand?: GitCommandContext;
}

export class RebaseError extends GitCommandError<RebaseErrorDetails> {
	static override is(ex: unknown, reason?: RebaseErrorReason): ex is RebaseError {
		return ex instanceof RebaseError && (reason == null || ex.details.reason === reason);
	}

	constructor(details: RebaseErrorDetails, original?: Error) {
		super('Unable to rebase', details, original);
	}

	protected override buildErrorMessage(details: RebaseErrorDetails): string {
		const baseMessage = `Unable to rebase${details.upstream ? ` onto '${details.upstream}'` : ''}`;

		switch (details.reason) {
			case 'aborted':
				return `Rebase${details.upstream ? ` onto '${details.upstream}'` : ''} was aborted`;
			case 'alreadyInProgress':
				return `${baseMessage} because a rebase is already in progress`;
			case 'conflicts':
				return `${baseMessage} due to conflicts. Resolve the conflicts first and continue the rebase`;
			case 'uncommittedChanges':
				return `${baseMessage} because there are uncommitted changes`;
			case 'wouldOverwriteChanges':
				return `${baseMessage} because some local changes would be overwritten`;
			default:
				return baseMessage;
		}
	}
}

export type ResetErrorReason =
	| 'ambiguousArgument'
	| 'notUpToDate'
	| 'detachedHead'
	| 'permissionDenied'
	| 'refLocked'
	| 'unmergedChanges'
	| 'wouldOverwriteChanges'
	| 'other';
interface ResetErrorDetails {
	reason?: ResetErrorReason;
	gitCommand?: GitCommandContext;
}

export class ResetError extends GitCommandError<ResetErrorDetails> {
	static override is(ex: unknown, reason?: ResetErrorReason): ex is ResetError {
		return ex instanceof ResetError && (reason == null || ex.details.reason === reason);
	}

	constructor(details: ResetErrorDetails, original?: Error) {
		super('Unable to reset', details, original);
	}

	protected override buildErrorMessage(details: ResetErrorDetails): string {
		const baseMessage = 'Unable to reset';
		switch (details.reason) {
			case 'ambiguousArgument':
				return `${baseMessage} because the argument is ambiguous`;
			case 'detachedHead':
				return `${baseMessage} because you are in a detached HEAD state`;
			case 'notUpToDate':
				return `${baseMessage} because the index is not up to date (you may have unresolved merge conflicts)`;
			case 'permissionDenied':
				return `${baseMessage} because you don't have permission to modify affected files`;
			case 'refLocked':
				return `${baseMessage} because the ref is locked`;
			case 'unmergedChanges':
				return `${baseMessage} because there are unmerged changes`;
			case 'wouldOverwriteChanges':
				return `${baseMessage} because your local changes would be overwritten`;
			default:
				return baseMessage;
		}
	}
}

export type RevertErrorReason =
	| 'aborted'
	| 'alreadyInProgress'
	| 'conflicts'
	| 'uncommittedChanges'
	| 'wouldOverwriteChanges'
	| 'other';
interface RevertErrorDetails {
	reason?: RevertErrorReason;
	refs?: string[];
	gitCommand?: GitCommandContext;
}

export class RevertError extends GitCommandError<RevertErrorDetails> {
	static override is(ex: unknown, reason?: RevertErrorReason): ex is RevertError {
		return ex instanceof RevertError && (reason == null || ex.details.reason === reason);
	}

	constructor(details: RevertErrorDetails, original?: Error) {
		super('Unable to revert', details, original);
	}

	protected override buildErrorMessage(details: RevertErrorDetails): string {
		const baseMessage = `Unable to revert${details.refs?.length ? ` ${details.refs.join(', ')}` : ''}`;

		switch (details.reason) {
			case 'aborted':
				return `Revert${details.refs?.length ? ` of ${details.refs.join(', ')}` : ''} was aborted`;
			case 'alreadyInProgress':
				return `${baseMessage} because a revert is already in progress`;
			case 'conflicts':
				return `${baseMessage} due to conflicts. Resolve the conflicts first and continue the revert`;
			case 'uncommittedChanges':
				return `${baseMessage} because there are uncommitted changes`;
			case 'wouldOverwriteChanges':
				return `${baseMessage} because some local changes would be overwritten`;
			default:
				return baseMessage;
		}
	}
}

export type StashApplyErrorReason = 'uncommittedChanges' | 'other';
interface StashApplyErrorDetails {
	reason?: StashApplyErrorReason;
	gitCommand?: GitCommandContext;
}

export class StashApplyError extends GitCommandError<StashApplyErrorDetails> {
	static override is(ex: unknown, reason?: StashApplyErrorReason): ex is StashApplyError {
		return ex instanceof StashApplyError && (reason == null || ex.details.reason === reason);
	}

	constructor(details: StashApplyErrorDetails, original?: Error) {
		super('Unable to apply stash', details, original);
	}

	protected override buildErrorMessage(details: StashApplyErrorDetails): string {
		switch (details.reason) {
			case 'uncommittedChanges':
				return 'Unable to apply stash. Your working tree changes would be overwritten. Please commit or stash your changes before trying again';
			default:
				return 'Unable to apply stash';
		}
	}
}

export type StashPushErrorReason = 'conflictingStagedAndUnstagedLines' | 'nothingToSave' | 'other';
interface StashPushErrorDetails {
	reason?: StashPushErrorReason;
	gitCommand?: GitCommandContext;
}

export class StashPushError extends GitCommandError<StashPushErrorDetails> {
	static override is(ex: unknown, reason?: StashPushErrorReason): ex is StashPushError {
		return ex instanceof StashPushError && (reason == null || ex.details.reason === reason);
	}

	constructor(details: StashPushErrorDetails, original?: Error) {
		super('Unable to stash', details, original);
	}

	protected override buildErrorMessage(details: StashPushErrorDetails): string {
		switch (details.reason) {
			case 'conflictingStagedAndUnstagedLines':
				return 'Changes were stashed, but the working tree cannot be updated because at least one file has staged and unstaged changes on the same line(s)';
			case 'nothingToSave':
				return 'No files to stash';
			default:
				return 'Unable to stash';
		}
	}
}

export type TagErrorReason =
	| 'alreadyExists'
	| 'invalidName'
	| 'notFound'
	| 'permissionDenied'
	| 'remoteRejected'
	| 'other';
interface TagErrorDetails {
	reason?: TagErrorReason;
	action?: string;
	tag?: string;
	gitCommand?: GitCommandContext;
}

export class TagError extends GitCommandError<TagErrorDetails> {
	static override is(ex: unknown, reason?: TagErrorReason): ex is TagError {
		return ex instanceof TagError && (reason == null || ex.details.reason === reason);
	}

	constructor(details: TagErrorDetails, original?: Error) {
		super('Unable to perform action on tag', details, original);
	}

	protected override buildErrorMessage(details: TagErrorDetails): string {
		let baseMessage: string;
		if (details.action != null) {
			baseMessage = `Unable to ${details.action} tag ${details.tag ? `'${details.tag}'` : ''}`;
		} else {
			baseMessage = `Unable to perform action${details.tag ? ` with tag '${details.tag}'` : 'on tag'}`;
		}

		switch (details.reason) {
			case 'alreadyExists':
				return `${baseMessage} because it already exists`;
			case 'invalidName':
				return `${baseMessage} because the tag name is invalid`;
			case 'notFound':
				return `${baseMessage} because it does not exist`;
			case 'permissionDenied':
				return `${baseMessage} because you don't have permission to push to this remote repository.`;
			case 'remoteRejected':
				return `${baseMessage} because the remote repository rejected the push.`;
			default:
				return baseMessage;
		}
	}
}

export class WorkspaceUntrustedError extends Error {
	constructor() {
		super('Unable to perform Git operations because the current workspace is untrusted');

		Error.captureStackTrace?.(this, new.target);
	}
}

export type WorktreeCreateErrorReason = 'alreadyCheckedOut' | 'alreadyExists';
interface WorktreeCreateErrorDetails {
	reason?: WorktreeCreateErrorReason;
	gitCommand?: GitCommandContext;
}

export class WorktreeCreateError extends GitCommandError<WorktreeCreateErrorDetails> {
	static override is(ex: unknown, reason?: WorktreeCreateErrorReason): ex is WorktreeCreateError {
		return ex instanceof WorktreeCreateError && (reason == null || ex.details.reason === reason);
	}

	constructor(details: WorktreeCreateErrorDetails, original?: Error) {
		super('Unable to create worktree', details, original);
	}

	protected override buildErrorMessage(details: WorktreeCreateErrorDetails): string {
		switch (details.reason) {
			case 'alreadyCheckedOut':
				return 'Unable to create worktree because it is already checked out';
			case 'alreadyExists':
				return 'Unable to create worktree because it already exists';
			default:
				return 'Unable to create worktree';
		}
	}
}

export type WorktreeDeleteErrorReason = 'defaultWorkingTree' | 'directoryNotEmpty' | 'uncommittedChanges';
interface WorktreeDeleteErrorDetails {
	reason?: WorktreeDeleteErrorReason;
	gitCommand?: GitCommandContext;
}

export class WorktreeDeleteError extends GitCommandError<WorktreeDeleteErrorDetails> {
	static override is(ex: unknown, reason?: WorktreeDeleteErrorReason): ex is WorktreeDeleteError {
		return ex instanceof WorktreeDeleteError && (reason == null || ex.details.reason === reason);
	}

	constructor(details: WorktreeDeleteErrorDetails, original?: Error) {
		super('Unable to delete worktree', details, original);
	}

	protected override buildErrorMessage(details: WorktreeDeleteErrorDetails): string {
		switch (details.reason) {
			case 'defaultWorkingTree':
				return 'Cannot delete worktree because it is the default working tree';
			case 'directoryNotEmpty':
				return 'Unable to delete worktree because the directory is not empty';
			case 'uncommittedChanges':
				return 'Unable to delete worktree because there are uncommitted changes';
			default:
				return 'Unable to delete worktree';
		}
	}
}

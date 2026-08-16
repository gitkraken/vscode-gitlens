import type { SpawnOptions } from 'child_process';
import { spawn } from 'child_process';
import * as process from 'process';
import type {
	BranchErrorReason,
	CheckoutErrorReason,
	CherryPickErrorReason,
	CommitErrorReason,
	FetchErrorReason,
	GitCommandError,
	GitWarningKey,
	MergeErrorReason,
	PausedOperationAbortErrorReason,
	PausedOperationContinueErrorReason,
	PullErrorReason,
	PushErrorReason,
	RebaseErrorReason,
	ResetErrorReason,
	RevertErrorReason,
	ShowErrorReason,
	SigningErrorReason,
	StashApplyErrorReason,
	StashPushErrorReason,
	TagErrorReason,
	WorktreeCreateErrorReason,
	WorktreeDeleteErrorReason,
} from '@gitlens/git/errors.js';
import { GitWarnings, WorkspaceUntrustedError } from '@gitlens/git/errors.js';
import type { SigningFormat } from '@gitlens/git/models/signature.js';
import type { GitRunCancellation } from '@gitlens/git/run.types.js';
import { CancellationError, getAbortSignalId, isCancellationError } from '@gitlens/utils/cancellation.js';
import { getScopedCounter } from '@gitlens/utils/counter.js';
import { getDurationMilliseconds, hrtime } from '@gitlens/utils/hrtime.js';
import type { LogChannel } from '@gitlens/utils/logger.js';
import { Logger } from '@gitlens/utils/logger.js';
import { formatLoggableScopeBlock } from '@gitlens/utils/logger.scoped.js';
import { dirname, isAbsolute, joinPaths, normalizePath } from '@gitlens/utils/path.js';
import { defer } from '@gitlens/utils/promise.js';
import type { Mutable } from '@gitlens/utils/types.js';
import { compare, fromString } from '@gitlens/utils/version.js';
import { CancelledRunError, RunError } from './exec.errors.js';
import type { RunOptions, RunResult } from './exec.js';
import { fsExists, runSpawn } from './exec.js';
import type { GitCommandPriority, GitResult, GitRunOptions, GitSpawnOptions } from './exec.types.js';
import type { FilteredGitFeatures, GitFeatureOrPrefix, GitFeatures } from './features.js';
import { gitFeaturesByVersion } from './features.js';
import type { GitQueueConfig } from './gitQueue.js';
import { getPrimaryGitCommand, GitQueue, inferGitCommandPriority } from './gitQueue.js';
import type { GitLocation } from './locator.js';

const slowCallWarningThreshold = 2000;
export const maxGitCliLength = 30000;

export const gitConfigsBranch = ['-c', 'color.branch=false'] as const;
export const gitConfigsDiff = ['-c', 'color.diff=false', '-c', 'diff.mnemonicPrefix=false'] as const;
export const gitConfigsLog = ['-c', 'log.showSignature=false'] as const;
export const gitConfigsLogWithFiles = ['-c', 'log.showSignature=false', '-c', 'diff.renameLimit=0'] as const;
export const gitConfigsLogWithSignatures = ['-c', 'log.showSignature=true'] as const;
export const gitConfigsPull = ['-c', 'merge.autoStash=true', '-c', 'rebase.autoStash=true'] as const;
export const gitConfigsStatus = ['-c', 'color.status=false'] as const;

export const GitErrors = {
	alreadyCheckedOut: /already checked out/i,
	alreadyExists: /already exists/i,
	ambiguousArgument: /fatal:\s*ambiguous argument ['"].+['"]: unknown revision or path not in the working tree/i,
	badObject: /fatal:\s*bad object (.*?)/i,
	badRevision: /bad revision '(.*?)'/i,
	branchAlreadyExists: /fatal:\s*A branch named '.+?' already exists/i,
	notFullyMerged: /error:\s*The branch '.+?' is not fully merged/i,
	cantLockRef: /cannot lock ref|unable to update local ref/i,
	changesWouldBeOverwritten:
		/Your local changes to the following files would be overwritten|Your local changes would be overwritten|overwritten by checkout/i,
	cherryPickAborted: /cherry-pick.*aborted/i,
	cherryPickInProgress: /cherry-pick is already in progress|You have not concluded your cherry-pick/i,
	commitChangesFirst: /Please, commit your changes before you can/i,
	conflict: /^CONFLICT \([^)]+\): \b/m,
	detachedHead: /You are in 'detached HEAD' state/i,
	entryNotUpToDate: /error:\s*Entry ['"].+['"] not uptodate\. Cannot merge\./i,
	failedToDeleteDirectoryNotEmpty: /failed to delete '(.*?)': Directory not empty/i,
	gpgNotFound: /gpg:?\s*(?:command\s+)?not found|'gpg' is not recognized as|cannot run gpg:/i,
	gpgSignFailed: /^error:\s*gpg failed to sign the data/im,
	invalidName: /fatal:\s*'.+?' is not a valid branch name/i,
	invalidLineCount: /file .+? has only (\d+) lines/i,
	invalidObjectName: /invalid object name: (.*)\s/i,
	invalidObjectNameList: /could not open object name list: (.*)\s/i,
	invalidTagName: /invalid tag name/i,
	mainWorkingTree: /is a main working tree/i,
	mergeAborted: /merge.*aborted/i,
	mergeInProgress: /^fatal:\s*You have not concluded your merge/i,
	noFastForward: /\(non-fast-forward\)/i,
	noMergeBase: /no merge base/i,
	noRemoteReference: /unable to delete '.+?': remote ref does not exist/i,
	noRemoteRepositorySpecified: /No remote repository specified\./i,
	noUpstream: /^fatal:\s*The current branch .* has no upstream branch/i,
	notAValidObjectName: /Not a valid object name/i,
	notAWorkingTree: /'(.*?)' is not a working tree/i,
	noUserNameConfigured: /Please tell me who you are\./i,
	nothingToCommit: /nothing(?: added)? to commit|no changes added to commit/i,
	noPausedOperation:
		/no merge (?:in progress|to abort)|no cherry-pick(?: or revert)? in progress|no rebase in progress/i,
	permissionDenied: /Permission.*denied/i,
	previousOperationEmpty: /The previous (?:cherry-pick|revert) is now empty/i,
	problemWithEditor: /there was a problem with the editor/i,
	pushRejected: /^error:\s*failed to push some refs to\b/m,
	pushRejectedRefDoesNotExists: /error:\s*unable to delete '(.*?)': remote ref does not exist/m,
	rebaseAborted: /Nothing to do|rebase.*aborted/i,
	rebaseInProgress: /It seems that there is already a rebase-(?:merge|apply) directory/i,
	rebaseMissingTodo: /error:\s*could not read file .*\/git-rebase-todo': No such file or directory/,
	rebaseMultipleBranches: /cannot rebase onto multiple branches/i,
	revertAborted: /revert.*aborted/i,
	revertInProgress: /^(error: )?(revert|cherry-pick) is already in progress/i,
	refLocked: /fatal:\s*cannot lock ref ['"].+['"]: unable to create file/i,
	remoteAhead: /rejected because the remote contains work/i,
	remoteConnectionFailed: /Could not read from remote repository/i,
	remoteRejected: /rejected because the remote contains work/i,
	signingKeyNotAvailable: /secret key not available|no secret key|no signing key/i,
	sshNotFound: /ssh-keygen[^\n]*(?:not found|No such file or directory|is not recognized)/i,
	stashConflictingStagedAndUnstagedLines: /Cannot remove worktree changes/i,
	stashNothingToSave: /No local changes to save/i,
	stashSavedWorkingDirAndIndexState: /Saved working directory and index state/i,
	tagAlreadyExists: /tag .* already exists/i,
	tagConflict: /! \[rejected\].*\(would clobber existing tag\)/m,
	tagNotFound: /tag .* not found/i,
	uncommittedChanges: /contains modified or untracked files/i,
	unmergedChanges: /error:\s*you need to resolve your current index first/i,
	unmergedFiles: /is not possible because you have unmerged files|You have unmerged files/i,
	unresolvedConflicts:
		/You must edit all merge conflicts|Resolve all conflicts|^CONFLICT \(|^Automatic merge failed|could not apply .*/im,
	unsafeRepository:
		/(?:^fatal:\s*detected dubious ownership in repository at '([^']+)'|unsafe repository \('([^']+)' is owned by someone else\))[\s\S]*(git config --global --add safe\.directory [^\n•]+)/m,
	unstagedChanges: /You have unstaged changes/i,
	// Matches both variants: with a lock reason (`..., lock reason: <reason>`) and without (`...;`)
	worktreeLocked: /fatal:\s*cannot remove a locked working tree/i,
	// Only matches the variant where Git reports a lock reason; the reason is free text, so capture the whole line
	worktreeLockedReason: /cannot remove a locked working tree,[ \t]*lock reason:[ \t]*(.*)/i,
} as const;

// `GitWarnings` moved to `@gitlens/git/errors.js` so the shared run contract can name its keys; re-exported
// here because it's long-established as part of this module's surface.
export { GitWarnings };
export type { GitWarningKey } from '@gitlens/git/errors.js';

export class GitError extends Error {
	readonly cmd: string | undefined;
	readonly exitCode: number | string | undefined;
	readonly stdout: string | undefined;
	readonly stderr: string | undefined;

	constructor(readonly original: Error) {
		let message: string;
		let stdout: string | undefined;
		let stderr: string | undefined;
		let cmd: string | undefined;
		let exitCode: number | string | undefined;

		if (original instanceof RunError) {
			stdout = original.stdout;
			stderr = original.stderr;
			message = stderr || stdout || original.message;
			cmd = original.cmd;
			exitCode = original.code;
		} else {
			message = original.message;
		}

		super(message);

		this.stdout = stdout;
		this.stderr = stderr;
		this.cmd = cmd;
		this.exitCode = exitCode;

		Error.captureStackTrace?.(this, new.target);
	}
}

export type PushForceOptions = { withLease: true; ifIncludes?: boolean } | { withLease: false; ifIncludes?: never };

type GitCommand =
	| 'branch'
	| 'checkout'
	| 'cherry-pick'
	| 'commit'
	| 'fetch'
	| 'merge'
	| 'paused-operation-abort'
	| 'paused-operation-continue'
	| 'pull'
	| 'push'
	| 'rebase'
	| 'reset'
	| 'revert'
	| 'show'
	| 'stash-apply'
	| 'stash-push'
	| 'tag'
	| 'worktree-create'
	| 'worktree-delete';

type GitCommandToReasonMap = {
	branch: BranchErrorReason;
	checkout: CheckoutErrorReason;
	'cherry-pick': CherryPickErrorReason;
	commit: CommitErrorReason;
	fetch: FetchErrorReason;
	merge: MergeErrorReason;
	'paused-operation-abort': PausedOperationAbortErrorReason;
	'paused-operation-continue': PausedOperationContinueErrorReason;
	pull: PullErrorReason;
	push: PushErrorReason;
	rebase: RebaseErrorReason;
	reset: ResetErrorReason;
	revert: RevertErrorReason;
	show: ShowErrorReason;
	'stash-apply': StashApplyErrorReason;
	'stash-push': StashPushErrorReason;
	tag: TagErrorReason;
	'worktree-create': WorktreeCreateErrorReason;
	'worktree-delete': WorktreeDeleteErrorReason;
};

const errorToReasonMap = new Map<GitCommand, [RegExp, GitCommandToReasonMap[GitCommand]][]>([
	[
		'branch',
		[
			[GitErrors.branchAlreadyExists, 'alreadyExists'],
			[GitErrors.invalidName, 'invalidName'],
			[GitErrors.notFullyMerged, 'notFullyMerged'],
			[GitErrors.noRemoteReference, 'noRemoteReference'],
		],
	],
	[
		'checkout',
		[
			[GitErrors.changesWouldBeOverwritten, 'wouldOverwriteChanges'],
			[GitErrors.ambiguousArgument, 'pathspecNotFound'],
			[GitErrors.notAValidObjectName, 'invalidRef'],
		],
	],
	[
		'cherry-pick',
		[
			[GitErrors.cherryPickAborted, 'aborted'],
			[GitErrors.cherryPickInProgress, 'alreadyInProgress'],
			[GitErrors.conflict, 'conflicts'],
			[GitErrors.previousOperationEmpty, 'emptyCommit'],
			[GitErrors.changesWouldBeOverwritten, 'wouldOverwriteChanges'],
		],
	],
	[
		'commit',
		[
			[GitErrors.nothingToCommit, 'nothingToCommit'],
			[GitErrors.unmergedFiles, 'conflicts'],
			[GitErrors.unresolvedConflicts, 'conflicts'],
			[GitErrors.noUserNameConfigured, 'noUserNameConfigured'],
		],
	],
	[
		'fetch',
		[
			[GitErrors.noFastForward, 'noFastForward'],
			[GitErrors.noRemoteRepositorySpecified, 'noRemote'],
			[GitErrors.remoteConnectionFailed, 'remoteConnectionFailed'],
		],
	],
	[
		'merge',
		[
			[GitErrors.mergeAborted, 'aborted'],
			[GitErrors.mergeInProgress, 'alreadyInProgress'],
			[GitErrors.unresolvedConflicts, 'conflicts'],
			[GitErrors.uncommittedChanges, 'uncommittedChanges'],
			[GitErrors.changesWouldBeOverwritten, 'wouldOverwriteChanges'],
		],
	],
	['paused-operation-abort', [[GitErrors.noPausedOperation, 'nothingToAbort']]],
	[
		'paused-operation-continue',
		[
			// Kept FIRST: an editor failure's stderr can also carry broader messages ("could not
			// commit staged changes", …) that later patterns would otherwise claim
			[GitErrors.problemWithEditor, 'messageEditFailed'],
			[GitErrors.previousOperationEmpty, 'emptyCommit'],
			[GitErrors.noPausedOperation, 'nothingToContinue'],
			[GitErrors.uncommittedChanges, 'uncommittedChanges'],
			[GitErrors.unmergedFiles, 'unmergedFiles'],
			[GitErrors.unresolvedConflicts, 'conflicts'],
			[GitErrors.unstagedChanges, 'unstagedChanges'],
			[GitErrors.changesWouldBeOverwritten, 'wouldOverwriteChanges'],
			// A single (non-sequencer) revert resolved to a no-op never gets git's "previous revert is now
			// empty" message — its `--continue` falls through to the commit, which reports having nothing to
			// commit. Mid-paused-op that means the step became empty, so it earns the same choice.
			//
			// Kept LAST because the pattern is deliberately broad: it also matches "no changes added to
			// commit" and "nothing added to commit", which appear alongside the more specific unmerged /
			// conflict / unstaged messages. Matching first would shadow those. It isn't narrowed to the
			// "working tree clean" variant because an empty step with untracked files present instead reports
			// "nothing added to commit but untracked files present".
			[GitErrors.nothingToCommit, 'emptyCommit'],
		],
	],
	[
		'pull',
		[
			[GitErrors.conflict, 'conflict'],
			[GitErrors.noUserNameConfigured, 'gitIdentity'],
			[GitErrors.remoteConnectionFailed, 'remoteConnectionFailed'],
			[GitErrors.unstagedChanges, 'unstagedChanges'],
			[GitErrors.unmergedFiles, 'unmergedFiles'],
			[GitErrors.commitChangesFirst, 'uncommittedChanges'],
			[GitErrors.changesWouldBeOverwritten, 'wouldOverwriteChanges'],
			[GitErrors.cantLockRef, 'refLocked'],
			[GitErrors.rebaseMultipleBranches, 'rebaseMultipleBranches'],
			[GitErrors.tagConflict, 'tagConflict'],
		],
	],
	[
		'push',
		[
			[GitErrors.remoteAhead, 'remoteAhead'],
			[GitWarnings.tipBehind, 'tipBehind'],
			[GitErrors.pushRejected, 'rejected'],
			[GitErrors.pushRejectedRefDoesNotExists, 'rejectedRefDoesNotExist'],
			[GitErrors.permissionDenied, 'permissionDenied'],
			[GitErrors.remoteConnectionFailed, 'remoteConnectionFailed'],
			[GitErrors.noUpstream, 'noUpstream'],
		],
	],
	[
		'rebase',
		[
			[GitErrors.rebaseAborted, 'aborted'],
			[GitErrors.rebaseMissingTodo, 'aborted'],
			[GitErrors.rebaseInProgress, 'alreadyInProgress'],
			[GitErrors.unresolvedConflicts, 'conflicts'],
			[GitErrors.uncommittedChanges, 'uncommittedChanges'],
			[GitErrors.changesWouldBeOverwritten, 'wouldOverwriteChanges'],
		],
	],
	[
		'reset',
		[
			[GitErrors.ambiguousArgument, 'ambiguousArgument'],
			[GitErrors.detachedHead, 'detachedHead'],
			[GitErrors.refLocked, 'refLocked'],
			[GitErrors.entryNotUpToDate, 'notUpToDate'],
			[GitErrors.permissionDenied, 'permissionDenied'],
			[GitErrors.unmergedChanges, 'unmergedChanges'],
			[GitErrors.changesWouldBeOverwritten, 'wouldOverwriteChanges'],
		],
	],
	[
		'revert',
		[
			[GitErrors.revertAborted, 'aborted'],
			[GitErrors.revertInProgress, 'alreadyInProgress'],
			[GitErrors.unresolvedConflicts, 'conflicts'],
			[GitErrors.uncommittedChanges, 'uncommittedChanges'],
			[GitErrors.changesWouldBeOverwritten, 'wouldOverwriteChanges'],
		],
	],
	[
		'show',
		[
			[GitErrors.badObject, 'invalidObject'],
			[GitErrors.badRevision, 'invalidRevision'],
			[GitErrors.notAValidObjectName, 'invalidRevision'],
			[GitWarnings.notFound, 'notFound'],
			[GitWarnings.foundButNotInRevision, 'notInRevision'],
		],
	],
	['stash-apply', [[GitErrors.changesWouldBeOverwritten, 'uncommittedChanges']]],
	[
		'stash-push',
		[
			[GitErrors.stashConflictingStagedAndUnstagedLines, 'conflictingStagedAndUnstagedLines'],
			[GitErrors.stashNothingToSave, 'nothingToSave'],
			[GitErrors.stashSavedWorkingDirAndIndexState, 'conflictingStagedAndUnstagedLines'],
		],
	],
	[
		'tag',
		[
			[GitErrors.tagAlreadyExists, 'alreadyExists'],
			[GitErrors.invalidTagName, 'invalidName'],
			[GitErrors.tagNotFound, 'notFound'],
			[GitErrors.permissionDenied, 'permissionDenied'],
			[GitErrors.remoteRejected, 'remoteRejected'],
			[GitErrors.tagConflict, 'tagConflict'],
		],
	],
	[
		'worktree-create',
		[
			[GitErrors.alreadyCheckedOut, 'alreadyCheckedOut'],
			[GitErrors.alreadyExists, 'alreadyExists'],
		],
	],
	[
		'worktree-delete',
		[
			// Must come first -- a locked worktree's lock reason is free text that can otherwise match the errors below
			[GitErrors.worktreeLocked, 'locked'],
			[GitErrors.mainWorkingTree, 'defaultWorkingTree'],
			[GitErrors.uncommittedChanges, 'uncommittedChanges'],
			[GitErrors.failedToDeleteDirectoryNotEmpty, 'directoryNotEmpty'],
		],
	],
]);

export function getGitCommandError<T extends GitCommand, TReturn extends GitCommandError<any>>(
	command: T,
	ex: GitError,
	creator: (reason: GitCommandToReasonMap[T] | undefined) => TReturn,
): TReturn {
	const msg: string = ex?.toString() ?? '';

	const errorsToReasons = errorToReasonMap.get(command) as [RegExp, GitCommandToReasonMap[T]][] | undefined;
	if (errorsToReasons != null) {
		for (const [error, reason] of errorsToReasons) {
			if (error.test(msg) || (ex.stderr && error.test(ex.stderr)) || (ex.stdout && error.test(ex.stdout))) {
				return creator(reason);
			}
		}
	}

	return creator(undefined);
}

function extractSigningErrorText(ex: unknown): string {
	if (ex == null) return '';
	if (ex instanceof GitError) return ex.stderr || ex.stdout || ex.message || '';
	if (ex instanceof Error) return ex.message || '';
	if (typeof ex === 'string') return ex;
	if (typeof ex === 'number' || typeof ex === 'boolean' || typeof ex === 'bigint') return String(ex);
	if (typeof ex === 'object' && 'message' in ex && typeof ex.message === 'string') return ex.message;
	return '';
}

/**
 * Classifies a Git error as a signing-related failure using the {@link GitErrors}
 * signing regexes. Returns the matched {@link SigningErrorReason}, or `undefined`
 * when the error is not a recognized signing failure.
 *
 * Precedence is significant: `passphraseFailed` (gpg sign failure) is checked
 * before `noKey`, matching the ordering used historically in patch.ts — a
 * combined stderr like "error: gpg failed to sign … gpg: No secret key"
 * resolves to `passphraseFailed`, the outer cause.
 */
export function classifySigningError(ex: unknown): SigningErrorReason | undefined {
	const text = extractSigningErrorText(ex);
	if (!text) return undefined;
	if (GitErrors.gpgSignFailed.test(text)) return 'passphraseFailed';
	if (GitErrors.signingKeyNotAvailable.test(text)) return 'noKey';
	if (GitErrors.gpgNotFound.test(text)) return 'gpgNotFound';
	if (GitErrors.sshNotFound.test(text)) return 'sshNotFound';
	return undefined;
}

/**
 * Infers the {@link SigningFormat} from stderr hints (e.g., mentions of
 * `ssh-keygen` or `gpg.ssh.*` config keys). Returns `undefined` when no hints
 * are present so callers can supply their own default (typically `'gpg'`).
 *
 * Used as a fallback when `config.getSigningConfig` is unavailable or rejects
 * on the error path.
 */
export function inferSigningFormatFromError(ex: unknown): SigningFormat | undefined {
	const text = extractSigningErrorText(ex);
	if (!text) return undefined;
	if (/\bssh-keygen\b|gpg\.ssh\.(?:program|allowedsignersfile)/i.test(text)) return 'ssh';
	if (/\bgpg\b/i.test(text)) return 'gpg';
	return undefined;
}

export interface GitOptions {
	/** Custom environment variables to add to every git command */
	env?: Record<string, string | undefined>;
	/** Dynamic environment provider called for each command (e.g., host-discovered SCM credentials) */
	getEnvironment?: () => Record<string, string | undefined> | undefined;
	/** Git command timeout in milliseconds. Defaults to 60000. Set to 0 to disable. */
	gitTimeout?: number;
	/** Returns whether the workspace is currently trusted. Defaults to true when not provided. Called on every exec/stream. */
	isTrusted?: () => boolean;
	/** Queue configuration (max concurrent processes, etc.) */
	queue?: GitQueueConfig;
	/** Decodes non-UTF-8 git output. Required when repositories use non-UTF-8 encodings. */
	decode?: (data: Uint8Array, options?: { readonly encoding: string }) => string | Promise<string>;
	/** Hooks for observing git execution events */
	hooks?: GitHooks;
	/** Optional dedicated logger for git command logging */
	logger?: LogChannel;
}

export interface GitHooks {
	/** Called when a git command is aborted (timeout or cancellation) */
	onAborted?(info: {
		operation: string;
		reason: 'timeout' | 'cancellation' | 'unknown';
		duration: number;
		timeout: number;
	}): void;
	/** Called when a queued command waited longer than 1s before executing */
	onSlowQueue?(info: {
		priority: GitCommandPriority;
		waitTime: number;
		active: number;
		queued: Record<GitCommandPriority, number>;
		maxConcurrent: number;
	}): void;
	/**
	 * Called once per git command that ran slowly (over the slow-call threshold). Fired only for the
	 * command that actually executed, never for a deduplicated rider that merely awaited it, so a single
	 * slow subprocess counts once. `operation` is the primary git subcommand (e.g. `status`, `rev-list`).
	 */
	onSlowCommand?(info: { operation: string | undefined; cwd: string | undefined; duration: number }): void;
}

const emptyArray: readonly never[] = Object.freeze([]);
const emptyObj = Object.freeze({});
const trailingNewlineRegex = /[\r|\n]+$/;
const uniqueCounterForStdin = getScopedCounter();
const uniqueCounterForStream = getScopedCounter();

type ExitCodeOnlyGitCommandOptions = GitRunOptions & { exitCodeOnly: true };

export class Git {
	/** Map of running git commands — avoids running duplicate overlapping commands */
	private readonly pendingCommands = new Map<string, Promise<RunResult<string | Buffer>>>();
	/** Queue for throttling background git operations */
	private readonly _queue: GitQueue;

	/** Cached base environment: process.env + static options.env + GCM/LC_ALL vars */
	private _baseEnv: Record<string, string | undefined> | undefined;
	/** Cached full environment: base + dynamic getEnvironment() result */
	private _fullEnv: Record<string, string | undefined> | undefined;
	/** Last dynamic env reference, used to detect when getEnvironment() returns a new object */
	private _lastDynamicEnv: Record<string, string | undefined> | undefined | null;

	constructor(
		private readonly _locator: () => Promise<GitLocation>,
		readonly options: GitOptions = {},
	) {
		this._queue = new GitQueue(options.queue, { onSlowQueue: options.hooks?.onSlowQueue });
	}

	/**
	 * Returns the base environment for git commands. Cached to avoid spreading
	 * process.env (30-100+ keys) on every call. Includes static options.env and
	 * GCM/LC_ALL vars but NOT dynamic getEnvironment() or per-call env overrides.
	 */
	private getBaseEnv(): Record<string, string | undefined> {
		return (this._baseEnv ??= {
			...process.env,
			...(this.options.env ?? emptyObj),
			GCM_INTERACTIVE: 'NEVER',
			GCM_PRESERVE_CREDS: 'TRUE',
			LC_ALL: 'C',
		});
	}

	/**
	 * Returns the full environment (base + dynamic). Cached and invalidated
	 * when getEnvironment() returns a different object reference.
	 */
	private getFullEnv(): Record<string, string | undefined> {
		const dynamicEnv = this.options.getEnvironment?.() ?? undefined;
		if (this._fullEnv != null && dynamicEnv === this._lastDynamicEnv) return this._fullEnv;

		this._lastDynamicEnv = dynamicEnv;
		this._fullEnv = dynamicEnv != null ? { ...this.getBaseEnv(), ...dynamicEnv } : this.getBaseEnv();
		return this._fullEnv;
	}

	/**
	 * Builds the environment for a git command. Returns the cached full env
	 * directly when there are no per-call overrides (the common case).
	 * Only allocates a new object when per-call env overrides are provided.
	 */
	private buildEnv(perCallEnv: Record<string, string | undefined> | undefined): Record<string, string | undefined> {
		if (perCallEnv == null) return this.getFullEnv();

		return { ...this.getFullEnv(), ...perCallEnv };
	}

	dispose(): void {
		this._queue.dispose();
	}

	/** Clear pending commands (e.g. on cache reset) */
	clearPendingCommands(): void {
		this.pendingCommands.clear();
	}

	private _gitLocation: GitLocation | undefined;
	private _gitLocationPromise: Promise<GitLocation> | undefined;

	private async getLocation(): Promise<GitLocation> {
		if (this._gitLocation == null) {
			this._gitLocationPromise ??= this._locator();
			this._gitLocation = await this._gitLocationPromise;
		}
		return this._gitLocation;
	}

	async path(): Promise<string> {
		return (await this.getLocation()).path;
	}

	async version(): Promise<string> {
		return (await this.getLocation()).version;
	}

	supports(feature: GitFeatures): boolean | Promise<boolean> {
		const version = gitFeaturesByVersion.get(feature);
		if (version == null) return true;

		return this._gitLocation != null
			? compare(fromString(this._gitLocation.version), fromString(version)) !== -1
			: this.version().then(v => compare(fromString(v), fromString(version)) !== -1);
	}

	supported<T extends GitFeatureOrPrefix>(feature: T): FilteredGitFeatures<T>[] | Promise<FilteredGitFeatures<T>[]> {
		function supportedCore(gitVersion: string): FilteredGitFeatures<T>[] {
			return [...gitFeaturesByVersion]
				.filter(([f, v]) => f.startsWith(feature) && compare(fromString(gitVersion), v) !== -1)
				.map(([f]) => f as FilteredGitFeatures<T>);
		}

		if (this._gitLocation == null) {
			return this.version().then(v => supportedCore(v));
		}
		return supportedCore(this._gitLocation.version);
	}

	async ensureSupports(feature: GitFeatures, prefix: string, suffix: string): Promise<void> {
		const version = gitFeaturesByVersion.get(feature);
		if (version == null) return;

		const gitVersion = await this.version();
		if (compare(fromString(gitVersion), fromString(version)) !== -1) return;

		throw new Error(
			`${prefix} requires a newer version of Git (>= ${version}) than is currently installed (${gitVersion}).${suffix}`,
		);
	}

	async run(
		options: ExitCodeOnlyGitCommandOptions,
		...args: readonly (string | undefined)[]
	): Promise<GitResult<unknown>>;
	async run<T extends string | Buffer = string>(
		options: GitRunOptions,
		...args: readonly (string | undefined)[]
	): Promise<GitResult<T>>;
	async run<T extends string | Buffer = string>(
		options: GitRunOptions,
		...args: readonly (string | undefined)[]
	): Promise<GitResult<T | unknown>> {
		if (this.options.isTrusted?.() === false) throw new WorkspaceUntrustedError();

		const runArgs = args.filter(a => a != null);
		const gitCommand = `git ${runArgs.join(' ')}`;

		// If cache is provided, use it to cache the full result
		if (options.caching != null) {
			return options.caching.cache.getOrCreate(
				options.caching.commonPath ?? options.cwd!,
				gitCommand,
				async (cacheable, signal) => {
					// Bind the shared spawn to the aggregate `signal` (fires only when ALL current callers
					// abort), not this-caller's `options.cancellation` — otherwise a superseded caller's
					// abort would kill the shared command and reject concurrent riders that never cancelled.
					const result = await this.runCore<T>(
						{ ...options, caching: undefined, cancellation: signal ?? options.cancellation },
						runArgs,
						gitCommand,
					);
					// Never cache a result that isn't a genuine command outcome. Under `errors: 'ignore'` a
					// cancelled/aborted run RESOLVES an empty result, which — left cached — would be served as a
					// real empty result for the full TTL (e.g. a valid merge-base read back as "none").
					// Invalidate on anything that isn't a clean exit, or whenever the aggregate signal aborted,
					// so the entry self-evicts instead of poisoning later callers.
					//
					// `status !== 'exited'` is what catches the case a bare `exitCode` check cannot. A swallowed
					// `GitWarnings` match used to report `exitCode: 0` UNCONDITIONALLY — the old code read it off
					// a `result` that is only ever assigned on the non-throwing path, so it was always the `?? 0`
					// fallback — which meant `exitCode !== 0` could never fire and every swallowed failure was
					// cached. A `warned` result now carries git's real code, so it's the status, not the code,
					// that has to do the work here. The `exitCode !== 0` half is kept as-is — a non-zero exit is
					// a real answer and arguably cacheable, but it isn't cached today and this isn't the change
					// to start.
					if (result.completion.status !== 'exited' || result.exitCode !== 0 || signal?.aborted) {
						cacheable.invalidate();
					}
					return result;
				},
				// Forward this caller's cancellation so `getOrCreate` races each caller's own wait — an
				// aborting caller rejects only itself, leaving the shared work (and its riders) intact.
				{ ...options.caching.options, cancellation: options.cancellation },
			);
		}

		return this.runCore<T>(options, runArgs, gitCommand);
	}

	private async runCore<T extends string | Buffer>(
		options: GitRunOptions,
		args: string[],
		gitCommand: string,
	): Promise<GitResult<T | unknown>> {
		const start = hrtime();

		gitCommand = `[${options.cwd}] ${gitCommand}`;
		const {
			cancellation,
			configs,
			correlationKey,
			errors: errorHandling,
			encoding,
			runLocally: _,
			selfMaintenance,
			...opts
		} = options;

		const defaultTimeout = this.options.gitTimeout ?? 60000;
		const runOpts: Mutable<RunOptions> = {
			...opts,
			timeout: opts.timeout === 0 || defaultTimeout === 0 ? undefined : (opts.timeout ?? defaultTimeout),
			encoding: (encoding ?? 'utf8') === 'utf8' ? 'utf8' : 'buffer',
			decode: this.options.decode,
			env: this.buildEnv(options.env),
			quiet: errorHandling === 'ignore',
		};

		const cacheKey = `${correlationKey !== undefined ? `${correlationKey}:` : ''}${
			options?.stdin != null ? `${uniqueCounterForStdin.next()}:` : ''
		}${cancellation != null ? `${getAbortSignalId(cancellation)}:` : ''}${gitCommand}`;

		// When the subprocess actually started — `start` includes GitQueue wait, which is congestion rather
		// than anything the repository did. Stays undefined for a dedup rider or a command aborted while queued.
		let execStart: ReturnType<typeof hrtime> | undefined;
		let waiting;
		let promise = this.pendingCommands.get(cacheKey);
		if (promise == null) {
			waiting = false;

			// Create a deferred promise and store it immediately to prevent duplicate commands
			// Note: cancellation tokens are not part of the dedup key — calls with different AbortSignals will not be deduplicated
			const deferred = defer<RunResult<string | Buffer>>();
			promise = deferred.promise;
			this.pendingCommands.set(cacheKey, promise);

			// Fixes https://github.com/gitkraken/vscode-gitlens/issues/73 & https://github.com/gitkraken/vscode-gitlens/issues/161
			// See https://stackoverflow.com/questions/4144417/how-to-handle-asian-characters-in-file-names-in-git-on-os-x
			args.unshift('-c', 'core.quotepath=false', '-c', 'color.ui=false', ...(configs ?? emptyArray));

			if (process.platform === 'win32') {
				args.unshift('-c', 'core.longpaths=true');
			}

			if (cancellation != null) {
				runOpts.cancellation = cancellation;
			}

			// Determine command priority:
			// Priority resolution:
			// 1. Explicit priority from options (highest precedence)
			// 2. Inferred from command type (only downgrades expensive commands to Background)
			const priority = options.priority ?? inferGitCommandPriority(args);

			// Execute through the queue (interactive/normal run immediately, background is throttled)
			const gitPath = await this.path();
			void this._queue
				.run(
					priority,
					() => {
						execStart = hrtime();
						return runSpawn<T>(gitPath, args, encoding ?? 'utf8', runOpts);
					},
					cancellation,
				)
				.then(deferred.fulfill, (e: unknown) => deferred.cancel(e instanceof Error ? e : new Error(String(e))))
				.finally(() => {
					this.pendingCommands.delete(cacheKey);
				})
				.catch(() => {});
		} else {
			waiting = true;
			Logger.trace(`${formatLoggableScopeBlock('GIT')} ${gitCommand} \u00b7 awaiting existing call...`);
		}

		let exception: Error | undefined;
		let result;
		try {
			result = await promise;
			// A normal `runSpawn` only resolves on a clean exit — `code !== 0 || signal` rejects — but the
			// `exitCodeOnly` overload resolves unconditionally, INCLUDING for a signalled run (no code, partial
			// or absent stdout). Coercing that to `0` would report a killed command as a clean success, so
			// classify it as the failure it is.
			if (result.exitCode == null) {
				// SIGTERM is how BOTH a timeout kill and a caller abort terminate, so it has to group with
				// cancellations here exactly as it does on the reject path — `failed`/`signal` is for every
				// OTHER signal. Only `exitCodeOnly` reaches this: a native spawn `timeout` fires
				// `close(null, 'SIGTERM')` with no `error` event, so it resolves instead of rejecting.
				// Throwing hands it to the catch below, which owns the timeout-vs-abort heuristic, the ABORTED
				// log, and the `onAborted` hook — none of which a branch here would fire.
				if (result.signal === 'SIGTERM') {
					throw new CancelledRunError(gitCommand, true, undefined, result.signal);
				}

				return {
					stdout: result.stdout,
					stderr: result.stderr,
					completion: {
						status: 'failed',
						reason: result.signal != null ? 'signal' : 'unstarted',
						error: new Error(
							`Command terminated without an exit code${result.signal != null ? ` (${result.signal})` : ''}`,
						),
					},
				};
			}

			return {
				stdout: result.stdout,
				stderr: result.stderr,
				exitCode: result.exitCode,
				completion: { status: 'exited', code: result.exitCode },
			};
		} catch (ex) {
			let cancellationReason: GitRunCancellation = 'unknown';
			if (ex instanceof CancelledRunError) {
				const duration = getDurationMilliseconds(start);
				const timeout = runOpts.timeout ?? 0;
				const reason =
					timeout > 0 && duration >= timeout - 100
						? 'timeout'
						: cancellation?.aborted
							? 'cancellation'
							: 'unknown';
				// Also surfaced on the result, but DIAGNOSTIC ONLY — a timeout kill and a caller abort are both
				// SIGTERM, so this duration heuristic can be wrong near the boundary. Never gate behavior on it.
				cancellationReason = reason === 'cancellation' ? 'aborted' : reason;
				Logger.warn(
					`${formatLoggableScopeBlock('GIT')} ${gitCommand} \u00b7 ABORTED after ${duration}ms (${reason})`,
				);
				this.options.hooks?.onAborted?.({
					operation: gitCommand,
					reason: reason,
					duration: duration,
					timeout: timeout,
				});
			}

			if (errorHandling === 'ignore') {
				if (ex instanceof RunError) {
					// `code` is `string | number | undefined`: a numeric string is a real exit code, but an errno
					// (`'ENOENT'`) means the spawn itself failed, and `undefined` means the process never exited
					// normally. Only the numeric case is an exit; the rest previously became `0` or `NaN`.
					const code = typeof ex.code === 'number' ? ex.code : ex.code != null ? parseInt(ex.code, 10) : NaN;
					const exited = Number.isInteger(code);

					return {
						stdout: ex.stdout,
						stderr: ex.stderr,
						...(exited ? { exitCode: code } : {}),
						completion:
							ex instanceof CancelledRunError
								? { status: 'cancelled', reason: cancellationReason, error: ex }
								: exited
									? { status: 'exited', code: code }
									: {
											status: 'failed',
											// A signal means it ran and was killed (partial `stdout` may exist);
											// no signal and no numeric code means it never got that far.
											reason: ex.signal != null ? 'signal' : 'unstarted',
											error: ex,
										},
					};
				}

				// No cancellation branch here: `CancelledRunError extends RunError`, so reaching this at all
				// proves `ex` is neither.
				return {
					stdout: '',
					stderr: undefined,
					completion: {
						status: 'failed',
						// No `RunError` means no process was ever spawned — a queue rejection or a
						// failure before `spawn` returned. (Not an untrusted workspace: `run` refuses
						// those up front, so they never reach this catch.)
						reason: 'unstarted',
						error: ex instanceof Error ? ex : new Error(String(ex)),
					},
				};
			}

			if (ex instanceof CancelledRunError) {
				exception = new CancellationError(ex);
			} else {
				exception = new GitError(ex);
			}
			if (errorHandling === 'throw') throw exception;

			// Rethrows unless the message matches a `GitWarnings` pattern, in which case it logs and returns the
			// key that matched. Capture the error first — `exception` is cleared to keep it out of the `finally`
			// log, but the result still needs to carry it.
			const swallowed = exception;
			const warning = defaultExceptionHandler(exception, options.cwd, start);
			exception = undefined;
			// The command did NOT produce this empty stdout — a warning was swallowed. Say so, or the caller
			// can't tell a genuinely empty answer (`noCommits`) from a read that never happened
			// (`notARepository`).
			//
			// The process DID exit though (a warning is only ever swallowed for a non-zero exit), so report the
			// code. `GitError.exitCode` is `number | string | undefined` — same normalization as the
			// `errors: 'ignore'` path above, since only the numeric case is a real exit.
			const rawCode = swallowed instanceof GitError ? swallowed.exitCode : undefined;
			const code = typeof rawCode === 'number' ? rawCode : rawCode != null ? parseInt(rawCode, 10) : NaN;

			// No `stderr`: it belongs to the error here. The top-level field is the channel for runs that
			// completed WITHOUT one (`exited` carries no error, so a successful command's stderr has nowhere
			// else to go) — a swallowed warning always has a `GitError`, and it carries the stderr. Reading
			// `result?.stderr` would be dead anyway: `result` is only assigned on the non-throwing path.
			return {
				stdout: '',
				...(Number.isInteger(code) ? { exitCode: code } : {}),
				completion: { status: 'warned', warning: warning, error: swallowed },
			};
		} finally {
			this.logGitCommandComplete(
				gitCommand,
				exception,
				getDurationMilliseconds(start),
				// 0 when the subprocess never started — there is no execution time to attribute. Also 0 for
				// GitLens's own maintenance work, which is slow by design and must not read as repo slowness.
				execStart == null || selfMaintenance ? 0 : getDurationMilliseconds(execStart),
				waiting,
				options.cwd,
				args,
			);
		}
	}

	async *stream(options: GitSpawnOptions, ...args: readonly (string | undefined)[]): AsyncGenerator<string> {
		if (this.options.isTrusted?.() === false) throw new WorkspaceUntrustedError();

		const start = hrtime();
		const streamId = uniqueCounterForStream.next();

		const { configs, stdin, stdinEncoding, cancellation, encoding, ...opts } = options;
		const runArgs = args.filter(a => a != null);

		const spawnOpts: SpawnOptions = {
			// Unless provided, ignore stdin and leave default streams for stdout and stderr
			stdio: [stdin ? 'pipe' : 'ignore', null, null],
			...opts,
			signal: cancellation,
			env: this.buildEnv(options.env),
		};

		const gitCommand = `(spawn) [${spawnOpts.cwd as string}] git ${runArgs.join(' ')}`;

		// Fixes https://github.com/gitkraken/vscode-gitlens/issues/73 & https://github.com/gitkraken/vscode-gitlens/issues/161
		// See https://stackoverflow.com/questions/4144417/how-to-handle-asian-characters-in-file-names-in-git-on-os-x
		runArgs.unshift('-c', 'core.quotepath=false', '-c', 'color.ui=false', ...(configs ?? emptyArray));

		if (process.platform === 'win32') {
			runArgs.unshift('-c', 'core.longpaths=true');
		}

		const command = await this.path();
		const proc = spawn(command, runArgs, spawnOpts);

		if (stdin) {
			proc.stdin?.end(stdin, (stdinEncoding ?? 'utf8') as BufferEncoding);
		}

		let exception: Error | undefined;

		const promise = new Promise<void>((resolve, reject) => {
			const stderrChunks: string[] = [];
			if (proc.stderr) {
				proc.stderr?.setEncoding('utf8');
				proc.stderr.on('data', chunk => stderrChunks.push(chunk));
			}

			proc.once('error', ex => {
				if (ex?.name === 'AbortError') return;

				exception = new GitError(ex);
			});
			proc.once('close', (code, signal) => {
				if (code === 0) {
					resolve();
					return;
				}

				if (signal === 'SIGTERM') {
					// If the caller aborted, just resolve
					if (cancellation?.aborted) {
						resolve();
					} else {
						reject(new CancelledRunError(proc.spawnargs.join(' '), true, code ?? undefined, signal));
					}
					return;
				}

				// If the caller didn't read the complete stream, just resolve
				if (
					signal === 'SIGPIPE' ||
					code === 141 /* SIGPIPE */ ||
					(code === 128 && stderrChunks.some(c => c.includes('Connection reset by peer')))
				) {
					resolve();
					return;
				}

				const stderr = stderrChunks.join('').trim();
				reject(
					new GitError(
						new RunError(
							{
								message: `Error (${code}): ${stderr || 'Unknown'}`,
								cmd: proc.spawnargs.join(' '),
								killed: proc.killed,
								code: proc.exitCode,
							},
							'',
							stderr,
						),
					),
				);
			});
		});

		let cleanedUp = false;
		const cleanup = () => {
			if (cleanedUp) return;

			cleanedUp = true;

			try {
				proc.removeAllListeners();
			} catch {}
			// Streaming spawns directly, with no GitQueue wait to exclude. It isn't pure subprocess time
			// either — the generator applies backpressure, so a slow consumer stalls the pipe and inflates
			// this — but there's no separate signal to measure here.
			const duration = getDurationMilliseconds(start);
			this.logGitCommandComplete(
				gitCommand,
				exception,
				duration,
				duration,
				false,
				spawnOpts.cwd as string | undefined,
				runArgs,
				streamId,
			);
		};

		try {
			this.logGitCommandStart(gitCommand, streamId);

			try {
				if (proc.stdout) {
					const enc = encoding ?? 'utf8';
					if (enc === 'utf8' || enc === 'binary' || enc === 'buffer') {
						proc.stdout.setEncoding(enc === 'buffer' ? 'utf8' : enc);
						for await (const chunk of proc.stdout) {
							yield chunk;
						}
					} else {
						// Non-UTF-8 encoding: collect raw buffers and decode at the end.
						// Streaming decode is unsafe because chunk boundaries can split
						// multi-byte sequences in the source encoding.
						const decode = this.options.decode;
						if (decode == null) {
							throw new Error(
								`Non-UTF-8 encoding '${enc}' requested for stream but no decode function configured`,
							);
						}

						const buffers: Buffer[] = [];
						for await (const chunk of proc.stdout) {
							buffers.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
						}
						yield await decode(Buffer.concat(buffers), { encoding: enc });
					}
				}
			} finally {
				// This await MUST be in this inner finally block to ensure the child process close event completes
				// before we call removeAllListeners() in the outer finally. When consumers break early from the
				// async generator (e.g., reading only the first chunk), the git process receives SIGPIPE and triggers
				// the close handler asynchronously. Without awaiting here, removeAllListeners() would execute before
				// the close handler finishes, causing a race condition and potential resource leaks.
				await promise;
			}
		} catch (ex) {
			exception = ex;
			throw ex;
		} finally {
			cleanup();
		}

		// Ensure cleanup happens immediately when the generator is explicitly closed (e.g., via break or return)
		// This is called by JavaScript when the generator is abandoned, ensuring logGitCommand is called
		// synchronously rather than waiting for garbage collection.
		// oxlint-disable-next-line typescript/no-meaningless-void-operator
		return void cleanup();
	}

	async rev_parse__git_dir(cwd: string): Promise<{ path: string; commonPath?: string } | undefined> {
		const result = await this.run({ cwd: cwd, errors: 'ignore' }, 'rev-parse', '--git-dir', '--git-common-dir');
		if (!result.stdout) return undefined;

		// Keep trailing spaces which are part of the directory name
		let [dotGitPath, commonDotGitPath] = result.stdout.split('\n').map(r => r.trimStart());

		// Make sure to normalize: https://github.com/git-for-windows/git/issues/2478

		if (!isAbsolute(dotGitPath)) {
			dotGitPath = joinPaths(cwd, dotGitPath);
		}
		dotGitPath = normalizePath(dotGitPath);

		if (commonDotGitPath) {
			if (!isAbsolute(commonDotGitPath)) {
				commonDotGitPath = joinPaths(cwd, commonDotGitPath);
			}
			commonDotGitPath = normalizePath(commonDotGitPath);

			return { path: dotGitPath, commonPath: commonDotGitPath !== dotGitPath ? commonDotGitPath : undefined };
		}

		return { path: dotGitPath };
	}

	async rev_parse__show_toplevel(cwd: string): Promise<[safe: true, repoPath: string] | [safe: false] | []> {
		let result;

		if (this.options.isTrusted?.() === false) {
			// Check if the folder is a bare clone: if it has a file named HEAD && `rev-parse --show-cdup` is empty
			if (await fsExists(joinPaths(cwd, 'HEAD'))) {
				try {
					result = await this.run(
						{ cwd: cwd, errors: 'throw', configs: ['-C', cwd] },
						'rev-parse',
						'--show-cdup',
					);
					if (!result.stdout.trim()) {
						Logger.warn(`Skipping (untrusted workspace); bare clone repository detected in '${cwd}'`);
						return emptyArray as [];
					}
				} catch {
					// If this throws, we should be good to open the repo (e.g. HEAD doesn't exist)
				}
			}
		}

		try {
			result = await this.run({ cwd: cwd, errors: 'throw' }, 'rev-parse', '--show-toplevel');
			// Make sure to normalize: https://github.com/git-for-windows/git/issues/2478
			// Keep trailing spaces which are part of the directory name
			return !result.stdout
				? (emptyArray as [])
				: [true, normalizePath(result.stdout.trimStart().replace(trailingNewlineRegex, ''))];
		} catch (ex) {
			if (ex instanceof WorkspaceUntrustedError) return emptyArray as [];
			if (!(ex instanceof GitError)) throw ex;

			const unsafeMatch = GitErrors.unsafeRepository.exec(ex.stderr ?? '');
			if (unsafeMatch != null) {
				Logger.warn(
					`Skipping; unsafe repository detected in '${unsafeMatch[1] || unsafeMatch[2]}'; run '${
						unsafeMatch[3]
					}' to allow it`,
				);
				return [false];
			}

			const inDotGit = GitWarnings.mustRunInWorkTree.test(ex.stderr ?? '');
			// Check if we are in a bare clone
			if (inDotGit && this.options.isTrusted?.() !== false) {
				result = await this.run({ cwd: cwd, errors: 'ignore' }, 'rev-parse', '--is-bare-repository');
				if (result.stdout.trim() === 'true') {
					const result = await this.rev_parse__git_dir(cwd);
					const repoPath = result?.commonPath ?? result?.path;
					if (repoPath?.length) return [true, repoPath];
				}
			}

			if (inDotGit || (ex.original as NodeJS.ErrnoException)?.code === 'ENOENT') {
				// If the `cwd` doesn't exist, walk backward to see if any parent folder exists
				let exists = inDotGit ? false : await fsExists(cwd);
				if (!exists) {
					do {
						const parent = dirname(cwd);
						if (parent === cwd || parent.length === 0) return emptyArray as [];

						cwd = parent;
						exists = await fsExists(cwd);
					} while (!exists);

					return this.rev_parse__show_toplevel(cwd);
				}
			}
			return emptyArray as [];
		}
	}

	private logGitCommandStart(command: string, id: number): void {
		Logger.info(`${formatLoggableScopeBlock(`GIT:\u2192${id}`)} ${command} \u00b7 starting...`);
		this.options.logger?.info(`${formatLoggableScopeBlock(`\u2192${id}`, '')} ${command} \u2022 starting...`);
	}

	private logGitCommandComplete(
		command: string,
		ex: Error | undefined,
		duration: number,
		/** Subprocess-only duration (excludes GitQueue wait); 0 when it never ran. */
		execDuration: number,
		waiting: boolean,
		cwd: string | undefined,
		args: readonly (string | undefined)[] | undefined,
		id?: number,
	): void {
		const slow = duration > slowCallWarningThreshold;
		const status = slow && waiting ? ' (slow, waiting)' : waiting ? ' (waiting)' : slow ? ' (slow)' : '';

		// The health signal is gated on the SUBPROCESS time, not the total: time spent queued behind other
		// git work is congestion, not repository slowness, and counting it would let a busy queue (including
		// our own background maintenance holding slots) manufacture the evidence that recommends more
		// maintenance. Logging keeps the total — the wait is exactly what you want to see when diagnosing.
		//
		// A deduplicated rider (`waiting`) shares the executed command's duration, so counting it too
		// would double-count a single slow subprocess — fire only for the command that actually ran.
		// Guarded: this runs inside the command's `finally`, so a hook throw would otherwise replace
		// the command's real result/error for the caller.
		if (execDuration > slowCallWarningThreshold && !waiting) {
			try {
				this.options.hooks?.onSlowCommand?.({
					operation: args != null ? getPrimaryGitCommand(args) : undefined,
					cwd: cwd,
					duration: execDuration,
				});
			} catch {}
		}

		if (ex != null) {
			Logger.error(
				undefined,
				`${formatLoggableScopeBlock(id ? `GIT:\u2190${id}` : 'GIT')} ${command} \u00b7 ${
					isCancellationError(ex)
						? 'cancelled'
						: (ex.message || String(ex) || '')
								.trim()
								.replace(/fatal:\s*/g, '')
								.replace(/\r?\n|\r/g, ' \u00b7 ')
				} [${duration}ms]${status}`,
			);
		} else if (slow) {
			Logger.warn(
				`${formatLoggableScopeBlock(id ? `GIT:\u2190${id}` : 'GIT', `*${duration}ms`)} ${command} [*${duration}ms]${status}`,
			);
		} else {
			Logger.info(
				`${formatLoggableScopeBlock(id ? `GIT:\u2190${id}` : 'GIT', `${duration}ms`)} ${command} [${duration}ms]${status}`,
			);
		}

		const logMessage = `${formatLoggableScopeBlock(
			`${id ? `\u2190${id}` : ''}${slow ? '*' : ''}`,
			`${duration}ms`,
		)} ${command}${status}`;
		if (ex != null) {
			this.options.logger?.error(`${logMessage} \u2022 FAILED\n${String(ex)}`);
		} else {
			this.options.logger?.info(`${logMessage} \u2022 completed`);
		}
	}
}

/**
 * Swallows an error whose message matches a known-benign {@link GitWarnings} pattern, returning WHICH one
 * matched so the caller can record it — the distinction matters, since `noCommits` is a real answer while
 * `notARepository` is a failed read. Rethrows anything else.
 */
export function defaultExceptionHandler(
	ex: Error,
	cwd: string | undefined,
	start?: [number, number],
): GitWarningKey | undefined {
	if (isCancellationError(ex)) throw ex;

	const msg = ex.message || ex.toString();
	if (msg) {
		for (const [key, warning] of Object.entries(GitWarnings) as [GitWarningKey, RegExp][]) {
			if (warning.test(msg)) {
				const duration = start !== undefined ? ` [${getDurationMilliseconds(start)}ms]` : '';
				Logger.warn(
					`[${cwd}] Git ${msg
						.trim()
						.replace(/fatal:\s*/g, '')
						.replace(/\r?\n|\r/g, ' \u00b7 ')}${duration}`,
				);
				return key;
			}
		}

		const match = GitErrors.badRevision.exec(msg);
		if (match != null) {
			const [, ref] = match;

			// Since looking up a ref with ^3 (e.g. looking for untracked files in a stash) can error on some versions of git just ignore it
			// Swallowed, but it matched no `GitWarnings` entry — `undefined` records "unclassified", which
			// callers must treat as "not a real answer" exactly like any warning they don't whitelist.
			if (ref?.endsWith('^3')) return undefined;
		}
	}

	throw ex;
}

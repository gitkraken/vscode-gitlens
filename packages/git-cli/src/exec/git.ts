import type { SpawnOptions } from 'child_process';
import { spawn } from 'child_process';
import * as process from 'process';
import type {
	BranchErrorReason,
	CheckoutErrorReason,
	CherryPickErrorReason,
	FetchErrorReason,
	GitCommandError,
	MergeErrorReason,
	PausedOperationAbortErrorReason,
	PausedOperationContinueErrorReason,
	PullErrorReason,
	PushErrorReason,
	RebaseErrorReason,
	ResetErrorReason,
	RevertErrorReason,
	ShowErrorReason,
	StashApplyErrorReason,
	StashPushErrorReason,
	TagErrorReason,
	WorktreeCreateErrorReason,
	WorktreeDeleteErrorReason,
} from '@gitlens/git/errors.js';
import { WorkspaceUntrustedError } from '@gitlens/git/errors.js';
import { CancellationError, getAbortSignalId, isCancellationError } from '@gitlens/utils/cancellation.js';
import { getScopedCounter } from '@gitlens/utils/counter.js';
import { getDurationMilliseconds, hrtime } from '@gitlens/utils/hrtime.js';
import { Logger } from '@gitlens/utils/logger.js';
import { formatLoggableScopeBlock } from '@gitlens/utils/logger.scoped.js';
import { dirname, isAbsolute, joinPaths, normalizePath } from '@gitlens/utils/path.js';
import { defer } from '@gitlens/utils/promise.js';
import type { Mutable } from '@gitlens/utils/types.js';
import { compare, fromString } from '@gitlens/utils/version.js';
import { CancelledRunError, RunError } from './exec.errors.js';
import type { RunOptions, RunResult } from './exec.js';
import { fsExists, runSpawn } from './exec.js';
import type { GitCommandPriority, GitExecOptions, GitResult, GitSpawnOptions } from './exec.types.js';
import type { FilteredGitFeatures, GitFeatureOrPrefix, GitFeatures } from './features.js';
import { gitFeaturesByVersion } from './features.js';
import type { GitQueueConfig } from './gitQueue.js';
import { GitQueue, inferGitCommandPriority } from './gitQueue.js';
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
	cherryPickEmptyPrevious: /The previous cherry-pick is now empty/i,
	cherryPickInProgress: /cherry-pick is already in progress|You have not concluded your cherry-pick/i,
	commitChangesFirst: /Please, commit your changes before you can/i,
	conflict: /^CONFLICT \([^)]+\): \b/m,
	detachedHead: /You are in 'detached HEAD' state/i,
	entryNotUpToDate: /error:\s*Entry ['"].+['"] not uptodate\. Cannot merge\./i,
	failedToDeleteDirectoryNotEmpty: /failed to delete '(.*?)': Directory not empty/i,
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
	noPausedOperation:
		/no merge (?:in progress|to abort)|no cherry-pick(?: or revert)? in progress|no rebase in progress/i,
	permissionDenied: /Permission.*denied/i,
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
	stashConflictingStagedAndUnstagedLines: /Cannot remove worktree changes/i,
	stashNothingToSave: /No local changes to save/i,
	stashSavedWorkingDirAndIndexState: /Saved working directory and index state/i,
	tagAlreadyExists: /tag .* already exists/i,
	tagConflict: /! \[rejected\].*\(would clobber existing tag\)/m,
	tagNotFound: /tag .* not found/i,
	uncommittedChanges: /contains modified or untracked files/i,
	unmergedChanges: /error:\s*you need to resolve your current index first/i,
	unmergedFiles: /is not possible because you have unmerged files|You have unmerged files/i,
	unresolvedConflicts: /You must edit all merge conflicts|Resolve all conflicts/i,
	unsafeRepository:
		/(?:^fatal:\s*detected dubious ownership in repository at '([^']+)'|unsafe repository \('([^']+)' is owned by someone else\))[\s\S]*(git config --global --add safe\.directory [^\n•]+)/m,
	unstagedChanges: /You have unstaged changes/i,
} as const;

export const GitWarnings = {
	notARepository: /Not a git repository/i,
	outsideRepository: /is outside repository/i,
	noPath: /no such path/i,
	noCommits: /does not have any commits/i,
	notFound: /Path '.*?' does not exist in/i,
	foundButNotInRevision: /Path '.*?' exists on disk, but not in/i,
	headNotABranch: /HEAD does not point to a branch/i,
	noUpstream: /no upstream configured for branch '(.*?)'/i,
	unknownRevision:
		/ambiguous argument '.*?': unknown revision or path not in the working tree|not stored as a remote-tracking branch/i,
	mustRunInWorkTree: /this operation must be run in a work tree/i,
	patchWithConflicts: /Applied patch to '.*?' with conflicts/i,
	noRemoteRepositorySpecified: /No remote repository specified\./i,
	remoteConnectionError: /Could not read from remote repository/i,
	notAGitCommand: /'.+' is not a git command/i,
	tipBehind: /tip of your current branch is behind/i,
} as const;

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
			[GitErrors.cherryPickEmptyPrevious, 'emptyCommit'],
			[GitErrors.changesWouldBeOverwritten, 'wouldOverwriteChanges'],
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
			[GitErrors.cherryPickEmptyPrevious, 'emptyCommit'],
			[GitErrors.noPausedOperation, 'nothingToContinue'],
			[GitErrors.uncommittedChanges, 'uncommittedChanges'],
			[GitErrors.unmergedFiles, 'unmergedFiles'],
			[GitErrors.unresolvedConflicts, 'conflicts'],
			[GitErrors.unstagedChanges, 'unstagedChanges'],
			[GitErrors.changesWouldBeOverwritten, 'wouldOverwriteChanges'],
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
}

const emptyArray: readonly never[] = Object.freeze([]);
const emptyObj = Object.freeze({});
const trailingNewlineRegex = /[\r|\n]+$/;
const uniqueCounterForStdin = getScopedCounter();
const uniqueCounterForStream = getScopedCounter();

type ExitCodeOnlyGitCommandOptions = GitExecOptions & { exitCodeOnly: true };

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

	async exec(
		options: ExitCodeOnlyGitCommandOptions,
		...args: readonly (string | undefined)[]
	): Promise<GitResult<unknown>>;
	async exec<T extends string | Buffer = string>(
		options: GitExecOptions,
		...args: readonly (string | undefined)[]
	): Promise<GitResult<T>>;
	async exec<T extends string | Buffer = string>(
		options: GitExecOptions,
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
				async cacheable => {
					const result = await this.execCore<T>({ ...options, caching: undefined }, runArgs, gitCommand);
					if (result.exitCode !== 0) {
						cacheable.invalidate();
					}
					return result;
				},
				options.caching.options,
			);
		}

		return this.execCore<T>(options, runArgs, gitCommand);
	}

	private async execCore<T extends string | Buffer>(
		options: GitExecOptions,
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
			...opts
		} = options;

		const defaultTimeout = this.options.gitTimeout ?? 60000;
		const runOpts: Mutable<RunOptions> = {
			...opts,
			timeout: opts.timeout === 0 || defaultTimeout === 0 ? undefined : (opts.timeout ?? defaultTimeout),
			encoding: (encoding ?? 'utf8') === 'utf8' ? 'utf8' : 'buffer',
			decode: this.options.decode,
			env: this.buildEnv(options.env),
		};

		const cacheKey = `${correlationKey !== undefined ? `${correlationKey}:` : ''}${
			options?.stdin != null ? `${uniqueCounterForStdin.next()}:` : ''
		}${cancellation != null ? `${getAbortSignalId(cancellation)}:` : ''}${gitCommand}`;

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
				.execute(priority, () => runSpawn<T>(gitPath, args, encoding ?? 'utf8', runOpts))
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
			return {
				stdout: result.stdout as T,
				stderr: result.stderr as T | undefined,
				exitCode: result.exitCode ?? 0,
			};
		} catch (ex) {
			if (ex instanceof CancelledRunError) {
				const duration = getDurationMilliseconds(start);
				const timeout = runOpts.timeout ?? 0;
				const reason =
					timeout > 0 && duration >= timeout - 100
						? 'timeout'
						: cancellation?.aborted
							? 'cancellation'
							: 'unknown';
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
					return {
						stdout: ex.stdout as T,
						stderr: ex.stderr as T | undefined,
						exitCode: ex.code != null ? (typeof ex.code === 'number' ? ex.code : parseInt(ex.code, 10)) : 0,
						cancelled: ex instanceof CancelledRunError,
					};
				}

				return {
					stdout: '' as T,
					stderr: undefined,
					exitCode: 0,
					cancelled: ex instanceof CancelledRunError,
				};
			}

			if (ex instanceof CancelledRunError) {
				exception = new CancellationError(ex);
			} else {
				exception = new GitError(ex);
			}
			if (errorHandling === 'throw') throw exception;

			defaultExceptionHandler(exception, options.cwd, start);
			exception = undefined;
			return { stdout: '' as T, stderr: result?.stderr as T | undefined, exitCode: result?.exitCode ?? 0 };
		} finally {
			this.logGitCommandComplete(gitCommand, exception, getDurationMilliseconds(start), waiting);
		}
	}

	async *stream(options: GitSpawnOptions, ...args: readonly (string | undefined)[]): AsyncGenerator<string> {
		if (this.options.isTrusted?.() === false) throw new WorkspaceUntrustedError();

		const start = hrtime();
		const streamId = uniqueCounterForStream.next();

		const { configs, stdin, stdinEncoding, cancellation, ...opts } = options;
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
		runArgs.unshift(
			'-c',
			'core.quotepath=false',
			'-c',
			'color.ui=false',
			...(configs !== undefined ? configs : emptyArray),
		);

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
			this.logGitCommandComplete(gitCommand, exception, getDurationMilliseconds(start), false, streamId);
		};

		try {
			this.logGitCommandStart(gitCommand, streamId);

			try {
				if (proc.stdout) {
					proc.stdout.setEncoding('utf8');
					for await (const chunk of proc.stdout) {
						yield chunk;
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
		// eslint-disable-next-line @typescript-eslint/no-meaningless-void-operator
		return void cleanup();
	}

	async rev_parse__git_dir(cwd: string): Promise<{ path: string; commonPath?: string } | undefined> {
		const result = await this.exec({ cwd: cwd, errors: 'ignore' }, 'rev-parse', '--git-dir', '--git-common-dir');
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
					result = await this.exec(
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
			result = await this.exec({ cwd: cwd, errors: 'throw' }, 'rev-parse', '--show-toplevel');
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
				result = await this.exec({ cwd: cwd, errors: 'ignore' }, 'rev-parse', '--is-bare-repository');
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
	}

	private logGitCommandComplete(
		command: string,
		ex: Error | undefined,
		duration: number,
		waiting: boolean,
		id?: number,
	): void {
		const slow = duration > slowCallWarningThreshold;
		const status = slow && waiting ? ' (slow, waiting)' : waiting ? ' (waiting)' : slow ? ' (slow)' : '';

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
	}
}

export function defaultExceptionHandler(ex: Error, cwd: string | undefined, start?: [number, number]): void {
	if (isCancellationError(ex)) throw ex;

	const msg = ex.message || ex.toString();
	if (msg) {
		for (const warning of Object.values(GitWarnings)) {
			if (warning.test(msg)) {
				const duration = start !== undefined ? ` [${getDurationMilliseconds(start)}ms]` : '';
				Logger.warn(
					`[${cwd}] Git ${msg
						.trim()
						.replace(/fatal:\s*/g, '')
						.replace(/\r?\n|\r/g, ' \u00b7 ')}${duration}`,
				);
				return;
			}
		}

		const match = GitErrors.badRevision.exec(msg);
		if (match != null) {
			const [, ref] = match;

			// Since looking up a ref with ^3 (e.g. looking for untracked files in a stash) can error on some versions of git just ignore it
			if (ref?.endsWith('^3')) return;
		}
	}

	throw ex;
}

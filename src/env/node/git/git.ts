import type { SpawnOptions } from 'child_process';
import { spawn } from 'child_process';
import { join as joinPath } from 'path';
import * as process from 'process';
import type { CancellationToken, Disposable, LogOutputChannel } from 'vscode';
import { Uri, window, workspace } from 'vscode';
import { hrtime } from '@env/hrtime.js';
import type { Container } from '../../../container.js';
import { CancellationError, isCancellationError } from '../../../errors.js';
import type { FilteredGitFeatures, GitFeatureOrPrefix, GitFeatures } from '../../../features.js';
import { gitFeaturesByVersion } from '../../../features.js';
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
} from '../../../git/errors.js';
import {
	BlameIgnoreRevsFileBadRevisionError,
	BlameIgnoreRevsFileError,
	CheckoutError,
	FetchError,
	PullError,
	PushError,
	ResetError,
	ShowError,
	StashPushError,
	WorkspaceUntrustedError,
} from '../../../git/errors.js';
import type { GitErrorHandling, GitExecOptions, GitResult, GitSpawnOptions } from '../../../git/execTypes.js';
import type { GitDir } from '../../../git/gitProvider.js';
import type { GitDiffFilter } from '../../../git/models/diff.js';
import { rootSha } from '../../../git/models/revision.js';
import { parseGitRemoteUrl } from '../../../git/parsers/remoteParser.js';
import { isUncommitted, isUncommittedStaged } from '../../../git/utils/revision.utils.js';
import { getCancellationTokenId } from '../../../system/-webview/cancellation.js';
import { configuration } from '../../../system/-webview/configuration.js';
import { splitPath } from '../../../system/-webview/path.js';
import { getScopedCounter } from '../../../system/counter.js';
import { slowCallWarningThreshold } from '../../../system/logger.constants.js';
import { Logger } from '../../../system/logger.js';
import { formatLoggableScopeBlock } from '../../../system/logger.scope.js';
import { dirname, isAbsolute, joinPaths, normalizePath } from '../../../system/path.js';
import { defer, isPromise } from '../../../system/promise.js';
import { getDurationMilliseconds } from '../../../system/string.js';
import { compare, fromString } from '../../../system/version.js';
import { GitQueue, inferGitCommandPriority } from './gitQueue.js';
import type { GitLocation } from './locator.js';
import { CancelledRunError, RunError } from './shell.errors.js';
import type { RunOptions, RunResult } from './shell.js';
import { fsExists, runSpawn } from './shell.js';

const emptyArray: readonly any[] = Object.freeze([]);
const emptyObj = Object.freeze({});

export const gitConfigsBranch = ['-c', 'color.branch=false'] as const;
export const gitConfigsDiff = ['-c', 'color.diff=false', '-c', 'diff.mnemonicPrefix=false'] as const;
export const gitConfigsLog = ['-c', 'log.showSignature=false'] as const;
export const gitConfigsLogWithFiles = ['-c', 'log.showSignature=false', '-c', 'diff.renameLimit=0'] as const;
export const gitConfigsLogWithSignatures = ['-c', 'log.showSignature=true'] as const;
export const gitConfigsPull = ['-c', 'merge.autoStash=true', '-c', 'rebase.autoStash=true'] as const;
export const gitConfigsStatus = ['-c', 'color.status=false'] as const;

export const maxGitCliLength = 30000;

const textDecoder = new TextDecoder('utf8');

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
	pushRejectedRemoteRefUpdated: /! \[rejected\].*\(remote ref updated since checkout\)/m,
	pushRejectedStaleInfo: /! \[rejected\].*\(stale info\)/m,
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
};

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
};

const fatalPrefixRegex = /fatal:\s*/g;
const newlineOrReturnRegex = /\r?\n|\r/g;
const ignoreRevsFileArgRegex = /^--ignore-revs-file\s*=?\s*(.*)$/;
const trailingNewlineRegex = /[\r|\n]+$/;

function defaultExceptionHandler(ex: Error, cwd: string | undefined, start?: [number, number]): void {
	if (isCancellationError(ex)) throw ex;

	const msg = ex.message || ex.toString();
	if (msg) {
		for (const warning of Object.values(GitWarnings)) {
			if (warning.test(msg)) {
				const duration = start !== undefined ? ` [${getDurationMilliseconds(start)}ms]` : '';
				Logger.warn(
					`[${cwd}] Git ${msg
						.trim()
						.replace(fatalPrefixRegex, '')
						.replace(newlineOrReturnRegex, ` \u2022 `)}${duration}`,
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

const uniqueCounterForStdin = getScopedCounter();
const uniqueCounterForStream = getScopedCounter();

type ExitCodeOnlyGitCommandOptions = GitExecOptions & { exitCodeOnly: true };
export type PushForceOptions = { withLease: true; ifIncludes?: boolean } | { withLease: false; ifIncludes?: never };

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

export class Git implements Disposable {
	private readonly _disposable: Disposable;
	/** Map of running git commands -- avoids running duplicate overlapping commands */
	private readonly pendingCommands = new Map<string, Promise<RunResult<string | Buffer>>>();
	/** Queue for throttling background git operations */
	private readonly _queue: GitQueue;

	constructor(private readonly container: Container) {
		this._queue = new GitQueue(container);
		this._disposable = container.events.on('git:cache:reset', e => {
			// Ignore provider resets (e.g. it needs to be git specific)
			if (e.data.types?.every(t => t === 'providers')) return;

			this.pendingCommands.clear();
		});
	}

	dispose(): void {
		this._queue.dispose();
		this._disposable.dispose();
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
		if (!workspace.isTrusted) throw new WorkspaceUntrustedError();

		const runArgs = args.filter(a => a != null);
		const gitCommand = `git ${runArgs.join(' ')}`;

		// If cache is provided, use it to cache the full result
		if (options.caching != null) {
			return options.caching.cache.getOrCreate(
				// Use cache.commonPath if provided for worktree-shared data, otherwise cwd
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
		const { cancellation, configs, correlationKey, errors: errorHandling, encoding, runLocally, ...opts } = options;

		const defaultTimeout = (configuration.get('advanced.git.timeout') ?? 60) * 1000;
		const runOpts: Mutable<RunOptions> = {
			...opts,
			timeout: opts.timeout === 0 || defaultTimeout === 0 ? undefined : (opts.timeout ?? defaultTimeout),
			encoding: (encoding ?? 'utf8') === 'utf8' ? 'utf8' : 'buffer',
			// Adds GCM environment variables to avoid any possible credential issues -- from https://github.com/Microsoft/vscode/issues/26573#issuecomment-338686581
			// Shouldn't *really* be needed but better safe than sorry
			env: {
				...process.env,
				...this._gitEnv,
				...(options.env ?? emptyObj),
				GCM_INTERACTIVE: 'NEVER',
				GCM_PRESERVE_CREDS: 'TRUE',
				LC_ALL: 'C',
			},
		};

		const cacheKey = `${correlationKey !== undefined ? `${correlationKey}:` : ''}${
			options?.stdin != null ? `${uniqueCounterForStdin.next()}:` : ''
		}${cancellation != null ? `${getCancellationTokenId(cancellation)}:` : ''}${gitCommand}`;

		let waiting;
		let promise = this.pendingCommands.get(cacheKey);
		if (promise == null) {
			waiting = false;

			// Create a deferred promise and store it immediately to prevent duplicate commands
			// from concurrent calls that might arrive during async operations below
			const deferred = defer<RunResult<string | Buffer>>();
			promise = deferred.promise;
			this.pendingCommands.set(cacheKey, promise);

			// Fixes https://github.com/gitkraken/vscode-gitlens/issues/73 & https://github.com/gitkraken/vscode-gitlens/issues/161
			// See https://stackoverflow.com/questions/4144417/how-to-handle-asian-characters-in-file-names-in-git-on-os-x
			args.unshift('-c', 'core.quotepath=false', '-c', 'color.ui=false', ...(configs ?? emptyArray));

			if (process.platform === 'win32') {
				args.unshift('-c', 'core.longpaths=true');
			}

			let abortController: AbortController | undefined;
			let disposeCancellation: Disposable | undefined;
			if (cancellation != null) {
				abortController = new AbortController();
				runOpts.signal = abortController.signal;
				disposeCancellation = cancellation.onCancellationRequested(() => abortController?.abort());
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
					void disposeCancellation?.dispose();
				})
				.catch(() => {});
		} else {
			waiting = true;
			Logger.trace(
				`${formatLoggableScopeBlock('GIT')} ${gitCommand} \u2022 awaiting existing call in progress...`,
			);
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
						: cancellation?.isCancellationRequested
							? 'cancellation'
							: 'unknown';
				Logger.warn(
					`${formatLoggableScopeBlock('GIT')} ${gitCommand} \u2022 ABORTED after ${duration}ms (${reason})`,
				);
				this.container.telemetry.sendEvent('op/git/aborted', {
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

			exception = ex instanceof CancelledRunError ? new CancellationError(ex) : new GitError(ex);
			if (errorHandling === 'throw') throw exception;

			defaultExceptionHandler(exception, options.cwd, start);
			exception = undefined;
			return { stdout: '' as T, stderr: result?.stderr as T | undefined, exitCode: result?.exitCode ?? 0 };
		} finally {
			this.logGitCommandComplete(gitCommand, exception, getDurationMilliseconds(start), waiting);
		}
	}

	async *stream(options: GitSpawnOptions, ...args: readonly (string | undefined)[]): AsyncGenerator<string> {
		if (!workspace.isTrusted) throw new WorkspaceUntrustedError();

		const start = hrtime();
		const streamId = uniqueCounterForStream.next();

		const { cancellation, configs, stdin, stdinEncoding, ...opts } = options;
		const runArgs = args.filter(a => a != null);

		const spawnOpts: SpawnOptions = {
			// Unless provided, ignore stdin and leave default streams for stdout and stderr
			stdio: [stdin ? 'pipe' : 'ignore', null, null],
			...opts,
			// Adds GCM environment variables to avoid any possible credential issues -- from https://github.com/Microsoft/vscode/issues/26573#issuecomment-338686581
			// Shouldn't *really* be needed but better safe than sorry
			env: {
				...process.env,
				...this._gitEnv,
				...(options.env ?? emptyObj),
				GCM_INTERACTIVE: 'NEVER',
				GCM_PRESERVE_CREDS: 'TRUE',
				LC_ALL: 'C',
			},
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

		let disposable: Disposable | undefined;
		if (cancellation != null) {
			const aborter = new AbortController();
			const onAbort = () => aborter.abort();

			const signal = spawnOpts.signal;
			const cancellationDisposable = cancellation.onCancellationRequested(onAbort);

			disposable = {
				dispose: () => {
					cancellationDisposable.dispose();
					signal?.removeEventListener('abort', onAbort);
				},
			};

			spawnOpts.signal?.addEventListener('abort', onAbort);
			spawnOpts.signal = aborter.signal;
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
					if (spawnOpts.signal?.aborted) {
						resolve();
					} else {
						reject(
							new CancellationError(
								new CancelledRunError(proc.spawnargs.join(' '), true, code ?? undefined, signal),
							),
						);
					}
					return;
				}

				// If the caller didn't read the complete stream, just resolve
				if (
					signal === 'SIGPIPE' ||
					code === 141 /* SIGPIPE */ ||
					// Effectively SIGPIPE on WSL & Linux?
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
				disposable?.dispose();
			} catch {}
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

	private _gitLocation: GitLocation | undefined;
	private _gitLocationPromise: Promise<GitLocation> | undefined;
	private async getLocation(): Promise<GitLocation> {
		if (this._gitLocation == null) {
			this._gitLocationPromise ??= this._gitLocator();
			this._gitLocation = await this._gitLocationPromise;
		}
		return this._gitLocation;
	}

	private _gitLocator!: () => Promise<GitLocation>;
	setLocator(locator: () => Promise<GitLocation>): void {
		this._gitLocator = locator;
		this._gitLocationPromise = undefined;
		this._gitLocation = undefined;
	}

	private _gitEnv: Record<string, unknown> | undefined;
	setEnv(env: Record<string, unknown> | undefined): void {
		this._gitEnv = env;
	}

	async path(): Promise<string> {
		return (await this.getLocation()).path;
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

	async version(): Promise<string> {
		return (await this.getLocation()).version;
	}

	// Git commands

	private readonly ignoreRevsFileMap = new Map<string, boolean>();

	async blame(
		repoPath: string | undefined,
		fileName: string,
		options?: ({ ref: string | undefined; contents?: never } | { contents: string; ref?: never }) & {
			args?: string[] | null;
			correlationKey?: string;
			ignoreWhitespace?: boolean;
			startLine?: number;
			endLine?: number;
		},
	): Promise<GitResult> {
		const [file, root] = splitPath(fileName, repoPath, true);

		const params = ['blame', '--root', '--incremental'];

		if (options?.ignoreWhitespace) {
			params.push('-w');
		}
		if (options?.startLine != null && options.endLine != null) {
			params.push(`-L ${options.startLine},${options.endLine}`);
		}
		if (options?.args != null) {
			// See if the args contains a value like: `--ignore-revs-file <file>` or `--ignore-revs-file=<file>` to account for user error
			// If so split it up into two args
			const argIndex = options.args.findIndex(
				arg => arg !== '--ignore-revs-file' && arg.startsWith('--ignore-revs-file'),
			);
			if (argIndex !== -1) {
				const match = ignoreRevsFileArgRegex.exec(options.args[argIndex]);
				if (match != null) {
					options.args.splice(argIndex, 1, '--ignore-revs-file', match[1]);
				}
			}

			params.push(...options.args);
		}

		// Ensure the version of Git supports the --ignore-revs-file flag, otherwise the blame will fail
		const supportsIgnoreRevsFileResult = this.supports('git:ignoreRevsFile');
		let supportsIgnoreRevsFile = isPromise(supportsIgnoreRevsFileResult)
			? await supportsIgnoreRevsFileResult
			: supportsIgnoreRevsFileResult;

		const ignoreRevsIndex = params.indexOf('--ignore-revs-file');

		if (supportsIgnoreRevsFile) {
			let ignoreRevsFile;
			if (ignoreRevsIndex !== -1) {
				ignoreRevsFile = params[ignoreRevsIndex + 1];
				if (!isAbsolute(ignoreRevsFile)) {
					ignoreRevsFile = joinPaths(root, ignoreRevsFile);
				}
			} else {
				ignoreRevsFile = joinPaths(root, '.git-blame-ignore-revs');
			}

			const exists = this.ignoreRevsFileMap.get(ignoreRevsFile);
			if (exists !== undefined) {
				supportsIgnoreRevsFile = exists;
			} else {
				// Ensure the specified --ignore-revs-file exists, otherwise the blame will fail
				try {
					supportsIgnoreRevsFile = await fsExists(ignoreRevsFile);
				} catch {
					supportsIgnoreRevsFile = false;
				}

				this.ignoreRevsFileMap.set(ignoreRevsFile, supportsIgnoreRevsFile);
			}
		}

		if (!supportsIgnoreRevsFile && ignoreRevsIndex !== -1) {
			params.splice(ignoreRevsIndex, 2);
		} else if (supportsIgnoreRevsFile && ignoreRevsIndex === -1) {
			params.push('--ignore-revs-file', '.git-blame-ignore-revs');
		}

		let stdin;
		if (options?.contents != null) {
			// Pipe the blame contents to stdin
			params.push('--contents', '-');

			stdin = options.contents;
		} else if (options?.ref) {
			if (isUncommittedStaged(options.ref)) {
				// Pipe the blame contents to stdin
				params.push('--contents', '-');

				// Get the file contents for the staged version using `:`
				stdin = await this.show__content<string>(repoPath, fileName, ':');
			} else {
				params.push(options.ref);
			}
		}

		try {
			const result = await this.exec(
				{ cwd: root, stdin: stdin, correlationKey: options?.correlationKey },
				...params,
				'--',
				file,
			);
			return result;
		} catch (ex) {
			// Since `-c blame.ignoreRevsFile=` doesn't seem to work (unlike as the docs suggest), try to detect the error and throw a more helpful one
			let match = GitErrors.invalidObjectNameList.exec(ex.message);
			if (match != null) {
				throw new BlameIgnoreRevsFileError(match[1], ex);
			}

			match = GitErrors.invalidObjectName.exec(ex.message);
			if (match != null) {
				throw new BlameIgnoreRevsFileBadRevisionError(match[1], ex);
			}

			throw ex;
		}
	}

	async branchOrTag__containsOrPointsAt(
		repoPath: string,
		refs: string[],
		options?: {
			type?: 'branch' | 'tag';
			all?: boolean;
			mode?: 'contains' | 'pointsAt';
			name?: string;
			remotes?: boolean;
		},
		cancellation?: CancellationToken,
	): Promise<GitResult> {
		const params: string[] = [options?.type ?? 'branch'];
		if (options?.all) {
			params.push('-a');
		} else if (options?.remotes) {
			params.push('-r');
		}

		params.push('--format=%(refname:short)');

		for (const ref of refs) {
			params.push(options?.mode === 'pointsAt' ? `--points-at=${ref}` : `--contains=${ref}`);
		}

		if (options?.name != null) {
			params.push(options.name);
		}

		const result = await this.exec(
			{
				cwd: repoPath,
				cancellation: cancellation,
				configs: gitConfigsBranch,
				errors: 'ignore',
			},
			...params,
		);
		return result;
	}

	async checkout(
		repoPath: string,
		ref: string,
		{ createBranch, path }: { createBranch?: string; path?: string } = {},
	): Promise<GitResult> {
		const params = ['checkout'];
		if (createBranch) {
			params.push('-b', createBranch, ref, '--');
		} else {
			params.push(ref, '--');

			if (path) {
				[path, repoPath] = splitPath(path, repoPath, true);

				params.push(path);
			}
		}

		try {
			const result = await this.exec({ cwd: repoPath }, ...params);
			return result;
		} catch (ex) {
			throw getGitCommandError(
				'checkout',
				ex,
				reason =>
					new CheckoutError(
						{ reason: reason ?? 'other', ref: ref, gitCommand: { repoPath: repoPath, args: params } },
						ex,
					),
			);
		}
	}

	// TODO: Expand to include options and other params
	async clone(url: string, parentPath: string): Promise<string | undefined> {
		let count = 0;
		const [, , remotePath] = parseGitRemoteUrl(url);
		const remoteName = remotePath.split('/').pop();
		if (!remoteName) return undefined;

		let folderPath = joinPath(parentPath, remoteName);
		while ((await fsExists(folderPath)) && count < 20) {
			count++;
			folderPath = joinPath(parentPath, `${remotePath}-${count}`);
		}

		await this.exec({ cwd: parentPath }, 'clone', url, folderPath);

		return folderPath;
	}

	async diff(
		repoPath: string,
		fileName: string,
		ref1?: string,
		ref2?: string,
		options?: {
			encoding?: string;
			filters?: GitDiffFilter[];
			linesOfContext?: number;
			renames?: boolean;
			similarityThreshold?: number | null;
		},
	): Promise<GitResult> {
		const params = ['diff', '--no-ext-diff', '--minimal'];

		if (options?.linesOfContext != null) {
			params.push(`-U${options.linesOfContext}`);
		}

		if (options?.renames) {
			params.push(`-M${options.similarityThreshold == null ? '' : `${options.similarityThreshold}%`}`);
		}

		if (options?.filters != null && options.filters.length !== 0) {
			params.push(`--diff-filter=${options.filters.join('')}`);
		}

		if (ref1) {
			// <sha>^3 signals an untracked file in a stash and if we are trying to find its parent, use the root sha
			if (ref1.endsWith('^3^')) {
				ref1 = rootSha;
			}
			params.push(isUncommittedStaged(ref1) ? '--staged' : ref1);
		}
		if (ref2) {
			params.push(isUncommittedStaged(ref2) ? '--staged' : ref2);
		}

		try {
			const result = await this.exec(
				{ cwd: repoPath, configs: gitConfigsDiff, encoding: options?.encoding },
				...params,
				'--',
				fileName,
			);
			return result;
		} catch (ex) {
			const match = GitErrors.badRevision.exec(ex.message);
			if (match !== null) {
				const [, ref] = match;

				// If the bad ref is trying to find a parent ref, assume we hit to the last commit, so try again using the root sha
				if (ref === ref1 && ref?.endsWith('^')) {
					return this.diff(repoPath, fileName, rootSha, ref2, options);
				}
			}

			throw ex;
		}
	}

	async diff__contents(
		repoPath: string,
		fileName: string,
		ref: string,
		contents: string,
		options?: { encoding?: string; filters?: GitDiffFilter[]; similarityThreshold?: number | null },
	): Promise<string> {
		const params = [
			'diff',
			`-M${options?.similarityThreshold == null ? '' : `${options.similarityThreshold}%`}`,
			'--no-ext-diff',
			'-U0',
			'--minimal',
		];

		if (options?.filters != null && options.filters.length !== 0) {
			params.push(`--diff-filter=${options.filters.join('')}`);
		}

		// // <sha>^3 signals an untracked file in a stash and if we are trying to find its parent, use the root sha
		// if (ref.endsWith('^3^')) {
		// 	ref = rootSha;
		// }
		// params.push(isUncommittedStaged(ref) ? '--staged' : ref);

		params.push('--no-index');

		try {
			const result = await this.exec(
				{
					cwd: repoPath,
					configs: gitConfigsDiff,
					encoding: options?.encoding,
					stdin: contents,
				},
				...params,
				'--',
				fileName,
				// Pipe the contents to stdin
				'-',
			);
			return result.stdout;
		} catch (ex) {
			if (ex instanceof GitError && ex.stdout) {
				return ex.stdout;
			}

			const match = GitErrors.badRevision.exec(ex.message);
			if (match !== null) {
				const [, matchedRef] = match;

				// If the bad ref is trying to find a parent ref, assume we hit to the last commit, so try again using the root sha
				if (matchedRef === ref && matchedRef?.endsWith('^')) {
					return this.diff__contents(repoPath, fileName, rootSha, contents, options);
				}
			}

			throw ex;
		}
	}

	async fetch(
		repoPath: string,
		options:
			| { all?: boolean; branch?: undefined; prune?: boolean; pull?: boolean; remote?: string }
			| {
					all?: undefined;
					branch: string;
					prune?: undefined;
					pull?: boolean;
					remote: string;
					upstream: string;
			  },
	): Promise<void> {
		const params = ['fetch'];

		if (options.prune) {
			params.push('--prune');
		}

		if (options.branch && options.remote) {
			if (options.upstream && options.pull) {
				params.push('-u', options.remote, `${options.upstream}:${options.branch}`);
			} else {
				params.push(options.remote, options.upstream || options.branch);
			}
		} else if (options.remote) {
			params.push(options.remote);
		} else if (options.all) {
			params.push('--all');
		}

		try {
			void (await this.exec({ cwd: repoPath }, ...params));
		} catch (ex) {
			throw getGitCommandError(
				'fetch',
				ex,
				reason =>
					new FetchError(
						{
							reason: reason ?? 'other',
							branch: options?.branch,
							remote: options?.remote,
							gitCommand: { repoPath: repoPath, args: params },
						},
						ex,
					),
			);
		}
	}

	async push(
		repoPath: string,
		options: {
			branch?: string;
			force?: PushForceOptions;
			publish?: boolean;
			remote?: string;
			upstream?: string;
			delete?: {
				remote: string;
				branch: string;
			};
		},
	): Promise<void> {
		const params = ['push'];

		if (options.force != null) {
			if (options.force.withLease) {
				params.push('--force-with-lease');
				if (options.force.ifIncludes) {
					if (await this.supports('git:push:force-if-includes')) {
						params.push('--force-if-includes');
					}
				}
			} else {
				params.push('--force');
			}
		}

		if (options.branch && options.remote) {
			if (options.upstream) {
				params.push('-u', options.remote, `${options.branch}:${options.upstream}`);
			} else if (options.publish) {
				params.push('--set-upstream', options.remote, options.branch);
			} else {
				params.push(options.remote, options.branch);
			}
		} else if (options.remote) {
			params.push(options.remote);
		} else if (options.delete) {
			params.push(options.delete.remote, `:${options.delete.branch}`);
		}

		try {
			void (await this.exec({ cwd: repoPath }, ...params));
		} catch (ex) {
			const error = getGitCommandError(
				'push',
				ex,
				reason =>
					new PushError(
						{
							reason: reason,
							branch: options?.branch || options?.delete?.branch,
							remote: options?.remote || options?.delete?.remote,
							gitCommand: { repoPath: repoPath, args: params },
						},
						ex,
					),
			);

			if (options?.force?.withLease && error.details.reason === 'rejected') {
				if (ex.stderr && GitErrors.pushRejectedStaleInfo.test(ex.stderr)) {
					throw new PushError(
						{
							reason: 'rejectedWithLease',
							branch: options?.branch || options?.delete?.branch,
							remote: options?.remote || options?.delete?.remote,
							gitCommand: { repoPath: repoPath, args: params },
						},
						ex,
					);
				}
				if (options.force.ifIncludes && ex.stderr && GitErrors.pushRejectedRemoteRefUpdated.test(ex.stderr)) {
					throw new PushError(
						{
							reason: 'rejectedWithLeaseIfIncludes',
							branch: options?.branch || options?.delete?.branch,
							remote: options?.remote || options?.delete?.remote,
							gitCommand: { repoPath: repoPath, args: params },
						},
						ex,
					);
				}
				if (ex.stderr && GitErrors.pushRejectedRefDoesNotExists.test(ex.stderr)) {
					throw new PushError(
						{
							reason: 'rejectedRefDoesNotExist',
							branch: options?.branch || options?.delete?.branch,
							remote: options?.remote || options?.delete?.remote,
							gitCommand: { repoPath: repoPath, args: params },
						},
						ex,
					);
				}
			}
			throw error;
		}
	}

	async pull(repoPath: string, options: { rebase?: boolean; tags?: boolean }): Promise<void> {
		const params = ['pull'];

		if (options.tags) {
			params.push('--tags');
		}

		if (options.rebase) {
			params.push('-r');
		}

		try {
			void (await this.exec({ cwd: repoPath, configs: gitConfigsPull }, ...params));
		} catch (ex) {
			throw getGitCommandError(
				'pull',
				ex,
				reason =>
					new PullError({ reason: reason ?? 'other', gitCommand: { repoPath: repoPath, args: params } }, ex),
			);
		}
	}

	async reset(
		repoPath: string,
		pathspecs: string[],
		options?: { mode?: 'hard' | 'keep' | 'merge' | 'mixed' | 'soft'; rev?: string },
	): Promise<void> {
		const params = ['reset', '-q'];
		if (options?.mode) {
			params.push(`--${options.mode}`);
		}
		if (options?.rev) {
			params.push(options.rev);
		}
		params.push('--', ...pathspecs);

		try {
			await this.exec({ cwd: repoPath }, ...params);
		} catch (ex) {
			throw getGitCommandError(
				'reset',
				ex,
				reason =>
					new ResetError({ reason: reason ?? 'other', gitCommand: { repoPath: repoPath, args: params } }, ex),
			);
		}
	}

	// eslint-disable-next-line @typescript-eslint/naming-convention
	private async rev_parse__git_dir(cwd: string): Promise<{ path: string; commonPath?: string } | undefined> {
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

	/**
	 * Combined rev-parse call that returns repository info in a single spawn.
	 * This is an optimization to reduce process spawns during repository discovery.
	 *
	 * @returns Object with repoPath (toplevel), gitDir path, optional commonGitDir path for worktrees,
	 *          and optional superprojectPath for submodules.
	 *          Returns `[false]` for unsafe repositories, or `undefined`/empty array for non-repos.
	 */
	async rev_parse__repository_info(
		cwd: string,
	): Promise<
		| { repoPath: string; gitDir: string; commonGitDir: string | undefined; superprojectPath: string | undefined }
		| [safe: true, repoPath: string]
		| [safe: false]
		| []
	> {
		let result;

		if (!workspace.isTrusted) {
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
					// If this throw, we should be good to open the repo (e.g. HEAD doesn't exist)
				}
			}
		}

		try {
			result = await this.exec(
				{ cwd: cwd, errors: 'throw' },
				'rev-parse',
				'--show-toplevel',
				'--git-dir',
				'--git-common-dir',
				'--show-superproject-working-tree',
			);
			if (!result.stdout) return emptyArray as [];

			// Output is 3-4 lines: show-toplevel, git-dir, git-common-dir, [show-superproject-working-tree]
			// The 4th line is only present for submodules
			// Keep trailing spaces which are part of the directory name
			const lines = result.stdout.split('\n').map(r => r.trimStart());
			const [repoPath, dotGitPath, commonDotGitPath, superprojectPath] = lines;

			if (!repoPath) return emptyArray as [];

			// Normalize repo path: https://github.com/git-for-windows/git/issues/2478
			const normalizedRepoPath = normalizePath(repoPath.replace(trailingNewlineRegex, ''));

			// Normalize git dir paths (may be relative)
			let gitDir = dotGitPath;
			if (gitDir && !isAbsolute(gitDir)) {
				gitDir = joinPaths(cwd, gitDir);
			}
			gitDir = normalizePath(gitDir);

			let commonGitDir: string | undefined;
			if (commonDotGitPath) {
				commonGitDir = commonDotGitPath;
				if (!isAbsolute(commonGitDir)) {
					commonGitDir = joinPaths(cwd, commonGitDir);
				}
				commonGitDir = normalizePath(commonGitDir);
				// Only set if different from gitDir
				if (commonGitDir === gitDir) {
					commonGitDir = undefined;
				}
			}

			// Normalize superproject path if present (4th line only exists for submodules)
			const normalizedSuperprojectPath = superprojectPath
				? normalizePath(superprojectPath.replace(trailingNewlineRegex, ''))
				: undefined;

			return {
				repoPath: normalizedRepoPath,
				gitDir: gitDir,
				commonGitDir: commonGitDir,
				superprojectPath: normalizedSuperprojectPath,
			};
		} catch (ex) {
			if (ex instanceof WorkspaceUntrustedError) return emptyArray as [];

			const unsafeMatch = GitErrors.unsafeRepository.exec(ex.stderr);
			if (unsafeMatch != null) {
				Logger.warn(
					`Skipping; unsafe repository detected in '${unsafeMatch[1] || unsafeMatch[2]}'; run '${
						unsafeMatch[3]
					}' to allow it`,
				);
				return [false];
			}

			const inDotGit = GitWarnings.mustRunInWorkTree.test(ex.stderr);
			// Check if we are in a bare clone
			if (inDotGit && workspace.isTrusted) {
				result = await this.exec({ cwd: cwd, errors: 'ignore' }, 'rev-parse', '--is-bare-repository');
				if (result.stdout.trim() === 'true') {
					const result = await this.rev_parse__git_dir(cwd);
					const repoPath = result?.commonPath ?? result?.path;
					if (repoPath?.length) return [true, repoPath];
				}
			}

			if (inDotGit || ex.code === 'ENOENT') {
				// If the `cwd` doesn't exist, walk backward to see if any parent folder exists
				let exists = inDotGit ? false : await fsExists(cwd);
				if (!exists) {
					do {
						const parent = dirname(cwd);
						if (parent === cwd || parent.length === 0) return emptyArray as [];

						cwd = parent;
						exists = await fsExists(cwd);
					} while (!exists);

					return this.rev_parse__repository_info(cwd);
				}
			}
			return emptyArray as [];
		}
	}

	async rev_parse__show_toplevel(cwd: string): Promise<[safe: true, repoPath: string] | [safe: false] | []> {
		let result;

		if (!workspace.isTrusted) {
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
					// If this throw, we should be good to open the repo (e.g. HEAD doesn't exist)
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

			const unsafeMatch = GitErrors.unsafeRepository.exec(ex.stderr);
			if (unsafeMatch != null) {
				Logger.warn(
					`Skipping; unsafe repository detected in '${unsafeMatch[1] || unsafeMatch[2]}'; run '${
						unsafeMatch[3]
					}' to allow it`,
				);
				return [false];
			}

			const inDotGit = GitWarnings.mustRunInWorkTree.test(ex.stderr);
			// Check if we are in a bare clone
			if (inDotGit && workspace.isTrusted) {
				result = await this.exec({ cwd: cwd, errors: 'ignore' }, 'rev-parse', '--is-bare-repository');
				if (result.stdout.trim() === 'true') {
					const result = await this.rev_parse__git_dir(cwd);
					const repoPath = result?.commonPath ?? result?.path;
					if (repoPath?.length) return [true, repoPath];
				}
			}

			if (inDotGit || ex.code === 'ENOENT') {
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

	async show__content<T extends string | Buffer>(
		repoPath: string | undefined,
		path: string,
		rev: string,
		options?: {
			encoding?: 'binary' | 'ascii' | 'utf8' | 'utf16le' | 'ucs2' | 'base64' | 'latin1' | 'hex' | 'buffer';
			errors?: GitErrorHandling;
		},
	): Promise<T | undefined> {
		const [file, root] = splitPath(path, repoPath, true);

		if (isUncommittedStaged(rev)) {
			rev = ':';
		}
		if (isUncommitted(rev)) throw new Error(`ref=${rev} is uncommitted`);

		const opts: GitExecOptions = {
			configs: gitConfigsLog,
			cwd: root,
			encoding: options?.encoding ?? 'utf8',
			errors: 'throw',
		};
		const args = rev.endsWith(':') ? `${rev}./${file}` : `${rev}:./${file}`;
		const params = ['show', '--textconv', args, '--'];

		try {
			const result = await this.exec<T>(opts, ...params);
			return result.stdout;
		} catch (ex) {
			const msg: string = ex?.toString() ?? '';
			if (rev === ':' && GitErrors.badRevision.test(msg)) {
				return this.show__content<T>(repoPath, path, 'HEAD:', options);
			}

			const error = getGitCommandError(
				'show',
				ex,
				reason =>
					new ShowError(
						{
							reason: reason ?? 'other',
							rev: rev,
							path: path,
							gitCommand: { repoPath: repoPath ?? '', args: params },
						},
						ex,
					),
			);
			if (options?.errors === 'throw') throw error;

			if (
				ShowError.is(error, 'invalidRevision') ||
				ShowError.is(error, 'notFound') ||
				ShowError.is(error, 'notInRevision')
			) {
				return undefined;
			}

			defaultExceptionHandler(ex, opts.cwd);
			return '' as T;
		}
	}

	async stash__push(
		repoPath: string,
		message?: string,
		options?: {
			includeUntracked?: boolean;
			keepIndex?: boolean;
			onlyStaged?: boolean;
			pathspecs?: string[];
			stdin?: boolean;
		},
	): Promise<void> {
		const params = ['stash', 'push'];

		if ((options?.includeUntracked || options?.pathspecs?.length) && !options?.onlyStaged) {
			params.push('--include-untracked');
		}

		// "--keep-index --include-untracked -- <pathspec>" hits a bug in git in some circumstances.
		// Don't allow these flags together.
		//
		// $ mkdir stash-test && cd stash-test && git init
		// $ echo a > a.txt
		// $ git add a.txt
		// $ git commit -m init
		// $ echo b > b.txt
		// $ git stash push --keep-index --include-untracked -- b.txt
		// Saved working directory and index state WIP on main: 8a280fe init
		// error: pathspec ':(prefix:0)b.txt' did not match any file(s) known to git
		if (options?.keepIndex && !(params.includes('--include-untracked') && options?.pathspecs?.length)) {
			params.push('--keep-index');
		}

		if (options?.onlyStaged) {
			if (await this.supports('git:stash:push:staged')) {
				params.push('--staged');
			} else {
				throw new Error(
					`Git version ${gitFeaturesByVersion.get(
						'git:stash:push:staged',
					)}}2.35 or higher is required for --staged`,
				);
			}
		}

		if (message) {
			params.push('-m', message);
		}

		let stdin;
		if (options?.pathspecs?.length) {
			if (options.stdin) {
				stdin = options.pathspecs.join('\0');
				params.push('--pathspec-from-file=-', '--pathspec-file-nul', '--');
			} else {
				params.push('--', ...options.pathspecs);
			}
		} else {
			params.push('--');
		}

		try {
			const result = await this.exec({ cwd: repoPath, stdin: stdin }, ...params);
			if (GitErrors.stashNothingToSave.test(result.stdout)) {
				throw new StashPushError({ reason: 'nothingToSave', gitCommand: { repoPath: repoPath, args: params } });
			}
		} catch (ex) {
			if (ex instanceof StashPushError) throw ex;

			throw getGitCommandError(
				'stash-push',
				ex,
				reason =>
					new StashPushError(
						{ reason: reason ?? 'other', gitCommand: { repoPath: repoPath, args: params } },
						ex,
					),
			);
		}
	}

	async status(
		repoPath: string,
		porcelainVersion: number = 1,
		options?: { similarityThreshold?: number },
		cancellation?: CancellationToken,
		...pathspecs: string[]
	): Promise<GitResult> {
		const params = [
			'status',
			porcelainVersion >= 2 ? `--porcelain=v${porcelainVersion}` : '--porcelain',
			'--branch',
			'-u',
		];
		if (await this.supports('git:status:find-renames')) {
			params.push(
				`--find-renames${options?.similarityThreshold == null ? '' : `=${options.similarityThreshold}%`}`,
			);
		}

		const result = await this.exec(
			{
				cwd: repoPath,
				cancellation: cancellation,
				configs: gitConfigsStatus,
				env: { GIT_OPTIONAL_LOCKS: '0' },
			},
			...params,
			'--',
			...pathspecs,
		);
		return result;
	}

	async readDotGitFile(
		gitDir: GitDir,
		pathParts: string[],
		options?: { numeric?: false; throw?: boolean; trim?: boolean },
	): Promise<string | undefined>;
	async readDotGitFile(
		gitDir: GitDir,
		pathParts: string[],
		options?: { numeric: true; throw?: boolean; trim?: boolean },
	): Promise<number | undefined>;
	async readDotGitFile(
		gitDir: GitDir,
		pathParts: string[],
		options?: { numeric?: boolean; throw?: boolean; trim?: boolean },
	): Promise<string | number | undefined> {
		try {
			const bytes = await workspace.fs.readFile(Uri.joinPath(gitDir.uri, ...pathParts));
			let contents = textDecoder.decode(bytes);
			contents = (options?.trim ?? true) ? contents.trim() : contents;

			if (options?.numeric) {
				const number = Number.parseInt(contents, 10);
				return isNaN(number) ? undefined : number;
			}

			return contents;
		} catch (ex) {
			if (options?.throw) throw ex;

			return undefined;
		}
	}
	private logGitCommandStart(command: string, id: number): void {
		Logger.info(`${formatLoggableScopeBlock(`GIT →${id}`)} ${command} \u2022 starting...`);
		this.logCore(`${formatLoggableScopeBlock(`→${id}`, '')} ${command} \u2022 starting...`);
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
				`${formatLoggableScopeBlock(id ? `GIT ←${id}` : 'GIT')} ${command} \u2022 ${
					isCancellationError(ex)
						? 'cancelled'
						: (ex.message || String(ex) || '')
								.trim()
								.replace(fatalPrefixRegex, '')
								.replace(newlineOrReturnRegex, ` \u2022 `)
				} [${duration}ms]${status}`,
			);
		} else if (slow) {
			Logger.warn(
				`${formatLoggableScopeBlock(id ? `GIT ←${id}` : 'GIT', `*${duration}ms`)} ${command} [*${duration}ms]${status}`,
			);
		} else {
			Logger.info(
				`${formatLoggableScopeBlock(id ? `GIT ←${id}` : 'GIT', `${duration}ms`)} ${command} [${duration}ms]${status}`,
			);
		}

		this.logCore(
			`${formatLoggableScopeBlock(`${id ? `←${id}` : ''}${slow ? '*' : ''}`, `${duration}ms`)} ${command}${status}`,
			ex,
		);
	}

	private _gitOutput: LogOutputChannel | undefined;
	private get gitOutput(): LogOutputChannel {
		return (this._gitOutput ??= window.createOutputChannel('GitLens (Git)', { log: true }));
	}

	private logCore(message: string, ex?: Error | undefined): void {
		if (ex != null) {
			this.gitOutput.error(`${message} \u2022 FAILED\n${String(ex)}`);
		} else {
			this.gitOutput.info(message);
		}
	}
}

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

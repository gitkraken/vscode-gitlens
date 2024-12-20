import type { ChildProcess, SpawnOptions } from 'child_process';
import { spawn } from 'child_process';
import { accessSync } from 'fs';
import { join as joinPath } from 'path';
import * as process from 'process';
import { hrtime } from '@env/hrtime';
import type { CancellationToken, OutputChannel } from 'vscode';
import { env, Uri, window, workspace } from 'vscode';
import { GlyphChars } from '../../../constants';
import type { GitCommandOptions, GitSpawnOptions } from '../../../git/commandOptions';
import { GitErrorHandling } from '../../../git/commandOptions';
import {
	BlameIgnoreRevsFileBadRevisionError,
	BlameIgnoreRevsFileError,
	CherryPickError,
	CherryPickErrorReason,
	FetchError,
	FetchErrorReason,
	PullError,
	PullErrorReason,
	PushError,
	PushErrorReason,
	StashPushError,
	StashPushErrorReason,
	TagError,
	TagErrorReason,
	WorkspaceUntrustedError,
} from '../../../git/errors';
import type { GitDir } from '../../../git/gitProvider';
import type { GitDiffFilter } from '../../../git/models/diff';
import type { GitRevisionRange } from '../../../git/models/revision';
import { isUncommitted, isUncommittedStaged, shortenRevision } from '../../../git/models/revision.utils';
import type { GitUser } from '../../../git/models/user';
import { parseGitBranchesDefaultFormat } from '../../../git/parsers/branchParser';
import { parseGitLogAllFormat, parseGitLogDefaultFormat } from '../../../git/parsers/logParser';
import { parseGitRemoteUrl } from '../../../git/parsers/remoteParser';
import { splitAt } from '../../../system/array';
import { log } from '../../../system/decorators/log';
import { join } from '../../../system/iterable';
import { Logger } from '../../../system/logger';
import { slowCallWarningThreshold } from '../../../system/logger.constants';
import { getLoggableScopeBlockOverride, getLogScope } from '../../../system/logger.scope';
import { dirname, isAbsolute, isFolderGlob, joinPaths, normalizePath } from '../../../system/path';
import { getDurationMilliseconds } from '../../../system/string';
import { compare, fromString } from '../../../system/version';
import { configuration } from '../../../system/vscode/configuration';
import { splitPath } from '../../../system/vscode/path';
import { getEditorCommand } from '../../../system/vscode/utils';
import { ensureGitTerminal } from '../../../terminal';
import type { GitLocation } from './locator';
import type { RunOptions } from './shell';
import { fsExists, isWindows, run, RunError } from './shell';

const emptyArray = Object.freeze([]) as unknown as any[];
const emptyObj = Object.freeze({});

const gitBranchDefaultConfigs = Object.freeze(['-c', 'color.branch=false']);
const gitDiffDefaultConfigs = Object.freeze(['-c', 'color.diff=false']);
export const gitLogDefaultConfigs = Object.freeze(['-c', 'log.showSignature=false']);
export const gitLogDefaultConfigsWithFiles = Object.freeze([
	'-c',
	'log.showSignature=false',
	'-c',
	'diff.renameLimit=0',
]);
const gitStatusDefaultConfigs = Object.freeze(['-c', 'color.status=false']);

export const maxGitCliLength = 30000;

const textDecoder = new TextDecoder('utf8');

// This is a root sha of all git repo's if using sha1
const rootSha = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

export const GitErrors = {
	badRevision: /bad revision '(.*?)'/i,
	cantLockRef: /cannot lock ref|unable to update local ref/i,
	changesWouldBeOverwritten: /Your local changes to the following files would be overwritten/i,
	commitChangesFirst: /Please, commit your changes before you can/i,
	conflict: /^CONFLICT \([^)]+\): \b/m,
	failedToDeleteDirectoryNotEmpty: /failed to delete '(.*?)': Directory not empty/i,
	invalidObjectName: /invalid object name: (.*)\s/i,
	invalidObjectNameList: /could not open object name list: (.*)\s/i,
	noFastForward: /\(non-fast-forward\)/i,
	noMergeBase: /no merge base/i,
	noRemoteRepositorySpecified: /No remote repository specified\./i,
	notAValidObjectName: /Not a valid object name/i,
	notAWorkingTree: /'(.*?)' is not a working tree/i,
	noUserNameConfigured: /Please tell me who you are\./i,
	invalidLineCount: /file .+? has only \d+ lines/i,
	uncommittedChanges: /contains modified or untracked files/i,
	alreadyExists: /already exists/i,
	alreadyCheckedOut: /already checked out/i,
	mainWorkingTree: /is a main working tree/i,
	noUpstream: /^fatal: The current branch .* has no upstream branch/i,
	permissionDenied: /Permission.*denied/i,
	pushRejected: /^error: failed to push some refs to\b/m,
	rebaseMultipleBranches: /cannot rebase onto multiple branches/i,
	remoteAhead: /rejected because the remote contains work/i,
	remoteConnection: /Could not read from remote repository/i,
	tagConflict: /! \[rejected\].*\(would clobber existing tag\)/m,
	unmergedFiles: /is not possible because you have unmerged files/i,
	unstagedChanges: /You have unstaged changes/i,
	tagAlreadyExists: /tag .* already exists/i,
	tagNotFound: /tag .* not found/i,
	invalidTagName: /invalid tag name/i,
	remoteRejected: /rejected because the remote contains work/i,
};

const GitWarnings = {
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

function defaultExceptionHandler(ex: Error, cwd: string | undefined, start?: [number, number]): string {
	const msg = ex.message || ex.toString();
	if (msg != null && msg.length !== 0) {
		for (const warning of Object.values(GitWarnings)) {
			if (warning.test(msg)) {
				const duration = start !== undefined ? ` [${getDurationMilliseconds(start)}ms]` : '';
				Logger.warn(
					`[${cwd}] Git ${msg
						.trim()
						.replace(/fatal: /g, '')
						.replace(/\r?\n|\r/g, ` ${GlyphChars.Dot} `)}${duration}`,
				);
				return '';
			}
		}

		const match = GitErrors.badRevision.exec(msg);
		if (match != null) {
			const [, ref] = match;

			// Since looking up a ref with ^3 (e.g. looking for untracked files in a stash) can error on some versions of git just ignore it
			if (ref?.endsWith('^3')) return '';
		}
	}

	throw ex;
}

let _uniqueCounterForStdin = 0;
function getStdinUniqueKey(): number {
	if (_uniqueCounterForStdin === Number.MAX_SAFE_INTEGER) {
		_uniqueCounterForStdin = 0;
	}
	return _uniqueCounterForStdin++;
}

type ExitCodeOnlyGitCommandOptions = GitCommandOptions & { exitCodeOnly: true };
export type PushForceOptions = { withLease: true; ifIncludes?: boolean } | { withLease: false; ifIncludes?: never };

const tagErrorAndReason: [RegExp, TagErrorReason][] = [
	[GitErrors.tagAlreadyExists, TagErrorReason.TagAlreadyExists],
	[GitErrors.tagNotFound, TagErrorReason.TagNotFound],
	[GitErrors.invalidTagName, TagErrorReason.InvalidTagName],
	[GitErrors.permissionDenied, TagErrorReason.PermissionDenied],
	[GitErrors.remoteRejected, TagErrorReason.RemoteRejected],
];

export class Git {
	/** Map of running git commands -- avoids running duplicate overlaping commands */
	private readonly pendingCommands = new Map<string, Promise<string | Buffer>>();

	async git(options: ExitCodeOnlyGitCommandOptions, ...args: any[]): Promise<number>;
	async git<T extends string | Buffer>(options: GitCommandOptions, ...args: any[]): Promise<T>;
	async git<T extends string | Buffer>(options: GitCommandOptions, ...args: any[]): Promise<T> {
		if (!workspace.isTrusted) throw new WorkspaceUntrustedError();

		const start = hrtime();

		const { configs, correlationKey, errors: errorHandling, encoding, ...opts } = options;

		const runOpts: RunOptions = {
			...opts,
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

		const gitCommand = `[${runOpts.cwd}] git ${args.join(' ')}`;

		const command = `${correlationKey !== undefined ? `${correlationKey}:` : ''}${
			options?.stdin != null ? `${getStdinUniqueKey()}:` : ''
		}${gitCommand}`;

		let waiting;
		let promise = this.pendingCommands.get(command);
		if (promise === undefined) {
			waiting = false;

			// Fixes https://github.com/gitkraken/vscode-gitlens/issues/73 & https://github.com/gitkraken/vscode-gitlens/issues/161
			// See https://stackoverflow.com/questions/4144417/how-to-handle-asian-characters-in-file-names-in-git-on-os-x
			args.unshift(
				'-c',
				'core.quotepath=false',
				'-c',
				'color.ui=false',
				...(configs != null ? configs : emptyArray),
			);

			if (process.platform === 'win32') {
				args.unshift('-c', 'core.longpaths=true');
			}

			promise = run<T>(await this.path(), args, encoding ?? 'utf8', runOpts);

			this.pendingCommands.set(command, promise);
		} else {
			waiting = true;
			Logger.debug(`${getLoggableScopeBlockOverride('GIT')} ${gitCommand} ${GlyphChars.Dot} waiting...`);
		}

		let exception: Error | undefined;
		try {
			return (await promise) as T;
		} catch (ex) {
			exception = ex;

			switch (errorHandling) {
				case GitErrorHandling.Ignore:
					exception = undefined;
					return '' as T;

				case GitErrorHandling.Throw:
					throw ex;

				default: {
					const result = defaultExceptionHandler(ex, options.cwd, start);
					exception = undefined;
					return result as T;
				}
			}
		} finally {
			this.pendingCommands.delete(command);
			this.logGitCommand(gitCommand, exception, getDurationMilliseconds(start), waiting);
		}
	}

	async gitSpawn(options: GitSpawnOptions, ...args: any[]): Promise<ChildProcess> {
		if (!workspace.isTrusted) throw new WorkspaceUntrustedError();

		const start = hrtime();

		const { cancellation, configs, stdin, stdinEncoding, ...opts } = options;

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

		const gitCommand = `(spawn) [${spawnOpts.cwd as string}] git ${args.join(' ')}`;

		// Fixes https://github.com/gitkraken/vscode-gitlens/issues/73 & https://github.com/gitkraken/vscode-gitlens/issues/161
		// See https://stackoverflow.com/questions/4144417/how-to-handle-asian-characters-in-file-names-in-git-on-os-x
		args.unshift(
			'-c',
			'core.quotepath=false',
			'-c',
			'color.ui=false',
			...(configs !== undefined ? configs : emptyArray),
		);

		if (process.platform === 'win32') {
			args.unshift('-c', 'core.longpaths=true');
		}

		if (cancellation) {
			const aborter = new AbortController();
			spawnOpts.signal = aborter.signal;
			cancellation.onCancellationRequested(() => aborter.abort());
		}

		const proc = spawn(await this.path(), args, spawnOpts);
		if (stdin) {
			proc.stdin?.end(stdin, (stdinEncoding ?? 'utf8') as BufferEncoding);
		}

		let exception: Error | undefined;
		proc.once('error', e => (exception = e));
		proc.once('exit', () => this.logGitCommand(gitCommand, exception, getDurationMilliseconds(start), false));
		return proc;
	}

	private _gitLocation: GitLocation | undefined;
	private _gitLocationPromise: Promise<GitLocation> | undefined;
	private async getLocation(): Promise<GitLocation> {
		if (this._gitLocation == null) {
			if (this._gitLocationPromise == null) {
				this._gitLocationPromise = this._gitLocator();
			}
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

	async version(): Promise<string> {
		return (await this.getLocation()).version;
	}

	async isAtLeastVersion(minimum: string): Promise<boolean> {
		const result = compare(fromString(await this.version()), fromString(minimum));
		return result !== -1;
	}

	maybeIsAtLeastVersion(minimum: string): boolean | undefined {
		return this._gitLocation != null
			? compare(fromString(this._gitLocation.version), fromString(minimum)) !== -1
			: undefined;
	}

	// Git commands

	add(repoPath: string | undefined, pathspecs: string[], ...args: string[]) {
		return this.git<string>({ cwd: repoPath }, 'add', ...args, '--', ...pathspecs);
	}

	apply(repoPath: string | undefined, patch: string, options: { allowConflicts?: boolean } = {}) {
		const params = ['apply', '--whitespace=warn'];
		if (options.allowConflicts) {
			params.push('-3');
		}
		return this.git<string>({ cwd: repoPath, stdin: patch }, ...params);
	}

	async apply2(
		repoPath: string,
		options?: {
			cancellation?: CancellationToken;
			configs?: readonly string[];
			errors?: GitErrorHandling;
			env?: Record<string, unknown>;
			stdin?: string;
		},
		...args: string[]
	) {
		return this.git<string>(
			{
				cwd: repoPath,
				cancellation: options?.cancellation,
				configs: options?.configs ?? gitLogDefaultConfigs,
				env: options?.env,
				errors: options?.errors,
				stdin: options?.stdin,
			},
			'apply',
			...args,
			...(options?.stdin ? ['-'] : emptyArray),
		);
	}

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
	) {
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
				const match = /^--ignore-revs-file\s*=?\s*(.*)$/.exec(options.args[argIndex]);
				if (match != null) {
					options.args.splice(argIndex, 1, '--ignore-revs-file', match[1]);
				}
			}

			params.push(...options.args);
		}

		// Ensure the version of Git supports the --ignore-revs-file flag, otherwise the blame will fail
		let supportsIgnoreRevsFile = this.maybeIsAtLeastVersion('2.23');
		if (supportsIgnoreRevsFile === undefined) {
			supportsIgnoreRevsFile = await this.isAtLeastVersion('2.23');
		}

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
			const blame = await this.git<string>(
				{ cwd: root, stdin: stdin, correlationKey: options?.correlationKey },
				...params,
				'--',
				file,
			);
			return blame;
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

	branch(repoPath: string, ...args: string[]) {
		return this.git<string>({ cwd: repoPath }, 'branch', ...args);
	}

	branch__set_upstream(repoPath: string, branch: string, remote: string, remoteBranch: string) {
		return this.git<string>({ cwd: repoPath }, 'branch', '--set-upstream-to', `${remote}/${remoteBranch}`, branch);
	}

	branchOrTag__containsOrPointsAt(
		repoPath: string,
		refs: string[],
		options?: {
			type?: 'branch' | 'tag';
			all?: boolean;
			mode?: 'contains' | 'pointsAt';
			name?: string;
			remotes?: boolean;
		},
	) {
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

		return this.git<string>(
			{ cwd: repoPath, configs: gitBranchDefaultConfigs, errors: GitErrorHandling.Ignore },
			...params,
		);
	}

	async cat_file__size(repoPath: string, oid: string): Promise<number> {
		const data = await this.git<string>({ cwd: repoPath }, 'cat-file', '-s', oid);
		return data.length ? parseInt(data.trim(), 10) : 0;
	}

	check_ignore(repoPath: string, ...files: string[]) {
		return this.git<string>(
			{ cwd: repoPath, errors: GitErrorHandling.Ignore, stdin: files.join('\0') },
			'check-ignore',
			'-z',
			'--stdin',
		);
	}

	check_mailmap(repoPath: string, author: string) {
		return this.git<string>({ cwd: repoPath, errors: GitErrorHandling.Ignore }, 'check-mailmap', author);
	}

	async check_ref_format(ref: string, repoPath?: string, options: { branch?: boolean } = { branch: true }) {
		const params = ['check-ref-format'];
		if (options.branch) {
			params.push('--branch');
		} else {
			params.push('--normalize');
		}

		try {
			const data = await this.git<string>(
				{ cwd: repoPath ?? '', errors: GitErrorHandling.Throw },
				...params,
				ref,
			);
			return Boolean(data.trim());
		} catch {
			return false;
		}
	}

	checkout(repoPath: string, ref: string, { createBranch, path }: { createBranch?: string; path?: string } = {}) {
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

		return this.git<string>({ cwd: repoPath }, ...params);
	}

	async cherrypick(repoPath: string, sha: string, options: { noCommit?: boolean; errors?: GitErrorHandling } = {}) {
		const params = ['cherry-pick'];
		if (options?.noCommit) {
			params.push('-n');
		}
		params.push(sha);

		try {
			await this.git<string>({ cwd: repoPath, errors: options?.errors }, ...params);
		} catch (ex) {
			const msg: string = ex?.toString() ?? '';
			let reason: CherryPickErrorReason = CherryPickErrorReason.Other;
			if (
				GitErrors.changesWouldBeOverwritten.test(msg) ||
				GitErrors.changesWouldBeOverwritten.test(ex.stderr ?? '')
			) {
				reason = CherryPickErrorReason.AbortedWouldOverwrite;
			} else if (GitErrors.conflict.test(msg) || GitErrors.conflict.test(ex.stdout ?? '')) {
				reason = CherryPickErrorReason.Conflicts;
			}

			throw new CherryPickError(reason, ex, sha);
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

		await this.git<string>({ cwd: parentPath }, 'clone', url, folderPath);

		return folderPath;
	}

	async config__get(key: string, repoPath?: string, options?: { local?: boolean }) {
		const data = await this.git<string>(
			{ cwd: repoPath ?? '', errors: GitErrorHandling.Ignore, local: options?.local },
			'config',
			'--get',
			key,
		);
		return data.length === 0 ? undefined : data.trim();
	}

	async config__get_regex(pattern: string, repoPath?: string, options?: { local?: boolean }) {
		const data = await this.git<string>(
			{ cwd: repoPath ?? '', errors: GitErrorHandling.Ignore, local: options?.local },
			'config',
			'--get-regex',
			pattern,
		);
		return data.length === 0 ? undefined : data.trim();
	}

	async config__set(key: string, value: string | undefined, repoPath?: string) {
		const params = ['config', '--local'];
		if (value == null) {
			params.push('--unset', key);
		} else {
			params.push(key, value);
		}
		await this.git<string>({ cwd: repoPath ?? '', local: true }, ...params);
	}

	async diff(
		repoPath: string,
		fileName: string,
		ref1?: string,
		ref2?: string,
		options: {
			encoding?: string;
			filters?: GitDiffFilter[];
			linesOfContext?: number;
			renames?: boolean;
			similarityThreshold?: number | null;
		} = {},
	): Promise<string> {
		const params = ['diff', '--no-ext-diff', '--minimal'];

		if (options.linesOfContext != null) {
			params.push(`-U${options.linesOfContext}`);
		}

		if (options.renames) {
			params.push(`-M${options.similarityThreshold == null ? '' : `${options.similarityThreshold}%`}`);
		}

		if (options.filters != null && options.filters.length !== 0) {
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
			return await this.git<string>(
				{
					cwd: repoPath,
					configs: gitDiffDefaultConfigs,
					encoding: options.encoding,
				},
				...params,
				'--',
				fileName,
			);
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

	async diff2(
		repoPath: string,
		options?: {
			cancellation?: CancellationToken;
			configs?: readonly string[];
			errors?: GitErrorHandling;
			stdin?: string;
		},
		...args: string[]
	) {
		return this.git<string>(
			{
				cwd: repoPath,
				cancellation: options?.cancellation,
				configs: options?.configs ?? gitLogDefaultConfigs,
				errors: options?.errors,
				stdin: options?.stdin,
			},
			'diff',
			...(options?.stdin ? ['--stdin'] : emptyArray),
			...args,
			...(!args.includes('--') ? ['--'] : emptyArray),
		);
	}

	async diff__contents(
		repoPath: string,
		fileName: string,
		ref: string,
		contents: string,
		options: { encoding?: string; filters?: GitDiffFilter[]; similarityThreshold?: number | null } = {},
	): Promise<string> {
		const params = [
			'diff',
			`-M${options.similarityThreshold == null ? '' : `${options.similarityThreshold}%`}`,
			'--no-ext-diff',
			'-U0',
			'--minimal',
		];

		if (options.filters != null && options.filters.length !== 0) {
			params.push(`--diff-filter=${options.filters.join('')}`);
		}

		// // <sha>^3 signals an untracked file in a stash and if we are trying to find its parent, use the root sha
		// if (ref.endsWith('^3^')) {
		// 	ref = rootSha;
		// }
		// params.push(isUncommittedStaged(ref) ? '--staged' : ref);

		params.push('--no-index');

		try {
			return await this.git<string>(
				{
					cwd: repoPath,
					configs: gitDiffDefaultConfigs,
					encoding: options.encoding,
					stdin: contents,
				},
				...params,
				'--',
				fileName,
				// Pipe the contents to stdin
				'-',
			);
		} catch (ex) {
			if (ex instanceof RunError && ex.stdout) {
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

	diff__name_status(
		repoPath: string,
		ref1?: string,
		ref2?: string,
		options?: { filters?: GitDiffFilter[]; path?: string; similarityThreshold?: number },
	) {
		const params = [
			'diff',
			'--name-status',
			`-M${options?.similarityThreshold == null ? '' : `${options?.similarityThreshold}%`}`,
			'--no-ext-diff',
			'-z',
		];
		if (options?.filters?.length) {
			params.push(`--diff-filter=${options.filters.join('')}`);
		}
		if (ref1) {
			params.push(ref1);
		}
		if (ref2) {
			params.push(ref2);
		}

		params.push('--');
		if (options?.path) {
			params.push(options.path);
		}

		return this.git<string>({ cwd: repoPath, configs: gitDiffDefaultConfigs }, ...params);
	}

	async diff__shortstat(repoPath: string, ref?: string) {
		const params = ['diff', '--shortstat', '--no-ext-diff'];
		if (ref) {
			params.push(ref);
		}

		try {
			return await this.git<string>({ cwd: repoPath, configs: gitDiffDefaultConfigs }, ...params, '--');
		} catch (ex) {
			const msg: string = ex?.toString() ?? '';
			if (GitErrors.noMergeBase.test(msg)) {
				return undefined;
			}

			throw ex;
		}
	}

	difftool(
		repoPath: string,
		fileName: string,
		tool: string,
		options: { ref1?: string; ref2?: string; staged?: boolean } = {},
	) {
		const params = ['difftool', '--no-prompt', `--tool=${tool}`];
		if (options.staged) {
			params.push('--staged');
		}
		if (options.ref1) {
			params.push(options.ref1);
		}
		if (options.ref2) {
			params.push(options.ref2);
		}

		return this.git<string>({ cwd: repoPath }, ...params, '--', fileName);
	}

	difftool__dir_diff(repoPath: string, tool: string, ref1: string, ref2?: string) {
		const params = ['difftool', '--dir-diff', `--tool=${tool}`, ref1];
		if (ref2) {
			params.push(ref2);
		}

		return this.git<string>({ cwd: repoPath }, ...params);
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
			  } = {},
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
			void (await this.git<string>({ cwd: repoPath }, ...params));
		} catch (ex) {
			const msg: string = ex?.toString() ?? '';
			let reason: FetchErrorReason = FetchErrorReason.Other;
			if (GitErrors.noFastForward.test(msg) || GitErrors.noFastForward.test(ex.stderr ?? '')) {
				reason = FetchErrorReason.NoFastForward;
			} else if (
				GitErrors.noRemoteRepositorySpecified.test(msg) ||
				GitErrors.noRemoteRepositorySpecified.test(ex.stderr ?? '')
			) {
				reason = FetchErrorReason.NoRemote;
			} else if (GitErrors.remoteConnection.test(msg) || GitErrors.remoteConnection.test(ex.stderr ?? '')) {
				reason = FetchErrorReason.RemoteConnection;
			}

			throw new FetchError(reason, ex, options?.branch, options?.remote);
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
		},
	): Promise<void> {
		const params = ['push'];

		if (options.force != null) {
			if (options.force.withLease) {
				params.push('--force-with-lease');
				if (options.force.ifIncludes) {
					if (await this.isAtLeastVersion('2.30.0')) {
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
		}

		try {
			void (await this.git<string>({ cwd: repoPath }, ...params));
		} catch (ex) {
			const msg: string = ex?.toString() ?? '';
			let reason: PushErrorReason = PushErrorReason.Other;
			if (GitErrors.remoteAhead.test(msg) || GitErrors.remoteAhead.test(ex.stderr ?? '')) {
				reason = PushErrorReason.RemoteAhead;
			} else if (GitWarnings.tipBehind.test(msg) || GitWarnings.tipBehind.test(ex.stderr ?? '')) {
				reason = PushErrorReason.TipBehind;
			} else if (GitErrors.pushRejected.test(msg) || GitErrors.pushRejected.test(ex.stderr ?? '')) {
				if (options?.force?.withLease) {
					if (/! \[rejected\].*\(stale info\)/m.test(ex.stderr || '')) {
						reason = PushErrorReason.PushRejectedWithLease;
					} else if (
						options.force.ifIncludes &&
						/! \[rejected\].*\(remote ref updated since checkout\)/m.test(ex.stderr || '')
					) {
						reason = PushErrorReason.PushRejectedWithLeaseIfIncludes;
					} else {
						reason = PushErrorReason.PushRejected;
					}
				} else {
					reason = PushErrorReason.PushRejected;
				}
			} else if (GitErrors.permissionDenied.test(msg) || GitErrors.permissionDenied.test(ex.stderr ?? '')) {
				reason = PushErrorReason.PermissionDenied;
			} else if (GitErrors.remoteConnection.test(msg) || GitErrors.remoteConnection.test(ex.stderr ?? '')) {
				reason = PushErrorReason.RemoteConnection;
			} else if (GitErrors.noUpstream.test(msg) || GitErrors.noUpstream.test(ex.stderr ?? '')) {
				reason = PushErrorReason.NoUpstream;
			}

			throw new PushError(reason, ex, options?.branch, options?.remote);
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
			void (await this.git<string>({ cwd: repoPath }, ...params));
		} catch (ex) {
			const msg: string = ex?.toString() ?? '';
			let reason: PullErrorReason = PullErrorReason.Other;
			if (GitErrors.conflict.test(msg) || GitErrors.conflict.test(ex.stdout ?? '')) {
				reason = PullErrorReason.Conflict;
			} else if (
				GitErrors.noUserNameConfigured.test(msg) ||
				GitErrors.noUserNameConfigured.test(ex.stderr ?? '')
			) {
				reason = PullErrorReason.GitIdentity;
			} else if (GitErrors.remoteConnection.test(msg) || GitErrors.remoteConnection.test(ex.stderr ?? '')) {
				reason = PullErrorReason.RemoteConnection;
			} else if (GitErrors.unstagedChanges.test(msg) || GitErrors.unstagedChanges.test(ex.stderr ?? '')) {
				reason = PullErrorReason.UnstagedChanges;
			} else if (GitErrors.unmergedFiles.test(msg) || GitErrors.unmergedFiles.test(ex.stderr ?? '')) {
				reason = PullErrorReason.UnmergedFiles;
			} else if (GitErrors.commitChangesFirst.test(msg) || GitErrors.commitChangesFirst.test(ex.stderr ?? '')) {
				reason = PullErrorReason.UncommittedChanges;
			} else if (
				GitErrors.changesWouldBeOverwritten.test(msg) ||
				GitErrors.changesWouldBeOverwritten.test(ex.stderr ?? '')
			) {
				reason = PullErrorReason.OverwrittenChanges;
			} else if (GitErrors.cantLockRef.test(msg) || GitErrors.cantLockRef.test(ex.stderr ?? '')) {
				reason = PullErrorReason.RefLocked;
			} else if (
				GitErrors.rebaseMultipleBranches.test(msg) ||
				GitErrors.rebaseMultipleBranches.test(ex.stderr ?? '')
			) {
				reason = PullErrorReason.RebaseMultipleBranches;
			} else if (GitErrors.tagConflict.test(msg) || GitErrors.tagConflict.test(ex.stderr ?? '')) {
				reason = PullErrorReason.TagConflict;
			}

			throw new PullError(reason, ex);
		}
	}

	for_each_ref__branch(repoPath: string, options: { all: boolean } = { all: false }) {
		const params = ['for-each-ref', `--format=${parseGitBranchesDefaultFormat}`, 'refs/heads'];
		if (options.all) {
			params.push('refs/remotes');
		}

		return this.git<string>({ cwd: repoPath }, ...params);
	}

	log(
		repoPath: string,
		options?: {
			cancellation?: CancellationToken;
			configs?: readonly string[];
			ref?: string;
			errors?: GitErrorHandling;
			stdin?: string;
		},
		...args: string[]
	) {
		return this.git<string>(
			{
				cwd: repoPath,
				cancellation: options?.cancellation,
				configs: options?.configs ?? gitLogDefaultConfigs,
				errors: options?.errors,
				stdin: options?.stdin,
			},
			'log',
			...(options?.stdin ? ['--stdin'] : emptyArray),
			...args,
			...(options?.ref && !isUncommittedStaged(options.ref) ? [options.ref] : emptyArray),
			...(!args.includes('--') ? ['--'] : emptyArray),
		);
	}

	async logStreamTo(
		repoPath: string,
		sha: string,
		limit: number,
		options?: { configs?: readonly string[]; stdin?: string },
		...args: string[]
	): Promise<[data: string[], count: number]> {
		const params = ['log', ...args];
		if (options?.stdin) {
			params.push('--stdin');
		}

		const proc = await this.gitSpawn(
			{ cwd: repoPath, configs: options?.configs ?? gitLogDefaultConfigs, stdin: options?.stdin },
			...params,
			'--',
		);

		const shaRegex = getShaInLogRegex(sha);

		let found = false;
		let count = 0;

		return new Promise<[data: string[], count: number]>((resolve, reject) => {
			const errData: string[] = [];
			const data: string[] = [];

			function onErrData(s: string) {
				errData.push(s);
			}

			function onError(e: Error) {
				reject(e);
			}

			function onExit(exitCode: number) {
				if (exitCode !== 0) {
					reject(new Error(errData.join('')));
				}

				resolve([data, count]);
			}

			function onData(s: string) {
				data.push(s);
				// eslint-disable-next-line no-control-regex
				count += s.match(/(?:^\x00*|\x00\x00)[0-9a-f]{40}\x00/g)?.length ?? 0;

				if (!found && shaRegex.test(s)) {
					found = true;
					// Buffer a bit past the sha we are looking for
					if (count > limit) {
						limit = count + 50;
					}
				}

				if (!found || count <= limit) return;

				proc.removeListener('exit', onExit);
				proc.removeListener('error', onError);
				proc.stdout!.removeListener('data', onData);
				proc.stderr!.removeListener('data', onErrData);
				proc.kill();

				resolve([data, count]);
			}

			proc.on('error', onError);
			proc.on('exit', onExit);

			proc.stdout!.setEncoding('utf8');
			proc.stdout!.on('data', onData);

			proc.stderr!.setEncoding('utf8');
			proc.stderr!.on('data', onErrData);
		});
	}

	log__file(
		repoPath: string,
		fileName: string,
		ref: string | undefined,
		{
			all,
			argsOrFormat,
			// TODO@eamodio remove this in favor of argsOrFormat
			fileMode = 'full',
			filters,
			limit,
			merges = false,
			ordering,
			renames = true,
			reverse = false,
			since,
			skip,
			startLine,
			endLine,
		}: {
			all?: boolean;
			argsOrFormat?: string | string[];
			// TODO@eamodio remove this in favor of argsOrFormat
			fileMode?: 'full' | 'simple' | 'none';
			filters?: GitDiffFilter[];
			limit?: number;
			merges?: boolean;
			ordering?: 'date' | 'author-date' | 'topo' | null;
			renames?: boolean;
			reverse?: boolean;
			since?: string;
			skip?: number;
			startLine?: number;
			endLine?: number;
		} = {},
	) {
		const [file, root] = splitPath(fileName, repoPath, true);

		if (argsOrFormat == null) {
			argsOrFormat = [`--format=${all ? parseGitLogAllFormat : parseGitLogDefaultFormat}`];
		}

		if (typeof argsOrFormat === 'string') {
			argsOrFormat = [`--format=${argsOrFormat}`];
		}

		const params = ['log', ...argsOrFormat];

		if (ordering) {
			params.push(`--${ordering}-order`);
		}

		if (limit && !reverse) {
			params.push(`-n${limit + 1}`);
		}

		if (skip) {
			params.push(`--skip=${skip}`);
		}

		if (since) {
			params.push(`--since="${since}"`);
		}

		if (all) {
			params.push('--all', '--single-worktree');
		}

		if (merges) {
			params.push('--first-parent');
		}

		// Can't allow rename detection (`--follow`) if a `startLine` is specified
		if (renames && startLine != null) {
			renames = false;
		}

		if (renames) {
			params.push('--follow');
		}

		if (filters != null && filters.length !== 0) {
			params.push(`--diff-filter=${filters.join('')}`);
		}

		if (fileMode !== 'none') {
			if (startLine == null) {
				// If this is the log of a folder, use `--name-status` to match non-file logs (for parsing)
				if (fileMode === 'simple' || isFolderGlob(file)) {
					params.push('--name-status');
				} else {
					params.push('--numstat', '--summary');
				}
			} else {
				// Don't include `--name-status`, `--numstat`, or `--summary` because they aren't supported with `-L`
				params.push(`-L ${startLine},${endLine == null ? startLine : endLine}:${file}`);
			}
		}

		if (ref && !isUncommittedStaged(ref)) {
			// If we are reversing, we must add a range (with HEAD) because we are using --ancestry-path for better reverse walking
			if (reverse) {
				params.push('--reverse', '--ancestry-path', `${ref}..HEAD`);
			} else {
				params.push(ref);
			}
		}

		// Don't specify a file spec when using a line number (so say the git docs)
		if (startLine == null) {
			params.push('--', file);
		}

		return this.git<string>({ cwd: root, configs: gitLogDefaultConfigs }, ...params);
	}

	async log__file_recent(
		repoPath: string,
		fileName: string,
		options?: {
			ordering?: 'date' | 'author-date' | 'topo' | null;
			ref?: string;
			similarityThreshold?: number | null;
			cancellation?: CancellationToken;
		},
	) {
		const params = [
			'log',
			`-M${options?.similarityThreshold == null ? '' : `${options?.similarityThreshold}%`}`,
			'-n1',
			'--format=%H',
		];

		if (options?.ordering) {
			params.push(`--${options?.ordering}-order`);
		}

		if (options?.ref) {
			params.push(options?.ref);
		}

		const data = await this.git<string>(
			{
				cancellation: options?.cancellation,
				cwd: repoPath,
				configs: gitLogDefaultConfigs,
				errors: GitErrorHandling.Ignore,
			},
			...params,
			'--',
			fileName,
		);
		return data.length === 0 ? undefined : data.trim();
	}

	async log__find_object(
		repoPath: string,
		oid: string,
		ref: string,
		ordering: 'date' | 'author-date' | 'topo' | null,
		file?: string,
		cancellation?: CancellationToken,
	) {
		const params = ['log', '-n1', '--no-renames', '--format=%H', `--find-object=${oid}`, ref];

		if (ordering) {
			params.push(`--${ordering}-order`);
		}

		if (file) {
			params.push('--', file);
		}

		const data = await this.git<string>(
			{
				cancellation: cancellation,
				cwd: repoPath,
				configs: gitLogDefaultConfigs,
				errors: GitErrorHandling.Ignore,
			},
			...params,
		);
		return data.length === 0 ? undefined : data.trim();
	}

	async log__recent(repoPath: string, ordering?: 'date' | 'author-date' | 'topo' | null) {
		const params = ['log', '-n1', '--format=%H'];

		if (ordering) {
			params.push(`--${ordering}-order`);
		}

		const data = await this.git<string>(
			{ cwd: repoPath, configs: gitLogDefaultConfigs, errors: GitErrorHandling.Ignore },
			...params,
			'--',
		);

		return data.length === 0 ? undefined : data.trim();
	}

	async log__recent_committerdate(repoPath: string, ordering?: 'date' | 'author-date' | 'topo' | null) {
		const params = ['log', '-n1', '--format=%ct'];

		if (ordering) {
			params.push(`--${ordering}-order`);
		}

		const data = await this.git<string>(
			{ cwd: repoPath, configs: gitLogDefaultConfigs, errors: GitErrorHandling.Ignore },
			...params,
			'--',
		);

		return data.length === 0 ? undefined : data.trim();
	}

	log__search(
		repoPath: string,
		search: string[] = emptyArray,
		options?: {
			limit?: number;
			ordering?: 'date' | 'author-date' | 'topo' | null;
			skip?: number;
			shas?: Set<string>;
			stdin?: string;
		},
	) {
		if (options?.shas != null) {
			const stdin = join(options.shas, '\n');
			return this.git<string>(
				{ cwd: repoPath, stdin: stdin },
				'show',
				'--stdin',
				'--name-status',
				`--format=${parseGitLogDefaultFormat}`,
				'--use-mailmap',
			);
		}

		let files;
		[search, files] = splitAt(search, search.indexOf('--'));

		return this.git<string>(
			{ cwd: repoPath, configs: ['-C', repoPath, ...gitLogDefaultConfigs], stdin: options?.stdin },
			'log',
			...(options?.stdin ? ['--stdin'] : emptyArray),
			'--name-status',
			`--format=${parseGitLogDefaultFormat}`,
			'--use-mailmap',
			...search,
			...(options?.ordering ? [`--${options.ordering}-order`] : emptyArray),
			...(options?.limit ? [`-n${options.limit + 1}`] : emptyArray),
			...(options?.skip ? [`--skip=${options.skip}`] : emptyArray),
			...files,
		);
	}

	//  log__shortstat(repoPath: string, options: { ref?: string }) {
	//     const params = ['log', '--shortstat', '--oneline'];
	//     if (options.ref && !isUncommittedStaged(options.ref)) {
	//         params.push(options.ref);
	//     }
	//     return this.git<string>({ cwd: repoPath, configs: gitLogDefaultConfigs }, ...params, '--');
	// }

	async ls_files(
		repoPath: string,
		fileName: string,
		options?: { ref?: string; untracked?: boolean },
	): Promise<string | undefined> {
		const params = ['ls-files'];
		if (options?.ref) {
			if (!isUncommitted(options.ref)) {
				params.push(`--with-tree=${options.ref}`);
			} else if (isUncommittedStaged(options.ref)) {
				params.push('--stage');
			}
		}

		if (!options?.ref && options?.untracked) {
			params.push('-o');
		}

		const data = await this.git<string>(
			{ cwd: repoPath, errors: GitErrorHandling.Ignore },
			...params,
			'--',
			fileName,
		);
		return data.length === 0 ? undefined : data.trim();
	}

	ls_remote(repoPath: string, remote: string, ref?: string) {
		return this.git<string>({ cwd: repoPath }, 'ls-remote', remote, ref);
	}

	ls_remote__HEAD(repoPath: string, remote: string) {
		return this.git<string>({ cwd: repoPath }, 'ls-remote', '--symref', remote, 'HEAD');
	}

	async ls_tree(repoPath: string, ref: string, path?: string) {
		const params = ['ls-tree'];
		if (path) {
			params.push('-l', ref, '--', path);
		} else {
			params.push('-lrt', ref, '--');
		}
		const data = await this.git<string>({ cwd: repoPath, errors: GitErrorHandling.Ignore }, ...params);
		return data.length === 0 ? undefined : data.trim();
	}

	merge_base(repoPath: string, ref1: string, ref2: string, options?: { forkPoint?: boolean }) {
		const params = ['merge-base'];
		if (options?.forkPoint) {
			params.push('--fork-point');
		}

		return this.git<string>({ cwd: repoPath }, ...params, ref1, ref2);
	}

	async merge_base__is_ancestor(repoPath: string, ref1: string, ref2: string): Promise<boolean> {
		const params = ['merge-base', '--is-ancestor'];
		const exitCode = await this.git({ cwd: repoPath, exitCodeOnly: true }, ...params, ref1, ref2);
		return exitCode === 0;
	}

	async merge_tree(repoPath: string, branch: string, target: string, ...args: string[]): Promise<string> {
		try {
			return await this.git<string>(
				{ cwd: repoPath, errors: GitErrorHandling.Throw },
				'merge-tree',
				...args,
				branch,
				target,
			);
		} catch (ex) {
			const msg = ex?.toString() ?? '';

			if (GitErrors.notAValidObjectName.test(msg)) {
				throw new Error(
					`'${target}' or '${branch}' not found - ensure the branches exist and are fully qualified (e.g. 'refs/heads/main')`,
				);
			}
			if (GitErrors.badRevision.test(msg)) {
				throw new Error(`Invalid branch name: ${msg.slice(msg.indexOf("'"))}`);
			}
			if (GitErrors.noMergeBase.test(msg)) {
				throw new Error(`Unable to merge '${branch}' and '${target}' as they have no common ancestor`);
			}

			if (ex instanceof RunError) return ex.stdout;

			debugger;
			return '';
		}
	}

	reflog(
		repoPath: string,
		options?: {
			cancellation?: CancellationToken;
			configs?: readonly string[];
			ref?: string;
			errors?: GitErrorHandling;
			stdin?: string;
		},
		...args: string[]
	): Promise<string> {
		return this.git<string>(
			{
				cwd: repoPath,
				cancellation: options?.cancellation,
				configs: options?.configs ?? gitLogDefaultConfigs,
				errors: options?.errors,
				stdin: options?.stdin,
			},
			'reflog',
			...(options?.stdin ? ['--stdin'] : emptyArray),
			...args,
			...(options?.ref && !isUncommittedStaged(options.ref) ? [options.ref] : emptyArray),
			...(!args.includes('--') ? ['--'] : emptyArray),
		);
	}

	remote(repoPath: string): Promise<string> {
		return this.git<string>({ cwd: repoPath }, 'remote', '-v');
	}

	remote__add(repoPath: string, name: string, url: string, options?: { fetch?: boolean }) {
		const params = ['remote', 'add'];
		if (options?.fetch) {
			params.push('-f');
		}
		return this.git<string>({ cwd: repoPath }, ...params, name, url);
	}

	remote__prune(repoPath: string, name: string) {
		return this.git<string>({ cwd: repoPath }, 'remote', 'prune', name);
	}

	remote__remove(repoPath: string, name: string) {
		return this.git<string>({ cwd: repoPath }, 'remote', 'remove', name);
	}

	remote__get_url(repoPath: string, remote: string): Promise<string> {
		return this.git<string>({ cwd: repoPath }, 'remote', 'get-url', remote);
	}

	reset(repoPath: string | undefined, pathspecs: string[]) {
		return this.git<string>({ cwd: repoPath }, 'reset', '-q', '--', ...pathspecs);
	}

	async rev_list(
		repoPath: string,
		ref: string,
		options?: { all?: boolean; maxParents?: number; since?: string },
	): Promise<string[] | undefined> {
		const params = ['rev-list'];
		if (options?.all) {
			params.push('--all');
		}

		if (options?.maxParents != null) {
			params.push(`--max-parents=${options.maxParents}`);
		}

		if (options?.since) {
			params.push(`--since="${options.since}"`, '--date-order');
		}

		const rawData = await this.git<string>(
			{ cwd: repoPath, errors: GitErrorHandling.Ignore },
			...params,
			ref,
			'--',
		);
		const data = rawData.trim().split('\n');
		if (data.length === 0) return undefined;

		return data;
	}

	async rev_list__count(repoPath: string, ref: string, all?: boolean): Promise<number | undefined> {
		const params = ['rev-list', '--count'];
		if (all) {
			params.push('--all');
		}

		let data = await this.git<string>({ cwd: repoPath, errors: GitErrorHandling.Ignore }, ...params, ref, '--');
		data = data.trim();
		if (data.length === 0) return undefined;

		const result = parseInt(data, 10);
		return isNaN(result) ? undefined : result;
	}

	async rev_list__left_right(
		repoPath: string,
		range: GitRevisionRange,
		authors?: GitUser[] | undefined,
		excludeMerges?: boolean,
	): Promise<{ left: number; right: number } | undefined> {
		const params = ['rev-list', '--left-right', '--count'];

		if (authors?.length) {
			params.push(...authors.map(a => `--author=^${a.name} <${a.email}>$`));
		}

		if (excludeMerges) {
			params.push('--no-merges');
		}

		const data = await this.git<string>({ cwd: repoPath, errors: GitErrorHandling.Ignore }, ...params, range, '--');
		if (data.length === 0) return undefined;

		const parts = data.split('\t');
		if (parts.length !== 2) return undefined;

		const [left, right] = parts;
		const result = {
			left: parseInt(left, 10),
			right: parseInt(right, 10),
		};

		if (isNaN(result.left) || isNaN(result.right)) return undefined;

		return result;
	}

	async rev_parse(repoPath: string, ref: string): Promise<string | undefined> {
		const data = await this.git<string>({ cwd: repoPath, errors: GitErrorHandling.Ignore }, 'rev-parse', ref);
		return data.length === 0 ? undefined : data.trim();
	}

	async rev_parse__currentBranch(
		repoPath: string,
		ordering: 'date' | 'author-date' | 'topo' | null,
	): Promise<[string, string | undefined] | undefined> {
		try {
			const data = await this.git<string>(
				{ cwd: repoPath, errors: GitErrorHandling.Throw },
				'rev-parse',
				'--abbrev-ref',
				'--symbolic-full-name',
				'@',
				'@{u}',
				'--',
			);
			return [data, undefined];
		} catch (ex) {
			const msg: string = ex?.toString() ?? '';
			if (GitErrors.badRevision.test(msg) || GitWarnings.noUpstream.test(msg)) {
				if (ex.stdout != null && ex.stdout.length !== 0) {
					return [ex.stdout, undefined];
				}

				try {
					const data = await this.symbolic_ref(repoPath, 'HEAD');
					if (data != null) return [data.trim(), undefined];
				} catch {}

				try {
					const data = await this.symbolic_ref(repoPath, 'refs/remotes/origin/HEAD');
					if (data != null) return [data.trim().substring('origin/'.length), undefined];
				} catch (ex) {
					if (/is not a symbolic ref/.test(ex.stderr)) {
						try {
							const data = await this.ls_remote__HEAD(repoPath, 'origin');
							if (data != null) {
								const match = /ref:\s(\S+)\s+HEAD/m.exec(data);
								if (match != null) {
									const [, branch] = match;
									return [branch.substring('refs/heads/'.length), undefined];
								}
							}
						} catch {}
					}
				}

				const defaultBranch = (await this.config__get('init.defaultBranch', repoPath)) ?? 'main';
				const branchConfig = await this.config__get_regex(`branch\\.${defaultBranch}\\.+`, repoPath, {
					local: true,
				});

				let remote;
				let remoteBranch;

				if (branchConfig) {
					let match = /^branch\..+\.remote\s(.+)$/m.exec(branchConfig);
					if (match != null) {
						remote = match[1];
					}

					match = /^branch\..+\.merge\srefs\/heads\/(.+)$/m.exec(branchConfig);
					if (match != null) {
						remoteBranch = match[1];
					}
				}
				return [`${defaultBranch}${remote && remoteBranch ? `\n${remote}/${remoteBranch}` : ''}`, undefined];
			}

			if (GitWarnings.headNotABranch.test(msg)) {
				const sha = await this.log__recent(repoPath, ordering);
				if (sha === undefined) return undefined;

				return [`(HEAD detached at ${shortenRevision(sha)})`, sha];
			}

			defaultExceptionHandler(ex, repoPath);
			return undefined;
		}
	}

	async rev_parse__git_dir(cwd: string): Promise<{ path: string; commonPath?: string } | undefined> {
		const data = await this.git<string>(
			{ cwd: cwd, errors: GitErrorHandling.Ignore },
			'rev-parse',
			'--git-dir',
			'--git-common-dir',
		);
		if (data.length === 0) return undefined;

		// Keep trailing spaces which are part of the directory name
		let [dotGitPath, commonDotGitPath] = data.split('\n').map(r => r.trimStart());

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
		let data;

		if (!workspace.isTrusted) {
			// Check if the folder is a bare clone: if it has a file named HEAD && `rev-parse --show-cdup` is empty
			try {
				accessSync(joinPaths(cwd, 'HEAD'));
				data = await this.git<string>(
					{ cwd: cwd, errors: GitErrorHandling.Throw, configs: ['-C', cwd] },
					'rev-parse',
					'--show-cdup',
				);
				if (data.trim() === '') {
					Logger.log(`Skipping (untrusted workspace); bare clone repository detected in '${cwd}'`);
					return emptyArray as [];
				}
			} catch {
				// If this throw, we should be good to open the repo (e.g. HEAD doesn't exist)
			}
		}

		try {
			data = await this.git<string>({ cwd: cwd, errors: GitErrorHandling.Throw }, 'rev-parse', '--show-toplevel');
			// Make sure to normalize: https://github.com/git-for-windows/git/issues/2478
			// Keep trailing spaces which are part of the directory name
			return data.length === 0
				? (emptyArray as [])
				: [true, normalizePath(data.trimStart().replace(/[\r|\n]+$/, ''))];
		} catch (ex) {
			if (ex instanceof WorkspaceUntrustedError) return emptyArray as [];

			const unsafeMatch =
				/^fatal: detected dubious ownership in repository at '([^']+)'[\s\S]*git config --global --add safe\.directory '?([^'\n]+)'?$/m.exec(
					ex.stderr,
				);
			if (unsafeMatch?.length === 3) {
				Logger.log(
					`Skipping; unsafe repository detected in '${unsafeMatch[1]}'; run 'git config --global --add safe.directory ${unsafeMatch[2]}' to allow it`,
				);
				return [false];
			}

			const inDotGit = /this operation must be run in a work tree/.test(ex.stderr);
			// Check if we are in a bare clone
			if (inDotGit && workspace.isTrusted) {
				data = await this.git<string>(
					{ cwd: cwd, errors: GitErrorHandling.Ignore },
					'rev-parse',
					'--is-bare-repository',
				);
				if (data.trim() === 'true') {
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

	async rev_parse__verify(repoPath: string, ref: string, fileName?: string): Promise<string | undefined> {
		const params = ['rev-parse', '--verify'];

		if (await this.isAtLeastVersion('2.30')) {
			params.push('--end-of-options');
		}

		const data = await this.git<string>(
			{ cwd: repoPath, errors: GitErrorHandling.Ignore },
			...params,
			fileName ? `${ref}:./${fileName}` : `${ref}^{commit}`,
		);
		return data.length === 0 ? undefined : data.trim();
	}

	show(
		repoPath: string,
		options?: { cancellation?: CancellationToken; configs?: readonly string[] },
		...args: string[]
	) {
		return this.git<string>(
			{
				cwd: repoPath,
				cancellation: options?.cancellation,
				configs: options?.configs ?? gitLogDefaultConfigs,
			},
			'show',
			...args,
			...(!args.includes('--') ? ['--'] : emptyArray),
		);
	}

	async show__content<TOut extends string | Buffer>(
		repoPath: string | undefined,
		fileName: string,
		ref: string,
		options?: {
			encoding?: 'binary' | 'ascii' | 'utf8' | 'utf16le' | 'ucs2' | 'base64' | 'latin1' | 'hex' | 'buffer';
		},
	): Promise<TOut | undefined> {
		const [file, root] = splitPath(fileName, repoPath, true);

		if (isUncommittedStaged(ref)) {
			ref = ':';
		}
		if (isUncommitted(ref)) throw new Error(`ref=${ref} is uncommitted`);

		const opts: GitCommandOptions = {
			configs: gitLogDefaultConfigs,
			cwd: root,
			encoding: options?.encoding ?? 'utf8',
			errors: GitErrorHandling.Throw,
		};
		const args = ref.endsWith(':') ? `${ref}./${file}` : `${ref}:./${file}`;

		try {
			const data = await this.git<TOut>(opts, 'show', '--textconv', args, '--');
			return data;
		} catch (ex) {
			const msg: string = ex?.toString() ?? '';
			if (ref === ':' && GitErrors.badRevision.test(msg)) {
				return this.show__content<TOut>(repoPath, fileName, 'HEAD:', options);
			}

			if (
				GitErrors.badRevision.test(msg) ||
				GitWarnings.notFound.test(msg) ||
				GitWarnings.foundButNotInRevision.test(msg)
			) {
				return undefined;
			}

			return defaultExceptionHandler(ex, opts.cwd) as TOut;
		}
	}

	stash__apply(repoPath: string, stashName: string, deleteAfter: boolean): Promise<string | undefined> {
		if (!stashName) return Promise.resolve(undefined);
		return this.git<string>({ cwd: repoPath }, 'stash', deleteAfter ? 'pop' : 'apply', stashName);
	}

	async stash__rename(repoPath: string, stashName: string, ref: string, message: string, stashOnRef?: string) {
		await this.stash__delete(repoPath, stashName, ref);
		return this.git<string>(
			{ cwd: repoPath },
			'stash',
			'store',
			'-m',
			stashOnRef ? `On ${stashOnRef}: ${message}` : message,
			ref,
		);
	}

	async stash__delete(repoPath: string, stashName: string, ref?: string) {
		if (!stashName) return undefined;

		if (ref) {
			const stashRef = await this.git<string>(
				{ cwd: repoPath, errors: GitErrorHandling.Ignore },
				'show',
				'--format=%H',
				'--no-patch',
				stashName,
			);
			if (stashRef?.trim() !== ref) {
				throw new Error('Unable to delete stash; mismatch with stash number');
			}
		}

		return this.git<string>({ cwd: repoPath }, 'stash', 'drop', stashName);
	}

	stash__list(
		repoPath: string,
		{ args, similarityThreshold }: { args?: string[]; similarityThreshold?: number | null },
	) {
		if (args == null) {
			args = ['--name-status'];
		}

		return this.git<string>(
			{ cwd: repoPath },
			'stash',
			'list',
			...args,
			`-M${similarityThreshold == null ? '' : `${similarityThreshold}%`}`,
		);
	}

	async stash__create(repoPath: string): Promise<string | undefined> {
		const params = ['stash', 'create'];

		const data = await this.git<string>({ cwd: repoPath }, ...params);
		return data?.trim() || undefined;
	}

	async stash__store(repoPath: string, sha: string, message?: string): Promise<void> {
		const params = ['stash', 'store'];

		if (message) {
			params.push('-m', message);
		}

		params.push(sha);

		await this.git<string>({ cwd: repoPath }, ...params);
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

		if (options?.keepIndex && !options?.includeUntracked) {
			params.push('--keep-index');
		}

		if (options?.onlyStaged) {
			if (await this.isAtLeastVersion('2.35')) {
				params.push('--staged');
			} else {
				throw new Error('Git version 2.35 or higher is required for --staged');
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
			const data = await this.git<string>({ cwd: repoPath, stdin: stdin }, ...params);
			if (data.includes('No local changes to save')) {
				throw new StashPushError(StashPushErrorReason.NothingToSave);
				return;
			}
		} catch (ex) {
			if (
				ex instanceof RunError &&
				ex.stdout.includes('Saved working directory and index state') &&
				ex.stderr.includes('Cannot remove worktree changes')
			) {
				throw new StashPushError(StashPushErrorReason.ConflictingStagedAndUnstagedLines);
			}
			throw ex;
		}
	}

	stash(repoPath: string, ...args: string[]) {
		return this.git<string>({ cwd: repoPath }, 'stash', ...args);
	}

	async status(
		repoPath: string,
		porcelainVersion: number = 1,
		options?: { similarityThreshold?: number },
	): Promise<string> {
		const params = [
			'status',
			porcelainVersion >= 2 ? `--porcelain=v${porcelainVersion}` : '--porcelain',
			'--branch',
			'-u',
		];
		if (await this.isAtLeastVersion('2.18')) {
			params.push(
				`--find-renames${options?.similarityThreshold == null ? '' : `=${options.similarityThreshold}%`}`,
			);
		}

		return this.git<string>(
			{ cwd: repoPath, configs: gitStatusDefaultConfigs, env: { GIT_OPTIONAL_LOCKS: '0' } },
			...params,
			'--',
		);
	}

	symbolic_ref(repoPath: string, ref: string) {
		return this.git<string>({ cwd: repoPath }, 'symbolic-ref', '--short', ref);
	}

	async tag(repoPath: string, ...args: string[]) {
		try {
			const output = await this.git<string>({ cwd: repoPath }, 'tag', ...args);
			return output;
		} catch (ex) {
			const msg: string = ex?.toString() ?? '';
			for (const [error, reason] of tagErrorAndReason) {
				if (error.test(msg) || error.test(ex.stderr ?? '')) {
					throw new TagError(reason, ex);
				}
			}
			throw new TagError(TagErrorReason.Other, ex);
		}
	}

	worktree__add(
		repoPath: string,
		path: string,
		{
			commitish,
			createBranch,
			detach,
			force,
		}: { commitish?: string; createBranch?: string; detach?: boolean; force?: boolean } = {},
	) {
		const params = ['worktree', 'add'];
		if (force) {
			params.push('--force');
		}
		if (createBranch) {
			params.push('-b', createBranch);
		}
		if (detach) {
			params.push('--detach');
		}
		params.push(path);
		if (commitish) {
			params.push(commitish);
		}
		return this.git<string>({ cwd: repoPath }, ...params);
	}

	worktree__list(repoPath: string) {
		return this.git<string>({ cwd: repoPath }, 'worktree', 'list', '--porcelain');
	}

	worktree__remove(repoPath: string, worktree: string, { force }: { force?: boolean } = {}) {
		const params = ['worktree', 'remove'];
		if (force) {
			params.push('--force');
		}
		params.push(worktree);

		return this.git<string>({ cwd: repoPath, errors: GitErrorHandling.Throw }, ...params);
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
			contents = options?.trim ?? true ? contents.trim() : contents;

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
	@log()
	async runGitCommandViaTerminal(cwd: string, command: string, args: string[], options?: { execute?: boolean }) {
		const scope = getLogScope();

		const location = await this.getLocation();
		const git = normalizePath(location.path ?? 'git');

		const coreEditorConfig = configuration.get('terminal.overrideGitEditor')
			? `-c "core.editor=${getEditorCommand()}" `
			: '';

		const parsedArgs = args.map(arg => (arg.startsWith('#') || /['();$|>&<]/.test(arg) ? `"${arg}"` : arg));

		let text;
		if (git.includes(' ')) {
			const shell = env.shell;
			Logger.debug(scope, `\u2022 git path '${git}' contains spaces, detected shell: '${shell}'`);

			text = `${
				(isWindows ? /(pwsh|powershell)\.exe/i : /pwsh/i).test(shell) ? '&' : ''
			} "${git}" -C "${cwd}" ${coreEditorConfig}${command} ${parsedArgs.join(' ')}`;
		} else {
			text = `${git} -C "${cwd}" ${coreEditorConfig}${command} ${parsedArgs.join(' ')}`;
		}

		Logger.log(scope, `\u2022 '${text}'`);
		this.logCore(`${getLoggableScopeBlockOverride('TERMINAL')} ${text}`);

		const terminal = ensureGitTerminal();
		terminal.show(false);
		// Removing this as this doesn't seem to work on bash
		// // Sends ansi codes to remove any text on the current input line
		// terminal.sendText('\x1b[2K\x1b', false);
		terminal.sendText(text, options?.execute ?? false);
	}

	private logGitCommand(command: string, ex: Error | undefined, duration: number, waiting: boolean): void {
		const slow = duration > slowCallWarningThreshold;
		const status = slow && waiting ? ' (slow, waiting)' : waiting ? ' (waiting)' : slow ? ' (slow)' : '';

		if (ex != null) {
			Logger.error(
				'',
				`${getLoggableScopeBlockOverride('GIT')} ${command} ${GlyphChars.Dot} ${(ex.message || String(ex) || '')
					.trim()
					.replace(/fatal: /g, '')
					.replace(/\r?\n|\r/g, ` ${GlyphChars.Dot} `)} [${duration}ms]${status}`,
			);
		} else if (slow) {
			Logger.warn(
				`${getLoggableScopeBlockOverride('GIT', `*${duration}ms`)} ${command} [*${duration}ms]${status}`,
			);
		} else {
			Logger.log(`${getLoggableScopeBlockOverride('GIT', `${duration}ms`)} ${command} [${duration}ms]${status}`);
		}

		this.logCore(`${getLoggableScopeBlockOverride(slow ? '*' : '', `${duration}ms`)} ${command}${status}`, ex);
	}

	private _gitOutput: OutputChannel | undefined;

	private logCore(message: string, ex?: Error | undefined): void {
		if (!Logger.enabled(ex != null ? 'error' : 'debug')) return;

		this._gitOutput ??= window.createOutputChannel('GitLens (Git)');
		this._gitOutput.appendLine(`${Logger.timestamp} ${message}${ex != null ? ` ${GlyphChars.Dot} FAILED` : ''}`);
		if (ex != null) {
			this._gitOutput.appendLine(`\n${String(ex)}\n`);
		}
	}
}

export function getShaInLogRegex(sha: string) {
	return new RegExp(`(?:^\x00*|\x00\x00)${sha}\x00`);
}

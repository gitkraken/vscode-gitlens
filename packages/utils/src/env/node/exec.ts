import type { ChildProcess, ExecFileException, ExecFileOptions } from 'child_process';
import { exec, execFile, spawn } from 'child_process';
import type { Stats } from 'fs';
import { access, constants } from 'fs';
import { stat } from 'fs/promises';
import { join as joinPaths } from 'path';
import * as process from 'process';
import type { Readable, Writable } from 'stream';
import type { CancellationReason } from '../../cancellation.js';
import { getScopedLogger, maybeStartScopedLogger } from '../../logger.scoped.js';
import { normalizePath } from '../../path.js';
import { isWindows } from './platform.js';

// -- Error types --

interface RunErrorContext {
	message: string;
	cmd?: string | undefined;
	killed?: boolean | undefined;
	code?: string | number | null | undefined;
	signal?: NodeJS.Signals | undefined;
}

export class RunError extends Error {
	readonly cmd?: string | undefined;
	readonly killed?: boolean | undefined;
	readonly code?: string | number | undefined;
	readonly signal?: NodeJS.Signals | undefined;
	readonly stdout: string;
	readonly stderr: string;

	constructor(context: RunErrorContext, stdout: string, stderr: string) {
		super(context.message);

		this.cmd = context.cmd;
		this.killed = context.killed;
		this.code = context.code ?? undefined;
		this.signal = context.signal;
		this.stdout = stdout?.trim() ?? '';
		this.stderr = stderr?.trim() ?? '';

		this.name = 'RunError';
		Error.captureStackTrace?.(this, new.target);
	}
}

export class CancelledRunError extends RunError {
	readonly reason: CancellationReason;

	constructor(
		cmd: string,
		killed: boolean,
		code?: number | string | undefined,
		signal: NodeJS.Signals = 'SIGTERM',
		reason: CancellationReason = 'unknown',
	) {
		super(
			{ message: `Operation cancelled; command=${cmd}`, cmd: cmd, killed: killed, code: code, signal: signal },
			'',
			'',
		);

		this.reason = reason;

		this.name = 'CancelledRunError';
		Error.captureStackTrace?.(this, new.target);
	}
}

// -- Execution utilities --

const slashesRegex = /[\\/]/;
const ps1Regex = /\.ps1$/i;
const batOrCmdRegex = /\.(bat|cmd)$/i;
const jsRegex = /\.(js)$/i;

/**
 * Search PATH to see if a file exists in any of the path folders.
 *
 * @param  {string} exe The file to search for
 * @return {string}     A fully qualified path, or the original path if nothing
 *                      is found
 *
 * @private
 */
async function runDownPath(exe: string): Promise<string> {
	// NB: Windows won't search PATH looking for executables in spawn like
	// Posix does

	// Files with any directory path don't get this applied
	if (slashesRegex.test(exe)) return exe;

	const target = joinPaths('.', exe);
	try {
		const stats = await stat(target);
		if (stats?.isFile() && isExecutable(stats)) return target;
	} catch {}

	const path = process.env.PATH;
	if (path != null && path.length !== 0) {
		const haystack = path.split(isWindows ? ';' : ':');
		for (const p of haystack) {
			const needle = joinPaths(p, exe);
			try {
				const stats = await stat(needle);
				if (stats?.isFile() && isExecutable(stats)) return needle;
			} catch {}
		}
	}

	return exe;
}

function isExecutable(stats: Stats) {
	if (isWindows) return true;

	const isGroup = stats.gid ? stats.gid === process.getgid?.() : true;
	const isUser = stats.uid ? stats.uid === process.getuid?.() : true;

	return Boolean(stats.mode & 0o0001 || (stats.mode & 0o0010 && isGroup) || (stats.mode & 0o0100 && isUser));
}

/**
 * Finds the executable and parameters to run on Windows. This method
 * mimics the POSIX behavior of being able to run scripts as executables by
 * replacing the passed-in executable with the script runner, for PowerShell,
 * CMD, and node scripts.
 *
 * This method also does the work of running down PATH, which spawn on Windows
 * also doesn't do, unlike on POSIX.
 */
export async function findExecutable(exe: string, args: string[]): Promise<{ cmd: string; args: string[] }> {
	// POSIX can just execute scripts directly, no need for silly goosery
	if (!isWindows) return { cmd: await runDownPath(exe), args: args };

	if (!(await fsExists(exe))) {
		// NB: When you write something like `surf-client ... -- surf-build` on Windows,
		// a shell would normally convert that to surf-build.cmd, but since it's passed
		// in as an argument, it doesn't happen
		const possibleExts = ['.exe', '.bat', '.cmd', '.ps1'];
		for (const ext of possibleExts) {
			const possibleFullPath = await runDownPath(`${exe}${ext}`);

			if (await fsExists(possibleFullPath)) return findExecutable(possibleFullPath, args);
		}
	}

	if (ps1Regex.test(exe)) {
		const cmd = joinPaths(
			process.env.SYSTEMROOT ?? 'C:\\WINDOWS',
			'System32',
			'WindowsPowerShell',
			'v1.0',
			'PowerShell.exe',
		);
		const psargs = ['-ExecutionPolicy', 'Unrestricted', '-NoLogo', '-NonInteractive', '-File', exe];

		return { cmd: cmd, args: [...psargs, ...args] };
	}

	if (batOrCmdRegex.test(exe)) {
		const cmd = joinPaths(process.env.SYSTEMROOT ?? 'C:\\WINDOWS', 'System32', 'cmd.exe');
		const cmdArgs = ['/C', exe, ...args];

		return { cmd: cmd, args: cmdArgs };
	}

	if (jsRegex.test(exe)) {
		const cmd = process.execPath;
		const nodeArgs = [exe];

		return { cmd: cmd, args: [...nodeArgs, ...args] };
	}

	return { cmd: exe, args: args };
}

export async function getWindowsShortPath(path: string): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		exec(`for %I in ("${path}") do @echo %~sI`, (error, stdout, _stderr) => {
			if (error != null) {
				reject(error);
				return;
			}

			resolve(normalizePath(stdout.trim()));
		});
	});
}

/** What core uses of a spawned process; Node's `ChildProcess` satisfies it */
export interface SpawnedProcess {
	readonly stdin: Writable | null;
	readonly stdout: Readable | null;
	readonly stderr: Readable | null;
	readonly killed: boolean;
	readonly exitCode: number | null;
	readonly spawnargs: string[];
	once(event: 'error', listener: (error: Error) => void): this;
	once(event: 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
	removeAllListeners(): this;
}

export interface ProcessSpawnOptions {
	readonly cwd?: string;
	/** The child's whole environment, not additions to the spawner's own; an `undefined` value leaves the key out */
	readonly env?: Record<string, string | undefined>;
	/** Milliseconds; absent means none */
	readonly timeout?: number;
	readonly signal?: AbortSignal;
	/** A `null` entry means `'pipe'` */
	readonly stdio?: ['pipe' | 'ignore', null, null];
}

/**
 * Launches a process in place of Node's `spawn`, and must behave as it does:
 * - pipe stdout and stderr, and stdin unless `stdio[0]` is `'ignore'`, which leaves `stdin` null
 * - honour `signal`, including one already aborted: kill with SIGTERM, then emit `'error'` with `name` `AbortError`,
 *   unless the process has already exited
 * - honour `timeout`: kill with SIGTERM and set `killed`, without emitting `'error'`
 * - report a killed process's `'close'` with a null code and its signal, not an exit code such as 143
 * - emit no event before returning, `'error'` at most once, and `'close'` exactly once and last: also after `'error'`
 *   (a failed launch, an abort), and only after `stdout` and `stderr` have ended or been destroyed, with `exitCode`
 *   and `killed` already set
 * - close the child's stdout when `stdout` is destroyed, which is how a reader that stops early ends the process
 */
export type ProcessSpawner = (command: string, args: readonly string[], options: ProcessSpawnOptions) => SpawnedProcess;

/**
 * The default {@link ProcessSpawner}: Node's `spawn`, but with its `timeout` handled here. Node clears its timeout
 * timer only on `'exit'`, which a failed launch (e.g. a missing `cwd`) never emits, so the timer outlives the
 * process and keeps Node alive for the full timeout. This mirrors Node's timeout handling but also clears on
 * `'close'`, as https://github.com/nodejs/node/pull/65506 does; remove it once the minimum supported Node/Electron
 * includes that fix.
 */
export function spawnProcess(command: string, args: readonly string[], options: ProcessSpawnOptions): ChildProcess {
	const { timeout, ...spawnOptions } = options;
	// Node's own validation, thrown before anything spawns
	if (timeout != null && !(Number.isInteger(timeout) && timeout >= 0)) {
		const ex = new RangeError(
			`The value of "timeout" is out of range. It must be an unsigned integer. Received ${String(timeout)}`,
		);
		(ex as RangeError & { code: string }).code = 'ERR_OUT_OF_RANGE';
		throw ex;
	}

	const child = spawn(command, args, spawnOptions);

	if (timeout != null && timeout > 0) {
		let timeoutId: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
			if (timeoutId != null) {
				try {
					child.kill();
				} catch (ex) {
					child.emit('error', ex);
				}
				timeoutId = undefined;
			}
		}, timeout);

		const clear = () => {
			if (timeoutId != null) {
				clearTimeout(timeoutId);
				timeoutId = undefined;
			}
		};
		// `'exit'` keeps Node's timing; `'close'` covers a launch that fails and never exits
		child.once('exit', clear);
		child.once('close', clear);
	}

	return child;
}

export interface RunOptions<TEncoding = BufferEncoding | 'buffer'> {
	cwd?: string;
	readonly env?: Record<string, string | undefined>;
	readonly encoding?: TEncoding;
	/**
	 * Decodes non-UTF-8 output. Called when `encoding` is not utf8/binary/buffer.
	 * Provided by the host via the `GitOptions.decode` option.
	 * If absent and a non-UTF-8 encoding is requested, throws at runtime.
	 */
	readonly decode?: (data: Uint8Array, options?: { readonly encoding: string }) => string | Promise<string>;
	/**
	 * The size the output buffer to allocate to the spawned process. Set this
	 * if you are anticipating a large amount of output.
	 *
	 * If not specified, this will be 10MB (10485760 bytes) which should be
	 * enough for most Git operations.
	 */
	readonly maxBuffer?: number;
	readonly cancellation?: AbortSignal;
	/**
	 * An optional string or buffer which will be written to
	 * the child process stdin stream immediately immediately
	 * after spawning the process.
	 */
	readonly stdin?: string | Buffer;
	/**
	 * The encoding to use when writing to stdin, if the stdin
	 * parameter is a string.
	 */
	readonly stdinEncoding?: string;
	readonly timeout?: number;
	/**
	 * When true, suppresses the `[EXEC]` stderr warning emitted on debug-enabled scopes.
	 * Use for commands whose failure is expected (e.g. paired with `errors: 'ignore'`).
	 */
	readonly quiet?: boolean;
	/** Launches the process; defaults to {@link spawnProcess}. Only used by `runSpawn` */
	readonly spawn?: ProcessSpawner;
}

const bufferExceededRegex = /stdout maxBuffer( length)? exceeded/;

type ExitCodeOnlyRunOptions<TEncoding = BufferEncoding | 'buffer'> = RunOptions<TEncoding> & { exitCodeOnly: true };

export function run(
	command: string,
	args: readonly string[],
	encoding: BufferEncoding | string,
	options: ExitCodeOnlyRunOptions<BufferEncoding>,
): Promise<number>;
export function run(
	command: string,
	args: readonly string[],
	encoding: BufferEncoding | string,
	options?: RunOptions<BufferEncoding>,
): Promise<string>;
export function run<T extends number | string>(
	command: string,
	args: readonly string[],
	encoding: BufferEncoding | string,
	options?: RunOptions<BufferEncoding> & { exitCodeOnly?: boolean },
): Promise<T> {
	const scope = getScopedLogger() ?? maybeStartScopedLogger('Exec.run');

	const { stdin, stdinEncoding, cancellation, decode, ...opts }: RunOptions<BufferEncoding> & ExecFileOptions = {
		maxBuffer: 1000 * 1024 * 1024,
		...options,
	};

	const promise = new Promise<T>((resolve, reject) => {
		const proc = execFile(
			command,
			args,
			{ ...opts, signal: cancellation },
			async (error: ExecFileException | null, stdout, stderr) => {
				if (options?.exitCodeOnly) {
					resolve((error?.code ?? proc.exitCode) as T);

					return;
				}

				if (error != null) {
					if (error.signal === 'SIGTERM') {
						reject(
							new CancelledRunError(
								`${command} ${args.join(' ')}`,
								true,
								error.code ?? undefined,
								error.signal,
								cancellation?.aborted ? 'aborted' : error.killed ? 'timeout' : 'unknown',
							),
						);

						return;
					}

					if (bufferExceededRegex.test(error.message)) {
						error.message = `Command output exceeded the allocated stdout buffer. Set 'options.maxBuffer' to a larger value than ${opts.maxBuffer} bytes`;
					}

					let stdoutDecoded: string;
					let stderrDecoded: string;
					if (encoding === 'utf8' || encoding === 'binary' || encoding === 'buffer') {
						// stdout & stderr can be `Buffer` or `string
						// oxlint-disable-next-line typescript/no-unnecessary-type-conversion
						stdoutDecoded = stdout.toString();
						// oxlint-disable-next-line typescript/no-unnecessary-type-conversion
						stderrDecoded = stderr.toString();
					} else {
						if (decode == null) {
							throw new Error(
								`Non-UTF-8 encoding '${encoding}' requested but no decode function configured`,
							);
						}

						stdoutDecoded = await decode(
							Buffer.from(stdout, 'binary'),
							encoding ? { encoding: encoding } : undefined,
						);
						stderrDecoded = await decode(
							Buffer.from(stderr, 'binary'),
							encoding ? { encoding: encoding } : undefined,
						);
					}
					reject(new RunError(error, stdoutDecoded, stderrDecoded));

					return;
				}

				if (stderr && !options?.quiet && scope?.enabled('debug')) {
					scope?.warn(`[EXEC] '${command} ${args.join(' ')}' \u2022 ${stderr}`);
				}

				if (encoding === 'utf8' || encoding === 'binary' || encoding === 'buffer') {
					resolve(stdout as T);
				} else {
					if (decode == null) {
						throw new Error(`Non-UTF-8 encoding '${encoding}' requested but no decode function configured`);
					}

					resolve(
						(await decode(
							Buffer.from(stdout, 'binary'),
							encoding ? { encoding: encoding } : undefined,
						)) as T,
					);
				}
			},
		);

		if (stdin != null) {
			endStdin(proc.stdin, stdin, stdinEncoding);
		}
	});

	return promise.finally(() => scope?.[Symbol.dispose]());
}

/**
 * Writes a child's whole input and closes it. A child can exit, or be killed on cancellation, before reading all of
 * it, and the pipe then errors (EPIPE, or EOF on Windows). Unlistened, that error is thrown as an uncaught exception
 * and takes down the whole host process, so it is dropped: the child's exit status and stderr already report the
 * failure, and a child that chose to stop reading answered from what it read.
 */
export function endStdin(stream: Writable | null, stdin: string | Buffer, stdinEncoding: string | undefined): void {
	if (stream == null) return;

	stream.on('error', () => {});
	if (typeof stdin === 'string') {
		stream.end(stdin, (stdinEncoding ?? 'utf8') as BufferEncoding);
	} else {
		stream.end(stdin);
	}
}

export interface RunExitResult {
	/**
	 * The process's exit code. ABSENT when the process never exited normally — killed by a signal, in which
	 * case {@link signal} is set. Deliberately optional rather than defaulted to `0`: a signalled process
	 * reported as `exitCode: 0` is indistinguishable from a clean success, so callers would read a partial
	 * or empty stdout as a complete answer.
	 */
	readonly exitCode?: number;
	/** Set when the process was terminated by a signal instead of exiting; {@link exitCode} is then absent. */
	readonly signal?: NodeJS.Signals;
	/** Whether Node itself killed the process (its spawn `timeout`), as opposed to an external signal. */
	readonly killed?: boolean;
}

export interface RunResult<T extends string | Buffer> extends RunExitResult {
	stdout: T;
	stderr: T;
}

export function runSpawn(
	command: string,
	args: readonly string[],
	encoding: BufferEncoding | 'buffer' | string,
	options: ExitCodeOnlyRunOptions,
): Promise<RunExitResult>;
export function runSpawn<T extends string | Buffer>(
	command: string,
	args: readonly string[],
	encoding: BufferEncoding | 'buffer' | string,
	options: RunOptions,
): Promise<RunResult<T>>;
export function runSpawn<T extends string | Buffer>(
	command: string,
	args: readonly string[],
	encoding: BufferEncoding | 'buffer' | string,
	options: RunOptions & { exitCodeOnly?: boolean },
): Promise<RunExitResult | RunResult<T>> {
	const scope = getScopedLogger() ?? maybeStartScopedLogger('Exec.runSpawn');

	const { stdin, stdinEncoding, cancellation, decode, spawn: spawner, ...opts }: RunOptions = options;

	const promise = new Promise<RunExitResult | RunResult<T>>((resolve, reject) => {
		const proc = (spawner ?? spawnProcess)(command, args, {
			cwd: opts.cwd,
			env: opts.env,
			// 0 disables it, which the spawner contract spells as absent
			timeout: opts.timeout === 0 ? undefined : opts.timeout,
			signal: cancellation,
			stdio: ['pipe', null, null],
		});
		const errorEncoding = encoding === 'buffer' ? 'utf8' : encoding;

		const stdoutBuffers: Buffer[] = [];
		proc.stdout?.on('data', (data: Buffer) => stdoutBuffers.push(data));

		const stderrBuffers: Buffer[] = [];
		proc.stderr?.on('data', (data: Buffer) => stderrBuffers.push(data));

		function getStdio<T>(
			encoding: BufferEncoding | 'buffer' | string,
		): { stdout: T; stderr: T } | Promise<{ stdout: T; stderr: T }> {
			const stdout = Buffer.concat(stdoutBuffers);
			const stderr = Buffer.concat(stderrBuffers);
			if (encoding === 'utf8' || encoding === 'binary') {
				return { stdout: stdout.toString(encoding) as T, stderr: stderr.toString(encoding) as T };
			}
			if (encoding === 'buffer') {
				return { stdout: stdout as T, stderr: stderr as T };
			}

			if (decode == null) {
				throw new Error(`Non-UTF-8 encoding '${encoding}' requested but no decode function configured`);
			}

			return Promise.all([
				decode(stdout, encoding ? { encoding: encoding } : undefined),
				decode(stderr, encoding ? { encoding: encoding } : undefined),
			]).then(([decodedStdout, decodedStderr]) => ({
				stdout: decodedStdout as T,
				stderr: decodedStderr as T,
			}));
		}

		proc.once('error', async ex => {
			if (ex?.name === 'AbortError') {
				reject(new CancelledRunError(`${command} ${args.join(' ')}`, true, undefined, undefined, 'aborted'));

				return;
			}

			const stdio = getStdio<string>(errorEncoding);
			const { stdout, stderr } = stdio instanceof Promise ? await stdio : stdio;

			reject(new RunError(ex, stdout, stderr));
		});

		proc.once('close', async (code, signal) => {
			if (options?.exitCodeOnly) {
				// Resolves unconditionally, so this is the one path that can hand back a signalled run. `code`
				// is null exactly when the process was killed — report the signal rather than coercing to `0`,
				// which would claim a clean success for a command that never finished. Note this returns BEFORE
				// the SIGTERM-to-cancellation diversion below, so callers have to classify that themselves.
				resolve({ exitCode: code ?? undefined, signal: signal ?? undefined, killed: proc.killed });

				return;
			}

			if (code !== 0 || signal) {
				const stdio = getStdio<string>(errorEncoding);
				const { stdout, stderr } = stdio instanceof Promise ? await stdio : stdio;
				if (stderr.length && !options?.quiet && scope?.enabled('debug')) {
					scope?.warn(`[EXEC] '${command} ${args.join(' ')}' \u2022 ${stderr}`);
				}

				if (signal === 'SIGTERM') {
					// Only Node's spawn `timeout` kills it (a caller abort rejected above, from `'error'`); an
					// external SIGTERM leaves `proc.killed` false
					reject(
						new CancelledRunError(
							`${command} ${args.join(' ')}`,
							true,
							code ?? undefined,
							signal,
							proc.killed ? 'timeout' : 'unknown',
						),
					);

					return;
				}

				reject(
					new RunError(
						{
							message: `Command failed with exit code ${code}`,
							code: code,
							signal: signal ?? undefined,
						},
						stdout,
						stderr,
					),
				);

				return;
			}

			const stdio = getStdio<T>(encoding);
			const { stdout, stderr } = stdio instanceof Promise ? await stdio : stdio;
			if (stderr.length && !options?.quiet && scope?.enabled('debug')) {
				scope?.warn(
					`[EXEC] '${command} ${args.join(' ')}' \u2022 ${typeof stderr === 'string' ? stderr : stderr.toString()}`,
				);
			}

			// The guard above already rejected every non-zero and every signalled close, so this is a clean
			// zero exit — `code` cannot be null here. (The optional typing exists for the `exitCodeOnly`
			// branch, which is where a codeless result can genuinely surface.)
			resolve({ exitCode: code ?? undefined, signal: signal ?? undefined, stdout: stdout, stderr: stderr });
		});

		// Only a host spawner can leave these out; reading no output as empty would pass for a clean answer
		if (proc.stdout == null || proc.stderr == null) {
			reject(new Error(`'${command}' was spawned without stdout and stderr pipes`));
		}

		if (stdin != null) {
			endStdin(proc.stdin, stdin, stdinEncoding);
		}
	});

	return promise.finally(() => scope?.[Symbol.dispose]());
}

export async function fsExists(path: string): Promise<boolean> {
	return new Promise<boolean>(resolve => access(path, constants.F_OK, err => resolve(err == null)));
}

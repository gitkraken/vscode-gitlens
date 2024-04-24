import type { ExecException } from 'child_process';
import { exec, execFile } from 'child_process';
import type { Stats } from 'fs';
import { access, constants, existsSync, statSync } from 'fs';
import { join as joinPaths } from 'path';
import * as process from 'process';
import type { CancellationToken } from 'vscode';
import { Logger } from '../../../system/logger';
import { normalizePath } from '../../../system/path';

export const isWindows = process.platform === 'win32';

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
function runDownPath(exe: string): string {
	// NB: Windows won't search PATH looking for executables in spawn like
	// Posix does

	// Files with any directory path don't get this applied
	if (slashesRegex.test(exe)) return exe;

	const target = joinPaths('.', exe);
	try {
		const stats = statSync(target);
		if (stats?.isFile() && isExecutable(stats)) return target;
	} catch {}

	const path = process.env.PATH;
	if (path != null && path.length !== 0) {
		const haystack = path.split(isWindows ? ';' : ':');
		let stats;
		for (const p of haystack) {
			const needle = joinPaths(p, exe);
			try {
				stats = statSync(needle);
				if (stats?.isFile() && isExecutable(stats)) return needle;
			} catch {}
		}
	}

	return exe;
}

function isExecutable(stats: Stats) {
	if (isWindows) return true;

	const isGroup = stats.gid ? process.getgid != null && stats.gid === process.getgid() : true;
	const isUser = stats.uid ? process.getuid != null && stats.uid === process.getuid() : true;

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
export function findExecutable(exe: string, args: string[]): { cmd: string; args: string[] } {
	// POSIX can just execute scripts directly, no need for silly goosery
	if (!isWindows) return { cmd: runDownPath(exe), args: args };

	if (!existsSync(exe)) {
		// NB: When you write something like `surf-client ... -- surf-build` on Windows,
		// a shell would normally convert that to surf-build.cmd, but since it's passed
		// in as an argument, it doesn't happen
		const possibleExts = ['.exe', '.bat', '.cmd', '.ps1'];
		for (const ext of possibleExts) {
			const possibleFullPath = runDownPath(`${exe}${ext}`);

			if (existsSync(possibleFullPath)) return findExecutable(possibleFullPath, args);
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

		return { cmd: cmd, args: psargs.concat(args) };
	}

	if (batOrCmdRegex.test(exe)) {
		const cmd = joinPaths(process.env.SYSTEMROOT ?? 'C:\\WINDOWS', 'System32', 'cmd.exe');
		const cmdArgs = ['/C', exe, ...args];

		return { cmd: cmd, args: cmdArgs };
	}

	if (jsRegex.test(exe)) {
		const cmd = process.execPath;
		const nodeArgs = [exe];

		return { cmd: cmd, args: nodeArgs.concat(args) };
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

export interface RunOptions<TEncoding = BufferEncoding | 'buffer'> {
	cancellation?: CancellationToken;
	cwd?: string;
	readonly env?: Record<string, any>;
	readonly encoding?: TEncoding;
	/**
	 * The size the output buffer to allocate to the spawned process. Set this
	 * if you are anticipating a large amount of output.
	 *
	 * If not specified, this will be 10MB (10485760 bytes) which should be
	 * enough for most Git operations.
	 */
	readonly maxBuffer?: number;
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
}

const bufferExceededRegex = /stdout maxBuffer( length)? exceeded/;

export class RunError extends Error {
	constructor(
		private readonly original: ExecException,
		public readonly stdout: string,
		public readonly stderr: string,
	) {
		super(original.message);

		stdout = stdout.trim();
		stderr = stderr.trim();
		Error.captureStackTrace?.(this, RunError);
	}

	get cmd(): string | undefined {
		return this.original.cmd;
	}

	get killed(): boolean | undefined {
		return this.original.killed;
	}

	get code(): number | undefined {
		return this.original.code;
	}

	get signal(): NodeJS.Signals | undefined {
		return this.original.signal;
	}
}

export class CancelledRunError extends RunError {
	constructor(cmd: string, killed: boolean, code?: number | undefined, signal: NodeJS.Signals = 'SIGTERM') {
		super(
			{
				name: 'CancelledRunError',
				message: 'Cancelled',
				cmd: cmd,
				killed: killed,
				code: code,
				signal: signal,
			},
			'',
			'',
		);

		Error.captureStackTrace?.(this, CancelledRunError);
	}
}

type ExitCodeOnlyRunOptions = RunOptions & { exitCodeOnly: true };

export function run(
	command: string,
	args: any[],
	encoding: BufferEncoding | 'buffer' | string,
	options: ExitCodeOnlyRunOptions,
): Promise<number>;
export function run<T extends string | Buffer>(
	command: string,
	args: any[],
	encoding: BufferEncoding | 'buffer' | string,
	options?: RunOptions,
): Promise<T>;
export function run<T extends number | string | Buffer>(
	command: string,
	args: any[],
	encoding: BufferEncoding | 'buffer' | string,
	options?: RunOptions & { exitCodeOnly?: boolean },
): Promise<T> {
	const { stdin, stdinEncoding, ...opts }: RunOptions = { maxBuffer: 1000 * 1024 * 1024, ...options };

	let killed = false;
	return new Promise<T>((resolve, reject) => {
		const proc = execFile(command, args, opts, async (error: ExecException | null, stdout, stderr) => {
			if (killed) return;

			if (options?.exitCodeOnly) {
				resolve((error?.code ?? proc.exitCode) as T);

				return;
			}

			if (error != null) {
				if (bufferExceededRegex.test(error.message)) {
					error.message = `Command output exceeded the allocated stdout buffer. Set 'options.maxBuffer' to a larger value than ${opts.maxBuffer} bytes`;
				}

				let stdoutDecoded: string;
				let stderrDecoded: string;
				if (encoding === 'utf8' || encoding === 'binary' || encoding === 'buffer') {
					// stdout & stderr can be `Buffer` or `string
					stdoutDecoded = stdout.toString();
					stderrDecoded = stderr.toString();
				} else {
					const decode = (await import(/* webpackChunkName: "lib-encoding" */ 'iconv-lite')).decode;
					stdoutDecoded = decode(Buffer.from(stdout, 'binary'), encoding);
					stderrDecoded = decode(Buffer.from(stderr, 'binary'), encoding);
				}
				reject(new RunError(error, stdoutDecoded, stderrDecoded));

				return;
			}

			if (stderr) {
				Logger.warn(`Warning(${command} ${args.join(' ')}): ${stderr}`);
			}

			if (encoding === 'utf8' || encoding === 'binary' || encoding === 'buffer') {
				resolve(stdout as T);
			} else {
				const decode = (await import(/* webpackChunkName: "lib-encoding" */ 'iconv-lite')).decode;
				resolve(decode(Buffer.from(stdout, 'binary'), encoding) as T);
			}
		});

		options?.cancellation?.onCancellationRequested(() => {
			const success = proc.kill();
			killed = true;

			if (options?.exitCodeOnly) {
				resolve(0 as T);
			} else {
				reject(new CancelledRunError(command, success));
			}
		});

		if (stdin != null) {
			proc.stdin?.end(stdin, (stdinEncoding ?? 'utf8') as BufferEncoding);
		}
	});
}

export async function fsExists(path: string) {
	return new Promise<boolean>(resolve => access(path, constants.F_OK, err => resolve(err == null)));
}

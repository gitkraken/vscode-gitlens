import type { ExecFileException, ExecFileOptions } from 'child_process';
import { exec, execFile, spawn } from 'child_process';
import type { Stats } from 'fs';
import { access, constants } from 'fs';
import { stat } from 'fs/promises';
import { join as joinPaths } from 'path';
import * as process from 'process';
import { getScopedLogger, maybeStartLoggableScope } from '../../../system/logger.scope.js';
import { normalizePath } from '../../../system/path.js';
import { CancelledRunError, RunError } from './shell.errors.js';

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

export interface RunOptions<TEncoding = BufferEncoding | 'buffer'> {
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
	readonly signal?: AbortSignal;
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
	const scope = getScopedLogger() ?? maybeStartLoggableScope('Shell.run');

	const { stdin, stdinEncoding, ...opts }: RunOptions<BufferEncoding> & ExecFileOptions = {
		maxBuffer: 1000 * 1024 * 1024,
		...options,
	};

	const promise = new Promise<T>((resolve, reject) => {
		const proc = execFile(command, args, opts, async (error: ExecFileException | null, stdout, stderr) => {
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
					// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-conversion
					stdoutDecoded = stdout.toString();
					// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-conversion
					stderrDecoded = stderr.toString();
				} else {
					const decode = (await import(/* webpackChunkName: "lib-encoding" */ 'iconv-lite')).decode;
					stdoutDecoded = decode(Buffer.from(stdout, 'binary'), encoding);
					stderrDecoded = decode(Buffer.from(stderr, 'binary'), encoding);
				}
				reject(new RunError(error, stdoutDecoded, stderrDecoded));

				return;
			}

			if (stderr && scope?.enabled('debug')) {
				scope?.warn(`[SHELL] '${command} ${args.join(' ')}' \u2022 ${stderr}`);
			}

			if (encoding === 'utf8' || encoding === 'binary' || encoding === 'buffer') {
				resolve(stdout as T);
			} else {
				const decode = (await import(/* webpackChunkName: "lib-encoding" */ 'iconv-lite')).decode;
				resolve(decode(Buffer.from(stdout, 'binary'), encoding) as T);
			}
		});

		if (stdin != null) {
			proc.stdin?.end(stdin, (stdinEncoding ?? 'utf8') as BufferEncoding);
		}
	});

	return promise.finally(() => scope?.[Symbol.dispose]());
}

export interface RunExitResult {
	exitCode: number;
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
	const scope = getScopedLogger() ?? maybeStartLoggableScope('Shell.runSpawn');

	const { stdin, stdinEncoding, ...opts }: RunOptions = options;

	const promise = new Promise<RunExitResult | RunResult<T>>((resolve, reject) => {
		const proc = spawn(command, args, opts);

		const stdoutBuffers: Buffer[] = [];
		proc.stdout.on('data', (data: Buffer) => stdoutBuffers.push(data));

		const stderrBuffers: Buffer[] = [];
		proc.stderr.on('data', (data: Buffer) => stderrBuffers.push(data));

		function getStdio<T>(
			encoding: BufferEncoding | 'buffer' | string,
		): { stdout: T; stderr: T } | Promise<{ stdout: T; stderr: T }> {
			const stdout = Buffer.concat(stdoutBuffers as ReadonlyArray<Uint8Array>);
			const stderr = Buffer.concat(stderrBuffers as ReadonlyArray<Uint8Array>);
			if (encoding === 'utf8' || encoding === 'binary') {
				return { stdout: stdout.toString(encoding) as T, stderr: stderr.toString(encoding) as T };
			}
			if (encoding === 'buffer') {
				return { stdout: stdout as T, stderr: stderr as T };
			}

			return import(/* webpackChunkName: "lib-encoding" */ 'iconv-lite').then(iconv => {
				return { stdout: iconv.decode(stdout, encoding) as T, stderr: iconv.decode(stderr, encoding) as T };
			});
		}

		proc.once('error', async ex => {
			if (ex?.name === 'AbortError') {
				reject(new CancelledRunError(`${command} ${args.join(' ')}`, true));

				return;
			}

			const stdio = getStdio<string>('utf8');
			const { stdout, stderr } = stdio instanceof Promise ? await stdio : stdio;

			reject(new RunError(ex, stdout, stderr));
		});

		proc.once('close', async (code, signal) => {
			if (options?.exitCodeOnly) {
				resolve({ exitCode: code ?? 0 });

				return;
			}

			if (code !== 0 || signal) {
				const stdio = getStdio<string>('utf8');
				const { stdout, stderr } = stdio instanceof Promise ? await stdio : stdio;
				if (stderr.length && scope?.enabled('debug')) {
					scope?.warn(`[SHELL] '${command} ${args.join(' ')}' \u2022 ${stderr}`);
				}

				if (signal === 'SIGTERM') {
					reject(new CancelledRunError(`${command} ${args.join(' ')}`, true, code ?? undefined, signal));

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
			if (stderr.length && scope?.enabled('debug')) {
				scope?.warn(
					`[SHELL] '${command} ${args.join(' ')}' \u2022 ${typeof stderr === 'string' ? stderr : stderr.toString()}`,
				);
			}

			resolve({ exitCode: code ?? 0, stdout: stdout, stderr: stderr });
		});

		if (stdin) {
			if (typeof stdin === 'string') {
				proc.stdin.end(stdin, (stdinEncoding ?? 'utf8') as BufferEncoding);
			} else if (stdin instanceof Buffer) {
				proc.stdin.end(stdin);
			}
		}
	});

	return promise.finally(() => scope?.[Symbol.dispose]());
}

export async function fsExists(path: string): Promise<boolean> {
	return new Promise<boolean>(resolve => access(path, constants.F_OK, err => resolve(err == null)));
}

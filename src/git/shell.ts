'use strict';
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as paths from 'path';
import * as iconv from 'iconv-lite';
import { Logger } from '../logger';

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

	const target = paths.join('.', exe);
	try {
		const stats = fs.statSync(target);
		if (stats && stats.isFile() && isExecutable(stats)) return target;
	} catch {}

	const path = process.env.PATH;
	if (path != null && path.length !== 0) {
		const haystack = path.split(isWindows ? ';' : ':');
		let stats;
		for (const p of haystack) {
			const needle = paths.join(p, exe);
			try {
				stats = fs.statSync(needle);
				if (stats && stats.isFile() && isExecutable(stats)) return needle;
			} catch {}
		}
	}

	return exe;
}

function isExecutable(stats: fs.Stats) {
	if (isWindows) return true;

	const isGroup = stats.gid ? process.getgid && stats.gid === process.getgid() : true;
	const isUser = stats.uid ? process.getuid && stats.uid === process.getuid() : true;

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

	if (!fs.existsSync(exe)) {
		// NB: When you write something like `surf-client ... -- surf-build` on Windows,
		// a shell would normally convert that to surf-build.cmd, but since it's passed
		// in as an argument, it doesn't happen
		const possibleExts = ['.exe', '.bat', '.cmd', '.ps1'];
		for (const ext of possibleExts) {
			const possibleFullPath = runDownPath(`${exe}${ext}`);

			if (fs.existsSync(possibleFullPath)) return findExecutable(possibleFullPath, args);
		}
	}

	if (ps1Regex.test(exe)) {
		const cmd = paths.join(
			process.env.SYSTEMROOT || 'C:\\WINDOWS',
			'System32',
			'WindowsPowerShell',
			'v1.0',
			'PowerShell.exe'
		);
		const psargs = ['-ExecutionPolicy', 'Unrestricted', '-NoLogo', '-NonInteractive', '-File', exe];

		return { cmd: cmd, args: psargs.concat(args) };
	}

	if (batOrCmdRegex.test(exe)) {
		const cmd = paths.join(process.env.SYSTEMROOT || 'C:\\WINDOWS', 'System32', 'cmd.exe');
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

export interface RunOptions {
	cwd?: string;
	readonly env?: Record<string, any>;
	readonly encoding?: BufferEncoding | 'buffer';
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

export function run<TOut extends string | Buffer>(
	command: string,
	args: any[],
	encoding: BufferEncoding | 'buffer',
	options: RunOptions = {}
): Promise<TOut> {
	const { stdin, stdinEncoding, ...opts }: RunOptions = { maxBuffer: 100 * 1024 * 1024, ...options };

	return new Promise<TOut>((resolve, reject) => {
		const proc = execFile(
			command,
			args,
			opts,
			(error: (Error & { stdout?: TOut | undefined }) | null, stdout, stderr) => {
				if (error != null) {
					if (bufferExceededRegex.test(error.message)) {
						error.message = `Command output exceeded the allocated stdout buffer. Set 'options.maxBuffer' to a larger value than ${opts.maxBuffer} bytes`;
					}

					error.stdout =
						encoding === 'utf8' || encoding === 'binary' || encoding === 'buffer'
							? (stdout as TOut)
							: (iconv.decode(Buffer.from(stdout, 'binary'), encoding) as TOut);
					reject(error);

					return;
				}

				if (stderr) {
					Logger.warn(`Warning(${command} ${args.join(' ')}): ${stderr}`);
				}

				resolve(
					encoding === 'utf8' || encoding === 'binary' || encoding === 'buffer'
						? (stdout as TOut)
						: (iconv.decode(Buffer.from(stdout, 'binary'), encoding) as TOut)
				);
			}
		);

		if (stdin) {
			proc.stdin.end(stdin, stdinEncoding || 'utf8');
		}
	});
}

export function fsExists(path: string) {
	return new Promise<boolean>(resolve => fs.exists(path, exists => resolve(exists)));
}

'use strict';
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as iconv from 'iconv-lite';
import * as paths from 'path';
import { Logger } from '../logger';

const isWindows = process.platform === 'win32';

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
    if (exe.match(/[\\\/]/)) return exe;

    const target = paths.join('.', exe);
    try {
        if (fs.statSync(target)) return target;
    }
    catch {}

    const haystack = process.env.PATH!.split(isWindows ? ';' : ':');
    for (const p of haystack) {
        const needle = paths.join(p, exe);
        try {
            if (fs.statSync(needle)) return needle;
        }
        catch {}
    }

    return exe;
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

    if (exe.match(/\.ps1$/i)) {
        const cmd = paths.join(process.env.SYSTEMROOT!, 'System32', 'WindowsPowerShell', 'v1.0', 'PowerShell.exe');
        const psargs = ['-ExecutionPolicy', 'Unrestricted', '-NoLogo', '-NonInteractive', '-File', exe];

        return { cmd: cmd, args: psargs.concat(args) };
    }

    if (exe.match(/\.(bat|cmd)$/i)) {
        const cmd = paths.join(process.env.SYSTEMROOT!, 'System32', 'cmd.exe');
        const cmdArgs = ['/C', exe, ...args];

        return { cmd: cmd, args: cmdArgs };
    }

    if (exe.match(/\.(js)$/i)) {
        const cmd = process.execPath;
        const nodeArgs = [exe];

        return { cmd: cmd, args: nodeArgs.concat(args) };
    }

    return { cmd: exe, args: args };
}

export class RunError extends Error {
    constructor(
        public readonly exitCode: number,
        ...args: any[]
    ) {
        super(...args);

        Error.captureStackTrace(this, RunError);
    }
}

export interface RunOptions {
    cwd?: string;
    readonly env?: Object;
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

export function run<TOut extends string | Buffer>(
    command: string,
    args: any[],
    encoding: BufferEncoding | 'buffer',
    options: RunOptions = {}
): Promise<TOut> {
    const { stdin, stdinEncoding, ...opts } = { maxBuffer: 100 * 1024 * 1024, ...options } as RunOptions;

    return new Promise<TOut>((resolve, reject) => {
        const proc = execFile(
            command,
            args,
            opts,
            (err: (Error & { code?: string | number }) | null, stdout, stderr) => {
                if (err != null) {
                    reject(
                        new RunError(
                            err.code ? Number(err.code) : 0,
                            err.message === 'stdout maxBuffer exceeded'
                                ? `Command output exceeded the allocated stdout buffer. Set 'options.maxBuffer' to a larger value than ${
                                      opts.maxBuffer
                                  } bytes`
                                : stderr
                        )
                    );

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

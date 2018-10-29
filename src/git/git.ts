'use strict';
import * as iconv from 'iconv-lite';
import * as paths from 'path';
import { GlyphChars } from '../constants';
import { Logger } from '../logger';
import { Objects, Strings } from '../system';
import { findGitPath, GitLocation } from './locator';
import { run, RunOptions } from './shell';

export { GitLocation } from './locator';
export * from './models/models';
export * from './parsers/parsers';
export * from './remotes/provider';

const defaultBlameParams = ['blame', '--root', '--incremental'];

// Using %x00 codes because some shells seem to try to expand things if not
const lb = '%x3c'; // `%x${'<'.charCodeAt(0).toString(16)}`;
const rb = '%x3e'; // `%x${'>'.charCodeAt(0).toString(16)}`;
const sl = '%x2f'; // `%x${'/'.charCodeAt(0).toString(16)}`;
const sp = '%x20'; // `%x${' '.charCodeAt(0).toString(16)}`;

const logFormat = [
    `${lb}${sl}f${rb}`,
    `${lb}r${rb}${sp}%H`, // ref
    `${lb}a${rb}${sp}%aN`, // author
    `${lb}e${rb}${sp}%aE`, // email
    `${lb}d${rb}${sp}%at`, // date
    `${lb}c${rb}${sp}%ct`, // committed date
    `${lb}p${rb}${sp}%P`, // parents
    `${lb}s${rb}`,
    `%B`, // summary
    `${lb}${sl}s${rb}`,
    `${lb}f${rb}`
].join('%n');

const defaultLogParams = ['log', '--name-status', `--format=${logFormat}`];

const stashFormat = [
    `${lb}${sl}f${rb}`,
    `${lb}r${rb}${sp}%H`, // ref
    `${lb}d${rb}${sp}%at`, // date
    `${lb}c${rb}${sp}%ct`, // committed date
    `${lb}l${rb}${sp}%gd`, // reflog-selector
    `${lb}s${rb}`,
    `%B`, // summary
    `${lb}${sl}s${rb}`,
    `${lb}f${rb}`
].join('%n');

const defaultStashParams = ['stash', 'list', '--name-status', '-M', `--format=${stashFormat}`];

const GitErrors = {
    badRevision: /bad revision \'.*?\'/i,
    notAValidObjectName: /Not a valid object name/i
};

const GitWarnings = {
    notARepository: /Not a git repository/i,
    outsideRepository: /is outside repository/i,
    noPath: /no such path/i,
    noCommits: /does not have any commits/i,
    notFound: /Path \'.*?\' does not exist in/i,
    foundButNotInRevision: /Path \'.*?\' exists on disk, but not in/i,
    headNotABranch: /HEAD does not point to a branch/i,
    noUpstream: /no upstream configured for branch \'(.*?)\'/i,
    unknownRevision: /ambiguous argument \'.*?\': unknown revision or path not in the working tree|not stored as a remote-tracking branch/i,
    mustRunInWorkTree: /this operation must be run in a work tree/i,
    patchWithConflicts: /Applied patch to \'.*?\' with conflicts/i,
    noRemoteRepositorySpecified: /No remote repository specified\./i,
    remoteConnectionError: /Could not read from remote repository/i
};

interface GitCommandOptions extends RunOptions {
    readonly correlationKey?: string;
    exceptionHandler?(ex: Error): string | void;
}

// A map of running git commands -- avoids running duplicate overlaping commands
const pendingCommands: Map<string, Promise<string | Buffer>> = new Map();

async function git<TOut extends string | Buffer>(options: GitCommandOptions, ...args: any[]): Promise<TOut> {
    const start = process.hrtime();

    const { correlationKey, exceptionHandler, ...opts } = options;

    const encoding = options.encoding || 'utf8';
    const runOpts = {
        ...opts,
        encoding: encoding === 'utf8' ? 'utf8' : encoding === 'buffer' ? 'buffer' : 'binary',
        // Adds GCM environment variables to avoid any possible credential issues -- from https://github.com/Microsoft/vscode/issues/26573#issuecomment-338686581
        // Shouldn't *really* be needed but better safe than sorry
        env: { ...(options.env || process.env), GCM_INTERACTIVE: 'NEVER', GCM_PRESERVE_CREDS: 'TRUE', LC_ALL: 'C' }
    } as RunOptions;

    const gitCommand = `[${runOpts.cwd}] git ${args.join(' ')}`;

    const command = `${correlationKey !== undefined ? `${correlationKey}:` : ''}${gitCommand}`;

    let waiting;
    let promise = pendingCommands.get(command);
    if (promise === undefined) {
        waiting = false;
        // Fixes https://github.com/eamodio/vscode-gitlens/issues/73 & https://github.com/eamodio/vscode-gitlens/issues/161
        // See https://stackoverflow.com/questions/4144417/how-to-handle-asian-characters-in-file-names-in-git-on-os-x
        args.splice(0, 0, '-c', 'core.quotepath=false', '-c', 'color.ui=false');

        promise = run<TOut>(gitInfo.path, args, encoding, runOpts);

        pendingCommands.set(command, promise);
    }
    else {
        waiting = true;
    }

    let exception: Error | undefined;
    try {
        return (await promise) as TOut;
    }
    catch (ex) {
        exception = ex;
        if (exceptionHandler !== undefined) {
            const result = exceptionHandler(ex);
            exception = undefined;
            return result as TOut;
        }

        const result = defaultExceptionHandler(ex, options, ...args);
        exception = undefined;
        return result as TOut;
    }
    finally {
        pendingCommands.delete(command);

        const duration = `${Strings.getDurationMilliseconds(start)} ms ${waiting ? '(await) ' : ''}`;
        Logger.log(
            `${gitCommand} ${GlyphChars.Dot} ${
                exception !== undefined ? `FAILED(${(exception.message || '').trim().split('\n', 1)[0]}) ` : ''
            }${duration}`
        );
        Logger.logGitCommand(
            `${gitCommand} ${GlyphChars.Dot} ${exception !== undefined ? 'FAILED ' : ''}${duration}`,
            exception
        );
    }
}

function defaultExceptionHandler(ex: Error, options: GitCommandOptions, ...args: any[]): string {
    const msg = ex && ex.toString();
    if (msg) {
        for (const warning of Objects.values(GitWarnings)) {
            if (warning.test(msg)) {
                Logger.warn('git', ...args, `  cwd='${options.cwd}'\n\n  `, msg.replace(/\r?\n|\r/g, ' '));
                return '';
            }
        }
    }

    Logger.error(ex, 'git', ...args, `  cwd='${options.cwd}'\n\n  `);
    throw ex;
}

function ignoreExceptionsHandler() {
    return '';
}

function throwExceptionHandler(ex: Error) {
    throw ex;
}

let gitInfo: GitLocation;

export class Git {
    static deletedOrMissingSha = '0000000000000000000000000000000000000000-';
    static shaLikeRegex = /(^[0-9a-f]{40}([\^@~:]\S*)?$)|(^[0]{40}(:|-)$)/;
    static shaRegex = /(^[0-9a-f]{40}$)|(^[0]{40}(:|-)$)/;
    static stagedUncommittedRegex = /^[0]{40}([\^@~]\S*)?:$/;
    static stagedUncommittedSha = '0000000000000000000000000000000000000000:';
    static uncommittedRegex = /^[0]{40}(?:[\^@~:]\S*)?:?$/;
    static uncommittedSha = '0000000000000000000000000000000000000000';

    static getEncoding(encoding: string | undefined) {
        return encoding !== undefined && iconv.encodingExists(encoding) ? encoding : 'utf8';
    }

    static getGitPath(): string {
        return gitInfo.path;
    }

    static getGitVersion(): string {
        return gitInfo.version;
    }

    static async setOrFindGitPath(gitPath?: string): Promise<void> {
        const start = process.hrtime();

        gitInfo = await findGitPath(gitPath);

        Logger.log(
            `Git found: ${gitInfo.version} @ ${gitInfo.path === 'git' ? 'PATH' : gitInfo.path} ${
                GlyphChars.Dot
            } ${Strings.getDurationMilliseconds(start)} ms`
        );
    }

    static isSha(ref: string) {
        return Git.shaRegex.test(ref);
    }

    static isShaLike(ref: string) {
        return Git.shaLikeRegex.test(ref);
    }

    static isStagedUncommitted(ref: string | undefined): boolean {
        return ref ? Git.stagedUncommittedRegex.test(ref) : false;
    }

    static isUncommitted(ref: string | undefined) {
        return ref ? Git.uncommittedRegex.test(ref) : false;
    }

    static shortenSha(
        ref: string,
        strings: { stagedUncommitted?: string; uncommitted?: string; working?: string } = {}
    ) {
        strings = { stagedUncommitted: 'Index', uncommitted: 'Working Tree', working: '', ...strings };

        if (ref === '') return strings.working;
        if (Git.isUncommitted(ref)) {
            if (Git.isStagedUncommitted(ref)) return strings.stagedUncommitted;

            return strings.uncommitted;
        }

        const index = ref.indexOf('^');
        if (index > 5) {
            // Only grab a max of 5 chars for the suffix
            const suffix = ref.substring(index).substring(0, 5);
            return `${ref.substring(0, 7 - suffix.length)}${suffix}`;
        }
        return ref.substring(0, 7);
    }

    static splitPath(fileName: string, repoPath: string | undefined, extract: boolean = true): [string, string] {
        if (repoPath) {
            fileName = Strings.normalizePath(fileName);
            repoPath = Strings.normalizePath(repoPath);

            const normalizedRepoPath = (repoPath.endsWith('/') ? repoPath : `${repoPath}/`).toLowerCase();
            if (fileName.toLowerCase().startsWith(normalizedRepoPath)) {
                fileName = fileName.substring(normalizedRepoPath.length);
            }
        }
        else {
            repoPath = Strings.normalizePath(extract ? paths.dirname(fileName) : repoPath!);
            fileName = Strings.normalizePath(extract ? paths.basename(fileName) : fileName);
        }

        return [fileName, repoPath];
    }

    static validateVersion(major: number, minor: number): boolean {
        const [gitMajor, gitMinor] = gitInfo.version.split('.');
        return parseInt(gitMajor, 10) >= major && parseInt(gitMinor, 10) >= minor;
    }

    // Git commands

    static add(repoPath: string | undefined, fileName: string) {
        return git<string>({ cwd: repoPath }, 'add', '-A', '--', fileName);
    }

    static apply(repoPath: string | undefined, patch: string, options: { allowConflicts?: boolean } = {}) {
        const params = ['apply'];
        if (options.allowConflicts) {
            params.push(`-3`);
        }
        return git<string>({ cwd: repoPath, stdin: patch }, ...params);
    }

    static async blame(
        repoPath: string | undefined,
        fileName: string,
        ref?: string,
        options: { args?: string[] | null; ignoreWhitespace?: boolean; startLine?: number; endLine?: number } = {}
    ) {
        const [file, root] = Git.splitPath(fileName, repoPath);

        const params = [...defaultBlameParams];

        if (options.ignoreWhitespace) {
            params.push('-w');
        }
        if (options.startLine != null && options.endLine != null) {
            params.push(`-L ${options.startLine},${options.endLine}`);
        }
        if (options.args != null) {
            params.push(...options.args);
        }

        let stdin;
        if (ref) {
            if (Git.isStagedUncommitted(ref)) {
                // Pipe the blame contents to stdin
                params.push('--contents', '-');

                // Get the file contents for the staged version using `:`
                stdin = await Git.show<string>(repoPath, fileName, ':');
            }
            else {
                params.push(ref);
            }
        }

        return git<string>({ cwd: root, stdin: stdin }, ...params, '--', file);
    }

    static async blame_contents(
        repoPath: string | undefined,
        fileName: string,
        contents: string,
        options: {
            args?: string[] | null;
            correlationKey?: string;
            ignoreWhitespace?: boolean;
            startLine?: number;
            endLine?: number;
        } = {}
    ) {
        const [file, root] = Git.splitPath(fileName, repoPath);

        const params = [...defaultBlameParams];

        if (options.ignoreWhitespace) {
            params.push('-w');
        }
        if (options.startLine != null && options.endLine != null) {
            params.push(`-L ${options.startLine},${options.endLine}`);
        }
        if (options.args != null) {
            params.push(...options.args);
        }

        // Pipe the blame contents to stdin
        params.push('--contents', '-');

        return git<string>(
            { cwd: root, stdin: contents, correlationKey: options.correlationKey },
            ...params,
            '--',
            file
        );
    }

    static branch(repoPath: string, options: { all: boolean } = { all: false }) {
        const params = ['-c', 'color.branch=false', 'branch', '-vv'];
        if (options.all) {
            params.push('-a');
        }

        return git<string>({ cwd: repoPath }, ...params);
    }

    static branch_contains(repoPath: string, ref: string, options: { remote: boolean } = { remote: false }) {
        const params = ['-c', 'color.branch=false', 'branch', '--contains'];
        if (options.remote) {
            params.push('-r');
        }

        return git<string>({ cwd: repoPath }, ...params, ref);
    }

    static check_mailmap(repoPath: string, author: string) {
        return git<string>({ cwd: repoPath }, 'check-mailmap', author);
    }

    static checkout(repoPath: string, fileName: string, ref: string) {
        const [file, root] = Git.splitPath(fileName, repoPath);

        return git<string>({ cwd: root }, 'checkout', ref, '--', file);
    }

    static async config_get(key: string, repoPath?: string) {
        const data = await git<string>(
            { cwd: repoPath || '', exceptionHandler: ignoreExceptionsHandler },
            'config',
            '--get',
            key
        );
        return data === '' ? undefined : data.trim();
    }

    static async config_getRegex(pattern: string, repoPath?: string) {
        const data = await git<string>(
            { cwd: repoPath || '', exceptionHandler: ignoreExceptionsHandler },
            'config',
            '--get-regex',
            pattern
        );
        return data === '' ? undefined : data.trim();
    }

    static diff(repoPath: string, fileName: string, ref1?: string, ref2?: string, options: { encoding?: string } = {}) {
        const params = ['-c', 'color.diff=false', 'diff', '--diff-filter=M', '-M', '--no-ext-diff', '--minimal'];
        if (ref1) {
            params.push(Git.isStagedUncommitted(ref1) ? '--staged' : ref1);
        }
        if (ref2) {
            params.push(Git.isStagedUncommitted(ref2) ? '--staged' : ref2);
        }

        const encoding: BufferEncoding = options.encoding === 'utf8' ? 'utf8' : 'binary';
        return git<string>({ cwd: repoPath, encoding: encoding }, ...params, '--', fileName);
    }

    static diff_nameStatus(repoPath: string, ref1?: string, ref2?: string, options: { filter?: string } = {}) {
        const params = ['-c', 'color.diff=false', 'diff', '--name-status', '-M', '--no-ext-diff'];
        if (options && options.filter) {
            params.push(`--diff-filter=${options.filter}`);
        }
        if (ref1) {
            params.push(ref1);
        }
        if (ref2) {
            params.push(ref2);
        }

        return git<string>({ cwd: repoPath }, ...params);
    }

    static diff_shortstat(repoPath: string, ref?: string) {
        const params = ['-c', 'color.diff=false', 'diff', '--shortstat', '--no-ext-diff'];
        if (ref) {
            params.push(ref);
        }
        return git<string>({ cwd: repoPath }, ...params);
    }

    static difftool_dirDiff(repoPath: string, tool: string, ref1: string, ref2?: string) {
        const params = ['difftool', '--dir-diff', `--tool=${tool}`, ref1];
        if (ref2) {
            params.push(ref2);
        }

        return git<string>({ cwd: repoPath }, ...params);
    }

    static difftool_fileDiff(
        repoPath: string,
        fileName: string,
        tool: string,
        options: { ref1?: string; ref2?: string; staged?: boolean } = {}
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
        params.push('--', fileName);

        return git<string>({ cwd: repoPath }, ...params);
    }

    static fetch(repoPath: string, options: { all?: boolean; remote?: string } = {}) {
        const params = ['fetch'];
        if (options.remote) {
            params.push(options.remote);
        }
        else if (options.all) {
            params.push('--all');
        }

        return git<string>({ cwd: repoPath }, ...params);
    }

    static log(repoPath: string, options: { author?: string; maxCount?: number; ref?: string; reverse?: boolean }) {
        const params = ['-c', 'diff.renameLimit=0', ...defaultLogParams, '--full-history', '-M', '-m'];
        if (options.author) {
            params.push(`--author=${options.author}`);
        }
        if (options.maxCount && !options.reverse) {
            params.push(`-n${options.maxCount}`);
        }
        if (options.ref && !Git.isStagedUncommitted(options.ref)) {
            if (options.reverse) {
                params.push('--reverse', '--ancestry-path', `${options.ref}..HEAD`);
            }
            else {
                params.push(options.ref);
            }
        }
        return git<string>({ cwd: repoPath }, ...params, '--');
    }

    static log_file(
        repoPath: string,
        fileName: string,
        options: {
            maxCount?: number;
            ref?: string;
            renames?: boolean;
            reverse?: boolean;
            startLine?: number;
            endLine?: number;
        } = { renames: true, reverse: false }
    ) {
        const [file, root] = Git.splitPath(fileName, repoPath);

        const params = [...defaultLogParams];
        if (options.maxCount && !options.reverse) {
            params.push(`-n${options.maxCount}`);
        }

        if (options.renames) {
            params.push('--follow');
        }

        if (options.ref && !Git.isStagedUncommitted(options.ref)) {
            if (options.reverse) {
                params.push('--reverse', '--ancestry-path', `${options.ref}..HEAD`);
            }
            else {
                params.push(options.ref);
            }
        }

        if (options.startLine != null && options.endLine != null) {
            params.push(`-L ${options.startLine},${options.endLine}:${file}`);
        }

        return git<string>({ cwd: root }, ...params, '--', file);
    }

    static async log_recent(repoPath: string, fileName: string) {
        const data = await git<string>(
            { cwd: repoPath, exceptionHandler: ignoreExceptionsHandler },
            'log',
            '-M',
            '-n1',
            '--format=%H',
            '--',
            fileName
        );
        return data === '' ? undefined : data.trim();
    }

    static async cat_file_validate(repoPath: string, fileName: string, ref: string) {
        if (Git.isUncommitted(ref)) return ref;

        try {
            await git<string>(
                { cwd: repoPath, exceptionHandler: throwExceptionHandler },
                'cat-file',
                '-e',
                `${ref}:./${fileName}`
            );
            return ref;
        }
        catch (ex) {
            const msg = ex && ex.toString();
            if (GitErrors.notAValidObjectName.test(msg)) {
                return Git.deletedOrMissingSha;
            }

            return undefined;
        }
    }

    static async log_resolve(repoPath: string, fileName: string, ref: string) {
        const data = await git<string>(
            { cwd: repoPath, exceptionHandler: ignoreExceptionsHandler },
            'log',
            '-M',
            '-n1',
            '--format=%H',
            ref,
            '--',
            fileName
        );
        return data === '' ? undefined : data.trim();
    }

    static log_search(repoPath: string, search: string[] = [], options: { maxCount?: number } = {}) {
        const params = [...defaultLogParams];
        if (options.maxCount) {
            params.push(`-n${options.maxCount}`);
        }

        return git<string>({ cwd: repoPath }, ...params, ...search);
    }

    static log_shortstat(repoPath: string, options: { ref?: string }) {
        const params = ['log', '--shortstat', '--oneline'];
        if (options.ref && !Git.isStagedUncommitted(options.ref)) {
            params.push(options.ref);
        }
        return git<string>({ cwd: repoPath }, ...params, '--');
    }

    static async ls_files(
        repoPath: string,
        fileName: string,
        options: { ref?: string } = {}
    ): Promise<string | undefined> {
        const params = ['ls-files'];
        if (options.ref && !Git.isUncommitted(options.ref)) {
            params.push(`--with-tree=${options.ref}`);
        }

        const data = await git<string>(
            { cwd: repoPath, exceptionHandler: ignoreExceptionsHandler },
            ...params,
            fileName
        );
        return data === '' ? undefined : data.trim();
    }

    static async ls_tree(repoPath: string, ref: string, options: { fileName?: string } = {}) {
        const params = ['ls-tree'];
        if (options.fileName) {
            params.push('-l', ref, '--', options.fileName);
        }
        else {
            params.push('-lrt', ref, '--');
        }
        const data = await git<string>({ cwd: repoPath, exceptionHandler: ignoreExceptionsHandler }, ...params);
        return data === '' ? undefined : data.trim();
    }

    static merge_base(repoPath: string, ref1: string, ref2: string, options: { forkPoint?: boolean } = {}) {
        const params = ['merge-base'];
        if (options.forkPoint) {
            params.push('--fork-point');
        }

        return git<string>({ cwd: repoPath }, ...params, ref1, ref2);
    }

    static remote(repoPath: string): Promise<string> {
        return git<string>({ cwd: repoPath }, 'remote', '-v');
    }

    static remote_url(repoPath: string, remote: string): Promise<string> {
        return git<string>({ cwd: repoPath }, 'remote', 'get-url', remote);
    }

    static reset(repoPath: string | undefined, fileName: string) {
        return git<string>({ cwd: repoPath }, 'reset', '-q', '--', fileName);
    }

    static async revparse(repoPath: string, ref: string): Promise<string | undefined> {
        const data = await git<string>({ cwd: repoPath, exceptionHandler: ignoreExceptionsHandler }, 'rev-parse', ref);
        return data === '' ? undefined : data.trim();
    }

    static async revparse_currentBranch(repoPath: string): Promise<[string, string?] | undefined> {
        const params = ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@', '@{u}'];

        const opts = {
            cwd: repoPath,
            exceptionHandler: throwExceptionHandler
        } as GitCommandOptions;

        try {
            const data = await git<string>(opts, ...params);
            return [data, undefined];
        }
        catch (ex) {
            const msg = ex && ex.toString();
            if (GitWarnings.headNotABranch.test(msg)) {
                const data = await git<string>(
                    { ...opts, exceptionHandler: ignoreExceptionsHandler },
                    'log',
                    '-n1',
                    '--format=%H',
                    '--'
                );
                if (data === '') return undefined;

                // Matches output of `git branch -vv`
                const sha = data.trim();
                return [`(HEAD detached at ${this.shortenSha(sha)})`, sha];
            }

            const result = GitWarnings.noUpstream.exec(msg);
            if (result !== null) return [result[1], undefined];

            if (GitWarnings.unknownRevision.test(msg)) {
                const data = await git<string>(
                    { ...opts, exceptionHandler: ignoreExceptionsHandler },
                    'symbolic-ref',
                    '-q',
                    '--short',
                    'HEAD'
                );
                return data === '' ? undefined : [data.trim(), undefined];
            }

            defaultExceptionHandler(ex, opts, ...params);
            return undefined;
        }
    }

    static async revparse_toplevel(cwd: string): Promise<string | undefined> {
        const data = await git<string>(
            { cwd: cwd, exceptionHandler: ignoreExceptionsHandler },
            'rev-parse',
            '--show-toplevel'
        );
        return data === '' ? undefined : data.trim();
    }

    static async show<TOut extends string | Buffer>(
        repoPath: string | undefined,
        fileName: string,
        ref: string,
        options: { encoding?: string } = {}
    ): Promise<TOut | undefined> {
        const [file, root] = Git.splitPath(fileName, repoPath);

        if (Git.isStagedUncommitted(ref)) {
            ref = ':';
        }
        if (Git.isUncommitted(ref)) throw new Error(`ref=${ref} is uncommitted`);

        const opts = {
            cwd: root,
            encoding: options.encoding || 'utf8',
            exceptionHandler: throwExceptionHandler
        } as GitCommandOptions;
        const args = ref.endsWith(':') ? `${ref}./${file}` : `${ref}:./${file}`;

        try {
            const data = await git<TOut>(opts, 'show', args, '--');
            return data;
        }
        catch (ex) {
            const msg = ex && ex.toString();
            if (ref === ':' && GitErrors.badRevision.test(msg)) {
                return Git.show<TOut>(repoPath, fileName, 'HEAD:', options);
            }

            if (
                GitErrors.badRevision.test(msg) ||
                GitWarnings.notFound.test(msg) ||
                GitWarnings.foundButNotInRevision.test(msg)
            ) {
                return undefined;
            }

            return defaultExceptionHandler(ex, opts, args) as TOut;
        }
    }

    static show_status(repoPath: string, fileName: string, ref: string) {
        return git<string>({ cwd: repoPath }, 'show', '--name-status', '--format=', ref, '--', fileName);
    }

    static stash_apply(repoPath: string, stashName: string, deleteAfter: boolean) {
        if (!stashName) return undefined;
        return git<string>({ cwd: repoPath }, 'stash', deleteAfter ? 'pop' : 'apply', stashName);
    }

    static stash_delete(repoPath: string, stashName: string) {
        if (!stashName) return undefined;
        return git<string>({ cwd: repoPath }, 'stash', 'drop', stashName);
    }

    static stash_list(repoPath: string) {
        return git<string>({ cwd: repoPath }, ...defaultStashParams);
    }

    static stash_push(repoPath: string, pathspecs: string[], message?: string) {
        const params = ['stash', 'push', '-u'];
        if (message) {
            params.push('-m', message);
        }
        return git<string>({ cwd: repoPath }, ...params, '--', ...pathspecs);
    }

    static stash_save(repoPath: string, message?: string) {
        const params = ['stash', 'save', '-u'];
        if (message) {
            params.push(message);
        }
        return git<string>({ cwd: repoPath }, ...params);
    }

    static status(repoPath: string, porcelainVersion: number = 1): Promise<string> {
        const porcelain = porcelainVersion >= 2 ? `--porcelain=v${porcelainVersion}` : '--porcelain';
        return git<string>(
            { cwd: repoPath, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } },
            '-c',
            'color.status=false',
            'status',
            porcelain,
            '--branch',
            '-u'
        );
    }

    static status_file(repoPath: string, fileName: string, porcelainVersion: number = 1): Promise<string> {
        const [file, root] = Git.splitPath(fileName, repoPath);

        const porcelain = porcelainVersion >= 2 ? `--porcelain=v${porcelainVersion}` : '--porcelain';
        return git<string>(
            { cwd: root, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } },
            '-c',
            'color.status=false',
            'status',
            porcelain,
            '--',
            file
        );
    }

    static tag(repoPath: string) {
        return git<string>({ cwd: repoPath }, 'tag', '-l', '-n1');
    }
}

'use strict';
/* eslint-disable @typescript-eslint/camelcase */
import * as paths from 'path';
import * as iconv from 'iconv-lite';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { Logger } from '../logger';
import { Objects, Strings } from '../system';
import { findGitPath, GitLocation } from './locator';
import { run, RunOptions } from './shell';

export { GitLocation } from './locator';
export * from './models/models';
export * from './parsers/parsers';
export * from './remotes/provider';

const emptyArray = (Object.freeze([]) as any) as any[];
const emptyObj = Object.freeze({});
const emptyStr = '';
const slash = '/';

// This is a root sha of all git repo's if using sha1
const rootSha = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

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
    '%B', // summary
    `${lb}${sl}s${rb}`,
    `${lb}f${rb}`
].join('%n');

const logSimpleFormat = `${lb}r${rb}${sp}%H`;

const defaultLogParams = ['log', '--name-status', `--format=${logFormat}`];

const stashFormat = [
    `${lb}${sl}f${rb}`,
    `${lb}r${rb}${sp}%H`, // ref
    `${lb}d${rb}${sp}%at`, // date
    `${lb}c${rb}${sp}%ct`, // committed date
    `${lb}l${rb}${sp}%gd`, // reflog-selector
    `${lb}s${rb}`,
    '%B', // summary
    `${lb}${sl}s${rb}`,
    `${lb}f${rb}`
].join('%n');

const defaultStashParams = ['stash', 'list', '--name-status', '-M', `--format=${stashFormat}`];

const GitErrors = {
    badRevision: /bad revision '(.*?)'/i,
    notAValidObjectName: /Not a valid object name/i
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
    unknownRevision: /ambiguous argument '.*?': unknown revision or path not in the working tree|not stored as a remote-tracking branch/i,
    mustRunInWorkTree: /this operation must be run in a work tree/i,
    patchWithConflicts: /Applied patch to '.*?' with conflicts/i,
    noRemoteRepositorySpecified: /No remote repository specified\./i,
    remoteConnectionError: /Could not read from remote repository/i,
    notAGitCommand: /'.+' is not a git command/i
};

export enum GitErrorHandling {
    Ignore = 'ignore',
    Throw = 'throw'
}

export interface GitCommandOptions extends RunOptions {
    configs?: string[];
    readonly correlationKey?: string;
    errors?: GitErrorHandling;
    // Specifies that this command should always be executed locally if possible
    local?: boolean;
}

// A map of running git commands -- avoids running duplicate overlaping commands
const pendingCommands: Map<string, Promise<string | Buffer>> = new Map();

export async function git<TOut extends string | Buffer>(options: GitCommandOptions, ...args: any[]): Promise<TOut> {
    if (Container.vsls.isMaybeGuest) {
        if (options.local !== true) {
            const guest = await Container.vsls.guest();
            if (guest !== undefined) {
                return guest.git<TOut>(options, ...args);
            }
        }
        else {
            // Since we will have a live share path here, just blank it out
            options.cwd = emptyStr;
        }
    }

    const start = process.hrtime();

    const { configs, correlationKey, errors: errorHandling, ...opts } = options;

    const encoding = options.encoding || 'utf8';
    const runOpts: RunOptions = {
        ...opts,
        encoding: encoding === 'utf8' ? 'utf8' : encoding === 'buffer' ? 'buffer' : 'binary',
        // Adds GCM environment variables to avoid any possible credential issues -- from https://github.com/Microsoft/vscode/issues/26573#issuecomment-338686581
        // Shouldn't *really* be needed but better safe than sorry
        env: {
            ...process.env,
            ...(options.env || emptyObj),
            GCM_INTERACTIVE: 'NEVER',
            GCM_PRESERVE_CREDS: 'TRUE',
            LC_ALL: 'C'
        }
    };

    const gitCommand = `[${runOpts.cwd}] git ${args.join(' ')}`;

    const command = `${correlationKey !== undefined ? `${correlationKey}:` : emptyStr}${gitCommand}`;

    let waiting;
    let promise = pendingCommands.get(command);
    if (promise === undefined) {
        waiting = false;

        // Fixes https://github.com/eamodio/vscode-gitlens/issues/73 & https://github.com/eamodio/vscode-gitlens/issues/161
        // See https://stackoverflow.com/questions/4144417/how-to-handle-asian-characters-in-file-names-in-git-on-os-x
        args.splice(
            0,
            0,
            '-c',
            'core.quotepath=false',
            '-c',
            'color.ui=false',
            ...(configs !== undefined ? configs : emptyArray)
        );

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

        switch (errorHandling) {
            case GitErrorHandling.Ignore:
                exception = undefined;
                return emptyStr as TOut;

            case GitErrorHandling.Throw:
                throw ex;

            default: {
                const result = defaultExceptionHandler(ex, options.cwd, start);
                exception = undefined;
                return result as TOut;
            }
        }
    }
    finally {
        pendingCommands.delete(command);

        const duration = `${Strings.getDurationMilliseconds(start)} ms ${waiting ? '(await) ' : emptyStr}`;
        if (exception !== undefined) {
            Logger.warn(
                `[${runOpts.cwd}] Git ${(exception.message || exception.toString() || emptyStr)
                    .trim()
                    .replace(/fatal: /g, '')
                    .replace(/\r?\n|\r/g, ` ${GlyphChars.Dot} `)} ${GlyphChars.Dot} ${duration}`
            );
        }
        else {
            Logger.log(`${gitCommand} ${GlyphChars.Dot} ${duration}`);
        }
        Logger.logGitCommand(
            `${gitCommand} ${GlyphChars.Dot} ${exception !== undefined ? 'FAILED ' : emptyStr}${duration}`,
            exception
        );
    }
}

function defaultExceptionHandler(ex: Error, cwd: string | undefined, start?: [number, number]): string {
    const msg = ex.message || ex.toString();
    if (msg != null && msg.length !== 0) {
        for (const warning of Objects.values(GitWarnings)) {
            if (warning.test(msg)) {
                const duration = start !== undefined ? `${Strings.getDurationMilliseconds(start)} ms` : emptyStr;
                Logger.warn(
                    `[${cwd}] Git ${msg
                        .trim()
                        .replace(/fatal: /g, '')
                        .replace(/\r?\n|\r/g, ` ${GlyphChars.Dot} `)} ${GlyphChars.Dot} ${duration}`
                );
                return emptyStr;
            }
        }

        const match = GitErrors.badRevision.exec(msg);
        if (match != null && match) {
            const [, ref] = match;

            // Since looking up a ref with ^3 (e.g. looking for untracked files in a stash) can error on some versions of git just ignore it
            if (ref != null && ref.endsWith('^3')) return emptyStr;
        }
    }

    throw ex;
}

let gitInfo: GitLocation;

export class Git {
    static deletedOrMissingSha = '0000000000000000000000000000000000000000-';
    static shaLikeRegex = /(^[0-9a-f]{40}([\^@~:]\S*)?$)|(^[0]{40}(:|-)$)/;
    static shaRegex = /(^[0-9a-f]{40}$)|(^[0]{40}(:|-)$)/;
    static shaShortenRegex = /^(.*?)([\^@~:].*)?$/;
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
        strings = { stagedUncommitted: 'Index', uncommitted: 'Working Tree', working: emptyStr, ...strings };

        if (ref == null || ref.length === 0) return strings.working;
        if (Git.isUncommitted(ref)) {
            if (Git.isStagedUncommitted(ref)) return strings.stagedUncommitted;

            return strings.uncommitted;
        }

        // Don't allow shas to be shortened to less than 5 characters
        const len = Math.max(5, Container.config.advanced.abbreviatedShaLength);

        // If we have a suffix, append it
        const match = Git.shaShortenRegex.exec(ref);
        if (match != null) {
            const [, rev, suffix] = match;

            if (suffix != null) {
                return `${rev.substr(0, len)}${suffix}`;
            }
        }

        return ref.substr(0, len);
    }

    static splitPath(fileName: string, repoPath: string | undefined, extract: boolean = true): [string, string] {
        if (repoPath) {
            fileName = Strings.normalizePath(fileName);
            repoPath = Strings.normalizePath(repoPath);

            const normalizedRepoPath = (repoPath.endsWith(slash) ? repoPath : `${repoPath}/`).toLowerCase();
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

    static add(repoPath: string | undefined, pathspec: string) {
        return git<string>({ cwd: repoPath }, 'add', '-A', '--', pathspec);
    }

    static apply(repoPath: string | undefined, patch: string, options: { allowConflicts?: boolean } = {}) {
        const params = ['apply', '--whitespace=warn'];
        if (options.allowConflicts) {
            params.push('-3');
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

    static blame_contents(
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
        const params = ['branch', '-vv', '--abbrev=40'];
        if (options.all) {
            params.push('-a');
        }

        return git<string>({ cwd: repoPath, configs: ['-c', 'color.branch=false'] }, ...params);
    }

    static branch_contains(repoPath: string, ref: string, options: { remote: boolean } = { remote: false }) {
        const params = ['branch', '--contains'];
        if (options.remote) {
            params.push('-r');
        }

        return git<string>({ cwd: repoPath, configs: ['-c', 'color.branch=false'] }, ...params, ref);
    }

    static async cat_validate(repoPath: string, ref: string) {
        if (Git.isUncommitted(ref)) return true;

        try {
            await git<string>({ cwd: repoPath, errors: GitErrorHandling.Throw }, 'cat-file', '-t', ref);
            return true;
        }
        catch (ex) {
            return false;
        }
    }

    static async cat_file_validate(repoPath: string, fileName: string, ref: string) {
        if (Git.isUncommitted(ref)) return ref;

        try {
            await git<string>(
                { cwd: repoPath, errors: GitErrorHandling.Throw },
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

    static check_mailmap(repoPath: string, author: string) {
        return git<string>({ cwd: repoPath, errors: GitErrorHandling.Ignore, local: true }, 'check-mailmap', author);
    }

    static checkout(repoPath: string, ref: string, fileName?: string) {
        const params = ['checkout', ref, '--'];
        if (fileName) {
            [fileName, repoPath] = Git.splitPath(fileName, repoPath);

            params.push(fileName);
        }

        return git<string>({ cwd: repoPath }, ...params);
    }

    static async config_get(key: string, repoPath?: string, options: { local?: boolean } = {}) {
        const data = await git<string>(
            { cwd: repoPath || emptyStr, errors: GitErrorHandling.Ignore, local: options.local },
            'config',
            '--get',
            key
        );
        return data.length === 0 ? undefined : data.trim();
    }

    static async config_getRegex(pattern: string, repoPath?: string, options: { local?: boolean } = {}) {
        const data = await git<string>(
            { cwd: repoPath || emptyStr, errors: GitErrorHandling.Ignore, local: options.local },
            'config',
            '--get-regex',
            pattern
        );
        return data.length === 0 ? undefined : data.trim();
    }

    static async diff(
        repoPath: string,
        fileName: string,
        ref1?: string,
        ref2?: string,
        options: { encoding?: string; filter?: string } = {}
    ): Promise<string> {
        const params = ['diff', '-M', '--no-ext-diff', '-U0', '--minimal'];
        if (options.filter) {
            params.push(`--diff-filter=${options.filter}`);
        }

        if (ref1) {
            // <sha>^3 signals an untracked file in a stash and if we are trying to find its parent, use the root sha
            if (ref1.endsWith('^3^')) {
                ref1 = rootSha;
            }
            params.push(Git.isStagedUncommitted(ref1) ? '--staged' : ref1);
        }
        if (ref2) {
            params.push(Git.isStagedUncommitted(ref2) ? '--staged' : ref2);
        }

        const encoding: BufferEncoding = options.encoding === 'utf8' ? 'utf8' : 'binary';

        try {
            return await git<string>(
                { cwd: repoPath, configs: ['-c', 'color.diff=false'], encoding: encoding },
                ...params,
                '--',
                fileName
            );
        }
        catch (ex) {
            const match = GitErrors.badRevision.exec(ex.message);
            if (match !== null) {
                const [, ref] = match;

                // If the bad ref is trying to find a parent ref, assume we hit to the last commit, so try again using the root sha
                if (ref === ref1 && ref != null && ref.endsWith('^')) {
                    return Git.diff(repoPath, fileName, rootSha, ref2, options);
                }
            }

            throw ex;
        }
    }

    static diff_nameStatus(repoPath: string, ref1?: string, ref2?: string, options: { filter?: string } = {}) {
        const params = ['diff', '--name-status', '-M', '--no-ext-diff'];
        if (options && options.filter) {
            params.push(`--diff-filter=${options.filter}`);
        }
        if (ref1) {
            params.push(ref1);
        }
        if (ref2) {
            params.push(ref2);
        }

        return git<string>({ cwd: repoPath, configs: ['-c', 'color.diff=false'] }, ...params);
    }

    static diff_shortstat(repoPath: string, ref?: string) {
        const params = ['diff', '--shortstat', '--no-ext-diff'];
        if (ref) {
            params.push(ref);
        }
        return git<string>({ cwd: repoPath, configs: ['-c', 'color.diff=false'] }, ...params);
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

        return git<string>({ cwd: repoPath }, ...params, '--', fileName);
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

    static log(repoPath: string, options: { authors?: string[]; maxCount?: number; ref?: string; reverse?: boolean }) {
        const params = [...defaultLogParams, '--full-history', '-M', '-m'];
        if (options.authors) {
            params.push('--use-mailmap', ...options.authors.map(a => `--author=${a}`));
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
        return git<string>(
            { cwd: repoPath, configs: ['-c', 'diff.renameLimit=0', '-c', 'log.showSignature=false'] },
            ...params,
            '--'
        );
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
        params.push(options.renames ? '--follow' : '-m');

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

    static log_file_simple(repoPath: string, fileName: string, ref?: string, count: number = 2, line?: number) {
        const [file, root] = Git.splitPath(fileName, repoPath);

        const params = ['log', `--format=${logSimpleFormat}`, `-n${count}`, '--follow'];
        if (ref && !Git.isStagedUncommitted(ref)) {
            params.push(ref);
        }

        if (line != null) {
            // Don't include --name-status or -s because Git won't honor it
            params.push(/*'-s',*/ `-L ${line},${line}:${file}`);
        }
        else {
            params.push('--name-status');
        }

        return git<string>({ cwd: root }, ...params, '--', file);
    }

    static async log_recent(repoPath: string, fileName: string) {
        const data = await git<string>(
            { cwd: repoPath, errors: GitErrorHandling.Ignore },
            'log',
            '-M',
            '-n1',
            '--format=%H',
            '--',
            fileName
        );
        return data.length === 0 ? undefined : data.trim();
    }

    static log_search(repoPath: string, search: string[] = emptyArray, options: { maxCount?: number } = {}) {
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

        const data = await git<string>({ cwd: repoPath, errors: GitErrorHandling.Ignore }, ...params, '--', fileName);
        return data.length === 0 ? undefined : data.trim();
    }

    static async ls_tree(repoPath: string, ref: string, options: { fileName?: string } = {}) {
        const params = ['ls-tree'];
        if (options.fileName) {
            params.push('-l', ref, '--', options.fileName);
        }
        else {
            params.push('-lrt', ref, '--');
        }
        const data = await git<string>({ cwd: repoPath, errors: GitErrorHandling.Ignore }, ...params);
        return data.length === 0 ? undefined : data.trim();
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
        const data = await git<string>({ cwd: repoPath, errors: GitErrorHandling.Ignore }, 'rev-parse', ref);
        return data.length === 0 ? undefined : data.trim();
    }

    static async revparse_currentBranch(repoPath: string): Promise<[string, string | undefined] | undefined> {
        const params = ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@', '@{u}'];

        const opts: GitCommandOptions = {
            cwd: repoPath,
            errors: GitErrorHandling.Throw
        };

        try {
            const data = await git<string>(opts, ...params);
            return [data, undefined];
        }
        catch (ex) {
            const msg = ex && ex.toString();
            if (GitWarnings.headNotABranch.test(msg)) {
                const data = await git<string>(
                    { ...opts, errors: GitErrorHandling.Ignore },
                    'log',
                    '-n1',
                    '--format=%H',
                    '--'
                );
                if (data.length === 0) return undefined;

                // Matches output of `git branch -vv`
                const sha = data.trim();
                return [`(HEAD detached at ${this.shortenSha(sha)})`, sha];
            }

            const result = GitWarnings.noUpstream.exec(msg);
            if (result !== null) return [result[1], undefined];

            if (GitWarnings.unknownRevision.test(msg)) {
                const data = await git<string>(
                    { ...opts, errors: GitErrorHandling.Ignore },
                    'symbolic-ref',
                    '-q',
                    '--short',
                    'HEAD'
                );
                return data.length === 0 ? undefined : [data.trim(), undefined];
            }

            defaultExceptionHandler(ex, opts.cwd);
            return undefined;
        }
    }

    static async revparse_toplevel(cwd: string): Promise<string | undefined> {
        const data = await git<string>({ cwd: cwd, errors: GitErrorHandling.Ignore }, 'rev-parse', '--show-toplevel');
        return data.length === 0 ? undefined : data.trim();
    }

    static shortlog(repoPath: string) {
        return git<string>({ cwd: repoPath }, 'shortlog', '-sne', '--all', '--no-merges');
    }

    static async show<TOut extends string | Buffer>(
        repoPath: string | undefined,
        fileName: string,
        ref: string,
        options: {
            encoding?: 'binary' | 'ascii' | 'utf8' | 'utf16le' | 'ucs2' | 'base64' | 'latin1' | 'hex' | 'buffer';
        } = {}
    ): Promise<TOut | undefined> {
        const [file, root] = Git.splitPath(fileName, repoPath);

        if (Git.isStagedUncommitted(ref)) {
            ref = ':';
        }
        if (Git.isUncommitted(ref)) throw new Error(`ref=${ref} is uncommitted`);

        const opts: GitCommandOptions = {
            configs: ['-c', 'log.showSignature=false'],
            cwd: root,
            encoding: options.encoding || 'utf8',
            errors: GitErrorHandling.Throw
        };
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

            return defaultExceptionHandler(ex, opts.cwd) as TOut;
        }
    }

    static show_diff(repoPath: string, fileName: string, ref: string) {
        return git<string>({ cwd: repoPath }, 'show', '--format=', '--minimal', '-U0', ref, '--', fileName);
    }

    static show_status(repoPath: string, fileName: string, ref: string) {
        return git<string>({ cwd: repoPath }, 'show', '--name-status', '--format=', ref, '--', fileName);
    }

    static showref_tag(repoPath: string) {
        return git<string>({ cwd: repoPath, errors: GitErrorHandling.Ignore }, 'show-ref', '--tags');
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
            { cwd: repoPath, configs: ['-c', 'color.status=false'], env: { GIT_OPTIONAL_LOCKS: '0' } },
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
            { cwd: root, configs: ['-c', 'color.status=false'], env: { GIT_OPTIONAL_LOCKS: '0' } },
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

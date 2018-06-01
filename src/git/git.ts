'use strict';
import { Objects, Strings } from '../system';
import { findGitPath, IGit } from './gitLocator';
import { Logger } from '../logger';
import { CommandOptions, runCommand } from './shell';
import * as fs from 'fs';
import * as iconv from 'iconv-lite';
import * as path from 'path';

export { IGit };
export * from './models/models';
export * from './parsers/parsers';
export * from './remotes/provider';

let git: IGit;

const defaultBlameParams = ['blame', '--root', '--incremental'];

// Using %x00 codes because some shells seem to try to expand things if not
const lb = '%x3c'; // `%x${'<'.charCodeAt(0).toString(16)}`;
const rb = '%x3e'; // `%x${'>'.charCodeAt(0).toString(16)}`;
const sl = '%x2f'; // `%x${'/'.charCodeAt(0).toString(16)}`;

const logFormat = [
    `${lb}${sl}f${rb}`,
    `${lb}r${rb} %H`,   // ref
    `${lb}a${rb} %an`,  // author
    `${lb}e${rb} %ae`,  // email
    `${lb}d${rb} %at`,  // date
    `${lb}p${rb} %P`,   // parents
    `${lb}s${rb}`,
    `%B`,               // summary
    `${lb}${sl}s${rb}`,
    `${lb}f${rb}`
].join('%n');

const defaultLogParams = ['log', '--name-status', '-M', `--format=${logFormat}`];

const stashFormat = [
    `${lb}${sl}f${rb}`,
    `${lb}r${rb} %H`,   // ref
    `${lb}d${rb} %at`,  // date
    `${lb}l${rb} %gd`,  // reflog-selector
    `${lb}s${rb}`,
    `%B`,               // summary
    `${lb}${sl}s${rb}`,
    `${lb}f${rb}`
].join('%n');

const defaultStashParams = ['stash', 'list', '--name-status', '-M', `--format=${stashFormat}`];

const GitErrors = {
    badRevision: /bad revision \'.*?\'/i
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
    unknownRevision: /ambiguous argument \'.*?\': unknown revision or path not in the working tree|not stored as a remote-tracking branch/i
};

async function gitCommand(options: CommandOptions & { readonly correlationKey?: string }, ...args: any[]): Promise<string> {
    try {
        return await gitCommandCore(options, ...args);
    }
    catch (ex) {
        return gitCommandDefaultErrorHandler(ex, options, ...args);
    }
}

// A map of running git commands -- avoids running duplicate overlaping commands
const pendingCommands: Map<string, Promise<string>> = new Map();

async function gitCommandCore(options: CommandOptions & { readonly correlationKey?: string }, ...args: any[]): Promise<string> {
    const start = process.hrtime();

    const { correlationKey, ...opts } = options;

    const encoding = options.encoding || 'utf8';
    const runOpts = {
        ...opts,
        encoding: encoding === 'utf8' ? 'utf8' : 'binary',
        // Adds GCM environment variables to avoid any possible credential issues -- from https://github.com/Microsoft/vscode/issues/26573#issuecomment-338686581
        // Shouldn't *really* be needed but better safe than sorry
        env: { ...(options.env || process.env), GCM_INTERACTIVE: 'NEVER', GCM_PRESERVE_CREDS: 'TRUE', LC_ALL: 'C' }
    } as CommandOptions;

    const gitCommand = `git ${args.join(' ')}`;
    const command = `(${runOpts.cwd}${correlationKey !== undefined ? correlationKey : ''}): ${gitCommand}`;

    let promise = pendingCommands.get(command);
    if (promise === undefined) {
        Logger.log(`Running${command}`);
        // Fixes https://github.com/eamodio/vscode-gitlens/issues/73 & https://github.com/eamodio/vscode-gitlens/issues/161
        // See https://stackoverflow.com/questions/4144417/how-to-handle-asian-characters-in-file-names-in-git-on-os-x
        args.splice(0, 0, '-c', 'core.quotepath=false', '-c', 'color.ui=false');

        promise = runCommand(git.path, args, runOpts);

        pendingCommands.set(command, promise);
    }
    else {
        Logger.log(`Awaiting${command}`);
    }

    let data: string;
    let exception: Error | undefined;
    try {
        data = await promise;
    }
    catch (ex) {
        exception = ex;
        throw ex;
    }
    finally {
        pendingCommands.delete(command);

        const duration = process.hrtime(start);
        const completedIn = `${exception === undefined ? 'Completed' : 'FAILED'} in ${(duration[0] * 1000) + Math.floor(duration[1] / 1000000)} ms`;

        Logger.log(`${exception === undefined ? 'Completed' : 'FAILED'}${command} ${completedIn}`);
        Logger.logGitCommand(`${gitCommand} ${completedIn}`, runOpts.cwd!, exception);
    }

    if (encoding === 'utf8' || encoding === 'binary') return data;

    return iconv.decode(Buffer.from(data, 'binary'), encoding);
}

function gitCommandDefaultErrorHandler(ex: Error, options: CommandOptions, ...args: any[]): string {
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

export class Git {

    static shaRegex = /^[0-9a-f]{40}(\^[0-9]*?)??( -)?$/;
    static shaStrictRegex = /^[0-9a-f]{40}$/;
    static stagedUncommittedRegex = /^[0]{40}(\^[0-9]*?)??:$/;
    static stagedUncommittedSha = '0000000000000000000000000000000000000000:';
    static uncommittedRegex = /^[0]{40}(\^[0-9]*?)??:??$/;
    static uncommittedSha = '0000000000000000000000000000000000000000';

    static gitInfo(): IGit {
        return git;
    }

    static getEncoding(encoding: string | undefined) {
        return (encoding !== undefined && iconv.encodingExists(encoding))
            ? encoding
            : 'utf8';
    }

    static async getGitInfo(gitPath?: string): Promise<IGit> {
        const start = process.hrtime();

        git = await findGitPath(gitPath);

        const duration = process.hrtime(start);
        Logger.log(`Git found: ${git.version} @ ${git.path === 'git' ? 'PATH' : git.path} in ${(duration[0] * 1000) + Math.floor(duration[1] / 1000000)} ms`);

        return git;
    }

    static async getVersionedFile(repoPath: string | undefined, fileName: string, ref: string) {
        const data = await Git.show(repoPath, fileName, ref, { encoding: 'binary' });
        if (data === undefined) return undefined;

        if (Git.isStagedUncommitted(ref)) {
            ref = '';
        }

        const suffix = Strings.truncate(Strings.sanitizeForFileSystem(Git.isSha(ref) ? Git.shortenSha(ref)! : ref), 50, '');
        const ext = path.extname(fileName);

        const tmp = await import('tmp');
        return new Promise<string>((resolve, reject) => {
            tmp.file({ prefix: `${path.basename(fileName, ext)}-${suffix}__`, postfix: ext },
                (err, destination, fd, cleanupCallback) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    Logger.log(`getVersionedFile[${destination}]('${repoPath}', '${fileName}', ${ref})`);
                    fs.appendFile(destination, data, { encoding: 'binary' }, err => {
                        if (err) {
                            reject(err);
                            return;
                        }

                        const ReadOnly = 0o100444; // 33060 0b1000000100100100
                        fs.chmod(destination, ReadOnly, err => {
                            resolve(destination);
                        });
                    });
                });
        });
    }

    static isResolveRequired(sha: string) {
        return Git.isSha(sha) && !Git.shaStrictRegex.test(sha);
    }

    static isSha(sha: string) {
        return Git.shaRegex.test(sha);
    }

    static isStagedUncommitted(sha: string | undefined): boolean {
        return sha === undefined ? false : Git.stagedUncommittedRegex.test(sha);
    }

    static isUncommitted(sha: string | undefined) {
        return sha === undefined ? false : Git.uncommittedRegex.test(sha);
    }

    static shortenSha(sha: string, strings: { stagedUncommitted?: string, uncommitted?: string, working?: string } = {}) {
        strings = { stagedUncommitted: 'index', uncommitted: 'working', working: '', ...strings };

        if (sha === '') return strings.working;
        if (Git.isStagedUncommitted(sha)) return strings.stagedUncommitted;
        if (Git.isUncommitted(sha)) return strings.uncommitted;

        const index = sha.indexOf('^');
        if (index > 6) {
            // Only grab a max of 5 chars for the suffix
            const suffix = sha.substring(index).substring(0, 5);
            return `${sha.substring(0, 8 - suffix.length)}${suffix}`;
        }
        return sha.substring(0, 8);
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
            repoPath = Strings.normalizePath(extract ? path.dirname(fileName) : repoPath!);
            fileName = Strings.normalizePath(extract ? path.basename(fileName) : fileName);
        }

        return [ fileName, repoPath ];
    }

    static validateVersion(major: number, minor: number): boolean {
        const [gitMajor, gitMinor] = git.version.split('.');
        return (parseInt(gitMajor, 10) >= major && parseInt(gitMinor, 10) >= minor);
    }

    // Git commands

    static async blame(repoPath: string | undefined, fileName: string, sha?: string, options: { args?: string[] | null, ignoreWhitespace?: boolean, startLine?: number, endLine?: number } = {}) {
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
        if (sha) {
            if (Git.isStagedUncommitted(sha)) {
                // Pipe the blame contents to stdin
                params.push('--contents', '-');

                // Get the file contents for the staged version using `:`
                stdin = await Git.show(repoPath, fileName, ':');
            }
            else {
                params.push(sha);
            }
        }

        return gitCommand({ cwd: root, stdin: stdin }, ...params, '--', file);
    }

    static async blame_contents(repoPath: string | undefined, fileName: string, contents: string, options: { args?: string[] | null, correlationKey?: string, ignoreWhitespace?: boolean, startLine?: number, endLine?: number } = {}) {
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

        return gitCommand({ cwd: root, stdin: contents, correlationKey: options.correlationKey }, ...params, '--', file);
    }

    static branch(repoPath: string, options: { all: boolean } = { all: false }) {
        const params = ['branch', '-vv'];
        if (options.all) {
            params.push('-a');
        }

        return gitCommand({ cwd: repoPath }, ...params);
    }

    static checkout(repoPath: string, fileName: string, sha: string) {
        const [file, root] = Git.splitPath(fileName, repoPath);

        return gitCommand({ cwd: root }, 'checkout', sha, '--', file);
    }

    static async config_get(key: string, repoPath?: string) {
        try {
            const data = await gitCommandCore({ cwd: repoPath || '' }, 'config', '--get', key);
            return data.trim();
        }
        catch {
            return undefined;
        }
    }

    static diff(repoPath: string, fileName: string, sha1?: string, sha2?: string, options: { encoding?: string } = {}) {
        const params = ['diff', '--diff-filter=M', '-M', '--no-ext-diff', '--minimal'];
        if (sha1) {
            params.push(Git.isStagedUncommitted(sha1) ? '--staged' : sha1);
        }
        if (sha2) {
            params.push(Git.isStagedUncommitted(sha2) ? '--staged' : sha2);
        }

        const encoding: BufferEncoding = options.encoding === 'utf8' ? 'utf8' : 'binary';
        return gitCommand({ cwd: repoPath, encoding: encoding }, ...params, '--', fileName);
    }

    static diff_nameStatus(repoPath: string, sha1?: string, sha2?: string, options: { filter?: string } = {}) {
        const params = ['diff', '--name-status', '-M', '--no-ext-diff'];
        if (options && options.filter) {
            params.push(`--diff-filter=${options.filter}`);
        }
        if (sha1) {
            params.push(sha1);
        }
        if (sha2) {
            params.push(sha2);
        }

        return gitCommand({ cwd: repoPath }, ...params);
    }

    static diff_shortstat(repoPath: string, sha?: string) {
        const params = ['diff', '--shortstat', '--no-ext-diff'];
        if (sha) {
            params.push(sha);
        }
        return gitCommand({ cwd: repoPath }, ...params);
    }

    static difftool_dirDiff(repoPath: string, tool: string, ref1: string, ref2?: string) {
        const params = ['difftool', '--dir-diff', `--tool=${tool}`, ref1];
        if (ref2) {
            params.push(ref2);
        }

        return gitCommand({ cwd: repoPath }, ...params);
    }

    static difftool_fileDiff(repoPath: string, fileName: string, tool: string, staged: boolean) {
        const params = ['difftool', '--no-prompt', `--tool=${tool}`];
        if (staged) {
            params.push('--staged');
        }
        params.push('--', fileName);

        return gitCommand({ cwd: repoPath }, ...params);
    }

    static log(repoPath: string, options: { maxCount?: number, ref?: string, reverse?: boolean }) {
        const params = [...defaultLogParams, '--full-history', '-m'];
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
        return gitCommand({ cwd: repoPath }, ...params, '--');
    }

    static log_file(repoPath: string, fileName: string, options: { maxCount?: number, ref?: string, renames?: boolean, reverse?: boolean, startLine?: number, endLine?: number } = { renames: true, reverse: false }) {
        const [file, root] = Git.splitPath(fileName, repoPath);

        const params = [...defaultLogParams];
        if (options.maxCount && !options.reverse) {
            params.push(`-n${options.maxCount}`);
        }

        if (options.renames) {
            params.push('--follow', '-m', '--first-parent');
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

        return gitCommand({ cwd: root }, ...params, '--', file);
    }

    static async log_recent(repoPath: string, fileName: string) {
        try {
            const data = await gitCommandCore({ cwd: repoPath }, 'log', '-M', '-n1', '--format=%H', '--', fileName);
            return data.trim();
        }
        catch {
            return undefined;
        }
    }

    static async log_resolve(repoPath: string, fileName: string, ref: string) {
        try {
            const data = await gitCommandCore({ cwd: repoPath }, 'log', '-M', '-n1', '--format=%H', ref, '--', fileName);
            return data.trim();
        }
        catch {
            return undefined;
        }
    }

    static log_search(repoPath: string, search: string[] = [], options: { maxCount?: number } = {}) {
        const params = [...defaultLogParams, '-m', '-i'];
        if (options.maxCount) {
            params.push(`-n${options.maxCount}`);
        }

        return gitCommand({ cwd: repoPath }, ...params, ...search);
    }

    static log_shortstat(repoPath: string, options: { ref?: string }) {
        const params = ['log', '--shortstat', '--oneline'];
        if (options.ref && !Git.isStagedUncommitted(options.ref)) {
            params.push(options.ref);
        }
        return gitCommand({ cwd: repoPath }, ...params, '--');
    }

    static async ls_files(repoPath: string, fileName: string, options: { ref?: string } = {}): Promise<string> {
        const params = ['ls-files'];
        if (options.ref && !Git.isStagedUncommitted(options.ref)) {
            params.push(`--with-tree=${options.ref}`);
        }

        try {
            const data = await gitCommandCore({ cwd: repoPath }, ...params, fileName);
            return data.trim();
        }
        catch {
            return '';
        }
    }

    static merge_base(repoPath: string, ref1: string, ref2: string, options: { forkPoint?: boolean } = {}) {
        const params = ['merge-base'];
        if (options.forkPoint) {
            params.push('--fork-point');
        }

        return gitCommand({ cwd: repoPath }, ...params, ref1, ref2);
    }

    static remote(repoPath: string): Promise<string> {
        return gitCommand({ cwd: repoPath }, 'remote', '-v');
    }

    static remote_url(repoPath: string, remote: string): Promise<string> {
        return gitCommand({ cwd: repoPath }, 'remote', 'get-url', remote);
    }

    static async revparse(repoPath: string, ref: string): Promise<string | undefined> {
        try {
            const data = await gitCommandCore({ cwd: repoPath }, 'rev-parse', ref);
            return data.trim();
        }
        catch {
            return undefined;
        }
    }

    static async revparse_currentBranch(repoPath: string): Promise<string | undefined> {
        const params = ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@', '@{u}'];

        const opts = { cwd: repoPath } as CommandOptions;
        try {
            const data = await gitCommandCore(opts, ...params);
            return data;
        }
        catch (ex) {
            const msg = ex && ex.toString();
            if (GitWarnings.headNotABranch.test(msg)) return undefined;

            const result = GitWarnings.noUpstream.exec(msg);
            if (result !== null) return result[1];

            if (GitWarnings.unknownRevision.test(msg)) {
                try {
                    const params = ['symbolic-ref', '-q', '--short', 'HEAD'];
                    const data = await gitCommandCore(opts, ...params);
                    return data;
                }
                catch {
                    return undefined;
                }
            }

            return gitCommandDefaultErrorHandler(ex, opts, ...params);
        }
    }

    static async revparse_toplevel(cwd: string): Promise<string | undefined> {
        try {
            const data = await gitCommandCore({ cwd: cwd }, 'rev-parse', '--show-toplevel');
            return data.trim();
        }
        catch {
            return undefined;
        }
    }

    static async show(repoPath: string | undefined, fileName: string, ref: string, options: { encoding?: string } = {}): Promise<string | undefined> {
        const [file, root] = Git.splitPath(fileName, repoPath);

        if (Git.isStagedUncommitted(ref)) {
            ref = ':';
        }
        if (Git.isUncommitted(ref)) throw new Error(`sha=${ref} is uncommitted`);

        const opts = { cwd: root, encoding: options.encoding || 'utf8' } as CommandOptions;
        const args = ref.endsWith(':')
            ? `${ref}./${file}`
            : `${ref}:./${file}`;

        try {
            const data = await gitCommandCore(opts, 'show', args, '--');
            return data;
        }
        catch (ex) {
            const msg = ex && ex.toString();
            if (ref === ':' && GitErrors.badRevision.test(msg)) {
                return Git.show(repoPath, fileName, 'HEAD:', options);
            }

            if (GitErrors.badRevision.test(msg) ||
                GitWarnings.notFound.test(msg) ||
                GitWarnings.foundButNotInRevision.test(msg)) return undefined;

            return gitCommandDefaultErrorHandler(ex, opts, args);
        }
    }

    static stash_apply(repoPath: string, stashName: string, deleteAfter: boolean) {
        if (!stashName) return undefined;
        return gitCommand({ cwd: repoPath }, 'stash', deleteAfter ? 'pop' : 'apply', stashName);
    }

    static stash_delete(repoPath: string, stashName: string) {
        if (!stashName) return undefined;
        return gitCommand({ cwd: repoPath }, 'stash', 'drop', stashName);
    }

    static stash_list(repoPath: string) {
        return gitCommand({ cwd: repoPath }, ...defaultStashParams);
    }

    static stash_push(repoPath: string, pathspecs: string[], message?: string) {
        const params = ['stash', 'push', '-u'];
        if (message) {
            params.push('-m', message);
        }
        params.splice(params.length, 0, '--', ...pathspecs);
        return gitCommand({ cwd: repoPath }, ...params);
    }

    static stash_save(repoPath: string, message?: string) {
        const params = ['stash', 'save', '-u'];
        if (message) {
            params.push(message);
        }
        return gitCommand({ cwd: repoPath }, ...params);
    }

    static status(repoPath: string, porcelainVersion: number = 1): Promise<string> {
        const porcelain = porcelainVersion >= 2 ? `--porcelain=v${porcelainVersion}` : '--porcelain';
        return gitCommand({ cwd: repoPath, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }, 'status', porcelain, '--branch', '-u');
    }

    static status_file(repoPath: string, fileName: string, porcelainVersion: number = 1): Promise<string> {
        const [file, root] = Git.splitPath(fileName, repoPath);

        const porcelain = porcelainVersion >= 2 ? `--porcelain=v${porcelainVersion}` : '--porcelain';
        return gitCommand({ cwd: root, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }, 'status', porcelain, file);
    }

    static tag(repoPath: string) {
        const params = ['tag', '-l'];

        return gitCommand({ cwd: repoPath }, ...params);
    }
}

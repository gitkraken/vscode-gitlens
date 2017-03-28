'use strict';
import { findGitPath, IGit } from './gitLocator';
import { Logger } from '../logger';
import { spawnPromise } from 'spawn-rx';
import * as fs from 'fs';
import * as path from 'path';
import * as tmp from 'tmp';

export * from './models/models';
export * from './parsers/blameParser';
export * from './parsers/logParser';
export * from './parsers/stashParser';
export * from './parsers/statusParser';
export * from './remotes/provider';

let git: IGit;

// `--format=%H -%nauthor %an%nauthor-date %ai%ncommitter %cn%ncommitter-date %ci%nparents %P%nsummary %B%nfilename ?`
const defaultLogParams = [`log`, `--name-status`, `--full-history`, `-M`, `--date=iso8601`, `--format=%H -%nauthor %an%nauthor-date %ai%nparents %P%nsummary %B%nfilename ?`];
const defaultStashParams = [`stash`, `list`, `--name-status`, `--full-history`, `-M`, `--format=%H -%nauthor-date %ai%nreflog-selector %gd%nsummary %B%nfilename ?`];

async function gitCommand(cwd: string, ...args: any[]) {
    try {
        const s = await spawnPromise(git.path, args, { cwd: cwd });
        Logger.log('git', ...args, `  cwd='${cwd}'`);
        return s;
    }
    catch (ex) {
        const msg = ex && ex.toString();
        if (msg && (msg.includes('Not a git repository') || msg.includes('is outside repository') || msg.includes('no such path'))) {
            Logger.warn('git', ...args, `  cwd='${cwd}'`, msg && `\n  ${msg.replace(/\r?\n|\r/g, ' ')}`);
            return '';
        }
        else {
            Logger.error(ex, 'git', ...args, `  cwd='${cwd}'`, msg && `\n  ${msg.replace(/\r?\n|\r/g, ' ')}`);
        }
        throw ex;
    }
}

export class Git {

    static shaRegex = /^[0-9a-f]{40}( -)?$/;
    static uncommittedRegex = /^[0]+$/;

    static gitInfo(): IGit {
        return git;
    }

    static async getRepoPath(cwd: string, gitPath?: string) {
        git = await findGitPath(gitPath);
        Logger.log(`Git found: ${git.version} @ ${git.path === 'git' ? 'PATH' : git.path}`);

        let data = await gitCommand(cwd, 'rev-parse', '--show-toplevel');
        data = data.replace(/\r?\n|\r/g, '').replace(/\\/g, '/');
        return data;
    }

    static async getVersionedFile(repoPath: string, fileName: string, branchOrSha: string) {
        const data = await Git.show(repoPath, fileName, branchOrSha);

        const suffix = Git.isSha(branchOrSha) ? branchOrSha.substring(0, 8) : branchOrSha;
        const ext = path.extname(fileName);
        return new Promise<string>((resolve, reject) => {
            tmp.file({ prefix: `${path.basename(fileName, ext)}-${suffix}__`, postfix: ext },
                (err, destination, fd, cleanupCallback) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    Logger.log(`getVersionedFile('${repoPath}', '${fileName}', ${branchOrSha}); destination=${destination}`);
                    fs.appendFile(destination, data, err => {
                        if (err) {
                            reject(err);
                            return;
                        }

                        resolve(destination);
                    });
                });
        });
    }

    static isSha(sha: string) {
        return Git.shaRegex.test(sha);
    }

    static isUncommitted(sha: string) {
        return Git.uncommittedRegex.test(sha);
    }

    static normalizePath(fileName: string, repoPath?: string) {
        return fileName && fileName.replace(/\\/g, '/');
    }

    static splitPath(fileName: string, repoPath: string | undefined, extract: boolean = true): [string, string] {
        if (repoPath) {
            fileName = this.normalizePath(fileName);
            repoPath = this.normalizePath(repoPath);

            const normalizedRepoPath = (repoPath.endsWith('/') ? repoPath : `${repoPath}/`).toLowerCase();
            if (fileName.toLowerCase().startsWith(normalizedRepoPath)) {
                fileName = fileName.substring(normalizedRepoPath.length);
            }
        }
        else {
            repoPath = this.normalizePath(extract ? path.dirname(fileName) : repoPath);
            fileName = this.normalizePath(extract ? path.basename(fileName) : fileName);
        }

        return [ fileName, repoPath ];
    }

    static validateVersion(major: number, minor: number): boolean {
        const [gitMajor, gitMinor] = git.version.split('.');
        return (parseInt(gitMajor, 10) >= major && parseInt(gitMinor, 10) >= minor);
    }

    // Git commands

    static blame(repoPath: string, fileName: string, sha?: string, startLine?: number, endLine?: number) {
        const [file, root] = Git.splitPath(fileName, repoPath);

        const params = [`blame`, `--root`, `--incremental`];

        if (startLine != null && endLine != null) {
            params.push(`-L ${startLine},${endLine}`);
        }

        if (sha) {
            params.push(sha);
        }

        return gitCommand(root, ...params, `--`, file);
    }

    static branch(repoPath: string, all: boolean) {
        const params = [`branch`];
        if (all) {
            params.push(`-a`);
        }

        return gitCommand(repoPath, ...params);
    }

    static diff_nameStatus(repoPath: string, sha1?: string, sha2?: string) {
        const params = [`diff`, `--name-status`, `-M`];
        if (sha1) {
            params.push(sha1);
        }
        if (sha2) {
            params.push(sha2);
        }

        return gitCommand(repoPath, ...params);
    }

    static difftool_dirDiff(repoPath: string, sha1: string, sha2?: string) {
        const params = [`difftool`, `--dir-diff`, sha1];
        if (sha2) {
            params.push(sha2);
        }

        return gitCommand(repoPath, ...params);
    }

    static log(repoPath: string, sha?: string, maxCount?: number, reverse: boolean = false) {
        const params = [...defaultLogParams, `-m`];
        if (maxCount && !reverse) {
            params.push(`-n${maxCount}`);
        }
        if (sha) {
            if (reverse) {
                params.push(`--reverse`);
                params.push(`--ancestry-path`);
                params.push(`${sha}..HEAD`);
            }
            else {
                params.push(sha);
            }
        }
        return gitCommand(repoPath, ...params);
    }

    static log_file(repoPath: string, fileName: string, sha?: string, maxCount?: number, reverse: boolean = false, startLine?: number, endLine?: number) {
        const [file, root] = Git.splitPath(fileName, repoPath);

        const params = [...defaultLogParams, `--follow`];
        if (maxCount && !reverse) {
            params.push(`-n${maxCount}`);
        }

        // If we are looking for a specific sha don't exclude merge commits
        if (!sha || maxCount > 2) {
            params.push(`--no-merges`);
        }
        else {
            params.push(`-m`);
        }

        if (sha) {
            if (reverse) {
                params.push(`--reverse`);
                params.push(`--ancestry-path`);
                params.push(`${sha}..HEAD`);
            }
            else {
                params.push(sha);
            }
        }

        if (startLine != null && endLine != null) {
            params.push(`-L ${startLine},${endLine}:${file}`);
        }

        params.push(`--`);
        params.push(file);

        return gitCommand(root, ...params);
    }

    static remote(repoPath: string): Promise<string> {
        return gitCommand(repoPath, 'remote', '-v');
    }

    static remote_url(repoPath: string, remote: string): Promise<string> {
        return gitCommand(repoPath, 'remote', 'get-url', remote);
    }

    static show(repoPath: string, fileName: string, branchOrSha: string) {
        const [file, root] = Git.splitPath(fileName, repoPath);
        branchOrSha = branchOrSha.replace('^', '');

        if (Git.isUncommitted(branchOrSha)) return Promise.reject(new Error(`sha=${branchOrSha} is uncommitted`));
        return gitCommand(root, 'show', `${branchOrSha}:./${file}`);
    }

    static stash_apply(repoPath: string, stashName: string, deleteAfter: boolean) {
        if (!stashName) return undefined;
        return gitCommand(repoPath, 'stash', deleteAfter ? 'pop' : 'apply', stashName);
    }

    static stash_delete(repoPath: string, stashName: string) {
        if (!stashName) return undefined;
        return gitCommand(repoPath, 'stash', 'drop', stashName);
    }

    static stash_list(repoPath: string) {
        return gitCommand(repoPath, ...defaultStashParams);
    }

    static status(repoPath: string, porcelainVersion: number = 1): Promise<string> {
        const porcelain = porcelainVersion >= 2 ? `--porcelain=v${porcelainVersion}` : '--porcelain';
        return gitCommand(repoPath, 'status', porcelain, '--branch');
    }

    static status_file(repoPath: string, fileName: string, porcelainVersion: number = 1): Promise<string> {
        const [file, root] = Git.splitPath(fileName, repoPath);

        const porcelain = porcelainVersion >= 2 ? `--porcelain=v${porcelainVersion}` : '--porcelain';
        return gitCommand(root, 'status', porcelain, file);
    }
}
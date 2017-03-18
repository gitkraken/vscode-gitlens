'use strict';
import { findGitPath, IGit } from './gitLocator';
import { Logger } from '../logger';
import { spawnPromise } from 'spawn-rx';
import * as fs from 'fs';
import * as path from 'path';
import * as tmp from 'tmp';

export * from './gitEnrichment';
export * from './enrichers/blameParserEnricher';
export * from './enrichers/logParserEnricher';

let git: IGit;

const DefaultLogParams = [`log`, `--name-status`, `--full-history`, `-M`, `--date=iso8601-strict`, `--format=%H -%nauthor %an%nauthor-date %ai%ncommitter %cn%ncommitter-date %ci%nparent %P%nsummary %B%nfilename ?`];

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
        }
        else {
            Logger.error('git', ...args, `  cwd='${cwd}'`, msg && `\n  ${msg.replace(/\r?\n|\r/g, ' ')}`);
        }
        throw ex;
    }
}

export type GitBlameFormat = '--incremental' | '--line-porcelain' | '--porcelain';
export const GitBlameFormat = {
    incremental: '--incremental' as GitBlameFormat,
    linePorcelain: '--line-porcelain' as GitBlameFormat,
    porcelain: '--porcelain' as GitBlameFormat
};

export class Git {

    static ShaRegex = /^[0-9a-f]{40}( -)?$/;
    static UncommittedRegex = /^[0]+$/;

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
        return Git.ShaRegex.test(sha);
    }

    static isUncommitted(sha: string) {
        return Git.UncommittedRegex.test(sha);
    }

    static normalizePath(fileName: string, repoPath?: string) {
        return fileName.replace(/\\/g, '/');
    }

    static splitPath(fileName: string, repoPath?: string): [string, string] {
        if (repoPath) {
            return [
                fileName.replace(repoPath.endsWith('/') ? repoPath : `${repoPath}/`, ''),
                repoPath
            ];
        }

        return [
            path.basename(fileName).replace(/\\/g, '/'),
            path.dirname(fileName).replace(/\\/g, '/')
        ];
    }

    // Git commands

    static blame(repoPath: string, fileName: string, format: GitBlameFormat, sha?: string, startLine?: number, endLine?: number) {
        const [file, root]: [string, string] = Git.splitPath(Git.normalizePath(fileName), repoPath);

        const params = [`blame`, `--root`, format];

        if (startLine != null && endLine != null) {
            params.push(`-L ${startLine},${endLine}`);
        }

        if (sha) {
            params.push(sha);
        }

        return gitCommand(root, ...params, `--`, file);
    }

    static branch(repoPath: string) {
        const params = [`branch`, `-a`];

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

    static show(repoPath: string, fileName: string, branchOrSha: string) {
        const [file, root] = Git.splitPath(Git.normalizePath(fileName), repoPath);
        branchOrSha = branchOrSha.replace('^', '');

        if (Git.isUncommitted(branchOrSha)) return Promise.reject(new Error(`sha=${branchOrSha} is uncommitted`));
        return gitCommand(root, 'show', `${branchOrSha}:./${file}`);
    }

    static log(repoPath: string, sha?: string, maxCount?: number, reverse: boolean = false) {
        const params = [...DefaultLogParams];
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
        const [file, root]: [string, string] = Git.splitPath(Git.normalizePath(fileName), repoPath);

        const params = [...DefaultLogParams, `--no-merges`, `--follow`];
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

        if (startLine != null && endLine != null) {
            params.push(`-L ${startLine},${endLine}:${file}`);
        }

        params.push(`--`);
        params.push(file);

        return gitCommand(root, ...params);
    }

    static status(repoPath: string): Promise<string> {
        const params = ['status', '--short'];
        return gitCommand(repoPath, ...params);
    }

    static status_file(repoPath: string, fileName: string): Promise<string> {
        const [file, root]: [string, string] = Git.splitPath(Git.normalizePath(fileName), repoPath);

        const params = ['status', file, '--short'];
        return gitCommand(root, ...params);
    }
}
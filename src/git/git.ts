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
const UncommittedRegex = /^[0]+$/;

const DefaultLogParams = [`log`, `--name-status`, `--full-history`, `-m`, `--date=iso8601-strict`, `--format=%H -%nauthor %an%nauthor-date %ai%ncommitter %cn%ncommitter-date %ci%nparent %P%nsummary %B%nfilename ?`];

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

    static async repoPath(cwd: string, gitPath?: string) {
        git = await findGitPath(gitPath);
        Logger.log(`Git found: ${git.version} @ ${git.path === 'git' ? 'PATH' : git.path}`);

        let data = await gitCommand(cwd, 'rev-parse', '--show-toplevel');
        data = data.replace(/\r?\n|\r/g, '').replace(/\\/g, '/');
        return data;
    }

    static blame(format: GitBlameFormat, fileName: string, sha?: string, repoPath?: string) {
        const [file, root]: [string, string] = Git.splitPath(Git.normalizePath(fileName), repoPath);

        const params = [`blame`, `--root`, format];
        if (sha) {
            params.push(sha);
        }

        return gitCommand(root, ...params, `--`, file);
    }

    static blameLines(format: GitBlameFormat, fileName: string, startLine: number, endLine: number, sha?: string, repoPath?: string) {
        const [file, root]: [string, string] = Git.splitPath(Git.normalizePath(fileName), repoPath);

        const params = [`blame`, `--root`, format, `-L ${startLine},${endLine}`];
        if (sha) {
            params.push(sha);
        }

        return gitCommand(root, ...params, `--`, file);
    }

    static diffDir(repoPath: string, sha1: string, sha2?: string) {
        const params = [`difftool`, `--dir-diff`, sha1];
        if (sha2) {
            params.push(sha2);
        }

        return gitCommand(repoPath, ...params);
    }

    static diffStatus(repoPath: string, sha1?: string, sha2?: string) {
        const params = [`diff`, `--name-status`, `-M`];
        if (sha1) {
            params.push(sha1);
        }
        if (sha2) {
            params.push(sha2);
        }

        return gitCommand(repoPath, ...params);
    }

    static async getVersionedFile(fileName: string, repoPath: string, sha: string) {
        const data = await Git.getVersionedFileText(fileName, repoPath, sha);

        const shortSha = sha.substring(0, 8);
        const ext = path.extname(fileName);
        return new Promise<string>((resolve, reject) => {
            tmp.file({ prefix: `${path.basename(fileName, ext)}-${shortSha}__`, postfix: ext },
                (err, destination, fd, cleanupCallback) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    Logger.log(`getVersionedFile(${fileName}, ${repoPath}, ${sha}); destination=${destination}`);
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

    static getVersionedFileText(fileName: string, repoPath: string, sha: string) {
        const [file, root] = Git.splitPath(Git.normalizePath(fileName), repoPath);
        sha = sha.replace('^', '');

        if (Git.isUncommitted(sha)) return Promise.reject(new Error(`sha=${sha} is uncommitted`));
        return gitCommand(root, 'show', `${sha}:./${file}`);
    }

    static gitInfo(): IGit {
        return git;
    }

    static log(fileName: string, sha?: string, repoPath?: string, maxCount?: number, reverse: boolean = false) {
        const [file, root]: [string, string] = Git.splitPath(Git.normalizePath(fileName), repoPath);

        const params = [...DefaultLogParams, `--follow`, `--no-merges`];
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
            params.push(`--`);
        }

        return gitCommand(root, ...params, file);
    }

    static logRange(fileName: string, start: number, end: number, sha?: string, repoPath?: string, maxCount?: number) {
        const [file, root]: [string, string] = Git.splitPath(Git.normalizePath(fileName), repoPath);

        const params = [...DefaultLogParams, `--no-merges`];
        if (maxCount) {
            params.push(`-n${maxCount}`);
        }
        if (sha) {
            params.push(`--follow`);
            params.push(sha);
        }
        params.push(`-L ${start},${end}:${file}`);

        return gitCommand(root, ...params);
    }

    static logRepo(repoPath: string, sha?: string, maxCount?: number, reverse: boolean = false) {
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

    static statusFile(fileName: string, repoPath: string): Promise<string> {
        const [file, root]: [string, string] = Git.splitPath(Git.normalizePath(fileName), repoPath);

        const params = ['status', file, '--short'];
        return gitCommand(root, ...params);
    }

    static statusRepo(repoPath: string): Promise<string> {
        const params = ['status', '--short'];
        return gitCommand(repoPath, ...params);
    }

    static isUncommitted(sha: string) {
        return UncommittedRegex.test(sha);
    }
}
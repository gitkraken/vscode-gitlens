'use strict';
import * as fs from 'fs';
import * as path from 'path';
import * as tmp from 'tmp';
import {spawnPromise} from 'spawn-rx';

export * from './gitEnrichment';

function gitCommand(cwd: string,  ...args) {
    return spawnPromise('git', args, { cwd: cwd })
        .then(s => {
            console.log('[GitLens]', 'git', ...args);
            return s;
        })
        .catch(ex => {
            const msg = ex && ex.toString();
            if (msg && (msg.includes('is outside repository') || msg.includes('no such path'))) {
                console.warn('[GitLens]', 'git', ...args, msg && msg.replace(/\r?\n|\r/g, ' '));
            } else {
                console.error('[GitLens]', 'git', ...args, msg && msg.replace(/\r?\n|\r/g, ' '));
            }
            throw ex;
        });
}

export type GitBlameFormat = '--incremental' | '--line-porcelain' | '--porcelain';
export const GitBlameFormat = {
    incremental: '--incremental' as GitBlameFormat,
    linePorcelain: '--line-porcelain' as GitBlameFormat,
    porcelain: '--porcelain' as GitBlameFormat
}

export default class Git {
    static normalizePath(fileName: string, repoPath?: string) {
        fileName = fileName.replace(/\\/g, '/');
        repoPath = repoPath.replace(/\\/g, '/');
        if (path.isAbsolute(fileName) && fileName.startsWith(repoPath)) {
            fileName = path.relative(repoPath, fileName).replace(/\\/g, '/');
        }
        return fileName;
    }

    static repoPath(cwd: string) {
        return gitCommand(cwd, 'rev-parse', '--show-toplevel').then(data => data.replace(/\r?\n|\r/g, '').replace(/\\/g, '/'));
    }

    static blame(format: GitBlameFormat, fileName: string, repoPath: string, sha?: string) {
        fileName = Git.normalizePath(fileName, repoPath);

        if (sha) {
            return gitCommand(repoPath, 'blame', format, '--root', `${sha}^`, '--', fileName);
        }
        return gitCommand(repoPath, 'blame', format, '--root', '--', fileName);
    }

    static getVersionedFile(fileName: string, repoPath: string, sha: string) {
        return new Promise<string>((resolve, reject) => {
            Git.getVersionedFileText(fileName, repoPath, sha).then(data => {
                const ext = path.extname(fileName);
                tmp.file({ prefix: `${path.basename(fileName, ext)}-${sha}_`, postfix: ext }, (err, destination, fd, cleanupCallback) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    //console.log(`getVersionedFile(${fileName}, ${sha}); destination=${destination}`);
                    fs.appendFile(destination, data, err => {
                        if (err) {
                            reject(err);
                            return;
                        }
                        resolve(destination);
                    });
                });
            });
        });
    }

    static getVersionedFileText(fileName: string, repoPath: string, sha: string) {
        fileName = Git.normalizePath(fileName, repoPath);
        sha = sha.replace('^', '');

        return gitCommand(repoPath, 'show', `${sha}:./${fileName}`);
    }

    // static getCommitMessage(sha: string, repoPath: string) {
    //     sha = sha.replace('^', '');

    //     return gitCommand(repoPath, 'show', '-s', '--format=%B', sha);
    //         // .then(s => { console.log(s); return s; })
    //         // .catch(ex => console.error(ex));
    // }

    // static getCommitMessages(fileName: string, repoPath: string) {
    //     fileName = Git.normalizePath(fileName, repoPath);

    //     // git log --format="%h (%aN %x09 %ai) %s"  --
    //     return gitCommand(repoPath, 'log', '--oneline', '--', fileName);
    //         // .then(s => { console.log(s); return s; })
    //         // .catch(ex => console.error(ex));
    // }
}
'use strict';
import {basename, dirname, extname, isAbsolute, relative} from 'path';
import * as fs from 'fs';
import * as tmp from 'tmp';
import {spawnPromise} from 'spawn-rx';

function gitCommand(cwd: string,  ...args) {
    return spawnPromise('git', args, { cwd: cwd });
}

export default class Git {
    static normalizePath(fileName: string, repoPath: string) {
        fileName = fileName.replace(/\\/g, '/');
        return isAbsolute(fileName) ? relative(repoPath, fileName) : fileName;
    }

    static repoPath(cwd: string) {
        return gitCommand(cwd, 'rev-parse', '--show-toplevel').then(data => data.replace(/\r?\n|\r/g, ''));
    }

    static blame(fileName: string, repoPath: string, sha?: string) {
        fileName = Git.normalizePath(fileName, repoPath);

        if (sha) {
            console.log('git', 'blame', '-fnw', '--root', `${sha}^`, '--', fileName);
            return gitCommand(repoPath, 'blame', '-fnw', '--root', `${sha}^`, '--', fileName);
        }

        console.log('git', 'blame', '-fnw', '--root', '--', fileName);
        return gitCommand(repoPath, 'blame', '-fnw', '--root', '--', fileName);
            // .then(s => { console.log(s); return s; })
            // .catch(ex => console.error(ex));
    }

    static getVersionedFile(fileName: string, repoPath: string, sha: string) {
        return new Promise<string>((resolve, reject) => {
            Git.getVersionedFileText(fileName, repoPath, sha).then(data => {
                let ext = extname(fileName);
                tmp.file({ prefix: `${basename(fileName, ext)}-${sha}_`, postfix: ext }, (err, destination, fd, cleanupCallback) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    console.log("File: ", destination);
                    console.log("Filedescriptor: ", fd);

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

        console.log('git', 'show', `${sha}:${fileName}`);
        return gitCommand(repoPath, 'show', `${sha}:${fileName}`);
            // .then(s => { console.log(s); return s; })
            // .catch(ex => console.error(ex));
    }

    static getCommitMessage(sha: string, repoPath: string) {
        sha = sha.replace('^', '');

        console.log('git', 'show', '-s', '--format=%B', sha);
        return gitCommand(repoPath, 'show', '-s', '--format=%B', sha);
            // .then(s => { console.log(s); return s; })
            // .catch(ex => console.error(ex));
    }
}
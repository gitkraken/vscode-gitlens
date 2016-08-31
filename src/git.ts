'use strict';
import {basename, dirname, extname, relative} from 'path';
import * as fs from 'fs';
import * as tmp from 'tmp';
import {spawnPromise} from 'spawn-rx';

export function gitRepoPath(cwd) {
    return gitCommand(cwd, 'rev-parse', '--show-toplevel').then(data => data.replace(/\r?\n|\r/g, ''));
}

export function gitBlame(fileName: string) {
    console.log('git', 'blame', '-fnw', '--root', '--', fileName);
    return gitCommand(dirname(fileName), 'blame', '-fnw', '--root', '--', fileName);
}

export function gitGetVersionFile(fileName: string, repoPath: string, sha: string) {
    return new Promise<string>((resolve, reject) => {
        gitGetVersionText(fileName, repoPath, sha).then(data => {
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

export function gitGetVersionText(fileName: string, repoPath: string, sha: string) {
    const gitArg = normalizeArgument(fileName, repoPath, sha);
    console.log('git', 'show', gitArg);
    return gitCommand(dirname(fileName), 'show', gitArg);
}

function normalizeArgument(fileName: string, repoPath: string, sha: string) {
    return `${sha.replace('^', '')}:${relative(repoPath, fileName.replace(/\\/g, '/'))}`;
}

function gitCommand(cwd: string,  ...args) {
    return spawnPromise('git', args, { cwd: cwd });
}
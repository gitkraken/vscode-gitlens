'use strict';
import {basename, dirname, extname, isAbsolute, relative} from 'path';
import * as fs from 'fs';
import * as tmp from 'tmp';
import {spawnPromise} from 'spawn-rx';

export function gitNormalizePath(fileName: string, repoPath: string) {
    fileName = fileName.replace(/\\/g, '/');
    return isAbsolute(fileName) ? relative(repoPath, fileName) : fileName;
}

export function gitRepoPath(cwd) {
    return gitCommand(cwd, 'rev-parse', '--show-toplevel').then(data => data.replace(/\r?\n|\r/g, ''));
}

export function gitBlame(fileName: string, repoPath: string) {
    fileName = gitNormalizePath(fileName, repoPath);

    console.log('git', 'blame', '-fnw', '--root', '--', fileName);
    return gitCommand(repoPath, 'blame', '-fnw', '--root', '--', fileName);
        // .then(s => { console.log(s); return s; })
        // .catch(ex => console.error(ex));
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
    fileName = gitNormalizePath(fileName, repoPath);
    sha = sha.replace('^', '');

    console.log('git', 'show', `${sha}:${fileName}`);
    return gitCommand(repoPath, 'show', `${sha}:${fileName}`);
        // .then(s => { console.log(s); return s; })
        // .catch(ex => console.error(ex));
}

function gitCommand(cwd: string,  ...args) {
    return spawnPromise('git', args, { cwd: cwd });
}
'use strict';
import {basename, dirname, extname} from 'path';
import * as fs from 'fs';
import * as tmp from 'tmp';
import {spawnPromise} from 'spawn-rx';

export declare interface IGitBlameLine {
    sha: string;
    file: string;
    originalLine: number;
    author: string;
    date: Date;
    line: number;
    //code: string;
}

export function gitRepoPath(cwd) {
    return gitCommand(cwd, 'rev-parse', '--show-toplevel').then(data => data.replace(/\r?\n|\r/g, ''));
}

const blameMatcher = /^([\^0-9a-fA-F]{8})\s([\S]*)\s+([0-9\S]+)\s\((.*)\s([0-9]{4}-[0-9]{2}-[0-9]{2}\s[0-9]{2}:[0-9]{2}:[0-9]{2}\s[-|+][0-9]{4})\s+([0-9]+)\)(.*)$/gm;

export function gitBlame(fileName: string) {
    console.log('git', 'blame', '-fnw', '--root', '--', fileName);
    return gitCommand(dirname(fileName), 'blame', '-fnw', '--root', '--', fileName).then(data => {
        let lines: Array<IGitBlameLine> = [];
        let m: Array<string>;
        while ((m = blameMatcher.exec(data)) != null) {
            lines.push({
                sha: m[1],
                file: m[2].trim(),
                originalLine: parseInt(m[3], 10) - 1,
                author: m[4].trim(),
                date: new Date(m[5]),
                line: parseInt(m[6], 10) - 1
                //code: m[7]
            });
        }
        return lines;
    });
}

export function gitGetVersionFile(repoPath: string, sha: string, source: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        gitCommand(repoPath, 'show', `${sha.replace('^', '')}:${source.replace(/\\/g, '/')}`).then(data => {
            let ext = extname(source);
            tmp.file({ prefix: `${basename(source, ext)}-${sha}_`, postfix: ext }, (err, destination, fd, cleanupCallback) => {
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

export function gitGetVersionText(repoPath: string, sha: string, source: string) {
    console.log('git', 'show', `${sha}:${source.replace(/\\/g, '/')}`);
    return gitCommand(repoPath, 'show', `${sha}:${source.replace(/\\/g, '/')}`);
}

function gitCommand(cwd: string,  ...args) {
    return spawnPromise('git', args, { cwd: cwd });
}
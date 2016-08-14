'use strict';
import {spawn} from 'child_process';
import {basename, dirname, extname} from 'path';
import * as fs from 'fs';
import * as tmp from 'tmp';

export declare interface IGitBlameLine {
    sha: string;
    file: string;
    originalLine: number;
    author: string;
    date: Date;
    line: number;
    code: string;
}

export function gitRepoPath(cwd): Promise<string> {
    let data: Array<string> = [];
    const capture = input => data.push(input.toString().replace(/\r?\n|\r/g, ''));
    const output = () => data[0];

    return gitCommand(cwd, capture, output, 'rev-parse', '--show-toplevel');

    // return new Promise<string>((resolve, reject) => {
    //     gitCommand(cwd, capture, output, 'rev-parse', '--show-toplevel')
    //         .then(result => resolve(result[0]))
    //         .catch(reason => reject(reason));
    // });
}

//const blameMatcher = /^(.*)\t\((.*)\t(.*)\t(.*?)\)(.*)$/gm;
//const blameMatcher = /^([0-9a-fA-F]{8})\s([\S]*)\s([0-9\S]+)\s\((.*?)\s([0-9]{4}-[0-9]{2}-[0-9]{2}\s[0-9]{2}:[0-9]{2}:[0-9]{2}\s[-|+][0-9]{4})\s([0-9]+)\)(.*)$/gm;
const blameMatcher = /^([0-9a-fA-F]{8})\s([\S]*)\s+([0-9\S]+)\s\((.*)\s([0-9]{4}-[0-9]{2}-[0-9]{2}\s[0-9]{2}:[0-9]{2}:[0-9]{2}\s[-|+][0-9]{4})\s+([0-9]+)\)(.*)$/gm;

export function gitBlame(fileName: string): Promise<IGitBlameLine[]> {
    let data: string = '';
    const capture = input => data += input.toString();
    const output = () => {
        let lines: Array<IGitBlameLine> = [];
        let m: Array<string>;
        while ((m = blameMatcher.exec(data)) != null) {
            lines.push({
                sha: m[1],
                file: m[2].trim(),
                originalLine: parseInt(m[3], 10) - 1,
                author: m[4].trim(),
                date: new Date(m[5]),
                line: parseInt(m[6], 10) - 1,
                code: m[7]
            });
        }
        return lines;
    };

    return gitCommand(dirname(fileName), capture, output, 'blame', '-fnw', '--', fileName);
}

export function gitGetVersionFile(repoPath: string, sha: string, source: string): Promise<any> {
    let data: Array<any> = [];
    const capture = input => data.push(input);
    const output = () => data;

    return new Promise<string>((resolve, reject) => {
        (gitCommand(repoPath, capture, output, 'show', `${sha}:${source.replace(/\\/g, '/')}`) as Promise<Array<Buffer>>).then(o => {
            let ext = extname(source);
            tmp.file({ prefix: `${basename(source, ext)}-${sha}_`, postfix: ext }, (err, destination, fd, cleanupCallback) => {
                if (err) {
                    reject(err);
                    return;
                }

                console.log("File: ", destination);
                console.log("Filedescriptor: ", fd);

                fs.appendFile(destination, o.join(), err => {
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

export function gitGetVersionText(repoPath: string, sha: string, source: string): Promise<string> {
    let data: Array<string> = [];
    const capture = input => data.push(input.toString());
    const output = () => data;

    return new Promise<string>((resolve, reject) => (gitCommand(repoPath, capture, output, 'show', `${sha}:${source.replace(/\\/g, '/')}`) as Promise<Array<string>>).then(o => resolve(o.join())));
}

function gitCommand(cwd: string, capture: (input: Buffer) => void, output: () => any,  ...args): Promise<any> {
    return new Promise<any>((resolve, reject) => {
        let spawn = require('child_process').spawn;
        let process = spawn('git', args, { cwd: cwd });

        process.stdout.on('data', data => {
            capture(data);
        });

        let errors: Array<string> = [];
        process.stderr.on('data', err => {
            errors.push(err.toString());
        });

        process.on('close', (exitCode, exitSignal) => {
            if (exitCode && errors.length) {
                reject(errors.toString());
                return;
            }

            try {
                resolve(output());
            } catch (ex) {
                reject(ex);
            }
        });
    });
}
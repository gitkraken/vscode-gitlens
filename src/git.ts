'use strict';
import {spawn} from 'child_process';
import {dirname} from 'path';

export declare interface IBlameLine {
    line: number;
    author: string;
    date: Date;
    sha: string;
    //code: string;
}

export function gitRepoPath(cwd)  {
    const mapper = (input, output) => {
        output.push(input.toString().replace(/\r?\n|\r/g, ''))
    };

    return new Promise<string>((resolve, reject) => {
        gitCommand(cwd, mapper, 'rev-parse', '--show-toplevel')
            .then(result => resolve(result[0]))
            .catch(reason => reject(reason));
    });
}

const blameMatcher = /^(.*)\t\((.*)\t(.*)\t(.*?)\)(.*)$/gm;

export function gitBlame(fileName: string) {
    const mapper = (input, output) => {
        let m: Array<string>;
        while ((m = blameMatcher.exec(input.toString())) != null) {
            output.push({
                line: parseInt(m[4], 10),
                author: m[2],
                date: new Date(m[3]),
                sha: m[1]
                //code: m[5]
            });
        }
    };

    return gitCommand(dirname(fileName), mapper, 'blame', '-c', '-M', '-w', '--', fileName) as Promise<IBlameLine[]>;
}

function gitCommand(cwd: string, map: (input: Buffer, output: Array<any>) => void, ...args): Promise<any> {
    return new Promise<any>((resolve, reject) => {
        let spawn = require('child_process').spawn;
        let process = spawn('git', args, { cwd: cwd });

        let output: Array<any> = [];
        process.stdout.on('data', data => {
            map(data, output);
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

            resolve(output);
        });
    });
}
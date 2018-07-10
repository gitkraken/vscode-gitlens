'use strict';
// import { findActualExecutable, spawnPromise } from 'spawn-rx';
import { findExecutable, runCommand } from './shell';
import * as path from 'path';

export interface IGit {
    path: string;
    version: string;
}

function parseVersion(raw: string): string {
    return raw.replace(/^git version /, '');
}

async function findSpecificGit(path: string): Promise<IGit> {
    const version = await runCommand(path, ['--version']);
    // If needed, let's update our path to avoid the search on every command
    if (!path || path === 'git') {
        path = findExecutable(path, ['--version']).cmd;
    }

    return {
        path,
        version: parseVersion(version.trim())
    };
}

async function findGitDarwin(): Promise<IGit> {
    try {
        let path = await runCommand('which', ['git']);
        path = path.replace(/^\s+|\s+$/g, '');

        if (path !== '/usr/bin/git') {
            return findSpecificGit(path);
        }

        try {
            await runCommand('xcode-select', ['-p']);
            return findSpecificGit(path);
        }
        catch (ex) {
            if (ex.code === 2) {
                return Promise.reject(new Error('Unable to find git'));
            }
            return findSpecificGit(path);
        }
    }
    catch (ex) {
        return Promise.reject(new Error('Unable to find git'));
    }
}

function findSystemGitWin32(basePath: string): Promise<IGit> {
    if (!basePath) return Promise.reject(new Error('Unable to find git'));
    return findSpecificGit(path.join(basePath, 'Git', 'cmd', 'git.exe'));
}

function findGitWin32(): Promise<IGit> {
    return findSystemGitWin32(process.env['ProgramW6432']!)
        .then(null, () => findSystemGitWin32(process.env['ProgramFiles(x86)']!))
        .then(null, () => findSystemGitWin32(process.env['ProgramFiles']!))
        .then(null, () => findSpecificGit('git'));
}

export async function findGitPath(path?: string): Promise<IGit> {
    try {
        return await findSpecificGit(path || 'git');
    }
    catch (ex) {
        try {
            switch (process.platform) {
                case 'darwin':
                    return await findGitDarwin();
                case 'win32':
                    return await findGitWin32();
                default:
                    return Promise.reject('Unable to find git');
            }
        }
        catch (ex) {
            return Promise.reject(new Error('Unable to find git'));
        }
    }
}

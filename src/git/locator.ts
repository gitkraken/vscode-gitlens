'use strict';
import * as path from 'path';
import { findExecutable, run } from './shell';

export interface GitLocation {
    path: string;
    version: string;
}

function parseVersion(raw: string): string {
    return raw.replace(/^git version /, '');
}

async function findSpecificGit(path: string): Promise<GitLocation> {
    const version = await run<string>(path, ['--version'], 'utf8');
    // If needed, let's update our path to avoid the search on every command
    if (!path || path === 'git') {
        path = findExecutable(path, ['--version']).cmd;
    }

    return {
        path,
        version: parseVersion(version.trim())
    };
}

async function findGitDarwin(): Promise<GitLocation> {
    try {
        let path = await run<string>('which', ['git'], 'utf8');
        path = path.replace(/^\s+|\s+$/g, '');

        if (path !== '/usr/bin/git') {
            return findSpecificGit(path);
        }

        try {
            await run<string>('xcode-select', ['-p'], 'utf8');
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

function findSystemGitWin32(basePath: string): Promise<GitLocation> {
    if (!basePath) return Promise.reject(new Error('Unable to find git'));
    return findSpecificGit(path.join(basePath, 'Git', 'cmd', 'git.exe'));
}

function findGitWin32(): Promise<GitLocation> {
    return findSystemGitWin32(process.env['ProgramW6432']!)
        .then(null, () => findSystemGitWin32(process.env['ProgramFiles(x86)']!))
        .then(null, () => findSystemGitWin32(process.env['ProgramFiles']!))
        .then(null, () => findSpecificGit('git'));
}

export async function findGitPath(path?: string): Promise<GitLocation> {
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

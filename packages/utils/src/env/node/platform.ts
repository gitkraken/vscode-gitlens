import { platform } from 'node:process';

export const isWindows: boolean = platform === 'win32';
export const isLinux: boolean = platform === 'linux';
export const isMac: boolean = platform === 'darwin';

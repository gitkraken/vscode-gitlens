import { env, UIKind } from 'vscode';

export const isWeb = env.uiKind === UIKind.Web;

export const isLinux = process.platform === 'linux';
export const isMac = process.platform === 'darwin';
export const isWindows = process.platform === 'win32';

import { env, UIKind } from 'vscode';

export const isWeb = env.uiKind === UIKind.Web;
export const isWindows = process.platform === 'win32';

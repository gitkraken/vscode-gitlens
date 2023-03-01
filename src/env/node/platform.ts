import * as process from 'process';
import { env, UIKind } from 'vscode';

export const isWeb = env.uiKind === UIKind.Web;

export const isLinux = process.platform === 'linux';
export const isMac = process.platform === 'darwin';
export const isWindows = process.platform === 'win32';

export function getPlatform(): string {
	if (isWindows) return 'windows';
	if (isMac) return 'macOS';
	if (isLinux) return 'linux';
	return isWeb ? 'web' : 'unknown';
}

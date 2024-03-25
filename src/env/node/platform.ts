import { tmpdir } from 'os';
import { join } from 'path';
import { platform } from 'process';
import { env, UIKind } from 'vscode';

export const isWeb = env.uiKind === UIKind.Web;

export const isLinux = platform === 'linux';
export const isMac = platform === 'darwin';
export const isWindows = platform === 'win32';

export function getPlatform(): string {
	if (isWindows) return 'windows';
	if (isMac) return 'macOS';
	if (isLinux) return 'linux';
	return isWeb ? 'web' : 'unknown';
}

export function getTempFile(filename: string): string {
	return join(tmpdir(), filename);
}

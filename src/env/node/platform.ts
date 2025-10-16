import { networkInterfaces, tmpdir } from 'os';
import { join } from 'path';
import { platform } from 'process';
import { env, UIKind } from 'vscode';

export const isWeb = env.uiKind === UIKind.Web;
export const isOffline = Object.values(networkInterfaces()).every(iface => iface?.every(addr => addr.internal));

export const isLinux = platform === 'linux';
export const isMac = platform === 'darwin';
export const isWindows = platform === 'win32';

type OperatingSystems = 'windows' | 'macOS' | 'linux' | 'unknown';
export type Platform = OperatingSystems | 'web' | `web-${OperatingSystems}` | 'unknown';

export function getPlatform(): Platform {
	if (isWindows) return 'windows';
	if (isMac) return 'macOS';
	if (isLinux) return 'linux';
	return isWeb ? 'web' : 'unknown';
}

export function getTempFile(filename: string): string {
	return join(tmpdir(), filename);
}

export function getAltKeySymbol(): string {
	if (isMac) return '⌥';
	return 'Alt';
}

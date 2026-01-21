import { hostname, networkInterfaces, tmpdir } from 'os';
import { join } from 'path';
import { platform, env as processEnv } from 'process';
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

/**
 * Returns an identifier for the current remote instance, if running in a remote environment.
 * Used to differentiate between multiple instances of the same remote type (e.g., multiple WSL distros).
 *
 * @returns The WSL distro name, hostname for SSH, or undefined if not applicable
 */
export function getRemoteInstanceIdentifier(): string | undefined {
	// For WSL, use the distro name (e.g., "Ubuntu", "Debian")
	const wslDistro = processEnv.WSL_DISTRO_NAME;
	if (wslDistro) return wslDistro;

	// For SSH and other remotes, use hostname to differentiate
	try {
		return hostname();
	} catch {
		return undefined;
	}
}

export const isWeb = true;

const _platform = (navigator as any)?.userAgentData?.platform;
const _userAgent = navigator.userAgent;

export const isLinux = _platform === 'Linux' || _userAgent.includes('Linux');
export const isMac = _platform === 'macOS' || _userAgent.includes('Macintosh');
export const isWindows = _platform === 'Windows' || _userAgent.includes('Windows');

export function getPlatform(): string {
	if (isWindows) return 'web-windows';
	if (isMac) return 'web-macOS';
	if (isLinux) return 'web-linux';
	return 'web';
}

export function getTempFile(filename: string): string {
	return filename;
}

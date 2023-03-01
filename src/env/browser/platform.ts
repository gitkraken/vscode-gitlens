export const isWeb = true;

const _platform = (navigator as any)?.userAgentData?.platform;
const _userAgent = navigator.userAgent;

export const isLinux = _platform === 'Linux' || _userAgent.indexOf('Linux') >= 0;
export const isMac = _platform === 'macOS' || _userAgent.indexOf('Macintosh') >= 0;
export const isWindows = _platform === 'Windows' || _userAgent.indexOf('Windows') >= 0;

export function getPlatform(): string {
	if (isWindows) return 'web-windows';
	if (isMac) return 'web-macOS';
	if (isLinux) return 'web-linux';
	return 'web';
}

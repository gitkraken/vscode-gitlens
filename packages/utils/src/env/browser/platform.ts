declare const navigator: { userAgent: string; userAgentData?: { platform?: string } } | undefined;

const _platform: string | undefined = (
	globalThis as unknown as { navigator?: { userAgentData?: { platform?: string } } }
).navigator?.userAgentData?.platform;
const _userAgent: string = typeof navigator !== 'undefined' ? navigator.userAgent : '';

export const isWindows: boolean = _platform === 'Windows' || _userAgent.includes('Windows');
export const isLinux: boolean = _platform === 'Linux' || _userAgent.includes('Linux');
export const isMac: boolean = _platform === 'macOS' || _userAgent.includes('Macintosh');

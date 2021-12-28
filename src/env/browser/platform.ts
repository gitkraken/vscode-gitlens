export const isWeb = true;
export const isWindows =
	(navigator as any)?.userAgentData?.platform === 'Windows' ||
	navigator.platform === 'Win32' ||
	navigator.platform === 'Win64';

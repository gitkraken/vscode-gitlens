import type { Commands } from '../../../constants';

export function createCommandLink(command: Commands | string, options?: { args?: string | Record<string, unknown> }) {
	if (options?.args != null) {
		if (typeof options.args === 'string') {
			return `command:${command}?${encodeURIComponent(options.args)}`;
		}
		return `command:${command}?${encodeURIComponent(JSON.stringify(options.args))}`;
	}
	return `command:${command}`;
}

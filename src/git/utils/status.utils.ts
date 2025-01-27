import { GlyphChars } from '../../constants';
import { pluralize } from '../../system/string';

export function getUpstreamStatus(
	upstream: { name: string; missing: boolean } | undefined,
	state: { ahead: number; behind: number },
	options?: {
		count?: boolean;
		empty?: string;
		expand?: boolean;
		icons?: boolean;
		prefix?: string;
		separator?: string;
		suffix?: string;
	},
): string {
	let count = true;
	let expand = false;
	let icons = false;
	let prefix = '';
	let separator = ' ';
	let suffix = '';
	if (options != null) {
		({ count = true, expand = false, icons = false, prefix = '', separator = ' ', suffix = '' } = options);
	}
	if (upstream == null || (state.behind === 0 && state.ahead === 0)) return options?.empty ?? '';

	if (expand) {
		let status = '';
		if (upstream.missing) {
			status = 'missing';
		} else {
			if (state.behind) {
				status += `${pluralize('commit', state.behind, {
					infix: icons ? '$(arrow-down) ' : undefined,
				})} behind`;
			}
			if (state.ahead) {
				status += `${status.length === 0 ? '' : separator}${pluralize('commit', state.ahead, {
					infix: icons ? '$(arrow-up) ' : undefined,
				})} ahead`;
				if (suffix.includes(upstream.name.split('/')[0])) {
					status += ' of';
				}
			}
		}
		return `${prefix}${status}${suffix}`;
	}

	const showCounts = count && !upstream.missing;

	return `${prefix}${showCounts ? state.behind : ''}${
		showCounts || state.behind !== 0 ? GlyphChars.ArrowDown : ''
	}${separator}${showCounts ? state.ahead : ''}${showCounts || state.ahead !== 0 ? GlyphChars.ArrowUp : ''}${suffix}`;
}

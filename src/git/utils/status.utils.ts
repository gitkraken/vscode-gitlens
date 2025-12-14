import { GlyphChars } from '../../constants';
import { pluralize } from '../../system/string';
import type { GitTrackingUpstream } from '../models/branch';
import type { GitDiffFileStats } from '../models/diff';

export function getFormattedDiffStatus(
	stats: GitDiffFileStats,
	options?: {
		compact?: boolean;
		empty?: string;
		expand?: boolean;
		prefix?: string;
		separator?: string;
		suffix?: string;
	},
): string {
	const { added, changed, deleted } = stats;
	if (added === 0 && changed === 0 && deleted === 0) return options?.empty ?? '';

	const prefix = options?.prefix ?? '';
	const separator = options?.separator ?? ' ';
	const suffix = options?.suffix ?? '';

	if (options?.expand) {
		let status = '';
		if (added) {
			status += `${pluralize('file', added)} added`;
		}
		if (changed) {
			status += `${status.length === 0 ? '' : separator}${pluralize('file', changed)} changed`;
		}
		if (deleted) {
			status += `${status.length === 0 ? '' : separator}${pluralize('file', deleted)} deleted`;
		}
		return `${prefix}${status}${suffix}`;
	}

	let status = '';
	if (options?.compact) {
		if (added !== 0) {
			status += `+${added}`;
		}
		if (changed !== 0) {
			status += `${status.length === 0 ? '' : separator}~${changed}`;
		}
		if (deleted !== 0) {
			status += `${status.length === 0 ? '' : separator}-${deleted}`;
		}
	} else {
		status += `+${added}${separator}~${changed}${separator}-${deleted}`;
	}

	return `${prefix}${status}${suffix}`;
}

export function getUpstreamStatus(
	upstream: GitTrackingUpstream | undefined,
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
	if (upstream == null) return options?.empty ?? '';
	const {
		state: { ahead, behind },
	} = upstream;
	if (!behind && !ahead) return options?.empty ?? '';

	let count = true;
	let expand = false;
	let icons = false;
	let prefix = '';
	let separator = ' ';
	let suffix = '';
	if (options != null) {
		({ count = true, expand = false, icons = false, prefix = '', separator = ' ', suffix = '' } = options);
	}

	if (expand) {
		let status = '';
		if (upstream.missing) {
			status = 'missing';
		} else {
			if (behind) {
				status += `${pluralize('commit', behind, {
					infix: icons ? '$(arrow-down) ' : undefined,
				})} behind`;
			}
			if (ahead) {
				status += `${status.length === 0 ? '' : separator}${pluralize('commit', ahead, {
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

	return `${prefix}${showCounts ? behind : ''}${showCounts || behind !== 0 ? GlyphChars.ArrowDown : ''}${separator}${
		showCounts ? ahead : ''
	}${showCounts || ahead !== 0 ? GlyphChars.ArrowUp : ''}${suffix}`;
}

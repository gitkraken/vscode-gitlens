import * as l10n from '@vscode/l10n';
import { formatPlural } from '@gitlens/utils/plural.js';
import type { GitTrackingUpstream } from '../models/branch.js';
import type { GitDiffFileStats } from '../models/diff.js';

// Unicode arrows (from GlyphChars)
const arrowDown = '\u2193';
const arrowUp = '\u2191';

function formatFileChange(count: number, kind: 'added' | 'changed' | 'deleted'): string {
	if (kind === 'added') {
		return formatPlural(l10n.t('{0, plural, one{{0} file added} other{{0} files added}}'), [count]);
	}
	if (kind === 'changed') {
		return formatPlural(l10n.t('{0, plural, one{{0} file changed} other{{0} files changed}}'), [count]);
	}
	return formatPlural(l10n.t('{0, plural, one{{0} file deleted} other{{0} files deleted}}'), [count]);
}

function formatExpandedUpstreamStatus(
	behind: number,
	ahead: number,
	options: {
		icons: boolean;
		separator: string;
		upstream?: string;
		upstreamSeparator: string;
		provider?: string;
	},
): string {
	const behindIcon = options.icons ? '$(arrow-down) ' : '';
	const aheadIcon = options.icons ? '$(arrow-up) ' : '';
	const args = {
		behindCount: behind,
		aheadCount: ahead,
		behindIcon: behindIcon,
		aheadIcon: aheadIcon,
		separator: options.separator,
		upstream: options.upstream ?? '',
		upstreamSeparator: options.upstreamSeparator,
		provider: options.provider ?? '',
	};

	if (behind && ahead) {
		if (options.upstream != null) {
			if (options.provider != null) {
				return formatPlural(
					l10n.t(
						'{behindCount, plural, one{{behindIcon}{behindCount} commit behind{separator}{aheadCount, plural, one{{aheadIcon}{aheadCount} commit ahead of{upstreamSeparator}{upstream} on {provider}} other{{aheadIcon}{aheadCount} commits ahead of{upstreamSeparator}{upstream} on {provider}}}} other{{behindIcon}{behindCount} commits behind{separator}{aheadCount, plural, one{{aheadIcon}{aheadCount} commit ahead of{upstreamSeparator}{upstream} on {provider}} other{{aheadIcon}{aheadCount} commits ahead of{upstreamSeparator}{upstream} on {provider}}}}}',
					),
					args,
				);
			}

			return formatPlural(
				l10n.t(
					'{behindCount, plural, one{{behindIcon}{behindCount} commit behind{separator}{aheadCount, plural, one{{aheadIcon}{aheadCount} commit ahead of{upstreamSeparator}{upstream}} other{{aheadIcon}{aheadCount} commits ahead of{upstreamSeparator}{upstream}}}} other{{behindIcon}{behindCount} commits behind{separator}{aheadCount, plural, one{{aheadIcon}{aheadCount} commit ahead of{upstreamSeparator}{upstream}} other{{aheadIcon}{aheadCount} commits ahead of{upstreamSeparator}{upstream}}}}}',
				),
				args,
			);
		}

		return formatPlural(
			l10n.t(
				'{behindCount, plural, one{{behindIcon}{behindCount} commit behind{separator}{aheadCount, plural, one{{aheadIcon}{aheadCount} commit ahead} other{{aheadIcon}{aheadCount} commits ahead}}} other{{behindIcon}{behindCount} commits behind{separator}{aheadCount, plural, one{{aheadIcon}{aheadCount} commit ahead} other{{aheadIcon}{aheadCount} commits ahead}}}}',
			),
			args,
		);
	}

	if (behind) {
		if (options.upstream != null) {
			if (options.provider != null) {
				return formatPlural(
					l10n.t(
						'{behindCount, plural, one{{behindIcon}{behindCount} commit behind{upstreamSeparator}{upstream} on {provider}} other{{behindIcon}{behindCount} commits behind{upstreamSeparator}{upstream} on {provider}}}',
					),
					args,
				);
			}
			return formatPlural(
				l10n.t(
					'{behindCount, plural, one{{behindIcon}{behindCount} commit behind{upstreamSeparator}{upstream}} other{{behindIcon}{behindCount} commits behind{upstreamSeparator}{upstream}}}',
				),
				args,
			);
		}
		return formatPlural(
			l10n.t(
				'{behindCount, plural, one{{behindIcon}{behindCount} commit behind} other{{behindIcon}{behindCount} commits behind}}',
			),
			args,
		);
	}

	if (options.upstream != null) {
		if (options.provider != null) {
			return formatPlural(
				l10n.t(
					'{aheadCount, plural, one{{aheadIcon}{aheadCount} commit ahead of{upstreamSeparator}{upstream} on {provider}} other{{aheadIcon}{aheadCount} commits ahead of{upstreamSeparator}{upstream} on {provider}}}',
				),
				args,
			);
		}
		return formatPlural(
			l10n.t(
				'{aheadCount, plural, one{{aheadIcon}{aheadCount} commit ahead of{upstreamSeparator}{upstream}} other{{aheadIcon}{aheadCount} commits ahead of{upstreamSeparator}{upstream}}}',
			),
			args,
		);
	}
	return formatPlural(
		l10n.t(
			'{aheadCount, plural, one{{aheadIcon}{aheadCount} commit ahead} other{{aheadIcon}{aheadCount} commits ahead}}',
		),
		args,
	);
}

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
			status += formatFileChange(added, 'added');
		}
		if (changed) {
			status += `${status.length === 0 ? '' : separator}${formatFileChange(changed, 'changed')}`;
		}
		if (deleted) {
			status += `${status.length === 0 ? '' : separator}${formatFileChange(deleted, 'deleted')}`;
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
		provider?: string;
		separator?: string;
		suffix?: string;
		upstream?: string;
		upstreamSeparator?: string;
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
	let provider: string | undefined;
	let separator = ' ';
	let suffix = '';
	let upstreamLabel: string | undefined;
	let upstreamSeparator = ' ';
	if (options != null) {
		({
			count = true,
			expand = false,
			icons = false,
			prefix = '',
			provider,
			separator = ' ',
			suffix = '',
			upstream: upstreamLabel,
			upstreamSeparator = ' ',
		} = options);
	}

	if (expand) {
		const status = upstream.missing
			? upstreamLabel != null
				? provider != null
					? l10n.t('missing upstream {upstream} on {provider}', {
							upstream: upstreamLabel,
							provider: provider,
						})
					: l10n.t('missing upstream {upstream}', { upstream: upstreamLabel })
				: l10n.t('missing')
			: formatExpandedUpstreamStatus(behind, ahead, {
					icons: icons,
					separator: separator,
					upstream: upstreamLabel,
					upstreamSeparator: upstreamSeparator,
					provider: provider,
				});
		return `${prefix}${status}${suffix}`;
	}

	const showCounts = count && !upstream.missing;

	return `${prefix}${showCounts ? behind : ''}${showCounts || behind !== 0 ? arrowDown : ''}${separator}${
		showCounts ? ahead : ''
	}${showCounts || ahead !== 0 ? arrowUp : ''}${suffix}`;
}

import * as l10n from '@vscode/l10n';
import { escapeMarkdown } from '@gitlens/utils/markdown.js';
import { getUpstreamStatus } from './status.utils.js';

export function formatMarkdownCode(value: string): string {
	let fenceLength = 1;
	for (const match of value.matchAll(/`+/g)) {
		fenceLength = Math.max(fenceLength, match[0].length + 1);
	}

	const fence = '`'.repeat(fenceLength);
	const padding = value.startsWith('`') || value.endsWith('`') ? ' ' : '';
	return `${fence}${padding}${value}${padding}${fence}`;
}

/**
 * Formats italic markdown indicators, e.g. ` \u00a0(_default, active_)`.
 * Returns empty string if no indicators.
 */
export function formatIndicators(indicators: string[]): string {
	if (!indicators.length) return '';
	return ` \u00a0(_${indicators.map(indicator => escapeMarkdown(indicator)).join(', ')}_)`;
}

/**
 * Formats the "Branch is ..." tracking status line for markdown tooltips.
 * Shared by tree-view nodes (branchNode, worktreeNode) and graph sidebar tooltips.
 */
export function formatTrackingTooltip(
	upstreamName: string,
	upstreamMissing: boolean,
	tracking?: { ahead: number; behind: number },
	providerName?: string,
): string {
	const upstream = `$(git-branch) ${formatMarkdownCode(upstreamName)}`;
	const provider = providerName ? escapeMarkdown(providerName) : undefined;
	const status = getUpstreamStatus(
		{
			name: upstreamName,
			missing: upstreamMissing,
			state: tracking ?? { ahead: 0, behind: 0 },
		},
		{
			empty: upstreamMissing
				? provider
					? l10n.t('missing upstream \\\n {upstream} on {provider}', {
							upstream: upstream,
							provider: provider,
						})
					: l10n.t('missing upstream \\\n {upstream}', { upstream: upstream })
				: provider
					? l10n.t('up to date with \\\n {upstream} on {provider}', {
							upstream: upstream,
							provider: provider,
						})
					: l10n.t('up to date with \\\n {upstream}', { upstream: upstream }),
			expand: true,
			icons: true,
			provider: provider,
			separator: ', ',
			upstream: upstream,
			upstreamSeparator: '\\\n',
		},
	);
	return l10n.t('Branch is {status}', { status: status });
}

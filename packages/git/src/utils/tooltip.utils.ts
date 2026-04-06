import { getUpstreamStatus } from './status.utils.js';

/**
 * Formats italic markdown indicators, e.g. ` \u00a0(_default, active_)`.
 * Returns empty string if no indicators.
 */
export function formatIndicators(indicators: string[]): string {
	if (!indicators.length) return '';
	return ` \u00a0(_${indicators.join(', ')}_)`;
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
	const provider = providerName ? ` on ${providerName}` : '';
	return `Branch is ${getUpstreamStatus(
		{
			name: upstreamName,
			missing: upstreamMissing,
			state: tracking ?? { ahead: 0, behind: 0 },
		},
		{
			empty: `${upstreamMissing ? 'missing upstream' : 'up to date with'} \\\n $(git-branch) \`${upstreamName}\`${provider}`,
			expand: true,
			icons: true,
			separator: ', ',
			suffix: `\\\n$(git-branch) \`${upstreamName}\`${provider}`,
		},
	)}`;
}

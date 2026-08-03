import { shortenRevision } from '@gitlens/git/utils/revision.utils.js';
import { formatIndicators, formatTrackingTooltip } from '@gitlens/git/utils/tooltip.utils.js';
import { formatDate, fromNow } from '@gitlens/utils/date.js';
import { pluralize } from '@gitlens/utils/string.js';
import type {
	GraphSidebarBranch,
	GraphSidebarPullRequest,
	GraphSidebarRemote,
	GraphSidebarStash,
	GraphSidebarTag,
	GraphSidebarWorktree,
} from './protocol.js';

function formatDateWithFromNow(date: number, dateFormat?: string | null): string {
	const relative = fromNow(date);
	if (dateFormat == null) return relative;
	return `${relative} (${formatDate(date, dateFormat)})`;
}

export function branchTooltip(b: GraphSidebarBranch, dateFormat?: string | null): string {
	const suffixes: string[] = [];
	if (b.current) {
		suffixes.push('current branch');
	}
	if (b.worktree) {
		suffixes.push('in a worktree');
	}

	let tooltip = `$(git-branch) \`${b.name}\`${formatIndicators(suffixes)}`;

	if (b.upstream) {
		tooltip += `\n\n${formatTrackingTooltip(b.upstream.name, b.upstream.missing, b.tracking, b.providerName)}`;
	} else if (!b.remote) {
		tooltip += `\n\nLocal branch, hasn't been published to a remote`;
	}

	if (b.date != null) {
		tooltip += `\n\nLast commit ${formatDateWithFromNow(b.date, dateFormat)}`;
	}

	if (b.starred) {
		tooltip += '\\\n$(star-full) Favorited';
	}

	return tooltip;
}

/** Mirrors `getPullRequestTooltip`'s voice — title, then a `#N by @author` byline — so a pull request
 *  reads the same here as it does everywhere else in GitLens. */
export function pullRequestTooltip(pr: GraphSidebarPullRequest, dateFormat?: string | null): string {
	const icon = pr.isDraft ? '$(git-pull-request-draft)' : '$(git-pull-request)';
	let tooltip = `${icon} ${pr.title.trim()}${pr.isDraft ? formatIndicators(['draft']) : ''}`;

	let byline = `#${pr.number}`;
	if (pr.authorName) {
		byline += ` by @${pr.authorName}`;
	}
	if (pr.date != null) {
		// State, not just recency: the panel lists open pull requests, so a merged or closed one only ever
		// arrives through the search-by-number fallback — where "updated 3 days ago" reads exactly like an
		// open one. Same wording the pull request node uses.
		const verb = pr.state === 'merged' ? 'merged' : pr.state === 'closed' ? 'closed' : 'updated';
		byline += `, ${verb} ${formatDateWithFromNow(pr.date, dateFormat)}`;
	}
	tooltip += `\\\n${byline}`;

	return tooltip;
}

/** The `Merges <head> into <base>` sentence, split from {@link pullRequestTooltip} so the hover's Lit half
 *  can place the pull request's size above it — size belongs with the byline, and keeping it out of the
 *  state block leaves the grouping line and the signals that explain it contiguous. */
export function pullRequestMergesTooltip(pr: GraphSidebarPullRequest): string | undefined {
	// A sentence rather than `head → base`: the arrow reads as ambiguous direction, and which side is
	// the target is the whole point of the line.
	if (pr.headBranch == null || pr.baseBranch == null) return undefined;

	// A fork's branch name alone is ambiguous — two pull requests can both be `patch-1` — so it's qualified
	// the way GitHub names a cross-repository head, `<owner>:<branch>`. Same form the Launchpad quick pick
	// uses, so one pull request reads the same in both places.
	const head = `$(git-branch) \`${pr.headOwner != null ? `${pr.headOwner}:` : ''}${pr.headBranch}\``;
	// Base before head, in GitHub's own order, minus its author clause — the row already says who. The count
	// is dropped rather than reordered around when a provider doesn't report one, so the two halves of the
	// sentence never swap places between rows.
	const commits = pr.commitCount ? ` ${pluralize('commit', pr.commitCount)}` : '';
	return `Merges${commits} into $(git-branch) \`${pr.baseBranch}\` from ${head}`;
}

export function tagTooltip(t: GraphSidebarTag, dateFormat?: string | null): string {
	let tooltip = `$(tag) \`${t.name}\``;
	if (t.sha) {
		tooltip += ` \u2014 \`${shortenRevision(t.sha)}\``;
	}
	if (t.date != null) {
		tooltip += `\\\n${formatDateWithFromNow(t.date, dateFormat)}`;
	}
	if (t.message) {
		tooltip += `\n\n${t.message}`;
	}
	return tooltip;
}

export function stashTooltip(s: GraphSidebarStash, dateFormat?: string | null): string {
	let tooltip = `$(archive) ${s.message || s.name}`;
	if (s.stashOnRef) {
		tooltip += `\\\nOn: \`${s.stashOnRef}\``;
	}
	if (s.date != null) {
		tooltip += `\\\n${formatDateWithFromNow(s.date, dateFormat)}`;
	}
	return tooltip;
}

export function worktreeTooltip(w: GraphSidebarWorktree): string {
	let tooltip = worktreeTooltipWithoutChangesLine(w);
	if (w.hasChanges != null) {
		tooltip += w.hasChanges ? '\n\nHas Uncommitted Changes' : '\n\nNo Uncommitted Changes';
	}
	return tooltip;
}

/** The markdown portion of the worktree tooltip without the trailing changes-line. Used by the
 *  webview to compose a rich tooltip where the changes-line is replaced by a `commit-stats` pill. */
export function worktreeTooltipWithoutChangesLine(w: GraphSidebarWorktree): string {
	const indicators: string[] = [];
	if (w.isDefault) {
		indicators.push('default');
	}
	if (w.opened) {
		indicators.push('active');
	}

	const indicatorStr = formatIndicators(indicators);
	const folder = `\\\n$(folder) \`${w.uri}\``;

	let tooltip: string;
	if (w.branch != null) {
		// Branch worktree
		tooltip = `${w.isDefault ? '$(pass) ' : ''}Worktree for $(git-branch) \`${w.branch}\`${indicatorStr}${folder}`;

		if (w.upstream) {
			tooltip += `\n\n${formatTrackingTooltip(w.upstream, false, w.tracking, w.providerName)}`;
		}
	} else if (w.sha != null) {
		// Detached worktree
		tooltip = `${w.isDefault ? '$(pass) ' : ''}Detached Worktree at $(git-commit) ${shortenRevision(w.sha)}${indicatorStr}${folder}`;
	} else {
		// Bare worktree
		tooltip = `${w.isDefault ? '$(pass) ' : ''}Bare Worktree${indicatorStr}${folder}`;
	}

	return tooltip;
}

export function remoteTooltip(r: GraphSidebarRemote): string {
	let tooltip = `\`${r.name}\``;

	if (r.providerName) {
		if (r.connected != null) {
			tooltip += ` \u00a0(${r.providerName} \u2014 _${r.connected ? 'connected' : 'not connected'}${r.isDefault ? ', default' : ''}_)`;
		} else {
			tooltip += ` \u00a0(${r.providerName}${r.isDefault ? ', default' : ''})`;
		}
	} else if (r.isDefault) {
		tooltip += ' \u00a0(_default_)';
	}

	if (r.url) {
		tooltip += `\n\n${r.url}`;
	}
	return tooltip;
}

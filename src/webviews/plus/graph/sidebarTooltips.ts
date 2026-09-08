import * as l10n from '@vscode/l10n';
import { shortenRevision } from '@gitlens/git/utils/revision.utils.js';
import { formatIndicators, formatTrackingTooltip } from '@gitlens/git/utils/tooltip.utils.js';
import { formatDate, fromNow } from '@gitlens/utils/date.js';
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
	return l10n.t('{0} ({1})', relative, formatDate(date, dateFormat));
}

export function branchTooltip(b: GraphSidebarBranch, dateFormat?: string | null): string {
	const suffixes: string[] = [];
	if (b.current) {
		suffixes.push(l10n.t('current branch'));
	}
	if (b.worktree) {
		suffixes.push(l10n.t('in a worktree'));
	}

	let tooltip = l10n.t('$(git-branch) `{0}`{1}', b.name, formatIndicators(suffixes));

	if (b.upstream) {
		tooltip += `\n\n${formatTrackingTooltip(b.upstream.name, b.upstream.missing, b.tracking, b.providerName)}`;
	} else if (!b.remote) {
		tooltip += `\n\n${l10n.t("Local branch, hasn't been published to a remote")}`;
	}

	if (b.date != null) {
		tooltip += `\n\n${l10n.t('Last commit {0}', formatDateWithFromNow(b.date, dateFormat))}`;
	}

	if (b.starred) {
		tooltip += `\\\n${l10n.t('$(star-full) Favorited')}`;
	}

	return tooltip;
}

/** Mirrors `getPullRequestTooltip`'s voice — title, then a `#N by @author` byline — so a pull request
 *  reads the same here as it does everywhere else in GitLens. */
export function pullRequestTooltip(pr: GraphSidebarPullRequest, dateFormat?: string | null): string {
	const icon = pr.isDraft ? '$(git-pull-request-draft)' : '$(git-pull-request)';
	let tooltip = `${icon} ${pr.title.trim()}${pr.isDraft ? formatIndicators([l10n.t('draft')]) : ''}`;

	let byline: string;
	if (pr.date != null) {
		// State, not just recency: the panel lists open pull requests, so a merged or closed one only ever
		// arrives through the search-by-number fallback — where "updated 3 days ago" reads exactly like an
		// open one. Same wording the pull request node uses.
		const date = formatDateWithFromNow(pr.date, dateFormat);
		if (pr.authorName) {
			byline =
				pr.state === 'merged'
					? l10n.t('#{number} by @{author}, merged {date}', {
							number: pr.number,
							author: pr.authorName,
							date: date,
						})
					: pr.state === 'closed'
						? l10n.t('#{number} by @{author}, closed {date}', {
								number: pr.number,
								author: pr.authorName,
								date: date,
							})
						: l10n.t('#{number} by @{author}, updated {date}', {
								number: pr.number,
								author: pr.authorName,
								date: date,
							});
		} else {
			byline =
				pr.state === 'merged'
					? l10n.t('#{number}, merged {date}', { number: pr.number, date: date })
					: pr.state === 'closed'
						? l10n.t('#{number}, closed {date}', { number: pr.number, date: date })
						: l10n.t('#{number}, updated {date}', { number: pr.number, date: date });
		}
	} else if (pr.authorName) {
		byline = l10n.t('#{number} by @{author}', { number: pr.number, author: pr.authorName });
	} else {
		byline = l10n.t('#{0}', pr.number);
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
	if (pr.commitCount == null || pr.commitCount === 0) {
		return l10n.t('Merges into $(git-branch) `{base}` from {head}', {
			base: pr.baseBranch,
			head: head,
		});
	}

	return pr.commitCount === 1
		? l10n.t('Merges {count} commit into $(git-branch) `{base}` from {head}', {
				count: pr.commitCount,
				base: pr.baseBranch,
				head: head,
			})
		: l10n.t('Merges {count} commits into $(git-branch) `{base}` from {head}', {
				count: pr.commitCount,
				base: pr.baseBranch,
				head: head,
			});
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
		tooltip += `\\\n${l10n.t('On: `{0}`', s.stashOnRef)}`;
	}
	if (s.date != null) {
		tooltip += `\\\n${formatDateWithFromNow(s.date, dateFormat)}`;
	}
	return tooltip;
}

export function worktreeTooltip(w: GraphSidebarWorktree): string {
	let tooltip = worktreeTooltipWithoutChangesLine(w);
	if (w.hasChanges != null) {
		tooltip += w.hasChanges
			? `\n\n${l10n.t('Has Uncommitted Changes')}`
			: `\n\n${l10n.t('No Uncommitted Changes')}`;
	}
	return tooltip;
}

/** The markdown portion of the worktree tooltip without the trailing changes-line. Used by the
 *  webview to compose a rich tooltip where the changes-line is replaced by a `commit-stats` pill. */
export function worktreeTooltipWithoutChangesLine(w: GraphSidebarWorktree): string {
	const indicators: string[] = [];
	if (w.isDefault) {
		indicators.push(l10n.t('default'));
	}
	if (w.opened) {
		indicators.push(l10n.t('active'));
	}

	const indicatorStr = formatIndicators(indicators);
	const folder = `\\\n$(folder) \`${w.uri}\``;

	let tooltip: string;
	if (w.branch != null) {
		// Branch worktree
		tooltip = l10n.t(
			'{0}Worktree for $(git-branch) `{1}`{2}{3}',
			w.isDefault ? '$(pass) ' : '',
			w.branch,
			indicatorStr,
			folder,
		);

		if (w.upstream) {
			tooltip += `\n\n${formatTrackingTooltip(w.upstream, false, w.tracking, w.providerName)}`;
		}
	} else if (w.sha != null) {
		// Detached worktree
		tooltip = l10n.t(
			'{0}Detached Worktree at $(git-commit) {1}{2}{3}',
			w.isDefault ? '$(pass) ' : '',
			shortenRevision(w.sha),
			indicatorStr,
			folder,
		);
	} else {
		// Bare worktree
		tooltip = l10n.t('{0}Bare Worktree{1}{2}', w.isDefault ? '$(pass) ' : '', indicatorStr, folder);
	}

	return tooltip;
}

export function remoteTooltip(r: GraphSidebarRemote): string {
	let tooltip = `\`${r.name}\``;

	if (r.providerName) {
		if (r.connected != null) {
			if (r.connected) {
				tooltip += r.isDefault
					? l10n.t('  ({provider} — _connected, default_)', { provider: r.providerName })
					: l10n.t('  ({provider} — _connected_)', { provider: r.providerName });
			} else {
				tooltip += r.isDefault
					? l10n.t('  ({provider} — _not connected, default_)', { provider: r.providerName })
					: l10n.t('  ({provider} — _not connected_)', { provider: r.providerName });
			}
		} else {
			tooltip += r.isDefault
				? l10n.t('  ({provider}, default)', { provider: r.providerName })
				: l10n.t('  ({0})', r.providerName);
		}
	} else if (r.isDefault) {
		tooltip += l10n.t('  (_default_)');
	}

	if (r.url) {
		tooltip += `\n\n${r.url}`;
	}
	return tooltip;
}

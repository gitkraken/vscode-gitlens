import { html, nothing } from 'lit';
import type { IssueOrPullRequest } from '@gitlens/git/models/issueOrPullRequest.js';
import { getPullRequestNumberFromUrl } from '@gitlens/git/utils/pullRequest.utils.js';
import type { Autolink } from '../../../../../autolinks/models/autolinks.js';
import './autolink-chip.js';
import '../code-icon.js';
import '../menu/menu-divider.js';
import '../menu/menu-item.js';
import '../menu/menu-label.js';

export interface MergedAutolinks {
	autolinks: Autolink[];
	enriched: IssueOrPullRequest[];
}

/**
 * Drops basic autolinks that an enriched item already covers, so a resolved issue and its raw
 * autolink don't both render as chips. Memoizes on the two input references — panels re-render far
 * more often than either array changes identity.
 */
export class AutolinkMerger {
	private cache?: {
		autolinksRef: Autolink[] | undefined;
		enrichedRef: IssueOrPullRequest[] | undefined;
		out: MergedAutolinks;
	};

	merge(autolinks: Autolink[] | undefined, enriched: IssueOrPullRequest[] | undefined): MergedAutolinks {
		const cached = this.cache;
		if (cached != null && cached.autolinksRef === autolinks && cached.enrichedRef === enriched) return cached.out;

		let out: MergedAutolinks;
		if (!enriched?.length) {
			out = { autolinks: autolinks ?? [], enriched: [] };
		} else {
			const enrichedIds = new Set(enriched.map(i => i.id));
			const remaining = autolinks?.filter(a => !enrichedIds.has(a.id)) ?? [];
			out = { autolinks: remaining, enriched: enriched };
		}
		this.cache = { autolinksRef: autolinks, enrichedRef: enriched, out: out };
		return out;
	}
}

/** Chips for the merged set — basic autolinks first, then the enriched issues and pull requests.
 *  `detailsOnClick` opts a PR chip's body into opening details on click (see `gl-autolink-chip`'s
 *  `details-on-click`) — issue chips are unaffected. Graph callers pass it; commitDetails doesn't. */
export function renderAutolinkChips(
	merged: MergedAutolinks,
	preferences?: { dateFormat?: string; dateStyle?: 'absolute' | 'relative' },
	detailsOnClick?: boolean,
): unknown {
	const { autolinks, enriched } = merged;

	return html`${
		autolinks.length
			? autolinks.map(autolink => {
					const name = autolink.description ?? autolink.title ?? `${autolink.prefix}${autolink.id}`;
					return html`<gl-autolink-chip
						type="autolink"
						name=${name}
						url=${autolink.url}
						identifier="${autolink.prefix}${autolink.id}"
						openOnRemote
					></gl-autolink-chip>`;
				})
			: nothing
	}${
		enriched.length
			? enriched.map(
					item =>
						html`<gl-autolink-chip
							type=${item.type === 'pullrequest' ? 'pr' : 'issue'}
							name=${item.title}
							url=${item.url}
							identifier="#${
								item.type === 'pullrequest'
									? (getPullRequestNumberFromUrl(item.url) ?? item.id)
									: item.id
							}"
							status=${item.state}
							.date=${item.closed ? item.closedDate : item.createdDate}
							.dateFormat=${preferences?.dateFormat}
							.dateStyle=${preferences?.dateStyle}
							.itemId=${
								item.type === 'pullrequest'
									? (getPullRequestNumberFromUrl(item.url) ?? item.id)
									: item.id
							}
							.providerId=${item.provider?.id}
							?details=${item.type === 'pullrequest'}
							?details-on-click=${item.type === 'pullrequest' && detailsOnClick === true}
							openOnRemote
						></gl-autolink-chip>`,
				)
			: nothing
	}`;
}

/** The `gl-chip-overflow` popover contents — the full set grouped as pull requests, issues, autolinks. */
export function renderAutolinksPopover(merged: MergedAutolinks): unknown {
	const { autolinks, enriched } = merged;
	if (!autolinks.length && !enriched.length) return nothing;

	const enrichedPrs = enriched.filter(i => i.type === 'pullrequest');
	const enrichedIssues = enriched.filter(i => i.type !== 'pullrequest');
	let needsDivider = false;

	return html`<div slot="popover">
		${
			enrichedPrs.length > 0
				? html`<menu-label>Pull Requests</menu-label> ${enrichedPrs.map(
							pr =>
								html`<menu-item href=${pr.url}>
									<code-icon icon="git-pull-request"></code-icon> #${pr.id}
									${pr.title ? ` — ${pr.title}` : ''}
								</menu-item>`,
						)}${((needsDivider = true), nothing)}`
				: nothing
		}
		${
			enrichedIssues.length > 0
				? html`${needsDivider ? html`<menu-divider></menu-divider>` : nothing}
						<menu-label>Issues</menu-label>
						${enrichedIssues.map(
							issue =>
								html`<menu-item href=${issue.url}>
									<code-icon icon="issues"></code-icon> #${issue.id}
									${issue.title ? ` — ${issue.title}` : ''}
								</menu-item>`,
						)}${((needsDivider = true), nothing)}`
				: nothing
		}
		${
			autolinks.length > 0
				? html`${needsDivider ? html`<menu-divider></menu-divider>` : nothing}
						<menu-label>Autolinks</menu-label>
						${autolinks.map(
							a =>
								html`<menu-item href=${a.url}>
									<code-icon icon="link"></code-icon> ${a.prefix}${a.id}${
										a.provider?.name ? ` on ${a.provider.name}` : ''
									}
								</menu-item>`,
						)}`
				: nothing
		}
	</div>`;
}

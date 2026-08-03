import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { PullRequestReviewDecision } from '@gitlens/git/models/pullRequest.js';
import type { LaunchpadGroup } from '../../../../../plus/launchpad/models/launchpad.js';
import { launchpadGroupLabelMap } from '../../../../../plus/launchpad/models/launchpad.js';
import type { GraphSidebarPullRequest } from '../../../../plus/graph/protocol.js';
import { getLaunchpadGroupIconName, getLaunchpadItemGrouping } from '../utils/overviewActions.utils.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/markdown/markdown.js';

/**
 * The Lit half of a PR leaf's hover in the graph sidebar: the row's Launchpad grouping and its review/CI
 * signals, rendered below the markdown half (`pullRequestTooltip`). Split that way because these lines want
 * scoped color/layout a markdown string can't express — the same hybrid compose the worktree leaf uses.
 *
 * Informational only, and a static snapshot: PR data lands on a 30-minute cache, so an open hover has
 * nothing to tick along with (unlike `<gl-agent-tooltip>`, which self-subscribes to live sessions).
 */
@customElement('gl-pr-tooltip')
export class GlPrTooltip extends LitElement {
	static override styles = css`
		:host {
			/* Codicons default to 16px, which towers over this hover's ~13px text */
			--code-icon-size: 1.3rem;

			display: block;
			margin-top: var(--gl-space-4);
			font-size: var(--vscode-font-size);
			line-height: 1.4;
			color: var(--vscode-foreground);
		}

		.launchpad {
			display: flex;
			gap: var(--gl-space-4);
			align-items: center;
			margin: 0;
			font-size: 0.9em;
		}

		/* Same three indicator colors the overview card and branch hover use, so one PR never reads as
		   two different states across surfaces. A quiet group (waiting for review) stays uncolored. */
		.launchpad--mergeable {
			color: var(--vscode-gitlens-launchpadIndicatorMergeableColor);
		}

		.launchpad--blocked {
			color: var(--vscode-gitlens-launchpadIndicatorBlockedColor);
		}

		.launchpad--attention {
			color: var(--vscode-gitlens-launchpadIndicatorAttentionColor);
		}

		.signals {
			display: flex;
			flex-wrap: wrap;
			gap: var(--gl-space-4) var(--gl-space-10);
			align-items: center;
			margin-top: var(--gl-space-4);
			color: var(--vscode-descriptionForeground);
		}

		.merges {
			display: block;
			margin-top: var(--gl-space-4);
			color: var(--vscode-descriptionForeground);
		}

		.signal {
			display: inline-flex;
			gap: var(--gl-space-4);
			align-items: center;
		}

		/* Only the glyph carries the tone. The grouping line above is a single short phrase and can afford
		   to be fully colored; a row of colored sentences beside it just gets hard to read. */
		.signal--blocked code-icon {
			color: var(--vscode-gitlens-launchpadIndicatorBlockedColor);
		}

		.signal--attention code-icon {
			color: var(--vscode-gitlens-launchpadIndicatorAttentionColor);
		}

		.signal--mergeable code-icon {
			color: var(--vscode-gitlens-launchpadIndicatorMergeableColor);
		}

		.stat--added {
			color: var(--gl-stat-added);
		}

		.stat--removed {
			color: var(--gl-stat-removed);
		}
	`;

	/** The row's Launchpad group, resolved by the panel (`getLaunchpadItemGroup`) so the hover and the
	 *  row's indicator never disagree. Absent = no grouping line. */
	@property({ attribute: false }) group?: LaunchpadGroup;

	@property({ attribute: false }) launchpad?: GraphSidebarPullRequest['launchpad'];

	/** CI rollup off the PR model — distinguishes passed from has-no-checks, which the categorizer's
	 *  bare `failingCI` flag can't. When absent, only a failing state (from that flag) is claimed. */
	@property({ attribute: false }) statusCheckRollup?: GraphSidebarPullRequest['statusCheckRollup'];

	/** Review decision off the PR model, for the same reason as {@link statusCheckRollup} — it must
	 *  survive Launchpad categorization being unavailable. */
	@property({ attribute: false }) reviewDecision?: GraphSidebarPullRequest['reviewDecision'];

	/** The `Merges <head> into <base>` sentence as markdown, rendered here rather than in the hover's
	 *  markdown half so the grouping line can sit directly under the pull request's identity — the same
	 *  place the branch hover puts it. */
	@property({ attribute: false }) merges?: string;

	@property({ type: Number }) additions?: number;
	@property({ type: Number }) deletions?: number;
	@property({ type: Number }) comments?: number;

	override render(): unknown {
		// State first, then reference. Someone hovering a red row is asking "why" — that answer sits
		// directly under the title, and what it merges into and how big it is follow.
		return html`${this.renderGrouping()}${this.renderSignals()}${this.renderMerges()}${this.renderStats()}`;
	}

	private renderGrouping() {
		const group = this.group;
		if (group == null) return nothing;

		const label = launchpadGroupLabelMap.get(group);
		const icon = getLaunchpadGroupIconName(group);
		if (label == null || icon == null) return nothing;

		// No trailing phrase — the label IS the statement; anything appended reads as advice the hover
		// isn't offering. A quiet group gets no modifier, so it inherits the tooltip's own color.
		const grouping = getLaunchpadItemGrouping(group);
		return html`<p class="launchpad${grouping != null ? ` launchpad--${grouping}` : ''}">
			<code-icon icon=${icon}></code-icon><span>${label.toUpperCase()}</span>
		</p>`;
	}

	/** Why the pull request is in the state the grouping line names — checks, conflicts, and where review
	 *  stands. Kept apart from {@link renderStats} so the reason for a red BLOCKED reads as belonging to it
	 *  rather than sitting in a run of numbers that say nothing about the state. */
	private renderSignals() {
		const signals: unknown[] = [];

		signals.push(this.renderChecks());

		const lp = this.launchpad;
		if (lp?.hasConflicts) {
			signals.push(this.renderSignal('warning', 'Conflicts', 'blocked'));
		}

		// Off the PR model rather than the categorization, so it still shows when Launchpad is absent.
		signals.push(this.renderReviewDecision(this.reviewDecision));

		if (lp != null) {
			const counts = lp.reviewCounts;
			if (counts.approval) {
				signals.push(this.renderCount('check', counts.approval, 'approval'));
			}
			// The decision above already carries this glyph and says it in words, so the count would repeat
			// both — show it only when there's no decision to attach it to.
			if (counts.changeRequest && this.reviewDecision !== 'ChangesRequested') {
				signals.push(this.renderCount('request-changes', counts.changeRequest, 'change request'));
			}
			// A submitted review whose verdict was "Comment" — someone reviewed and had something to say.
			// That outranks ordinary discussion, so it takes the glyph Launchpad already gives a commented
			// review (follow-up, `report`) and that group's amber, while the PR's plain comment count stays
			// a muted bubble down in the stats. Same-looking bubbles read as the same thing; these aren't.
			if (counts.comment) {
				signals.push(this.renderCount('report', counts.comment, 'review comment', 'attention'));
			}
		}

		if (!signals.some(s => s !== nothing)) return nothing;

		return html`<div class="signals">${signals}</div>`;
	}

	private renderMerges() {
		if (!this.merges) return nothing;

		return html`<gl-markdown class="merges" density="compact" .markdown=${this.merges}></gl-markdown>`;
	}

	/** How big the pull request is and how much has been said about it — volume, not state. Always in this
	 *  order, whether or not Launchpad resolved, so the line doesn't reshuffle between rows. */
	private renderStats() {
		const stats: unknown[] = [];

		if (this.additions || this.deletions) {
			stats.push(html`<span class="signal">
				${this.additions ? html`<span class="stat--added">+${this.additions}</span>` : nothing}
				${this.deletions ? html`<span class="stat--removed">-${this.deletions}</span>` : nothing}
			</span>`);
		}

		if (this.comments) {
			stats.push(this.renderCount('comment-discussion', this.comments, 'comments'));
		}

		if (!stats.length) return nothing;

		return html`<div class="signals stats">${stats}</div>`;
	}

	private renderChecks() {
		switch (this.statusCheckRollup) {
			case 'success':
				return this.renderSignal('pass', 'Checks passed', 'mergeable');
			case 'failed':
				return this.renderSignal('error', 'Checks failing', 'blocked');
			case 'pending':
				return this.renderSignal('clock', 'Checks pending');
			default:
				// No rollup on the wire: the categorizer's flag can only claim the failing side.
				return this.launchpad?.failingCI ? this.renderSignal('error', 'Checks failing', 'blocked') : nothing;
		}
	}

	private renderSignal(icon: string, label: string, tone?: 'blocked' | 'attention' | 'mergeable') {
		return html`<span class="signal${tone != null ? ` signal--${tone}` : ''}">
			<code-icon icon=${icon}></code-icon><span>${label}</span>
		</span>`;
	}

	/** Icon + number, with the noun carried by `aria-label` — spelling each one out would push the line
	 *  past the compact single row this hover is meant to be. */
	private renderCount(icon: string, count: number, noun: string, tone?: 'blocked' | 'attention' | 'mergeable') {
		return html`<span
			class="signal${tone != null ? ` signal--${tone}` : ''}"
			role="img"
			aria-label="${count} ${noun}"
		>
			<code-icon icon=${icon}></code-icon><span>${count}</span>
		</span>`;
	}

	/** Same glyph/label vocabulary as `<issue-pull-request>`, so a PR's review state reads identically
	 *  in the sidebar hover and in the details panes. */
	private renderReviewDecision(decision: `${PullRequestReviewDecision}` | undefined) {
		switch (decision) {
			case 'Approved':
				return this.renderSignal('pass', 'Approved', 'mergeable');
			case 'ChangesRequested':
				return this.renderSignal('request-changes', 'Changes Requested', 'attention');
			case 'ReviewRequired':
				return this.renderSignal('comment-unresolved', 'Review Required');
			default:
				return nothing;
		}
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-pr-tooltip': GlPrTooltip;
	}
}

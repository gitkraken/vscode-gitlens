import { css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import type { PullRequestStackInfo } from '@gitlens/git/models/pullRequest.js';
import { GlElement } from '../element.js';
import { getAutolinkIcon } from './utils.js';
import '../button.js';
import '../code-icon.js';
import '../formatted-date.js';

declare global {
	interface HTMLElementTagNameMap {
		'issue-pull-request': IssuePullRequest;
	}

	interface GlobalEventHandlersEventMap {
		'gl-issue-pull-request-details': CustomEvent<{ id: string; providerId: string | undefined }>;
	}
}

@customElement('issue-pull-request')
export class IssuePullRequest extends GlElement {
	static override styles = css`
		/* Matches the graph's ref-pill hover card (.gl-graph__ref-metadata-card) — same stack, gaps, type
		   sizes and muted tones, so a pull request reads identically wherever it's hovered. */
		:host {
			display: flex;
			flex-direction: column;
			gap: 0.4rem;
			font-size: var(--gl-font-base);
		}

		/* Flex, not the grid the full card uses: compact renders a single row, and the grid's icon spanned
		   rows 1/3 — so a second, empty row plus its row-gap padded the component below its own ink and the
		   text rode high inside the anchor's hover box. */
		:host([compact]) {
			display: flex;
			/* Explicit: the base host is a column, and inheriting that stacked the icon above the title. */
			flex-direction: row;
			align-items: center;
			gap: 0.6rem;
		}

		/* Icon, title, identifier and the actions share the first line; the actions sit hard right, past
		   the identifier. Baseline alignment keeps a wrapped title level with the id that follows it. */
		/* Never wraps: the actions have to stay on the first line, at its right edge. Only the title/id box
		   inside it wraps, so a long title grows downward without pushing the actions onto a row of their own. */
		.head {
			display: flex;
			flex-wrap: nowrap;
			/* Centered, not flex-start: the actions button is taller than the text, so top-aligning left the
			   icon, title and id riding above it. */
			align-items: center;
			gap: 0.2rem 0.5rem;
		}

		.head-text {
			display: flex;
			flex: 1 1 auto;
			flex-wrap: wrap;
			min-width: 0;
			align-items: baseline;
			gap: 0.2rem 0.5rem;
		}

		/* Inherits rather than taking the link colour: the ref card's title is plain, and two differently
		   coloured titles was the most visible mismatch between the two cards. Still underlines on hover,
		   so the affordance survives. */
		a {
			color: inherit;
			text-decoration: none;
		}

		a:hover {
			text-decoration: underline;
		}

		.icon {
			align-self: center;
			flex-shrink: 0;
			text-align: center;
		}

		.icon--pr-opened {
			color: var(--vscode-gitlens-openPullRequestIconColor);
		}

		.icon--pr-closed {
			color: var(--vscode-gitlens-closedPullRequestIconColor);
		}

		.icon--pr-merged {
			color: var(--vscode-gitlens-mergedPullRequestIconColor);
		}

		.icon--pr-draft {
			color: var(--vscode-descriptionForeground);
		}

		.icon--issue-opened {
			color: var(--vscode-gitlens-openAutolinkedIssueIconColor);
		}

		.icon--issue-closed {
			color: var(--vscode-gitlens-closedAutolinkedIssueIconColor);
		}

		.title {
			flex: 1 1 60%;
			min-width: 0;
			margin: 0;
			font-weight: 600;
			overflow-wrap: break-word;
		}

		/* Compact pill: the count is a flex sibling of the identifier so both are centered against the same
		   box. As an inline box it relied on vertical-align, which centers on an approximated x-height —
		   close enough to look like a mistake rather than a choice. */
		:host([compact]) .title {
			display: flex;
			align-items: center;
			gap: 0.4rem;
			font-weight: inherit;
		}

		.date {
			margin: 0;
			color: var(--vscode-descriptionForeground);
			font-size: 1.1rem;
		}

		.identifier {
			flex: none;
			color: var(--vscode-descriptionForeground);
			font-variant-numeric: tabular-nums;
		}

		/* Pushed to the head's right edge — past the identifier — rather than occupying a column of its own. */
		.details {
			display: flex;
			flex: none;
			gap: var(--gl-space-2);
			align-items: center;
			margin: 0;
		}

		.badge {
			display: inline-block;
			padding: 0.1rem 0.4rem;
			font-size: 0.9em;
			line-height: 1;
			border: var(--gl-border-width) solid var(--color-foreground--50);
			border-radius: var(--gl-radius-sm);
			opacity: 0.8;
		}

		/* Its own row in the content column, below the metadata line — inline it competed with the
		   author/state/date for a line that's already dense. */
		.stack-line {
			display: flex;
			gap: 0.4rem;
			align-items: center;
			margin: 0;
			color: var(--vscode-descriptionForeground);
			font-size: 1.1rem;
		}

		/* The layer count, in the same wash-box treatment the graph's ref-pill chip uses. Sits directly
		   against the identifier before it — no separator, so icon/number/count read as one unit. */
		.stack {
			display: inline-flex;
			align-items: center;
			height: 1.5rem;
			padding: 0 0.3rem;
			/* Pushed to the line's right edge, under the actions in the head above it. */
			margin-left: auto;
			/* Without both of these the box inherits the paragraph's line-height and grows to the full line
			   box — tall, and sitting on the text baseline rather than centered against it. */
			line-height: 1;
			vertical-align: middle;
			font-size: 0.9em;
			font-variant-numeric: tabular-nums;
			border-radius: 0.3rem;
			background: color-mix(in srgb, currentColor 18%, transparent);
		}

		.review {
			display: flex;
			gap: 0.3rem;
			align-items: center;
			margin: 0;
			font-size: 1.1rem;
		}

		.review--approved {
			color: var(--vscode-gitlens-mergedPullRequestIconColor);
		}

		.review--changes-requested {
			color: var(--vscode-gitlens-closedPullRequestIconColor);
		}

		.review--review-required {
			opacity: 0.8;
		}
	`;

	@property()
	url = '';

	@property()
	name = '';

	@property()
	date?: number | string | Date;

	@property()
	dateFormat?: string;

	@property()
	dateStyle?: string;

	@property()
	status: 'opened' | 'closed' | 'merged' = 'merged';

	@property()
	type: 'autolink' | 'issue' | 'pr' = 'autolink';

	@property()
	identifier = '';

	/** Numeric id of the PR/issue (no `#` prefix). Carried on the `gl-issue-pull-request-details`
	 *  event so listeners can route by chip when multiple chips share a panel. */
	@property({ attribute: 'item-id' })
	itemId?: string;

	/** Provider id (e.g. 'github') — carried on the `gl-issue-pull-request-details` event so the
	 *  host can resolve the PR by id via the matching integration. */
	@property({ attribute: 'provider-id' })
	providerId?: string;

	@property({ type: Boolean, reflect: true })
	compact?: boolean;

	@property()
	author?: string;

	@property({ type: Boolean })
	isDraft?: boolean;

	/**
	 * What {@link date} actually is — "updated", "merged", and so on.
	 *
	 * Without it the date sits directly after the state and reads as belonging to it: a caller passing an
	 * `updatedDate` for an open pull request rendered "opened 2 hours ago", naming the wrong event. Callers
	 * that pass a created/closed date matching the state leave this unset and read correctly as before.
	 */
	@property({ attribute: 'date-label' })
	dateLabel?: string;

	/** Stack membership, when this pull request is one layer of a stack. */
	@property({ attribute: false })
	stack?: Pick<PullRequestStackInfo, 'number' | 'position' | 'size'>;

	@property()
	reviewDecision?: string;

	@property({ type: Boolean })
	details = false;

	/** Suppresses the "Open Details" eye even when {@link details} is set — for callers whose chip
	 *  body already opens the same details view on click, so the card doesn't offer it twice. */
	@property({ type: Boolean, attribute: 'hide-details-action' })
	hideDetailsAction = false;

	@property({ type: Boolean })
	openOnRemote = false;

	private renderDate() {
		if (!this.date) return nothing;

		return html`<formatted-date
			.date=${new Date(this.date)}
			.format=${this.dateFormat}
			.dateStyle=${this.dateStyle}
		></formatted-date>`;
	}

	override render(): unknown {
		const { icon, modifier } = getAutolinkIcon(this.type, this.status, this.isDraft);

		if (this.compact) {
			return html`
				<span class="icon icon--${modifier}"><code-icon icon=${icon}></code-icon></span>
				<p class="title">
					${this.identifier}${
						this.stack != null
							? html`<span class="stack" title="Layer ${this.stack.position} of ${this.stack.size}"
									>${this.stack.position}/${this.stack.size}</span
								>`
							: nothing
					}
				</p>
			`;
		}

		return html`
			<div class="head">
				<span class="icon icon--${modifier}"><code-icon icon=${icon}></code-icon></span>
				<div class="head-text">
					<p class="title">
						<a href="${this.url}">${this.name}</a>
					</p>
					${
						// The identifier trails the title rather than leading the metadata line — same shape as
						// the graph's ref-pill card, so a pull request reads identically wherever it's hovered.
						this.identifier ? html`<span class="identifier">${this.identifier}</span>` : nothing
					}
				</div>
				${when(
					(this.details === true && !this.hideDetailsAction) || this.openOnRemote === true,
					() => html`
						<p class="details">
							${
								this.details && !this.hideDetailsAction
									? html`<gl-button
											appearance="toolbar"
											tooltip="Open Details"
											@click=${() => this.onDetailsClicked()}
											><code-icon icon="eye"></code-icon
										></gl-button>`
									: nothing
							}
							${
								this.openOnRemote && this.url
									? html`<gl-button appearance="toolbar" tooltip="Open on Remote" href=${this.url}
											><code-icon icon="globe"></code-icon
										></gl-button>`
									: nothing
							}
						</p>
					`,
				)}
			</div>
			<p class="date">
				${
					// "Opened by" holds whatever became of it since, and matches the graph's ref-pill card.
					this.author ? html`Opened by ${this.author}` : nothing
				}${this.isDraft ? html` <span class="badge">Draft</span>` : nothing}${
					// With a `dateLabel` the state word is redundant — the coloured icon already carries state,
					// and the label names the date. Without one the state IS the date's label ("opened 3 days
					// ago" over a created date), so it has to stay.
					this.dateLabel
						? html`${this.author ? ' · ' : nothing}${this.dateLabel} ${this.renderDate()}`
						: html`${this.status ? html` ${this.status}` : nothing} ${this.renderDate()}`
				}
			</p>
			${
				this.stack != null
					? html`<p class="stack-line">
							<code-icon icon="layers"></code-icon>Stack #${this.stack.number}<span class="stack"
								>${this.stack.position}/${this.stack.size}</span
							>
						</p>`
					: nothing
			}
			${this.renderReviewDecision()}
		`;
	}

	private renderReviewDecision() {
		if (!this.reviewDecision || this.type !== 'pr') return nothing;

		let label: string;
		let icon: string;
		let cls: string;
		switch (this.reviewDecision) {
			case 'Approved':
				label = 'Approved';
				icon = 'pass';
				cls = 'review--approved';
				break;
			case 'ChangesRequested':
				label = 'Changes Requested';
				icon = 'request-changes';
				cls = 'review--changes-requested';
				break;
			case 'ReviewRequired':
				label = 'Review Required';
				icon = 'comment-unresolved';
				cls = 'review--review-required';
				break;
			default:
				return nothing;
		}

		return html`<p class="review ${cls}"><code-icon icon=${icon}></code-icon> ${label}</p>`;
	}

	private onDetailsClicked() {
		this.emit('gl-issue-pull-request-details', {
			id: this.itemId ?? '',
			providerId: this.providerId,
		});
	}
}

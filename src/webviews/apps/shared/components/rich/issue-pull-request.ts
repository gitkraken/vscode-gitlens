import { css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
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
		:host {
			display: grid;
			grid-template-columns: min-content 1fr min-content;
			gap: 0.25rem 0.6rem;
			justify-content: start;
			font-size: 1.3rem;
		}

		:host([compact]) {
			grid-template-columns: min-content 1fr;
		}

		a {
			color: var(--color-link-foreground);
			text-decoration: none;
		}

		.icon {
			grid-row: 1 / 3;
			grid-column: 1;
			padding-top: 0.1rem;
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
			grid-row: 1;
			grid-column: 2;
			margin: 0;
		}

		.date {
			grid-row: 2;
			grid-column: 2;
			margin: 0;
		}

		.details {
			display: flex;
			grid-row: 1 / 3;
			grid-column: 3;
			gap: var(--gl-space-2);
			align-items: center;
			margin: 0;
		}

		.badge {
			display: inline-block;
			padding: 0.1rem 0.4rem;
			font-size: 0.9em;
			line-height: 1;
			border: 1px solid var(--color-foreground--50);
			border-radius: var(--gl-radius-sm);
			opacity: 0.8;
		}

		.review {
			display: flex;
			grid-column: 2;
			gap: 0.3rem;
			align-items: center;
			margin: 0;
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

	@property()
	reviewDecision?: string;

	@property({ type: Boolean })
	details = false;

	@property({ type: Boolean })
	openOnRemote = false;

	private get typeLabel() {
		switch (this.type) {
			case 'issue':
				return 'Issue ';
			case 'pr':
				return 'PR ';
			default:
				return '';
		}
	}

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
				<p class="title">${this.identifier}</p>
			`;
		}

		return html`
			<span class="icon icon--${modifier}"><code-icon icon=${icon}></code-icon></span>
			<p class="title">
				<a href="${this.url}">${this.name}</a>
			</p>
			<p class="date">
				${this.typeLabel}${this.identifier}${this.author ? html` by ${this.author}` : nothing}
				${this.isDraft ? html` <span class="badge">Draft</span>` : nothing}
				${this.status ? html` ${this.status}` : nothing} ${this.renderDate()}
			</p>
			${this.renderReviewDecision()}
			${when(
				this.details === true || this.openOnRemote === true,
				() => html`
					<p class="details">
						${this.details
							? html`<gl-button
									appearance="toolbar"
									tooltip="Open Details"
									@click=${() => this.onDetailsClicked()}
									><code-icon icon="eye"></code-icon
								></gl-button>`
							: nothing}
						${this.openOnRemote && this.url
							? html`<gl-button appearance="toolbar" tooltip="Open on Remote" href=${this.url}
									><code-icon icon="globe"></code-icon
								></gl-button>`
							: nothing}
					</p>
				`,
			)}
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

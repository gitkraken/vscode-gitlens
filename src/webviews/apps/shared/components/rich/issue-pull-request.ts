import { css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import '../button';
import '../code-icon';
import '../formatted-date';
import { GlElement } from '../element';

declare global {
	interface HTMLElementTagNameMap {
		'issue-pull-request': IssuePullRequest;
	}

	interface GlobalEventHandlersEventMap {
		'gl-issue-pull-request-details': CustomEvent<void>;
	}
}

@customElement('issue-pull-request')
export class IssuePullRequest extends GlElement {
	static override styles = css`
		:host {
			display: grid;
			gap: 0.25rem 0.6rem;
			justify-content: start;
			font-size: 1.3rem;
			grid-template-columns: min-content 1fr min-content;
		}

		:host([compact]) {
			grid-template-columns: min-content 1fr;
		}

		a {
			color: var(--color-link-foreground);
			text-decoration: none;
		}

		.icon {
			grid-column: 1;
			grid-row: 1 / 3;
			text-align: center;
			padding-top: 0.1rem;
		}

		.icon--opened {
			color: var(--vscode-gitlens-openPullRequestIconColor);
		}
		.icon--closed {
			color: var(--vscode-gitlens-closedPullRequestIconColor);
		}
		.icon--merged {
			color: var(--vscode-gitlens-mergedPullRequestIconColor);
		}

		.title {
			grid-column: 2;
			grid-row: 1;
			margin: 0;
		}

		.date {
			grid-column: 2;
			grid-row: 2;
			margin: 0;
		}

		.details {
			grid-column: 3;
			grid-row: 1 / 3;
			margin: 0;
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

	@property({ type: Boolean, reflect: true })
	compact?: boolean;

	@property({ type: Boolean })
	details = false;

	renderDate() {
		if (!this.date) return nothing;

		return html`<formatted-date
			.date=${new Date(this.date)}
			.format=${this.dateFormat}
			.dateStyle=${this.dateStyle}
		></formatted-date>`;
	}

	override render() {
		let icon;
		let status;
		switch (this.type) {
			case 'issue':
				status = this.status === 'closed' ? 'merged' : 'opened';
				icon = this.status === 'closed' ? 'pass' : 'issues';
				break;
			case 'pr':
				status = this.status;
				switch (this.status) {
					case 'merged':
						icon = 'git-merge';
						break;
					case 'closed':
						icon = 'git-pull-request-closed';
						break;
					case 'opened':
					default:
						icon = 'git-pull-request';
						break;
				}
				break;
			case 'autolink':
			default:
				status = 'opened';
				icon = 'link';
				break;
		}

		if (this.compact) {
			return html`
				<span class="icon icon--${status}"><code-icon icon=${icon}></code-icon></span>
				<p class="title">${this.identifier}</p>
			`;
		}

		return html`
			<span class="icon icon--${status}"><code-icon icon=${icon}></code-icon></span>
			<p class="title">
				<a href="${this.url}">${this.name}</a>
			</p>
			<p class="date">${this.identifier} ${this.status ? this.status : nothing} ${this.renderDate()}</p>
			${when(
				this.details === true,
				() => html`
					<p class="details">
						<gl-button appearance="toolbar" tooltip="Open Details" @click=${() => this.onDetailsClicked()}
							><code-icon icon="eye"></code-icon
						></gl-button>
					</p>
				`,
			)}
		`;
	}

	private onDetailsClicked() {
		this.emit('gl-issue-pull-request-details');
	}
}

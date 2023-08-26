import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import '../code-icon';
import '../formatted-date';

@customElement('commit-identity')
export class CommitIdentity extends LitElement {
	static override styles = css`
		:host {
			display: grid;
			gap: 0rem 1rem;
			justify-content: start;
		}

		a {
			color: var(--color-link-foreground);
			text-decoration: none;
		}

		.avatar {
			grid-column: 1;
			grid-row: 1 / 3;
			width: 36px;
		}

		.thumb {
			width: 100%;
			height: auto;
			border-radius: 0.4rem;
		}

		.name {
			grid-column: 2;
			grid-row: 1;
			font-size: 1.5rem;
		}

		.date {
			grid-column: 2;
			grid-row: 2;
			font-size: 1.3rem;
		}
	`;

	@property()
	name = '';

	@property()
	email = '';

	@property()
	date = '';

	@property()
	avatarUrl = 'https://www.gravatar.com/avatar/?s=64&d=robohash';

	@property({ type: Boolean })
	showAvatar = false;

	@property()
	dateFormat = 'MMMM Do, YYYY h:mma';

	@property()
	committer = false;

	@property()
	actionLabel = 'committed';

	override render() {
		return html`
			<a class="avatar" href="${this.email ? `mailto:${this.email}` : '#'}">
				${this.showAvatar
					? html`<img class="thumb" src="${this.avatarUrl}" alt="${this.name}" />`
					: html`<code-icon icon="person" size="32"></code-icon>`}
			</a>
			<a class="name" href="${this.email ? `mailto:${this.email}` : '#'}">${this.name}</a>
			<span class="date">
				${this.actionLabel}
				<formatted-date date=${this.date} format=${this.dateFormat}> </formatted-date>
			</span>
		`;
	}
}

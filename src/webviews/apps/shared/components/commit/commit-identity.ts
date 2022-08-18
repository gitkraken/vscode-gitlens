import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import '../formatted-date';

@customElement('commit-identity')
export class CommitIdentity extends LitElement {
	static override styles = css`
		:host {
			display: grid;
			gap: 0.25rem 0.5rem;
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
	avatar = 'https://www.gravatar.com/avatar/?s=64&d=robohash';

	@property()
	dateFormat = 'MMMM Do, YYYY h:mma';

	@property({ type: Boolean, reflect: true })
	committer = false;

	@property()
	actionLabel = 'committed';

	override render() {
		const largerUrl = this.avatar.replace('s=32', 's=64');
		return html`
			<a class="avatar" href="${this.email ? `mailto:${this.email}` : '#'}"
				><img class="thumb" lazy src="${largerUrl}" alt="${this.name}"
			/></a>
			<a class="name" href="${this.email ? `mailto:${this.email}` : '#'}">${this.name}</a>
			<span class="date"
				>${this.actionLabel} <formatted-date date=${this.date} dateFormat="${this.dateFormat}"></formatted-date
			></span>
		`;
	}
}

import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import '../formatted-date';
import '../code-icon';

@customElement('issue-pull-request')
export class IssuePullRequest extends LitElement {
	static override styles = css`
		:host {
			display: grid;
			gap: 0.25rem 0.6rem;
			justify-content: start;
		}

		a {
			color: var(--color-link-foreground);
			text-decoration: none;
		}

		.icon {
			grid-column: 1;
			grid-row: 1 / 3;
			color: var(--vscode-gitlens-mergedPullRequestIconColor);
			text-align: center;
			padding-top: 0.1rem;
		}

		.title {
			grid-column: 2;
			grid-row: 1;
			margin: 0;
			font-size: 1.4rem;
		}

		.date {
			grid-column: 2;
			grid-row: 2;
			margin: 0;
			font-size: 1.3rem;
		}
	`;

	@property()
	url = '';

	@property()
	name = '';

	@property()
	date = '';

	@property()
	status = 'merged';

	@property()
	key = '#1999';

	renderDate() {
		if (this.date === '') {
			return nothing;
		}
		return html`<formatted-date date="${this.date}"></formatted-date>`;
	}

	override render() {
		let icon = 'issues';
		switch (this.status.toLowerCase()) {
			case '':
				icon = 'link';
				break;
			case 'merged':
				icon = 'git-merge';
				break;
			case 'closed':
				icon = 'pass';
				break;
		}

		return html`
			<span class="icon"><code-icon icon=${icon}></code-icon></span>
			<p class="title">
				<a href="${this.url}">${this.name}</a>
			</p>
			<p class="date">${this.key} ${this.status === '' ? this.status : nothing} ${this.renderDate()}</p>
		`;
	}
}

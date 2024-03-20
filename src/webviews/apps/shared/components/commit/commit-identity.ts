import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import { dateConverter } from '../converters/date-converter';
import '../code-icon';
import '../formatted-date';

@customElement('commit-identity')
export class CommitIdentity extends LitElement {
	static override styles = css`
		:host {
			display: flex;
			flex-direction: row;
			align-items: center;
			gap: 0 0.6rem;
		}

		a {
			color: var(--color-link-foreground);
			text-decoration: none;
		}

		.avatar {
			width: 1.8rem;
		}

		.thumb {
			width: 100%;
			height: auto;
			vertical-align: middle;
			border-radius: 0.4rem;
		}

		.name {
			flex: 1;
			font-size: 1.3rem;
			white-space: nowrap;
			text-overflow: ellipsis;
		}

		.date {
			flex: none;
			margin-inline-start: auto;
			font-size: 1.3rem;
			color: var(--color-foreground--50);
		}
	`;

	@property()
	name = '';

	@property()
	url?: string;

	@property({ converter: dateConverter(), reflect: true })
	date: Date | undefined;

	@property()
	avatarUrl = 'https://www.gravatar.com/avatar/?s=64&d=robohash';

	@property({ type: Boolean, attribute: 'show-avatar', reflect: true })
	showAvatar = false;

	@property()
	dateFormat = 'MMMM Do, YYYY h:mma';

	@property()
	dateStyle: 'relative' | 'absolute' = 'relative';

	@property({ type: Boolean })
	committer = false;

	@property()
	actionLabel?: string;

	private renderAvatar() {
		if (this.showAvatar && this.avatarUrl != null && this.avatarUrl.length > 0) {
			return html`<img class="thumb" src="${this.avatarUrl}" alt="${this.name}" />`;
		}
		return html`<code-icon icon="person" size="18"></code-icon>`;
	}

	override render() {
		return html`
			${when(
				this.url != null,
				() =>
					html`<a class="avatar" href="${this.url}">${this.renderAvatar()}</a
						><a class="name" href="${this.url}">${this.name}</a>`,
				() =>
					html`<span class="avatar">${this.renderAvatar()}</span
						><span class="name" href="${this.url}">${this.name}</span>`,
			)}
			<span class="date">
				${this.actionLabel}
				<formatted-date
					.date=${this.date}
					.format=${this.dateFormat}
					.dateStyle=${this.dateStyle}
				></formatted-date>
			</span>
		`;
	}
}

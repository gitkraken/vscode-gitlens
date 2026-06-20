import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import { dateConverter } from '../converters/date-converter.js';
import '../code-icon.js';
import '../formatted-date.js';
import '../overlays/tooltip.js';

@customElement('commit-identity')
export class CommitIdentity extends LitElement {
	static override styles = css`
		:host,
		.author {
			display: flex;
			flex-direction: row;
			gap: 0 var(--gl-space-6);
			align-items: center;
		}

		a {
			color: var(--color-link-foreground);
			text-decoration: none;
		}

		.author-hover {
			display: flex;
			flex-direction: column;
			gap: var(--gl-space-6);
			align-items: center;
			justify-content: center;
			margin: var(--gl-space-6) var(--gl-space-2) var(--gl-space-2);
		}

		.author-hover img {
			max-width: 64px;
		}

		.avatar {
			width: 1.8rem;
		}

		.thumb {
			width: 100%;
			height: auto;
			vertical-align: middle;
			border-radius: var(--gl-radius-sm);
		}

		.name {
			flex: 1;
			text-overflow: ellipsis;
			font-size: 1.3rem;
			white-space: nowrap;
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
		if (this.showAvatar && this.avatarUrl?.length) {
			return html`<img class="thumb" src="${this.avatarUrl}" alt="${this.name}" />`;
		}
		return html`<code-icon icon="person" size="18"></code-icon>`;
	}

	override render(): unknown {
		return html`
			<gl-tooltip>
				${when(
					this.url != null,
					() =>
						html`<a class="author" href="${this.url}"
							><span class="avatar">${this.renderAvatar()}</span
							><span class="name" href="${this.url}">${this.name}</span></a
						>`,
					() =>
						html`<span class="author"
							><span class="avatar">${this.renderAvatar()}</span
							><span class="name" href="${this.url}">${this.name}</span></span
						>`,
				)}
				<div class="author-hover" slot="content">
					${this.avatarUrl?.length
						? html`<img class="thumb" src="${this.avatarUrl}" alt="${this.name}" />`
						: nothing}
					<span>${this.name}</span>
				</div>
			</gl-tooltip>
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

import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import '../code-icon';
import '../overlays/tooltip';

@customElement('gl-commit-author')
export class GlCommitAuthor extends LitElement {
	static override styles = css`
		:host {
			display: contents;
		}

		* {
			box-sizing: border-box;
		}

		.author {
			display: flex;
			flex-direction: row;
			align-items: center;
			gap: 0 0.6rem;
		}

		a {
			color: var(--color-link-foreground);
			text-decoration: none;
		}

		.author-hover {
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			gap: 0.6rem;
			margin: 0.6rem 0.2rem 0.2rem 0.2rem;
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
			border-radius: 0.4rem;
		}

		.name {
			flex: 1;
			font-size: 1.3rem;
			white-space: nowrap;
			text-overflow: ellipsis;
		}
	`;

	@property()
	name = '';

	@property()
	url?: string;

	@property()
	avatarUrl = 'https://www.gravatar.com/avatar/?s=64&d=robohash';

	@property({ type: Boolean, attribute: 'show-avatar', reflect: true })
	showAvatar = false;

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
							><span class="avatar">${this.renderAvatar()}</span><span class="name">${this.name}</span></a
						>`,
					() =>
						html`<span class="author"
							><span class="avatar">${this.renderAvatar()}</span
							><span class="name">${this.name}</span></span
						>`,
				)}
				<div class="author-hover" slot="content">
					${this.avatarUrl?.length
						? html`<img class="thumb" src="${this.avatarUrl}" alt="${this.name}" />`
						: nothing}
					<span>${this.name}</span>
				</div>
			</gl-tooltip>
		`;
	}
}

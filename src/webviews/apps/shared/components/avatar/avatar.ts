import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import '../code-icon';
import '../overlays/tooltip';

@customElement('gl-avatar')
export class GlAvatar extends LitElement {
	static override styles = [
		css`
			:host {
				display: inline-block;
				vertical-align: middle;
			}

			.avatar {
				display: inline-flex;
				width: var(--gl-avatar-size, 1.6rem);
				aspect-ratio: 1;
				vertical-align: middle;
				border-radius: 100%;
				justify-content: center;
			}

			.thumb {
				border-radius: 50%;
			}

			.thumb--text {
				display: flex;
				align-items: center;
				justify-content: center;
				font-size: clamp(0.8rem, calc(var(--gl-avatar-size, 1.6rem) * 0.5), 1.1rem);
				line-height: 1;
				text-transform: uppercase;
				cursor: default;
				color: var(--vscode-descriptionForeground);
			}

			.thumb--media {
				display: block;
				width: 100%;
				height: auto;
				object-fit: cover;
				object-position: 50% 50%;
			}
		`,
	];

	@property()
	src?: string;

	@property()
	name?: string;

	@property()
	href?: string;

	override render() {
		if (this.name) {
			return html`<gl-tooltip .content=${this.name}>${this.renderAvatar()}</gl-tooltip>`;
		}

		return this.renderAvatar();
	}

	private renderAvatar() {
		if (this.href) {
			return html`<a href=${this.href} class="avatar">${this.renderContent()}</a>`;
		}

		return html`<span class="avatar">${this.renderContent()}</span>`;
	}

	private renderContent() {
		if (!this.src) {
			return html`<slot class="thumb thumb--text"></slot>`;
		}

		return html`<img class="thumb thumb--media" src="${this.src}" alt="${this.name}" />`;
	}
}

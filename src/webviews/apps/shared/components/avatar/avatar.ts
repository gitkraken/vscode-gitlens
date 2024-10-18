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
				width: 1.6rem;
				aspect-ratio: 1;
				vertical-align: middle;
				border-radius: 100%;
			}

			.thumb {
				width: 100%;
				height: auto;
				border-radius: 100%;
			}
		`,
	];

	@property()
	url = 'https://www.gravatar.com/avatar/?s=32&d=robohash';

	@property()
	name?: string;

	override render() {
		if (this.name) {
			return html`<gl-tooltip .content=${this.name}>${this.renderAvatar()}</gl-tooltip>`;
		}

		return this.renderAvatar();
	}

	private renderAvatar() {
		return html`<span class="avatar"><img class="thumb" src="${this.url}" alt="${this.name}" /></span>`;
	}
}

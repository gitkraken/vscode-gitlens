import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import '../overlays/popover';
import './avatar';

export interface AvatarShape {
	src?: string;
	name?: string;
	href?: string;
}

@customElement('gl-avatar-list')
export class GlAvatarList extends LitElement {
	// static override styles = [];

	@property({ type: Number })
	max: number = 3;

	@property({ type: Array })
	avatars: AvatarShape[] = [];

	override render() {
		return html`<gl-avatar-group>${this.renderList()}</gl-avatar-group>`;
	}

	private renderList() {
		const avatars = this.avatars.slice(0, this.max);
		const overflowAvatars = this.avatars.slice(this.max);

		return html`
			${avatars.map(
				avatar => html`<gl-avatar .src=${avatar.src} .name=${avatar.name} .href=${avatar.href}></gl-avatar>`,
			)}
			${when(
				overflowAvatars.length > 0,
				() =>
					html`<gl-popover>
						<gl-avatar slot="anchor" class="overflow">+${overflowAvatars.length}</gl-avatar>
						<div slot="content" class="overflow-list">
							${overflowAvatars.map(
								avatar =>
									html`<gl-avatar
										.src=${avatar.src}
										.name=${avatar.name}
										.href=${avatar.href}
									></gl-avatar>`,
							)}
						</div>
					</gl-popover>`,
			)}
		`;
	}
}

@customElement('gl-avatar-group')
export class GlAvatarGroup extends LitElement {
	static override styles = [
		css`
			.avatar-group {
				display: inline-flex;
				flex-direction: row;
				justify-content: center;
				align-items: center;
			}

			.avatar-group::slotted(*:not(:first-child)) {
				margin-left: calc(var(--gl-avatar-size, 1.6rem) * -0.2);
			}

			.avatar-group:focus-within::slotted(*),
			.avatar-group:hover::slotted(*) {
				opacity: 0.5;
			}

			.avatar-group:focus-within::slotted(*:focus),
			.avatar-group:hover::slotted(*:hover) {
				opacity: 1;
				z-index: var(--gl-avatar-selected-zindex, 1) !important;
			}
		`,
	];

	override render() {
		return html`<slot class="avatar-group" part="base"></slot>`;
	}
}

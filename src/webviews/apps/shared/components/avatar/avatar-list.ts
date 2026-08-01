import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import '../code-icon.js';
import '../overlays/popover.js';
import './avatar.js';

export interface AvatarShape {
	src?: string;
	name?: string;
	href?: string;
}

@customElement('gl-avatar-list')
export class GlAvatarList extends LitElement {
	static override styles = [
		css`
			/* Exposed as gl-avatar-list::part(base) — rebase-entry restyles it to right-align. */
			.avatar-group {
				display: inline-flex;
				flex-direction: row;
				align-items: center;
				justify-content: center;
			}

			.avatar-group > *:not(:first-child) {
				margin-left: calc(var(--gl-avatar-size, 1.6rem) * -0.2);
			}

			.avatar-group:focus-within > *,
			.avatar-group:hover > * {
				opacity: 0.5;
			}

			.avatar-group:focus-within > *:focus,
			.avatar-group:hover > *:hover {
				z-index: var(--gl-avatar-selected-zindex, 1) !important;
				opacity: 1;
			}
		`,
	];

	@property({ type: Number })
	max: number = 3;

	@property({ type: Array })
	avatars: AvatarShape[] = [];

	override render(): unknown {
		return html`<div class="avatar-group" part="base">${this.renderList()}</div>`;
	}

	private renderList() {
		const avatars = this.avatars.slice(0, this.max);
		const overflowAvatars = this.avatars.slice(this.max);

		return html`
			${avatars.map(
				avatar =>
					html`<gl-avatar exportparts="avatar" .src=${avatar.src} .name=${avatar.name} .href=${avatar.href}
						>${!avatar.src ? html`<code-icon icon="account"></code-icon>` : ''}</gl-avatar
					>`,
			)}
			${when(
				overflowAvatars.length,
				() =>
					html`<gl-popover>
						<gl-avatar exportparts="avatar" slot="anchor" class="overflow"
							>+${overflowAvatars.length}</gl-avatar
						>
						<div slot="content" class="overflow-list">
							${overflowAvatars.map(
								avatar =>
									html`<gl-avatar .src=${avatar.src} .name=${avatar.name} .href=${avatar.href}
										>${!avatar.src ? html`<code-icon icon="account"></code-icon>` : ''}</gl-avatar
									>`,
							)}
						</div>
					</gl-popover>`,
			)}
		`;
	}
}

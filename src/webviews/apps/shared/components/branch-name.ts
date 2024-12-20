import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import './code-icon';

@customElement('gl-branch-name')
export class GlBranchName extends LitElement {
	static override styles = css`
		:host {
			display: inline-block;
			max-width: 100%;
			align-content: center;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
			vertical-align: middle;
			margin-top: -3px;
		}

		strong {
			font-weight: bold;
		}

		code-icon {
			margin-bottom: 2px;
		}
	`;

	@property({ type: String })
	name?: string;

	@property({ type: Number })
	size: number = 12;

	override render() {
		return html`
			<code-icon icon="git-branch" size="${this.size}"></code-icon>&nbsp;<strong
				>${this.name ?? '<missing>'}</strong
			>
		`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-branch-name': GlBranchName;
	}
}
export function renderBranchName(name: string | undefined, size = 12) {
	return html`<gl-branch-name .name=${name} .size=${size}></gl-branch-name>`;
}

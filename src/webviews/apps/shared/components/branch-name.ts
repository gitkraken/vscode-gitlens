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

		.icon {
			margin: 0 0.3rem 0.1rem 0.2rem;
		}

		.worktree .icon {
			margin-right: 0.4rem;
		}

		.label {
			font-weight: bold;
		}
	`;

	@property({ type: String })
	name?: string;

	@property({ type: Number })
	size: number = 12;

	@property({ type: Boolean })
	worktree = false;

	override render() {
		return html`<span class="${this.worktree ? 'worktree' : 'branch'}"
			><code-icon
				class="icon"
				icon="${this.worktree ? 'gl-worktrees-view' : 'git-branch'}"
				size="${this.size}"
			></code-icon
			><span class="label">${this.name ?? '<missing>'}</span></span
		>`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-branch-name': GlBranchName;
	}
}

export function renderBranchName(name: string | undefined, worktree?: boolean) {
	return html`<gl-branch-name .name=${name} .size=${12} ?worktree=${worktree ?? false}></gl-branch-name>`;
}

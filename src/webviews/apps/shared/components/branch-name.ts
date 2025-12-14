import type { TemplateResult } from 'lit';
import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import './code-icon';

@customElement('gl-branch-name')
export class GlBranchName extends LitElement {
	static override styles = css`
		:host {
			display: inline-flex;
			align-items: baseline;
			max-width: 100%;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
			margin-inline: 0.2rem;
		}

		:host(:focus) {
			outline: 1px solid var(--vscode-focusBorder);
			outline-offset: 2px;
		}

		.icon {
			margin-right: 0.3rem;
			align-self: center;
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

	override render(): unknown {
		return html`<code-icon
				class="icon"
				icon="${this.worktree ? 'gl-worktree' : 'git-branch'}"
				size="${this.size}"
			></code-icon
			><span class="label">${this.name ?? '<missing>'}</span>`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-branch-name': GlBranchName;
	}
}

export function renderBranchName(name: string | undefined, worktree?: boolean): TemplateResult {
	return html`<gl-branch-name .name=${name} .size=${12} ?worktree=${worktree ?? false}></gl-branch-name>`;
}

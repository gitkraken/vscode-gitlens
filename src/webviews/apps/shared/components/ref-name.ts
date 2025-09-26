import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { GitReference } from '../../../../git/models/reference';
import './code-icon';

@customElement('gl-ref-name')
export class GlRefName extends LitElement {
	static override styles = css`
		:host {
			box-sizing: border-box;
			display: flex;
			align-content: center;

			max-width: 100%;
			overflow: hidden;
			text-overflow: ellipsis;
			gap: 0.4rem;
		}

		* {
			box-sizing: border-box;
		}

		.icon.tag,
		.icon.worktree {
			margin-right: 0.1rem;
		}

		.label {
			min-width: 2.4rem;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
			font-weight: var(--font-weight, bold);
		}
	`;

	@property({ type: Boolean, reflect: true })
	icon = false;

	@property({ type: Object })
	ref?: GitReference;

	@property({ type: Number })
	size: number = 13;

	@property({ type: Boolean })
	worktree = false;

	override render(): unknown {
		if (this.ref == null) return nothing;

		let className;
		let icon;
		switch (this.ref.refType) {
			case 'branch':
				className = this.worktree ? 'worktree' : 'branch';
				icon = this.worktree ? 'gl-worktree' : 'git-branch';
				break;
			case 'tag':
				className = 'tag';
				icon = 'tag';
				break;
			default:
				className = 'revision';
				icon = 'git-commit';
				break;
		}

		return html`${this.icon
				? html`<code-icon
						class="icon${className ? ` ${className}` : ''}"
						icon="${icon}"
						size="${this.size}"
					></code-icon>`
				: nothing}<span class="label">${this.ref.name}</span>`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-ref-name': GlRefName;
	}
}

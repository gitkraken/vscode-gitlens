import type { TemplateResult } from 'lit';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { GitReference } from '../../../../git/models/reference';
import './code-icon';

@customElement('gl-ref-name')
export class GlRefName extends LitElement {
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
			margin: 0 0.3rem 0.2rem 0.2rem;
		}

		.tag .icon,
		.worktree .icon {
			margin-right: 0.4rem;
		}

		.label {
			font-weight: var(--font-weight, bold);
		}
	`;

	@property({ type: Boolean, reflect: true })
	icon = false;

	@property({ type: Object })
	ref?: GitReference;

	@property({ type: Number })
	size: number = 12;

	@property({ type: Boolean })
	worktree = false;

	override render(): unknown {
		if (this.ref == null) return nothing;

		let className;
		let icon;
		switch (this.ref.refType) {
			case 'branch':
				className = this.worktree ? 'worktree' : 'branch';
				icon = this.worktree ? 'gl-worktrees-view' : 'git-branch';
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

		return html`<span class="${className}"
			>${this.icon ? html`<code-icon class="icon" icon="${icon}" size="${this.size}"></code-icon>` : nothing}<span
				class="label"
				>${this.ref.name}</span
			></span
		>`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-ref-name': GlRefName;
	}
}

export function renderRefName(ref: GitReference | undefined, icon?: boolean, worktree?: boolean): TemplateResult {
	return html`<gl-ref-name
		?icon=${icon ?? true}
		.ref=${ref}
		.size=${12}
		?worktree=${worktree ?? false}
	></gl-ref-name>`;
}

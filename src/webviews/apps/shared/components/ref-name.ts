import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { GitReference } from '@gitlens/git/models/reference.js';
import './code-icon.js';

@customElement('gl-ref-name')
export class GlRefName extends LitElement {
	static override styles = css`
		:host {
			box-sizing: border-box;
			display: grid;
			grid-template-columns: minmax(0, 1fr);
			align-items: center;

			max-width: 100%;
			min-width: 1.4rem;
		}

		:host([icon]) {
			grid-template-columns: auto minmax(0, 1fr);
			min-width: 1.6rem;
		}

		* {
			box-sizing: border-box;
		}

		.icon {
			flex-shrink: 0;
		}

		.icon.tag,
		.icon.worktree {
			margin-right: 0.1rem;
		}

		.label {
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
			font-weight: var(--font-weight, bold);
		}

		/* Spacing between icon and label as a margin (not a grid gap) so that
		   when the label is hidden via display:none — e.g. the icon-only
		   collapse step in the graph header — the gap collapses with it. */
		:host([icon]) .label {
			margin-left: 0.4rem;
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

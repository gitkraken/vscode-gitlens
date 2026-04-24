import type { TemplateResult } from 'lit';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import './code-icon.js';

@customElement('gl-branch-name')
export class GlBranchName extends LitElement {
	static override styles = css`
		:host {
			display: inline-flex;
			align-items: baseline;
			min-width: 0;
			max-width: 100%;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
			margin-inline: 0.2rem;
		}

		:host([appearance='pill']) {
			padding: 0.1rem 0.6rem;
			border-radius: 0.3rem;
			background-color: color-mix(
				in srgb,
				var(--gl-branch-color, var(--vscode-gitlens-graphScrollMarkerLocalBranchesColor, #4ec9b0)) 15%,
				transparent
			);
			color: var(--gl-branch-color, var(--vscode-gitlens-graphScrollMarkerLocalBranchesColor, #4ec9b0));
		}

		:host([appearance='button']) {
			padding: 0.2rem 0.4rem;
			border-radius: var(--gk-action-radius, 0.3rem);
			cursor: pointer;
			color: var(--gl-branch-color, var(--vscode-gitlens-graphScrollMarkerLocalBranchesColor, inherit));
			font-size: var(--gl-font-base);
		}

		:host([appearance='button']:hover) {
			background: var(--vscode-toolbar-hoverBackground);
		}

		:host([appearance='button']:focus-visible) {
			outline: 1px solid var(--vscode-focusBorder);
			outline-offset: 2px;
		}

		:host(:focus:not([appearance='button'])) {
			outline: 1px solid var(--vscode-focusBorder);
			outline-offset: 2px;
		}

		.icon {
			margin-right: 0.3rem;
			align-self: center;
		}

		.label {
			font-weight: 600;
			/* Block-level box (default span is inline → text-overflow is ignored). flex 1 1 auto
			   lets the label both grow into available space and shrink when the parent narrows;
			   min-width: 0 unlocks shrinking past intrinsic content size. */
			display: block;
			flex: 1 1 auto;
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.chevron {
			margin-left: 0.2rem;
			align-self: center;
			flex-shrink: 0;
		}
	`;

	@property({ reflect: true })
	appearance?: 'pill' | 'button';

	@property({ type: String })
	name?: string;

	@property({ type: Number })
	size: number = 12;

	@property({ type: Boolean })
	worktree = false;

	@property({ type: Boolean })
	chevron = false;

	@property()
	icon?: string;

	override connectedCallback(): void {
		super.connectedCallback?.();
		this.addEventListener('keydown', this.onKeydown);
	}

	override disconnectedCallback(): void {
		this.removeEventListener('keydown', this.onKeydown);
		super.disconnectedCallback?.();
	}

	override updated(changedProperties: Map<string, unknown>): void {
		if (changedProperties.has('appearance')) {
			if (this.appearance === 'button') {
				this.setAttribute('role', 'button');
				if (!this.hasAttribute('tabindex')) {
					this.setAttribute('tabindex', '0');
				}
			} else {
				if (this.getAttribute('role') === 'button') {
					this.removeAttribute('role');
				}
				if (this.getAttribute('tabindex') === '0') {
					this.removeAttribute('tabindex');
				}
			}
		}
	}

	private readonly onKeydown = (e: KeyboardEvent): void => {
		if (this.appearance !== 'button') return;
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			this.click();
		}
	};

	override render(): unknown {
		const icon = this.icon ?? (this.worktree ? 'gl-worktree' : 'git-branch');
		return html`<code-icon class="icon" icon="${icon}" size="${this.size}"></code-icon
			><span class="label">${this.name ?? '<missing>'}</span>${this.chevron
				? html`<code-icon class="chevron" icon="chevron-down" size="12"></code-icon>`
				: nothing}`;
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

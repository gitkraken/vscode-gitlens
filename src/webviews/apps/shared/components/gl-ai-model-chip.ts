import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { AiModelInfo } from '../../../rpc/services/types.js';
import './code-icon.js';

/**
 * Compact chip that surfaces the currently selected AI model and lets the user open the
 * native VS Code AI provider quickpick to switch. Designed to be slotted into
 * `<gl-ai-input slot="footer">`.
 *
 * The chip is intentionally read-only display + click-to-switch — no in-webview popover.
 * Reusing the native quickpick keeps a single source of truth for model selection across
 * GitLens (matches the SCM and Home view model chips).
 */
@customElement('gl-ai-model-chip')
export class GlAiModelChip extends LitElement {
	static override styles = css`
		:host {
			display: inline-flex;
			align-items: center;
			min-width: 0;
		}

		.chip {
			display: inline-flex;
			align-items: center;
			gap: 0.3rem;
			max-width: 100%;
			padding: 0.1rem 0.4rem;
			border: 1px solid transparent;
			border-radius: 0.3rem;
			background: transparent;
			color: var(--vscode-descriptionForeground);
			font-size: var(--gl-font-micro);
			font-family: inherit;
			cursor: pointer;
			text-align: left;
			line-height: 1.4;
			transition:
				color 0.15s,
				background 0.15s,
				border-color 0.15s;
		}

		.chip:hover,
		.chip:focus-visible {
			color: var(--vscode-foreground);
			background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground));
			border-color: var(--vscode-toolbar-hoverOutline, transparent);
			outline: none;
		}

		.chip__label {
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.chip__chevron {
			flex-shrink: 0;
			--code-icon-size: 10px;
			opacity: 0.7;
		}
	`;

	@property({ type: Object })
	model?: AiModelInfo;

	override render(): unknown {
		const label = this.model != null ? `${this.model.provider.name} · ${this.model.name}` : 'Choose model…';
		const title = this.model != null ? `AI model: ${label}\nClick to switch` : 'Choose an AI model';

		return html`<button class="chip" type="button" title=${title} @click=${this.onClick}>
			<span class="chip__label">${label}</span>
			<code-icon icon="chevron-down" class="chip__chevron" aria-hidden="true"></code-icon>
		</button>`;
	}

	private onClick = (e: Event): void => {
		e.preventDefault();
		e.stopPropagation();
		this.dispatchEvent(new CustomEvent('switch-model', { bubbles: true, composed: true }));
	};
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-ai-model-chip': GlAiModelChip;
	}
}

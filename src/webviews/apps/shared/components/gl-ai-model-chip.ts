import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { AiModelInfo } from '../../../rpc/services/types.js';
import './code-icon.js';
import './overlays/tooltip.js';

/**
 * Compact chip that surfaces the currently selected AI model and lets the user open the
 * native VS Code AI provider quickpick to switch. Designed to be slotted into
 * `<gl-ai-input slot="footer">`; the consumption rate sits directly after the model so the
 * two read as one fact.
 *
 * The chip is intentionally read-only display + click-to-switch — no in-webview popover.
 * Reusing the native quickpick keeps a single source of truth for model selection across
 * GitLens (matches the SCM and Home view model chips).
 */
@customElement('gl-ai-model-chip')
export class GlAiModelChip extends LitElement {
	static override styles = css`
		:host {
			display: flex;
			gap: 0.4rem;
			align-items: center;
			width: 100%;
			min-width: 0;
		}

		/* gl-tooltip wraps the clickable model button; keep it shrinkable so the label ellipsizes. */
		gl-tooltip {
			min-width: 0;
		}

		.chip {
			display: inline-flex;
			gap: 0.4rem;
			align-items: center;
			max-width: 100%;
			min-width: 0;
			padding: 0.1rem 0.4rem;
			font-family: inherit;
			font-size: var(--gl-font-micro);
			line-height: 1.4;
			color: var(--vscode-descriptionForeground);
			text-align: left;
			cursor: pointer;
			background: transparent;
			border: var(--gl-border-width) solid transparent;
			border-radius: var(--gl-radius-sm);
			transition:
				color var(--gl-duration-fast),
				background var(--gl-duration-fast),
				border-color var(--gl-duration-fast);
		}

		.chip:hover,
		.chip:focus-visible {
			outline: none;
			background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground));
			border-color: var(--vscode-toolbar-hoverOutline, transparent);
		}

		/* Model name leads (foreground); provider trails, quieter — no separator, the
		   weight/color contrast carries the split. Provider clips before the model name. */
		.chip__model {
			flex: 0 1 auto;
			min-width: 0;
			overflow: hidden;
			font-weight: 500;
			color: var(--vscode-foreground);
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.chip__provider {
			flex: 0 8 auto;
			min-width: 0;
			overflow: hidden;
			color: var(--vscode-descriptionForeground);
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.chip:hover .chip__provider,
		.chip:focus-visible .chip__provider {
			color: var(--vscode-foreground);
		}

		.chip__chevron {
			flex-shrink: 0;
			--code-icon-size: 10px;

			opacity: 0.7;
		}

		/* Consumption rate — GitKraken AI models only. Quiet, non-interactive info sitting directly
		   after the model it describes (not floated to the footer's far edge). */
		.chip__rate {
			display: inline-flex;
			flex: none;
			gap: 0.2rem;
			align-items: center;
			font-size: var(--gl-font-micro);
			color: var(--vscode-descriptionForeground);
			white-space: nowrap;
		}

		.chip__rate-icon {
			flex-shrink: 0;
			--code-icon-size: 10px;

			opacity: 0.7;
		}

		/* gl-tooltip's own hr rule only reaches its fallback content; slotted content lives in
		   this component's shadow tree, so restyle the divider here to match other tooltips. */
		[slot='content'] hr {
			margin: var(--gl-space-4) 0;
			border: none;
			border-top: var(--gl-border-width) solid var(--color-foreground--25);
		}
	`;

	@property({ type: Object })
	model?: AiModelInfo;

	override render(): unknown {
		const model = this.model;
		const canonical = model != null ? `${model.name} via ${model.provider.name}` : undefined;

		return html`<gl-tooltip>
				<button class="chip" type="button" @click=${this.onClick}>
					<span class="chip__model">${model?.name ?? 'Choose AI Model…'}</span>
					${model != null ? html`<span class="chip__provider">${model.provider.name}</span>` : nothing}
					<code-icon icon="chevron-down" class="chip__chevron" aria-hidden="true"></code-icon>
				</button>
				<span slot="content"
					>${canonical != null
						? html`Switch AI Model
								<hr />
								${canonical}`
						: 'Choose AI Model'}</span
				>
			</gl-tooltip>
			${model?.consumptionRateLabel
				? html`<span class="chip__rate"
						><code-icon icon="zap" class="chip__rate-icon" aria-hidden="true"></code-icon
						>${model.consumptionRateLabel}</span
					>`
				: nothing}`;
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

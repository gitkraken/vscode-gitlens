import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { State } from '../../../../plus/graph/detailsProtocol.js';
import type { AiModelInfo } from '../../../../rpc/services/types.js';
import { elementBase } from '../../../shared/components/styles/lit/base.css.js';
import '../../../shared/components/ai-input.js';
import '../../../shared/components/gl-ai-model-chip.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/overlays/tooltip.js';

// Match gl-ai-input's `--angle` registration so the busy-border conic gradient picks up
// the animated angle. Already registered if gl-ai-input loaded first; the try/catch makes
// the duplicate call a no-op.
try {
	CSS.registerProperty({
		name: '--angle',
		syntax: '<angle>',
		inherits: false,
		initialValue: '0deg',
	});
} catch {
	/* already registered */
}

/**
 * Comparison-scoped AI actions row. Wraps the freeform Explain input ({@link GlAiInput})
 * alongside a peer "Generate Changelog" chip so both AI affordances on a comparison sit in
 * one band. Replaces the bare `<gl-ai-input>` that the multi-commit and compare-mode panels
 * each rendered, ensuring the two panels stay visually identical.
 */
@customElement('gl-compare-ai-actions')
export class GlCompareAIActions extends LitElement {
	static override styles = [
		elementBase,
		css`
			:host {
				display: block;
			}

			.row {
				display: flex;
				gap: var(--gl-space-6);
				align-items: stretch;
				min-width: 0;
			}

			/* The inner gl-ai-input is sized by flex, not by panelActionInputStyles (the latter
	   targets the outer gl-compare-ai-actions host instead). */
			.row > gl-ai-input {
				flex: 1;
				width: auto;
				min-width: 0;
				max-width: none;
				margin: 0;
			}

			/* Default state mirrors the Explain input when unfocused (plain solid border +
	   input background). On hover/focus the border swaps to the same conic-gradient
	   that the Explain input shows when focused. Busy keeps the gradient border and
	   animates --angle so the gradient sweeps around the perimeter. */
			.changelog-btn {
				--gradient-start: var(--gl-ai-accent-1);
				--gradient-mid: var(--gl-ai-accent-2);
				--gradient-end: var(--gl-ai-accent-3);

				display: inline-flex;
				flex: none;
				align-items: center;
				justify-content: center;
				padding: 0 var(--gl-space-8);
				font: inherit;
				font-size: var(--gl-font-base);
				color: var(--vscode-input-foreground);
				cursor: pointer;
				background: var(--vscode-input-background);
				border: var(--gl-border-width) solid var(--vscode-input-border, transparent);
				border-radius: var(--gl-radius-md);
			}

			.changelog-btn:hover:not([disabled]),
			.changelog-btn:focus-visible,
			.changelog-btn.is-busy {
				color: var(--vscode-button-foreground);
				background:
					linear-gradient(var(--vscode-button-background), var(--vscode-button-background)) padding-box,
					conic-gradient(
							from var(--angle, 0deg),
							var(--gradient-start),
							var(--gradient-mid),
							var(--gradient-end),
							var(--gradient-start)
						)
						border-box;
				border-color: transparent;
			}

			.changelog-btn:focus-visible {
				outline: none;
			}

			.changelog-btn[disabled]:not(.is-busy) {
				cursor: not-allowed;
				opacity: 0.6;
			}

			.changelog-btn.is-busy {
				cursor: progress;
				animation: ai-spin 2s linear infinite;
			}

			@keyframes ai-spin {
				to {
					--angle: 360deg;
				}
			}

			@media (prefers-reduced-motion: reduce) {
				.changelog-btn.is-busy {
					animation: none;
				}
			}

			/* Scope chip — informational (or switchable) pill in the Explain input's footer, ahead of
	   the model chip. flex: none keeps it compact against gl-ai-input's footer slot, which
	   otherwise stretches its (single, historically) slotted child to fill the row. */
			.scope-chip {
				display: inline-flex;
				flex: none;
				gap: var(--gl-space-4);
				align-items: center;
				max-width: 16rem;
				padding: 0 var(--gl-space-8);
				font: inherit;
				font-size: var(--gl-font-sm);
				color: var(--color-foreground--65);
				background: none;
				border: var(--gl-border-width) solid var(--vscode-input-border, transparent);
				border-radius: var(--gl-radius-lg);
			}

			button.scope-chip {
				cursor: pointer;
			}

			button.scope-chip:hover,
			button.scope-chip:focus-visible {
				color: var(--vscode-foreground);
			}

			.scope-chip__label {
				min-width: 0;
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}
		`,
	];

	@property({ type: Boolean })
	explainBusy = false;

	@property({ type: Boolean })
	generateChangelogBusy = false;

	@property({ type: Object })
	orgSettings?: State['orgSettings'];

	@property({ type: Object })
	aiModel?: AiModelInfo;

	/** Optional scope label shown as a chip in the Explain input's footer (e.g. "12 unpushed
	 *  commits"). Omitted entirely when unset — compare/multicommit consumers are unaffected. */
	@property({ type: String })
	scopeLabel?: string;

	/** Whether the scope chip is clickable — dispatches `gl-ai-scope-switch` on click when true. */
	@property({ type: Boolean })
	scopeSwitchable = false;

	override render(): unknown {
		if (this.orgSettings?.ai === false) return nothing;

		const busy = this.generateChangelogBusy;
		return html`<div class="row">
			<gl-ai-input multiline floating-footer button-tooltip="Explain Changes" .busy=${this.explainBusy}>
				<gl-ai-model-chip slot="footer" .model=${this.aiModel}></gl-ai-model-chip>
				${this.renderScopeChip()}
			</gl-ai-input>
			<gl-tooltip content="Generate Changelog" placement="bottom"
				><button
					class=${busy ? 'changelog-btn is-busy' : 'changelog-btn'}
					aria-label="Generate Changelog"
					?disabled=${busy}
					aria-busy=${busy ? 'true' : nothing}
					@click=${this.onGenerateChangelog}
				>
					${busy
						? html`<code-icon icon="loading" modifier="spin"></code-icon>`
						: html`<code-icon icon="list-unordered"></code-icon>`}
				</button></gl-tooltip
			>
		</div>`;
	}

	private renderScopeChip(): unknown {
		if (!this.scopeLabel) return nothing;

		const inner = html`<code-icon icon="target" size="12"></code-icon
			><span class="scope-chip__label">${this.scopeLabel}</span>${this.scopeSwitchable
				? html`<code-icon icon="chevron-down" size="12"></code-icon>`
				: nothing}`;

		if (this.scopeSwitchable) {
			return html`<gl-tooltip content="Switch what the AI reads" placement="bottom" slot="footer">
				<button type="button" class="scope-chip" @click=${this.onScopeSwitch}>${inner}</button>
			</gl-tooltip>`;
		}

		return html`<gl-tooltip content="What the AI reads" placement="bottom" slot="footer">
			<span class="scope-chip">${inner}</span>
		</gl-tooltip>`;
	}

	private onScopeSwitch(): void {
		this.dispatchEvent(new CustomEvent('gl-ai-scope-switch', { bubbles: true, composed: true }));
	}

	private onGenerateChangelog(): void {
		if (this.generateChangelogBusy) return;

		this.dispatchEvent(new CustomEvent('gl-generate-changelog', { bubbles: true, composed: true }));
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-compare-ai-actions': GlCompareAIActions;
	}

	interface HTMLElementEventMap {
		'gl-generate-changelog': CustomEvent<void>;
		'gl-ai-scope-switch': CustomEvent<void>;
	}
}

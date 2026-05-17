import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { State } from '../../../../plus/graph/detailsProtocol.js';
import { elementBase } from '../../../shared/components/styles/lit/base.css.js';
import '../../../shared/components/ai-input.js';
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
				gap: 0.6rem;
				align-items: stretch;
				min-width: 0;
			}

			/* The inner gl-ai-input is sized by flex, not by panelActionInputStyles (the latter
			   targets the outer gl-compare-ai-actions host instead). */
			.row > gl-ai-input {
				flex: 1;
				min-width: 0;
				width: auto;
				max-width: none;
				margin: 0;
			}

			/* Default state mirrors the Explain input when unfocused (plain solid border +
			   input background). On hover/focus the border swaps to the same conic-gradient
			   that the Explain input shows when focused. Busy keeps the gradient border and
			   animates --angle so the gradient sweeps around the perimeter. */
			.changelog-btn {
				--gradient-start: #7c3aed;
				--gradient-mid: #0ea5e9;
				--gradient-end: #06b6d4;

				flex: none;
				display: inline-flex;
				align-items: center;
				justify-content: center;
				padding: 0 0.8rem;
				font: inherit;
				font-size: var(--gl-font-base);
				color: var(--vscode-input-foreground);
				background: var(--vscode-input-background);
				border: 1px solid var(--vscode-input-border, transparent);
				border-radius: 0.6rem;
				cursor: pointer;
			}

			.changelog-btn:hover:not([disabled]),
			.changelog-btn:focus-visible,
			.changelog-btn.is-busy {
				border-color: transparent;
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
			}

			.changelog-btn:focus-visible {
				outline: none;
			}

			.changelog-btn[disabled]:not(.is-busy) {
				opacity: 0.6;
				cursor: not-allowed;
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
		`,
	];

	@property({ type: Boolean })
	explainBusy = false;

	@property({ type: Boolean })
	generateChangelogBusy = false;

	@property({ type: Object })
	orgSettings?: State['orgSettings'];

	override render(): unknown {
		if (this.orgSettings?.ai === false) return nothing;

		const busy = this.generateChangelogBusy;
		return html`<div class="row">
			<gl-ai-input multiline button-tooltip="Explain Changes" .busy=${this.explainBusy}></gl-ai-input>
			<gl-tooltip content="Generate Changelog (Preview)" placement="bottom"
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
	}
}

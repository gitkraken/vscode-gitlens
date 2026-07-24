import { css, html, LitElement, nothing } from 'lit';
import type { PropertyValues } from 'lit';
import { customElement, property } from 'lit/decorators.js';

/** A full-viewport, blurred overlay shown while a native drag has strayed OUTSIDE the webview — VS
 *  Code blocks all webview events until the user holds Shift to bring the drag back in, so this
 *  instructs them to do so. Rendered in the browser **top layer** (a manual `[popover]`) so it sits
 *  above the entire `--gl-z-*` scale AND the WebAwesome floating band (tooltips/hovers) — a z-index
 *  can't win that (see docs/webview-styling.md, Elevation). Toggled imperatively via `active`; never
 *  blocks the drag (`pointer-events: none`). */
@customElement('gl-drag-shift-overlay')
export class GlDragShiftOverlay extends LitElement {
	static override styles = css`
		/* Override the UA [popover] box (fit-content / auto margin / border / opaque bg) into a
		   pass-through full-viewport layer. Hiding is the UA's [popover]:not(:popover-open) display:none
		   — so display is set ONLY when open (an unconditional author display would defeat it). */
		:host {
			position: fixed;
			inset: 0;
			width: 100%;
			height: 100%;
			max-width: none;
			max-height: none;
			margin: 0;
			padding: 0;
			border: 0;
			overflow: hidden;
			background: transparent;
			pointer-events: none;
		}

		:host(:popover-open) {
			display: flex;
			align-items: center;
			justify-content: center;
		}

		.backdrop {
			position: absolute;
			inset: 0;
			background: color-mix(in srgb, var(--vscode-editor-background) 55%, transparent);
			backdrop-filter: blur(0.3rem);
		}

		.hint {
			position: relative;
			display: inline-flex;
			gap: 0.6rem;
			align-items: center;
			padding: 1rem 1.6rem;
			border-radius: 0.4rem;
			color: var(--vscode-editorWidget-foreground, var(--vscode-foreground));
			background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
			border: 0.1rem solid var(--vscode-editorWidget-border, var(--vscode-widget-border, transparent));
			box-shadow: 0 0.2rem 0.8rem rgb(0 0 0 / 0.36);
			font-size: 1.3rem;
		}

		kbd {
			display: inline-block;
			padding: 0.1rem 0.6rem;
			border-radius: 0.3rem;
			color: var(--vscode-keybindingLabel-foreground, var(--vscode-foreground));
			background: var(
				--vscode-keybindingLabel-background,
				color-mix(in srgb, var(--vscode-foreground) 12%, transparent)
			);
			border: 0.1rem solid var(--vscode-keybindingLabel-border, var(--vscode-widget-border, transparent));
			font-family: var(--vscode-editor-font-family, monospace);
			font-size: 1.15rem;
		}
	`;

	@property({ type: Boolean, reflect: true })
	active = false;

	@property()
	label = 'to Resume Dragging';

	override connectedCallback(): void {
		super.connectedCallback?.();
		// Manual popover → top layer, no light-dismiss, no focus trap.
		this.setAttribute('popover', 'manual');
	}

	override updated(changedProperties: PropertyValues): void {
		super.updated?.(changedProperties);
		if (changedProperties.has('active') && this.isConnected) {
			// Idempotent — shows/hides in the top layer to match `active` (no throw if already there).
			this.togglePopover(this.active);
		}
	}

	override render(): unknown {
		if (!this.active) return nothing;

		return html`<div class="backdrop"></div>
			<div class="hint">Hold <kbd>Shift</kbd> ${this.label}</div>`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-drag-shift-overlay': GlDragShiftOverlay;
	}
}

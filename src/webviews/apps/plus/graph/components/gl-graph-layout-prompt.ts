import { css, html, LitElement, svg } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import type { GlDialog } from '../../../shared/components/overlays/dialog.js';
import '../../../shared/components/button.js';
import '../../../shared/components/code-icon.js';
import { srOnlyStyles } from '../../../shared/components/styles/lit/a11y.css.js';
import { emitTelemetrySentEvent } from '../../../shared/telemetry.js';
import '../../../shared/components/overlays/dialog.js';
import '../../../shared/components/overlays/tooltip.js';

export type GraphLayoutPromptChoice = 'sidebar' | 'panel' | 'dismissed';

const promptTitle = 'How would you like to use the Commit Graph?';
const promptCaption =
	"The Commit Graph is now the main GitLens view — it's your command center for managing agents, worktrees, commits, and reviews. Pick where it should live; you can always drag it elsewhere later.";
const sidebarCaption = 'Compact, alongside your editor';
const panelCaption = 'Full width, below your editor';

/** The compact variants hide the per-option captions — keep in sync with the media queries in the styles */
const captionsHiddenMediaQuery = '(max-width: 479px), (max-height: 419px)';

export interface GraphLayoutPromptChoiceEventDetail {
	choice: GraphLayoutPromptChoice;
}

/**
 * One-time prompt shown on first entry to the Graph *view*, asking which layout the user
 * prefers: the Graph in the side bar, or full-width in the bottom panel (#5412).
 * Options are illustrated abstractly (VS Code customize-layout icon style) rather than
 * text-only. Any outcome — a choice or closing the dialog — dismisses the prompt for good;
 * the host (`ChooseGraphLayoutCommand`) owns moving the view and storing the dismissal.
 */
@customElement('gl-graph-layout-prompt')
export class GlGraphLayoutPrompt extends LitElement {
	static override styles = css`
		.layout-prompt {
			position: relative;
			display: flex;
			flex-direction: column;
			gap: var(--gl-space-16);
		}

		/* The dialog surface (editorWidget background) matches the tooltip surface (hover
		   background) in many themes; the tooltip BODY still reads via its border and shadow,
		   but the pointer arrow has neither and vanishes. Shift the tooltip surface slightly
		   toward the foreground so the arrow (which follows this variable) stays visible. */
		gl-tooltip {
			--wa-tooltip-background-color: color-mix(
				in srgb,
				var(--color-hover-background) 88%,
				var(--color-hover-foreground)
			);
		}

		.layout-prompt__title {
			margin: 0;
			/* Clear the absolutely-positioned close button in the top-right corner */
			padding-right: 2.8rem;
			font-size: 1.6rem;
			font-weight: 600;
			line-height: 1.2;
		}

		.layout-prompt__caption {
			margin: 0;
			color: var(--vscode-descriptionForeground);
		}

		/* Stand-in for the main caption when a compact variant visually hides it (see below) */
		.layout-prompt__title-info {
			display: none;
			margin-left: 0.4rem;
			color: var(--vscode-descriptionForeground);
			/* Match the title's font size and center on its text line ('middle' lands the icon
			   box on the line-box midpoint here; the short variant's smaller title needs an
			   extra optical nudge — see below) */
			--code-icon-size: 1em;
			--code-icon-v-align: middle;
		}

		.layout-prompt__options {
			display: flex;
			gap: var(--gl-space-12);
			justify-content: center;
		}

		.layout-prompt__option {
			display: flex;
			flex-direction: column;
			align-items: center;
			gap: var(--gl-space-8);
			padding: var(--gl-space-12);
			background: none;
			color: inherit;
			font-family: inherit;
			font-size: inherit;
			border: 1px solid var(--vscode-widget-border);
			border-radius: var(--gl-radius-sm);
			cursor: pointer;
		}

		.layout-prompt__option:hover,
		.layout-prompt__option:focus-visible {
			background-color: var(--vscode-list-hoverBackground);
			border-color: var(--vscode-focusBorder);
			outline: none;
		}

		.layout-prompt__option-label {
			font-weight: 600;
		}

		.layout-prompt__option-caption {
			color: var(--vscode-descriptionForeground);
			font-size: 1.1rem;
			/* Keep the description on one line — the dialog is min-content sized, so without this
			   the caption wraps at the illustration's width */
			white-space: nowrap;
		}

		.layout-prompt__illustration .frame {
			fill: var(--vscode-editorWidget-background);
			stroke: var(--vscode-descriptionForeground);
			opacity: 0.9;
		}

		.layout-prompt__illustration .region {
			fill: var(--vscode-focusBorder);
			opacity: 0.2;
			stroke: var(--vscode-focusBorder);
			stroke-opacity: 0.9;
		}

		.layout-prompt__illustration .lane {
			stroke: var(--vscode-focusBorder);
			fill: none;
		}

		.layout-prompt__illustration .dot {
			fill: var(--vscode-focusBorder);
		}

		.layout-prompt__illustration .muted {
			stroke: var(--vscode-descriptionForeground);
			opacity: 0.35;
		}

		.layout-prompt__footer {
			display: flex;
			justify-content: center;
		}

		.layout-prompt__skip {
			background: none;
			border: none;
			padding: 0;
			color: var(--vscode-textLink-foreground);
			font-family: inherit;
			font-size: inherit;
			cursor: pointer;
		}

		.layout-prompt__skip:hover,
		.layout-prompt__skip:focus-visible {
			text-decoration: underline;
			outline: none;
		}

		.layout-prompt__close {
			position: absolute;
			top: -0.4rem;
			right: -0.4rem;
		}

		.layout-prompt__option-text {
			display: flex;
			flex-direction: column;
			align-items: center;
			gap: var(--gl-space-4);
		}

		.layout-prompt__illustration {
			display: block;
			width: 13.2rem;
			height: auto;
		}

		/* Keep the dialog inside small webview hosts (side bar ≈300px wide, bottom panel can be
		   short); gl-dialog's own min-width (40rem) would otherwise overflow the side bar */
		gl-dialog::part(base) {
			box-sizing: border-box;
			min-width: min(40rem, calc(100vw - 2.4rem));
			max-width: min(56rem, calc(100vw - 2.4rem));
			max-height: calc(100vh - 2.4rem);
			overflow: auto;

			/* Brand-gradient border, matching the graph's feature gate (feature-gate.css.ts):
			   border-image ignores border-radius, so use a transparent real border, a solid fill
			   clipped to padding-box, and the brand gradient clipped to border-box so it only
			   shows through the border ring. */
			background:
				linear-gradient(var(--vscode-editorWidget-background), var(--vscode-editorWidget-background))
					padding-box,
				var(--gl-gradient-brand) border-box;
			border: 0.2rem solid transparent;
			border-radius: var(--gl-radius-xl);
			box-shadow: 0 0 0 1px var(--vscode-editorWidget-border);
		}

		/* Background-painted borders are dropped in forced-colors mode — restore a solid border. */
		@media (forced-colors: active) {
			gl-dialog::part(base) {
				border-color: var(--vscode-editorWidget-border);
			}
		}

		/* Horizontally narrow (e.g. the Graph in the side bar): stack the option cards — each
		   keeps the normal column layout (title below the picture, like the short variant) —
		   and drop the captions so the dialog stays short enough; the hidden text surfaces
		   via hover tooltips (option cards + the title's info icon) instead */
		@media (max-width: 479px) {
			.layout-prompt__options {
				flex-direction: column;
				/* Cards hug their content (like the short variant) instead of stretching to the
				   dialog's width, which read as flexible side padding */
				align-items: center;
			}

			.layout-prompt__option {
				padding: var(--gl-space-8);
			}

			/* Visually hidden but kept in the accessibility tree — sighted users get the same
			   text from the title's info-icon tooltip instead */
			.layout-prompt__caption {
				${srOnlyStyles}
			}

			.layout-prompt__title-info {
				display: inline-block;
			}

			.layout-prompt__option-caption {
				display: none;
			}

			.layout-prompt__illustration {
				width: 9.6rem;
			}
		}

		/* Vertically narrow (e.g. the Graph in a short bottom panel): compress — smaller
		   illustrations, drop the secondary captions, tighter spacing */
		@media (max-height: 419px) {
			.layout-prompt {
				gap: var(--gl-space-8);
			}

			.layout-prompt__title {
				font-size: 1.3rem;
			}

			.layout-prompt__caption,
			.layout-prompt__option-caption {
				display: none;
			}

			.layout-prompt__option {
				padding: var(--gl-space-8);
			}

			.layout-prompt__illustration {
				width: 9.6rem;
			}
		}
	`;

	private _answered = false;

	/** When a compact variant hides the per-option captions, surface them as hover tooltips instead */
	@state()
	private _optionCaptionsHidden = false;

	private _captionsHiddenMedia?: MediaQueryList;
	private readonly onCaptionsHiddenMediaChange = (e: MediaQueryListEvent): void => {
		this._optionCaptionsHidden = e.matches;
	};

	override connectedCallback(): void {
		super.connectedCallback?.();

		this._captionsHiddenMedia = window.matchMedia(captionsHiddenMediaQuery);
		this._captionsHiddenMedia.addEventListener('change', this.onCaptionsHiddenMediaChange);
		this._optionCaptionsHidden = this._captionsHiddenMedia.matches;
	}

	override disconnectedCallback(): void {
		this._captionsHiddenMedia?.removeEventListener('change', this.onCaptionsHiddenMediaChange);
		this._captionsHiddenMedia = undefined;

		super.disconnectedCallback?.();
	}

	override render(): unknown {
		return html`<gl-dialog
			modal
			open
			autofocus-self
			closedby="any"
			label=${promptTitle}
			@gl-dialog-close=${this.onDialogClose}
		>
			<div class="layout-prompt">
				<h2 class="layout-prompt__title">
					${promptTitle}<gl-tooltip content=${promptCaption}
						><code-icon class="layout-prompt__title-info" icon="info" aria-hidden="true"></code-icon
					></gl-tooltip>
				</h2>
				<p class="layout-prompt__caption">${promptCaption}</p>
				<div class="layout-prompt__options">
					<gl-tooltip content=${sidebarCaption} ?disabled=${!this._optionCaptionsHidden}>
						<button type="button" class="layout-prompt__option" @click=${() => this.choose('sidebar')}>
							${this.renderSidebarIllustration()}
							<span class="layout-prompt__option-text">
								<span class="layout-prompt__option-label">Side Bar</span>
								<span class="layout-prompt__option-caption">${sidebarCaption}</span>
							</span>
						</button>
					</gl-tooltip>
					<gl-tooltip content=${panelCaption} ?disabled=${!this._optionCaptionsHidden}>
						<button type="button" class="layout-prompt__option" @click=${() => this.choose('panel')}>
							${this.renderPanelIllustration()}
							<span class="layout-prompt__option-text">
								<span class="layout-prompt__option-label">Bottom Panel</span>
								<span class="layout-prompt__option-caption">${panelCaption}</span>
							</span>
						</button>
					</gl-tooltip>
				</div>
				<div class="layout-prompt__footer">
					<gl-tooltip content="Close and keep my current layout">
						<button type="button" class="layout-prompt__skip" @click=${() => this.choose('dismissed')}>
							Keep my current layout
						</button>
					</gl-tooltip>
				</div>
				<!-- Last in the DOM so it's the last tab stop (the option cards and skip link come
				     first for keyboard users); positioned visually at the top-right corner. -->
				<gl-button
					class="layout-prompt__close"
					appearance="toolbar"
					density="compact"
					tooltip="Close and keep my current layout"
					aria-label="Close and keep my current layout"
					@click=${() => this.choose('dismissed')}
					><code-icon icon="close"></code-icon
				></gl-button>
			</div>
		</gl-dialog>`;
	}

	/** Abstract window mock: highlighted side bar hosting a vertical commit graph */
	private renderSidebarIllustration() {
		return svg`<svg class="layout-prompt__illustration" width="132" height="88" viewBox="0 0 132 88" aria-hidden="true">
			<rect class="frame" x="1" y="1" width="130" height="86" rx="4" />
			<rect class="region" x="2" y="2" width="55" height="84" />
			<line class="lane" x1="20" y1="16" x2="20" y2="72" />
			<path class="lane" d="M20 26 C 20 34, 36 32, 36 40 L 36 52 C 36 60, 20 58, 20 66" fill="none" />
			<circle class="dot" cx="20" cy="16" r="3.5" />
			<circle class="dot" cx="20" cy="40" r="3.5" />
			<circle class="dot" cx="36" cy="46" r="3.5" />
			<circle class="dot" cx="20" cy="72" r="3.5" />
			<line class="muted" x1="66" y1="18" x2="120" y2="18" />
			<line class="muted" x1="66" y1="32" x2="112" y2="32" />
			<line class="muted" x1="66" y1="46" x2="120" y2="46" />
			<line class="muted" x1="66" y1="60" x2="104" y2="60" />
		</svg>`;
	}

	/** Abstract window mock: highlighted bottom panel hosting the commit graph — the graph
	 * still flows top→bottom there (same list, wider), so the mini-graph is NOT rotated */
	private renderPanelIllustration() {
		return svg`<svg class="layout-prompt__illustration" width="132" height="88" viewBox="0 0 132 88" aria-hidden="true">
			<rect class="frame" x="1" y="1" width="130" height="86" rx="4" />
			<line class="muted" x1="14" y1="2" x2="14" y2="50" />
			<rect class="region" x="2" y="51" width="128" height="35" />
			<line class="lane" x1="24" y1="56" x2="24" y2="81" />
			<path class="lane" d="M24 59 C 24 65, 35 63, 35 69 L 35 77" fill="none" />
			<circle class="dot" cx="24" cy="56" r="3" />
			<circle class="dot" cx="35" cy="77" r="3" />
			<circle class="dot" cx="24" cy="81" r="3" />
			<line class="muted" x1="48" y1="56" x2="120" y2="56" />
			<line class="muted" x1="48" y1="68" x2="104" y2="68" />
			<line class="muted" x1="48" y1="81" x2="112" y2="81" />
			<line class="muted" x1="26" y1="14" x2="120" y2="14" />
			<line class="muted" x1="26" y1="26" x2="108" y2="26" />
			<line class="muted" x1="26" y1="38" x2="120" y2="38" />
		</svg>`;
	}

	private choose(choice: GraphLayoutPromptChoice): void {
		if (this._answered) return;

		this._answered = true;
		// Close the native dialog before the host unmounts us, so the browser restores focus to
		// the previously-focused element (unmounting an open dialog skips that). The resulting
		// `gl-dialog-close` echo is absorbed by the `_answered` guard above.
		this.shadowRoot?.querySelector<GlDialog>('gl-dialog')?.close();

		emitTelemetrySentEvent<'graph/layoutPrompt/choice'>(this, {
			name: 'graph/layoutPrompt/choice',
			data: { choice: choice },
		});
		this.dispatchEvent(
			new CustomEvent<GraphLayoutPromptChoiceEventDetail>('gl-graph-layout-choice', {
				detail: { choice: choice },
				bubbles: true,
				composed: true,
			}),
		);
	}

	// Esc/backdrop closes the native dialog without a click — count it as a dismissal (the
	// prompt is one-shot either way). A choice click also closes the dialog; `_answered`
	// keeps that from double-reporting.
	private onDialogClose = (): void => {
		this.choose('dismissed');
	};
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-graph-layout-prompt': GlGraphLayoutPrompt;
	}
}

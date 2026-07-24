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

		.layout-prompt__title-info:focus-visible {
			outline: 1px solid var(--vscode-focusBorder);
			outline-offset: 0.2rem;
			border-radius: var(--gl-radius-sm);
		}

		.layout-prompt__options {
			display: flex;
			gap: var(--gl-space-16);
			justify-content: center;
		}

		.layout-prompt__option {
			display: flex;
			flex-direction: column;
			align-items: center;
			gap: var(--gl-space-8);
			padding: var(--gl-space-16);
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

		/* Designed illustrations ship as dark/light exports differing only in these colors — one
		   markup, themed via custom properties (host body carries the vscode-* theme class) */
		:host {
			--lp-frame-bg: #121212;
			--lp-frame-stroke: #363636;
			--lp-shell-bg: #2a2a2c;
			--lp-dot-fill: #d9d9d9;
			--lp-row: #808080;
			--lp-purple: #aa5bf5;
			--lp-green: #00a02e;
		}

		:host-context(.vscode-light),
		:host-context(.vscode-high-contrast-light) {
			--lp-frame-bg: #fefefe;
			--lp-frame-stroke: #dddddd;
			--lp-shell-bg: #e3e3e3;
			--lp-dot-fill: #9c9c9c;
			--lp-row: #b4b4b4;
			--lp-purple: #c180ff;
			--lp-green: #37d865;
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
			/* 1.25× the illustrations' native 13.8rem */
			width: 17.25rem;
			height: auto;
		}

		/* Keep the dialog inside small webview hosts (side bar ≈300px wide, bottom panel can be
		   short); gl-dialog's own min-width (40rem) would otherwise overflow the side bar */
		gl-dialog::part(base) {
			box-sizing: border-box;
			min-width: min(44rem, calc(100vw - 2.4rem));
			max-width: min(60rem, calc(100vw - 2.4rem));
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

			/* Visually hidden but kept in the accessibility tree — sighted users get the same
			   text from the title's info-icon tooltip instead */
			.layout-prompt__caption {
				${srOnlyStyles}
			}

			.layout-prompt__title-info {
				display: inline-block;
				/* The smaller title leaves the icon sitting low — nudge it up optically */
				translate: 0 -0.06em;
			}

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
					<!-- Focusable (not aria-hidden) so sighted keyboard-only users can reach the
					     caption in the compact variants, where hovering this icon is otherwise the
					     only way to see it; gl-tooltip opens on focus. display: none in the normal
					     layout keeps it out of the tab order there. -->
					${promptTitle}<gl-tooltip content=${promptCaption}
						><code-icon
							class="layout-prompt__title-info"
							icon="info"
							role="img"
							tabindex="0"
							aria-label="More information"
						></code-icon
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

	/** Designed window mock: highlighted side bar hosting a vertical commit graph */
	private renderSidebarIllustration() {
		return svg`<svg class="layout-prompt__illustration" width="138" height="75" viewBox="0 0 138 75" fill="none" aria-hidden="true">
			<rect x="0.336586" y="0.336586" width="137.327" height="74.0488" rx="1.00976" fill="var(--lp-frame-bg)" stroke="var(--lp-frame-stroke)" stroke-width="0.673171"/>
			<path d="M0.5 0.999999C0.5 0.447715 0.947715 0 1.5 0H37.5V74H1.5C0.947715 74 0.5 73.5523 0.5 73V0.999999Z" fill="var(--lp-shell-bg)"/>
			<rect x="114.837" y="5.33659" width="18.3268" height="10.3268" rx="1.00976" stroke="var(--lp-frame-stroke)" stroke-width="0.673171"/>
			<rect x="101.837" y="21.3366" width="22.3268" height="33.3268" rx="1.00976" stroke="var(--lp-frame-stroke)" stroke-width="0.673171"/>
			<rect x="101.837" y="59.3366" width="31.3268" height="10.3268" rx="1.00976" stroke="var(--lp-frame-stroke)" stroke-width="0.673171"/>
			<rect x="127.566" y="63.6147" width="3.36585" height="3.36585" rx="1.68293" fill="var(--lp-dot-fill)" stroke="#D9D9D9" stroke-width="0.673171"/>
			<path d="M37.4707 0L37.4707 74.722" stroke="var(--lp-frame-stroke)" stroke-width="0.673171"/>
			<path d="M96.1536 0L96.1536 74.722" stroke="var(--lp-frame-stroke)" stroke-width="0.673171"/>
			<path d="M9.11255 74.4023L9.11255 62.0884" stroke="var(--lp-purple)" stroke-width="0.812499"/>
			<path d="M9.11255 45.2381L9.11255 10.8887" stroke="var(--lp-purple)" stroke-width="0.812499"/>
			<path d="M9.11255 51.7189L9.11255 49.1265" stroke="var(--lp-purple)" stroke-width="0.812499"/>
			<path d="M9.11255 58.1998L9.11255 55.6074" stroke="var(--lp-purple)" stroke-width="0.812499"/>
			<path d="M15.5935 74.4025L15.5935 42.6455" stroke="var(--lp-green)" stroke-width="0.812499"/>
			<path d="M15.5935 38.4579L15.5935 17.0706" stroke="var(--lp-green)" stroke-width="0.812499"/>
			<path d="M22.0745 74.4026L22.0745 23.8506" stroke="#40AAA3" stroke-width="0.812499"/>
			<path d="M28.5557 74.4023L28.5557 30.3313" stroke="#8A743A" stroke-width="0.812499"/>
			<circle cx="28.5556" cy="28.3874" r="1.94431" stroke="#8A743A" stroke-width="0.812499"/>
			<circle cx="22.0747" cy="21.9062" r="1.94431" stroke="#40AAA3" stroke-width="0.812499"/>
			<circle cx="15.5937" cy="15.4253" r="1.94431" stroke="var(--lp-green)" stroke-width="0.812499"/>
			<circle cx="15.5937" cy="40.7014" r="1.94431" stroke="var(--lp-green)" stroke-width="0.812499"/>
			<circle cx="9.11276" cy="8.94431" r="1.94431" stroke="var(--lp-purple)" stroke-width="0.812499"/>
			<circle cx="9.11276" cy="60.1443" r="1.94431" stroke="var(--lp-purple)" stroke-width="0.812499"/>
			<circle cx="9.11276" cy="53.6633" r="1.94431" stroke="var(--lp-purple)" stroke-width="0.812499"/>
			<circle cx="9.11276" cy="47.1823" r="1.94431" stroke="var(--lp-purple)" stroke-width="0.812499"/>
			<path d="M37.3506 8.94385L11.0569 8.94385" stroke="#AA5BF5" stroke-opacity="0.3" stroke-width="2.75444"/>
			<path d="M37.3506 47.1821H11.0569" stroke="#AA5BF5" stroke-opacity="0.3" stroke-width="2.75444"/>
			<path d="M37.3506 53.6631H11.0569" stroke="#AA5BF5" stroke-opacity="0.3" stroke-width="2.75444"/>
			<path d="M37.3506 15.4248L17.5379 15.4248" stroke="#00A02E" stroke-opacity="0.3" stroke-width="2.75444"/>
			<path d="M37.3506 40.7012H17.5379" stroke="#00A02E" stroke-opacity="0.3" stroke-width="2.75444"/>
			<path d="M37.3506 21.906H24.0189" stroke="#309FC7" stroke-opacity="0.3" stroke-width="2.75444"/>
			<path d="M37.3506 28.3872H30.4999" stroke="#C7B830" stroke-opacity="0.3" stroke-width="2.75444"/>
			<path d="M37.3506 60.7925H11.0569" stroke="#C7308B" stroke-opacity="0.3" stroke-width="2.75444"/>
		</svg>`;
	}

	/** Designed window mock: highlighted bottom panel hosting the commit graph */
	private renderPanelIllustration() {
		return svg`<svg class="layout-prompt__illustration" width="138" height="75" viewBox="0 0 138 75" fill="none" aria-hidden="true">
			<rect x="0.336586" y="0.336586" width="137.327" height="74.0488" rx="1.00976" fill="var(--lp-frame-bg)" stroke="var(--lp-frame-stroke)" stroke-width="0.673171"/>
			<path d="M1.5 75C0.947712 75 0.5 74.5523 0.5 74L0.499998 40L102.5 40L102.5 74C102.5 74.5523 102.052 75 101.5 75L1.5 75Z" fill="var(--lp-shell-bg)"/>
			<rect x="118.815" y="5.04899" width="14.8098" height="10.7707" rx="1.00976" stroke="var(--lp-frame-stroke)" stroke-width="0.673171"/>
			<rect x="106.697" y="21.205" width="14.8098" height="33.6586" rx="1.00976" stroke="var(--lp-frame-stroke)" stroke-width="0.673171"/>
			<rect x="106.697" y="58.9025" width="26.9268" height="10.7707" rx="1.00976" stroke="var(--lp-frame-stroke)" stroke-width="0.673171"/>
			<rect x="127.566" y="63.6149" width="3.36585" height="3.36585" rx="1.68293" fill="var(--lp-dot-fill)" stroke="#D9D9D9" stroke-width="0.673171"/>
			<path d="M102.5 40L0.499999 40" stroke="var(--lp-frame-stroke)" stroke-width="0.673171"/>
			<path d="M102.154 0L102.154 74.722" stroke="var(--lp-frame-stroke)" stroke-width="0.673171"/>
			<path d="M37.3188 63.404L37.3188 63.2017" stroke="var(--lp-purple)" stroke-width="0.673171"/>
			<g clip-path="url(#lp-panel-clip)">
				<path d="M12.3188 76.2404L12.3188 47.7812" stroke="var(--lp-purple)" stroke-width="0.673171"/>
				<path d="M60 46.1702H13.9299" stroke="#AA5BF5" stroke-opacity="0.3" stroke-width="2.2821"/>
				<path d="M60 51.5398H19.2996" stroke="#00A02E" stroke-opacity="0.3" stroke-width="2.2821"/>
				<path d="M60 72.4817H19.2996" stroke="#00A02E" stroke-opacity="0.3" stroke-width="2.2821"/>
				<path d="M60 56.9094H24.6692" stroke="#309FC7" stroke-opacity="0.3" stroke-width="2.2821"/>
				<path d="M60 62.2793H30.0389" stroke="#C7B830" stroke-opacity="0.3" stroke-width="2.2821"/>
				<path d="M17.6885 70.6232L17.6885 52.9033" stroke="var(--lp-green)" stroke-width="0.673171"/>
				<path d="M23.0581 100.404L23.0581 58.5205" stroke="#40AAA3" stroke-width="0.673171"/>
				<path d="M28.4282 100.404L28.4282 63.8901" stroke="#8A743A" stroke-width="0.673171"/>
				<circle cx="28.4278" cy="62.2794" r="1.6109" stroke="#8A743A" stroke-width="0.673171"/>
				<circle cx="23.0582" cy="56.9097" r="1.6109" stroke="#40AAA3" stroke-width="0.673171"/>
				<circle cx="17.6885" cy="51.5401" r="1.6109" stroke="var(--lp-green)" stroke-width="0.673171"/>
				<circle cx="17.6885" cy="72.4817" r="1.6109" stroke="var(--lp-green)" stroke-width="0.673171"/>
				<circle cx="12.3189" cy="46.1705" r="1.6109" stroke="var(--lp-purple)" stroke-width="0.673171"/>
			</g>
			<path d="M88.8481 47.1704H65.7586" stroke="var(--lp-row)" stroke-width="0.673171"/>
			<path d="M80.7939 52.54H65.7589" stroke="var(--lp-row)" stroke-width="0.673171"/>
			<path d="M88.8481 57.9097H65.7586" stroke="var(--lp-row)" stroke-width="0.673171"/>
			<path d="M80.7939 63.2793H65.7589" stroke="var(--lp-row)" stroke-width="0.673171"/>
			<path d="M88.8481 68.6489H65.7586" stroke="var(--lp-row)" stroke-width="0.673171"/>
			<defs>
				<clipPath id="lp-panel-clip">
					<rect width="51" height="30" fill="white" transform="translate(9.5 44)"/>
				</clipPath>
			</defs>
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

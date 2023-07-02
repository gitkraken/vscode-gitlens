import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('gk-blame-svg')
export class BlameSvg extends LitElement {
	static override styles = css`
		:host {
			position: relative;
		}

		:host svg:last-child {
			display: block;
			max-width: 69.2rem;
			width: calc(100% - 2rem);
			height: auto;
			margin: 0 1rem;

			border: 0.1rem solid var(--vscode-editorWidget-border);
		}

		* {
			user-select: none;
		}

		.codicon {
			font-family: codicon;
			cursor: default;
			user-select: none;
		}

		.glicon {
			font-family: glicons;
			cursor: default;
			user-select: none;
		}

		.line text {
			font-family: var(--vscode-editor-font-family);
			font-size: var(--vscode-editor-font-size);
			font-weight: var(--vscode-editor-font-weight);
		}

		.cursor {
			fill: var(--vscode-editorCursor-foreground);
		}

		.splitter {
			stroke: var(--vscode-editorGroup-border);
		}

		.punctuation {
			fill: var(--vscode-editor-foreground);
		}

		.function-declaration {
			fill: var(--vscode-symbolIcon-functionForeground);
		}

		.function-name {
			fill: var(--vscode-symbolIcon-colorForeground);
		}

		.function-argument {
			fill: var(--vscode-symbolIcon-variableForeground);
		}

		.function-argument-type {
			fill: var(--vscode-symbolIcon-typeParameterForeground);
		}

		.function-return {
			fill: var(--vscode-debugTokenExpression-name);
		}

		.line-current {
			fill: var(--vscode-editor-lineHighlightBackground);
			stroke: var(--vscode-editor-lineHighlightBorder);
			stroke-width: 0.1rem;
			fill-opacity: 0.8;
		}

		.line-number {
			fill: var(--vscode-editorLineNumber-foreground);
		}

		.line-number-active {
			fill: var(--vscode-editorLineNumber-activeForeground);
		}

		.blame {
			fill: var(--vscode-gitlens-trailingLineForegroundColor);
			cursor: pointer;
		}

		.codelens text {
			font-family: var(--vscode-font-family);
			font-size: var(--vscode-font-size);
			font-weight: var(--vscode-font-weight);

			fill: var(--vscode-editorCodeLens-foreground);
		}
		.codelens text tspan {
			font-size: 0.8em;
		}

		.hover {
			opacity: 0;
			visibility: hidden;
			position: absolute;
			bottom: 30px;
			right: -30px;
			animation-duration: 0.25s;
			animation-timing-function: ease-in-out;
			animation-fill-mode: both;
		}

		.hover rect {
			fill: var(--vscode-editorHoverWidget-background);
			stroke: var(--vscode-editorHoverWidget-border);
			stroke-width: 1;
		}

		.hover line {
			stroke: var(--vscode-editorHoverWidget-border);
			stroke-width: 1;
		}

		.hover text {
			font-family: var(--vscode-font-family);
			font-weight: var(--vscode-font-weight);
			font-size: 1.1rem;

			fill: var(--vscode-editorHoverWidget-foreground);
		}

		.hover__diff tspan {
			font-family: var(--vscode-editor-font-family);
			font-weight: var(--vscode-editor-font-weight);
			font-size: var(--vscode-editor-font-size);
		}

		.hover__diff-removed {
			fill: var(--vscode-gitDecoration-deletedResourceForeground);
		}

		.hover__diff-added {
			fill: var(--vscode-gitDecoration-addedResourceForeground);
		}

		.hover__author {
			font-weight: 700;
		}

		.hover__date {
			font-style: italic;
		}

		.hover__link {
			fill: #3794ff !important;
		}

		@keyframes fadeInHover {
			0% {
				opacity: 0;
				visibility: visible;
			}

			100% {
				opacity: 1;
				visibility: visible;
			}
		}

		@keyframes fadeOutHover {
			0% {
				opacity: 1;
				visibility: visible;
			}

			100% {
				opacity: 0;
				visibility: hidden;
			}
		}

		:host([hovered][hovering]) .hover {
			animation-name: fadeInHover;
		}

		:host([hovered]:not([hovering])) .hover {
			animation-name: fadeOutHover;
		}

		.blame,
		.codelens {
			transition: opacity 150ms ease-in-out;
		}

		:host(:not([inline])) .blame,
		:host(:not([codelens])) .codelens {
			cursor: default;
			opacity: 0;
		}
	`;

	@property({ type: Boolean, reflect: true })
	inline?: boolean;

	@property({ type: Boolean, reflect: true })
	codelens?: boolean;

	@property({ type: Boolean, reflect: true })
	hovered?: boolean;

	@property({ type: Boolean, reflect: true })
	hovering?: boolean;

	protected onMouseOver() {
		this.hovered = true;
		this.hovering = this.inline;
	}

	protected onMouseOut() {
		this.hovered = true;
		this.hovering = false;
	}

	override render() {
		return html`
			<!-- Don't reformat or let prettier reformat the SVG otherwise whitespace will get added incorrect and screw up the positioning -->
			<!-- prettier-ignore -->
			<svg class="hover" width="600" height="177" viewBox="30 0 80 177" fill="none" xmlns="http://www.w3.org/2000/svg">
				<rect width="370" height="177" rx="3"></rect>
				<text x="9" y="41" text-anchor="start"><tspan class="codicon" font-size="32">&#xeb99;</tspan></text>
				<text>
					<tspan class="hover__author hover__link" x="52" y="30">You</tspan><tspan>, 6 years ago via PR&nbsp;</tspan><tspan class="hover__author hover__link">#1</tspan><tspan class="hover__date" dx="12">(November 12th, 2016 3:41pm)</tspan><tspan x="52" y="55">Supercharge Git</tspan>
				</text>

				<line x1="0" y1="70" x2="371" y2="70" />

				<text y="89">
					<tspan x="9" dy="1.5" class="codicon hover__link">&#xeafc;</tspan><tspan dx="2" dy="-1.5" class="hover__link">29ad3a0</tspan><tspan dx="9" opacity="0.6">|</tspan><tspan dx="9" dy="1.5" class="codicon hover__link">&#xeafd;</tspan><tspan dx="9" dy="-1.5" opacity="0.6">|</tspan><tspan dx="9" dy="1.5" class="codicon hover__link">&#xea82;</tspan><tspan dx="9" dy="-1.5" opacity="0.6">|</tspan><tspan dx="9" dy="1.5" class="codicon hover__link">&#xeb01;</tspan><tspan dx="9" dy="-1.5" opacity="0.6">|</tspan><tspan dx="9" dy="1.5" class="codicon hover__link">&#xea7c;</tspan>
				</text>

				<line x1="0" y1="99" x2="371" y2="99" />

				<text class="hover__diff">
					<tspan class="hover__diff-removed" x="9" y="119">- return git;</tspan>
					<tspan class="hover__diff-added" x="9" y="136">+ return supercharged(git);</tspan>
				</text>

				<line x1="0" y1="147" x2="371" y2="147" />

				<text y="166">
					<tspan x="9">Changes</tspan><tspan dx="12" dy="1.5" class="codicon hover__link">&#xeafc;</tspan><tspan dx="2" dy="-1.5" class="hover__link">3ac1d3f</tspan><tspan dx="9" dy="1.5" class="codicon">&#xea99;</tspan><tspan dx="6" class="codicon hover__link">&#xeafc;</tspan><tspan dx="2" dy="-1.5" class="hover__link">29ad3a0</tspan><tspan dx="9" opacity="0.6">|</tspan><tspan dx="9" dy="1.5" class="codicon hover__link">&#xeafd;</tspan>
				</text>
			</svg>

			<!-- Don't reformat or let prettier reformat the SVG otherwise whitespace will get added incorrect and screw up the positioning -->
			<!-- prettier-ignore -->
			<svg width="600" height="45" viewBox="0 0 600 43" fill="none" xmlns="http://www.w3.org/2000/svg">
				<g class="codelens">
					<text y="18"><tspan x="38">Eric Amodio, 3 minutes ago | 1 author (Eric Amodio)</tspan></text>
				</g>
				<g class="line">
					<text y="34"><tspan x="7" class="line-number">13</tspan><tspan x="38" class="function-return">return</tspan><tspan dx="6" class="function-name">supercharged</tspan><tspan class="punctuation">(</tspan><tspan class="function-argument">git</tspan><tspan class="punctuation">)</tspan><tspan class="punctuation">;</tspan><tspan class="cursor">|</tspan><tspan dx="24" class="blame" @mouseover=${this
				.onMouseOver} @mouseout=${this.onMouseOut}>You, 6 years ago via PR #1 • Supercharge Git</tspan></text>
				</g>
				<!-- <g class="line">
					<text y="34"><tspan x="7" class="line-number">12</tspan><tspan x="38" class="function-declaration">function</tspan><tspan dx="6" class="function-name">gitlens</tspan><tspan class="punctuation">(</tspan><tspan class="function-argument">git</tspan><tspan class="punctuation">:</tspan><tspan dx="6" class="function-argument-type">object</tspan><tspan class="punctuation">)</tspan><tspan dx="6" class="punctuation">{</tspan><tspan class="cursor">|</tspan><tspan dx="24" class="blame" data-feature-blame="on">You, 6 years ago via PR #1 • Supercharge Git</tspan></text>
				</g> -->
			</svg>
		`;
	}
}

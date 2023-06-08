import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('gk-annotations-svg')
export class AnnotationsSvg extends LitElement {
	static override styles = css`
		:host > svg {
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

		.gutter {
			fill: var(--vscode-gitlens-gutterBackgroundColor);
		}

		.gutter-avatar circle {
			fill: var(--vscode-editorInfo-foreground);
		}
		.gutter-avatar text {
			fill: var(--vscode-gitlens-gutterForegroundColor);
			font-size: 0.75rem;
		}

		.gutter-text {
			fill: var(--vscode-gitlens-gutterForegroundColor);
		}

		.heatmap {
			stroke: #7162db;
		}

		.annotations-left {
			transition: opacity 150ms ease-in-out;
		}

		.annotations-right {
			transition: transform 150ms ease-in-out;
		}

		:host(:not([toggled])) .annotations-left {
			opacity: 0;
		}
		:host(:not([toggled])) .annotations-right {
			transform: translateX(-242px);
		}
	`;

	@property({ type: Boolean, reflect: true })
	toggled?: boolean;

	override render() {
		return html`
			<!-- Don't reformat or let prettier reformat the SVG otherwise whitespace will get added incorrect and screw up the positioning -->
			<!-- prettier-ignore -->
			<svg width="600" height="44" viewBox="0 0 600 42" fill="none" xmlns="http://www.w3.org/2000/svg">
				<g class="line">
					<rect class="line-current" x="0" y="21" width="calc(100% - 1px)" height="21"></rect>
					<text y="14"><tspan x="7" class="line-number">12</tspan></text>
					<text y="36"><tspan x="7" class="line-number-active">13</tspan></text>
				</g>
				<g class="annotations-left">
					<rect class="gutter" x="28" y="0" width="242" height="100%"></rect>
					<g class="line">
						<g class="gutter-avatar">
							<circle cx="42" cy="9" r="7"></circle>
							<text x="42" y="11.5" text-anchor="middle">EA</text>
						</g>
						<text y="14"><tspan x="58" class="gutter-text">Hello GitLens</tspan><tspan x="274" dx="-12" text-anchor="end" class="gutter-text">6 yrs ago</tspan></text>
						<g class="gutter-avatar">
							<circle cx="42" cy="31" r="7"></circle>
							<text x="42" y="33.5" text-anchor="middle">EA</text>
						</g>
						<text y="36"><tspan x="58" class="gutter-text">Supercharged</tspan><tspan x="274" dx="-12" text-anchor="end" class="gutter-text">6 yrs ago</tspan></text>
					</g>
					<line class="heatmap" x1="270" y1="0" x2="270" y2="100%" />
				</g>
				<g class="annotations-right">
					<g class="line">
						<text y="14"><tspan x="278" class="function-declaration">function</tspan><tspan dx="6" class="function-name">gitlens</tspan><tspan class="punctuation">(</tspan><tspan class="function-argument">git</tspan><tspan class="punctuation">:</tspan><tspan dx="6" class="function-argument-type">object</tspan><tspan class="punctuation">)</tspan><tspan dx="6" class="punctuation">{</tspan></text>
						<text y="36"><tspan x="278" dx="24" class="function-return">return</tspan><tspan dx="6" class="function-name">supercharged</tspan><tspan class="punctuation">(</tspan><tspan class="function-argument">git</tspan><tspan class="punctuation">)</tspan><tspan class="punctuation">;</tspan><tspan class="cursor">|</tspan></text>
					</g>
				</g>
			</svg>
		`;
	}
}

import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('gk-revision-navigation-svg')
export class RevisionNavigationSvg extends LitElement {
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

		.splitter {
			stroke: var(--vscode-editorGroup-border);
		}

		.added-line {
			fill: var(--vscode-diffEditor-insertedLineBackground);
		}

		.removed-line {
			fill: var(--vscode-diffEditor-removedLineBackground);
		}

		.added-text {
			outline: 1px solid green;
			fill: green;
		}

		.revision-left {
			transition: opacity 150ms ease-in-out;
		}

		.revision-right {
			transition: transform 150ms ease-in-out;
		}

		:host(:not([toggled])) .revision-left {
			opacity: 0;
		}
		:host(:not([toggled])) .revision-right {
			transform: translateX(-283px);
		}
		:host(:not([toggled])) .revision-right .added-text {
			outline-color: transparent;
			fill: inherit;
		}
	`;

	@property({ type: Boolean, reflect: true })
	toggled?: boolean;

	override render() {
		return html`
			<!-- Don't reformat or let prettier reformat the SVG otherwise whitespace will get added incorrect and screw up the positioning -->
			<!-- prettier-ignore -->
			<svg width="600" height="44" viewBox="0 0 600 42" fill="none" xmlns="http://www.w3.org/2000/svg">
				<defs>
					<clipPath id="clip-left">
						<rect x="0" y="0" width="279" height="100%"></rect>
					</clipPath>
				</defs>

				<g class="revision-left">
					<rect class="removed-line" x="28" y="21" width="251" height="21"></rect>
					<rect class="added-line" x="311" y="21" width="309" height="21"></rect>
					<!-- <rect class="added-text" x="433" y="21" width="38" height="21"></rect> -->
					<rect class="line-current" x="0" y="21" width="calc(100% - 1px)" height="21"></rect>
					<g class="line line-left" style="clip-path: url(#clip-left)">
						<text y="14"><tspan x="7" class="line-number">12</tspan><tspan x="40" class="function-declaration">function</tspan><tspan dx="6" class="function-name">gitlens</tspan><tspan class="punctuation">(</tspan><tspan class="function-argument">git</tspan><tspan class="punctuation">:</tspan><tspan dx="6" class="function-argument-type">object</tspan><tspan class="punctuation">)</tspan><tspan dx="6" class="punctuation">{</tspan></text>
						<text y="36"><tspan x="7" class="line-number">13</tspan><tspan x="40" dx="24" class="function-return">return</tspan><tspan dx="6" class="function-name">supercharged</tspan><tspan class="punctuation">(</tspan><tspan class="function-argument">git</tspan><tspan class="punctuation">)</tspan><tspan class="punctuation">;</tspan></text>
					</g>
					<line class="splitter" x1="280" y1="0" x2="280" y2="100%" />
				</g>
				<g class="revision-right">
					<g class="line line-right">
						<text y="14"><tspan x="290" class="line-number">12</tspan><tspan x="323" class="function-declaration">function</tspan><tspan dx="6" class="function-name">gitlens</tspan><tspan class="punctuation">(</tspan><tspan class="function-argument">git</tspan><tspan class="punctuation">:</tspan><tspan dx="6" class="function-argument-type">object</tspan><tspan class="punctuation">)</tspan><tspan dx="6" class="punctuation">{</tspan></text>
						<text y="36"><tspan x="290" class="line-number-active">13</tspan><tspan x="323" dx="24" class="function-return">return</tspan><tspan dx="6" class="function-name"><tspan>super</tspan><tspan class="added-text">DuperC</tspan><tspan>harged</tspan></tspan><tspan class="punctuation">(</tspan><tspan class="function-argument">git</tspan><tspan class="punctuation">)</tspan><tspan class="punctuation">;</tspan><tspan class="cursor">|</tspan></text>
					</g>
				</g>
			</svg>
		`;
	}
}

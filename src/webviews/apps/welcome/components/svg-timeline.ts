import { css, html, LitElement } from 'lit';
import { customElement } from 'lit/decorators.js';

@customElement('gk-timeline-svg')
export class TimelineSvg extends LitElement {
	static override styles = css`
		:host {
			--color-lane1: #7101ff;
			--color-lane2: #f90;
		}

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

		.additions line {
			stroke: var(--vscode-gitlens-decorations-addedForegroundColor, #339e3e);
			stroke-width: 1.2;
		}

		.deletions line {
			stroke: var(--vscode-gitlens-decorations-deletedForegroundColor, #9e2716);
			stroke-width: 1.2;
		}

		.grid-line {
			stroke: var(--vscode-editorWidget-border, #474747);
			stroke-dasharray: 4.5 4.5;
		}

		.lane1 circle {
			fill: var(--color-lane1);
			opacity: 0.3;
		}

		.lane1 circle:hover {
			cursor: pointer;
			opacity: 0.8;
		}

		.lane2 circle {
			fill: var(--color-lane2);
			opacity: 0.3;
		}

		.lane2 circle:hover {
			cursor: pointer;
			opacity: 0.8;
		}

		:host-context(.vscode-light),
		:host-context(.vscode-high-contrast-light) {
			--color-lane1: #007acc;
			--color-lane2: #ea5c00;
		}
	`;

	override render() {
		return html`
			<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 850 290">
				<g class="additions">
					<line x1="39" x2="39" y1="278" y2="276" />
					<line x1="45" x2="45" y1="272" y2="265" />
					<line x1="99" x2="99" y1="264" y2="249" />
					<line x1="106" x2="106" y1="252" y2="225" />
					<line x1="161" x2="161" y1="272" y2="265" />
					<line x1="174" x2="174" y1="278" y2="276" />
					<line x1="228" x2="228" y1="272" y2="265" />
					<line x1="234" x2="234" y1="264" y2="249" />
					<line x1="288" x2="288" y1="278" y2="276" />
					<line x1="342" x2="342" y1="272" y2="265" />
					<line x1="350" x2="350" y1="172" y2="63" />
					<line x1="357" x2="357" y1="249" y2="218" />
					<line x1="364" x2="364" y1="266" y2="254" />
					<line x1="371" x2="371" y1="273" y2="266" />
					<line x1="378" x2="378" y1="273" y2="266" />
					<line x1="385" x2="385" y1="273" y2="266" />
					<line x1="440" x2="440" y1="249" y2="218" />
					<line x1="447" x2="447" y1="249" y2="218" />
					<line x1="454" x2="454" y1="264" y2="249" />
					<line x1="461" x2="461" y1="264" y2="249" />
					<line x1="468" x2="468" y1="273" y2="266" />
					<line x1="475" x2="475" y1="117" y2="20" />
					<line x1="482" x2="482" y1="273" y2="266" />
					<line x1="490" x2="490" y1="273" y2="266" />
					<line x1="497" x2="497" y1="204" y2="129" />
					<line x1="504" x2="504" y1="200" y2="120" />
					<line x1="511" x2="511" y1="200" y2="120" />
					<line x1="518" x2="518" y1="213" y2="145" />
					<line x1="525" x2="525" y1="252" y2="225" />
					<line x1="580" x2="580" y1="278" y2="276" />
					<line x1="587" x2="587" y1="273" y2="266" />
					<line x1="594" x2="594" y1="252" y2="225" />
					<line x1="601" x2="601" y1="247" y2="214" />
					<line x1="608" x2="608" y1="271" y2="263" />
					<line x1="615" x2="615" y1="274" y2="268" />
					<line x1="623" x2="623" y1="271" y2="263" />
					<line x1="677" x2="677" y1="264" y2="249" />
					<line x1="731" x2="731" y1="273" y2="266" />
					<line x1="739" x2="739" y1="252" y2="225" />
					<line x1="743" x2="743" y1="264" y2="249" />
					<line x1="751" x2="751" y1="224" y2="168" />
					<line x1="805" x2="805" y1="278" y2="276" />
				</g>
				<g class="deletions">
					<line x1="39" x2="39" y1="276" y2="289" />
					<line x1="45" x2="45" y1="270" y2="289" />
					<line x1="99" x2="99" y1="262" y2="289" />
					<line x1="106" x2="106" y1="250" y2="289" />
					<line x1="161" x2="161" y1="270" y2="289" />
					<line x1="174" x2="174" y1="276" y2="289" />
					<line x1="228" x2="228" y1="270" y2="289" />
					<line x1="234" x2="234" y1="262" y2="289" />
					<line x1="288" x2="288" y1="276" y2="289" />
					<line x1="342" x2="342" y1="270" y2="289" />
					<line x1="350" x2="350" y1="170" y2="289" />
					<line x1="357" x2="357" y1="249" y2="289" />
					<line x1="364" x2="364" y1="264" y2="289" />
					<line x1="371" x2="371" y1="271" y2="289" />
					<line x1="378" x2="378" y1="271" y2="289" />
					<line x1="385" x2="385" y1="271" y2="289" />
					<line x1="440" x2="440" y1="247" y2="289" />
					<line x1="447" x2="447" y1="247" y2="289" />
					<line x1="454" x2="454" y1="262" y2="289" />
					<line x1="461" x2="461" y1="262" y2="289" />
					<line x1="468" x2="468" y1="271" y2="289" />
					<line x1="475" x2="475" y1="115" y2="289" />
					<line x1="482" x2="482" y1="271" y2="289" />
					<line x1="490" x2="490" y1="271" y2="289" />
					<line x1="497" x2="497" y1="202" y2="289" />
					<line x1="504" x2="504" y1="198" y2="289" />
					<line x1="511" x2="511" y1="198" y2="289" />
					<line x1="518" x2="518" y1="211" y2="289" />
					<line x1="525" x2="525" y1="250" y2="289" />
					<line x1="580" x2="580" y1="276" y2="289" />
					<line x1="587" x2="587" y1="271" y2="289" />
					<line x1="594" x2="594" y1="250" y2="289" />
					<line x1="601" x2="601" y1="245" y2="289" />
					<line x1="608" x2="608" y1="269" y2="289" />
					<line x1="615" x2="615" y1="272" y2="289" />
					<line x1="623" x2="623" y1="269" y2="289" />
					<line x1="677" x2="677" y1="262" y2="289" />
					<line x1="731" x2="731" y1="271" y2="289" />
					<line x1="739" x2="739" y1="250" y2="289" />
					<line x1="743" x2="743" y1="262" y2="289" />
					<line x1="751" x2="751" y1="222" y2="289" />
					<line x1="805" x2="805" y1="276" y2="289" />
				</g>
				<g class="lane1">
					<line class="grid-line" x1="39" x2="809" y1="99" y2="99" />
					<circle cx="39" cy="99" r="4" />
					<circle cx="45" cy="99" r="8" />
					<circle cx="99" cy="99" r="17" />
					<circle cx="106" cy="99" r="29" />
					<circle cx="174" cy="99" r="4" />
					<circle cx="350" cy="99" r="96" />
					<circle cx="364" cy="99" r="12" />
					<circle cx="378" cy="99" r="8" />
					<circle cx="385" cy="99" r="8" />
					<circle cx="447" cy="99" r="32" />
					<circle cx="461" cy="99" r="17" />
					<circle cx="468" cy="99" r="8" />
					<circle cx="475" cy="99" r="100" />
					<circle cx="482" cy="99" r="8" />
					<circle cx="490" cy="99" r="8" />
					<circle cx="497" cy="99" r="67" />
					<circle cx="504" cy="99" r="71" />
					<circle cx="511" cy="99" r="71" />
					<circle cx="518" cy="99" r="61" />
					<circle cx="525" cy="99" r="29" />
					<circle cx="580" cy="99" r="4" />
					<circle cx="594" cy="99" r="29" />
					<circle cx="677" cy="99" r="17" />
					<circle cx="731" cy="99" r="8" />
					<circle cx="739" cy="99" r="29" />
				</g>
				<g class="lane2">
					<line class="grid-line" x1="39" x2="809" y1="154" y2="154" />
					<circle cx="161" cy="154" r="8" />
					<circle cx="228" cy="154" r="8" />
					<circle cx="234" cy="154" r="17" />
					<circle cx="288" cy="154" r="4" />
					<circle cx="342" cy="154" r="8" />
					<circle cx="357" cy="154" r="31" />
					<circle cx="371" cy="154" r="8" />
					<circle cx="385" cy="154" r="8" />
					<circle cx="440" cy="154" r="32" />
					<circle cx="454" cy="154" r="17" />
					<circle cx="587" cy="154" r="8" />
					<circle cx="601" cy="154" r="33" />
					<circle cx="608" cy="154" r="9" />
					<circle cx="615" cy="154" r="7" />
					<circle cx="623" cy="154" r="9" />
					<circle cx="743" cy="154" r="17" />
					<circle cx="751" cy="154" r="50" />
					<circle cx="805" cy="154" r="4" />
				</g>
			</svg>
		`;
	}
}

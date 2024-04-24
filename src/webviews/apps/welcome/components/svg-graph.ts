import { css, html, LitElement } from 'lit';
import { customElement } from 'lit/decorators.js';

@customElement('gk-graph-svg')
export class GraphSvg extends LitElement {
	static override styles = css`
		:host > svg {
			display: block;
			max-width: 69.2rem;
			width: calc(100% - 2rem);
			height: auto;
			margin: 0 1rem;

			border: 0.1rem solid var(--vscode-editorWidget-border);
			fill: var(--vscode-editor-background);
		}

		* {
			user-select: none;
		}

		text {
			font-family: var(--vscode-font-family);
			font-weight: var(--vscode-font-weight);
			font-size: 1.1rem;
		}

		.codicon {
			font-family: codicon;
			cursor: default;
			user-select: none;
		}

		.foreground {
			fill: var(--vscode-editor-foreground);
		}

		.branch {
			fill: white;
		}

		.branch-current {
			font-weight: 700 !important;
		}

		.messages {
			opacity: 0.7;
		}

		.authors {
			opacity: 0.45;
		}

		.wip {
			opacity: 0.45;
		}

		.lane1-foreground {
			stroke: var(--vscode-gitlens-graphLane1Color);
		}
		.lane1-background {
			fill: var(--vscode-gitlens-graphLane1Color);
		}

		.lane2-foreground {
			stroke: var(--vscode-gitlens-graphLane2Color);
		}
		.lane2-background {
			fill: var(--vscode-gitlens-graphLane2Color);
		}

		.lane3-foreground {
			stroke: var(--vscode-gitlens-graphLane3Color);
		}
		.lane3-background {
			fill: var(--vscode-gitlens-graphLane3Color);
		}

		.lane4-foreground {
			stroke: var(--vscode-gitlens-graphLane4Color);
		}
		.lane4-background {
			fill: var(--vscode-gitlens-graphLane4Color);
		}

		.lane5-foreground {
			stroke: var(--vscode-gitlens-graphLane5Color);
		}
		.lane5-background {
			fill: var(--vscode-gitlens-graphLane5Color);
		}
	`;

	override render() {
		return html`
			<!-- Don't reformat or let prettier reformat the SVG otherwise whitespace will get added incorrect and screw up the positioning -->
			<!-- prettier-ignore -->
			<svg width="850" height="290" viewBox="0 0 850 290" fill="none" xmlns="http://www.w3.org/2000/svg">
				<rect class="lane2-background" x="70" y="46" width="126" height="19" rx="4"/>
				<text class="branch branch-current" x="74" y="59"><tspan dy="1" class="codicon">&#xeab2;</tspan><tspan dx="4" class="codicon">&#xea7a;</tspan><tspan dx="6" dy="-1">main</tspan></text>

				<rect class="lane3-background" opacity="0.5" x="70" y="73" width="126" height="19" rx="4"/>
				<text class="branch" x="74" y="87"><tspan dy="1" class="codicon">&#xebaa;</tspan><tspan dx="4" class="codicon">&#xea64;</tspan><tspan dx="6" dy="-1">feature/onboard</tspan></text>

				<rect class="lane4-background" opacity="0.5" x="70" y="99" width="126" height="19" rx="4"/>
				<text class="branch" x="74" y="113"><tspan dy="1" class="codicon">&#xea7a;</tspan><tspan dx="4" class="codicon">&#xea64;</tspan><tspan dx="6" dy="-1">feature/graph</tspan></text>

				<rect class="lane5-background" opacity="0.5" x="70" y="237" width="126" height="19" rx="4"/>
				<text class="branch" x="74" y="251"><tspan dy="1" class="codicon">&#xea7a;</tspan><tspan dx="6" dy="-1">bug/crash</tspan></text>

				<rect class="lane1-background" opacity="0.2" x="216" y="20" width="128" height="18"/>
				<rect class="lane1-background" x="342" y="20" width="2" height="18"/>

				<line class="lane2-foreground" opacity="0.4" x1="196" y1="56" x2="230" y2="56" stroke-width="2"/>
				<rect class="lane2-background" opacity="0.2" x="238" y="47" width="106" height="18"/>
				<rect class="lane2-background" x="342" y="47" width="2" height="18"/>

				<rect class="lane2-background" opacity="0.2" x="238" y="128" width="106" height="18" />
				<rect class="lane2-background" x="342" y="128" width="2" height="18"/>

				<rect class="lane2-background" opacity="0.2" x="238" y="263" width="106" height="18"/>
				<rect class="lane2-background" x="342" y="263" width="2" height="18"/>

				<line class="lane3-foreground" opacity="0.4" x1="196" y1="83" x2="253" y2="83" stroke-width="2"/>
				<rect class="lane3-background" opacity="0.2" x="260" y="74" width="84" height="18"/>
				<rect class="lane3-background" x="342" y="74" width="2" height="18"/>

				<rect class="lane3-background" opacity="0.2" x="260" y="155" width="84" height="18"/>
				<rect class="lane3-background" x="342" y="155" width="2" height="18"/>

				<rect class="lane3-background" opacity="0.2" x="260" y="209" width="84" height="18"/>
				<rect class="lane3-background" x="342" y="209" width="2" height="18"/>

				<line class="lane4-foreground" opacity="0.4" x1="196" y1="109" x2="275" y2="109" stroke-width="2"/>
				<rect class="lane4-background" opacity="0.2" x="282" y="101" width="62" height="18"/>
				<rect class="lane4-background" x="342" y="101" width="2" height="18"/>

				<rect class="lane4-background" x="342" y="182" width="2" height="18"/>
				<rect class="lane4-background" opacity="0.2" x="282" y="182" width="62" height="18"/>

				<line class="lane5-foreground" opacity="0.3" x1="196" y1="246" x2="297" y2="246" stroke-width="2"/>
				<rect class="lane5-background" opacity="0.2" x="304" y="236" width="40" height="18"/>
				<rect class="lane5-background" x="342" y="236" width="2" height="18"/>
				<path class="lane5-foreground" d="M239 270.74H297C301.418 270.74 305 267.158 305 262.74V247" stroke-width="2"/>

				<line class="lane1-foreground" x1="217" y1="38" x2="217" y2="319" stroke-width="2" stroke-dasharray="4 4"/>
				<circle class="lane1-foreground container" cx="217" cy="29" r="8" stroke-width="2" stroke-dasharray="4 4"/>

				<rect class="lane2-background" x="238" y="47" width="2" height="332"/>
				<circle class="lane2-foreground container" cx="239" cy="56" r="8" stroke-width="2"/>
				<circle class="lane2-foreground container" cx="239" cy="137" r="8" stroke-width="2"/>
				<circle class="lane2-foreground container" cx="239" cy="271" r="8" stroke-width="2"/>

				<rect class="lane3-background" x="260" y="74" width="2" height="305"/>
				<circle class="lane3-foreground container" cx="261" cy="83" r="8" stroke-width="2"/>
				<circle class="lane3-foreground container" cx="261" cy="164" r="8" stroke-width="2"/>
				<circle class="lane3-foreground container" cx="261" cy="218" r="8" stroke-width="2"/>

				<rect class="lane4-background" x="282" y="106" width="2" height="209"/>
				<circle class="lane4-foreground container" cx="283" cy="110" r="8" stroke-width="2"/>
				<circle class="lane4-foreground container" cx="283" cy="191" r="8" stroke-width="2"/>

				<circle class="lane5-foreground container" cx="305" cy="245" r="8" stroke-width="2"/>

				<text x="366" y="33.5" class="foreground wip"><tspan>Work in progress</tspan><tspan dx="9" dy="1" class="codicon">&#xea73;</tspan><tspan dx="3" dy="-1">2</tspan><tspan dx="9" dy="1" class="codicon">&#xea60;</tspan><tspan dx="3" dy="-1">1</tspan></text>
				<text class="foreground messages">
					<tspan x="366" y="59.5">Improves performance &amp; reduces bundle size</tspan>
					<tspan x="366" y="86.5">Adds brand new welcome experience</tspan>
					<tspan x="366" y="113.5">Adds new Commit Graph panel layout</tspan>
					<tspan x="366" y="140.5">Optimizes startup performance</tspan>
					<tspan x="366" y="167.5">Revamps Home view experience for better utility</tspan>
					<tspan x="366" y="194.5">Optimizes Commit Graph loading performance</tspan>
					<tspan x="366" y="221.5">Adds new GitLens Inspect side bar for a better experience</tspan>
					<tspan x="366" y="248.5">Fixes crash when run on a phone</tspan>
					<tspan x="366" y="275.5">Updates package dependencies</tspan>
				</text>

				<text class="foreground authors">
					<tspan x="696" y="59.5">Eric Amodio</tspan>
					<tspan x="696" y="86.5">Keith Daulton</tspan>
					<tspan x="696" y="113.5">Eric Amodio</tspan>
					<tspan x="696" y="140.5">Ramin Tadayon</tspan>
					<tspan x="696" y="167.5">Keith Daulton</tspan>
					<tspan x="696" y="194.5">Eric Amodio</tspan>
					<tspan x="696" y="221.5">Keith Daulton</tspan>
					<tspan x="696" y="248.5">Ramin Tadayon</tspan>
					<tspan x="696" y="275.5">Ramin Tadayon</tspan>
				</text>
			</svg>
		`;
	}
}

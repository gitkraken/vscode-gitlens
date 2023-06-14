import { css, html, LitElement } from 'lit';
import { customElement } from 'lit/decorators.js';
import { icons, svgBase } from './svg.css';

@customElement('gk-workspaces-svg')
export class BlameSvg extends LitElement {
	static override styles = [
		svgBase,
		icons,
		css`
			text {
				fill: var(--vscode-foreground);
				font-size: 18px;
			}
			.header {
				font-weight: 700;
			}

			.codicon {
				font-family: codicon;
				cursor: default;
				user-select: none;
				font-size: 20px;
			}

			.glicon {
				font-family: glicons;
				cursor: default;
				user-select: none;
			}
			.desc {
				font-size: 0.9em;
				opacity: 0.6;
			}
			.small {
				font-size: 0.9em;
			}
			.header-box {
				fill: var(--vscode-sideBarSectionHeader-background);
			}
			.row-box {
				fill: var(--vscode-list-hoverBackground);
				opacity: 0;
			}
			.row {
				cursor: pointer;
			}
			.row:hover .row-box {
				opacity: 1;
			}
			.row-box-selected {
				fill: var(--vscode-list-activeSelectionBackground);
				stroke: var(--vscode-list-focusOutline);
				stroke-width: 1;
			}
			.selected {
				fill: var(--vscode-list-activeSelectionForeground);
			}
			.row:not(:hover) .row-actions {
				display: none;
			}
			.link {
				fill: var(--vscode-textLink-foreground);
			}
			.link:hover {
				text-decoration: underline;
			}
			.addition {
				fill: var(--vscode-gitDecoration-addedResourceForeground);
			}
			.deletion {
				fill: var(--vscode-gitDecoration-deletedResourceForeground);
			}
		`,
	];

	override render() {
		return html`
			<!-- Don't reformat or let prettier reformat the SVG otherwise whitespace will get added incorrect and screw up the positioning -->
			<!-- a-prettier-ignore -->
			<svg width="850" height="290" viewBox="0 0 850 290" fill="none" xmlns="http://www.w3.org/2000/svg">
				<g>
					<rect x="0" y="0" width="100%" height="44" class="header-box" />
					<text x="10" y="28" class="header">
						<tspan dy="4" class="codicon">&#xeab4;</tspan>
						<tspan dx="6" dy="-4">GITKRAKEN WORKSPACES</tspan>
					</text>
				</g>
				<g class="row">
					<rect x="0" y="45" width="100%" height="44" class="row-box-selected" />
					<text x="30" y="71" class="selected">
						<tspan dx="2" dy="4" class="codicon">&#xeab4;</tspan>
						<tspan dx="24" class="codicon">&#xebaa;</tspan>
						<tspan dx="10" dy="-4">Client apps</tspan>
					</text>
					<text x="100%" y="71" text-anchor="end" class="selected">
						<tspan dx="-10" dy="4" class="codicon">&#xea60;</tspan>
						<tspan dx="12" class="codicon">&#xeb1a;</tspan>
						<tspan dx="12" class="codicon">&#xeae4;</tspan>
					</text>
				</g>
				<g class="row">
					<rect x="0" y="90" width="100%" height="44" class="row-box" />
					<text x="50" y="116">
						<tspan dx="2" dy="4" class="codicon">&#xeab6;</tspan>
						<tspan dx="24" class="codicon">&#xea83;</tspan>
						<tspan dx="10" dy="-4">vscode-gitlens</tspan>
						<tspan dx="4" class="small">0</tspan>
						<tspan dx="-8" dy="6" class="codicon">&#xea9d;</tspan>
						<tspan dx="-4" dy="-6" class="small">1</tspan>
						<tspan dx="-8" dy="6" class="codicon">&#xeaa0;</tspan>
						<tspan dx="-3" dy="-6" class="desc">•</tspan>
						<tspan dx="1" dy="0" class="desc">main</tspan>
						<tspan dx="1" dy="0" class="desc">•</tspan>
						<tspan dx="1" dy="0" class="desc">Last fetched 6/9/23</tspan>
					</text>
					<text x="100%" y="116" text-anchor="end" class="row-actions">
						<tspan dx="-10" dy="4" class="codicon">&#xeaa1;</tspan>
						<tspan dx="12" class="codicon">&#xea9a;</tspan>
						<tspan dx="12" class="codicon">&#xeb37;</tspan>
						<tspan dx="12" class="codicon">&#xeae4;</tspan>
					</text>
				</g>
				<g class="row">
					<rect x="0" y="135" width="100%" height="44" class="row-box" />
					<text x="50" y="162">
						<tspan dx="2" dy="4" class="codicon">&#xeab6;</tspan>
						<tspan dx="24" class="codicon">&#xea83;</tspan>
						<tspan dx="10" dy="-4">GitKraken</tspan>
						<tspan dx="4" class="small">1</tspan>
						<tspan dx="-8" dy="6" class="codicon">&#xea9d;</tspan>
						<tspan dx="-4" dy="-6" class="small">0</tspan>
						<tspan dx="-8" dy="6" class="codicon">&#xeaa0;</tspan>
						<tspan dx="-3" dy="-6" class="desc">•</tspan>
						<tspan dx="1" dy="0" class="desc">development</tspan>
						<tspan dx="1" dy="0" class="desc">•</tspan>
						<tspan dx="1" dy="0" class="desc">Last fetched 6/7/23</tspan>
					</text>
					<text x="100%" y="162" text-anchor="end" class="row-actions">
						<tspan dx="-10" dy="4" class="codicon">&#xeaa1;</tspan>
						<tspan dx="12" class="codicon">&#xea9a;</tspan>
						<tspan dx="12" class="codicon">&#xeb37;</tspan>
						<tspan dx="12" class="codicon">&#xeae4;</tspan>
					</text>
				</g>
				<g class="row">
					<rect x="0" y="179" width="100%" height="44" class="row-box" />
					<text x="30" y="209">
						<tspan dx="2" dy="4" class="codicon">&#xeab6;</tspan>
						<tspan dx="24" class="codicon">&#xebaa;</tspan>
						<tspan dx="10" dy="-4">Backend services</tspan>
					</text>
					<text x="100%" y="209" text-anchor="end" class="row-actions">
						<tspan dx="-10" dy="4" class="codicon">&#xea60;</tspan>
						<tspan dx="12" class="codicon">&#xeb1a;</tspan>
						<tspan dx="12" class="codicon">&#xeae4;</tspan>
					</text>
				</g>
				<g class="row">
					<rect x="0" y="223" width="100%" height="44" class="row-box" />
					<text x="30" y="253">
						<tspan dx="2" dy="4" class="codicon">&#xeab6;</tspan>
						<tspan dx="24" class="codicon">&#xebaa;</tspan>
						<tspan dx="10" dy="-4">Open source projects</tspan>
					</text>
					<text x="100%" y="253" text-anchor="end" class="row-actions">
						<tspan dx="-10" dy="4" class="codicon">&#xea60;</tspan>
						<tspan dx="12" class="codicon">&#xeb1a;</tspan>
						<tspan dx="12" class="codicon">&#xeae4;</tspan>
					</text>
				</g>
			</svg>
		`;
	}
}

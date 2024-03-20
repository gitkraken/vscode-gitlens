import { css, html, LitElement } from 'lit';
import { customElement } from 'lit/decorators.js';
import { icons, svgBase } from './svg.css';

@customElement('gk-focus-svg')
export class BlameSvg extends LitElement {
	static override styles = [
		svgBase,
		icons,
		css`
			text {
				fill: var(--vscode-foreground);
				font-size: 18px;
			}
			.heading {
				font-weight: 600;
				font-size: 20px;
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
			.indicator-info {
				fill: var(--vscode-problemsInfoIcon-foreground);
			}
			.indicator-warning {
				fill: var(--vscode-problemsWarningIcon-foreground);
			}
			.indicator-error {
				fill: var(--vscode-problemsErrorIcon-foreground);
			}
			.tabs {
			}
			.tab {
				text-decoration: underline;
				opacity: 0.8;
				font-size: 16px;
				cursor: pointer;
			}
			.row-box {
				fill: var(--vscode-foreground);
				opacity: 0;
			}
			.row:hover .row-box {
				opacity: 0.06;
			}
			.link {
				fill: var(--vscode-textLink-foreground);
				cursor: pointer;
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
					<text x="10" y="30" class="heading">
						<tspan>My Pull Requests</tspan>
					</text>
					<text x="100%" y="30.5" class="tabs" text-anchor="end">
						<tspan class="tab" dx="-10">All</tspan>
						<tspan class="tab" dx="6">Opened by me</tspan>
						<tspan class="tab" dx="6">Assigned to me</tspan>
						<tspan class="tab" dx="6">Needs my review</tspan>
						<tspan class="tab" dx="6">Mentions me</tspan>
					</text>
				</g>
				<g class="row">
					<rect x="0" y="52" width="100%" height="34" class="row-box" />
					<text x="10" y="75">
						<tspan dx="2" dy="2" class="codicon">&#xea64;</tspan>
						<tspan dx="2" class="codicon indicator-error">&#xeb43;</tspan>
						<tspan dx="30" dy="-2">1wk</tspan>
						<tspan dx="30">adds stylelint</tspan>
						<tspan class="link">#2453</tspan>
					</text>
					<text x="100%" y="75" text-anchor="end">
						<tspan dx="-10" dy="2" class="codicon">&#xeb99;</tspan>
						<tspan dx="40" dy="-2" class="addition">+1735</tspan>
						<tspan dx="2" class="deletion">-748</tspan>
						<tspan dx="40" dy="2" class="glicon">&#xf118;</tspan>
					</text>
				</g>
				<g class="row">
					<rect x="0" y="86" width="100%" height="34" class="row-box" />
					<text x="10" y="109">
						<tspan dx="2" dy="2" class="codicon">&#xea64;</tspan>
						<tspan dx="2" class="codicon indicator-info">&#xeba4;</tspan>
						<tspan dx="30" dy="-2">1wk</tspan>
						<tspan dx="30">Workspaces side bar view</tspan>
						<tspan class="link">#2650</tspan>
					</text>
					<text x="100%" y="109" text-anchor="end">
						<tspan dx="-10" dy="2" class="codicon">&#xeb99;</tspan>
						<tspan dx="40" dy="-2" class="addition">+3,556</tspan>
						<tspan dx="2" class="deletion">-136</tspan>
						<tspan dx="34" dy="2" class="glicon">&#xf118;</tspan>
					</text>
				</g>
				<g class="row">
					<rect x="0" y="120" width="100%" height="34" class="row-box" />
					<text x="10" y="143">
						<tspan dx="2" dy="2" class="codicon">&#xea64;</tspan>
						<tspan dx="2" class="codicon indicator-error">&#xebe6;</tspan>
						<tspan dx="30" dy="-2" class="indicator-warning">3wk</tspan>
						<tspan dx="29">Adds experimental.OpenAIModel</tspan>
						<tspan class="link">#2637</tspan>
					</text>
					<text x="100%" y="143" text-anchor="end">
						<tspan dx="-10" dy="2" class="codicon">&#xeb99;</tspan>
						<tspan dx="40" dy="-2" class="addition">+79</tspan>
						<tspan dx="2" class="deletion">-12</tspan>
						<tspan dx="72" dy="2" class="glicon">&#xf118;</tspan>
					</text>
				</g>
				<g class="row">
					<rect x="0" y="154" width="100%" height="34" class="row-box" />
					<text x="10" y="177">
						<tspan dx="2" dy="2" class="codicon">&#xea64;</tspan>
						<tspan dx="54" dy="-2" class="indicator-error">2mo</tspan>
						<tspan dx="29">adds focus view</tspan>
						<tspan class="link">#2516</tspan>
					</text>
					<text x="100%" y="177" text-anchor="end">
						<tspan dx="-10" dy="2" class="codicon">&#xeb99;</tspan>
						<tspan dx="39" dy="-2" class="addition">+3,327</tspan>
						<tspan dx="2" class="deletion">-28</tspan>
						<tspan dx="45" dy="2" class="glicon">&#xf118;</tspan>
					</text>
				</g>
				<g>
					<text x="10" y="232" class="heading">
						<tspan>My Issues</tspan>
					</text>
					<text x="100%" y="232.5" class="tabs" text-anchor="end">
						<tspan class="tab" dx="-10">All</tspan>
						<tspan class="tab" dx="6">Opened by me</tspan>
						<tspan class="tab" dx="6">Assigned to me</tspan>
						<tspan class="tab" dx="6">Mentions me</tspan>
					</text>
				</g>
				<g class="row">
					<rect x="0" y="255" width="100%" height="30" class="row-box" />
					<text x="10" y="278">
						<tspan dx="2" dy="2" class="codicon">&#xeb0c;</tspan>
						<tspan dx="54" dy="-2" class="indicator-error">2mo</tspan>
						<tspan dx="30">Labs: add AI explain panel to Inspect</tspan>
						<tspan class="link">#2628</tspan>
					</text>
					<text x="100%" y="278" text-anchor="end">
						<tspan dx="-10" dy="2" class="codicon">&#xeb99;</tspan>
						<tspan dx="10" dy="0.5" class="codicon">&#xeb01;</tspan>
					</text>
				</g>
			</svg>
		`;
	}
}

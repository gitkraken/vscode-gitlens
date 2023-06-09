import { css, html, LitElement } from 'lit';
import { customElement } from 'lit/decorators.js';
import { icons, svgBase } from './svg.css';

@customElement('gk-focus-svg')
export class BlameSvg extends LitElement {
	static override styles = [
		svgBase,
		icons,
		css`
			:host {
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
					<rect x="0" y="52" width="100%" height="30" class="row-box" />
					<text x="10" y="70">
						<tspan dx="2" dy="2" class="codicon">&#xea64;</tspan>
						<tspan dx="30" dy="-2">1wk</tspan>
						<tspan dx="30">adds stylelint</tspan>
						<tspan class="link">#2453</tspan>
					</text>
					<text x="100%" y="70" text-anchor="end">
						<tspan dx="-10" dy="2" class="codicon">&#xeb99;</tspan>
						<tspan dx="40" dy="-2">0</tspan>
						<tspan dx="40" class="addition">+1735</tspan>
						<tspan dx="2" class="deletion">-748</tspan>
						<tspan dx="40" dy="2" class="codicon">&#xeaf7;</tspan>
						<tspan dx="10" class="glicon">&#xf118;</tspan>
					</text>
				</g>
				<g class="row">
					<rect x="0" y="82" width="100%" height="30" class="row-box" />
					<text x="10" y="100">
						<tspan dx="2" dy="2" class="codicon">&#xea64;</tspan>
						<tspan dx="30" dy="-2">1wk</tspan>
						<tspan dx="30">Workspaces side bar view</tspan>
						<tspan class="link">#2650</tspan>
					</text>
					<text x="100%" y="100" text-anchor="end">
						<tspan dx="-10" dy="2" class="codicon">&#xeb99;</tspan>
						<tspan dx="40" dy="-2">5</tspan>
						<tspan dx="40" class="addition">+3,556</tspan>
						<tspan dx="2" class="deletion">-136</tspan>
						<tspan dx="35" dy="2" class="codicon">&#xeaf7;</tspan>
						<tspan dx="10" class="glicon">&#xf118;</tspan>
					</text>
				</g>
				<g class="row">
					<rect x="0" y="112" width="100%" height="30" class="row-box" />
					<text x="10" y="130">
						<tspan dx="2" dy="2" class="codicon">&#xea64;</tspan>
						<tspan dx="30" dy="-2">3wk</tspan>
						<tspan dx="29">Adds experimental.OpenAIModel</tspan>
						<tspan class="link">#2637</tspan>
					</text>
					<text x="100%" y="130" text-anchor="end">
						<tspan dx="-10" dy="2" class="codicon">&#xeb99;</tspan>
						<tspan dx="40" dy="-2">6</tspan>
						<tspan dx="40" class="addition">+79</tspan>
						<tspan dx="2" class="deletion">-12</tspan>
						<tspan dx="63.5" dy="2" class="codicon">&#xeaf7;</tspan>
						<tspan dx="10" class="glicon">&#xf118;</tspan>
					</text>
				</g>
				<g class="row">
					<rect x="0" y="142" width="100%" height="30" class="row-box" />
					<text x="10" y="160">
						<tspan dx="2" dy="2" class="codicon">&#xea64;</tspan>
						<tspan dx="30" dy="-2">2mo</tspan>
						<tspan dx="29">adds focus view</tspan>
						<tspan class="link">#2516</tspan>
					</text>
					<text x="100%" y="160" text-anchor="end">
						<tspan dx="-10" dy="2" class="codicon">&#xeb99;</tspan>
						<tspan dx="37" dy="-2">14</tspan>
						<tspan dx="36" class="addition">+3,327</tspan>
						<tspan dx="2" class="deletion">-28</tspan>
						<tspan dx="43" dy="2" class="codicon">&#xeaf7;</tspan>
						<tspan dx="10" class="glicon">&#xf118;</tspan>
					</text>
				</g>
				<g>
					<text x="10" y="200" class="heading">
						<tspan>My Issues</tspan>
					</text>
					<text x="100%" y="200.5" class="tabs" text-anchor="end">
						<tspan class="tab" dx="-10">All</tspan>
						<tspan class="tab" dx="6">Opened by me</tspan>
						<tspan class="tab" dx="6">Assigned to me</tspan>
						<tspan class="tab" dx="6">Mentions me</tspan>
					</text>
				</g>
				<g class="row">
					<rect x="0" y="222" width="100%" height="30" class="row-box" />
					<text x="10" y="240">
						<tspan dx="2" dy="2" class="codicon">&#xeb0c;</tspan>
						<tspan dx="30" dy="-2">2mo</tspan>
						<tspan dx="30">Labs: add AI explain panel to Commit Details</tspan>
						<tspan class="link">#2628</tspan>
					</text>
					<text x="100%" y="240" text-anchor="end">
						<tspan dx="-10" dy="2" class="codicon">&#xeb99;</tspan>
						<tspan dx="40" dy="-2">2</tspan>
						<tspan dx="40">0</tspan>
						<tspan dx="40" dy="2" class="codicon">&#xeb01;</tspan>
					</text>
				</g>
				<g class="row">
					<rect x="0" y="252" width="100%" height="30" class="row-box" />
					<text x="10" y="270">
						<tspan dx="2" dy="2" class="codicon">&#xeb0c;</tspan>
						<tspan dx="30" dy="-2">1mo</tspan>
						<tspan dx="30">Experiment with putting the Commit Graph in the sidebar or panel</tspan>
						<tspan class="link">#2602</tspan>
					</text>
					<text x="100%" y="270" text-anchor="end">
						<tspan dx="-10" dy="2" class="codicon">&#xeb99;</tspan>
						<tspan dx="40" dy="-2">2</tspan>
						<tspan dx="40">2</tspan>
						<tspan dx="40" dy="2" class="codicon">&#xeb01;</tspan>
					</text>
				</g>
				<style>
					<![CDATA[
					text {
						fill: var(--vscode-foreground);
					}
					.heading {
					font-weight: 600;
					font-size: 16px;
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
					.tabs {
					}
					.tab {
					text-decoration: underline;
					opacity: 0.8;
					}
					               .row-box { fill: var(--vscode-foreground); opacity: 0; }
					               .row:hover .row-box { opacity: 0.06; }
					               .link { fill: var(--vscode-textLink-foreground); }
					               .link:hover { text-decoration: underline; }
					                              .addition { fill: var(--vscode-gitDecoration-addedResourceForeground); }
					                              .deletion { fill: var(--vscode-gitDecoration-deletedResourceForeground); }
					           ]]>
				</style>
			</svg>
		`;
	}
}

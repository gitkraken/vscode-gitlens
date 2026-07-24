import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { pluralize } from '@gitlens/utils/string.js';
import { renderBranchName } from '../branch-name.js';
import '../overlays/tooltip.js';
import './tracking.js';

@customElement('gl-tracking-status')
export class GlTrackingStatus extends LitElement {
	static override styles = css`
		.tracking__pill {
			display: flex;
			flex-direction: row;
			gap: var(--gl-space-10);
		}

		.pill {
			--gl-pill-border: color-mix(in srgb, transparent 80%, var(--color-foreground));

			font-weight: 600;
		}

		.tracking__tooltip {
			display: contents;
			vertical-align: middle;
		}

		.tracking__tooltip p {
			margin-block: 0;
		}

		::slotted(p[slot='extra']) {
			margin-block: var(--gl-space-10) 0;
		}
	`;

	@property({ attribute: 'branch-name' }) branchName?: string;
	@property({ attribute: 'upstream-name' }) upstreamName?: string;
	@property({ type: Boolean, attribute: 'missing-upstream' }) missingUpstream = false;
	@property({ type: Number }) ahead = 0;
	@property({ type: Number }) behind = 0;
	@property({ type: Number }) working = 0;
	@property({ type: Boolean }) outlined = false;
	@property({ type: Boolean }) colorized = false;

	override render(): unknown {
		if (!this.branchName || !this.upstreamName) return nothing;

		return html`<gl-tooltip class="tracking__pill" placement="bottom"
			><gl-tracking-pill
				class="pill"
				.ahead=${this.ahead}
				.behind=${this.behind}
				.working=${this.working}
				?outlined=${this.outlined}
				?colorized=${this.colorized}
				always-show
				?missingUpstream=${this.missingUpstream}
			></gl-tracking-pill>
			<span class="tracking__tooltip" slot="content">${this.renderDescription()}<slot name="extra"></slot></span
		></gl-tooltip>`;
	}

	private renderDescription() {
		if (this.missingUpstream) {
			return html`${renderBranchName(this.branchName)} is missing its upstream
			${renderBranchName(this.upstreamName)}`;
		}

		const status: string[] = [];
		if (this.behind) {
			status.push(`${pluralize('commit', this.behind)} behind`);
		}
		if (this.ahead) {
			status.push(`${pluralize('commit', this.ahead)} ahead of`);
		}

		if (status.length) {
			return html`${renderBranchName(this.branchName)} is ${status.join(', ')}
			${renderBranchName(this.upstreamName)}`;
		}

		return html`${renderBranchName(this.branchName)} is up to date with ${renderBranchName(this.upstreamName)}`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-tracking-status': GlTrackingStatus;
	}
}

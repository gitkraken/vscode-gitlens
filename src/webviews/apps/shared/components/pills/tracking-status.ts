import * as l10n from '@vscode/l10n';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { localizedContent } from '@gitlens/components/localizedContent.js';
import { getNumericFormat } from '@gitlens/utils/date.js';
import { renderBranchName } from '../branch-name.js';
import '@gitlens/components/components/overlays/tooltip.js';
import '@gitlens/components/components/pills/tracking.js';

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
		let message: string;
		if (this.missingUpstream) {
			message = l10n.t('{branch} is missing its upstream {upstream}');
		} else if (this.behind && this.ahead) {
			message =
				this.behind === 1
					? this.ahead === 1
						? l10n.t('{branch} is {behind} commit behind, {ahead} commit ahead of {upstream}')
						: l10n.t('{branch} is {behind} commit behind, {ahead} commits ahead of {upstream}')
					: this.ahead === 1
						? l10n.t('{branch} is {behind} commits behind, {ahead} commit ahead of {upstream}')
						: l10n.t('{branch} is {behind} commits behind, {ahead} commits ahead of {upstream}');
		} else if (this.behind) {
			message =
				this.behind === 1
					? l10n.t('{branch} is {behind} commit behind {upstream}')
					: l10n.t('{branch} is {behind} commits behind {upstream}');
		} else if (this.ahead) {
			message =
				this.ahead === 1
					? l10n.t('{branch} is {ahead} commit ahead of {upstream}')
					: l10n.t('{branch} is {ahead} commits ahead of {upstream}');
		} else {
			message = l10n.t('{branch} is up to date with {upstream}');
		}
		return localizedContent(message, {
			branch: renderBranchName(this.branchName),
			upstream: renderBranchName(this.upstreamName),
			ahead: getNumericFormat()(this.ahead),
			behind: getNumericFormat()(this.behind),
		});
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-tracking-status': GlTrackingStatus;
	}
}

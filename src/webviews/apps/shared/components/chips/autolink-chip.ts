import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { getAutolinkIcon } from '../rich/utils';
import './action-chip';
import '../rich/issue-pull-request';
import '../overlays/popover';

@customElement('gl-autolink-chip')
export class GlAutolinkChip extends LitElement {
	static override styles = css`
		:host {
			display: contents;
		}

		.chip--opened::part(icon) {
			color: var(--vscode-gitlens-openPullRequestIconColor);
		}
		.chip--closed::part(icon) {
			color: var(--vscode-gitlens-closedPullRequestIconColor);
		}
		.chip--merged::part(icon) {
			color: var(--vscode-gitlens-mergedPullRequestIconColor);
		}
	`;

	@property()
	url = '';

	@property()
	name = '';

	@property()
	date?: number | string | Date;

	@property()
	dateFormat?: string;

	@property()
	dateStyle?: string;

	@property()
	status: 'opened' | 'closed' | 'merged' = 'merged';

	@property()
	type: 'autolink' | 'issue' | 'pr' = 'autolink';

	@property()
	identifier = '';

	@property({ type: Boolean })
	details = false;

	override render(): unknown {
		const { icon, modifier } = getAutolinkIcon(this.type, this.status);

		return html`<gl-popover hoist>
			<gl-action-chip exportparts="icon" slot="anchor" icon=${icon} class="chip--${modifier}"
				><span part="label">${this.identifier}</span></gl-action-chip
			>
			<div slot="content">
				<issue-pull-request
					type=${this.type}
					name=${this.name}
					url="${this.url}"
					identifier=${this.identifier}
					status=${this.status}
					.date=${this.date}
					.dateFormat=${this.dateFormat}
					.dateStyle=${this.dateStyle}
					?details=${this.details}
				></issue-pull-request>
			</div>
		</gl-popover>`;
	}
}

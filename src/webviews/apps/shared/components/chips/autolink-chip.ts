import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { getAutolinkIcon } from '../rich/utils.js';
import './action-chip.js';
import '../rich/issue-pull-request.js';
import '../overlays/popover.js';

@customElement('gl-autolink-chip')
export class GlAutolinkChip extends LitElement {
	static override styles = css`
		:host {
			display: inline-flex;
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

	@property()
	author?: string;

	@property({ type: Boolean })
	isDraft?: boolean;

	@property()
	reviewDecision?: string;

	@property({ type: Boolean })
	details = false;

	override render(): unknown {
		const { icon, modifier } = getAutolinkIcon(this.type, this.status);

		return html`<gl-popover hoist>
			<gl-action-chip
				exportparts="icon"
				slot="anchor"
				icon=${icon}
				overlay="none"
				label=${this.getAccessibleLabel()}
				class="chip--${modifier}"
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
					.author=${this.author}
					?isDraft=${this.isDraft}
					.reviewDecision=${this.reviewDecision}
					?details=${this.details}
				></issue-pull-request>
			</div>
		</gl-popover>`;
	}

	private getAccessibleLabel(): string {
		const typeLabel = this.type === 'pr' ? 'Pull request' : this.type === 'issue' ? 'Issue' : 'Autolink';
		return this.name ? `${typeLabel} ${this.identifier} - ${this.name}` : `${typeLabel} ${this.identifier}`;
	}
}

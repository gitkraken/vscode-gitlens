import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { PullRequestStackInfo } from '@gitlens/git/models/pullRequest.js';
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

		.chip--pr-opened::part(icon) {
			color: var(--vscode-gitlens-openPullRequestIconColor);
		}

		.chip--pr-closed::part(icon) {
			color: var(--vscode-gitlens-closedPullRequestIconColor);
		}

		.chip--pr-merged::part(icon) {
			color: var(--vscode-gitlens-mergedPullRequestIconColor);
		}

		.chip--pr-draft::part(icon) {
			color: var(--vscode-descriptionForeground);
		}

		.chip--issue-opened::part(icon) {
			color: var(--vscode-gitlens-openAutolinkedIssueIconColor);
		}

		.chip--issue-closed::part(icon) {
			color: var(--vscode-gitlens-closedAutolinkedIssueIconColor);
		}

		.stack-badge {
			display: inline-flex;
			align-items: center;
			margin-inline-start: 0.3rem;
			padding: 0.15rem 0.25rem;
			border-radius: 0.3rem;
			font-size: 0.9em;
			font-variant-numeric: tabular-nums;
			line-height: 1;
			color: currentColor;
			background: color-mix(in srgb, currentColor 18%, transparent);
		}
	`;

	@property()
	url = '';

	@property()
	name = '';

	@property()
	date?: number | string | Date;

	/** Names what {@link date} is, forwarded to `<issue-pull-request>` — without it a caller passing an
	 *  `updatedDate` gets the state word as the label ("opened 2 hours ago"), naming the wrong event. */
	@property({ attribute: 'date-label' })
	dateLabel?: string;

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

	@property({ type: Boolean })
	openOnRemote = false;

	/** Numeric id of the PR/issue (no `#` prefix). Passed through to `<issue-pull-request>` so the
	 *  `gl-issue-pull-request-details` event detail can identify this chip. */
	@property({ attribute: 'item-id' })
	itemId?: string;

	/** Provider id (e.g. 'github') — passed through to `<issue-pull-request>` so listeners can
	 *  resolve the PR by id without falling back to current-branch lookup. */
	@property({ attribute: 'provider-id' })
	providerId?: string;

	/** Stack membership — rendered as a layer badge (e.g. "2/3") on the chip and forwarded to the
	 *  hover card. */
	@property({ type: Object })
	stack?: Pick<PullRequestStackInfo, 'number' | 'position' | 'size'>;

	override render(): unknown {
		const { icon, modifier } = getAutolinkIcon(this.type, this.status, this.isDraft);

		return html`<gl-popover trigger="hover focus click">
			<gl-action-chip
				exportparts="icon"
				slot="anchor"
				icon=${icon}
				overlay="none"
				label=${this.getAccessibleLabel()}
				class="chip--${modifier}"
				><span part="label"
					>${this.identifier}${
						this.stack != null
							? html`<span class="stack-badge" aria-hidden="true"
									>${this.stack.position}/${this.stack.size}</span
								>`
							: nothing
					}</span
				></gl-action-chip
			>
			<div slot="content">
				<issue-pull-request
					type=${this.type}
					name=${this.name}
					url="${this.url}"
					identifier=${this.identifier}
					status=${this.status}
					.dateLabel=${this.dateLabel}
					.date=${this.date}
					.dateFormat=${this.dateFormat}
					.dateStyle=${this.dateStyle}
					.author=${this.author}
					?isDraft=${this.isDraft}
					.reviewDecision=${this.reviewDecision}
					?details=${this.details}
					?openOnRemote=${this.openOnRemote}
					.itemId=${this.itemId}
					.providerId=${this.providerId}
					.stack=${this.stack}
				></issue-pull-request>
			</div>
		</gl-popover>`;
	}

	private getAccessibleLabel(): string {
		const typeLabel = this.type === 'pr' ? 'Pull request' : this.type === 'issue' ? 'Issue' : 'Autolink';
		const layer = this.stack != null ? `, layer ${this.stack.position} of ${this.stack.size}` : '';

		return this.name
			? `${typeLabel} ${this.identifier} - ${this.name}${layer}`
			: `${typeLabel} ${this.identifier}${layer}`;
	}
}

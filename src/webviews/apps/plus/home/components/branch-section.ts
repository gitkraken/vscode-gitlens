import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import type { GitTrackingState } from '../../../../../git/models/branch';
import type { GetOverviewBranch } from '../../../../home/protocol';
import '../../../shared/components/code-icon';
import '../../../shared/components/avatar/avatar';
import '../../../shared/components/card/card';
import '../../../shared/components/formatted-date';

type OverviewBranch = GetOverviewBranch;

export const sectionHeadingStyles = css`
	.section-heading {
		font-size: 1.3rem;
		font-weight: normal;
		margin-block: 0 0.8rem;
		text-transform: uppercase;
	}
`;

@customElement('gl-branch-section')
export class GlBranchSection extends LitElement {
	static override styles = [
		sectionHeadingStyles,
		css`
			.section {
				margin-bottom: 1.2rem;
			}
		`,
	];

	@property({ type: String }) label!: string;
	@property({ type: Array }) branches!: GetOverviewBranch[];

	override render() {
		return html`
			<div class="section">
				<h3 class="section-heading">${this.label}</h3>
				${this.branches.map(branch => html`<gl-branch-card .branch=${branch}></gl-branch-card>`)}
			</div>
		`;
	}
}

@customElement('gl-branch-card')
export class GlBranchCard extends LitElement {
	static override styles = css`
		.branch-item {
		}

		.pill {
			display: inline-flex;
			align-items: center;
			/* gap: 0.4rem; */
			padding: 0.2rem 0.4rem 0.2rem 0.8rem;
			margin-left: 0.4rem;
			border-radius: 0.4rem;
			border: 1px solid color-mix(in lab, var(--vscode-sideBar-foreground) 100%, #000 10%);
			/* background-color: var(--vscode-gitDecoration-untrackedResourceForeground); */
		}

		.branch-item__main {
			display: flex;
			/* flex-direction: column; */
			/* align-items: center; */
			margin-block-end: 0.8rem;
		}

		.branch-item__icon {
			margin-right: 0.4rem;
			color: var(--vscode-gitDecoration-addedResourceForeground);
		}

		.branch-item__name {
			font-weight: bold;
			margin-right: 0.8rem;
		}

		.branch-item__pr-number {
			color: var(--vscode-descriptionForeground);
			margin-right: 0.8rem;
		}
		.branch-item__pr-title {
			flex-grow: 1;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}

		.branch-item__details {
			display: flex;
			flex-direction: column;
			gap: 0.4rem;
			/* align-items: center; */
			font-size: 0.9em;
			color: var(--vscode-descriptionForeground);
		}

		.branch-item__upstream,
		.branch-item__pr-status,
		.branch-item__commit-count {
			display: flex;
			align-items: center;
			margin-right: 1.6rem;
		}

		.branch-item__upstream code-icon,
		.branch-item__pr-status code-icon,
		.branch-item__commit-count code-icon {
			margin-right: 0.4rem;
		}

		.branch-item__more-actions {
			margin-left: auto;
		}
	`;

	@property({ type: Object })
	branch!: GetOverviewBranch;

	override render() {
		const { name, pr, opened: active, timestamp: date, state, workingTreeState } = this.branch;

		return html`
			<gl-card class="branch-item" .active=${active}>
				<p class="branch-item__main">
					<span class="branch-item__icon">${this.renderIcon(this.branch)}</span>
					${when(
						pr,
						() =>
							html`<span class="branch-item__pr-title">${pr!.title}</span>
								<span class="branch-item__pr-number">#${pr!.id}</span>`,
						() => html`<span class="branch-item__name">${name}</span>`,
					)}
				</p>
				<p class="branch-item__details">
					${this.renderAvatars(this.branch)}
					${when(
						pr,
						() =>
							html`<span
								><span class="branch-item__icon">${this.renderIcon(this.branch, true)}</span
								><span class="branch-item__name">${name}</span></span
							>`,
					)}
					${this.renderStatus(workingTreeState, state)}
					${when(
						date,
						() =>
							html`<formatted-date .date=${new Date(date!)} class="branch-item__date"></formatted-date>`,
					)}
				</p>
			</gl-card>
		`;
	}

	private renderIcon(branch: OverviewBranch, noPr?: boolean) {
		if (branch.pr && !noPr) {
			if (branch.pr.state === 'closed') {
				return html`<code-icon icon="git-pull-request-closed"></code-icon>`;
			} else if (branch.pr.state === 'merged') {
				return html`<code-icon icon="git-merge"></code-icon>`;
			}
			return html`<code-icon icon="git-pull-request"></code-icon>`;
		}
		if (branch.worktree) {
			return html`<code-icon icon="gl-repositories-view"></code-icon>`;
		}
		return html`<code-icon icon="git-branch"></code-icon>`;
	}

	private renderAvatars(branch: GetOverviewBranch) {
		return html`
			${when(
				branch.contributors != null,
				() =>
					html`<div>
						${branch.contributors!.map(
							contributor =>
								html`<gl-avatar url="${contributor.avatarUrl}" name=${contributor.name}></gl-avatar>`,
						)}
					</div>`,
			)}
			${when(
				branch.owner,
				() =>
					html`<div>
						<gl-avatar url="${branch.owner!.avatarUrl}" name=${branch.owner!.name}></gl-avatar>
					</div>`,
			)}
		`;
	}

	private renderStatus(
		workingTreeState: { added: number; changed: number; deleted: number } | undefined,
		state: GitTrackingState | undefined,
	) {
		const rendered = [];
		if (workingTreeState?.added || workingTreeState?.changed || workingTreeState?.deleted) {
			if (workingTreeState.added) {
				rendered.push(html`<span>${workingTreeState.added}<code-icon icon="add"></code-icon></span>`);
			}
			if (workingTreeState.changed) {
				rendered.push(html`<span>${workingTreeState.changed}<code-icon icon="edit"></code-icon></span>`);
			}
			if (workingTreeState.deleted) {
				rendered.push(html`<span>${workingTreeState.deleted}<code-icon icon="trash"></code-icon></span>`);
			}
		}

		if (state?.ahead || state?.behind) {
			if (state.ahead) {
				rendered.push(html`<span class="pill">${state.ahead}<code-icon icon="arrow-up"></code-icon></span>`);
			}
			if (state.behind) {
				rendered.push(html`<span class="pill">${state.behind}<code-icon icon="arrow-down"></code-icon></span>`);
			}
		}

		if (rendered.length) {
			return html`<span class="branch-item__status">${rendered}</span>`;
		}

		return nothing;
	}
}

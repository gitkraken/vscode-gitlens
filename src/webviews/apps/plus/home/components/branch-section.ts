import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import type { GitTrackingState } from '../../../../../git/models/branch';
import type { GetOverviewBranch } from '../../../../home/protocol';
import '../../../shared/components/code-icon';
import '../../../shared/components/avatar/avatar';
import '../../../shared/components/avatar/avatar-list';
import '../../../shared/components/card/card';
import '../../../shared/components/commit/commit-stats';
import '../../../shared/components/formatted-date';
import '../../../shared/components/pills/tracking';
import '../../../shared/components/rich/pr-icon';

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
				<slot></slot>
				${this.branches.map(branch => html`<gl-branch-card .branch=${branch}></gl-branch-card>`)}
			</div>
		`;
	}
}

export const branchCardStyles = css`
	.pill {
		display: inline-flex;
		align-items: center;
		/* gap: 0.4rem; */
		padding-block: 0.1rem;
		padding-inline: 0.6rem 0.4rem;
		margin-left: 0.4rem;
		border-radius: 0.4rem;
		border: 1px solid color-mix(in lab, var(--vscode-sideBar-foreground, var(--vscode-foreground)) 100%, #000 10%);
		/* background-color: var(--vscode-gitDecoration-untrackedResourceForeground); */
	}

	/* .branch-item {} */

	.branch-item__main {
		display: flex;
		/* flex-direction: column; */
		/* align-items: center; */
		gap: 0.4rem;
	}

	.branch-item__icon {
		margin-right: 0.4rem;
		color: var(--color-foreground--50);
	}

	.branch-item__name {
		flex-grow: 1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		font-weight: bold;
	}

	.branch-item__identifier {
		color: var(--vscode-descriptionForeground);
	}

	.branch-item__details {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		/* align-items: center; */
		font-size: 0.9em;
		color: var(--vscode-descriptionForeground);
	}
	.branch-item__details > * {
		margin-block: 0;
	}

	.branch-item__main + .branch-item__main,
	.branch-item__main + .branch-item__details,
	.branch-item__details + .branch-item__details {
		margin-block-start: 0.8rem;
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

	.branch-item__grouping {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		max-width: 100%;
	}

	.test1 {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.test1 .branch-item__grouping {
		flex-grow: 1;
		overflow: hidden;
		margin-inline-start: auto;
	}
`;

@customElement('gl-branch-card')
export class GlBranchCard extends LitElement {
	static override styles = branchCardStyles;

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
							html`<span class="branch-item__name">${pr!.title}</span>
								<span class="branch-item__identifier">#${pr!.id}</span>`,
						() => html`<span class="branch-item__name">${name}</span>`,
					)}
				</p>
				<div class="branch-item__details">
					<p class="test1">
						${this.renderAvatars(this.branch)} ${this.renderStatus(workingTreeState, state)}
						${when(
							pr,
							() => html`
								<span class="branch-item__grouping"
									><span class="branch-item__icon">${this.renderIcon(this.branch, true)}</span
									><span class="branch-item__name">${name}</span></span
								>
							`,
						)}
					</p>
					${when(
						date,
						() =>
							html`<formatted-date .date=${new Date(date!)} class="branch-item__date"></formatted-date>`,
					)}
				</div>
			</gl-card>
		`;
	}

	private renderIcon(branch: OverviewBranch, noPr?: boolean) {
		if (branch.pr && !noPr) {
			return html`<pr-icon state=${branch.pr.state}></pr-icon>`;
		}
		if (branch.worktree) {
			return html`<code-icon icon="gl-repositories-view"></code-icon>`;
		}
		return html`<code-icon icon="git-branch"></code-icon>`;
	}

	private renderAvatars(branch: GetOverviewBranch) {
		const contributors = [];

		if (branch.owner) {
			contributors.push(branch.owner);
		}

		if (branch.contributors) {
			contributors.push(...branch.contributors);
		}

		if (contributors.length === 0) {
			return nothing;
		}

		return html`<gl-avatar-list
			.avatars=${contributors.map(a => ({ name: a.name, src: a.avatarUrl }))}
		></gl-avatar-list>`;
	}

	private renderStatus(
		workingTreeState: { added: number; changed: number; deleted: number } | undefined,
		state: GitTrackingState | undefined,
	) {
		const rendered = [];
		if (workingTreeState?.added || workingTreeState?.changed || workingTreeState?.deleted) {
			// if (workingTreeState.added) {
			// 	rendered.push(html`<span>${workingTreeState.added}<code-icon icon="add"></code-icon></span>`);
			// }
			// if (workingTreeState.changed) {
			// 	rendered.push(html`<span>${workingTreeState.changed}<code-icon icon="edit"></code-icon></span>`);
			// }
			// if (workingTreeState.deleted) {
			// 	rendered.push(html`<span>${workingTreeState.deleted}<code-icon icon="trash"></code-icon></span>`);
			// }

			rendered.push(
				html`<commit-stats
					added=${workingTreeState.added}
					modified=${workingTreeState.changed}
					removed=${workingTreeState.deleted}
					symbol="icons"
				></commit-stats>`,
			);
		}

		if (state?.ahead || state?.behind) {
			// if (state.ahead) {
			// 	rendered.push(html`<span class="pill">${state.ahead}<code-icon icon="arrow-up"></code-icon></span>`);
			// }
			// if (state.behind) {
			// 	rendered.push(html`<span class="pill">${state.behind}<code-icon icon="arrow-down"></code-icon></span>`);
			// }
			rendered.push(
				html`<gl-tracking-pill
					colorized
					outlined
					ahead=${state.ahead}
					behind=${state.behind}
				></gl-tracking-pill>`,
			);
		}

		if (rendered.length) {
			// return html`<span class="branch-item__status">${rendered}</span>`;
			return rendered;
		}

		return nothing;
	}
}

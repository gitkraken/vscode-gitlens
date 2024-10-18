import { consume } from '@lit/context';
import { SignalWatcher } from '@lit-labs/signals';
import { css, html, LitElement } from 'lit';
import { customElement } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import type { GetOverviewBranch } from '../../../../home/protocol';
import { branchCardStyles, sectionHeadingStyles } from './branch-section';
import type { Overview, OverviewState } from './overviewState';
import { overviewStateContext } from './overviewState';
import '../../../shared/components/code-icon';
import '../../../shared/components/card/card';

export const activeWorkTagName = 'gl-active-work';

@customElement(activeWorkTagName)
export class GlActiveWork extends SignalWatcher(LitElement) {
	static override styles = [
		css`
			:host {
				display: block;
				margin-bottom: 2.4rem;
			}
		`,
		branchCardStyles,
		sectionHeadingStyles,
	];

	@consume({ context: overviewStateContext })
	private _overviewState!: OverviewState;

	override connectedCallback() {
		super.connectedCallback();

		if (this._overviewState.state.value == null) {
			this._overviewState.run();
		}
	}

	override render() {
		return this._overviewState.render({
			pending: () => html`<span>Loading...</span>`,
			complete: overview => this.renderComplete(overview),
			error: () => html`<span>Error</span>`,
		});
	}

	private renderComplete(overview: Overview) {
		const activeBranches = overview?.repository?.branches?.active;
		if (activeBranches == null) return html`<span>None</span>`;

		return html`
			<h3 class="section-heading">Active (${activeBranches.length})</h3>
			${activeBranches.map(branch => this.renderRepoBranchCard(overview!.repository.name, branch))}
		`;
	}

	private renderRepoBranchCard(repoName: string, branch: GetOverviewBranch) {
		const { name, pr, opened: active, timestamp: date, state, workingTreeState } = branch;
		return html`
			<gl-card class="branch-item" active>
				<p class="branch-item__main">
					<span class="branch-item__icon">
						<code-icon icon="repo"></code-icon>
					</span>
					<span class="branch-item__name">${repoName}</span>
				</p>
				<p class="branch-item__main">
					<span class="branch-item__icon">
						${when(
							branch.worktree,
							() => html`<code-icon icon="gl-repositories-view"></code-icon>`,
							() => html`<code-icon icon="git-branch"></code-icon>`,
						)}
					</span>
					<span class="branch-item__name">${name}</span>
				</p>
			</gl-card>
			${when(pr, () => {
				const statusIcon =
					pr!.state === 'closed'
						? 'git-pull-request-closed'
						: pr!.state === 'merged'
						  ? 'git-merge'
						  : 'git-pull-request';
				return html`<gl-card class="branch-item">
					<p class="branch-item__main">
						<span class="branch-item__icon">
							<code-icon icon=${statusIcon}></code-icon>
						</span>
						<span class="branch-item__pr-title">${pr!.title}</span>
						<span class="branch-item__pr-number">#${pr!.id}</span>
					</p>
				</gl-card>`;
			})}
		`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		[activeWorkTagName]: GlActiveWork;
	}
}

import { consume } from '@lit/context';
import { SignalWatcher } from '@lit-labs/signals';
import { css, html, LitElement, nothing } from 'lit';
import { customElement } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import type { GitTrackingState } from '../../../../../git/models/branch';
import type { GetOverviewBranch } from '../../../../home/protocol';
import { branchCardStyles, sectionHeadingStyles } from './branch-section';
import type { Overview, OverviewState } from './overviewState';
import { overviewStateContext } from './overviewState';
import '../../../shared/components/code-icon';
import '../../../shared/components/skeleton-loader';
import '../../../shared/components/card/card';
import '../../../shared/components/rich/pr-icon';

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
			pending: () => this.renderPending(),
			complete: overview => this.renderComplete(overview),
			error: () => html`<span>Error</span>`,
		});
	}

	private renderPending() {
		return html`
			<h3 class="section-heading">Active</h3>
			<skeleton-loader lines="3"></skeleton-loader>
		`;
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
		const { name, pr, state, workingTreeState } = branch;
		return html`
			<gl-card class="branch-item" active>
				<p class="branch-item__main">
					<span class="branch-item__icon">
						<code-icon icon="repo"></code-icon>
					</span>
					<span class="branch-item__name">${repoName}</span>
				</p>
				${when(state, () => this.renderStatus(undefined, state))}
				<p class="branch-item__main">
					<span class="branch-item__icon">
						<code-icon icon=${branch.worktree ? 'gl-repositories-view' : 'git-branch'}></code-icon>
					</span>
					<span class="branch-item__name">${name}</span>
				</p>
				${when(workingTreeState, () => this.renderStatus(workingTreeState, undefined))}
			</gl-card>
			${when(pr, () => {
				return html`<gl-card class="branch-item">
					<p class="branch-item__main">
						<span class="branch-item__icon">
							<pr-icon state=${pr!.state}></pr-icon>
						</span>
						<span class="branch-item__name">${pr!.title}</span>
						<span class="branch-item__identifier">#${pr!.id}</span>
					</p>
				</gl-card>`;
			})}
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
			const stateFrags = [];
			if (state.ahead) {
				stateFrags.push(html`<span class="pill">${state.ahead}<code-icon icon="arrow-up"></code-icon></span>`);
			}
			if (state.behind) {
				stateFrags.push(
					html`<span class="pill">${state.behind}<code-icon icon="arrow-down"></code-icon></span>`,
				);
			}
		}

		if (rendered.length) {
			return html`<p class="branch-item__details"><span class="branch-item__status">${rendered}</span></p>`;
		}

		return nothing;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		[activeWorkTagName]: GlActiveWork;
	}
}

import { consume } from '@lit/context';
import { SignalWatcher } from '@lit-labs/signals';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import type { GitTrackingState } from '../../../../../git/models/branch';
import { createWebviewCommandLink } from '../../../../../system/webview';
import type { GetOverviewBranch, State } from '../../../../home/protocol';
import { stateContext } from '../../../home/context';
import { branchCardStyles, sectionHeadingStyles } from './branch-section';
import type { Overview, OverviewState } from './overviewState';
import { overviewStateContext } from './overviewState';
import '../../../shared/components/button';
import '../../../shared/components/code-icon';
import '../../../shared/components/skeleton-loader';
import '../../../shared/components/card/card';
import '../../../shared/components/commit/commit-stats';
import '../../../shared/components/menu/menu-item';
import '../../../shared/components/overlays/popover';
import '../../../shared/components/pills/tracking';
import '../../../shared/components/rich/pr-icon';

export const activeWorkTagName = 'gl-active-work';

@customElement(activeWorkTagName)
export class GlActiveWork extends SignalWatcher(LitElement) {
	static override styles = [
		branchCardStyles,
		sectionHeadingStyles,
		css`
			:host {
				display: block;
				margin-bottom: 2.4rem;
			}
			.is-end {
				margin-block-end: 0;
			}
			.section-heading-action {
				--button-padding: 0.1rem 0.2rem 0;
				margin-block: -1rem;
			}
			.heading-icon {
				color: var(--color-foreground--50);
			}
		`,
	];

	@consume<State>({ context: stateContext, subscribe: true })
	@state()
	private _homeState!: State;

	@consume({ context: overviewStateContext })
	private _overviewState!: OverviewState;

	override connectedCallback() {
		super.connectedCallback();

		if (this._homeState.repositories.openCount > 0) {
			this._overviewState.run();
		}
	}

	override render() {
		if (this._homeState.repositories.openCount === 0) {
			return nothing;
		}

		return this._overviewState.render({
			pending: () => this.renderPending(),
			complete: overview => this.renderComplete(overview),
			error: () => html`<span>Error</span>`,
		});
	}

	private renderPending() {
		if (this._overviewState.state == null) {
			return html`
				<h3 class="section-heading"><skeleton-loader lines="1"></skeleton-loader></h3>
				<skeleton-loader lines="3"></skeleton-loader>
			`;
		}
		return this.renderComplete(this._overviewState.state);
	}

	private renderComplete(overview: Overview) {
		const activeBranches = overview?.repository?.branches?.active;
		if (!activeBranches) return html`<span>None</span>`;

		return html`
			<h3 class="section-heading section-heading--actions">
				<span><code-icon icon="repo" class="heading-icon"></code-icon> ${overview.repository.name}</span>
				${when(
					this._homeState.repositories.openCount > 1,
					() =>
						html`<span
							><gl-button
								class="section-heading-action"
								appearance="toolbar"
								tooltip="Change Repository"
								@click=${(e: MouseEvent) => this.onChange(e)}
								><code-icon icon="chevron-down"></code-icon></gl-button
						></span>`,
				)}
			</h3>
			${activeBranches.map(branch => this.renderRepoBranchCard(branch))}
		`;
	}

	private renderRepoBranchCard(branch: GetOverviewBranch) {
		const { name, pr, state, workingTreeState, upstream } = branch;
		return html`
			<gl-card class="branch-item" active>
				<p class="branch-item__main">
					<span class="branch-item__icon">
						<code-icon icon=${branch.worktree ? 'gl-worktrees-view' : 'git-branch'}></code-icon>
					</span>
					<span class="branch-item__name">${name}</span>
				</p>
				${when(state, () => this.renderBranchStateActions(state, upstream))}
				${when(pr, pr => {
					return html` <p class="branch-item__main is-end">
						<span class="branch-item__icon">
							<pr-icon state=${pr.state}></pr-icon>
						</span>
						<span class="branch-item__name">${pr.title}</span>
						<a href=${pr.url} class="branch-item__identifier">#${pr.id}</a>
					</p>`;
				})}
				${when(workingTreeState, () => this.renderStatus(workingTreeState, state))}
			</gl-card>
		`;
	}

	private renderBranchStateActions(state?: GitTrackingState, upstream?: { name: string; missing: boolean }) {
		if (upstream?.missing !== false) {
			return html`<div>
				<button-container>
					<gl-button
						href=${createWebviewCommandLink('gitlens.views.home.publishBranch', 'gitlens.views.home', '')}
						full
						appearance="secondary"
						><code-icon icon="cloud-upload" slot="prefix"></code-icon> Publish Branch</gl-button
					></button-container
				>
			</div>`;
		}
		if (state?.ahead || state?.behind) {
			const isAhead = state.ahead > 0;
			const isBehind = state.behind > 0;
			if (isAhead && isBehind) {
				const pullTooltip = upstream?.name ? `Pull from ${upstream.name}` : 'Pull';
				const forcePushTooltip = upstream?.name ? `Force Push to ${upstream.name}` : 'Force Push';
				return html`<div>
					<button-container>
						<gl-button
							href=${createWebviewCommandLink('gitlens.views.home.pull', 'gitlens.views.home', '')}
							full
							appearance="secondary"
							tooltip=${pullTooltip}
							><code-icon icon="gl-repo-pull" slot="prefix"></code-icon> Pull
							<gl-tracking-pill
								.ahead=${state.ahead}
								.behind=${state.behind}
								slot="suffix"
							></gl-tracking-pill
						></gl-button>
						<gl-button
							href=${createWebviewCommandLink('gitlens.views.home.push', 'gitlens.views.home', '', {
								force: true,
							})}
							appearance="secondary"
							density="compact"
							tooltip=${forcePushTooltip}
							><code-icon icon="repo-force-push"></code-icon
						></gl-button>
					</button-container>
				</div>`;
			}
			if (isBehind) {
				const tooltip = upstream?.name ? `Pull from ${upstream.name}` : 'Pull';
				return html`<div>
					<button-container>
						<gl-button
							href=${createWebviewCommandLink('gitlens.views.home.pull', 'gitlens.views.home', '')}
							full
							appearance="secondary"
							tooltip=${tooltip}
							><code-icon icon="gl-repo-pull" slot="prefix"></code-icon> Pull
							<gl-tracking-pill
								.ahead=${state.ahead}
								.behind=${state.behind}
								slot="suffix"
							></gl-tracking-pill></gl-button
					></button-container>
				</div>`;
			}
			if (isAhead) {
				const tooltip = upstream?.name ? `Push to ${upstream.name}` : 'Push';
				return html`<div>
					<button-container>
						<gl-button
							href=${createWebviewCommandLink('gitlens.views.home.push', 'gitlens.views.home', '')}
							full
							appearance="secondary"
							tooltip=${tooltip}
							><code-icon icon="repo-push" slot="prefix"></code-icon> Push
							<gl-tracking-pill
								.ahead=${state.ahead}
								.behind=${state.behind}
								slot="suffix"
							></gl-tracking-pill>
						</gl-button>
					</button-container>
				</div>`;
			}
		}
		return nothing;
	}

	private renderStatus(
		workingTreeState: { added: number; changed: number; deleted: number } | undefined,
		_state: GitTrackingState | undefined,
	) {
		const rendered = [];
		if (workingTreeState?.added || workingTreeState?.changed || workingTreeState?.deleted) {
			rendered.push(
				html`<commit-stats
					added=${workingTreeState.added}
					modified=${workingTreeState.changed}
					removed=${workingTreeState.deleted}
					symbol="icons"
				></commit-stats>`,
			);
		}

		// if (state?.ahead || state?.behind) {
		// 	rendered.push(
		// 		html`<gl-tracking-pill
		// 			colorized
		// 			outlined
		// 			ahead=${state.ahead}
		// 			behind=${state.behind}
		// 		></gl-tracking-pill>`,
		// 	);
		// }

		if (rendered.length) {
			return html`<p class="branch-item__details">${rendered}</p>`;
		}

		return nothing;
	}

	private onChange(_e: MouseEvent) {
		void this._overviewState.changeRepository();
	}
}

declare global {
	interface HTMLElementTagNameMap {
		[activeWorkTagName]: GlActiveWork;
	}
}

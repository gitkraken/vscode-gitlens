import { consume } from '@lit/context';
import { SignalWatcher } from '@lit-labs/signals';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { when } from 'lit/directives/when.js';
import type { GitTrackingState } from '../../../../../git/models/branch';
import type { GetOverviewBranch, RepositoryChoice, State } from '../../../../home/protocol';
import { stateContext } from '../../../home/context';
import { GlElement } from '../../../shared/components/element';
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
		css`
			:host {
				display: block;
				margin-bottom: 2.4rem;
			}
		`,
		branchCardStyles,
		sectionHeadingStyles,
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
				<h3 class="section-heading">Active</h3>
				<skeleton-loader lines="3"></skeleton-loader>
			`;
		}
		return this.renderComplete(this._overviewState.state);
	}

	private renderComplete(overview: Overview) {
		const activeBranches = overview?.repository?.branches?.active;
		if (activeBranches == null) return html`<span>None</span>`;

		return html`
			<h3 class="section-heading section-heading--actions">
				<span>Active (${activeBranches.length})</span>
				${when(overview!.choices, () => html`<gl-change-repo .options=${overview!.choices}></gl-change-repo>`)}
			</h3>
			${activeBranches.map(branch => this.renderRepoBranchCard(overview!.repository.name, branch))}
		`;
	}

	private renderRepoBranchCard(repoName: string, branch: GetOverviewBranch) {
		const { name, pr, state, workingTreeState, upstream } = branch;
		return html`
			<gl-card class="branch-item" active>
				<p class="branch-item__main">
					<span class="branch-item__icon">
						<code-icon icon="repo"></code-icon>
					</span>
					<span class="branch-item__name">${repoName}</span>
				</p>
				${when(state, () => this.renderBranchStateActions(state, upstream))}
				<p class="branch-item__main">
					<span class="branch-item__icon">
						<code-icon icon=${branch.worktree ? 'gl-repositories-view' : 'git-branch'}></code-icon>
					</span>
					<span class="branch-item__name">${name}</span>
				</p>
				${when(workingTreeState, () => this.renderStatus(workingTreeState, state))}
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

	private renderBranchStateActions(state?: GitTrackingState, upstream?: { name: string; missing: boolean }) {
		if (upstream?.missing !== false) {
			return html`<div>
				<button-container>
					<gl-button full appearance="secondary"
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
						<gl-button full appearance="secondary" tooltip=${pullTooltip}
							><code-icon icon="gl-repo-pull" slot="prefix"></code-icon> Pull
							<gl-tracking-pill
								.ahead=${state.ahead}
								.behind=${state.behind}
								slot="suffix"
							></gl-tracking-pill
						></gl-button>
						<gl-button appearance="secondary" density="compact" tooltip=${forcePushTooltip}
							><code-icon icon="repo-force-push"></code-icon
						></gl-button>
					</button-container>
				</div>`;
			}
			if (isBehind) {
				const tooltip = upstream?.name ? `Pull from ${upstream.name}` : 'Pull';
				return html`<div>
					<button-container>
						<gl-button full appearance="secondary" tooltip=${tooltip}
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
						<gl-button full appearance="secondary" tooltip=${tooltip}
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
}

@customElement('gl-change-repo')
export class GlChangeRepo extends GlElement {
	static override styles = [
		css`
			.popover::part(body) {
				padding: 0;
				font-size: var(--vscode-font-size);
				background-color: var(--vscode-menu-background);
			}
			.trigger {
				--button-padding: 0.1rem 0.2rem 0;
				margin-block: -1rem;
			}

			.option {
				max-width: 20rem;
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
			}

			.option code-icon {
				color: var(--color-foreground--50);
			}
		`,
	];

	@consume({ context: overviewStateContext })
	private _overviewState!: OverviewState;

	@property({ type: Array }) options?: RepositoryChoice[];

	protected getLabel(option: RepositoryChoice) {
		return option.name;
	}

	protected onChange(option: RepositoryChoice) {
		void this.querySelector('gl-popover')?.hide();
		void this._overviewState.changeRepository(option.path);
	}

	override render() {
		if (!this.options) {
			return;
		}
		return html`
			<gl-popover class="popover" placement="bottom-end" trigger="focus" .distance=${4} .arrow=${false}>
				<gl-button class="trigger" appearance="toolbar" slot="anchor"
					><code-icon icon="chevron-down"></code-icon
				></gl-button>
				<div slot="content">
					${repeat(this.options, item => {
						if (item.selected) {
							return nothing;
						}
						const label = this.getLabel(item);
						return html`<menu-item class="option" @click=${() => this.onChange(item)}
							><code-icon icon="repo"></code-icon> ${label}</menu-item
						>`;
					})}
				</div>
			</gl-popover>
		`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		[activeWorkTagName]: GlActiveWork;
		'gl-change-repo': GlChangeRepo;
	}
}

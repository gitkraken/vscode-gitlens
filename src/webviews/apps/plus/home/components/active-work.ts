import { consume } from '@lit/context';
import { SignalWatcher } from '@lit-labs/signals';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { when } from 'lit/directives/when.js';
import { createCommandLink } from '../../../../../system/commands';
import { createWebviewCommandLink } from '../../../../../system/webview';
import type { GetOverviewBranch, OpenInGraphParams, State } from '../../../../home/protocol';
import { stateContext } from '../../../home/context';
import { ipcContext } from '../../../shared/context';
import { getReferenceLabel } from '../../../shared/git-utils';
import type { HostIpc } from '../../../shared/ipc';
import { linkStyles } from '../../shared/components/vscode.css';
import { branchCardStyles, GlBranchCardBase } from './branch-card';
import type { Overview, OverviewState } from './overviewState';
import { overviewStateContext } from './overviewState';
import '../../../shared/components/button';
import '../../../shared/components/code-icon';
import '../../../shared/components/skeleton-loader';
import '../../../shared/components/card/card';
import '../../../shared/components/commit/commit-stats';
import '../../../shared/components/menu/menu-item';
import '../../../shared/components/overlays/popover';
import '../../../shared/components/overlays/tooltip';
import '../../../shared/components/pills/tracking';
import '../../../shared/components/rich/issue-icon';
import '../../../shared/components/rich/pr-icon';

export const activeWorkTagName = 'gl-active-work';

@customElement(activeWorkTagName)
export class GlActiveWork extends SignalWatcher(LitElement) {
	static override styles = [
		linkStyles,
		branchCardStyles,
		css`
			[hidden] {
				display: none;
			}
			:host {
				display: block;
				margin-bottom: 2.4rem;
				color: var(--vscode-foreground);
			}
			.section-heading-action {
				--button-padding: 0.1rem 0.2rem 0;
				margin-block: -1rem;
			}
			.section-heading-provider {
				color: inherit;
			}
			.tooltip {
				text-transform: none;
			}
		`,
	];

	@consume<State>({ context: stateContext, subscribe: true })
	@state()
	private _homeState!: State;

	@consume({ context: overviewStateContext })
	private _overviewState!: OverviewState;

	@consume({ context: ipcContext })
	private _ipc!: HostIpc;

	override connectedCallback() {
		super.connectedCallback();

		if (this._homeState.repositories.openCount > 0) {
			this._overviewState.run();
		}
	}

	override render() {
		if (this._homeState.discovering) {
			return this.renderLoader();
		}

		if (this._homeState.repositories.openCount === 0) {
			return nothing;
		}

		return this._overviewState.render({
			pending: () => this.renderPending(),
			complete: overview => this.renderComplete(overview),
			error: () => html`<span>Error</span>`,
		});
	}

	private renderLoader() {
		return html`
			<gl-section>
				<skeleton-loader slot="heading" lines="1"></skeleton-loader>
				<skeleton-loader lines="3"></skeleton-loader>
			</gl-section>
		`;
	}

	private renderPending() {
		if (this._overviewState.state == null) {
			return this.renderLoader();
		}
		return this.renderComplete(this._overviewState.state, true);
	}

	private renderComplete(overview: Overview, isFetching = false) {
		const repo = overview?.repository;
		const activeBranches = repo?.branches?.active;
		if (!activeBranches) return html`<span>None</span>`;

		return html`
			<gl-section ?loading=${isFetching}>
				<span slot="heading">${this.renderRepositoryIcon(repo.provider)} ${repo.name}</span>
				<span slot="heading-actions"
					><gl-button
						aria-busy="${ifDefined(isFetching)}"
						?disabled=${isFetching}
						class="section-heading-action"
						appearance="toolbar"
						tooltip="Open in Commit Graph"
						href=${createCommandLink('gitlens.home.openInGraph', {
							type: 'repo',
							repoPath: this._overviewState.state!.repository.path,
						} satisfies OpenInGraphParams)}
						><code-icon icon="gl-graph"></code-icon
					></gl-button>
					<gl-button
						aria-busy="${ifDefined(isFetching)}"
						?disabled=${isFetching}
						class="section-heading-action"
						appearance="toolbar"
						tooltip="Fetch"
						href=${createCommandLink('gitlens.home.fetch', undefined)}
						><code-icon icon="repo-fetch"></code-icon
					></gl-button>
					${when(
						this._homeState.repositories.openCount > 1,
						() =>
							html`<gl-button
								aria-busy="${ifDefined(isFetching)}"
								?disabled=${isFetching}
								class="section-heading-action"
								appearance="toolbar"
								tooltip="Change Repository"
								@click=${(e: MouseEvent) => this.onChange(e)}
								><code-icon icon="chevron-down"></code-icon
							></gl-button>`,
					)}</span
				>
				${activeBranches.map(branch => {
					return this.renderRepoBranchCard(branch, repo.path, isFetching);
				})}
			</gl-section>
		`;
	}

	private renderRepositoryIcon(provider?: { name: string; icon?: string; url?: string }) {
		if (!provider) {
			return html`<code-icon icon="repo" class="heading-icon"></code-icon>`;
		}

		let icon = 'repo';
		if (provider.icon != null) {
			icon = provider.icon === 'cloud' ? 'cloud' : `gl-provider-${provider.icon}`;
		}

		return html`<gl-tooltip>
			${when(
				provider.url != null,
				() =>
					html`<a href=${provider.url!} class="section-heading-provider"
						><code-icon icon=${icon} class="heading-icon"></code-icon
					></a>`,
				() => html`<code-icon icon=${icon} class="heading-icon"></code-icon>`,
			)}
			<span slot="content" class="tooltip">Open repository on ${provider.name}</span>
		</gl-tooltip>`;
	}

	private renderRepoBranchCard(branch: GetOverviewBranch, repo: string, isFetching: boolean) {
		return html`<gl-active-branch-card
			.branch=${branch}
			.repo=${repo}
			?busy=${isFetching}
		></gl-active-branch-card>`;
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

@customElement('gl-active-branch-card')
export class GlActiveBranchCard extends GlBranchCardBase {
	override connectedCallback(): void {
		super.connectedCallback();

		this.toggleExpanded(true);
	}

	override render() {
		return html` ${this.renderBranchItem()} ${this.renderPrItem()} ${this.renderAutolinksItem()} `;
	}

	render_old() {
		const { name, pr } = this.branch;

		return html`
			<gl-card class="branch-item" .indicator=${this.cardIndicator}>
				<div class="branch-item__container">
					${this.renderBranchIndicator()}
					<div class="branch-item__section">
						<p class="branch-item__grouping">
							<span class="branch-item__icon">
								<code-icon
									icon=${this.branch.worktree ? 'gl-worktrees-view' : 'git-branch'}
								></code-icon>
							</span>
							<span class="branch-item__name">${name}</span>
						</p>
					</div>
					${this.renderBranchStateActions()}
					${when(pr, pr => {
						return html`<div class="branch-item__section">
							<p class="branch-item__grouping">
								<span class="branch-item__icon">
									<pr-icon state=${pr.state} pr-id=${pr.id}></pr-icon>
								</span>
								<a href=${pr.url} class="branch-item__name">${pr.title}</a>
								<span class="branch-item__identifier">#${pr.id}</span>
							</p>
						</div>`;
					})}
					${this.renderAutolinks()}${this.renderStatus()}
				</div>
				${this.renderActions()}
			</gl-card>
		`;
	}

	private renderBranchStateActions() {
		const { state, upstream } = this.branch;
		const isFetching = this.busy;

		if (upstream?.missing !== false) {
			const publishTooltip = upstream?.name ? `Publish branch to ${upstream.name}` : 'Publish branch';
			return html`<div>
				<button-container>
					<gl-button
						aria-busy=${ifDefined(isFetching)}
						?disabled=${isFetching}
						href=${createWebviewCommandLink('gitlens.views.home.publishBranch', 'gitlens.views.home', '')}
						full
						appearance="secondary"
						tooltip="${publishTooltip}"
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
							aria-busy=${ifDefined(isFetching)}
							?disabled=${isFetching}
							href=${createWebviewCommandLink('gitlens.views.home.pull', 'gitlens.views.home', '')}
							full
							appearance="secondary"
							tooltip=${pullTooltip}
							><code-icon icon="repo-pull" slot="prefix"></code-icon> Pull
							<gl-tracking-pill
								.ahead=${state.ahead}
								.behind=${state.behind}
								slot="suffix"
							></gl-tracking-pill
						></gl-button>
						<gl-button
							aria-busy=${ifDefined(isFetching)}
							?disabled=${isFetching}
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
							aria-busy=${ifDefined(isFetching)}
							?disabled=${isFetching}
							href=${createWebviewCommandLink('gitlens.views.home.pull', 'gitlens.views.home', '')}
							full
							appearance="secondary"
							tooltip=${tooltip}
							><code-icon icon="repo-pull" slot="prefix"></code-icon> Pull
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
							aria-busy=${ifDefined(isFetching)}
							?disabled=${isFetching}
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

	private renderStatus() {
		const { workingTreeState } = this.branch;

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

		if (rendered.length) {
			return html`<p class="branch-item__section branch-item__section--details">${rendered}</p>`;
		}

		return nothing;
	}

	private renderBranchIndicator() {
		const branch = this.branch;

		if (branch.mergeStatus == null && branch.rebaseStatus == null) {
			return nothing;
		}

		const modifier = branch.hasConflicts ? ' has-conflicts' : '';

		let content;
		if (branch.mergeStatus != null) {
			content = html`${branch.hasConflicts ? 'Resolve conflicts before merging' : 'Merging'}
			${branch.mergeStatus.incoming != null
				? `${getReferenceLabel(branch.mergeStatus.incoming, { expand: false, icon: false })} `
				: ''}into
			${getReferenceLabel(branch.mergeStatus.current, { expand: false, icon: false })}`;
		} else if (branch.rebaseStatus != null) {
			const started = branch.rebaseStatus.steps.total > 0;
			content = html`${branch.hasConflicts
				? 'Resolve conflicts to continue rebasing'
				: started
				  ? 'Rebasing'
				  : 'Pending rebase of'}
			${branch.rebaseStatus.incoming != null
				? getReferenceLabel(branch.rebaseStatus.incoming, { expand: false, icon: false })
				: ''}
			onto
			${getReferenceLabel(branch.rebaseStatus.current ?? branch.rebaseStatus.onto, {
				expand: false,
				icon: false,
			})}${started ? ` (${branch.rebaseStatus.steps.current.number}/${branch.rebaseStatus.steps.total})` : ''}`;
		}

		return html`
			<div class="branch-item__section">
				<p class="branch-item__grouping branch-item__grouping--mergingRebasing${modifier}">
					<span class="branch-item__icon">
						<code-icon icon="warning" class="branch-item__indicator${modifier}"></code-icon>
					</span>
					<span class="branch-item__name">${content}</span>
				</p>
			</div>
		`;
	}

	protected getActions() {
		const actions = [];

		if (this.branch.pr) {
			actions.push(
				html`<action-item
					label="Open Pull Request Changes"
					icon="request-changes"
					href=${this.createCommandLink('gitlens.home.openPullRequestChanges')}
				></action-item>`,
			);
			actions.push(
				html`<action-item
					label="Open Pull Request on Remote"
					icon="globe"
					href=${this.createCommandLink('gitlens.home.openPullRequestOnRemote')}
				></action-item>`,
			);
		} else if (this.branch.upstream?.missing === false) {
			actions.push(
				html`<action-item
					label="Create Pull Request..."
					icon="git-pull-request-create"
					href=${this.createCommandLink('gitlens.home.createPullRequest')}
				></action-item>`,
			);
		}

		return actions;
	}
}

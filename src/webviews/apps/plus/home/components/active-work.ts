import { consume } from '@lit/context';
import { SignalWatcher } from '@lit-labs/signals';
import type { TemplateResult } from 'lit';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { isSubscriptionTrialOrPaidFromState } from '../../../../../plus/gk/utils/subscription.utils';
import type { AssociateIssueWithBranchCommandArgs } from '../../../../../plus/startWork/startWork';
import { createCommandLink } from '../../../../../system/commands';
import { createWebviewCommandLink } from '../../../../../system/webview';
import type {
	GetActiveOverviewResponse,
	GetOverviewBranch,
	OpenInGraphParams,
	OpenInTimelineParams,
	State,
} from '../../../../home/protocol';
import { ExecuteCommand } from '../../../../protocol';
import { stateContext } from '../../../home/context';
import type { RepoButtonGroupClickEvent } from '../../../shared/components/repo-button-group';
import { ipcContext } from '../../../shared/contexts/ipc';
import { linkStyles, ruleStyles } from '../../shared/components/vscode.css';
import { branchCardStyles, GlBranchCardBase } from './branch-card';
import type { ActiveOverviewState } from './overviewState';
import { activeOverviewStateContext } from './overviewState';
import '../../../shared/components/breadcrumbs';
import '../../../shared/components/button';
import '../../../shared/components/code-icon';
import '../../../shared/components/skeleton-loader';
import '../../../shared/components/card/card';
import '../../../shared/components/commit/commit-stats';
import '../../../shared/components/menu/menu-item';
import '../../../shared/components/menu/menu-label';
import '../../../shared/components/overlays/popover';
import '../../../shared/components/pills/tracking';
import '../../../shared/components/ref-button';
import '../../../shared/components/repo-button-group';
import '../../../shared/components/rich/issue-icon';
import '../../../shared/components/rich/pr-icon';
import '../../shared/components/merge-rebase-status';

export const activeWorkTagName = 'gl-active-work';

@customElement(activeWorkTagName)
export class GlActiveWork extends SignalWatcher(LitElement) {
	static override styles = [
		linkStyles,
		branchCardStyles,
		ruleStyles,
		css`
			[hidden] {
				display: none;
			}

			:host {
				display: block;
				margin-bottom: 2.4rem;
				color: var(--vscode-foreground);
			}

			gl-repo-button-group {
				text-transform: none;
			}

			gl-section::part(header) {
				margin-block-end: 0.2rem;
			}

			.section-heading-actions {
				flex: none;
				display: flex;
				align-items: center;
			}

			.section-heading-action {
				--button-padding: 0.2rem;
				--button-line-height: 1.2rem;
				/* margin-block: -1rem; */
			}

			.section-heading-provider {
				color: inherit;
			}

			.tooltip {
				text-transform: none;
			}

			.uppercase {
				text-transform: uppercase;
			}

			gl-breadcrumbs {
				--gl-tooltip-text-transform: none;
			}

			.heading-branch-breadcrumb {
				text-transform: none;
			}
		`,
	];

	@consume<State>({ context: stateContext, subscribe: true })
	@state()
	private _homeState!: State;

	@consume({ context: activeOverviewStateContext })
	private _activeOverviewState!: ActiveOverviewState;

	@consume({ context: ipcContext })
	private _ipc!: typeof ipcContext.__context__;

	@state()
	private repoCollapsed = true;

	get isPro() {
		return isSubscriptionTrialOrPaidFromState(this._homeState.subscription.state);
	}

	override connectedCallback(): void {
		super.connectedCallback?.();

		if (this._homeState.repositories.openCount > 0) {
			this._activeOverviewState.run();
		}
	}

	private onBranchSelectorClicked() {
		this._ipc.sendCommand(ExecuteCommand, {
			command: 'gitlens.home.switchToBranch',
			args: [{ repoPath: this._activeOverviewState.state?.active.repoPath }],
		});
	}

	override render(): unknown {
		if (this._homeState.discovering) {
			return this.renderLoader();
		}

		if (this._homeState.repositories.openCount === 0) {
			return nothing;
		}

		return this._activeOverviewState.render({
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
		if (this._activeOverviewState.state == null) {
			return this.renderLoader();
		}
		return this.renderComplete(this._activeOverviewState.state, true);
	}

	private renderComplete(overview: GetActiveOverviewResponse, isFetching = false) {
		const repo = overview?.repository;
		const activeBranch = overview?.active;
		if (!repo || !activeBranch) return html`<span>None</span>`;
		const hasMultipleRepositories = this._homeState.repositories.openCount > 1;

		return html`
			<gl-section ?loading=${isFetching}>
				<gl-breadcrumbs slot="heading">
					<gl-breadcrumb-item collapsibleState="none" class="heading-repo-breadcrumb"
						><gl-repo-button-group
							.repository=${repo}
							?disabled=${!hasMultipleRepositories}
							?hasMultipleRepositories=${hasMultipleRepositories}
							.source=${{ source: 'graph' } as const}
							?expandable=${true}
							@gl-click=${this.onRepositorySelectorClicked}
							><span slot="tooltip">
								Switch to Another Repository...
								<hr />
								${repo.name}
							</span></gl-repo-button-group
						></gl-breadcrumb-item
					>
					<gl-breadcrumb-item collapsibleState="none" icon="git-branch" class="heading-branch-breadcrumb"
						><gl-ref-button .ref=${activeBranch.reference} @click=${this.onBranchSelectorClicked}
							><span slot="tooltip">Switch to Another Branch... </span></gl-ref-button
						></gl-breadcrumb-item
					>
				</gl-breadcrumbs>
				<span class="section-heading-actions" slot="heading-actions">
					<gl-button
						aria-busy="${ifDefined(isFetching)}"
						?disabled=${isFetching}
						class="section-heading-action"
						appearance="toolbar"
						tooltip="Fetch All"
						href=${createCommandLink('gitlens.home.fetch', undefined)}
						><code-icon icon="repo-fetch"></code-icon
					></gl-button>
					<gl-button
						aria-busy="${ifDefined(isFetching)}"
						?disabled=${isFetching}
						class="section-heading-action"
						appearance="toolbar"
						tooltip="Visualize Repo History"
						href=${createCommandLink('gitlens.visualizeHistory.repo:home', {
							type: 'repo',
							repoPath: this._activeOverviewState.state!.repository.path,
						} satisfies OpenInTimelineParams)}
						><code-icon icon="graph-scatter"></code-icon></gl-button
					><gl-button
						aria-busy="${ifDefined(isFetching)}"
						?disabled=${isFetching}
						class="section-heading-action"
						appearance="toolbar"
						tooltip="Open in Commit Graph"
						href=${createCommandLink('gitlens.home.openInGraph', {
							type: 'repo',
							repoPath: this._activeOverviewState.state!.repository.path,
						} satisfies OpenInGraphParams)}
						><code-icon icon="gl-graph"></code-icon
					></gl-button>
				</span>
				${this.renderRepoBranchCard(activeBranch, repo.path, isFetching)}
			</gl-section>
		`;
	}

	private renderRepoBranchCard(branch: GetOverviewBranch, repo: string, isFetching: boolean) {
		return html`<gl-active-branch-card
			.branch=${branch}
			.repo=${repo}
			?busy=${isFetching}
			?showUpgrade=${!this.isPro}
		></gl-active-branch-card>`;
	}

	private onRepositorySelectorClicked(e: CustomEvent<RepoButtonGroupClickEvent>) {
		if (e.detail.part === 'label') {
			this._activeOverviewState.changeRepository();
		}
	}
}

declare global {
	interface HTMLElementTagNameMap {
		[activeWorkTagName]: GlActiveWork;
	}
}

@customElement('gl-active-branch-card')
export class GlActiveBranchCard extends GlBranchCardBase {
	static override styles = [
		linkStyles,
		branchCardStyles,
		css`
			:host {
				display: flex;
				flex-direction: column;
				gap: 0.8rem;
			}

			span.branch-item__missing {
				color: var(--vscode-descriptionForeground);
				font-style: italic;
			}

			gl-work-item {
				--gl-card-vertical-padding: 0.4rem;
			}

			.associate-issue-action {
				--button-padding: 0.2rem;
				--button-line-height: 1.2rem;
			}
		`,
	];

	override connectedCallback(): void {
		super.connectedCallback?.();

		this.toggleExpanded(true);
	}

	override render(): unknown {
		return html`
			${this.renderBranchIndicator()}${this.renderIssuesItem()}${this.renderBranchItem(
				html`${this.renderBranchStateActions()}${this.renderBranchActions()}`,
			)}${this.renderPrItem()}
		`;
	}

	private renderActionsMenu() {
		const aiEnabled = this._homeState.orgSettings.ai && this._homeState.aiEnabled;
		const isFetching = this.busy;
		const workingTreeState = this.wip?.workingTreeState;
		const hasWip =
			workingTreeState != null &&
			workingTreeState.added + workingTreeState.changed + workingTreeState.deleted > 0;

		const actions = [];
		if (aiEnabled) {
			if (hasWip) {
				actions.push(
					html`<menu-item
						?disabled=${isFetching}
						href=${this.createCommandLink('gitlens.ai.generateCommits:home')}
						>Generate Commits with AI (Preview)</menu-item
					>`,
				);
				actions.push(
					html`<menu-item
						?disabled=${isFetching}
						href=${this.createCommandLink('gitlens.ai.composeCommits:home')}
						>Compose Commits with AI (Preview)</menu-item
					>`,
				);
				actions.push(
					html`<menu-item ?disabled=${isFetching} href=${this.createCommandLink('gitlens.ai.explainWip:home')}
						>Explain Working Changes (Preview)</menu-item
					>`,
				);
			}

			actions.push(
				html`<menu-item ?disabled=${isFetching} href=${this.createCommandLink('gitlens.ai.explainBranch:home')}
					>Explain Branch Changes (Preview)</menu-item
				>`,
			);

			if (hasWip) {
				actions.push(
					html`<menu-item
						?disabled=${isFetching}
						href=${this.createCommandLink('gitlens.home.createCloudPatch')}
						>Share as Cloud Patch</menu-item
					>`,
				);
			}
		} else if (hasWip) {
			return html`
				<gl-button
					aria-busy=${ifDefined(isFetching)}
					?disabled=${isFetching}
					href=${this.createCommandLink('gitlens.home.createCloudPatch')}
					appearance="secondary"
					tooltip="Share as Cloud Patch"
					><code-icon icon="gl-cloud-patch-share"></code-icon>
				</gl-button>
			`;
		}

		if (actions.length === 0) return undefined;

		return html`<gl-popover
			appearance="menu"
			trigger="click focus"
			placement="bottom-end"
			.arrow=${false}
			distance="0"
		>
			<gl-button slot="anchor" appearance="toolbar" tooltipPlacement="top" aria-label="Additional Actions">
				<code-icon icon="ellipsis"></code-icon>
			</gl-button>
			<div slot="content">
				<menu-label>Actions</menu-label>
				${actions}
			</div>
		</gl-popover>`;
	}

	private renderBranchStateActions() {
		const { name, upstream } = this.branch;

		const actions: TemplateResult[] = [];

		const wrappedActions = () => {
			if (actions.length === 0) return this.renderActionsMenu();
			return html`<div><button-container>${actions}${this.renderActionsMenu()}</button-container></div>`;
		};

		const isFetching = this.busy;
		const workingTreeState = this.wip?.workingTreeState;
		const hasWip =
			workingTreeState != null &&
			workingTreeState.added + workingTreeState.changed + workingTreeState.deleted > 0;

		if (hasWip) {
			if (this._homeState.orgSettings.ai && this._homeState.aiEnabled) {
				actions.push(html`
					<gl-button
						aria-busy=${ifDefined(isFetching)}
						?disabled=${isFetching}
						href=${this.createCommandLink('gitlens.ai.generateCommitMessage', {
							repoPath: this.repo,
							source: 'home',
						})}
						appearance="secondary"
						tooltip="Generate Message &amp; Commit via SCM..."
						><code-icon icon="sparkle" slot="prefix"></code-icon>Commit
					</gl-button>
				`);
			} else {
				actions.push(html`
					<gl-button
						aria-busy=${ifDefined(isFetching)}
						?disabled=${isFetching}
						href="command:workbench.view.scm"
						appearance="secondary"
						tooltip="Commit via SCM"
						><code-icon rotate="45" icon="arrow-up" slot="suffix"></code-icon>Commit
					</gl-button>
				`);
			}
		}

		if (this.wip?.pausedOpStatus != null) {
			return wrappedActions();
		}

		if (upstream?.missing !== false) {
			// TODO: Upstream will never exist here -- we need to look at remotes
			actions.push(html`
				<gl-button
					aria-busy=${ifDefined(isFetching)}
					?disabled=${isFetching}
					href=${this.createWebviewCommandLink('gitlens.views.home.publishBranch')}
					full
					appearance="secondary"
					><code-icon icon="cloud-upload" slot="prefix"></code-icon> Publish Branch<span slot="tooltip"
						>Publish (push) <strong>${name}</strong> to ${upstream?.name ?? 'a remote'}</span
					></gl-button
				>
			`);

			return wrappedActions();
		}

		if (upstream?.state?.ahead || upstream?.state?.behind) {
			const isAhead = Boolean(upstream.state.ahead);
			const isBehind = Boolean(upstream.state.behind);
			if (isAhead && isBehind) {
				const pullTooltip = upstream?.name ? `Pull from ${upstream.name}` : 'Pull';
				const forcePushTooltip = upstream?.name ? `Force Push to ${upstream.name}` : 'Force Push';
				actions.push(html`
					<gl-button
						aria-busy=${ifDefined(isFetching)}
						?disabled=${isFetching}
						href=${createWebviewCommandLink('gitlens.views.home.pull', 'gitlens.views.home', '')}
						full
						appearance="secondary"
						tooltip=${pullTooltip}
						><code-icon icon="repo-pull" slot="prefix"></code-icon> Pull
						<gl-tracking-pill
							.ahead=${upstream.state.ahead}
							.behind=${upstream.state.behind}
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
				`);

				return wrappedActions();
			}

			if (isBehind) {
				const tooltip = upstream?.name ? `Pull from ${upstream.name}` : 'Pull';
				actions.push(html`
					<gl-button
						aria-busy=${ifDefined(isFetching)}
						?disabled=${isFetching}
						href=${createWebviewCommandLink('gitlens.views.home.pull', 'gitlens.views.home', '')}
						full
						appearance="secondary"
						tooltip=${tooltip}
						><code-icon icon="repo-pull" slot="prefix"></code-icon> Pull
						<gl-tracking-pill
							.ahead=${upstream.state.ahead}
							.behind=${upstream.state.behind}
							slot="suffix"
						></gl-tracking-pill
					></gl-button>
				`);

				return wrappedActions();
			}

			if (isAhead) {
				const tooltip = upstream?.name ? `Push to ${upstream.name}` : 'Push';
				actions.push(html`
					<gl-button
						aria-busy=${ifDefined(isFetching)}
						?disabled=${isFetching}
						href=${createWebviewCommandLink('gitlens.views.home.push', 'gitlens.views.home', '')}
						full
						appearance="secondary"
						tooltip=${tooltip}
						><code-icon icon="repo-push" slot="prefix"></code-icon> Push
						<gl-tracking-pill
							.ahead=${upstream.state.ahead}
							.behind=${upstream.state.behind}
							slot="suffix"
						></gl-tracking-pill>
					</gl-button>
				`);

				return wrappedActions();
			}
		}

		return wrappedActions();
	}

	protected renderBranchIndicator(): TemplateResult | undefined {
		const wip = this.wip;
		if (wip?.pausedOpStatus == null) return undefined;

		return html`<gl-merge-rebase-status
			?conflicts=${wip.hasConflicts}
			.pausedOpStatus=${wip.pausedOpStatus}
		></gl-merge-rebase-status>`;
	}

	protected getBranchActions(): TemplateResult[] {
		return [];
	}

	protected getPrActions(): TemplateResult[] {
		return [
			html`<action-item
				label="Open Pull Request Changes"
				icon="request-changes"
				href=${this.createCommandLink('gitlens.home.openPullRequestChanges')}
			></action-item>`,
			html`<action-item
				label="Compare Pull Request"
				icon="git-compare"
				href=${this.createCommandLink('gitlens.home.openPullRequestComparison')}
			></action-item>`,
			html`<action-item
				label="Open Pull Request Details"
				icon="eye"
				href=${this.createCommandLink('gitlens.home.openPullRequestDetails')}
			></action-item>`,
		];
	}

	protected getCollapsedActions(): TemplateResult[] {
		return [];
	}

	protected override renderIssuesItem(): TemplateResult | NothingType {
		const issues = [...(this.issues ?? []), ...(this.autolinks ?? [])];
		if (!issues.length) {
			if (!this.expanded) return nothing;

			return html`<div class="branch-item__row" full>
				<span class="branch-item__missing" full>Current work item</span>
				<gl-button
					class="associate-issue-action"
					appearance="toolbar"
					href=${this.createCommandLink<AssociateIssueWithBranchCommandArgs>(
						'gitlens.associateIssueWithBranch',
						{
							branch: this.branch.reference,
							source: 'home',
						},
					)}
					tooltip="Associate Issue with Branch"
					aria-label="Associate Issue with Branch"
					><issue-icon></issue-icon>
				</gl-button>
			</div>`;
		}
		return super.renderIssuesItem();
	}
}

type NothingType = typeof nothing;

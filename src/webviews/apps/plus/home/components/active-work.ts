import { consume } from '@lit/context';
import { SignalWatcher } from '@lit-labs/signals';
import type { TemplateResult } from 'lit';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { isSubscriptionTrialOrPaidFromState } from '../../../../../plus/gk/utils/subscription.utils.js';
import type { AssociateIssueWithBranchCommandArgs } from '../../../../../plus/startWork/associateIssueWithBranch.js';
import { createCommandLink } from '../../../../../system/commands.js';
import type {
	GetActiveOverviewResponse,
	GetOverviewBranch,
	OpenInGraphParams,
	OpenInTimelineParams,
} from '../../../../home/protocol.js';
import type { HomeState } from '../../../home/state.js';
import { homeStateContext } from '../../../home/state.js';
import type { RepoButtonGroupClickEvent } from '../../../shared/components/repo-button-group.js';
import type { CommandsState } from '../../../shared/contexts/commands.js';
import { commandsContext } from '../../../shared/contexts/commands.js';
import type { SubscriptionContextState } from '../../../shared/contexts/subscription.js';
import { subscriptionContext } from '../../../shared/contexts/subscription.js';
import type { WebviewContext } from '../../../shared/contexts/webview.js';
import { webviewContext } from '../../../shared/contexts/webview.js';
import { linkStyles, ruleStyles } from '../../shared/components/vscode.css.js';
import { branchCardStyles, GlBranchCardBase } from './branch-card.js';
import type { ActiveOverviewState } from './overviewState.js';
import { activeOverviewStateContext } from './overviewState.js';
import '../../../shared/components/breadcrumbs.js';
import '../../../shared/components/button.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/skeleton-loader.js';
import '../../../shared/components/card/card.js';
import '../../../shared/components/commit/commit-stats.js';
import '../../../shared/components/menu/menu-divider.js';
import '../../../shared/components/menu/menu-item.js';
import '../../../shared/components/menu/menu-label.js';
import '../../../shared/components/overlays/popover.js';
import '../../../shared/components/pills/tracking.js';
import '../../../shared/components/ref-button.js';
import '../../../shared/components/repo-button-group.js';
import '../../../shared/components/rich/issue-icon.js';
import '../../../shared/components/rich/pr-icon.js';
import '../../shared/components/merge-rebase-status.js';

export const activeWorkTagName = 'gl-active-work';

@customElement(activeWorkTagName)
export class GlActiveWork extends SignalWatcher(LitElement) {
	@consume({ context: subscriptionContext, subscribe: true })
	private _subscription!: SubscriptionContextState;

	@consume({ context: homeStateContext })
	private _homeCtx!: HomeState;

	@consume({ context: commandsContext })
	private _commands!: CommandsState;

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

	@consume({ context: activeOverviewStateContext })
	private _activeOverviewState!: ActiveOverviewState;

	@consume({ context: webviewContext })
	private _webview!: WebviewContext;

	@state()
	private repoCollapsed = true;

	get isPro() {
		const sub = this._subscription.subscription.get();
		return sub != null && isSubscriptionTrialOrPaidFromState(sub.state);
	}

	override connectedCallback(): void {
		super.connectedCallback?.();

		if (this._homeCtx.repositories.get().openCount > 0) {
			this._activeOverviewState.fetch();
		}
	}

	private onBranchSelectorClicked() {
		void this._commands.service?.executeScoped('gitlens.switchToBranch:home', {
			repoPath: this._activeOverviewState.value.get()?.active[0]?.repoPath,
		});
	}

	override render(): unknown {
		if (this._homeCtx.discovering.get()) {
			return this.renderLoader();
		}

		if (this._homeCtx.repositories.get().openCount === 0) {
			return nothing;
		}

		if (this._activeOverviewState.error.get() != null) {
			return html`
				<gl-section>
					<span slot="heading">Active Branch</span>
					<span
						>Unable to load branch data.
						<a
							href="#"
							@click=${(e: Event) => {
								e.preventDefault();
								this._activeOverviewState.fetch();
							}}
							>Retry</a
						>
					</span>
				</gl-section>
			`;
		}

		const overview = this._activeOverviewState.value.get();
		if (overview == null) {
			return this.renderLoader();
		}

		return this.renderComplete(overview, this._activeOverviewState.loading.get());
	}

	private renderLoader() {
		return html`
			<gl-section>
				<skeleton-loader slot="heading" lines="1"></skeleton-loader>
				<skeleton-loader lines="3"></skeleton-loader>
			</gl-section>
		`;
	}

	private renderComplete(overview: GetActiveOverviewResponse, isFetching = false) {
		const repo = overview?.repository;
		const activeBranches = overview?.active;
		if (!repo || !activeBranches?.length) return html`<span>None</span>`;
		const hasMultipleRepositories = this._homeCtx.repositories.get().openCount > 1;
		const primaryBranch = activeBranches[0];

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
						><gl-ref-button .ref=${primaryBranch.reference} @click=${this.onBranchSelectorClicked}
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
						href=${this._webview.createCommandLink('gitlens.fetch:')}
						><code-icon icon="repo-fetch"></code-icon
					></gl-button>
					<gl-button
						aria-busy="${ifDefined(isFetching)}"
						?disabled=${isFetching}
						class="section-heading-action"
						appearance="toolbar"
						tooltip="Visualize Repo History"
						href=${this._webview.createCommandLink<OpenInTimelineParams>('gitlens.visualizeHistory.repo:', {
							type: 'repo',
							repoPath: repo.path,
						})}
						><code-icon icon="graph-scatter"></code-icon></gl-button
					><gl-button
						aria-busy="${ifDefined(isFetching)}"
						?disabled=${isFetching}
						class="section-heading-action"
						appearance="toolbar"
						tooltip="Open in Commit Graph"
						href=${this._webview.createCommandLink<OpenInGraphParams>('gitlens.showInCommitGraph:', {
							type: 'repo',
							repoPath: repo.path,
						})}
						><code-icon icon="gl-graph"></code-icon
					></gl-button>
				</span>
				${activeBranches.map(branch => this.renderRepoBranchCard(branch, repo.path, isFetching))}
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
		const aiEnabled = this._subscription.orgSettings.get()?.ai && this._aiCtx.state.get().enabled;
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
						href=${createCommandLink('gitlens.ai.generateCommitMessage', {
							repoPath: this.repo,
							source: 'home',
						})}
						>Generate Commit Message</menu-item
					>`,
				);
				actions.push(html`<menu-divider></menu-divider>`);
				actions.push(
					html`<menu-item
						?disabled=${isFetching}
						href=${this.createWebviewCommandLinkWithBranchRef('gitlens.ai.explainWip:')}
						>Explain Working Changes (Preview)</menu-item
					>`,
				);
			}

			actions.push(
				html`<menu-item
					?disabled=${isFetching}
					href=${this.createWebviewCommandLinkWithBranchRef('gitlens.ai.explainBranch:')}
					>Explain Branch Changes (Preview)</menu-item
				>`,
			);

			if (hasWip) {
				actions.push(html`<menu-divider></menu-divider>`);
				actions.push(
					html`<menu-item
						?disabled=${isFetching}
						href=${this.createWebviewCommandLinkWithBranchRef('gitlens.createCloudPatch:')}
						>Share as Cloud Patch</menu-item
					>`,
				);
			}
		} else if (hasWip) {
			return html`
				<gl-button
					aria-busy=${ifDefined(isFetching)}
					?disabled=${isFetching}
					href=${this.createWebviewCommandLinkWithBranchRef('gitlens.createCloudPatch:')}
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
			<div slot="content">${actions}</div>
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
			actions.push(html`
				<gl-button
					aria-busy=${ifDefined(isFetching)}
					?disabled=${isFetching}
					href=${this.createWebviewCommandLinkWithBranchRef('gitlens.composeCommits:')}
					appearance="secondary"
					density="compact"
					><code-icon icon="wand" slot="prefix"></code-icon>Compose Commits...<span slot="tooltip"
						><strong>Compose Commits</strong> (Preview)<br /><i
							>Automatically or interactively organize changes into meaningful commits</i
						></span
					></gl-button
				>
			`);
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
					href=${this.createWebviewCommandLinkWithBranchRef('gitlens.publishBranch:')}
					appearance="secondary"
					density="compact"
				>
					<code-icon icon="cloud-upload" slot="${ifDefined(hasWip ? undefined : 'prefix')}"></code-icon>
					${hasWip ? '' : 'Publish Branch'}
					<span slot="tooltip"
						>Publish (push) <strong>${name}</strong> to ${upstream?.name ?? 'a remote'}</span
					>
				</gl-button>
			`);

			return wrappedActions();
		}

		if (upstream?.state?.ahead || upstream?.state?.behind) {
			const isAhead = Boolean(upstream.state.ahead);
			const isBehind = Boolean(upstream.state.behind);
			if (isAhead && isBehind) {
				actions.push(html`
					<gl-button
						aria-busy=${ifDefined(isFetching)}
						?disabled=${isFetching}
						href=${this._webview.createCommandLink('gitlens.pull:')}
						appearance="secondary"
						density="compact"
					>
						<code-icon icon="repo-pull" slot="${ifDefined(hasWip ? undefined : 'prefix')}"></code-icon>
						${hasWip ? '' : 'Pull'}
						<gl-tracking-pill
							.ahead=${upstream.state.ahead}
							.behind=${upstream.state.behind}
							slot="suffix"
						></gl-tracking-pill>
						<span slot="tooltip"
							>Pull${upstream?.name ? html` from <strong>${upstream.name}</strong>` : ''}</span
						>
					</gl-button>
					<gl-button
						aria-busy=${ifDefined(isFetching)}
						?disabled=${isFetching}
						href=${this._webview.createCommandLink<{ force?: boolean }>('gitlens.push:', { force: true })}
						appearance="secondary"
						density="compact"
					>
						<code-icon icon="repo-force-push"></code-icon>
						<span slot="tooltip"
							>Force Push${upstream?.name ? html` to <strong>${upstream.name}</strong>` : ''}</span
						>
					</gl-button>
				`);

				return wrappedActions();
			}

			if (isBehind) {
				actions.push(html`
					<gl-button
						aria-busy=${ifDefined(isFetching)}
						?disabled=${isFetching}
						href=${this._webview.createCommandLink('gitlens.pull:')}
						appearance="secondary"
						density="compact"
					>
						<code-icon icon="repo-pull" slot="${ifDefined(hasWip ? undefined : 'prefix')}"></code-icon>
						${hasWip ? '' : 'Pull'}
						<gl-tracking-pill
							.ahead=${upstream.state.ahead}
							.behind=${upstream.state.behind}
							slot="suffix"
						></gl-tracking-pill>
						<span slot="tooltip"
							>Pull${upstream?.name ? html` from <strong>${upstream.name}</strong>` : ''}</span
						>
					</gl-button>
				`);

				return wrappedActions();
			}

			if (isAhead) {
				actions.push(html`
					<gl-button
						aria-busy=${ifDefined(isFetching)}
						?disabled=${isFetching}
						href=${this._webview.createCommandLink('gitlens.push:')}
						appearance="secondary"
						density="compact"
					>
						<code-icon icon="repo-push" slot="prefix"></code-icon>
						${hasWip ? '' : 'Push'}
						<gl-tracking-pill
							.ahead=${upstream.state.ahead}
							.behind=${upstream.state.behind}
							slot="suffix"
						></gl-tracking-pill>
						<span slot="tooltip"
							>Push${upstream?.name ? html` to <strong>${upstream.name}</strong>` : ''}</span
						>
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
				href=${this.createWebviewCommandLinkWithBranchRef('gitlens.openPullRequestChanges:')}
			></action-item>`,
			html`<action-item
				label="Compare Pull Request"
				icon="git-compare"
				href=${this.createWebviewCommandLinkWithBranchRef('gitlens.openPullRequestComparison:')}
			></action-item>`,
			html`<action-item
				label="Open Pull Request Details"
				icon="eye"
				href=${this.createWebviewCommandLinkWithBranchRef('gitlens.openPullRequestDetails:')}
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
					href=${createCommandLink<AssociateIssueWithBranchCommandArgs>('gitlens.associateIssueWithBranch', {
						command: 'associateIssueWithBranch',
						branch: this.branch.reference,
						source: 'home',
					})}
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

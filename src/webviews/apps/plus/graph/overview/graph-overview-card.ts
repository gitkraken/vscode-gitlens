import { consume } from '@lit/context';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import { formatDate, fromNow } from '@gitlens/utils/date.js';
import { pluralize } from '@gitlens/utils/string.js';
import type { GlWebviewCommandsOrCommandsWithSuffix } from '../../../../../constants.commands.js';
import {
	launchpadCategoryToGroupMap,
	launchpadGroupIconMap,
	launchpadGroupLabelMap,
} from '../../../../../plus/launchpad/models/launchpad.js';
import type { BranchRef, OpenWorktreeCommandArgs } from '../../../../home/protocol.js';
import type {
	OverviewBranch,
	OverviewBranchEnrichment,
	OverviewBranchLaunchpadItem,
	OverviewBranchWip,
} from '../../../../shared/overviewBranches.js';
import { renderBranchName } from '../../../shared/components/branch-name.js';
import { srOnlyStyles } from '../../../shared/components/styles/lit/a11y.css.js';
import type { WebviewContext } from '../../../shared/contexts/webview.js';
import { webviewContext } from '../../../shared/contexts/webview.js';
import '../../../shared/components/branch-icon.js';
import '../../../shared/components/card/card.js';
import '../../../shared/components/card/work-item.js';
import '../../../shared/components/pills/tracking.js';
import '../../../shared/components/commit/commit-stats.js';
import '../../../shared/components/avatar/avatar-list.js';
import '../../../shared/components/rich/pr-icon.js';
import '../../../shared/components/rich/issue-icon.js';
import '../../../shared/components/overlays/tooltip.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/actions/action-item.js';
import '../../../shared/components/actions/action-nav.js';

function getBranchCardIndicator(
	branch: OverviewBranch,
	wip?: OverviewBranchWip,
	enrichment?: OverviewBranchEnrichment,
): string | undefined {
	if (branch.opened) {
		if (wip?.pausedOpStatus != null) {
			if (wip.hasConflicts) return 'conflict';
			switch (wip.pausedOpStatus.type) {
				case 'cherry-pick':
					return 'cherry-picking';
				case 'merge':
					return 'merging';
				case 'rebase':
					return 'rebasing';
				case 'revert':
					return 'reverting';
			}
		}

		const hasWip =
			wip?.workingTreeState != null &&
			wip.workingTreeState.added + wip.workingTreeState.changed + wip.workingTreeState.deleted > 0;
		if (hasWip) return 'branch-changes';

		if (enrichment?.mergeTarget?.mergedStatus?.merged) return 'branch-merged';
	}

	if (branch.upstream?.missing) return 'branch-missingUpstream';
	const state = branch.upstream?.state;
	if (state != null) {
		if (state.ahead > 0 && state.behind > 0) return 'branch-diverged';
		if (state.ahead > 0) return 'branch-ahead';
		if (state.behind > 0) return 'branch-behind';
		return 'branch-synced';
	}
	return undefined;
}

function getLaunchpadItemGroup(
	pr: OverviewBranchEnrichment['pr'],
	launchpadItem: OverviewBranchLaunchpadItem | undefined,
) {
	if (launchpadItem == null || pr?.state !== 'opened') return undefined;
	if (pr.draft && launchpadItem.category === 'unassigned-reviewers') return undefined;

	const group = launchpadCategoryToGroupMap.get(launchpadItem.category);
	if (group == null || group === 'other' || group === 'draft' || group === 'current-branch') {
		return undefined;
	}

	return group;
}

function getLaunchpadItemGrouping(group: ReturnType<typeof getLaunchpadItemGroup>) {
	switch (group) {
		case 'mergeable':
			return 'mergeable';
		case 'blocked':
			return 'blocked';
		case 'follow-up':
		case 'needs-review':
			return 'attention';
	}

	return undefined;
}

function getWipTooltipParts(workingTreeState: { added: number; changed: number; deleted: number }) {
	const parts = [];
	if (workingTreeState.added) {
		parts.push(`${pluralize('file', workingTreeState.added)} added`);
	}
	if (workingTreeState.changed) {
		parts.push(`${pluralize('file', workingTreeState.changed)} changed`);
	}
	if (workingTreeState.deleted) {
		parts.push(`${pluralize('file', workingTreeState.deleted)} deleted`);
	}
	return parts;
}

declare global {
	interface GlobalEventHandlersEventMap {
		'gl-graph-overview-branch-selected': CustomEvent<{
			branchId: string;
			branchName: string;
			mergeTargetTipSha?: string;
		}>;
		'gl-graph-overview-card-expand-toggled': CustomEvent<{ expanded: boolean }>;
	}
}

@customElement('gl-graph-overview-card')
export class GlGraphOverviewCard extends LitElement {
	static override styles = css`
		:host {
			display: block;
			--gl-card-background: color-mix(
				in lab,
				var(--color-graph-background, var(--color-background)) 100%,
				#fff 8%
			);
			--gl-card-hover-background: color-mix(
				in lab,
				var(--color-graph-background, var(--color-background)) 100%,
				#fff 12%
			);
		}

		:host-context(.vscode-light),
		:host-context(.vscode-high-contrast-light) {
			--gl-card-background: color-mix(
				in lab,
				var(--color-graph-background, var(--color-background)) 100%,
				#000 6%
			);
			--gl-card-hover-background: color-mix(
				in lab,
				var(--color-graph-background, var(--color-background)) 100%,
				#000 10%
			);
		}

		* {
			box-sizing: border-box;
		}

		gl-avatar-list {
			--gl-avatar-size: 2.4rem;
			margin-block: -0.4rem;
		}

		.branch-item {
			position: relative;
		}

		.branch-item__container {
			display: flex;
			flex-direction: column;
			gap: 0.6rem;
		}

		.branch-item__container > * {
			margin-block: 0;
		}

		.branch-item__section {
			display: flex;
			flex-direction: column;
			gap: 0.4rem;
		}

		.branch-item__section > * {
			margin-block: 0;
		}

		.branch-item__section--details {
			font-size: 0.9em;
			color: var(--vscode-descriptionForeground);
		}

		.branch-item__grouping {
			display: inline-flex;
			align-items: center;
			gap: 0.6rem;
			max-width: 100%;
			margin-block: 0;
		}

		.branch-item__icon {
			color: var(--vscode-descriptionForeground);
			flex: none;
		}

		.branch-item__name {
			flex-grow: 1;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
			font-weight: bold;
		}

		.branch-item__name--secondary {
			font-weight: normal;
			color: var(--vscode-descriptionForeground);
			text-decoration: none;
		}

		.branch-item__name--secondary:hover {
			color: var(--vscode-textLink-activeForeground);
		}

		.branch-item__identifier {
			color: var(--vscode-descriptionForeground);
			text-decoration: none;
		}

		.branch-item__changes {
			display: flex;
			align-items: center;
			gap: 1rem;
			margin-block: 0;
			flex-wrap: wrap;
			justify-content: flex-end;
		}

		.branch-item__date {
			margin-inline-end: auto;
		}

		.branch-item__actions {
			display: flex;
			align-items: center;
			gap: 0.8rem;
			flex-direction: row;
			justify-content: flex-end;
			font-size: 0.9em;
		}

		.branch-item__actions:not(:has(*)) {
			display: none;
		}

		.branch-item__collapsed-actions {
			position: absolute;
			z-index: 2;
			right: 0.4rem;
			bottom: 0.3rem;
			padding: 0.4rem 0.6rem;
			background-color: var(--gl-card-hover-background);
		}

		.branch-item:not(:focus-within):not(:hover) .branch-item__collapsed-actions {
			${srOnlyStyles}
		}

		.tracking__pill,
		.wip__pill {
			display: flex;
			flex-direction: row;
			gap: 1rem;
		}

		.tracking__tooltip,
		.wip__tooltip {
			display: contents;
			vertical-align: middle;
		}

		.tracking__tooltip p,
		.wip__tooltip p {
			margin-block: 0;
		}

		.pill {
			--gl-pill-border: color-mix(in srgb, transparent 80%, var(--color-foreground));
		}

		.launchpad-grouping--mergeable {
			color: var(--vscode-gitlens-launchpadIndicatorMergeableColor);
		}

		.launchpad-grouping--blocked {
			color: var(--vscode-gitlens-launchpadIndicatorBlockedColor);
		}

		.launchpad-grouping--attention {
			color: var(--vscode-gitlens-launchpadIndicatorAttentionColor);
		}

		.branch-item__category {
			margin-inline-start: 0.6rem;
		}

		gl-card {
			cursor: pointer;
		}

		gl-card::part(base) {
			padding: 0.6rem 0.8rem;
			margin-block-end: 0;
			border-radius: 0.4rem;
		}

		gl-card.is-scoped {
			outline: 1px solid var(--vscode-focusBorder);
		}
	`;

	@consume({ context: webviewContext })
	private _webview!: WebviewContext;

	@property({ type: Object })
	branch!: OverviewBranch;

	@property({ type: Object })
	wip?: OverviewBranchWip;

	@property({ type: Object })
	enrichment?: OverviewBranchEnrichment;

	@property({ type: Boolean, reflect: true })
	scoped = false;

	@property({ type: Boolean, reflect: true })
	expandable = false;

	@property({ type: Boolean, reflect: true })
	expanded = false;

	private eventController?: AbortController;

	override connectedCallback(): void {
		super.connectedCallback?.();
		this.attachFocusListener();
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback?.();
		this.eventController?.abort();
	}

	private attachFocusListener() {
		this.eventController?.abort();
		this.eventController = undefined;
		if (this.expandable) {
			this.eventController = new AbortController();
			this.addEventListener('focusin', this.onFocus, { signal: this.eventController.signal });
		}
	}

	private readonly onFocus = (e: FocusEvent) => {
		const actionElement = e.composedPath().some(el => (el as HTMLElement).matches?.('action-item') ?? false);
		if (actionElement || this.expanded) return;
		this.toggleExpanded(true);
	};

	get branchRef(): BranchRef {
		return {
			repoPath: this.branch.repoPath,
			branchId: this.branch.id,
			branchName: this.branch.name,
			worktree: this.branch.worktree
				? { name: this.branch.worktree.name, isDefault: this.branch.worktree.isDefault }
				: undefined,
		};
	}

	get isWorktree(): boolean {
		return this.branch.worktree != null;
	}

	private get hasWip(): boolean {
		return (
			this.wip?.workingTreeState != null &&
			this.wip.workingTreeState.added + this.wip.workingTreeState.changed + this.wip.workingTreeState.deleted > 0
		);
	}

	override render() {
		const branch = this.branch;
		if (branch == null) return nothing;

		const branchIndicator = getBranchCardIndicator(this.branch, this.wip, this.enrichment);

		return html`
			<gl-card
				class="branch-item ${this.scoped ? 'is-scoped' : ''}"
				focusable
				.indicator=${branchIndicator}
				@click=${this.onCardClick}
				@keydown=${this.onCardKeydown}
			>
				<div class="branch-item__container">
					${this.renderBranchItem()} ${this.renderPrItem()} ${this.renderIssuesItem()}
				</div>
				${this.renderCollapsedActions()}
			</gl-card>
		`;
	}

	private renderBranchItem() {
		const wip = this.renderWip();
		const tracking = this.renderTracking();
		const avatars = this.renderAvatars();
		const timestamp = this.renderTimestamp();

		return html`
			<gl-work-item ?expanded=${this.expanded}>
				<div class="branch-item__section">
					<p class="branch-item__grouping">
						<span class="branch-item__icon">${this.renderBranchIcon()}</span>
						<span class="branch-item__name">${this.branch.name}</span>
					</p>
				</div>
				${when(
					timestamp || wip || tracking || avatars,
					() => html`
						<div class="branch-item__section branch-item__section--details" slot="context">
							<p class="branch-item__changes">${timestamp}${wip}${tracking}${avatars}</p>
						</div>
					`,
				)}
				${when(
					this.expanded,
					() => html`<div class="branch-item__actions" slot="actions">${this.renderBranchActions()}</div>`,
				)}
				<span class="branch-item__changes" slot="summary">${this.renderTracking()}${avatars}</span>
			</gl-work-item>
		`;
	}

	private renderBranchIcon() {
		return html`<gl-branch-icon
			branch="${this.branch.name}"
			status="${this.branch.status}"
			?hasChanges=${this.hasWip}
			upstream=${this.branch.upstream?.name ?? ''}
			?worktree=${this.branch.worktree != null}
			?is-default=${this.branch.worktree?.isDefault ?? false}
		></gl-branch-icon>`;
	}

	private renderTracking() {
		if (this.branch.upstream == null) return nothing;

		const { state } = this.branch.upstream;

		let tooltip;
		if (this.branch.upstream.missing) {
			tooltip = html`${renderBranchName(this.branch.name)} is missing its upstream
			${renderBranchName(this.branch.upstream.name)}`;
		} else {
			const status: string[] = [];
			if (state.behind) {
				status.push(`${pluralize('commit', state.behind)} behind`);
			}
			if (state.ahead) {
				status.push(`${pluralize('commit', state.ahead)} ahead of`);
			}
			if (status.length) {
				tooltip = html`${renderBranchName(this.branch.name)} is ${status.join(', ')}
				${renderBranchName(this.branch.upstream.name)}`;
			} else {
				tooltip = html`${renderBranchName(this.branch.name)} is up to date with
				${renderBranchName(this.branch.upstream.name)}`;
			}
		}

		return html`<gl-tooltip class="tracking__pill" placement="bottom"
			><gl-tracking-pill
				class="pill"
				colorized
				outlined
				always-show
				ahead=${state.ahead}
				behind=${state.behind}
				?missingUpstream=${this.branch.upstream.missing ?? false}
			></gl-tracking-pill>
			<span class="tracking__tooltip" slot="content">${tooltip}</span></gl-tooltip
		>`;
	}

	private renderWip() {
		const workingTreeState = this.wip?.workingTreeState;
		if (workingTreeState == null) return nothing;

		const total = workingTreeState.added + workingTreeState.changed + workingTreeState.deleted;
		if (total === 0) return nothing;

		const parts = getWipTooltipParts(workingTreeState);

		return html`<gl-tooltip class="wip__pill" placement="bottom"
			><commit-stats
				added=${workingTreeState.added}
				modified=${workingTreeState.changed}
				removed=${workingTreeState.deleted}
				symbol="icons"
			></commit-stats>
			<span class="wip__tooltip" slot="content">
				<p>${parts.length ? `${parts.join(', ')} in the working tree` : 'No working tree changes'}</p>
			</span></gl-tooltip
		>`;
	}

	private renderAvatars() {
		const contributors = this.enrichment?.contributors;
		if (!contributors?.length) return nothing;

		return html`<gl-avatar-list
			.avatars=${contributors.map(a => ({ name: a.name, src: a.avatarUrl }))}
			max="1"
		></gl-avatar-list>`;
	}

	private renderTimestamp() {
		const timestamp = this.branch.timestamp;
		if (timestamp == null) return nothing;

		const date = new Date(timestamp);
		const dateFormat = 'MMMM Do, YYYY h:mma';

		return html`<gl-tooltip class="branch-item__date">
			<time datetime="${date.toISOString()}">${fromNow(date)}</time>
			<span slot="content">${formatDate(date, dateFormat)}</span>
		</gl-tooltip>`;
	}

	private renderPrItem() {
		const pr = this.enrichment?.pr;
		if (pr == null) return nothing;

		const launchpadItem = this.enrichment?.resolvedLaunchpad;

		return html`
			<gl-work-item ?expanded=${this.expanded} nested>
				<div class="branch-item__section">
					<p class="branch-item__grouping">
						<span class="branch-item__icon">
							<pr-icon ?draft=${pr.draft} state=${pr.state} pr-id=${pr.id}></pr-icon>
						</span>
						<a
							href=${pr.url}
							class="branch-item__name branch-item__name--secondary"
							@click=${this.onLinkClick}
							>${pr.title}</a
						>
						<span class="branch-item__identifier">#${pr.id}</span>
					</p>
				</div>
				${this.renderLaunchpadItem(launchpadItem)}
				${when(
					this.expanded,
					() => html`<div class="branch-item__actions" slot="actions">${this.renderPrActions()}</div>`,
				)}
			</gl-work-item>
		`;
	}

	private renderLaunchpadItem(launchpadItem: OverviewBranchLaunchpadItem | undefined) {
		if (launchpadItem == null) return nothing;

		const group = getLaunchpadItemGroup(this.enrichment?.pr, launchpadItem);
		if (group == null) return nothing;

		const groupLabel = launchpadGroupLabelMap.get(group);
		const groupIcon = launchpadGroupIconMap.get(group);
		if (groupLabel == null || groupIcon == null) return nothing;

		const groupIconString = groupIcon.match(/\$\((.*?)\)/)![1].replace('gitlens', 'gl');

		return html`<div class="branch-item__section branch-item__section--details" slot="context">
			<p class="launchpad-grouping--${getLaunchpadItemGrouping(group)}">
				<code-icon icon="${groupIconString}"></code-icon
				><span class="branch-item__category">${groupLabel.toUpperCase()}</span>
			</p>
		</div>`;
	}

	private renderIssuesItem() {
		const issues = this.enrichment?.issues;
		const autolinks = this.enrichment?.autolinks;
		const allIssues = [...(issues ?? []), ...(autolinks ?? [])];
		if (allIssues.length === 0) return nothing;

		return html`
			<gl-work-item ?expanded=${this.expanded} nested>
				<div class="branch-item__section">
					${allIssues.map(
						issue => html`
							<p class="branch-item__grouping">
								<span class="branch-item__icon">
									<issue-icon state=${issue.state} issue-id=${issue.id}></issue-icon>
								</span>
								<a
									href=${issue.url}
									class="branch-item__name branch-item__name--secondary"
									@click=${this.onLinkClick}
									>${issue.title}</a
								>
								<span class="branch-item__identifier"
									>${isNaN(parseInt(issue.id)) ? '' : '#'}${issue.id}</span
								>
							</p>
						`,
					)}
				</div>
			</gl-work-item>
		`;
	}

	private renderBranchActions() {
		const actions = [];

		if (this.isWorktree) {
			actions.push(
				html`<action-item
					label="Open Worktree"
					alt-label="Open Worktree in New Window"
					icon="browser"
					alt-icon="empty-window"
					href=${this.createCommandLink('gitlens.openWorktree:')}
					alt-href=${this.createCommandLink<OpenWorktreeCommandArgs>('gitlens.openWorktree:', {
						location: 'newWindow',
					})}
				></action-item>`,
			);
		} else {
			actions.push(
				html`<action-item
					label="Switch to Branch..."
					icon="gl-switch"
					href=${this.createCommandLink('gitlens.switchToBranch:')}
				></action-item>`,
			);
		}

		actions.push(
			html`<action-item
				label="Fetch"
				icon="repo-fetch"
				href=${this.createCommandLink('gitlens.fetch:')}
			></action-item>`,
			html`<action-item
				label=${this.isWorktree ? 'Open in Worktrees View' : 'Open in Branches View'}
				icon="arrow-right"
				href=${this.createCommandLink('gitlens.openInView.branch:')}
			></action-item>`,
		);

		return html`<action-nav>${actions}</action-nav>`;
	}

	private renderPrActions() {
		return html`<action-nav>
			<action-item
				label="Open Pull Request Changes"
				icon="request-changes"
				href=${this.createCommandLink('gitlens.openPullRequestChanges:')}
			></action-item>
			<action-item
				label="Compare Pull Request"
				icon="git-compare"
				href=${this.createCommandLink('gitlens.openPullRequestComparison:')}
			></action-item>
			<action-item
				label="Open Pull Request Details"
				icon="eye"
				href=${this.createCommandLink('gitlens.openPullRequestDetails:')}
			></action-item>
		</action-nav>`;
	}

	private renderCollapsedActions() {
		if (this.expanded) return nothing;

		const actions = [];

		if (this.isWorktree) {
			actions.push(
				html`<action-item
					label="Open Worktree"
					icon="browser"
					href=${this.createCommandLink('gitlens.openWorktree:')}
				></action-item>`,
			);
		} else {
			actions.push(
				html`<action-item
					label="Switch to Branch..."
					icon="gl-switch"
					href=${this.createCommandLink('gitlens.switchToBranch:')}
				></action-item>`,
			);
		}

		actions.push(
			html`<action-item
				label=${this.isWorktree ? 'Open in Worktrees View' : 'Open in Branches View'}
				icon="arrow-right"
				href=${this.createCommandLink('gitlens.openInView.branch:')}
			></action-item>`,
		);

		return html`<action-nav class="branch-item__collapsed-actions">${actions}</action-nav>`;
	}

	private createCommandLink<T>(
		command: GlWebviewCommandsOrCommandsWithSuffix,
		args?: Omit<T, keyof BranchRef>,
	): string {
		return this._webview.createCommandLink<T | BranchRef>(
			command,
			args ? { ...args, ...this.branchRef } : this.branchRef,
		);
	}

	toggleExpanded(expanded = !this.expanded): void {
		this.expanded = expanded;
		queueMicrotask(() => {
			this.dispatchEvent(
				new CustomEvent('gl-graph-overview-card-expand-toggled', {
					detail: { expanded: expanded },
					bubbles: true,
					composed: true,
				}),
			);
		});
	}

	private onCardClick() {
		if (this.expandable && !this.expanded) {
			this.toggleExpanded(true);
			return;
		}

		this.dispatchEvent(
			new CustomEvent('gl-graph-overview-branch-selected', {
				detail: {
					branchId: this.branch.id,
					branchName: this.branch.name,
					mergeTargetTipSha: this.enrichment?.mergeTarget?.sha,
				},
				bubbles: true,
				composed: true,
			}),
		);
	}

	private onCardKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			this.onCardClick();
		}
	}

	private onLinkClick(e: Event) {
		e.stopPropagation();
	}
}

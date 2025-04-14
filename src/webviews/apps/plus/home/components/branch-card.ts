import { consume } from '@lit/context';
import type { TemplateResult } from 'lit';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { when } from 'lit/directives/when.js';
import type { GlCommands } from '../../../../../constants.commands';
import type { WebviewIds, WebviewViewIds } from '../../../../../constants.views';
import type { LaunchpadCommandArgs } from '../../../../../plus/launchpad/launchpad';
import {
	actionGroupMap,
	launchpadCategoryToGroupMap,
	launchpadGroupIconMap,
	launchpadGroupLabelMap,
} from '../../../../../plus/launchpad/models/launchpad';
import type { AssociateIssueWithBranchCommandArgs } from '../../../../../plus/startWork/startWork';
import { createCommandLink } from '../../../../../system/commands';
import { fromNow } from '../../../../../system/date';
import { interpolate, pluralize } from '../../../../../system/string';
import { createWebviewCommandLink } from '../../../../../system/webview';
import type {
	BranchRef,
	CreatePullRequestCommandArgs,
	GetOverviewBranch,
	OpenInGraphParams,
	State,
} from '../../../../home/protocol';
import { stateContext } from '../../../home/context';
import { renderBranchName } from '../../../shared/components/branch-name';
import type { GlCard } from '../../../shared/components/card/card';
import { GlElement, observe } from '../../../shared/components/element';
import { srOnlyStyles } from '../../../shared/components/styles/lit/a11y.css';
import { linkStyles } from '../../shared/components/vscode.css';
import '../../../shared/components/code-icon';
import '../../../shared/components/avatar/avatar';
import '../../../shared/components/avatar/avatar-list';
import '../../../shared/components/commit/commit-stats';
import '../../../shared/components/formatted-date';
import '../../../shared/components/pills/tracking';
import '../../../shared/components/rich/issue-icon';
import '../../../shared/components/rich/pr-icon';
import '../../../shared/components/actions/action-item';
import '../../../shared/components/actions/action-nav';
import '../../../shared/components/branch-icon';
import './merge-target-status';

export const branchCardStyles = css`
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

	.branch-item__actions {
		display: flex;
		align-items: center;
		gap: 0.8rem;
		flex-direction: row;
		justify-content: flex-end;
		font-size: 0.9em;
	}

	/* :empty selector doesn't work with lit */
	.branch-item__actions:not(:has(*)) {
		display: none;
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
	}

	.branch-item__identifier {
		color: var(--vscode-descriptionForeground);
		text-decoration: none;
	}

	.branch-item__grouping {
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
		max-width: 100%;
		margin-block: 0;
	}

	.branch-item__changes {
		display: flex;
		align-items: center;
		gap: 1rem;
		justify-content: flex-end;
		flex-wrap: wrap;
		white-space: nowrap;
	}

	.branch-item__changes formatted-date {
		margin-inline-end: auto;
	}

	.branch-item__summary {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}

	.branch-item__collapsed-actions {
		position: absolute;
		z-index: var(--gl-branch-card-actions-zindex, 2);
		right: 0.4rem;
		bottom: 0.3rem;
		padding: 0.4rem 0.6rem;
		background-color: var(--gl-card-hover-background);
	}

	.branch-item:not(:focus-within):not(:hover) .branch-item__collapsed-actions {
		${srOnlyStyles}
	}

	.pill {
		--gl-pill-border: color-mix(in srgb, transparent 80%, var(--color-foreground));
	}

	.work-item {
		--gl-card-background: color-mix(in lab, var(--vscode-sideBar-background) 100%, #fff 3%);
		--gl-card-hover-background: color-mix(in lab, var(--vscode-sideBar-background) 100%, #fff 1.5%);
	}
	.work-item::part(base) {
		margin-block-end: 0;
	}

	.branch-item__section.mb-1 {
		margin-block: 0.4rem;
	}

	.branch-item__merge-target {
		margin-inline-end: auto;
	}

	.branch-item__row {
		display: flex;
		gap: 0.8rem;
	}

	.branch-item__row [full] {
		flex-grow: 1;
	}

	.branch-item__missing {
		--button-foreground: inherit;
	}

	.branch-item__is-narrow {
		display: none;
	}

	@media (max-width: 330px) {
		.branch-item__is-narrow {
			display: block;
		}
		.branch-item__is-wide {
			display: none;
		}
	}

	:host-context(.vscode-dark) .branch-item__missing,
	:host-context(.vscode-high-contrast) .branch-item__missing {
		--button-background: color-mix(in lab, var(--vscode-sideBar-background) 100%, #fff 3%);
		--button-hover-background: color-mix(in lab, var(--vscode-sideBar-background) 100%, #fff 1.5%);
		--button-border: color-mix(in lab, var(--vscode-sideBar-background) 100%, #fff 12%);
	}

	:host-context(.vscode-light) .branch-item__missing,
	:host-context(.vscode-high-contrast-light) .branch-item__missing {
		--button-background: color-mix(in lab, var(--vscode-sideBar-background) 100%, #000 8%);
		--button-hover-background: color-mix(in lab, var(--vscode-sideBar-background) 100%, #000 10%);
		--button-border: color-mix(in lab, var(--vscode-sideBar-background) 100%, #000 14%);
	}

	.branch-item__category {
		margin-inline-start: 0.6rem;
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

	p.tracking__tooltip--wip {
		margin-block-start: 1rem;
	}
`;

type NothingType = typeof nothing;

declare global {
	interface GlobalEventHandlersEventMap {
		'gl-branch-card-expand-toggled': CustomEvent<{ expanded: boolean }>;
	}
}

export abstract class GlBranchCardBase extends GlElement {
	static override styles = [linkStyles, branchCardStyles];

	@consume<State>({ context: stateContext, subscribe: true })
	@state()
	private _homeState!: State;

	@property()
	repo!: string;

	@property({ type: Boolean })
	showUpgrade = false;

	private _branch!: GetOverviewBranch;
	get branch(): GetOverviewBranch {
		return this._branch;
	}
	@property({ type: Object })
	set branch(value: GetOverviewBranch) {
		this._branch = value;
		this.autolinksPromise = value?.autolinks;
		this.contributorsPromise = value?.contributors;
		this.issuesPromise = value?.issues;
		this.prPromise = value?.pr;
		this.mergeTargetPromise = value?.mergeTarget;
		this.remotePromise = value?.remote;
		this.wipPromise = value?.wip;
	}

	@state()
	private _autolinks!: Awaited<GetOverviewBranch['autolinks']>;
	get autolinks(): Awaited<GetOverviewBranch['autolinks']> {
		return this._autolinks;
	}

	private _autolinksPromise!: GetOverviewBranch['autolinks'];
	get autolinksPromise(): GetOverviewBranch['autolinks'] {
		return this._autolinksPromise;
	}
	set autolinksPromise(value: GetOverviewBranch['autolinks']) {
		if (this._autolinksPromise === value) return;

		this._autolinksPromise = value;
		void this._autolinksPromise?.then(
			r => (this._autolinks = r),
			() => (this._autolinks = undefined),
		);
	}

	@state()
	private _contributors!: Awaited<GetOverviewBranch['contributors']>;
	get contributors(): Awaited<GetOverviewBranch['contributors']> {
		return this._contributors;
	}

	private _contributorsPromise!: GetOverviewBranch['contributors'];
	get contributorsPromise(): GetOverviewBranch['contributors'] {
		return this._contributorsPromise;
	}
	set contributorsPromise(value: GetOverviewBranch['contributors']) {
		if (this._contributorsPromise === value) return;

		this._contributorsPromise = value;
		void this._contributorsPromise?.then(
			r => (this._contributors = r),
			() => (this._contributors = undefined),
		);
	}

	@state()
	private _issues!: Awaited<GetOverviewBranch['issues']>;
	get issues(): Awaited<GetOverviewBranch['issues']> {
		return this._issues;
	}

	private _issuesPromise!: GetOverviewBranch['issues'];
	get issuesPromise(): GetOverviewBranch['issues'] {
		return this._issuesPromise;
	}
	set issuesPromise(value: GetOverviewBranch['issues']) {
		if (this._issuesPromise === value) return;

		this._issuesPromise = value;
		void this._issuesPromise?.then(
			r => (this._issues = r),
			() => (this._issues = undefined),
		);
	}

	@state()
	private _pr!: Awaited<GetOverviewBranch['pr']>;
	get pr(): Awaited<GetOverviewBranch['pr']> {
		return this._pr;
	}

	private _prPromise!: GetOverviewBranch['pr'];
	get prPromise(): GetOverviewBranch['pr'] {
		return this._prPromise;
	}
	set prPromise(value: GetOverviewBranch['pr']) {
		if (this._prPromise === value) return;

		this._prPromise = value;
		void this._prPromise?.then(
			r => {
				this._pr = r;
				this.launchpadItemPromise = r?.launchpad;
			},
			() => {
				this._pr = undefined;
				this.launchpadItemPromise = undefined;
			},
		);
	}

	@state()
	private _launchpadItem!: Awaited<NonNullable<Awaited<GetOverviewBranch['pr']>>['launchpad']>;
	get launchpadItem(): Awaited<NonNullable<Awaited<GetOverviewBranch['pr']>>['launchpad']> {
		return this._launchpadItem;
	}

	private _launchpadItemPromise!: NonNullable<Awaited<GetOverviewBranch['pr']>>['launchpad'];
	get launchpadItemPromise(): NonNullable<Awaited<GetOverviewBranch['pr']>>['launchpad'] {
		return this._launchpadItemPromise;
	}
	set launchpadItemPromise(value: NonNullable<Awaited<GetOverviewBranch['pr']>>['launchpad']) {
		if (this._launchpadItemPromise === value) return;

		this._launchpadItemPromise = value;
		void this._launchpadItemPromise?.then(
			r => (this._launchpadItem = r),
			() => (this._launchpadItem = undefined),
		);
	}

	@state()
	private _mergeTarget!: Awaited<GetOverviewBranch['mergeTarget']>;
	get mergeTarget(): Awaited<GetOverviewBranch['mergeTarget']> {
		return this._mergeTarget;
	}

	private _mergeTargetPromise!: GetOverviewBranch['mergeTarget'];
	get mergeTargetPromise(): GetOverviewBranch['mergeTarget'] {
		return this._mergeTargetPromise;
	}
	set mergeTargetPromise(value: GetOverviewBranch['mergeTarget']) {
		if (this._mergeTargetPromise === value) return;

		this._mergeTargetPromise = value;
		void this._mergeTargetPromise?.then(
			r => (this._mergeTarget = r),
			() => (this._mergeTarget = undefined),
		);
	}

	@state()
	private _remote!: Awaited<GetOverviewBranch['remote']>;
	get remote(): Awaited<GetOverviewBranch['remote']> {
		return this._remote;
	}

	private _remotePromise!: GetOverviewBranch['remote'];
	get remotePromise(): GetOverviewBranch['remote'] {
		return this._remotePromise;
	}
	set remotePromise(value: GetOverviewBranch['remote']) {
		if (this._remotePromise === value) return;

		this._remotePromise = value;
		void this._remotePromise?.then(
			r => (this._remote = r),
			() => (this._remote = undefined),
		);
	}

	@state()
	private _wip!: Awaited<GetOverviewBranch['wip']>;
	get wip(): Awaited<GetOverviewBranch['wip']> {
		return this._wip;
	}

	private _wipPromise!: GetOverviewBranch['wip'];
	get wipPromise(): GetOverviewBranch['wip'] {
		return this._wipPromise;
	}
	set wipPromise(value: GetOverviewBranch['wip']) {
		if (this._wipPromise === value) return;

		this._wipPromise = value;
		void this._wipPromise?.then(
			r => (this._wip = r),
			() => (this._wip = undefined),
		);
	}

	@property({ type: Boolean, reflect: true })
	busy = false;

	@property({ type: Boolean, reflect: true })
	expanded = false;

	@property({ type: Boolean, reflect: true })
	expandable = false;

	private eventController?: AbortController;

	@observe('expandable')
	private onExpandableChanged() {
		this.attachFocusListener();
	}

	get branchRef(): BranchRef {
		return {
			repoPath: this.repo,
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

	get cardIndicator(): GlCard['indicator'] {
		return getLaunchpadItemGrouping(getLaunchpadItemGroup(this.pr, this.launchpadItem)) ?? 'base';
	}

	get branchCardIndicator(): GlCard['indicator'] {
		if (!this.branch.opened) return undefined;

		if (this.wip?.pausedOpStatus != null) {
			if (this.wip?.hasConflicts) return 'conflict';
			switch (this.wip.pausedOpStatus.type) {
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
			this.wip?.workingTreeState != null &&
			this.wip.workingTreeState.added + this.wip.workingTreeState.changed + this.wip.workingTreeState.deleted > 0;

		if (hasWip) {
			return 'branch-changes';
		}

		if (this.mergeTarget?.mergedStatus?.merged) {
			return 'branch-merged';
		}

		switch (this.branch.status) {
			case 'ahead':
				return 'branch-ahead';
			case 'behind':
				return 'branch-behind';
			case 'diverged':
				return 'branch-diverged';
			case 'upToDate':
				return 'branch-synced';
			case 'missingUpstream':
				return 'branch-missingUpstream';
			default:
				return undefined;
		}
	}

	override connectedCallback(): void {
		super.connectedCallback();
		this.attachFocusListener();
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback();
		this.eventController?.abort();
	}

	private attachFocusListener() {
		this.eventController?.abort();
		this.eventController = undefined;
		if (this.expandable) {
			if (this.eventController == null) {
				this.eventController = new AbortController();
			}
			this.addEventListener('focusin', this.onFocus.bind(this), { signal: this.eventController.signal });
		}
	}

	private onFocus(e: FocusEvent) {
		const actionElement = e.composedPath().some(el => (el as HTMLElement).matches?.('action-item') ?? false);
		if (actionElement || this.expanded) return;
		this.toggleExpanded(true);
	}

	protected renderIssues(): TemplateResult | NothingType {
		const { autolinks, issues } = this;
		const issuesSource = issues?.length ? issues : autolinks;
		if (!issuesSource?.length) return nothing;

		return html`
			${issuesSource.map(issue => {
				return html`
					<p class="branch-item__grouping">
						<span class="branch-item__icon">
							<issue-icon state=${issue.state} issue-id=${issue.id}></issue-icon>
						</span>
						<a href=${issue.url} class="branch-item__name branch-item__name--secondary">${issue.title}</a>
						<span class="branch-item__identifier">#${issue.id}</span>
					</p>
				`;
			})}
		`;
	}

	protected renderWip(): TemplateResult | NothingType {
		const workingTreeState = this.wip?.workingTreeState;
		if (workingTreeState == null) return nothing;

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
			</span>
		</gl-tooltip>`;
	}

	protected renderAvatars(): TemplateResult | NothingType {
		const { contributors } = this;

		if (!contributors?.length) return nothing;

		return html`<gl-avatar-list
			.avatars=${contributors.map(a => ({ name: a.name, src: a.avatarUrl }))}
			max="1"
		></gl-avatar-list>`;
	}

	protected renderTracking(showWip = false): TemplateResult | NothingType {
		if (this.branch.upstream == null) return nothing;

		const { state } = this.branch.upstream;
		// const ahead = this.branch.state.ahead ?? 0;
		// const behind = this.branch.state.behind ?? 0;

		let working = 0;
		let wipTooltip;
		if (showWip) {
			const workingTreeState = this.wip?.workingTreeState;
			if (workingTreeState != null) {
				working = workingTreeState.added + workingTreeState.changed + workingTreeState.deleted;

				const wipParts = getWipTooltipParts(workingTreeState);
				if (wipParts.length) {
					wipTooltip = html`<p class="tracking__tooltip--wip">${wipParts.join(', ')} in the working tree</p>`;
				}
			}
		}

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
				tooltip = html`${renderBranchName(this.branch.name)} is
				${status.join(', ')}${renderBranchName(this.branch.upstream?.name)}`;
			} else {
				tooltip = html`${renderBranchName(this.branch.name)} is up to date with
				${renderBranchName(this.branch.upstream?.name)}`;
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
				working=${working}
				?missingUpstream=${this.branch.upstream?.missing ?? false}
			></gl-tracking-pill>
			<span class="tracking__tooltip" slot="content">${tooltip}${wipTooltip}</span></gl-tooltip
		>`;
	}

	protected abstract getBranchActions(): TemplateResult[];
	protected renderBranchActions(): TemplateResult | NothingType {
		const actions = this.getBranchActions?.();
		if (!actions?.length) return nothing;

		return html`<action-nav>${actions}</action-nav>`;
	}

	protected abstract getPrActions(): TemplateResult[];
	protected renderPrActions(): TemplateResult | NothingType {
		const actions = this.getPrActions?.();
		if (!actions?.length) return nothing;

		return html`<action-nav>${actions}</action-nav>`;
	}

	protected abstract getCollapsedActions(): TemplateResult[];
	protected renderCollapsedActions(): TemplateResult | NothingType {
		if (this.expanded) return nothing;

		const actions = this.getCollapsedActions?.();
		if (!actions?.length) return nothing;

		return html`<action-nav class="branch-item__collapsed-actions">${actions}</action-nav>`;
	}

	protected createWebviewCommandLink<T>(
		command: `${WebviewIds | WebviewViewIds}.${string}` | `gitlens.plus.${string}`,
		args?: T | any,
	): string {
		return createWebviewCommandLink<T>(
			command,
			'gitlens.views.home',
			'',
			args ? { ...args, ...this.branchRef } : this.branchRef,
		);
	}

	protected createCommandLink<T>(command: GlCommands, args?: T | any): string {
		return createCommandLink<T>(command, args ? { ...args, ...this.branchRef } : this.branchRef);
	}

	protected renderTimestamp(): TemplateResult | NothingType {
		const { timestamp } = this.branch;
		if (timestamp == null) return nothing;

		return html`<formatted-date
			tooltip="Last commit on "
			.date=${new Date(timestamp)}
			class="branch-item__date"
		></formatted-date>`;
	}

	protected abstract renderBranchIndicator?(): TemplateResult | undefined;

	protected renderBranchItem(actionsSection?: TemplateResult | NothingType): TemplateResult | NothingType {
		const wip = this.renderWip();
		const tracking = this.renderTracking();
		const avatars = this.renderAvatars();
		const indicator = this.branch.opened ? undefined : this.renderBranchIndicator?.();
		const mergeTargetStatus = this.renderMergeTargetStatus();
		const timestamp = this.renderTimestamp();

		return html`
			<gl-work-item
				?primary=${!this.branch.opened}
				?nested=${!this.branch.opened}
				.indicator=${this.branchCardIndicator}
				?expanded=${this.expanded}
			>
				<div class="branch-item__section">
					<p class="branch-item__grouping">
						<span class="branch-item__icon"> ${this.renderBranchIcon()} </span>
						<span class="branch-item__name">${this.branch.name}</span>
					</p>
				</div>
				${when(
					timestamp || indicator || wip || tracking || avatars,
					() => html`
						<div class="branch-item__section branch-item__section--details" slot="context">
							<p class="branch-item__changes">${timestamp}${indicator}${wip}${tracking}${avatars}</p>
						</div>
					`,
				)}
				${when(
					// TODO: this doesn't work properly. nothing is true, empty html template is true
					actionsSection || mergeTargetStatus,
					() =>
						html`<div class="branch-item__actions" slot="actions">
							${mergeTargetStatus ?? nothing}${actionsSection ?? nothing}
						</div>`,
				)}
				<span class="branch-item__summary" slot="summary">${this.renderTracking(true)} ${avatars}</span>
			</gl-work-item>
		`;
	}

	private renderBranchIcon() {
		const hasChanges =
			this.wip?.workingTreeState != null &&
			this.wip.workingTreeState.added + this.wip.workingTreeState.changed + this.wip.workingTreeState.deleted > 0;
		return html`<gl-branch-icon
			branch="${this.branch.name}"
			status="${this.branch.status}"
			?hasChanges=${hasChanges}
			upstream=${this.branch.upstream?.name}
			?worktree=${this.branch.worktree != null}
			?is-default=${this.branch.worktree?.isDefault ?? false}
		></gl-branch-icon>`;
	}

	protected renderPrItem(): TemplateResult | NothingType {
		if (!this.pr) {
			if (this.branch.upstream?.missing === false && this.expanded) {
				return html`
					<div class="branch-item__row">
						<gl-button
							class="branch-item__missing"
							appearance="secondary"
							full
							href="${createCommandLink('gitlens.home.createPullRequest', {
								ref: this.branchRef,
								describeWithAI: false,
								source: { source: 'home', detail: 'create-pr' },
							})}"
							>Create a Pull Request</gl-button
						>
						${this._homeState.orgSettings.ai &&
						this.remote?.provider?.supportedFeatures?.createPullRequestWithDetails
							? html`<gl-button
									class="branch-item__missing"
									tooltip="Create a Pull Request with AI (Preview)"
									appearance="secondary"
									href="${createCommandLink<CreatePullRequestCommandArgs>(
										'gitlens.home.createPullRequest',
										{
											ref: this.branchRef,
											describeWithAI: true,
											source: { source: 'home', detail: 'create-pr' },
										},
									)}"
							  >
									<code-icon class="branch-item__is-wide" icon="sparkle" slot="prefix"></code-icon>
									<code-icon class="branch-item__is-narrow" icon="sparkle"></code-icon>
									<span class="branch-item__is-wide">Create with AI</span>
							  </gl-button>`
							: nothing}
					</div>
				`;
			}
			return nothing;
		}

		const indicator: GlCard['indicator'] = this.branch.opened
			? getLaunchpadItemGrouping(getLaunchpadItemGroup(this.pr, this.launchpadItem)) ?? 'base'
			: undefined;

		const actions = this.renderPrActions();
		return html`
			<gl-work-item ?expanded=${this.expanded} ?nested=${!this.branch.opened} .indicator=${indicator}>
				<div class="branch-item__section">
					<p class="branch-item__grouping">
						<span class="branch-item__icon">
							<pr-icon ?draft=${this.pr.draft} state=${this.pr.state} pr-id=${this.pr.id}></pr-icon>
						</span>
						<a href=${this.pr.url} class="branch-item__name branch-item__name--secondary"
							>${this.pr.title}</a
						>
						<span class="branch-item__identifier">#${this.pr.id}</span>
					</p>
				</div>
				${this.renderLaunchpadItem()}
				${when(actions != null, () => html`<div class="branch-item__actions" slot="actions">${actions}</div>`)}
			</gl-work-item>
		`;
	}

	protected renderLaunchpadItem(): TemplateResult | NothingType {
		if (this.launchpadItem == null) return nothing;

		const group = getLaunchpadItemGroup(this.pr, this.launchpadItem);
		if (group == null) return nothing;

		const groupLabel = launchpadGroupLabelMap.get(group);
		const groupIcon = launchpadGroupIconMap.get(group);

		if (groupLabel == null || groupIcon == null) return nothing;
		const groupIconString = groupIcon.match(/\$\((.*?)\)/)![1].replace('gitlens', 'gl');

		const tooltip = interpolate(actionGroupMap.get(this.launchpadItem.category)![1], {
			author: this.launchpadItem.author?.username ?? 'unknown',
			createdDateRelative: fromNow(new Date(this.launchpadItem.createdDate)),
		});

		return html`<div class="branch-item__section branch-item__section--details" slot="context">
				<p class="launchpad-grouping--${getLaunchpadItemGrouping(group)}">
					<gl-tooltip content="${tooltip}">
						<a
							href=${createCommandLink<Omit<LaunchpadCommandArgs, 'command'>>('gitlens.showLaunchpad', {
								source: 'home',
								state: {
									id: { uuid: this.launchpadItem.uuid, group: group },
								},
							} satisfies Omit<LaunchpadCommandArgs, 'command'>)}
							class="launchpad__grouping"
						>
							<code-icon icon="${groupIconString}"></code-icon
							><span class="branch-item__category">${groupLabel.toUpperCase()}</span></a
						>
					</gl-tooltip>
				</p>
			</div>
			${groupIconString
				? html`<span
						class="branch-item__summary launchpad-grouping--${getLaunchpadItemGrouping(group)}"
						slot="summary"
						><gl-tooltip placement="bottom" content="${groupLabel}"
							><code-icon icon="${groupIconString}"></code-icon></gl-tooltip
				  ></span>`
				: nothing}`;
	}

	protected renderMergeTargetStatus(): TemplateResult | NothingType {
		if (this.showUpgrade) {
			return html`<gl-merge-target-upgrade class="branch-item__merge-target"></gl-merge-target-upgrade>`;
		}

		if (!this.branch.mergeTarget) return nothing;

		return html`<gl-merge-target-status
			class="branch-item__merge-target"
			.branch=${this.branch}
			.targetPromise=${this.branch.mergeTarget}
		></gl-merge-target-status>`;
	}

	protected renderIssuesItem(): TemplateResult | NothingType {
		const issues = [...(this.issues ?? []), ...(this.autolinks ?? [])];
		if (!issues.length) {
			if (!this.expanded) return nothing;

			return html`<gl-button
				class="branch-item__missing"
				appearance="secondary"
				full
				href=${this.createCommandLink<AssociateIssueWithBranchCommandArgs>('gitlens.associateIssueWithBranch', {
					branch: this.branch.reference,
					source: 'home',
				})}
				>Associate an Issue</gl-button
			>`;
		}

		const indicator: GlCard['indicator'] = this.branch.opened ? 'base' : undefined;
		// for (const issue of issues) {
		// 	if (issue.state === 'opened') {
		// 		indicator = 'issue-open';
		// 		break;
		// 	}

		// 	if (issue.state === 'closed') {
		// 		indicator = 'issue-closed';
		// 	}
		// }

		return html`
			<gl-work-item ?expanded=${this.expanded} ?nested=${!this.branch.opened} .indicator=${indicator}>
				<div class="branch-item__section">${this.renderIssues()}</div>
			</gl-work-item>
		`;
	}

	toggleExpanded(expanded = !this.expanded): void {
		this.expanded = expanded;

		queueMicrotask(() => {
			this.emit('gl-branch-card-expand-toggled', { expanded: expanded });
		});
	}
}

@customElement('gl-branch-card')
export class GlBranchCard extends GlBranchCardBase {
	override render(): unknown {
		return html`
			<gl-card class="branch-item" focusable .indicator=${this.cardIndicator}>
				<div class="branch-item__container">
					${this.renderBranchItem(this.renderBranchActions())}${this.renderPrItem()}${this.renderIssuesItem()}
				</div>
				${this.renderCollapsedActions()}
			</gl-card>
		`;
	}

	protected getCollapsedActions(): TemplateResult[] {
		const actions = [];

		if (this.branch.worktree) {
			actions.push(
				html`<action-item
					label="Open Worktree"
					icon="browser"
					href=${this.createCommandLink('gitlens.home.openWorktree')}
				></action-item>`,
			);
		} else {
			actions.push(
				html`<action-item
					label="Switch to Branch..."
					icon="gl-switch"
					href=${this.createCommandLink('gitlens.home.switchToBranch')}
				></action-item>`,
			);
		}

		return actions;
	}

	protected getBranchActions(): TemplateResult[] {
		const actions = [];

		if (this.branch.worktree) {
			actions.push(
				html`<action-item
					label="Open Worktree"
					icon="browser"
					href=${this.createCommandLink('gitlens.home.openWorktree')}
				></action-item>`,
			);
		} else {
			actions.push(
				html`<action-item
					label="Switch to Branch..."
					icon="gl-switch"
					href=${this.createCommandLink('gitlens.home.switchToBranch')}
				></action-item>`,
			);
		}

		// branch actions
		actions.push(
			html`<action-item
				label="Fetch"
				icon="repo-fetch"
				href=${this.createCommandLink('gitlens.home.fetch')}
			></action-item>`,
		);
		actions.push(
			html`<action-item
				label="Open in Commit Graph"
				icon="gl-graph"
				href=${createCommandLink('gitlens.home.openInGraph', {
					...this.branchRef,
					type: 'branch',
				} satisfies OpenInGraphParams)}
			></action-item>`,
		);

		return actions;
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

	renderBranchIndicator(): TemplateResult | undefined {
		return undefined;
	}
}

@customElement('gl-work-item')
export class GlWorkUnit extends LitElement {
	static override styles = [
		css`
			.work-item {
				display: flex;
				flex-direction: column;
				gap: 0.8rem;
			}

			.work-item_content-empty {
				gap: 0;
			}

			.work-item__header {
				display: flex;
				flex-direction: row;
				justify-content: space-between;
				align-items: center;
				gap: 0.8rem;
			}

			.work-item__main {
				display: block;
				flex: 1;
				min-width: 0;
			}

			.work-item__summary {
				display: block;
				flex: none;
			}

			.work-item__content {
				display: flex;
				flex-direction: column;
				gap: 0.8rem;
				max-height: 100px;

				transition-property: opacity, max-height, display;
				transition-duration: 0.2s;
				transition-behavior: allow-discrete;
			}

			:host(:not([expanded])) .work-item__content {
				display: none;
				opacity: 0;
				max-height: 0;
			}

			gl-card::part(base) {
				margin-block-end: 0;
			}
		`,
	];

	@property({ type: Boolean, reflect: true })
	primary: boolean = false;

	@property({ type: Boolean, reflect: true })
	nested: boolean = false;

	@property({ reflect: true })
	indicator?: GlCard['indicator'];

	@property({ type: Boolean, reflect: true })
	expanded: boolean = false;

	override render(): unknown {
		return html`<gl-card
			.density=${this.primary ? 'tight' : undefined}
			.grouping=${this.nested === false ? undefined : this.primary ? 'item-primary' : 'item'}
			.indicator=${this.indicator}
			>${this.renderContent()}</gl-card
		>`;
	}

	private renderContent() {
		const contentRequired =
			this.querySelectorAll('[slot="context"]').length > 0 ||
			this.querySelectorAll('[slot="actions"]').length > 0;

		return html`
			<div class=${classMap({ 'work-item': true, 'work-item_content-empty': !contentRequired })}>
				<header class="work-item__header">
					<slot class="work-item__main"></slot>
					${this.renderSummary()}
				</header>
				<div class="work-item__content">
					<slot class="work-item__context" name="context"></slot>
					<slot class="work-item__actions" name="actions"></slot>
				</div>
			</div>
		`;
	}

	private renderSummary() {
		if (this.expanded) return nothing;

		return html`<slot class="work-item__summary" name="summary"></slot>`;
	}
}

function getLaunchpadItemGroup(
	pr: Awaited<GetOverviewBranch['pr']>,
	launchpadItem: Awaited<NonNullable<Awaited<GetOverviewBranch['pr']>>['launchpad']>,
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
		parts.push(`${pluralize('file', workingTreeState.added ?? 0)} added`);
	}
	if (workingTreeState.changed) {
		parts.push(`${pluralize('file', workingTreeState.changed ?? 0)} changed`);
	}
	if (workingTreeState.deleted) {
		parts.push(`${pluralize('file', workingTreeState.deleted ?? 0)} deleted`);
	}
	return parts;
}

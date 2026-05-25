import type { Remote } from '@eamodio/supertalk';
import { consume } from '@lit/context';
import type { PropertyValues, TemplateResult } from 'lit';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { when } from 'lit/directives/when.js';
import { formatDate, fromNow } from '@gitlens/utils/date.js';
import { pluralize } from '@gitlens/utils/string.js';
import type { AgentSessionState } from '../../../../../agents/models/agentSessionState.js';
import type { GlWebviewCommandsOrCommandsWithSuffix } from '../../../../../constants.commands.js';
import type { GraphOverviewActionName } from '../../../../../constants.telemetry.js';
import { isSubscriptionTrialOrPaidFromState } from '../../../../../plus/gk/utils/subscription.utils.js';
import {
	launchpadCategoryToGroupMap,
	launchpadGroupIconMap,
	launchpadGroupLabelMap,
} from '../../../../../plus/launchpad/models/launchpad.js';
import type { BranchRef } from '../../../../home/protocol.js';
import type { GraphServices } from '../../../../plus/graph/graphService.js';
import type {
	OverviewBranch,
	OverviewBranchEnrichment,
	OverviewBranchIssue,
	OverviewBranchLaunchpadItem,
	OverviewBranchMergeTarget,
	OverviewBranchWip,
} from '../../../../shared/overviewBranches.js';
import type { ActionItem } from '../../../shared/components/actions/action-item.js';
import { srOnlyStyles } from '../../../shared/components/styles/lit/a11y.css.js';
import type { WebviewContext } from '../../../shared/contexts/webview.js';
import { webviewContext } from '../../../shared/contexts/webview.js';
import { emitTelemetrySentEvent } from '../../../shared/telemetry.js';
import type { AppState } from '../context.js';
import { graphServicesContext, graphStateContext } from '../context.js';
import '../../shared/components/merge-target-status.js';
import '../../../shared/components/branch-icon.js';
import '../../../shared/components/card/card.js';
import '../../../shared/components/pills/agent-status-pill.js';
import '../../../shared/components/pills/tracking-status.js';
import '../../../shared/components/commit/commit-stats.js';
import '../../../shared/components/commit/wip-stats.js';
import '../../../shared/components/avatar/avatar-list.js';
import '../../../shared/components/rich/pr-icon.js';
import '../../../shared/components/rich/issue-icon.js';
import '../../../shared/components/overlays/popover.js';
import '../../../shared/components/overlays/tooltip.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/actions/action-item.js';
import '../../../shared/components/actions/action-nav.js';

function getBranchCardIndicator(
	branch: OverviewBranch,
	wip?: OverviewBranchWip,
	enrichment?: OverviewBranchEnrichment,
	mergeTarget?: OverviewBranchMergeTarget,
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

		// Prefer the explicit `hasChanges` flag (populated by both the lightweight and detailed
		// loaders) over deriving from `workingTreeState`, which is undefined on the basic load.
		const hasWip =
			wip?.hasChanges === true ||
			(wip?.workingTreeState != null &&
				wip.workingTreeState.added + wip.workingTreeState.changed + wip.workingTreeState.deleted > 0);
		if (hasWip) return 'branch-changes';

		// Card-local mergeTarget (resolved post-hover) takes precedence over enrichment.mergeTarget,
		// which is undefined for the graph overview now that merge-target is fetched lazily.
		const target = mergeTarget ?? enrichment?.mergeTarget;
		if (target?.mergedStatus?.merged) return 'branch-merged';
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

function formatIssueIdentifier(id: string): string {
	return isNaN(parseInt(id, 10)) ? id : `#${id}`;
}

declare global {
	interface GlobalEventHandlersEventMap {
		'gl-graph-overview-branch-selected': CustomEvent<{
			branchId: string;
			branchName: string;
			mergeTargetTipSha?: string;
		}>;
		'gl-graph-overview-card-request-wip-details': CustomEvent<{
			branchId: string;
		}>;
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

		/* Lights up when one or more selected/focused graph rows live on this branch.
		   Overrides the --gl-card-background cascade so the inner-shadow :hover rule
		   in card.css.ts continues to compose on top via --gl-card-hover-background. */
		:host([contains-selection]) {
			--gl-card-background: var(--vscode-list-inactiveSelectionBackground);
			--gl-card-hover-background: color-mix(
				in lab,
				var(--vscode-list-inactiveSelectionBackground) 100%,
				var(--vscode-foreground) 8%
			);
		}

		* {
			box-sizing: border-box;
		}

		gl-popover {
			/* Anchor wrapper inside the popover defaults to fit-content; grow it so the
			   whole card is the hover-target. */
			--gl-popover-anchor-width: 100%;
			/* Slightly slower show keeps quick scan-passes from triggering the rich hover;
			   short hide gives users a beat to move into the popover without it dismissing. */
			--show-delay: 600ms;
			--hide-delay: 120ms;
		}

		.branch-item {
			position: relative;
		}

		gl-card {
			cursor: pointer;
			display: block;
		}

		gl-card::part(base) {
			padding: 0.4rem 0.6rem;
			margin-block-end: 0;
			border-radius: 0.4rem;
		}

		gl-card.is-scoped {
			--gl-card-background: color-mix(in srgb, var(--gl-chip-scoped-color) 10%, var(--vscode-sideBar-background));
			--gl-card-hover-background: color-mix(
				in srgb,
				var(--gl-chip-scoped-color) 14%,
				var(--vscode-sideBar-background)
			);
		}
		gl-card.is-scoped::part(base) {
			box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--gl-chip-scoped-color) 35%, transparent);
		}

		gl-card.is-launchpad-mergeable::part(base) {
			border-inline-end: 0.3rem solid var(--vscode-gitlens-launchpadIndicatorMergeableColor);
		}
		gl-card.is-launchpad-blocked::part(base) {
			border-inline-end: 0.3rem solid var(--vscode-gitlens-launchpadIndicatorBlockedColor);
		}
		gl-card.is-launchpad-attention::part(base) {
			border-inline-end: 0.3rem solid var(--vscode-gitlens-launchpadIndicatorAttentionColor);
		}

		.branch-item__container {
			display: flex;
			flex-direction: column;
			gap: 0.3rem;
		}

		.branch-item__grouping {
			position: relative;
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

		.branch-item__meta {
			display: flex;
			align-items: center;
			gap: 0.8rem;
			margin-block: 0;
			font-size: 0.9em;
			color: var(--vscode-descriptionForeground);
		}

		.branch-item__meta-left {
			display: inline-flex;
			align-items: center;
			gap: 0.8rem;
			min-width: 0;
		}

		.branch-item__meta-right {
			display: inline-flex;
			align-items: center;
			gap: 0.6rem;
			margin-inline-start: auto;
		}

		/* One-line layout: tracking + wip pill folded into the name row's right edge when there
		   are no issues / PRs / agents to take the second meta line. flex-none + margin-inline-start
		   keeps the pills hugging the right edge while the name shrinks first under width pressure. */
		.branch-item__meta-inline {
			display: inline-flex;
			align-items: center;
			gap: 0.6rem;
			margin-inline-start: auto;
			flex: none;
			font-size: 0.9em;
			color: var(--vscode-descriptionForeground);
		}

		.branch-item__count {
			display: inline-flex;
			align-items: center;
			gap: 0.3rem;
			color: var(--vscode-descriptionForeground);
		}

		.branch-item__count code-icon {
			color: var(--vscode-descriptionForeground);
		}

		.branch-item__active-agents {
			display: flex;
			flex-direction: column;
			/* flex-start so a compact-fallback pill (needs-input + !canResolve) shrinks to its
			   content instead of inheriting stretch. Full-mode pills still span the row via their
			   own width: 100%. */
			align-items: flex-start;
			gap: 0.4rem;
		}

		.branch-item__date {
			margin-inline-end: auto;
		}

		.branch-item__inline-actions {
			/* Anchored to row 1 (grouping is position: relative). Absolute so it floats over the
			   branch name on hover without pushing layout. Spans grouping height and centers
			   content via flex — using transform here would create a containing block for the
			   action-item hoisted (fixed-positioned) tooltip and clip it. */
			position: absolute;
			z-index: 2;
			top: 0;
			bottom: 0;
			right: 0;
			display: inline-flex;
			align-items: center;
			padding: 0 0.4rem;
			background-color: var(--gl-card-hover-background);
			font-size: 0.9em;
		}

		.branch-item:not(:focus-within):not(:hover) .branch-item__inline-actions {
			${srOnlyStyles}
		}

		.wip__tooltip {
			display: contents;
			vertical-align: middle;
		}

		.wip__tooltip p {
			margin-block: 0;
		}

		gl-avatar-list {
			--gl-avatar-size: 2rem;
		}

		.hover {
			display: flex;
			flex-direction: column;
			gap: 0.8rem;
			min-width: 24rem;
			max-width: 36rem;
		}

		.hover__section {
			display: flex;
			flex-direction: column;
			gap: 0.4rem;
		}

		.hover__section--inline {
			flex-direction: row;
			flex-wrap: wrap;
			align-items: center;
			justify-content: space-between;
			gap: 0.6rem;
		}

		.hover__section + .hover__section {
			padding-top: 0.6rem;
			border-top: 1px solid var(--vscode-widget-border, transparent);
		}

		.hover__row {
			display: flex;
			align-items: center;
			gap: 0.6rem;
			max-width: 100%;
		}

		.hover__name {
			flex-grow: 1;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}

		.hover__name--bold {
			font-weight: bold;
		}

		.hover__name a {
			color: inherit;
			text-decoration: none;
		}

		.hover__name a:hover {
			text-decoration: underline;
		}

		.hover__identifier {
			color: var(--vscode-descriptionForeground);
		}

		.hover__icon {
			flex: none;
			color: var(--vscode-descriptionForeground);
		}

		.hover__text {
			margin: 0;
			line-height: 1.4;
		}

		.hover__text--secondary {
			font-size: 0.9em;
			color: var(--vscode-descriptionForeground);
		}

		.hover__muted {
			color: var(--vscode-descriptionForeground);
			margin-inline-start: 0.4rem;
		}

		.hover__launchpad {
			display: inline-flex;
			align-items: center;
			gap: 0.4rem;
			font-size: 0.9em;
		}

		.hover__launchpad--mergeable {
			color: var(--vscode-gitlens-launchpadIndicatorMergeableColor);
		}
		.hover__launchpad--blocked {
			color: var(--vscode-gitlens-launchpadIndicatorBlockedColor);
		}
		.hover__launchpad--attention {
			color: var(--vscode-gitlens-launchpadIndicatorAttentionColor);
		}

		.hover__avatars {
			flex: none;
			margin-inline-start: auto;
		}

		.hover__status-group {
			display: flex;
			align-items: center;
			gap: 0.6rem;
			flex-wrap: wrap;
		}

		.hover__status-group gl-tracking-status {
			--gl-pill-padding: 0.3rem 0.8rem;
		}

		.hover__agents {
			display: flex;
			flex-direction: row;
			align-items: center;
			gap: 0.4rem;
			flex-wrap: wrap;
		}

		.hover__actions {
			display: flex;
			flex-wrap: wrap;
			gap: 0.4rem;
		}
	`;

	@consume({ context: webviewContext })
	private _webview!: WebviewContext;

	@consume({ context: graphServicesContext, subscribe: true })
	private _services?: Remote<GraphServices> | undefined;

	@consume({ context: graphStateContext, subscribe: true })
	private _graphState?: AppState;

	@property({ type: Object })
	branch!: OverviewBranch;

	@property({ type: Object })
	wip?: OverviewBranchWip;

	@property({ type: Object })
	enrichment?: OverviewBranchEnrichment;

	@property({ type: Array })
	agentSessions?: AgentSessionState[];

	@property({ type: Boolean, reflect: true })
	scoped = false;

	/** True when any selected/focused graph row's commit is contained in this branch's history. */
	@property({ type: Boolean, reflect: true, attribute: 'contains-selection' })
	containsSelection = false;

	// Track when the rich hover has been shown at least once so <gl-merge-target-status>
	// (which has its own popover/loading affordance) only mounts when the user actually opens
	// the hover. Mounting kicks off the lazy merge-target fetch (see `_mergeTargetPromise`).
	@state()
	private _hoverShown = false;

	// Resolved merge-target value, fetched lazily on first hover via `BranchesService.getMergeTargetStatus`.
	// Drives the `branch-merged` card indicator and is published into shared `overviewEnrichment` state
	// so the scope-anchor flow's `reconcileScopeMergeTarget` hook can backfill the tip SHA.
	@state()
	private _mergeTarget?: OverviewBranchMergeTarget;

	// True while the lazy fetch is in flight. Drives `<gl-merge-target-status>`'s `loading` prop so
	// the chip shows its progress affordance (and `aria-busy="true"`) during the fetch instead of
	// rendering nothing until resolution.
	@state()
	private _mergeTargetLoading = false;

	// In-flight (or resolved) lazy fetch promise. Handed to <gl-merge-target-status> as `targetPromise`
	// so the chip's `loading` affordance covers the fetch latency without re-firing across hovers.
	private _mergeTargetPromise?: Promise<OverviewBranchMergeTarget | undefined>;

	// Tracks the branch id this card last fetched merge-target data for. When the `branch` prop
	// transitions to a different branch (Lit's `repeat` reuses card instances), the cached promise
	// and resolved value are stale and must be cleared.
	private _mergeTargetFetchedFor?: string;

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
		// `hasChanges` is set on both the basic and detailed wip loads, so the dirty indicator
		// can show up before the rich hover triggers a detailed fetch.
		if (this.wip?.hasChanges === true) return true;

		const wts = this.wip?.workingTreeState;
		return wts != null && wts.added + wts.changed + wts.deleted > 0;
	}

	private get launchpadGrouping() {
		return getLaunchpadItemGrouping(getLaunchpadItemGroup(this.enrichment?.pr, this.enrichment?.resolvedLaunchpad));
	}

	override render() {
		const branch = this.branch;
		if (branch == null) return nothing;

		const branchIndicator = getBranchCardIndicator(this.branch, this.wip, this.enrichment, this._mergeTarget);
		const grouping = this.launchpadGrouping;
		const cardClasses = classMap({
			'branch-item': true,
			'is-scoped': this.scoped,
			[`is-launchpad-${grouping ?? 'none'}`]: grouping != null,
		});

		// Pre-compute the meta pieces here so we can decide between a one-line and two-line layout
		// for inactive cards: when an inactive card has no issues / PRs / agents (the right-side
		// enrichment column), tracking and the wip pill fold up into the name row instead of
		// taking a second line. Active cards always keep their two-line layout — the inline
		// add/changed/deleted icons need the second-row real-estate.
		const tracking = this.renderTracking();
		const wip = this.renderWipMeta();
		const issuesIndicator = this.renderIssuesIndicator();
		const prIndicator = this.renderPrIndicator();
		const agentsIndicator = this.renderAgentsIndicator();
		const hasLeft = tracking !== nothing || wip !== nothing;
		const hasRight = issuesIndicator !== nothing || prIndicator !== nothing || agentsIndicator !== nothing;
		const inlineFold = !branch.opened && !hasRight && hasLeft;

		// placement="right" so the popover floats over the Graph (which sits to the right of
		// the sidebar in typical layouts) rather than into the editor's left margin. The
		// popover's flip behavior auto-corrects when there isn't room.
		return html`
			<gl-popover
				hoist
				trigger="hover focus-visible"
				placement="right"
				@gl-popover-show=${this.onPopoverShow}
				@click=${this.onActionItemClick}
			>
				<gl-card
					slot="anchor"
					class=${cardClasses}
					focusable
					.indicator=${branchIndicator}
					@click=${this.onCardClick}
					@keydown=${this.onCardKeydown}
					@focusin=${this.onCardFocusIn}
					@focusout=${this.onCardFocusOut}
				>
					<div class="branch-item__container">
						<p class="branch-item__grouping">
							<span class="branch-item__icon">${this.renderBranchIcon()}</span>
							<span class="branch-item__name">${this.branch.name}</span>
							${when(
								inlineFold,
								() => html`<span class="branch-item__meta-inline">${tracking}${wip}</span>`,
							)}
							${this.renderInlineActions()}
						</p>
						${when(!inlineFold && (hasLeft || hasRight), () =>
							this.renderMetaRow(
								tracking,
								wip,
								hasLeft,
								issuesIndicator,
								prIndicator,
								agentsIndicator,
								hasRight,
							),
						)}
						${this.renderActiveAgentPills()}
					</div>
				</gl-card>
				<div slot="content" class="hover">${when(this._hoverShown, () => this.renderHoverContent())}</div>
			</gl-popover>
		`;
	}

	private readonly onPopoverShow = () => {
		if (!this._hoverShown) {
			this._hoverShown = true;
		}
		// Kick off the lazy merge-target fetch on first popover open. Subsequent opens reuse
		// `_mergeTargetPromise` (the chip short-circuits when the same promise reference is passed).
		void this.ensureMergeTargetFetched();
		// Upgrade Recent worktree cards from the cheap dirty bit to the full add/changed/deleted
		// breakdown so the badge tooltip can show counts. Active cards already have the breakdown
		// from the eager fetch and the upgrade short-circuits.
		this.maybeRequestWipDetails();
	};

	// Tracks the wip object reference we last requested details for, so we don't re-fire on every
	// re-render. A push notification (which replaces the wip entry with a fresh basic-only object)
	// breaks reference equality and lets the next hover refetch.
	private _wipDetailsRequestedFor?: OverviewBranchWip;

	private maybeRequestWipDetails(): void {
		if (!this._hoverShown) return;

		const wip = this.wip;
		if (wip == null) return;
		// Nothing dirty — no detailed fetch needed; commit-stats wouldn't render anyway.
		if (wip.hasChanges !== true) return;
		// Already have the breakdown.
		if (wip.workingTreeState != null) return;
		if (this._wipDetailsRequestedFor === wip) return;

		this._wipDetailsRequestedFor = wip;
		this.dispatchEvent(
			new CustomEvent('gl-graph-overview-card-request-wip-details', {
				detail: { branchId: this.branch.id },
				bubbles: true,
				composed: true,
			}),
		);
	}

	override willUpdate(changed: PropertyValues<this>): void {
		// Lit's `repeat` reuses card instances when the branch list reorders, so a `branch` prop
		// transition can swap us onto a different branch entirely. Drop the stale merge-target
		// state and any in-flight promise so the next hover triggers a fresh fetch.
		if (changed.has('branch') && this.branch?.id !== this._mergeTargetFetchedFor) {
			this._mergeTarget = undefined;
			this._mergeTargetPromise = undefined;
			this._mergeTargetFetchedFor = undefined;
			this._mergeTargetLoading = false;
			this._wipDetailsRequestedFor = undefined;
		}
		// When the wip prop replaces (push notification or post-fetch merge) and the rich hover is
		// already open, ensure the detailed breakdown gets re-requested so the open hover stays
		// accurate. `maybeRequestWipDetails` short-circuits when we already have detailed data.
		if (changed.has('wip')) {
			this.maybeRequestWipDetails();
		}
	}

	private async ensureMergeTargetFetched(): Promise<void> {
		const branch = this.branch;
		if (branch == null) return;

		// Already fetched (or in flight) for this branch — nothing to do. The promise is reused
		// across hovers; <gl-merge-target-status> handles loading state internally.
		if (this._mergeTargetFetchedFor === branch.id && this._mergeTargetPromise != null) return;

		// Shared `overviewEnrichment` may already have this branch's merge target — populated by
		// `graph-app`'s click-to-scope path or a previous mount of a sibling card. Copy it onto
		// the card-local state without re-fetching.
		const shared = this._graphState?.overviewEnrichment?.[branch.id]?.mergeTarget;
		if (shared != null) {
			this._mergeTargetFetchedFor = branch.id;
			this._mergeTarget = shared;
			this._mergeTargetPromise = Promise.resolve(shared);
			return;
		}

		// Non-pro users get no merge-target work today (the eager path was gated by `isPro`).
		// Mirror that here so we don't spend IPC + git work producing data the chip won't render.
		const subState = this._graphState?.subscription?.state;
		if (subState != null && !isSubscriptionTrialOrPaidFromState(subState)) return;

		const services = this._services;
		if (services == null) return;

		this._mergeTargetFetchedFor = branch.id;
		this._mergeTargetLoading = true;
		const branchId = branch.id;
		const repoPath = branch.repoPath;
		const branchName = branch.name;

		const promise = (async (): Promise<OverviewBranchMergeTarget | undefined> => {
			try {
				const branches = await services.branches;
				const enrichment = await branches.getBranchEnrichment(repoPath, branchName);
				return await enrichment?.mergeTargetStatus;
			} catch {
				return undefined;
			}
		})();
		this._mergeTargetPromise = promise;

		const result = await promise;
		// Bail out if a `branch` prop transition while we were awaiting reassigned us — `willUpdate`
		// has already cleared the state for the new branch and `_mergeTargetFetchedFor` no longer matches.
		if (this._mergeTargetFetchedFor !== branchId) return;

		this._mergeTarget = result;
		this._mergeTargetLoading = false;
		// Publish into shared enrichment so the scope-anchor's `reconcileScopeMergeTarget` hook
		// backfills the tip SHA for the currently-scoped branch.
		this._graphState?.mergeMergeTargetIntoEnrichment(branchId, result);
	}

	// `<gl-popover>`'s built-in `focus` trigger relies on focus events bubbling out of the
	// anchor, but `<gl-card focusable>` keeps the focusable target inside its shadow root and
	// the underlying `focus` event isn't composed — so the popover never sees it. Wire
	// focusin/focusout on the card host explicitly to drive the popover's show/hide.
	private readonly onCardFocusIn = (e: FocusEvent) => {
		// Mirror the popover's `focus-visible` trigger semantics: only show on keyboard focus,
		// not on mouse-induced focus. `e.target` is retargeted to the gl-card host across the
		// shadow boundary, and `:focus-visible` doesn't reliably propagate from a delegated
		// descendant to the host — so reach into composedPath to find the actual focused
		// element (the innermost element along the event path) and check :focus-visible there.
		const focused = e.composedPath()[0];
		if (!(focused instanceof Element) || !focused.matches(':focus-visible')) return;

		const popover = this.shadowRoot?.querySelector<
			HTMLElement & { show: (triggeredBy?: 'hover' | 'focus' | 'click' | 'manual') => void }
		>('gl-popover');
		popover?.show('focus');
	};

	private readonly onCardFocusOut = (e: FocusEvent) => {
		// Close only when focus leaves the card+popover entirely.
		const next = e.relatedTarget as Node | null;
		if (next && (this.shadowRoot?.contains(next) || this.contains(next))) return;

		const popover = this.shadowRoot?.querySelector<HTMLElement & { hide: () => void }>('gl-popover');
		popover?.hide();
	};

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

	// Called from `render()` when the card needs a second meta line — i.e. active card (always)
	// or any card with right-side enrichment. Inactive cards with neither use the inline fold.
	private renderMetaRow(
		tracking: unknown,
		wip: unknown,
		hasLeft: boolean,
		issuesIndicator: unknown,
		prIndicator: unknown,
		agentsIndicator: unknown,
		hasRight: boolean,
	) {
		return html`<p class="branch-item__meta">
			${when(hasLeft, () => html`<span class="branch-item__meta-left">${tracking}${wip}</span>`)}
			${when(
				hasRight,
				() =>
					html`<span class="branch-item__meta-right">
						${issuesIndicator}${prIndicator}${agentsIndicator}
					</span>`,
			)}
		</p>`;
	}

	private renderTracking() {
		const upstream = this.branch.upstream;
		if (upstream == null) return nothing;

		return html`<gl-tracking-status
			.branchName=${this.branch.name}
			.upstreamName=${upstream.name}
			.missingUpstream=${upstream.missing ?? false}
			.ahead=${upstream.state.ahead}
			.behind=${upstream.state.behind}
			colorized
			outlined
		></gl-tracking-status>`;
	}

	private renderWipMeta() {
		if (this.wip == null) return nothing;

		const workingTreeState = this.wip.workingTreeState;

		// Active card (single `opened` branch): inline add/changed/deleted icons inside the meta row
		// (NOT pill form). The detailed breakdown lives in the hover popover for everyone — this
		// inline view is the active card's at-a-glance number. No per-pill tooltip; the popover
		// carries the descriptive content.
		if (this.branch.opened && this.hasWip) {
			const added = workingTreeState?.added ?? 0;
			const changed = workingTreeState?.changed ?? 0;
			const deleted = workingTreeState?.deleted ?? 0;
			return html`<commit-stats
				added=${added}
				modified=${changed}
				removed=${deleted}
				symbol="icons"
				no-tooltip
			></commit-stats>`;
		}

		// Other cards: just the dirty/clean badge (pencil / check pill). Same component the
		// Worktrees-panel rows use so sizing matches. Tooltip is suppressed — the rich hover
		// popover carries the breakdown.
		return html`<gl-wip-stats
			badge
			show-clean
			no-tooltip
			.dirty=${this.hasWip}
			added=${workingTreeState?.added ?? nothing}
			modified=${workingTreeState?.changed ?? nothing}
			removed=${workingTreeState?.deleted ?? nothing}
		></gl-wip-stats>`;
	}

	// Wip pill for the hover popover. Renders for both dirty (commit-stats pill with the
	// add/changed/deleted breakdown) and clean (check pill) states. Cheap-probed Recent cards
	// fetch the breakdown on first hover via maybeRequestWipDetails; the popover re-renders
	// once it lands so the dirty pill swaps from empty to numeric.
	private renderHoverWipStats() {
		if (this.wip == null) return nothing;

		const workingTreeState = this.wip.workingTreeState;
		return html`<gl-wip-stats
			show-clean
			no-tooltip
			.dirty=${this.hasWip}
			added=${workingTreeState?.added ?? nothing}
			modified=${workingTreeState?.changed ?? nothing}
			removed=${workingTreeState?.deleted ?? nothing}
		></gl-wip-stats>`;
	}

	private renderIssuesIndicator() {
		const issues = this.enrichment?.issues ?? [];
		if (issues.length === 0) return nothing;

		// `<issue-icon>` has its own `<gl-tooltip>` when state is set — wrap-only via
		// `branch-item__count` to keep icon + count visually paired without nesting tooltips.
		const openCount = issues.filter(i => i.state === 'opened').length;
		const state = openCount > 0 ? 'opened' : 'closed';

		return html`<span class="branch-item__count"
			><issue-icon state=${state}></issue-icon>${when(
				issues.length > 1,
				() => html`<span>${issues.length}</span>`,
			)}</span
		>`;
	}

	private renderPrIndicator() {
		const pr = this.enrichment?.pr;
		if (pr == null) return nothing;

		// `<pr-icon>` has its own `<gl-tooltip>` when state is set — render directly without
		// wrapping to avoid nested tooltips.
		return html`<pr-icon ?draft=${pr.draft ?? false} state=${pr.state} pr-id=${pr.id}></pr-icon>`;
	}

	private renderAgentsIndicator() {
		const sessions = this.agentSessions;
		if (sessions == null || sessions.length === 0) return nothing;

		return html`<gl-tooltip placement="bottom"
			><span class="branch-item__count"
				><code-icon icon="robot"></code-icon>${when(
					sessions.length > 1,
					() => html`<span>${sessions.length}</span>`,
				)}</span
			>
			<span slot="content">${pluralize('agent session', sessions.length)}</span></gl-tooltip
		>`;
	}

	private renderActiveAgentPills() {
		// Surface waiting-phase sessions on the card itself as full-width pills so the most
		// actionable affordance (Allow / Deny / More) is one click away. Working and idle sessions
		// stay quiet here and continue to render in `renderHoverAgents()` inside the rich hover.
		const sessions = this.agentSessions;
		if (sessions == null || sessions.length === 0) return nothing;

		const active = sessions.filter(s => s.phase === 'waiting');
		if (active.length === 0) return nothing;

		return html`<div class="branch-item__active-agents">
			${active.map(s => html`<gl-agent-status-pill full .session=${s}></gl-agent-status-pill>`)}
		</div>`;
	}

	private renderInlineActions() {
		// Inline actions surface only the most-relevant single action per state. The full set
		// (and PR-specific actions) live in the rich hover. Per #5170:
		// - Opened (current/active) branches: state-aware sync (Pull/Push/Fetch). One action,
		//   no alt-toggle — Pull/Fetch stay distinct so the click is unambiguous. NEVER Switch
		//   or Open Worktree — the user is already on this branch.
		// - Non-opened worktree branches: Open Worktree (new window default; alt-toggle to
		//   open in current window).
		// - Non-opened main-repo branches: Switch to Branch.
		const actions: TemplateResult[] = [];
		const opened = this.branch.opened;
		const upstream = this.branch.upstream;
		const tracking = upstream?.state;
		const hasUpstream = upstream != null && !upstream.missing;

		if (opened) {
			if (hasUpstream) {
				if (tracking?.behind) {
					actions.push(
						html`<action-item
							label="Pull"
							icon="repo-pull"
							href=${this.createCommandLink('gitlens.graph.pull')}
						></action-item>`,
					);
				} else if (tracking?.ahead) {
					actions.push(
						html`<action-item
							label="Push"
							icon="repo-push"
							href=${this.createCommandLink('gitlens.graph.push')}
						></action-item>`,
					);
				} else {
					actions.push(
						html`<action-item
							label="Fetch"
							icon="repo-fetch"
							href=${this.createCommandLink('gitlens.fetch:')}
						></action-item>`,
					);
				}
			} else {
				actions.push(
					html`<action-item
						label="Publish Branch"
						icon="cloud-upload"
						href=${this.createCommandLink('gitlens.publishBranch:')}
					></action-item>`,
				);
			}
		} else if (this.isWorktree) {
			actions.push(
				html`<action-item
					label="Open Worktree in New Window"
					alt-label="Open Worktree"
					icon="empty-window"
					alt-icon="browser"
					href=${this.createCommandLink('gitlens.openWorktreeInNewWindow:')}
					alt-href=${this.createCommandLink('gitlens.openWorktree:')}
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

		if (actions.length === 0) return nothing;
		return html`<action-nav class="branch-item__inline-actions">${actions}</action-nav>`;
	}

	private renderHoverContent() {
		const pr = this.enrichment?.pr;
		const issues = this.enrichment?.issues ?? [];
		const autolinks = this.enrichment?.autolinks ?? [];
		const contributors = this.enrichment?.contributors ?? [];

		const hasItems = pr != null || issues.length > 0 || autolinks.length > 0;

		return html`
			${this.renderHoverHeader(contributors)}
			${when(hasItems, () => this.renderHoverItems(pr, issues, autolinks))} ${this.renderHoverAgents()}
			${this.renderHoverActions(pr != null)}
		`;
	}

	private renderHoverAgents() {
		const sessions = this.agentSessions;
		if (sessions == null || sessions.length === 0) return nothing;

		return html`<div class="hover__section">
			<div class="hover__agents">
				${sessions.map(s => html`<gl-agent-status-pill .session=${s}></gl-agent-status-pill>`)}
			</div>
		</div>`;
	}

	private renderHoverMergeTarget(): TemplateResult | typeof nothing {
		// Only mount the chip after the user has actually opened the rich hover. Mounting also
		// triggers the lazy merge-target fetch via `onPopoverShow` → `ensureMergeTargetFetched`.
		// While the fetch is in flight, `_mergeTargetLoading` keeps the chip's `loading` affordance
		// (with `aria-busy="true"`) visible — without it, the chip would render `nothing` for the
		// fetch duration and pop in on resolution.
		if (!this._hoverShown) return nothing;

		const promise = this._mergeTargetPromise;
		if (promise == null) return nothing;
		return html`<gl-merge-target-status
			.branch=${this.branch}
			.targetPromise=${promise}
			?loading=${this._mergeTargetLoading}
		></gl-merge-target-status>`;
	}

	private renderHoverHeader(contributors: NonNullable<OverviewBranchEnrichment['contributors']>) {
		const worktreeName = this.branch.worktree?.name;
		const showWorktreeName = worktreeName != null && worktreeName !== this.branch.name;
		const timestamp = this.branch.timestamp;
		const dateFormat = 'MMMM Do, YYYY h:mma';

		return html`<div class="hover__section">
			<div class="hover__row">
				<span class="hover__icon">${this.renderBranchIcon()}</span>
				<span class="hover__name hover__name--bold">${this.branch.name}</span>
				${when(showWorktreeName, () => html`<span class="hover__identifier">${worktreeName}</span>`)}
				${when(
					contributors.length > 0,
					() =>
						html`<gl-avatar-list
							class="hover__avatars"
							.avatars=${contributors.map(a => ({ name: a.name, src: a.avatarUrl }))}
							max="8"
						></gl-avatar-list>`,
				)}
			</div>
			${when(timestamp != null, () => {
				const date = new Date(timestamp!);
				return html`<p class="hover__text hover__text--secondary">
					<time datetime="${date.toISOString()}">${formatDate(date, dateFormat)}</time>
					<span class="hover__muted">(${fromNow(date)})</span>
				</p>`;
			})}
		</div>`;
	}

	private renderHoverItems(
		pr: OverviewBranchEnrichment['pr'] | undefined,
		issues: NonNullable<OverviewBranchEnrichment['issues']>,
		autolinks: NonNullable<OverviewBranchEnrichment['autolinks']>,
	) {
		const launchpadItem = this.enrichment?.resolvedLaunchpad;
		const group = pr != null ? getLaunchpadItemGroup(pr, launchpadItem) : undefined;
		const grouping = getLaunchpadItemGrouping(group);
		const groupLabel = group != null ? launchpadGroupLabelMap.get(group) : undefined;
		const groupIcon = group != null ? launchpadGroupIconMap.get(group) : undefined;
		const groupIconString = groupIcon?.match(/\$\((.*?)\)/)?.[1].replace('gitlens', 'gl');

		return html`<div class="hover__section">
			${when(
				pr != null,
				() => html`
					<div class="hover__row">
						<span class="hover__icon">
							<pr-icon ?draft=${pr!.draft} state=${pr!.state} pr-id=${pr!.id}></pr-icon>
						</span>
						<span class="hover__name">
							<a href=${pr!.url} @click=${this.onLinkClick}>${pr!.title}</a>
						</span>
						<span class="hover__identifier">#${pr!.id}</span>
					</div>
					${when(
						grouping != null && groupLabel != null && groupIconString != null,
						() =>
							html`<p class="hover__launchpad hover__launchpad--${grouping}">
								<code-icon icon="${groupIconString!}"></code-icon
								><span>${groupLabel!.toUpperCase()}</span>
							</p>`,
					)}
				`,
			)}
			${[...issues, ...autolinks].map(item => this.renderHoverItemRow(item))}
		</div>`;
	}

	private renderHoverItemRow(item: OverviewBranchIssue) {
		const identifier = html`<span class="hover__identifier">${formatIssueIdentifier(item.id)}</span>`;
		const link = html`<span class="hover__name">
			<a href=${item.url} @click=${this.onLinkClick}>${item.title}</a>
		</span>`;

		switch (item.type) {
			case 'pullrequest':
				return html`<div class="hover__row">
					<span class="hover__icon">
						<pr-icon ?draft=${item.draft ?? false} state=${item.state} pr-id=${item.id}></pr-icon>
					</span>
					${link}${identifier}
				</div>`;
			case 'issue':
				return html`<div class="hover__row">
					<span class="hover__icon">
						<issue-icon state=${item.state} issue-id=${item.id}></issue-icon>
					</span>
					${link}${identifier}
				</div>`;
			default:
				return html`<div class="hover__row">
					<span class="hover__icon"><code-icon icon="link"></code-icon></span>
					${link}${identifier}
				</div>`;
		}
	}

	private renderHoverActions(hasPr: boolean) {
		// Curated set per #5170 — sync and "Open in View" live elsewhere (inline overlay /
		// scope popover), so the rich hover focuses on diff/compare/checkout flows. Order is:
		// 1. Open All Changes — PR multi-diff when there's a PR, otherwise the branch-vs-merge-
		//    base multi-diff. Skipped for the opened branch without a PR (lhs == rhs => empty).
		// 2. combined compares — default = Compare PR (if PR) / Compare with HEAD (else); alt
		//    flips to Compare with Working Tree. Opened branches collapse to just Working Tree
		//    since the branch IS HEAD.
		// 3. Open Worktree in New Window (worktrees only, alt opens in current window)
		// 4. Switch to Branch (non-worktree, non-opened)
		const opened = this.branch.opened;
		const actions: TemplateResult[] = [];

		if (hasPr) {
			actions.push(
				html`<action-item
					label="Open All Changes"
					icon="diff-multiple"
					href=${this.createCommandLink('gitlens.openPullRequestChanges:')}
				></action-item>`,
			);
		} else if (!opened) {
			actions.push(
				html`<action-item
					label="Open All Changes"
					icon="diff-multiple"
					href=${this.createCommandLink('gitlens.graph.openChangedFileDiffsWithMergeBase')}
				></action-item>`,
			);
		}

		if (opened) {
			actions.push(
				html`<action-item
					label="Compare with Working Tree"
					icon="gl-compare-ref-working"
					href=${this.createCommandLink('gitlens.graph.compareWithWorking')}
				></action-item>`,
			);
		} else if (hasPr) {
			actions.push(
				html`<action-item
					label="Compare Pull Request"
					icon="git-compare"
					href=${this.createCommandLink('gitlens.openPullRequestComparison:')}
					alt-label="Compare with Working Tree"
					alt-icon="gl-compare-ref-working"
					alt-href=${this.createCommandLink('gitlens.graph.compareWithWorking')}
				></action-item>`,
			);
		} else {
			actions.push(
				html`<action-item
					label="Compare with HEAD"
					icon="compare-changes"
					href=${this.createCommandLink('gitlens.graph.compareBranchWithHead')}
					alt-label="Compare with Working Tree"
					alt-icon="gl-compare-ref-working"
					alt-href=${this.createCommandLink('gitlens.graph.compareWithWorking')}
				></action-item>`,
			);
		}

		if (!opened) {
			if (this.isWorktree) {
				actions.push(
					html`<action-item
						label="Open Worktree in New Window"
						alt-label="Open Worktree"
						icon="empty-window"
						alt-icon="browser"
						href=${this.createCommandLink('gitlens.openWorktreeInNewWindow:')}
						alt-href=${this.createCommandLink('gitlens.openWorktree:')}
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
		}

		return html`<div class="hover__section hover__section--inline">
			<div class="hover__status-group">
				${this.renderTracking()}${this.renderHoverWipStats()}${this.renderHoverMergeTarget()}
			</div>
			<div class="hover__actions">
				<action-nav>${actions}</action-nav>
			</div>
		</div>`;
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

	/** Walk the composed event path to detect when a click/keydown originated inside an embedded
	 *  agent status pill — those are the pill's own affordance (Allow / Deny / More) and must not
	 *  trigger the card's "scope to branch" dispatch as a side effect. We deliberately don't
	 *  stopPropagation inside the pill itself because that would also break VS Code's webview
	 *  command:URL interception, which relies on link clicks reaching the document. */
	private isEventFromAgentPill(e: Event): boolean {
		const path = e.composedPath();
		for (const node of path) {
			if ((node as Element)?.tagName === 'GL-AGENT-STATUS-PILL') return true;
		}
		return false;
	}

	private onCardClick(e: MouseEvent) {
		if (this.isEventFromAgentPill(e)) return;

		this.dispatchBranchSelected();
	}

	private onCardKeydown(e: KeyboardEvent) {
		if (e.key !== 'Enter' && e.key !== ' ') return;
		if (this.isEventFromAgentPill(e)) return;

		e.preventDefault();
		this.dispatchBranchSelected();
	}

	private dispatchBranchSelected() {
		this.dispatchEvent(
			new CustomEvent('gl-graph-overview-branch-selected', {
				detail: {
					branchId: this.branch.id,
					branchName: this.branch.name,
					// Prefer the card-local resolved value (post-hover) over enrichment, which is
					// undefined for graph cards now that merge-target is fetched lazily. When both
					// are absent, graph-app falls through to firing its own lazy fetch and
					// `reconcileScopeMergeTarget` backfills the tip SHA when it arrives.
					mergeTargetTipSha: this._mergeTarget?.sha ?? this.enrichment?.mergeTarget?.sha,
				},
				bubbles: true,
				composed: true,
			}),
		);
	}

	private onLinkClick(e: Event) {
		e.stopPropagation();
	}

	private onActionItemClick(e: MouseEvent) {
		// Delegated to the popover host so it fires for clicks in both the inline action-nav
		// (inside the card) and the hover action-nav (inside the popover content slot). Native
		// click events compose through shadow boundaries, so composedPath surfaces the original
		// `<action-item>` target even when the event target has been retargeted upward.
		let action: ActionItem | undefined;
		let inline = false;
		for (const node of e.composedPath()) {
			const el = node as Element;
			if (action == null && el?.tagName === 'ACTION-ITEM') {
				action = el as ActionItem;
			} else if (!inline && el?.classList?.contains('branch-item__inline-actions')) {
				inline = true;
			}
			if (action != null && inline) break;
		}
		if (action == null) return;

		const altKeyPressed = e.altKey || e.shiftKey;
		const href = altKeyPressed && action.altHref ? action.altHref : action.href;
		if (href == null) return;

		emitTelemetrySentEvent<'graph/overview/action'>(this, {
			name: 'graph/overview/action',
			data: {
				name: commandToOverviewActionName(href),
				location: inline ? 'inline' : 'hover',
				alt: altKeyPressed,
			},
		});
	}
}

function commandToOverviewActionName(href: string): GraphOverviewActionName {
	// command URIs look like `command:gitlens.x?{...}` or `command:gitlens.x:graph?{...}` for
	// "commands with suffix". Capture the full id (up to `?` or end), then strip the trailing
	// `:graph` suffix the overview-card webview emits via createCommandLink.
	const match = /^command:([^?]+)/.exec(href);
	const command = match?.[1].replace(/:graph$/, '');
	switch (command) {
		case 'gitlens.graph.pull':
			return 'pull';
		case 'gitlens.graph.push':
			return 'push';
		case 'gitlens.fetch':
			return 'fetch';
		case 'gitlens.publishBranch':
			return 'publishBranch';
		case 'gitlens.switchToBranch':
			return 'switch';
		case 'gitlens.openWorktree':
		case 'gitlens.openWorktreeInNewWindow':
			return 'openWorktree';
		case 'gitlens.graph.compareBranchWithHead':
			return 'compareWithHead';
		case 'gitlens.graph.compareWithWorking':
			return 'compareWithWorking';
		case 'gitlens.openPullRequestComparison':
			return 'compareWithPr';
		default:
			return 'other';
	}
}

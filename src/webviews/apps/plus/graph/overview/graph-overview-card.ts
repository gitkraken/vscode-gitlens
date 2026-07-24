import type { Remote } from '@eamodio/supertalk';
import { consume } from '@lit/context';
import type { TemplateResult } from 'lit';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { when } from 'lit/directives/when.js';
import { pluralize } from '@gitlens/utils/string.js';
import type { AgentSessionState } from '../../../../../agents/models/agentSessionState.js';
import type { GlWebviewCommandsOrCommandsWithSuffix } from '../../../../../constants.commands.js';
import type { BranchRef } from '../../../../home/protocol.js';
import type { GraphServices } from '../../../../plus/graph/graphService.js';
import type {
	OverviewBranch,
	OverviewBranchEnrichment,
	OverviewBranchWip,
} from '../../../../shared/overviewBranches.js';
import type { ActionItem } from '../../../shared/components/actions/action-item.js';
import { srOnlyStyles } from '../../../shared/components/styles/lit/a11y.css.js';
import type { WebviewContext } from '../../../shared/contexts/webview.js';
import { webviewContext } from '../../../shared/contexts/webview.js';
import { emitTelemetrySentEvent } from '../../../shared/telemetry.js';
import type { AppState } from '../context.js';
import { graphServicesContext, graphStateContext } from '../context.js';
import {
	commandToOverviewActionName,
	getLaunchpadItemGroup,
	getLaunchpadItemGrouping,
} from '../utils/overviewActions.utils.js';
import '../components/gl-branch-hover.js';
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

		// Merge-target is fetched lazily by <gl-branch-hover> on first hover and published into shared
		// `overviewEnrichment`, which `graph-overview` passes straight back down as our `enrichment` prop.
		// So this stays absent until someone hovers the branch — by design, it's expensive.
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
	// Delegate focus so the parent's roving toolbar can drive the card as a single tab stop: a
	// roving `tabindex` set on this host gates the whole card in/out of the Tab order, and
	// `host.focus()` (arrow-key roving) lands on the inner focusable `gl-card`.
	static override shadowRootOptions: ShadowRootInit = {
		...LitElement.shadowRootOptions,
		delegatesFocus: true,
	};

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
			--gl-card-background: color-mix(
				in lab,
				var(--vscode-list-inactiveSelectionBackground) 100%,
				var(--vscode-foreground) 10%
			);
			--gl-card-hover-background: color-mix(
				in lab,
				var(--vscode-list-inactiveSelectionBackground) 100%,
				var(--vscode-foreground) 14%
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
			display: block;
			cursor: pointer;
		}

		gl-card::part(base) {
			padding: var(--gl-space-4) var(--gl-space-6);
			margin-block-end: 0;
			border-radius: var(--gl-radius-sm);
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
			gap: var(--gl-space-6);
			align-items: center;
			max-width: 100%;
			margin-block: 0;
		}

		.branch-item__icon {
			flex: none;
			color: var(--vscode-descriptionForeground);
		}

		.branch-item__name {
			flex-grow: 1;
			overflow: hidden;
			text-overflow: ellipsis;
			font-weight: bold;
			white-space: nowrap;
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
			gap: var(--gl-space-8);
			align-items: center;
			margin-block: 0;
			font-size: 0.9em;
			color: var(--vscode-descriptionForeground);
		}

		.branch-item__meta-left {
			display: inline-flex;
			gap: var(--gl-space-8);
			align-items: center;
			min-width: 0;
		}

		.branch-item__meta-right {
			display: inline-flex;
			gap: var(--gl-space-6);
			align-items: center;
			margin-inline-start: auto;
		}

		/* One-line layout: tracking + wip pill folded into the name row's right edge when there
	   are no issues / PRs / agents to take the second meta line. flex-none + margin-inline-start
	   keeps the pills hugging the right edge while the name shrinks first under width pressure. */
		.branch-item__meta-inline {
			display: inline-flex;
			flex: none;
			gap: var(--gl-space-6);
			align-items: center;
			margin-inline-start: auto;
			font-size: 0.9em;
			color: var(--vscode-descriptionForeground);
		}

		.branch-item__count {
			display: inline-flex;
			gap: 0.3rem;
			align-items: center;
			color: var(--vscode-descriptionForeground);
		}

		.branch-item__count code-icon {
			color: var(--vscode-descriptionForeground);
		}

		.branch-item__active-agents {
			display: flex;
			flex-direction: column;
			gap: var(--gl-space-4);

			/* flex-start so a compact-fallback pill (needs-input + !canResolve) shrinks to its
		   content instead of inheriting stretch. Full-mode pills still span the row via their
		   own width: 100%. */
			align-items: flex-start;
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
			top: 0;
			right: 0;
			bottom: 0;
			z-index: 2;
			display: inline-flex;
			align-items: center;
			padding: 0 var(--gl-space-4);
			font-size: 0.9em;
			background-color: var(--gl-card-hover-background);
		}

		.branch-item:not(:focus-within, :hover) .branch-item__inline-actions {
			${srOnlyStyles}
		}

		.wip__tooltip {
			display: contents;
			vertical-align: middle;
		}

		.wip__tooltip p {
			margin-block: 0;
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

	// Sticky: the rich hover has been opened at least once. Gates CONSTRUCTION of <gl-branch-hover>, so
	// a card that's never been hovered pays nothing for it.
	@state()
	private _hoverShown = false;

	// Live open state. Gates the hover's RENDERING — it stays mounted once shown (keeping its per-branch
	// merge-target/enrichment caches) but renders nothing while closed, so it registers no signal
	// dependencies and costs nothing on subsequent state ticks.
	@state()
	private _hoverOpen = false;

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

		const branchIndicator = getBranchCardIndicator(this.branch, this.wip, this.enrichment);
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
				trigger="hover focus-visible"
				placement="right"
				@gl-popover-show=${this.onPopoverShow}
				@gl-popover-after-hide=${this.onPopoverHide}
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
				${when(
					this._hoverShown,
					() => html`<gl-branch-hover
						slot="content"
						surface="overview"
						.branchId=${this.branch.id}
						.fallbackBranch=${this.branch}
						.wip=${this.wip}
						.open=${this._hoverOpen}
					></gl-branch-hover>`,
				)}
			</gl-popover>
		`;
	}

	private readonly onPopoverShow = () => {
		// `_hoverShown` is sticky (first open ever) and gates construction; `_hoverOpen` tracks the live
		// open state and gates rendering. Keeping the element mounted preserves its per-branch fetch
		// caches, while the `open` flag keeps a closed hover from re-rendering on state ticks. The
		// `graph/overview/hoverShown` telemetry is emitted by `<gl-branch-hover>` itself (with the right
		// `surface`), so both this card and the WIP bar report it identically.
		this._hoverOpen = true;
		this._hoverShown = true;
	};

	private readonly onPopoverHide = () => {
		this._hoverOpen = false;
	};

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
		// stay quiet here and continue to render inside the rich hover (<gl-branch-hover>).
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

	private isEventFromActionItem(e: Event): boolean {
		const path = e.composedPath();
		for (const node of path) {
			if ((node as Element)?.tagName === 'ACTION-ITEM') return true;
		}
		return false;
	}

	private onCardClick(e: MouseEvent) {
		if (this.isEventFromAgentPill(e) || this.isEventFromActionItem(e)) return;

		this.dispatchBranchSelected();
	}

	private onCardKeydown(e: KeyboardEvent) {
		if (e.key !== 'Enter' && e.key !== ' ') return;
		if (this.isEventFromAgentPill(e) || this.isEventFromActionItem(e)) return;

		e.preventDefault();
		this.dispatchBranchSelected();
	}

	private dispatchBranchSelected() {
		emitTelemetrySentEvent<'graph/overview/branchSelected'>(this, {
			name: 'graph/overview/branchSelected',
			data: {
				isActive: this.branch.opened,
				isWorktree: this.isWorktree,
				hasPr: this.enrichment?.pr != null,
				hasIssues: (this.enrichment?.issues?.length ?? 0) > 0 || (this.enrichment?.autolinks?.length ?? 0) > 0,
				hasWip: this.hasWip,
			},
		});

		this.dispatchEvent(
			new CustomEvent('gl-graph-overview-branch-selected', {
				detail: {
					branchId: this.branch.id,
					branchName: this.branch.name,
					// Merge-target is fetched lazily by <gl-branch-hover> and published into shared
					// `overviewEnrichment`, which `graph-overview` passes straight back down as our
					// `enrichment` prop. Absent until someone hovers this branch — graph-app then fires
					// its own lazy fetch and `reconcileScopeMergeTarget` backfills the tip SHA.
					mergeTargetTipSha: this.enrichment?.mergeTarget?.sha,
				},
				bubbles: true,
				composed: true,
			}),
		);
	}

	private onActionItemClick(e: MouseEvent) {
		// Bound on the popover host, so clicks from the hover's action-nav reach here too — but
		// <gl-branch-hover> emits its own `action` event (with the right surface), so bail on those or
		// we'd double-count. What's left is the card's own inline action-nav.
		let action: ActionItem | undefined;
		for (const node of e.composedPath()) {
			const el = node as Element;
			if (el?.tagName === 'GL-BRANCH-HOVER') return;

			// Native click events compose through shadow boundaries, so composedPath surfaces the
			// original `<action-item>` even though the event target has been retargeted upward.
			if (action == null && el?.tagName === 'ACTION-ITEM') {
				action = el as ActionItem;
			}
		}

		if (action == null) return;

		const altKeyPressed = e.altKey || e.shiftKey;
		const href = altKeyPressed && action.altHref ? action.altHref : action.href;
		if (href == null) return;

		emitTelemetrySentEvent<'graph/overview/action'>(this, {
			name: 'graph/overview/action',
			data: {
				name: commandToOverviewActionName(href),
				location: 'inline',
				surface: 'overview',
				alt: altKeyPressed,
			},
		});
	}
}

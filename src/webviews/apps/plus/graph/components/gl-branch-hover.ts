import type { Remote } from '@eamodio/supertalk';
import { SignalWatcher } from '@lit-labs/signals';
import { consume } from '@lit/context';
import type { PropertyValues, TemplateResult } from 'lit';
import { html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import { formatDate, fromNow } from '@gitlens/utils/date.js';
import type { AgentSessionState } from '../../../../../agents/models/agentSessionState.js';
import type { GlWebviewCommandsOrCommandsWithSuffix } from '../../../../../constants.commands.js';
import type { GraphBranchHoverSurface } from '../../../../../constants.telemetry.js';
import { isSubscriptionTrialOrPaidFromState } from '../../../../../plus/gk/utils/subscription.utils.js';
import { launchpadGroupIconMap, launchpadGroupLabelMap } from '../../../../../plus/launchpad/models/launchpad.js';
import type { BranchRef } from '../../../../home/protocol.js';
import type { GraphServices } from '../../../../plus/graph/graphService.js';
import type {
	OverviewBranch,
	OverviewBranchEnrichment,
	OverviewBranchIssue,
	OverviewBranchMergeTarget,
	OverviewBranchWip,
} from '../../../../shared/overviewBranches.js';
import { matchAgentSessionsForWorktree } from '../../../shared/agentUtils.js';
import type { ActionItem } from '../../../shared/components/actions/action-item.js';
import { boxSizingBase } from '../../../shared/components/styles/lit/base.css.js';
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
import { branchHoverStyles } from './gl-branch-hover.css.js';
import '../../shared/components/merge-target-status.js';
import '../../../shared/components/avatar/avatar-list.js';
import '../../../shared/components/actions/action-item.js';
import '../../../shared/components/actions/action-nav.js';
import '../../../shared/components/branch-icon.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/commit/wip-stats.js';
import '../../../shared/components/pills/agent-status-pill.js';
import '../../../shared/components/pills/tracking-status.js';
import '../../../shared/components/overlays/tooltip.js';
import '../../../shared/components/rich/issue-icon.js';
import '../../../shared/components/rich/pr-icon.js';

/** How long the hover must stay open before it spends any git/API work. Guards the keyboard path:
 *  `<gl-popover>` applies its `--show-delay` only to the *hover* trigger, so `focus-visible` opens
 *  instantly — arrow-keying across the WIP bar's pills would otherwise fire a merge-target chain and
 *  an enrichment request per pill passed through. */
const fetchSettleDelay = 150;

function formatIssueIdentifier(id: string): string {
	return isNaN(parseInt(id, 10)) ? id : `#${id}`;
}

function toBranchRef(branch: OverviewBranch): BranchRef {
	return {
		repoPath: branch.repoPath,
		branchId: branch.id,
		branchName: branch.name,
		worktree: branch.worktree ? { name: branch.worktree.name, isDefault: branch.worktree.isDefault } : undefined,
	};
}

/**
 * The rich branch hover, shared by the Graph's overview cards and its WIP bar pills so both surfaces
 * show the same thing: branch header (icon, worktree, contributors, timestamp), PR / Launchpad / issues
 * / autolinks, per-session agent pills, and a status row (tracking + WIP stats + merge target) alongside
 * the action nav.
 *
 * Self-resolving: takes a `branchId` and looks the branch, enrichment, and agent sessions up live from
 * `graphStateContext`, rather than having each anchor thread them down. Keying off the id (instead of
 * caching against the instance) is also what makes it safe under Lit's `repeat` recycling — the overview
 * card used to need a `willUpdate` hook to drop stale merge-target state when it was reused for a
 * different branch.
 *
 * Two things the anchor still owns:
 * - **`wip`** is a prop. The overview keeps its merged wip in a component-local field and only mirrors
 *   *enrichment* into shared state, so there is no single shared source to self-resolve from. Both
 *   anchors already hold their own wip; passing it down is cheaper than restructuring that pipeline.
 * - **`open`** gates rendering. While closed this renders `nothing` *before touching any signal*, so it
 *   registers no signal dependencies and a previously-hovered anchor costs nothing on subsequent agent
 *   ticks. Anchors should keep the element mounted (its per-branch fetch caches survive) and just flip
 *   `open`.
 */
@customElement('gl-branch-hover')
export class GlBranchHover extends SignalWatcher(LitElement) {
	static override styles = [boxSizingBase, branchHoverStyles];

	@consume({ context: webviewContext })
	private _webview!: WebviewContext;

	@consume({ context: graphServicesContext, subscribe: true })
	private _services?: Remote<GraphServices> | undefined;

	@consume({ context: graphStateContext, subscribe: true })
	private _graphState?: AppState;

	/** The branch this hover describes, in scope ref-id format (`{repoPath}|heads/{name}`). Undefined for
	 *  a detached worktree — the hover then degrades to whatever `fallbackBranch`/`wip` provide. */
	@property() branchId?: string;

	/** Which anchor this hover is mounted on. Segments telemetry; also routes the WIP-details request,
	 *  which only the overview panel listens for. */
	@property() surface: GraphBranchHoverSurface = 'overview';

	/** Whether the anchor's popover is actually showing. Drives both the render short-circuit and the
	 *  settle-gated lazy fetches. */
	@property({ type: Boolean }) open = false;

	@property({ attribute: false }) wip?: OverviewBranchWip;

	/** Used when `branchId` isn't in `state.overview` — a worktree branch only lands there when the
	 *  worktree is `opened` or its last commit is recent (`getBranchOverviewType`), so a dirty worktree on
	 *  an older branch has no overview entry. The WIP bar supplies the host's projection instead. */
	@property({ attribute: false }) fallbackBranch?: OverviewBranch;

	/** Display label for the degraded hover shown when no `OverviewBranch` resolves at all (a detached
	 *  worktree). The WIP bar passes the pill's label; the overview card never needs it. */
	@property() label?: string;

	/** False when the anchor's host has opted out of per-worktree `git status` on hover
	 *  (`graph.showWorktreeWipStats`). Suppresses the WIP-details upgrade and switches the pending-stats
	 *  message to a static one — enrichment and merge-target aren't what that setting is about. */
	@property({ type: Boolean, attribute: 'wip-details' }) wipDetails = true;

	@state() private _mergeTarget?: OverviewBranchMergeTarget;
	@state() private _mergeTargetLoading = false;
	private _mergeTargetPromise?: Promise<OverviewBranchMergeTarget | undefined>;
	private _mergeTargetFetchedFor?: string;
	/** The `wip` object we last requested a breakdown for — keyed by reference, not branch id, so a WIP
	 *  push (which replaces the object) re-enables the request. A branch id alone never changes, so once a
	 *  fetch failed it would suppress every retry for the branch's lifetime. */
	private _wipDetailsRequestedFor?: OverviewBranchWip;
	/** Set after the first open so `hoverShown` fires once per branch shown — reset on a `branchId` change
	 *  (see `willUpdate`) since a recycled pill swapped onto a new branch is a new, branch-specific view. */
	private _hoverShownEmitted = false;
	private _settleTimer?: ReturnType<typeof setTimeout>;

	private get branch(): OverviewBranch | undefined {
		const id = this.branchId;
		if (id != null) {
			const overview = this._graphState?.overview;
			const found = overview?.active.find(b => b.id === id) ?? overview?.recent.find(b => b.id === id);
			if (found != null) return found;
		}

		return this.fallbackBranch;
	}

	private get enrichment(): OverviewBranchEnrichment | undefined {
		return this.branchId != null ? this._graphState?.overviewEnrichment?.[this.branchId] : undefined;
	}

	private get agentSessions(): AgentSessionState[] | undefined {
		const branch = this.branch;
		if (branch == null) return undefined;

		// Graph strips the default worktree from `worktreesByBranch`, so an `opened` branch with no
		// `worktree` is the default worktree's HEAD — match it via `repoPath`. A non-`opened` branch with
		// no worktree isn't checked out anywhere, so no agent can be running on it; skipping the match
		// keeps the matcher's `worktreePath ?? repoPath` fallback from false-matching it to the default
		// worktree's session. (Mirrors `graph-overview`'s matching so the card sees the same set.)
		const worktreePath = branch.worktree?.path ?? (branch.opened ? branch.repoPath : undefined);
		if (worktreePath == null) return undefined;

		return matchAgentSessionsForWorktree(this._graphState?.agentSessions, {
			repoPath: branch.repoPath,
			worktreePath: worktreePath,
		});
	}

	private get hasWip(): boolean {
		if (this.wip?.hasChanges === true) return true;

		const wts = this.wip?.workingTreeState;
		return wts != null && wts.added + wts.changed + wts.deleted > 0;
	}

	override disconnectedCallback(): void {
		this.cancelSettle();
		super.disconnectedCallback?.();
	}

	private cancelSettle(): void {
		if (this._settleTimer != null) {
			clearTimeout(this._settleTimer);
			this._settleTimer = undefined;
		}
	}

	override willUpdate(changed: PropertyValues<this>): void {
		// A WIP-bar pill is keyed by worktree, not branch, so a checkout swaps this same instance onto a
		// different branch. Drop the merge-target cache synchronously (before render) so a recycled hover
		// never pairs the new branch with the previous branch's resolved merge target; the settle timer
		// then refetches. Reset `hoverShown` too — the event is branch-specific, so the new branch's view
		// must count rather than be suppressed by the prior branch's emit. (The overview card used to own
		// this via its own willUpdate.)
		if (changed.has('branchId')) {
			this._mergeTarget = undefined;
			this._mergeTargetPromise = undefined;
			this._mergeTargetLoading = false;
			this._mergeTargetFetchedFor = undefined;
			this._hoverShownEmitted = false;
		}
	}

	override updated(changed: PropertyValues<this>): void {
		// Emit `hoverShown` from whichever surface mounted us, so the event's `surface` field is accurate
		// for both anchors instead of only the overview card. Once per branch shown: the flag resets on a
		// `branchId` change (see `willUpdate`), so a pill recycled onto a new branch by a checkout re-fires.
		if (this.open && !this._hoverShownEmitted) {
			this._hoverShownEmitted = true;
			this.emitHoverShown();
		}

		if (!changed.has('open') && !changed.has('branchId') && !changed.has('wip')) return;

		if (!this.open) {
			this.cancelSettle();
			return;
		}

		// Settle before spending anything: a hover passed through (or a pill focused in transit by the
		// arrow keys) should cost nothing. Re-armed on `wip`/`branchId` changes so an open hover still
		// upgrades when its data replaces underneath it.
		this.cancelSettle();
		this._settleTimer = setTimeout(() => {
			this._settleTimer = undefined;
			if (!this.open) return;

			void this.ensureMergeTargetFetched();
			this.ensureEnrichmentFetched();
			this.maybeRequestWipDetails();
		}, fetchSettleDelay);
	}

	/** The overview fetches enrichment for its active/recent branches on mount. A WIP-bar pill's branch
	 *  may not be in that set at all, so ask for it additively — deduped against what's already resolved
	 *  or in flight, so re-hovering is free. */
	private ensureEnrichmentFetched(): void {
		if (this.surface === 'overview') return;

		const id = this.branchId;
		if (id == null || this.enrichment != null) return;

		this._graphState?.ensureEnrichmentFetchedForBranches([id]);
	}

	private maybeRequestWipDetails(): void {
		// The WIP bar fetches its own breakdown (leading-edge, on `mouseenter`) and nothing listens for
		// this event outside the overview panel. Honor the `graph.showWorktreeWipStats` opt-out too — this
		// is the per-worktree `git status` that setting exists to suppress.
		if (this.surface !== 'overview' || !this.wipDetails) return;

		const branchId = this.branchId;
		const wip = this.wip;
		if (branchId == null || wip == null) return;
		// Nothing dirty — no breakdown to fetch. Already have it — nothing to upgrade.
		if (wip.hasChanges !== true || wip.workingTreeState != null) return;
		// Keyed by the wip object, so a push (fresh object still lacking a breakdown) re-enables the
		// request after a failed fetch, but a plain re-render (same object) doesn't re-fire.
		if (this._wipDetailsRequestedFor === wip) return;

		this._wipDetailsRequestedFor = wip;
		this.dispatchEvent(
			new CustomEvent('gl-graph-overview-card-request-wip-details', {
				detail: { branchId: branchId },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private emitHoverShown(): void {
		const branch = this.branch;
		const enrichment = this.enrichment;
		emitTelemetrySentEvent<'graph/overview/hoverShown'>(this, {
			name: 'graph/overview/hoverShown',
			data: {
				surface: this.surface,
				isActive: branch?.opened ?? false,
				isWorktree: branch?.worktree != null,
				hasPr: enrichment?.pr != null,
				hasIssues: (enrichment?.issues?.length ?? 0) > 0 || (enrichment?.autolinks?.length ?? 0) > 0,
				hasWip: this.hasWip,
				hasAgents: (this.agentSessions?.length ?? 0) > 0,
			},
		});
	}

	private async ensureMergeTargetFetched(): Promise<void> {
		const branch = this.branch;
		if (branch == null) return;

		// Already fetched (or in flight) for this branch. The promise is reused across hovers;
		// <gl-merge-target-status> handles its own loading state.
		if (this._mergeTargetFetchedFor === branch.id && this._mergeTargetPromise != null) return;

		// Shared `overviewEnrichment` may already have it — published by a sibling anchor's fetch or the
		// click-to-scope path. Adopt it without re-fetching.
		const shared = this._graphState?.overviewEnrichment?.[branch.id]?.mergeTarget;
		if (shared != null) {
			this._mergeTargetFetchedFor = branch.id;
			this._mergeTarget = shared;
			this._mergeTargetPromise = Promise.resolve(shared);
			return;
		}

		// Non-pro users get no merge-target work — don't spend IPC + git producing data the chip won't render.
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
		// A `branchId` transition while awaiting may have moved us onto a different branch.
		if (this._mergeTargetFetchedFor !== branchId) return;

		this._mergeTarget = result;
		this._mergeTargetLoading = false;
		// Publish so the scope-anchor's `reconcileScopeMergeTarget` hook backfills the tip SHA — and so the
		// overview card's own `branch-merged` indicator can read it back out of shared state.
		this._graphState?.mergeMergeTargetIntoEnrichment(branchId, result);
	}

	override render(): unknown {
		// Short-circuit BEFORE reading any signal, so a closed hover registers no signal dependencies and
		// stays inert through agent/state ticks. (See the class doc — this is what makes it safe for the
		// anchor to keep every previously-hovered instance mounted.)
		if (!this.open) return nothing;

		const branch = this.branch;
		// A detached worktree resolves no `OverviewBranch` (no branch to key on) — fall back to a degraded
		// hover from the label + wip alone rather than an empty popover, matching the old tooltip's floor.
		if (branch == null) return this.renderDegraded();

		const enrichment = this.enrichment;
		const pr = enrichment?.pr;
		const issues = enrichment?.issues ?? [];
		const autolinks = enrichment?.autolinks ?? [];
		const contributors = enrichment?.contributors ?? [];
		const hasItems = pr != null || issues.length > 0 || autolinks.length > 0;

		return html`
			${this.renderHeader(branch, contributors)} ${when(hasItems, () => this.renderItems(pr, issues, autolinks))}
			${this.renderAgents()} ${this.renderActions(branch, pr != null)}
		`;
	}

	/** Fallback for a detached worktree, where no `OverviewBranch` resolves: header label + the working
	 *  changes we can render from `wip` alone. No PR/agents/actions — those all need a branch. */
	private renderDegraded() {
		const label = this.label;
		if (label == null && this.wip == null) return nothing;

		return html`
			<div class="section">
				${when(
					label != null,
					() => html`<div class="row">
						<span class="icon"><code-icon icon="gl-worktree"></code-icon></span>
						<span class="name name--bold">${label}</span>
					</div>`,
				)}
			</div>
			${when(
				this.wip != null,
				() => html`<div class="section"><div class="status-group">${this.renderWipStats()}</div></div>`,
			)}
		`;
	}

	private renderHeader(branch: OverviewBranch, contributors: NonNullable<OverviewBranchEnrichment['contributors']>) {
		const worktreeName = branch.worktree?.name;
		const showWorktreeName = worktreeName != null && worktreeName !== branch.name;
		const timestamp = branch.timestamp;

		return html`<div class="section">
			<div class="row">
				<span class="icon">
					<gl-branch-icon
						branch="${branch.name}"
						status="${branch.status}"
						?hasChanges=${this.hasWip}
						upstream=${branch.upstream?.name ?? ''}
						?worktree=${branch.worktree != null}
						?is-default=${branch.worktree?.isDefault ?? false}
					></gl-branch-icon>
				</span>
				<span class="name name--bold">${branch.name}</span>
				${when(showWorktreeName, () => html`<span class="identifier">${worktreeName}</span>`)}
				${when(
					contributors.length > 0,
					() =>
						html`<gl-avatar-list
							class="avatars"
							.avatars=${contributors.map(a => ({ name: a.name, src: a.avatarUrl }))}
							max="8"
						></gl-avatar-list>`,
				)}
			</div>
			${when(timestamp != null, () => {
				const date = new Date(timestamp!);
				return html`<p class="text text--secondary">
					<time datetime="${date.toISOString()}">${formatDate(date, 'MMMM Do, YYYY h:mma')}</time>
					<span class="muted">(${fromNow(date)})</span>
				</p>`;
			})}
		</div>`;
	}

	private renderItems(
		pr: OverviewBranchEnrichment['pr'] | undefined,
		issues: NonNullable<OverviewBranchEnrichment['issues']>,
		autolinks: NonNullable<OverviewBranchEnrichment['autolinks']>,
	) {
		const group = pr != null ? getLaunchpadItemGroup(pr, this.enrichment?.resolvedLaunchpad) : undefined;
		const grouping = getLaunchpadItemGrouping(group);
		const groupLabel = group != null ? launchpadGroupLabelMap.get(group) : undefined;
		const groupIcon = group != null ? launchpadGroupIconMap.get(group) : undefined;
		const groupIconString = groupIcon?.match(/\$\((.*?)\)/)?.[1].replace('gitlens', 'gl');

		return html`<div class="section">
			${when(
				pr != null,
				() => html`
					<div class="row">
						<span class="icon">
							<pr-icon ?draft=${pr!.draft} state=${pr!.state} pr-id=${pr!.id}></pr-icon>
						</span>
						<span class="name">
							<a href=${pr!.url} @click=${(e: Event) => this.onLinkClick(e, 'pullrequest')}
								>${pr!.title}</a
							>
						</span>
						<span class="identifier">#${pr!.id}</span>
					</div>
					${when(
						grouping != null && groupLabel != null && groupIconString != null,
						() =>
							html`<p class="launchpad launchpad--${grouping}">
								<code-icon icon="${groupIconString!}"></code-icon
								><span>${groupLabel!.toUpperCase()}</span>
							</p>`,
					)}
				`,
			)}
			${[...issues, ...autolinks].map(item => this.renderItemRow(item))}
		</div>`;
	}

	private renderItemRow(item: OverviewBranchIssue) {
		const identifier = html`<span class="identifier">${formatIssueIdentifier(item.id)}</span>`;
		const linkType: 'pullrequest' | 'issue' | 'autolink' =
			item.type === 'pullrequest' ? 'pullrequest' : item.type === 'issue' ? 'issue' : 'autolink';
		const link = html`<span class="name">
			<a href=${item.url} @click=${(e: Event) => this.onLinkClick(e, linkType)}>${item.title}</a>
		</span>`;

		switch (item.type) {
			case 'pullrequest':
				return html`<div class="row">
					<span class="icon">
						<pr-icon ?draft=${item.draft ?? false} state=${item.state} pr-id=${item.id}></pr-icon>
					</span>
					${link}${identifier}
				</div>`;
			case 'issue':
				return html`<div class="row">
					<span class="icon"><issue-icon state=${item.state} issue-id=${item.id}></issue-icon></span>
					${link}${identifier}
				</div>`;
			default:
				return html`<div class="row">
					<span class="icon"><code-icon icon="link"></code-icon></span>
					${link}${identifier}
				</div>`;
		}
	}

	private renderAgents() {
		const sessions = this.agentSessions;
		if (sessions == null || sessions.length === 0) return nothing;

		return html`<div class="section">
			<div class="agents">
				${sessions.map(s => html`<gl-agent-status-pill .session=${s}></gl-agent-status-pill>`)}
			</div>
		</div>`;
	}

	private renderTracking(branch: OverviewBranch) {
		const upstream = branch.upstream;
		if (upstream == null) {
			// No upstream — `gl-tracking-status` renders nothing, so a never-published branch's unpushed
			// commits would vanish from the hover entirely. Surface them as an outlined indicator box
			// matching the neighboring pills — just the arrow, with a tooltip carrying the meaning (there's
			// no count to show; the probe is a presence bit).
			if (this.wip?.hasUnpublishedCommits !== true) return nothing;

			return html`<gl-tooltip content="Unpublished commits" placement="bottom">
				<span class="unpublished" aria-label="Unpublished commits" tabindex="0">
					<code-icon icon="arrow-up"></code-icon>
				</span>
			</gl-tooltip>`;
		}

		return html`<gl-tracking-status
			.branchName=${branch.name}
			.upstreamName=${upstream.name}
			.missingUpstream=${upstream.missing ?? false}
			.ahead=${upstream.state.ahead}
			.behind=${upstream.state.behind}
			colorized
			outlined
		></gl-tracking-status>`;
	}

	private renderWipStats() {
		if (this.wip == null) return nothing;

		const dirty = this.hasWip;
		const workingTreeState = this.wip.workingTreeState;

		// The breakdown is fetched lazily, so a dirty branch can be open before its counts arrive —
		// `gl-wip-stats` would render an empty pill with nothing to explain it. Say so instead. When the
		// host opted out of hover fetches (`wipDetails` false), no breakdown is ever coming, so state that
		// rather than a perpetual "Loading…".
		if (dirty && workingTreeState == null) {
			return html`<span class="wip-status"
				>${!this.wipDetails
					? 'Has working changes'
					: this.wip.statsUnavailable === true
						? "Couldn't load changes"
						: 'Loading changes…'}</span
			>`;
		}

		// `badge` is consulted independently in the dirty and clean branches, so `!dirty` gets us exactly
		// what we want out of the shared component with no change to it: the numeric breakdown when dirty,
		// and the compact check pill (the same one the card renders inline) when clean. Keep its tooltip
		// (unlike the card's inline pill, which suppresses it because the popover carries the breakdown) —
		// here the tooltip IS the breakdown detail.
		return html`<gl-wip-stats
			?badge=${!dirty}
			show-clean
			.dirty=${dirty}
			added=${workingTreeState?.added ?? nothing}
			modified=${workingTreeState?.changed ?? nothing}
			removed=${workingTreeState?.deleted ?? nothing}
		></gl-wip-stats>`;
	}

	private renderMergeTarget(branch: OverviewBranch): TemplateResult | typeof nothing {
		const promise = this._mergeTargetPromise;
		if (promise == null) return nothing;

		return html`<gl-merge-target-status
			compact
			.branch=${branch}
			.targetPromise=${promise}
			?loading=${this._mergeTargetLoading}
		></gl-merge-target-status>`;
	}

	private renderActions(branch: OverviewBranch, hasPr: boolean) {
		// Curated set per #5170 — sync and "Open in View" live elsewhere (inline overlay / scope popover),
		// so the rich hover focuses on diff/compare/checkout flows.
		const opened = branch.opened;
		const isWorktree = branch.worktree != null;
		// Resolve the ref once — every `link()` below composes it, and the `branch` getter behind it does a
		// linear scan of the overview lists.
		const ref = toBranchRef(branch);
		const link = (command: GlWebviewCommandsOrCommandsWithSuffix) => this._webview.createCommandLink(command, ref);
		const actions: TemplateResult[] = [];

		if (hasPr) {
			actions.push(
				html`<action-item
					label="Open All Changes"
					icon="diff-multiple"
					href=${link('gitlens.openPullRequestChanges:')}
				></action-item>`,
			);
		} else if (!opened) {
			// Skipped for the opened branch without a PR — lhs == rhs, so the multi-diff would be empty.
			actions.push(
				html`<action-item
					label="Open All Changes"
					icon="diff-multiple"
					href=${link('gitlens.graph.openChangedFileDiffsWithMergeBase')}
				></action-item>`,
			);
		}

		if (opened) {
			// The branch IS HEAD, so the compares collapse to just the working tree.
			actions.push(
				html`<action-item
					label="Compare with Working Tree"
					icon="gl-compare-ref-working"
					href=${link('gitlens.graph.compareWithWorking')}
				></action-item>`,
			);
		} else if (hasPr) {
			actions.push(
				html`<action-item
					label="Compare Pull Request"
					icon="git-compare"
					href=${link('gitlens.openPullRequestComparison:')}
					alt-label="Compare with Working Tree"
					alt-icon="gl-compare-ref-working"
					alt-href=${link('gitlens.graph.compareWithWorking')}
				></action-item>`,
			);
		} else {
			actions.push(
				html`<action-item
					label="Compare with HEAD"
					icon="compare-changes"
					href=${link('gitlens.graph.compareBranchWithHead')}
					alt-label="Compare with Working Tree"
					alt-icon="gl-compare-ref-working"
					alt-href=${link('gitlens.graph.compareWithWorking')}
				></action-item>`,
			);
		}

		if (!opened) {
			if (isWorktree) {
				actions.push(
					html`<action-item
						label="Open Worktree in New Window"
						alt-label="Open Worktree"
						icon="empty-window"
						alt-icon="browser"
						href=${link('gitlens.openWorktreeInNewWindow:')}
						alt-href=${link('gitlens.openWorktree:')}
					></action-item>`,
				);
			} else {
				actions.push(
					html`<action-item
						label="Switch to Branch..."
						icon="gl-switch"
						href=${link('gitlens.switchToBranch:')}
					></action-item>`,
				);
			}
		}

		return html`<div class="section section--inline" @click=${this.onActionItemClick}>
			<div class="status-group">
				${this.renderTracking(branch)}${this.renderWipStats()}${this.renderMergeTarget(branch)}
			</div>
			<div class="actions"><action-nav>${actions}</action-nav></div>
		</div>`;
	}

	private onLinkClick(e: Event, type: 'pullrequest' | 'issue' | 'autolink') {
		e.stopPropagation();

		emitTelemetrySentEvent<'graph/overview/linkClicked'>(this, {
			name: 'graph/overview/linkClicked',
			data: { surface: this.surface, type: type },
		});
	}

	private onActionItemClick(e: MouseEvent) {
		// Never stopPropagation here: the actions are `command:` URI links and VS Code's webview
		// intercepts them at the document level, so swallowing the click would break them.
		let action: ActionItem | undefined;
		for (const node of e.composedPath()) {
			if ((node as Element)?.tagName === 'ACTION-ITEM') {
				action = node as ActionItem;
				break;
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
				location: 'hover',
				surface: this.surface,
				alt: altKeyPressed,
			},
		});
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-branch-hover': GlBranchHover;
	}
}

import { consume } from '@lit/context';
import type { PropertyValues, TemplateResult } from 'lit';
import { html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { arePathsEqual } from '@gitlens/utils/path.js';
import { pluralize } from '@gitlens/utils/string.js';
import type { AssociateIssueWithBranchCommandArgs } from '../../../../../plus/startWork/associateIssueWithBranch.js';
import { createCommandLink } from '../../../../../system/commands.js';
import type { State } from '../../../../plus/graph/detailsProtocol.js';
import type { GraphItemContext } from '../../../../plus/graph/protocol.js';
import type { BranchEnrichment, BranchMergeTargetStatus } from '../../../../rpc/services/branches.js';
import type { AiModelInfo } from '../../../../rpc/services/types.js';
import type { BranchAndTargetRefs, BranchRef } from '../../../../shared/branchRefs.js';
import type {
	OverviewBranchIssue,
	OverviewBranchMergeTarget,
	OverviewBranchPullRequest,
} from '../../../../shared/overviewBranches.js';
import { isAbortError, noopUnlessReal } from '../../../shared/actions/rpc.js';
import { elementBase, metadataBarVarsBase } from '../../../shared/components/styles/lit/base.css.js';
import type { WebviewContext } from '../../../shared/contexts/webview.js';
import { webviewContext } from '../../../shared/contexts/webview.js';
import type { ResolvedServices } from './detailsActions.js';
import { graphBranchSheetPaneStyles } from './gl-graph-branch-sheet-pane.css.js';
import './gl-compare-ai-actions.js';
import '../../../shared/components/chips/action-chip.js';
import '../../../shared/components/chips/autolink-chip.js';
import '../../../shared/components/chips/chip-overflow.js';
import '../../../shared/components/overlays/tooltip.js';
import '../../../shared/components/pills/tracking-status.js';
import '../../../shared/components/button.js';
import '../../../shared/components/button-container.js';
import '../../../shared/components/code-icon.js';

/** Minimal branch/tag identity carried by the `gl-graph-open-branch` event (a ref-pill click).
 *  `context` is the ref's serialized `data-vscode-context` (row-menu parity for the kebab + the
 *  remote/tag action links). */
export type BranchSheetRef = {
	name: string;
	refType: string;
	remote: string | null;
	sha: string | null;
	context?: string;
};

/** The synchronous branch snapshot resolved by {@link BranchEnrichment}. */
type BranchSnapshot = BranchEnrichment['branch'];

/** Per-ref cache so reopening the same ref within a session doesn't refetch. Sentinels
 *  (`hasMergeTarget` / `hasPullRequest`) distinguish "not fetched yet" from "fetched, none". */
interface BranchSheetCacheEntry {
	branch: BranchSnapshot;
	autolinks?: OverviewBranchIssue[];
	issues?: OverviewBranchIssue[];
	mergeTarget?: BranchMergeTargetStatus;
	hasMergeTarget?: boolean;
	pullRequest?: OverviewBranchPullRequest;
	hasPullRequest?: boolean;
}

type SheetStepAction = {
	actionLabel: string;
	tooltip?: string;
	icon?: string;
	/** In-flight state — renders a disabled spinner button that anchors the row's layout. */
	loading?: boolean;
} & ({ href: string; onClick?: never } | { onClick?: () => void; href?: never });

type SheetStep = {
	icon: string;
	iconFlip?: 'inline' | 'block';
	label: string;
	actionPrefixIcon?: string;
	/** Optional alt action — rendered as the small side of a split-button. */
	alt?: SheetStepAction;
} & SheetStepAction;

/** AI band scope — `unpushed` diffs the branch's own upstream..branch, `target` diffs its merge
 *  target..branch. */
type AiScope = 'unpushed' | 'target';

/** VS Code's command-link interceptor ignores untrusted (synthetic) clicks, so a programmatic
 *  `click()` on a raw `command:` anchor would fall through to real navigation and CSP-wedge the
 *  webview. Trusted clicks are intercepted upstream; kill the fallthrough for everything else. */
function onlyTrustedCommandLinkClicks(e: MouseEvent): void {
	if (!e.isTrusted) {
		e.preventDefault();
	}
}

/**
 * Branch overlay sheet content (P1 — local/current/worktree branches). Renders a metadata strip
 * mirroring `gl-details-wip-header` and a "Next steps" hub mirroring `gl-details-wip-empty-pane`,
 * re-scoped to the selected ref. Owns its own enrichment fetch + per-ref cache; each leg lands
 * independently into a reserved footprint so nothing reflows on arrival. Tag/remote refs render an
 * identity-only fallback until their P2 tailoring lands.
 */
@customElement('gl-graph-branch-sheet-pane')
export class GlGraphBranchSheetPane extends LitElement {
	static override styles = [elementBase, metadataBarVarsBase, graphBranchSheetPaneStyles];

	@consume({ context: webviewContext })
	private _webview!: WebviewContext;

	/** The ref this sheet is scoped to (name/refType/remote/sha). */
	@property({ attribute: false }) ref?: BranchSheetRef;
	/** Resolved RPC services accessor — used for enrichment fetch + checked-out pull/force-push. */
	@property({ attribute: false }) services?: ResolvedServices;
	@property({ attribute: 'repo-path' }) repoPath?: string;
	@property() dateFormat?: string;
	@property() dateStyle?: string;
	/** Whether AI features are enabled — gates the AI band section. */
	@property({ type: Boolean }) aiEnabled = false;
	@property({ attribute: false }) aiModel?: AiModelInfo;
	@property({ attribute: false }) orgSettings?: State['orgSettings'];
	/** Monotonic stamp bumped by the details panel whenever the graph's row/branch data changes.
	 *  Triggers an in-place enrichment refresh when the sheet is already open on this ref — actions
	 *  run FROM the sheet (push/pull/switch/delete via command links) land here instead of going stale. */
	@property({ type: Number }) changeStamp?: number;

	@state() private _branch?: BranchSnapshot;
	@state() private _autolinks?: OverviewBranchIssue[];
	@state() private _issues?: OverviewBranchIssue[];
	@state() private _mergeTarget?: BranchMergeTargetStatus;
	@state() private _mergeTargetLoading = false;
	@state() private _pullRequest?: OverviewBranchPullRequest;
	@state() private _pullRequestLoading = false;
	/** Tag tip-commit summary (for the tag tip line). */
	@state() private _tipMessage?: string;
	/** User's AI band scope pick — reset on ref identity change; falls back to the default
	 *  (unpushed when it exists, else target) when unset or no longer available. */
	@state() private _aiScope?: AiScope;
	@state() private _explainBusy = false;
	@state() private _generateChangelogBusy = false;

	private readonly _cache = new Map<string, BranchSheetCacheEntry>();
	private readonly _tipCache = new Map<string, string | undefined>();
	private _controller?: AbortController;
	private _loadedKey?: string;
	private _refreshTimer?: ReturnType<typeof setTimeout>;

	override disconnectedCallback(): void {
		this._controller?.abort();
		clearTimeout(this._refreshTimer);
		super.disconnectedCallback?.();
	}

	protected override willUpdate(changed: PropertyValues): void {
		const identityChanged = changed.has('ref') || changed.has('repoPath') || changed.has('services');
		if (!identityChanged) {
			if (changed.has('changeStamp')) {
				this.maybeRefreshEnrichment();
			}
			return;
		}

		const ref = this.ref;
		const repoPath = this.repoPath;
		const services = this.services;
		const key = ref != null && repoPath != null ? `${repoPath}\x1f${ref.refType}\x1f${ref.name}` : undefined;
		if (key === this._loadedKey) return;

		this._controller?.abort();
		// Drop any pending stamp-refresh for the previous ref — left armed, it would fire mid-flight
		// and abort the NEW ref's fetch, stranding its loading legs.
		clearTimeout(this._refreshTimer);
		this._refreshTimer = undefined;
		// A new ref's AI band re-derives its own default scope rather than inheriting the previous
		// ref's pick.
		this._aiScope = undefined;

		// Branch refs (local/current/worktree/remote): fetch enrichment. Remote surfaces only the PR
		// chip + Checkout row (per the gating table); the other legs land but stay ungated-off.
		if (ref != null && key != null && repoPath != null && (ref.refType === 'head' || ref.refType === 'remote')) {
			// Not ready yet — don't mark loaded so a later services/repoPath arrival re-enters here.
			if (services == null) return;

			this._loadedKey = key;
			this._tipMessage = undefined;
			// Remote branches need the full remote-qualified name — take it from the ref's context.
			const branchName = this.contextRefName() ?? ref.name;
			void this.loadEnrichment(key, repoPath, branchName, services);
			return;
		}

		// Tags: no branch enrichment; fetch the tip-commit summary for the tip line.
		this._loadedKey = key;
		this.resetEnrichmentState();
		if (ref?.refType === 'tag' && key != null && repoPath != null && ref.sha != null && services != null) {
			void this.loadTagTip(key, repoPath, ref.sha, services);
		} else {
			this._tipMessage = undefined;
		}
	}

	/** Row/branch data changed elsewhere (push/pull/switch/delete run FROM the sheet, or any other
	 *  graph update) while the sheet is showing a branch ref — schedule an in-place enrichment
	 *  refresh, bypassing the loaded-key gate. No-op for tags (no branch enrichment to refresh) or
	 *  when the stamp arrives for a ref other than the currently-loaded one. */
	private maybeRefreshEnrichment(): void {
		const ref = this.ref;
		const repoPath = this.repoPath;
		const services = this.services;
		const key = ref != null && repoPath != null ? `${repoPath}\x1f${ref.refType}\x1f${ref.name}` : undefined;
		if (ref == null || repoPath == null || services == null) return;
		if (key == null || key !== this._loadedKey) return;
		if (ref.refType !== 'head' && ref.refType !== 'remote') return;

		const branchName = this.contextRefName() ?? ref.name;
		this.scheduleEnrichmentRefresh(key, repoPath, branchName, services);
	}

	/** Debounces bursts of stamp changes (a page of row updates lands as several ticks) into a
	 *  single refetch, trailing ~500ms after the last one. */
	private scheduleEnrichmentRefresh(
		key: string,
		repoPath: string,
		branchName: string,
		services: ResolvedServices,
	): void {
		clearTimeout(this._refreshTimer);
		this._refreshTimer = setTimeout(() => {
			this._refreshTimer = undefined;
			// The ref may have changed while the debounce was pending — refreshing the old key would
			// abort the current ref's in-flight fetch.
			if (key !== this._loadedKey) return;

			void this.loadEnrichment(key, repoPath, branchName, services, true);
		}, 500);
	}

	private async loadEnrichment(
		key: string,
		repoPath: string,
		branchName: string,
		services: ResolvedServices,
		isRefresh = false,
	): Promise<void> {
		this._controller?.abort();
		const controller = new AbortController();
		this._controller = controller;
		const signal = controller.signal;

		if (!isRefresh) {
			// Hydrate from cache synchronously (instant continuity) or reset to loading (first visit).
			const cached = this._cache.get(key);
			if (cached != null) {
				this._branch = cached.branch;
				this._autolinks = cached.autolinks;
				this._issues = cached.issues;
				this._mergeTarget = cached.mergeTarget;
				this._mergeTargetLoading = !cached.hasMergeTarget;
				this._pullRequest = cached.pullRequest;
				this._pullRequestLoading = !cached.hasPullRequest;
			} else {
				this.resetEnrichmentState();
				this._mergeTargetLoading = true;
				this._pullRequestLoading = true;
			}
		}
		// On refresh, leave whatever is currently displayed alone — the fresh values land in place
		// as each leg resolves, so the sheet never flashes back to a loading/skeleton state.

		try {
			const enrichment = await services.branches.getBranchEnrichment(repoPath, branchName, signal);
			if (signal.aborted || this._loadedKey !== key) return;
			if (enrichment == null) {
				this._mergeTargetLoading = false;
				this._pullRequestLoading = false;
				// A refresh resolving null means the branch no longer exists (e.g. deleted from the
				// sheet) — ask the panel to close. An initial null just leaves the identity fallback.
				if (isRefresh) {
					this.dispatchEvent(
						new CustomEvent('gl-graph-branch-sheet-close-request', { bubbles: true, composed: true }),
					);
				}
				return;
			}

			this._branch = enrichment.branch;
			this.updateCache(key, { branch: enrichment.branch });

			void enrichment.autolinks.then(autolinks => {
				if (signal.aborted || this._loadedKey !== key) return;

				this._autolinks = autolinks;
				this.updateCache(key, { autolinks: autolinks });
			}, noopUnlessReal);

			void enrichment.issues.then(issues => {
				if (signal.aborted || this._loadedKey !== key) return;

				this._issues = issues;
				this.updateCache(key, { issues: issues });
			}, noopUnlessReal);

			void enrichment.mergeTargetStatus
				.then(mergeTarget => {
					if (signal.aborted || this._loadedKey !== key) return;

					const status: BranchMergeTargetStatus = { branch: enrichment.branch, mergeTarget: mergeTarget };
					this._mergeTarget = status;
					this.updateCache(key, { mergeTarget: status, hasMergeTarget: true });
				}, noopUnlessReal)
				.finally(() => {
					if (signal.aborted || this._loadedKey !== key) return;

					this._mergeTargetLoading = false;
				});

			void enrichment.pullRequest
				.then(pr => {
					if (signal.aborted || this._loadedKey !== key) return;

					this._pullRequest = pr;
					this.updateCache(key, { pullRequest: pr, hasPullRequest: true });
				}, noopUnlessReal)
				.finally(() => {
					if (signal.aborted || this._loadedKey !== key) return;

					this._pullRequestLoading = false;
				});
		} catch (ex) {
			if (isAbortError(ex) || this._loadedKey !== key) return;

			this._mergeTargetLoading = false;
			this._pullRequestLoading = false;
		}
	}

	private updateCache(key: string, patch: Partial<BranchSheetCacheEntry>): void {
		const existing = this._cache.get(key);
		if (existing != null) {
			this._cache.set(key, { ...existing, ...patch });
		} else if (patch.branch != null) {
			this._cache.set(key, { ...patch, branch: patch.branch });
		}
	}

	private resetEnrichmentState(): void {
		this._branch = undefined;
		this._autolinks = undefined;
		this._issues = undefined;
		this._mergeTarget = undefined;
		this._mergeTargetLoading = false;
		this._pullRequest = undefined;
		this._pullRequestLoading = false;
	}

	/** Fetch the tag's tip-commit summary for the tip line (best-effort; cached per key). */
	private async loadTagTip(key: string, repoPath: string, sha: string, services: ResolvedServices): Promise<void> {
		this._controller?.abort();
		const controller = new AbortController();
		this._controller = controller;
		const signal = controller.signal;

		if (this._tipCache.has(key)) {
			this._tipMessage = this._tipCache.get(key);
			return;
		}

		this._tipMessage = undefined;

		try {
			const commit = await services.repository.getCommit(repoPath, sha);
			if (signal.aborted || this._loadedKey !== key) return;

			const message = commit?.summary ?? commit?.message;
			this._tipMessage = message;
			this._tipCache.set(key, message);
		} catch {
			// Best-effort — the tip line just omits the message on failure.
		}
	}

	/** Parse the ref's serialized `data-vscode-context` into the typed graph context (for the
	 *  remote/tag action links). Returns `undefined` when absent or malformed. */
	private parseContext(): GraphItemContext | undefined {
		const context = this.ref?.context;
		if (context == null) return undefined;

		try {
			return JSON.parse(context) as GraphItemContext;
		} catch {
			return undefined;
		}
	}

	/** The ref's authoritative name from its context (full remote-qualified name for remotes). */
	private contextRefName(): string | undefined {
		const value = this.parseContext()?.webviewItemValue;
		return value != null && typeof value === 'object' && 'ref' in value ? value.ref.name : undefined;
	}

	/** The ref's display name — remote-qualified ("origin/main") for a remote ref, else the bare
	 *  name. `ref.name` alone is the bare branch name shared with its local tracking counterpart
	 *  (see `resolveRef` in gl-lit-graph), so a remote sheet needs the remote prefixed back on.
	 *  Prefers the authoritative name from the ref's context when available. */
	private displayName(ref: BranchSheetRef): string {
		if (ref.refType !== 'remote') return ref.name;
		return this.contextRefName() ?? (ref.remote != null ? `${ref.remote}/${ref.name}` : ref.name);
	}

	override render(): unknown {
		const ref = this.ref;
		if (ref == null) return nothing;

		switch (ref.refType) {
			case 'head':
				return html`${this.renderMetadata()}${this.renderHub()}`;
			case 'remote':
				return html`${this.renderRemoteStrip()}${this.renderRemoteHub(ref)}`;
			case 'tag':
				return html`${this.renderTagStrip(ref)}${this.renderTagHub(ref)}`;
			default:
				return this.renderIdentity(ref);
		}
	}

	private renderIdentity(ref: BranchSheetRef): TemplateResult {
		const icon = ref.refType === 'tag' ? 'tag' : 'git-branch';
		return html`<div class="identity">
			<div class="identity__name"><code-icon icon=${icon}></code-icon><span>${ref.name}</span></div>
			${ref.sha != null
				? html`<div class="identity__tip">
						Tip <code-icon icon="git-commit" size="12"></code-icon> ${ref.sha.slice(0, 7)}
					</div>`
				: nothing}
		</div>`;
	}

	private renderRemoteStrip(): TemplateResult | typeof nothing {
		if (this._pullRequest == null && !this._pullRequestLoading) return nothing;

		return html`<div class="metadata">
			<div class="strip-row">${this.renderPullRequest()}</div>
		</div>`;
	}

	private renderRemoteHub(ref: BranchSheetRef): TemplateResult | typeof nothing {
		const context = this.parseContext();
		if (context == null) return nothing;

		const step: SheetStep = {
			icon: 'gl-switch',
			label: `Switch to ${this.displayName(ref)}`,
			actionLabel: 'Switch',
			href: this._webview.createCommandLink<GraphItemContext>('gitlens.switchToBranch:', context),
		};
		return html`<div class="hub">
			<section class="section">
				<h3 class="section__heading">Next steps</h3>
				${this.renderStep(step)}
			</section>
		</div>`;
	}

	private renderTagStrip(ref: BranchSheetRef): TemplateResult | typeof nothing {
		if (ref.sha == null) return nothing;

		return html`<div class="metadata">
			<div class="strip-row">${this.renderTipLine(ref.sha)}</div>
		</div>`;
	}

	private renderTipLine(sha: string): TemplateResult {
		return html`<span class="tip-line">
			<code-icon icon="git-commit" size="12"></code-icon>
			<span class="tip-line__sha">${sha.slice(0, 7)}</span>
			${this._tipMessage != null ? html`<span class="tip-line__message">${this._tipMessage}</span>` : nothing}
		</span>`;
	}

	private renderTagHub(ref: BranchSheetRef): TemplateResult | typeof nothing {
		const context = this.parseContext();
		if (context == null) return nothing;

		const steps: SheetStep[] = [
			{
				icon: 'git-branch',
				label: `Create Branch from ${ref.name}`,
				actionLabel: 'Create Branch…',
				href: this._webview.createCommandLink<GraphItemContext>('gitlens.createBranch:', context),
			},
			{
				icon: 'gl-switch',
				label: `Switch to ${ref.name} (Detached)`,
				actionLabel: 'Switch',
				href: this._webview.createCommandLink<GraphItemContext>('gitlens.graph.switchToTag', context),
			},
		];
		return html`<div class="hub">
			<section class="section">
				<h3 class="section__heading">Next steps</h3>
				${steps.map(step => this.renderStep(step))}
			</section>
		</div>`;
	}

	/** One consolidated strip row — issues (chips + associate) on the left, actions (PR chip +
	 *  worktree ops) right-anchored. Identity chrome (name, kebab) lives in the sheet header. */
	private renderMetadata(): TemplateResult | typeof nothing {
		const branch = this._branch;
		if (branch?.reference == null) return nothing;

		const worktree = branch.worktree;
		const inOtherWorktree = this.isOtherWorktree(worktree);
		const associated = this._issues ?? [];
		const patternAutolinks = associated.length ? [] : (this._autolinks ?? []);
		const hasAny = associated.length > 0 || patternAutolinks.length > 0;

		return html`<div class="metadata">
			<div class="strip-row">
				${hasAny
					? html`<gl-chip-overflow max-rows="1" class="issues-chips">
							${associated.map(i => this.renderIssueChip(i, true))}
							${patternAutolinks.map(i => this.renderIssueChip(i, false))}
						</gl-chip-overflow>`
					: nothing}
				${this.renderAssociateIssue(branch.reference, hasAny)}
				<div class="branch-ops">
					${this.renderPullRequest()}
					${inOtherWorktree && worktree != null ? this.renderWorktreeOps(worktree) : nothing}
				</div>
			</div>
		</div>`;
	}

	private renderPullRequest(): TemplateResult | typeof nothing {
		if (this._branch == null) return nothing;

		const pr = this._pullRequest;
		if (pr == null) {
			// Reserve a small footprint while loading so a landing PR chip doesn't pop the row.
			if (this._pullRequestLoading) {
				return html`<span class="pull-request pull-request--loading" aria-busy="true"></span>`;
			}
			return nothing;
		}

		const status = pr.state === 'merged' || pr.state === 'closed' ? pr.state : 'opened';
		return html`<gl-autolink-chip
			class="pull-request"
			type="pr"
			name=${pr.title}
			url=${pr.url}
			identifier="#${pr.id}"
			status=${status}
			.date=${pr.updatedDate}
			.dateFormat=${this.dateFormat}
			.dateStyle=${this.dateStyle}
			.author=${pr.authorName}
			?isDraft=${pr.draft ?? false}
			.reviewDecision=${pr.reviewDecision}
			.itemId=${pr.id}
			.providerId=${pr.providerId}
			details
			openOnRemote
		></gl-autolink-chip>`;
	}

	private renderWorktreeOps(worktree: NonNullable<BranchSnapshot['worktree']>): TemplateResult {
		return html`<gl-action-chip
				icon="terminal"
				label="Open in Integrated Terminal"
				overlay="tooltip"
				href=${this._webview.createCommandLink('gitlens.openInIntegratedTerminal:', {
					worktreeUri: worktree.uri,
				})}
			></gl-action-chip>
			<gl-action-chip
				icon="empty-window"
				label="Open Worktree in New Window"
				alt-icon="window"
				alt-label="Open Worktree"
				overlay="tooltip"
				href=${this._webview.createCommandLink('gitlens.openWorktreeInNewWindow:', {
					worktreeUri: worktree.uri,
				})}
				alt-href=${this._webview.createCommandLink('gitlens.openWorktree:', { worktreeUri: worktree.uri })}
			></gl-action-chip>`;
	}

	private renderIssueChip(i: OverviewBranchIssue, associated: boolean): TemplateResult {
		const hasNumericId = !isNaN(parseInt(i.id, 10));
		const identifier = hasNumericId ? `#${i.id}` : i.id;
		const status = i.state === 'closed' ? 'closed' : 'opened';
		const type: 'issue' | 'autolink' = associated ? 'issue' : 'autolink';

		return html`<gl-autolink-chip
			type=${type}
			name=${i.title}
			url=${i.url}
			identifier=${identifier}
			status=${status}
			openOnRemote
		></gl-autolink-chip>`;
	}

	private renderAssociateIssue(
		reference: NonNullable<BranchSnapshot['reference']>,
		rightAligned: boolean,
	): TemplateResult {
		const href = createCommandLink<AssociateIssueWithBranchCommandArgs>('gitlens.associateIssueWithBranch', {
			command: 'associateIssueWithBranch',
			branch: reference,
			source: 'graph',
		});

		if (rightAligned) {
			return html`<gl-action-chip
				class="associate-issue"
				icon="link"
				label="Associate Issue with Branch"
				overlay="tooltip"
				href=${href}
			></gl-action-chip>`;
		}

		return html`<gl-action-chip
			class="associate-issue"
			icon="link"
			label="Associate Issue with Branch"
			overlay="tooltip"
			href=${href}
			>&nbsp;Associate Issue…</gl-action-chip
		>`;
	}

	private renderHub(): TemplateResult | typeof nothing {
		const branch = this._branch;
		if (branch == null) return nothing;

		const steps = this.computeSteps(branch);

		return html`<div class="hub">
			<div class="relationship-cards">
				${this.renderUpstreamCard(branch)}${this.renderMergeTargetCard(branch)}
			</div>
			${steps.length > 0
				? html`<section class="section">
						<h3 class="section__heading">Next steps</h3>
						${steps.map(step => this.renderStep(step))}
					</section>`
				: nothing}
			${this.renderAiBand(branch)}
		</div>`;
	}

	/** "Upstream" relationship card — the branch's own remote tracking counterpart, always rendered
	 *  once the branch snapshot resolves (upstream state arrives synchronously with it, so unlike the
	 *  merge-target card, this one never needs a loading shimmer). */
	private renderUpstreamCard(branch: BranchSnapshot): TemplateResult {
		const upstream = branch.upstream;
		const ahead = upstream?.state.ahead ?? 0;
		const behind = upstream?.state.behind ?? 0;
		const missing = upstream == null || upstream.missing;
		const branchRef = this.toBranchRef(branch);
		const checkoutPath = this.checkoutPath(branch);

		// Not-published is really just about Publish — collapse to a single row: token + Publish,
		// no status line, no pill (it would only echo "missing"), no fetch (nothing to fetch from).
		if (missing) {
			return html`<div class="relationship-card">
				<div class="relationship-card__head">
					${this.renderKindIcon('globe', 'Upstream')}
					${this.renderEditToken(
						upstream?.name ?? 'Not published',
						'Set Upstream…',
						this._webview.createCommandLink<BranchRef>('gitlens.git.branch.setUpstream:', branchRef),
						upstream?.name == null,
					)}
					<div class="relationship-card__actions">
						<gl-button
							appearance="secondary"
							href=${this._webview.createCommandLink<BranchRef>('gitlens.publishBranch:', branchRef)}
							>Publish</gl-button
						>
					</div>
				</div>
			</div>`;
		}

		let status: string;
		let stateAction: TemplateResult | typeof nothing = nothing;
		if (ahead > 0 && behind > 0) {
			status = `Diverged — ${pluralize('commit', behind)} to pull · ${pluralize('commit', ahead)} to push`;
			if (checkoutPath != null) {
				stateAction = html`<button-container>
					<gl-button appearance="secondary" @click=${() => this.pull(checkoutPath)}>Pull</gl-button>
					<gl-button appearance="secondary" @click=${() => this.forcePush(checkoutPath)}
						>Force Push</gl-button
					>
				</button-container>`;
			}
		} else if (behind > 0) {
			status = `${pluralize('commit', behind)} to pull`;
			if (checkoutPath != null) {
				stateAction = html`<gl-button appearance="secondary" @click=${() => this.pull(checkoutPath)}
					>Pull</gl-button
				>`;
			}
		} else if (ahead > 0) {
			status = `${pluralize('commit', ahead)} to push`;
			stateAction = html`<gl-button
				appearance="secondary"
				href=${this._webview.createCommandLink<BranchRef>('gitlens.pushBranch:', branchRef)}
				>Push</gl-button
			>`;
		} else {
			status = 'Up to date';
		}

		return html`<div class="relationship-card">
			<div class="relationship-card__head">
				${this.renderKindIcon('globe', 'Upstream')}
				${this.renderEditToken(
					upstream?.name ?? 'No upstream',
					upstream != null ? 'Change Upstream…' : 'Set Upstream…',
					this._webview.createCommandLink<BranchRef>('gitlens.git.branch.setUpstream:', branchRef),
					upstream?.name == null,
				)}
			</div>
			<div class="relationship-card__foot">
				<gl-tracking-status
					class="relationship-card__pill"
					.branchName=${branch.name}
					.upstreamName=${upstream?.name}
					.missingUpstream=${upstream?.missing ?? false}
					.ahead=${ahead}
					.behind=${behind}
					colorized
					outlined
				></gl-tracking-status>
				<span class="relationship-card__status">${status}</span>
				<div class="relationship-card__actions">
					${stateAction}
					<gl-action-chip
						class="relationship-card__fetch"
						icon="repo-fetch"
						label="Fetch"
						overlay="tooltip"
						href=${this._webview.createCommandLink<BranchRef>('gitlens.fetch:', branchRef)}
					></gl-action-chip>
				</div>
			</div>
		</div>`;
	}

	/** The counterpart name IS the edit affordance (no separate corner chip) — a token with a
	 *  dashed underline and a trailing edit icon that fades in on hover/focus. Shared by the
	 *  Upstream card's bare name and the Merge Target card's directional sentence. */
	private renderEditToken(text: string, tooltip: string, href: string, muted: boolean): TemplateResult {
		// Lead the tooltip with the full name — the visible text ellipsizes at narrow card widths.
		return html`<gl-tooltip content="${text} — ${tooltip}"
			><a
				class="relationship-card__token${muted ? ' relationship-card__token--muted' : ''}"
				href=${href}
				@click=${onlyTrustedCommandLinkClicks}
				><span class="relationship-card__token-text">${text}</span
				><code-icon class="relationship-card__token-icon" icon="pencil" size="12"></code-icon></a
		></gl-tooltip>`;
	}

	/** Scopes available to the AI band — `unpushed` (this branch's own upstream) and `target` (its
	 *  merge target), each carrying the `from`/`to` revs `explainCompare`/`generateChangelogCompare`
	 *  diff against and the label the scope chip shows. Either, both, or neither may be present. */
	private computeAiScopes(
		branch: BranchSnapshot,
	): Partial<Record<AiScope, { from: string; to: string; label: string }>> {
		const scopes: Partial<Record<AiScope, { from: string; to: string; label: string }>> = {};

		const upstream = branch.upstream;
		const ahead = upstream?.state.ahead ?? 0;
		if (upstream != null && !upstream.missing && ahead > 0) {
			scopes.unpushed = { from: upstream.name, to: branch.name, label: pluralize('unpushed commit', ahead) };
		}

		const mergeTarget = this._mergeTarget?.mergeTarget;
		if (mergeTarget != null) {
			scopes.target = { from: mergeTarget.name, to: branch.name, label: `all changes vs ${mergeTarget.name}` };
		}

		return scopes;
	}

	/** AI band — an Explain input + Generate Changelog chip scoped to either the branch's unpushed
	 *  commits or all changes vs its merge target, replacing the old fixed three-button grid. Hidden
	 *  once the branch is merged (nothing left to explain/changelog against a dead branch). */
	private renderAiBand(branch: BranchSnapshot): TemplateResult | typeof nothing {
		if (!this.aiEnabled) return nothing;
		if (this._mergeTarget?.mergeTarget?.mergedStatus?.merged) return nothing;

		const scopes = this.computeAiScopes(branch);
		if (scopes.unpushed == null && scopes.target == null) return nothing;

		const switchable = scopes.unpushed != null && scopes.target != null;
		const effective: AiScope =
			this._aiScope != null && scopes[this._aiScope] != null
				? this._aiScope
				: scopes.unpushed != null
					? 'unpushed'
					: 'target';
		const scope = scopes[effective]!;

		return html`<section class="section">
			<gl-compare-ai-actions
				.aiModel=${this.aiModel}
				.orgSettings=${this.orgSettings}
				.explainBusy=${this._explainBusy}
				.generateChangelogBusy=${this._generateChangelogBusy}
				.scopeLabel=${scope.label}
				.scopeSwitchable=${switchable}
				@gl-explain=${(e: CustomEvent<{ prompt?: string }>) => this.onAiExplain(scope, e.detail.prompt)}
				@gl-generate-changelog=${() => this.onAiGenerateChangelog(scope)}
				@gl-ai-scope-switch=${() => {
					this._aiScope = effective === 'unpushed' ? 'target' : 'unpushed';
				}}
			></gl-compare-ai-actions>
		</section>`;
	}

	private onAiExplain(scope: { from: string; to: string }, prompt: string | undefined): void {
		const branch = this._branch;
		if (branch == null || this.services == null) return;

		this._explainBusy = true;
		void this.services.graphInspect.explainCompare(branch.repoPath, scope.from, scope.to, prompt).finally(() => {
			this._explainBusy = false;
		});
	}

	private onAiGenerateChangelog(scope: { from: string; to: string }): void {
		const branch = this._branch;
		if (branch == null || this.services == null) return;

		this._generateChangelogBusy = true;
		void this.services.graphInspect.generateChangelogCompare(branch.repoPath, scope.from, scope.to).finally(() => {
			this._generateChangelogBusy = false;
		});
	}

	private computeSteps(branch: BranchSnapshot): SheetStep[] {
		const steps: SheetStep[] = [];
		const branchRef = this.toBranchRef(branch);
		// The ref's graph context (threaded from the pill) — unlocks the GraphItemContext-based
		// Create Worktree… and Create PR commands that have no BranchRef form.
		const context = this.parseContext();
		const worktree = branch.worktree;
		const checkedOut = branch.opened;
		const inOtherWorktree = this.isOtherWorktree(worktree);

		const upstreamMissing = branch.upstream == null || branch.upstream.missing;

		// Switch — a local branch not checked out anywhere. A branch on a (even closed) worktree
		// can't be switched to; its Worktree row below is the way "onto" it.
		if (!checkedOut && worktree == null) {
			steps.push({
				icon: 'gl-switch',
				label: `Switch to ${branch.name}`,
				actionLabel: 'Switch',
				href: this._webview.createCommandLink<BranchRef>('gitlens.switchToBranch:', branchRef),
				alt:
					context != null
						? {
								actionLabel: 'Create Worktree…',
								icon: 'gl-worktree',
								tooltip: 'Create Worktree…',
								href: this._webview.createCommandLink<GraphItemContext>(
									'gitlens.graph.createWorktree',
									context,
								),
							}
						: undefined,
			});
		}

		// Worktree — the branch is checked out in a worktree OTHER than the current window.
		if (inOtherWorktree && worktree != null) {
			steps.push({
				icon: 'gl-worktree',
				label: `In worktree · ${worktree.name}`,
				actionLabel: 'Open Worktree',
				href: this._webview.createCommandLink('gitlens.openWorktree:', { worktreeUri: worktree.uri }),
				alt: {
					actionLabel: 'Open Worktree in New Window',
					icon: 'empty-window',
					tooltip: 'Open Worktree in New Window',
					href: this._webview.createCommandLink('gitlens.openWorktreeInNewWindow:', {
						worktreeUri: worktree.uri,
					}),
				},
			});
		}

		// Tri-state PR row (published branches only, since an unpublished branch can't have a PR):
		// View → Checking… → Create PR. The no-PR Create PR leg uses the ref's GraphItemContext
		// (threaded from the pill); it collapses only when the context is unavailable.
		if (!upstreamMissing) {
			const pr = this._pullRequest;
			if (pr != null) {
				steps.push({
					icon: 'git-pull-request',
					label: `Pull Request #${pr.id}: ${pr.title}`,
					actionLabel: 'View',
					href: pr.url,
				});
			} else if (this._pullRequestLoading) {
				steps.push({
					icon: 'git-pull-request',
					label: 'Checking for pull request…',
					actionLabel: 'Checking',
					loading: true,
				});
			} else if (context != null) {
				steps.push({
					icon: 'git-pull-request-create',
					label: 'Create a Pull Request',
					actionLabel: 'Create PR',
					href: this._webview.createCommandLink<GraphItemContext>('gitlens.createPullRequest:', context),
				});
			}
		}

		// Review / Recompose — checked-out branches only (current or worktree); both target this ref
		// via its graph context (enter review mode / AI recompose the branch).
		if (checkedOut && context != null) {
			steps.push({
				icon: 'checklist',
				label: 'Review Changes',
				actionLabel: 'Review',
				href: this._webview.createCommandLink<GraphItemContext>('gitlens.reviewChanges:', context),
			});
			steps.push({
				icon: 'wand',
				label: 'Recompose Branch',
				actionLabel: 'Recompose',
				href: this._webview.createCommandLink<GraphItemContext>('gitlens.ai.recomposeBranch:', context),
			});
		}

		return steps;
	}

	/** Merge-target card state, computed once from `mergeTarget.mergedStatus` / `.potentialConflicts`
	 *  / `.status.behind`, in the same priority order as the old next-step's computation
	 *  (merged-locally → merged → conflict → behind → in-sync). */
	private mergeTargetCardState(
		mergeTarget: OverviewBranchMergeTarget,
	): 'merged' | 'conflicts' | 'behind' | 'in-sync' {
		if (mergeTarget.mergedStatus?.merged) return 'merged';
		if (mergeTarget.potentialConflicts?.status === 'conflicts') return 'conflicts';
		if ((mergeTarget.status?.behind ?? 0) > 0) return 'behind';
		return 'in-sync';
	}

	/** "Merge target" relationship card — an at-a-glance summary of the branch's relationship to its
	 *  merge target, with Rebase/Merge/Delete actions. Renders a shimmer placeholder while loading,
	 *  and nothing at all when the branch has no detected merge target. */
	private renderMergeTargetCard(branch: BranchSnapshot): TemplateResult | typeof nothing {
		const mergeTarget = this._mergeTarget?.mergeTarget;
		if (mergeTarget == null) {
			return this._mergeTargetLoading ? this.renderMergeTargetCardLoading() : nothing;
		}

		const state = this.mergeTargetCardState(mergeTarget);
		const actions = this.renderMergeTargetCardActions(branch, mergeTarget, state);
		const targetRef: BranchAndTargetRefs = {
			...this.toBranchRef(branch),
			mergeTargetId: mergeTarget.id,
			mergeTargetName: mergeTarget.name,
		};

		// Directional predicate of the sheet's subject — "Merges into ‹target›" — so the relationship
		// reads without knowing the term "merge target" and without repeating the branch name (the
		// sheet header names it directly above).
		return html`<div class="relationship-card">
			<div class="relationship-card__head">
				${this.renderKindIcon('gl-merge-target', 'Merge Target', state === 'conflicts')}
				<span class="relationship-card__connector">Merges into</span>
				${this.renderEditToken(
					mergeTarget.name,
					'Change Merge Target…',
					this._webview.createCommandLink<BranchAndTargetRefs>(
						'gitlens.git.branch.setMergeTarget:',
						targetRef,
					),
					false,
				)}
			</div>
			<div class="relationship-card__foot">
				<gl-tracking-status
					class="relationship-card__pill"
					.branchName=${branch.name}
					.upstreamName=${mergeTarget.name}
					.ahead=${mergeTarget.status?.ahead ?? 0}
					.behind=${mergeTarget.status?.behind ?? 0}
					colorized
					outlined
				></gl-tracking-status>
				<span class="relationship-card__status"
					>${this.renderMergeTargetCardStatusText(mergeTarget, state)}</span
				>
				${actions !== nothing ? html`<div class="relationship-card__actions">${actions}</div>` : nothing}
			</div>
		</div>`;
	}

	private renderMergeTargetCardLoading(): TemplateResult {
		return html`<div class="relationship-card relationship-card--loading" aria-busy="true">
			<div class="relationship-card__head">
				${this.renderKindIcon('gl-merge-target', 'Merge Target')}
				<div class="relationship-card__shimmer-line relationship-card__shimmer-line--head"></div>
			</div>
			<div class="relationship-card__shimmer-line relationship-card__shimmer-line--status"></div>
		</div>`;
	}

	/** Leading kind marker — a dim icon (globe = upstream, gl-merge-target = merge target) in place
	 *  of the louder uppercase badges; the tooltip carries the words. */
	private renderKindIcon(icon: string, kind: string, warn = false): TemplateResult {
		return html`<gl-tooltip content=${kind}
			><code-icon
				class="relationship-card__kind-icon${warn ? ' relationship-card__kind-icon--warn' : ''}"
				icon=${icon}
			></code-icon
		></gl-tooltip>`;
	}

	private renderMergeTargetCardStatusText(
		mergeTarget: OverviewBranchMergeTarget,
		state: 'merged' | 'conflicts' | 'behind' | 'in-sync',
	): string {
		switch (state) {
			case 'merged': {
				const mergedStatus = mergeTarget.mergedStatus;
				const likely = mergedStatus?.merged && mergedStatus.confidence !== 'highest';
				return `${likely ? 'Likely merged' : 'Merged'} into ${mergeTarget.name} — safe to delete`;
			}
			case 'conflicts': {
				const files =
					mergeTarget.potentialConflicts?.status === 'conflicts'
						? mergeTarget.potentialConflicts.conflict.files.length
						: 0;
				return `Potential conflicts in ${pluralize('file', files)} — resolving now avoids them at PR time`;
			}
			case 'behind': {
				const behind = mergeTarget.status?.behind ?? 0;
				const clean = mergeTarget.potentialConflicts?.status === 'clean';
				return `${pluralize('commit', behind)} behind — rebase or merge to catch up${clean ? ' · no conflicts expected' : ''}`;
			}
			case 'in-sync': {
				const ahead = mergeTarget.status?.ahead ?? 0;
				return ahead > 0
					? `Up to date with ${mergeTarget.name} — ${pluralize('commit', ahead)} of unique work`
					: `Up to date with ${mergeTarget.name}`;
			}
		}
	}

	/** Whether the Rebase/Merge pair applies — checked out somewhere (the commands run against the
	 *  branch's OWN checked-out worktree) and its own upstream settled (otherwise push/pull is the
	 *  bigger ask first). */
	private canRebaseOrMerge(branch: BranchSnapshot, state: 'merged' | 'conflicts' | 'behind' | 'in-sync'): boolean {
		if (state !== 'behind' && state !== 'conflicts') return false;
		if (!branch.opened && branch.worktree == null) return false;

		const upstream = branch.upstream;
		const upstreamMissing = upstream == null || upstream.missing;
		return upstreamMissing || ((upstream?.state.ahead ?? 0) === 0 && (upstream?.state.behind ?? 0) === 0);
	}

	/**
	 * Merge-target card actions — Rebase/Merge for behind/conflicts (checked-out + upstream-ready
	 * only, since the commands run against the branch's OWN checked-out worktree); Push/Delete for
	 * merged (not gated on checked-out — deleting doesn't require the branch to be checked out).
	 */
	private renderMergeTargetCardActions(
		branch: BranchSnapshot,
		mergeTarget: OverviewBranchMergeTarget,
		state: 'merged' | 'conflicts' | 'behind' | 'in-sync',
	): TemplateResult | typeof nothing {
		const branchRef = this.toBranchRef(branch);
		const isWorktree = this.isOtherWorktree(branch.worktree);
		const deleteLabel = isWorktree ? 'Delete Worktree' : 'Delete Branch';

		const mergedStatus = mergeTarget.mergedStatus;
		if (mergedStatus?.merged) {
			const targetRef: BranchRef = {
				repoPath: mergeTarget.repoPath,
				branchId: mergeTarget.id,
				branchName: mergeTarget.name,
			};

			if (mergedStatus.localBranchOnly) {
				const localTargetRef: BranchRef = {
					repoPath: branch.repoPath,
					branchId: mergedStatus.localBranchOnly.id!,
					branchName: mergedStatus.localBranchOnly.name,
					branchUpstreamName: mergedStatus.localBranchOnly.upstream?.name,
				};
				return html`<button-container>
					<gl-button
						appearance="secondary"
						href=${this._webview.createCommandLink<BranchRef>('gitlens.pushBranch:', localTargetRef)}
						>Push ${mergedStatus.localBranchOnly.name}</gl-button
					>
					<gl-button
						appearance="secondary"
						tooltip=${deleteLabel}
						href=${this._webview.createCommandLink<[BranchRef, BranchRef]>(
							'gitlens.deleteBranchOrWorktree:',
							[branchRef, localTargetRef],
						)}
						>${deleteLabel}</gl-button
					>
				</button-container>`;
			}

			return html`<gl-button
				appearance="secondary"
				href=${this._webview.createCommandLink<[BranchRef, BranchRef]>('gitlens.deleteBranchOrWorktree:', [
					branchRef,
					targetRef,
				])}
				>${deleteLabel}</gl-button
			>`;
		}

		if (!this.canRebaseOrMerge(branch, state)) return nothing;

		// "Current" (this window's checked-out branch) targets rebaseCurrentOnto/mergeIntoCurrent at
		// the merge target's own repoPath; a branch checked out in ANOTHER worktree instead targets
		// that worktree's repoPath, so the command resolves to THAT worktree's current branch — which
		// is this branch.
		const isCurrent = branch.opened && !isWorktree;
		const opsRepoPath = isCurrent ? mergeTarget.repoPath : (branch.worktree?.path ?? mergeTarget.repoPath);
		const targetRef: BranchRef = { repoPath: opsRepoPath, branchId: mergeTarget.id, branchName: mergeTarget.name };

		return html`<button-container>
			<gl-button
				appearance="secondary"
				tooltip=${`Rebase ${branch.name} onto ${mergeTarget.name} — ${mergeTarget.name} is not changed`}
				href=${this._webview.createCommandLink<BranchRef>('gitlens.rebaseCurrentOnto:', targetRef)}
				>Rebase</gl-button
			>
			<gl-button
				appearance="secondary"
				tooltip=${`Merge ${mergeTarget.name} into ${branch.name} — ${mergeTarget.name} is not changed`}
				href=${this._webview.createCommandLink<BranchRef>('gitlens.mergeIntoCurrent:', targetRef)}
				>Merge</gl-button
			>
		</button-container>`;
	}

	private renderStep(step: SheetStep): TemplateResult {
		const primaryInner = html`${step.actionPrefixIcon
			? html`<code-icon icon=${step.actionPrefixIcon} slot="prefix"></code-icon>`
			: nothing}${step.actionLabel}`;
		const primary = step.loading
			? html`<gl-button
					class="next-step__action"
					appearance="secondary"
					disabled
					aria-label=${step.actionLabel}
					tooltip=${ifDefined(step.tooltip)}
					><code-icon icon="loading" modifier="spin"></code-icon
				></gl-button>`
			: step.href != null
				? html`<gl-button class="next-step__action" appearance="secondary" href=${step.href}
						>${primaryInner}</gl-button
					>`
				: html`<gl-button class="next-step__action" appearance="secondary" @click=${() => step.onClick?.()}
						>${primaryInner}</gl-button
					>`;

		const alt = step.alt;
		const altInner = alt?.icon ? html`<code-icon icon=${alt.icon}></code-icon>` : alt?.actionLabel;
		const altButton =
			alt == null
				? nothing
				: alt.href != null
					? html`<gl-button appearance="secondary" tooltip=${alt.tooltip ?? alt.actionLabel} href=${alt.href}
							>${altInner}</gl-button
						>`
					: html`<gl-button
							appearance="secondary"
							tooltip=${alt.tooltip ?? alt.actionLabel}
							@click=${() => alt.onClick?.()}
							>${altInner}</gl-button
						>`;

		const action =
			alt != null
				? html`<button-container class="next-step__action">${primary}${altButton}</button-container>`
				: primary;

		return html`<div class="next-step">
			<code-icon class="next-step__icon" icon=${step.icon} flip=${ifDefined(step.iconFlip)}></code-icon>
			<span class="next-step__label">${step.label}</span>
			${action}
		</div>`;
	}

	private toBranchRef(branch: BranchSnapshot): BranchRef {
		return {
			repoPath: branch.repoPath,
			branchId: branch.id,
			branchName: branch.name,
			branchUpstreamName: branch.upstream?.name,
			worktree: branch.worktree
				? { name: branch.worktree.name, isDefault: branch.worktree.isDefault }
				: undefined,
		};
	}

	/** The path where the branch is checked out (its worktree, or the repo for the current branch),
	 *  or `undefined` when the branch isn't checked out anywhere. */
	private checkoutPath(branch: BranchSnapshot): string | undefined {
		return branch.worktree?.path ?? (branch.opened ? this.repoPath : undefined);
	}

	/** True when the branch lives in a worktree OTHER than the current window's. Derived by PATH
	 *  (not `worktree.isDefault`): when the workspace IS a linked worktree, the current branch's
	 *  worktree is non-default yet still the current window, so `isDefault` would misclassify it. */
	private isOtherWorktree(worktree: BranchSnapshot['worktree']): boolean {
		return worktree != null && !arePathsEqual(worktree.path, this.repoPath ?? '');
	}

	private pull(checkoutPath: string): void {
		void this.services?.repository.pull(checkoutPath);
	}

	private forcePush(checkoutPath: string): void {
		void this.services?.repository.push(checkoutPath, true);
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-graph-branch-sheet-pane': GlGraphBranchSheetPane;
	}
}

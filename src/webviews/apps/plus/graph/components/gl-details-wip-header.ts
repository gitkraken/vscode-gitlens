import { consume } from '@lit/context';
import type { TemplateResult } from 'lit';
import { html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { AssociateIssueWithBranchCommandArgs } from '../../../../../plus/startWork/associateIssueWithBranch.js';
import { createCommandLink } from '../../../../../system/commands.js';
import type { Wip } from '../../../../plus/graph/detailsProtocol.js';
import type { BranchMergeTargetStatus } from '../../../../rpc/services/branches.js';
import type { OverviewBranchIssue, OverviewBranchPullRequest } from '../../../../shared/overviewBranches.js';
import { renderDetailsMaximizeChip } from '../../../shared/components/details-header/details-maximize-chip.js';
import { elementBase, metadataBarVarsBase } from '../../../shared/components/styles/lit/base.css.js';
import type { WebviewContext } from '../../../shared/contexts/webview.js';
import { webviewContext } from '../../../shared/contexts/webview.js';
import type { NavigationState } from '../../../shared/controllers/navigationStack.js';
import type { RunningOperationExecState } from './detailsState.js';
import { detailsWipHeaderStyles } from './gl-details-wip-header.css.js';
import '../../shared/components/merge-rebase-status.js';
import '../../shared/components/merge-target-status.js';
import '../../../shared/components/chips/action-chip.js';
import '../../../shared/components/chips/autolink-chip.js';
import '../../../shared/components/chips/chip-overflow.js';
import '../../../shared/components/branch-name.js';
import '../../../shared/components/pills/tracking-status.js';
import '../../../shared/components/commit/wip-stats.js';
import '../../../shared/components/progress.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/details-header/gl-details-header.js';
import '../../../shared/components/nav-buttons.js';
import '../../../shared/components/overlays/tooltip.js';

@customElement('gl-details-wip-header')
export class GlDetailsWipHeader extends LitElement {
	static override styles = [elementBase, metadataBarVarsBase, detailsWipHeaderStyles];

	@consume({ context: webviewContext })
	private _webview!: WebviewContext;

	@property({ type: Object }) wip?: Wip;
	/** Path of the repo the graph is currently focused on. Used to detect when the displayed WIP
	 *  is for a secondary worktree (`wip.repo.path !== currentRepoPath`) so we can surface the
	 *  Open Worktree action. */
	@property() currentRepoPath?: string;
	@property() activeMode?: 'review' | 'compose' | 'resolve' | null;
	/** Pre-computed snippet shown on the right of the identity row while in mode (e.g. "7 files",
	 *  "Generating…", "3 commits · 7 files", "Error"). Computed by the host panel from scope +
	 *  resource + registry state. Hidden when `activeMode` is null. */
	@property({ attribute: false }) modeStatusText?: string | TemplateResult;
	/** Forwarded to `gl-details-header` — when true, close button becomes a back arrow that
	 *  pops the user out of the mode's results view to its scope picker. */
	@property({ type: Boolean }) inResultsView = false;
	/** Forwarded to `gl-details-header` — drives the suffix-icon status overlay on the compose
	 *  and review toggle chips, parallel to the WIP-row adornment buttons. The `hasResult` flag
	 *  separates a `'backed'` entry with a viewable result from a `'backed'`-no-result placeholder
	 *  (cancelled / first-error Go Back) so the chip doesn't falsely advertise a completed run. */
	@property({ attribute: false }) modeStatus?: Partial<
		Record<'review' | 'compose' | 'resolve', { execState: RunningOperationExecState; hasResult: boolean }>
	>;
	@property({ type: Boolean }) aiEnabled = false;
	@property({ type: Boolean }) loading = false;
	@property({ type: Array }) autolinks?: OverviewBranchIssue[];
	@property({ type: Array }) issues?: OverviewBranchIssue[];
	@property({ type: Object }) mergeTargetStatus?: BranchMergeTargetStatus;
	@property({ type: Boolean }) mergeTargetStatusLoading = false;
	@property({ type: Object }) pullRequest?: OverviewBranchPullRequest;
	@property({ type: Boolean }) pullRequestLoading = false;
	@property() dateFormat?: string;
	@property() dateStyle?: string;
	/** Back/forward history state from the graph host, rendered to the left of the jump button. */
	@property({ attribute: false }) navigation?: NavigationState;
	/** Graph-bottom-only: render the maximize/restore chip left of Refresh (and thread it into the
	 *  header's active-mode cluster). */
	@property({ type: Boolean, attribute: 'show-maximize' }) showMaximize = false;
	/** Drives the maximize chip's icon/label when `showMaximize` is true. */
	@property({ type: Boolean }) maximized = false;

	override render() {
		const wip = this.wip;
		if (!wip) return nothing;

		const branchName = wip.branch?.name;
		const files = wip.changes?.files ?? [];
		const upstream = wip.branch?.upstream;
		const ahead = wip.branch?.tracking?.ahead ?? 0;
		const behind = wip.branch?.tracking?.behind ?? 0;

		// Prefer the git-authoritative counts embedded in the wip (`wip.stats`, same object the
		// header/row badges derive `workingTreeStats` from) so the panel header and the graph
		// header/row can never disagree. Fall back to iterating the file list only when stats are
		// absent (e.g. a wip produced by the standalone commitDetails webview, which doesn't
		// compute diffStatus). Note: the file list double-counts mixed staged+unstaged entries,
		// whereas `git diff --shortstat` counts unique paths — `wip.stats` is the correct source.
		let addedCount: number;
		let modifiedCount: number;
		let removedCount: number;
		if (wip.stats != null) {
			addedCount = wip.stats.added;
			modifiedCount = wip.stats.modified;
			removedCount = wip.stats.deleted;
		} else {
			addedCount = 0;
			modifiedCount = 0;
			removedCount = 0;
			for (const f of files) {
				if (f.status === 'A' || f.status === '?') {
					addedCount++;
				} else if (f.status === 'D') {
					removedCount++;
				} else {
					modifiedCount++;
				}
			}
		}

		const isModeActive = this.activeMode != null;
		const isSecondaryWorktree =
			wip.repo?.path != null && this.currentRepoPath != null && wip.repo.path !== this.currentRepoPath;

		return html`<gl-details-header
			.activeMode=${this.activeMode}
			.modeStatus=${this.modeStatus}
			.loading=${this.loading}
			.modes=${this.computeWipModes()}
			.compareEnabled=${true}
			?show-maximize=${this.showMaximize}
			?maximized=${this.maximized}
			?in-results-view=${this.inResultsView}
		>
			<div class="graph-details-header__title-group">
				<span class="graph-details-header__wip-title">
					${this.activeMode === 'compose'
						? html`<code-icon class="graph-details-header__mode-icon" icon="wand"></code-icon
								><span class="graph-details-header__wip-title-text">Composing Changes</span>`
						: this.activeMode === 'review'
							? html`<code-icon class="graph-details-header__mode-icon" icon="checklist"></code-icon
									><span class="graph-details-header__wip-title-text">Reviewing Changes</span>`
							: this.activeMode === 'resolve'
								? html`<code-icon class="graph-details-header__mode-icon" icon="gl-merge"></code-icon
										><span class="graph-details-header__wip-title-text">Resolving Conflicts</span>`
								: html`<span class="graph-details-header__wip-title-text">Working Changes</span>`}
				</span>
				${!isModeActive
					? html`<gl-wip-stats
							.added=${addedCount}
							.modified=${modifiedCount}
							.removed=${removedCount}
							show-clean
						></gl-wip-stats>`
					: nothing}
			</div>
			${!isModeActive
				? html`${(this.navigation?.count ?? 0) > 1 || wip.branch?.reference?.sha != null
							? html`<span slot="actions" class="nav-jump">
									<gl-nav-buttons .navigation=${this.navigation}></gl-nav-buttons>
									${wip.branch?.reference?.sha != null
										? html`<gl-action-chip
												icon="download"
												label="Jump to Branch Tip"
												overlay="tooltip"
												@click=${this.onJumpToTipClick}
											></gl-action-chip>`
										: nothing}
								</span>`
							: nothing}
						${this.showMaximize ? renderDetailsMaximizeChip(this.maximized) : nothing}
						<gl-action-chip
							slot="actions"
							icon="refresh"
							label="Refresh"
							overlay="tooltip"
							@click=${() => this.emit('refresh-wip')}
						></gl-action-chip>`
				: nothing}
			${this.renderPausedOpStatus()}
			<div slot="secondary" class="graph-details-header__branch-row">
				<div class="branch-identity">
					${branchName
						? isModeActive
							? html`<gl-tooltip placement="bottom"
									><gl-branch-name
										class="graph-details-header__branch graph-details-header__branch--static"
										.name=${branchName}
									></gl-branch-name
									><span slot="content"><gl-branch-name .name=${branchName}></gl-branch-name></span
								></gl-tooltip>`
							: html`<gl-tooltip placement="bottom">
									<gl-branch-name
										appearance="button"
										class="graph-details-header__branch"
										chevron
										.name=${branchName}
										@click=${() => this.emit('switch-branch')}
									></gl-branch-name>
									<span slot="content"
										>Switch Branch...
										<hr />
										<gl-branch-name .name=${branchName}></gl-branch-name
									></span>
								</gl-tooltip>`
						: nothing}
					${!isModeActive
						? html`<div class="branch-actions">
								${this.renderBranchStateAction()}${this.renderFetchAction()}
							</div>`
						: nothing}
					${!isModeActive ? this.renderBranchActionsButton() : nothing}
					${isModeActive
						? html`<gl-wip-stats
								.added=${addedCount}
								.modified=${modifiedCount}
								.removed=${removedCount}
								show-clean
							></gl-wip-stats>`
						: nothing}
					<gl-tracking-status
						.branchName=${branchName}
						.upstreamName=${upstream?.name}
						.missingUpstream=${upstream?.missing ?? false}
						.ahead=${ahead}
						.behind=${behind}
						colorized
						outlined
					></gl-tracking-status>
					${this.renderMergeTargetStatus()}${this.renderAssociatedPullRequest()}
				</div>
				${!isModeActive
					? html`<div class="branch-ops">
							${files.length > 0
								? html`<gl-action-chip
										icon="gl-cloud-patch-share"
										label="Share as Cloud Patch"
										overlay="tooltip"
										@click=${() => this.emit('share-as-cloud-patch')}
									></gl-action-chip>`
								: nothing}
							<gl-action-chip
								icon="terminal"
								label="Open in Integrated Terminal"
								overlay="tooltip"
								href=${this._webview.createCommandLink('gitlens.openInIntegratedTerminal:', {
									worktreeUri: wip.repo.uri,
								})}
							></gl-action-chip>
							${isSecondaryWorktree
								? html`<gl-action-chip
										icon="empty-window"
										label="Open Worktree in New Window"
										alt-icon="window"
										alt-label="Open Worktree"
										overlay="tooltip"
										href=${this._webview.createCommandLink('gitlens.openWorktreeInNewWindow:', {
											worktreeUri: wip.repo.uri,
										})}
										alt-href=${this._webview.createCommandLink('gitlens.openWorktree:', {
											worktreeUri: wip.repo.uri,
										})}
									></gl-action-chip>`
								: nothing}
							${this.renderWipActionsButton()}
						</div>`
					: this.modeStatusText
						? html`<div class="mode-status">${this.modeStatusText}</div>`
						: nothing}
			</div>
			${!isModeActive ? this.renderIssuesRow() : nothing}
		</gl-details-header>`;
	}

	private renderBranchActionsButton() {
		// `wip.stats.branchContext` is the serialized `gitlens:branch` context built host-side, so this
		// kebab opens the same branch actions menu as a graph branch row. Undefined on detached HEAD.
		const context = this.wip?.stats?.branchContext;
		if (context == null) return nothing;

		return html`<gl-action-chip
			icon="kebab-vertical"
			label="Show Branch Actions"
			overlay="tooltip"
			data-vscode-context=${context}
			@click=${this.onMoreActionsClick}
		></gl-action-chip>`;
	}

	private renderWipActionsButton() {
		// `wip.stats.context` is the serialized `GraphItemContext` for the WIP row's right-click menu,
		// so reusing it here opens the identical context menu with zero drift. The host panel's
		// `ContextMenuProxyController` copies `data-vscode-context` into light DOM on `contextmenu`.
		const context = this.wip?.stats?.context;
		if (context == null) return nothing;

		return html`<gl-action-chip
			icon="kebab-vertical"
			label="Show More Actions"
			overlay="tooltip"
			data-vscode-context=${context}
			@click=${this.onMoreActionsClick}
		></gl-action-chip>`;
	}

	private onMoreActionsClick = (e: MouseEvent): void => {
		e.preventDefault();
		e.stopPropagation();

		const target = e.currentTarget as HTMLElement | null;
		if (target == null) return;

		const rect = target.getBoundingClientRect();
		target.dispatchEvent(
			new MouseEvent('contextmenu', {
				bubbles: true,
				composed: true,
				cancelable: true,
				clientX: rect.left,
				clientY: rect.bottom,
				button: 2,
			}),
		);
	};

	private computeWipModes(): ('review' | 'compose' | 'resolve')[] {
		if (!this.aiEnabled) return [];
		// Surface the Resolve toggle only when the WIP has conflicts (a paused merge/rebase) —
		// resolve operates on the conflicted-file set, so it's meaningless otherwise. It leads
		// the cluster when present: resolving is the primary action for a conflicted WIP.
		return this.wip?.changes?.hasConflicts ? ['resolve', 'compose', 'review'] : ['compose', 'review'];
	}

	private renderBranchStateAction() {
		const branch = this.wip?.branch;
		if (!branch) return nothing;

		if (branch.upstream == null || branch.upstream.missing === true) {
			return html`<gl-action-chip
				icon="cloud-upload"
				label="Publish Branch"
				overlay="tooltip"
				@click=${() => this.emit('publish-branch')}
			></gl-action-chip>`;
		}

		const ahead = branch.tracking?.ahead ?? 0;
		const behind = branch.tracking?.behind ?? 0;

		if (ahead > 0 && behind > 0) {
			return html`<gl-action-chip
					icon="repo-pull"
					label="Pull"
					overlay="tooltip"
					@click=${() => this.emit('pull')}
				></gl-action-chip>
				<gl-action-chip
					icon="repo-force-push"
					label="Force Push"
					overlay="tooltip"
					@click=${() => this.emit('force-push')}
				></gl-action-chip>`;
		}

		if (behind > 0) {
			return html`<gl-action-chip
				icon="repo-pull"
				label="Pull"
				overlay="tooltip"
				@click=${() => this.emit('pull')}
			></gl-action-chip>`;
		}

		if (ahead > 0) {
			return html`<gl-action-chip
				icon="repo-push"
				label="Push"
				overlay="tooltip"
				@click=${() => this.emit('push')}
			></gl-action-chip>`;
		}

		return nothing;
	}

	private renderFetchAction() {
		if (!this.wip?.branch) return nothing;

		return html`<gl-action-chip
			icon="repo-fetch"
			label="Fetch"
			overlay="tooltip"
			@click=${() => this.emit('fetch')}
		></gl-action-chip>`;
	}

	private renderPausedOpStatus() {
		const pausedOpStatus = this.wip?.changes?.pausedOpStatus;
		if (pausedOpStatus == null) return nothing;

		return html`<div slot="secondary" class="graph-details-header__paused-op">
			<gl-merge-rebase-status
				?conflicts=${this.wip?.changes?.hasConflicts ?? false}
				?ai-resolve=${this.aiEnabled}
				?ai-resume=${this.aiEnabled}
				?readonly=${this.activeMode != null}
				.pausedOpStatus=${pausedOpStatus}
			></gl-merge-rebase-status>
		</div>`;
	}

	private renderMergeTargetStatus() {
		// Hidden while any mode (compose/review/resolve) is active — the mode takes over the row.
		if (this.activeMode != null) return nothing;
		if (this.wip?.branch == null) return nothing;

		const status = this.mergeTargetStatus;
		const loading = this.mergeTargetStatusLoading;
		const showComponent = status != null || loading;
		return html`<span class="graph-details-header__merge-target-slot">
			${showComponent
				? html`<gl-merge-target-status
						class="graph-details-header__merge-target"
						.branch=${status?.branch}
						.targetPromise=${status != null ? Promise.resolve(status.mergeTarget) : undefined}
						?loading=${status == null && loading}
					></gl-merge-target-status>`
				: nothing}
		</span>`;
	}

	private renderAssociatedPullRequest() {
		if (this.wip?.branch == null) return nothing;

		const pr = this.pullRequest;
		if (pr == null) {
			// While loading reserve a small footprint so a landing PR chip doesn't pop the
			// branch-identity row sideways. Mirrors the merge-target slot's loading pattern.
			// Collapses to nothing once loading settles with no PR — many branches don't have one.
			if (this.pullRequestLoading) {
				return html`<span
					class="graph-details-header__pull-request graph-details-header__pull-request--loading"
					aria-busy="true"
				></span>`;
			}
			return nothing;
		}

		const status = pr.state === 'merged' || pr.state === 'closed' ? pr.state : 'opened';
		return html`<gl-autolink-chip
			class="graph-details-header__pull-request"
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

	private renderIssuesRow() {
		const branchReference = this.wip?.branch?.reference ?? this.mergeTargetStatus?.branch.reference;
		if (branchReference == null) return nothing;

		const associated = this.issues ?? [];
		const patternAutolinks = associated.length ? [] : (this.autolinks ?? []);
		const hasAny = associated.length > 0 || patternAutolinks.length > 0;

		return html`<div slot="secondary" class="graph-details-header__issues">
			${hasAny
				? html`<gl-chip-overflow max-rows="1" class="graph-details-header__issues-chips">
						${associated.map(i => this.renderIssueChip(i, true))}
						${patternAutolinks.map(i => this.renderIssueChip(i, false))}
					</gl-chip-overflow>`
				: nothing}
			${this.renderAssociateIssueAction(branchReference, hasAny)}
		</div>`;
	}

	private renderIssueChip(i: OverviewBranchIssue, associated: boolean) {
		const hasNumericId = !isNaN(parseInt(i.id, 10));
		const identifier = hasNumericId ? `#${i.id}` : i.id;
		const status = i.state === 'closed' ? 'closed' : 'opened';
		const type: 'issue' | 'autolink' = associated ? 'issue' : 'autolink';

		const chip = html`<gl-autolink-chip
			type=${type}
			name=${i.title}
			url=${i.url}
			identifier=${identifier}
			status=${status}
			openOnRemote
		></gl-autolink-chip>`;

		if (!associated || i.entityId == null) return chip;

		return html`<span class="issue-chip-group" data-associated="true">
			${chip}
			<gl-tooltip placement="bottom" content="Remove Branch Association">
				<button
					class="issue-chip-group__remove"
					type="button"
					aria-label="Remove Branch Association"
					@click=${(e: MouseEvent) => this.handleRemoveAssociatedIssue(e, i.entityId!)}
				>
					<code-icon icon="close" size="12"></code-icon>
				</button>
			</gl-tooltip>
		</span>`;
	}

	private renderAssociateIssueAction(
		branchReference: NonNullable<BranchMergeTargetStatus['branch']['reference']>,
		rightAligned: boolean,
	) {
		const href = createCommandLink<AssociateIssueWithBranchCommandArgs>('gitlens.associateIssueWithBranch', {
			command: 'associateIssueWithBranch',
			branch: branchReference,
			source: 'graph',
		});

		if (rightAligned) {
			return html`<gl-action-chip
				class="associate-issue-action associate-issue-action--trailing"
				icon="link"
				label="Associate Issue with Branch"
				overlay="tooltip"
				href=${href}
			></gl-action-chip>`;
		}

		return html`<gl-action-chip
			class="associate-issue-action"
			icon="link"
			label="Associate Issue with Branch"
			overlay="tooltip"
			href=${href}
			>&nbsp;Associate Issue…</gl-action-chip
		>`;
	}

	private handleRemoveAssociatedIssue(e: MouseEvent, entityId: string) {
		e.preventDefault();
		e.stopPropagation();
		this.dispatchEvent(
			new CustomEvent('remove-associated-issue', {
				detail: { entityId: entityId },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private onJumpToTipClick = (): void => {
		const sha = this.wip?.branch?.reference?.sha;
		if (!sha) return;

		this.dispatchEvent(
			new CustomEvent('gl-jump-to-commit', {
				detail: { sha: sha },
				bubbles: true,
				composed: true,
			}),
		);
	};

	private emit(name: string) {
		this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true }));
	}
}

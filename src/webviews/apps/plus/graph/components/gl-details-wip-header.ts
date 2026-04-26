import { html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { AssociateIssueWithBranchCommandArgs } from '../../../../../plus/startWork/associateIssueWithBranch.js';
import { createCommandLink } from '../../../../../system/commands.js';
import type { Wip } from '../../../../plus/graph/detailsProtocol.js';
import type { BranchMergeTargetStatus } from '../../../../rpc/services/branches.js';
import type { OverviewBranchIssue } from '../../../../shared/overviewBranches.js';
import { elementBase, metadataBarVarsBase } from '../../../shared/components/styles/lit/base.css.js';
import { detailsWipHeaderStyles } from './gl-details-wip-header.css.js';
import '../../shared/components/merge-target-status.js';
import '../../../shared/components/chips/action-chip.js';
import '../../../shared/components/chips/autolink-chip.js';
import '../../../shared/components/chips/chip-overflow.js';
import '../../../shared/components/branch-name.js';
import '../../../shared/components/pills/tracking.js';
import '../../../shared/components/commit/commit-stats.js';
import '../../../shared/components/progress.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/details-header/gl-details-header.js';
import '../../../shared/components/overlays/tooltip.js';

@customElement('gl-details-wip-header')
export class GlDetailsWipHeader extends LitElement {
	static override styles = [elementBase, metadataBarVarsBase, detailsWipHeaderStyles];

	@property({ type: Object }) wip?: Wip;
	@property() activeMode?: 'review' | 'compose' | 'compare' | null;
	@property({ type: Boolean }) aiEnabled = false;
	@property({ type: Boolean }) loading = false;
	@property({ type: Array }) autolinks?: OverviewBranchIssue[];
	@property({ type: Array }) issues?: OverviewBranchIssue[];
	@property({ type: Object }) mergeTargetStatus?: BranchMergeTargetStatus;
	@property({ type: Boolean }) mergeTargetStatusLoading = false;

	override render() {
		const wip = this.wip;
		if (!wip) return nothing;

		const branchName = wip.branch?.name;
		const files = wip.changes?.files ?? [];
		const tracking = wip.branch?.tracking;
		const ahead = tracking?.ahead ?? 0;
		const behind = tracking?.behind ?? 0;

		let addedCount = 0;
		let modifiedCount = 0;
		let removedCount = 0;
		for (const f of files) {
			if (f.status === 'A' || f.status === '?') {
				addedCount++;
			} else if (f.status === 'D') {
				removedCount++;
			} else {
				modifiedCount++;
			}
		}

		const isModeActive = this.activeMode != null;

		return html`<gl-details-header
			.activeMode=${this.activeMode}
			.loading=${this.loading}
			.modes=${this.computeWipModes()}
			style="--mode-header-bg: var(--titlebar-bg, var(--color-background--level-05)); --mode-header-tint: 20%"
		>
			<div class="graph-details-header__title-group">
				<span class="graph-details-header__wip-title"
					>${this.activeMode === 'compare' ? 'Compare References' : 'Working Changes'}</span
				>
				${this.activeMode !== 'compare'
					? files.length > 0
						? html`<commit-stats
								.added=${addedCount || undefined}
								.modified=${modifiedCount || undefined}
								.removed=${removedCount || undefined}
								symbol="icons"
								appearance="pill"
							></commit-stats>`
						: html`<span class="no-changes">No changes</span>`
					: nothing}
			</div>
			${!isModeActive
				? html`<gl-action-chip
						slot="actions"
						icon="refresh"
						label="Refresh"
						overlay="tooltip"
						@click=${() => this.emit('refresh-wip')}
					></gl-action-chip>`
				: nothing}
			${this.activeMode !== 'compare'
				? html`<div slot="secondary" class="graph-details-header__branch-row">
							<div class="branch-identity">
								${branchName
									? html`<gl-tooltip hoist placement="bottom">
											<gl-branch-name
												appearance="button"
												class="graph-details-header__branch"
												chevron
												.name=${branchName}
												@click=${() => this.emit('switch-branch')}
											></gl-branch-name>
											<span slot="content">Switch Branch...</span>
										</gl-tooltip>`
									: nothing}
								${ahead > 0 || behind > 0
									? html`<gl-tracking-pill .ahead=${ahead} .behind=${behind}></gl-tracking-pill>`
									: nothing}
								${this.renderMergeTargetStatus()}
							</div>
							<div class="branch-ops">
								${this.renderBranchStateAction()}${this.renderFetchAction()}
								<gl-action-chip
									icon="custom-start-work"
									label="Create Branch..."
									overlay="tooltip"
									@click=${() => this.emit('create-branch')}
								></gl-action-chip>
							</div>
						</div>
						${!isModeActive ? this.renderIssuesRow() : nothing}`
				: nothing}
		</gl-details-header>`;
	}

	private computeWipModes(): ('review' | 'compose' | 'compare')[] {
		const modes: ('review' | 'compose' | 'compare')[] = ['compose'];
		if (this.aiEnabled !== false) {
			modes.push('review');
		}
		modes.push('compare');
		return modes;
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

		if (behind > 0) {
			return html`<gl-action-chip
					icon="repo-pull"
					label="Pull"
					overlay="tooltip"
					@click=${() => this.emit('pull')}
				></gl-action-chip>
				${ahead > 0
					? html`<gl-action-chip
							icon="repo-push"
							label="Push"
							overlay="tooltip"
							@click=${() => this.emit('push')}
						></gl-action-chip>`
					: nothing}`;
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

	private renderMergeTargetStatus() {
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
		></gl-autolink-chip>`;

		if (!associated || i.entityId == null) return chip;

		return html`<span class="issue-chip-group" data-associated="true">
			${chip}
			<gl-tooltip hoist placement="bottom" content="Remove Branch Association">
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

	private emit(name: string) {
		this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true }));
	}
}

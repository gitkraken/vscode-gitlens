import { consume } from '@lit/context';
import type { TemplateResult } from 'lit';
import { html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { pluralize } from '@gitlens/utils/string.js';
import type { ConnectCloudIntegrationsCommandArgs } from '../../../../../commands/cloudIntegrations.js';
import type { LaunchpadCommandArgs } from '../../../../../plus/launchpad/launchpad.js';
import type { LaunchpadSummaryResult } from '../../../../../plus/launchpad/launchpadIndicator.js';
import { createCommandLink } from '../../../../../system/commands.js';
import type { GitBranchShape, Wip } from '../../../../plus/graph/detailsProtocol.js';
import type { BranchMergeTargetStatus } from '../../../../rpc/services/branches.js';
import type { BranchRef } from '../../../../shared/branchRefs.js';
import { elementBase } from '../../../shared/components/styles/lit/base.css.js';
import type { WebviewContext } from '../../../shared/contexts/webview.js';
import { webviewContext } from '../../../shared/contexts/webview.js';
import { detailsWipEmptyPaneStyles } from './gl-details-wip-empty-pane.css.js';
import '../../../shared/components/button.js';
import '../../../shared/components/button-container.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/skeleton-loader.js';

type NextStepAction = { actionLabel: string; tooltip?: string; icon?: string } & (
	| { event: string; href?: never }
	| { href: string; event?: never }
);

type NextStep = {
	icon: string;
	iconFlip?: 'inline' | 'block';
	label: string;
	actionPrefixIcon?: string;
	/** Optional alt action — rendered as the small side of a split-button. */
	alt?: NextStepAction;
} & NextStepAction;

function getRemoteNameFromUpstream(upstreamName: string | undefined): string {
	if (!upstreamName) return 'origin';

	const slash = upstreamName.indexOf('/');
	return slash > 0 ? upstreamName.slice(0, slash) : upstreamName;
}

@customElement('gl-details-wip-empty-pane')
export class GlDetailsWipEmptyPane extends LitElement {
	static override styles = [elementBase, detailsWipEmptyPaneStyles];

	@consume({ context: webviewContext })
	private _webview!: WebviewContext;

	@property({ type: Object }) wip?: Wip;
	@property({ type: Boolean }) hasPullRequest = false;
	@property({ type: Boolean }) hasIntegrationsConnected = false;
	@property({ type: Object }) launchpadSummary?: LaunchpadSummaryResult | { error: Error };
	@property({ type: Boolean }) launchpadSummaryLoading = false;
	@property({ type: Boolean }) aiEnabled = false;
	@property({ type: Boolean }) aiCreatePrEnabled = false;
	@property({ type: Object }) mergeTargetStatus?: BranchMergeTargetStatus;

	private _hadNextSteps = false;
	private _cachedNextSteps: NextStep[] = [];

	protected override willUpdate(): void {
		const branch = this.wip?.branch;
		this._cachedNextSteps = branch != null ? this.computeNextSteps(branch) : [];
	}

	override render(): unknown {
		const branch = this.wip?.branch;
		if (!branch) return this.renderIdle();

		const nextSteps = this._cachedNextSteps;
		// Pending steps win — Review/Recompose ride along below the pending list with the
		// active-state ordering rule. With no pending steps, the panel falls back to the idle
		// UI (renderIdle handles the Review/Recompose buttons itself).
		if (nextSteps.length === 0) return this.renderIdle();

		const recomposeFirst = this.shouldRecomposeFirst(branch);
		const uniqueWorkSteps = this.computeUniqueWorkSteps(recomposeFirst);
		return this.renderActive(branch, [...nextSteps, ...uniqueWorkSteps]);
	}

	private shouldRecomposeFirst(branch: GitBranchShape): boolean {
		const ahead = branch.tracking?.ahead ?? 0;
		const behind = branch.tracking?.behind ?? 0;
		const upstreamMissing = branch.upstream == null || branch.upstream.missing === true;
		return upstreamMissing || ahead !== 0 || behind !== 0;
	}

	/** Gating shared by `computeUniqueWorkSteps` (active state) and `renderIdle` (idle state).
	 *  Both surfaces want Review/Recompose under the same conditions — merge target detected,
	 *  unique commits against it, and no in-flight paused git op. */
	private hasUniqueWorkActions(): boolean {
		if (this.wip?.changes?.pausedOpStatus != null) return false;

		const mergeTarget = this.mergeTargetStatus?.mergeTarget;
		if (mergeTarget == null) return false;

		return (mergeTarget.status?.ahead ?? 0) > 0;
	}

	protected override updated(): void {
		const hasNextSteps = this._cachedNextSteps.length > 0;
		if (hasNextSteps && !this._hadNextSteps) {
			this.emit('next-steps-shown');
		}
		this._hadNextSteps = hasNextSteps;
	}

	private renderActive(branch: GitBranchShape, nextSteps: NextStep[]) {
		const ahead = branch.tracking?.ahead ?? 0;
		const hasDiverged = ahead > 0 || branch.upstream?.missing === true || branch.upstream == null;

		return html`<div class="hub">
			<section class="section">
				<h3 class="section__heading">Next steps</h3>
				${nextSteps.map(step => this.renderNextStep(step))}
			</section>
			${this.aiEnabled && hasDiverged ? this.renderAiWorkflows(ahead) : nothing}
			<section class="section">
				<header class="section__header">
					<h3 class="section__heading">Launchpad</h3>
					<gl-button
						class="section__heading-action"
						appearance="toolbar"
						aria-busy=${this.launchpadSummaryLoading}
						?disabled=${this.launchpadSummaryLoading}
						tooltip="Refresh Launchpad"
						@click=${() => this.emit('refresh-launchpad')}
					>
						<code-icon icon="refresh"></code-icon>
					</gl-button>
				</header>
				${this.renderLaunchpadSummary()}
				<div class="start-fresh">
					<gl-button
						appearance="secondary"
						@click=${() => this.emit('start-work', { showOpenInAgent: 'ask' })}
					>
						Start Work on an Issue…
					</gl-button>
				</div>
			</section>
		</div>`;
	}

	private renderNextStep(step: NextStep) {
		const primaryInner = html`${step.actionPrefixIcon
			? html`<code-icon icon=${step.actionPrefixIcon} slot="prefix"></code-icon>`
			: nothing}${step.actionLabel}`;
		const primary =
			step.href != null
				? html`<gl-button class="next-step__action" appearance="secondary" href=${step.href}
						>${primaryInner}</gl-button
					>`
				: html`<gl-button class="next-step__action" appearance="secondary" @click=${() => this.emit(step.event)}
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
							@click=${() => this.emit(alt.event)}
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

	private renderAiWorkflows(ahead: number) {
		return html`<section class="section">
			<h3 class="section__heading">AI workflows</h3>
			<div class="ai-grid">
				<gl-button class="ai-button" appearance="secondary" @click=${() => this.emit('ai-draft-pr')}>
					<code-icon icon="sparkle"></code-icon>Draft PR description
				</gl-button>
				<gl-button class="ai-button" appearance="secondary" @click=${() => this.emit('ai-summarize-branch')}>
					<code-icon icon="sparkle"></code-icon>Summarize branch
				</gl-button>
				${ahead > 0
					? html`<gl-button
							class="ai-button"
							appearance="secondary"
							@click=${() => this.emit('ai-review-unpushed')}
						>
							<code-icon icon="sparkle"></code-icon>Review ${pluralize('unpushed commit', ahead)}
						</gl-button>`
					: nothing}
				<gl-button class="ai-button" appearance="secondary" @click=${() => this.emit('ai-changelog')}>
					<code-icon icon="sparkle"></code-icon>Generate changelog entry
				</gl-button>
			</div>
		</section>`;
	}

	private renderIdle() {
		const showUniqueWorkButtons = this.hasUniqueWorkActions();

		return html`<div class="hub hub--idle">
			<p class="caption">Nothing pending on this branch.</p>
			<div class="start-fresh">
				<gl-button appearance="secondary" @click=${() => this.emit('start-work')}>
					<code-icon icon="issues"></code-icon>Start Work…
				</gl-button>
				<gl-button appearance="secondary" @click=${() => this.emit('create-branch')}>
					<code-icon icon="custom-start-work"></code-icon>Create Branch…
				</gl-button>
				<gl-button appearance="secondary" @click=${() => this.emit('switch-branch')}>
					<code-icon icon="gl-switch"></code-icon>Switch Branch…
				</gl-button>
				<gl-button appearance="secondary" @click=${() => this.emit('apply-stash')}>
					<code-icon icon="gl-stash-pop"></code-icon>Apply Stash…
				</gl-button>
				<gl-button appearance="secondary" @click=${() => this.emit('new-worktree')}>
					<code-icon icon="gl-worktrees-view"></code-icon>New Worktree…
				</gl-button>
				${showUniqueWorkButtons
					? html`<gl-button appearance="secondary" @click=${() => this.emit('review-branch-changes')}>
								<code-icon icon="checklist"></code-icon>Review Branch
							</gl-button>
							<gl-button appearance="secondary" @click=${() => this.emit('recompose-branch-changes')}>
								<code-icon icon="wand"></code-icon>Recompose Branch
							</gl-button>`
					: nothing}
			</div>
		</div>`;
	}

	private renderLaunchpadSummary(): TemplateResult {
		if (!this.hasIntegrationsConnected) {
			return html`<ul class="launchpad-items">
				<li>
					<a
						class="launchpad-item launchpad-item--link"
						href=${createCommandLink<ConnectCloudIntegrationsCommandArgs>(
							'gitlens.plus.cloudIntegrations.connect',
							{ source: { source: 'graph' } },
						)}
					>
						<code-icon class="launchpad-item__icon" icon="plug"></code-icon>
						<span>Connect to see PRs here</span>
					</a>
				</li>
			</ul>`;
		}

		const summary = this.launchpadSummary;
		if (summary == null) {
			return html`<div class="launchpad-items launchpad-items--loading">
				<skeleton-loader lines="1"></skeleton-loader>
				<skeleton-loader lines="1"></skeleton-loader>
			</div>`;
		}

		if (!('total' in summary)) {
			return html`<ul class="launchpad-items">
				<li class="launchpad-item launchpad-item--muted">Unable to load items</li>
			</ul>`;
		}

		const items: TemplateResult[] = [];

		if (summary.error != null) {
			items.push(
				html`<li>
					<span class="launchpad-item launchpad-item--muted">
						<code-icon class="launchpad-item__icon" icon="warning"></code-icon>
						<span>Some integrations failed to load</span>
					</span>
				</li>`,
			);
		}

		if (summary.total === 0) {
			items.push(html`<li class="launchpad-item launchpad-item--muted">You are all caught up!</li>`);
			return html`<ul class="launchpad-items">
				${items}
			</ul>`;
		}

		if (!summary.hasGroupedItems) {
			items.push(
				html`<li class="launchpad-item launchpad-item--muted">No pull requests need your attention</li>
					<li class="launchpad-item launchpad-item--muted">(${summary.total} other pull requests)</li>`,
			);
			return html`<ul class="launchpad-items">
				${items}
			</ul>`;
		}

		for (const group of summary.groups) {
			switch (group) {
				case 'mergeable': {
					const total = summary.mergeable?.total ?? 0;
					if (total === 0) continue;

					items.push(
						html`<li>
							<a
								class="launchpad-item launchpad-item--link launchpad-item--mergeable"
								href=${this.createShowLaunchpadLink('mergeable')}
							>
								<code-icon class="launchpad-item__icon" icon="rocket"></code-icon>
								<span>${pluralize('pull request', total)} can be merged</span>
							</a>
						</li>`,
					);
					break;
				}
				case 'blocked': {
					const total = summary.blocked?.total ?? 0;
					if (total === 0) continue;

					const messages: { count: number; message: string }[] = [];
					if (summary.blocked!.unassignedReviewers) {
						messages.push({
							count: summary.blocked!.unassignedReviewers,
							message: `${summary.blocked!.unassignedReviewers > 1 ? 'need' : 'needs'} reviewers`,
						});
					}
					if (summary.blocked!.failedChecks) {
						messages.push({
							count: summary.blocked!.failedChecks,
							message: `${summary.blocked!.failedChecks > 1 ? 'have' : 'has'} failed CI checks`,
						});
					}
					if (summary.blocked!.conflicts) {
						messages.push({
							count: summary.blocked!.conflicts,
							message: `${summary.blocked!.conflicts > 1 ? 'have' : 'has'} conflicts`,
						});
					}

					const href = this.createShowLaunchpadLink('blocked');
					if (messages.length === 1) {
						items.push(
							html`<li>
								<a class="launchpad-item launchpad-item--link launchpad-item--blocked" href=${href}>
									<code-icon class="launchpad-item__icon" icon="error"></code-icon>
									<span>${pluralize('pull request', total)} ${messages[0].message}</span>
								</a>
							</li>`,
						);
					} else {
						items.push(
							html`<li>
								<a class="launchpad-item launchpad-item--link launchpad-item--blocked" href=${href}>
									<code-icon class="launchpad-item__icon" icon="error"></code-icon>
									<span
										>${pluralize('pull request', total)} ${total > 1 ? 'are' : 'is'} blocked
										(${messages.map(m => `${m.count} ${m.message}`).join(', ')})</span
									>
								</a>
							</li>`,
						);
					}
					break;
				}
				case 'follow-up': {
					const total = summary.followUp?.total ?? 0;
					if (total === 0) continue;

					items.push(
						html`<li>
							<a
								class="launchpad-item launchpad-item--link launchpad-item--attention"
								href=${this.createShowLaunchpadLink('follow-up')}
							>
								<code-icon class="launchpad-item__icon" icon="report"></code-icon>
								<span
									>${pluralize('pull request', total)} ${total > 1 ? 'require' : 'requires'}
									follow-up</span
								>
							</a>
						</li>`,
					);
					break;
				}
				case 'needs-review': {
					const total = summary.needsReview?.total ?? 0;
					if (total === 0) continue;

					items.push(
						html`<li>
							<a
								class="launchpad-item launchpad-item--link launchpad-item--attention"
								href=${this.createShowLaunchpadLink('needs-review')}
							>
								<code-icon class="launchpad-item__icon" icon="comment-unresolved"></code-icon>
								<span
									>${pluralize('pull request', total)} ${total > 1 ? 'need' : 'needs'} your
									review</span
								>
							</a>
						</li>`,
					);
					break;
				}
			}
		}

		return html`<ul class="launchpad-items">
			${items}
		</ul>`;
	}

	private createShowLaunchpadLink(group: NonNullable<LaunchpadCommandArgs['state']>['initialGroup']): string {
		return `command:gitlens.showLaunchpad?${encodeURIComponent(
			JSON.stringify({
				source: 'graph-details',
				state: { initialGroup: group },
			} satisfies Omit<LaunchpadCommandArgs, 'command'>),
		)}`;
	}

	private computeNextSteps(branch: GitBranchShape): NextStep[] {
		const ahead = branch.tracking?.ahead ?? 0;
		const behind = branch.tracking?.behind ?? 0;
		const upstreamMissing = branch.upstream == null || branch.upstream.missing === true;
		const remoteName = getRemoteNameFromUpstream(branch.upstream?.name);

		const steps: NextStep[] = [];

		if (upstreamMissing) {
			steps.push({
				icon: 'cloud-upload',
				label: `Publish ${branch.name} to ${remoteName}`,
				actionLabel: 'Publish',
				event: 'publish-branch',
			});
		} else {
			if (behind > 0) {
				steps.push({
					icon: 'repo-pull',
					label: `Pull ${pluralize('commit', behind)} from ${remoteName}`,
					actionLabel: 'Pull',
					event: 'pull',
				});
			} else if (ahead > 0) {
				steps.push({
					icon: 'repo-push',
					label: `Push ${pluralize('commit', ahead)} to ${remoteName}`,
					actionLabel: 'Push',
					event: 'push',
				});
			}

			// Show "Create PR" for any published branch without an existing PR,
			// regardless of ahead/behind state — matches Home view behavior.
			if (!this.hasPullRequest) {
				const useAI = this.aiCreatePrEnabled;
				steps.push({
					icon: 'git-pull-request-create',
					label: 'Create a Pull Request',
					actionLabel: 'Create PR',
					actionPrefixIcon: useAI ? 'sparkle' : undefined,
					event: useAI ? 'create-pr-ai' : 'create-pr',
				});
			}
		}

		// Rebase/merge against the branch's merge target — allowed when the upstream is missing or
		// in-sync (otherwise push/pull is the bigger ask).
		const upstreamReady = upstreamMissing || (ahead === 0 && behind === 0);
		const mergeTargetStep = this.computeMergeTargetStep(upstreamReady);
		if (mergeTargetStep != null) {
			steps.push(mergeTargetStep);
		}

		// Note: Review/Recompose are intentionally NOT appended here. They're appended by
		// `render()` only when there are other pending steps to ride along below. When the
		// pending list is empty, the panel routes to renderIdle which adds them as buttons.

		return steps;
	}

	/**
	 * Review Changes / Recompose Branch as next-steps rows (active state). Gated by
	 * {@link hasUniqueWorkActions}. Returned in the order requested by the caller:
	 * - `recomposeFirst` true (branch actively being worked on) → Recompose, then Review
	 * - false (branch in sync with upstream) → Review, then Recompose
	 */
	private computeUniqueWorkSteps(recomposeFirst: boolean): NextStep[] {
		if (!this.hasUniqueWorkActions()) return [];

		const review: NextStep = {
			icon: 'checklist',
			label: 'Review Changes',
			actionLabel: 'Review',
			event: 'review-branch-changes',
		};
		const recompose: NextStep = {
			icon: 'wand',
			label: 'Recompose Branch',
			actionLabel: 'Recompose',
			event: 'recompose-branch-changes',
		};

		return recomposeFirst ? [recompose, review] : [review, recompose];
	}

	/**
	 * Merge-target step — mirrors the priority-ordered state model of the branch-header chip
	 * (`gl-merge-target-status`): merged-locally → merged → conflict → behind → in-sync.
	 * Label text mirrors the chip's popover titles with the merge-target's actual name in place
	 * of the generic "Merge Target". Gated identically across all states to avoid clutter:
	 * - merge target must be detected for this branch
	 * - no paused git operation in progress (mid-rebase/merge/cherry-pick)
	 * - upstream must be missing or in-sync (otherwise push/pull is the bigger ask)
	 */
	private computeMergeTargetStep(upstreamReady: boolean): NextStep | undefined {
		if (!upstreamReady) return undefined;
		if (this.wip?.changes?.pausedOpStatus != null) return undefined;

		const status = this.mergeTargetStatus;
		const mergeTarget = status?.mergeTarget;
		const branch = status?.branch;
		if (mergeTarget == null || branch == null) return undefined;

		const branchRef: BranchRef = {
			repoPath: branch.repoPath,
			branchId: branch.id,
			branchName: branch.name,
			worktree: branch.worktree
				? { name: branch.worktree.name, isDefault: branch.worktree.isDefault }
				: undefined,
		};
		const targetRef: BranchRef = {
			repoPath: mergeTarget.repoPath,
			branchId: mergeTarget.id,
			branchName: mergeTarget.name,
		};

		const isWorktree = branch.worktree != null && !branch.worktree.isDefault;
		const deleteLabel = isWorktree ? 'Delete Worktree' : 'Delete Branch';

		const mergedStatus = mergeTarget.mergedStatus;
		if (mergedStatus?.merged && mergedStatus.localBranchOnly) {
			const localTargetRef: BranchRef = {
				repoPath: branch.repoPath,
				branchId: mergedStatus.localBranchOnly.id!,
				branchName: mergedStatus.localBranchOnly.name,
				branchUpstreamName: mergedStatus.localBranchOnly.upstream?.name,
			};
			const likely = mergedStatus.confidence !== 'highest' ? 'Likely ' : '';
			return {
				icon: 'git-merge',
				iconFlip: 'block',
				label: `Branch ${likely}Merged Locally into ${mergeTarget.name}`,
				actionLabel: `Push ${mergedStatus.localBranchOnly.name}`,
				href: this._webview.createCommandLink<BranchRef>('gitlens.pushBranch:', localTargetRef),
				alt: {
					actionLabel: deleteLabel,
					tooltip: deleteLabel,
					href: this._webview.createCommandLink<[BranchRef, BranchRef]>('gitlens.deleteBranchOrWorktree:', [
						branchRef,
						localTargetRef,
					]),
				},
			};
		}

		if (mergedStatus?.merged) {
			const likely = mergedStatus.confidence !== 'highest' ? 'Likely ' : '';
			return {
				icon: 'git-merge',
				iconFlip: 'block',
				label: `Branch ${likely}Merged into ${mergeTarget.name}`,
				actionLabel: deleteLabel,
				href: this._webview.createCommandLink<[BranchRef, BranchRef]>('gitlens.deleteBranchOrWorktree:', [
					branchRef,
					targetRef,
				]),
			};
		}

		const hasConflicts = mergeTarget.potentialConflicts?.status === 'conflicts';
		if (hasConflicts) {
			return {
				icon: 'git-merge',
				iconFlip: 'block',
				label: `Potential Conflicts with ${mergeTarget.name}`,
				actionLabel: 'Rebase',
				event: 'rebase-onto-merge-target',
				alt: {
					actionLabel: 'Merge',
					tooltip: `Merge ${mergeTarget.name} into ${branch.name} instead`,
					event: 'merge-merge-target-into-current',
				},
			};
		}

		const behind = mergeTarget.status?.behind ?? 0;
		if (behind === 0) return undefined;

		return {
			icon: 'git-merge',
			iconFlip: 'block',
			label: `${pluralize('Commit', behind)} Behind ${mergeTarget.name}`,
			actionLabel: 'Rebase',
			event: 'rebase-onto-merge-target',
			alt: {
				actionLabel: 'Merge',
				tooltip: `Merge ${mergeTarget.name} into ${branch.name} instead`,
				event: 'merge-merge-target-into-current',
			},
		};
	}

	private emit(name: string, detail?: unknown): void {
		this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true, detail: detail }));
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-details-wip-empty-pane': GlDetailsWipEmptyPane;
	}
}

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

type NextStepAction = {
	actionLabel: string;
	tooltip?: string;
	icon?: string;
	/** When true, renderNextStep ignores `event`/`href` and renders a disabled button with a
	 *  spinning icon in place of the normal action button. Used for in-flight states that
	 *  should anchor layout (the row stays put) while a real action isn't yet available. */
	loading?: boolean;
} & ({ event: string; href?: never } | { href: string; event?: never });

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
	/** The branch's associated pull request (if any). When set, the PR slot in `computeNextSteps`
	 *  renders a "View Pull Request" row linking to `pr.url`. When unset and `pullRequestLoading`
	 *  is true, renders an inline loading row. When unset and not loading, renders the
	 *  "Create a Pull Request" action. */
	@property({ type: Object }) pullRequest?: { id: string; title: string; url: string };
	/** True while the host's PR enrichment fetch is in flight for this branch. Used to render a
	 *  stable "Checking for pull request…" row that anchors the layout until enrichment lands. */
	@property({ type: Boolean }) pullRequestLoading = false;
	@property({ type: Boolean }) hasIntegrationsConnected = false;
	@property({ type: Object }) launchpadSummary?: LaunchpadSummaryResult | { error: Error };
	@property({ type: Boolean }) launchpadSummaryLoading = false;
	/** When true, render the Launchpad section between Next steps and Start New. Off by default
	 *  so consumers that don't wire Launchpad props (e.g., the commit-details `gl-details-wip-panel`)
	 *  don't accidentally surface a Launchpad block they never opted into. */
	@property({ type: Boolean, attribute: 'show-launchpad' }) showLaunchpad = false;
	@property({ type: Boolean }) aiEnabled = false;
	@property({ type: Boolean }) aiCreatePrEnabled = false;
	@property({ type: Object }) mergeTargetStatus?: BranchMergeTargetStatus;

	private _hadNextSteps = false;
	private _cachedNextSteps: NextStep[] = [];
	private _cachedUniqueWorkSteps: NextStep[] = [];

	protected override willUpdate(): void {
		const branch = this.wip?.branch;
		this._cachedNextSteps = branch != null ? this.computeNextSteps(branch) : [];
		this._cachedUniqueWorkSteps =
			branch != null ? this.computeUniqueWorkSteps(this.shouldRecomposeFirst(branch)) : [];
	}

	override render(): unknown {
		// Stable bottom anchor — `Start New` always renders. Sections above it (`Next steps`,
		// `AI workflows`, `Launchpad`) appear conditionally on data and order is fixed; their
		// arrival pushes the start-new section down but never displaces it. Review/Recompose
		// surface inside `Next steps` (via `uniqueWorkSteps`) when there's unique-work; the
		// previous renderIdle's bottom-of-cluster Review/Recompose buttons are replaced by that
		// path.
		const branch = this.wip?.branch;
		const allSteps = [...this._cachedNextSteps, ...this._cachedUniqueWorkSteps];
		const hasSteps = allSteps.length > 0;
		const ahead = branch?.tracking?.ahead ?? 0;
		const hasDiverged =
			branch != null && (ahead > 0 || branch.upstream?.missing === true || branch.upstream == null);

		// Launchpad renders from initial mount (when `showLaunchpad`) — the summary content is
		// branch-agnostic (PRs across the user's connected integrations) and the inner
		// `renderLaunchpadSummary` handles its own loading/empty/unconnected states with a
		// stable footprint. Gating on `branch != null` here would cause the section to pop into
		// existence the moment WIP arrived, shifting `Start New` down — the very layout flip
		// this scaffold was reshaped to avoid.
		return html`<div class="hub">
			${hasSteps
				? html`<section class="section">
						<h3 class="section__heading">Next steps</h3>
						${allSteps.map(step => this.renderNextStep(step))}
					</section>`
				: nothing}
			${branch != null && this.aiEnabled && hasDiverged ? this.renderAiWorkflows(ahead) : nothing}
			${this.showLaunchpad ? this.renderLaunchpadSection() : nothing} ${this.renderStartNewSection()}
		</div>`;
	}

	private renderLaunchpadSection() {
		return html`<section class="section">
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
		</section>`;
	}

	private renderStartNewSection() {
		return html`<section class="section">
			<h3 class="section__heading">Start New</h3>
			<div class="start-new">
				<gl-button appearance="secondary" @click=${() => this.emit('start-work', { showOpenInAgent: 'ask' })}>
					Start Work on an Issue…
				</gl-button>
				<gl-button appearance="secondary" @click=${() => this.emit('start-review', { showOpenInAgent: 'ask' })}>
					Start Review on a PR…
				</gl-button>
				<gl-button appearance="secondary" @click=${() => this.emit('apply-stash')}>
					Apply / Pop Stash…
				</gl-button>
				<gl-button appearance="secondary" @click=${() => this.emit('new-worktree')}>
					Create Worktree…
				</gl-button>
				<gl-button appearance="secondary" @click=${() => this.emit('create-branch')}>
					Create Branch…
				</gl-button>
				<gl-button appearance="secondary" @click=${() => this.emit('switch-branch')}>
					Switch Branch…
				</gl-button>
			</div>
		</section>`;
	}

	private shouldRecomposeFirst(branch: GitBranchShape): boolean {
		const ahead = branch.tracking?.ahead ?? 0;
		const behind = branch.tracking?.behind ?? 0;
		const upstreamMissing = branch.upstream == null || branch.upstream.missing === true;
		return upstreamMissing || ahead !== 0 || behind !== 0;
	}

	/** Gates the Review/Recompose next-step rows added by `computeUniqueWorkSteps`. Fully permissive
	 *  except for paused git ops (rebase/merge/cherry-pick mid-flow shouldn't compete with
	 *  Review/Recompose actions). Without a precise "ahead of fork point" signal piped from the
	 *  host, conservative gating (merge-target detected + ahead > 0) hid the rows on common cases
	 *  like local-only branches with unpushed commits — leaving the actions to figure out scope at
	 *  invocation time is the lesser evil. */
	private hasUniqueWorkActions(): boolean {
		if (this.wip?.changes?.pausedOpStatus != null) return false;
		return this.wip?.branch != null;
	}

	protected override updated(): void {
		// Mirror what `render()` actually puts in the Next-steps section: cached next steps PLUS
		// uniqueWorkSteps. Pre-rename this guard only checked `_cachedNextSteps`, so a render
		// that showed Review/Recompose alone (uniqueWorkSteps populated, no cached steps) never
		// fired the event — breaking telemetry (`TrackGraphDetailsWipShownCommand`) and the
		// deferred-walkthrough trigger.
		const hasNextSteps = this._cachedNextSteps.length + this._cachedUniqueWorkSteps.length > 0;
		if (hasNextSteps && !this._hadNextSteps) {
			this.emit('next-steps-shown');
		}
		this._hadNextSteps = hasNextSteps;
	}

	private renderNextStep(step: NextStep) {
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
			// Single skeleton line matches the most common landed content — "You are all caught
			// up!" or a single group summary. Two lines was nearly always over-tall, causing a
			// downward shift when content landed.
			return html`<div class="launchpad-items launchpad-items--loading">
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

			// Tri-state PR row for any published branch — stays in place across enrichment so the
			// section doesn't shrink/grow when the PR fetch settles. Loading shows a spinner row;
			// resolving with a PR swaps to a "View Pull Request" row; resolving with no PR swaps
			// to the "Create a Pull Request" action row. Always pushes a row, never collapses —
			// the row's role transforms in place.
			if (this.pullRequest != null) {
				const pr = this.pullRequest;
				steps.push({
					icon: 'git-pull-request',
					label: `Pull Request #${pr.id}: ${pr.title}`,
					actionLabel: 'View',
					href: pr.url,
				});
			} else if (this.pullRequestLoading) {
				steps.push({
					icon: 'git-pull-request',
					label: 'Checking for pull request…',
					actionLabel: 'Checking',
					loading: true,
					event: '',
				});
			} else {
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

		// Note: Review/Recompose are intentionally NOT appended here. `render()` concatenates
		// `computeUniqueWorkSteps()` onto this list — so when the pending list is empty but
		// unique-work exists, the Next-steps section still surfaces Review/Recompose rows
		// without polluting the regular next-steps flow.

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

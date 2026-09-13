import { consume } from '@lit/context';
import * as l10n from '@vscode/l10n';
import { html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { boxSizingBase } from '@gitlens/components/components/styles/lit/base.css.js';
import { formatPlural } from '@gitlens/utils/plural.js';
import type {
	LaunchpadSummaryError,
	LaunchpadSummaryResult,
} from '../../../../../plus/launchpad/launchpadIndicator.js';
import type { GitBranchShape, Wip } from '../../../../plus/graph/detailsProtocol.js';
import type { BranchMergeTargetStatus } from '../../../../rpc/services/branches.js';
import type { BranchRef } from '../../../../shared/branchRefs.js';
import type { WebviewContext } from '../../../shared/contexts/webview.js';
import { webviewContext } from '../../../shared/contexts/webview.js';
import { detailsWipEmptyPaneStyles } from './gl-details-wip-empty-pane.css.js';
import type { NextStep } from './nextStep.js';
import { nextStepStyles, renderNextStep } from './nextStep.js';
import '../../../shared/components/button.js';
import '../../../shared/components/button-container.js';
import '@gitlens/components/components/codeIcon.js';
import './gl-launchpad-summary.js';

function getRemoteNameFromUpstream(upstreamName: string | undefined): string {
	if (!upstreamName) return 'origin';

	const slash = upstreamName.indexOf('/');
	return slash > 0 ? upstreamName.slice(0, slash) : upstreamName;
}

@customElement('gl-details-wip-empty-pane')
export class GlDetailsWipEmptyPane extends LitElement {
	static override styles = [boxSizingBase, nextStepStyles, detailsWipEmptyPaneStyles];

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
	@property({ type: Object }) launchpadSummary?: LaunchpadSummaryResult | { error: LaunchpadSummaryError };
	@property({ type: Boolean }) launchpadSummaryLoading = false;
	/** When true, render the Launchpad section between Next steps and Start New. Off by default
	 *  so consumers that don't wire Launchpad props (e.g., the commit-details `gl-details-wip-panel`)
	 *  don't accidentally surface a Launchpad block they never opted into. */
	@property({ type: Boolean, attribute: 'show-launchpad' }) showLaunchpad = false;
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
		// `Launchpad`) appear conditionally on data and order is fixed; their
		// arrival pushes the start-new section down but never displaces it. Review/Recompose
		// surface inside `Next steps` (via `uniqueWorkSteps`) when there's unique-work; the
		// previous renderIdle's bottom-of-cluster Review/Recompose buttons are replaced by that
		// path.
		const allSteps = [...this._cachedNextSteps, ...this._cachedUniqueWorkSteps];
		const hasSteps = allSteps.length > 0;

		// Launchpad renders from initial mount (when `showLaunchpad`) — the summary content is
		// branch-agnostic (PRs across the user's connected integrations) and the inner
		// `gl-launchpad-summary` handles its own loading/empty/unconnected states with a
		// stable footprint. Gating on `branch != null` here would cause the section to pop into
		// existence the moment WIP arrived, shifting `Start New` down — the very layout flip
		// this scaffold was reshaped to avoid.
		return html`<div class="hub">
			${
				hasSteps
					? html`<section class="section">
							<h3 class="section__heading">${l10n.t('Next steps')}</h3>
							${allSteps.map(step => renderNextStep(step))}
						</section>`
					: nothing
			}
			${this.showLaunchpad ? this.renderLaunchpadSection() : nothing} ${this.renderStartNewSection()}
		</div>`;
	}

	private renderLaunchpadSection() {
		return html`<section class="section">
			<header class="section__header">
				<h3 class="section__heading">${l10n.t('Launchpad')}</h3>
				<gl-button
					class="section__heading-action"
					appearance="toolbar"
					aria-busy=${this.launchpadSummaryLoading}
					?disabled=${this.launchpadSummaryLoading}
					tooltip=${l10n.t('Refresh Launchpad')}
					@click=${() => this.emit('refresh-launchpad')}
				>
					<code-icon icon="refresh"></code-icon>
				</gl-button>
			</header>
			<gl-launchpad-summary
				.summary=${this.launchpadSummary}
				?has-integrations-connected=${this.hasIntegrationsConnected}
				source="graph-details"
			></gl-launchpad-summary>
		</section>`;
	}

	private renderStartNewSection() {
		return html`<section class="section">
			<h3 class="section__heading">${l10n.t('Start New')}</h3>
			<div class="start-new">
				<gl-button appearance="secondary" @click=${() => this.emit('start-work', { showOpenInAgent: 'ask' })}>
					${l10n.t('Start Work on an Issue…')}
				</gl-button>
				<gl-button appearance="secondary" @click=${() => this.emit('start-review', { showOpenInAgent: 'ask' })}>
					${l10n.t('Start Review on a PR…')}
				</gl-button>
				<gl-button appearance="secondary" @click=${() => this.emit('apply-stash')}>
					${l10n.t('Apply / Pop Stash…')}
				</gl-button>
				<gl-button appearance="secondary" @click=${() => this.emit('new-worktree')}>
					${l10n.t('Create Worktree…')}
				</gl-button>
				<gl-button appearance="secondary" @click=${() => this.emit('create-branch')}>
					${l10n.t('Create Branch…')}
				</gl-button>
				<gl-button appearance="secondary" @click=${() => this.emit('switch-branch')}>
					${l10n.t('Switch Branch…')}
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
		// Counts BOTH sources the Next-steps section renders. A section showing only
		// Review/Recompose (uniqueWorkSteps populated, no cached steps) still has to fire
		// `next-steps-shown` — it drives the `action:gitlens.graph.details.wipShown:happened`
		// usage track and the deferred-walkthrough trigger.
		const hasNextSteps = this._cachedNextSteps.length + this._cachedUniqueWorkSteps.length > 0;
		if (hasNextSteps && !this._hadNextSteps) {
			this.emit('next-steps-shown');
		}
		this._hadNextSteps = hasNextSteps;
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
				label: l10n.t('Publish {branch} to {remote}', { branch: branch.name, remote: remoteName }),
				actionLabel: l10n.t('Publish'),
				onClick: () => this.emit('publish-branch'),
			});
		} else {
			if (ahead > 0 && behind > 0) {
				steps.push({
					icon: 'repo-force-push',
					label: l10n.t('Diverged from {remote} — {behind} behind, {ahead} ahead', {
						remote: remoteName,
						behind: behind,
						ahead: ahead,
					}),
					actionLabel: l10n.t('Pull'),
					onClick: () => this.emit('pull'),
					alt: {
						actionLabel: l10n.t('Force Push'),
						tooltip: formatPlural(
							l10n.t(
								'{count, plural, one{Force push {count} commit to {remote}} other{Force push {count} commits to {remote}}}',
							),
							{ count: ahead, remote: remoteName },
						),
						onClick: () => this.emit('force-push'),
					},
				});
			} else if (behind > 0) {
				steps.push({
					icon: 'repo-pull',
					label: formatPlural(
						l10n.t(
							'{count, plural, one{Pull {count} commit from {remote}} other{Pull {count} commits from {remote}}}',
						),
						{ count: behind, remote: remoteName },
					),
					actionLabel: l10n.t('Pull'),
					onClick: () => this.emit('pull'),
				});
			} else if (ahead > 0) {
				steps.push({
					icon: 'repo-push',
					label: formatPlural(
						l10n.t(
							'{count, plural, one{Push {count} commit to {remote}} other{Push {count} commits to {remote}}}',
						),
						{ count: ahead, remote: remoteName },
					),
					actionLabel: l10n.t('Push'),
					onClick: () => this.emit('push'),
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
					label: l10n.t('Pull Request #{id}: {title}', { id: pr.id, title: pr.title }),
					actionLabel: l10n.t('View'),
					href: pr.url,
				});
			} else if (this.pullRequestLoading) {
				steps.push({
					icon: 'git-pull-request',
					label: l10n.t('Checking for pull request…'),
					actionLabel: l10n.t('Checking'),
					loading: true,
				});
			} else {
				const useAI = this.aiCreatePrEnabled;
				steps.push({
					icon: 'git-pull-request-create',
					label: l10n.t('Create a Pull Request'),
					actionLabel: l10n.t('Create PR'),
					actionPrefixIcon: useAI ? 'sparkle' : undefined,
					onClick: () => this.emit(useAI ? 'create-pr-ai' : 'create-pr'),
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
			label: l10n.t('Review Changes'),
			actionLabel: l10n.t('Review'),
			onClick: () => this.emit('review-branch-changes'),
		};
		const recompose: NextStep = {
			icon: 'wand',
			label: l10n.t('Recompose Branch'),
			actionLabel: l10n.t('Recompose'),
			onClick: () => this.emit('recompose-branch-changes'),
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
		const deleteLabel = isWorktree ? l10n.t('Delete Worktree') : l10n.t('Delete Branch');

		const mergedStatus = mergeTarget.mergedStatus;
		if (mergedStatus?.merged && mergedStatus.localBranchOnly) {
			const localTargetRef: BranchRef = {
				repoPath: branch.repoPath,
				branchId: mergedStatus.localBranchOnly.id!,
				branchName: mergedStatus.localBranchOnly.name,
				branchUpstreamName: mergedStatus.localBranchOnly.upstream?.name,
			};
			return {
				icon: 'git-merge',
				iconFlip: 'block',
				label:
					mergedStatus.confidence !== 'highest'
						? l10n.t('Branch Likely Merged Locally into {target}', { target: mergeTarget.name })
						: l10n.t('Branch Merged Locally into {target}', { target: mergeTarget.name }),
				actionLabel: l10n.t('Push {branch}', { branch: mergedStatus.localBranchOnly.name }),
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
			return {
				icon: 'git-merge',
				iconFlip: 'block',
				label:
					mergedStatus.confidence !== 'highest'
						? l10n.t('Branch Likely Merged into {target}', { target: mergeTarget.name })
						: l10n.t('Branch Merged into {target}', { target: mergeTarget.name }),
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
				label: l10n.t('Potential Conflicts with {target}', { target: mergeTarget.name }),
				actionLabel: l10n.t('Rebase'),
				onClick: () => this.emit('rebase-onto-merge-target'),
				alt: {
					actionLabel: l10n.t('Merge'),
					tooltip: l10n.t('Merge {target} into {branch} instead', {
						target: mergeTarget.name,
						branch: branch.name,
					}),
					onClick: () => this.emit('merge-merge-target-into-current'),
				},
			};
		}

		const behind = mergeTarget.status?.behind ?? 0;
		if (behind === 0) return undefined;

		return {
			icon: 'git-merge',
			iconFlip: 'block',
			label: formatPlural(
				l10n.t('{count, plural, one{{count} Commit Behind {target}} other{{count} Commits Behind {target}}}'),
				{ count: behind, target: mergeTarget.name },
			),
			actionLabel: l10n.t('Rebase'),
			onClick: () => this.emit('rebase-onto-merge-target'),
			alt: {
				actionLabel: l10n.t('Merge'),
				tooltip: l10n.t('Merge {target} into {branch} instead', {
					target: mergeTarget.name,
					branch: branch.name,
				}),
				onClick: () => this.emit('merge-merge-target-into-current'),
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

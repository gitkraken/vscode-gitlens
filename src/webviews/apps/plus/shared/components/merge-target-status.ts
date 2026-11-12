import { consume } from '@lit/context';
import * as l10n from '@vscode/l10n';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { boxSizingBase, linkBase, scrollableBase } from '@gitlens/components/components/styles/lit/base.css.js';
import { localizedContent } from '@gitlens/components/localizedContent.js';
import { formatPlural } from '@gitlens/utils/plural.js';
import type { BranchAndTargetRefs, BranchRef, DeleteBranchOrWorktreeRefs } from '../../../../shared/branchRefs.js';
import type { OverviewBranch, OverviewBranchMergeTarget } from '../../../../shared/overviewBranches.js';
import { renderBranchName } from '../../../shared/components/branch-name.js';
import type { WebviewContext } from '../../../shared/contexts/webview.js';
import { webviewContext } from '../../../shared/contexts/webview.js';
import type { QueueablePullRequest } from '../mergeQueue.utils.js';
import { getMergeQueueNote, getMergeTargetQueueTreatment } from '../mergeQueue.utils.js';
import { chipStyles } from './chipStyles.js';
import '../../../shared/components/button.js';
import '../../../shared/components/button-container.js';
import '@gitlens/components/components/codeIcon.js';
import '@gitlens/components/components/overlays/popover.js';
import '@gitlens/components/components/overlays/tooltip.js';
import '../../../shared/components/ref-button.js';

type MergeTargetPromise = Promise<OverviewBranchMergeTarget | undefined> | undefined;

export const mergeTargetStyles = css`
	.header__actions {
		margin-top: var(--gl-space-4);
		margin-left: auto;
	}

	.content {
		gap: var(--gl-space-6);
	}

	:host-context(.vscode-dark),
	:host-context(.vscode-high-contrast) {
		--color-status--in-sync: #0b0;
		--color-merge--clean: #0b0;
		--color-merge--conflict: var(--vscode-gitlens-decorations\\.statusMergingOrRebasingForegroundColor);
	}

	:host-context(.vscode-light),
	:host-context(.vscode-high-contrast-light) {
		--color-status--in-sync: #0a0;
		--color-merge--clean: #0a0;
		--color-merge--conflict: var(--vscode-gitlens-decorations\\.statusMergingOrRebasingForegroundColor);
	}

	/* Compact indicator (branch hover): scale the whole composite to 80% so the merge-target glyph +
	   status overlay keep their tuned alignment. transform, not smaller icon sizes, so the overlap
	   margins scale with it. */
	.chip.compact {
		transform: scale(0.8);
		transform-origin: left center;
	}

	.header__title > span {
		cursor: help;
	}

	.header__title code-icon:not(.info) {
		margin-bottom: 0.1rem;
	}

	.header__title code-icon.status--warning {
		color: var(--vscode-gitlens-decorations\\.statusMergingOrRebasingForegroundColor);
	}

	.header__title p {
		margin: 0.5rem 0 0;
	}

	.header__subtitle {
		margin: var(--gl-space-2) 0 0;
		font-size: var(--gl-font-base);
	}

	.status--conflict .icon,
	.status--conflict .status-indicator {
		color: var(--vscode-gitlens-decorations\\.statusMergingOrRebasingForegroundColor);
	}

	.status--behind .icon,
	.status--behind .status-indicator {
		color: var(--vscode-gitlens-decorations\\.statusMergingOrRebasingForegroundColor);
	}

	.status--merged .icon,
	.status--merged .status-indicator {
		color: var(--vscode-gitlens-mergedPullRequestIconColor);
	}

	.status--merged .icon {
		transform: rotateY(180deg);
	}

	.status--successor .status-indicator {
		color: var(--color-foreground--50);
	}

	.status--in-sync .status-indicator {
		color: var(--color-status--in-sync);
	}

	.status--loading {
		color: var(--color-foreground--50);
		cursor: default;
	}

	.status--merge-conflict {
		color: var(--color-merge--conflict);
	}

	.status--merge-clean {
		color: var(--color-merge--clean);
	}

	.status--merge-unknown {
		color: var(--color-foreground--50);
	}

	.status--upgrade {
		color: var(--color-foreground--50);
	}

	.status-indicator {
		margin-top: var(--gl-space-8);
		margin-left: -0.5rem;
	}

	.body {
		display: flex;
		flex-direction: column;
		gap: var(--gl-space-8);
		width: 100%;
	}

	.button-container {
		display: flex;
		flex-direction: column;
		gap: var(--gl-space-8);
		align-items: center;
		justify-content: center;
		width: 100%;
		margin-top: var(--gl-space-4);
		margin-bottom: var(--gl-space-4);
	}

	.button-container gl-button {
		max-width: 30rem;
	}

	p {
		margin: 0 var(--gl-space-4);
	}

	p code-icon,
	gl-button code-icon {
		margin-bottom: 0.1rem;
	}

	details {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: var(--gl-space-4);
		padding: 0;
		margin: 0 var(--gl-space-2) var(--gl-space-4);
		overflow: hidden;
		color: var(--color-foreground--85);
		border: var(--gl-border-width) solid transparent;
	}

	details[open] {
		border: var(--gl-border-width) solid var(--vscode-sideBar-border);
		border-radius: var(--gl-radius-sm);
	}

	summary {
		position: sticky;
		top: 0;
		z-index: 1;
		padding: var(--gl-space-4) var(--gl-space-6);
		color: var(--color-foreground);
		cursor: pointer;
		list-style: none;
		transition: transform var(--gl-ease-in-out) var(--gl-duration-x-fast);
	}

	summary:hover {
		color: var(--vscode-textLink-activeForeground);
	}

	details[open] > summary {
		margin-left: 0;
		color: var(--vscode-textLink-foreground);
		background: var(--vscode-sideBar-background);
		border-radius: var(--gl-radius-sm) var(--gl-radius-sm) 0 0;
	}

	details[open] > summary code-icon {
		transform: rotate(90deg);
	}

	summary code-icon {
		transition: transform var(--gl-duration-medium);
	}

	.files {
		display: flex;
		flex-direction: column;
		gap: var(--gl-space-4);
		max-height: 8rem;
		padding: var(--gl-space-4) var(--gl-space-8);
		overflow-y: auto;
		background: var(--vscode-sideBar-background);
	}

	gl-popover {
		--max-width: 60rem;
	}

	.target-edit * {
		text-decoration: underline dotted;
		text-underline-offset: 0.3rem;
	}

	.target-edit gl-branch-name {
		margin: 0;
	}
`;

@customElement('gl-merge-target-status')
export class GlMergeTargetStatus extends LitElement {
	static override shadowRootOptions: ShadowRootInit = {
		...LitElement.shadowRootOptions,
		delegatesFocus: true,
	};

	static override styles = [boxSizingBase, linkBase, chipStyles, scrollableBase, mergeTargetStyles];

	@consume({ context: webviewContext })
	private _webview!: WebviewContext;

	@property({ type: Object })
	branch!: Pick<OverviewBranch, 'repoPath' | 'id' | 'name' | 'opened' | 'upstream' | 'worktree'>;

	@property({ type: Boolean, reflect: true })
	loading = false;

	/** The branch's pull request, when known. While it's in a merge queue the queue owns the branch, so the popover
	 *  offers no Rebase/Merge: conflicts stay a warning, and being behind is the queue's job. */
	@property({ attribute: false })
	pullRequest?: QueueablePullRequest;

	/** Compact presentation for tight surfaces (the branch hover): the indicator renders at 80% scale and
	 *  opens a plain one-line tooltip instead of the full interactive popover (no push/compare/delete
	 *  actions). Off by default so the overview card / home keep the rich popover. */
	@property({ type: Boolean, reflect: true })
	compact = false;

	@state()
	private _target: Awaited<MergeTargetPromise>;
	get target(): Awaited<MergeTargetPromise> {
		return this._target;
	}

	private _targetPromise: MergeTargetPromise;
	get targetPromise(): MergeTargetPromise {
		return this._targetPromise;
	}
	@property({ type: Object })
	set targetPromise(value: MergeTargetPromise) {
		if (this._targetPromise === value) return;

		this._targetPromise = value;
		if (value == null) {
			this._target = undefined;
			return;
		}

		void value.then(
			r => {
				if (this._targetPromise === value) {
					this._target = r;
				}
			},
			() => {
				if (this._targetPromise === value) {
					this._target = undefined;
				}
			},
		);
	}

	private get conflictResult() {
		return this.target?.potentialConflicts;
	}

	private get conflicts() {
		const result = this.conflictResult;
		return result?.status === 'conflicts' ? result.conflict : undefined;
	}

	private get conflictError() {
		const result = this.conflictResult;
		return result?.status === 'error' ? result : undefined;
	}

	private get mergedStatus() {
		return this.target?.mergedStatus;
	}

	/** Whether the branch's work landed (by its merged pull request, else by git evidence) — what the surfaces switch
	 *  on, never {@link mergedStatus} alone */
	private get landed() {
		return this.target?.landed;
	}

	/** The branch's pull request merged but the branch has commits it didn't carry, so it is NOT landed */
	private get successor() {
		return this.target?.successor;
	}

	/** Only PR evidence may pre-select Force Delete — git evidence can't prove the work is safe to drop */
	private get deleteOptions(): { mergedPullRequest?: { id: string; sha: string } } | undefined {
		const landed = this.landed;
		return landed?.via === 'pr' && landed.pullRequest != null && landed.tipSha != null
			? { mergedPullRequest: { id: landed.pullRequest.id, sha: landed.tipSha } }
			: undefined;
	}

	private get status() {
		return this.target?.status;
	}

	private get branchRef(): BranchRef | undefined {
		if (this.branch == null) return undefined;

		return {
			repoPath: this.branch.repoPath,
			branchId: this.branch.id,
			branchName: this.branch.name,
			worktree: this.branch.worktree
				? { name: this.branch.worktree.name, isDefault: this.branch.worktree.isDefault }
				: undefined,
		};
	}

	private get targetBranchRef(): BranchRef | undefined {
		if (this.target == null) return undefined;

		return {
			repoPath: this.target.repoPath,
			branchId: this.target.id,
			branchName: this.target.name,
		};
	}

	/** One-line status summary for the compact tooltip — a terse stand-in for the popover's rich header. */
	private get compactStatusLabel(): string {
		const target = this.target?.name ?? l10n.t('the merge target');
		const landed = this.landed;
		if (landed != null) {
			return landed.via === 'pr' && landed.pullRequest != null
				? l10n.t('Merged via Pull Request #{id}', { id: landed.pullRequest.id })
				: l10n.t('Merged into {target}', { target: target });
		}

		const successor = this.successor;
		if (successor != null) return this.successorTitle(successor);

		if (this.conflicts) return l10n.t('Merging into {target} will cause conflicts', { target: target });

		const behind = this.status?.behind ?? 0;
		if (behind > 0) {
			return formatPlural(
				l10n.t('{count, plural, one{{count} commit behind {target}} other{{count} commits behind {target}}}'),
				{
					count: behind,
					target: target,
				},
			);
		}
		return l10n.t('Merges cleanly into {target}', { target: target });
	}

	private successorTitle(successor: NonNullable<OverviewBranchMergeTarget['successor']>): string {
		return formatPlural(
			l10n.t(
				'{count, plural, one{Pull request #{id} was merged; {count} new commit since} other{Pull request #{id} was merged; {count} new commits since}}',
			),
			{ count: successor.newCommits, id: successor.pullRequest.id },
		);
	}

	override render(): unknown {
		if (!this.status && !this.conflicts && this.landed == null && this.successor == null) {
			if (this.loading) {
				return html`<gl-tooltip content=${l10n.t('Checking merge target status…')}>
					<span class="chip status--loading${this.compact ? ' compact' : ''}" aria-busy="true">
						<code-icon class="icon" icon="gl-merge-target" size="18"></code-icon>
						<code-icon class="status-indicator" icon="sync" size="12"></code-icon>
					</span>
				</gl-tooltip>`;
			}
			return nothing;
		}

		let icon;
		let status;

		if (this.landed != null) {
			icon = 'git-merge';
			status = 'merged';
		} else if (this.successor != null) {
			icon = 'git-pull-request';
			status = 'successor';
		} else if (this.conflicts) {
			icon = 'warning';
			status = 'conflict';
		} else if ((this.status?.behind ?? 0) > 0) {
			icon = 'arrow-down';
			status = 'behind';
		} else {
			icon = 'check';
			status = 'in-sync';
		}

		// Compact: a plain tooltip with a one-line summary rather than the interactive popover.
		if (this.compact) {
			return html`<gl-tooltip content=${this.compactStatusLabel} placement="bottom">
				<span class="chip status--${status} compact" tabindex="0"
					><code-icon class="icon" icon="gl-merge-target" size="18"></code-icon
					><code-icon class="status-indicator icon--${status}" icon="${icon}" size="12"></code-icon>
				</span>
			</gl-tooltip>`;
		}

		return html`<gl-popover placement="bottom" trigger="hover click focus">
			<span slot="anchor" class="chip status--${status}" tabindex="0"
				><code-icon class="icon" icon="gl-merge-target" size="18"></code-icon
				><code-icon class="status-indicator icon--${status}" icon="${icon}" size="12"></code-icon>
			</span>
			<div slot="content" class="content">${this.renderContent()}</div>
		</gl-popover>`;
	}

	private renderContent() {
		const landed = this.landed;
		const localBranchOnly =
			landed?.via === 'git' && this.mergedStatus?.merged ? this.mergedStatus.localBranchOnly : undefined;

		const mergeTargetRef =
			localBranchOnly != null
				? {
						repoPath: this.branch.repoPath,
						branchId: localBranchOnly.id!,
						branchName: localBranchOnly.name,
						branchUpstreamName: localBranchOnly.upstream?.name,
					}
				: this.target
					? {
							repoPath: this.target.repoPath,
							branchId: this.target.id,
							branchName: this.target.name,
							branchUpstreamName: undefined,
						}
					: undefined;

		if (landed != null) {
			if (localBranchOnly != null) {
				return html`${this.renderHeader(
						landed.confidence !== 'highest'
							? l10n.t('Branch Likely Merged Locally into Merge Target')
							: l10n.t('Branch Merged Locally into Merge Target'),
						'git-merge',
					)}
					<div class="body">
						<p>
							${localizedContent(
								landed.confidence !== 'highest'
									? l10n.t(
											"Your current branch {branch} has likely been merged into its merge target's local branch {target}.",
										)
									: l10n.t(
											"Your current branch {branch} has been merged into its merge target's local branch {target}.",
										),
								{
									branch: renderBranchName(this.branch.name),
									target: renderBranchName(localBranchOnly.name),
								},
							)}
						</p>
						<div class="button-container">
							<gl-button
								full
								href="${this._webview.createCommandLink<BranchRef>(
									'gitlens.pushBranch:',
									mergeTargetRef,
								)}"
								><span
									>${localizedContent(l10n.t('Push {branch}'), {
										branch: renderBranchName(localBranchOnly.name),
									})}</span
								></gl-button
							>
							<gl-button
								full
								appearance="secondary"
								href="${this._webview.createCommandLink<DeleteBranchOrWorktreeRefs>(
									'gitlens.deleteBranchOrWorktree:',
									{ ...this.branchRef!, mergeTarget: mergeTargetRef },
								)}"
								><span
									>${localizedContent(
										this.branch.worktree != null && !this.branch.worktree.isDefault
											? l10n.t('Delete Worktree {branch}')
											: l10n.t('Delete Branch {branch}'),
										{ branch: renderBranchName(this.branch.name, this.branch.worktree != null) },
									)}</span
								></gl-button
							>
						</div>
					</div>`;
			}

			const mergedPullRequest = landed.via === 'pr' ? landed.pullRequest : undefined;
			return html`${this.renderHeader(
					mergedPullRequest != null
						? l10n.t('Merged via Pull Request #{id}', {
								id: mergedPullRequest.id,
							})
						: landed.confidence !== 'highest'
							? l10n.t('Branch Likely Merged into Merge Target')
							: l10n.t('Branch Merged into Merge Target'),
					'git-merge',
				)}
				<div class="body">
					<p>
						${
							mergedPullRequest != null
								? localizedContent(
										l10n.t(
											'The pull request #{id} for your current branch {branch} was merged into its merge target {target}.',
										),
										{
											id: mergedPullRequest.id,
											branch: renderBranchName(this.branch.name),
											target: this.renderInlineTargetEdit(this.target),
										},
									)
								: localizedContent(
										landed.confidence !== 'highest'
											? l10n.t(
													'Your current branch {branch} has likely been merged into its merge target {target}.',
												)
											: l10n.t(
													'Your current branch {branch} has been merged into its merge target {target}.',
												),
										{
											branch: renderBranchName(this.branch.name),
											target: this.renderInlineTargetEdit(this.target),
										},
									)
						}
					</p>
					<div class="button-container">
						<gl-button
							full
							href="${this._webview.createCommandLink<DeleteBranchOrWorktreeRefs>(
								'gitlens.deleteBranchOrWorktree:',
								{
									...this.branchRef!,
									mergeTarget: mergeTargetRef,
									...this.deleteOptions,
								},
							)}"
							><span
								>${localizedContent(
									this.branch.worktree != null && !this.branch.worktree.isDefault
										? l10n.t('Delete Worktree {branch}')
										: l10n.t('Delete Branch {branch}'),
									{ branch: renderBranchName(this.branch.name, this.branch.worktree != null) },
								)}</span
							></gl-button
						>
					</div>
				</div>`;
		}

		const successor = this.successor;
		if (successor != null) {
			return html`${this.renderHeader(this.successorTitle(successor), 'git-pull-request')}
				<div class="body">
					<p>
						${localizedContent(
							formatPlural(
								l10n.t(
									'{count, plural, one{Pull request #{id} for your current branch {branch} was merged into its merge target {target}, but the branch has {count} new commit since.} other{Pull request #{id} for your current branch {branch} was merged into its merge target {target}, but the branch has {count} new commits since.}}',
								),
								{ count: successor.newCommits, id: successor.pullRequest.id },
							),
							{
								branch: renderBranchName(this.branch.name),
								target: this.renderInlineTargetEdit(this.target),
							},
						)}
					</p>
					${
						(this.status?.behind ?? 0) > 0
							? html`${this.renderMergeActions(this.conflicts?.branch ?? this.branch.name, false)}
								${this.renderConflictCheck()}`
							: nothing
					}
				</div>`;
		}

		if (this.conflicts) {
			const queued = getMergeTargetQueueTreatment(this.pullRequest, 'conflicts') !== 'default';
			return html`${this.renderHeader(l10n.t('Potential Conflicts with Merge Target'), 'warning', 'warning')}
				<div class="body">
					${this.status ? html`<p>${this.renderBehindDescription(this.status.behind)}</p>` : nothing}
					${this.renderMergeActions(this.conflicts.branch, queued)} ${this.renderConflictCheck()}
				</div>`;
		}

		if (this.status != null) {
			if (this.status.behind > 0) {
				const queued = getMergeTargetQueueTreatment(this.pullRequest, 'behind') !== 'default';
				return html`${this.renderHeader(
						formatPlural(
							l10n.t(
								'{count, plural, one{{count} Commit Behind Merge Target} other{{count} Commits Behind Merge Target}}',
							),
							{
								count: this.status.behind,
							},
						),
						'arrow-down',
						// Behind isn't something to act on while queued — the queue merges against the latest target.
						queued ? undefined : 'warning',
					)}
					<div class="body">
						<p>${this.renderBehindDescription(this.status.behind)}</p>
						${this.renderMergeActions(this.branch.name, queued)} ${this.renderConflictCheck()}
					</div>`;
			}

			return html`${this.renderHeader(l10n.t('Up to Date with Merge Target'), 'check')}
				<div class="body">
					<p>
						${localizedContent(
							l10n.t('Your current branch {branch} is up to date with its merge target {target}.'),
							{
								branch: renderBranchName(this.branch.name),
								target: this.renderInlineTargetEdit(this.target),
							},
						)}
					</p>
				</div>`;
		}

		return nothing;
	}

	/** Rebase/Merge buttons (or the merge-queue note when queued) for a branch that's behind its merge target */
	private renderMergeActions(branchName: string, queued: boolean) {
		if (queued) return html`<p>${getMergeQueueNote()}</p>`;

		const target = renderBranchName(this.target?.name);
		return html`<div class="button-container">
			<gl-button
				full
				href="${this._webview.createCommandLink<BranchRef>('gitlens.rebaseCurrentOnto:', this.targetBranchRef)}"
				><span
					>${localizedContent(l10n.t('Rebase {branch} onto {target}'), {
						branch: renderBranchName(branchName),
						target: target,
					})}</span
				></gl-button
			>
			<gl-button
				full
				appearance="secondary"
				href="${this._webview.createCommandLink<BranchRef>('gitlens.mergeIntoCurrent:', this.targetBranchRef)}"
				><span
					>${localizedContent(l10n.t('Merge {target} into {branch}'), {
						target: target,
						branch: renderBranchName(branchName),
					})}</span
				></gl-button
			>
		</div>`;
	}

	/** The potential-conflicts warning (with files), or the unable-to-detect / no-conflicts note */
	private renderConflictCheck() {
		const conflicts = this.conflicts;
		if (conflicts != null) {
			return html`<p class="status--merge-conflict">
					<code-icon icon="warning"></code-icon>
					${formatPlural(
						l10n.t(
							'{count, plural, one{Merging will cause conflicts in {count} file that will need to be resolved.} other{Merging will cause conflicts in {count} files that will need to be resolved.}}',
						),
						{ count: conflicts.files.length },
					)}
				</p>
				${this.renderFiles(conflicts.files)}`;
		}

		if (this.conflictError) {
			return html`<p class="status--merge-unknown">
				<code-icon icon="error"></code-icon> ${l10n.t('Unable to detect conflicts.')}
			</p>`;
		}

		if (this.conflictResult?.status === 'clean') {
			return html`<p class="status--merge-clean">
				<code-icon icon="check"></code-icon>
				${l10n.t('Merging will not cause conflicts.')}
			</p>`;
		}

		return nothing;
	}

	private renderBehindDescription(behind: number) {
		return localizedContent(
			formatPlural(
				l10n.t(
					'{count, plural, one{Your current branch {branch} is {count} commit behind its merge target {target}.} other{Your current branch {branch} is {count} commits behind its merge target {target}.}}',
				),
				{ count: behind },
			),
			{
				branch: renderBranchName(this.branch.name),
				target: this.renderInlineTargetEdit(this.target),
			},
		);
	}

	private renderHeader(title: string, icon: string, status?: string) {
		return html`<div class="header">
			<gl-tooltip class="header__title">
				<span>
					<code-icon
						icon="${icon}"
						class="${ifDefined(status ? `status--${status}` : undefined)}"
					></code-icon>
					${title}&nbsp;<code-icon class="info" icon="question" size="16"></code-icon>
				</span>
				<span slot="content"
					>${title}
					<p>
						${localizedContent(
							l10n.t('The "merge target" is the branch that {branch} is most likely to be merged into.'),
							{ branch: renderBranchName(this.branch.name) },
						)}
					</p>
				</span>
			</gl-tooltip>
			${this.renderHeaderActions()}
		</div>`;
	}

	private renderHeaderActions() {
		const branchRef = this.branchRef;
		const targetRef = this.targetBranchRef;

		return html`<span class="header__actions"
			>${
				branchRef && targetRef
					? html`<gl-button
								href="${this._webview.createCommandLink<BranchAndTargetRefs>(
									'gitlens.git.branch.setMergeTarget:',
									{
										...branchRef,
										mergeTargetId: targetRef.branchId,
										mergeTargetName: targetRef.branchName,
									},
								)}"
								appearance="toolbar"
								><code-icon icon="pencil"></code-icon
								><span slot="tooltip"
									>${localizedContent(l10n.t('Change Merge Target{break}{target}'), {
										break: html`<br />`,
										target: renderBranchName(this.target?.name),
									})}</span
								></gl-button
							><gl-button
								href="${this._webview.createCommandLink<BranchAndTargetRefs>(
									'gitlens.openMergeTargetComparison:',
									{
										...branchRef,
										mergeTargetId: targetRef.branchId,
										mergeTargetName: targetRef.branchName,
									},
								)}"
								appearance="toolbar"
								@click=${(e: MouseEvent) => this.onCompareClick(e, targetRef.branchName)}
								><code-icon icon="git-compare"></code-icon>
								<span slot="tooltip"
									>${localizedContent(
										l10n.t('Compare Branch with Merge Target{break}{branch} {arrow} {target}'),
										{
											break: html`<br />`,
											branch: renderBranchName(this.branch.name),
											arrow: html`<code-icon icon="arrow-both" size="12"></code-icon>`,
											target: renderBranchName(this.target?.name),
										},
									)}</span
								>
							</gl-button>`
					: nothing
			}<gl-button
				href="${this._webview.createCommandLink<BranchRef>('gitlens.fetch:', this.targetBranchRef)}"
				appearance="toolbar"
				><code-icon icon="repo-fetch"></code-icon>
				<span slot="tooltip"
					>${localizedContent(l10n.t('Fetch Merge Target{break}{target}'), {
						break: html`<br />`,
						target: renderBranchName(this.target?.name),
					})}</span
				>
			</gl-button></span
		>`;
	}

	private onCompareClick(e: MouseEvent, targetBranchName: string) {
		// The merge target is the BASE of the comparison ("what I'm measuring my changes against"),
		// so it goes into `leftRef` per the compare-panel convention (leftRef = Base / older,
		// rightRef = Compare / newer / current branch). The graph compare workflow seeds rightRef
		// from the active WIP/commit selection, so dispatching only leftRef here leaves the
		// selection-derived Compare side intact rather than clobbering it.
		const event = new CustomEvent('compare-with-merge-target', {
			detail: { leftRef: targetBranchName, leftRefType: 'branch' },
			bubbles: true,
			composed: true,
			cancelable: true,
		});
		this.dispatchEvent(event);

		if (event.defaultPrevented) {
			e.preventDefault();
		}
	}

	private renderInlineTargetEdit(target: Awaited<MergeTargetPromise>) {
		return html`<gl-button
			class="target-edit"
			appearance="toolbar"
			density="compact"
			tooltip=${l10n.t('Change Merge Target')}
			href="${this._webview.createCommandLink<BranchAndTargetRefs>('gitlens.git.branch.setMergeTarget:', {
				...this.branchRef!,
				mergeTargetId: this.targetBranchRef!.branchId,
				mergeTargetName: this.targetBranchRef!.branchName,
			})}"
			>${renderBranchName(target?.name)}</gl-button
		>`;
	}

	private renderFiles(files: { path: string }[]) {
		return html`
			<details>
				<summary>
					<code-icon icon="chevron-right"></code-icon>
					${formatPlural(
						l10n.t(
							'{count, plural, one{Show {count} conflicting file} other{Show {count} conflicting files}}',
						),
						{
							count: files.length,
						},
					)}
				</summary>
				<div class="files scrollable">${files.map(file => this.renderFile(file.path))}</div>
			</details>
		`;
	}

	private renderFile(path: string) {
		return html`<span class="files__item"><code-icon icon="file"></code-icon> ${path}</span>`;
	}
}

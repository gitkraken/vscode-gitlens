import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { SubscriptionPlanId } from '../../../../../constants.subscription';
import type { SubscriptionUpgradeCommandArgs } from '../../../../../plus/gk/models/subscription';
import { createCommandLink } from '../../../../../system/commands';
import { pluralize } from '../../../../../system/string';
import type { BranchAndTargetRefs, BranchRef, GetOverviewBranch } from '../../../../home/protocol';
import { renderBranchName } from '../../../shared/components/branch-name';
import { elementBase, linkBase, scrollableBase } from '../../../shared/components/styles/lit/base.css';
import { chipStyles } from '../../shared/components/chipStyles';
import '../../../shared/components/button';
import '../../../shared/components/button-container';
import '../../../shared/components/code-icon';
import '../../../shared/components/overlays/popover';

const mergeTargetStyles = css`
	.header__actions {
		margin-top: 0.4rem;
	}

	.content {
		gap: 0.6rem;
	}

	:host-context(.vscode-dark),
	:host-context(.vscode-high-contrast) {
		--color-status--in-sync: #00bb00;
		--color-merge--clean: #00bb00;
		--color-merge--conflict: var(--vscode-gitlens-decorations\\.statusMergingOrRebasingForegroundColor);
	}

	:host-context(.vscode-light),
	:host-context(.vscode-high-contrast-light) {
		--color-status--in-sync: #00aa00;
		--color-merge--clean: #00aa00;
		--color-merge--conflict: var(--vscode-gitlens-decorations\\.statusMergingOrRebasingForegroundColor);
	}

	.header__title code-icon {
		margin-bottom: 0.1rem;
	}

	.header__title code-icon.status--warning {
		color: var(--vscode-gitlens-decorations\\.statusMergingOrRebasingForegroundColor);
	}

	.header__subtitle {
		font-size: 1.3rem;
		margin: 0.2rem 0 0 0;
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

	.status--in-sync .status-indicator {
		color: var(--color-status--in-sync);
	}

	.status--merge-conflict {
		color: var(--color-merge--conflict);
	}

	.status--merge-clean {
		color: var(--color-merge--clean);
	}

	.status--upgrade {
		color: var(--color-foreground--50);
	}

	.status-indicator {
		margin-left: -0.5rem;
		margin-top: 0.8rem;
	}

	.body {
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
		width: 100%;
	}

	.button-container {
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
		margin-top: 0.4rem;
		margin-bottom: 0.4rem;
		align-items: center;
		justify-content: center;
		width: 100%;
	}

	.button-container gl-button {
		max-width: 30rem;
	}

	p {
		margin: 0 0.4rem;
	}

	p code-icon,
	gl-button code-icon {
		margin-bottom: 0.1rem;
	}

	details {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding: 0;
		position: relative;
		margin: 0 0.2rem 0.4rem;
		overflow: hidden;
		border: 1px solid transparent;
		color: var(--color-foreground--85);
	}

	details[open] {
		border-radius: 0.3rem;
		border: 1px solid var(--vscode-sideBar-border);
	}

	summary {
		position: sticky;
		top: 0;
		color: var(--color-foreground);
		cursor: pointer;
		list-style: none;
		transition: transform ease-in-out 0.1s;
		padding: 0.4rem 0.6rem 0.4rem 0.6rem;
		z-index: 1;
	}

	summary:hover {
		color: var(--vscode-textLink-activeForeground);
	}

	details[open] > summary {
		color: var(--vscode-textLink-foreground);
		border-radius: 0.3rem 0.3rem 0 0;
		margin-left: 0;
		background: var(--vscode-sideBar-background);
	}

	details[open] > summary code-icon {
		transform: rotate(90deg);
	}

	summary code-icon {
		transition: transform 0.2s;
	}

	.files {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;

		max-height: 8rem;
		overflow-y: auto;
		padding: 0.4rem 0.8rem;

		background: var(--vscode-sideBar-background);
	}

	gl-popover {
		--max-width: 80vw;
	}

	.info {
		cursor: help;
		display: inline-flex;
		vertical-align: middle;
	}
`;

@customElement('gl-merge-target-status')
export class GlMergeTargetStatus extends LitElement {
	static override shadowRootOptions: ShadowRootInit = {
		...LitElement.shadowRootOptions,
		delegatesFocus: true,
	};

	static override styles = [elementBase, linkBase, chipStyles, scrollableBase, mergeTargetStyles];

	@property({ type: Object })
	branch!: Pick<GetOverviewBranch, 'repoPath' | 'id' | 'name' | 'opened' | 'upstream' | 'worktree'>;

	@state()
	private _target: Awaited<GetOverviewBranch['mergeTarget']>;
	get target(): Awaited<GetOverviewBranch['mergeTarget']> {
		return this._target;
	}

	private _targetPromise: GetOverviewBranch['mergeTarget'];
	get targetPromise(): GetOverviewBranch['mergeTarget'] {
		return this._targetPromise;
	}
	@property({ type: Object })
	set targetPromise(value: GetOverviewBranch['mergeTarget']) {
		if (this._targetPromise === value) return;

		this._targetPromise = value;
		void this._targetPromise?.then(
			r => (this._target = r),
			() => (this._target = undefined),
		);
	}

	private get conflicts() {
		return this.target?.potentialConflicts;
	}

	private get mergedStatus() {
		return this.target?.mergedStatus;
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

	override render(): unknown {
		if (!this.status && !this.conflicts) return nothing;

		let icon;
		let status;

		if (this.mergedStatus?.merged) {
			icon = 'git-merge';
			status = 'merged';
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

		return html`<gl-popover placement="bottom" trigger="hover click focus" hoist>
			<span slot="anchor" class="chip status--${status}" tabindex="0"
				><code-icon class="icon" icon="gl-merge-target" size="18"></code-icon
				><code-icon class="status-indicator icon--${status}" icon="${icon}" size="12"></code-icon>
			</span>
			<div slot="content" class="content">${this.renderContent()}</div>
		</gl-popover>`;
	}

	private renderContent() {
		const target = renderBranchName(this.target?.name);

		const mergeTargetRef =
			this.mergedStatus?.merged && this.mergedStatus.localBranchOnly
				? {
						repoPath: this.branch.repoPath,
						branchId: this.mergedStatus.localBranchOnly.id!,
						branchName: this.mergedStatus.localBranchOnly.name,
						branchUpstreamName: this.mergedStatus.localBranchOnly.upstream?.name,
				  }
				: this.target
				  ? {
							repoPath: this.target.repoPath,
							branchId: this.target.id,
							branchName: this.target.name,
							branchUpstreamName: undefined,
				    }
				  : undefined;

		if (this.mergedStatus?.merged) {
			if (this.mergedStatus.localBranchOnly) {
				return html`<div class="header">
						<span class="header__title"
							><code-icon icon="git-merge"></code-icon> Branch
							${this.mergedStatus.confidence !== 'highest' ? 'Likely ' : ''}Merged Locally into Merge
							Target&nbsp;${this.renderInfo()}${this.renderCurrentTarget()}</span
						>
						${this.renderActions()}
					</div>
					<div class="body">
						<p>
							Your current branch ${renderBranchName(this.branch.name)} has
							${this.mergedStatus.confidence !== 'highest' ? 'likely ' : ''}been merged into its merge
							target's local branch ${renderBranchName(this.mergedStatus.localBranchOnly.name)}.
						</p>
						<div class="button-container">
							<gl-button
								full
								href="${createCommandLink(
									'gitlens.home.pushBranch',
									mergeTargetRef! satisfies BranchRef,
								)}"
								>Push ${renderBranchName(this.mergedStatus.localBranchOnly.name)}</gl-button
							>
							<gl-button
								full
								appearance="secondary"
								href="${createCommandLink('gitlens.home.deleteBranchOrWorktree', [
									this.branchRef,
									mergeTargetRef,
								])}"
								>Delete
								${this.branch.worktree != null && !this.branch.worktree.isDefault
									? 'Worktree'
									: 'Branch'}
								${renderBranchName(this.branch.name, this.branch.worktree != null)}</gl-button
							>
						</div>
					</div>`;
			}

			return html`<div class="header">
					<span class="header__title"
						><code-icon icon="git-merge"></code-icon> Branch
						${this.mergedStatus.confidence !== 'highest' ? 'Likely ' : ''}Merged into Merge
						Target&nbsp;${this.renderInfo()}${this.renderCurrentTarget()}</span
					>
					${this.renderActions()}
				</div>
				<div class="body">
					<p>
						Your current branch ${renderBranchName(this.branch.name)} has
						${this.mergedStatus.confidence !== 'highest' ? 'likely ' : ''}been merged into its merge target
						${target}.
					</p>
					<div class="button-container">
						<gl-button
							full
							href="${createCommandLink('gitlens.home.deleteBranchOrWorktree', [
								this.branchRef,
								mergeTargetRef,
							])}"
							>Delete
							${this.branch.worktree != null && !this.branch.worktree.isDefault ? 'Worktree' : 'Branch'}
							${renderBranchName(this.branch.name, this.branch.worktree != null)}</gl-button
						>
					</div>
				</div>`;
		}

		if (this.conflicts) {
			return html`
				<div class="header">
					<span class="header__title"
						><code-icon class="status--warning" icon="warning"></code-icon> Potential Conflicts with Merge
						Target&nbsp;${this.renderInfo()}${this.renderCurrentTarget()}</span
					>
					${this.renderActions()}
				</div>
				<div class="body">
					${this.status
						? html`<p>
								Your current branch ${renderBranchName(this.branch.name)} is
								${pluralize('commit', this.status.behind)} behind its merge target ${target}.
						  </p>`
						: nothing}
					<div class="button-container">
						<gl-button
							full
							href="${createCommandLink('gitlens.home.rebaseCurrentOnto', this.targetBranchRef)}"
							>Rebase ${renderBranchName(this.conflicts.branch)} onto ${target}</gl-button
						>
						<gl-button
							full
							appearance="secondary"
							href="${createCommandLink('gitlens.home.mergeIntoCurrent', this.targetBranchRef)}"
							>Merge ${target} into ${renderBranchName(this.conflicts.branch)}</gl-button
						>
					</div>
					<p class="status--merge-conflict">
						<code-icon icon="warning"></code-icon> Merging will cause conflicts in
						${pluralize('file', this.conflicts.files.length)} that will need to be resolved.
					</p>
					${this.renderFiles(this.conflicts.files)}
				</div>
			`;
		}

		if (this.status != null) {
			if (this.status.behind > 0) {
				return html`<div class="header">
						<span class="header__title"
							><code-icon class="status--warning" icon="arrow-down"></code-icon> ${pluralize(
								'Commit',
								this.status.behind,
							)}
							Behind Merge Target&nbsp;${this.renderInfo()}${this.renderCurrentTarget()}</span
						>
						${this.renderActions()}
					</div>
					<div class="body">
						<p>
							Your current branch ${renderBranchName(this.branch.name)} is
							${pluralize('commit', this.status.behind)} behind its merge target ${target}.
						</p>
						<div class="button-container">
							<gl-button
								full
								href="${createCommandLink('gitlens.home.rebaseCurrentOnto', this.targetBranchRef)}"
								>Rebase ${renderBranchName(this.branch.name)} onto ${target}</gl-button
							>
							<gl-button
								full
								appearance="secondary"
								href="${createCommandLink('gitlens.home.mergeIntoCurrent', this.targetBranchRef)}"
								>Merge ${target} into ${renderBranchName(this.branch.name)}</gl-button
							>
						</div>
						<p class="status--merge-clean">
							<code-icon icon="check"></code-icon> Merging will not cause conflicts.
						</p>
					</div>`;
			}

			return html`<div class="header">
					<span class="header__title"
						><code-icon icon="check"></code-icon> Up to Date with Merge
						Target&nbsp;${this.renderInfo()}${this.renderCurrentTarget()}</span
					>
					${this.renderActions()}
				</div>
				<div class="body">
					<p>
						Your current branch ${renderBranchName(this.branch.name)} is up to date with its merge target
						${target}.
					</p>
				</div>`;
		}

		return nothing;
	}

	private renderActions() {
		const branchRef = this.branchRef;
		const targetRef = this.targetBranchRef;

		return html`<span class="header__actions"
			>${branchRef && targetRef
				? html`<gl-button
						href="${createCommandLink<BranchAndTargetRefs>('gitlens.home.openMergeTargetComparison', {
							...branchRef,
							mergeTargetId: targetRef.branchId,
							mergeTargetName: targetRef.branchName,
						})}"
						appearance="toolbar"
						><code-icon icon="git-compare"></code-icon>
						<span slot="tooltip"
							>Compare Branch with Merge Target<br />${renderBranchName(this.branch.name)}
							&leftrightarrow; ${renderBranchName(this.target?.name)}</span
						>
				  </gl-button>`
				: nothing}<gl-button
				href="${createCommandLink('gitlens.home.fetch', this.targetBranchRef)}"
				appearance="toolbar"
				><code-icon icon="repo-fetch"></code-icon>
				<span slot="tooltip">Fetch Merge Target<br />${renderBranchName(this.target?.name)}</span>
			</gl-button></span
		>`;
	}

	private renderCurrentTarget() {
		return nothing;
		// return html`<br />
		// 	<p class="header__subtitle">Merge Target is ${renderBranchName(this.target?.name)}</p>`;
	}

	private renderInfo() {
		return html`<gl-tooltip class="info" position="bottom">
			<code-icon icon="question" size="16"></code-icon>
			<span slot="content"
				>The "merge target" is the branch that ${renderBranchName(this.branch.name)} is most likely to be merged
				into.</span
			>
		</gl-tooltip>`;
	}

	private renderFiles(files: { path: string }[]) {
		return html`
			<details>
				<summary>
					<code-icon icon="chevron-right"></code-icon>
					Show ${files.length} conflicting files
				</summary>
				<div class="files scrollable">${files.map(file => this.renderFile(file.path))}</div>
			</details>
		`;
	}

	private renderFile(path: string) {
		return html`<span class="files__item"><code-icon icon="file"></code-icon> ${path}</span>`;
	}
}

@customElement('gl-merge-target-upgrade')
export class GlMergeTargetUpgrade extends LitElement {
	static override shadowRootOptions: ShadowRootInit = {
		...LitElement.shadowRootOptions,
		delegatesFocus: true,
	};

	static override styles = [elementBase, linkBase, chipStyles, scrollableBase, mergeTargetStyles];

	override render(): unknown {
		const icon = 'warning';
		const status = 'upgrade';

		return html`<gl-popover placement="bottom" trigger="hover click focus" hoist>
			<span slot="anchor" class="chip status--${status}" tabindex="0"
				><code-icon class="icon" icon="gl-merge-target" size="18"></code-icon
				><code-icon class="status-indicator icon--${status}" icon="${icon}" size="12"></code-icon>
			</span>
			<div slot="content" class="content">
				<div class="header">
					<span class="header__title">Detect potential merge conflicts</span>
				</div>
				<div class="body">
					<p>
						Upgrade to GitLens Pro to see when your current branch has potential conflicts with its merge
						target branch and take action to resolve them.
					</p>
					<div class="button-container">
						<gl-button
							full
							href="${createCommandLink<SubscriptionUpgradeCommandArgs>('gitlens.plus.upgrade', {
								plan: SubscriptionPlanId.Pro,
								source: 'merge-target',
							})}"
							>Upgrade to Pro</gl-button
						>
					</div>
				</div>
			</div>
		</gl-popover>`;
	}
}

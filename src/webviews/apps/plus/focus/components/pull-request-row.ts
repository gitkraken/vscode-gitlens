import { css, customElement, FASTElement, html, observable, volatile, when } from '@microsoft/fast-element';
import type { PullRequestMember, PullRequestShape } from '../../../../../git/models/pullRequest';
import { fromNow } from '../../../../../system/date';
import { focusOutline, srOnly } from '../../../shared/components/styles/a11y';
import { elementBase } from '../../../shared/components/styles/base';
import { fromDateRange } from './helpers';
import '../../../shared/components/table/table-cell';
import '../../../shared/components/avatars/avatar-item';
import '../../../shared/components/avatars/avatar-stack';
import '../../../shared/components/code-icon';
import './git-avatars';

const template = html<PullRequestRow>`
	<template role="row">
		<table-cell class="status">
			${when(
				x => x.pullRequest?.isDraft === true,
				html`<code-icon icon="git-pull-request-draft" title="draft"></code-icon>`,
			)}
			${when(
				x => x.pullRequest?.isDraft !== true,
				html`<code-icon class="pull-request-draft" icon="git-pull-request" title="open"></code-icon>`,
			)}
			${when(
				x => x.indicator === 'changes',
				html`<code-icon class="indicator-error" icon="request-changes" title="changes requested"></code-icon>`,
			)}
			${when(
				x => x.indicator === 'ready',
				html`<code-icon class="indicator-info" icon="pass" title="approved and ready to merge"></code-icon>`,
			)}
			${when(
				x => x.indicator === 'conflicting',
				html`<code-icon
					class="indicator-error"
					icon="bracket-error"
					title="cannot be merged due to merge conflicts"
				></code-icon>`,
			)}
			${when(x => x.indicator === 'checks', html`<code-icon icon="error" title="checks failed"></code-icon>`)}
		</table-cell>
		<table-cell class="time"
			><span class="${x => x.lastUpdatedClass}" title="${x => x.lastUpdatedLabel}"
				>${x => x.lastUpdated}</span
			></table-cell
		>
		<table-cell>
			${x => x.pullRequest!.title} <a href="${x => x.pullRequest!.url}">#${x => x.pullRequest!.id}</a><br />
			<small>
				<span class="tag"><code-icon icon="repo"></code-icon>${x => x.pullRequest!.refs?.base.repo}</span>
				into
				${when(
					x => x.pullRequest!.refs?.isCrossRepository !== true,
					html<PullRequestRow>`
						<span class="tag"
							><code-icon icon="source-control"></code-icon>${x => x.pullRequest!.refs?.base.branch}</span
						>
						from
						<span class="tag"
							><code-icon icon="source-control"></code-icon>${x => x.pullRequest!.refs?.head.branch}</span
						>
					`,
				)}
				${when(
					x => x.pullRequest!.refs?.isCrossRepository === true,
					html<PullRequestRow>`
						<span class="tag"
							><code-icon icon="source-control"></code-icon>${x => x.pullRequest!.refs?.base.owner}:${x =>
								x.pullRequest!.refs?.base.branch}</span
						>
						from
						<span class="tag"
							><code-icon icon="source-control"></code-icon>${x => x.pullRequest!.refs?.head.owner}:${x =>
								x.pullRequest!.refs?.head.branch}</span
						>
					`,
				)}
			</small>
		</table-cell>
		<table-cell class="vcenter participants">
			${when(
				x => x.pullRequest!.author != null,
				html<PullRequestRow>`
					<avatar-stack>
						<avatar-item
							media="${x => x.pullRequest!.author.avatarUrl}"
							title="${x => x.pullRequest!.author.name} (author)"
						></avatar-item>
					</avatar-stack>
				`,
			)}
			${when(
				x => x.assignees.length > 0,
				html<PullRequestRow>`<git-avatars :avatars="${x => x.pullRequest!.assignees}"></git-avatars>`,
			)}
		</table-cell>
		<table-cell class="vcenter">${x => x.pullRequest!.comments}</table-cell>
		<table-cell class="vcenter stats"
			><span class="stat-added">+${x => x.pullRequest!.additions}</span>
			<span class="stat-deleted">-${x => x.pullRequest!.deletions}</span></table-cell
		>
		<table-cell class="vcenter actions">
			<a
				href="#"
				tabindex="${x => (x.isCurrentWorktree || x.isCurrentBranch ? -1 : null)}"
				title="${x => (x.isCurrentWorktree ? 'Already on this workree' : 'Open Worktree...')}"
				aria-label="${x => (x.isCurrentWorktree ? 'Already on this workree' : 'Open Worktree...')}"
				@click="${(x, c) => x.onOpenWorktreeClick(c.event)}"
				><code-icon icon="gl-worktrees-view"></code-icon></a
			><a
				href="#"
				tabindex="${x => (x.hasWorktree || x.isCurrentBranch ? -1 : null)}"
				title="${x => (x.isCurrentBranch ? 'Already on this branch' : 'Switch to Branch...')}"
				aria-label="${x => (x.isCurrentBranch ? 'Already on this branch' : 'Switch to Branch...')}"
				@click="${(x, c) => x.onSwitchBranchClick(c.event)}"
				><code-icon icon="gl-switch"></code-icon
			></a>
		</table-cell>
	</template>
`;

const styles = css`
	${elementBase}

	:host {
		display: table-row;
	}

	:host(:focus) {
		${focusOutline}
	}

	a {
		color: var(--vscode-textLink-foreground);
		text-decoration: none;
	}

	a:hover {
		color: var(--vscode-textLink-activeForeground);
		text-decoration: underline;
	}

	a:focus {
		${focusOutline}
	}

	code-icon {
		font-size: inherit;
	}

	.vcenter {
		vertical-align: middle;
	}

	.tag {
		display: inline-block;
		padding: 0.1rem 0.2rem;
		background-color: var(--background-05);
		color: var(--color-foreground--85);
		white-space: nowrap;
	}
	.tag code-icon {
		margin-right: 0.2rem;
	}

	.status {
		font-size: 1.6rem;
	}

	.time {
	}

	.icon-only {
	}

	.participants {
		white-space: nowrap;
	}

	.stats {
	}

	.actions {
		text-align: right;
		white-space: nowrap;
		width: 6.4rem;
	}

	.actions a {
		box-sizing: border-box;
		display: inline-flex;
		justify-content: center;
		align-items: center;
		width: 3.2rem;
		height: 3.2rem;
		border-radius: 0.5rem;
		color: inherit;
		padding: 0.2rem;
		vertical-align: text-bottom;
		text-decoration: none;
		cursor: pointer;
	}
	.actions a:focus {
		outline: 1px solid var(--vscode-focusBorder);
		outline-offset: -1px;
	}
	.actions a:hover {
		background-color: var(--vscode-toolbar-hoverBackground);
	}
	.actions a:active {
		background-color: var(--vscode-toolbar-activeBackground);
	}
	.actions a[tabindex='-1'] {
		opacity: 0.5;
		cursor: default;
	}

	.actions a code-icon {
		font-size: 1.6rem;
	}

	.stat-added {
		color: var(--vscode-gitDecoration-addedResourceForeground);
	}
	.stat-deleted {
		color: var(--vscode-gitDecoration-deletedResourceForeground);
	}

	.issue-open {
		color: var(--vscode-gitlens-openAutolinkedIssueIconColor);
	}
	.issue-closed {
		color: var(--vscode-gitlens-closedAutolinkedIssueIconColor);
	}

	.indicator-info {
		color: var(--vscode-problemsInfoIcon-foreground);
	}
	.indicator-warning {
		color: var(--vscode-problemsWarningIcon-foreground);
	}
	.indicator-error {
		color: var(--vscode-problemsErrorIcon-foreground);
	}
	.indicator-neutral {
		color: var(--color-alert-neutralBorder);
	}

	.pull-request-draft {
		/* color: var(--vscode-pullRequests-draft); */
		color: var(--color-foreground--85);
	}
	.pull-request-open {
		color: var(--vscode-gitlens-openPullRequestIconColor);
	}
	.pull-request-merged {
		color: var(--vscode-gitlens-mergedPullRequestIconColor);
	}
	.pull-request-closed {
		color: var(--vscode-gitlens-closedPullRequestIconColor);
	}
	.pull-request-notification {
		color: var(--vscode-pullRequests-notification);
	}

	${srOnly}
`;

@customElement({
	name: 'pull-request-row',
	template: template,
	styles: styles,
})
export class PullRequestRow extends FASTElement {
	@observable
	public pullRequest?: PullRequestShape;

	@observable
	public reasons?: string[];

	@observable
	public checks?: boolean;

	@observable
	public isCurrentBranch = false;

	@observable
	public isCurrentWorktree = false;

	@observable
	public hasWorktree = false;

	@observable
	public hasLocalBranch = false;

	@volatile
	get lastUpdatedDate() {
		return this.pullRequest ? new Date(this.pullRequest.date) : undefined;
	}

	@volatile
	get lastUpdatedState() {
		if (!this.lastUpdatedDate) {
			return;
		}
		return fromDateRange(this.lastUpdatedDate);
	}

	@volatile
	get lastUpdated() {
		if (!this.lastUpdatedDate) {
			return;
		}
		return fromNow(this.lastUpdatedDate, true);
	}

	@volatile
	get lastUpdatedLabel() {
		if (!this.lastUpdatedDate) {
			return;
		}
		return fromNow(this.lastUpdatedDate);
	}

	@volatile
	get lastUpdatedClass() {
		switch (this.lastUpdatedState?.status) {
			case 'danger':
				return 'indicator-error';
			case 'warning':
				return 'indicator-warning';
			default:
				return '';
		}
	}

	@volatile
	get indicator() {
		if (this.pullRequest == null) return '';

		if (this.checks === false) {
			return 'checks';
		} else if (this.pullRequest.reviewDecision === 'ChangesRequested') {
			return 'changes';
		} else if (this.pullRequest.reviewDecision === 'Approved' && this.pullRequest.mergeableState === 'Mergeable') {
			return 'ready';
		}

		if (this.pullRequest.mergeableState === 'Conflicting') {
			return 'conflicting';
		}

		return '';
	}

	@volatile
	get indicatorLabel() {
		return undefined;
	}

	@volatile
	get assignees() {
		const assignees = this.pullRequest?.assignees;
		if (assignees == null) {
			return [];
		}
		const author: PullRequestMember | undefined = this.pullRequest!.author;
		if (author != null) {
			return assignees.filter(assignee => assignee.name !== author.name);
		}

		return assignees;
	}

	onOpenWorktreeClick(e: Event) {
		if (this.isCurrentWorktree) {
			e.preventDefault();
			e.stopImmediatePropagation();
			return;
		}
		this.$emit('open-worktree', this.pullRequest!);
	}

	onSwitchBranchClick(e: Event) {
		if (this.isCurrentBranch) {
			e.preventDefault();
			e.stopImmediatePropagation();
			return;
		}
		this.$emit('switch-branch', this.pullRequest!);
	}
}

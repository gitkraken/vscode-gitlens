import { css, customElement, FASTElement, html, observable, volatile, when } from '@microsoft/fast-element';
import type { IssueMember, IssueShape } from '../../../../../git/models/issue';
import { fromNow } from '../../../../../system/date';
import { focusOutline, srOnly } from '../../../shared/components/styles/a11y';
import { elementBase } from '../../../shared/components/styles/base';
import { fromDateRange } from './helpers';
import '../../../shared/components/table/table-cell';
import '../../../shared/components/avatars/avatar-item';
import '../../../shared/components/avatars/avatar-stack';
import '../../../shared/components/code-icon';
import './git-avatars';

const template = html<IssueRow>`
	<template role="row">
		<table-cell class="status">
			${when(x => x.issue!.closed === true, html`<code-icon icon="pass"></code-icon>`)}
			${when(x => x.issue!.closed !== true, html`<code-icon icon="issues"></code-icon>`)}
		</table-cell>
		<table-cell class="time"
			><span class="${x => x.lastUpdatedClass}" title="${x => x.lastUpdatedLabel}"
				>${x => x.lastUpdated}</span
			></table-cell
		>
		<table-cell>
			${x => x.issue!.title} <a href="${x => x.issue!.url}">#${x => x.issue!.id}</a><br />
			<small>
				<span class="tag"><code-icon icon="repo"></code-icon>${x => x.issue!.repository.repo}</span>
			</small>
		</table-cell>
		<table-cell class="vcenter participants">
			${when(
				x => x.issue!.author != null,
				html<IssueRow>`
					<avatar-stack>
						<avatar-item
							media="${x => x.issue!.author?.avatarUrl}"
							title="${x => x.issue!.author?.name} (author)"
						></avatar-item>
					</avatar-stack>
				`,
			)}
			${when(
				x => x.assignees.length > 0,
				html<IssueRow>`<git-avatars :avatars="${x => x.issue!.assignees}"></git-avatars>`,
			)}
		</table-cell>
		<table-cell class="vcenter">${x => x.issue!.commentsCount}</table-cell>
		<table-cell class="vcenter">${x => x.issue!.thumbsUpCount}</table-cell>
		<table-cell class="vcenter actions">
			<a href="${x => x.issue!.url}" title="Open issue on remote"><code-icon icon="globe"></code-icon></a>
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
	name: 'issue-row',
	template: template,
	styles: styles,
})
export class IssueRow extends FASTElement {
	@observable
	public issue?: IssueShape;

	@observable
	public reasons?: string[];

	@volatile
	get lastUpdatedDate() {
		return new Date(this.issue!.date);
	}

	@volatile
	get lastUpdatedState() {
		return fromDateRange(this.lastUpdatedDate);
	}

	@volatile
	get lastUpdated() {
		return fromNow(this.lastUpdatedDate, true);
	}

	@volatile
	get lastUpdatedLabel() {
		return fromNow(this.lastUpdatedDate);
	}

	@volatile
	get lastUpdatedClass() {
		switch (this.lastUpdatedState.status) {
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
		return '';
	}

	@volatile
	get indicatorLabel() {
		return undefined;
	}

	@volatile
	get assignees() {
		const assignees = this.issue?.assignees;
		if (assignees == null) {
			return [];
		}
		const author: IssueMember | undefined = this.issue!.author;
		if (author != null) {
			return assignees.filter(assignee => assignee.url !== author.url);
		}

		return assignees;
	}
}

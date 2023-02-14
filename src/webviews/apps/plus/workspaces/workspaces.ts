import type { State } from '../../../../plus/webviews/workspaces/protocol';
import { App } from '../../shared/appBase';
import type { IssueRow } from './components/issue-row';
import type { PullRequestRow } from './components/pull-request-row';
import '../../shared/components/code-icon';
import '../../shared/components/avatars/avatar-item';
import '../../shared/components/avatars/avatar-stack';
import '../../shared/components/table/table-container';
import '../../shared/components/table/table-row';
import '../../shared/components/table/table-cell';
import './components/issue-row';
import './components/pull-request-row';
import './workspaces.scss';

export class WorkspacesApp extends App<State> {
	constructor() {
		super('WorkspacesApp');
	}

	override onInitialize() {
		this.log(`${this.appName}.onInitialize`);
		this.renderContent();
		console.log(this.state);
	}

	renderContent() {
		this.renderPullRequests();
		this.renderIssues();
	}

	renderPullRequests() {
		const tableEl = document.getElementById('pull-requests');

		if (this.state.pullRequests != null && this.state.pullRequests?.length > 0) {
			const els = this.state.pullRequests.map(({ pullRequest, reasons }) => {
				const rowEl = document.createElement('pull-request-row') as PullRequestRow;
				rowEl.pullRequest = pullRequest;
				rowEl.reasons = reasons;

				return rowEl;
			});
			tableEl?.append(...els);
		}
	}

	renderIssues() {
		const tableEl = document.getElementById('issues');

		if (this.state.issues != null && this.state.issues?.length > 0) {
			const els = this.state.issues.map(({ issue, reasons }) => {
				const rowEl = document.createElement('issue-row') as IssueRow;
				rowEl.issue = issue;
				rowEl.reasons = reasons;

				return rowEl;
			});
			tableEl?.append(...els);
		}
	}
}

new WorkspacesApp();

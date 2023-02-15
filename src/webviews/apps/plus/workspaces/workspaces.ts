import type { State } from '../../../../plus/webviews/workspaces/protocol';
import { DidChangeStateNotificationType } from '../../../../plus/webviews/workspaces/protocol';
import type { IpcMessage } from '../../../protocol';
import { onIpc } from '../../../protocol';
import { App } from '../../shared/appBase';
import type { IssueRow } from './components/issue-row';
import type { PullRequestRow } from './components/pull-request-row';
import '../../shared/components/code-icon';
import '../../shared/components/avatars/avatar-item';
import '../../shared/components/avatars/avatar-stack';
import '../../shared/components/menu/menu-list';
import '../../shared/components/menu/menu-item';
import '../../shared/components/menu/menu-label';
import '../../shared/components/menu/menu-divider';
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

	protected override onMessageReceived(e: MessageEvent) {
		const msg = e.data as IpcMessage;
		this.log(`onMessageReceived(${msg.id}): name=${msg.method}`);

		switch (msg.method) {
			case DidChangeStateNotificationType.method:
				onIpc(DidChangeStateNotificationType, msg, params => {
					this.setState({ ...this.state, ...params.state });
					this.renderContent();
				});
				break;
		}
	}

	renderContent() {
		this.renderPullRequests();
		this.renderIssues();
	}

	renderPullRequests() {
		const tableEl = document.getElementById('pull-requests');
		if (tableEl == null) return;
		if (tableEl.childNodes.length > 1) {
			tableEl.childNodes.forEach((node, index) => {
				if (index > 0) {
					tableEl.removeChild(node);
				}
			});
		}

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
		if (tableEl == null) return;
		if (tableEl.childNodes.length > 1) {
			tableEl.childNodes.forEach((node, index) => {
				if (index > 0) {
					tableEl.removeChild(node);
				}
			});
		}

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

import type { State } from '../../../../plus/webviews/workspaces/protocol';
import {
	DidChangeStateNotificationType,
	DidChangeSubscriptionNotificationType,
} from '../../../../plus/webviews/workspaces/protocol';
import type { IpcMessage } from '../../../protocol';
import { onIpc } from '../../../protocol';
import { App } from '../../shared/appBase';
import type { AccountBadge } from '../../shared/components/account/account-badge';
import { DOM } from '../../shared/dom';
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
import '../../shared/components/account/account-badge';
import './components/issue-row';
import './components/pull-request-row';
import './workspaces.scss';

export class WorkspacesApp extends App<State> {
	constructor() {
		super('WorkspacesApp');
	}

	_prFilter?: string;
	_issueFilter?: string;

	override onInitialize() {
		this.log(`${this.appName}.onInitialize`);
		this.renderContent();
		console.log(this.state);
	}

	protected override onBind() {
		const disposables = super.onBind?.() ?? [];

		disposables.push(
			DOM.on('#pr-filter [data-tab]', 'click', e =>
				this.onSelectTab(e, val => {
					this._prFilter = val;
					this.renderPullRequests();
				}),
			),
		);
		disposables.push(
			DOM.on('#issue-filter [data-tab]', 'click', e =>
				this.onSelectTab(e, val => {
					this._issueFilter = val;
					this.renderIssues();
				}),
			),
		);
		return disposables;
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
			case DidChangeSubscriptionNotificationType.method:
				onIpc(DidChangeSubscriptionNotificationType, msg, params => {
					this.setState({ ...this.state, subscription: params.subscription, isPlus: params.isPlus });
					this.renderContent();
				});
				break;
		}
	}

	renderContent() {
		this.renderAccountState();

		if (this.state.isPlus) {
			this.renderPullRequests();
			this.renderIssues();
		}
	}

	renderPullRequests() {
		const tableEl = document.getElementById('pull-requests');
		if (tableEl == null) return;

		const rowEls = tableEl.querySelectorAll('pull-request-row');
		rowEls.forEach(el => el.remove());

		const noneEl = document.getElementById('no-pull-requests')!;
		const loadingEl = document.getElementById('loading-pull-requests')!;
		if (this.state.pullRequests == null) {
			noneEl.setAttribute('hidden', 'true');
			loadingEl.removeAttribute('hidden');
		} else if (this.state.pullRequests.length === 0) {
			noneEl.removeAttribute('hidden');
			loadingEl.setAttribute('hidden', 'true');
		} else {
			noneEl.setAttribute('hidden', 'true');
			loadingEl.setAttribute('hidden', 'true');
			this.state.pullRequests.forEach(({ pullRequest, reasons }) => {
				if (this._prFilter == null || this._prFilter === '' || reasons.includes(this._prFilter)) {
					const rowEl = document.createElement('pull-request-row') as PullRequestRow;
					rowEl.pullRequest = pullRequest;
					rowEl.reasons = reasons;

					tableEl.append(rowEl);
				}
			});
		}
	}

	renderIssues() {
		const tableEl = document.getElementById('issues')!;

		const rowEls = tableEl.querySelectorAll('issue-row');
		rowEls.forEach(el => el.remove());

		const noneEl = document.getElementById('no-issues')!;
		const loadingEl = document.getElementById('loading-issues')!;
		if (this.state.issues == null) {
			noneEl.setAttribute('hidden', 'true');
			loadingEl.removeAttribute('hidden');
		} else if (this.state.issues.length === 0) {
			noneEl.removeAttribute('hidden');
			loadingEl.setAttribute('hidden', 'true');
		} else {
			noneEl.setAttribute('hidden', 'true');
			loadingEl.setAttribute('hidden', 'true');
			this.state.issues.forEach(({ issue, reasons }) => {
				if (this._issueFilter == null || this._issueFilter === '' || reasons.includes(this._issueFilter)) {
					const rowEl = document.createElement('issue-row') as IssueRow;
					rowEl.issue = issue;
					rowEl.reasons = reasons;

					tableEl.append(rowEl);
				}
			});
		}
	}

	renderAccountState() {
		const content = document.getElementById('content')!;
		const overlay = document.getElementById('overlay')!;
		if (this.state.isPlus) {
			content.removeAttribute('aria-hidden');
			overlay.setAttribute('hidden', 'true');
		} else {
			content.setAttribute('aria-hidden', 'true');
			overlay.removeAttribute('hidden');
		}

		// const badgeEl = document.getElementById('account-badge')! as AccountBadge;
		const badgeEl = document.createElement('account-badge') as AccountBadge;
		badgeEl.subscription = this.state.subscription;

		const headerEl = document.getElementById('header')!;
		headerEl.innerHTML = '';
		headerEl.append(badgeEl);
	}

	onSelectTab(e: Event, callback?: (val?: string) => void) {
		const thisEl = e.target as HTMLElement;
		const tab = thisEl.dataset.tab!;

		thisEl.parentElement?.querySelectorAll('[data-tab]')?.forEach(el => {
			if ((el as HTMLElement).dataset.tab !== tab) {
				el.classList.remove('is-active');
			} else {
				el.classList.add('is-active');
			}
		});

		callback?.(tab);
	}
}

new WorkspacesApp();

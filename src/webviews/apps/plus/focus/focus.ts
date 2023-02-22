import { provideVSCodeDesignSystem, vsCodeButton } from '@vscode/webview-ui-toolkit';
import type { State } from '../../../../plus/webviews/focus/protocol';
import {
	DidChangeStateNotificationType,
	DidChangeSubscriptionNotificationType,
} from '../../../../plus/webviews/focus/protocol';
import type { IpcMessage } from '../../../protocol';
import { ExecuteCommandType, onIpc } from '../../../protocol';
import { App } from '../../shared/appBase';
import type { AccountBadge } from '../../shared/components/account/account-badge';
import { DOM } from '../../shared/dom';
import type { IssueRow } from './components/issue-row';
import type { PlusContent } from './components/plus-content';
import type { PullRequestRow } from './components/pull-request-row';
import '../../shared/components/code-icon';
import '../../shared/components/avatars/avatar-item';
import '../../shared/components/avatars/avatar-stack';
import '../../shared/components/table/table-container';
import '../../shared/components/table/table-row';
import '../../shared/components/table/table-cell';
import '../../shared/components/account/account-badge';
import './components/issue-row';
import './components/plus-content';
import './components/pull-request-row';
import './focus.scss';

export class FocusApp extends App<State> {
	constructor() {
		super('FocusApp');
	}

	_prFilter?: string;
	_issueFilter?: string;

	override onInitialize() {
		this.log(`${this.appName}.onInitialize`);
		provideVSCodeDesignSystem().register(vsCodeButton());
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
		disposables.push(
			DOM.on('[data-action]', 'click', (e, target: HTMLElement) => this.onDataActionClicked(e, target)),
		);
		disposables.push(
			DOM.on<PlusContent, string>('plus-content', 'action', (e, target: HTMLElement) =>
				this.onPlusActionClicked(e, target),
			),
		);

		return disposables;
	}

	private onDataActionClicked(_e: MouseEvent, target: HTMLElement) {
		const action = target.dataset.action;
		this.onActionClickedCore(action);
	}

	private onPlusActionClicked(e: CustomEvent<string>, _target: HTMLElement) {
		this.onActionClickedCore(e.detail);
	}

	private onActionClickedCore(action?: string) {
		if (action?.startsWith('command:')) {
			this.sendCommand(ExecuteCommandType, { command: action.slice(8) });
		}
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
		const accountOverlay = document.getElementById('account-overlay')!;
		const connectOverlay = document.getElementById('connect-overlay')!;

		if (!this.state.isPlus) {
			content.setAttribute('aria-hidden', 'true');
			accountOverlay.removeAttribute('hidden');
			connectOverlay.setAttribute('hidden', 'true');
		} else if (this.state.repos != null && this.state.repos.some(repo => repo.isConnected) === false) {
			content.setAttribute('aria-hidden', 'true');
			accountOverlay.setAttribute('hidden', 'true');
			connectOverlay.removeAttribute('hidden');
		} else {
			content.removeAttribute('aria-hidden');
			accountOverlay.setAttribute('hidden', 'true');
			connectOverlay.setAttribute('hidden', 'true');
		}

		const badgeEl = document.getElementById('account-badge')! as AccountBadge;
		badgeEl.subscription = this.state.subscription;
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

new FocusApp();

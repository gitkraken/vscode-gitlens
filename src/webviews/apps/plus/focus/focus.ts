// import { FocusView } from '@gitkraken/shared-web-components';
import type { PullRequestShape } from '../../../../git/models/pullRequest';
import type { State } from '../../../../plus/webviews/focus/protocol';
import {
	DidChangeNotificationType,
	OpenWorktreeCommandType,
	SwitchToBranchCommandType,
} from '../../../../plus/webviews/focus/protocol';
import type { IpcMessage } from '../../../protocol';
import { onIpc } from '../../../protocol';
import { App } from '../../shared/appBase';
import type { FeatureGate } from '../../shared/components/feature-gate';
import type { FeatureGateBadge } from '../../shared/components/feature-gate-badge';
import { DOM } from '../../shared/dom';
import type { GkIssueRow } from './components/gk-issue-row';
import type { GkPullRequestRow } from './components/gk-pull-request-row';
import type { IssueRow } from './components/issue-row';
import type { PullRequestRow } from './components/pull-request-row';
import '../../shared/components/button';
import '../../shared/components/code-icon';
import '../../shared/components/feature-gate';
import '../../shared/components/avatars/avatar-item';
import '../../shared/components/avatars/avatar-stack';
import '../../shared/components/table/table-container';
import '../../shared/components/table/table-row';
import '../../shared/components/table/table-cell';
import '../../shared/components/feature-gate-badge';
import './components/issue-row';
import './components/pull-request-row';
import './components/gk-pull-request-row';
import './components/gk-issue-row';
import './focus.scss';
import '@gitkraken/shared-web-components';

export class FocusApp extends App<State> {
	constructor() {
		super('FocusApp');
	}

	private _focusFilter?: string;
	private _prFilter?: string;
	private _issueFilter?: string;

	override onInitialize() {
		this.renderContent();
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
			DOM.on('#issue-filter [data-tab]', 'click', e =>
				this.onSelectTab(e, val => {
					this._issueFilter = val;
					this.renderIssues();
				}),
			),
			DOM.on('#focus-filter [data-tab]', 'click', e =>
				this.onSelectTab(e, val => {
					this._focusFilter = val;
					this.renderIssues();
				}),
			),
			DOM.on<PullRequestRow, PullRequestShape>('pull-request-row', 'open-worktree', (e, target: HTMLElement) =>
				this.onOpenWorktree(e, target),
			),
			DOM.on<PullRequestRow, PullRequestShape>('pull-request-row', 'switch-branch', (e, target: HTMLElement) =>
				this.onSwitchBranch(e, target),
			),
		);

		return disposables;
	}

	private onSwitchBranch(e: CustomEvent<PullRequestShape>, _target: HTMLElement) {
		if (e.detail?.refs?.head == null) return;
		this.sendCommand(SwitchToBranchCommandType, { pullRequest: e.detail });
	}

	private onOpenWorktree(e: CustomEvent<PullRequestShape>, _target: HTMLElement) {
		if (e.detail?.refs?.head == null) return;
		this.sendCommand(OpenWorktreeCommandType, { pullRequest: e.detail });
	}

	protected override onMessageReceived(e: MessageEvent) {
		const msg = e.data as IpcMessage;
		this.log(`onMessageReceived(${msg.id}): name=${msg.method}`);

		switch (msg.method) {
			case DidChangeNotificationType.method:
				onIpc(DidChangeNotificationType, msg, params => {
					this.state = params.state;
					this.setState(this.state);
					this.renderContent();
				});
				break;
		}
	}

	renderContent() {
		let $gate = document.getElementById('subscription-gate')! as FeatureGate;
		if ($gate != null) {
			$gate.state = this.state.access.subscription.current.state;
			$gate.visible = this.state.access.allowed !== true;
		}

		$gate = document.getElementById('connection-gate')! as FeatureGate;
		if ($gate != null) {
			$gate.visible =
				this.state.access.allowed === true && !(this.state.repos?.some(r => r.isConnected) ?? false);
		}

		const $badge = document.getElementById('subscription-gate-badge')! as FeatureGateBadge;
		$badge.subscription = this.state.access.subscription.current;

		// this.renderPullRequests();
		// this.renderIssues();
		this.renderFocusList();
	}

	renderFocusList() {
		const tableEl = document.getElementById('list-focus-items');
		if (tableEl == null) return;

		tableEl.innerHTML = '';

		const noneEl = document.getElementById('no-focus-items')!;
		const loadingEl = document.getElementById('loading-focus-items')!;
		if (this.state.access.allowed !== true || (this.state.pullRequests == null && this.state.issues == null)) {
			noneEl.setAttribute('hidden', 'true');
			loadingEl.removeAttribute('hidden');
		} else if (
			(this.state.pullRequests == null || this.state.pullRequests.length === 0) &&
			(this.state.issues == null || this.state.issues.length === 0)
		) {
			noneEl.removeAttribute('hidden');
			loadingEl.setAttribute('hidden', 'true');
		} else {
			noneEl.setAttribute('hidden', 'true');
			loadingEl.setAttribute('hidden', 'true');
			let rank = 0;
			this.state.pullRequests?.forEach(
				({ pullRequest, reasons, isCurrentBranch, isCurrentWorktree, hasWorktree, hasLocalBranch }, i) => {
					if (this._focusFilter == null || this._focusFilter === '' || reasons.includes(this._focusFilter)) {
						const rowEl = document.createElement('gk-pull-request-row') as GkPullRequestRow;
						rowEl.pullRequest = pullRequest;
						rowEl.rank = ++rank;
						// rowEl2.reasons = reasons;
						rowEl.isCurrentBranch = isCurrentBranch;
						rowEl.isCurrentWorktree = isCurrentWorktree;
						rowEl.hasWorktree = hasWorktree;
						rowEl.hasLocalBranch = hasLocalBranch;

						tableEl.append(rowEl);
					}
				},
			);

			this.state.issues?.forEach(({ issue, reasons }) => {
				if (this._focusFilter == null || this._focusFilter === '' || reasons.includes(this._focusFilter)) {
					const rowEl = document.createElement('gk-issue-row') as GkIssueRow;
					rowEl.rank = ++rank;
					rowEl.issue = issue;

					tableEl.append(rowEl);
				}
			});
		}
	}

	renderPullRequests() {
		const tableEl = document.getElementById('pull-requests');
		if (tableEl == null) return;
		const tableEl2 = document.getElementById('share-pull-requests')!;

		const rowEls = tableEl.querySelectorAll('pull-request-row');
		rowEls.forEach(el => el.remove());

		const noneEl = document.getElementById('no-pull-requests')!;
		const loadingEl = document.getElementById('loading-pull-requests')!;
		if (this.state.pullRequests == null || this.state.access.allowed !== true) {
			noneEl.setAttribute('hidden', 'true');
			loadingEl.removeAttribute('hidden');
		} else if (this.state.pullRequests.length === 0) {
			noneEl.removeAttribute('hidden');
			loadingEl.setAttribute('hidden', 'true');
		} else {
			noneEl.setAttribute('hidden', 'true');
			loadingEl.setAttribute('hidden', 'true');
			tableEl2.innerHTML = '';
			this.state.pullRequests.forEach(
				({ pullRequest, reasons, isCurrentBranch, isCurrentWorktree, hasWorktree, hasLocalBranch }, i) => {
					if (this._prFilter == null || this._prFilter === '' || reasons.includes(this._prFilter)) {
						const rowEl = document.createElement('pull-request-row') as PullRequestRow;
						rowEl.pullRequest = pullRequest;
						rowEl.reasons = reasons;
						rowEl.isCurrentBranch = isCurrentBranch;
						rowEl.isCurrentWorktree = isCurrentWorktree;
						rowEl.hasWorktree = hasWorktree;
						rowEl.hasLocalBranch = hasLocalBranch;

						tableEl.append(rowEl);

						const rowEl2 = document.createElement('gk-pull-request-row') as GkPullRequestRow;
						rowEl2.pullRequest = pullRequest;
						rowEl2.rank = i + 1;
						// rowEl2.reasons = reasons;
						rowEl2.isCurrentBranch = isCurrentBranch;
						rowEl2.isCurrentWorktree = isCurrentWorktree;
						rowEl2.hasWorktree = hasWorktree;
						rowEl2.hasLocalBranch = hasLocalBranch;

						tableEl2.append(rowEl2);
					}
				},
			);
		}
	}

	renderIssues() {
		const tableEl = document.getElementById('issues')!;

		const rowEls = tableEl.querySelectorAll('issue-row');
		rowEls.forEach(el => el.remove());
		const tableEl2 = document.getElementById('share-pull-requests')!;

		const noneEl = document.getElementById('no-issues')!;
		const loadingEl = document.getElementById('loading-issues')!;
		if (this.state.issues == null || this.state.access.allowed !== true) {
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

					const rowEl2 = document.createElement('gk-issue-row') as GkIssueRow;
					rowEl2.issue = issue;

					tableEl2.append(rowEl2);
				}
			});
		}
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

// customElements.define(FocusView.tag, FocusView);
// FocusView.define();

new FocusApp();

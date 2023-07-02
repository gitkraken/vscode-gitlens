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
import './focus.scss';

export class FocusApp extends App<State> {
	constructor() {
		super('FocusApp');
	}

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

		this.renderPullRequests();
		this.renderIssues();
	}

	renderPullRequests() {
		const tableEl = document.getElementById('pull-requests');
		if (tableEl == null) return;

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
			this.state.pullRequests.forEach(
				({ pullRequest, reasons, isCurrentBranch, isCurrentWorktree, hasWorktree, hasLocalBranch }) => {
					if (this._prFilter == null || this._prFilter === '' || reasons.includes(this._prFilter)) {
						const rowEl = document.createElement('pull-request-row') as PullRequestRow;
						rowEl.pullRequest = pullRequest;
						rowEl.reasons = reasons;
						rowEl.isCurrentBranch = isCurrentBranch;
						rowEl.isCurrentWorktree = isCurrentWorktree;
						rowEl.hasWorktree = hasWorktree;
						rowEl.hasLocalBranch = hasLocalBranch;

						tableEl.append(rowEl);
					}
				},
			);
		}
	}

	renderIssues() {
		const tableEl = document.getElementById('issues')!;

		const rowEls = tableEl.querySelectorAll('issue-row');
		rowEls.forEach(el => el.remove());

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

new FocusApp();

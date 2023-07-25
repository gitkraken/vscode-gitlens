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
import type { GlFocusApp } from './components/focus-app';
import type { GkIssueRow } from './components/gk-issue-row';
import type { GkPullRequestRow } from './components/gk-pull-request-row';
// import type { IssueRow } from './components/issue-row';
// import type { PullRequestRow } from './components/pull-request-row';
// import '../../shared/components/button';
import '../../shared/components/code-icon';
import '../../shared/components/feature-gate';
import '../../shared/components/avatars/avatar-item';
import '../../shared/components/avatars/avatar-stack';
import '../../shared/components/table/table-container';
import '../../shared/components/table/table-row';
import '../../shared/components/table/table-cell';
import '../../shared/components/feature-gate-badge';
// import './components/issue-row';
// import './components/pull-request-row';
import './components/gk-pull-request-row';
import './components/gk-issue-row';
import './components/focus-app';
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
		this.attachState();
	}

	protected override onBind() {
		const disposables = super.onBind?.() ?? [];

		disposables.push(
			DOM.on<GkPullRequestRow, PullRequestShape>(
				'gk-pull-request-row',
				'open-worktree',
				(e, target: HTMLElement) => this.onOpenWorktree(e, target),
			),
			DOM.on<GkPullRequestRow, PullRequestShape>(
				'gk-pull-request-row',
				'switch-branch',
				(e, target: HTMLElement) => this.onSwitchBranch(e, target),
			),
		);

		return disposables;
	}

	private _component?: GlFocusApp;
	private get component() {
		if (this._component == null) {
			this._component = (document.getElementById('app') as GlFocusApp)!;
		}
		return this._component;
	}

	attachState() {
		this.component.state = this.state;
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
					// this.renderContent();
					this.attachState();
				});
				break;
		}
	}
}

// customElements.define(FocusView.tag, FocusView);
// FocusView.define();

new FocusApp();

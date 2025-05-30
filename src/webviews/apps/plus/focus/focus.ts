import type { IssueShape } from '../../../../git/models/issue';
import type { PullRequestShape } from '../../../../git/models/pullRequest';
import type { State } from '../../../../plus/webviews/focus/protocol';
import {
	DidChangeNotificationType,
	OpenBranchCommandType,
	OpenWorktreeCommandType,
	PinIssueCommandType,
	PinPrCommandType,
	SnoozeIssueCommandType,
	SnoozePrCommandType,
	SwitchToBranchCommandType,
} from '../../../../plus/webviews/focus/protocol';
import type { IpcMessage } from '../../../protocol';
import { onIpc } from '../../../protocol';
import { App } from '../../shared/appBase';
import { DOM } from '../../shared/dom';
import type { GlFocusApp } from './components/focus-app';
import type { GkIssueRow } from './components/gk-issue-row';
import type { GkPullRequestRow } from './components/gk-pull-request-row';
import './components/focus-app';
import './focus.scss';

export class FocusApp extends App<State> {
	constructor() {
		super('FocusApp');
	}

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
			DOM.on<GkPullRequestRow, PullRequestShape>('gk-pull-request-row', 'open-branch', (e, target: HTMLElement) =>
				this.onOpenBranch(e, target),
			),
			DOM.on<GkPullRequestRow, PullRequestShape>(
				'gk-pull-request-row',
				'switch-branch',
				(e, target: HTMLElement) => this.onSwitchBranch(e, target),
			),
			DOM.on<GkPullRequestRow, { item: PullRequestShape | IssueShape; snooze?: string }>(
				'gk-pull-request-row',
				'snooze-item',
				(e, _target: HTMLElement) => this.onSnoozeItem(e, false),
			),
			DOM.on<GkPullRequestRow, { item: PullRequestShape | IssueShape; pin?: string }>(
				'gk-pull-request-row',
				'pin-item',
				(e, _target: HTMLElement) => this.onPinItem(e, false),
			),
			DOM.on<GkIssueRow, { item: PullRequestShape | IssueShape; snooze?: string }>(
				'gk-issue-row',
				'snooze-item',
				(e, _target: HTMLElement) => this.onSnoozeItem(e, true),
			),
			DOM.on<GkIssueRow, { item: PullRequestShape | IssueShape; pin?: string }>(
				'gk-issue-row',
				'pin-item',
				(e, _target: HTMLElement) => this.onPinItem(e, true),
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

	private onOpenBranch(e: CustomEvent<PullRequestShape>, _target: HTMLElement) {
		if (e.detail?.refs?.head == null) return;
		this.sendCommand(OpenBranchCommandType, { pullRequest: e.detail });
	}

	private onSwitchBranch(e: CustomEvent<PullRequestShape>, _target: HTMLElement) {
		if (e.detail?.refs?.head == null) return;
		this.sendCommand(SwitchToBranchCommandType, { pullRequest: e.detail });
	}

	private onOpenWorktree(e: CustomEvent<PullRequestShape>, _target: HTMLElement) {
		if (e.detail?.refs?.head == null) return;
		this.sendCommand(OpenWorktreeCommandType, { pullRequest: e.detail });
	}

	private onSnoozeItem(e: CustomEvent<{ item: PullRequestShape | IssueShape; snooze?: string }>, isIssue: boolean) {
		if (isIssue) {
			this.sendCommand(SnoozeIssueCommandType, { issue: e.detail.item as IssueShape, snooze: e.detail.snooze });
		} else {
			this.sendCommand(SnoozePrCommandType, {
				pullRequest: e.detail.item as PullRequestShape,
				snooze: e.detail.snooze,
			});
		}
	}

	private onPinItem(e: CustomEvent<{ item: PullRequestShape | IssueShape; pin?: string }>, isIssue: boolean) {
		if (isIssue) {
			this.sendCommand(PinIssueCommandType, { issue: e.detail.item as IssueShape, pin: e.detail.pin });
		} else {
			this.sendCommand(PinPrCommandType, { pullRequest: e.detail.item as PullRequestShape, pin: e.detail.pin });
		}
	}

	protected override onMessageReceived(msg: IpcMessage) {
		switch (msg.method) {
			case DidChangeNotificationType.method:
				onIpc(DidChangeNotificationType, msg, params => {
					this.state = params.state;
					this.setState(this.state);
					this.attachState();
				});
				break;
			default:
				super.onMessageReceived?.(msg);
		}
	}
}

new FocusApp();

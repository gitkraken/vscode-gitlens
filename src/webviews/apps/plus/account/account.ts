/*global*/
import './account.scss';
import type { Disposable } from 'vscode';
import { getSubscriptionTimeRemaining, SubscriptionState } from '../../../../plus/gk/account/subscription';
import type { State } from '../../../../plus/webviews/account/protocol';
import { DidChangeSubscriptionNotificationType } from '../../../../plus/webviews/account/protocol';
import type { IpcMessage } from '../../../protocol';
import { ExecuteCommandType, onIpc } from '../../../protocol';
import { App } from '../../shared/appBase';
import { DOM } from '../../shared/dom';
import type { AccountContent } from './components/account-content';
import './components/account-content';

export class AccountApp extends App<State> {
	constructor() {
		super('AccountApp');
	}

	protected override onInitialize() {
		this.state = this.getState() ?? this.state;
		this.updateState();
	}

	protected override onBind(): Disposable[] {
		const disposables = super.onBind?.() ?? [];

		disposables.push(
			DOM.on('[data-action]', 'click', (e, target: HTMLElement) => this.onDataActionClicked(e, target)),
		);

		return disposables;
	}

	protected override onMessageReceived(msg: IpcMessage) {
		switch (msg.method) {
			case DidChangeSubscriptionNotificationType.method:
				onIpc(DidChangeSubscriptionNotificationType, msg, params => {
					this.state.subscription = params.subscription;
					this.state.avatar = params.avatar;
					this.state.hasMultipleOrganizations = params.hasMultipleOrganizations;
					this.state.timestamp = Date.now();
					this.setState(this.state);
					this.updateState();
				});
				break;

			default:
				super.onMessageReceived?.(msg);
				break;
		}
	}

	private onDataActionClicked(_e: MouseEvent, target: HTMLElement) {
		const action = target.dataset.action;
		this.onActionClickedCore(action);
	}

	private onActionClickedCore(action?: string) {
		if (action?.startsWith('command:')) {
			this.sendCommand(ExecuteCommandType, { command: action.slice(8) });
		}
	}

	private getDaysRemaining() {
		if (this.state.subscription.state !== SubscriptionState.FreePlusInTrial) {
			return 0;
		}

		return getSubscriptionTimeRemaining(this.state.subscription, 'days') ?? 0;
	}

	private updateState() {
		const days = this.getDaysRemaining();
		const { subscription, avatar, hasMultipleOrganizations } = this.state;

		const $content = document.getElementById('account-content')! as AccountContent;

		$content.image = avatar ?? '';
		$content.name = subscription.account?.name ?? '';
		$content.state = subscription.state;
		$content.organization = subscription.activeOrganization?.name ?? '';
		$content.hasMultipleOrganizations = hasMultipleOrganizations ?? false;
		$content.plan = subscription.plan.effective.name;
		$content.days = days;
		$content.trialReactivationCount = subscription.plan.effective.trialReactivationCount;
	}
}

new AccountApp();

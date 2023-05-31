/*global*/
import './account.scss';
import type { Disposable } from 'vscode';
import type { State } from '../../../../plus/webviews/account/protocol';
import { DidChangeSubscriptionNotificationType } from '../../../../plus/webviews/account/protocol';
import { getSubscriptionTimeRemaining, SubscriptionState } from '../../../../subscription';
import type { IpcMessage } from '../../../protocol';
import { ExecuteCommandType, onIpc } from '../../../protocol';
import { App } from '../../shared/appBase';
import { DOM } from '../../shared/dom';
import type { HeaderCard } from './components/header-card';
import '../../shared/components/code-icon';
import './components/header-card';

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

	protected override onMessageReceived(e: MessageEvent) {
		const msg = e.data as IpcMessage;

		switch (msg.method) {
			case DidChangeSubscriptionNotificationType.method:
				this.log(`onMessageReceived(${msg.id}): name=${msg.method}`);

				onIpc(DidChangeSubscriptionNotificationType, msg, params => {
					this.state.subscription = params.subscription;
					this.state.avatar = params.avatar;
					this.setState(this.state);
					this.updateState();
				});
				break;

			default:
				super.onMessageReceived?.(e);
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
		if (
			![SubscriptionState.FreeInPreviewTrial, SubscriptionState.FreePlusInTrial].includes(
				this.state.subscription.state,
			)
		) {
			return 0;
		}

		return getSubscriptionTimeRemaining(this.state.subscription, 'days') ?? 0;
	}

	private updateHeader(days = this.getDaysRemaining()) {
		const { subscription, avatar } = this.state;

		const $headerContent = document.getElementById('header-card')! as HeaderCard;
		if (avatar) {
			$headerContent.setAttribute('image', avatar);
		}
		$headerContent.setAttribute('name', subscription.account?.name ?? '');

		// TODO: remove
		const steps = 0;
		const completed = 0;

		$headerContent.setAttribute('steps', steps.toString());
		$headerContent.setAttribute('completed', completed.toString());
		$headerContent.setAttribute('state', subscription.state.toString());
		$headerContent.setAttribute('plan', subscription.plan.effective.name);
		$headerContent.setAttribute('days', days.toString());
	}

	private updateState() {
		const days = this.getDaysRemaining();
		this.updateHeader(days);
	}
}

new AccountApp();

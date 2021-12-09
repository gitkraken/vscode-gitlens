import { commands, Disposable, window } from 'vscode';
import type { Container } from '../../../container';
import type { SubscriptionChangeEvent } from '../../../premium/subscription/subscriptionService';
import type { Subscription } from '../../../subscription';
import { WebviewViewBase } from '../../webviewViewBase';
import { DidChangeSubscriptionNotificationType, State } from './protocol';

export class HomeWebviewView extends WebviewViewBase<State> {
	constructor(container: Container) {
		super(container, 'gitlens.views.home', 'home.html', 'Home');

		this.disposables.push(this.container.subscription.onDidChange(this.onSubscriptionChanged, this));
	}

	private onSubscriptionChanged(e: SubscriptionChangeEvent) {
		void this.notifyDidChangeData(e.current);
	}

	protected override registerCommands(): Disposable[] {
		// TODO@eamodio implement hide commands
		return [
			commands.registerCommand('gitlens.home.hideWelcome', () => {}),
			commands.registerCommand('gitlens.home.hideSubscription', () => {}),
		];
	}

	protected override async includeBootstrap(): Promise<State> {
		const subscription = await this.container.subscription.getSubscription();
		return {
			subscription: subscription,
		};
	}

	private notifyDidChangeData(subscription: Subscription) {
		if (!this.isReady) return false;

		return window.withProgress({ location: { viewId: this.id } }, () =>
			this.notify(DidChangeSubscriptionNotificationType, { subscription: subscription }),
		);
	}
}

import { commands, Disposable, window } from 'vscode';
import type { Container } from '../../container';
import type { SubscriptionChangeEvent } from '../../plus/subscription/subscriptionService';
import { ensurePlusFeaturesEnabled } from '../../plus/subscription/utils';
import { SyncedStorageKeys } from '../../storage';
import type { Subscription } from '../../subscription';
import { WebviewViewBase } from '../webviewViewBase';
import { DidChangeSubscriptionNotificationType, State } from './protocol';

export class HomeWebviewView extends WebviewViewBase<State> {
	constructor(container: Container) {
		super(container, 'gitlens.views.home', 'home.html', 'Home');

		this.disposables.push(this.container.subscription.onDidChange(this.onSubscriptionChanged, this));
	}

	override async show(options?: { preserveFocus?: boolean | undefined }): Promise<void> {
		if (!(await ensurePlusFeaturesEnabled())) return;
		return super.show(options);
	}

	private onSubscriptionChanged(e: SubscriptionChangeEvent) {
		void this.notifyDidChangeData(e.current);
	}

	protected override onVisibilityChanged(visible: boolean): void {
		if (!visible) return;

		void this.validateSubscription();
	}

	protected override onWindowFocusChanged(focused: boolean): void {
		if (!focused) return;

		void this.validateSubscription();
	}

	private _validating: Promise<void> | undefined;
	private async validateSubscription(): Promise<void> {
		if (this._validating == null) {
			this._validating = this.container.subscription.validate();
			try {
				void (await this._validating);
			} finally {
				this._validating = undefined;
			}
		}
	}

	protected override registerCommands(): Disposable[] {
		return [
			commands.registerCommand(`${this.id}.refresh`, () => this.refresh(), this),
			commands.registerCommand('gitlens.home.toggleWelcome', async () => {
				const welcomeVisible = this.container.storage.get(SyncedStorageKeys.HomeViewWelcomeVisible, true);
				await this.container.storage.store(SyncedStorageKeys.HomeViewWelcomeVisible, !welcomeVisible);

				const subscription = await this.container.subscription.getSubscription();
				void this.notifyDidChangeData(subscription);
			}),
		];
	}

	protected override async includeBootstrap(): Promise<State> {
		const subscription = await this.container.subscription.getSubscription();
		return {
			subscription: subscription,
			welcomeVisible: this.container.storage.get(SyncedStorageKeys.HomeViewWelcomeVisible, true),
		};
	}

	private notifyDidChangeData(subscription: Subscription) {
		if (!this.isReady) return false;

		return window.withProgress({ location: { viewId: this.id } }, () =>
			this.notify(DidChangeSubscriptionNotificationType, {
				subscription: subscription,
				welcomeVisible: this.container.storage.get(SyncedStorageKeys.HomeViewWelcomeVisible, true),
			}),
		);
	}
}

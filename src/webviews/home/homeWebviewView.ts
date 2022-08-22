import type { Disposable } from 'vscode';
import { window } from 'vscode';
import { CoreCommands } from '../../constants';
import type { Container } from '../../container';
import type { SubscriptionChangeEvent } from '../../plus/subscription/subscriptionService';
import { ensurePlusFeaturesEnabled } from '../../plus/subscription/utils';
import type { Subscription } from '../../subscription';
import { executeCoreCommand, registerCommand } from '../../system/command';
import { WebviewViewBase } from '../webviewViewBase';
import type { State } from './protocol';
import { CompletedActions, DidChangeSubscriptionNotificationType } from './protocol';

export class HomeWebviewView extends WebviewViewBase<State> {
	constructor(container: Container) {
		super(container, 'gitlens.views.home', 'home.html', 'Home', 'homeView');

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

	protected override registerCommands(): Disposable[] {
		return [
			registerCommand(`${this.id}.refresh`, () => this.refresh(), this),
			registerCommand('gitlens.home.toggleWelcome', async () => {
				const welcomeVisible = !this.welcomeVisible;
				await this.container.storage.store('views:welcome:visible', welcomeVisible);
				if (welcomeVisible) {
					await this.container.storage.store('home:actions:completed', []);
				}

				void this.notifyDidChangeData();
			}),

			registerCommand('gitlens.home.showSCM', async () => {
				const completedActions = this.container.storage.get('home:actions:completed', []);
				if (!completedActions.includes(CompletedActions.OpenedSCM)) {
					completedActions.push(CompletedActions.OpenedSCM);
					await this.container.storage.store('home:actions:completed', completedActions);

					void this.notifyDidChangeData();
				}

				await executeCoreCommand(CoreCommands.ShowSCM);
			}),
		];
	}

	protected override async includeBootstrap(): Promise<State> {
		return this.getState();
	}

	private get welcomeVisible(): boolean {
		return this.container.storage.get('views:welcome:visible', true);
	}

	private async getState(subscription?: Subscription): Promise<State> {
		// Make sure to make a copy of the array otherwise it will be live to the storage value
		const completedActions = [...this.container.storage.get('home:actions:completed', [])];
		if (!this.welcomeVisible) {
			completedActions.push(CompletedActions.DismissedWelcome);
		}

		return {
			subscription: subscription ?? (await this.container.subscription.getSubscription()),
			completedActions: completedActions,
		};
	}

	private notifyDidChangeData(subscription?: Subscription) {
		if (!this.isReady) return false;

		return window.withProgress({ location: { viewId: this.id } }, async () =>
			this.notify(DidChangeSubscriptionNotificationType, await this.getState(subscription)),
		);
	}

	private _validating: Promise<void> | undefined;
	private async validateSubscription(): Promise<void> {
		if (this._validating == null) {
			this._validating = this.container.subscription.validate();
			try {
				await this._validating;
			} finally {
				this._validating = undefined;
			}
		}
	}
}

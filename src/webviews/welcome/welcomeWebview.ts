import type { ConfigurationChangeEvent } from 'vscode';
import { Disposable, workspace } from 'vscode';
import type { Container } from '../../container';
import type { SubscriptionChangeEvent } from '../../plus/subscription/subscriptionService';
import type { Subscription } from '../../subscription';
import { SubscriptionState } from '../../subscription';
import { configuration } from '../../system/configuration';
import type { IpcMessage } from '../protocol';
import { onIpc } from '../protocol';
import type { WebviewController, WebviewProvider } from '../webviewController';
import type { State, UpdateConfigurationParams } from './protocol';
import { DidChangeNotificationType, UpdateConfigurationCommandType } from './protocol';

const emptyDisposable = Object.freeze({
	dispose: () => {
		/* noop */
	},
});

export class WelcomeWebviewProvider implements WebviewProvider<State> {
	private readonly _disposable: Disposable;

	constructor(
		private readonly container: Container,
		private readonly host: WebviewController<State>,
	) {
		this._disposable = Disposable.from(
			configuration.onDidChange(this.onConfigurationChanged, this),
			this.container.git.onDidChangeRepositories(() => this.notifyDidChange(), this),
			!workspace.isTrusted
				? workspace.onDidGrantWorkspaceTrust(() => this.notifyDidChange(), this)
				: emptyDisposable,
			this.container.subscription.onDidChange(this.onSubscriptionChanged, this),
		);
	}

	dispose() {
		this._disposable.dispose();
	}

	includeBootstrap(): Promise<State> {
		return this.getState();
	}

	onReloaded() {
		void this.notifyDidChange();
	}

	private onSubscriptionChanged(e: SubscriptionChangeEvent) {
		void this.notifyDidChange(e.current);
	}

	private onConfigurationChanged(e: ConfigurationChangeEvent) {
		if (!configuration.changed(e, 'codeLens.enabled') && !configuration.changed(e, 'currentLine.enabled')) return;

		void this.notifyDidChange();
	}

	onMessageReceived(e: IpcMessage) {
		switch (e.method) {
			case UpdateConfigurationCommandType.method:
				onIpc(UpdateConfigurationCommandType, e, params => this.updateConfiguration(params));
				break;
		}
	}
	private async getState(subscription?: Subscription): Promise<State> {
		return {
			webviewId: this.host.id,
			timestamp: Date.now(),
			version: this.container.version,
			// Make sure to get the raw config so to avoid having the mode mixed in
			config: {
				codeLens: configuration.get('codeLens.enabled', undefined, true, true),
				currentLine: configuration.get('currentLine.enabled', undefined, true, true),
			},
			repoFeaturesBlocked:
				!workspace.isTrusted ||
				this.container.git.openRepositoryCount === 0 ||
				this.container.git.hasUnsafeRepositories(),
			isTrialOrPaid: await this.getTrialOrPaidState(subscription),
		};
	}

	private async getTrialOrPaidState(subscription?: Subscription): Promise<boolean> {
		const sub = subscription ?? (await this.container.subscription.getSubscription(true));

		if ([SubscriptionState.FreePlusInTrial, SubscriptionState.Paid].includes(sub.state)) {
			return true;
		}

		return false;
	}

	private updateConfiguration(params: UpdateConfigurationParams) {
		void configuration.updateEffective(`${params.type}.enabled`, params.value);
	}

	private async notifyDidChange(subscription?: Subscription) {
		void this.host.notify(DidChangeNotificationType, { state: await this.getState(subscription) });
	}
}

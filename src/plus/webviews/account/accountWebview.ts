import { Disposable, window } from 'vscode';
import { getAvatarUriFromGravatarEmail } from '../../../avatars';
import type { Container } from '../../../container';
import { registerCommand } from '../../../system/command';
import type { Deferrable } from '../../../system/function';
import { debounce } from '../../../system/function';
import type { WebviewController, WebviewProvider } from '../../../webviews/webviewController';
import type { Subscription } from '../../gk/account/subscription';
import type { SubscriptionChangeEvent } from '../../gk/account/subscriptionService';
import type { State } from './protocol';
import { DidChangeSubscriptionNotificationType } from './protocol';

export class AccountWebviewProvider implements WebviewProvider<State> {
	private readonly _disposable: Disposable;

	constructor(
		private readonly container: Container,
		private readonly host: WebviewController<State>,
	) {
		this._disposable = Disposable.from(this.container.subscription.onDidChange(this.onSubscriptionChanged, this));
	}

	dispose() {
		this._disposable.dispose();
	}

	private onSubscriptionChanged(e: SubscriptionChangeEvent) {
		void this.notifyDidChangeSubscription(e.current);
	}

	registerCommands(): Disposable[] {
		return [
			registerCommand(
				`${this.host.id}.refresh`,
				async () => {
					await this.validateSubscriptionCore(true);
					await this.host.refresh(true);
				},
				this,
			),
		];
	}

	includeBootstrap(): Promise<State> {
		return this.getState();
	}

	onReloaded(): void {
		void this.notifyDidChangeSubscription();
	}

	onVisibilityChanged(visible: boolean): void {
		if (!visible) {
			this._validateSubscriptionDebounced?.cancel();
			return;
		}

		queueMicrotask(() => void this.validateSubscription());
	}

	onWindowFocusChanged(focused: boolean): void {
		if (!focused || !this.host.visible) {
			this._validateSubscriptionDebounced?.cancel();
			return;
		}

		queueMicrotask(() => void this.validateSubscription());
	}

	private async getSubscription(subscription?: Subscription) {
		let sub = subscription ?? (await this.container.subscription.getSubscription(true));
		if (sub?.account != null && (sub?.activeOrganization == null || subscription == null)) {
			const activeOrganization = await this.container.subscription.getActiveOrganization({
				force: subscription == null,
			});
			sub = { ...sub, activeOrganization: activeOrganization };
		}

		let avatar;
		if (sub.account?.email) {
			avatar = getAvatarUriFromGravatarEmail(sub.account.email, 34).toString();
		} else {
			avatar = `${this.host.getWebRoot() ?? ''}/media/gitlens-logo.webp`;
		}

		const organizationCount = this.container.organization.organizationCount;

		return {
			subscription: sub,
			avatar: avatar,
			hasMultipleOrganizations: organizationCount != null && organizationCount > 1,
		};
	}

	private async getState(subscription?: Subscription): Promise<State> {
		const subscriptionResult = await this.getSubscription(subscription);

		return {
			...this.host.baseWebviewState,
			webroot: this.host.getWebRoot(),
			subscription: subscriptionResult.subscription,
			avatar: subscriptionResult.avatar,
			hasMultipleOrganizations: subscriptionResult.hasMultipleOrganizations,
		};
	}

	private notifyDidChangeSubscription(subscription?: Subscription) {
		return window.withProgress({ location: { viewId: this.host.id } }, async () => {
			const sub = await this.getSubscription(subscription);
			return this.host.notify(DidChangeSubscriptionNotificationType, {
				...sub,
			});
		});
	}

	private _validateSubscriptionDebounced: Deferrable<AccountWebviewProvider['validateSubscription']> | undefined =
		undefined;

	private async validateSubscription(): Promise<void> {
		if (this._validateSubscriptionDebounced == null) {
			this._validateSubscriptionDebounced = debounce(this.validateSubscriptionCore, 1000);
		}

		await this._validateSubscriptionDebounced();
	}

	private _validating: Promise<void> | undefined;
	private async validateSubscriptionCore(force?: boolean) {
		if (this._validating == null || force) {
			this._validating = this.container.subscription.validate({ force: force });
			try {
				await this._validating;
			} finally {
				this._validating = undefined;
			}
		}
	}
}

import { Disposable, window } from 'vscode';
import { getAvatarUriFromGravatarEmail } from '../../../avatars';
import type { Container } from '../../../container';
import type { RepositoriesVisibility } from '../../../git/gitProviderService';
import type { Subscription } from '../../../subscription';
import { registerCommand } from '../../../system/command';
import type { Deferrable } from '../../../system/function';
import { debounce } from '../../../system/function';
import type { WebviewController, WebviewProvider } from '../../../webviews/webviewController';
import type { SubscriptionChangeEvent } from '../../subscription/subscriptionService';
import type { State } from './protocol';
import { DidChangeSubscriptionNotificationType } from './protocol';

export class AccountWebviewProvider implements WebviewProvider<State> {
	private readonly _disposable: Disposable;

	constructor(private readonly container: Container, private readonly host: WebviewController<State>) {
		this._disposable = Disposable.from(this.container.subscription.onDidChange(this.onSubscriptionChanged, this));
	}

	dispose() {
		this._disposable.dispose();
	}

	private onSubscriptionChanged(e: SubscriptionChangeEvent) {
		void this.notifyDidChangeData(e.current);
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

	registerCommands(): Disposable[] {
		return [registerCommand(`${this.host.id}.refresh`, () => this.host.refresh(true), this)];
	}

	includeBootstrap(): Promise<State> {
		return this.getState();
	}

	private async getRepoVisibility(): Promise<RepositoriesVisibility> {
		const visibility = await this.container.git.visibility();
		return visibility;
	}

	private async getSubscription(subscription?: Subscription) {
		const sub = subscription ?? (await this.container.subscription.getSubscription(true));

		let avatar;
		if (sub.account?.email) {
			avatar = getAvatarUriFromGravatarEmail(sub.account.email, 34).toString();
		} else {
			avatar = `${this.host.getWebRoot() ?? ''}/media/gitlens-logo.webp`;
		}

		return {
			subscription: sub,
			avatar: avatar,
		};
	}

	private async getState(subscription?: Subscription): Promise<State> {
		const subscriptionResult = await this.getSubscription(subscription);

		return {
			timestamp: Date.now(),
			webroot: this.host.getWebRoot(),
			subscription: subscriptionResult.subscription,
			avatar: subscriptionResult.avatar,
		};
	}

	private notifyDidChangeData(subscription?: Subscription) {
		if (!this.host.ready) return false;

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
	private async validateSubscriptionCore() {
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

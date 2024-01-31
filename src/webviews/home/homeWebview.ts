import { Disposable, workspace } from 'vscode';
import type { ContextKeys } from '../../constants';
import type { Container } from '../../container';
import type { Subscription } from '../../plus/gk/account/subscription';
import { isSubscriptionExpired, isSubscriptionPaid, isSubscriptionTrial } from '../../plus/gk/account/subscription';
import type { SubscriptionChangeEvent } from '../../plus/gk/account/subscriptionService';
import { registerCommand } from '../../system/command';
import { getContext, onDidChangeContext } from '../../system/context';
import type { WebviewController, WebviewProvider } from '../webviewController';
import type { DidChangeRepositoriesParams, State } from './protocol';
import { DidChangeOrgSettingsType, DidChangeRepositoriesType, DidChangeSubscriptionType } from './protocol';

const emptyDisposable = Object.freeze({
	dispose: () => {
		/* noop */
	},
});

export class HomeWebviewProvider implements WebviewProvider<State> {
	private readonly _disposable: Disposable;

	constructor(
		private readonly container: Container,
		private readonly host: WebviewController<State>,
	) {
		this._disposable = Disposable.from(
			this.container.git.onDidChangeRepositories(this.onRepositoriesChanged, this),
			!workspace.isTrusted
				? workspace.onDidGrantWorkspaceTrust(this.notifyDidChangeRepositories, this)
				: emptyDisposable,
			this.container.subscription.onDidChange(this.onSubscriptionChanged, this),
			onDidChangeContext(this.onContextChanged, this),
		);
	}

	dispose() {
		this._disposable.dispose();
	}

	private onRepositoriesChanged() {
		this.notifyDidChangeRepositories();
	}

	registerCommands(): Disposable[] {
		return [registerCommand(`${this.host.id}.refresh`, () => this.host.refresh(true), this)];
	}

	includeBootstrap(): Promise<State> {
		return this.getState();
	}

	onReloaded() {
		this.notifyDidChangeRepositories();
	}

	private getOrgSettings(): State['orgSettings'] {
		return {
			drafts: getContext<boolean>('gitlens:gk:organization:drafts:enabled', false),
		};
	}

	private onContextChanged(key: ContextKeys) {
		if (key === 'gitlens:gk:organization:drafts:enabled') {
			this.notifyDidChangeOrgSettings();
		}
	}

	private onSubscriptionChanged(e: SubscriptionChangeEvent) {
		void this.notifyDidChangeSubscription(e.current);
	}

	private async getState(subscription?: Subscription): Promise<State> {
		return {
			...this.host.baseWebviewState,
			repositories: this.getRepositoriesState(),
			webroot: this.host.getWebRoot(),
			promoStates: await this.getCanShowPromos(subscription),
			orgSettings: this.getOrgSettings(),
		};
	}

	private getRepositoriesState(): DidChangeRepositoriesParams {
		return {
			count: this.container.git.repositoryCount,
			openCount: this.container.git.openRepositoryCount,
			hasUnsafe: this.container.git.hasUnsafeRepositories(),
			trusted: workspace.isTrusted,
		};
	}

	private async getCanShowPromos(subscription?: Subscription): Promise<Record<string, boolean>> {
		const promos = {
			hs2023: false,
			pro50: false,
		};

		const sub = subscription ?? (await this.container.subscription.getSubscription(true));
		const expiresTime = new Date('2023-12-31T07:59:00.000Z').getTime(); // 2023-12-30 23:59:00 PST-0800
		if (Date.now() < expiresTime && !isSubscriptionPaid(sub)) {
			promos.hs2023 = true;
		} else if (subscription != null && (isSubscriptionTrial(subscription) || isSubscriptionExpired(subscription))) {
			promos.pro50 = true;
		}

		return promos;
	}

	private notifyDidChangeRepositories() {
		void this.host.notify(DidChangeRepositoriesType, this.getRepositoriesState());
	}

	private async notifyDidChangeSubscription(subscription?: Subscription) {
		void this.host.notify(DidChangeSubscriptionType, {
			promoStates: await this.getCanShowPromos(subscription),
		});
	}

	private notifyDidChangeOrgSettings() {
		void this.host.notify(DidChangeOrgSettingsType, {
			orgSettings: this.getOrgSettings(),
		});
	}
}

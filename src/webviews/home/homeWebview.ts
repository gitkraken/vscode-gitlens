import type { ConfigurationChangeEvent } from 'vscode';
import { Disposable, window } from 'vscode';
import { getAvatarUriFromGravatarEmail } from '../../avatars';
import { ViewsLayout } from '../../commands/setViewsLayout';
import type { Container } from '../../container';
import type { RepositoriesVisibility } from '../../git/gitProviderService';
import type { SubscriptionChangeEvent } from '../../plus/subscription/subscriptionService';
import type { Subscription } from '../../subscription';
import { executeCoreCommand, registerCommand } from '../../system/command';
import { configuration } from '../../system/configuration';
import { getContext, onDidChangeContext } from '../../system/context';
import type { Deferrable } from '../../system/function';
import { debounce } from '../../system/function';
import type { StorageChangeEvent } from '../../system/storage';
import type { IpcMessage } from '../protocol';
import { onIpc } from '../protocol';
import type { WebviewController, WebviewProvider } from '../webviewController';
import type { CompleteStepParams, DismissBannerParams, DismissSectionParams, State } from './protocol';
import {
	CompletedActions,
	CompleteStepCommandType,
	DidChangeConfigurationType,
	DidChangeExtensionEnabledType,
	DidChangeLayoutType,
	DidChangeSubscriptionNotificationType,
	DismissBannerCommandType,
	DismissSectionCommandType,
	DismissStatusCommandType,
} from './protocol';

export class HomeWebviewProvider implements WebviewProvider<State> {
	private readonly _disposable: Disposable;

	constructor(private readonly container: Container, private readonly host: WebviewController<State>) {
		this._disposable = Disposable.from(
			this.container.subscription.onDidChange(this.onSubscriptionChanged, this),
			onDidChangeContext(key => {
				if (key !== 'gitlens:disabled') return;
				this.notifyExtensionEnabled();
			}),
			configuration.onDidChange(this.onConfigurationChanged, this),
			this.container.storage.onDidChange(this.onStorageChanged, this),
		);
	}

	dispose() {
		this._disposable.dispose();
	}

	private onConfigurationChanged(e: ConfigurationChangeEvent) {
		if (!configuration.changed(e, 'plusFeatures.enabled')) {
			return;
		}

		this.notifyDidChangeConfiguration();
	}

	private onStorageChanged(e: StorageChangeEvent) {
		if (e.key !== 'views:layout') return;

		this.notifyDidChangeLayout();
	}

	private async onSubscriptionChanged(e: SubscriptionChangeEvent) {
		await this.container.storage.store('home:status:pinned', true);
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
		return [
			registerCommand(`${this.host.id}.refresh`, () => this.host.refresh(true), this),
			registerCommand('gitlens.home.toggleWelcome', async () => {
				const welcomeVisible = !this.welcomeVisible;
				await this.container.storage.store('views:welcome:visible', welcomeVisible);
				if (welcomeVisible) {
					await Promise.allSettled([
						this.container.storage.store('home:actions:completed', []),
						this.container.storage.store('home:steps:completed', []),
						this.container.storage.store('home:sections:dismissed', []),
					]);
				}

				void this.host.refresh();
			}),
			registerCommand('gitlens.home.restoreWelcome', async () => {
				await Promise.allSettled([
					this.container.storage.store('home:steps:completed', []),
					this.container.storage.store('home:sections:dismissed', []),
				]);

				void this.host.refresh();
			}),

			registerCommand('gitlens.home.showSCM', async () => {
				const completedActions = this.container.storage.get('home:actions:completed', []);
				if (!completedActions.includes(CompletedActions.OpenedSCM)) {
					completedActions.push(CompletedActions.OpenedSCM);
					await this.container.storage.store('home:actions:completed', completedActions);

					void this.notifyDidChangeData();
				}

				await executeCoreCommand('workbench.view.scm');
			}),
		];
	}

	onMessageReceived(e: IpcMessage) {
		switch (e.method) {
			case CompleteStepCommandType.method:
				onIpc(CompleteStepCommandType, e, params => this.completeStep(params));
				break;
			case DismissSectionCommandType.method:
				onIpc(DismissSectionCommandType, e, params => this.dismissSection(params));
				break;
			case DismissStatusCommandType.method:
				onIpc(DismissStatusCommandType, e, _params => this.dismissPinStatus());
				break;
			case DismissBannerCommandType.method:
				onIpc(DismissBannerCommandType, e, params => this.dismissBanner(params));
				break;
		}
	}

	private completeStep({ id, completed = false }: CompleteStepParams) {
		const steps = this.container.storage.get('home:steps:completed', []);

		const hasStep = steps.includes(id);
		if (!hasStep && completed) {
			steps.push(id);
		} else if (hasStep && !completed) {
			steps.splice(steps.indexOf(id), 1);
		}
		void this.container.storage.store('home:steps:completed', steps);
	}

	private dismissSection(params: DismissSectionParams) {
		const sections = this.container.storage.get('home:sections:dismissed', []);
		if (sections.includes(params.id)) {
			return;
		}

		sections.push(params.id);
		void this.container.storage.store('home:sections:dismissed', sections);
	}

	private dismissBanner(params: DismissBannerParams) {
		const banners = this.container.storage.get('home:banners:dismissed', []);

		if (!banners.includes(params.id)) {
			banners.push(params.id);
		}

		void this.container.storage.store('home:banners:dismissed', banners);
	}

	private dismissPinStatus() {
		void this.container.storage.store('home:status:pinned', false);
	}

	includeBootstrap(): Promise<State> {
		return this.getState();
	}

	private get welcomeVisible(): boolean {
		return this.container.storage.get('views:welcome:visible', true);
	}

	private async getRepoVisibility(): Promise<RepositoriesVisibility> {
		const visibility = await this.container.git.visibility();
		return visibility;
	}

	private async getSubscription(subscription?: Subscription) {
		// Make sure to make a copy of the array otherwise it will be live to the storage value
		const completedActions = [...this.container.storage.get('home:actions:completed', [])];
		if (!this.welcomeVisible) {
			completedActions.push(CompletedActions.DismissedWelcome);
		}

		const sub = subscription ?? (await this.container.subscription.getSubscription(true));

		let avatar;
		if (sub.account?.email) {
			avatar = getAvatarUriFromGravatarEmail(sub.account.email, 34).toString();
		} else {
			avatar = `${this.host.getWebRoot() ?? ''}/media/gitlens-logo.webp`;
		}

		return {
			subscription: sub,
			completedActions: completedActions,
			avatar: avatar,
		};
	}

	private getPinStatus() {
		return this.container.storage.get('home:status:pinned') ?? true;
	}

	private async getState(subscription?: Subscription): Promise<State> {
		const sub = await this.getSubscription(subscription);
		const steps = this.container.storage.get('home:steps:completed', []);
		const sections = this.container.storage.get('home:sections:dismissed', []);
		const dismissedBanners = this.container.storage.get('home:banners:dismissed', []);

		return {
			extensionEnabled: this.getExtensionEnabled(),
			webroot: this.host.getWebRoot(),
			subscription: sub.subscription,
			completedActions: sub.completedActions,
			plusEnabled: this.getPlusEnabled(),
			visibility: await this.getRepoVisibility(),
			completedSteps: steps,
			dismissedSections: sections,
			avatar: sub.avatar,
			layout: this.getLayout(),
			pinStatus: this.getPinStatus(),
			dismissedBanners: dismissedBanners,
		};
	}

	private notifyDidChangeData(subscription?: Subscription) {
		if (!this.host.ready) return false;

		return window.withProgress({ location: { viewId: this.host.id } }, async () => {
			const sub = await this.getSubscription(subscription);
			return this.host.notify(DidChangeSubscriptionNotificationType, {
				...sub,
				pinStatus: this.getPinStatus(),
			});
		});
	}

	private getExtensionEnabled() {
		return !getContext('gitlens:disabled', false);
	}

	private notifyExtensionEnabled() {
		if (!this.host.ready) return;

		void this.host.notify(DidChangeExtensionEnabledType, {
			extensionEnabled: this.getExtensionEnabled(),
		});
	}

	private getPlusEnabled() {
		return configuration.get('plusFeatures.enabled');
	}

	private notifyDidChangeConfiguration() {
		if (!this.host.ready) return;

		void this.host.notify(DidChangeConfigurationType, {
			plusEnabled: this.getPlusEnabled(),
		});
	}

	private getLayout() {
		const layout = this.container.storage.get('views:layout');
		return layout != null ? (layout as ViewsLayout) : ViewsLayout.SourceControl;
	}

	private notifyDidChangeLayout() {
		if (!this.host.ready) return;

		void this.host.notify(DidChangeLayoutType, { layout: this.getLayout() });
	}

	private _validateSubscriptionDebounced: Deferrable<HomeWebviewProvider['validateSubscription']> | undefined =
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

import type { ConfigurationChangeEvent, Disposable } from 'vscode';
import { window } from 'vscode';
import { getAvatarUriFromGravatarEmail } from '../../avatars';
import { ViewsLayout } from '../../commands/setViewsLayout';
import { ContextKeys, CoreCommands } from '../../constants';
import type { Container } from '../../container';
import { getContext, onDidChangeContext } from '../../context';
import type { RepositoriesVisibility } from '../../git/gitProviderService';
import type { SubscriptionChangeEvent } from '../../plus/subscription/subscriptionService';
import { ensurePlusFeaturesEnabled } from '../../plus/subscription/utils';
import type { StorageChangeEvent } from '../../storage';
import type { Subscription } from '../../subscription';
import { executeCoreCommand, registerCommand } from '../../system/command';
import { configuration } from '../../system/configuration';
import type { Deferrable } from '../../system/function';
import { debounce } from '../../system/function';
import type { IpcMessage } from '../protocol';
import { onIpc } from '../protocol';
import { WebviewViewBase } from '../webviewViewBase';
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

export class HomeWebviewView extends WebviewViewBase<State> {
	constructor(container: Container) {
		super(container, 'gitlens.views.home', 'home.html', 'Home', `${ContextKeys.WebviewViewPrefix}home`, 'homeView');

		this.disposables.push(
			this.container.subscription.onDidChange(this.onSubscriptionChanged, this),
			onDidChangeContext(key => {
				if (key !== ContextKeys.Disabled) return;
				this.notifyExtensionEnabled();
			}),
			configuration.onDidChange(e => {
				this.onConfigurationChanged(e);
			}, this),
			this.container.storage.onDidChange(e => {
				this.onStorageChanged(e);
			}),
		);
	}

	override async show(options?: { preserveFocus?: boolean | undefined }): Promise<void> {
		if (!(await ensurePlusFeaturesEnabled())) return;
		return super.show(options);
	}

	private async onSubscriptionChanged(e: SubscriptionChangeEvent) {
		await this.container.storage.store('home:status:pinned', true);
		void this.notifyDidChangeData(e.current);
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

	protected override onVisibilityChanged(visible: boolean): void {
		if (!visible) {
			this._validateSubscriptionDebounced?.cancel();
			return;
		}

		queueMicrotask(() => void this.validateSubscription());
	}

	protected override onWindowFocusChanged(focused: boolean): void {
		if (!focused || !this.visible) {
			this._validateSubscriptionDebounced?.cancel();
			return;
		}

		queueMicrotask(() => void this.validateSubscription());
	}

	protected override registerCommands(): Disposable[] {
		return [
			registerCommand(`${this.id}.refresh`, () => this.refresh(), this),
			registerCommand('gitlens.home.toggleWelcome', async () => {
				const welcomeVisible = !this.welcomeVisible;
				await this.container.storage.store('views:welcome:visible', welcomeVisible);
				if (welcomeVisible) {
					await this.container.storage.store('home:actions:completed', []);
					await this.container.storage.store('home:steps:completed', []);
					await this.container.storage.store('home:sections:dismissed', []);
				}

				void this.refresh();
			}),
			registerCommand('gitlens.home.restoreWelcome', async () => {
				await this.container.storage.store('home:steps:completed', []);
				await this.container.storage.store('home:sections:dismissed', []);

				void this.refresh();
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

	protected override onMessageReceived(e: IpcMessage) {
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

	protected override async includeBootstrap(): Promise<State> {
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

		const subscriptionState = subscription ?? (await this.container.subscription.getSubscription(true));

		let avatar;
		if (subscriptionState.account?.email) {
			avatar = getAvatarUriFromGravatarEmail(subscriptionState.account.email, 34).toString();
		} else {
			avatar = `${this.getWebRoot() ?? ''}/media/gitlens-logo.webp`;
		}

		return {
			subscription: subscriptionState,
			completedActions: completedActions,
			avatar: avatar,
		};
	}

	private getPinStatus() {
		return this.container.storage.get('home:status:pinned') ?? true;
	}

	private async getState(subscription?: Subscription): Promise<State> {
		const subscriptionState = await this.getSubscription(subscription);
		const steps = this.container.storage.get('home:steps:completed', []);
		const sections = this.container.storage.get('home:sections:dismissed', []);
		const dismissedBanners = this.container.storage.get('home:banners:dismissed', []);

		return {
			extensionEnabled: this.getExtensionEnabled(),
			webroot: this.getWebRoot(),
			subscription: subscriptionState.subscription,
			completedActions: subscriptionState.completedActions,
			plusEnabled: this.getPlusEnabled(),
			visibility: await this.getRepoVisibility(),
			completedSteps: steps,
			dismissedSections: sections,
			avatar: subscriptionState.avatar,
			layout: this.getLayout(),
			pinStatus: this.getPinStatus(),
			dismissedBanners: dismissedBanners,
		};
	}

	private notifyDidChangeData(subscription?: Subscription) {
		if (!this.isReady) return false;

		const getSub = async () => {
			const sub = await this.getSubscription(subscription);

			return {
				...sub,
				pinStatus: this.getPinStatus(),
			};
		};

		return window.withProgress({ location: { viewId: this.id } }, async () =>
			this.notify(DidChangeSubscriptionNotificationType, await getSub()),
		);
	}

	private getExtensionEnabled() {
		return !getContext(ContextKeys.Disabled, false);
	}

	private notifyExtensionEnabled() {
		if (!this.isReady) return;

		void this.notify(DidChangeExtensionEnabledType, {
			extensionEnabled: this.getExtensionEnabled(),
		});
	}

	private getPlusEnabled() {
		return configuration.get('plusFeatures.enabled');
	}

	private notifyDidChangeConfiguration() {
		if (!this.isReady) return;

		void this.notify(DidChangeConfigurationType, {
			plusEnabled: this.getPlusEnabled(),
		});
	}

	private getLayout() {
		const layout = this.container.storage.get('views:layout');
		return layout != null ? (layout as ViewsLayout) : ViewsLayout.SourceControl;
	}

	private notifyDidChangeLayout() {
		if (!this.isReady) return;

		void this.notify(DidChangeLayoutType, { layout: this.getLayout() });
	}

	private _validateSubscriptionDebounced: Deferrable<HomeWebviewView['validateSubscription']> | undefined = undefined;

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

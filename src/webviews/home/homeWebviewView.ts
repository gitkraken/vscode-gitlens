import type { Disposable } from 'vscode';
import { window } from 'vscode';
import { getAvatarUriFromGravatarEmail } from '../../avatars';
import { configuration } from '../../configuration';
import { ContextKeys, CoreCommands } from '../../constants';
import type { Container } from '../../container';
import { getContext, onDidChangeContext } from '../../context';
import type { RepositoriesVisibility } from '../../git/gitProviderService';
import type { SubscriptionChangeEvent } from '../../plus/subscription/subscriptionService';
import { ensurePlusFeaturesEnabled } from '../../plus/subscription/utils';
import type { Subscription } from '../../subscription';
import { executeCoreCommand, registerCommand } from '../../system/command';
import type { IpcMessage } from '../protocol';
import { onIpc } from '../protocol';
import { WebviewViewBase } from '../webviewViewBase';
import type { CompleteStepParams, DismissSectionParams, State } from './protocol';
import {
	CompletedActions,
	CompleteStepCommandType,
	DidChangeExtensionEnabledType,
	DidChangeSubscriptionNotificationType,
	DismissSectionCommandType,
} from './protocol';

export class HomeWebviewView extends WebviewViewBase<State> {
	constructor(container: Container) {
		super(container, 'gitlens.views.home', 'home.html', 'Home', 'homeView');

		this.disposables.push(
			this.container.subscription.onDidChange(this.onSubscriptionChanged, this),
			onDidChangeContext(key => {
				if (key !== ContextKeys.Disabled) return;
				this.notifyExtensionEnabled();
			}),
		);
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

		queueMicrotask(() => void this.validateSubscription());
	}

	protected override onWindowFocusChanged(focused: boolean): void {
		if (!focused) return;

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

		if (!sections.includes(params.id)) {
			sections.push(params.id);
		}

		void this.container.storage.store('home:sections:dismissed', sections);
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

	private async getState(subscription?: Subscription): Promise<State> {
		const subscriptionState = await this.getSubscription(subscription);
		const steps = this.container.storage.get('home:steps:completed', []);
		const sections = this.container.storage.get('home:sections:dismissed', []);

		return {
			extensionEnabled: this.getExtensionEnabled(),
			webroot: this.getWebRoot(),
			subscription: subscriptionState.subscription,
			completedActions: subscriptionState.completedActions,
			plusEnabled: configuration.get('plusFeatures.enabled'),
			visibility: await this.getRepoVisibility(),
			completedSteps: steps,
			dismissedSections: sections,
			avatar: subscriptionState.avatar,
		};
	}

	private notifyDidChangeData(subscription?: Subscription) {
		if (!this.isReady) return false;

		return window.withProgress({ location: { viewId: this.id } }, async () =>
			this.notify(DidChangeSubscriptionNotificationType, await this.getSubscription(subscription)),
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

import { Disposable, workspace } from 'vscode';
import type { ContextKeys } from '../../constants.context';
import type { Container } from '../../container';
import type { Subscription } from '../../plus/gk/account/subscription';
import type { SubscriptionChangeEvent } from '../../plus/gk/account/subscriptionService';
import { registerCommand } from '../../system/command';
import { getContext, onDidChangeContext } from '../../system/context';
import type { IpcMessage } from '../protocol';
import type { WebviewHost, WebviewProvider } from '../webviewProvider';
import type { CollapseSectionParams, DidChangeRepositoriesParams, State } from './protocol';
import {
	CollapseSectionCommand,
	DidChangeIntegrationsConnections,
	DidChangeOrgSettings,
	DidChangeRepositories,
	DidChangeSubscription,
} from './protocol';

const emptyDisposable = Object.freeze({
	dispose: () => {
		/* noop */
	},
});

export class HomeWebviewProvider implements WebviewProvider<State> {
	private readonly _disposable: Disposable;

	constructor(
		private readonly container: Container,
		private readonly host: WebviewHost,
	) {
		this._disposable = Disposable.from(
			this.container.git.onDidChangeRepositories(this.onRepositoriesChanged, this),
			!workspace.isTrusted
				? workspace.onDidGrantWorkspaceTrust(this.notifyDidChangeRepositories, this)
				: emptyDisposable,
			this.container.subscription.onDidChange(this.onSubscriptionChanged, this),
			onDidChangeContext(this.onContextChanged, this),
			this.container.integrations.onDidChangeConnectionState(this.onChangeConnectionState, this),
		);
	}

	dispose() {
		this._disposable.dispose();
	}

	private onChangeConnectionState() {
		this.notifyDidChangeOnboardingIntegration();
	}

	private onRepositoriesChanged() {
		this.notifyDidChangeRepositories();
	}

	registerCommands(): Disposable[] {
		return [registerCommand(`${this.host.id}.refresh`, () => this.host.refresh(true), this)];
	}

	onMessageReceived(e: IpcMessage) {
		switch (true) {
			case CollapseSectionCommand.is(e):
				this.onCollapseSection(e.params);
				break;
		}
	}

	includeBootstrap(): Promise<State> {
		return this.getState();
	}

	onReloaded() {
		this.notifyDidChangeRepositories();
	}

	private onCollapseSection(params: CollapseSectionParams) {
		const collapsed = this.container.storage.get('home:sections:collapsed');
		if (collapsed == null) {
			if (params.collapsed === true) {
				void this.container.storage.store('home:sections:collapsed', [params.section]);
			}
			return;
		}

		const idx = collapsed.indexOf(params.section);
		if (params.collapsed === true) {
			if (idx === -1) {
				void this.container.storage.store('home:sections:collapsed', [...collapsed, params.section]);
			}

			return;
		}

		if (idx !== -1) {
			collapsed.splice(idx, 1);
			void this.container.storage.store('home:sections:collapsed', collapsed);
		}
	}

	private getWalkthroughCollapsed() {
		return this.container.storage.get('home:sections:collapsed')?.includes('walkthrough') ?? false;
	}

	private getOrgSettings(): State['orgSettings'] {
		return {
			drafts: getContext('gitlens:gk:organization:drafts:enabled', false),
		};
	}

	private onContextChanged(key: keyof ContextKeys) {
		if (key === 'gitlens:gk:organization:drafts:enabled') {
			this.notifyDidChangeOrgSettings();
		}
	}

	private onSubscriptionChanged(e: SubscriptionChangeEvent) {
		void this.notifyDidChangeSubscription(e.current);
	}

	private async getState(subscription?: Subscription): Promise<State> {
		subscription ??= await this.container.subscription.getSubscription(true);
		return {
			...this.host.baseWebviewState,
			repositories: this.getRepositoriesState(),
			webroot: this.host.getWebRoot(),
			subscription: subscription,
			orgSettings: this.getOrgSettings(),
			walkthroughCollapsed: this.getWalkthroughCollapsed(),
			hasAnyIntegrationConnected: this.isAnyIntegrationConnected(),
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

	private _hostedIntegrationConnected: boolean | undefined;
	private isAnyIntegrationConnected(force = false) {
		if (this._hostedIntegrationConnected == null || force === true) {
			this._hostedIntegrationConnected =
				[
					...this.container.integrations.getConnected('hosting'),
					...this.container.integrations.getConnected('issues'),
				].length > 0;
		}
		return this._hostedIntegrationConnected;
	}

	private notifyDidChangeRepositories() {
		void this.host.notify(DidChangeRepositories, this.getRepositoriesState());
	}

	private notifyDidChangeOnboardingIntegration() {
		// force rechecking
		const isConnected = this.isAnyIntegrationConnected(true);
		void this.host.notify(DidChangeIntegrationsConnections, {
			hasAnyIntegrationConnected: isConnected,
		});
	}

	private async notifyDidChangeSubscription(subscription?: Subscription) {
		subscription ??= await this.container.subscription.getSubscription(true);

		void this.host.notify(DidChangeSubscription, {
			subscription: subscription,
		});
	}

	private notifyDidChangeOrgSettings() {
		void this.host.notify(DidChangeOrgSettings, {
			orgSettings: this.getOrgSettings(),
		});
	}
}

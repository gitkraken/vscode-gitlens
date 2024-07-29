import { Disposable, workspace } from 'vscode';
import type { ContextKeys } from '../../constants.context';
import type { Container } from '../../container';
import type { Subscription } from '../../plus/gk/account/subscription';
import type { SubscriptionChangeEvent } from '../../plus/gk/account/subscriptionService';
import { registerCommand } from '../../system/command';
import { getContext, onDidChangeContext } from '../../system/context';
import { Logger } from '../../system/logger';
import type { IpcMessage } from '../protocol';
import type { WebviewHost, WebviewProvider } from '../webviewProvider';
import type { CollapseSectionParams, DidChangeRepositoriesParams, DidChangeUsagesParams, State } from './protocol';
import {
	CollapseSectionCommand,
	DidChangeIntegrationsConnections,
	DidChangeOrgSettings,
	DidChangeRepositories,
	DidChangeSubscription,
	DidChangeUsage,
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
		Logger.log('test usage', this.container.usage.get('graphView:shown'));

		this._disposable = Disposable.from(
			this.container.git.onDidChangeRepositories(this.onRepositoriesChanged, this),
			!workspace.isTrusted
				? workspace.onDidGrantWorkspaceTrust(this.notifyDidChangeRepositories, this)
				: emptyDisposable,
			this.container.subscription.onDidChange(this.onSubscriptionChanged, this),
			onDidChangeContext(this.onContextChanged, this),
			this.container.integrations.onDidChangeConnectionState(this.onChangeConnectionState, this),
			this.container.usage.onDidChange(this.onUsagesChanged, this),
		);
	}

	dispose() {
		this._disposable.dispose();
	}

	private onChangeConnectionState() {
		this.notifyDidChangeOnboardingIntegration();
	}

	private onUsagesChanged() {
		Logger.log(
			'usage changed',
			this.container.usage.get('graphView:shown'),
			this.container.usage.get('graphWebview:shown'),
		);
		this.notifyDidChangeUsages();
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
		Logger.log('test usage', this.container.usage);

		void this.notifyDidChangeSubscription(e.current);
	}

	private async getState(subscription?: Subscription): Promise<State> {
		subscription ??= await this.container.subscription.getSubscription(true);
		return {
			...this.host.baseWebviewState,
			repositories: this.getRepositoriesState(),
			onboardingState: this.getOnboardingState(),
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

	private getOnboardingState(): DidChangeUsagesParams {
		return {
			configurationChecked: Boolean(this.container.usage.get('settingsWebview:shown')?.firstUsedAt),
			revisionHistoryChecked: false,
			commitGraphChecked:
				Boolean(this.container.usage.get('graphView:shown')?.firstUsedAt) ||
				Boolean(this.container.usage.get('graphWebview:shown')?.firstUsedAt),
			branchesChecked: Boolean(this.container.usage.get('branchesView:shown')?.firstUsedAt),
			cloudPatchesChecked: false,
			commitsChecked: Boolean(this.container.usage.get('commitsView:shown')?.firstUsedAt),
			contributorsChecked: Boolean(this.container.usage.get('contributorsView:shown')?.firstUsedAt),
			fileHistoryChecked: Boolean(this.container.usage.get('fileHistoryView:shown')?.firstUsedAt),
			inspectChecked: false,
			gitLensChecked: false,
			launchpadChecked: false,
			lineHistoryChecked: Boolean(this.container.usage.get('lineHistoryView:shown')?.firstUsedAt),
			searchAndCompareChecked: Boolean(this.container.usage.get('searchAndCompareView:shown')?.firstUsedAt),
			stashesChecked: Boolean(this.container.usage.get('stashesView:shown')?.firstUsedAt),
			tagsChecked: Boolean(this.container.usage.get('tagsView:shown')?.firstUsedAt),
			visualFileHistoryChecked: false,
			workTreesChecked: Boolean(this.container.usage.get('worktreesView:shown')?.firstUsedAt),
			workSpacesChecked: Boolean(this.container.usage.get('workspacesView:shown')?.firstUsedAt),
		};
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
	private notifyDidChangeUsages() {
		void this.host.notify(DidChangeUsage, this.getOnboardingState());
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

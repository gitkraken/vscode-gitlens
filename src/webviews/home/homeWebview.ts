import type { TextEditor } from 'vscode';
import { Disposable, window, workspace } from 'vscode';
import type { ContextKeys } from '../../constants.context';
import type { Container } from '../../container';
import type { Subscription } from '../../plus/gk/account/subscription';
import type { SubscriptionChangeEvent } from '../../plus/gk/account/subscriptionService';
import { HostingIntegrationId } from '../../plus/integrations/providers/models';
import { registerCommand } from '../../system/command';
import { getContext, onDidChangeContext } from '../../system/context';
import type { TrackedUsageKeys, UsageChangeEvent } from '../../telemetry/usageTracker';
import type { OnboardingItem } from '../apps/home/model/gitlens-onboarding';
import type { WebviewHost, WebviewProvider } from '../webviewProvider';
import type {
	DidChangeOnboardingStateParams,
	DidChangeRepositoriesParams,
	OnboardingConfigurationExtras,
	State,
} from './protocol';
import {
	DidChangeIntegrationsConnections,
	DidChangeOnboardingConfiguration,
	DidChangeOnboardingState,
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
	private activeTextEditor: TextEditor | undefined;

	constructor(
		private readonly container: Container,
		private readonly host: WebviewHost,
	) {
		this.activeTextEditor = window.activeTextEditor;
		this._disposable = Disposable.from(
			this.container.git.onDidChangeRepositories(this.onRepositoriesChanged, this),
			!workspace.isTrusted
				? workspace.onDidGrantWorkspaceTrust(this.notifyDidChangeRepositories, this)
				: emptyDisposable,
			this.container.subscription.onDidChange(this.onSubscriptionChanged, this),
			onDidChangeContext(this.onContextChanged, this),
			this.container.integrations.onDidChangeConnectionState(this.onChangeConnectionState, this),
			this.container.usage.onDidChange(this.onUsagesChanged, this),
			window.onDidChangeActiveTextEditor(this.onChangeActiveTextEditor, this),
			this.container.integrations.onDidChangeConnectionState(e => {
				if (e.key === 'github' || e.key === 'gitlab') this.onChangeConnectionState();
			}, this),
		);
	}

	dispose() {
		this.notifyDidChangeOnboardingState();
		this._disposable.dispose();
	}

	private onChangeConnectionState() {
		this.notifyDidChangeOnboardingIntegration();
	}

	private onChangeActiveTextEditor(e: TextEditor | undefined) {
		this.activeTextEditor = e;
		this.container.integrations.getConnected('hosting');
		this.notifyDidChangeOnboardingConfig();
	}

	private onUsagesChanged(e: UsageChangeEvent | undefined) {
		if (!e || e?.key === 'integration:repoHost') {
			this.notifyDidChangeOnboardingConfig();
		}
		this.notifyDidChangeOnboardingState();
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
			onboardingState: this.getOnboardingState(),
			onboardingExtras: this.getOnboardingExtras(),
			webroot: this.host.getWebRoot(),
			subscription: subscription,
			orgSettings: this.getOrgSettings(),
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

	private checkIfSomeUsed(...keys: TrackedUsageKeys[]) {
		for (const key of keys) {
			if (this.container.usage.get(key)?.firstUsedAt) {
				return true;
			}
		}
		return false;
	}

	private isHostedIntegrationConnected() {
		return this.container.integrations
			.getConnected('hosting')
			.some(x => x.id === HostingIntegrationId.GitHub || x.id === HostingIntegrationId.GitLab);
	}

	private getOnboardingState(): Omit<
		Required<DidChangeOnboardingStateParams>,
		`${OnboardingItem.allSidebarViews}Checked` | `${OnboardingItem.editorFeatures}Checked`
	> {
		return {
			commitGraphChecked: this.checkIfSomeUsed(
				'graphView:shown',
				'graphWebview:shown',
				'command:gitlens.showGraphPage:executed',
				'command:gitlens.showGraph:executed',
			),
			visualFileHistoryChecked: this.checkIfSomeUsed('timelineWebview:shown'),
			sourceControlChecked:
				// as we cannot track native vscode usage, let's check if user has opened one of the GL features on the SCM view
				this.checkIfSomeUsed(
					'stashesView:shown',
					'commitsView:shown',
					'branchesView:shown',
					'tagsView:shown',
					'worktreesView:shown',
					'contributorsView:shown',
					'remotesView:shown',
				),

			repoHostChecked: this.isHostedIntegrationConnected(),
			revisionHistoryChecked: this.checkIfSomeUsed(
				'command:gitlens.diffWithPrevious:executed',
				'command:gitlens.diffWithNext:executed',
				'command:gitlens.diffWithRevision:executed',
			),
			inspectChecked: this.checkIfSomeUsed(
				'commitDetailsView:shown',
				'lineHistoryView:shown',
				'fileHistoryView:shown',
				'lineHistoryView:shown',
				'searchAndCompareView:shown',
			),
			gitLensChecked: this.checkIfSomeUsed(
				'homeView:shown',
				'accountView:shown',
				'patchDetailsView:shown',
				'workspacesView:shown',
			),
			launchpadChecked: this.checkIfSomeUsed('focusWebview:shown', 'command:gitlens.showLaunchpad:executed'),
			blameChecked: this.checkIfSomeUsed('lineBlame:hovered'),
			codeLensChecked: this.checkIfSomeUsed('codeLens:activated'),
			fileAnnotationsChecked: this.checkIfSomeUsed('command:gitlens.toggleFileBlame:executed'),
		};
	}

	private getOnboardingExtras(): OnboardingConfigurationExtras {
		return {
			editorPreviewEnabled: Boolean(this.activeTextEditor),
			repoHostConnected: this.isHostedIntegrationConnected(),
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
	private notifyDidChangeOnboardingState() {
		void this.host.notify(DidChangeOnboardingState, this.getOnboardingState());
	}

	private notifyDidChangeOnboardingConfig() {
		void this.host.notify(DidChangeOnboardingConfiguration, this.getOnboardingExtras());
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

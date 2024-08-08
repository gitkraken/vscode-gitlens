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
import type { WebviewHost, WebviewProvider } from '../webviewProvider';
import type { DidChangeOnboardingStateParams, DidChangeRepositoriesParams, OnboardingItem, State } from './protocol';
import {
	DidChangeIntegrationsConnections,
	DidChangeOnboardingEditor,
	DidChangeOnboardingIntegration,
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
	private hostedIntegrationConnected: boolean | undefined;

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
				if (isSupportedIntegration(e.key)) this.onChangeConnectionState();
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
		this.notifyDidChangeEditor();
	}

	private onUsagesChanged(e: UsageChangeEvent | undefined) {
		if (!e || e?.key === 'integration:repoHost') {
			this.notifyDidChangeOnboardingIntegration();
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
			editorPreviewEnabled: this.isEditorPreviewEnabled(),
			repoHostConnected: this.isHostedIntegrationConnected(),
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

	private isEditorPreviewEnabled() {
		return Boolean(this.activeTextEditor);
	}

	private isHostedIntegrationConnected(force = false) {
		if (this.hostedIntegrationConnected == null || force === true) {
			this.hostedIntegrationConnected = this.container.integrations
				.getConnected('hosting')
				.some(x => isSupportedIntegration(x.id));
		}
		return this.hostedIntegrationConnected;
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

	private notifyDidChangeRepositories() {
		void this.host.notify(DidChangeRepositories, this.getRepositoriesState());
	}

	private notifyDidChangeOnboardingState() {
		void this.host.notify(DidChangeOnboardingState, this.getOnboardingState());
	}

	private notifyDidChangeOnboardingIntegration() {
		// force rechecking
		const isConnected = this.isHostedIntegrationConnected(true);
		void this.host.notify(DidChangeOnboardingIntegration, {
			onboardingState: this.getOnboardingState(),
			repoHostConnected: isConnected,
		});
	}

	private notifyDidChangeEditor() {
		void this.host.notify(DidChangeOnboardingEditor, {
			editorPreviewEnabled: this.isEditorPreviewEnabled(),
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

function isSupportedIntegration(key: string) {
	return [HostingIntegrationId.GitHub, HostingIntegrationId.GitLab].includes(key as HostingIntegrationId);
}

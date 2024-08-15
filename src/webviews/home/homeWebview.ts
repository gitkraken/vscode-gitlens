import type { TextEditor } from 'vscode';
import { Disposable, window, workspace } from 'vscode';
import type { ContextKeys } from '../../constants.context';
import type { Container } from '../../container';
import type { Subscription } from '../../plus/gk/account/subscription';
import { SubscriptionState } from '../../plus/gk/account/subscription';
import type { SubscriptionChangeEvent } from '../../plus/gk/account/subscriptionService';
import { HostingIntegrationId } from '../../plus/integrations/providers/models';
import { registerCommand } from '../../system/command';
import { getContext, onDidChangeContext } from '../../system/context';
import { debounce } from '../../system/function';
import { isTextEditor } from '../../system/utils';
import type { TrackedUsageKeys, UsageChangeEvent } from '../../telemetry/usageTracker';
import type { WebviewHost, WebviewProvider } from '../webviewProvider';
import type { DidChangeOnboardingStateParams, DidChangeRepositoriesParams, OnboardingItem, State } from './protocol';
import {
	DidChangeCodeLensState,
	DidChangeLineBlameState,
	DidChangeOnboardingEditor,
	DidChangeOnboardingIntegration,
	DidChangeOnboardingIsInitialized,
	DidChangeOnboardingState,
	DidChangeOrgSettings,
	DidChangeRepositories,
	DidChangeSubscription,
	DidTogglePlusFeatures,
} from './protocol';

const emptyDisposable = Object.freeze({
	dispose: () => {
		/* noop */
	},
});

export class HomeWebviewProvider implements WebviewProvider<State> {
	private readonly _disposable: Disposable;
	private activeTrackedTextEditor: TextEditor | undefined;
	private hostedIntegrationConnected: boolean | undefined;
	private onboardingInitialized: boolean = false;

	constructor(
		private readonly container: Container,
		private readonly host: WebviewHost,
	) {
		this.activeTrackedTextEditor = window.activeTextEditor;
		this._disposable = Disposable.from(
			this.container.git.onDidChangeRepositories(this.onRepositoriesChanged, this),
			!workspace.isTrusted
				? workspace.onDidGrantWorkspaceTrust(this.notifyDidChangeRepositories, this)
				: emptyDisposable,
			this.container.subscription.onDidChange(this.onSubscriptionChanged, this),
			onDidChangeContext(this.onContextChanged, this),
			this.container.integrations.onDidChangeConnectionState(this.onChangeConnectionState, this),
			this.container.usage.onDidChange(this.onUsagesChanged, this),
			window.onDidChangeActiveTextEditor(debounce(this.onChangeActiveTextEditor, 250), this),
			this.container.integrations.onDidChangeConnectionState(e => {
				if (isSupportedIntegration(e.key)) this.onChangeConnectionState();
			}, this),
			this.container.codeLens.onCodeLensToggle(this.onToggleCodeLens, this),
			this.container.lineAnnotations.onToggle(this.onToggleLineAnnotations, this),
		);
	}

	dispose() {
		this._disposable.dispose();
	}

	private onChangeConnectionState() {
		void this.notifyDidChangeOnboardingIntegration();
	}

	private async onChangeActiveTextEditor(e: TextEditor | undefined) {
		if (!e || !isTextEditor(e)) {
			this.activeTrackedTextEditor = undefined;
		} else if (await this.container.git.isTracked(e.document.uri)) {
			this.activeTrackedTextEditor = e;
		} else {
			this.activeTrackedTextEditor = undefined;
		}
		this.notifyDidChangeEditor();
	}

	private onToggleCodeLens() {
		this.notifyDidToggleCodeLens();
	}

	private onToggleLineAnnotations() {
		this.notifyDidToggleLineBlame();
	}

	private onUsagesChanged(e: UsageChangeEvent | undefined) {
		if (!e || e?.key === 'integration:repoHost') {
			void this.notifyDidChangeOnboardingIntegration();
		}
		void this.notifyDidChangeOnboardingState();
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
		this.notifyDidChangeEditor();
		void this.notifyDidChangeOnboardingState();
		this.notifyDidToggleCodeLens();
		this.notifyDidToggleLineBlame();
		void this.notifyDidChangeOnboardingIntegration();
		void this.container.git.access().then(x => console.log('subscription', { x: x, plan: x.subscription }));
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
		if (key === 'gitlens:plus:enabled') {
			this.notifyDidTogglePlus();
		}
	}

	private onSubscriptionChanged(e: SubscriptionChangeEvent) {
		void this.notifyDidChangeSubscription(e.current);
		void this.notifyDidChangeOnboardingState();
	}

	private async getState(subscription?: Subscription): Promise<State> {
		subscription ??= await this.container.subscription.getSubscription(true);
		return {
			...this.host.baseWebviewState,
			repositories: this.getRepositoriesState(),
			onboardingState: await this.getOnboardingState(),
			editorPreviewEnabled: this.isEditorPreviewEnabled(),
			canEnableCodeLens: this.canCodeLensBeEnabled(),
			canEnableLineBlame: this.canLineBlameBeEnabled(),
			repoHostConnected: this.isHostedIntegrationConnected(),
			webroot: this.host.getWebRoot(),
			subscription: subscription,
			orgSettings: this.getOrgSettings(),
			hasAnyIntegrationConnected: this.isAnyIntegrationConnected(),
			isOnboardingInitialized: this.onboardingInitialized,
			proFeaturesEnabled: this.getPlusFeaturesEnabled(),
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
		return Boolean(this.activeTrackedTextEditor);
	}

	private canCodeLensBeEnabled() {
		return this.container.codeLens.canToggle && !this.container.codeLens.isEnabled;
	}

	private canLineBlameBeEnabled() {
		return !this.container.lineAnnotations.enabled;
	}

	private isHostedIntegrationConnected(force = false) {
		if (this.hostedIntegrationConnected == null || force === true) {
			this.hostedIntegrationConnected = this.container.integrations
				.getConnected('hosting')
				.some(x => isSupportedIntegration(x.id));
		}
		return this.hostedIntegrationConnected;
	}

	private async getOnboardingState(): Promise<
		Omit<
			Required<DidChangeOnboardingStateParams>,
			| `${OnboardingItem.allSidebarViews}Checked`
			| `${OnboardingItem.editorFeatures}Checked`
			| `${OnboardingItem.proFeatures}Checked`
		>
	> {
		const subscription = await this.container.subscription.getSubscription();
		return {
			commitGraphChecked: this.checkIfSomeUsed(
				'graphView:shown',
				'graphWebview:shown',
				'command:gitlens.showGraphPage:executed',
				'command:gitlens.showGraph:executed',
			),
			visualFileHistoryChecked: this.checkIfSomeUsed('timelineView:shown', 'timelineWebview:shown'),
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
			upgradeToProChecked: subscription.state === SubscriptionState.Paid,
			tryTrialChecked:
				subscription.state === SubscriptionState.FreeInPreviewTrial ||
				subscription.state === SubscriptionState.FreePlusInTrial ||
				subscription.state === SubscriptionState.FreePlusTrialExpired ||
				subscription.state === SubscriptionState.Paid,
		};
	}

	private notifyDidChangeRepositories() {
		void this.host.notify(DidChangeRepositories, this.getRepositoriesState());
	}

	private async notifyDidChangeOnboardingState() {
		void this.host.notify(DidChangeOnboardingState, await this.getOnboardingState());
	}

	private getPlusFeaturesEnabled() {
		return getContext('gitlens:plus:enabled') ?? false;
	}

	private notifyDidChangeIsOnboardingInitialized() {
		void this.host.notify(DidChangeOnboardingIsInitialized, {
			isInitialized: this.onboardingInitialized,
		});
	}

	private _timeout: NodeJS.Timeout | undefined;

	private async notifyDidChangeOnboardingIntegration() {
		// force rechecking
		const isConnected = this.isHostedIntegrationConnected(true);
		void this.host.notify(DidChangeOnboardingIntegration, {
			onboardingState: await this.getOnboardingState(),
			repoHostConnected: isConnected,
		});
		if (!this._timeout) {
			clearTimeout(this._timeout);
		}
		this._timeout = setTimeout(() => {
			this.onboardingInitialized = true;
			this.notifyDidChangeIsOnboardingInitialized();
		}, 250);
	}

	private notifyDidTogglePlus() {
		void this.host.notify(DidTogglePlusFeatures, this.getPlusFeaturesEnabled());
	}

	private notifyDidChangeEditor() {
		void this.host.notify(DidChangeOnboardingEditor, {
			editorPreviewEnabled: this.isEditorPreviewEnabled(),
		});
	}

	private notifyDidToggleCodeLens() {
		void this.host.notify(DidChangeCodeLensState, {
			canBeEnabled: this.canCodeLensBeEnabled(),
		});
	}

	private notifyDidToggleLineBlame() {
		void this.host.notify(DidChangeLineBlameState, {
			canBeEnabled: this.canLineBlameBeEnabled(),
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

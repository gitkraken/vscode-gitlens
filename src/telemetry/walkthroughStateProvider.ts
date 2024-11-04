import type { Event } from 'vscode';
import { Disposable, EventEmitter } from 'vscode';
import { Commands } from '../constants.commands';
import type { TrackedUsageKeys } from '../constants.telemetry';
import type { Container } from '../container';
import { entries } from '../system/object';
import { wait } from '../system/promise';
import { setContext } from '../system/vscode/context';
import type { UsageChangeEvent } from './usageTracker';

export enum WalkthroughContextKeys {
	GettingStarted = 'gettingStarted',
	VisualizeCodeHistory = 'visualizeCodeHistory',
	PrReviews = 'prReviews',
	StreamlineCollaboration = 'streamlineCollaboration',
	Integrations = 'integrations',
}

export class WalkthroughStateProvider implements Disposable {
	protected disposables: Disposable[] = [];
	private readonly state = new Map<WalkthroughContextKeys, boolean>();
	readonly walkthroughSize: number;
	private isInitialized = false;
	private _initPromise: Promise<void> | undefined;

	/**
	 * using reversed map (instead of direct map as walkthroughToTracking Record<WalkthroughContextKeys, TrackedUsageKeys[]>)
	 * makes code less readable, but prevents duplicated usageTracker keys
	 */
	private readonly walkthroughByTracking: Partial<Record<TrackedUsageKeys, WalkthroughContextKeys>> = {
		[`command:${Commands.PlusStartPreviewTrial}:executed`]: WalkthroughContextKeys.GettingStarted,
		[`command:${Commands.PlusReactivateProTrial}:executed`]: WalkthroughContextKeys.GettingStarted,
		[`command:${Commands.ShowWelcomePage}:executed`]: WalkthroughContextKeys.GettingStarted,
		[`command:${Commands.OpenWalkthrough}:executed`]: WalkthroughContextKeys.GettingStarted,
		[`command:${Commands.GetStarted}:executed`]: WalkthroughContextKeys.GettingStarted,

		'graphDetailsView:shown': WalkthroughContextKeys.VisualizeCodeHistory,
		'graphView:shown': WalkthroughContextKeys.VisualizeCodeHistory,
		'graphWebview:shown': WalkthroughContextKeys.VisualizeCodeHistory,
		'commitDetailsView:shown': WalkthroughContextKeys.VisualizeCodeHistory,
		[`command:${Commands.ShowGraph}:executed`]: WalkthroughContextKeys.VisualizeCodeHistory,
		[`command:${Commands.ShowGraphPage}:executed`]: WalkthroughContextKeys.VisualizeCodeHistory,
		[`command:${Commands.ShowGraphView}:executed`]: WalkthroughContextKeys.VisualizeCodeHistory,
		[`command:${Commands.ShowInCommitGraph}:executed`]: WalkthroughContextKeys.VisualizeCodeHistory,
		[`command:${Commands.ShowInCommitGraphView}:executed`]: WalkthroughContextKeys.VisualizeCodeHistory,

		'launchpadView:shown': WalkthroughContextKeys.PrReviews,
		'worktreesView:shown': WalkthroughContextKeys.PrReviews,
		[`command:${Commands.ShowLaunchpad}:executed`]: WalkthroughContextKeys.PrReviews,
		[`command:${Commands.ShowLaunchpadView}:executed`]: WalkthroughContextKeys.PrReviews,
		[`command:${Commands.GitCommandsWorktree}:executed`]: WalkthroughContextKeys.PrReviews,
		[`command:${Commands.GitCommandsWorktreeCreate}:executed`]: WalkthroughContextKeys.PrReviews,
		[`command:${Commands.GitCommandsWorktreeDelete}:executed`]: WalkthroughContextKeys.PrReviews,
		[`command:${Commands.GitCommandsWorktreeOpen}:executed`]: WalkthroughContextKeys.PrReviews,

		[`command:${Commands.CreateCloudPatch}:executed`]: WalkthroughContextKeys.StreamlineCollaboration,
		[`command:${Commands.CreatePatch}:executed`]: WalkthroughContextKeys.StreamlineCollaboration,

		[`command:${Commands.PlusConnectCloudIntegrations}:executed`]: WalkthroughContextKeys.Integrations,
		[`command:${Commands.PlusManageCloudIntegrations}:executed`]: WalkthroughContextKeys.Integrations,
	};
	private readonly _onProgressChanged = new EventEmitter<void>();

	constructor(private readonly container: Container) {
		this.disposables.push(this.container.usage.onDidChange(this.onUsageChanged, this));
		this.walkthroughSize = Object.values(WalkthroughContextKeys).length;

		this.initializeState();
	}

	private initializeState() {
		for (const key of Object.values(WalkthroughContextKeys)) {
			this.state.set(key, false);
		}
		entries(this.walkthroughByTracking).forEach(([usageKey, walkthroughKey]) => {
			if (!this.state.get(walkthroughKey) && this.container.usage.isUsed(usageKey)) {
				void this.completeStep(walkthroughKey);
			}
		});
		this._onProgressChanged.fire(undefined);
	}

	private onUsageChanged(e: UsageChangeEvent | void) {
		const usageTrackingKey = e?.key;
		if (!usageTrackingKey) {
			return;
		}
		const walkthroughKey = this.walkthroughByTracking[usageTrackingKey];
		if (walkthroughKey) {
			void this.completeStep(walkthroughKey);
			this._onProgressChanged.fire(undefined);
		}
	}

	/**
	 * Walkthrough view is not ready to listen to context changes immediately after opening VSCode with the walkthrough page opened
	 * As we're not able to check if the walkthrough is ready, we need to add a delay.
	 * The 1s delay will not be too annoying for user but it's enough to init
	 */
	private async waitForWalkthroughInitialized() {
		if (this.isInitialized) {
			return;
		}
		if (!this._initPromise) {
			this._initPromise = wait(1000).then(() => {
				this.isInitialized = true;
			});
		}
		await this._initPromise;
	}

	/**
	 * Set up the walkthrough step completed.
	 * According to [VSCode docs](https://code.visualstudio.com/api/references/contribution-points?source=post_page#Completion-events)
	 * we don't have an ability to reset the flag
	 */
	private async completeStep(key: WalkthroughContextKeys) {
		this.state.set(key, true);
		await this.waitForWalkthroughInitialized();
		void setContext(`gitlens:walkthroughState:${key}`, true);
	}

	get onProgressChanged(): Event<void> {
		return this._onProgressChanged.event;
	}

	get doneCount() {
		return [...this.state.values()].filter(x => x).length;
	}

	get progress() {
		return this.doneCount / this.walkthroughSize;
	}

	dispose(): void {
		Disposable.from(...this.disposables).dispose();
	}
}

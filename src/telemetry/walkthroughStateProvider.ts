import type { Event } from 'vscode';
import { Disposable, EventEmitter } from 'vscode';
import { GlCommand } from '../constants.commands';
import { SubscriptionState } from '../constants.subscription';
import type { TrackedUsageKeys } from '../constants.telemetry';
import type { Container } from '../container';
import type { SubscriptionChangeEvent } from '../plus/gk/account/subscriptionService';
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

type WalkthroughUsage = {
	subscriptionStates?: SubscriptionState[] | Readonly<SubscriptionState[]>;
	subscriptionCommands?: TrackedUsageKeys[] | Readonly<TrackedUsageKeys[]>;
	usage: TrackedUsageKeys[];
};

const triedProStates: Readonly<SubscriptionState[]> = [
	SubscriptionState.ProTrial,
	SubscriptionState.ProTrialExpired,
	SubscriptionState.ProTrialReactivationEligible,
	SubscriptionState.Paid,
];

const tryProCommands: Readonly<TrackedUsageKeys[]> = [
	`command:${GlCommand.PlusStartPreviewTrial}:executed`,
	`command:${GlCommand.PlusReactivateProTrial}:executed`,
];

const walkthroughRequiredMapping: Readonly<Map<WalkthroughContextKeys, WalkthroughUsage>> = new Map<
	WalkthroughContextKeys,
	WalkthroughUsage
>([
	[
		WalkthroughContextKeys.GettingStarted,
		{
			subscriptionStates: triedProStates,
			subscriptionCommands: tryProCommands,
			usage: [],
		},
	],
	[
		WalkthroughContextKeys.VisualizeCodeHistory,
		{
			subscriptionStates: triedProStates,
			subscriptionCommands: tryProCommands,
			usage: [
				'graphDetailsView:shown',
				'graphView:shown',
				'graphWebview:shown',
				'commitDetailsView:shown',
				`command:${GlCommand.ShowGraph}:executed`,
				`command:${GlCommand.ShowGraphPage}:executed`,
				`command:${GlCommand.ShowGraphView}:executed`,
				`command:${GlCommand.ShowInCommitGraph}:executed`,
				`command:${GlCommand.ShowInCommitGraphView}:executed`,
			],
		},
	],
	[
		WalkthroughContextKeys.PrReviews,
		{
			subscriptionStates: triedProStates,
			subscriptionCommands: tryProCommands,
			usage: [
				'launchpadView:shown',
				'worktreesView:shown',
				`command:${GlCommand.ShowLaunchpad}:executed`,
				`command:${GlCommand.ShowLaunchpadView}:executed`,
				`command:${GlCommand.GitCommandsWorktree}:executed`,
				`command:${GlCommand.GitCommandsWorktreeCreate}:executed`,
				`command:${GlCommand.GitCommandsWorktreeDelete}:executed`,
				`command:${GlCommand.GitCommandsWorktreeOpen}:executed`,
			],
		},
	],
	[
		WalkthroughContextKeys.StreamlineCollaboration,
		{
			subscriptionStates: triedProStates,
			subscriptionCommands: tryProCommands,
			usage: [
				`patchDetailsView:shown`,
				`patchDetailsWebview:shown`,
				`draftsView:shown`,
				`command:${GlCommand.ShowDraftsView}:executed`,
				`command:${GlCommand.ShowPatchDetailsPage}:executed`,
				`command:${GlCommand.CreateCloudPatch}:executed`,
				`command:${GlCommand.CreatePatch}:executed`,
			],
		},
	],
	[
		WalkthroughContextKeys.Integrations,
		{
			usage: [
				`command:${GlCommand.PlusConnectCloudIntegrations}:executed`,
				`command:${GlCommand.PlusManageCloudIntegrations}:executed`,
			],
		},
	],
]);

export class WalkthroughStateProvider implements Disposable {
	readonly walkthroughSize = walkthroughRequiredMapping.size;
	protected disposables: Disposable[] = [];
	private readonly completed = new Set<WalkthroughContextKeys>();
	private subscriptionState: SubscriptionState | undefined;

	private readonly _onProgressChanged = new EventEmitter<void>();
	get onProgressChanged(): Event<void> {
		return this._onProgressChanged.event;
	}

	constructor(private readonly container: Container) {
		this.disposables.push(
			this.container.usage.onDidChange(this.onUsageChanged, this),
			this.container.subscription.onDidChange(this.onSubscriptionChanged, this),
		);

		void this.initializeState();
	}

	private async initializeState() {
		this.subscriptionState = (await this.container.subscription.getSubscription(true)).state;

		for (const key of walkthroughRequiredMapping.keys()) {
			if (this.validateStep(key)) {
				void this.completeStep(key);
			}
		}
		this._onProgressChanged.fire(undefined);
	}

	private onUsageChanged(e: UsageChangeEvent | void) {
		const usageTrackingKey = e?.key;
		if (!usageTrackingKey) {
			return;
		}

		const stepsToValidate = this.getStepsFromUsage(usageTrackingKey);
		let shouldFire = false;
		for (const step of stepsToValidate) {
			// no need to check if the step is already completed
			if (this.completed.has(step)) {
				continue;
			}

			if (this.validateStep(step)) {
				void this.completeStep(step);
				this.container.telemetry.sendEvent('walkthrough/completion', {
					'context.key': step,
				});
				shouldFire = true;
			}
		}
		if (shouldFire) {
			this._onProgressChanged.fire(undefined);
		}
	}

	private onSubscriptionChanged(e: SubscriptionChangeEvent) {
		this.subscriptionState = e.current.state;
		const stepsToValidate = this.getStepsFromSubscriptionState(e.current.state);
		let shouldFire = false;
		for (const step of stepsToValidate) {
			// no need to check if the step is already completed
			if (this.completed.has(step)) {
				continue;
			}

			if (this.validateStep(step)) {
				void this.completeStep(step);
				this.container.telemetry.sendEvent('walkthrough/completion', {
					'context.key': step,
				});
				shouldFire = true;
			}
		}
		if (shouldFire) {
			this._onProgressChanged.fire(undefined);
		}
	}

	private _isInitialized: boolean = false;
	private _initPromise: Promise<void> | undefined;
	/**
	 * Walkthrough view is not ready to listen to context changes immediately after opening VSCode with the walkthrough page opened
	 * As we're not able to check if the walkthrough is ready, we need to add a delay.
	 * The 1s delay will not be too annoying for user but it's enough to init
	 */
	private async waitForWalkthroughInitialized() {
		if (this._isInitialized) {
			return;
		}
		if (!this._initPromise) {
			this._initPromise = wait(1000).then(() => {
				this._isInitialized = true;
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
		this.completed.add(key);
		await this.waitForWalkthroughInitialized();
		void setContext(`gitlens:walkthroughState:${key}`, true);
	}

	get doneCount() {
		return this.completed.size;
	}

	get progress() {
		return this.doneCount / this.walkthroughSize;
	}

	dispose(): void {
		Disposable.from(...this.disposables).dispose();
	}

	private getStepsFromUsage(usageKey: TrackedUsageKeys): WalkthroughContextKeys[] {
		const keys: WalkthroughContextKeys[] = [];
		for (const [key, { subscriptionCommands, usage }] of walkthroughRequiredMapping) {
			if (subscriptionCommands?.includes(usageKey) || usage.includes(usageKey)) {
				keys.push(key);
			}
		}

		return keys;
	}

	private getStepsFromSubscriptionState(_state: SubscriptionState): WalkthroughContextKeys[] {
		const keys: WalkthroughContextKeys[] = [];
		for (const [key, { subscriptionStates }] of walkthroughRequiredMapping) {
			if (subscriptionStates != null) {
				keys.push(key);
			}
		}

		return keys;
	}

	private validateStep(key: WalkthroughContextKeys): boolean {
		const { subscriptionStates, subscriptionCommands, usage } = walkthroughRequiredMapping.get(key)!;

		let subscriptionState: boolean | undefined;
		if (subscriptionStates != null && subscriptionStates.length > 0) {
			subscriptionState = this.subscriptionState != null && subscriptionStates.includes(this.subscriptionState);
		}
		let subscriptionCommandState: boolean | undefined;
		if (subscriptionCommands != null && subscriptionCommands.length > 0) {
			subscriptionCommandState = subscriptionCommands.some(event => this.container.usage.isUsed(event));
		}
		if (
			(subscriptionState === undefined && subscriptionCommandState === false) ||
			(subscriptionState === false && subscriptionCommandState !== true)
		) {
			return false;
		}

		if (usage.length > 0 && !usage.some(event => this.container.usage.isUsed(event))) {
			return false;
		}
		return true;
	}
}

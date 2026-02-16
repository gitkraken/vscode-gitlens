import type { Event } from 'vscode';
import { Disposable, env, EventEmitter } from 'vscode';
import { SubscriptionState } from '../constants.subscription.js';
import type { TrackedUsageKeys } from '../constants.telemetry.js';
import type { WalkthroughContextKeys } from '../constants.walkthroughs.js';
import type { Container } from '../container.js';
import type { SubscriptionChangeEvent } from '../plus/gk/subscriptionService.js';
import { setContext } from '../system/-webview/context.js';
import { wait } from '../system/promise.js';
import type { UsageChangeEvent } from './usageTracker.js';

type WalkthroughUsage = {
	subscriptionStates?: SubscriptionState[] | Readonly<SubscriptionState[]>;
	subscriptionCommands?: TrackedUsageKeys[] | Readonly<TrackedUsageKeys[]>;
	usage: TrackedUsageKeys[];
};

const triedProStates: Readonly<SubscriptionState[]> = [
	SubscriptionState.Trial,
	SubscriptionState.TrialExpired,
	SubscriptionState.TrialReactivationEligible,
	SubscriptionState.Paid,
];

const tryProCommands: Readonly<TrackedUsageKeys[]> = ['command:gitlens.plus.reactivateProTrial:executed'];

const walkthroughRequiredMapping: Readonly<Map<WalkthroughContextKeys, WalkthroughUsage>> = new Map<
	WalkthroughContextKeys,
	WalkthroughUsage
>([
	[
		'gettingStarted',
		{
			subscriptionStates: triedProStates,
			subscriptionCommands: tryProCommands,
			usage: [],
		},
	],
	[
		'visualizeCodeHistory',
		{
			subscriptionStates: triedProStates,
			subscriptionCommands: tryProCommands,
			usage: [
				'graphDetailsView:shown',
				'graphView:shown',
				'graphWebview:shown',
				'commitDetailsView:shown',
				'command:gitlens.showGraph:executed',
				'command:gitlens.showGraphPage:executed',
				'command:gitlens.showGraphView:executed',
				'command:gitlens.showInCommitGraph:executed',
				'command:gitlens.showInCommitGraphView:executed',
			],
		},
	],
	['gitBlame', { usage: ['command:gitlens.toggleFileBlame:executed', 'command:gitlens.toggleLineBlame:executed'] }],
	[
		'prReviews',
		{
			subscriptionStates: triedProStates,
			subscriptionCommands: tryProCommands,
			usage: [
				'launchpadView:shown',
				'worktreesView:shown',
				'command:gitlens.showLaunchpad:executed',
				'command:gitlens.showLaunchpadView:executed',
				'command:gitlens.git.worktree:executed',
				'command:gitlens.git.worktree.create:executed',
				'command:gitlens.git.worktree.delete:executed',
				'command:gitlens.git.worktree.open:executed',
			],
		},
	],
	[
		'aiFeatures',
		{
			usage: [
				'command:gitlens.walkthrough.openAiSettings:executed',
				'command:gitlens.ai.explainBranch:executed',
				'command:gitlens.ai.explainCommit:executed',
				'command:gitlens.ai.explainStash:executed',
				'command:gitlens.ai.explainWip:executed',
				'command:gitlens.ai.generateChangelog:executed',
				'command:gitlens.ai.generateCommitMessage:executed',
				'command:gitlens.ai.explainBranch:graph:executed',
				'command:gitlens.ai.explainBranch:views:executed',
				'command:gitlens.ai.explainCommit:graph:executed',
				'command:gitlens.ai.explainCommit:views:executed',
				'command:gitlens.ai.explainStash:graph:executed',
				'command:gitlens.ai.explainStash:views:executed',
				'command:gitlens.ai.explainWip:graph:executed',
				'command:gitlens.ai.explainWip:views:executed',
				'command:gitlens.ai.generateChangelogFrom:graph:executed',
				'command:gitlens.ai.generateChangelogFrom:views:executed',
				'command:gitlens.ai.generateCommitMessage:graph:executed',
				'command:gitlens.ai.generateCommitMessage:scm:executed',
				'command:gitlens.ai.generateChangelog:views:executed',
				'action:gitlens.ai.generateCommits:happened',
			],
		},
	],
	[
		'mcpFeatures',
		{
			usage: [
				'command:gitlens.ai.mcp.install:executed',
				'command:gitlens.ai.mcp.reinstall:executed',
				'action:gitlens.mcp.ipcRequest:happened',
				'action:gitlens.mcp.chatInteraction:happened',
				'action:gitlens.mcp.bundledMcpDefinitionProvided:happened',
			],
		},
	],
]);

export class WalkthroughStateProvider implements Disposable {
	private readonly _onDidChangeProgress = new EventEmitter<void>();
	get onDidChangeProgress(): Event<void> {
		return this._onDidChangeProgress.event;
	}

	readonly walkthroughSize = walkthroughRequiredMapping.size;

	protected disposables: Disposable[] = [];
	private readonly completed = new Set<WalkthroughContextKeys>();
	private subscriptionState: SubscriptionState | undefined;

	readonly isWalkthroughSupported = isWalkthroughSupported();

	constructor(private readonly container: Container) {
		if (this.isWalkthroughSupported) {
			void setContext('gitlens:walkthroughSupported', true);
		}

		this.disposables.push(
			this._onDidChangeProgress,
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
		this._onDidChangeProgress.fire(undefined);
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
			this._onDidChangeProgress.fire(undefined);
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
			this._onDidChangeProgress.fire(undefined);
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

	get doneCount(): number {
		return this.completed.size;
	}

	get progress(): number {
		return this.doneCount / this.walkthroughSize;
	}

	getState(): Map<WalkthroughContextKeys, boolean> {
		const state = new Map<WalkthroughContextKeys, boolean>();
		for (const key of walkthroughRequiredMapping.keys()) {
			state.set(key, this.completed.has(key));
		}
		return state;
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

const walkthroughsUnsupportedByApp = ['Cursor', 'Qoder', 'Trae', 'Void'];
export function isWalkthroughSupported(): boolean {
	return !walkthroughsUnsupportedByApp.includes(env.appName);
}

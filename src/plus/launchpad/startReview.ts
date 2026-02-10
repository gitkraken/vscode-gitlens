import type { QuickPick } from 'vscode';
import { Uri, window } from 'vscode';
import type { ManageCloudIntegrationsCommandArgs } from '../../commands/cloudIntegrations.js';
import type {
	AsyncStepResultGenerator,
	PartialStepState,
	StepGenerator,
	StepsContext,
	StepSelection,
	StepState,
} from '../../commands/quick-wizard/models/steps.js';
import { StepResultBreak } from '../../commands/quick-wizard/models/steps.js';
import type { QuickPickStep } from '../../commands/quick-wizard/models/steps.quickpick.js';
import {
	ConnectIntegrationButton,
	OpenOnAzureDevOpsQuickInputButton,
	OpenOnBitbucketQuickInputButton,
	OpenOnGitHubQuickInputButton,
	OpenOnGitLabQuickInputButton,
} from '../../commands/quick-wizard/quickButtons.js';
import { QuickCommand } from '../../commands/quick-wizard/quickCommand.js';
import { ensureAccessStep } from '../../commands/quick-wizard/steps/access.js';
import { StepsController } from '../../commands/quick-wizard/stepsController.js';
import { canPickStepContinue, createPickStep } from '../../commands/quick-wizard/utils/steps.utils.js';
import type { IntegrationIds } from '../../constants.integrations.js';
import { GitCloudHostIntegrationId } from '../../constants.integrations.js';
import { proBadge } from '../../constants.js';
import type { Source, Sources } from '../../constants.telemetry.js';
import type { Container } from '../../container.js';
import type { GitBranch } from '../../git/models/branch.js';
import type { PullRequest } from '../../git/models/pullRequest.js';
import type { GitWorktree } from '../../git/models/worktree.js';
import type { QuickPickItemOfT } from '../../quickpicks/items/common.js';
import { createQuickPickItemOfT } from '../../quickpicks/items/common.js';
import type { DirectiveQuickPickItem } from '../../quickpicks/items/directive.js';
import { createDirectiveQuickPickItem, Directive } from '../../quickpicks/items/directive.js';
import { executeCommand } from '../../system/-webview/command.js';
import { configuration } from '../../system/-webview/configuration.js';
import { openUrl } from '../../system/-webview/vscode/uris.js';
import { getScopedCounter } from '../../system/counter.js';
import { fromNow } from '../../system/date.js';
import { some } from '../../system/iterable.js';
import type { Deferred } from '../../system/promise.js';
import type { ConnectMoreIntegrationsItem } from '../integrations/utils/-webview/integration.quickPicks.js';
import {
	getOpenOnGitProviderQuickInputButtons,
	isManageIntegrationsItem,
	manageIntegrationsItem,
} from '../integrations/utils/-webview/integration.quickPicks.js';
import type { LaunchpadCategorizedResult, LaunchpadItem } from './launchpadProvider.js';
import { getLaunchpadItemIdHash, supportedLaunchpadIntegrations } from './launchpadProvider.js';
import { startReviewFromLaunchpadItem } from './utils/-webview/startReview.utils.js';

export interface StartReviewTelemetryContext {
	instance: number;
	'items.count'?: number;
}

export interface StartReviewCommandArgs {
	readonly command: 'startReview';
	source?: Sources;

	// Pre-select PR by URL (skips PR picker)
	prUrl?: string;

	// Use smart defaults and skip unnecessary steps
	useDefaults?: boolean;

	// Open chat on after branch/worktree is opened
	openChatOnComplete?: boolean;

	// Instructions to include in the AI prompt
	instructions?: string;

	// Result tracking for programmatic usage
	result?: Deferred<{ branch: GitBranch; worktree?: GitWorktree; pr: PullRequest }>;
}

const instanceCounter = getScopedCounter();

const Steps = {
	ConnectIntegrations: 'startReview-connect-integrations',
	EnsureAccess: 'startReview-ensure-access',
	PickPullRequest: 'startReview-pick-pr',
} as const;
type StepNames = (typeof Steps)[keyof typeof Steps];

const connectMoreIntegrationsItem: ConnectMoreIntegrationsItem = {
	label: 'Connect an Additional Integration...',
	detail: 'Connect additional integrations to view their pull requests',
	item: undefined,
};

interface StartReviewItem {
	launchpadItem: LaunchpadItem;
}

interface StartReviewResult {
	items: StartReviewItem[];
}

export interface StartReviewContext extends StepsContext<StepNames> {
	result?: StartReviewResult;
	title: string;
	telemetryContext: StartReviewTelemetryContext | undefined;
	connectedIntegrations: Map<IntegrationIds, boolean>;
}

interface StartReviewState {
	item?: StartReviewItem;
	prUrl?: string;
	instructions?: string;
	useDefaults?: boolean;
	openChatOnComplete?: boolean;
	result?: Deferred<{ branch: GitBranch; worktree?: GitWorktree; pr: PullRequest }>;
}

export type StartReviewStepState<T extends StartReviewState = StartReviewState> = RequireSome<StepState<T>, 'item'>;

function assertsStartReviewStepState(state: StepState<StartReviewState>): asserts state is StartReviewStepState {
	if (state.item != null) return;

	debugger;
	throw new Error('Missing item');
}

function isConnectMoreIntegrationsItem(item: unknown): item is ConnectMoreIntegrationsItem {
	return item === connectMoreIntegrationsItem;
}

function buildItemTelemetryData(item: StartReviewItem) {
	return {
		'item.id': getLaunchpadItemIdHash(item.launchpadItem),
		'item.provider': item.launchpadItem.provider.id,
		'item.updatedDate': item.launchpadItem.updatedDate.getTime(),
	};
}

export class StartReviewCommand extends QuickCommand<StartReviewState> {
	private readonly source: Source;
	private readonly telemetryContext: StartReviewTelemetryContext | undefined;
	private readonly telemetryEventKey = 'startReview';

	constructor(container: Container, args?: StartReviewCommandArgs) {
		super(container, 'startReview', 'startReview', `Start Review\u00a0\u00a0${proBadge}`, {
			description: 'Start a review for a pull request',
		});

		this.source = { source: args?.source ?? 'commandPalette' };

		if (this.container.telemetry.enabled) {
			this.telemetryContext = { instance: instanceCounter.next() };

			this.container.telemetry.sendEvent(
				`${this.telemetryEventKey}/open`,
				{ ...this.telemetryContext },
				this.source,
			);
		}

		this.initialState = {
			prUrl: args?.prUrl,
			instructions: args?.instructions,
			useDefaults: args?.useDefaults,
			openChatOnComplete: args?.openChatOnComplete,
			result: args?.result,
		};
	}

	protected override createContext(context?: StepsContext<any>): StartReviewContext {
		return {
			...context,
			container: this.container,
			result: undefined,
			title: this.title,
			telemetryContext: this.telemetryContext,
			connectedIntegrations: undefined!,
		};
	}

	protected async *steps(state: PartialStepState<StartReviewState>, context?: StartReviewContext): StepGenerator {
		if (this.container.git.isDiscoveringRepositories) {
			await this.container.git.isDiscoveringRepositories;
		}

		context ??= this.createContext();
		context.connectedIntegrations = await this.container.launchpad.getConnectedIntegrations();

		using steps = new StepsController<StepNames>(context, this);

		let opened = false;
		try {
			while (!steps.isComplete) {
				context.title = this.title;
				const hasConnectedIntegrations = [...context.connectedIntegrations.values()].some(c => c);

				if (steps.isAtStep(Steps.ConnectIntegrations) || !hasConnectedIntegrations) {
					using step = steps.enterStep(Steps.ConnectIntegrations);

					if (this.container.telemetry.enabled) {
						this.container.telemetry.sendEvent(
							opened ? `${this.telemetryEventKey}/steps/connect` : `${this.telemetryEventKey}/opened`,
							{
								...context.telemetryContext!,
								connected: false,
							},
							this.source,
						);
					}

					opened = true;

					const isUsingCloudIntegrations = configuration.get('cloudIntegrations.enabled', undefined, false);
					const result = isUsingCloudIntegrations
						? yield* this.confirmCloudIntegrationsConnectStep(state, context)
						: yield* this.confirmLocalIntegrationConnectStep(state, context);
					if (result === StepResultBreak) {
						if (step.goBack() == null) break;
						continue;
					}

					result.resume();

					const connected = result.connected;
					if (!connected) continue;
				}

				if (steps.isAtStepOrUnset(Steps.EnsureAccess)) {
					using step = steps.enterStep(Steps.EnsureAccess);

					const result = yield* ensureAccessStep(this.container, 'startReview', state, context, step);
					if (result === StepResultBreak) {
						if (step.goBack() == null) break;
						continue;
					}
				}

				if (steps.isAtStepOrUnset(Steps.PickPullRequest) || state.item == null) {
					using step = steps.enterStep(Steps.PickPullRequest);

					if (this.container.telemetry.enabled) {
						this.container.telemetry.sendEvent(
							opened ? `${this.telemetryEventKey}/steps/pr` : `${this.telemetryEventKey}/opened`,
							{
								...context.telemetryContext!,
								connected: true,
							},
							this.source,
						);
					}

					opened = true;

					// Auto-select PR if prUrl is provided
					if (state.prUrl && state.useDefaults) {
						// Lookup the LaunchpadItem from the URL, then execute the review
						try {
							const launchpadItem = await this.lookupLaunchpadItem(state.prUrl);
							if (launchpadItem == null) {
								throw new Error(`No PR found matching '${state.prUrl}'`);
							}

							const reviewResult = await startReviewFromLaunchpadItem(
								this.container,
								launchpadItem,
								state.instructions,
								state.openChatOnComplete,
								state.useDefaults,
							);
							state.result?.fulfill(reviewResult);
							steps.markStepsComplete();
							return;
						} catch (ex) {
							state.result?.cancel(ex instanceof Error ? ex : new Error(String(ex)));
							void window.showErrorMessage(
								`Failed to start review: ${ex instanceof Error ? ex.message : String(ex)}`,
							);
							return StepResultBreak;
						}
					}

					// Otherwise, show the PR picker
					const result = yield* this.pickPullRequestStep(state, context);
					if (result === StepResultBreak) {
						state.item = undefined;
						if (step.goBack() == null) break;
						continue;
					}

					state.item = result;

					if (this.container.telemetry.enabled) {
						this.container.telemetry.sendEvent(
							`${this.telemetryEventKey}/pr/chosen`,
							{
								...context.telemetryContext!,
								...buildItemTelemetryData(result),
								connected: true,
							},
							this.source,
						);
					}
				}

				assertsStartReviewStepState(state);

				// Execute the review using the LaunchpadItem directly (avoids redundant PR lookup)
				try {
					const reviewResult = await startReviewFromLaunchpadItem(
						this.container,
						state.item.launchpadItem,
						state.instructions,
						state.openChatOnComplete,
						state.useDefaults,
					);
					state.result?.fulfill(reviewResult);
				} catch (ex) {
					state.result?.cancel(ex instanceof Error ? ex : new Error(String(ex)));
					void window.showErrorMessage(
						`Failed to start review: ${ex instanceof Error ? ex.message : String(ex)}`,
					);
					return StepResultBreak;
				}

				steps.markStepsComplete();
			}
		} finally {
			if (state.result?.pending) {
				state.result.cancel(new Error('Start Review cancelled'));
			}
		}

		return steps.isComplete ? undefined : StepResultBreak;
	}

	private async ensureIntegrationConnected(id: IntegrationIds) {
		const integration = await this.container.integrations.get(id);
		if (integration == null) return false;

		let connected = integration.maybeConnected ?? (await integration.isConnected());
		if (!connected) {
			connected = await integration.connect('startReview');
		}

		return connected;
	}

	private async lookupLaunchpadItem(prUrl: string): Promise<LaunchpadItem | undefined> {
		const result = await this.container.launchpad.getCategorizedItems({ search: prUrl });
		if (result.error != null) {
			throw new Error(`Error fetching PR: ${result.error.message}`);
		}

		return result.items?.[0];
	}

	private async *confirmLocalIntegrationConnectStep(
		state: StepState<StartReviewState>,
		context: StartReviewContext,
	): AsyncStepResultGenerator<{ connected: boolean | IntegrationIds; resume: () => void | undefined }> {
		context.result = undefined;
		const confirmations: (QuickPickItemOfT<IntegrationIds> | DirectiveQuickPickItem)[] = [];

		for (const integration of supportedLaunchpadIntegrations) {
			if (context.connectedIntegrations.get(integration)) {
				continue;
			}
			switch (integration) {
				case GitCloudHostIntegrationId.GitHub:
					confirmations.push(
						createQuickPickItemOfT(
							{
								label: 'Connect to GitHub...',
								detail: 'Will connect to GitHub to provide access to your pull requests',
							},
							integration,
						),
					);
					break;
				default:
					break;
			}
		}

		const step = this.createConfirmStep(
			`${this.title} \u00a0\u2022\u00a0 Connect an Integration`,
			confirmations,
			createDirectiveQuickPickItem(Directive.Cancel, false, { label: 'Cancel' }),
			{
				placeholder: 'Connect an integration to view pull requests for review',
				buttons: [],
				ignoreFocusOut: false,
			},
		);

		const selection: StepSelection<typeof step> = yield step;
		if (canPickStepContinue(step, state, selection)) {
			const resume = step.freeze?.();
			const chosenIntegrationId = selection[0].item;
			const connected = await this.ensureIntegrationConnected(chosenIntegrationId);
			return { connected: connected ? chosenIntegrationId : false, resume: () => resume?.dispose() };
		}

		return StepResultBreak;
	}

	private async *confirmCloudIntegrationsConnectStep(
		state: StepState<StartReviewState>,
		context: StartReviewContext,
		overrideStep?: QuickPickStep<QuickPickItemOfT<StartReviewItem>>,
	): AsyncStepResultGenerator<{ connected: boolean | IntegrationIds; resume: () => void | undefined }> {
		const hasConnectedIntegration = some(context.connectedIntegrations.values(), c => c);
		context.result = undefined;
		let step;
		let selection;
		if (overrideStep == null) {
			step = this.createConfirmStep(
				`${this.title} \u00a0\u2022\u00a0 Connect an ${hasConnectedIntegration ? 'Additional ' : ''}Integration`,
				[
					createQuickPickItemOfT(
						{
							label: `Connect an ${hasConnectedIntegration ? 'Additional ' : ''}Integration...`,
							detail: hasConnectedIntegration
								? 'Connect additional integrations to view their pull requests'
								: 'Connect an integration to start reviewing pull requests',
							picked: true,
						},
						true,
					),
				],
				createDirectiveQuickPickItem(Directive.Cancel, false, { label: 'Cancel' }),
				{
					placeholder: hasConnectedIntegration
						? 'Connect additional integrations to Start Review'
						: 'Connect an integration to get started with Start Review',
					buttons: [],
					ignoreFocusOut: true,
				},
			);

			selection = yield step;
		} else {
			step = overrideStep;
			selection = [true];
		}

		if (canPickStepContinue(step, state, selection)) {
			let previousPlaceholder: string | undefined;
			if (step.quickpick) {
				previousPlaceholder = step.quickpick.placeholder;
				step.quickpick.placeholder = 'Connecting integrations...';
			}
			const resume = step.freeze?.();
			const connected = await this.container.integrations.connectCloudIntegrations(
				{ integrationIds: supportedLaunchpadIntegrations },
				{
					source: 'startReview',
				},
			);
			if (step.quickpick) {
				step.quickpick.placeholder = previousPlaceholder;
			}
			return { connected: connected, resume: () => resume?.dispose() };
		}

		return StepResultBreak;
	}

	private async *pickPullRequestStep(
		state: StepState<StartReviewState>,
		context: StartReviewContext,
	): AsyncStepResultGenerator<StartReviewItem> {
		const hasDisconnectedIntegrations = [...context.connectedIntegrations.values()].some(c => !c);

		const buildPullRequestQuickPickItem = (i: StartReviewItem) => {
			const buttons = getOpenOnGitProviderQuickInputButtons(i.launchpadItem.provider.id);
			return {
				label:
					i.launchpadItem.title.length > 60
						? `${i.launchpadItem.title.substring(0, 60)}...`
						: i.launchpadItem.title,
				description: `\u00a0 ${i.launchpadItem.repository.owner.login}/${i.launchpadItem.repository.name}#${i.launchpadItem.id} \u00a0`,
				detail: `      ${fromNow(i.launchpadItem.updatedDate)} by @${i.launchpadItem.author?.username ?? 'unknown'}`,
				iconPath:
					i.launchpadItem.author?.avatarUrl != null ? Uri.parse(i.launchpadItem.author.avatarUrl) : undefined,
				item: i,
				picked: i.launchpadItem.uuid === state.item?.launchpadItem.uuid,
				buttons: buttons,
			};
		};

		const getItems = (result: StartReviewResult) => {
			const items: QuickPickItemOfT<StartReviewItem>[] = [];

			if (result.items?.length) {
				items.push(...result.items.map(buildPullRequestQuickPickItem));
			}

			return items;
		};

		function getItemsAndPlaceholder(): {
			placeholder: string;
			items: (DirectiveQuickPickItem | QuickPickItemOfT<StartReviewItem | undefined>)[];
		} {
			if (!context.result?.items.length) {
				return {
					placeholder: 'No pull requests found. Paste a PR URL or connect more integrations.',
					items: [
						hasDisconnectedIntegrations ? connectMoreIntegrationsItem : manageIntegrationsItem,
						createDirectiveQuickPickItem(Directive.Cancel),
					],
				};
			}

			return {
				placeholder: 'Choose a pull request to review or paste a PR URL',
				items: [...getItems(context.result), createDirectiveQuickPickItem(Directive.Cancel)],
			};
		}

		const updateItems = async (quickpick: QuickPick<any>) => {
			quickpick.busy = true;
			try {
				await updateContextItems(this.container, context);
				const { items, placeholder } = getItemsAndPlaceholder();
				quickpick.placeholder = placeholder;
				quickpick.items = items;
			} catch {
				quickpick.placeholder = 'Error retrieving pull requests';
				quickpick.items = [createDirectiveQuickPickItem(Directive.Cancel)];
			} finally {
				quickpick.busy = false;
			}
		};

		const step = createPickStep<QuickPickItemOfT<StartReviewItem>>({
			title: context.title,
			placeholder: 'Loading...',
			matchOnDescription: true,
			matchOnDetail: true,
			items: [],
			buttons: [...(hasDisconnectedIntegrations ? [ConnectIntegrationButton] : [])],
			onDidActivate: updateItems,
			onDidClickButton: async (_quickpick, button) => {
				switch (button) {
					case ConnectIntegrationButton:
						this.sendTitleActionTelemetry('connect', context);
						return this.next([connectMoreIntegrationsItem]);
				}
				return undefined;
			},
			onDidClickItemButton: (_quickpick, button, { item }) => {
				switch (button) {
					case OpenOnAzureDevOpsQuickInputButton:
					case OpenOnBitbucketQuickInputButton:
					case OpenOnGitHubQuickInputButton:
					case OpenOnGitLabQuickInputButton:
						this.sendItemActionTelemetry('soft-open', item, context);
						this.open(item);
						return undefined;
					default:
						return false;
				}
			},
			onDidChangeValue: () => true,
		});

		const selection: StepSelection<typeof step> = yield step;
		if (!canPickStepContinue(step, state, selection)) {
			return StepResultBreak;
		}
		const element = selection[0];
		if (isConnectMoreIntegrationsItem(element)) {
			this.sendTitleActionTelemetry('connect', context);
			const isUsingCloudIntegrations = configuration.get('cloudIntegrations.enabled', undefined, false);
			const result = isUsingCloudIntegrations
				? yield* this.confirmCloudIntegrationsConnectStep(state, context, step)
				: yield* this.confirmLocalIntegrationConnectStep(state, context);
			if (result === StepResultBreak) return result;

			result.resume();
			return StepResultBreak;
		} else if (isManageIntegrationsItem(element)) {
			this.sendActionTelemetry('manage', context);
			executeCommand<ManageCloudIntegrationsCommandArgs>('gitlens.plus.cloudIntegrations.manage', {
				source: { source: 'startReview' },
			});
			return StepResultBreak;
		}

		return { ...element.item };
	}

	private open(item: StartReviewItem): void {
		if (item.launchpadItem.url == null) return;
		void openUrl(item.launchpadItem.url);
	}

	private sendItemActionTelemetry(action: 'soft-open', item: StartReviewItem, context: StartReviewContext) {
		if (!this.container.telemetry.enabled) return;

		this.container.telemetry.sendEvent(
			`${this.telemetryEventKey}/pr/action`,
			{
				...context.telemetryContext!,
				...buildItemTelemetryData(item),
				action: action,
				connected: true,
			},
			this.source,
		);
	}

	private sendTitleActionTelemetry(action: 'connect', context: StartReviewContext) {
		if (!this.container.telemetry.enabled) return;

		this.container.telemetry.sendEvent(
			`${this.telemetryEventKey}/title/action`,
			{ ...context.telemetryContext!, connected: true, action: action },
			this.source,
		);
	}

	private sendActionTelemetry(action: 'manage' | 'connect', context: StartReviewContext) {
		if (!this.container.telemetry.enabled) return;

		this.container.telemetry.sendEvent(
			`${this.telemetryEventKey}/action`,
			{ ...context.telemetryContext!, connected: true, action: action },
			this.source,
		);
	}
}

async function updateContextItems(container: Container, context: StartReviewContext) {
	context.connectedIntegrations = await container.launchpad.getConnectedIntegrations();

	// Get PRs from launchpad that need review
	const result: LaunchpadCategorizedResult = await container.launchpad.getCategorizedItems();

	if (result.error != null) {
		context.result = { items: [] };
		return;
	}

	// Filter to PRs that need review (not authored by current user, or explicitly in needs-my-review category)
	const reviewablePrs =
		result.items?.filter(item => item.actionableCategory === 'needs-my-review' || !item.viewer.isAuthor) ?? [];

	context.result = {
		items: reviewablePrs.map(launchpadItem => ({ launchpadItem: launchpadItem })),
	};

	if (container.telemetry.enabled) {
		updateTelemetryContext(context);
	}
}

function updateTelemetryContext(context: StartReviewContext) {
	context.telemetryContext = {
		...context.telemetryContext!,
		'items.count': context.result?.items.length ?? 0,
	};
}

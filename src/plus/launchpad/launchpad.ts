import type { QuickInputButton, QuickPick, QuickPickItem } from 'vscode';
import { commands, ThemeIcon, Uri } from 'vscode';
import { getAvatarUri } from '../../avatars';
import type {
	AsyncStepResultGenerator,
	PartialStepState,
	StepGenerator,
	StepResultGenerator,
	StepSelection,
	StepState,
} from '../../commands/quickCommand';
import {
	canPickStepContinue,
	createPickStep,
	endSteps,
	freezeStep,
	QuickCommand,
	StepResultBreak,
} from '../../commands/quickCommand';
import {
	ConnectIntegrationButton,
	FeedbackQuickInputButton,
	LaunchpadSettingsQuickInputButton,
	LearnAboutProQuickInputButton,
	MergeQuickInputButton,
	OpenOnGitHubQuickInputButton,
	OpenOnGitLabQuickInputButton,
	OpenOnWebQuickInputButton,
	OpenWorktreeInNewWindowQuickInputButton,
	PinQuickInputButton,
	RefreshQuickInputButton,
	SnoozeQuickInputButton,
	UnpinQuickInputButton,
	UnsnoozeQuickInputButton,
} from '../../commands/quickCommand.buttons';
import { ensureAccessStep } from '../../commands/quickCommand.steps';
import type { OpenWalkthroughCommandArgs } from '../../commands/walkthroughs';
import { proBadge, urls } from '../../constants';
import { Commands } from '../../constants.commands';
import type { IntegrationId } from '../../constants.integrations';
import { HostingIntegrationId, SelfHostedIntegrationId } from '../../constants.integrations';
import type { LaunchpadTelemetryContext, Source, Sources, TelemetryEvents } from '../../constants.telemetry';
import type { Container } from '../../container';
import { PlusFeatures } from '../../features';
import type { QuickPickItemOfT } from '../../quickpicks/items/common';
import { createQuickPickItemOfT, createQuickPickSeparator } from '../../quickpicks/items/common';
import type { DirectiveQuickPickItem } from '../../quickpicks/items/directive';
import { createDirectiveQuickPickItem, Directive, isDirectiveQuickPickItem } from '../../quickpicks/items/directive';
import { getScopedCounter } from '../../system/counter';
import { fromNow } from '../../system/date';
import { some } from '../../system/iterable';
import { interpolate, pluralize } from '../../system/string';
import { executeCommand } from '../../system/vscode/command';
import { configuration } from '../../system/vscode/configuration';
import { openUrl } from '../../system/vscode/utils';
import { getApplicablePromo } from '../gk/account/promos';
import { ProviderBuildStatusState, ProviderPullRequestReviewState } from '../integrations/providers/models';
import type {
	LaunchpadAction,
	LaunchpadActionCategory,
	LaunchpadCategorizedResult,
	LaunchpadGroup,
	LaunchpadItem,
	LaunchpadTargetAction,
} from './launchpadProvider';
import {
	countLaunchpadItemGroups,
	getLaunchpadItemIdHash,
	groupAndSortLaunchpadItems,
	launchpadGroupIconMap,
	launchpadGroupLabelMap,
	launchpadGroups,
	supportedLaunchpadIntegrations,
} from './launchpadProvider';

const actionGroupMap = new Map<LaunchpadActionCategory, string[]>([
	['mergeable', ['Ready to Merge', 'Ready to merge']],
	['unassigned-reviewers', ['Unassigned Reviewers', 'You need to assign reviewers']],
	['failed-checks', ['Failed Checks', 'You need to resolve the failing checks']],
	['conflicts', ['Resolve Conflicts', 'You need to resolve merge conflicts']],
	['needs-my-review', ['Needs Your Review', `\${author} requested your review`]],
	['code-suggestions', ['Code Suggestions', 'Code suggestions have been made on this pull request']],
	['changes-requested', ['Changes Requested', 'Reviewers requested changes before this can be merged']],
	['reviewer-commented', ['Reviewers Commented', 'Reviewers have commented on this pull request']],
	['waiting-for-review', ['Waiting for Review', 'Waiting for reviewers to approve this pull request']],
	['draft', ['Draft', 'Continue working on your draft']],
	['other', ['Other', `Opened by \${author} \${createdDateRelative}`]],
]);

export interface LaunchpadItemQuickPickItem extends QuickPickItemOfT<LaunchpadItem> {
	group: LaunchpadGroup;
}

type ConnectMoreIntegrationsItem = QuickPickItem & {
	item: undefined;
	group: undefined;
};
const connectMoreIntegrationsItem: ConnectMoreIntegrationsItem = {
	label: 'Connect more integrations',
	detail: 'Connect integration with more Git providers',
	item: undefined,
	group: undefined,
};
function isConnectMoreIntegrationsItem(item: unknown): item is ConnectMoreIntegrationsItem {
	return item === connectMoreIntegrationsItem;
}

interface Context {
	result: LaunchpadCategorizedResult;

	title: string;
	collapsed: Map<LaunchpadGroup, boolean>;
	telemetryContext: LaunchpadTelemetryContext | undefined;
	connectedIntegrations: Map<IntegrationId, boolean>;
	showGraduationPromo: boolean;
}

interface GroupedLaunchpadItem extends LaunchpadItem {
	group: LaunchpadGroup;
}

interface State {
	item?: GroupedLaunchpadItem;
	action?: LaunchpadAction | LaunchpadTargetAction;
	initialGroup?: LaunchpadGroup;
	selectTopItem?: boolean;
}

export interface LaunchpadCommandArgs {
	readonly command: 'launchpad';
	confirm?: boolean;
	source?: Sources;
	state?: Partial<State>;
}

type LaunchpadStepState<T extends State = State> = RequireSome<StepState<T>, 'item'>;

function assertsLaunchpadStepState(state: StepState<State>): asserts state is LaunchpadStepState {
	if (state.item != null) return;

	debugger;
	throw new Error('Missing item');
}

const instanceCounter = getScopedCounter();

const defaultCollapsedGroups: LaunchpadGroup[] = ['draft', 'other', 'snoozed'];

export class LaunchpadCommand extends QuickCommand<State> {
	private readonly source: Source;
	private readonly telemetryContext: LaunchpadTelemetryContext | undefined;

	constructor(container: Container, args?: LaunchpadCommandArgs) {
		super(container, 'launchpad', 'launchpad', `GitLens Launchpad\u00a0\u00a0${proBadge}`, {
			description: 'focus on a pull request',
		});

		if (
			args?.source === 'launchpad-indicator' &&
			container.storage.get('launchpad:indicator:hasInteracted') == null
		) {
			void container.storage.store('launchpad:indicator:hasInteracted', new Date().toISOString());
		}

		this.source = { source: args?.source ?? 'commandPalette' };
		if (this.container.telemetry.enabled) {
			this.telemetryContext = {
				instance: instanceCounter.next(),
				'initialState.group': args?.state?.initialGroup,
				'initialState.selectTopItem': args?.state?.selectTopItem ?? false,
			};

			this.container.telemetry.sendEvent('launchpad/open', { ...this.telemetryContext }, this.source);
		}

		let counter = 0;
		if (args?.state?.item != null) {
			counter++;
		}

		this.initialState = {
			counter: counter,
			confirm: args?.confirm,
			...args?.state,
		};
	}

	private async ensureIntegrationConnected(id: IntegrationId) {
		const integration = await this.container.integrations.get(id);
		let connected = integration.maybeConnected ?? (await integration.isConnected());
		if (!connected) {
			connected = await integration.connect('launchpad');
		}

		return connected;
	}

	protected async *steps(state: PartialStepState<State>): StepGenerator {
		if (this.container.git.isDiscoveringRepositories) {
			await this.container.git.isDiscoveringRepositories;
		}

		let storedCollapsed = this.container.storage.get('launchpad:groups:collapsed') satisfies
			| LaunchpadGroup[]
			| undefined;
		if (storedCollapsed == null) {
			storedCollapsed = defaultCollapsedGroups;
		}

		const collapsed = new Map<LaunchpadGroup, boolean>(storedCollapsed.map(g => [g, true]));
		if (state.initialGroup != null) {
			// set all to true except the initial group
			for (const group of launchpadGroups) {
				collapsed.set(group, group !== state.initialGroup);
			}
		}

		const context: Context = {
			result: { items: [] },
			title: this.title,
			collapsed: collapsed,
			telemetryContext: this.telemetryContext,
			connectedIntegrations: await this.container.launchpad.getConnectedIntegrations(),
			showGraduationPromo: false,
		};

		let opened = false;

		while (this.canStepsContinue(state)) {
			context.title = this.title;

			let newlyConnected = false;
			const hasConnectedIntegrations = [...context.connectedIntegrations.values()].some(c => c);
			if (!hasConnectedIntegrations) {
				if (this.container.telemetry.enabled) {
					this.container.telemetry.sendEvent(
						opened ? 'launchpad/steps/connect' : 'launchpad/opened',
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
					return result;
				}

				result.resume();

				const connected = result.connected;
				if (!connected) {
					continue;
				}

				newlyConnected = Boolean(connected);
			}

			const result = yield* ensureAccessStep(state, context, PlusFeatures.Launchpad);
			if (result === StepResultBreak) continue;

			context.showGraduationPromo = getApplicablePromo(result.subscription.current.state, 'launchpad') != null;

			await updateContextItems(this.container, context, { force: newlyConnected });

			if (state.counter < 1 || state.item == null) {
				if (this.container.telemetry.enabled) {
					this.container.telemetry.sendEvent(
						opened ? 'launchpad/steps/main' : 'launchpad/opened',
						{
							...context.telemetryContext!,
							connected: true,
						},
						this.source,
					);
				}

				opened = true;

				const result = yield* this.pickLaunchpadItemStep(state, context, {
					picked: state.item?.graphQLId,
					selectTopItem: state.selectTopItem,
				});
				if (result === StepResultBreak) continue;

				if (isConnectMoreIntegrationsItem(result)) {
					const isUsingCloudIntegrations = configuration.get('cloudIntegrations.enabled', undefined, false);
					const result = isUsingCloudIntegrations
						? yield* this.confirmCloudIntegrationsConnectStep(state, context)
						: yield* this.confirmLocalIntegrationConnectStep(state, context);
					if (result === StepResultBreak) continue;

					result.resume();

					const connected = result.connected;
					newlyConnected = Boolean(connected);
					await updateContextItems(this.container, context, { force: newlyConnected });
					continue;
				}

				state.item = result;
			}

			assertsLaunchpadStepState(state);

			if (this.confirm(state.confirm)) {
				this.sendItemActionTelemetry('select', state.item, state.item.group, context);
				await this.container.launchpad.ensureLaunchpadItemCodeSuggestions(state.item);

				const result = yield* this.confirmStep(state, context);
				if (result === StepResultBreak) continue;

				state.action = result;
			}

			if (state.action) {
				this.sendItemActionTelemetry(state.action, state.item, state.item.group, context);
			}

			if (typeof state.action === 'string') {
				switch (state.action) {
					case 'merge':
						void this.container.launchpad.merge(state.item);
						break;
					case 'open':
						this.container.launchpad.open(state.item);
						break;
					case 'soft-open':
						this.container.launchpad.open(state.item);
						state.counter = 2;
						continue;
					case 'switch':
					case 'show-overview':
						void this.container.launchpad.switchTo(state.item);
						break;
					case 'open-worktree':
						void this.container.launchpad.switchTo(state.item, { skipWorktreeConfirmations: true });
						break;
					case 'switch-and-code-suggest':
					case 'code-suggest':
						void this.container.launchpad.switchTo(state.item, { startCodeSuggestion: true });
						break;
					case 'open-changes':
						void this.container.launchpad.openChanges(state.item);
						break;
					case 'open-in-graph':
						void this.container.launchpad.openInGraph(state.item);
						break;
				}
			} else {
				switch (state.action?.action) {
					case 'open-suggestion': {
						this.container.launchpad.openCodeSuggestion(state.item, state.action.target);
						break;
					}
				}
			}

			endSteps(state);
		}

		return state.counter < 0 ? StepResultBreak : undefined;
	}

	private *pickLaunchpadItemStep(
		state: StepState<State>,
		context: Context,
		{ picked, selectTopItem }: { picked?: string; selectTopItem?: boolean },
	): StepResultGenerator<GroupedLaunchpadItem | ConnectMoreIntegrationsItem> {
		const hasDisconnectedIntegrations = [...context.connectedIntegrations.values()].some(c => !c);
		const getItems = (result: LaunchpadCategorizedResult) => {
			const items: (LaunchpadItemQuickPickItem | DirectiveQuickPickItem | ConnectMoreIntegrationsItem)[] = [];
			if (context.showGraduationPromo) {
				items.push(
					createDirectiveQuickPickItem(Directive.RequiresPaidSubscription, undefined, {
						label: `Preview access of Launchpad will end on September 27th`,
						detail: '$(blank) Upgrade before then to save 75% or more on GitLens Pro',
						iconPath: new ThemeIcon('megaphone'),
						buttons: [LearnAboutProQuickInputButton],
					}),
				);
			}

			if (result.items?.length) {
				const uiGroups = groupAndSortLaunchpadItems(result.items);
				const topItem: LaunchpadItem | undefined =
					!selectTopItem || picked != null
						? undefined
						: uiGroups.get('mergeable')?.[0] ||
						  uiGroups.get('blocked')?.[0] ||
						  uiGroups.get('follow-up')?.[0] ||
						  uiGroups.get('needs-review')?.[0];
				for (const [ui, groupItems] of uiGroups) {
					if (!groupItems.length) continue;

					items.push(
						createQuickPickSeparator(groupItems.length ? groupItems.length.toString() : undefined),
						createDirectiveQuickPickItem(Directive.Reload, false, {
							label: `$(${
								context.collapsed.get(ui) ? 'chevron-down' : 'chevron-up'
							})\u00a0\u00a0${launchpadGroupIconMap.get(ui)!}\u00a0\u00a0${launchpadGroupLabelMap
								.get(ui)
								?.toUpperCase()}`, //'\u00a0',
							//detail: groupMap.get(group)?.[0].toUpperCase(),
							onDidSelect: () => {
								const collapsed = !context.collapsed.get(ui);
								context.collapsed.set(ui, collapsed);
								if (state.initialGroup == null) {
									void this.container.storage.store(
										'launchpad:groups:collapsed',
										Array.from(context.collapsed.keys()).filter(g => context.collapsed.get(g)),
									);
								}

								if (this.container.telemetry.enabled) {
									updateTelemetryContext(context);
									this.container.telemetry.sendEvent(
										'launchpad/groupToggled',
										{
											...context.telemetryContext!,
											group: ui,
											collapsed: collapsed,
										},
										this.source,
									);
								}
							},
						}),
					);

					if (context.collapsed.get(ui)) continue;

					items.push(
						...groupItems.map(i => {
							const buttons = [];

							if (i.actionableCategory === 'mergeable') {
								buttons.push(MergeQuickInputButton);
							}

							buttons.push(
								i.viewer.pinned ? UnpinQuickInputButton : PinQuickInputButton,
								i.viewer.snoozed ? UnsnoozeQuickInputButton : SnoozeQuickInputButton,
							);

							buttons.push(...getOpenOnGitProviderQuickInputButtons(i.provider.id));

							if (!i.openRepository?.localBranch?.current) {
								buttons.push(OpenWorktreeInNewWindowQuickInputButton);
							}

							return {
								label: i.title.length > 60 ? `${i.title.substring(0, 60)}...` : i.title,
								// description: `${i.repoAndOwner}#${i.id}, by @${i.author}`,
								description: `\u00a0 ${i.repository.owner.login}/${i.repository.name}#${i.id} \u00a0 ${
									i.codeSuggestionsCount > 0
										? ` $(gitlens-code-suggestion) ${i.codeSuggestionsCount}`
										: ''
								} \u00a0 ${i.isNew ? '(New since last view)' : ''}`,
								detail: `      ${i.viewer.pinned ? '$(pinned) ' : ''}${
									i.actionableCategory === 'other'
										? ''
										: `${actionGroupMap.get(i.actionableCategory)![0]} \u2022  `
								}${fromNow(i.updatedDate)} by @${i.author!.username}`,

								buttons: buttons,
								iconPath: i.author?.avatarUrl != null ? Uri.parse(i.author.avatarUrl) : undefined,
								item: i,
								picked: i.graphQLId === picked || i.graphQLId === topItem?.graphQLId,
								group: ui,
							};
						}),
					);
				}
			}

			return items;
		};

		function getItemsAndPlaceholder() {
			if (context.result.error != null) {
				return {
					placeholder: `Unable to load items (${
						context.result.error.name === 'HttpError' &&
						'status' in context.result.error &&
						typeof context.result.error.status === 'number'
							? `${context.result.error.status}: ${String(context.result.error)}`
							: String(context.result.error)
					})`,
					items: [createDirectiveQuickPickItem(Directive.Cancel, undefined, { label: 'OK' })],
				};
			}

			if (!context.result.items.length) {
				return {
					placeholder: 'All done! Take a vacation',
					items: [createDirectiveQuickPickItem(Directive.Cancel, undefined, { label: 'OK' })],
				};
			}

			return {
				placeholder: 'Choose an item to focus on',
				items: getItems(context.result),
			};
		}

		const updateItems = async (
			quickpick: QuickPick<LaunchpadItemQuickPickItem | DirectiveQuickPickItem | ConnectMoreIntegrationsItem>,
		) => {
			quickpick.busy = true;

			try {
				await updateContextItems(this.container, context, { force: true });

				const { items, placeholder } = getItemsAndPlaceholder();
				quickpick.placeholder = placeholder;
				quickpick.items = items;
			} finally {
				quickpick.busy = false;
			}
		};

		const { items, placeholder } = getItemsAndPlaceholder();

		let groupsHidden = false;

		const step = createPickStep({
			title: context.title,
			placeholder: placeholder,
			matchOnDetail: true,
			items: items,
			buttons: [
				// FeedbackQuickInputButton,
				OpenOnWebQuickInputButton,
				...(hasDisconnectedIntegrations ? [ConnectIntegrationButton] : []),
				LaunchpadSettingsQuickInputButton,
				RefreshQuickInputButton,
			],
			onDidChangeValue: quickpick => {
				const hideGroups = Boolean(quickpick.value?.length);

				if (groupsHidden != hideGroups) {
					groupsHidden = hideGroups;
					quickpick.items = hideGroups ? items.filter(i => !isDirectiveQuickPickItem(i)) : items;
				}

				return true;
			},
			onDidClickButton: async (quickpick, button) => {
				switch (button) {
					case ConnectIntegrationButton:
						this.sendTitleActionTelemetry('connect', context);
						return this.next([connectMoreIntegrationsItem]);

					case LaunchpadSettingsQuickInputButton:
						this.sendTitleActionTelemetry('settings', context);
						void commands.executeCommand('workbench.action.openSettings', 'gitlens.launchpad');
						break;

					case FeedbackQuickInputButton:
						this.sendTitleActionTelemetry('feedback', context);
						void openUrl('https://github.com/gitkraken/vscode-gitlens/discussions/3286');
						break;

					case OpenOnWebQuickInputButton:
						this.sendTitleActionTelemetry('open-on-gkdev', context);
						void openUrl(this.container.launchpad.generateWebUrl());
						break;

					case RefreshQuickInputButton:
						this.sendTitleActionTelemetry('refresh', context);
						await updateItems(quickpick);
						break;
				}
				return undefined;
			},

			onDidClickItemButton: async (quickpick, button, { group, item }) => {
				if (button === LearnAboutProQuickInputButton) {
					void openUrl(urls.proFeatures);
					return;
				}

				if (!item) return;

				switch (button) {
					case OpenOnGitHubQuickInputButton:
					case OpenOnGitLabQuickInputButton:
						this.sendItemActionTelemetry('soft-open', item, group, context);
						this.container.launchpad.open(item);
						break;

					case SnoozeQuickInputButton:
						this.sendItemActionTelemetry('snooze', item, group, context);
						await this.container.launchpad.snooze(item);
						break;

					case UnsnoozeQuickInputButton:
						this.sendItemActionTelemetry('unsnooze', item, group, context);
						await this.container.launchpad.unsnooze(item);
						break;

					case PinQuickInputButton:
						this.sendItemActionTelemetry('pin', item, group, context);
						await this.container.launchpad.pin(item);
						break;

					case UnpinQuickInputButton:
						this.sendItemActionTelemetry('unpin', item, group, context);
						await this.container.launchpad.unpin(item);
						break;

					case MergeQuickInputButton:
						this.sendItemActionTelemetry('merge', item, group, context);
						await this.container.launchpad.merge(item);
						break;

					case OpenWorktreeInNewWindowQuickInputButton:
						this.sendItemActionTelemetry('open-worktree', item, group, context);
						await this.container.launchpad.switchTo(item, { skipWorktreeConfirmations: true });
						break;
				}

				await updateItems(quickpick);
			},
		});

		const selection: StepSelection<typeof step> = yield step;
		if (!canPickStepContinue(step, state, selection)) {
			return StepResultBreak;
		}
		const element = selection[0];
		if (isConnectMoreIntegrationsItem(element)) {
			return element;
		}
		return { ...element.item, group: element.group };
	}

	private *confirmStep(
		state: LaunchpadStepState,
		context: Context,
	): StepResultGenerator<LaunchpadAction | LaunchpadTargetAction> {
		const gitProviderWebButtons = getOpenOnGitProviderQuickInputButtons(state.item.provider.id);
		const confirmations: (
			| QuickPickItemOfT<LaunchpadAction>
			| QuickPickItemOfT<LaunchpadTargetAction>
			| DirectiveQuickPickItem
		)[] = [
			createQuickPickSeparator(fromNow(state.item.updatedDate)),
			createQuickPickItemOfT(
				{
					label: state.item.title,
					description: `${state.item.repository.owner.login}/${state.item.repository.name}#${state.item.id}`,
					detail: interpolate(actionGroupMap.get(state.item.actionableCategory)![1], {
						author: state.item.author!.username,
						createdDateRelative: fromNow(state.item.createdDate),
					}),
					iconPath: state.item.author?.avatarUrl != null ? Uri.parse(state.item.author.avatarUrl) : undefined,
					buttons: [...gitProviderWebButtons],
				},
				'soft-open',
			),
			createDirectiveQuickPickItem(Directive.Noop, false, { label: '' }),
			...this.getLaunchpadItemInformationRows(state.item),
			createQuickPickSeparator('Actions'),
		];

		for (const action of state.item.suggestedActions) {
			switch (action) {
				case 'merge': {
					let from;
					let into;
					if (
						state.item.headRepository?.owner != null &&
						state.item.headRepository.owner !== state.item.repository.owner
					) {
						from =
							state.item.headRef != null
								? `${state.item.headRepository.owner.login}:${state.item.headRef.name}`
								: 'these changes';
						into =
							state.item.baseRef != null
								? ` into ${state.item.repository.owner.login}:${state.item.baseRef.name}`
								: '';
					} else {
						from = state.item.headRef?.name ?? 'these changes';
						into = state.item.baseRef?.name ? ` into ${state.item.baseRef.name}` : '';
					}

					confirmations.push(
						createQuickPickItemOfT(
							{
								label: 'Merge...',
								detail: `Will merge ${from}${into}`,
								buttons: [...gitProviderWebButtons],
							},
							action,
						),
					);
					break;
				}
				case 'open':
					confirmations.push(
						createQuickPickItemOfT(
							{
								label: `${this.getOpenActionLabel(
									state.item.actionableCategory,
								)} on ${getIntegrationTitle(state.item.provider.id)}`,
								buttons: [...gitProviderWebButtons],
							},
							action,
						),
					);
					break;
				case 'switch':
					confirmations.push(
						createQuickPickItemOfT(
							{
								label: 'Switch to Branch or Worktree',
								detail: 'Will checkout the branch, create or open a worktree',
							},
							action,
						),
					);
					break;
				case 'open-worktree':
					confirmations.push(
						createQuickPickItemOfT(
							{
								label: 'Open in Worktree',
								detail: 'Will create or open a worktree in a new window',
							},
							action,
						),
					);
					break;
				case 'switch-and-code-suggest':
					confirmations.push(
						createQuickPickItemOfT(
							{
								label: `Switch & Suggest ${
									state.item.viewer.isAuthor ? 'Additional ' : ''
								}Code Changes`,
								detail: 'Will checkout and start suggesting code changes',
							},
							action,
						),
					);
					break;
				case 'code-suggest':
					confirmations.push(
						createQuickPickItemOfT(
							{
								label: `Suggest ${state.item.viewer.isAuthor ? 'Additional ' : ''}Code Changes`,
								detail: 'Will start suggesting code changes',
							},
							action,
						),
					);
					break;
				case 'show-overview':
					confirmations.push(
						createQuickPickItemOfT(
							{
								label: 'Open Details',
								detail: 'Will open the pull request details in the Side Bar',
							},
							action,
						),
					);
					break;
				case 'open-changes':
					confirmations.push(
						createQuickPickItemOfT(
							{
								label: 'Open Changes',
								detail: 'Will open the pull request changes for review',
							},
							action,
						),
					);
					break;
				case 'open-in-graph':
					confirmations.push(
						createQuickPickItemOfT(
							{
								label: 'Open in Commit Graph',
							},
							action,
						),
					);
					break;
			}
		}

		const step = this.createConfirmStep(
			`Launchpad \u00a0\u2022\u00a0 Pull Request ${state.item.repository.owner.login}/${state.item.repository.name}#${state.item.id}`,
			confirmations,
			undefined,
			{
				placeholder: 'Choose an action to perform',
				onDidClickItemButton: (_quickpick, button, item) => {
					switch (button) {
						case OpenOnGitHubQuickInputButton:
						case OpenOnGitLabQuickInputButton:
							this.sendItemActionTelemetry('soft-open', state.item, state.item.group, context);
							this.container.launchpad.open(state.item);
							break;
						case OpenOnWebQuickInputButton:
							this.sendItemActionTelemetry(
								'open-suggestion-browser',
								state.item,
								state.item.group,
								context,
							);
							if (isLaunchpadTargetActionQuickPickItem(item)) {
								this.container.launchpad.openCodeSuggestionInBrowser(item.item.target);
							}
							break;
					}
				},
			},
		);

		const selection: StepSelection<typeof step> = yield step;
		return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
	}

	private async *confirmLocalIntegrationConnectStep(
		state: StepState<State>,
		context: Context,
	): AsyncStepResultGenerator<{ connected: boolean | IntegrationId; resume: () => void }> {
		const confirmations: (QuickPickItemOfT<IntegrationId> | DirectiveQuickPickItem)[] = [
			createDirectiveQuickPickItem(Directive.Cancel, undefined, {
				label: 'Launchpad prioritizes your pull requests to keep you focused and your team unblocked',
				detail: 'Click to learn more about Launchpad',
				iconPath: new ThemeIcon('rocket'),
				onDidSelect: () =>
					void executeCommand<OpenWalkthroughCommandArgs>(Commands.OpenWalkthrough, {
						step: 'launchpad',
						source: 'launchpad',
						detail: 'info',
					}),
			}),
			createQuickPickSeparator(),
		];

		for (const integration of supportedLaunchpadIntegrations) {
			if (context.connectedIntegrations.get(integration)) {
				continue;
			}
			switch (integration) {
				case HostingIntegrationId.GitHub:
					confirmations.push(
						createQuickPickItemOfT(
							{
								label: 'Connect to GitHub...',
								detail: 'Will connect to GitHub to provide access your pull requests and issues',
							},
							integration,
						),
					);
					break;
				case HostingIntegrationId.GitLab:
					confirmations.push(
						createQuickPickItemOfT(
							{
								label: 'Connect to GitLab...',
								detail: 'Will connect to GitLab to provide access your pull requests and issues',
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
			{ placeholder: 'Connect an integration to get started with Launchpad', buttons: [], ignoreFocusOut: false },
		);

		// Note: This is a hack to allow the quickpick to stay alive after the user finishes connecting the integration.
		// Otherwise it disappears.
		let freeze!: () => Disposable;
		step.onDidActivate = qp => {
			freeze = () => freezeStep(step, qp);
		};

		const selection: StepSelection<typeof step> = yield step;
		if (canPickStepContinue(step, state, selection)) {
			const resume = freeze();
			const chosenIntegrationId = selection[0].item;
			const connected = await this.ensureIntegrationConnected(chosenIntegrationId);
			return { connected: connected ? chosenIntegrationId : false, resume: () => resume[Symbol.dispose]() };
		}

		return StepResultBreak;
	}

	private async *confirmCloudIntegrationsConnectStep(
		state: StepState<State>,
		context: Context,
	): AsyncStepResultGenerator<{ connected: boolean | IntegrationId; resume: () => void }> {
		const hasConnectedIntegration = some(context.connectedIntegrations.values(), c => c);
		const step = this.createConfirmStep(
			`${this.title} \u00a0\u2022\u00a0 Connect an ${hasConnectedIntegration ? 'Additional ' : ''}Integration`,
			[
				createDirectiveQuickPickItem(Directive.Cancel, undefined, {
					label: 'Launchpad prioritizes your pull requests to keep you focused and your team unblocked',
					detail: 'Click to learn more about Launchpad',
					iconPath: new ThemeIcon('rocket'),
					onDidSelect: () =>
						void executeCommand<OpenWalkthroughCommandArgs>(Commands.OpenWalkthrough, {
							step: 'launchpad',
							source: 'launchpad',
							detail: 'info',
						}),
				}),
				createQuickPickSeparator(),
				createQuickPickItemOfT(
					{
						label: `Connect an ${hasConnectedIntegration ? 'Additional ' : ''}Integration...`,
						detail: hasConnectedIntegration
							? 'Connect additional integrations to view their pull requests in Launchpad'
							: 'Connect an integration to accelerate your PR reviews',
						picked: true,
					},
					true,
				),
			],
			createDirectiveQuickPickItem(Directive.Cancel, false, { label: 'Cancel' }),
			{
				placeholder: hasConnectedIntegration
					? 'Connect additional integrations to Launchpad'
					: 'Connect an integration to get started with Launchpad',
				buttons: [],
				ignoreFocusOut: true,
			},
		);

		// Note: This is a hack to allow the quickpick to stay alive after the user finishes connecting the integration.
		// Otherwise it disappears.
		let freeze!: () => Disposable;
		let quickpick!: QuickPick<any>;
		step.onDidActivate = qp => {
			quickpick = qp;
			freeze = () => freezeStep(step, qp);
		};

		const selection: StepSelection<typeof step> = yield step;

		if (canPickStepContinue(step, state, selection)) {
			const previousPlaceholder = quickpick.placeholder;
			quickpick.placeholder = 'Connecting integrations...';
			quickpick.ignoreFocusOut = true;
			const resume = freeze();
			const connected = await this.container.integrations.connectCloudIntegrations(
				{ integrationIds: supportedLaunchpadIntegrations },
				{
					source: 'launchpad',
				},
			);
			quickpick.placeholder = previousPlaceholder;
			return { connected: connected, resume: () => resume[Symbol.dispose]() };
		}

		return StepResultBreak;
	}

	private getLaunchpadItemInformationRows(
		item: LaunchpadItem,
	): (QuickPickItemOfT<LaunchpadAction> | QuickPickItemOfT<LaunchpadTargetAction> | DirectiveQuickPickItem)[] {
		const information: (
			| QuickPickItemOfT<LaunchpadAction>
			| QuickPickItemOfT<LaunchpadTargetAction>
			| DirectiveQuickPickItem
		)[] = [];
		switch (item.actionableCategory) {
			case 'mergeable':
				information.push(
					createQuickPickSeparator('Status'),
					this.getLaunchpadItemStatusInformation(item),
					...this.getLaunchpadItemReviewInformation(item),
				);
				break;
			case 'failed-checks':
			case 'conflicts':
				information.push(createQuickPickSeparator('Status'), this.getLaunchpadItemStatusInformation(item));
				break;
			case 'unassigned-reviewers':
			case 'needs-my-review':
			case 'changes-requested':
			case 'reviewer-commented':
			case 'waiting-for-review':
				information.push(
					createQuickPickSeparator('Reviewers'),
					...this.getLaunchpadItemReviewInformation(item),
				);
				break;
			default:
				break;
		}

		if (item.codeSuggestions?.value != null && item.codeSuggestions.value.length > 0) {
			if (information.length > 0) {
				information.push(createDirectiveQuickPickItem(Directive.Noop, false, { label: '' }));
			}

			information.push(
				createQuickPickSeparator('Suggestions'),
				...this.getLaunchpadItemCodeSuggestionInformation(item),
			);
		}

		if (information.length > 0) {
			information.push(createDirectiveQuickPickItem(Directive.Noop, false, { label: '' }));
		}

		return information;
	}

	private getLaunchpadItemStatusInformation(item: LaunchpadItem): QuickPickItemOfT<LaunchpadAction> {
		let status: string | undefined;
		const base = item.baseRef?.name != null ? `$(git-branch) ${item.baseRef.name}` : '';
		const ciStatus = item.headCommit?.buildStatuses?.[0].state;
		if (ciStatus === ProviderBuildStatusState.Success) {
			if (item.hasConflicts) {
				status = `$(error) Conflicts with ${base}, but passed CI checks`;
			} else {
				status = `$(pass) No conflicts, and passed CI checks`;
			}
		} else if (ciStatus === ProviderBuildStatusState.Failed) {
			if (item.hasConflicts) {
				status = `$(error) Conflicts with ${base}, and failed CI checks`;
			} else {
				status = `$(error) No conflicts, but failed CI checks`;
			}
		} else if (item.hasConflicts) {
			status = `$(error) Conflicts with ${base}`;
		} else {
			status = `$(pass) No conflicts`;
		}

		const gitProviderWebButtons = getOpenOnGitProviderQuickInputButtons(item.provider.id);
		return createQuickPickItemOfT({ label: status, buttons: [...gitProviderWebButtons] }, 'soft-open');
	}

	private getLaunchpadItemReviewInformation(item: LaunchpadItem): QuickPickItemOfT<LaunchpadAction>[] {
		const gitProviderWebButtons = getOpenOnGitProviderQuickInputButtons(item.provider.id);
		if (item.reviews == null || item.reviews.length === 0) {
			return [
				createQuickPickItemOfT(
					{ label: `$(info) No reviewers have been assigned`, buttons: [...gitProviderWebButtons] },
					'soft-open',
				),
			];
		}

		const reviewInfo: QuickPickItemOfT<LaunchpadAction>[] = [];

		for (const review of item.reviews) {
			const isCurrentUser = review.reviewer.username === item.currentViewer.username;
			let reviewLabel: string | undefined;
			const iconPath = review.reviewer.avatarUrl != null ? Uri.parse(review.reviewer.avatarUrl) : undefined;
			switch (review.state) {
				case ProviderPullRequestReviewState.Approved:
					reviewLabel = `${isCurrentUser ? 'You' : review.reviewer.username} approved these changes`;
					break;
				case ProviderPullRequestReviewState.ChangesRequested:
					reviewLabel = `${isCurrentUser ? 'You' : review.reviewer.username} requested changes`;
					break;
				case ProviderPullRequestReviewState.Commented:
					reviewLabel = `${isCurrentUser ? 'You' : review.reviewer.username} left a comment review`;
					break;
				case ProviderPullRequestReviewState.ReviewRequested:
					reviewLabel = `${
						isCurrentUser ? `You haven't` : `${review.reviewer.username} hasn't`
					} reviewed these changes yet`;
					break;
			}

			if (reviewLabel != null) {
				reviewInfo.push(
					createQuickPickItemOfT(
						{ label: reviewLabel, iconPath: iconPath, buttons: [...gitProviderWebButtons] },
						'soft-open',
					),
				);
			}
		}

		return reviewInfo;
	}

	private getLaunchpadItemCodeSuggestionInformation(
		item: LaunchpadItem,
	): (QuickPickItemOfT<LaunchpadTargetAction> | DirectiveQuickPickItem)[] {
		if (item.codeSuggestions?.value == null || item.codeSuggestions.value.length === 0) {
			return [];
		}

		const codeSuggestionInfo: (QuickPickItemOfT<LaunchpadTargetAction> | DirectiveQuickPickItem)[] = [
			createDirectiveQuickPickItem(Directive.Noop, false, {
				label: `$(gitlens-code-suggestion) ${pluralize('code suggestion', item.codeSuggestions.value.length)}`,
			}),
		];

		for (const suggestion of item.codeSuggestions.value) {
			codeSuggestionInfo.push(
				createQuickPickItemOfT(
					{
						label: `    ${suggestion.author.name} suggested a code change ${fromNow(
							suggestion.createdAt,
						)}: "${suggestion.title}"`,
						iconPath: suggestion.author.avatarUri ?? getAvatarUri(suggestion.author.email),
						buttons: [OpenOnWebQuickInputButton],
					},
					{
						action: 'open-suggestion',
						target: suggestion.id,
					},
				),
			);
		}

		return codeSuggestionInfo;
	}

	private getOpenActionLabel(actionCategory: string) {
		switch (actionCategory) {
			case 'unassigned-reviewers':
				return 'Assign Reviewers';
			case 'failed-checks':
				return 'Resolve Failing Checks';
			case 'conflicts':
				return 'Resolve Conflicts';
			case 'needs-my-review':
				return 'Start Reviewing';
			case 'changes-requested':
			case 'reviewer-commented':
				return 'Respond to Reviewers';
			case 'waiting-for-review':
				return 'Check In with Reviewers';
			case 'draft':
				return 'View draft';
			default:
				return 'Open';
		}
	}

	private sendItemActionTelemetry(
		actionOrTargetAction:
			| LaunchpadAction
			| LaunchpadTargetAction
			| 'pin'
			| 'unpin'
			| 'snooze'
			| 'unsnooze'
			| 'open-suggestion-browser'
			| 'select',
		item: LaunchpadItem,
		group: LaunchpadGroup,
		context: Context,
	) {
		if (!this.container.telemetry.enabled) return;

		let action:
			| LaunchpadAction
			| 'pin'
			| 'unpin'
			| 'snooze'
			| 'unsnooze'
			| 'open-suggestion'
			| 'open-suggestion-browser'
			| 'select'
			| undefined;
		if (typeof actionOrTargetAction !== 'string' && 'action' in actionOrTargetAction) {
			action = actionOrTargetAction.action;
		} else {
			action = actionOrTargetAction;
		}
		if (action == null) return;

		this.container.telemetry.sendEvent(
			action === 'select' ? 'launchpad/steps/details' : 'launchpad/action',
			{
				...context.telemetryContext!,
				action: action,
				'item.id': getLaunchpadItemIdHash(item),
				'item.type': item.type,
				'item.provider': item.provider.id,
				'item.actionableCategory': item.actionableCategory,
				'item.group': group,
				'item.assignees.count': item.assignees?.length ?? undefined,
				'item.createdDate': item.createdDate.getTime(),
				'item.updatedDate': item.updatedDate.getTime(),
				'item.isNew': item.isNew,

				'item.comments.count': item.commentCount ?? undefined,
				'item.upvotes.count': item.upvoteCount ?? undefined,

				'item.pr.codeSuggestionCount': item.codeSuggestionsCount,
				'item.pr.isDraft': item.isDraft,
				'item.pr.mergeableState': item.mergeableState,
				'item.pr.state': item.state,

				'item.pr.changes.additions': item.additions ?? undefined,
				'item.pr.changes.deletions': item.deletions ?? undefined,
				'item.pr.changes.commits': item.commitCount ?? undefined,
				'item.pr.changes.files': item.fileCount ?? undefined,

				'item.pr.failingCI': item.failingCI,
				'item.pr.hasConflicts': item.hasConflicts,

				'item.pr.reviews.count': item.reviews?.length ?? undefined,
				'item.pr.reviews.decision': item.reviewDecision ?? undefined,
				'item.pr.reviews.changeRequestCount': item.changeRequestReviewCount ?? undefined,

				'item.viewer.isAuthor': item.viewer.isAuthor,
				'item.viewer.isAssignee': item.viewer.isAssignee,
				'item.viewer.pinned': item.viewer.pinned,
				'item.viewer.snoozed': item.viewer.snoozed,
				'item.viewer.pr.canMerge': item.viewer.canMerge,
				'item.viewer.pr.isReviewer': item.viewer.isReviewer,
				'item.viewer.pr.shouldAssignReviewer': item.viewer.shouldAssignReviewer,
				'item.viewer.pr.shouldMerge': item.viewer.shouldMerge,
				'item.viewer.pr.shouldReview': item.viewer.shouldReview,
				'item.viewer.pr.waitingOnReviews': item.viewer.waitingOnReviews,
			},
			this.source,
		);
	}

	private sendTitleActionTelemetry(action: TelemetryEvents['launchpad/title/action']['action'], context: Context) {
		if (!this.container.telemetry.enabled) return;

		this.container.telemetry.sendEvent(
			'launchpad/title/action',
			{ ...context.telemetryContext!, action: action },
			this.source,
		);
	}
}

function getOpenOnGitProviderQuickInputButton(integrationId: string): QuickInputButton | undefined {
	switch (integrationId) {
		case HostingIntegrationId.GitLab:
		case SelfHostedIntegrationId.GitLabSelfHosted:
			return OpenOnGitLabQuickInputButton;
		case HostingIntegrationId.GitHub:
		case SelfHostedIntegrationId.GitHubEnterprise:
			return OpenOnGitHubQuickInputButton;
		default:
			return undefined;
	}
}

function getOpenOnGitProviderQuickInputButtons(integrationId: string): QuickInputButton[] {
	const button = getOpenOnGitProviderQuickInputButton(integrationId);
	return button != null ? [button] : [];
}

function getIntegrationTitle(integrationId: string): string {
	switch (integrationId) {
		case HostingIntegrationId.GitLab:
		case SelfHostedIntegrationId.GitLabSelfHosted:
			return 'GitLab';
		case HostingIntegrationId.GitHub:
		case SelfHostedIntegrationId.GitHubEnterprise:
			return 'GitHub';
		default:
			return integrationId;
	}
}

async function updateContextItems(container: Container, context: Context, options?: { force?: boolean }) {
	context.result = await container.launchpad.getCategorizedItems(options);
	if (container.telemetry.enabled) {
		updateTelemetryContext(context);
	}
	context.connectedIntegrations = await container.launchpad.getConnectedIntegrations();
}

function updateTelemetryContext(context: Context) {
	if (context.telemetryContext == null) return;

	let updatedContext: NonNullable<(typeof context)['telemetryContext']>;
	if (context.result.error != null) {
		updatedContext = {
			...context.telemetryContext,
			'items.error': String(context.result.error),
		};
	} else {
		const grouped = countLaunchpadItemGroups(context.result.items);

		updatedContext = {
			...context.telemetryContext,
			'items.count': context.result.items.length,
			'items.timings.prs': context.result.timings?.prs,
			'items.timings.codeSuggestionCounts': context.result.timings?.codeSuggestionCounts,
			'items.timings.enrichedItems': context.result.timings?.enrichedItems,
			'groups.count': grouped.size,
		};

		for (const [group, count] of grouped) {
			updatedContext[`groups.${group}.count`] = count;
			updatedContext[`groups.${group}.collapsed`] = context.collapsed.get(group);
		}
	}

	context.telemetryContext = updatedContext;
}

function isLaunchpadTargetActionQuickPickItem(item: any): item is QuickPickItemOfT<LaunchpadTargetAction> {
	return item?.item?.action != null && item?.item?.target != null;
}

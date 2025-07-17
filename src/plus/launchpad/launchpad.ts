import type { CancellationToken, QuickInputButton, QuickPick, QuickPickItem } from 'vscode';
import { commands, QuickInputButtons, ThemeIcon, Uri } from 'vscode';
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
	QuickCommand,
	StepResultBreak,
} from '../../commands/quickCommand';
import {
	ConnectIntegrationButton,
	FeedbackQuickInputButton,
	LaunchpadSettingsQuickInputButton,
	LearnAboutProQuickInputButton,
	MergeQuickInputButton,
	OpenOnAzureDevOpsQuickInputButton,
	OpenOnBitbucketQuickInputButton,
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
import type { IntegrationIds } from '../../constants.integrations';
import { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '../../constants.integrations';
import type { LaunchpadTelemetryContext, Source, Sources, TelemetryEvents } from '../../constants.telemetry';
import type { Container } from '../../container';
import type { QuickPickItemOfT } from '../../quickpicks/items/common';
import { createQuickPickItemOfT, createQuickPickSeparator } from '../../quickpicks/items/common';
import type { DirectiveQuickPickItem } from '../../quickpicks/items/directive';
import { createDirectiveQuickPickItem, Directive, isDirectiveQuickPickItem } from '../../quickpicks/items/directive';
import { createAsyncDebouncer } from '../../system/-webview/asyncDebouncer';
import { executeCommand } from '../../system/-webview/command';
import { configuration } from '../../system/-webview/configuration';
import { openUrl } from '../../system/-webview/vscode/uris';
import { getScopedCounter } from '../../system/counter';
import { fromNow } from '../../system/date';
import { some } from '../../system/iterable';
import { interpolate, pluralize } from '../../system/string';
import { isWalkthroughSupported } from '../../telemetry/walkthroughStateProvider';
import { ProviderBuildStatusState, ProviderPullRequestReviewState } from '../integrations/providers/models';
import type { LaunchpadCategorizedResult, LaunchpadItem } from './launchpadProvider';
import {
	countLaunchpadItemGroups,
	getLaunchpadItemIdHash,
	groupAndSortLaunchpadItems,
	supportedLaunchpadIntegrations,
} from './launchpadProvider';
import type { LaunchpadAction, LaunchpadGroup, LaunchpadTargetAction } from './models/launchpad';
import { actionGroupMap, launchpadGroupIconMap, launchpadGroupLabelMap, launchpadGroups } from './models/launchpad';

export interface LaunchpadItemQuickPickItem extends QuickPickItem {
	readonly type: 'item';
	readonly item: LaunchpadItem;
	readonly group: LaunchpadGroup;

	searchModeEnabled?: never;
}

interface ConnectMoreIntegrationsQuickPickItem extends QuickPickItem {
	readonly type: 'integrations';
	readonly item?: never;
	readonly group?: never;

	searchModeEnabled?: never;
}

interface ToggleSearchModeQuickPickItem extends QuickPickItem {
	readonly type: 'searchMode';
	readonly item?: never;
	readonly group?: never;

	searchMode: boolean;
}

type LaunchpadQuickPickItem =
	| LaunchpadItemQuickPickItem
	| ConnectMoreIntegrationsQuickPickItem
	| ToggleSearchModeQuickPickItem
	| DirectiveQuickPickItem;

function isConnectMoreIntegrationsItem(item: LaunchpadQuickPickItem): item is ConnectMoreIntegrationsQuickPickItem {
	return !isDirectiveQuickPickItem(item) && item?.type === 'integrations';
}

// function isLaunchpadItem(item: LaunchpadQuickPickItem): item is LaunchpadItemQuickPickItem {
// 	return !isDirectiveQuickPickItem(item) && item?.type === 'item';
// }

function isToggleSearchModeItem(item: LaunchpadQuickPickItem): item is ToggleSearchModeQuickPickItem {
	return !isDirectiveQuickPickItem(item) && item?.type === 'searchMode';
}

const connectMoreIntegrationsItem: ConnectMoreIntegrationsQuickPickItem = {
	type: 'integrations',
	label: 'Connect an Additional Integration...',
	detail: 'Connect additional integrations to view their pull requests in Launchpad',
};

interface Context {
	result: LaunchpadCategorizedResult;
	searchResult: LaunchpadCategorizedResult | undefined;

	title: string;
	collapsed: Map<LaunchpadGroup, boolean>;
	telemetryContext: LaunchpadTelemetryContext | undefined;
	connectedIntegrations: Map<IntegrationIds, boolean>;

	inSearch: boolean | 'mode';
	updateItemsDebouncer: ReturnType<typeof createAsyncDebouncer>;
}

interface GroupedLaunchpadItem extends LaunchpadItem {
	readonly group: LaunchpadGroup;
}

interface State {
	id?: { uuid: string; group: LaunchpadGroup };
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
	private savedSearch: string | undefined;

	constructor(container: Container, args?: LaunchpadCommandArgs) {
		super(container, 'launchpad', 'launchpad', `GitLens Launchpad\u00a0\u00a0${proBadge}`, {
			description: 'focus on a pull request',
		});

		if (
			args?.source === 'launchpad-indicator' &&
			container.storage.get('launchpad:indicator:hasInteracted') == null
		) {
			void container.storage.store('launchpad:indicator:hasInteracted', new Date().toISOString()).catch();
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

	private async ensureIntegrationConnected(id: IntegrationIds) {
		const integration = await this.container.integrations.get(id);
		if (integration == null) return false;

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

		using updateItemsDebouncer = createAsyncDebouncer(500);

		const context: Context = {
			result: { items: [] },
			searchResult: undefined,
			title: this.title,
			collapsed: collapsed,
			telemetryContext: this.telemetryContext,
			connectedIntegrations: await this.container.launchpad.getConnectedIntegrations(),
			inSearch: false,
			updateItemsDebouncer: updateItemsDebouncer,
		};

		const toggleSearchMode = (enabled: boolean) => {
			context.inSearch = enabled ? 'mode' : false;
			context.searchResult = undefined;
			context.updateItemsDebouncer.cancel();
			state.item = undefined;
		};

		let opened = false;

		while (this.canStepsContinue(state)) {
			context.title = this.title;
			context.updateItemsDebouncer.cancel();

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

			const result = yield* ensureAccessStep(this.container, state, context, 'launchpad');
			if (result === StepResultBreak) continue;

			await updateContextItems(this.container, context, { force: newlyConnected });

			if (state.counter < 1 || state.item == null) {
				if (state.id != null) {
					const item = context.result.items?.find(item => item.uuid === state.id?.uuid);
					if (item != null) {
						state.item = { ...item, group: state.id.group };
						if (state.counter < 1) {
							state.counter = 1;
						}
						continue;
					}
				}

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
					picked: state.item?.graphQLId ?? state.item?.uuid,
					selectTopItem: state.selectTopItem,
				});
				if (result === StepResultBreak) {
					toggleSearchMode(false);
					continue;
				}

				if (isConnectMoreIntegrationsItem(result)) {
					toggleSearchMode(false);

					const isUsingCloudIntegrations = configuration.get('cloudIntegrations.enabled', undefined, false);
					const result = isUsingCloudIntegrations
						? yield* this.confirmCloudIntegrationsConnectStep(state, context)
						: yield* this.confirmLocalIntegrationConnectStep(state, context);
					if (result === StepResultBreak) continue;

					result.resume();

					const connected = result.connected;
					newlyConnected = Boolean(connected);
					await updateContextItems(this.container, context, { force: newlyConnected });

					state.counter--;
					continue;
				}

				if (isToggleSearchModeItem(result)) {
					toggleSearchMode(result.searchMode);

					state.counter--;
					continue;
				}

				state.item = { ...result.item, group: result.group };
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
						void this.container.launchpad.switchTo(state.item, { openInWorktree: true });
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
	): StepResultGenerator<
		LaunchpadItemQuickPickItem | ConnectMoreIntegrationsQuickPickItem | ToggleSearchModeQuickPickItem
	> {
		const hasDisconnectedIntegrations = [...context.connectedIntegrations.values()].some(c => !c);

		const buildGroupHeading = (
			ui: LaunchpadGroup,
			groupLength: number,
		): [DirectiveQuickPickItem, DirectiveQuickPickItem] => {
			return [
				createQuickPickSeparator(groupLength ? groupLength.toString() : undefined),
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
			];
		};

		const buildLaunchpadQuickPickItem = (
			i: LaunchpadItem,
			ui: LaunchpadGroup,
			topItem: LaunchpadItem | undefined,
			alwaysShow: boolean | undefined,
		): LaunchpadItemQuickPickItem => {
			const buttons = [];

			if (i.actionableCategory === 'mergeable') {
				buttons.push(MergeQuickInputButton);
			}

			if (!i.isSearched) {
				buttons.push(
					i.viewer.pinned ? UnpinQuickInputButton : PinQuickInputButton,
					i.viewer.snoozed ? UnsnoozeQuickInputButton : SnoozeQuickInputButton,
				);
			}

			buttons.push(...getOpenOnGitProviderQuickInputButtons(i.provider.id));

			if (!i.openRepository?.localBranch?.current) {
				buttons.push(OpenWorktreeInNewWindowQuickInputButton);
			}

			return {
				type: 'item',
				label: i.title.length > 60 ? `${i.title.substring(0, 60)}...` : i.title,
				// description: `${i.repoAndOwner}#${i.id}, by @${i.author}`,
				description: `\u00a0 ${i.repository.owner.login}/${i.repository.name}#${i.id} \u00a0 ${
					i.codeSuggestionsCount > 0 ? ` $(gitlens-code-suggestion) ${i.codeSuggestionsCount}` : ''
				} \u00a0 ${i.isNew ? '(New since last view)' : ''}`,
				detail: `      ${i.viewer.pinned ? '$(pinned) ' : ''}${
					i.isDraft && ui !== 'draft' ? '$(git-pull-request-draft) ' : ''
				}${
					i.actionableCategory === 'other' ? '' : `${actionGroupMap.get(i.actionableCategory)![0]} \u2022  `
				}${fromNow(i.updatedDate)} by @${i.author!.username}`,

				alwaysShow: alwaysShow,
				buttons: buttons,
				iconPath:
					i.provider.id === GitCloudHostIntegrationId.AzureDevOps
						? new ThemeIcon('account')
						: i.author?.avatarUrl != null
							? Uri.parse(i.author.avatarUrl)
							: new ThemeIcon('account'),
				item: i,
				picked:
					i.graphQLId != null
						? i.graphQLId === picked || i.graphQLId === topItem?.graphQLId
						: i.uuid != null
							? i.uuid === picked || i.uuid === topItem?.uuid
							: false,
				group: ui,
			};
		};

		const getLaunchpadQuickPickItems = (items: LaunchpadItem[] = [], isFiltering?: boolean) => {
			const groupedAndSorted: (
				| LaunchpadItemQuickPickItem
				| DirectiveQuickPickItem
				| ConnectMoreIntegrationsQuickPickItem
				| ToggleSearchModeQuickPickItem
			)[] = [];

			if (items.length) {
				const uiGroups = groupAndSortLaunchpadItems(items);
				const topItem: LaunchpadItem | undefined =
					!selectTopItem || picked != null
						? undefined
						: uiGroups.get('mergeable')?.[0] ||
							uiGroups.get('blocked')?.[0] ||
							uiGroups.get('follow-up')?.[0] ||
							uiGroups.get('needs-review')?.[0];
				for (let [ui, groupItems] of uiGroups) {
					if (context.inSearch) {
						groupItems = groupItems.filter(i => i.isSearched);
					}

					if (!groupItems.length) continue;

					if (!isFiltering) {
						groupedAndSorted.push(...buildGroupHeading(ui, groupItems.length));
						if (context.collapsed.get(ui)) {
							continue;
						}
					}

					groupedAndSorted.push(
						...groupItems.map(i => buildLaunchpadQuickPickItem(i, ui, topItem, Boolean(context.inSearch))),
					);
				}
			}

			return groupedAndSorted;
		};

		function getItemsAndQuickpickProps(isFiltering?: boolean) {
			const result = context.inSearch ? context.searchResult : context.result;

			if (result?.error != null) {
				return {
					title: `${context.title} \u00a0\u2022\u00a0 Unable to Load Items`,
					placeholder: `Unable to load items (${
						result.error.name === 'HttpError' &&
						'status' in result.error &&
						typeof result.error.status === 'number'
							? `${result.error.status}: ${String(result.error)}`
							: String(result.error)
					})`,
					items: [createDirectiveQuickPickItem(Directive.Cancel, undefined, { label: 'OK' })],
				};
			}

			if (!result?.items.length) {
				if (context.inSearch === 'mode') {
					return {
						title: `Search For Pull Request \u00a0\u2022\u00a0 ${context.title}`,
						placeholder: 'Enter a term to search for a pull request to act on',
						items: [
							{
								type: 'searchMode',
								searchMode: false,
								label: 'Cancel Searching',
								detail: isFiltering ? 'No pull requests found' : 'Go back to Launchpad',
								alwaysShow: true,
								picked: true,
							} satisfies ToggleSearchModeQuickPickItem,
						],
					};
				}

				return {
					title: context.title,
					placeholder: 'All done! Take a vacation',
					items: [
						{
							type: 'searchMode',
							searchMode: true,
							label: 'Search for Pull Request...',
							alwaysShow: true,
							picked: true,
						} satisfies ToggleSearchModeQuickPickItem,
					],
				};
			}

			const items = getLaunchpadQuickPickItems(result.items, isFiltering);
			const hasPicked = items.some(i => i.picked);
			if (context.inSearch === 'mode') {
				const offItem: ToggleSearchModeQuickPickItem = {
					type: 'searchMode',
					searchMode: false,
					label: 'Cancel Searching',
					detail: 'Go back to Launchpad',
					alwaysShow: true,
					picked: !isFiltering && !hasPicked,
				};

				return {
					title: `Search For Pull Request \u00a0\u2022\u00a0 ${context.title}`,
					placeholder: 'Enter a term to search for a pull request to act on',
					items: isFiltering ? [...items, offItem] : [offItem, ...items],
				};
			}

			const onItem: ToggleSearchModeQuickPickItem = {
				type: 'searchMode',
				searchMode: true,
				label: 'Search for Pull Request...',
				alwaysShow: true,
				picked: !isFiltering && !hasPicked,
			};

			return {
				title: context.title,
				placeholder: 'Choose a pull request or paste a pull request URL to act on',
				items: isFiltering
					? [...items, onItem]
					: [onItem, ...getLaunchpadQuickPickItems(result.items, isFiltering)],
			};
		}

		const updateItems = async (
			quickpick: QuickPick<
				| LaunchpadItemQuickPickItem
				| DirectiveQuickPickItem
				| ConnectMoreIntegrationsQuickPickItem
				| ToggleSearchModeQuickPickItem
			>,
			options?: { force?: boolean; immediate?: boolean },
		) => {
			const search = context.inSearch ? quickpick.value : undefined;
			quickpick.busy = true;
			try {
				const update = async (cancellationToken: CancellationToken | undefined) => {
					if (context.inSearch === 'mode') {
						quickpick.items = [
							{
								type: 'searchMode',
								searchMode: false,
								label: `Searching for "${quickpick.value}"...`,
								detail: 'Click to cancel searching',
								alwaysShow: true,
								picked: true,
							} satisfies ToggleSearchModeQuickPickItem,
						];
					}

					await updateContextItems(
						this.container,
						context,
						{ force: options?.force, search: search },
						cancellationToken,
					);

					if (cancellationToken?.isCancellationRequested) return;

					const { items, placeholder, title } = getItemsAndQuickpickProps(Boolean(search));
					quickpick.title = title;
					quickpick.placeholder = placeholder;
					quickpick.items = items;
				};

				if (options?.immediate) {
					context.updateItemsDebouncer.cancel();
					await update(undefined);
				} else {
					await context.updateItemsDebouncer(update);
				}
			} finally {
				quickpick.busy = false;
			}
		};

		// Should only be used for optimistic update of the list when some UI property (like pinned, snoozed) changed with an
		// item. For all other cases, use updateItems.
		const optimisticallyUpdateItems = (
			quickpick: QuickPick<
				| LaunchpadItemQuickPickItem
				| DirectiveQuickPickItem
				| ConnectMoreIntegrationsQuickPickItem
				| ToggleSearchModeQuickPickItem
			>,
		) => {
			const { items, placeholder, title } = getItemsAndQuickpickProps(Boolean(quickpick.value));
			quickpick.title = title;
			quickpick.placeholder = placeholder;
			quickpick.items = items;
		};

		const { items, placeholder, title } = getItemsAndQuickpickProps();

		const inSearchMode = context.inSearch === 'mode';
		const step = createPickStep({
			title: title,
			placeholder: placeholder,
			matchOnDescription: !inSearchMode,
			matchOnDetail: !inSearchMode,
			items: items,
			buttons: [
				...(inSearchMode ? [QuickInputButtons.Back] : []),
				// FeedbackQuickInputButton,
				OpenOnWebQuickInputButton,
				...(hasDisconnectedIntegrations ? [ConnectIntegrationButton] : []),
				LaunchpadSettingsQuickInputButton,
				RefreshQuickInputButton,
			],
			// Used to persist the search value when switching between non-search and search mode
			onDidActivate: quickpick => {
				if (!this.savedSearch?.length) return;

				if (context.inSearch === 'mode') {
					quickpick.value = this.savedSearch;
				}

				this.savedSearch = undefined;
			},
			onDidChangeValue: async quickpick => {
				const { value } = quickpick;
				this.savedSearch = value;

				// Nothing to search
				if (!value?.length) {
					context.updateItemsDebouncer.cancel();

					context.searchResult = undefined;
					if (context.inSearch === true) {
						context.inSearch = false;
					}

					// Restore category/divider items
					const { items, placeholder, title } = getItemsAndQuickpickProps();
					quickpick.title = title;
					quickpick.placeholder = placeholder;
					quickpick.items = items;

					return true;
				}

				// In API search mode, search the API and update the quickpick
				if (context.inSearch || this.container.launchpad.isMaybeSupportedLaunchpadPullRequestSearchUrl(value)) {
					let immediate = false;
					if (!context.inSearch) {
						immediate = value.length >= 3;

						// Hide the category/divider items quickly
						const { items } = getItemsAndQuickpickProps(true);
						quickpick.items = items;

						context.inSearch = true;
					}

					await updateItems(quickpick, { force: true, immediate: immediate });
				} else {
					// Out of API search mode
					context.updateItemsDebouncer.cancel();

					// Hide the category/divider items quickly
					const { items } = getItemsAndQuickpickProps(true);
					quickpick.title = title;
					quickpick.placeholder = placeholder;
					quickpick.items = items;
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
						await updateItems(quickpick, { force: true, immediate: true });
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
					case OpenOnAzureDevOpsQuickInputButton:
					case OpenOnBitbucketQuickInputButton:
						this.sendItemActionTelemetry('soft-open', item, group, context);
						this.container.launchpad.open(item);
						break;

					case SnoozeQuickInputButton: {
						this.sendItemActionTelemetry('snooze', item, group, context);

						// Update optimistically
						const contextItem = context.result.items?.find(i => i.uuid === item.uuid);
						if (contextItem != null) {
							contextItem.viewer.snoozed = true;
							optimisticallyUpdateItems(quickpick);
						}

						await this.container.launchpad.snooze(item);
						break;
					}
					case UnsnoozeQuickInputButton: {
						this.sendItemActionTelemetry('unsnooze', item, group, context);

						// Update optimistically
						const contextItem = context.result.items?.find(i => i.uuid === item.uuid);
						if (contextItem != null) {
							contextItem.viewer.snoozed = false;
							optimisticallyUpdateItems(quickpick);
						}

						await this.container.launchpad.unsnooze(item);
						break;
					}
					case PinQuickInputButton: {
						this.sendItemActionTelemetry('pin', item, group, context);

						// Update optimistically
						const contextItem = context.result.items?.find(i => i.uuid === item.uuid);
						if (contextItem != null) {
							contextItem.viewer.pinned = true;
							optimisticallyUpdateItems(quickpick);
						}

						await this.container.launchpad.pin(item);
						break;
					}
					case UnpinQuickInputButton: {
						this.sendItemActionTelemetry('unpin', item, group, context);

						// Update optimistically
						const contextItem = context.result.items?.find(i => i.uuid === item.uuid);
						if (contextItem != null) {
							contextItem.viewer.pinned = false;
							optimisticallyUpdateItems(quickpick);
						}

						await this.container.launchpad.unpin(item);
						break;
					}
					case MergeQuickInputButton:
						this.sendItemActionTelemetry('merge', item, group, context);
						await this.container.launchpad.merge(item);
						break;

					case OpenWorktreeInNewWindowQuickInputButton:
						this.sendItemActionTelemetry('open-worktree', item, group, context);
						await this.container.launchpad.switchTo(item, { openInWorktree: true });
						break;
				}

				await updateItems(quickpick);
			},
		});

		const selection: StepSelection<typeof step> = yield step;
		if (!canPickStepContinue(step, state, selection)) return StepResultBreak;

		return selection[0];
	}

	private *confirmStep(
		state: LaunchpadStepState,
		context: Context,
	): StepResultGenerator<LaunchpadAction | LaunchpadTargetAction> {
		const gitProviderWebButtons = getOpenOnGitProviderQuickInputButtons(state.item.provider.id);

		function getConfirmations(): (
			| QuickPickItemOfT<LaunchpadAction>
			| QuickPickItemOfT<LaunchpadTargetAction>
			| DirectiveQuickPickItem
		)[] {
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
						iconPath:
							state.item.provider.id === GitCloudHostIntegrationId.AzureDevOps
								? new ThemeIcon('account')
								: state.item.author?.avatarUrl != null
									? Uri.parse(state.item.author.avatarUrl)
									: undefined,
						buttons: [
							...gitProviderWebButtons,
							...(state.item.isSearched
								? []
								: [
										state.item.viewer.pinned ? UnpinQuickInputButton : PinQuickInputButton,
										state.item.viewer.snoozed ? UnsnoozeQuickInputButton : SnoozeQuickInputButton,
									]),
						],
					},
					'soft-open',
				),
				createDirectiveQuickPickItem(Directive.Noop, false, { label: '' }),
				...getLaunchpadItemInformationRows(state.item),
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
									label: `${getOpenActionLabel(
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
									label: 'Switch to Branch',
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

			return confirmations;
		}

		const step = this.createConfirmStep(
			`Launchpad \u00a0\u2022\u00a0 Pull Request ${state.item.repository.owner.login}/${state.item.repository.name}#${state.item.id}`,
			getConfirmations(),
			undefined,
			{
				placeholder: 'Choose an action to perform',
				onDidClickItemButton: async (quickpick, button, item): Promise<void> => {
					switch (button) {
						case OpenOnGitHubQuickInputButton:
						case OpenOnGitLabQuickInputButton:
						case OpenOnAzureDevOpsQuickInputButton:
						case OpenOnBitbucketQuickInputButton:
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
						case PinQuickInputButton:
							this.sendItemActionTelemetry('pin', state.item, state.item.group, context);
							quickpick.busy = true;
							await this.container.launchpad.pin(state.item);
							quickpick.items = [
								...getConfirmations(),
								createQuickPickSeparator(),
								createDirectiveQuickPickItem(Directive.Cancel),
							];
							quickpick.busy = false;
							break;
						case UnpinQuickInputButton:
							this.sendItemActionTelemetry('unpin', state.item, state.item.group, context);
							quickpick.busy = true;
							await this.container.launchpad.unpin(state.item);
							quickpick.items = [
								...getConfirmations(),
								createQuickPickSeparator(),
								createDirectiveQuickPickItem(Directive.Cancel),
							];
							quickpick.busy = false;
							break;
						case SnoozeQuickInputButton:
							this.sendItemActionTelemetry('snooze', state.item, state.item.group, context);
							quickpick.busy = true;
							void this.container.launchpad.snooze(state.item);
							quickpick.items = [
								...getConfirmations(),
								createQuickPickSeparator(),
								createDirectiveQuickPickItem(Directive.Cancel),
							];
							quickpick.busy = false;
							break;
						case UnsnoozeQuickInputButton:
							this.sendItemActionTelemetry('unsnooze', state.item, state.item.group, context);
							void this.container.launchpad.unsnooze(state.item);
							quickpick.items = [
								...getConfirmations(),
								createQuickPickSeparator(),
								createDirectiveQuickPickItem(Directive.Cancel),
							];
							quickpick.busy = false;
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
	): AsyncStepResultGenerator<{ connected: boolean | IntegrationIds; resume: () => void | undefined }> {
		const hasConnectedIntegration = some(context.connectedIntegrations.values(), c => c);
		const confirmations: (QuickPickItemOfT<IntegrationIds> | DirectiveQuickPickItem)[] =
			!hasConnectedIntegration && isWalkthroughSupported()
				? [
						createDirectiveQuickPickItem(Directive.Cancel, undefined, {
							label: 'Launchpad prioritizes your pull requests to keep you focused and your team unblocked',
							detail: 'Click to learn more about Launchpad',
							iconPath: new ThemeIcon('rocket'),
							onDidSelect: () =>
								void executeCommand<OpenWalkthroughCommandArgs>('gitlens.openWalkthrough', {
									step: 'accelerate-pr-reviews',
									source: { source: 'launchpad', detail: 'info' },
								}),
						}),
						createQuickPickSeparator(),
					]
				: [];

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
								detail: 'Will connect to GitHub to provide access your pull requests and issues',
							},
							integration,
						),
					);
					break;
				case GitCloudHostIntegrationId.GitLab:
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
		state: StepState<State>,
		context: Context,
	): AsyncStepResultGenerator<{ connected: boolean | IntegrationIds; resume: () => void | undefined }> {
		const hasConnectedIntegration = some(context.connectedIntegrations.values(), c => c);
		const step = this.createConfirmStep(
			`${this.title} \u00a0\u2022\u00a0 Connect an ${hasConnectedIntegration ? 'Additional ' : ''}Integration`,
			[
				...(hasConnectedIntegration || !isWalkthroughSupported()
					? []
					: [
							createDirectiveQuickPickItem(Directive.Cancel, undefined, {
								label: 'Launchpad prioritizes your pull requests to keep you focused and your team unblocked',
								detail: 'Click to learn more about Launchpad',
								iconPath: new ThemeIcon('rocket'),
								onDidSelect: () =>
									void executeCommand<OpenWalkthroughCommandArgs>('gitlens.openWalkthrough', {
										step: 'accelerate-pr-reviews',
										source: { source: 'launchpad', detail: 'info' },
									}),
							}),
							createQuickPickSeparator(),
						]),
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

		const selection: StepSelection<typeof step> = yield step;

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
					source: 'launchpad',
				},
			);
			if (step.quickpick) {
				step.quickpick.placeholder = previousPlaceholder;
			}
			return { connected: connected, resume: () => resume?.dispose() };
		}

		return StepResultBreak;
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

function getLaunchpadItemInformationRows(
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
				getLaunchpadItemStatusInformation(item),
				...getLaunchpadItemReviewInformation(item),
			);
			break;
		case 'failed-checks':
		case 'conflicts':
			information.push(createQuickPickSeparator('Status'), getLaunchpadItemStatusInformation(item));
			break;
		case 'unassigned-reviewers':
		case 'needs-my-review':
		case 'changes-requested':
		case 'reviewer-commented':
		case 'waiting-for-review':
			information.push(createQuickPickSeparator('Reviewers'), ...getLaunchpadItemReviewInformation(item));
			break;
		default:
			break;
	}

	if (item.codeSuggestions?.value != null && item.codeSuggestions.value.length > 0) {
		if (information.length > 0) {
			information.push(createDirectiveQuickPickItem(Directive.Noop, false, { label: '' }));
		}

		information.push(createQuickPickSeparator('Suggestions'), ...getLaunchpadItemCodeSuggestionInformation(item));
	}

	if (information.length > 0) {
		information.push(createDirectiveQuickPickItem(Directive.Noop, false, { label: '' }));
	}

	return information;
}

function getLaunchpadItemStatusInformation(item: LaunchpadItem): QuickPickItemOfT<LaunchpadAction> {
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

function getLaunchpadItemReviewInformation(item: LaunchpadItem): QuickPickItemOfT<LaunchpadAction>[] {
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
		const iconPath =
			item.provider.id === GitCloudHostIntegrationId.AzureDevOps
				? new ThemeIcon('account')
				: review.reviewer.avatarUrl != null
					? Uri.parse(review.reviewer.avatarUrl)
					: new ThemeIcon('account');
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

function getLaunchpadItemCodeSuggestionInformation(
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
					label: `    ${suggestion.author.name} suggested a code change ${fromNow(suggestion.createdAt)}: "${
						suggestion.title
					}"`,
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

function getOpenActionLabel(actionCategory: string) {
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

function getOpenOnGitProviderQuickInputButton(integrationId: string): QuickInputButton | undefined {
	switch (integrationId) {
		case GitCloudHostIntegrationId.GitLab:
		case GitSelfManagedHostIntegrationId.GitLabSelfHosted:
		case GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted:
			return OpenOnGitLabQuickInputButton;
		case GitCloudHostIntegrationId.GitHub:
		case GitSelfManagedHostIntegrationId.GitHubEnterprise:
		case GitSelfManagedHostIntegrationId.CloudGitHubEnterprise:
			return OpenOnGitHubQuickInputButton;
		case GitCloudHostIntegrationId.AzureDevOps:
		case GitSelfManagedHostIntegrationId.AzureDevOpsServer:
			return OpenOnAzureDevOpsQuickInputButton;
		case GitCloudHostIntegrationId.Bitbucket:
		case GitSelfManagedHostIntegrationId.BitbucketServer:
			return OpenOnBitbucketQuickInputButton;
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
		case GitCloudHostIntegrationId.GitLab:
		case GitSelfManagedHostIntegrationId.GitLabSelfHosted:
		case GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted:
			return 'GitLab';
		case GitCloudHostIntegrationId.GitHub:
		case GitSelfManagedHostIntegrationId.GitHubEnterprise:
		case GitSelfManagedHostIntegrationId.CloudGitHubEnterprise:
			return 'GitHub';
		case GitCloudHostIntegrationId.AzureDevOps:
			return 'Azure DevOps';
		case GitSelfManagedHostIntegrationId.AzureDevOpsServer:
			return 'Azure DevOps Server';
		case GitCloudHostIntegrationId.Bitbucket:
			return 'Bitbucket';
		case GitSelfManagedHostIntegrationId.BitbucketServer:
			return 'Bitbucket Data Center';
		default:
			return integrationId;
	}
}

async function updateContextItems(
	container: Container,
	context: Context,
	options?: { force?: boolean; search?: string },
	cancellation?: CancellationToken,
) {
	const result = await container.launchpad.getCategorizedItems(options, cancellation);
	if (context.inSearch) {
		context.searchResult = result;
	} else {
		context.result = result;
		if (container.telemetry.enabled) {
			updateTelemetryContext(context);
		}
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

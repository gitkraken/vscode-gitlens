import type { QuickPick } from 'vscode';
import { commands, Uri } from 'vscode';
import { getAvatarUri } from '../../avatars';
import type {
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
	FeedbackQuickInputButton,
	LaunchpadSettingsQuickInputButton,
	MergeQuickInputButton,
	OpenOnGitHubQuickInputButton,
	OpenOnWebQuickInputButton,
	OpenWorktreeInNewWindowQuickInputButton,
	PinQuickInputButton,
	RefreshQuickInputButton,
	SnoozeQuickInputButton,
	UnpinQuickInputButton,
	UnsnoozeQuickInputButton,
} from '../../commands/quickCommand.buttons';
import type { LaunchpadTelemetryContext, Source, Sources, TelemetryEvents } from '../../constants';
import { previewBadge } from '../../constants';
import type { Container } from '../../container';
import type { QuickPickItemOfT } from '../../quickpicks/items/common';
import { createQuickPickItemOfT, createQuickPickSeparator } from '../../quickpicks/items/common';
import type { DirectiveQuickPickItem } from '../../quickpicks/items/directive';
import { createDirectiveQuickPickItem, Directive } from '../../quickpicks/items/directive';
import { getScopedCounter } from '../../system/counter';
import { fromNow } from '../../system/date';
import { interpolate, pluralize } from '../../system/string';
import { openUrl } from '../../system/utils';
import { isSupportedCloudIntegrationId } from '../integrations/authentication/models';
import type { IntegrationId } from '../integrations/providers/models';
import {
	HostingIntegrationId,
	ProviderBuildStatusState,
	ProviderPullRequestReviewState,
} from '../integrations/providers/models';
import type {
	FocusAction,
	FocusActionCategory,
	FocusCategorizedResult,
	FocusGroup,
	FocusItem,
	FocusTargetAction,
} from './focusProvider';
import {
	countFocusItemGroups,
	focusGroupIconMap,
	focusGroupLabelMap,
	focusGroups,
	getFocusItemIdHash,
	groupAndSortFocusItems,
	supportedFocusIntegrations,
} from './focusProvider';

const actionGroupMap = new Map<FocusActionCategory, string[]>([
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

export interface FocusItemQuickPickItem extends QuickPickItemOfT<FocusItem> {
	group: FocusGroup;
}

interface Context {
	result: FocusCategorizedResult;

	title: string;
	collapsed: Map<FocusGroup, boolean>;
	telemetryContext: LaunchpadTelemetryContext | undefined;
}

interface GroupedFocusItem extends FocusItem {
	group: FocusGroup;
}

interface State {
	item?: GroupedFocusItem;
	action?: FocusAction | FocusTargetAction;
	initialGroup?: FocusGroup;
	selectTopItem?: boolean;
}

export interface FocusCommandArgs {
	readonly command: 'focus';
	confirm?: boolean;
	source?: Sources;
	state?: Partial<State>;
}

type FocusStepState<T extends State = State> = RequireSome<StepState<T>, 'item'>;

function assertsFocusStepState(state: StepState<State>): asserts state is FocusStepState {
	if (state.item != null) return;

	debugger;
	throw new Error('Missing item');
}

const instanceCounter = getScopedCounter();

const defaultCollapsedGroups: FocusGroup[] = ['draft', 'other', 'snoozed'];

export class FocusCommand extends QuickCommand<State> {
	private readonly source: Source;
	private readonly telemetryContext: LaunchpadTelemetryContext | undefined;

	constructor(container: Container, args?: FocusCommandArgs) {
		super(container, 'focus', 'focus', `GitLens Launchpad\u00a0\u00a0${previewBadge}`, {
			description: 'focus on a pull request or issue',
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

		const counter = 0;

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
			if (isSupportedCloudIntegrationId(integration.id)) {
				await this.container.integrations.manageCloudIntegrations(
					{ integrationId: integration.id },
					{
						source: 'launchpad',
						detail: {
							action: 'connect',
							integration: integration.id,
						},
					},
				);
			}
			connected = await integration.connect();
		}

		return connected;
	}

	protected async *steps(state: PartialStepState<State>): StepGenerator {
		if (this.container.git.isDiscoveringRepositories) {
			await this.container.git.isDiscoveringRepositories;
		}

		let storedCollapsed = this.container.storage.get('launchpad:groups:collapsed') satisfies
			| FocusGroup[]
			| undefined;
		if (storedCollapsed == null) {
			storedCollapsed = defaultCollapsedGroups;
		}

		const collapsed = new Map<FocusGroup, boolean>(storedCollapsed.map(g => [g, true]));
		if (state.initialGroup != null) {
			// set all to true except the initial group
			for (const group of focusGroups) {
				collapsed.set(group, group !== state.initialGroup);
			}
		}

		const context: Context = {
			result: { items: [] },
			title: this.title,
			collapsed: collapsed,
			telemetryContext: this.telemetryContext,
		};

		let opened = false;

		while (this.canStepsContinue(state)) {
			context.title = this.title;

			if (state.counter < 1 && !(await this.container.focus.hasConnectedIntegration())) {
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

				const result = yield* this.confirmIntegrationConnectStep(state, context);
				if (result !== StepResultBreak && !(await this.ensureIntegrationConnected(result))) {
					let integration;
					switch (result) {
						case HostingIntegrationId.GitHub:
							integration = 'GitHub';
							break;
						default:
							integration = `integration (${result})`;
							break;
					}
					throw new Error(`Unable to connect to ${integration}`);
				}
			}

			await updateContextItems(this.container, context);

			if (state.counter < 2 || state.item == null) {
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

				const result = yield* this.pickFocusItemStep(state, context, {
					picked: state.item?.id,
					selectTopItem: state.selectTopItem,
				});
				if (result === StepResultBreak) continue;

				state.item = result;
			}

			assertsFocusStepState(state);

			if (this.confirm(state.confirm)) {
				this.sendItemActionTelemetry('select', state.item, state.item.group, context);
				await this.container.focus.ensureFocusItemCodeSuggestions(state.item);

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
						void this.container.focus.merge(state.item);
						break;
					case 'open':
						this.container.focus.open(state.item);
						break;
					case 'soft-open':
						this.container.focus.open(state.item);
						state.counter = 2;
						continue;
					case 'switch':
					case 'show-overview':
						void this.container.focus.switchTo(state.item);
						break;
					case 'open-worktree':
						void this.container.focus.switchTo(state.item, { skipWorktreeConfirmations: true });
						break;
					case 'switch-and-code-suggest':
					case 'code-suggest':
						void this.container.focus.switchTo(state.item, { startCodeSuggestion: true });
						break;
					case 'open-changes':
						void this.container.focus.openChanges(state.item);
						break;
					case 'open-in-graph':
						void this.container.focus.openInGraph(state.item);
						break;
				}
			} else {
				switch (state.action?.action) {
					case 'open-suggestion': {
						this.container.focus.openCodeSuggestion(state.item, state.action.target);
						break;
					}
				}
			}

			endSteps(state);
		}

		return state.counter < 0 ? StepResultBreak : undefined;
	}

	private *pickFocusItemStep(
		state: StepState<State>,
		context: Context,
		{ picked, selectTopItem }: { picked?: string; selectTopItem?: boolean },
	): StepResultGenerator<GroupedFocusItem> {
		const getItems = (result: FocusCategorizedResult) => {
			const items: (FocusItemQuickPickItem | DirectiveQuickPickItem)[] = [];

			if (result.items?.length) {
				const uiGroups = groupAndSortFocusItems(result.items);
				const topItem: FocusItem | undefined =
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
							})\u00a0\u00a0${focusGroupIconMap.get(ui)!}\u00a0\u00a0${focusGroupLabelMap
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

							if (!i.openRepository?.localBranch?.current) {
								buttons.push(OpenWorktreeInNewWindowQuickInputButton);
							}

							buttons.push(OpenOnGitHubQuickInputButton);

							return {
								label: i.title.length > 60 ? `${i.title.substring(0, 60)}...` : i.title,
								// description: `${i.repoAndOwner}#${i.id}, by @${i.author}`,
								description: `\u00a0 ${i.repository.owner.login}/${i.repository.name}#${i.id} \u00a0 ${
									i.codeSuggestionsCount > 0
										? ` $(gitlens-code-suggestion) ${i.codeSuggestionsCount}`
										: ''
								} \u00a0 ${i.isNew ? '(New since last view)' : ''}`,
								detail: `      ${
									i.actionableCategory === 'other'
										? ''
										: `${actionGroupMap.get(i.actionableCategory)![0]} \u2022  `
								}${fromNow(i.updatedDate)} by @${i.author!.username}`,

								buttons: buttons,
								iconPath: i.author?.avatarUrl != null ? Uri.parse(i.author.avatarUrl) : undefined,
								item: i,
								picked: i.id === picked || i.id === topItem?.id,
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
					placeholder: `Unable to load items (${String(context.result.error)})`,
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

		const updateItems = async (quickpick: QuickPick<FocusItemQuickPickItem | DirectiveQuickPickItem>) => {
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

		const step = createPickStep({
			title: context.title,
			placeholder: placeholder,
			matchOnDetail: true,
			items: items,
			buttons: [
				FeedbackQuickInputButton,
				OpenOnWebQuickInputButton,
				LaunchpadSettingsQuickInputButton,
				RefreshQuickInputButton,
			],
			// onDidChangeValue: async (quickpick, value) => {},
			onDidClickButton: async (quickpick, button) => {
				switch (button) {
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
						void openUrl(this.container.focus.generateWebUrl());
						break;
					case RefreshQuickInputButton:
						this.sendTitleActionTelemetry('refresh', context);
						await updateItems(quickpick);
						break;
				}
			},

			onDidClickItemButton: async (quickpick, button, { group, item }) => {
				switch (button) {
					case OpenOnGitHubQuickInputButton:
						this.sendItemActionTelemetry('soft-open', item, group, context);
						this.container.focus.open(item);
						break;

					case SnoozeQuickInputButton:
						this.sendItemActionTelemetry('snooze', item, group, context);
						await this.container.focus.snooze(item);
						break;

					case UnsnoozeQuickInputButton:
						this.sendItemActionTelemetry('unsnooze', item, group, context);
						await this.container.focus.unsnooze(item);
						break;

					case PinQuickInputButton:
						this.sendItemActionTelemetry('pin', item, group, context);
						await this.container.focus.pin(item);
						break;

					case UnpinQuickInputButton:
						this.sendItemActionTelemetry('unpin', item, group, context);
						await this.container.focus.unpin(item);
						break;

					case MergeQuickInputButton:
						this.sendItemActionTelemetry('merge', item, group, context);
						await this.container.focus.merge(item);
						break;

					case OpenWorktreeInNewWindowQuickInputButton:
						this.sendItemActionTelemetry('open-worktree', item, group, context);
						await this.container.focus.switchTo(item, { skipWorktreeConfirmations: true });
						break;
				}

				await updateItems(quickpick);
			},
		});

		const selection: StepSelection<typeof step> = yield step;
		return canPickStepContinue(step, state, selection)
			? { ...selection[0].item, group: selection[0].group }
			: StepResultBreak;
	}

	private *confirmStep(
		state: FocusStepState,
		context: Context,
	): StepResultGenerator<FocusAction | FocusTargetAction> {
		const confirmations: (
			| QuickPickItemOfT<FocusAction>
			| QuickPickItemOfT<FocusTargetAction>
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
					buttons: [OpenOnGitHubQuickInputButton],
				},
				'soft-open',
			),
			createDirectiveQuickPickItem(Directive.Noop, false, { label: '' }),
			...this.getFocusItemInformationRows(state.item),
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
								buttons: [OpenOnGitHubQuickInputButton],
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
								label: `${this.getOpenActionLabel(state.item.actionableCategory)} on GitHub`,
								buttons: [OpenOnGitHubQuickInputButton],
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
								label: 'Open Worktree in New Window',
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
							this.sendItemActionTelemetry('soft-open', state.item, state.item.group, context);
							this.container.focus.open(state.item);
							break;
						case OpenOnWebQuickInputButton:
							this.sendItemActionTelemetry(
								'open-suggestion-browser',
								state.item,
								state.item.group,
								context,
							);
							if (isFocusTargetActionQuickPickItem(item)) {
								this.container.focus.openCodeSuggestionInBrowser(item.item.target);
							}
							break;
					}
				},
			},
		);

		const selection: StepSelection<typeof step> = yield step;
		return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
	}

	private *confirmIntegrationConnectStep(
		state: StepState<State>,
		_context: Context,
	): StepResultGenerator<IntegrationId> {
		const confirmations: (QuickPickItemOfT<IntegrationId> | DirectiveQuickPickItem)[] = [];

		for (const integration of supportedFocusIntegrations) {
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
				default:
					break;
			}
		}

		const step = this.createConfirmStep(
			`${this.title} \u00a0\u2022\u00a0 Connect an Integration`,
			confirmations,
			createDirectiveQuickPickItem(Directive.Cancel, false, { label: 'Cancel' }),
			{ placeholder: 'Launchpad requires a connected integration', ignoreFocusOut: false },
		);

		const selection: StepSelection<typeof step> = yield step;
		return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
	}

	private getFocusItemInformationRows(
		item: FocusItem,
	): (QuickPickItemOfT<FocusAction> | QuickPickItemOfT<FocusTargetAction> | DirectiveQuickPickItem)[] {
		const information: (
			| QuickPickItemOfT<FocusAction>
			| QuickPickItemOfT<FocusTargetAction>
			| DirectiveQuickPickItem
		)[] = [];
		switch (item.actionableCategory) {
			case 'mergeable':
				information.push(
					createQuickPickSeparator('Status'),
					this.getFocusItemStatusInformation(item),
					...this.getFocusItemReviewInformation(item),
				);
				break;
			case 'failed-checks':
			case 'conflicts':
				information.push(createQuickPickSeparator('Status'), this.getFocusItemStatusInformation(item));
				break;
			case 'unassigned-reviewers':
			case 'needs-my-review':
			case 'changes-requested':
			case 'reviewer-commented':
			case 'waiting-for-review':
				information.push(createQuickPickSeparator('Reviewers'), ...this.getFocusItemReviewInformation(item));
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
				...this.getFocusItemCodeSuggestionInformation(item),
			);
		}

		if (information.length > 0) {
			information.push(createDirectiveQuickPickItem(Directive.Noop, false, { label: '' }));
		}

		return information;
	}

	private getFocusItemStatusInformation(item: FocusItem): QuickPickItemOfT<FocusAction> {
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

		return createQuickPickItemOfT({ label: status, buttons: [OpenOnGitHubQuickInputButton] }, 'soft-open');
	}

	private getFocusItemReviewInformation(item: FocusItem): QuickPickItemOfT<FocusAction>[] {
		if (item.reviews == null || item.reviews.length === 0) {
			return [
				createQuickPickItemOfT(
					{ label: `$(info) No reviewers have been assigned`, buttons: [OpenOnGitHubQuickInputButton] },
					'soft-open',
				),
			];
		}

		const reviewInfo: QuickPickItemOfT<FocusAction>[] = [];

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
						{ label: reviewLabel, iconPath: iconPath, buttons: [OpenOnGitHubQuickInputButton] },
						'soft-open',
					),
				);
			}
		}

		return reviewInfo;
	}

	private getFocusItemCodeSuggestionInformation(
		item: FocusItem,
	): (QuickPickItemOfT<FocusTargetAction> | DirectiveQuickPickItem)[] {
		if (item.codeSuggestions?.value == null || item.codeSuggestions.value.length === 0) {
			return [];
		}

		const codeSuggestionInfo: (QuickPickItemOfT<FocusTargetAction> | DirectiveQuickPickItem)[] = [
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
			| FocusAction
			| FocusTargetAction
			| 'pin'
			| 'unpin'
			| 'snooze'
			| 'unsnooze'
			| 'open-suggestion-browser'
			| 'select',
		item: FocusItem,
		group: FocusGroup,
		context: Context,
	) {
		if (!this.container.telemetry.enabled) return;

		let action:
			| FocusAction
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
				'item.id': getFocusItemIdHash(item),
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

async function updateContextItems(container: Container, context: Context, options?: { force?: boolean }) {
	context.result = await container.focus.getCategorizedItems(options);
	if (container.telemetry.enabled) {
		updateTelemetryContext(context);
	}
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
		const grouped = countFocusItemGroups(context.result.items);

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

function isFocusTargetActionQuickPickItem(item: any): item is QuickPickItemOfT<FocusTargetAction> {
	return item?.item?.action != null && item?.item?.target != null;
}

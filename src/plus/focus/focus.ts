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
	OpenCodeSuggestionBrowserQuickInputButton,
	OpenLaunchpadInEditorQuickInputButton,
	OpenOnGitHubQuickInputButton,
	PinQuickInputButton,
	RefreshQuickInputButton,
	SnoozeQuickInputButton,
	UnpinQuickInputButton,
	UnsnoozeQuickInputButton,
} from '../../commands/quickCommand.buttons';
import { Commands } from '../../constants';
import type { Container } from '../../container';
import type { QuickPickItemOfT } from '../../quickpicks/items/common';
import { createQuickPickItemOfT, createQuickPickSeparator } from '../../quickpicks/items/common';
import type { DirectiveQuickPickItem } from '../../quickpicks/items/directive';
import { createDirectiveQuickPickItem, Directive } from '../../quickpicks/items/directive';
import { command, executeCommand } from '../../system/command';
import { fromNow } from '../../system/date';
import { interpolate, pluralize } from '../../system/string';
import { openUrl } from '../../system/utils';
import type { IntegrationId } from '../integrations/providers/models';
import {
	HostingIntegrationId,
	ProviderBuildStatusState,
	ProviderPullRequestReviewState,
} from '../integrations/providers/models';
import type { FocusAction, FocusActionCategory, FocusGroup, FocusItem, FocusTargetAction } from './focusProvider';
import { groupAndSortFocusItems, supportedFocusIntegrations } from './focusProvider';

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

const groupMap = new Map<FocusGroup, [string, string | undefined]>([
	['current-branch', ['Current Branch', 'git-branch']],
	['pinned', ['Pinned', 'pinned']],
	['mergeable', ['Ready to Merge', 'rocket']],
	['blocked', ['Blocked', 'error']], //bracket-error
	['follow-up', ['Requires Follow-up', 'report']],
	// ['needs-attention', ['Needs Your Attention', 'bell-dot']], //comment-unresolved
	['needs-review', ['Needs Your Review', 'comment-draft']], // feedback
	['waiting-for-review', ['Waiting for Review', 'gitlens-clock']],
	['draft', ['Draft', 'git-pull-request-draft']],
	['other', ['Other', 'ellipsis']],
	['snoozed', ['Snoozed', 'bell-slash']],
]);

export interface FocusItemQuickPickItem extends QuickPickItemOfT<FocusItem> {}

interface Context {
	items: FocusItem[];
	title: string;
	collapsed: Map<FocusGroup, boolean>;
}

interface State {
	item?: FocusItem;
	action?: FocusAction | FocusTargetAction;
	initialGroup?: FocusGroup;
	selectTopItem?: boolean;
}

export interface FocusCommandArgs {
	readonly command: 'focus';
	confirm?: boolean;
	state?: Partial<State>;
}

type FocusStepState<T extends State = State> = RequireSome<StepState<T>, 'item'>;

function assertsFocusStepState(state: StepState<State>): asserts state is FocusStepState {
	if (state.item != null) return;

	debugger;
	throw new Error('Missing item');
}

@command()
export class FocusCommand extends QuickCommand<State> {
	constructor(container: Container, args?: FocusCommandArgs) {
		super(container, 'focus', 'focus', 'GitLens Launchpad\u00a0\u00a0ᴾᴿᴱⱽᴵᴱᵂ', {
			description: 'focus on a pull request or issue',
		});

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
			connected = await integration.connect();
		}

		return connected;
	}

	protected async *steps(state: PartialStepState<State>): StepGenerator {
		if (this.container.git.isDiscoveringRepositories) {
			await this.container.git.isDiscoveringRepositories;
		}

		const collapsed = new Map<FocusGroup, boolean>([
			['draft', true],
			['other', true],
			['snoozed', true],
		]);
		if (state.initialGroup != null) {
			// set all to true except the initial group
			for (const [group] of groupMap) {
				collapsed.set(group, group !== state.initialGroup);
			}
		}

		const context: Context = {
			items: [],
			title: this.title,
			collapsed: collapsed,
		};

		while (this.canStepsContinue(state)) {
			context.title = this.title;

			if (state.counter < 1 && !(await this.container.focus.hasConnectedIntegration())) {
				const result = yield* this.confirmIntegrationConnectStep(state, context);
				if (result !== StepResultBreak && !(await this.ensureIntegrationConnected(result))) {
					throw new Error('Could not connect chosen integration');
				}
			}

			context.items = await this.container.focus.getCategorizedItems();

			if (state.counter < 2 || state.item == null) {
				const result = yield* this.pickFocusItemStep(state, context, {
					picked: state.item?.id,
					selectTopItem: state.selectTopItem,
				});
				if (result === StepResultBreak) continue;

				state.item = result;
			}

			assertsFocusStepState(state);

			if (this.confirm(state.confirm)) {
				await this.container.focus.ensureFocusItemCodeSuggestions(state.item);
				const result = yield* this.confirmStep(state, context);
				if (result === StepResultBreak) continue;

				state.action = result;
			}

			if (typeof state.action === 'string') {
				switch (state.action) {
					case 'merge': {
						void this.container.focus.merge(state.item);
						break;
					}
					case 'open':
						this.container.focus.open(state.item);
						break;
					case 'soft-open':
						this.container.focus.open(state.item);
						state.counter = 2;
						continue;
					case 'switch': {
						void this.container.focus.switchTo(state.item);
						break;
					}
					case 'switch-and-review':
					case 'review': {
						void this.container.focus.switchTo(state.item, true);
						break;
					}
					// case 'change-reviewers':
					// 	await this.container.focus.changeReviewers(state.item);
					// 	break;
					// case 'decline-review':
					// 	await this.container.focus.declineReview(state.item);
					// 	break;
					// case 'nudge':
					// 	await this.container.focus.nudge(state.item);
					// 	break;
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
	): StepResultGenerator<FocusItem> {
		function getItems(categorizedItems: FocusItem[]) {
			const items: (FocusItemQuickPickItem | DirectiveQuickPickItem)[] = [];

			if (categorizedItems?.length) {
				const uiGroups = groupAndSortFocusItems(categorizedItems);
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
							label: `$(${context.collapsed.get(ui) ? 'chevron-down' : 'chevron-up'})\u00a0\u00a0$(${
								groupMap.get(ui)![1]
							})\u00a0\u00a0${groupMap.get(ui)![0]?.toUpperCase()}`, //'\u00a0',
							//detail: groupMap.get(group)?.[0].toUpperCase(),
							onDidSelect: () => {
								context.collapsed.set(ui, !context.collapsed.get(ui));
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
								OpenOnGitHubQuickInputButton,
							);

							return {
								label: i.title,
								// description: `${i.repoAndOwner}#${i.id}, by @${i.author}`,
								description: `\u00a0 ${i.repository.owner.login}/${i.repository.name} #${i.id} \u00a0 ${
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
							};
						}),
					);
				}
			}

			return items;
		}

		const items = getItems(context.items);

		const step = createPickStep({
			title: context.title,
			placeholder: !items.length ? 'All done! Take a vacation' : 'Choose an item to focus on',
			matchOnDetail: true,
			items: !items.length ? [createDirectiveQuickPickItem(Directive.Cancel, undefined, { label: 'OK' })] : items,
			buttons: [
				FeedbackQuickInputButton,
				OpenLaunchpadInEditorQuickInputButton,
				LaunchpadSettingsQuickInputButton,
				RefreshQuickInputButton,
			],
			// onDidChangeValue: async (quickpick, value) => {},
			onDidClickButton: async (quickpick, button) => {
				switch (button) {
					case LaunchpadSettingsQuickInputButton:
						void commands.executeCommand('workbench.action.openSettings', 'gitlens.launchpad');
						break;
					case FeedbackQuickInputButton:
						void openUrl('https://github.com/gitkraken/vscode-gitlens/discussions/3268');
						break;
					case OpenLaunchpadInEditorQuickInputButton:
						void executeCommand(Commands.ShowFocusPage);
						break;
					case RefreshQuickInputButton:
						quickpick.busy = true;

						try {
							context.items = await this.container.focus.getCategorizedItems({ force: true });
							const items = getItems(context.items);

							quickpick.placeholder = !items.length
								? 'All done! Take a vacation'
								: 'Choose an item to focus on';
							quickpick.items = items;
						} finally {
							quickpick.busy = false;
						}
						break;
				}
			},

			onDidClickItemButton: async (quickpick, button, { item }) => {
				switch (button) {
					case OpenOnGitHubQuickInputButton:
						this.container.focus.open(item);
						break;
					case SnoozeQuickInputButton:
						await this.container.focus.snooze(item);
						break;

					case UnsnoozeQuickInputButton:
						await this.container.focus.unsnooze(item);
						break;

					case PinQuickInputButton:
						await this.container.focus.pin(item);
						break;

					case UnpinQuickInputButton:
						await this.container.focus.unpin(item);
						break;

					case MergeQuickInputButton:
						await this.container.focus.merge(item);
						break;
				}

				quickpick.busy = true;

				try {
					context.items = await this.container.focus.getCategorizedItems();
					const items = getItems(context.items);

					quickpick.placeholder = !items.length ? 'All done! Take a vacation' : 'Choose an item to focus on';
					quickpick.items = items;
				} finally {
					quickpick.busy = false;
				}
			},
		});

		const selection: StepSelection<typeof step> = yield step;
		return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
	}

	private *confirmStep(
		state: FocusStepState,
		_context: Context,
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
				case 'merge':
					confirmations.push(
						createQuickPickItemOfT(
							{
								label: 'Merge...',
								detail: `Will merge ${state.item.headRef?.name ?? 'this pull request'}${
									state.item.baseRef?.name ? ` into ${state.item.baseRef.name}` : ''
								}${
									state.item.repository.owner
										? ` on ${state.item.repository.owner.login}/${state.item.repository.name}`
										: ''
								}`,
							},
							action,
						),
					);
					break;
				case 'open':
					confirmations.push(
						createQuickPickItemOfT(
							{
								label: `${this.getOpenActionLabel(state.item.actionableCategory)} on GitHub`,
							},
							action,
						),
					);
					break;
				/* case 'review':
					confirmations.push(
						createQuickPickItemOfT(
							{
								label: 'Start Review',
								detail: 'Will checkout a branch or worktree to review this pull request',
							},
							action,
						),
					);
					break; */
				case 'switch': {
					if (state.item.openRepository?.localBranch?.current) {
						confirmations.push(
							createQuickPickItemOfT(
								{
									label: `Suggest ${state.item.viewer.isAuthor ? 'Additional ' : ''}Code Changes`,
									detail: 'Will let you choose code changes to suggest on this pull request',
								},
								'review',
							),
						);
						break;
					} else {
						confirmations.push(
							createQuickPickItemOfT(
								{
									label: 'Switch to Branch or Worktree',
									detail: 'Will checkout the branch or worktree for this pull request',
								},
								action,
							),
							createQuickPickItemOfT(
								{
									label: `Suggest ${state.item.viewer.isAuthor ? 'Additional ' : ''}Code Changes`,
									detail: 'Will let you choose code changes to suggest on this pull request',
								},
								'switch-and-review',
							),
						);
					}
					break;
				}
				/* case 'change-reviewers':
					confirmations.push(
						createQuickPickItemOfT(
							{
								label: 'Change Reviewers',
								detail: 'Will change the reviewers for this pull request',
							},
							action,
						),
					);
					break;
				case 'decline-review':
					confirmations.push(
						createQuickPickItemOfT(
							{
								label: 'Decline Review',
								detail: 'Will decline the review for this pull request',
							},
							action,
						),
					);
					break;
				case 'nudge':
					confirmations.push(
						createQuickPickItemOfT(
							{
								label: 'Nudge',
								detail: 'Will nudge the reviewers on this pull request',
							},
							action,
						),
					);
					break; */
			}
		}

		const step = this.createConfirmStep(
			`PR ${state.item.repository.owner.login}/${state.item.repository.name}#${state.item.id}`,
			confirmations,
			undefined,
			{
				placeholder: 'Choose an action to perform',
				onDidClickItemButton: (_quickpick, button, item) => {
					switch (button) {
						case OpenOnGitHubQuickInputButton:
							this.container.focus.open(state.item);
							break;
						case OpenCodeSuggestionBrowserQuickInputButton:
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
								label: 'Connect GitHub',
								detail: 'Will connect to GitHub',
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
			this.title,
			confirmations,
			createDirectiveQuickPickItem(Directive.Cancel, false, { label: 'Cancel' }),
			{ placeholder: 'GitHub not connected. Choose an action', ignoreFocusOut: false },
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

		if (item.codeSuggestions != null && item.codeSuggestions.length > 0) {
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
		const base = item.baseRef?.name != null ? `: ${item.baseRef.name}` : '';
		const ciStatus = item.headCommit?.buildStatuses?.[0].state;
		if (ciStatus === ProviderBuildStatusState.Success) {
			status = `$(pass) CI checks passed${!item.hasConflicts ? `, and no conflicts with base${base}` : ''}.`;
		} else if (ciStatus === ProviderBuildStatusState.Failed) {
			status = `$(error) CI checks are failing${item.hasConflicts ? `, and conflicts with base${base}` : ''}.`;
		} else if (item.hasConflicts) {
			status = `$(error) Conflicts with base${base}.`;
		} else {
			status = `$(pass) No conflicts with base${base}.`;
		}

		return createQuickPickItemOfT(
			{
				label: status,
			},
			'soft-open',
		);
	}

	private getFocusItemReviewInformation(item: FocusItem): QuickPickItemOfT<FocusAction>[] {
		if (item.reviews == null || item.reviews.length === 0) {
			return [
				createQuickPickItemOfT(
					{
						label: `$(info) No reviewers have been assigned yet to this Pull Request.`,
					},
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
					reviewLabel = `${isCurrentUser ? 'You' : review.reviewer.username} approved this Pull Request.`;
					break;
				case ProviderPullRequestReviewState.ChangesRequested:
					reviewLabel = `${
						isCurrentUser ? 'You' : review.reviewer.username
					} requested changes on this Pull Request.`;
					break;
				case ProviderPullRequestReviewState.Commented:
					reviewLabel = `${
						isCurrentUser ? 'You' : review.reviewer.username
					} left a comment review on this Pull Request.`;
					break;
				case ProviderPullRequestReviewState.ReviewRequested:
					reviewLabel = `${
						isCurrentUser ? 'You have' : `${review.reviewer.username} has`
					} not yet reviewed this Pull Request.`;
					break;
			}

			if (reviewLabel != null) {
				reviewInfo.push(
					createQuickPickItemOfT(
						{
							label: reviewLabel,
							iconPath: iconPath,
						},
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
		if (item.codeSuggestions == null || item.codeSuggestions.length === 0) {
			return [];
		}

		const codeSuggestionInfo: (QuickPickItemOfT<FocusTargetAction> | DirectiveQuickPickItem)[] = [
			createDirectiveQuickPickItem(Directive.Noop, false, {
				label: `$(gitlens-code-suggestion) ${pluralize(
					'code suggestion',
					item.codeSuggestions.length,
				)} for this Pull Request:`,
			}),
		];

		for (const suggestion of item.codeSuggestions) {
			codeSuggestionInfo.push(
				createQuickPickItemOfT(
					{
						label: `    ${suggestion.author.name} suggested a code change ${fromNow(
							suggestion.createdAt,
						)}: "${suggestion.title}"`,
						iconPath:
							suggestion.author.avatar != null
								? Uri.parse(suggestion.author.avatar)
								: suggestion.author.email != null
								  ? getAvatarUri(suggestion.author.email)
								  : undefined,
						buttons: [OpenCodeSuggestionBrowserQuickInputButton],
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
}

function isFocusTargetActionQuickPickItem(item: any): item is QuickPickItemOfT<FocusTargetAction> {
	return item?.item?.action != null && item?.item?.target != null;
}

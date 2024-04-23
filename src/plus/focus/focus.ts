import { ThemeIcon, Uri } from 'vscode';
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
	MergeQuickInputButton,
	PinQuickInputButton,
	RefreshQuickInputButton,
	SnoozeQuickInputButton,
	UnpinQuickInputButton,
	UnsnoozeQuickInputButton,
} from '../../commands/quickCommand.buttons';
import type { Container } from '../../container';
import type { QuickPickItemOfT } from '../../quickpicks/items/common';
import { createQuickPickItemOfT, createQuickPickSeparator } from '../../quickpicks/items/common';
import type { DirectiveQuickPickItem } from '../../quickpicks/items/directive';
import { createDirectiveQuickPickItem, Directive } from '../../quickpicks/items/directive';
import { command } from '../../system/command';
import { fromNow } from '../../system/date';
import { interpolate, pluralize } from '../../system/string';
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
	['other', ['Other', 'Other pull requests']],
]);

const groupMap = new Map<FocusGroup, [string, ThemeIcon | undefined]>([
	['current-branch', ['Current Branch', new ThemeIcon('git-branch')]],
	['pinned', ['Pinned', new ThemeIcon('pinned')]],
	['mergeable', ['Ready to Merge', new ThemeIcon('rocket')]],
	['blocked', ['Blocked', new ThemeIcon('error')]], //bracket-error
	['follow-up', ['Requires Follow-up', new ThemeIcon('report')]],
	['needs-attention', ['Needs Your Attention', new ThemeIcon('bell-dot')]], //comment-unresolved
	['needs-review', ['Needs Your Review', new ThemeIcon('comment-draft')]], // feedback
	['waiting-for-review', ['Waiting for Review', new ThemeIcon('gitlens-clock')]],
	['draft', ['Draft', new ThemeIcon('git-pull-request-draft')]],
	['other', ['Other', new ThemeIcon('question')]],
	['snoozed', ['Snoozed', new ThemeIcon('bell-slash')]],
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
		super(container, 'focus', 'focus', 'Launchpad', { description: 'focus on a pull request or issue' });

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
					case 'review':
					case 'switch': {
						void this.container.focus.switchTo(state.item);
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
		{ picked }: { picked?: string },
	): StepResultGenerator<FocusItem> {
		function getItems(categorizedItems: FocusItem[]) {
			const items: (FocusItemQuickPickItem | DirectiveQuickPickItem)[] = [];

			if (categorizedItems?.length) {
				const uiGroups = groupAndSortFocusItems(categorizedItems);
				for (const [ui, groupItems] of uiGroups) {
					if (!groupItems.length) continue;

					items.push(
						createQuickPickSeparator(groupItems.length ? groupItems.length.toString() : undefined),
						createDirectiveQuickPickItem(Directive.Reload, false, {
							label: `${groupMap.get(ui)![0]?.toUpperCase()}\u00a0$(${
								context.collapsed.get(ui) ? 'chevron-down' : 'chevron-up'
							})`, //'\u00a0',
							//detail: groupMap.get(group)?.[0].toUpperCase(),
							iconPath: groupMap.get(ui)![1],
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
							);

							return {
								label: i.title,
								// description: `${i.repoAndOwner}#${i.id}, by @${i.author}`,
								description: `#${i.id} ${i.isNew ? '(New since last view)' : ''} ${
									i.codeSuggestionsCount > 0
										? ` $(gitlens-code-suggestion) ${i.codeSuggestionsCount}`
										: ''
								}`,
								detail: `      ${actionGroupMap.get(i.actionableCategory)![0]} \u2022  ${fromNow(
									i.updatedDate,
								)} by @${i.author!.username} \u2022 ${i.repository.owner.login}/${i.repository.name}`,

								buttons: buttons,
								iconPath: i.author?.avatarUrl != null ? Uri.parse(i.author.avatarUrl) : undefined,
								item: i,
								picked: i.id === picked,
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
			buttons: [RefreshQuickInputButton],
			// onDidChangeValue: async (quickpick, value) => {},
			onDidClickButton: async (quickpick, button) => {
				if (button === RefreshQuickInputButton) {
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
				}
			},

			onDidClickItemButton: async (quickpick, button, { item }) => {
				switch (button) {
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
			createDirectiveQuickPickItem(Directive.Noop, false, {
				label: state.item.title,
				description: `${state.item.repository.owner.login}/${state.item.repository.name}#${
					state.item.id
				} \u2022 ${fromNow(state.item.updatedDate)}`,
				detail: interpolate(actionGroupMap.get(state.item.actionableCategory)![1], {
					author: state.item.author!.username,
				}),
				iconPath: state.item.author?.avatarUrl != null ? Uri.parse(state.item.author.avatarUrl) : undefined,
			}),
			...this.getFocusItemInformationRows(state.item),
			createQuickPickSeparator(),
			createDirectiveQuickPickItem(Directive.Noop, false, {
				label: '',
			}),
		];

		for (const action of state.item.suggestedActions) {
			switch (action) {
				case 'merge':
					confirmations.push(
						createQuickPickItemOfT(
							{
								label: 'Merge',
								detail: 'Will merge the pull request',
							},
							action,
						),
					);
					break;
				case 'open':
					confirmations.push(
						createQuickPickItemOfT(
							{
								label: 'Open on GitHub',
							},
							action,
						),
					);
					break;
				case 'review':
					confirmations.push(
						createQuickPickItemOfT(
							{
								label: 'Start Review',
								detail: 'Will checkout a branch or worktree to review this pull request',
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
								detail: 'Will checkout the branch or worktree for this pull request',
							},
							action,
						),
					);
					break;
				case 'change-reviewers':
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
					break;
			}
		}

		const step = this.createConfirmStep(
			`Focus on ${state.item.repository.owner.login}/${state.item.repository.name}#${state.item.id}`,
			confirmations,
			undefined,
			{ placeholder: 'Choose an action to perform', ignoreFocusOut: false },
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
	): (QuickPickItemOfT<FocusTargetAction> | DirectiveQuickPickItem)[] {
		const information: (QuickPickItemOfT<FocusTargetAction> | DirectiveQuickPickItem)[] = [
			this.getFocusItemCreatedDateInformation(item),
			this.getFocusItemUpdatedDateInformation(item),
		];
		switch (item.actionableCategory) {
			case 'mergeable':
				information.push(
					...this.getFocusItemStatusInformation(item),
					...this.getFocusItemReviewInformation(item),
				);
				break;
			case 'failed-checks':
			case 'conflicts':
				information.push(...this.getFocusItemStatusInformation(item));
				break;
			case 'unassigned-reviewers':
			case 'needs-my-review':
			case 'code-suggestions':
			case 'changes-requested':
			case 'reviewer-commented':
			case 'waiting-for-review':
				information.push(...this.getFocusItemReviewInformation(item));
				break;
			default:
				break;
		}

		information.push(...this.getFocusItemCodeSuggestionInformation(item));

		return information;
	}

	private getFocusItemCreatedDateInformation(item: FocusItem): DirectiveQuickPickItem {
		return createDirectiveQuickPickItem(Directive.Noop, false, {
			label: `$(clock) Pull request was created ${fromNow(item.createdDate)}.`,
		});
	}

	private getFocusItemUpdatedDateInformation(item: FocusItem): DirectiveQuickPickItem {
		return createDirectiveQuickPickItem(Directive.Noop, false, {
			label: `$(clock) Pull request was last updated ${fromNow(item.updatedDate)}.`,
		});
	}

	private getFocusItemStatusInformation(item: FocusItem): DirectiveQuickPickItem[] {
		let ciStatus = '$(question) Unknown CI status';
		switch (item.headCommit?.buildStatuses?.[0].state) {
			case ProviderBuildStatusState.Success:
				ciStatus = '$(pass) CI checks passed.';
				break;
			case ProviderBuildStatusState.Failed:
				ciStatus = '$(error) CI checks are failing.';
				break;
			case ProviderBuildStatusState.Pending:
				ciStatus = '$(info) CI checks are pending.';
				break;
			case undefined:
				ciStatus = '$(info) No CI checks found.';
				break;
		}

		return [
			createDirectiveQuickPickItem(Directive.Noop, false, {
				label: ciStatus,
			}),
			createDirectiveQuickPickItem(Directive.Noop, false, {
				label: item.hasConflicts
					? `$(error) Conflicts with base${item.baseRef?.name != null ? `: ${item.baseRef.name}` : ''}.`
					: `$(pass) No conflicts with base${item.baseRef?.name != null ? `: ${item.baseRef.name}` : ''}.`,
			}),
		];
	}

	private getFocusItemReviewInformation(item: FocusItem): DirectiveQuickPickItem[] {
		if (item.reviews == null || item.reviews.length === 0) {
			return [
				createDirectiveQuickPickItem(Directive.Noop, false, {
					label: `$(info) No reviewers have been assigned yet to this Pull Request.`,
				}),
			];
		}

		const reviewInfo: DirectiveQuickPickItem[] = [];

		for (const review of item.reviews) {
			const isCurrentUser = review.reviewer.username === item.currentViewer.username;
			switch (review.state) {
				case ProviderPullRequestReviewState.Approved:
					reviewInfo.push(
						createDirectiveQuickPickItem(Directive.Noop, false, {
							label: `${isCurrentUser ? 'You' : review.reviewer.username} approved this Pull Request.`,
							iconPath:
								review.reviewer.avatarUrl != null ? Uri.parse(review.reviewer.avatarUrl) : undefined,
						}),
					);
					break;
				case ProviderPullRequestReviewState.ChangesRequested:
					reviewInfo.push(
						createDirectiveQuickPickItem(Directive.Noop, false, {
							label: `${
								isCurrentUser ? 'You' : review.reviewer.username
							} requested changes on this Pull Request.`,
							iconPath:
								review.reviewer.avatarUrl != null ? Uri.parse(review.reviewer.avatarUrl) : undefined,
						}),
					);
					break;
				case ProviderPullRequestReviewState.Commented:
					reviewInfo.push(
						createDirectiveQuickPickItem(Directive.Noop, false, {
							label: `${
								isCurrentUser ? 'You' : review.reviewer.username
							} left a comment review on this Pull Request.`,
							iconPath:
								review.reviewer.avatarUrl != null ? Uri.parse(review.reviewer.avatarUrl) : undefined,
						}),
					);
					break;
				case ProviderPullRequestReviewState.ReviewRequested:
					reviewInfo.push(
						createDirectiveQuickPickItem(Directive.Noop, false, {
							label: `${
								isCurrentUser ? 'You have' : `${review.reviewer.username} has`
							} not yet reviewed this Pull Request.`,
							iconPath:
								review.reviewer.avatarUrl != null ? Uri.parse(review.reviewer.avatarUrl) : undefined,
						}),
					);
					break;
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
}

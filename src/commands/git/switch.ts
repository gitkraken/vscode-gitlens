import { ProgressLocation, window } from 'vscode';
import * as nls from 'vscode-nls';
import { BranchSorting } from '../../config';
import type { Container } from '../../container';
import { GitReference } from '../../git/models/reference';
import type { Repository } from '../../git/models/repository';
import type { QuickPickItemOfT } from '../../quickpicks/items/common';
import { isStringArray } from '../../system/array';
import type { ViewsWithRepositoryFolders } from '../../views/viewBase';
import type {
	PartialStepState,
	QuickPickStep,
	StepGenerator,
	StepResultGenerator,
	StepSelection,
	StepState,
} from '../quickCommand';
import {
	appendReposToTitle,
	inputBranchNameStep,
	pickBranchOrTagStepMultiRepo,
	pickRepositoriesStep,
	QuickCommand,
	StepResult,
} from '../quickCommand';

const localize = nls.loadMessageBundle();
interface Context {
	repos: Repository[];
	associatedView: ViewsWithRepositoryFolders;
	showTags: boolean;
	switchToLocalFrom: GitReference | undefined;
	title: string;
}

interface State {
	repos: string | string[] | Repository | Repository[];
	reference: GitReference;
	createBranch?: string;
	fastForwardTo?: GitReference;
}

type ConfirmationChoice = 'switch' | 'switch+fast-forward';

type SwitchStepState<T extends State = State> = ExcludeSome<StepState<T>, 'repos', string | string[] | Repository>;

export interface SwitchGitCommandArgs {
	readonly command: 'switch' | 'checkout';
	confirm?: boolean;
	state?: Partial<State>;
}

export class SwitchGitCommand extends QuickCommand<State> {
	constructor(container: Container, args?: SwitchGitCommandArgs) {
		super(container, 'switch', localize('label', 'switch'), localize('title', 'Switch'), {
			description: localize('description', 'aka checkout, switches the current branch to a specified branch'),
		});

		let counter = 0;
		if (args?.state?.repos != null && (!Array.isArray(args.state.repos) || args.state.repos.length !== 0)) {
			counter++;
		}

		if (args?.state?.reference != null) {
			counter++;
		}

		this.initialState = {
			counter: counter,
			confirm: args?.confirm,
			...args?.state,
		};
	}

	async execute(state: SwitchStepState) {
		await window.withProgress(
			{
				location: ProgressLocation.Notification,
				title:
					state.repos.length === 1
						? localize(
								'title.switchingRepoToRef',
								'Switching {0} to {1}',
								state.repos[0].formattedName,
								state.reference.name,
						  )
						: localize(
								'title.switchingNumberOfReposToRef',
								'Switching {0} repositories to {1}',
								state.repos.length,
								state.reference.name,
						  ),
			},
			() =>
				Promise.all(
					state.repos.map(r =>
						r.switch(state.reference.ref, { createBranch: state.createBranch, progress: false }),
					),
				),
		);

		if (state.fastForwardTo != null) {
			state.repos[0].merge('--ff-only', state.fastForwardTo.ref);
		}
	}

	override isMatch(key: string) {
		return super.isMatch(key) || key === 'checkout';
	}

	override isFuzzyMatch(name: string) {
		return super.isFuzzyMatch(name) || name === 'checkout';
	}

	protected async *steps(state: PartialStepState<State>): StepGenerator {
		const context: Context = {
			repos: this.container.git.openRepositories,
			associatedView: this.container.commitsView,
			showTags: false,
			switchToLocalFrom: undefined,
			title: this.title,
		};

		if (state.repos != null && !Array.isArray(state.repos)) {
			state.repos = [state.repos] as string[] | Repository[];
		}

		let skippedStepOne = false;

		while (this.canStepsContinue(state)) {
			context.title = this.title;

			if (state.counter < 1 || state.repos == null || state.repos.length === 0 || isStringArray(state.repos)) {
				skippedStepOne = false;
				if (context.repos.length === 1) {
					skippedStepOne = true;
					state.counter++;

					state.repos = [context.repos[0]];
				} else {
					const result = yield* pickRepositoriesStep(
						state as ExcludeSome<typeof state, 'repos', string | Repository>,
						context,
						{ skipIfPossible: state.counter >= 1 },
					);
					// Always break on the first step (so we will go back)
					if (result === StepResult.Break) break;

					state.repos = result;
				}
			}

			if (state.counter < 2 || state.reference == null) {
				const result = yield* pickBranchOrTagStepMultiRepo(state as SwitchStepState, context, {
					placeholder: context =>
						context.showTags
							? localize(
									'pickBranchOrTagStepMultiRepo.placeholder.chooseBranchToSwitchTo',
									'Choose a branch to switch to',
							  )
							: localize(
									'pickBranchOrTagStepMultiRepo.placeholder.chooseBranchOrTagToSwitchTo',
									'Choose a branch or tag to switch to',
							  ),
				});
				if (result === StepResult.Break) {
					// If we skipped the previous step, make sure we back up past it
					if (skippedStepOne) {
						state.counter--;
					}

					continue;
				}

				state.reference = result;
			}

			if (GitReference.isBranch(state.reference) && state.reference.remote) {
				context.title = localize('createBranch.title', 'Create Branch and {0}', this.title);

				const { values: branches } = await this.container.git.getBranches(state.reference.repoPath, {
					filter: b => b.upstream?.name === state.reference!.name,
					sort: { orderBy: BranchSorting.DateDesc },
				});

				if (branches.length === 0) {
					const result = yield* inputBranchNameStep(state as SwitchStepState, context, {
						placeholder: localize(
							'inputBranchNameStep.placeholder',
							'Please provider a name for the new branch',
						),
						titleContext: ` ${localize(
							'inputBranchNameStep.titleContext',
							'based on {0}',
							GitReference.toString(state.reference, {
								icon: false,
							}),
						)}`,
						value: state.createBranch ?? GitReference.getNameWithoutRemote(state.reference),
					});
					if (result === StepResult.Break) continue;

					state.createBranch = result;
				} else {
					context.title = `${this.title} to Local Branch`;
					context.switchToLocalFrom = state.reference;
					state.reference = branches[0];
					state.createBranch = undefined;
				}
			} else {
				state.createBranch = undefined;
			}

			if (this.confirm(state.confirm || context.switchToLocalFrom != null)) {
				const result = yield* this.confirmStep(state as SwitchStepState, context);
				if (result === StepResult.Break) continue;

				if (result === 'switch+fast-forward') {
					state.fastForwardTo = context.switchToLocalFrom;
				}
			}

			QuickCommand.endSteps(state);
			void this.execute(state as SwitchStepState);
		}

		return state.counter < 0 ? StepResult.Break : undefined;
	}

	private *confirmStep(state: SwitchStepState, context: Context): StepResultGenerator<ConfirmationChoice> {
		let additionalConfirmations: QuickPickItemOfT<ConfirmationChoice>[];
		if (context.switchToLocalFrom != null && state.repos.length === 1) {
			additionalConfirmations = [
				{
					label: localize('andFastForward', '{0} and Fast-Forward', context.title),
					description: '',
					detail: localize(
						'willSwitchToAndFastForwardLocalRefInRepo',
						'Will switch to and fast-forward local {0} in {1}',
						GitReference.toString(state.reference),
						`$(repo) ${state.repos[0].formattedName}`,
					),
					item: 'switch+fast-forward',
				},
			];
		} else {
			additionalConfirmations = [];
		}

		const step: QuickPickStep<QuickPickItemOfT<ConfirmationChoice>> = this.createConfirmStep<
			QuickPickItemOfT<ConfirmationChoice>
		>(
			appendReposToTitle(localize('confirm', 'Confirm {0}', context.title), state, context),
			[
				{
					label: context.title,
					description: state.createBranch ? '-b' : '',
					detail: state.createBranch
						? state.repos.length === 1
							? localize(
									'confirmStep.detail.willCreateAndSwitchToNewBranchNamedFromRefRepo',
									'Will create and switch to a new branch named {0} from {1} in {2}',
									state.createBranch,
									GitReference.toString(state.reference),
									`$(repo) ${state.repos[0].formattedName}`,
							  )
							: localize(
									'confirmStep.detail.willCreateAndSwitchToNewBranchNamedFromRefInNumberOfRepos',
									'Will create and switch to a new branch named {0} from {1} in {2} repositories',
									state.createBranch,
									GitReference.toString(state.reference),
									state.repos.length,
							  )
						: state.repos.length === 1
						? context.switchToLocalFrom != null
							? localize(
									'confirmStep.detail.willSwitchToLocalRefInRepo',
									'Will switch to local {0} in {1}',
									GitReference.toString(state.reference),
									`$(repo) ${state.repos[0].formattedName}`,
							  )
							: localize(
									'confirmStep.detail.willSwitchToRefInRepo',
									'Will switch to {0} in {1}',
									GitReference.toString(state.reference),
									`$(repo) ${state.repos[0].formattedName}`,
							  )
						: context.switchToLocalFrom != null
						? localize(
								'confirmStep.detail.willSwitchToLocalRefInNumberOfRepos',
								'Will switch to local {0} in {1} repositories',
								GitReference.toString(state.reference),
								state.repos.length,
						  )
						: localize(
								'confirmStep.detail.willSwitchToRefInNumberOfRepos',
								'Will switch to {0} in {1} repositories',
								GitReference.toString(state.reference),
								state.repos.length,
						  ),
					item: 'switch',
				},
				...additionalConfirmations,
			],
			undefined,
			{ placeholder: localize('confirm', 'Confirm {0}', context.title) },
		);
		const selection: StepSelection<typeof step> = yield step;
		return QuickCommand.canPickStepContinue(step, state, selection) ? selection[0].item : StepResult.Break;
	}
}

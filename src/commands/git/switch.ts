import { ProgressLocation, window } from 'vscode';
import type { Container } from '../../container';
import type { GitReference } from '../../git/models/reference';
import { getNameWithoutRemote, getReferenceLabel, isBranchReference } from '../../git/models/reference';
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
	canPickStepContinue,
	endSteps,
	inputBranchNameStep,
	pickBranchOrTagStepMultiRepo,
	pickRepositoriesStep,
	QuickCommand,
	StepResultBreak,
} from '../quickCommand';

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
		super(container, 'switch', 'switch', 'Switch Branch', {
			description: 'aka checkout, switches the current branch to a specified branch',
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
				title: `Switching ${
					state.repos.length === 1 ? state.repos[0].formattedName : `${state.repos.length} repositories`
				} to ${state.reference.name}`,
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
					if (state.repos == null) {
						state.counter++;
					}

					state.repos = [context.repos[0]];
				} else {
					const result = yield* pickRepositoriesStep(
						state as ExcludeSome<typeof state, 'repos', string | Repository>,
						context,
						{ skipIfPossible: state.counter >= 1 },
					);
					// Always break on the first step (so we will go back)
					if (result === StepResultBreak) break;

					state.repos = result;
				}
			}

			if (state.counter < 2 || state.reference == null) {
				const result = yield* pickBranchOrTagStepMultiRepo(state as SwitchStepState, context, {
					placeholder: context => `Choose a branch${context.showTags ? ' or tag' : ''} to switch to`,
				});
				if (result === StepResultBreak) {
					// If we skipped the previous step, make sure we back up past it
					if (skippedStepOne) {
						state.counter--;
					}

					continue;
				}

				state.reference = result;
			}

			if (isBranchReference(state.reference) && state.reference.remote) {
				context.title = `Create Branch and ${this.title}`;

				const { values: branches } = await this.container.git.getBranches(state.reference.repoPath, {
					filter: b => b.upstream?.name === state.reference!.name,
					sort: { orderBy: 'date:desc' },
				});

				if (branches.length === 0) {
					const result = yield* inputBranchNameStep(state as SwitchStepState, context, {
						placeholder: 'Please provide a name for the new branch',
						titleContext: ` based on ${getReferenceLabel(state.reference, {
							icon: false,
						})}`,
						value: state.createBranch ?? getNameWithoutRemote(state.reference),
					});
					if (result === StepResultBreak) continue;

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
				if (result === StepResultBreak) continue;

				if (result === 'switch+fast-forward') {
					state.fastForwardTo = context.switchToLocalFrom;
				}
			}

			endSteps(state);
			void this.execute(state as SwitchStepState);
		}

		return state.counter < 0 ? StepResultBreak : undefined;
	}

	private *confirmStep(state: SwitchStepState, context: Context): StepResultGenerator<ConfirmationChoice> {
		let additionalConfirmations: QuickPickItemOfT<ConfirmationChoice>[];
		if (context.switchToLocalFrom != null && state.repos.length === 1) {
			additionalConfirmations = [
				{
					label: `${context.title} and Fast-Forward`,
					description: '',
					detail: `Will switch to and fast-forward local ${getReferenceLabel(state.reference)} in $(repo) ${
						state.repos[0].formattedName
					}`,
					item: 'switch+fast-forward',
				},
			];
		} else {
			additionalConfirmations = [];
		}

		const step: QuickPickStep<QuickPickItemOfT<ConfirmationChoice>> = this.createConfirmStep<
			QuickPickItemOfT<ConfirmationChoice>
		>(
			appendReposToTitle(`Confirm ${context.title}`, state, context),
			[
				{
					label: context.title,
					description: state.createBranch ? '-b' : '',
					detail: `Will ${
						state.createBranch
							? `create and switch to a new branch named ${state.createBranch} from ${getReferenceLabel(
									state.reference,
							  )}`
							: `switch to ${context.switchToLocalFrom != null ? 'local ' : ''}${getReferenceLabel(
									state.reference,
							  )}`
					} in ${
						state.repos.length === 1
							? `$(repo) ${state.repos[0].formattedName}`
							: `${state.repos.length} repositories`
					}`,
					item: 'switch',
				},
				...additionalConfirmations,
			],
			undefined,
			{ placeholder: `Confirm ${context.title}` },
		);
		const selection: StepSelection<typeof step> = yield step;
		return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
	}
}

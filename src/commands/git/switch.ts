'use strict';
import { ProgressLocation, QuickPickItem, window } from 'vscode';
import { Container } from '../../container';
import { GitReference, Repository } from '../../git/git';
import {
	appendReposToTitle,
	inputBranchNameStep,
	PartialStepState,
	pickBranchOrTagStepMultiRepo,
	pickRepositoriesStep,
	QuickCommand,
	QuickPickStep,
	StepGenerator,
	StepResult,
	StepResultGenerator,
	StepSelection,
	StepState,
} from '../quickCommand';
import { Arrays } from '../../system';

interface Context {
	repos: Repository[];
	showTags: boolean;
	title: string;
}

interface State {
	repos: string | string[] | Repository | Repository[];
	reference: GitReference;
	createBranch?: string;
}

type SwitchStepState<T extends State = State> = ExcludeSome<StepState<T>, 'repos', string | string[] | Repository>;

export interface SwitchGitCommandArgs {
	readonly command: 'switch';
	confirm?: boolean;
	state?: Partial<State>;
}

export class SwitchGitCommand extends QuickCommand<State> {
	constructor(args?: SwitchGitCommandArgs) {
		super('switch', 'switch', 'Switch', {
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
		return void (await window.withProgress(
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
		));
	}

	isMatch(name: string) {
		return super.isMatch(name) || name === 'checkout';
	}

	protected async *steps(state: PartialStepState<State>): StepGenerator {
		const context: Context = {
			repos: [...(await Container.git.getOrderedRepositories())],
			showTags: false,
			title: this.title,
		};

		if (state.repos != null && !Array.isArray(state.repos)) {
			state.repos = [state.repos] as string[] | Repository[];
		}

		let skippedStepOne = false;

		while (this.canStepsContinue(state)) {
			context.title = this.title;

			if (
				state.counter < 1 ||
				state.repos == null ||
				state.repos.length === 0 ||
				Arrays.isStringArray(state.repos)
			) {
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
					placeholder: context => `Choose a branch${context.showTags ? ' or tag' : ''} to switch to`,
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
				context.title = `Create Branch and ${this.title}`;

				const branches = await Container.git.getBranches(state.reference.repoPath, {
					filter: b => b.tracking === state.reference!.name,
				});

				if (branches.length === 0) {
					const result = yield* inputBranchNameStep(state as SwitchStepState, context, {
						placeholder: 'Please provide a name for the new branch',
						titleContext: ` based on ${GitReference.toString(state.reference, {
							icon: false,
						})}`,
						value: state.createBranch ?? GitReference.getNameWithoutRemote(state.reference),
					});
					if (result === StepResult.Break) continue;

					state.createBranch = result;
				} else {
					state.createBranch = undefined;
				}
			} else {
				state.createBranch = undefined;
			}

			if (this.confirm(state.confirm)) {
				const result = yield* this.confirmStep(state as SwitchStepState, context);
				if (result === StepResult.Break) continue;
			}

			QuickCommand.endSteps(state);
			void this.execute(state as SwitchStepState);
		}

		return state.counter < 0 ? StepResult.Break : undefined;
	}

	private *confirmStep(state: SwitchStepState, context: Context): StepResultGenerator<void> {
		const step: QuickPickStep<QuickPickItem> = this.createConfirmStep(
			appendReposToTitle(`Confirm ${context.title}`, state, context),
			[
				{
					label: context.title,
					description: state.createBranch ? '-b' : '',
					detail: `Will ${
						state.createBranch
							? `create and switch to a new branch named ${
									state.createBranch
							  } from ${GitReference.toString(state.reference)}`
							: `switch to ${GitReference.toString(state.reference)}`
					} in ${
						state.repos.length === 1
							? `$(repo) ${state.repos[0].formattedName}`
							: `${state.repos.length} repositories`
					}`,
				},
			],
			undefined,
			{ placeholder: `Confirm ${context.title}` },
		);
		const selection: StepSelection<typeof step> = yield step;
		return QuickCommand.canPickStepContinue(step, state, selection) ? undefined : StepResult.Break;
	}
}

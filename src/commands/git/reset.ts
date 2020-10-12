'use strict';
import { Container } from '../../container';
import { GitBranch, GitLog, GitReference, GitRevisionReference, Repository } from '../../git/git';
import {
	appendReposToTitle,
	PartialStepState,
	pickCommitStep,
	pickRepositoryStep,
	QuickCommand,
	QuickPickStep,
	StepGenerator,
	StepResult,
	StepResultGenerator,
	StepSelection,
	StepState,
} from '../quickCommand';
import { FlagsQuickPickItem } from '../../quickpicks';

interface Context {
	repos: Repository[];
	cache: Map<string, Promise<GitLog | undefined>>;
	destination: GitBranch;
	title: string;
}

type Flags = '--hard' | '--soft';

interface State {
	repo: string | Repository;
	reference: GitRevisionReference;
	flags: Flags[];
}

export interface ResetGitCommandArgs {
	readonly command: 'reset';
	confirm?: boolean;
	state?: Partial<State>;
}

type ResetStepState<T extends State = State> = ExcludeSome<StepState<T>, 'repo', string>;

export class ResetGitCommand extends QuickCommand<State> {
	constructor(args?: ResetGitCommandArgs) {
		super('reset', 'reset', 'Reset', { description: 'resets the current branch to a specified commit' });

		let counter = 0;
		if (args?.state?.repo != null) {
			counter++;
		}

		if (args?.state?.reference != null) {
			counter++;
		}

		this.initialState = {
			counter: counter,
			confirm: args?.confirm ?? true,
			...args?.state,
		};
		this._canSkipConfirm = !this.initialState.confirm;
	}

	private _canSkipConfirm: boolean = false;
	get canSkipConfirm(): boolean {
		return this._canSkipConfirm;
	}

	execute(state: ResetStepState) {
		return state.repo.reset(...state.flags, state.reference.ref);
	}

	protected async *steps(state: PartialStepState<State>): StepGenerator {
		const context: Context = {
			repos: [...(await Container.git.getOrderedRepositories())],
			cache: new Map<string, Promise<GitLog | undefined>>(),
			destination: undefined!,
			title: this.title,
		};

		if (state.flags == null) {
			state.flags = [];
		}

		let skippedStepOne = false;

		while (this.canStepsContinue(state)) {
			context.title = this.title;

			if (state.counter < 1 || state.repo == null || typeof state.repo === 'string') {
				skippedStepOne = false;
				if (context.repos.length === 1) {
					skippedStepOne = true;
					state.counter++;

					state.repo = context.repos[0];
				} else {
					const result = yield* pickRepositoryStep(state, context);
					// Always break on the first step (so we will go back)
					if (result === StepResult.Break) break;

					state.repo = result;
				}
			}

			if (context.destination == null) {
				const branch = await state.repo.getBranch();
				if (branch == null) break;

				context.destination = branch;
			}

			context.title = `${this.title} ${GitReference.toString(context.destination, { icon: false })}`;

			if (state.counter < 2 || state.reference == null) {
				const ref = context.destination.ref;

				let log = context.cache.get(ref);
				if (log == null) {
					log = Container.git.getLog(state.repo.path, { ref: ref, merges: false });
					context.cache.set(ref, log);
				}

				const result: StepResult<GitReference> = yield* pickCommitStep(state as ResetStepState, context, {
					log: await log,
					onDidLoadMore: log => context.cache.set(ref, Promise.resolve(log)),
					placeholder: (context, log) =>
						log == null
							? `${context.destination.name} has no commits`
							: `Choose a commit to reset ${context.destination.name} to`,
					picked: state.reference?.ref,
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

			if (this.confirm(state.confirm)) {
				const result = yield* this.confirmStep(state as ResetStepState, context);
				if (result === StepResult.Break) continue;

				state.flags = result;
			}

			QuickCommand.endSteps(state);
			this.execute(state as ResetStepState);
		}

		return state.counter < 0 ? StepResult.Break : undefined;
	}

	private *confirmStep(state: ResetStepState, context: Context): StepResultGenerator<Flags[]> {
		const step: QuickPickStep<FlagsQuickPickItem<Flags>> = this.createConfirmStep(
			appendReposToTitle(`Confirm ${context.title}`, state, context),
			[
				FlagsQuickPickItem.create<Flags>(state.flags, [], {
					label: this.title,
					detail: `Will reset (leaves changes in the working tree) ${GitReference.toString(
						context.destination,
					)} to ${GitReference.toString(state.reference)}`,
				}),
				FlagsQuickPickItem.create<Flags>(state.flags, ['--soft'], {
					label: `Soft ${this.title}`,
					description: '--soft',
					detail: `Will soft reset (leaves changes in the index and working tree) ${GitReference.toString(
						context.destination,
					)} to ${GitReference.toString(state.reference)}`,
				}),
				FlagsQuickPickItem.create<Flags>(state.flags, ['--hard'], {
					label: `Hard ${this.title}`,
					description: '--hard',
					detail: `Will hard reset (discards all changes) ${GitReference.toString(
						context.destination,
					)} to ${GitReference.toString(state.reference)}`,
				}),
			],
		);
		const selection: StepSelection<typeof step> = yield step;
		return QuickCommand.canPickStepContinue(step, state, selection) ? selection[0].item : StepResult.Break;
	}
}

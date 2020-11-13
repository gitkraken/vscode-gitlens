'use strict';
import { Container } from '../../container';
import { GitBranch, GitLog, GitReference, GitRevision, Repository } from '../../git/git';
import {
	appendReposToTitle,
	PartialStepState,
	pickBranchOrTagStep,
	pickCommitsStep,
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
	selectedBranchOrTag: GitReference | undefined;
	showTags: boolean;
	title: string;
}

type Flags = '--edit';

interface State<Refs = GitReference | GitReference[]> {
	repo: string | Repository;
	references: Refs;
	flags: Flags[];
}

export interface CherryPickGitCommandArgs {
	readonly command: 'cherry-pick';
	state?: Partial<State>;
}

type CherryPickStepState<T extends State = State> = ExcludeSome<StepState<T>, 'repo', string>;

export class CherryPickGitCommand extends QuickCommand<State> {
	constructor(args?: CherryPickGitCommandArgs) {
		super('cherry-pick', 'cherry-pick', 'Cherry Pick', {
			description: 'integrates changes from specified commits into the current branch',
		});

		let counter = 0;
		if (args?.state?.repo != null) {
			counter++;
		}

		if (
			args?.state?.references != null &&
			(!Array.isArray(args.state.references) || args.state.references.length !== 0)
		) {
			counter++;
		}

		this.initialState = {
			counter: counter,
			confirm: true,
			...args?.state,
		};
	}

	get canSkipConfirm(): boolean {
		return false;
	}

	execute(state: CherryPickStepState<State<GitReference[]>>) {
		state.repo.cherryPick(...state.flags, ...state.references.map(c => c.ref).reverse());
	}

	isFuzzyMatch(name: string) {
		return super.isFuzzyMatch(name) || name === 'cherry';
	}

	protected async *steps(state: PartialStepState<State>): StepGenerator {
		const context: Context = {
			repos: [...(await Container.git.getOrderedRepositories())],
			cache: new Map<string, Promise<GitLog | undefined>>(),
			destination: undefined!,
			selectedBranchOrTag: undefined,
			showTags: true,
			title: this.title,
		};

		if (state.flags == null) {
			state.flags = [];
		}

		if (state.references != null && !Array.isArray(state.references)) {
			state.references = [state.references];
		}

		let skippedStepOne = false;

		while (this.canStepsContinue(state)) {
			context.title = this.title;

			if (state.counter < 1 || state.repo == null || typeof state.repo === 'string') {
				skippedStepOne = false;
				if (context.repos.length === 1) {
					skippedStepOne = true;
					if (state.repo == null) {
						state.counter++;
					}

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

			context.title = `${this.title} into ${GitReference.toString(context.destination, { icon: false })}`;

			if (state.counter < 2 || state.references == null || state.references.length === 0) {
				const result: StepResult<GitReference> = yield* pickBranchOrTagStep(
					state as CherryPickStepState,
					context,
					{
						filter: { branches: b => b.id !== context.destination.id },
						placeholder: context =>
							`Choose a branch${context.showTags ? ' or tag' : ''} to cherry-pick from`,
						picked: context.selectedBranchOrTag?.ref,
						value: context.selectedBranchOrTag == null ? state.references?.[0]?.ref : undefined,
					},
				);
				if (result === StepResult.Break) {
					// If we skipped the previous step, make sure we back up past it
					if (skippedStepOne) {
						state.counter--;
					}

					continue;
				}

				if (GitReference.isRevision(result)) {
					state.references = [result];
					context.selectedBranchOrTag = undefined;
				} else {
					context.selectedBranchOrTag = result;
				}
			}

			if (state.counter < 3 && context.selectedBranchOrTag != null) {
				const ref = GitRevision.createRange(context.destination.ref, context.selectedBranchOrTag.ref);

				let log = context.cache.get(ref);
				if (log == null) {
					log = Container.git.getLog(state.repo.path, { ref: ref, merges: false });
					context.cache.set(ref, log);
				}

				const result: StepResult<GitReference[]> = yield* pickCommitsStep(
					state as CherryPickStepState,
					context,
					{
						log: await log,
						onDidLoadMore: log => context.cache.set(ref, Promise.resolve(log)),
						picked: state.references?.map(r => r.ref),
						placeholder: (context, log) =>
							log == null
								? `No pickable commits found on ${GitReference.toString(context.selectedBranchOrTag, {
										icon: false,
								  })}`
								: `Choose commits to cherry-pick into ${GitReference.toString(context.destination, {
										icon: false,
								  })}`,
					},
				);
				if (result === StepResult.Break) continue;

				state.references = result;
			}

			if (this.confirm(state.confirm)) {
				const result = yield* this.confirmStep(state as CherryPickStepState, context);
				if (result === StepResult.Break) continue;

				state.flags = result;
			}

			QuickCommand.endSteps(state);
			this.execute(state as CherryPickStepState<State<GitReference[]>>);
		}

		return state.counter < 0 ? StepResult.Break : undefined;
	}

	private *confirmStep(state: CherryPickStepState, context: Context): StepResultGenerator<Flags[]> {
		const step: QuickPickStep<FlagsQuickPickItem<Flags>> = QuickCommand.createConfirmStep(
			appendReposToTitle(`Confirm ${context.title}`, state, context),
			[
				FlagsQuickPickItem.create<Flags>(state.flags, [], {
					label: this.title,
					detail: `Will apply ${GitReference.toString(state.references)} to ${GitReference.toString(
						context.destination,
					)}`,
				}),
				FlagsQuickPickItem.create<Flags>(state.flags, ['--edit'], {
					label: `${this.title} & Edit`,
					description: '--edit',
					detail: `Will edit and apply ${GitReference.toString(state.references)} to ${GitReference.toString(
						context.destination,
					)}`,
				}),
			],
			context,
		);
		const selection: StepSelection<typeof step> = yield step;
		return QuickCommand.canPickStepContinue(step, state, selection) ? selection[0].item : StepResult.Break;
	}
}

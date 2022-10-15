import * as nls from 'vscode-nls';
import type { Container } from '../../container';
import type { GitBranch } from '../../git/models/branch';
import type { GitLog } from '../../git/models/log';
import type { GitRevisionReference } from '../../git/models/reference';
import { GitReference } from '../../git/models/reference';
import type { Repository } from '../../git/models/repository';
import { FlagsQuickPickItem } from '../../quickpicks/items/flags';
import type { ViewsWithRepositoryFolders } from '../../views/viewBase';
import type {
	PartialStepState,
	QuickPickStep,
	StepGenerator,
	StepResultGenerator,
	StepSelection,
	StepState,
} from '../quickCommand';
import { appendReposToTitle, pickCommitsStep, pickRepositoryStep, QuickCommand, StepResult } from '../quickCommand';

const localize = nls.loadMessageBundle();
interface Context {
	repos: Repository[];
	associatedView: ViewsWithRepositoryFolders;
	cache: Map<string, Promise<GitLog | undefined>>;
	destination: GitBranch;
	title: string;
}

type Flags = '--edit' | '--no-edit';

interface State<Refs = GitRevisionReference | GitRevisionReference[]> {
	repo: string | Repository;
	references: Refs;
	flags: Flags[];
}

export interface RevertGitCommandArgs {
	readonly command: 'revert';
	state?: Partial<State>;
}

type RevertStepState<T extends State = State> = ExcludeSome<StepState<T>, 'repo', string>;

export class RevertGitCommand extends QuickCommand<State> {
	constructor(container: Container, args?: RevertGitCommandArgs) {
		super(container, 'revert', localize('label', 'revert'), localize('title', 'Revert'), {
			description: localize(
				'description',
				'undoes the changes of specified commits, by creating new commits with inverted changes',
			),
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

	override get canSkipConfirm(): boolean {
		return false;
	}

	execute(state: RevertStepState<State<GitRevisionReference[]>>) {
		return state.repo.revert(...state.flags, ...state.references.map(c => c.ref).reverse());
	}

	protected async *steps(state: PartialStepState<State>): StepGenerator {
		const context: Context = {
			repos: this.container.git.openRepositories,
			associatedView: this.container.commitsView,
			cache: new Map<string, Promise<GitLog | undefined>>(),
			destination: undefined!,
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

			if (state.counter < 2 || state.references == null || state.references.length === 0) {
				const ref = context.destination.ref;

				let log = context.cache.get(ref);
				if (log == null) {
					log = this.container.git.getLog(state.repo.path, { ref: ref, merges: false });
					context.cache.set(ref, log);
				}

				const result: StepResult<GitRevisionReference[]> = yield* pickCommitsStep(
					state as RevertStepState,
					context,
					{
						log: await log,
						onDidLoadMore: log => context.cache.set(ref, Promise.resolve(log)),
						placeholder: (context, log) =>
							log == null
								? localize(
										'pickCommitsStep.placeholder.branchHasNoCommits',
										'{0} has no commits',
										context.destination.name,
								  )
								: localize(
										'pickCommitsStep.placeholder.chooseCommitsToRevert',
										'Choose commits to revert',
								  ),
						picked: state.references?.map(r => r.ref),
					},
				);
				if (result === StepResult.Break) {
					// If we skipped the previous step, make sure we back up past it
					if (skippedStepOne) {
						state.counter--;
					}

					continue;
				}

				state.references = result;
			}

			const result = yield* this.confirmStep(state as RevertStepState, context);
			if (result === StepResult.Break) continue;

			state.flags = result;

			QuickCommand.endSteps(state);
			this.execute(state as RevertStepState<State<GitRevisionReference[]>>);
		}

		return state.counter < 0 ? StepResult.Break : undefined;
	}

	private *confirmStep(state: RevertStepState, context: Context): StepResultGenerator<Flags[]> {
		const step: QuickPickStep<FlagsQuickPickItem<Flags>> = this.createConfirmStep(
			appendReposToTitle(localize('confirm', 'Confirm {0}', context.title), state, context),
			[
				FlagsQuickPickItem.create<Flags>(state.flags, ['--no-edit'], {
					label: this.title,
					description: '--no-edit',
					detail: localize(
						'confirmStep.quickPick.noEdit.detail',
						'Will revert {0}',
						GitReference.toString(state.references),
					),
				}),
				FlagsQuickPickItem.create<Flags>(state.flags, ['--edit'], {
					label: localize('confirmStep.quickPick.edit.label', '{0} & Edit', this.title),
					description: '--edit',
					detail: localize(
						'confirmStep.quickPick.edit.detail',
						'Will revert and edit {0}',
						GitReference.toString(state.references),
					),
				}),
			],
		);
		const selection: StepSelection<typeof step> = yield step;
		return QuickCommand.canPickStepContinue(step, state, selection) ? selection[0].item : StepResult.Break;
	}
}

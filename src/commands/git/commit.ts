'use strict';
import { Container } from '../../container';
import { GitLog, GitReference, GitRevisionReference, Repository } from '../../git/models';
import { FlagsQuickPickItem } from '../../quickpicks';
import { ViewsWithRepositoryFolders } from '../../views/viewBase';
import {
	appendReposToTitle,
	PartialStepState,
	pickRepositoryStep,
	QuickCommand,
	QuickPickStep,
	StepGenerator,
	StepResult,
	StepResultGenerator,
	StepSelection,
	StepState,
} from '../quickCommand';

interface Context {
	repos: Repository[];
	associatedView: ViewsWithRepositoryFolders;
	cache: Map<string, Promise<GitLog | undefined>>;
	selectedBranchOrTag: GitReference | undefined;
	showTags: boolean;
	title: string;
}

type Flags = '--fixup';

interface State {
	repo: string | Repository;
	reference: GitRevisionReference;
	flags: Flags[];
}

export interface CommitGitCommandArgs {
	readonly command: 'commit';
	state?: Partial<State>;
}

type CommitStepState<T extends State = State> = ExcludeSome<StepState<T>, 'repo', string>;

export class CommitGitCommand extends QuickCommand<State> {
	constructor(args?: CommitGitCommandArgs) {
		super('commit', 'commit', 'Commit', {
			description: 'Use to add or modify commits',
		});

		let counter = 0;
		if (args?.state?.repo != null) {
			counter++;
		}

		this.initialState = {
			counter: counter,
			confirm: true,
			...args?.state,
		};
	}

	override get canSkipConfirm(): boolean {
		return true;
	}

	execute(state: CommitStepState) {
		const args: string[] = state.flags;
		if (args.includes('--fixup') && state.reference != null) {
			args.splice(args.indexOf('--fixup') + 1, 0, state.reference.ref);
		}

		console.log(args);
		return state.repo.commit(...args);
	}

	protected async *steps(state: PartialStepState<State>): StepGenerator {
		const context: Context = {
			repos: Container.instance.git.openRepositories,
			associatedView: Container.instance.commitsView,
			cache: new Map<string, Promise<GitLog | undefined>>(),
			selectedBranchOrTag: undefined,
			showTags: true,
			title: this.title,
		};

		if (state.flags == null) {
			state.flags = [];
		}

		while (this.canStepsContinue(state)) {
			context.title = this.title;

			if (state.counter < 1 || state.repo == null || typeof state.repo === 'string') {
				if (context.repos.length === 1) {
					state.repo = context.repos[0];
				} else {
					const result = yield* pickRepositoryStep(state, context);
					// Always break on the first step (so we will go back)
					if (result === StepResult.Break) break;

					state.repo = result;
				}
			}

			context.title = `${this.title} as a fixup coommit to  ${GitReference.toString(state.reference, {
				icon: false,
			})}`;

			if (this.confirm(state.confirm)) {
				const result = yield* this.confirmStep(state as CommitStepState, context);
				if (result === StepResult.Break) continue;

				state.flags = result;
			}

			QuickCommand.endSteps(state);
			this.execute(state as CommitStepState<State>);
		}

		return state.counter < 0 ? StepResult.Break : undefined;
	}

	private *confirmStep(state: CommitStepState, context: Context): StepResultGenerator<Flags[]> {
		const step: QuickPickStep<FlagsQuickPickItem<Flags>> = QuickCommand.createConfirmStep(
			appendReposToTitle(`Confirm ${context.title}`, state, context),
			[
				FlagsQuickPickItem.create<Flags>(state.flags, ['--fixup'], {
					label: `${this.title} as a fixup commit`,
					description: '--edit',
					detail: `Will commit as a fixup commit to ${GitReference.toString(state.reference)}`,
				}),
			],
			context,
		);
		const selection: StepSelection<typeof step> = yield step;
		return QuickCommand.canPickStepContinue(step, state, selection) ? selection[0].item : StepResult.Break;
	}
}

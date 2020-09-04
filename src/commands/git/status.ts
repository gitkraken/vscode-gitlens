'use strict';
import { GlyphChars } from '../../constants';
import { Container } from '../../container';
import { GitReference, GitStatus, Repository } from '../../git/git';
import {
	PartialStepState,
	pickRepositoryStep,
	QuickCommand,
	showRepositoryStatusStep,
	StepGenerator,
	StepResult,
	StepState,
} from '../quickCommand';
import { CommandQuickPickItem, GitCommandQuickPickItem } from '../../quickpicks';
import { Strings } from '../../system';

interface Context {
	repos: Repository[];
	status: GitStatus;
	title: string;
}

interface State {
	repo: string | Repository;
}

export interface StatusGitCommandArgs {
	readonly command: 'status';
	state?: Partial<State>;
}

type StatusStepState<T extends State = State> = ExcludeSome<StepState<T>, 'repo', string>;

export class StatusGitCommand extends QuickCommand<State> {
	constructor(args?: StatusGitCommandArgs) {
		super('status', 'status', 'Status', {
			description: 'shows status information about a repository',
		});

		let counter = 0;
		if (args?.state?.repo != null) {
			counter++;
		}

		this.initialState = {
			counter: counter,
			confirm: false,
			...args?.state,
		};
	}

	get canConfirm() {
		return false;
	}

	protected async *steps(state: PartialStepState<State>): StepGenerator {
		const context: Context = {
			repos: [...(await Container.git.getOrderedRepositories())],
			status: undefined!,
			title: this.title,
		};

		let skippedStepOne = false;

		while (this.canStepsContinue(state)) {
			context.title = this.title;

			if (
				state.counter < 1 ||
				state.repo == null ||
				typeof state.repo === 'string' ||
				!context.repos.includes(state.repo)
			) {
				skippedStepOne = false;
				if (context.repos.length === 1) {
					if (state.repo == null) {
						skippedStepOne = true;
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

			context.status = (await state.repo.getStatus())!;
			if (context.status == null) return;

			context.title = `${this.title}${Strings.pad(GlyphChars.Dot, 2, 2)}${GitReference.toString(
				GitReference.create(context.status.branch, state.repo.path, {
					refType: 'branch',
					name: context.status.branch,
					remote: false,
				}),
				{ icon: false },
			)}`;

			const result = yield* showRepositoryStatusStep(state as StatusStepState, context);
			if (result === StepResult.Break) {
				// If we skipped the previous step, make sure we back up past it
				if (skippedStepOne) {
					skippedStepOne = false;
					state.counter--;
				}

				continue;
			}

			if (result instanceof GitCommandQuickPickItem) {
				yield* result.executeSteps(this.pickedVia);
				state.counter--;

				continue;
			}

			if (result instanceof CommandQuickPickItem) {
				QuickCommand.endSteps(state);

				void result.execute();
				break;
			}
		}
	}
}

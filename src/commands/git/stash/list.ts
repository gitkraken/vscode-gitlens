import type { Container } from '../../../container.js';
import type { GitStashCommit } from '../../../git/models/commit.js';
import type { GitStashReference } from '../../../git/models/reference.js';
import type { Repository } from '../../../git/models/repository.js';
import type { PartialStepState, StepGenerator, StepResult, StepsContext } from '../../quick-wizard/models/steps.js';
import { StepResultBreak } from '../../quick-wizard/models/steps.js';
import { QuickCommand } from '../../quick-wizard/quickCommand.js';
import { pickRepositoryStep } from '../../quick-wizard/steps/repositories.js';
import { pickStashStep } from '../../quick-wizard/steps/stashes.js';
import { StepsController } from '../../quick-wizard/stepsController.js';
import { getSteps } from '../../quick-wizard/utils/quickWizard.utils.js';
import { assertStepState } from '../../quick-wizard/utils/steps.utils.js';
import type { StashContext } from '../stash.js';

const Steps = {
	PickRepo: 'stash-list-pick-repo',
	PickStash: 'stash-list-pick-stash',
	Show: 'stash-list-show',
} as const;
type StepNames = (typeof Steps)[keyof typeof Steps];
export type StashListStepNames = StepNames;

type Context = StashContext<StepNames>;

interface State<Repo = string | Repository> {
	repo: Repo;
	reference: GitStashReference | GitStashCommit;
}
export type StashListState = State;

export interface StashListGitCommandArgs {
	readonly command: 'stash-list';
	confirm?: boolean;
	state?: Partial<State>;
}

export class StashListGitCommand extends QuickCommand<State> {
	constructor(container: Container, args?: StashListGitCommandArgs) {
		super(container, 'stash-list', 'list', 'Stashes', {
			description: 'lists stashes',
		});

		this.initialState = { confirm: args?.confirm, ...args?.state };
	}

	override get canConfirm(): boolean {
		return false; // list doesn't need confirmation
	}

	protected createContext(context?: StepsContext<any>): Context {
		return {
			...context,
			container: this.container,
			repos: this.container.git.openRepositories,
			associatedView: this.container.views.stashes,
			readonly: false,
			title: this.title,
		};
	}

	protected async *steps(state: PartialStepState<State>, context?: Context): StepGenerator {
		context ??= this.createContext();
		using steps = new StepsController<StepNames>(context, this);

		while (!steps.isComplete) {
			context.title = this.title;

			if (steps.isAtStep(Steps.PickRepo) || state.repo == null || typeof state.repo === 'string') {
				if (context.repos.length === 1) {
					[state.repo] = context.repos;
				} else {
					using step = steps.enterStep(Steps.PickRepo);

					const result = yield* pickRepositoryStep(state, context, step);
					if (result === StepResultBreak) {
						state.repo = undefined!;
						if (step.goBack() == null) break;
						continue;
					}

					state.repo = result;
				}
			}

			assertStepState<State<Repository>>(state);

			if (steps.isAtStep(Steps.PickStash) || state.reference == null) {
				using step = steps.enterStep(Steps.PickStash);

				const result: StepResult<GitStashCommit> = yield* pickStashStep(state, context, {
					stash: await state.repo.git.stash?.getStash(),
					placeholder: (_context, stash) =>
						stash == null ? `No stashes found in ${state.repo.name}` : 'Choose a stash',
					picked: state.reference?.ref,
				});
				if (result === StepResultBreak) {
					state.reference = undefined!;
					if (step.goBack() == null) break;
					continue;
				}

				state.reference = result;
			}

			if (steps.isAtStepOrUnset(Steps.Show)) {
				using step = steps.enterStep(Steps.Show);

				const result = yield* getSteps(
					this.container,
					{ command: 'show', state: { repo: state.repo, reference: state.reference } },
					context,
					this.startedFrom,
				);
				if (result === StepResultBreak) {
					if (step.goBack() == null) break;
					continue;
				}

				steps.markStepsComplete();
			}
		}

		return steps.isComplete ? undefined : StepResultBreak;
	}
}

import type { Container } from '../../../container.js';
import type { GitStashReference } from '../../../git/models/reference.js';
import type { Repository } from '../../../git/models/repository.js';
import { getReferenceLabel } from '../../../git/utils/reference.utils.js';
import { showGitErrorMessage } from '../../../messages.js';
import { Logger } from '../../../system/logger.js';
import type {
	PartialStepState,
	StepGenerator,
	StepResult,
	StepResultGenerator,
	StepsContext,
	StepSelection,
	StepState,
} from '../../quick-wizard/models/steps.js';
import { StepResultBreak } from '../../quick-wizard/models/steps.js';
import { QuickCommand } from '../../quick-wizard/quickCommand.js';
import { pickRepositoryStep } from '../../quick-wizard/steps/repositories.js';
import { pickStashesStep } from '../../quick-wizard/steps/stashes.js';
import { StepsController } from '../../quick-wizard/stepsController.js';
import { appendReposToTitle, assertStepState, canPickStepContinue } from '../../quick-wizard/utils/steps.utils.js';
import type { StashContext } from '../stash.js';

const Steps = {
	PickRepo: 'stash-drop-pick-repo',
	PickStashes: 'stash-drop-pick-stashes',
	Confirm: 'stash-drop-confirm',
} as const;
type StepNames = (typeof Steps)[keyof typeof Steps];
export type StashDropStepNames = StepNames;

type Context = StashContext<StepNames>;

interface State<Repo = string | Repository> {
	repo: Repo;
	references: GitStashReference[];
}
export type StashDropState = State;

export interface StashDropGitCommandArgs {
	readonly command: 'stash-drop';
	confirm?: boolean;
	state?: Partial<State>;
}

export class StashDropGitCommand extends QuickCommand<State> {
	constructor(container: Container, args?: StashDropGitCommandArgs) {
		super(container, 'stash-drop', 'drop', 'Drop Stashes', {
			description: 'deletes stash entries',
		});

		this.initialState = { confirm: args?.confirm, ...args?.state };
	}

	override get canSkipConfirm(): boolean {
		return false; // Always require confirmation for drop
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
				// Only show the picker if there are multiple repositories
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

			if (steps.isAtStep(Steps.PickStashes) || !state.references?.length) {
				using step = steps.enterStep(Steps.PickStashes);

				const result: StepResult<GitStashReference[]> = yield* pickStashesStep(state, context, {
					stash: await state.repo.git.stash?.getStash(),
					placeholder: (_context, stash) =>
						stash == null ? `No stashes found in ${state.repo.name}` : 'Choose stashes to delete',
					picked: state.references?.map(r => r.ref),
				});
				if (result === StepResultBreak) {
					state.references = undefined!;
					if (step.goBack() == null) break;
					continue;
				}

				state.references = result;
			}

			{
				using step = steps.enterStep(Steps.Confirm);

				const result = yield* this.confirmStep(state, context);
				if (result === StepResultBreak) {
					if (step.goBack() == null) break;
					continue;
				}
			}

			steps.markStepsComplete();

			state.references.sort((a, b) => parseInt(b.stashNumber, 10) - parseInt(a.stashNumber, 10));
			for (const ref of state.references) {
				try {
					await state.repo.git.stash?.deleteStash(`stash@{${ref.stashNumber}}`, ref.ref);
				} catch (ex) {
					Logger.error(ex, context.title);
					void showGitErrorMessage(
						ex,
						`Unable to delete stash@{${ref.stashNumber}}${ref.message ? `: ${ref.message}` : ''}`,
					);
				}
			}
		}

		return steps.isComplete ? undefined : StepResultBreak;
	}

	private *confirmStep(state: StepState<State<Repository>>, context: Context): StepResultGenerator<void> {
		const step = this.createConfirmStep(
			appendReposToTitle(`Confirm ${context.title}`, state, context),
			[
				{
					label: context.title,
					detail: `Will delete ${getReferenceLabel(state.references)}`,
				},
			],
			undefined,
			{ placeholder: `Confirm ${context.title}` },
		);
		const selection: StepSelection<typeof step> = yield step;
		return canPickStepContinue(step, state, selection) ? undefined : StepResultBreak;
	}
}

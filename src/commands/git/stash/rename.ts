import type { Container } from '../../../container.js';
import { revealStash, showStashInDetailsView } from '../../../git/actions/stash.js';
import type { GitStashReference } from '../../../git/models/reference.js';
import type { Repository } from '../../../git/models/repository.js';
import { getReferenceLabel } from '../../../git/utils/reference.utils.js';
import { showGitErrorMessage } from '../../../messages.js';
import { Logger } from '../../../system/logger.js';
import type {
	AsyncStepResultGenerator,
	PartialStepState,
	StepGenerator,
	StepResult,
	StepResultGenerator,
	StepsContext,
	StepSelection,
	StepState,
} from '../../quick-wizard/models/steps.js';
import { StepResultBreak } from '../../quick-wizard/models/steps.js';
import { RevealInSideBarQuickInputButton, ShowDetailsViewQuickInputButton } from '../../quick-wizard/quickButtons.js';
import { QuickCommand } from '../../quick-wizard/quickCommand.js';
import { pickRepositoryStep } from '../../quick-wizard/steps/repositories.js';
import { pickStashStep } from '../../quick-wizard/steps/stashes.js';
import { StepsController } from '../../quick-wizard/stepsController.js';
import {
	appendReposToTitle,
	assertStepState,
	canInputStepContinue,
	canPickStepContinue,
	canStepContinue,
	createInputStep,
} from '../../quick-wizard/utils/steps.utils.js';
import type { StashContext } from '../stash.js';

const Steps = {
	PickRepo: 'stash-rename-pick-repo',
	PickStash: 'stash-rename-pick-stash',
	InputMessage: 'stash-rename-input-message',
	Confirm: 'stash-rename-confirm',
} as const;
type StepNames = (typeof Steps)[keyof typeof Steps];
export type StashRenameStepNames = StepNames;

type Context = StashContext<StepNames>;

interface State<Repo = string | Repository> {
	repo: Repo;
	reference: GitStashReference;
	message: string;
}
export type StashRenameState = State;

export interface StashRenameGitCommandArgs {
	readonly command: 'stash-rename';
	confirm?: boolean;
	state?: Partial<State>;
}

export class StashRenameGitCommand extends QuickCommand<State> {
	constructor(container: Container, args?: StashRenameGitCommandArgs) {
		super(container, 'stash-rename', 'rename', 'Rename Stash', {
			description: 'renames a stash',
		});

		this.initialState = { confirm: args?.confirm, ...args?.state };
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

			if (steps.isAtStep(Steps.PickStash) || state.reference == null) {
				using step = steps.enterStep(Steps.PickStash);

				const result: StepResult<GitStashReference> = yield* pickStashStep(state, context, {
					stash: await state.repo.git.stash?.getStash(),
					placeholder: (_context, stash) =>
						stash == null ? `No stashes found in ${state.repo.name}` : 'Choose a stash to rename',
					picked: state.reference?.ref,
				});
				if (result === StepResultBreak) {
					state.reference = undefined!;
					if (step.goBack() == null) break;
					continue;
				}

				state.reference = result;
			}

			if (steps.isAtStep(Steps.InputMessage) || state.message == null) {
				using step = steps.enterStep(Steps.InputMessage);

				const result: StepResult<string> = yield* this.inputMessageStep(state, context);
				if (result === StepResultBreak) {
					state.message = undefined!;
					if (step.goBack() == null) break;
					continue;
				}

				state.message = result;
			}

			if (this.confirm(state.confirm)) {
				using step = steps.enterStep(Steps.Confirm);

				const result = yield* this.confirmStep(state, context);
				if (result === StepResultBreak) {
					if (step.goBack() == null) break;
					continue;
				}
			}

			steps.markStepsComplete();

			try {
				await state.repo.git.stash?.renameStash(
					state.reference.name,
					state.reference.ref,
					state.message,
					state.reference.stashOnRef,
				);
			} catch (ex) {
				Logger.error(ex, context.title);
				void showGitErrorMessage(ex, 'Unable to rename stash');
			}
		}

		return steps.isComplete ? undefined : StepResultBreak;
	}

	private async *inputMessageStep(
		state: StepState<State<Repository>>,
		context: Context,
	): AsyncStepResultGenerator<string> {
		const step = createInputStep({
			title: appendReposToTitle(context.title, state, context),
			placeholder: 'Stash message',
			value: state.message ?? state.reference?.message,
			prompt: `Please provide a new message for ${getReferenceLabel(state.reference, { icon: false })}`,
		});

		const value: StepSelection<typeof step> = yield step;
		if (!canStepContinue(step, state, value) || !(await canInputStepContinue(step, state, value))) {
			return StepResultBreak;
		}

		return value;
	}

	private *confirmStep(state: StepState<State<Repository>>, context: Context): StepResultGenerator<void> {
		const step = this.createConfirmStep(
			appendReposToTitle(`Confirm ${context.title}`, state, context),
			[
				{
					label: context.title,
					detail: `Will rename ${getReferenceLabel(state.reference)}`,
				},
			],
			undefined,
			{
				placeholder: `Confirm ${context.title}`,
				additionalButtons: [ShowDetailsViewQuickInputButton, RevealInSideBarQuickInputButton],
				onDidClickButton: (_quickpick, button) => {
					if (button === ShowDetailsViewQuickInputButton) {
						void showStashInDetailsView(state.reference, { pin: false, preserveFocus: true });
					} else if (button === RevealInSideBarQuickInputButton) {
						void revealStash(state.reference, { select: true, expand: true });
					}
				},
			},
		);
		const selection: StepSelection<typeof step> = yield step;
		return canPickStepContinue(step, state, selection) ? undefined : StepResultBreak;
	}
}

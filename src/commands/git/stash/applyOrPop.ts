import { window } from 'vscode';
import type { Container } from '../../../container.js';
import { revealStash, showStashInDetailsView } from '../../../git/actions/stash.js';
import { StashApplyError } from '../../../git/errors.js';
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
import { RevealInSideBarQuickInputButton, ShowDetailsViewQuickInputButton } from '../../quick-wizard/quickButtons.js';
import { QuickCommand } from '../../quick-wizard/quickCommand.js';
import { pickRepositoryStep } from '../../quick-wizard/steps/repositories.js';
import { pickStashStep } from '../../quick-wizard/steps/stashes.js';
import { StepsController } from '../../quick-wizard/stepsController.js';
import { appendReposToTitle, assertStepState, canPickStepContinue } from '../../quick-wizard/utils/steps.utils.js';
import type { StashContext } from '../stash.js';

const Steps = {
	PickRepo: 'stash-apply-or-pop-pick-repo',
	PickStash: 'stash-apply-or-pop-pick-stash',
	Confirm: 'stash-apply-or-pop-confirm',
} as const;
type StepNames = (typeof Steps)[keyof typeof Steps];
export type StashApplyOrPopStepNames = StepNames;

type Context = StashContext<StepNames>;

type Mode = 'apply' | 'pop';
interface State<Repo = string | Repository> {
	mode: Mode;
	repo: Repo;
	reference: GitStashReference;
}
export type StashApplyOrPopState = State;

export interface StashApplyOrPopGitCommandArgs {
	readonly command: 'stash-apply' | 'stash-pop';
	confirm?: boolean;
	state?: Partial<State>;
}

export class StashApplyOrPopGitCommand extends QuickCommand<State> {
	private readonly mode: Mode;

	constructor(container: Container, args?: StashApplyOrPopGitCommandArgs) {
		const mode = args?.command === 'stash-pop' ? 'pop' : 'apply';
		super(container, `stash.${mode}`, mode, mode === 'pop' ? 'Pop Stash' : 'Apply Stash', {
			description: mode === 'pop' ? 'applies and deletes a stash' : 'applies a stash to the working tree',
		});

		this.mode = mode;
		this.initialState = { confirm: args?.confirm, mode: mode, ...args?.state };
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
						stash == null
							? `No stashes found in ${state.repo.name}`
							: state.mode === 'pop'
								? 'Choose a stash to pop'
								: 'Choose a stash to apply to your working tree',
					picked: state.reference?.ref,
				});
				if (result === StepResultBreak) {
					state.reference = undefined!;
					if (step.goBack() == null) break;
					continue;
				}

				state.reference = result;
			}

			if (this.confirm(state.confirm)) {
				using step = steps.enterStep(Steps.Confirm);

				const result = yield* this.confirmStep(state, context);
				if (result === StepResultBreak) {
					state.mode = this.mode;
					if (step.goBack() == null) break;
					continue;
				}

				state.mode = result;
			}

			steps.markStepsComplete();

			try {
				await state.repo.git.stash?.applyStash(
					state.mode === 'pop' ? `stash@{${state.reference.stashNumber}}` : state.reference.ref,
					{ deleteAfter: state.mode === 'pop' },
				);

				if (state.reference.message) {
					const scmRepo = await state.repo.git.getScmRepository();
					if (scmRepo != null && !scmRepo.inputBox.value) {
						scmRepo.inputBox.value = state.reference.message;
					}
				}
			} catch (ex) {
				Logger.error(ex, context.title);

				if (StashApplyError.is(ex, 'uncommittedChanges')) {
					void window.showWarningMessage(
						'Unable to apply stash. Your local changes would be overwritten. Please commit or stash your changes before trying again.',
					);
				} else {
					void showGitErrorMessage(ex, StashApplyError.is(ex) ? undefined : 'Unable to apply stash');
				}
			}
		}

		return steps.isComplete ? undefined : StepResultBreak;
	}

	private *confirmStep(state: StepState<State<Repository>>, context: Context): StepResultGenerator<Mode> {
		const step = this.createConfirmStep<{ label: string; detail: string; item: Mode }>(
			appendReposToTitle(`Confirm ${context.title}`, state, context),
			[
				{
					label: context.title,
					detail:
						this.mode === 'pop'
							? `Will delete ${getReferenceLabel(
									state.reference,
								)} and apply the changes to the working tree`
							: `Will apply the changes from ${getReferenceLabel(state.reference)} to the working tree`,
					item: this.mode,
				},
				{
					label: this.mode === 'pop' ? 'Apply Stash' : 'Pop Stash',
					detail:
						this.mode === 'pop'
							? `Will apply the changes from ${getReferenceLabel(state.reference)} to the working tree`
							: `Will delete ${getReferenceLabel(
									state.reference,
								)} and apply the changes to the working tree`,
					item: this.mode === 'pop' ? 'apply' : 'pop',
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
		return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
	}
}

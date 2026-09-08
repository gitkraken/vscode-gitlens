import { l10n } from 'vscode';
import type { GitStashReference } from '@gitlens/git/models/reference.js';
import { getReferenceLabel } from '@gitlens/git/utils/reference.utils.js';
import { Logger } from '@gitlens/utils/logger.js';
import type { Container } from '../../../container.js';
import type { GlRepository } from '../../../git/models/repository.js';
import { showGitErrorMessage } from '../../../messages.js';
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
import { canSkipRepositoryPick, pickRepositoryStep } from '../../quick-wizard/steps/repositories.js';
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

interface State<Repo = string | GlRepository> {
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
		super(container, 'stash-drop', 'drop', l10n.t('Drop Stashes'), {
			description: l10n.t('deletes stash entries'),
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
				// Skip the picker only when the sole available repo is the one requested
				if (canSkipRepositoryPick(context.repos, state.repo)) {
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

			assertStepState<State<GlRepository>>(state);

			if (steps.isAtStep(Steps.PickStashes) || !state.references?.length) {
				using step = steps.enterStep(Steps.PickStashes);

				const result: StepResult<GitStashReference[]> = yield* pickStashesStep(state, context, {
					stash: await state.repo.git.stash?.getStash(),
					placeholder: (_context, stash) =>
						stash == null
							? l10n.t('No stashes found in {0}', state.repo.name)
							: l10n.t('Choose stashes to delete'),
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
					Logger.error(ex, 'Drop Stashes');
					const stashRef = `stash@{${ref.stashNumber}}`;
					void showGitErrorMessage(
						ex,
						ref.message
							? l10n.t('Unable to delete {0}: {1}', stashRef, ref.message)
							: l10n.t('Unable to delete {0}', stashRef),
					);
				}
			}
		}

		return steps.isComplete ? undefined : StepResultBreak;
	}

	private *confirmStep(state: StepState<State<GlRepository>>, context: Context): StepResultGenerator<void> {
		const confirmTitle = l10n.t('Confirm Drop Stashes');
		const step = this.createConfirmStep(
			appendReposToTitle(confirmTitle, state, context),
			[
				{
					label: context.title,
					detail: l10n.t('Will delete {0}', getReferenceLabel(state.references)),
				},
			],
			confirmTitle,
		);
		const selection: StepSelection<typeof step> = yield step;
		return canPickStepContinue(step, state, selection) ? undefined : StepResultBreak;
	}
}

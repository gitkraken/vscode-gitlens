import type { Container } from '../../../container.js';
import { BranchError } from '../../../git/errors.js';
import type { GitBranchReference } from '../../../git/models/reference.js';
import type { Repository } from '../../../git/models/repository.js';
import { getReferenceLabel } from '../../../git/utils/reference.utils.js';
import { showGitErrorMessage } from '../../../messages.js';
import type { FlagsQuickPickItem } from '../../../quickpicks/items/flags.js';
import { createFlagsQuickPickItem } from '../../../quickpicks/items/flags.js';
import { Logger } from '../../../system/logger.js';
import type {
	PartialStepState,
	StepGenerator,
	StepResultGenerator,
	StepsContext,
	StepSelection,
	StepState,
} from '../../quick-wizard/models/steps.js';
import { StepResultBreak } from '../../quick-wizard/models/steps.js';
import type { QuickPickStep } from '../../quick-wizard/models/steps.quickpick.js';
import { QuickCommand } from '../../quick-wizard/quickCommand.js';
import { inputBranchNameStep, pickBranchStep } from '../../quick-wizard/steps/branches.js';
import { pickRepositoryStep } from '../../quick-wizard/steps/repositories.js';
import { StepsController } from '../../quick-wizard/stepsController.js';
import {
	appendReposToTitle,
	assertStepState,
	canPickStepContinue,
	createConfirmStep,
} from '../../quick-wizard/utils/steps.utils.js';
import type { BranchContext } from '../branch.js';

const Steps = {
	PickRepo: 'branch-rename-pick-repo',
	PickBranch: 'branch-rename-pick-branch',
	InputName: 'branch-rename-input-name',
	Confirm: 'branch-rename-confirm',
} as const;
type StepNames = (typeof Steps)[keyof typeof Steps];
export type BranchRenameStepNames = StepNames;

type Context = BranchContext<StepNames>;

type Flags = '-m';
interface State<Repo = string | Repository> {
	repo: Repo;
	reference: GitBranchReference;
	name: string;
	flags: Flags[];
}
export type BranchRenameState = State;

export interface BranchRenameGitCommandArgs {
	readonly command: 'branch-rename';
	confirm?: boolean;
	state?: Partial<State>;
}

export class BranchRenameGitCommand extends QuickCommand<State> {
	constructor(container: Container, args?: BranchRenameGitCommandArgs) {
		super(container, 'branch-rename', 'rename', 'Rename Branch', {
			description: 'renames the specified branch',
		});

		this.initialState = { confirm: args?.confirm, ...args?.state };
	}

	override get canSkipConfirm(): boolean {
		return false; // Always confirm rename operations
	}

	protected createContext(context?: StepsContext<any>): Context {
		return {
			...context,
			container: this.container,
			repos: this.container.git.openRepositories,
			associatedView: this.container.views.branches,
			showTags: false,
			title: this.title,
		};
	}

	protected async *steps(state: PartialStepState<State>, context?: Context): StepGenerator {
		context ??= this.createContext();
		using steps = new StepsController<StepNames>(context, this);

		state.flags ??= [];

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

			if (steps.isAtStep(Steps.PickBranch) || state.reference == null) {
				using step = steps.enterStep(Steps.PickBranch);

				const result = yield* pickBranchStep(state, context, {
					filter: b => !b.remote,
					picked: state.reference?.ref,
					placeholder: 'Choose a branch to rename',
				});
				if (result === StepResultBreak) {
					state.reference = undefined!;
					if (step.goBack() == null) break;
					continue;
				}

				state.reference = result;
			}

			if (steps.isAtStep(Steps.InputName) || state.name == null) {
				using step = steps.enterStep(Steps.InputName);

				const result = yield* inputBranchNameStep(state, context, {
					prompt: 'Please provide a new name for the branch',
					title: `${context.title} ${getReferenceLabel(state.reference, false)}`,
					value: state.name ?? state.reference.name,
				});
				if (result === StepResultBreak) {
					state.name = undefined!;
					if (step.goBack() == null) break;
					continue;
				}

				state.name = result;
			}

			if (!steps.isAtStepOrUnset(Steps.Confirm)) continue;

			{
				using step = steps.enterStep(Steps.Confirm);

				const result = yield* this.confirmStep(state, context);
				if (result === StepResultBreak) {
					state.flags = [];
					if (step.goBack() == null) break;
					continue;
				}

				state.flags = result;
			}

			steps.markStepsComplete();

			try {
				await state.repo.git.branches.renameBranch?.(state.reference.ref, state.name);
			} catch (ex) {
				Logger.error(ex, context.title);
				void showGitErrorMessage(ex, BranchError.is(ex) ? undefined : 'Unable to rename branch');
				return undefined;
			}
		}

		return steps.isComplete ? undefined : StepResultBreak;
	}

	private *confirmStep(state: StepState<State<Repository>>, context: Context): StepResultGenerator<Flags[]> {
		const step: QuickPickStep<FlagsQuickPickItem<Flags>> = createConfirmStep(
			appendReposToTitle(`Confirm ${context.title}`, state, context),
			[
				createFlagsQuickPickItem<Flags>(state.flags, ['-m'], {
					label: context.title,
					detail: `Will rename ${getReferenceLabel(state.reference)} to ${state.name}`,
				}),
			],
			context,
		);
		const selection: StepSelection<typeof step> = yield step;
		return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
	}
}

import { ThemeIcon } from 'vscode';
import type { Container } from '../../../container.js';
import { BranchError } from '../../../git/errors.js';
import type { GitBranchReference } from '../../../git/models/reference.js';
import type { Repository } from '../../../git/models/repository.js';
import { getReferenceLabel } from '../../../git/utils/reference.utils.js';
import { showGitErrorMessage } from '../../../messages.js';
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
import { pickBranchStep, pickOrResetBranchStep } from '../../quick-wizard/steps/branches.js';
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
	PickRepo: 'branch-upstream-pick-repo',
	PickBranch: 'branch-upstream-pick-branch',
	PickRemoteBranch: 'branch-upstream-pick-remote-branch',
	Confirm: 'branch-upstream-confirm',
} as const;
type StepNames = (typeof Steps)[keyof typeof Steps];
export type BranchUpstreamStepNames = StepNames;

type Context = BranchContext<StepNames>;

interface State<Repo = string | Repository> {
	repo: Repo;
	reference: GitBranchReference;
	/** Specifies the desired upstream; use `null` to unset */
	upstream?: GitBranchReference | null;
}
export type BranchUpstreamState = State;

export interface BranchUpstreamGitCommandArgs {
	readonly command: 'branch-upstream';
	confirm?: boolean;
	state?: Partial<State>;
}

export class BranchUpstreamGitCommand extends QuickCommand<State> {
	constructor(container: Container, args?: BranchUpstreamGitCommandArgs) {
		super(container, 'branch-upstream', 'upstream', 'Change Upstream', {
			description: 'manages upstream tracking for a branch',
		});

		this.initialState = { confirm: args?.confirm, ...args?.state };
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
					placeholder: 'Choose a branch to change its upstream tracking',
				});
				if (result === StepResultBreak) {
					state.reference = undefined!;
					if (step.goBack() == null) break;
					continue;
				}

				state.reference = result;
			}

			if (steps.isAtStep(Steps.PickRemoteBranch) || state.upstream === undefined) {
				using step = steps.enterStep(Steps.PickRemoteBranch);

				const result = yield* pickOrResetBranchStep(state, context, {
					filter: b => b.remote,
					placeholder: 'Choose an upstream branch to track',
					picked: state.upstream?.ref,
					reset:
						state.reference.upstream != null
							? {
									label: 'Unset Upstream',
									description: 'Removes any upstream tracking',
									button: { icon: new ThemeIcon('discard'), tooltip: 'Unset Upstream' },
								}
							: undefined,
				});
				if (result === StepResultBreak) {
					state.upstream = undefined;
					if (step.goBack() == null) break;
					continue;
				}

				state.upstream = result ?? null;
			}

			if (!steps.isAtStepOrUnset(Steps.Confirm)) continue;

			{
				using step = steps.enterStep(Steps.Confirm);

				const result = yield* this.confirmStep(state, context);
				if (result === StepResultBreak) {
					if (step.goBack() == null) break;
					continue;
				}
			}

			steps.markStepsComplete();

			try {
				await state.repo.git.branches.setUpstreamBranch?.(
					state.reference.name,
					state.upstream?.name ?? undefined,
				);
			} catch (ex) {
				Logger.error(ex, context.title);
				void showGitErrorMessage(ex, BranchError.is(ex) ? undefined : 'Unable to manage upstream tracking');
			}
		}

		return steps.isComplete ? undefined : StepResultBreak;
	}

	private *confirmStep(state: StepState<State<Repository>>, context: Context): StepResultGenerator<void> {
		let title;
		let detail;
		if (state.upstream == null) {
			title = 'Unset Upstream';
			detail = `Will remove the upstream tracking from ${getReferenceLabel(state.reference)}`;
		} else if (state.reference.upstream == null) {
			title = 'Set Upstream';
			detail = `Will set the upstream tracking for ${getReferenceLabel(state.reference)} to ${getReferenceLabel(
				state.upstream,
				{ label: false },
			)}`;
		} else {
			title = `Change Upstream`;
			detail = `Will change the upstream tracking for ${getReferenceLabel(state.reference)} to ${getReferenceLabel(
				state.upstream,
				{ label: false },
			)}`;
		}

		const step: QuickPickStep = createConfirmStep(
			appendReposToTitle(`Confirm ${title}`, state, context),
			[{ label: title, detail: detail }],
			context,
		);
		const selection: StepSelection<typeof step> = yield step;
		return canPickStepContinue(step, state, selection) ? undefined : StepResultBreak;
	}
}

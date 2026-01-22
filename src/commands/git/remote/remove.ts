import type { Container } from '../../../container.js';
import type { GitRemote } from '../../../git/models/remote.js';
import type { Repository } from '../../../git/models/repository.js';
import { showGenericErrorMessage } from '../../../messages.js';
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
import { pickRemoteStep } from '../../quick-wizard/steps/remotes.js';
import { pickRepositoryStep } from '../../quick-wizard/steps/repositories.js';
import { StepsController } from '../../quick-wizard/stepsController.js';
import {
	appendReposToTitle,
	assertStepState,
	canPickStepContinue,
	createConfirmStep,
} from '../../quick-wizard/utils/steps.utils.js';
import type { RemoteContext } from '../remote.js';

const Steps = {
	PickRepo: 'remote-remove-pick-repo',
	PickRemote: 'remote-remove-pick-remote',
	Confirm: 'remote-remove-confirm',
} as const;
type StepNames = (typeof Steps)[keyof typeof Steps];
export type RemoteRemoveStepNames = StepNames;

type Context = RemoteContext<StepNames>;

interface State<Repo = string | Repository> {
	repo: Repo;
	remote: string | GitRemote;
}
export type RemoteRemoveState = State;

export interface RemoteRemoveGitCommandArgs {
	readonly command: 'remote-remove';
	confirm?: boolean;
	state?: Partial<State>;
}

export class RemoteRemoveGitCommand extends QuickCommand<State> {
	constructor(container: Container, args?: RemoteRemoveGitCommandArgs) {
		super(container, 'remote-remove', 'remove', 'Remove Remote', {
			description: 'removes the specified remote',
		});

		this.initialState = { confirm: args?.confirm, ...args?.state };
	}

	override get canSkipConfirm(): boolean {
		return false; // Always require confirmation for remove
	}

	protected createContext(context?: StepsContext<any>): Context {
		return {
			...context,
			container: this.container,
			repos: this.container.git.openRepositories,
			associatedView: this.container.views.remotes,
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

					const result = yield* pickRepositoryStep(state, context, step, { excludeWorktrees: true });
					if (result === StepResultBreak) {
						state.repo = undefined!;
						if (step.goBack() == null) break;
						continue;
					}

					state.repo = result;
				}
			}

			assertStepState<State<Repository>>(state);

			if (typeof state.remote === 'string') {
				const [remote] = await state.repo.git.remotes.getRemotes({ filter: r => r.name === state.remote });
				if (remote != null) {
					state.remote = remote;
				} else {
					state.remote = undefined!;
				}
			}

			if (steps.isAtStep(Steps.PickRemote) || state.remote == null) {
				using step = steps.enterStep(Steps.PickRemote);

				const picked: string | undefined = typeof state.remote === 'string' ? state.remote : state.remote?.name;
				const result: GitRemote | typeof StepResultBreak = yield* pickRemoteStep(state, context, {
					picked: picked,
					placeholder: 'Choose remote to remove',
				});
				if (result === StepResultBreak) {
					state.remote = undefined!;
					if (step.goBack() == null) break;
					continue;
				}

				state.remote = result;
			}

			{
				using step = steps.enterStep(Steps.Confirm);

				const result = yield* this.confirmStep(
					state as StepState<State<Repository>> & { remote: GitRemote },
					context,
				);
				if (result === StepResultBreak) {
					if (step.goBack() == null) break;
					continue;
				}
			}

			steps.markStepsComplete();

			try {
				await state.repo.git.remotes.removeRemote?.(state.remote.name);
			} catch (ex) {
				Logger.error(ex);
				void showGenericErrorMessage('Unable to remove remote');
			}
		}

		return steps.isComplete ? undefined : StepResultBreak;
	}

	private *confirmStep(
		state: StepState<State<Repository>> & { remote: GitRemote },
		context: Context,
	): StepResultGenerator<void> {
		const step: QuickPickStep = createConfirmStep(
			appendReposToTitle(`Confirm ${context.title}`, state, context),
			[{ label: context.title, detail: `Will remove remote '${state.remote.name}'` }],
			context,
		);
		const selection: StepSelection<typeof step> = yield step;
		return canPickStepContinue(step, state, selection) ? undefined : StepResultBreak;
	}
}

import type { Container } from '../../../container.js';
import { revealRemote } from '../../../git/actions/remote.js';
import type { Repository } from '../../../git/models/repository.js';
import type { FlagsQuickPickItem } from '../../../quickpicks/items/flags.js';
import { createFlagsQuickPickItem } from '../../../quickpicks/items/flags.js';
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
import { inputRemoteNameStep, inputRemoteUrlStep } from '../../quick-wizard/steps/remotes.js';
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
	PickRepo: 'remote-add-pick-repo',
	InputName: 'remote-add-input-name',
	InputUrl: 'remote-add-input-url',
	Confirm: 'remote-add-confirm',
} as const;
type StepNames = (typeof Steps)[keyof typeof Steps];
export type RemoteAddStepNames = StepNames;

type Context = RemoteContext<StepNames>;

type Flags = '-f';
interface State<Repo = string | Repository> {
	repo: Repo;
	name: string;
	url: string;
	flags: Flags[];

	reveal?: boolean;
}
export type RemoteAddState = State;

export interface RemoteAddGitCommandArgs {
	readonly command: 'remote-add';
	confirm?: boolean;
	state?: Partial<State>;
}

export class RemoteAddGitCommand extends QuickCommand<State> {
	constructor(container: Container, args?: RemoteAddGitCommandArgs) {
		super(container, 'remote-add', 'add', 'Add Remote', {
			description: 'adds a new remote',
		});

		this.initialState = { confirm: args?.confirm, flags: ['-f'], ...args?.state };
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

		state.flags ??= [];

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

			if (steps.isAtStep(Steps.InputName) || state.name == null) {
				using step = steps.enterStep(Steps.InputName);

				const result = yield* inputRemoteNameStep(state, context, {
					prompt: 'Please provide a name for the remote',
					value: state.name,
				});
				if (result === StepResultBreak) {
					state.name = undefined!;
					if (step.goBack() == null) break;
					continue;
				}

				state.name = result;
			}

			if (steps.isAtStep(Steps.InputUrl) || state.url == null) {
				using step = steps.enterStep(Steps.InputUrl);

				const result = yield* inputRemoteUrlStep(state, context, {
					prompt: 'Please provide a URL for the remote',
					value: state.url,
				});
				if (result === StepResultBreak) {
					state.url = undefined!;
					if (step.goBack() == null) break;
					continue;
				}

				state.url = result;
			}

			if (this.confirm(state.confirm)) {
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

			const remote = await state.repo.git.remotes.addRemoteWithResult?.(
				state.name,
				state.url,
				state.flags.includes('-f') ? { fetch: true } : undefined,
			);
			if (state.reveal !== false) {
				void revealRemote(remote, { focus: true, select: true });
			}
		}

		return steps.isComplete ? undefined : StepResultBreak;
	}

	private *confirmStep(state: StepState<State<Repository>>, context: Context): StepResultGenerator<Flags[]> {
		const step: QuickPickStep<FlagsQuickPickItem<Flags>> = createConfirmStep(
			appendReposToTitle(`Confirm ${context.title}`, state, context),
			[
				createFlagsQuickPickItem<Flags>(state.flags, [], {
					label: context.title,
					detail: `Will add remote '${state.name}' for ${state.url}`,
				}),
				createFlagsQuickPickItem<Flags>(state.flags, ['-f'], {
					label: `${context.title} and Fetch`,
					description: '-f',
					detail: `Will add and fetch remote '${state.name}' for ${state.url}`,
				}),
			],
			context,
		);
		const selection: StepSelection<typeof step> = yield step;
		return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
	}
}

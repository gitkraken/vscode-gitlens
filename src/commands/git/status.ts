import { GlyphChars } from '../../constants.js';
import type { Container } from '../../container.js';
import type { Repository } from '../../git/models/repository.js';
import type { GitStatus } from '../../git/models/status.js';
import { createReference, getReferenceLabel } from '../../git/utils/reference.utils.js';
import { CommandQuickPickItem } from '../../quickpicks/items/common.js';
import { GitWizardQuickPickItem } from '../../quickpicks/items/gitWizard.js';
import { pad } from '../../system/string.js';
import type { ViewsWithRepositoryFolders } from '../../views/viewBase.js';
import type { PartialStepState, StepGenerator, StepsContext } from '../quick-wizard/models/steps.js';
import { StepResultBreak } from '../quick-wizard/models/steps.js';
import { QuickCommand } from '../quick-wizard/quickCommand.js';
import { pickRepositoryStep, showRepositoryStatusStep } from '../quick-wizard/steps/repositories.js';
import { StepsController } from '../quick-wizard/stepsController.js';
import { assertStepState } from '../quick-wizard/utils/steps.utils.js';

const Steps = {
	PickRepo: 'status-pick-repo',
	ShowStatus: 'status-show-status',
} as const;
type StepNames = (typeof Steps)[keyof typeof Steps];

interface Context extends StepsContext<StepNames> {
	repos: Repository[];
	associatedView: ViewsWithRepositoryFolders;
	status: GitStatus;
	title: string;
}

interface State<Repo = string | Repository> {
	repo: Repo;
}

export interface StatusGitCommandArgs {
	readonly command: 'status';
	state?: Partial<State>;
}

export class StatusGitCommand extends QuickCommand<State> {
	constructor(container: Container, args?: StatusGitCommandArgs) {
		super(container, 'status', 'status', 'Status', {
			description: 'shows status information about a repository',
		});

		this.initialState = { confirm: false, ...args?.state };
	}

	override get canConfirm(): boolean {
		return false;
	}

	protected createContext(context?: StepsContext<any>): Context {
		return {
			...context,
			container: this.container,
			repos: this.container.git.openRepositories,
			associatedView: this.container.views.commits,
			status: undefined!,
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

			context.status = (await state.repo.git.status.getStatus())!;
			if (context.status == null) break;

			context.title = `${this.title}${pad(GlyphChars.Dot, 2, 2)}${getReferenceLabel(
				createReference(context.status.branch, state.repo.path, {
					refType: 'branch',
					name: context.status.branch,
					remote: false,
					upstream: context.status.upstream,
				}),
				{ icon: false },
			)}`;

			{
				using step = steps.enterStep(Steps.ShowStatus);

				const result = yield* showRepositoryStatusStep(state, context);
				if (result === StepResultBreak) {
					if (step.goBack() == null) break;
					continue;
				}

				if (result instanceof GitWizardQuickPickItem) {
					const r = yield* result.executeSteps(context, this.startedFrom);
					if (r === StepResultBreak) {
						steps.markStepsComplete();
					}

					continue;
				}

				if (result instanceof CommandQuickPickItem) {
					steps.markStepsComplete();

					void result.execute();
					break;
				}
			}
		}

		return steps.isComplete ? undefined : StepResultBreak;
	}
}

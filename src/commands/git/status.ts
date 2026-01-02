import { GlyphChars } from '../../constants.js';
import type { Container } from '../../container.js';
import type { Repository } from '../../git/models/repository.js';
import type { GitStatus } from '../../git/models/status.js';
import { createReference, getReferenceLabel } from '../../git/utils/reference.utils.js';
import { CommandQuickPickItem } from '../../quickpicks/items/common.js';
import { GitWizardQuickPickItem } from '../../quickpicks/items/gitWizard.js';
import { pad } from '../../system/string.js';
import type { ViewsWithRepositoryFolders } from '../../views/viewBase.js';
import type { PartialStepState, StepGenerator, StepState } from '../quickCommand.js';
import { endSteps, QuickCommand, StepResultBreak } from '../quickCommand.js';
import { pickRepositoryStep, showRepositoryStatusStep } from '../quickCommand.steps.js';

interface Context {
	repos: Repository[];
	associatedView: ViewsWithRepositoryFolders;
	status: GitStatus;
	title: string;
}

interface State {
	repo: string | Repository;
}

export interface StatusGitCommandArgs {
	readonly command: 'status';
	state?: Partial<State>;
}

type StatusStepState<T extends State = State> = ExcludeSome<StepState<T>, 'repo', string>;

export class StatusGitCommand extends QuickCommand<State> {
	constructor(container: Container, args?: StatusGitCommandArgs) {
		super(container, 'status', 'status', 'Status', {
			description: 'shows status information about a repository',
		});

		let counter = 0;
		if (args?.state?.repo != null) {
			counter++;
		}

		this.initialState = {
			counter: counter,
			confirm: false,
			...args?.state,
		};
	}

	override get canConfirm(): boolean {
		return false;
	}

	protected async *steps(state: PartialStepState<State>): StepGenerator {
		const context: Context = {
			repos: this.container.git.openRepositories,
			associatedView: this.container.views.commits,
			status: undefined!,
			title: this.title,
		};

		let skippedStepOne = false;

		while (this.canStepsContinue(state)) {
			context.title = this.title;

			if (state.counter < 1 || state.repo == null || typeof state.repo === 'string') {
				skippedStepOne = false;
				if (context.repos.length === 1) {
					skippedStepOne = true;
					if (state.repo == null) {
						state.counter++;
					}

					state.repo = context.repos[0];
				} else {
					const result = yield* pickRepositoryStep(state, context);
					// Always break on the first step (so we will go back)
					if (result === StepResultBreak) break;

					state.repo = result;
				}
			}

			context.status = (await state.repo.git.status.getStatus())!;
			if (context.status == null) return;

			context.title = `${this.title}${pad(GlyphChars.Dot, 2, 2)}${getReferenceLabel(
				createReference(context.status.branch, state.repo.path, {
					refType: 'branch',
					name: context.status.branch,
					remote: false,
					upstream: context.status.upstream,
				}),
				{ icon: false },
			)}`;

			const result = yield* showRepositoryStatusStep(state as StatusStepState, context);
			if (result === StepResultBreak) {
				// If we skipped the previous step, make sure we back up past it
				if (skippedStepOne) {
					state.counter--;
				}

				continue;
			}

			if (result instanceof GitWizardQuickPickItem) {
				const r = yield* result.executeSteps(this.pickedVia);
				state.counter--;
				if (r === StepResultBreak) {
					endSteps(state);
				}

				continue;
			}

			if (result instanceof CommandQuickPickItem) {
				endSteps(state);

				void result.execute();
				break;
			}
		}
	}
}

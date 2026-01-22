import type { Container } from '../../container.js';
import type { GitCommit, GitStashCommit } from '../../git/models/commit.js';
import { isCommit } from '../../git/models/commit.js';
import type { GitRevisionReference } from '../../git/models/reference.js';
import type { Repository } from '../../git/models/repository.js';
import { CommitFilesQuickPickItem } from '../../quickpicks/items/commits.js';
import { CommandQuickPickItem } from '../../quickpicks/items/common.js';
import { GitWizardQuickPickItem } from '../../quickpicks/items/gitWizard.js';
import type { ViewsWithRepositoryFolders } from '../../views/viewBase.js';
import type { PartialStepState, StepGenerator, StepsContext } from '../quick-wizard/models/steps.js';
import { StepResultBreak } from '../quick-wizard/models/steps.js';
import { QuickCommand } from '../quick-wizard/quickCommand.js';
import {
	pickCommitStep,
	showCommitOrStashFilesStep,
	showCommitOrStashFileStep,
	showCommitOrStashStep,
} from '../quick-wizard/steps/commits.js';
import { pickRepositoryStep } from '../quick-wizard/steps/repositories.js';
import { StepsController } from '../quick-wizard/stepsController.js';
import { assertStepState } from '../quick-wizard/utils/steps.utils.js';

const Steps = {
	PickRepo: 'show-pick-repo',
	PickCommit: 'show-pick-commit',
	ShowCommit: 'show-show-commit',
	ShowFiles: 'show-show-files',
	ShowFile: 'show-show-file',
} as const;
type StepNames = (typeof Steps)[keyof typeof Steps];

interface Context extends StepsContext<StepNames> {
	repos: Repository[];
	associatedView: ViewsWithRepositoryFolders;
	title: string;
}

interface State<Repo = string | Repository, Ref = GitRevisionReference | GitCommit | GitStashCommit> {
	repo: Repo;
	reference: Ref;
	fileName: string;
}

export interface ShowGitCommandArgs {
	readonly command: 'show';
	state?: Partial<State>;
}

export class ShowGitCommand extends QuickCommand<State> {
	constructor(container: Container, args?: ShowGitCommandArgs) {
		super(container, 'show', 'show', 'Show', {
			description: 'shows information about a git reference',
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

			if (
				steps.isAtStep(Steps.PickCommit) ||
				state.reference == null ||
				!isCommit(state.reference) ||
				state.reference.file != null
			) {
				if (state.reference != null && !isCommit(state.reference)) {
					state.reference = (await this.container.git
						.getRepositoryService(state.reference.repoPath)
						.commits.getCommit(state.reference.ref))!;
				}

				if (steps.isAtStep(Steps.PickCommit) || state.reference == null) {
					using step = steps.enterStep(Steps.PickCommit);

					const result = yield* pickCommitStep(state, context, {
						log: {
							repoPath: state.repo.path,
							commits: new Map<string, GitCommit | GitStashCommit>(),
							sha: undefined,
							count: 0,
							limit: undefined,
							hasMore: false,
						},
						placeholder: 'Enter a reference or commit SHA',
						picked: state.reference?.ref,
					});
					if (result === StepResultBreak) {
						state.reference = undefined!;
						if (step.goBack() == null) break;
						continue;
					}

					state.reference = result;
				}
			}

			assertStepState<State<Repository, GitCommit | GitStashCommit>>(state);

			if (steps.isAtStepOrUnset(Steps.ShowCommit)) {
				using step = steps.enterStep(Steps.ShowCommit);

				if (!state.reference.hasFullDetails({ allowFilteredFiles: true })) {
					await state.reference.ensureFullDetails();
				}

				const result = yield* showCommitOrStashStep(state, context);
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

				if (result instanceof CommitFilesQuickPickItem) {
					// Toggle to files view - go to ShowFiles step
					steps.goBackToStep(Steps.ShowFiles);
					continue;
				}

				if (result instanceof CommandQuickPickItem) {
					steps.markStepsComplete();

					void result.execute();
					break;
				}
			}

			if (steps.isAtStep(Steps.ShowFiles) || state.fileName == null) {
				using step = steps.enterStep(Steps.ShowFiles);

				const result = yield* showCommitOrStashFilesStep(state, context, {
					picked: state.fileName,
				});
				if (result === StepResultBreak) {
					state.fileName = undefined!;
					if (step.goBack() == null) break;
					continue;
				}

				if (result instanceof CommitFilesQuickPickItem) {
					// Since this is a sort of toggle button, go back to ShowCommit step
					steps.goBackToStep(Steps.ShowCommit);
					continue;
				}

				state.fileName = result.file.path;
			}

			if (steps.isAtStepOrUnset(Steps.ShowFile)) {
				using step = steps.enterStep(Steps.ShowFile);

				const result = yield* showCommitOrStashFileStep(state, context);
				if (result === StepResultBreak) {
					state.fileName = undefined!;
					if (step.goBack() == null) break;
					continue;
				}

				if (result instanceof CommitFilesQuickPickItem) {
					// Since this is a sort of toggle button, go back to ShowCommit step
					steps.goBackToStep(Steps.ShowCommit);
					continue;
				}

				if (result instanceof GitWizardQuickPickItem) {
					yield* result.executeSteps(context, this.startedFrom);
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

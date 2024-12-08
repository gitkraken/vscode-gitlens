import type { Container } from '../../container';
import type { GitCommit, GitStashCommit } from '../../git/models/commit';
import { isCommit } from '../../git/models/commit';
import type { GitRevisionReference } from '../../git/models/reference';
import { Repository } from '../../git/models/repository';
import { CommitFilesQuickPickItem } from '../../quickpicks/items/commits';
import { CommandQuickPickItem } from '../../quickpicks/items/common';
import { GitWizardQuickPickItem } from '../../quickpicks/items/gitWizard';
import type { ViewsWithRepositoryFolders } from '../../views/viewBase';
import type { PartialStepState, StepGenerator } from '../quickCommand';
import { endSteps, QuickCommand, StepResultBreak } from '../quickCommand';
import {
	pickCommitStep,
	pickRepositoryStep,
	showCommitOrStashFilesStep,
	showCommitOrStashFileStep,
	showCommitOrStashStep,
} from '../quickCommand.steps';

interface Context {
	repos: Repository[];
	associatedView: ViewsWithRepositoryFolders;
	title: string;
}

interface State<Ref = GitRevisionReference | GitCommit | GitStashCommit> {
	repo: string | Repository;
	reference: Ref;
	fileName: string;
}

export interface ShowGitCommandArgs {
	readonly command: 'show';
	state?: Partial<State>;
}

type RepositoryStepState<T extends State = State> = SomeNonNullable<
	ExcludeSome<PartialStepState<T>, 'repo', string>,
	'repo'
>;
function assertStateStepRepository(state: PartialStepState<State>): asserts state is RepositoryStepState {
	if (state.repo instanceof Repository) return;

	debugger;
	throw new Error('Missing repository');
}

type CommitStepState = SomeNonNullable<RepositoryStepState<State<GitCommit | GitStashCommit>>, 'reference'>;
function assertsStateStepCommit(state: RepositoryStepState): asserts state is CommitStepState {
	if (isCommit(state.reference)) return;

	debugger;
	throw new Error('Missing reference');
}

type FileNameStepState = SomeNonNullable<CommitStepState, 'fileName'>;
function assertsStateStepFileName(state: CommitStepState): asserts state is FileNameStepState {
	if (state.fileName) return;

	debugger;
	throw new Error('Missing filename');
}

export class ShowGitCommand extends QuickCommand<State> {
	constructor(container: Container, args?: ShowGitCommandArgs) {
		super(container, 'show', 'show', 'Show', {
			description: 'shows information about a git reference',
		});

		let counter = 0;
		if (args?.state?.repo != null) {
			counter++;
		}

		if (args?.state?.reference != null) {
			counter++;
		}

		if (args?.state?.fileName != null) {
			// Skip past the commit show
			counter += 2;
		}

		this.initialState = {
			counter: counter,
			confirm: false,
			...args?.state,
		};
	}

	override get canConfirm() {
		return false;
	}

	protected override getStepState(limitBackNavigation: boolean): PartialStepState<State> {
		// This command is special since we want to allow backing up all the way to the commit,
		// so ensure the startingStep is at most 1
		const state = super.getStepState(limitBackNavigation);
		return {
			...state,
			startingStep: limitBackNavigation ? Math.min(state.startingStep ?? 0, 1) : 0,
		};
	}

	protected async *steps(state: PartialStepState<State>): StepGenerator {
		const context: Context = {
			repos: this.container.git.openRepositories,
			associatedView: this.container.views.commits,
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

			assertStateStepRepository(state);

			if (
				state.counter < 2 ||
				state.reference == null ||
				!isCommit(state.reference) ||
				state.reference.file != null
			) {
				if (state.reference != null && !isCommit(state.reference)) {
					state.reference = await this.container.git.getCommit(state.reference.repoPath, state.reference.ref);
				}

				if (state.counter < 2 || state.reference == null) {
					const result = yield* pickCommitStep(state, context, {
						log: {
							repoPath: state.repo.path,
							commits: new Map<string, GitCommit | GitStashCommit>(),
							sha: undefined,
							range: undefined,
							count: 0,
							limit: undefined,
							hasMore: false,
						},
						placeholder: 'Enter a reference or commit SHA',
						picked: state.reference?.ref,
					});
					if (result === StepResultBreak) {
						// If we skipped the previous step, make sure we back up past it
						if (skippedStepOne) {
							state.counter--;
						}

						continue;
					}

					state.reference = result;
				}
			}

			assertsStateStepCommit(state);

			if (state.counter < 3) {
				if (state.reference.files == null) {
					await state.reference.ensureFullDetails();
				}

				const result = yield* showCommitOrStashStep(state, context);
				if (result === StepResultBreak) continue;

				if (result instanceof GitWizardQuickPickItem) {
					const r = yield* result.executeSteps(this.pickedVia);
					state.counter--;
					if (r === StepResultBreak) {
						endSteps(state);
					}

					continue;
				}

				if (result instanceof CommandQuickPickItem && !(result instanceof CommitFilesQuickPickItem)) {
					endSteps(state);

					void result.execute();
					break;
				}
			}

			if (state.counter < 4 || state.fileName == null) {
				const result = yield* showCommitOrStashFilesStep(state, context, {
					picked: state.fileName,
				});
				if (result === StepResultBreak) continue;

				if (result instanceof CommitFilesQuickPickItem) {
					// Since this is a sort of toggle button, back up 2 steps
					state.counter -= 2;

					continue;
				}

				state.fileName = result.file.path;
			}

			assertsStateStepFileName(state);

			const result = yield* showCommitOrStashFileStep(state, context);
			if (result === StepResultBreak) continue;

			if (result instanceof CommitFilesQuickPickItem) {
				// Since this is a sort of toggle button, back up 2 steps
				state.counter -= 2;

				continue;
			}

			if (result instanceof GitWizardQuickPickItem) {
				yield* result.executeSteps(this.pickedVia);
				state.counter--;

				continue;
			}

			if (result instanceof CommandQuickPickItem) {
				endSteps(state);

				void result.execute();
				break;
			}
		}

		return state.counter < 0 ? StepResultBreak : undefined;
	}
}

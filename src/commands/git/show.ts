'use strict';
import { Container } from '../../container';
import { GitAuthor, GitLogCommit, GitRevisionReference, GitStashCommit, Repository } from '../../git/git';
import {
	PartialStepState,
	pickCommitStep,
	pickRepositoryStep,
	QuickCommand,
	showCommitOrStashFilesStep,
	showCommitOrStashFileStep,
	showCommitOrStashStep,
	StepGenerator,
	StepResult,
	StepState,
} from '../quickCommand';
import { CommandQuickPickItem, CommitFilesQuickPickItem, GitCommandQuickPickItem } from '../../quickpicks';

interface Context {
	repos: Repository[];
	title: string;
}

interface State<Ref = GitRevisionReference | GitLogCommit | GitStashCommit> {
	repo: string | Repository;
	reference: Ref;
	fileName: string;
}

export interface ShowGitCommandArgs {
	readonly command: 'show';
	state?: Partial<State>;
}

type ShowStepState<T extends State = State> = ExcludeSome<StepState<T>, 'repo', string>;

export class ShowGitCommand extends QuickCommand<State> {
	constructor(args?: ShowGitCommandArgs) {
		super('show', 'show', 'Show', {
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

	get canConfirm() {
		return false;
	}

	protected getStepState(limitBackNavigation: boolean): PartialStepState<State> {
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
			repos: [...(await Container.git.getOrderedRepositories())],
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
					if (result === StepResult.Break) break;

					state.repo = result;
				}
			}

			if (
				state.counter < 2 ||
				state.reference == null ||
				!GitLogCommit.is(state.reference) ||
				state.reference.isFile
			) {
				if (state.reference != null && (!GitLogCommit.is(state.reference) || state.reference.isFile)) {
					state.reference = await Container.git.getCommit(state.reference.repoPath, state.reference.ref);
				}

				if (state.counter < 2 || state.reference == null) {
					const result = yield* pickCommitStep(state as ShowStepState, context, {
						log: {
							repoPath: state.repo.path,
							authors: new Map<string, GitAuthor>(),
							commits: new Map<string, GitLogCommit>(),
							sha: undefined,
							range: undefined,
							count: 0,
							limit: undefined,
							hasMore: false,
						},
						placeholder: 'Enter a reference or commit id ',
						picked: state.reference?.ref,
					});
					if (result === StepResult.Break) {
						// If we skipped the previous step, make sure we back up past it
						if (skippedStepOne) {
							state.counter--;
						}

						continue;
					}

					state.reference = result;
				}
			}

			if (state.counter < 3) {
				const result = yield* showCommitOrStashStep(
					state as ShowStepState<State<GitLogCommit | GitStashCommit>>,
					context,
				);
				if (result === StepResult.Break) continue;

				if (result instanceof GitCommandQuickPickItem) {
					const r = yield* result.executeSteps(this.pickedVia);
					state.counter--;
					if (r === StepResult.Break) {
						QuickCommand.endSteps(state);
					}

					continue;
				}

				if (result instanceof CommandQuickPickItem && !(result instanceof CommitFilesQuickPickItem)) {
					QuickCommand.endSteps(state);

					void result.execute();
					break;
				}
			}

			if (state.counter < 4 || state.fileName == null) {
				const result = yield* showCommitOrStashFilesStep(
					state as ShowStepState<State<GitLogCommit | GitStashCommit>>,
					context,
					{
						picked: state.fileName,
					},
				);
				if (result === StepResult.Break) continue;

				if (result instanceof CommitFilesQuickPickItem) {
					// Since this is a sort of toggle button, back up 2 steps
					state.counter -= 2;

					continue;
				}

				state.fileName = result.file.fileName;
			}

			const result = yield* showCommitOrStashFileStep(
				state as ShowStepState<State<GitLogCommit | GitStashCommit>>,
				context,
			);
			if (result === StepResult.Break) continue;

			if (result instanceof CommitFilesQuickPickItem) {
				// Since this is a sort of toggle button, back up 2 steps
				state.counter -= 2;

				continue;
			}

			if (result instanceof GitCommandQuickPickItem) {
				yield* result.executeSteps(this.pickedVia);
				state.counter--;

				continue;
			}

			if (result instanceof CommandQuickPickItem) {
				QuickCommand.endSteps(state);

				void result.execute();
				break;
			}
		}

		return state.counter < 0 ? StepResult.Break : undefined;
	}
}

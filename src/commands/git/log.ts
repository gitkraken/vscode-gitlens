import { GlyphChars, quickPickTitleMaxChars } from '../../constants';
import type { Container } from '../../container';
import { showDetailsView } from '../../git/actions/commit';
import { GitCommit } from '../../git/models/commit';
import type { GitLog } from '../../git/models/log';
import type { GitReference } from '../../git/models/reference';
import { getReferenceLabel, isRevisionRangeReference, isRevisionReference } from '../../git/models/reference.utils';
import { Repository } from '../../git/models/repository';
import { pad } from '../../system/string';
import { formatPath } from '../../system/vscode/formatPath';
import type { ViewsWithRepositoryFolders } from '../../views/viewBase';
import type { PartialStepState, StepGenerator, StepResult } from '../quickCommand';
import { endSteps, QuickCommand, StepResultBreak } from '../quickCommand';
import { pickBranchOrTagStep, pickCommitStep, pickRepositoryStep } from '../quickCommand.steps';
import { getSteps } from '../quickWizard.utils';

interface Context {
	repos: Repository[];
	associatedView: ViewsWithRepositoryFolders;
	cache: Map<string, Promise<GitLog | undefined>>;
	selectedBranchOrTag: GitReference | undefined;
	title: string;
}

interface State {
	repo: string | Repository;
	reference: GitReference | 'HEAD';

	fileName?: string;
	openPickInView?: boolean;
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

export interface LogGitCommandArgs {
	readonly command: 'log';
	state?: Partial<State>;
}

export class LogGitCommand extends QuickCommand<State> {
	constructor(container: Container, args?: LogGitCommandArgs) {
		super(container, 'log', 'history', 'Commits', {
			description: 'aka log, shows commit history',
		});

		let counter = 0;
		if (args?.state?.repo != null) {
			counter++;
		}

		if (args?.state?.reference != null) {
			counter++;
			if (
				args.state.reference !== 'HEAD' &&
				isRevisionReference(args.state.reference) &&
				!isRevisionRangeReference(args.state.reference)
			) {
				counter++;
			}
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

	override isFuzzyMatch(name: string) {
		return super.isFuzzyMatch(name) || name === 'log';
	}

	protected async *steps(state: PartialStepState<State>): StepGenerator {
		const context: Context = {
			repos: this.container.git.openRepositories,
			associatedView: this.container.views.commits,
			cache: new Map<string, Promise<GitLog | undefined>>(),
			selectedBranchOrTag: undefined,
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

			if (state.reference === 'HEAD') {
				const branch = await state.repo.git.getBranch();
				state.reference = branch;
			}

			if (state.counter < 2 || state.reference == null) {
				const result = yield* pickBranchOrTagStep(state, context, {
					placeholder: 'Choose a branch or tag to show its commit history',
					picked: context.selectedBranchOrTag?.ref,
					value: context.selectedBranchOrTag == null ? state.reference?.ref : undefined,
					ranges: true,
				});
				if (result === StepResultBreak) {
					// If we skipped the previous step, make sure we back up past it
					if (skippedStepOne) {
						state.counter--;
					}

					continue;
				}

				state.reference = result;
				context.selectedBranchOrTag = undefined;
			}

			if (!isRevisionReference(state.reference) || isRevisionRangeReference(state.reference)) {
				context.selectedBranchOrTag = state.reference;
			}

			context.title = `${this.title}${pad(GlyphChars.Dot, 2, 2)}${getReferenceLabel(context.selectedBranchOrTag, {
				icon: false,
			})}`;

			if (state.fileName) {
				context.title += `${pad(GlyphChars.Dot, 2, 2)}${formatPath(state.fileName, {
					fileOnly: true,
					truncateTo: quickPickTitleMaxChars - context.title.length - 3,
				})}`;
			}

			if (state.counter < 3 && context.selectedBranchOrTag != null) {
				const ref = context.selectedBranchOrTag.ref;

				let log = context.cache.get(ref);
				if (log == null) {
					log =
						state.fileName != null
							? this.container.git.getLogForFile(state.repo.path, state.fileName, { ref: ref })
							: this.container.git.getLog(state.repo.path, { ref: ref });
					context.cache.set(ref, log);
				}

				const result = yield* pickCommitStep(state, context, {
					ignoreFocusOut: true,
					log: await log,
					onDidLoadMore: log => context.cache.set(ref, Promise.resolve(log)),
					placeholder: (context, log) =>
						log == null
							? `No commits found in ${getReferenceLabel(context.selectedBranchOrTag, {
									icon: false,
							  })}`
							: 'Choose a commit',
					picked: state.reference?.ref,
				});
				if (result === StepResultBreak) continue;

				state.reference = result;
			}

			if (!(state.reference instanceof GitCommit) || state.reference.file != null) {
				state.reference = await this.container.git.getCommit(state.repo.path, state.reference.ref);
			}

			let result: StepResult<ReturnType<typeof getSteps>>;
			if (state.openPickInView) {
				void showDetailsView(state.reference as GitCommit, {
					pin: false,
					preserveFocus: false,
				});
				result = StepResultBreak;
			} else {
				result = yield* getSteps(
					this.container,
					{
						command: 'show',
						state: {
							repo: state.repo,
							reference: state.reference,
							fileName: state.fileName,
						},
					},
					this.pickedVia,
				);
			}

			state.counter--;
			if (result === StepResultBreak) {
				endSteps(state);
			}
		}

		return state.counter < 0 ? StepResultBreak : undefined;
	}
}

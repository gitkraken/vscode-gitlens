'use strict';
import { Container } from '../../container';
import { GitLog, GitLogCommit, GitReference, Repository } from '../../git/git';
import { GitCommandsCommand } from '../gitCommands';
import {
	PartialStepState,
	pickBranchOrTagStep,
	pickCommitStep,
	pickRepositoryStep,
	QuickCommand,
	StepGenerator,
	StepResult,
	StepState,
} from '../quickCommand';
import { GlyphChars, quickPickTitleMaxChars } from '../../constants';
import { GitUri } from '../../git/gitUri';
import { Strings } from '../../system';

interface Context {
	repos: Repository[];
	cache: Map<string, Promise<GitLog | undefined>>;
	selectedBranchOrTag: GitReference | undefined;
	title: string;
}

interface State {
	repo: string | Repository;
	reference: GitReference | 'HEAD';

	fileName?: string;
}

type LogStepState<T extends State = State> = ExcludeSome<StepState<T>, 'repo', string>;

export interface LogGitCommandArgs {
	readonly command: 'log';
	state?: Partial<State>;
}

export class LogGitCommand extends QuickCommand<State> {
	constructor(args?: LogGitCommandArgs) {
		super('log', 'history', 'Commits', {
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
				GitReference.isRevision(args.state.reference) &&
				!GitReference.isRevisionRange(args.state.reference)
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

	get canConfirm(): boolean {
		return false;
	}

	isMatch(name: string) {
		return super.isMatch(name) || name === 'history';
	}

	protected async *steps(state: PartialStepState<State>): StepGenerator {
		const context: Context = {
			repos: [...(await Container.git.getOrderedRepositories())],
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
					if (result === StepResult.Break) break;

					state.repo = result;
				}
			}

			if (state.reference === 'HEAD') {
				const branch = await state.repo.getBranch();
				state.reference = branch;
			}

			if (state.counter < 2 || state.reference == null) {
				const result = yield* pickBranchOrTagStep(state as LogStepState, context, {
					placeholder: 'Choose a branch or tag to show its commit history',
					picked: context.selectedBranchOrTag?.ref,
					value: context.selectedBranchOrTag == null ? state.reference?.ref : undefined,
				});
				if (result === StepResult.Break) {
					// If we skipped the previous step, make sure we back up past it
					if (skippedStepOne) {
						state.counter--;
					}

					continue;
				}

				state.reference = result;
				context.selectedBranchOrTag = undefined;
			}

			if (!GitReference.isRevision(state.reference) || GitReference.isRevisionRange(state.reference)) {
				context.selectedBranchOrTag = state.reference;
			}

			context.title = `${this.title}${Strings.pad(
				GlyphChars.Dot,
				2,
				2,
			)}${GitReference.toString(context.selectedBranchOrTag, { icon: false })}`;

			if (state.fileName) {
				context.title += `${Strings.pad(GlyphChars.Dot, 2, 2)}${GitUri.getFormattedFilename(state.fileName, {
					truncateTo: quickPickTitleMaxChars - context.title.length - 3,
				})}`;
			}

			if (state.counter < 3 && context.selectedBranchOrTag != null) {
				const ref = context.selectedBranchOrTag.ref;

				let log = context.cache.get(ref);
				if (log == null) {
					log =
						state.fileName != null
							? Container.git.getLogForFile(state.repo.path, state.fileName, { ref: ref })
							: Container.git.getLog(state.repo.path, { ref: ref });
					context.cache.set(ref, log);
				}

				const result = yield* pickCommitStep(state as LogStepState, context, {
					ignoreFocusOut: true,
					log: await log,
					onDidLoadMore: log => context.cache.set(ref, Promise.resolve(log)),
					placeholder: (context, log) =>
						log == null
							? `No commits found in ${GitReference.toString(context.selectedBranchOrTag, {
									icon: false,
							  })}`
							: 'Choose a commit',
					picked: state.reference?.ref,
				});
				if (result === StepResult.Break) continue;

				state.reference = result;
			}

			if (!(state.reference instanceof GitLogCommit) || state.reference.isFile) {
				state.reference = await Container.git.getCommit(state.repo.path, state.reference.ref);
			}

			const result = yield* GitCommandsCommand.getSteps(
				{
					command: 'show',
					state: {
						repo: state.repo,
						reference: state.reference as GitLogCommit,
						fileName: state.fileName,
					},
				},
				this.pickedVia,
			);
			state.counter--;
			if (result === StepResult.Break) {
				QuickCommand.endSteps(state);
			}
		}

		return state.counter < 0 ? StepResult.Break : undefined;
	}
}

import { window } from 'vscode';
import type { Container } from '../../container';
import { ResetError } from '../../git/errors';
import type { GitBranch } from '../../git/models/branch';
import type { GitLog } from '../../git/models/log';
import type { GitReference, GitRevisionReference, GitTagReference } from '../../git/models/reference';
import type { Repository } from '../../git/models/repository';
import { getReferenceLabel } from '../../git/utils/reference.utils';
import { showGitErrorMessage } from '../../messages';
import type { FlagsQuickPickItem } from '../../quickpicks/items/flags';
import { createFlagsQuickPickItem } from '../../quickpicks/items/flags';
import { Logger } from '../../system/logger';
import type { ViewsWithRepositoryFolders } from '../../views/viewBase';
import type {
	PartialStepState,
	QuickPickStep,
	StepGenerator,
	StepResult,
	StepResultGenerator,
	StepSelection,
	StepState,
} from '../quickCommand';
import { canPickStepContinue, endSteps, QuickCommand, StepResultBreak } from '../quickCommand';
import { appendReposToTitle, pickCommitStep, pickRepositoryStep } from '../quickCommand.steps';

interface Context {
	repos: Repository[];
	associatedView: ViewsWithRepositoryFolders;
	cache: Map<string, Promise<GitLog | undefined>>;
	destination: GitBranch;
	title: string;
}

type Flags = '--hard' | '--keep' | '--soft';

interface State {
	repo: string | Repository;
	reference: GitRevisionReference | GitTagReference;
	flags: Flags[];
}

export interface ResetGitCommandArgs {
	readonly command: 'reset';
	confirm?: boolean;
	state?: Partial<State>;
}

type ResetStepState<T extends State = State> = ExcludeSome<StepState<T>, 'repo', string>;

export class ResetGitCommand extends QuickCommand<State> {
	constructor(container: Container, args?: ResetGitCommandArgs) {
		super(container, 'reset', 'reset', 'Reset', { description: 'resets the current branch to a specified commit' });

		let counter = 0;
		if (args?.state?.repo != null) {
			counter++;
		}

		if (args?.state?.reference != null) {
			counter++;
		}

		this.initialState = {
			counter: counter,
			confirm: args?.confirm ?? true,
			...args?.state,
		};
		this._canSkipConfirm = !this.initialState.confirm;
	}

	private _canSkipConfirm: boolean = false;
	override get canSkipConfirm(): boolean {
		return this._canSkipConfirm;
	}

	private async execute(state: ResetStepState) {
		const mode = state.flags.includes('--soft')
			? 'soft'
			: state.flags.includes('--keep')
				? 'keep'
				: state.flags.includes('--hard')
					? 'hard'
					: undefined;

		try {
			await state.repo.git.ops?.reset(state.reference.ref, { mode: mode });
		} catch (ex) {
			Logger.error(ex, this.title);

			if (mode === 'keep' && (ResetError.is(ex, 'notUpToDate') || ResetError.is(ex, 'wouldOverwriteChanges'))) {
				void window.showWarningMessage(
					'Unable to safely reset. Your local changes would be overwritten by the reset. Please commit or stash your changes before trying again.',
				);
			} else {
				void showGitErrorMessage(ex);
			}
		}
	}

	protected async *steps(state: PartialStepState<State>): StepGenerator {
		const context: Context = {
			repos: this.container.git.openRepositories,
			associatedView: this.container.views.commits,
			cache: new Map<string, Promise<GitLog | undefined>>(),
			destination: undefined!,
			title: this.title,
		};

		if (state.flags == null) {
			state.flags = [];
		}

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

			if (context.destination == null) {
				const branch = await state.repo.git.branches.getBranch();
				if (branch == null) break;

				context.destination = branch;
			}

			context.title = `${this.title} ${getReferenceLabel(context.destination, { icon: false })}`;

			if (state.counter < 2 || state.reference == null) {
				const rev = context.destination.ref;

				let log = context.cache.get(rev);
				if (log == null) {
					log = state.repo.git.commits.getLog(rev, { merges: 'first-parent' });
					context.cache.set(rev, log);
				}

				const result: StepResult<GitReference> = yield* pickCommitStep(state as ResetStepState, context, {
					log: await log,
					onDidLoadMore: log => context.cache.set(rev, Promise.resolve(log)),
					placeholder: (context, log) =>
						log == null
							? `${context.destination.name} has no commits`
							: `Choose a commit to reset ${context.destination.name} to`,
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

			if (this.confirm(state.confirm)) {
				const result = yield* this.confirmStep(state as ResetStepState, context);
				if (result === StepResultBreak) continue;

				state.flags = result;
			}

			endSteps(state);
			await this.execute(state as ResetStepState);
		}

		return state.counter < 0 ? StepResultBreak : undefined;
	}

	private *confirmStep(state: ResetStepState, context: Context): StepResultGenerator<Flags[]> {
		const step: QuickPickStep<FlagsQuickPickItem<Flags>> = this.createConfirmStep(
			appendReposToTitle(`Confirm ${context.title}`, state, context),
			[
				createFlagsQuickPickItem<Flags>(state.flags, [], {
					label: this.title,
					description: '--mixed \u2022 unstages your changes and reset changes',
					detail: `Will unstage your changes and reset ${getReferenceLabel(context.destination)} to ${getReferenceLabel(
						state.reference,
					)}`,
				}),
				createFlagsQuickPickItem<Flags>(state.flags, ['--soft'], {
					label: `Soft ${this.title}`,
					description: '--soft \u2022 keeps your changes and stages reset changes',
					detail: `Will keep your changes and reset ${getReferenceLabel(context.destination)} to ${getReferenceLabel(
						state.reference,
					)}`,
				}),
				createFlagsQuickPickItem<Flags>(state.flags, ['--keep'], {
					label: `Safe Hard ${this.title}`,
					description:
						'--keep \u2022 keeps your changes and discards reset changes; aborts if reset changes would overwrite them',
					detail: `Will safely hard reset ${getReferenceLabel(context.destination)} to ${getReferenceLabel(
						state.reference,
					)}`,
				}),
				createFlagsQuickPickItem<Flags>(state.flags, ['--hard'], {
					label: `Hard ${this.title}`,
					description: '$(warning) --hard \u2022 discards ALL changes',
					detail: `Will discard ALL changes and reset ${getReferenceLabel(context.destination)} to ${getReferenceLabel(
						state.reference,
					)}`,
				}),
			],
		);
		const selection: StepSelection<typeof step> = yield step;
		return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
	}
}

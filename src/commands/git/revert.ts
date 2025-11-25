import { window } from 'vscode';
import type { Container } from '../../container';
import { RevertError } from '../../git/errors';
import type { GitBranch } from '../../git/models/branch';
import type { GitLog } from '../../git/models/log';
import type { GitRevisionReference } from '../../git/models/reference';
import type { Repository } from '../../git/models/repository';
import { getReferenceLabel } from '../../git/utils/reference.utils';
import { showGitErrorMessage } from '../../messages';
import type { FlagsQuickPickItem } from '../../quickpicks/items/flags';
import { createFlagsQuickPickItem } from '../../quickpicks/items/flags';
import { executeCommand } from '../../system/-webview/command';
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
import { appendReposToTitle, pickCommitsStep, pickRepositoryStep } from '../quickCommand.steps';

interface Context {
	repos: Repository[];
	associatedView: ViewsWithRepositoryFolders;
	cache: Map<string, Promise<GitLog | undefined>>;
	destination: GitBranch;
	title: string;
}

type Flags = '--edit' | '--no-edit';

interface State<Refs = GitRevisionReference | GitRevisionReference[]> {
	repo: string | Repository;
	references: Refs;
	flags: Flags[];
}

export interface RevertGitCommandArgs {
	readonly command: 'revert';
	state?: Partial<State>;
}

type RevertStepState<T extends State = State> = ExcludeSome<StepState<T>, 'repo', string>;

export class RevertGitCommand extends QuickCommand<State> {
	constructor(container: Container, args?: RevertGitCommandArgs) {
		super(container, 'revert', 'revert', 'Revert', {
			description: 'undoes the changes of specified commits, by creating new commits with inverted changes',
		});

		let counter = 0;
		if (args?.state?.repo != null) {
			counter++;
		}

		if (
			args?.state?.references != null &&
			(!Array.isArray(args.state.references) || args.state.references.length !== 0)
		) {
			counter++;
		}

		this.initialState = {
			counter: counter,
			confirm: true,
			...args?.state,
		};
	}

	override get canSkipConfirm(): boolean {
		return false;
	}

	private async execute(state: RevertStepState<State<GitRevisionReference[]>>) {
		const refs = state.references.map(c => c.ref).reverse();

		const options: { editMessage?: boolean } = {};
		if (state.flags.includes('--edit')) {
			options.editMessage = true;
		} else if (state.flags.includes('--no-edit')) {
			options.editMessage = false;
		}

		try {
			await state.repo.git.ops?.revert(refs, options);
		} catch (ex) {
			// Don't show an error message if the user intentionally aborted the revert
			if (RevertError.is(ex, 'aborted')) {
				Logger.log(ex.message, this.title);
				return;
			}

			Logger.error(ex, this.title);

			if (RevertError.is(ex, 'uncommittedChanges') || RevertError.is(ex, 'wouldOverwriteChanges')) {
				void window.showWarningMessage(
					'Unable to revert. Your local changes would be overwritten. Please commit or stash your changes before trying again.',
				);
				return;
			}

			if (RevertError.is(ex, 'conflicts')) {
				void window.showWarningMessage(
					'Unable to revert due to conflicts. Resolve the conflicts before continuing, or abort the revert.',
				);
				void executeCommand('gitlens.showCommitsView');
				return;
			}

			if (RevertError.is(ex, 'alreadyInProgress')) {
				void window.showWarningMessage(
					'Unable to revert. A revert is already in progress. Continue or abort the current revert first.',
				);
				void executeCommand('gitlens.showCommitsView');
				return;
			}

			void showGitErrorMessage(ex, RevertError.is(ex) ? undefined : 'Unable to revert');
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

		if (state.references != null && !Array.isArray(state.references)) {
			state.references = [state.references];
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

			if (state.counter < 2 || state.references == null || state.references.length === 0) {
				const rev = context.destination.ref;

				let log = context.cache.get(rev);
				if (log == null) {
					log = state.repo.git.commits.getLog(rev, { merges: 'first-parent' });
					context.cache.set(rev, log);
				}

				const result: StepResult<GitRevisionReference[]> = yield* pickCommitsStep(
					state as RevertStepState,
					context,
					{
						log: await log,
						onDidLoadMore: log => context.cache.set(rev, Promise.resolve(log)),
						placeholder: (context, log) =>
							log == null ? `${context.destination.name} has no commits` : 'Choose commits to revert',
						picked: state.references?.map(r => r.ref),
					},
				);
				if (result === StepResultBreak) {
					// If we skipped the previous step, make sure we back up past it
					if (skippedStepOne) {
						state.counter--;
					}

					continue;
				}

				state.references = result;
			}

			const result = yield* this.confirmStep(state as RevertStepState, context);
			if (result === StepResultBreak) continue;

			state.flags = result;

			endSteps(state);
			void this.execute(state as RevertStepState<State<GitRevisionReference[]>>);
		}

		return state.counter < 0 ? StepResultBreak : undefined;
	}

	private *confirmStep(state: RevertStepState, context: Context): StepResultGenerator<Flags[]> {
		const step: QuickPickStep<FlagsQuickPickItem<Flags>> = this.createConfirmStep(
			appendReposToTitle(`Confirm ${context.title}`, state, context),
			[
				createFlagsQuickPickItem<Flags>(state.flags, ['--no-edit'], {
					label: this.title,
					description: '--no-edit',
					detail: `Will revert ${getReferenceLabel(state.references)}`,
				}),
				createFlagsQuickPickItem<Flags>(state.flags, ['--edit'], {
					label: `${this.title} & Edit`,
					description: '--edit',
					detail: `Will revert and edit ${getReferenceLabel(state.references)}`,
				}),
			],
		);
		const selection: StepSelection<typeof step> = yield step;
		return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
	}
}

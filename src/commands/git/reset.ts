import { window } from 'vscode';
import type { Container } from '../../container.js';
import { ResetError } from '../../git/errors.js';
import type { GitBranch } from '../../git/models/branch.js';
import type { GitLog } from '../../git/models/log.js';
import type { GitRevisionReference, GitTagReference } from '../../git/models/reference.js';
import type { Repository } from '../../git/models/repository.js';
import { getReferenceLabel } from '../../git/utils/reference.utils.js';
import { showGitErrorMessage } from '../../messages.js';
import { createDirectiveQuickPickItem, Directive } from '../../quickpicks/items/directive.js';
import type { FlagsQuickPickItem } from '../../quickpicks/items/flags.js';
import { createFlagsQuickPickItem } from '../../quickpicks/items/flags.js';
import { Logger } from '../../system/logger.js';
import type { ViewsWithRepositoryFolders } from '../../views/viewBase.js';
import type {
	PartialStepState,
	StepGenerator,
	StepResultGenerator,
	StepsContext,
	StepSelection,
	StepState,
} from '../quick-wizard/models/steps.js';
import { StepResultBreak } from '../quick-wizard/models/steps.js';
import type { QuickPickStep } from '../quick-wizard/models/steps.quickpick.js';
import { QuickCommand } from '../quick-wizard/quickCommand.js';
import { pickCommitStep } from '../quick-wizard/steps/commits.js';
import { pickRepositoryStep } from '../quick-wizard/steps/repositories.js';
import { StepsController } from '../quick-wizard/stepsController.js';
import { appendReposToTitle, assertStepState, canPickStepContinue } from '../quick-wizard/utils/steps.utils.js';

const Steps = {
	PickRepo: 'reset-pick-repo',
	PickCommit: 'reset-pick-commit',
	Confirm: 'reset-confirm',
} as const;
type StepNames = (typeof Steps)[keyof typeof Steps];

interface Context extends StepsContext<StepNames> {
	repos: Repository[];
	associatedView: ViewsWithRepositoryFolders;
	cache: Map<string, Promise<GitLog | undefined>>;
	destination: GitBranch;
	title: string;
}

type Flags = '--hard' | '--keep' | '--soft';
interface State<Repo = string | Repository> {
	repo: Repo;
	reference: GitRevisionReference | GitTagReference;
	flags: Flags[];
}

export interface ResetGitCommandArgs {
	readonly command: 'reset';
	confirm?: boolean;
	state?: Partial<State>;
}

export class ResetGitCommand extends QuickCommand<State> {
	constructor(container: Container, args?: ResetGitCommandArgs) {
		super(container, 'reset', 'reset', 'Reset', { description: 'resets the current branch to a specified commit' });

		this.initialState = { confirm: args?.confirm ?? true, ...args?.state };
		this._canSkipConfirm = !this.initialState.confirm;
	}

	private _canSkipConfirm: boolean = false;
	override get canSkipConfirm(): boolean {
		return this._canSkipConfirm;
	}

	private async execute(state: StepState<State<Repository>>) {
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

	protected createContext(context?: StepsContext<any>): Context {
		return {
			...context,
			container: this.container,
			repos: this.container.git.openRepositories,
			associatedView: this.container.views.commits,
			cache: new Map<string, Promise<GitLog | undefined>>(),
			destination: undefined!,
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

			if (context.destination == null) {
				const branch = await state.repo.git.branches.getBranch();
				if (branch == null) break;

				context.destination = branch;
			}

			context.title = `${this.title} ${getReferenceLabel(context.destination, { icon: false })}`;

			if (steps.isAtStep(Steps.PickCommit) || state.reference == null) {
				using step = steps.enterStep(Steps.PickCommit);

				const rev = context.destination.ref;

				let log = context.cache.get(rev);
				if (log == null) {
					log = state.repo.git.commits.getLog(rev, { merges: 'first-parent' });
					context.cache.set(rev, log);
				}

				const result = yield* pickCommitStep(state, context, {
					emptyItems: [
						createDirectiveQuickPickItem(Directive.Cancel, true, {
							label: 'OK',
							detail: `${context.destination.name} has no commits`,
						}),
					],
					log: await log,
					onDidLoadMore: log => context.cache.set(rev, Promise.resolve(log)),
					placeholder: (context, log) =>
						!log?.commits.size
							? `${context.destination.name} has no commits`
							: `Choose a commit to reset ${context.destination.name} to`,
					picked: state.reference?.ref,
				});
				if (result === StepResultBreak) {
					state.reference = undefined!;
					if (step.goBack() == null) break;
					continue;
				}

				state.reference = result;
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
			await this.execute(state);
		}

		return steps.isComplete ? undefined : StepResultBreak;
	}

	private *confirmStep(state: StepState<State<Repository>>, context: Context): StepResultGenerator<Flags[]> {
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

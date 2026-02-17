import { window } from 'vscode';
import type { Container } from '../../container.js';
import { RevertError } from '../../git/errors.js';
import type { GitBranch } from '../../git/models/branch.js';
import type { GitLog } from '../../git/models/log.js';
import type { GitRevisionReference } from '../../git/models/reference.js';
import type { Repository } from '../../git/models/repository.js';
import { getReferenceLabel } from '../../git/utils/reference.utils.js';
import { showGitErrorMessage } from '../../messages.js';
import { createDirectiveQuickPickItem, Directive } from '../../quickpicks/items/directive.js';
import type { FlagsQuickPickItem } from '../../quickpicks/items/flags.js';
import { createFlagsQuickPickItem } from '../../quickpicks/items/flags.js';
import { executeCommand } from '../../system/-webview/command.js';
import { Logger } from '../../system/logger.js';
import type { ViewsWithRepositoryFolders } from '../../views/viewBase.js';
import type {
	PartialStepState,
	StepGenerator,
	StepResult,
	StepResultGenerator,
	StepsContext,
	StepSelection,
	StepState,
} from '../quick-wizard/models/steps.js';
import { StepResultBreak } from '../quick-wizard/models/steps.js';
import type { QuickPickStep } from '../quick-wizard/models/steps.quickpick.js';
import { QuickCommand } from '../quick-wizard/quickCommand.js';
import { pickCommitsStep } from '../quick-wizard/steps/commits.js';
import { pickRepositoryStep } from '../quick-wizard/steps/repositories.js';
import { StepsController } from '../quick-wizard/stepsController.js';
import { appendReposToTitle, assertStepState, canPickStepContinue } from '../quick-wizard/utils/steps.utils.js';

const Steps = {
	PickRepo: 'revert-pick-repo',
	PickCommits: 'revert-pick-commits',
	Confirm: 'revert-confirm',
} as const;
type StepNames = (typeof Steps)[keyof typeof Steps];

interface Context extends StepsContext<StepNames> {
	repos: Repository[];
	associatedView: ViewsWithRepositoryFolders;
	cache: Map<string, Promise<GitLog | undefined>>;
	destination: GitBranch;
	title: string;
}

type Flags = '--edit' | '--no-edit';
interface State<Repo = string | Repository, Refs = GitRevisionReference | GitRevisionReference[]> {
	repo: Repo;
	references: Refs;
	flags: Flags[];
}

export interface RevertGitCommandArgs {
	readonly command: 'revert';
	state?: Partial<State>;
}

export class RevertGitCommand extends QuickCommand<State> {
	constructor(container: Container, args?: RevertGitCommandArgs) {
		super(container, 'revert', 'revert', 'Revert', {
			description: 'undoes the changes of specified commits, by creating new commits with inverted changes',
		});

		this.initialState = { confirm: true, ...args?.state };
	}

	override get canSkipConfirm(): boolean {
		return false;
	}

	private async execute(state: StepState<State<Repository, GitRevisionReference[]>>) {
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
				Logger.debug(ex.message, this.title);
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

		if (state.references != null && !Array.isArray(state.references)) {
			state.references = [state.references];
		}

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

			if (steps.isAtStep(Steps.PickCommits) || state.references == null || state.references.length === 0) {
				using step = steps.enterStep(Steps.PickCommits);

				const rev = context.destination.ref;

				let log = context.cache.get(rev);
				if (log == null) {
					log = state.repo.git.commits.getLog(rev, { merges: 'first-parent' });
					context.cache.set(rev, log);
				}

				const result: StepResult<GitRevisionReference[]> = yield* pickCommitsStep(state, context, {
					emptyItems: [
						createDirectiveQuickPickItem(Directive.Cancel, true, {
							label: 'OK',
							detail: `${context.destination.name} has no commits`,
						}),
					],
					log: await log,
					onDidLoadMore: log => context.cache.set(rev, Promise.resolve(log)),
					placeholder: (context, log) =>
						!log?.commits.size ? `${context.destination.name} has no commits` : 'Choose commits to revert',
					picked: state.references?.map(r => r.ref),
				});
				if (result === StepResultBreak) {
					state.references = undefined!;
					if (step.goBack() == null) break;
					continue;
				}

				state.references = result;
			}

			assertStepState<State<Repository, GitRevisionReference[]>>(state);

			{
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
			void this.execute(state);
		}

		return steps.isComplete ? undefined : StepResultBreak;
	}

	private *confirmStep(
		state: StepState<State<Repository, GitRevisionReference[]>>,
		context: Context,
	): StepResultGenerator<Flags[]> {
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

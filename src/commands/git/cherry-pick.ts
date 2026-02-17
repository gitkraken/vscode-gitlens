import { ThemeIcon, window } from 'vscode';
import type { Container } from '../../container.js';
import { skipPausedOperation } from '../../git/actions/pausedOperation.js';
import { CherryPickError } from '../../git/errors.js';
import type { GitBranch } from '../../git/models/branch.js';
import type { GitLog } from '../../git/models/log.js';
import type { ConflictDetectionResult } from '../../git/models/mergeConflicts.js';
import type { GitPausedOperationStatus } from '../../git/models/pausedOperationStatus.js';
import type { GitReference } from '../../git/models/reference.js';
import type { Repository } from '../../git/models/repository.js';
import { getReferenceLabel, isRevisionReference } from '../../git/utils/reference.utils.js';
import { createRevisionRange } from '../../git/utils/revision.utils.js';
import { showGitErrorMessage } from '../../messages.js';
import { isSubscriptionTrialOrPaidFromState } from '../../plus/gk/utils/subscription.utils.js';
import { createQuickPickSeparator } from '../../quickpicks/items/common.js';
import type { DirectiveQuickPickItem } from '../../quickpicks/items/directive.js';
import { createDirectiveQuickPickItem, Directive } from '../../quickpicks/items/directive.js';
import type { FlagsQuickPickItem } from '../../quickpicks/items/flags.js';
import { createFlagsQuickPickItem } from '../../quickpicks/items/flags.js';
import { executeCommand } from '../../system/-webview/command.js';
import { ensureArray } from '../../system/array.js';
import { Logger } from '../../system/logger.js';
import { pluralize } from '../../system/string.js';
import type { ViewsWithRepositoryFolders } from '../../views/viewBase.js';
import type {
	AsyncStepResultGenerator,
	PartialStepState,
	StepGenerator,
	StepResult,
	StepsContext,
	StepSelection,
	StepState,
} from '../quick-wizard/models/steps.js';
import { StepResultBreak } from '../quick-wizard/models/steps.js';
import type { QuickPickStep } from '../quick-wizard/models/steps.quickpick.js';
import { QuickCommand } from '../quick-wizard/quickCommand.js';
import { pickCommitsStep } from '../quick-wizard/steps/commits.js';
import { pickBranchOrTagStep } from '../quick-wizard/steps/references.js';
import { pickRepositoryStep } from '../quick-wizard/steps/repositories.js';
import { StepsController } from '../quick-wizard/stepsController.js';
import { appendReposToTitle, assertStepState, canPickStepContinue } from '../quick-wizard/utils/steps.utils.js';

const Steps = {
	PickRepo: 'cherry-pick-pick-repo',
	PickBranchOrTag: 'cherry-pick-pick-branch-or-tag',
	PickCommits: 'cherry-pick-pick-commits',
	Confirm: 'cherry-pick-confirm',
} as const;
type StepNames = (typeof Steps)[keyof typeof Steps];

interface Context extends StepsContext<StepNames> {
	repos: Repository[];
	associatedView: ViewsWithRepositoryFolders;
	cache: Map<string, Promise<GitLog | undefined>>;
	destination: GitBranch;
	selectedBranchOrTag: GitReference | undefined;
	showTags: boolean;
	title: string;
}

type Flags = '--edit' | '--no-commit';
interface State<Repo = string | Repository, Refs = GitReference | GitReference[]> {
	repo: Repo;
	references: Refs;
	flags: Flags[];
}

export interface CherryPickGitCommandArgs {
	readonly command: 'cherry-pick';
	state?: Partial<State>;
}

export class CherryPickGitCommand extends QuickCommand<State> {
	constructor(container: Container, args?: CherryPickGitCommandArgs) {
		super(container, 'cherry-pick', 'cherry-pick', 'Cherry Pick', {
			description: 'integrates changes from specified commits into the current branch',
		});

		this.initialState = { confirm: true, ...args?.state };
	}

	override get canSkipConfirm(): boolean {
		return false;
	}

	private async execute(state: StepState<State<Repository, GitReference[]>>) {
		try {
			await state.repo.git.ops?.cherryPick?.(
				state.references.map(c => c.ref),
				{
					edit: state.flags.includes('--edit'),
					noCommit: state.flags.includes('--no-commit'),
				},
			);
		} catch (ex) {
			// Don't show an error message if the user intentionally aborted the cherry-pick
			if (CherryPickError.is(ex, 'aborted')) {
				Logger.debug(ex.message, this.title);
				return;
			}

			Logger.error(ex, this.title);

			if (CherryPickError.is(ex, 'wouldOverwriteChanges')) {
				void window.showWarningMessage(
					'Unable to cherry-pick. Your local changes would be overwritten. Please commit or stash your changes before trying again.',
				);
				return;
			}

			if (CherryPickError.is(ex, 'conflicts')) {
				void window.showWarningMessage(
					'Unable to cherry-pick due to conflicts. Resolve the conflicts before continuing, or abort the cherry-pick.',
				);
				void executeCommand('gitlens.showCommitsView');
				return;
			}

			if (CherryPickError.is(ex, 'alreadyInProgress')) {
				void window.showWarningMessage(
					'Unable to cherry-pick. A cherry-pick is already in progress. Continue or abort the current cherry-pick first.',
				);
				void executeCommand('gitlens.showCommitsView');
				return;
			}

			if (CherryPickError.is(ex, 'emptyCommit')) {
				let pausedOperation: GitPausedOperationStatus | undefined;
				try {
					pausedOperation = await state.repo.git.pausedOps?.getPausedOperationStatus?.();
					pausedOperation ??= await state.repo
						.waitForRepoChange(500)
						.then(() => state.repo.git.pausedOps?.getPausedOperationStatus?.());
				} catch {}

				const pausedAt = pausedOperation
					? getReferenceLabel(pausedOperation?.incoming, { icon: false, label: true, quoted: true })
					: undefined;

				const skip = { title: 'Skip' };
				const cancel = { title: 'Cancel', isCloseAffordance: true };
				const result = await window.showInformationMessage(
					`Unable to complete the cherry-pick operation because ${pausedAt ?? 'it'} resulted in an empty commit.\n\nDo you want to skip ${pausedAt ?? 'this commit'}?`,
					{ modal: true },
					skip,
					cancel,
				);
				if (result === skip) {
					return void skipPausedOperation(state.repo.git);
				}

				void executeCommand('gitlens.showCommitsView');
				return;
			}

			void showGitErrorMessage(ex, CherryPickError.is(ex) ? undefined : 'Unable to cherry-pick');
		}
	}

	override isFuzzyMatch(name: string): boolean {
		return super.isFuzzyMatch(name) || name === 'cherry';
	}

	protected createContext(context?: StepsContext<any>): Context {
		return {
			...context,
			container: this.container,
			repos: this.container.git.openRepositories,
			associatedView: this.container.views.commits,
			cache: new Map<string, Promise<GitLog | undefined>>(),
			destination: undefined!,
			selectedBranchOrTag: undefined,
			showTags: true,
			title: this.title,
		};
	}

	protected async *steps(state: PartialStepState<State>, context?: Context): StepGenerator {
		context = this.createContext();
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

			context.title = `${this.title} into ${getReferenceLabel(context.destination, {
				icon: false,
				label: false,
			})}`;

			if (steps.isAtStep(Steps.PickBranchOrTag) || !state.references?.length) {
				using step = steps.enterStep(Steps.PickBranchOrTag);

				const result: StepResult<GitReference> = yield* pickBranchOrTagStep(state, context, {
					filter: { branches: b => b.id !== context.destination.id },
					placeholder: context => `Choose a branch${context.showTags ? ' or tag' : ''} to cherry-pick from`,
					picked: context.selectedBranchOrTag?.ref,
					value: context.selectedBranchOrTag == null ? state.references?.[0]?.ref : undefined,
				});
				if (result === StepResultBreak) {
					state.references = undefined!;
					if (step.goBack() == null) break;
					continue;
				}

				if (isRevisionReference(result)) {
					state.references = [result];
					context.selectedBranchOrTag = undefined;
				} else {
					context.selectedBranchOrTag = result;
				}
			}

			if (context.selectedBranchOrTag == null && state.references?.length) {
				const branches: string[] = await state.repo.git.branches.getBranchesWithCommits(
					state.references.map(r => r.ref),
					undefined,
					{ mode: 'contains' },
				);
				if (branches.length) {
					const branch = await state.repo.git.branches.getBranch(branches[0]);
					if (branch != null) {
						context.selectedBranchOrTag = branch;
					}
				}
			}

			if (context.selectedBranchOrTag != null) {
				using step = steps.enterStep(Steps.PickCommits);

				const rev = createRevisionRange(context.destination.ref, context.selectedBranchOrTag.ref, '..');

				let log = context.cache.get(rev);
				if (log == null) {
					log = state.repo.git.commits.getLog(rev, { merges: 'first-parent' });
					context.cache.set(rev, log);
				}

				const result: StepResult<GitReference[]> = yield* pickCommitsStep(state, context, {
					emptyItems: [
						createDirectiveQuickPickItem(Directive.Cancel, true, {
							label: 'OK',
							detail: `No pickable commits found on ${getReferenceLabel(context.selectedBranchOrTag, { icon: false })}`,
						}),
					],
					log: await log,
					onDidLoadMore: log => context.cache.set(rev, Promise.resolve(log)),
					picked: state.references?.map(r => r.ref),
					placeholder: (context, log) =>
						!log?.commits.size
							? `No pickable commits found on ${getReferenceLabel(context.selectedBranchOrTag, { icon: false })}`
							: `Choose commits to cherry-pick into ${getReferenceLabel(context.destination, { icon: false })}`,
				});
				if (result === StepResultBreak) {
					state.references = undefined!;
					if (step.goBack() == null) break;
					continue;
				}

				state.references = result;
			}

			assertStepState<State<Repository, GitReference[]>>(state);

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
			void this.execute(state);
		}

		return steps.isComplete ? undefined : StepResultBreak;
	}

	private async *confirmStep(
		state: StepState<State<Repository, GitReference[]>>,
		context: Context,
	): AsyncStepResultGenerator<Flags[]> {
		const items: FlagsQuickPickItem<Flags>[] = [
			createFlagsQuickPickItem<Flags>(state.flags, [], {
				label: this.title,
				detail: `Will apply ${getReferenceLabel(state.references, { label: false })} to ${getReferenceLabel(
					context.destination,
					{ label: false },
				)}`,
			}),
			createFlagsQuickPickItem<Flags>(state.flags, ['--edit'], {
				label: `${this.title} & Edit`,
				description: '--edit',
				detail: `Will edit and apply ${getReferenceLabel(state.references, {
					label: false,
				})} to ${getReferenceLabel(context.destination, {
					label: false,
				})}`,
			}),
			createFlagsQuickPickItem<Flags>(state.flags, ['--no-commit'], {
				label: `${this.title} without Committing`,
				description: '--no-commit',
				detail: `Will apply ${getReferenceLabel(state.references, { label: false })} to ${getReferenceLabel(
					context.destination,
					{ label: false },
				)} without Committing`,
			}),
		];

		let potentialConflict: Promise<ConflictDetectionResult | undefined> | undefined;
		const subscription = await this.container.subscription.getSubscription();
		if (isSubscriptionTrialOrPaidFromState(subscription?.state)) {
			// Reverse the commits since they're typically in newest-to-oldest order (from git log),
			// but conflict detection needs oldest-to-newest order to properly simulate cherry-pick
			potentialConflict = state.repo.git.branches.getPotentialApplyConflicts?.(
				context.destination.name,
				ensureArray(state.references)
					.map(r => r.ref)
					.reverse(),
				{ stopOnFirstConflict: true },
			);
		}

		let step: QuickPickStep<DirectiveQuickPickItem | FlagsQuickPickItem<Flags>>;

		const notices: DirectiveQuickPickItem[] = [];
		if (potentialConflict) {
			void potentialConflict?.then(result => {
				if (result == null || result.status === 'clean') {
					notices.splice(
						0,
						1,
						createDirectiveQuickPickItem(Directive.Noop, false, {
							label: 'No Conflicts Detected',
							iconPath: new ThemeIcon('check'),
						}),
					);
				} else if (result.status === 'error') {
					notices.splice(
						0,
						1,
						createDirectiveQuickPickItem(Directive.Noop, false, {
							label: 'Unable to Detect Conflicts',
							detail: result.message,
							iconPath: new ThemeIcon('error'),
						}),
					);
				} else {
					notices.splice(
						0,
						1,
						createDirectiveQuickPickItem(Directive.Noop, false, {
							label: 'Conflicts Detected',
							detail: `Will result in ${result.stoppedOnFirstConflict ? 'at least ' : ''}${pluralize(
								'conflicting file',
								result.conflict.files.length,
							)} that will need to be resolved`,
							iconPath: new ThemeIcon('warning'),
						}),
					);
				}

				if (step.quickpick != null) {
					const active = step.quickpick.activeItems;
					step.quickpick.items = [
						...notices,
						...items,
						createQuickPickSeparator(),
						createDirectiveQuickPickItem(Directive.Cancel),
					];
					step.quickpick.activeItems = active;
				}
			});

			notices.push(
				createDirectiveQuickPickItem(Directive.Noop, false, {
					label: `$(loading~spin) \u00a0Detecting Conflicts...`,
					// Don't use this, because the spin here causes the icon to spin incorrectly
					//iconPath: new ThemeIcon('loading~spin'),
				}),
				createQuickPickSeparator(),
			);
		}

		step = this.createConfirmStep(appendReposToTitle(`Confirm ${context.title}`, state, context), [
			...notices,
			...items,
		]);
		const selection: StepSelection<typeof step> = yield step;
		return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
	}
}

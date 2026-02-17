import { ThemeIcon, window } from 'vscode';
import type { Container } from '../../container.js';
import { RebaseError } from '../../git/errors.js';
import type { GitBranch } from '../../git/models/branch.js';
import type { GitLog } from '../../git/models/log.js';
import type { ConflictDetectionResult } from '../../git/models/mergeConflicts.js';
import type { GitReference } from '../../git/models/reference.js';
import type { Repository } from '../../git/models/repository.js';
import { isRebaseTodoEditorEnabled, reopenRebaseTodoEditor } from '../../git/utils/-webview/rebase.utils.js';
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
import { Logger } from '../../system/logger.js';
import { pluralize } from '../../system/string.js';
import { createDisposable } from '../../system/unifiedDisposable.js';
import type { ViewsWithRepositoryFolders } from '../../views/viewBase.js';
import type {
	AsyncStepResultGenerator,
	PartialStepState,
	StepGenerator,
	StepsContext,
	StepSelection,
	StepState,
} from '../quick-wizard/models/steps.js';
import { StepResultBreak } from '../quick-wizard/models/steps.js';
import type { QuickPickStep } from '../quick-wizard/models/steps.quickpick.js';
import { PickCommitToggleQuickInputButton } from '../quick-wizard/quickButtons.js';
import { QuickCommand } from '../quick-wizard/quickCommand.js';
import { pickCommitStep } from '../quick-wizard/steps/commits.js';
import { pickBranchOrTagStep } from '../quick-wizard/steps/references.js';
import { pickRepositoryStep } from '../quick-wizard/steps/repositories.js';
import { StepsController } from '../quick-wizard/stepsController.js';
import { appendReposToTitle, assertStepState, canPickStepContinue } from '../quick-wizard/utils/steps.utils.js';

const Steps = {
	PickRepo: 'rebase-pick-repo',
	PickBranchOrTag: 'rebase-pick-branch-or-tag',
	PickCommit: 'rebase-pick-commit',
	Confirm: 'rebase-confirm',
} as const;
type StepNames = (typeof Steps)[keyof typeof Steps];

interface Context extends StepsContext<StepNames> {
	repos: Repository[];
	associatedView: ViewsWithRepositoryFolders;
	cache: Map<string, Promise<GitLog | undefined>>;
	branch: GitBranch;
	pickCommit: boolean;
	pickCommitForItem: boolean;
	selectedBranchOrTag: GitReference | undefined;
	showTags: boolean;
	title: string;
}

type Flags = '--interactive' | '--update-refs';
interface State<Repo = string | Repository> {
	repo: Repo;
	destination: GitReference;
	flags: Flags[];
}

export interface RebaseGitCommandArgs {
	readonly command: 'rebase';
	state?: Partial<State>;
}

export class RebaseGitCommand extends QuickCommand<State> {
	constructor(container: Container, args?: RebaseGitCommandArgs) {
		super(container, 'rebase', 'rebase', 'Rebase', {
			description:
				'integrates changes from a specified branch into the current branch, by changing the base of the branch and reapplying the commits on top',
		});

		this.initialState = { confirm: true, ...args?.state };
	}

	override get canSkipConfirm(): boolean {
		return false;
	}

	private async execute(state: StepState<State<Repository>>) {
		const interactive = state.flags.includes('--interactive');
		const updateRefs = state.flags.includes('--update-refs');

		// If the editor is not enabled, listen for the rebase todo file to be opened and then reopen it with our editor
		const disposable =
			interactive && !isRebaseTodoEditorEnabled()
				? window.onDidChangeActiveTextEditor(async e => {
						if (e?.document.uri.path.endsWith('git-rebase-todo')) {
							await reopenRebaseTodoEditor('gitlens.rebase');
							disposable?.dispose();
						}
					})
				: undefined;

		using _ = createDisposable(() => void disposable?.dispose());

		try {
			await state.repo.git.ops?.rebase?.(state.destination.ref, {
				interactive: interactive,
				updateRefs: updateRefs,
			});
		} catch (ex) {
			// Don't show an error message if the user intentionally aborted the rebase
			if (RebaseError.is(ex, 'aborted')) {
				Logger.debug(ex.message, this.title);
				return;
			}

			Logger.error(ex, this.title);

			if (RebaseError.is(ex, 'uncommittedChanges') || RebaseError.is(ex, 'wouldOverwriteChanges')) {
				void window.showWarningMessage(
					'Unable to rebase. Your local changes would be overwritten. Please commit or stash your changes before trying again.',
				);
				return;
			}

			if (RebaseError.is(ex, 'conflicts')) {
				void window.showWarningMessage(
					'Unable to rebase due to conflicts. Resolve the conflicts before continuing, or abort the rebase.',
				);
				// TODO: open the rebase editor, if its not already open?
				void executeCommand('gitlens.showCommitsView');
				return;
			}

			if (RebaseError.is(ex, 'alreadyInProgress')) {
				void window.showWarningMessage(
					'Unable to rebase. A rebase is already in progress. Continue or abort the current rebase first.',
				);
				// TODO: open the rebase editor, if its not already open?
				void executeCommand('gitlens.showCommitsView');
				return;
			}

			void showGitErrorMessage(ex, RebaseError.is(ex) ? undefined : 'Unable to rebase');
		}
	}

	protected createContext(context?: StepsContext<any>): Context {
		return {
			...context,
			container: this.container,
			repos: this.container.git.openRepositories,
			associatedView: this.container.views.commits,
			cache: new Map<string, Promise<GitLog | undefined>>(),
			branch: undefined!,
			pickCommit: false,
			pickCommitForItem: false,
			selectedBranchOrTag: undefined,
			showTags: true,
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

			if (context.branch == null) {
				const branch = await state.repo.git.branches.getBranch();
				if (branch == null) break;

				context.branch = branch;
			}

			context.title = `${this.title} ${getReferenceLabel(context.branch, {
				icon: false,
				label: false,
			})} onto`;
			context.pickCommitForItem = false;

			if (steps.isAtStep(Steps.PickBranchOrTag) || state.destination == null) {
				using step = steps.enterStep(Steps.PickBranchOrTag);

				const pickCommitToggle = new PickCommitToggleQuickInputButton(context.pickCommit, context, () => {
					context.pickCommit = !context.pickCommit;
					pickCommitToggle.on = context.pickCommit;
				});

				const result = yield* pickBranchOrTagStep(state, context, {
					placeholder: context => `Choose a branch${context.showTags ? ' or tag' : ''} to rebase onto`,
					picked: context.selectedBranchOrTag?.ref,
					value: context.selectedBranchOrTag == null ? state.destination?.ref : undefined,
					additionalButtons: [pickCommitToggle],
				});
				if (result === StepResultBreak) {
					state.destination = undefined!;
					if (step.goBack() == null) break;
					continue;
				}

				state.destination = result;
				context.selectedBranchOrTag = undefined;
			}

			if (!isRevisionReference(state.destination)) {
				context.selectedBranchOrTag = state.destination;
			}

			if (
				context.selectedBranchOrTag != null &&
				(steps.isAtStep(Steps.PickCommit) ||
					context.pickCommit ||
					context.pickCommitForItem ||
					state.destination.ref === context.branch.ref)
			) {
				using step = steps.enterStep(Steps.PickCommit);

				const rev = context.selectedBranchOrTag.ref;

				let log = context.cache.get(rev);
				if (log == null) {
					log = state.repo.git.commits.getLog(rev, { merges: 'first-parent' });
					context.cache.set(rev, log);
				}

				const result = yield* pickCommitStep(state, context, {
					emptyItems: [
						createDirectiveQuickPickItem(Directive.Cancel, true, {
							label: 'OK',
							detail: `No commits found on ${getReferenceLabel(context.selectedBranchOrTag, { icon: false })}`,
						}),
					],
					ignoreFocusOut: true,
					log: await log,
					onDidLoadMore: log => context.cache.set(rev, Promise.resolve(log)),
					placeholder: (context, log) =>
						!log?.commits.size
							? `No commits found on ${getReferenceLabel(context.selectedBranchOrTag, { icon: false })}`
							: `Choose a commit to rebase ${getReferenceLabel(context.branch, { icon: false })} onto`,
					picked: state.destination?.ref,
				});
				if (result === StepResultBreak) {
					if (step.goBack() == null) break;
					continue;
				}

				state.destination = result;
			}

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

	private async *confirmStep(
		state: StepState<State<Repository>>,
		context: Context,
	): AsyncStepResultGenerator<Flags[]> {
		const counts = await state.repo.git.commits.getLeftRightCommitCount(
			createRevisionRange(state.destination.ref, context.branch.ref, '...'),
			{ excludeMerges: true },
		);

		const title = `${context.title} ${getReferenceLabel(state.destination, { icon: false, label: false })}`;
		const ahead = counts?.right ?? 0;
		const behind = counts?.left ?? 0;
		if (behind === 0 && ahead === 0) {
			const step: QuickPickStep<DirectiveQuickPickItem> = this.createConfirmStep(
				appendReposToTitle(`Confirm ${title}`, state, context),
				[],
				createDirectiveQuickPickItem(Directive.Cancel, true, {
					label: 'OK',
					detail: `${getReferenceLabel(context.branch, {
						capitalize: true,
					})} is already up to date with ${getReferenceLabel(state.destination, { label: false })}`,
				}),
				{
					placeholder: `Nothing to rebase; ${getReferenceLabel(context.branch, {
						label: false,
						icon: false,
					})} is already up to date`,
				},
			);
			const selection: StepSelection<typeof step> = yield step;
			canPickStepContinue(step, state, selection);
			return StepResultBreak;
		}

		const items: FlagsQuickPickItem<Flags>[] = [
			createFlagsQuickPickItem<Flags>(state.flags, ['--interactive'], {
				label: `Interactive ${this.title}`,
				description: '--interactive',
				detail: `Will interactively update ${getReferenceLabel(context.branch, {
					label: false,
				})} by applying ${pluralize('commit', ahead)} on top of ${getReferenceLabel(state.destination, {
					label: false,
				})}`,
				picked: behind === 0,
			}),
			createFlagsQuickPickItem<Flags>(state.flags, ['--interactive', '--update-refs'], {
				label: `Interactive ${this.title} & Update Branches`,
				description: '--interactive --update-refs',
				detail: `Will interactively update ${getReferenceLabel(context.branch, {
					label: false,
				})} and any branches pointing to rebased commits`,
			}),
		];

		if (behind > 0) {
			items.unshift(
				createFlagsQuickPickItem<Flags>(state.flags, [], {
					label: this.title,
					detail: `Will update ${getReferenceLabel(context.branch, {
						label: false,
					})} by applying ${pluralize('commit', ahead)} on top of ${getReferenceLabel(state.destination, {
						label: false,
					})}`,
					picked: true,
				}),
				createFlagsQuickPickItem<Flags>(state.flags, ['--update-refs'], {
					label: `${this.title} & Update Branches`,
					description: '--update-refs',
					detail: `Will update ${getReferenceLabel(context.branch, {
						label: false,
					})} and any branches pointing to rebased commits`,
				}),
			);
		}

		let potentialConflict: Promise<ConflictDetectionResult | undefined> | undefined;
		const subscription = await this.container.subscription.getSubscription();
		if (isSubscriptionTrialOrPaidFromState(subscription?.state)) {
			potentialConflict = state.repo.git.commits
				.getLogShas(`${state.destination.ref}..${context.branch.name}`, { merges: false, reverse: true })
				.then(shas =>
					state.repo.git.branches.getPotentialApplyConflicts?.(state.destination.ref, [...shas], {
						stopOnFirstConflict: true,
					}),
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

		step = this.createConfirmStep(appendReposToTitle(`Confirm ${title}`, state, context), [...notices, ...items]);
		const selection: StepSelection<typeof step> = yield step;
		return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
	}
}

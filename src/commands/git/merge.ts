import { ThemeIcon, window } from 'vscode';
import type { Container } from '../../container.js';
import { MergeError } from '../../git/errors.js';
import type { GitBranch } from '../../git/models/branch.js';
import type { GitLog } from '../../git/models/log.js';
import type { ConflictDetectionResult } from '../../git/models/mergeConflicts.js';
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
import { PickCommitToggleQuickInputButton } from '../quick-wizard/quickButtons.js';
import { QuickCommand } from '../quick-wizard/quickCommand.js';
import { pickCommitStep } from '../quick-wizard/steps/commits.js';
import { pickBranchOrTagStep } from '../quick-wizard/steps/references.js';
import { pickRepositoryStep } from '../quick-wizard/steps/repositories.js';
import { StepsController } from '../quick-wizard/stepsController.js';
import { appendReposToTitle, assertStepState, canPickStepContinue } from '../quick-wizard/utils/steps.utils.js';

const Steps = {
	PickRepo: 'merge-pick-repo',
	PickBranchOrTag: 'merge-pick-branch-or-tag',
	PickCommit: 'merge-pick-commit',
	Confirm: 'merge-confirm',
} as const;
type StepNames = (typeof Steps)[keyof typeof Steps];

interface Context extends StepsContext<StepNames> {
	repos: Repository[];
	associatedView: ViewsWithRepositoryFolders;
	cache: Map<string, Promise<GitLog | undefined>>;
	destination: GitBranch;
	pickCommit: boolean;
	pickCommitForItem: boolean;
	selectedBranchOrTag: GitReference | undefined;
	showTags: boolean;
	title: string;
}

type Flags = '--ff-only' | '--no-ff' | '--squash' | '--no-commit';
interface State<Repo = string | Repository> {
	repo: Repo;
	reference: GitReference;
	flags: Flags[];
}

export interface MergeGitCommandArgs {
	readonly command: 'merge';
	state?: Partial<State>;
}

export class MergeGitCommand extends QuickCommand<State> {
	constructor(container: Container, args?: MergeGitCommandArgs) {
		super(container, 'merge', 'merge', 'Merge', {
			description: 'integrates changes from a specified branch into the current branch',
		});

		this.initialState = { confirm: true, ...args?.state };
	}

	override get canSkipConfirm(): boolean {
		return false;
	}

	private async execute(state: StepState<State<Repository>>) {
		const options: { fastForward?: boolean | 'only'; noCommit?: boolean; squash?: boolean } = {};

		if (state.flags.includes('--ff-only')) {
			options.fastForward = 'only';
		} else if (state.flags.includes('--no-ff')) {
			options.fastForward = false;
		}
		if (state.flags.includes('--squash')) {
			options.squash = true;
		}
		if (state.flags.includes('--no-commit')) {
			options.noCommit = true;
		}

		try {
			await state.repo.git.ops?.merge(state.reference.ref, options);
		} catch (ex) {
			// Don't show an error message if the user intentionally aborted the merge
			if (MergeError.is(ex, 'aborted')) {
				Logger.debug(ex.message, this.title);
				return;
			}

			Logger.error(ex, this.title);

			if (MergeError.is(ex, 'uncommittedChanges') || MergeError.is(ex, 'wouldOverwriteChanges')) {
				void window.showWarningMessage(
					'Unable to merge. Your local changes would be overwritten. Please commit or stash your changes before trying again.',
				);
				return;
			}

			if (MergeError.is(ex, 'conflicts')) {
				void window.showWarningMessage(
					'Unable to merge due to conflicts. Resolve the conflicts before continuing, or abort the merge.',
				);
				void executeCommand('gitlens.showCommitsView');
				return;
			}

			if (MergeError.is(ex, 'alreadyInProgress')) {
				void window.showWarningMessage(
					'Unable to merge. A merge is already in progress. Continue or abort the current merge first.',
				);
				void executeCommand('gitlens.showCommitsView');
				return;
			}

			void showGitErrorMessage(ex, MergeError.is(ex) ? undefined : 'Unable to merge');
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

			if (context.destination == null) {
				const branch = await state.repo.git.branches.getBranch();
				if (branch == null) break;

				context.destination = branch;
			}

			context.title = `${this.title} into ${getReferenceLabel(context.destination, {
				icon: false,
				label: false,
			})}`;
			context.pickCommitForItem = false;

			if (steps.isAtStep(Steps.PickBranchOrTag) || state.reference == null) {
				using step = steps.enterStep(Steps.PickBranchOrTag);

				const pickCommitToggle = new PickCommitToggleQuickInputButton(context.pickCommit, context, () => {
					context.pickCommit = !context.pickCommit;
					pickCommitToggle.on = context.pickCommit;
				});

				const result: StepResult<GitReference> = yield* pickBranchOrTagStep(state, context, {
					placeholder: context => `Choose a branch${context.showTags ? ' or tag' : ''} to merge`,
					picked: context.selectedBranchOrTag?.ref,
					value: context.selectedBranchOrTag == null ? state.reference?.ref : undefined,
					additionalButtons: [pickCommitToggle],
				});
				if (result === StepResultBreak) {
					state.reference = undefined!;
					if (step.goBack() == null) break;
					continue;
				}

				state.reference = result;
				context.selectedBranchOrTag = undefined;
			}

			if (!isRevisionReference(state.reference)) {
				context.selectedBranchOrTag = state.reference;
			}

			if (
				context.selectedBranchOrTag != null &&
				(steps.isAtStep(Steps.PickCommit) ||
					context.pickCommit ||
					context.pickCommitForItem ||
					state.reference.ref === context.destination.ref)
			) {
				using step = steps.enterStep(Steps.PickCommit);

				const rev = context.selectedBranchOrTag.ref;

				let log = context.cache.get(rev);
				if (log == null) {
					log = state.repo.git.commits.getLog(rev, { merges: 'first-parent' });
					context.cache.set(rev, log);
				}

				const result: StepResult<GitReference> = yield* pickCommitStep(state, context, {
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
							: `Choose a commit to merge into ${getReferenceLabel(context.destination, { icon: false })}`,
					picked: state.reference?.ref,
				});
				if (result === StepResultBreak) {
					if (step.goBack() == null) break;
					continue;
				}

				state.reference = result;
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
			createRevisionRange(context.destination.ref, state.reference.ref, '...'),
		);

		const title = `Merge ${getReferenceLabel(state.reference, { icon: false, label: false })} into ${getReferenceLabel(context.destination, { icon: false, label: false })} `;
		const count = counts != null ? counts.right : 0;
		if (count === 0) {
			const step: QuickPickStep<DirectiveQuickPickItem> = this.createConfirmStep(
				appendReposToTitle(`Confirm ${title}`, state, context),
				[],
				createDirectiveQuickPickItem(Directive.Cancel, true, {
					label: 'OK',
					detail: `${getReferenceLabel(context.destination, {
						capitalize: true,
						label: false,
					})} is already up to date with ${getReferenceLabel(state.reference, { label: false })}`,
				}),
				{
					placeholder: `Nothing to merge; ${getReferenceLabel(context.destination, {
						label: false,
						icon: false,
					})} is already up to date`,
				},
			);
			const selection: StepSelection<typeof step> = yield step;
			canPickStepContinue(step, state, selection);
			return StepResultBreak;
		}

		const items = [
			createFlagsQuickPickItem<Flags>(state.flags, [], {
				label: this.title,
				detail: `Will merge ${pluralize('commit', count)} from ${getReferenceLabel(state.reference, {
					label: false,
				})} into ${getReferenceLabel(context.destination, { label: false })}`,
				picked: true,
			}),
			createFlagsQuickPickItem<Flags>(state.flags, ['--ff-only'], {
				label: `Fast-forward ${this.title}`,
				description: '--ff-only',
				detail: `Will fast-forward merge ${pluralize('commit', count)} from ${getReferenceLabel(
					state.reference,
					{ label: false },
				)} into ${getReferenceLabel(context.destination, { label: false })}`,
			}),
			createFlagsQuickPickItem<Flags>(state.flags, ['--squash'], {
				label: `Squash ${this.title}`,
				description: '--squash',
				detail: `Will squash ${pluralize('commit', count)} from ${getReferenceLabel(state.reference, {
					label: false,
				})} into one when merging into ${getReferenceLabel(context.destination, { label: false })}`,
			}),
			createFlagsQuickPickItem<Flags>(state.flags, ['--no-ff'], {
				label: `No Fast-forward ${this.title}`,
				description: '--no-ff',
				detail: `Will create a merge commit when merging ${pluralize('commit', count)} from ${getReferenceLabel(
					state.reference,
					{ label: false },
				)} into ${getReferenceLabel(context.destination, { label: false })}`,
			}),
			createFlagsQuickPickItem<Flags>(state.flags, ['--no-ff', '--no-commit'], {
				label: `Don't Commit ${this.title}`,
				description: '--no-commit --no-ff',
				detail: `Will pause before committing the merge of ${pluralize(
					'commit',
					count,
				)} from ${getReferenceLabel(state.reference, {
					label: false,
				})} into ${getReferenceLabel(context.destination, { label: false })}`,
			}),
		];

		let potentialConflict: Promise<ConflictDetectionResult | undefined> | undefined;
		const subscription = await this.container.subscription.getSubscription();
		if (isSubscriptionTrialOrPaidFromState(subscription?.state)) {
			potentialConflict = state.repo.git.branches.getPotentialMergeConflicts?.(
				state.reference.name,
				context.destination.name,
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
							detail: `Will result in ${pluralize(
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
